import { ethers } from "ethers";
import contractConfig from "../config/contract.json";

export const MST_CHAIN_ID_DECIMAL = Number(import.meta.env.VITE_MST_CHAIN_ID) || 91562037;
export const MST_CHAIN_ID_HEX = "0x" + MST_CHAIN_ID_DECIMAL.toString(16);
export const MST_RPC_URL = import.meta.env.VITE_MST_RPC_URL || "https://testnetrpc.mstblockchain.com";
export const MST_EXPLORER_URL = import.meta.env.VITE_MST_EXPLORER_URL || "https://testnet.mstscan.com";
export const MST_CONTRACT_ADDRESS = import.meta.env.VITE_CONTRACT_ADDRESS || contractConfig.contractAddress;
export const RELAY_API_URL = (import.meta.env.VITE_RELAY_API_URL || "http://localhost:5001").replace(/\/$/, "");

// Retry helper with exponential backoff for RPC rate limits (429)
async function retryRpc(fn, maxRetries = 3, baseDelay = 800) {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const is429 = err?.message?.includes('429') || 
                    err?.info?.error?.message?.includes('429') ||
                    err?.error?.message?.includes('429') ||
                    err?.code === -32603;
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

export async function connectWallet() {
  if (typeof window.ethereum === "undefined") {
    throw new Error("BridgeKey (or MetaMask) wallet not detected. Please install the BridgeKey extension.");
  }

  try {
    const accounts = await window.ethereum.request({ method: "eth_requestAccounts" });
    if (!accounts || accounts.length === 0) {
      throw new Error("No accounts found in wallet");
    }

    // Ensure user is on MST Testnet
    await ensureMstNetwork();

    const provider = new ethers.BrowserProvider(window.ethereum);
    const signer = await provider.getSigner();
    const address = await signer.getAddress();
    
    // Balance fetch is best-effort — never break connection over it
    let balance = "0.0000";
    try {
      const balanceRaw = await retryRpc(() => provider.getBalance(address));
      balance = Number(ethers.formatEther(balanceRaw)).toFixed(4);
    } catch (balErr) {
      try {
        const directProvider = new ethers.JsonRpcProvider(MST_RPC_URL);
        const balanceRaw = await retryRpc(() => directProvider.getBalance(address));
        balance = Number(ethers.formatEther(balanceRaw)).toFixed(4);
      } catch (_) {
        // Balance unavailable due to RPC rate limits — show 0 and continue
        console.warn("Balance fetch failed (RPC rate limit). Wallet connected with balance shown as 0.");
      }
    }

    return {
      provider,
      signer,
      address,
      balance
    };
  } catch (err) {
    if (
      err.message?.includes("BridgeKey was updated") ||
      err.message?.includes("could not coalesce error") ||
      err.code === -32603 ||
      err.info?.error?.code === -32603
    ) {
      // Check if this is specifically a 429 rate limit
      const is429 = err.message?.includes('429') || err.info?.error?.message?.includes('429');
      if (is429) {
        throw new Error("MST Testnet RPC is temporarily rate-limited. Please wait a few seconds and try connecting again.");
      }
      throw new Error("BridgeKey extension was recently updated or reloaded. Please refresh this page (press Cmd+R or F5) and click Connect Wallet again.");
    }
    throw err;
  }
}

export async function ensureMstNetwork() {
  if (!window.ethereum) return;
  
  let currentChainId;
  try {
    currentChainId = await window.ethereum.request({ method: "eth_chainId" });
  } catch (err) {
    // If we can't even read the chain ID, skip network check (wallet will prompt later)
    console.warn("Could not read chain ID, skipping network check:", err.message);
    return;
  }

  if (currentChainId !== MST_CHAIN_ID_HEX) {
    try {
      await window.ethereum.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: MST_CHAIN_ID_HEX }]
      });
    } catch (switchError) {
      // Code 4902 means the chain has not been added yet
      if (switchError.code === 4902 || switchError.message?.includes("Unrecognized chain")) {
        await window.ethereum.request({
          method: "wallet_addEthereumChain",
          params: [MST_NETWORK_PARAMS]
        });
      } else {
        throw switchError;
      }
    }
  }
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
