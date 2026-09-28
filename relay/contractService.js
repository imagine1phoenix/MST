const { ethers } = require("ethers");
const path = require("path");
const fs = require("fs");
const dotenv = require("dotenv");
dotenv.config({ path: path.join(__dirname, ".env") });

class ContractService {
  constructor() {
    this.configFile = path.join(__dirname, "config/contract.json");
    this.config = this.loadConfig();
    this.rpcUrl = process.env.MST_RPC_URL || this.config.rpcUrl || "https://testnetrpc.mstblockchain.com";
    this.provider = new ethers.JsonRpcProvider(this.rpcUrl);
    
    // Terminal signer wallet
    const terminalKey = process.env.TERMINAL_PRIVATE_KEY || "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
    this.terminalWallet = new ethers.Wallet(terminalKey, this.provider);

    this.contract = null;
    this.initContract();
  }

  loadConfig() {
    try {
      if (fs.existsSync(this.configFile)) {
        return JSON.parse(fs.readFileSync(this.configFile, "utf8"));
      }
    } catch (e) {
      console.error("Error reading contract config:", e.message);
    }
    return {
      contractAddress: "",
      abi: [],
      rpcUrl: "https://testnetrpc.mstblockchain.com",
      explorerUrl: "https://testnet.mstscan.com",
      chainId: 91562037
    };
  }

  initContract() {
    this.config = this.loadConfig();
    const address = process.env.CONTRACT_ADDRESS || this.config.contractAddress;
    if (address && ethers.isAddress(address) && this.config.abi && this.config.abi.length > 0) {
      this.contract = new ethers.Contract(address, this.config.abi, this.terminalWallet);
      console.log(`[ContractService] Initialized with contract at: ${address}`);
    } else {
      console.log(`[ContractService] No contract address configured yet. Mock/Simulation mode enabled.`);
      this.contract = null;
    }
  }

  async getDelivery(deliveryId) {
    this.initContract();
    if (!this.contract) {
      return null;
    }
    const d = await this.contract.getDelivery(deliveryId);
    return {
      id: Number(d.id),
      sender: d.sender,
      courier: d.courier,
      recipient: d.recipient,
      terminalAddress: d.terminalAddress,
      escrowAmount: ethers.formatEther(d.escrowAmount),
      cashbackAmount: ethers.formatEther(d.cashbackAmount),
      courierPayout: ethers.formatEther(d.courierPayout),
      rfidHash: d.rfidHash,
      targetLat: Number(d.targetLat) / 1e6,
      targetLon: Number(d.targetLon) / 1e6,
      allowedRadiusMeters: Number(d.allowedRadiusMeters),
      terminalConfirmed: d.terminalConfirmed,
      recipientConfirmed: d.recipientConfirmed,
      status: Number(d.status), // 0: Created, 1: TerminalConfirmed, 2: RecipientConfirmed, 3: Settled, 4: Cancelled
      createdAt: Number(d.createdAt),
      settledAt: Number(d.settledAt),
      verifiedLat: Number(d.verifiedLat) / 1e6,
      verifiedLon: Number(d.verifiedLon) / 1e6
    };
  }

  async terminalConfirm(deliveryId, rfidUid, lat, lon) {
    this.initContract();
    if (!this.contract) {
      throw new Error("Smart contract is not yet deployed. Please deploy contract to MST Testnet first.");
    }

    const latMicro = Math.round(Number(lat) * 1e6);
    const lonMicro = Math.round(Number(lon) * 1e6);

    console.log(`[ContractService] Calling terminalConfirm for delivery #${deliveryId}...`);
    console.log(`  RFID UID: ${rfidUid}`);
    console.log(`  Lat: ${lat} (${latMicro}), Lon: ${lon} (${lonMicro})`);

    const tx = await this.contract.terminalConfirm(deliveryId, rfidUid, latMicro, lonMicro);
    console.log(`[ContractService] Tx broadcasted: ${tx.hash}`);
    const receipt = await tx.wait();
    console.log(`[ContractService] Tx confirmed in block ${receipt.blockNumber}`);

    return {
      success: true,
      txHash: tx.hash,
      blockNumber: receipt.blockNumber,
      mstScanUrl: `${this.config.explorerUrl || "https://testnet.mstscan.com"}/tx/${tx.hash}`
    };
  }
}

module.exports = new ContractService();
