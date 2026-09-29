import { ethers } from "ethers";
import contractConfig from "../config/contract.json";

export const MST_CHAIN_ID_DECIMAL = Number(import.meta.env.VITE_MST_CHAIN_ID) || 91562037;
export const MST_CHAIN_ID_HEX = "0x" + MST_CHAIN_ID_DECIMAL.toString(16);
export const MST_RPC_URL = import.meta.env.VITE_MST_RPC_URL || "https://testnetrpc.mstblockchain.com";
export const MST_EXPLORER_URL = import.meta.env.VITE_MST_EXPLORER_URL || "https://testnet.mstscan.com";
export const MST_CONTRACT_ADDRESS = import.meta.env.VITE_CONTRACT_ADDRESS || contractConfig.contractAddress;
export function getRelayApiUrl() {
  if (typeof window !== "undefined") {
    const saved = localStorage.getItem("mst_relay_api_url");
    if (saved && saved.trim()) return saved.trim().replace(/\/$/, "");
  }
  return (import.meta.env.VITE_RELAY_API_URL || "http://localhost:5001").replace(/\/$/, "");
}

export function setRelayApiUrl(url) {
  if (typeof window !== "undefined") {
    const clean = (url || "").trim().replace(/\/$/, "");
    if (clean) {
      localStorage.setItem("mst_relay_api_url", clean);
    } else {
      localStorage.removeItem("mst_relay_api_url");
    }
    window.dispatchEvent(new CustomEvent("relay-url-changed", { detail: clean }));
  }
}

export const RELAY_API_URL = getRelayApiUrl();

// Helper to find the active Ethereum / BridgeKey provider
export function getEthereumProvider() {
  if (typeof window === "undefined") return null;
  // If BridgeKey is directly injected as window.bridgekey
  if (window.bridgekey) return window.bridgekey;
  // If multiple extensions are installed (EIP-6963 / multi-provider)
  if (window.ethereum?.providers && Array.isArray(window.ethereum.providers)) {
    const bk = window.ethereum.providers.find(p => p.isBridgeKey);
    if (bk) return bk;
    return window.ethereum.providers[0];
  }
  return window.ethereum || null;
}

// Retry helper with exponential backoff for RPC calls
async function retryRpc(fn, maxRetries = 2, baseDelay = 600) {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const is429 = err?.message?.includes('429') || 
                    err?.info?.error?.message?.includes('429') ||
                    err?.error?.message?.includes('429');
      if (is429 && attempt < maxRetries) {
        await new Promise(r => setTimeout(r, baseDelay * Math.pow(2, attempt)));
        continue;
      }
      throw err;
    }
  }
}

export const MST_NETWORK_PARAMS = {
  chainId: MST_CHAIN_ID_HEX,
  chainName: "MST Testnet",
  nativeCurrency: {
    name: "MST Coin",
    symbol: "MSTC",
    decimals: 18
  },
  rpcUrls: [MST_RPC_URL],
  blockExplorerUrls: [MST_EXPLORER_URL]
};

export async function connectWallet(requestPermission = true) {
  const eth = getEthereumProvider();
  if (!eth) {
    throw new Error("BridgeKey (or Web3) wallet not detected in your browser. Please ensure your BridgeKey extension is installed and enabled.");
  }

  try {
    let accounts = [];
    if (requestPermission) {
      try {
        accounts = await eth.request({ method: "eth_requestAccounts" });
      } catch (reqErr) {
        if (reqErr.code === 4001 || reqErr.message?.includes("User rejected") || reqErr.message?.includes("rejected")) {
          throw new Error("Connection request was cancelled in BridgeKey.");
        }
        if (reqErr.code === -32002) {
          throw new Error("Connection request is already pending. Please click the BridgeKey extension icon in your browser to approve.");
        }
        throw reqErr;
      }
    } else {
      // Passive check: only read accounts already permitted
      accounts = await eth.request({ method: "eth_accounts" });
      if (!accounts || accounts.length === 0) {
        return null;
      }
    }

    if (!accounts || accounts.length === 0) {
      throw new Error("No accounts found in BridgeKey. Please unlock your wallet and select an account.");
    }

    // Only attempt network switch if this was an active user click
    if (requestPermission) {
      try {
        await ensureMstNetwork();
      } catch (netErr) {
        console.warn("MST network check non-fatal warning:", netErr?.message || netErr);
      }
    }

    // Initialize BrowserProvider with "any" to avoid network change freezes
    const provider = new ethers.BrowserProvider(eth, "any");
    const signer = await provider.getSigner();
    const address = await signer.getAddress();
    
    // Balance fetch is best-effort — never break wallet connection over balance read failure
    let balance = "0.0000";
    try {
      const balanceRaw = await retryRpc(() => provider.getBalance(address));
      balance = Number(ethers.formatEther(balanceRaw)).toFixed(4);
    } catch (_) {
      try {
        const directProvider = new ethers.JsonRpcProvider(MST_RPC_URL);
        const balanceRaw = await retryRpc(() => directProvider.getBalance(address));
        balance = Number(ethers.formatEther(balanceRaw)).toFixed(4);
      } catch (directErr) {
        console.warn("Balance fetch skipped (RPC rate limit or offline). Wallet connected successfully.");
      }
    }

    return {
      provider,
      signer,
      address,
      balance
    };
  } catch (err) {
    if (err.message?.includes("Extension context invalidated")) {
      throw new Error("BridgeKey extension was reloaded. Please refresh the page (press Cmd+R or F5) and reconnect.");
    }
    if (err.message?.includes("429")) {
      throw new Error("MST Testnet RPC is temporarily rate-limited. Please wait 10 seconds and try again.");
    }
    throw err;
  }
}

export async function ensureMstNetwork() {
  const eth = getEthereumProvider();
  if (!eth) return false;
  
  let currentChainId;
  try {
    currentChainId = await eth.request({ method: "eth_chainId" });
  } catch (err) {
    console.warn("Could not read eth_chainId:", err?.message || err);
    return false;
  }

  // Already on MST Testnet
  if (currentChainId && currentChainId.toLowerCase() === MST_CHAIN_ID_HEX.toLowerCase()) {
    return true;
  }

  try {
    await eth.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: MST_CHAIN_ID_HEX }]
    });
    return true;
  } catch (switchError) {
    // 4902 indicates chain has not been added yet
    const isUnrecognized = switchError.code === 4902 || 
                           switchError.code === -32603 ||
                           switchError.message?.toLowerCase().includes("unrecognized") ||
                           switchError.message?.toLowerCase().includes("not added");
    if (isUnrecognized) {
      try {
        await eth.request({
          method: "wallet_addEthereumChain",
          params: [MST_NETWORK_PARAMS]
        });
        return true;
      } catch (addError) {
        console.warn("Could not add MST Testnet to wallet:", addError?.message || addError);
      }
    } else {
      console.warn("Could not switch to MST Testnet:", switchError?.message || switchError);
    }
  }

  return false;
}

export function getContractInstance(signerOrProvider) {
  const address = MST_CONTRACT_ADDRESS;
  if (!address || !ethers.isAddress(address)) {
    return null;
  }
  return new ethers.Contract(address, contractConfig.abi, signerOrProvider);
}

export function formatAddress(address) {
  if (!address) return "";
  return `${address.substring(0, 6)}...${address.substring(address.length - 4)}`;
}

export function hashRfidUid(uid) {
  return ethers.keccak256(ethers.toUtf8Bytes(uid.trim()));
}
