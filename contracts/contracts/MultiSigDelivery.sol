// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title MultiSigDelivery
 * @notice Two-Factor Multi-Signature Smart Delivery Terminal Escrow with GPS Geofencing
 * @dev Combines Physical Hardware Scan (Key 1: RFID + GPS) with Digital Recipient Wallet (Key 2: BridgeKey)
 */
contract MultiSigDelivery is ReentrancyGuard {
    // --- Data Types ---
    enum DeliveryStatus {
        Created,
        TerminalConfirmed,
        RecipientConfirmed,
        Settled,
        Cancelled
    }

    struct Delivery {
        uint256 id;
        address payable sender;
        address payable courier;
        address recipient;
        address terminalAddress; // Authorized terminal/relay address (or address(0) to allow courier)
        uint256 escrowAmount;
        uint256 cashbackAmount;   // 5% cashback to sender
        uint256 courierPayout;    // 95% payout to courier
        bytes32 rfidHash;         // keccak256 hash of the RFID UID
        int32 targetLat;          // Scaled by 1e6 (microdegrees)
        int32 targetLon;          // Scaled by 1e6 (microdegrees)
        uint32 allowedRadiusMeters;
        bool terminalConfirmed;
        bool recipientConfirmed;
        DeliveryStatus status;
        uint256 createdAt;
        uint256 settledAt;
        int32 verifiedLat;
        int32 verifiedLon;
    }

    // --- State Variables ---
    uint256 public deliveryCount;
    mapping(uint256 => Delivery) public deliveries;

    // Lookup table for cosine (scaled by 10,000) from 0 to 90 degrees at 10-degree increments
    uint16[10] private cosTable = [10000, 9848, 9397, 8660, 7660, 6428, 5000, 3420, 1736, 0];

    // --- Events ---
    event DeliveryCreated(
        uint256 indexed deliveryId,
        address indexed sender,
        address indexed recipient,
        address courier,
        uint256 escrowAmount,
        bytes32 rfidHash,
        int32 targetLat,
        int32 targetLon,
        uint32 allowedRadiusMeters
    );

    event TerminalConfirmed(
        uint256 indexed deliveryId,
        address indexed terminal,
        int32 verifiedLat,
        int32 verifiedLon,
        uint256 calculatedDistanceMeters
    );

    event RecipientConfirmed(
        uint256 indexed deliveryId,
        address indexed recipient
    );

    event DeliverySettled(
        uint256 indexed deliveryId,
        address indexed courier,
        uint256 courierPayout,
        address indexed sender,
        uint256 cashbackAmount
    );

    event DeliveryCancelled(
        uint256 indexed deliveryId,
        address indexed sender,
        uint256 refundAmount
    );

    // --- Modifiers ---
    modifier deliveryExists(uint256 _deliveryId) {
        require(_deliveryId > 0 && _deliveryId <= deliveryCount, "Delivery does not exist");
        _;
    }

    // --- Main Functions ---

    /**
     * @notice Create a new delivery escrow
     * @param _courier Address of the courier receiving payout upon completion
     * @param _recipient Address of the customer/recipient signing Key 2 with BridgeKey
     * @param _terminalAddress Specific authorized IoT terminal address (or address(0) to allow courier)
     * @param _rfidHash Keccak256 hash of the RFID UID assigned to this delivery
     * @param _targetLat Destination latitude in microdegrees (lat * 1e6)
     * @param _targetLon Destination longitude in microdegrees (lon * 1e6)
     * @param _allowedRadiusMeters Maximum allowed distance in meters for GPS verification
     */
    function createDelivery(
        address payable _courier,
        address _recipient,
        address _terminalAddress,
        bytes32 _rfidHash,
        int32 _targetLat,
        int32 _targetLon,
        uint32 _allowedRadiusMeters
    ) external payable nonReentrant returns (uint256) {
        require(msg.value > 0, "Escrow amount must be > 0");
        require(_courier != address(0), "Invalid courier address");
        require(_recipient != address(0), "Invalid recipient address");
        require(_rfidHash != bytes32(0), "Invalid RFID hash");
        require(_allowedRadiusMeters > 0, "Radius must be > 0");

        deliveryCount++;
        uint256 deliveryId = deliveryCount;

        // 5% cashback incentive to sender, 95% to courier
        uint256 cashback = (msg.value * 5) / 100;
        uint256 payout = msg.value - cashback;

        deliveries[deliveryId] = Delivery({
            id: deliveryId,
            sender: payable(msg.sender),
            courier: _courier,
            recipient: _recipient,
            terminalAddress: _terminalAddress,
            escrowAmount: msg.value,
            cashbackAmount: cashback,
            courierPayout: payout,
            rfidHash: _rfidHash,
            targetLat: _targetLat,
            targetLon: _targetLon,
            allowedRadiusMeters: _allowedRadiusMeters,
            terminalConfirmed: false,
            recipientConfirmed: false,
            status: DeliveryStatus.Created,
            createdAt: block.timestamp,
            settledAt: 0,
            verifiedLat: 0,
            verifiedLon: 0
        });

        emit DeliveryCreated(
            deliveryId,
            msg.sender,
            _recipient,
            _courier,
            msg.value,
            _rfidHash,
            _targetLat,
            _targetLon,
            _allowedRadiusMeters
        );

        return deliveryId;
    }

    /**
     * @notice Hardware Key 1: Confirm delivery from IoT Terminal Relay
     * @param _deliveryId ID of the delivery
     * @param _rfidUid Raw RFID card UID (will be hashed to verify against stored hash)
     * @param _currentLat Current terminal GPS latitude in microdegrees
     * @param _currentLon Current terminal GPS longitude in microdegrees
     */
    function terminalConfirm(
        uint256 _deliveryId,
        string calldata _rfidUid,
        int32 _currentLat,
        int32 _currentLon
    ) external nonReentrant deliveryExists(_deliveryId) {
        Delivery storage d = deliveries[_deliveryId];

        require(d.status == DeliveryStatus.Created || d.status == DeliveryStatus.RecipientConfirmed, "Invalid delivery status");
        require(!d.terminalConfirmed, "Terminal already confirmed");

        // Verify caller authorization
        if (d.terminalAddress != address(0)) {
            require(
                msg.sender == d.terminalAddress || msg.sender == d.courier || msg.sender == d.sender,
                "Unauthorized terminal caller"
            );
        }

        // 1. Verify RFID Proof
        bytes32 computedHash = keccak256(abi.encodePacked(_rfidUid));
        require(computedHash == d.rfidHash, "RFID authentication failed");

        // 2. Verify GPS Geofence Proof
        uint256 distance = calculateDistance(d.targetLat, d.targetLon, _currentLat, _currentLon);
        require(distance <= d.allowedRadiusMeters, "Terminal outside geofence radius");

        d.terminalConfirmed = true;
        d.verifiedLat = _currentLat;
        d.verifiedLon = _currentLon;

        emit TerminalConfirmed(_deliveryId, msg.sender, _currentLat, _currentLon, distance);

        if (d.recipientConfirmed) {
            _settle(_deliveryId);
        } else {
            d.status = DeliveryStatus.TerminalConfirmed;
        }
    }

    /**
     * @notice Digital Key 2: Confirm delivery via Recipient BridgeKey Wallet
     * @param _deliveryId ID of the delivery
     */
    function recipientConfirm(uint256 _deliveryId) external nonReentrant deliveryExists(_deliveryId) {
        Delivery storage d = deliveries[_deliveryId];

        require(msg.sender == d.recipient, "Only recipient can confirm Key 2");
        require(d.status == DeliveryStatus.Created || d.status == DeliveryStatus.TerminalConfirmed, "Invalid delivery status");
        require(!d.recipientConfirmed, "Recipient already confirmed");

        d.recipientConfirmed = true;

        emit RecipientConfirmed(_deliveryId, msg.sender);

        if (d.terminalConfirmed) {
            _settle(_deliveryId);
        } else {
            d.status = DeliveryStatus.RecipientConfirmed;
        }
    }

    /**
     * @notice Check status and finalize settlement (can be called by any party if both keys are satisfied)
     */
    function checkAndSettle(uint256 _deliveryId) external nonReentrant deliveryExists(_deliveryId) {
        Delivery storage d = deliveries[_deliveryId];
        require(d.terminalConfirmed && d.recipientConfirmed, "Multi-Sig condition not met");
        require(d.status != DeliveryStatus.Settled, "Already settled");
        require(d.status != DeliveryStatus.Cancelled, "Delivery cancelled");

        _settle(_deliveryId);
    }

    /**
     * @notice Cancel delivery and refund escrow if not completed after 3 days, or sender cancels before any confirm
     */
    function cancelAndRefund(uint256 _deliveryId) external nonReentrant deliveryExists(_deliveryId) {
        Delivery storage d = deliveries[_deliveryId];
        require(d.status != DeliveryStatus.Settled, "Already settled");
        require(d.status != DeliveryStatus.Cancelled, "Already cancelled");

        bool isSender = (msg.sender == d.sender);
        bool hasNoConfirms = (!d.terminalConfirmed && !d.recipientConfirmed);
        bool isTimedOut = (block.timestamp >= d.createdAt + 3 days);

        require(
            (isSender && hasNoConfirms) || isTimedOut,
            "Cannot cancel delivery under current state"
        );

        d.status = DeliveryStatus.Cancelled;
        uint256 refundAmount = d.escrowAmount;

        (bool success, ) = d.sender.call{value: refundAmount}("");
        require(success, "Refund transfer failed");

        emit DeliveryCancelled(_deliveryId, d.sender, refundAmount);
    }

    // --- Internal Logic ---

    function _settle(uint256 _deliveryId) internal {
        Delivery storage d = deliveries[_deliveryId];
        d.status = DeliveryStatus.Settled;
        d.settledAt = block.timestamp;

        // Payout 95% to courier
        (bool courierSuccess, ) = d.courier.call{value: d.courierPayout}("");
        require(courierSuccess, "Courier payout failed");

        // Payout 5% cashback to sender
        (bool cashbackSuccess, ) = d.sender.call{value: d.cashbackAmount}("");
        require(cashbackSuccess, "Cashback payout failed");

        emit DeliverySettled(_deliveryId, d.courier, d.courierPayout, d.sender, d.cashbackAmount);
    }

    // --- Geofencing Calculations ---

    /**
     * @notice Calculate distance in meters between two coordinates in microdegrees (1e6)
     * @dev Uses equirectangular flat-earth approximation scaled for microdegree precision
     */
    function calculateDistance(
        int32 _lat1,
        int32 _lon1,
        int32 _lat2,
        int32 _lon2
    ) public view returns (uint256) {
        // Delta in microdegrees
        int64 dLat = int64(_lat1) - int64(_lat2);
        if (dLat < 0) dLat = -dLat;

        int64 dLon = int64(_lon1) - int64(_lon2);
        if (dLon < 0) dLon = -dLon;

        // dy = (dLat * 111320) / 1000000 (meters)
        int64 dy = (dLat * 111320) / 1000000;

        // Mean latitude for cosine projection
        int64 meanLat = (int64(_lat1) + int64(_lat2)) / 2;
        if (meanLat < 0) meanLat = -meanLat;
        uint256 meanLatDeg = uint256(uint64(meanLat)) / 1000000;
        if (meanLatDeg > 90) meanLatDeg = 90;

        uint256 cosFactor = getCosineScaled(meanLatDeg);

        // dx = (dLon * 111320 / 1000000) * cos / 10000
        int64 dx = ((dLon * 111320) / 1000000) * int64(uint64(cosFactor)) / 10000;

        int64 distSqSigned = dx * dx + dy * dy;
        uint256 distSq = uint256(uint64(distSqSigned));
        return sqrt(distSq);
    }

    /**
     * @notice Linear interpolation of cosine scaled by 10,000 for degrees 0 to 90
     */
    function getCosineScaled(uint256 deg) public view returns (uint256) {
        if (deg >= 90) return 0;
        uint256 index = deg / 10;
        uint256 rem = deg % 10;
        if (index >= 9) return cosTable[9];

        uint256 v0 = cosTable[index];
        uint256 v1 = cosTable[index + 1];

        // Linear interpolation: v0 - (v0 - v1) * rem / 10
        return v0 - ((v0 - v1) * rem) / 10;
    }

    /**
     * @notice Integer square root using Babylonian method
     */
    function sqrt(uint256 x) public pure returns (uint256 y) {
        if (x == 0) return 0;
        uint256 z = (x + 1) / 2;
        y = x;
        while (z < y) {
            y = z;
            z = (x / z + z) / 2;
        }
    }

    // --- View Helpers ---

    function getDelivery(uint256 _deliveryId) external view deliveryExists(_deliveryId) returns (Delivery memory) {
        return deliveries[_deliveryId];
    }

    function isTerminalConfirmed(uint256 _deliveryId) external view deliveryExists(_deliveryId) returns (bool) {
        return deliveries[_deliveryId].terminalConfirmed;
    }

    function isRecipientConfirmed(uint256 _deliveryId) external view deliveryExists(_deliveryId) returns (bool) {
        return deliveries[_deliveryId].recipientConfirmed;
    }
}
