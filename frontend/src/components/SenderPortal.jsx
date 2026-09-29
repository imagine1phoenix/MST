import React, { useState, useEffect } from 'react';
import { ethers } from 'ethers';
import { PackagePlus, MapPin, Hash, Sparkles, AlertCircle, CheckCircle2, ExternalLink, Radio } from 'lucide-react';
import { hashRfidUid, getContractInstance, ensureMstNetwork, RELAY_API_URL } from '../utils/web3';

const PRESETS = [
  { name: 'Delhi Tech Park', lat: 28.6129, lon: 77.2295 },
  { name: 'Mumbai BKC Hub', lat: 19.0657, lon: 72.8687 },
  { name: 'Bangalore Electronic City', lat: 12.8452, lon: 77.6602 }
];

export { PRESETS };

export default function SenderPortal({ signer, account, balance, onConnect, onDeliveryCreated }) {
  const [courier, setCourier] = useState('0x70997970C51812dc3A010C7d01b50e0d17dc79C8');
  const [recipient, setRecipient] = useState(account || '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC');
  const [amount, setAmount] = useState('0.1');
  const [lat, setLat] = useState('28.6129');
  const [lon, setLon] = useState('77.2295');
  const [radius, setRadius] = useState('100');
  const [rfidUid, setRfidUid] = useState('CARD_MST_9921');

  // Auto-populate recipient with user's connected wallet for easy testing
  useEffect(() => {
    if (account && (!recipient || recipient === '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC')) {
      setRecipient(account);
    }
  }, [account]);

  const [isLoading, setIsLoading] = useState(false);
  const [statusMessage, setStatusMessage] = useState(null);
  const [createdDelivery, setCreatedDelivery] = useState(null);
  const [hardwareScannedCard, setHardwareScannedCard] = useState(null);

  // Poll for physical cards tapped on the ESP32 RC522 terminal
  useEffect(() => {
    const checkLastCard = async () => {
      try {
        const res = await fetch(`${RELAY_API_URL}/api/terminal/last-card`);
        if (res.ok) {
          const data = await res.json();
          if (data && data.uid) {
            setHardwareScannedCard(data.uid);
          }
        }
      } catch (_) {}
    };
    checkLastCard();
    const interval = setInterval(checkLastCard, 2000);
    return () => clearInterval(interval);
  }, []);

  // Real-time calculations
  const parsedAmount = parseFloat(amount) || 0;
  const courierPayout = (parsedAmount * 0.95).toFixed(4);
  const cashbackReward = (parsedAmount * 0.05).toFixed(4);
  const rfidHash = rfidUid ? hashRfidUid(rfidUid) : '0x0000000000000000000000000000000000000000000000000000000000000000';

  const handleUseLocation = () => {
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          setLat(pos.coords.latitude.toFixed(6));
          setLon(pos.coords.longitude.toFixed(6));
        },
        (err) => alert("Could not fetch location: " + err.message)
      );
    } else {
      alert("Geolocation is not supported by your browser");
    }
  };

  const handleCreate = async (e) => {
    e.preventDefault();
    if (!signer || !account) {
      if (onConnect) {
        onConnect();
      } else {
        alert("Please connect your BridgeKey or MetaMask wallet first!");
      }
      return;
    }

    // Input validations with clear feedback
    if (!courier || !ethers.isAddress(courier)) {
      setStatusMessage({ type: 'error', text: 'Invalid Courier Address. Must be a valid 0x wallet address.' });
      return;
    }
    if (!recipient || !ethers.isAddress(recipient)) {
      setStatusMessage({ type: 'error', text: 'Invalid Recipient Address. Must be a valid 0x wallet address.' });
      return;
    }
    const parsedLat = parseFloat(lat);
    const parsedLon = parseFloat(lon);
    if (isNaN(parsedLat) || isNaN(parsedLon)) {
      setStatusMessage({ type: 'error', text: 'Invalid GPS coordinates. Please click a location preset or "My Location".' });
      return;
    }
    const parsedAmountVal = parseFloat(amount);
    if (isNaN(parsedAmountVal) || parsedAmountVal <= 0) {
      setStatusMessage({ type: 'error', text: 'Escrow amount must be greater than 0.' });
      return;
    }

    try {
      setIsLoading(true);
      setStatusMessage({ type: 'info', text: 'Preparing transaction...' });

      // Ensure network is MST Testnet
      await ensureMstNetwork();

      const contract = getContractInstance(signer);
      if (!contract) {
        // Contract not yet deployed - show simulation creation
        const simId = Math.floor(Math.random() * 900) + 100;
        const newDelivery = {
          id: simId,
          courier,
          recipient,
          escrowAmount: amount,
          cashbackAmount: cashbackReward,
          courierPayout,
          rfidUid,
          rfidHash,
          targetLat: parsedLat,
          targetLon: parsedLon,
          allowedRadiusMeters: parseInt(radius) || 100,
          txHash: '0x' + Array.from({length: 64}, () => Math.floor(Math.random()*16).toString(16)).join(''),
          simulation: true
        };
        setCreatedDelivery(newDelivery);
        if (onDeliveryCreated) onDeliveryCreated(newDelivery);
        setStatusMessage({
          type: 'success',
          text: `Delivery #${simId} created in simulation mode!`
        });
        return;
      }

      const latMicro = Math.round(parsedLat * 1e6);
      const lonMicro = Math.round(parsedLon * 1e6);
      const radiusInt = parseInt(radius) || 100;
      const escrowWei = ethers.parseEther(amount.toString());

      setStatusMessage({ type: 'info', text: 'Confirm the transaction in your wallet (MetaMask / BridgeKey)...' });

      // Call createDelivery on MST Testnet with explicit gasLimit to prevent estimation stalls
      const tx = await contract.createDelivery(
        courier,
        recipient,
        ethers.ZeroAddress, // Allow courier or relay terminal
        rfidHash,
        latMicro,
        lonMicro,
        radiusInt,
        { 
          value: escrowWei,
          gasLimit: 400000,
          gasPrice: ethers.parseUnits('1', 'gwei')
        }
      );

      setStatusMessage({ type: 'info', text: `Transaction broadcasted: ${tx.hash}. Awaiting block confirmation...` });
      const receipt = await tx.wait();

      // Parse event to get delivery ID
      let deliveryId = 1;
      for (const log of receipt.logs) {
        try {
          const parsed = contract.interface.parseLog(log);
          if (parsed && parsed.name === 'DeliveryCreated') {
            deliveryId = Number(parsed.args.deliveryId);
            break;
          }
        } catch (_) {}
      }

      const newDelivery = {
        id: deliveryId,
        courier,
        recipient,
        escrowAmount: amount,
        cashbackAmount: cashbackReward,
        courierPayout,
        rfidUid,
        rfidHash,
        targetLat: parsedLat,
        targetLon: parsedLon,
        allowedRadiusMeters: radiusInt,
        txHash: tx.hash,
        simulation: false
      };

      setCreatedDelivery(newDelivery);
      if (onDeliveryCreated) onDeliveryCreated(newDelivery);

      // Inform relay server of active delivery ID for hardware scans
      fetch(`${RELAY_API_URL}/api/terminal/active-delivery`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deliveryId })
      }).catch(() => {});

      // Dispatch Telegram notification to Sender and Recipient
      fetch(`${RELAY_API_URL}/api/telegram/event`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          deliveryId,
          sender: account,
          recipient,
          type: 'CREATED',
          data: {
            amount,
            cashback: cashbackReward,
            payout: courierPayout,
            lat: parsedLat,
            lon: parsedLon,
            txHash: tx.hash
          }
        })
      }).catch(() => {});

      setStatusMessage({
        type: 'success',
        text: `Delivery #${deliveryId} locked in escrow on MST Testnet!`
      });
    } catch (err) {
      console.error("Booking Error:", err);
      let errMsg = err.reason || err.message || 'Transaction rejected or failed';
      if (err.code === 'ACTION_REJECTED' || err.message?.includes('user rejected') || err.message?.includes('User denied')) {
        errMsg = 'Transaction was rejected in your wallet.';
      } else if (err.message?.includes('insufficient funds')) {
        errMsg = 'Insufficient MSTC balance for this escrow amount + gas fee.';
      } else if (err.message?.includes('429') || err.info?.error?.message?.includes('429')) {
        errMsg = 'MST Testnet RPC is rate-limited. Please wait 10–15 seconds and try again.';
      } else if (err.message?.includes('could not coalesce') || err.code === -32603) {
        errMsg = 'RPC connection issue. Please refresh the page and try again.';
      }
      setStatusMessage({
        type: 'error',
        text: errMsg
      });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))', gap: '24px' }}>
      {/* Create Delivery Form */}
      <div className="glass-panel" style={{ padding: '28px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '20px' }}>
          <PackagePlus size={22} color="var(--accent-cyan)" />
          <h2 style={{ fontSize: '1.25rem', fontWeight: 700 }}>Book Delivery & Lock Escrow</h2>
        </div>

        <form onSubmit={handleCreate} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <div>
            <label style={{ display: 'block', fontSize: '0.82rem', color: 'var(--text-secondary)', marginBottom: '6px' }}>
              Courier Wallet Address
            </label>
            <input
              type="text"
              className="input-field mono"
              value={courier}
              onChange={(e) => setCourier(e.target.value)}
              placeholder="0x..."
              required
            />
          </div>

          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
              <label style={{ fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
                Recipient Wallet Address (BridgeKey)
              </label>
              {account && (
                <button
                  type="button"
                  onClick={() => setRecipient(account)}
                  style={{
                    background: 'none',
                    border: 'none',
                    color: 'var(--accent-cyan)',
                    cursor: 'pointer',
                    fontSize: '0.74rem'
                  }}
                >
                  Use My Address (For Testing)
                </button>
              )}
            </div>
            <input
              type="text"
              className="input-field mono"
              value={recipient}
              onChange={(e) => setRecipient(e.target.value)}
              placeholder="0x..."
              required
            />
          </div>

          <div>
            <label style={{ display: 'block', fontSize: '0.82rem', color: 'var(--text-secondary)', marginBottom: '6px' }}>
              Escrow Value ($MSTC)
            </label>
            <input
              type="number"
              step="0.01"
              min="0.01"
              className="input-field mono"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              required
            />
          </div>

          {/* GPS Coordinates */}
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
              <label style={{ fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
                Target Delivery Coordinates (GPS)
              </label>
              <button
                type="button"
                onClick={handleUseLocation}
                style={{
                  background: 'none',
                  border: 'none',
                  color: 'var(--accent-cyan)',
                  cursor: 'pointer',
                  fontSize: '0.78rem',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '4px'
                }}
              >
                <MapPin size={12} /> My Location
              </button>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
              <input
                type="text"
                className="input-field mono"
                placeholder="Latitude"
                value={lat}
                onChange={(e) => setLat(e.target.value)}
                required
              />
              <input
                type="text"
                className="input-field mono"
                placeholder="Longitude"
                value={lon}
                onChange={(e) => setLon(e.target.value)}
                required
              />
            </div>

            {/* Quick Presets */}
            <div style={{ display: 'flex', gap: '6px', marginTop: '8px', flexWrap: 'wrap' }}>
              {PRESETS.map((p) => (
                <button
                  key={p.name}
                  type="button"
                  onClick={() => { setLat(p.lat.toString()); setLon(p.lon.toString()); }}
                  style={{
                    background: 'rgba(255, 255, 255, 0.05)',
                    border: '1px solid var(--border-color)',
                    borderRadius: '6px',
                    color: 'var(--text-secondary)',
                    fontSize: '0.72rem',
                    padding: '4px 8px',
                    cursor: 'pointer'
                  }}
                >
                  📍 {p.name}
                </button>
              ))}
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
            <div>
              <label style={{ display: 'block', fontSize: '0.82rem', color: 'var(--text-secondary)', marginBottom: '6px' }}>
                Geofence Radius (Meters)
              </label>
              <input
                type="number"
                min="10"
                max="5000"
                className="input-field mono"
                value={radius}
                onChange={(e) => setRadius(e.target.value)}
                required
              />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: '0.82rem', color: 'var(--text-secondary)', marginBottom: '6px' }}>
                RFID Tag UID
              </label>
              <input
                type="text"
                className="input-field mono"
                value={rfidUid}
                onChange={(e) => setRfidUid(e.target.value)}
                required
              />
              {hardwareScannedCard && (
                <div style={{
                  marginTop: '8px',
                  padding: '8px 10px',
                  background: 'rgba(0, 242, 254, 0.08)',
                  border: '1px solid rgba(0, 242, 254, 0.3)',
                  borderRadius: '6px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: '8px'
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', overflow: 'hidden' }}>
                    <Radio size={13} color="var(--accent-cyan)" />
                    <span style={{ fontSize: '0.72rem', color: 'var(--text-secondary)' }}>
                      Tapped Card: <strong className="mono" style={{ color: 'var(--accent-cyan)' }}>{hardwareScannedCard}</strong>
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setRfidUid(hardwareScannedCard)}
                    style={{
                      background: 'var(--accent-cyan)',
                      color: '#05080f',
                      border: 'none',
                      borderRadius: '4px',
                      padding: '3px 8px',
                      fontSize: '0.72rem',
                      fontWeight: 700,
                      cursor: 'pointer',
                      whiteSpace: 'nowrap'
                    }}
                  >
                    Use Card
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* In-Form Real-time Status Alert */}
          {statusMessage && (
            <div style={{
              padding: '12px 14px',
              borderRadius: '8px',
              fontSize: '0.84rem',
              display: 'flex',
              alignItems: 'flex-start',
              gap: '10px',
              background: statusMessage.type === 'error' ? 'rgba(239, 68, 68, 0.12)' : statusMessage.type === 'success' ? 'rgba(16, 185, 129, 0.12)' : 'rgba(0, 242, 254, 0.12)',
              border: `1px solid ${statusMessage.type === 'error' ? 'rgba(239, 68, 68, 0.4)' : statusMessage.type === 'success' ? 'rgba(16, 185, 129, 0.4)' : 'rgba(0, 242, 254, 0.4)'}`,
              color: statusMessage.type === 'error' ? '#ef4444' : statusMessage.type === 'success' ? '#10b981' : 'var(--accent-cyan)'
            }}>
              {statusMessage.type === 'success' ? <CheckCircle2 size={18} /> : <AlertCircle size={18} />}
              <div style={{ flex: 1, wordBreak: 'break-word', lineHeight: 1.4 }}>
                <strong>{statusMessage.type === 'error' ? 'Notice: ' : statusMessage.type === 'success' ? 'Success: ' : 'Status: '}</strong>
                {statusMessage.text}
              </div>
            </div>
          )}

          <button
            type="submit"
            disabled={isLoading}
            className="btn-primary"
            style={{ marginTop: '10px' }}
          >
            {isLoading
              ? 'Processing Escrow...'
              : !account
              ? '⚡ Connect Wallet to Book Delivery'
              : 'Deposit Escrow & Lock on Chain'}
          </button>
        </form>
      </div>

      {/* Escrow Breakdown & On-Chain Preview */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
        {/* Settlement Breakdown Card */}
        <div className="glass-panel" style={{ padding: '24px' }}>
          <h3 style={{ fontSize: '1rem', fontWeight: 600, marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Sparkles size={18} color="var(--accent-amber)" />
            Escrow & Cashback Engine
          </h3>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 14px', background: 'rgba(255, 255, 255, 0.03)', borderRadius: '8px' }}>
              <span style={{ color: 'var(--text-secondary)', fontSize: '0.88rem' }}>Total Escrow Locked:</span>
              <span style={{ fontWeight: 700, fontFamily: 'var(--font-mono)' }}>{parsedAmount} $MSTC</span>
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 14px', background: 'rgba(16, 185, 129, 0.08)', border: '1px solid rgba(16, 185, 129, 0.2)', borderRadius: '8px' }}>
              <span style={{ color: '#10b981', fontSize: '0.88rem' }}>Courier Payout (95%):</span>
              <span style={{ fontWeight: 700, color: '#10b981', fontFamily: 'var(--font-mono)' }}>{courierPayout} $MSTC</span>
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 14px', background: 'rgba(0, 242, 254, 0.08)', border: '1px solid rgba(0, 242, 254, 0.2)', borderRadius: '8px' }}>
              <span style={{ color: 'var(--accent-cyan)', fontSize: '0.88rem' }}>Sender Cashback (5%):</span>
              <span style={{ fontWeight: 700, color: 'var(--accent-cyan)', fontFamily: 'var(--font-mono)' }}>+{cashbackReward} $MSTC</span>
            </div>
          </div>

          <div style={{ marginTop: '16px', padding: '12px', background: 'rgba(0,0,0,0.2)', borderRadius: '8px', fontSize: '0.78rem', color: 'var(--text-muted)' }}>
            💡 <strong>Zero-Trust Multi-Sig:</strong> Escrow cannot be settled unless <strong>both</strong> the Terminal (Key 1 via RFID & GPS) and Recipient (Key 2 via BridgeKey) provide proof on the MST Blockchain.
          </div>
        </div>

        {/* Cryptographic Proof Hash Card */}
        <div className="glass-panel" style={{ padding: '24px' }}>
          <h3 style={{ fontSize: '1rem', fontWeight: 600, marginBottom: '12px', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Hash size={18} color="var(--accent-purple)" />
            Cryptographic RFID Hash (On-Chain)
          </h3>
          <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '10px' }}>
            To prevent card-cloning theft, only the <code>keccak256</code> hash is stored on-chain:
          </p>
          <div style={{
            background: 'rgba(0, 0, 0, 0.4)',
            padding: '12px',
            borderRadius: '8px',
            fontFamily: 'var(--font-mono)',
            fontSize: '0.75rem',
            wordBreak: 'break-all',
            color: 'var(--accent-purple)',
            border: '1px solid rgba(139, 92, 246, 0.2)'
          }}>
            {rfidHash}
          </div>
        </div>

        {/* Status Notification */}
        {statusMessage && (
          <div className="glass-panel" style={{
            padding: '16px',
            borderColor: statusMessage.type === 'error' ? 'var(--accent-red)' : statusMessage.type === 'success' ? 'var(--accent-green)' : 'var(--accent-cyan)',
            display: 'flex',
            alignItems: 'flex-start',
            gap: '12px'
          }}>
            {statusMessage.type === 'success' ? (
              <CheckCircle2 size={20} color="var(--accent-green)" />
            ) : (
              <AlertCircle size={20} color={statusMessage.type === 'error' ? 'var(--accent-red)' : 'var(--accent-cyan)'} />
            )}
            <div style={{ fontSize: '0.88rem' }}>
              <div>{statusMessage.text}</div>
              {createdDelivery?.txHash && (
                <a
                  href={`https://testnet.mstscan.com/tx/${createdDelivery.txHash}`}
                  target="_blank"
                  rel="noreferrer"
                  style={{ color: 'var(--accent-cyan)', fontSize: '0.8rem', display: 'inline-flex', alignItems: 'center', gap: '4px', marginTop: '6px' }}
                >
                  <span>View on MSTScan</span>
                  <ExternalLink size={12} />
                </a>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
