import React from 'react';
import { ShieldCheck, Wallet, ExternalLink, RefreshCw, Cpu, Send } from 'lucide-react';
import { formatAddress, MST_CHAIN_ID_DECIMAL } from '../utils/web3';

export default function Navbar({ account, balance, onConnect, isConnecting, contractAddress, onOpenTelegram }) {
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
        flexWrap: 'wrap',
        gap: '16px'
      }}>
        {/* Brand / Logo */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
          <div style={{
            width: '42px',
            height: '42px',
            borderRadius: '12px',
            background: 'linear-gradient(135deg, #00f2fe 0%, #0099b8 100%)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            boxShadow: '0 0 25px rgba(0, 242, 254, 0.5)'
          }}>
            <Cpu size={24} color="#000000" />
          </div>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ fontSize: '1.25rem', fontWeight: 800, letterSpacing: '-0.02em', color: '#fff' }}>
                MST <span style={{ color: 'var(--accent-cyan)', textShadow: '0 0 15px rgba(0, 242, 254, 0.6)' }}>SmartTerminal</span>
              </span>
              <span className="badge badge-cyan" style={{ fontSize: '0.7rem' }}>
                Multi-Sig 2.0
              </span>
            </div>
            <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
              IoT Geofenced Escrow • MST Blockchain × Robotics
            </p>
          </div>
        </div>

        {/* Network & Wallet Controls */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          {/* MST Testnet Badge */}
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            background: 'rgba(255, 255, 255, 0.04)',
            border: '1px solid var(--border-color)',
            padding: '8px 14px',
            borderRadius: '10px'
          }}>
            <span className="status-dot status-dot-active"></span>
            <span style={{ fontSize: '0.82rem', fontWeight: 600 }}>MST Testnet</span>
            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>(ID: {MST_CHAIN_ID_DECIMAL})</span>
          </div>

          {/* Faucet Link */}
          <a
            href="https://faucet.masterstroke.academy"
            target="_blank"
            rel="noreferrer"
            className="btn-secondary"
            style={{ textDecoration: 'none', padding: '8px 14px', fontSize: '0.82rem' }}
          >
            <span>Claim $MSTC Faucet</span>
            <ExternalLink size={14} />
          </a>

          {/* Telegram Bot Alerts Link */}
          <button
            onClick={onOpenTelegram}
            className="btn-secondary"
            style={{ padding: '8px 14px', fontSize: '0.82rem', display: 'flex', alignItems: 'center', gap: '6px' }}
            title="Configure & Test Telegram Bot Notifications"
          >
            <Send size={14} color="var(--accent-cyan)" />
            <span>Telegram Bot</span>
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
