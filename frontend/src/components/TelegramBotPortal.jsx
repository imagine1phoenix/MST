import React, { useState, useEffect } from 'react';
import { Send, CheckCircle2, AlertCircle, ExternalLink, Copy, Check, Bell, Shield, Sparkles, RefreshCw, KeyRound, ArrowRight, MessageSquare, Terminal } from 'lucide-react';
import { RELAY_API_URL } from '../utils/web3';

export default function TelegramBotPortal({ account }) {
  const [botStatus, setBotStatus] = useState({
    active: false,
    botUsername: null,
    botName: null,
    linkedCount: 0,
    hasToken: false,
    mappings: {}
  });

  const [isLoading, setIsLoading] = useState(false);
  const [copiedCmd, setCopiedCmd] = useState(false);
  const [chatIdInput, setChatIdInput] = useState('');
  const [linkStatus, setLinkStatus] = useState(null);

  // Configuration modal/panel state
  const [tokenInput, setTokenInput] = useState('');
  const [defaultChatInput, setDefaultChatInput] = useState('');
  const [configStatus, setConfigStatus] = useState(null);

  // Test notification bench state
  const [testDeliveryId, setTestDeliveryId] = useState('20');
  const [testEventType, setTestEventType] = useState('SETTLED');
  const [testResult, setTestResult] = useState(null);
  const [testRole, setTestRole] = useState('sender'); // 'sender' | 'recipient'

  // Fetch status on load and periodically
  const fetchStatus = async () => {
    try {
      const res = await fetch(`${RELAY_API_URL}/api/telegram/status`);
      if (res.ok) {
        const data = await res.json();
        setBotStatus(data);
      }
    } catch (_) {}
  };

  useEffect(() => {
    fetchStatus();
    const timer = setInterval(fetchStatus, 5000);
    return () => clearInterval(timer);
  }, []);

  const handleCopyCommand = () => {
    const cmd = `/link ${account || '0xb2CAcD0597ac693057aa80dA0eF9892b8951dd0a'}`;
    navigator.clipboard.writeText(cmd);
    setCopiedCmd(true);
    setTimeout(() => setCopiedCmd(false), 2000);
  };

  const handleLinkDirect = async (e) => {
    e.preventDefault();
    if (!chatIdInput.trim()) return;
    setIsLoading(true);
    setLinkStatus(null);
    try {
      const res = await fetch(`${RELAY_API_URL}/api/telegram/link`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          walletAddress: account || '0xb2CAcD0597ac693057aa80dA0eF9892b8951dd0a',
          chatId: chatIdInput.trim()
        })
      });
      const data = await res.json();
      if (data.success) {
        setLinkStatus({ success: true, message: `Wallet successfully linked to Telegram Chat ID ${chatIdInput}!` });
        setChatIdInput('');
        fetchStatus();
      } else {
        setLinkStatus({ success: false, message: data.error || 'Failed to link wallet.' });
      }
    } catch (err) {
      setLinkStatus({ success: false, message: err.message });
    } finally {
      setIsLoading(false);
    }
  };

  const handleSaveConfig = async (e) => {
    e.preventDefault();
    setIsLoading(true);
    setConfigStatus(null);
    try {
      const res = await fetch(`${RELAY_API_URL}/api/telegram/config`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token: tokenInput.trim(),
          defaultChatId: defaultChatInput.trim()
        })
      });
      const data = await res.json();
      if (data.success) {
        setConfigStatus({ success: true, message: 'Telegram Bot connected & authenticated!' });
        fetchStatus();
      } else {
        setConfigStatus({
          success: false,
          message: data.status?.hasToken
            ? 'Token configured. If connecting directly to Telegram failed, verify token with @BotFather.'
            : 'Config updated.'
        });
        fetchStatus();
      }
    } catch (err) {
      setConfigStatus({ success: false, message: err.message });
    } finally {
      setIsLoading(false);
    }
  };

  const handleSendTestAlert = async () => {
    setIsLoading(true);
    setTestResult(null);
    try {
      const res = await fetch(`${RELAY_API_URL}/api/telegram/test-notify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          deliveryId: Number(testDeliveryId) || 20,
          type: testEventType,
          senderWallet: account || '0xb2CAcD0597ac693057aa80dA0eF9892b8951dd0a',
          recipientWallet: '0x90F79bf6EB2c4f870365E785982E1f101E93b906'
        })
      });
      const data = await res.json();
      setTestResult({
        success: data.success,
        message: data.message || `Test ${testEventType} notification dispatched!`,
        data
      });
    } catch (err) {
      setTestResult({ success: false, message: err.message });
    } finally {
      setIsLoading(false);
    }
  };

  const currentWallet = account || '0xb2CAcD0597ac693057aa80dA0eF9892b8951dd0a';
  const isLinked = botStatus.mappings && botStatus.mappings[currentWallet.toLowerCase()];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '32px' }}>
      {/* Header Banner */}
      <div className="glass-panel" style={{ padding: '28px', background: 'radial-gradient(ellipse at 80% 20%, rgba(0, 242, 254, 0.12) 0%, rgba(2, 6, 12, 0.98) 70%)' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: '20px' }}>
          <div style={{ display: 'flex', gap: '18px' }}>
            <div style={{
              width: '56px',
              height: '56px',
              borderRadius: '16px',
              background: 'linear-gradient(135deg, #00f2fe 0%, #0088a8 100%)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              boxShadow: '0 0 25px rgba(0, 242, 254, 0.5)',
              flexShrink: 0
            }}>
              <Send size={28} color="#000000" />
            </div>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '6px' }}>
                <h2 style={{ fontSize: '1.45rem', fontWeight: 800, letterSpacing: '-0.02em' }}>
                  Telegram Push Notification Engine
                </h2>
                <span className={`badge ${botStatus.active ? 'badge-green' : 'badge-amber'}`} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <span className={`status-dot ${botStatus.active ? 'status-dot-active' : ''}`} style={{ background: botStatus.active ? 'var(--accent-green)' : 'var(--accent-amber)' }}></span>
                  {botStatus.active ? 'Live Connected' : 'Standby / Simulation'}
                </span>
              </div>
              <p style={{ color: 'var(--text-secondary)', fontSize: '0.92rem', maxWidth: '680px', lineHeight: '1.5' }}>
                Sends deeply personalized, real-time cryptographic updates to both the <strong>Sender</strong> and <strong>Recipient</strong> throughout every stage: escrow locking, physical RFID verification, locker door unlocking, and instant 5% cashback payouts!
              </p>
            </div>
          </div>

          {/* Quick Bot Link */}
          {botStatus.botUsername ? (
            <a
              href={`https://t.me/${botStatus.botUsername}`}
              target="_blank"
              rel="noreferrer"
              className="btn-primary"
              style={{ textDecoration: 'none', background: 'linear-gradient(135deg, #00f2fe 0%, #0099b8 100%)', color: '#000000', fontWeight: 700 }}
            >
              <Send size={16} color="#000000" />
              <span>Open @{botStatus.botUsername}</span>
              <ExternalLink size={14} color="#000000" />
            </a>
          ) : (
            <div style={{
              background: 'rgba(255, 255, 255, 0.05)',
              border: '1px solid var(--border-color)',
              padding: '10px 18px',
              borderRadius: '12px',
              fontSize: '0.85rem'
            }}>
              <span style={{ color: 'var(--text-muted)' }}>Registered Wallets: </span>
              <strong style={{ color: 'var(--accent-cyan)' }}>{botStatus.linkedCount || 0}</strong>
            </div>
          )}
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: '24px' }}>
        {/* Card 1: Link Your Wallet */}
        <div className="glass-panel" style={{ padding: '26px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '18px' }}>
            <KeyRound size={20} color="var(--accent-cyan)" />
            <h3 style={{ fontSize: '1.15rem', fontWeight: 700 }}>1. Link Your Wallet for Alerts</h3>
          </div>

          <p style={{ fontSize: '0.86rem', color: 'var(--text-secondary)', marginBottom: '16px', lineHeight: '1.5' }}>
            Link your BridgeKey wallet address to your Telegram chat so you receive personal notifications whenever your parcels are created, scanned, or settled.
          </p>

          <div style={{
            background: 'rgba(0, 0, 0, 0.3)',
            border: '1px solid var(--border-color)',
            borderRadius: '12px',
            padding: '14px',
            marginBottom: '20px'
          }}>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '4px' }}>CURRENT ACTIVE WALLET</div>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.84rem', color: 'var(--accent-cyan)', wordBreak: 'break-all' }}>
              {currentWallet}
            </div>
            <div style={{ marginTop: '8px', display: 'flex', alignItems: 'center', gap: '6px' }}>
              {isLinked ? (
                <span style={{ fontSize: '0.78rem', color: 'var(--accent-green)', display: 'flex', alignItems: 'center', gap: '4px' }}>
                  <CheckCircle2 size={13} /> Linked to Telegram Chat #{botStatus.mappings[currentWallet.toLowerCase()]}
                </span>
              ) : (
                <span style={{ fontSize: '0.78rem', color: 'var(--accent-amber)', display: 'flex', alignItems: 'center', gap: '4px' }}>
                  <AlertCircle size={13} /> Not linked yet — Link via command below
                </span>
              )}
            </div>
          </div>

          {/* Method A: Telegram Bot Command */}
          <div style={{ marginBottom: '20px' }}>
            <div style={{ fontSize: '0.82rem', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '8px' }}>
              Method A: Copy Bot Command into Telegram
            </div>
            <div style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              background: 'rgba(0, 242, 254, 0.06)',
              border: '1px solid var(--border-accent)',
              borderRadius: '10px',
              padding: '10px 14px'
            }}>
              <code style={{ fontSize: '0.82rem', color: 'var(--text-primary)', wordBreak: 'break-all' }}>
                /link {currentWallet.substring(0, 10)}...{currentWallet.substring(36)}
              </code>
              <button
                onClick={handleCopyCommand}
                className="btn-secondary"
                style={{ padding: '6px 12px', fontSize: '0.75rem', flexShrink: 0, gap: '4px' }}
              >
                {copiedCmd ? <Check size={14} color="var(--accent-green)" /> : <Copy size={14} />}
                <span>{copiedCmd ? 'Copied!' : 'Copy Full'}</span>
              </button>
            </div>
          </div>

          {/* Method B: Direct Chat ID Link */}
          <div>
            <div style={{ fontSize: '0.82rem', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '8px' }}>
              Method B: Enter Your Telegram Chat ID
            </div>
            <form onSubmit={handleLinkDirect} style={{ display: 'flex', gap: '10px' }}>
              <input
                type="text"
                placeholder="e.g. 123456789"
                value={chatIdInput}
                onChange={(e) => setChatIdInput(e.target.value)}
                style={{
                  flex: 1,
                  background: 'rgba(255, 255, 255, 0.04)',
                  border: '1px solid var(--border-color)',
                  borderRadius: '10px',
                  padding: '10px 14px',
                  color: '#fff',
                  fontSize: '0.85rem'
                }}
              />
              <button
                type="submit"
                disabled={isLoading || !chatIdInput.trim()}
                className="btn-primary"
                style={{ padding: '10px 18px', fontSize: '0.85rem', flexShrink: 0 }}
              >
                Link
              </button>
            </form>
            {linkStatus && (
              <div style={{
                marginTop: '10px',
                fontSize: '0.8rem',
                color: linkStatus.success ? 'var(--accent-green)' : 'var(--accent-red)'
              }}>
                {linkStatus.message}
              </div>
            )}
          </div>
        </div>

        {/* Card 2: Interactive Notification Test Bench */}
        <div className="glass-panel" style={{ padding: '26px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '18px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <Bell size={20} color="var(--accent-cyan)" />
              <h3 style={{ fontSize: '1.15rem', fontWeight: 700 }}>2. Notification Test Bench</h3>
            </div>
            <span className="badge badge-cyan" style={{ fontSize: '0.72rem' }}>Live Test</span>
          </div>

          <p style={{ fontSize: '0.86rem', color: 'var(--text-secondary)', marginBottom: '16px', lineHeight: '1.5' }}>
            Simulate and preview what the Sender and Recipient receive on their phone for any delivery lifecycle event.
          </p>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginBottom: '16px' }}>
            <div>
              <label style={{ fontSize: '0.75rem', color: 'var(--text-muted)', display: 'block', marginBottom: '6px' }}>EVENT TYPE</label>
              <select
                value={testEventType}
                onChange={(e) => setTestEventType(e.target.value)}
                style={{
                  width: '100%',
                  background: 'rgba(255, 255, 255, 0.04)',
                  border: '1px solid var(--border-color)',
                  borderRadius: '10px',
                  padding: '9px 12px',
                  color: '#fff',
                  fontSize: '0.84rem'
                }}
              >
                <option value="CREATED" style={{ background: '#111726' }}>📦 1. Parcel Booked</option>
                <option value="KEY1_VERIFIED" style={{ background: '#111726' }}>💳 2. Key 1 (RFID Verified)</option>
                <option value="SETTLED" style={{ background: '#111726' }}>🎉 3. Settled (+5% Cashback)</option>
              </select>
            </div>

            <div>
              <label style={{ fontSize: '0.75rem', color: 'var(--text-muted)', display: 'block', marginBottom: '6px' }}>DELIVERY ID</label>
              <input
                type="number"
                value={testDeliveryId}
                onChange={(e) => setTestDeliveryId(e.target.value)}
                style={{
                  width: '100%',
                  background: 'rgba(255, 255, 255, 0.04)',
                  border: '1px solid var(--border-color)',
                  borderRadius: '10px',
                  padding: '9px 12px',
                  color: '#fff',
                  fontSize: '0.84rem'
                }}
              />
            </div>
          </div>

          <div style={{ display: 'flex', gap: '10px', marginBottom: '18px' }}>
            <button
              onClick={handleSendTestAlert}
              disabled={isLoading}
              className="btn-primary"
              style={{ flex: 1, padding: '10px 16px', fontSize: '0.85rem' }}
            >
              {isLoading ? <RefreshCw size={14} className="spin" /> : <Send size={14} />}
              <span>Dispatch Test Notification</span>
            </button>
          </div>

          {testResult && (
            <div style={{
              background: testResult.success ? 'rgba(16, 185, 129, 0.1)' : 'rgba(239, 68, 68, 0.1)',
              border: `1px solid ${testResult.success ? 'rgba(16, 185, 129, 0.3)' : 'rgba(239, 68, 68, 0.3)'}`,
              borderRadius: '10px',
              padding: '10px 14px',
              marginBottom: '16px',
              fontSize: '0.82rem',
              color: testResult.success ? '#6ee7b7' : '#fca5a5'
            }}>
              {testResult.message}
            </div>
          )}

          {/* Interactive Message Preview */}
          <div style={{
            background: 'rgba(15, 23, 42, 0.7)',
            border: '1px solid var(--border-color)',
            borderRadius: '12px',
            padding: '14px'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
              <span style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-muted)' }}>PREVIEW TELEGRAM MESSAGE</span>
              <div style={{ display: 'flex', gap: '6px' }}>
                <button
                  onClick={() => setTestRole('sender')}
                  style={{
                    background: testRole === 'sender' ? 'var(--accent-cyan)' : 'transparent',
                    color: testRole === 'sender' ? '#000' : 'var(--text-muted)',
                    border: 'none',
                    borderRadius: '6px',
                    padding: '3px 8px',
                    fontSize: '0.7rem',
                    fontWeight: 600,
                    cursor: 'pointer'
                  }}
                >
                  Sender View
                </button>
                <button
                  onClick={() => setTestRole('recipient')}
                  style={{
                    background: testRole === 'recipient' ? 'var(--accent-cyan)' : 'transparent',
                    color: testRole === 'recipient' ? '#000' : 'var(--text-muted)',
                    border: 'none',
                    borderRadius: '6px',
                    padding: '3px 8px',
                    fontSize: '0.7rem',
                    fontWeight: 600,
                    cursor: 'pointer'
                  }}
                >
                  Recipient View
                </button>
              </div>
            </div>

            <div style={{
              fontSize: '0.8rem',
              lineHeight: '1.5',
              color: 'var(--text-primary)',
              background: 'rgba(0, 0, 0, 0.3)',
              padding: '12px',
              borderRadius: '8px',
              borderLeft: '3px solid var(--accent-cyan)'
            }}>
              {testEventType === 'CREATED' && (
                testRole === 'sender' ? (
                  <>
                    <div>📦 <strong>YOUR PARCEL IS BOOKED! (Delivery #{testDeliveryId})</strong></div>
                    <div style={{ marginTop: '6px', color: 'var(--text-secondary)' }}>Hello Sender! Your zero-trust delivery has been locked on the MST Blockchain.</div>
                    <div style={{ marginTop: '6px' }}>💰 <strong>Escrow Locked:</strong> <code>0.1000 $MSTC</code></div>
                    <div>🎁 <strong>Your 5% Cashback:</strong> <code>+0.0050 $MSTC</code> <em>(Pending completion)</em></div>
                    <div>🚚 <strong>Courier Payout:</strong> <code>0.0950 $MSTC</code></div>
                  </>
                ) : (
                  <>
                    <div>📬 <strong>INCOMING PARCEL ALERT! (Delivery #{testDeliveryId})</strong></div>
                    <div style={{ marginTop: '6px', color: 'var(--text-secondary)' }}>Hello Recipient! A package is being dispatched to you on the MST Network.</div>
                    <div style={{ marginTop: '6px' }}>💰 <strong>Escrow Value:</strong> <code>0.1000 $MSTC</code> (Fully funded ✅)</div>
                    <div>📍 <strong>Destination Terminal:</strong> <code>28.6129, 77.2295</code></div>
                  </>
                )
              )}

              {testEventType === 'KEY1_VERIFIED' && (
                testRole === 'sender' ? (
                  <>
                    <div>💳 <strong>PARCEL ARRIVED AT LOCKER! (Delivery #{testDeliveryId})</strong></div>
                    <div style={{ marginTop: '6px' }}>🏷️ <strong>Hardware RFID Scan:</strong> ✅ Verified (UID: <code>0x82</code>)</div>
                    <div>🛰️ <strong>Geofence Confirmation:</strong> ✅ Target GPS Match</div>
                    <div style={{ marginTop: '6px', color: 'var(--text-secondary)' }}><em>The recipient has been alerted to sign Key 2 and retrieve the package. Your 5% cashback will disburse immediately upon pickup.</em></div>
                  </>
                ) : (
                  <>
                    <div>🚨 <strong>YOUR PACKAGE HAS ARRIVED AT THE SMART TERMINAL!</strong></div>
                    <div style={{ marginTop: '6px' }}>🔑 <strong>Key 1 (Terminal RFID):</strong> ✅ <strong>VERIFIED</strong></div>
                    <div>🔒 <strong>Locker Door:</strong> LATCHED SHUT (Awaiting Key 2)</div>
                    <div style={{ marginTop: '6px', color: 'var(--accent-cyan)' }}>👉 <strong>Action Required:</strong> Sign Key 2 on your Recipient Portal to pop open the locker door!</div>
                  </>
                )
              )}

              {testEventType === 'SETTLED' && (
                testRole === 'sender' ? (
                  <>
                    <div>🎉 <strong>DELIVERY #{testDeliveryId} COMPLETE — 5% CASHBACK CREDITED!</strong></div>
                    <div style={{ marginTop: '6px', color: 'var(--accent-green)', fontWeight: 600 }}>
                      🎁 YOUR CASHBACK PAYOUT: +0.0050 $MSTC (5% instant reward 🎉)
                    </div>
                    <div style={{ marginTop: '4px', color: 'var(--text-secondary)' }}>Your BridgeKey wallet balance has been credited directly on-chain!</div>
                    <div style={{ marginTop: '6px' }}>🔗 <em>View Receipt on MSTScan (0xaedc0a...)</em></div>
                  </>
                ) : (
                  <>
                    <div>🔓 <strong>LOCKER UNLOCKED & DELIVERY #{testDeliveryId} COMPLETE!</strong></div>
                    <div style={{ marginTop: '6px' }}>🚪 <strong>Compartment Door:</strong> <strong>UNLOCKED</strong> ✅</div>
                    <div style={{ marginTop: '4px' }}>📦 Please take your package from the locker compartment.</div>
                    <div style={{ marginTop: '6px', color: 'var(--text-secondary)' }}><em>Hope you enjoyed your zero-trust delivery experience!</em></div>
                  </>
                )
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Card 3: Bot Configuration & Telegram Setup Guide */}
      <div className="glass-panel" style={{ padding: '26px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '18px' }}>
          <Terminal size={20} color="var(--accent-cyan)" />
          <h3 style={{ fontSize: '1.15rem', fontWeight: 700 }}>3. Bot Configuration & Custom Setup</h3>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '24px' }}>
          <div>
            <form onSubmit={handleSaveConfig} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              <div>
                <label style={{ fontSize: '0.78rem', color: 'var(--text-muted)', display: 'block', marginBottom: '6px' }}>
                  TELEGRAM BOT TOKEN (From @BotFather)
                </label>
                <input
                  type="password"
                  placeholder="e.g. 7123456789:AAHxyz..."
                  value={tokenInput}
                  onChange={(e) => setTokenInput(e.target.value)}
                  style={{
                    width: '100%',
                    background: 'rgba(255, 255, 255, 0.04)',
                    border: '1px solid var(--border-color)',
                    borderRadius: '10px',
                    padding: '10px 14px',
                    color: '#fff',
                    fontSize: '0.85rem'
                  }}
                />
              </div>

              <div>
                <label style={{ fontSize: '0.78rem', color: 'var(--text-muted)', display: 'block', marginBottom: '6px' }}>
                  DEFAULT / DEMO CHAT ID (Optional Broadcast Channel)
                </label>
                <input
                  type="text"
                  placeholder="e.g. 987654321"
                  value={defaultChatInput}
                  onChange={(e) => setDefaultChatInput(e.target.value)}
                  style={{
                    width: '100%',
                    background: 'rgba(255, 255, 255, 0.04)',
                    border: '1px solid var(--border-color)',
                    borderRadius: '10px',
                    padding: '10px 14px',
                    color: '#fff',
                    fontSize: '0.85rem'
                  }}
                />
              </div>

              <button
                type="submit"
                disabled={isLoading}
                className="btn-secondary"
                style={{ padding: '10px 16px', fontSize: '0.85rem', alignSelf: 'flex-start' }}
              >
                {isLoading ? <RefreshCw size={14} className="spin" /> : <Shield size={14} />}
                <span>Save & Authenticate Bot</span>
              </button>

              {configStatus && (
                <div style={{
                  fontSize: '0.82rem',
                  color: configStatus.success ? 'var(--accent-green)' : 'var(--accent-amber)'
                }}>
                  {configStatus.message}
                </div>
              )}
            </form>
          </div>

          <div style={{
            background: 'rgba(255, 255, 255, 0.02)',
            border: '1px solid var(--border-color)',
            borderRadius: '12px',
            padding: '18px'
          }}>
            <h4 style={{ fontSize: '0.9rem', fontWeight: 700, marginBottom: '12px', color: 'var(--accent-cyan)' }}>
              ⚡ Quick 60-Second Setup with @BotFather:
            </h4>
            <ol style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', paddingLeft: '18px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <li>Open Telegram and search for <code>@BotFather</code>.</li>
              <li>Send <code>/newbot</code>, choose a name and username (e.g. <code>MST_SmartTerminal_Bot</code>).</li>
              <li>Copy the HTTP API Token provided by BotFather.</li>
              <li>Paste it in the token input on the left and click <strong>Save & Authenticate</strong>.</li>
              <li>Open your new bot, click <strong>Start</strong>, and send <code>/link &lt;your_wallet&gt;</code>!</li>
            </ol>
          </div>
        </div>
      </div>
    </div>
  );
}
