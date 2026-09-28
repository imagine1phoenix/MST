const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("MultiSigDelivery Smart Contract", function () {
  let MultiSigDelivery, contract;
  let sender, courier, recipient, terminal, attacker;

  // Test GPS Coordinates (New Delhi India Gate: 28.6129° N, 77.2295° E)
  // Scaled by 1e6:
  const TARGET_LAT = 28612900;
  const TARGET_LON = 77229500;
  const ALLOWED_RADIUS_METERS = 100; // 100m

  const RFID_SECRET_UID = "CARD_UID_A1B2C3D4";
  const RFID_HASH = ethers.keccak256(ethers.toUtf8Bytes(RFID_SECRET_UID));
  const ESCROW_AMOUNT = ethers.parseEther("1.0"); // 1.0 MSTC

  beforeEach(async function () {
    [sender, courier, recipient, terminal, attacker] = await ethers.getSigners();

    const Factory = await ethers.getContractFactory("MultiSigDelivery");
    contract = await Factory.deploy();
    await contract.waitForDeployment();
  });

  describe("1. Delivery Initialization (FR-01)", function () {
    it("should create delivery with correct escrow, 5% cashback and 95% payout", async function () {
      const tx = await contract.connect(sender).createDelivery(
        courier.address,
        recipient.address,
        terminal.address,
        RFID_HASH,
        TARGET_LAT,
        TARGET_LON,
        ALLOWED_RADIUS_METERS,
        { value: ESCROW_AMOUNT }
      );

      const receipt = await tx.wait();
      expect(await contract.deliveryCount()).to.equal(1);

      const d = await contract.getDelivery(1);
      expect(d.sender).to.equal(sender.address);
      expect(d.courier).to.equal(courier.address);
      expect(d.recipient).to.equal(recipient.address);
      expect(d.terminalAddress).to.equal(terminal.address);
      expect(d.escrowAmount).to.equal(ESCROW_AMOUNT);

      // 5% cashback = 0.05 MSTC, 95% courier = 0.95 MSTC
      const expectedCashback = ethers.parseEther("0.05");
      const expectedPayout = ethers.parseEther("0.95");
      expect(d.cashbackAmount).to.equal(expectedCashback);
      expect(d.courierPayout).to.equal(expectedPayout);
      expect(d.terminalConfirmed).to.be.false;
      expect(d.recipientConfirmed).to.be.false;
    });

    it("should revert if escrow value is zero", async function () {
      await expect(
        contract.connect(sender).createDelivery(
          courier.address,
          recipient.address,
          terminal.address,
          RFID_HASH,
          TARGET_LAT,
          TARGET_LON,
          ALLOWED_RADIUS_METERS,
          { value: 0 }
        )
      ).to.be.revertedWith("Escrow amount must be > 0");
    });
  });

  describe("2. Terminal Confirmation (FR-02: Key 1 Physical Proof)", function () {
    beforeEach(async function () {
      await contract.connect(sender).createDelivery(
        courier.address,
        recipient.address,
        terminal.address,
        RFID_HASH,
        TARGET_LAT,
        TARGET_LON,
        ALLOWED_RADIUS_METERS,
        { value: ESCROW_AMOUNT }
      );
    });

    it("should succeed when terminal scans valid RFID within geofence radius", async function () {
      // 10 microdegrees offset (approx 1 meter away, well within 100m)
      const currentLat = TARGET_LAT + 10;
      const currentLon = TARGET_LON + 10;

      await expect(
        contract.connect(terminal).terminalConfirm(1, RFID_SECRET_UID, currentLat, currentLon)
      )
        .to.emit(contract, "TerminalConfirmed");

      const d = await contract.getDelivery(1);
      expect(d.terminalConfirmed).to.be.true;
      expect(d.status).to.equal(1); // TerminalConfirmed
    });

    it("should reject terminal confirm if RFID UID is incorrect", async function () {
      const wrongUid = "FAKE_CLONED_UID_999";
      await expect(
        contract.connect(terminal).terminalConfirm(1, wrongUid, TARGET_LAT, TARGET_LON)
      ).to.be.revertedWith("RFID authentication failed");
    });

    it("should reject terminal confirm if GPS is outside geofence radius", async function () {
      // Offset by 0.05 degrees (approx 5.5 km away)
      const distantLat = TARGET_LAT + 50000;
      const distantLon = TARGET_LON;

      await expect(
        contract.connect(terminal).terminalConfirm(1, RFID_SECRET_UID, distantLat, distantLon)
      ).to.be.revertedWith("Terminal outside geofence radius");
    });

    it("should reject unauthorized caller if not terminal or courier", async function () {
      await expect(
        contract.connect(attacker).terminalConfirm(1, RFID_SECRET_UID, TARGET_LAT, TARGET_LON)
      ).to.be.revertedWith("Unauthorized terminal caller");
    });
  });

  describe("3. Recipient Confirmation (FR-03: Key 2 Digital Approval)", function () {
    beforeEach(async function () {
      await contract.connect(sender).createDelivery(
        courier.address,
        recipient.address,
        terminal.address,
        RFID_HASH,
        TARGET_LAT,
        TARGET_LON,
        ALLOWED_RADIUS_METERS,
        { value: ESCROW_AMOUNT }
      );
    });

    it("should succeed when recipient signs confirm from BridgeKey wallet", async function () {
      await expect(contract.connect(recipient).recipientConfirm(1))
        .to.emit(contract, "RecipientConfirmed")
        .withArgs(1, recipient.address);

      const d = await contract.getDelivery(1);
      expect(d.recipientConfirmed).to.be.true;
      expect(d.status).to.equal(2); // RecipientConfirmed
    });

    it("should reject non-recipient attempting to sign Key 2", async function () {
      await expect(contract.connect(attacker).recipientConfirm(1)).to.be.revertedWith(
        "Only recipient can confirm Key 2"
      );
    });
  });

  describe("4. End-to-End Multi-Sig Settlement & Payout (FR-04)", function () {
    beforeEach(async function () {
      await contract.connect(sender).createDelivery(
        courier.address,
        recipient.address,
        terminal.address,
        RFID_HASH,
        TARGET_LAT,
        TARGET_LON,
        ALLOWED_RADIUS_METERS,
        { value: ESCROW_AMOUNT }
      );
    });

    it("should settle and distribute funds when Terminal confirms first, then Recipient confirms", async function () {
      // 1. Terminal confirms (Key 1)
      await contract.connect(terminal).terminalConfirm(1, RFID_SECRET_UID, TARGET_LAT, TARGET_LON);

      // Track balances before Key 2
      const courierBalBefore = await ethers.provider.getBalance(courier.address);
      const senderBalBefore = await ethers.provider.getBalance(sender.address);

      // 2. Recipient confirms (Key 2) -> triggers settlement
      const tx = await contract.connect(recipient).recipientConfirm(1);
      await expect(tx)
        .to.emit(contract, "DeliverySettled")
        .withArgs(1, courier.address, ethers.parseEther("0.95"), sender.address, ethers.parseEther("0.05"));

      const d = await contract.getDelivery(1);
      expect(d.status).to.equal(3); // Settled
      expect(d.terminalConfirmed).to.be.true;
      expect(d.recipientConfirmed).to.be.true;

      // Courier received 95%
      const courierBalAfter = await ethers.provider.getBalance(courier.address);
      expect(courierBalAfter - courierBalBefore).to.equal(ethers.parseEther("0.95"));

      // Sender received 5% cashback
      const senderBalAfter = await ethers.provider.getBalance(sender.address);
      expect(senderBalAfter - senderBalBefore).to.equal(ethers.parseEther("0.05"));
    });

    it("should settle and distribute funds when Recipient confirms first, then Terminal confirms", async function () {
      // 1. Recipient confirms (Key 2)
      await contract.connect(recipient).recipientConfirm(1);

      // Track balances before Key 1
      const courierBalBefore = await ethers.provider.getBalance(courier.address);
      const senderBalBefore = await ethers.provider.getBalance(sender.address);

      // 2. Terminal confirms (Key 1) -> triggers settlement
      const tx = await contract.connect(terminal).terminalConfirm(1, RFID_SECRET_UID, TARGET_LAT, TARGET_LON);
      await expect(tx).to.emit(contract, "DeliverySettled");

      const d = await contract.getDelivery(1);
      expect(d.status).to.equal(3); // Settled

      const courierBalAfter = await ethers.provider.getBalance(courier.address);
      expect(courierBalAfter - courierBalBefore).to.equal(ethers.parseEther("0.95"));

      const senderBalAfter = await ethers.provider.getBalance(sender.address);
      expect(senderBalAfter - senderBalBefore).to.equal(ethers.parseEther("0.05"));
    });
  });

  describe("5. Cancellation and Escrow Refund", function () {
    it("should allow sender to cancel and receive 100% refund before any confirmation", async function () {
      await contract.connect(sender).createDelivery(
        courier.address,
        recipient.address,
        terminal.address,
        RFID_HASH,
        TARGET_LAT,
        TARGET_LON,
        ALLOWED_RADIUS_METERS,
        { value: ESCROW_AMOUNT }
      );

      const senderBalBefore = await ethers.provider.getBalance(sender.address);

      const tx = await contract.connect(sender).cancelAndRefund(1);
      const receipt = await tx.wait();
      const gasCost = receipt.gasUsed * receipt.gasPrice;

      const senderBalAfter = await ethers.provider.getBalance(sender.address);
      expect(senderBalAfter + gasCost - senderBalBefore).to.equal(ESCROW_AMOUNT);

      const d = await contract.getDelivery(1);
      expect(d.status).to.equal(4); // Cancelled
    });
  });
});
