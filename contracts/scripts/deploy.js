const { ethers } = require("hardhat");
const fs = require("fs");
const path = require("path");

async function main() {
  console.log("==========================================");
  console.log(" Deploying MultiSigDelivery to MST Network");
  console.log("==========================================");

  const [deployer] = await ethers.getSigners();
  console.log("Deployer Address:", deployer.address);

  const balance = await ethers.provider.getBalance(deployer.address);
  console.log("Deployer Balance:", ethers.formatEther(balance), "MSTC");

  if (balance === 0n) {
    console.warn("⚠️ Warning: Deployer balance is 0. Claim faucet tokens at https://faucet.masterstroke.academy");
  }

  const Factory = await ethers.getContractFactory("MultiSigDelivery");
  console.log("Broadcasting deployment transaction...");
  const contract = await Factory.deploy();
  await contract.waitForDeployment();

  const contractAddress = await contract.getAddress();
  console.log("✅ MultiSigDelivery deployed at:", contractAddress);
  console.log("MSTScan Explorer URL:", `https://testnet.mstscan.com/address/${contractAddress}`);

  // Save deployment artifact
  const deploymentInfo = {
    network: "mstTestnet",
    chainId: 91562037,
    contractAddress,
    deployer: deployer.address,
    deployedAt: new Date().toISOString(),
  };

  const artifactPath = path.join(__dirname, "../artifacts/contracts/MultiSigDelivery.sol/MultiSigDelivery.json");
  const contractArtifact = JSON.parse(fs.readFileSync(artifactPath, "utf8"));
  deploymentInfo.abi = contractArtifact.abi;

  fs.writeFileSync(
    path.join(__dirname, "../deployedAddress.json"),
    JSON.stringify(deploymentInfo, null, 2)
  );
  console.log("Saved deployment info to contracts/deployedAddress.json");

  // Also sync to relay and frontend directories if they exist
  const relayConfigDir = path.join(__dirname, "../../relay/config");
  if (!fs.existsSync(relayConfigDir)) fs.mkdirSync(relayConfigDir, { recursive: true });
  fs.writeFileSync(path.join(relayConfigDir, "contract.json"), JSON.stringify(deploymentInfo, null, 2));

  const frontendConfigDir = path.join(__dirname, "../../frontend/src/config");
  if (!fs.existsSync(frontendConfigDir)) fs.mkdirSync(frontendConfigDir, { recursive: true });
  fs.writeFileSync(path.join(frontendConfigDir, "contract.json"), JSON.stringify(deploymentInfo, null, 2));

  console.log("Synced ABI and contract address to /relay and /frontend");
}

main().catch((error) => {
  console.error("Deployment failed:", error);
  process.exitCode = 1;
});
