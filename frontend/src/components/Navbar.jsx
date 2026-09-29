import React from 'react';
import { ShieldCheck, Wallet, ExternalLink, RefreshCw, Cpu, Send, Sliders } from 'lucide-react';
import { formatAddress, MST_CHAIN_ID_DECIMAL } from '../utils/web3';

export default function Navbar({ account, balance, onConnect, isConnecting, contractAddress, onOpenTelegram, onOpenAdmin }) {
  return (
    <header style={{
      borderBottom: '1px solid rgba(0, 242, 254, 0.2)',
      background: 'rgba(0, 0, 0, 0.92)',
      backdropFilter: 'blur(16px)',
      position: 'sticky',
      top: 0,
      zIndex: 50,
      padding: '16px 28px',
      boxShadow: '0 4px 30px rgba(0, 0, 0, 0.9), 0 1px 0 rgba(0, 242, 254, 0.15)'
    }}>
      <div style={{
        maxWidth: '1280px',
        margin: '0 auto',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        flexWrap: 'nowrap',
        gap: '20px'
      }}>
        {/* Brand / Logo */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexShrink: 0 }}>
          <div style={{
            width: '38px',
            height: '38px',
            borderRadius: '10px',
            background: 'linear-gradient(135deg, #00f2fe 0%, #0099b8 100%)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            boxShadow: '0 0 20px rgba(0, 242, 254, 0.45)',
            flexShrink: 0
          }}>
            <Cpu size={22} color="#000000" />
          </div>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ fontSize: '1.18rem', fontWeight: 800, letterSpacing: '-0.02em', color: '#fff', whiteSpace: 'nowrap' }}>
                MST <span style={{ color: 'var(--accent-cyan)', textShadow: '0 0 15px rgba(0, 242, 254, 0.6)' }}>SmartTerminal</span>
              </span>
              <span className="badge badge-cyan" style={{ fontSize: '0.68rem', padding: '2px 8px' }}>
                Multi-Sig 2.0
              </span>
            </div>
            <p style={{ fontSize: '0.74rem', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
              IoT Geofenced Escrow • Zero-Trust Delivery
            </p>
          </div>
        </div>

        {/* Network & Wallet Controls */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexShrink: 0 }}>
          {/* MST Testnet Badge */}
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            background: 'rgba(0, 242, 254, 0.05)',
            border: '1px solid rgba(0, 242, 254, 0.2)',
            padding: '7px 12px',
            borderRadius: '10px',
            whiteSpace: 'nowrap'
          }}>
            <span className="status-dot status-dot-active"></span>
            <span style={{ fontSize: '0.8rem', fontWeight: 600 }}>MST Testnet</span>
          </div>

          {/* Faucet Link */}
          <a
            href="https://faucet.masterstroke.academy"
            target="_blank"
            rel="noreferrer"
            className="btn-secondary"
            style={{ textDecoration: 'none', padding: '7px 12px', fontSize: '0.8rem', whiteSpace: 'nowrap' }}
          >
            <span>Faucet</span>
            <ExternalLink size={13} />
          </a>

          {/* Telegram Bot Alerts Link */}
          <button
            onClick={onOpenTelegram}
            className="btn-secondary"
            style={{ padding: '7px 12px', fontSize: '0.8rem', display: 'flex', alignItems: 'center', gap: '6px', whiteSpace: 'nowrap' }}
            title="Configure & Test Telegram Bot Notifications"
          >
            <Send size={13} color="var(--accent-cyan)" />
            <span>Telegram Bot</span>
          </button>

          {/* Admin & Terminal Config */}
          <button
            onClick={onOpenAdmin}
            className="btn-secondary"
            style={{ padding: '7px 12px', fontSize: '0.8rem', display: 'flex', alignItems: 'center', gap: '6px', whiteSpace: 'nowrap' }}
            title="Configure Wi-Fi and Relay Connection"
          >
            <Sliders size={13} color="var(--accent-cyan)" />
            <span>Admin</span>
          </button>

          {/* Wallet Button */}
          {account ? (
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: '10px',
              background: 'rgba(0, 242, 254, 0.08)',
              border: '1px solid var(--border-accent)',
              padding: '6px 14px',
              borderRadius: '12px'
            }}>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-primary)' }}>
                  {formatAddress(account)}
                </div>
                <div style={{ fontSize: '0.75rem', color: 'var(--accent-cyan)', fontFamily: 'var(--font-mono)' }}>
                  {balance} $MSTC
                </div>
              </div>
              <div style={{
                width: '32px',
                height: '32px',
                borderRadius: '50%',
                background: 'linear-gradient(135deg, #00f2fe 0%, #0088b3 100%)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                boxShadow: '0 0 12px rgba(0, 242, 254, 0.4)'
              }}>
                <ShieldCheck size={18} color="#000000" />
              </div>
            </div>
          ) : (
            <button
              onClick={onConnect}
              disabled={isConnecting}
              className="btn-primary"
            >
              {isConnecting ? (
                <>
                  <RefreshCw size={16} className="spin" />
                  <span>Connecting...</span>
                </>
              ) : (
                <>
                  <Wallet size={16} />
                  <span>Connect BridgeKey</span>
                </>
              )}
            </button>
          )}
        </div>
      </div>
    </header>
  );
}
