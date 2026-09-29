import React, { useState, useEffect } from 'react';
import Navbar from './components/Navbar';
import SenderPortal from './components/SenderPortal';
import RecipientPortal from './components/RecipientPortal';
import TerminalMonitor from './components/TerminalMonitor';
import { Package, KeyRound, Cpu, FileText, ExternalLink, ShieldCheck, AlertCircle, X, RefreshCw } from 'lucide-react';
import { connectWallet, getEthereumProvider } from './utils/web3';
import contractConfig from './config/contract.json';

export default function App() {
  const [activeTab, setActiveTab] = useState('sender');
  const [account, setAccount] = useState(null);
  const [balance, setBalance] = useState('0.0000');
  const [signer, setSigner] = useState(null);
  const [isConnecting, setIsConnecting] = useState(false);
  const [connectError, setConnectError] = useState(null);
  const [activeDeliveryId, setActiveDeliveryId] = useState('1');

  // Try auto-connecting if wallet provider already has authorized accounts
  useEffect(() => {
    const eth = getEthereumProvider();
    if (eth) {
      eth.request({ method: 'eth_accounts' })
        .then(async (accounts) => {
          if (accounts && accounts.length > 0) {
            handleConnect(true); // silent auto-connect
          }
        })
        .catch(() => {});

      // Listen to account changes
      const handleAccountsChanged = (accounts) => {
        if (accounts.length > 0) {
          handleConnect(true);
        } else {
          setAccount(null);
          setSigner(null);
          setBalance('0.0000');
        }
      };

      eth.on?.('accountsChanged', handleAccountsChanged);
      return () => {
        eth.removeListener?.('accountsChanged', handleAccountsChanged);
      };
    }
  }, []);

  const handleConnect = async (isAuto = false) => {
    try {
      setIsConnecting(true);
      if (!isAuto) setConnectError(null);
      const data = await connectWallet();
      setAccount(data.address);
      setBalance(data.balance);
      setSigner(data.signer);
      setConnectError(null);
    } catch (err) {
      console.warn("Wallet connect:", err.message);
      if (!isAuto) {
        setConnectError(err.message || "Failed to connect BridgeKey wallet.");
      }
    } finally {
      setIsConnecting(false);
    }
  };

  const handleDeliveryCreated = (newDelivery) => {
    setActiveDeliveryId(newDelivery.id.toString());
  };

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      <Navbar
        account={account}
        balance={balance}
        onConnect={handleConnect}
        isConnecting={isConnecting}
        contractAddress={contractConfig.contractAddress}
      />

      {/* Main Container */}
      <main style={{ maxWidth: '1280px', margin: '0 auto', padding: '32px 24px', width: '100%', flex: 1 }}>
        {/* BridgeKey Connection Alert */}
        {connectError && (
          <div style={{
            marginBottom: '24px',
            padding: '14px 20px',
            borderRadius: '12px',
            background: 'rgba(239, 68, 68, 0.1)',
            border: '1px solid rgba(239, 68, 68, 0.4)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '16px'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <AlertCircle size={20} color="var(--accent-red)" style={{ flexShrink: 0 }} />
              <span style={{ fontSize: '0.88rem', color: '#fca5a5' }}>
                <strong style={{ color: '#fff' }}>BridgeKey Wallet:</strong> {connectError}
              </span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
              <button
                onClick={() => handleConnect(false)}
                className="btn-secondary"
                style={{ padding: '6px 12px', fontSize: '0.78rem', display: 'flex', alignItems: 'center', gap: '6px' }}
              >
                <RefreshCw size={13} />
                Retry Connect
              </button>
              <button
                onClick={() => setConnectError(null)}
                style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', padding: '4px' }}
                title="Dismiss"
              >
                <X size={16} />
              </button>
            </div>
          </div>
        )}

        {/* Hero Banner */}
        <div style={{ marginBottom: '32px', textAlign: 'center' }}>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', padding: '6px 16px', background: 'rgba(0, 242, 254, 0.08)', borderRadius: '9999px', border: '1px solid var(--border-accent)', marginBottom: '14px' }}>
            <ShieldCheck size={16} color="var(--accent-cyan)" />
            <span style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--accent-cyan)' }}>
              MST Blockchain Buildathon × Robotics Track
            </span>
          </div>
          <h1 style={{ fontSize: '2.4rem', fontWeight: 800, letterSpacing: '-0.03em', marginBottom: '12px' }}>
            Zero-Trust Smart Delivery Terminal
          </h1>
          <p style={{ color: 'var(--text-secondary)', maxWidth: '640px', margin: '0 auto', fontSize: '0.98rem', lineHeight: '1.6' }}>
            Combining Two-Factor Multi-Sig Escrow with Real-World GPS Geofencing & Cold-Chain Auditing on the MST Blockchain.
          </p>
        </div>

        {/* Tab Navigation */}
        <div style={{
          display: 'flex',
          justifyContent: 'center',
          gap: '12px',
          marginBottom: '32px',
          flexWrap: 'wrap'
        }}>
          <button
            onClick={() => setActiveTab('sender')}
            className={activeTab === 'sender' ? 'btn-primary' : 'btn-secondary'}
          >
            <Package size={18} />
            <span>1. Sender Escrow Portal</span>
          </button>

          <button
            onClick={() => setActiveTab('recipient')}
            className={activeTab === 'recipient' ? 'btn-primary' : 'btn-secondary'}
          >
            <KeyRound size={18} />
            <span>2. Recipient BridgeKey Sign</span>
          </button>

          <button
            onClick={() => setActiveTab('terminal')}
            className={activeTab === 'terminal' ? 'btn-primary' : 'btn-secondary'}
          >
            <Cpu size={18} />
            <span>3. IoT Robotics Hub & Sensors</span>
          </button>

          <button
            onClick={() => setActiveTab('docs')}
            className={activeTab === 'docs' ? 'btn-primary' : 'btn-secondary'}
          >
            <FileText size={18} />
            <span>4. Verification & MSTScan</span>
          </button>
        </div>

        {/* Tab Contents */}
        {activeTab === 'sender' && (
          <SenderPortal
            signer={signer}
            account={account}
            balance={balance}
            onConnect={handleConnect}
            onDeliveryCreated={handleDeliveryCreated}
          />
        )}

        {activeTab === 'recipient' && (
          <RecipientPortal
            signer={signer}
            account={account}
            activeDeliveryId={activeDeliveryId}
            onActiveDeliveryChange={setActiveDeliveryId}
          />
        )}

        {activeTab === 'terminal' && (
          <TerminalMonitor
            activeDeliveryId={activeDeliveryId}
          />
        )}

        {activeTab === 'docs' && (
          <div className="glass-panel" style={{ padding: '36px', maxWidth: '840px', margin: '0 auto' }}>
            <h2 style={{ fontSize: '1.4rem', fontWeight: 800, marginBottom: '20px' }}>
              MST Testnet Submission & Verification Details
            </h2>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', fontSize: '0.9rem' }}>
              <div style={{ padding: '16px', background: 'rgba(255,255,255,0.03)', borderRadius: '10px' }}>
                <div style={{ fontWeight: 600, color: 'var(--accent-cyan)', marginBottom: '4px' }}>
                  MST Blockchain Network Parameters:
                </div>
                <ul style={{ paddingLeft: '20px', lineHeight: '1.8', color: 'var(--text-secondary)' }}>
                  <li><strong>Network Name:</strong> MST Testnet</li>
                  <li><strong>RPC Endpoint:</strong> <code className="mono">https://testnetrpc.mstblockchain.com</code></li>
                  <li><strong>Chain ID:</strong> <code className="mono">91562037 (0x5752035)</code></li>
                  <li><strong>Currency:</strong> MSTC</li>
                  <li><strong>Block Explorer:</strong> <a href="https://testnet.mstscan.com" target="_blank" rel="noreferrer" style={{ color: 'var(--accent-blue)' }}>https://testnet.mstscan.com</a></li>
                  <li><strong>Official Faucet:</strong> <a href="https://faucet.masterstroke.academy" target="_blank" rel="noreferrer" style={{ color: 'var(--accent-blue)' }}>https://faucet.masterstroke.academy</a></li>
                </ul>
              </div>

              <div style={{ padding: '16px', background: 'rgba(255,255,255,0.03)', borderRadius: '10px' }}>
                <div style={{ fontWeight: 600, color: 'var(--accent-purple)', marginBottom: '4px' }}>
                  Smart Contract Deployment Command:
                </div>
                <p style={{ color: 'var(--text-secondary)', marginBottom: '8px' }}>
                  To deploy directly to MST Testnet using your funded BridgeKey wallet:
                </p>
                <div style={{ background: '#05080f', padding: '12px', borderRadius: '8px', fontFamily: 'var(--font-mono)', fontSize: '0.82rem', overflowX: 'auto' }}>
                  cd contracts && npx hardhat run scripts/deploy.js --network mstTestnet
                </div>
              </div>

              <div style={{ padding: '16px', background: 'rgba(255,255,255,0.03)', borderRadius: '10px' }}>
                <div style={{ fontWeight: 600, color: 'var(--accent-green)', marginBottom: '4px' }}>
                  Mandatory Hackathon Deliverables Status:
                </div>
                <ul style={{ paddingLeft: '20px', lineHeight: '1.8', color: 'var(--text-secondary)' }}>
                  <li>✅ <strong>Two-Factor Multi-Sig Smart Contract:</strong> Verified, unit tested with 11 tests in Hardhat.</li>
                  <li>✅ <strong>GPS Geofencing Math:</strong> Integer Haversine / Equirectangular on-chain checking.</li>
                  <li>✅ <strong>Cold-Chain & Environmental Auditing:</strong> DHT22, MQ135, HC-SR04 telemetry pipeline.</li>
                  <li>✅ <strong>5% Cashback Reward:</strong> Programmatically distributed to sender wallet upon settlement.</li>
                  <li>✅ <strong>BridgeKey Wallet Integration:</strong> EIP-1193 standard, 1-click network switcher and signing.</li>
                  <li>✅ <strong>Neurick Hardware Firmware:</strong> Full ESP32-S3 Arduino sketch with SPI RFID, UART GPS, I2C OLED, and Servo locker latch.</li>
                </ul>
              </div>
            </div>
          </div>
        )}
      </main>

      {/* Footer */}
      <footer style={{ borderTop: '1px solid var(--border-color)', padding: '20px 24px', textAlign: 'center', fontSize: '0.8rem', color: 'var(--text-muted)' }}>
        MST Blockchain Buildathon 2026 • Newrro Neurick AI & Robotics Terminal • Multi-Sig Delivery
      </footer>
    </div>
  );
}
