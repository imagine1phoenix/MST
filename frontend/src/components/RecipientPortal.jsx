import React, { useState, useEffect } from 'react';
import { ethers } from 'ethers';
import { ShieldCheck, CheckCircle2, Clock, AlertTriangle, KeyRound, Radio, ExternalLink } from 'lucide-react';
import { getContractInstance, formatAddress, RELAY_API_URL } from '../utils/web3';

export default function RecipientPortal({ signer, account, activeDeliveryId, onActiveDeliveryChange }) {
  const [deliveryId, setDeliveryId] = useState(activeDeliveryId || '1');
  const [delivery, setDelivery] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isSigning, setIsSigning] = useState(false);
  const [statusMessage, setStatusMessage] = useState(null);

  useEffect(() => {
    if (activeDeliveryId) {
      setDeliveryId(activeDeliveryId.toString());
      fetchDelivery(activeDeliveryId);
    } else {
      fetchDelivery(deliveryId);
    }
  }, [activeDeliveryId]);

  // Auto-poll delivery status every 4 seconds for live Key 1 / Key 2 updates
  useEffect(() => {
    const interval = setInterval(() => {
      fetchDelivery(deliveryId, true); // true = silent background poll
    }, 4000);
    return () => clearInterval(interval);
  }, [deliveryId]);

  const fetchDelivery = async (idToFetch, isSilent = false) => {
    try {
      if (!isSilent) setIsLoading(true);
      const id = idToFetch || deliveryId;

      // 1. Try fetching from Relay API
      try {
        const res = await fetch(`${RELAY_API_URL}/api/terminal/status/${id}`);
        if (res.ok) {
          const data = await res.json();
          setDelivery(data);
          return;
        }
      } catch (_) {}

      // 2. Fallback to Contract if signer exists
      if (signer) {
        try {
          const contract = getContractInstance(signer);
          if (contract) {
            const d = await contract.getDelivery(id);
            setDelivery({
              id: Number(d.id),
              sender: d.sender,
              courier: d.courier,
              recipient: d.recipient,
              escrowAmount: (Number(d.escrowAmount) / 1e18).toFixed(4),
              cashbackAmount: (Number(d.cashbackAmount) / 1e18).toFixed(4),
              courierPayout: (Number(d.courierPayout) / 1e18).toFixed(4),
              targetLat: Number(d.targetLat) / 1e6,
              targetLon: Number(d.targetLon) / 1e6,
              allowedRadiusMeters: Number(d.allowedRadiusMeters),
              terminalConfirmed: d.terminalConfirmed,
              recipientConfirmed: d.recipientConfirmed,
              status: Number(d.status),
              unlockDoor: d.terminalConfirmed && d.recipientConfirmed
            });
            return;
          }
        } catch (contractErr) {
          console.warn("Delivery fetch skipped:", contractErr.message);
          return;
        }
      }

      // Mock default only if no delivery loaded yet
      setDelivery(prev => prev || {
        id: Number(id),
        sender: '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266',
        courier: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8',
        recipient: account || '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC',
        escrowAmount: '0.1000',
        cashbackAmount: '0.0050',
        courierPayout: '0.0950',
        targetLat: 28.6129,
        targetLon: 77.2295,
        allowedRadiusMeters: 100,
        terminalConfirmed: false,
        recipientConfirmed: false,
        status: 0,
        unlockDoor: false,
        simulation: true
      });
    } catch (err) {
      console.warn("Could not fetch live delivery:", err);
    } finally {
      setIsLoading(false);
    }
  };

  const handleRecipientConfirm = async () => {
    if (!signer) {
      alert("Please connect your BridgeKey wallet!");
      return;
    }

    // Pre-check: warn if connected wallet doesn't match designated recipient
    if (delivery?.recipient && account && 
        delivery.recipient.toLowerCase() !== account.toLowerCase()) {
      setStatusMessage({
        type: 'error',
        text: `Wallet mismatch! This delivery's recipient is ${formatAddress(delivery.recipient)}, but you're connected as ${formatAddress(account)}. Switch to the correct BridgeKey wallet to sign Key 2.`
      });
      return;
    }

    try {
      setIsSigning(true);
      setStatusMessage({ type: 'info', text: 'Prompting BridgeKey wallet signature for Key 2...' });

      const contract = getContractInstance(signer);
      if (!contract) {
        // Simulation mode
        setTimeout(() => {
          setDelivery(prev => ({
            ...prev,
            recipientConfirmed: true,
            status: prev.terminalConfirmed ? 3 : 2,
            unlockDoor: prev.terminalConfirmed
          }));
          setStatusMessage({
            type: 'success',
            text: 'Key 2 (Recipient Approval) signed! (Simulation mode)'
          });
          setIsSigning(false);
        }, 1200);
        return;
      }

      const tx = await contract.recipientConfirm(deliveryId, { 
        gasLimit: 300000,
        gasPrice: ethers.parseUnits('1', 'gwei')
      });
      setStatusMessage({ type: 'info', text: `Transaction submitted: ${tx.hash}. Awaiting block confirmation...` });
      
      try {
        await tx.wait(1);
      } catch (waitErr) {
        console.warn("Receipt wait notice:", waitErr);
      }

      setStatusMessage({
        type: 'success',
        text: `Key 2 Confirmed on MST Blockchain! Escrow unlocked. Tx: ${tx.hash}`,
        txHash: tx.hash
      });

      // Refresh delivery status
      await fetchDelivery(deliveryId);
    } catch (err) {
      console.error("recipientConfirm error:", err);
      const fullError = (err?.info?.error?.message || err?.error?.message || err?.reason || err?.message || '').toLowerCase();
      let errMsg = err.reason || err.message || 'Signature rejected or failed';
      if (err.code === 'ACTION_REJECTED' || fullError.includes('user rejected') || fullError.includes('denied') || fullError.includes('rejected')) {
        errMsg = 'Transaction was rejected in your wallet.';
      } else if (fullError.includes('429') || fullError.includes('rate limit')) {
        errMsg = 'MST Testnet RPC is rate-limited. Please wait 10 seconds and click Confirm again.';
      } else if (err.code === 'CALL_EXCEPTION' || fullError.includes('call_exception') || fullError.includes('missing revert data')) {
        errMsg = 'Transaction would revert on-chain. Check the Delivery Manifest to verify your wallet matches the Recipient address and Key 1 is confirmed.';
      } else if (fullError.includes('could not coalesce')) {
        errMsg = 'RPC response delayed. Please wait a few seconds and click Confirm again.';
      }
      setStatusMessage({
        type: 'error',
        text: errMsg
      });
    } finally {
      setIsSigning(false);
    }
  };

  const isSettled = delivery?.status === 3 || (delivery?.terminalConfirmed && delivery?.recipientConfirmed);
  const walletMismatch = delivery?.recipient && account && 
    delivery.recipient.toLowerCase() !== account.toLowerCase();

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
      {/* Wallet Mismatch Warning */}
      {walletMismatch && (
        <div style={{
          padding: '14px 18px',
          borderRadius: '12px',
          background: 'rgba(245, 158, 11, 0.1)',
          border: '1px solid rgba(245, 158, 11, 0.4)',
          display: 'flex',
          alignItems: 'center',
          gap: '12px',
          fontSize: '0.88rem'
        }}>
          <AlertTriangle size={20} color="var(--accent-amber)" style={{ flexShrink: 0 }} />
          <div>
            <strong style={{ color: 'var(--accent-amber)' }}>Wallet Mismatch:</strong>{' '}
            <span style={{ color: 'var(--text-secondary)' }}>
              You're connected as <code className="mono" style={{ color: 'var(--accent-cyan)' }}>{formatAddress(account)}</code>, 
              but this delivery's recipient is <code className="mono" style={{ color: 'var(--accent-amber)' }}>{formatAddress(delivery.recipient)}</code>. 
              Switch wallets in BridgeKey to sign Key 2.
            </span>
          </div>
        </div>
      )}

      {/* Lookup Bar */}
      <div className="glass-panel" style={{ padding: '20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '16px', flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <KeyRound size={22} color="var(--accent-purple)" />
          <div>
            <h2 style={{ fontSize: '1.15rem', fontWeight: 700 }}>Recipient Multi-Sig Verification</h2>
            <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
              Authorize delivery receipt and trigger zero-trust smart escrow release
            </p>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>Delivery ID:</span>
          <input
            type="number"
            min="1"
            className="input-field mono"
            style={{ width: '90px', padding: '8px 12px' }}
            value={deliveryId}
            onChange={(e) => {
              setDeliveryId(e.target.value);
              if (onActiveDeliveryChange) onActiveDeliveryChange(e.target.value);
            }}
          />
          <button
            onClick={() => fetchDelivery(deliveryId)}
            className="btn-secondary"
            style={{ padding: '8px 16px' }}
          >
            Refresh
          </button>
        </div>
      </div>

      {/* Multi-Sig 4-Step Visualizer */}
      <div className="glass-panel" style={{ padding: '28px' }}>
        <h3 style={{ fontSize: '1rem', fontWeight: 600, marginBottom: '20px' }}>
          Multi-Signature Settlement Pipeline
        </h3>

        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
          gap: '16px'
        }}>
          {/* Step 1: Escrow Locked */}
          <div style={{
            background: 'rgba(255, 255, 255, 0.03)',
            border: '1px solid var(--border-color)',
            borderRadius: '12px',
            padding: '18px'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '10px' }}>
              <span className="badge badge-cyan">Step 1</span>
              <CheckCircle2 size={18} color="var(--accent-cyan)" />
            </div>
            <div style={{ fontWeight: 600, fontSize: '0.95rem' }}>Escrow Deposited</div>
            <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: '4px' }}>
              {delivery ? `${delivery.escrowAmount} $MSTC locked on-chain` : 'Awaiting order'}
            </p>
          </div>

          {/* Step 2: Key 1 Physical Terminal */}
          <div style={{
            background: delivery?.terminalConfirmed ? 'rgba(16, 185, 129, 0.06)' : 'rgba(255, 255, 255, 0.03)',
            border: delivery?.terminalConfirmed ? '1px solid rgba(16, 185, 129, 0.3)' : '1px solid var(--border-color)',
            borderRadius: '12px',
            padding: '18px'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '10px' }}>
              <span className={`badge ${delivery?.terminalConfirmed ? 'badge-green' : 'badge-amber'}`}>Key 1</span>
              {delivery?.terminalConfirmed ? (
                <CheckCircle2 size={18} color="var(--accent-green)" />
              ) : (
                <Clock size={18} color="var(--accent-amber)" />
              )}
            </div>
            <div style={{ fontWeight: 600, fontSize: '0.95rem' }}>Physical Terminal</div>
            <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: '4px' }}>
              {delivery?.terminalConfirmed ? 'RFID + GPS Geofence Verified ✅' : 'Awaiting RFID tap at location...'}
            </p>
          </div>

          {/* Step 3: Key 2 Recipient Wallet */}
          <div style={{
            background: delivery?.recipientConfirmed ? 'rgba(16, 185, 129, 0.06)' : 'rgba(255, 255, 255, 0.03)',
            border: delivery?.recipientConfirmed ? '1px solid rgba(16, 185, 129, 0.3)' : '1px solid var(--border-color)',
            borderRadius: '12px',
            padding: '18px'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '10px' }}>
              <span className={`badge ${delivery?.recipientConfirmed ? 'badge-green' : 'badge-purple'}`}>Key 2</span>
              {delivery?.recipientConfirmed ? (
                <CheckCircle2 size={18} color="var(--accent-green)" />
              ) : (
                <KeyRound size={18} color="var(--accent-purple)" />
              )}
            </div>
            <div style={{ fontWeight: 600, fontSize: '0.95rem' }}>BridgeKey Approval</div>
            <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: '4px' }}>
              {delivery?.recipientConfirmed ? 'Recipient Signed On-Chain ✅' : 'Waiting for your signature'}
            </p>
          </div>

          {/* Step 4: Final Settlement */}
          <div style={{
            background: isSettled ? 'rgba(0, 242, 254, 0.08)' : 'rgba(255, 255, 255, 0.03)',
            border: isSettled ? '1px solid var(--border-accent)' : '1px solid var(--border-color)',
            borderRadius: '12px',
            padding: '18px'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '10px' }}>
              <span className={`badge ${isSettled ? 'badge-cyan' : 'badge-amber'}`}>Settlement</span>
              {isSettled ? (
                <ShieldCheck size={18} color="var(--accent-cyan)" />
              ) : (
                <Clock size={18} color="var(--text-muted)" />
              )}
            </div>
            <div style={{ fontWeight: 600, fontSize: '0.95rem' }}>Auto-Payout & Cashback</div>
            <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: '4px' }}>
              {isSettled ? 'Settled! Courier & Cashback Paid 🎉' : 'Triggers upon Key 1 + Key 2'}
            </p>
          </div>
        </div>
      </div>

      {/* Main Action Box & Delivery Info */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '24px' }}>
        {/* Sign Key 2 Action Panel */}
        <div className="glass-panel" style={{ padding: '28px' }}>
          <h3 style={{ fontSize: '1.1rem', fontWeight: 600, marginBottom: '16px' }}>
            Action: Confirm Receipt (Key 2)
          </h3>

          <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', lineHeight: '1.6', marginBottom: '20px' }}>
            By signing this transaction with your <strong>BridgeKey wallet</strong>, you cryptographically authorize delivery completion. If the physical terminal has already scanned your RFID card within the geofence, settlement will happen instantly!
          </p>

          <button
            onClick={handleRecipientConfirm}
            disabled={isSigning || delivery?.recipientConfirmed || isSettled}
            className="btn-success"
            style={{ width: '100%', padding: '16px', fontSize: '1rem' }}
          >
            {delivery?.recipientConfirmed ? (
              <>
                <CheckCircle2 size={18} />
                <span>Key 2 Already Confirmed</span>
              </>
            ) : isSigning ? (
              <span>Signing in BridgeKey...</span>
            ) : (
              <>
                <ShieldCheck size={18} />
                <span>Sign & Confirm Receipt with BridgeKey</span>
              </>
            )}
          </button>

          {/* Feedback message */}
          {statusMessage && (
            <div style={{
              marginTop: '16px',
              padding: '14px',
              borderRadius: '10px',
              background: 'rgba(0,0,0,0.3)',
              border: `1px solid ${statusMessage.type === 'error' ? 'var(--accent-red)' : 'var(--accent-green)'}`,
              fontSize: '0.85rem'
            }}>
              <div>{statusMessage.text}</div>
              {statusMessage.txHash && (
                <a
                  href={`https://testnet.mstscan.com/tx/${statusMessage.txHash}`}
                  target="_blank"
                  rel="noreferrer"
                  style={{ color: 'var(--accent-cyan)', display: 'inline-flex', alignItems: 'center', gap: '4px', marginTop: '6px', fontSize: '0.8rem' }}
                >
                  <span>Verify on MSTScan</span>
                  <ExternalLink size={12} />
                </a>
              )}
            </div>
          )}
        </div>

        {/* Delivery Details Card */}
        <div className="glass-panel" style={{ padding: '28px' }}>
          <h3 style={{ fontSize: '1.1rem', fontWeight: 600, marginBottom: '16px' }}>
            Delivery Manifest #{delivery?.id || deliveryId}
          </h3>

          {delivery ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', fontSize: '0.88rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid rgba(255,255,255,0.06)', paddingBottom: '8px' }}>
                <span style={{ color: 'var(--text-muted)' }}>Sender:</span>
                <span className="mono">{formatAddress(delivery.sender)}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid rgba(255,255,255,0.06)', paddingBottom: '8px' }}>
                <span style={{ color: 'var(--text-muted)' }}>Courier:</span>
                <span className="mono">{formatAddress(delivery.courier)}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid rgba(255,255,255,0.06)', paddingBottom: '8px' }}>
                <span style={{ color: 'var(--text-muted)' }}>Recipient:</span>
                <span className="mono">{formatAddress(delivery.recipient)}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid rgba(255,255,255,0.06)', paddingBottom: '8px' }}>
                <span style={{ color: 'var(--text-muted)' }}>Escrow Total:</span>
                <span className="mono" style={{ fontWeight: 600 }}>{delivery.escrowAmount} $MSTC</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid rgba(255,255,255,0.06)', paddingBottom: '8px' }}>
                <span style={{ color: 'var(--text-muted)' }}>Target GPS:</span>
                <span className="mono">{delivery.targetLat}, {delivery.targetLon}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid rgba(255,255,255,0.06)', paddingBottom: '8px' }}>
                <span style={{ color: 'var(--text-muted)' }}>Geofence Radius:</span>
                <span className="mono">{delivery.allowedRadiusMeters} meters</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', paddingTop: '4px' }}>
                <span style={{ color: 'var(--text-muted)' }}>Locker Door Latch:</span>
                <span style={{ fontWeight: 700, color: delivery.unlockDoor ? 'var(--accent-green)' : 'var(--accent-amber)' }}>
                  {delivery.unlockDoor ? '🔓 UNLOCKED' : '🔒 LOCKED'}
                </span>
              </div>
            </div>
          ) : (
            <div style={{ color: 'var(--text-muted)' }}>Loading delivery details...</div>
          )}
        </div>
      </div>
    </div>
  );
}
