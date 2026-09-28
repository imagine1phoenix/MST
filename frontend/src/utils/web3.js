import { ethers } from "ethers";
import contractConfig from "../config/contract.json";

export const MST_CHAIN_ID_DECIMAL = 91562037;
export const MST_CHAIN_ID_HEX = "0x5752035";

export const MST_NETWORK_PARAMS = {
  chainId: MST_CHAIN_ID_HEX,
  chainName: "MST Testnet",
  nativeCurrency: {
    name: "MST Coin",
    symbol: "MSTC",
    decimals: 18
  },
  rpcUrls: ["https://testnetrpc.mstblockchain.com"],
  blockExplorerUrls: ["https://testnet.mstscan.com"]
};

export async function connectWallet() {
  if (typeof window.ethereum === "undefined") {
    throw new Error("BridgeKey (or MetaMask) wallet not detected. Please install the BridgeKey extension.");
  }

  const accounts = await window.ethereum.request({ method: "eth_requestAccounts" });
  if (!accounts || accounts.length === 0) {
    throw new Error("No accounts found in wallet");
  }

  // Ensure user is on MST Testnet
  await ensureMstNetwork();

  const provider = new ethers.BrowserProvider(window.ethereum);
  const signer = await provider.getSigner();
  const address = await signer.getAddress();
  const balanceRaw = await provider.getBalance(address);
  const balance = ethers.formatEther(balanceRaw);

  return {
    provider,
    signer,
    address,
    balance: Number(balance).toFixed(4)
  };
}

export async function ensureMstNetwork() {
  if (!window.ethereum) return;
  const currentChainId = await window.ethereum.request({ method: "eth_chainId" });

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
  const address = contractConfig.contractAddress;
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
