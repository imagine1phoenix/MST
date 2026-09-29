import React, { useState, useEffect } from 'react';
import { 
  Sliders, Wifi, Server, Cpu, CheckCircle2, AlertCircle, RefreshCw, 
  ExternalLink, Copy, Check, Save, Smartphone, Radio, Globe, Shield, Terminal, ArrowRight, Zap
} from 'lucide-react';
import { getRelayApiUrl, setRelayApiUrl, MST_RPC_URL, MST_CHAIN_ID_DECIMAL } from '../utils/web3';

export default function AdminPortal({ activeDeliveryId }) {
  // Relay connection state
  const [relayUrl, setRelayUrl] = useState(getRelayApiUrl());
  const [relayStatus, setRelayStatus] = useState({ online: false, pingMs: null, data: null });
  const [isPinging, setIsPinging] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);

  // Terminal config from Relay
  const [terminalConfig, setTerminalConfig] = useState({
    wifiSsid: 'BMS_Buildathon',
    wifiPassword: 'Bmsce$2026$!',
    relayHost: 'http://10.80.79.100:5001',
    currentIp: '10.80.79.100',
    availableIps: [],
    knownNetworks: []
  });
  const [isConfigLoading, setIsConfigLoading] = useState(false);
  const [configSaveStatus, setConfigSaveStatus] = useState(null);

  // Form state
  const [ssidInput, setSsidInput] = useState('');
  const [passwordInput, setPasswordInput] = useState('');
  const [relayHostInput, setRelayHostInput] = useState('');
  const [copiedSnippet, setCopiedSnippet] = useState(false);

  // New network preset modal/inputs
  const [newSsid, setNewSsid] = useState('');
  const [newPass, setNewPass] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [showAddPreset, setShowAddPreset] = useState(false);

  // Latest hardware telemetry
  const [telemetry, setTelemetry] = useState(null);

  // Ping relay server to measure latency & verify health
  const testRelayConnection = async (targetUrl = null) => {
    const url = (targetUrl || relayUrl).replace(/\/$/, "");
    setIsPinging(true);
    const start = performance.now();
    try {
      const res = await fetch(`${url}/api/network-info`, { signal: AbortSignal.timeout(4000) });
      const duration = Math.round(performance.now() - start);
      if (res.ok) {
        const data = await res.json();
        setRelayStatus({ online: true, pingMs: duration, data });
      } else {
        setRelayStatus({ online: false, pingMs: null, data: null });
      }
    } catch (err) {
      setRelayStatus({ online: false, pingMs: null, data: null, error: err.message });
    } finally {
      setIsPinging(false);
    }
  };

  // Fetch terminal config from Relay
  const fetchTerminalConfig = async () => {
    setIsConfigLoading(true);
    try {
      const res = await fetch(`${relayUrl}/api/terminal/config`, { signal: AbortSignal.timeout(4000) });
      if (res.ok) {
        const data = await res.json();
        setTerminalConfig(data);
        setSsidInput(data.wifiSsid || '');
        setPasswordInput(data.wifiPassword || '');
        setRelayHostInput(data.relayHost || '');
      }
    } catch (_) {}
    finally {
      setIsConfigLoading(false);
    }
  };

  // Fetch live telemetry snapshot
  const fetchTelemetry = async () => {
    try {
      const res = await fetch(`${relayUrl}/api/terminal/telemetry/latest`, { signal: AbortSignal.timeout(3000) });
      if (res.ok) {
        const data = await res.json();
        setTelemetry(data);
      }
    } catch (_) {}
  };

  useEffect(() => {
    testRelayConnection();
    fetchTerminalConfig();
    fetchTelemetry();
    const interval = setInterval(() => {
      fetchTelemetry();
    }, 4000);
    return () => clearInterval(interval);
  }, [relayUrl]);

  // Apply new relay URL to frontend (localStorage)
  const handleApplyRelayUrl = (newUrl = null) => {
    const urlToSet = (newUrl || relayUrl).trim().replace(/\/$/, "");
    setRelayUrl(urlToSet);
    setRelayApiUrl(urlToSet);
    setSaveSuccess(true);
    testRelayConnection(urlToSet);
    setTimeout(() => setSaveSuccess(false), 2500);
  };

  // Save Terminal Wi-Fi config to Relay
  const handleSaveTerminalConfig = async (e) => {
    e.preventDefault();
    setConfigSaveStatus({ saving: true });
    try {
      const res = await fetch(`${relayUrl}/api/terminal/config`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          wifiSsid: ssidInput,
          wifiPassword: passwordInput,
          relayHost: relayHostInput,
          knownNetworks: terminalConfig.knownNetworks
        })
      });
      const data = await res.json();
      if (data.success) {
        setConfigSaveStatus({ success: true, message: 'Terminal Wi-Fi & Relay configuration updated on server!' });
        setTerminalConfig(data.config);
      } else {
        setConfigSaveStatus({ error: true, message: 'Server failed to save configuration.' });
      }
    } catch (err) {
      setConfigSaveStatus({ error: true, message: err.message });
    }
    setTimeout(() => setConfigSaveStatus(null), 4000);
  };

  // Quick preset loader
  const handleApplyPreset = (preset) => {
    setSsidInput(preset.ssid);
    setPasswordInput(preset.password || '');
    if (preset.relayHost) {
      setRelayHostInput(preset.relayHost);
    }
  };

  // Add new known network preset
  const handleAddNewPreset = (e) => {
    e.preventDefault();
    if (!newSsid.trim()) return;
    const updated = [
      ...(terminalConfig.knownNetworks || []),
      {
        ssid: newSsid.trim(),
        password: newPass.trim(),
        description: newDesc.trim() || 'Custom Network'
      }
    ];
    setTerminalConfig(prev => ({ ...prev, knownNetworks: updated }));
    setNewSsid('');
    setNewPass('');
    setNewDesc('');
    setShowAddPreset(false);

    // Persist to relay
    fetch(`${relayUrl}/api/terminal/config`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ knownNetworks: updated })
    }).catch(() => {});
  };

  // Generate Arduino C++ code snippet
  const generatedCode = `// --- Generated Configuration for MultiSigTerminal.ino ---
const char *WIFI_SSID = "${ssidInput || 'BMS_Buildathon'}";
const char *WIFI_PASSWORD = "${passwordInput || 'Bmsce$2026$!'}";
const char *RELAY_HOST = "${relayHostInput || 'http://10.80.79.100:5001'}"; // Port 5001 mandatory!`;

  const handleCopyCode = () => {
    navigator.clipboard.writeText(generatedCode);
    setCopiedSnippet(true);
    setTimeout(() => setCopiedSnippet(false), 2000);
  };

  return (
    <div style={{ maxWidth: '1080px', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: '28px' }}>
      
      {/* Header Banner */}
      <div style={{
        background: 'linear-gradient(135deg, rgba(0, 242, 254, 0.08) 0%, rgba(2, 8, 14, 0.95) 100%)',
        border: '1px solid rgba(0, 242, 254, 0.28)',
        borderRadius: '20px',
        padding: '28px',
        position: 'relative',
        overflow: 'hidden'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '16px' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '8px' }}>
              <div style={{
                background: 'linear-gradient(135deg, #00f2fe 0%, #0099b8 100%)',
                width: '36px',
                height: '36px',
                borderRadius: '10px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#000'
              }}>
                <Sliders size={20} />
              </div>
              <h2 style={{ fontSize: '1.5rem', fontWeight: 800, letterSpacing: '-0.02em', margin: 0 }}>
                Admin & Terminal Network Manager
              </h2>
              <span className="badge badge-cyan" style={{ fontSize: '0.72rem' }}>
                Hotspot & Wi-Fi Switcher
              </span>
            </div>
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.88rem', margin: 0, maxWidth: '650px', lineHeight: '1.5' }}>
              Seamlessly switch Wi-Fi networks and Relay Host addresses when demonstrating the hardware terminal across different venues, mobile hotspots, or college Wi-Fi.
            </p>
          </div>

          {/* Live Relay Status Pill */}
          <div style={{
            background: relayStatus.online ? 'rgba(34, 197, 94, 0.1)' : 'rgba(239, 68, 68, 0.1)',
            border: `1px solid ${relayStatus.online ? 'rgba(34, 197, 94, 0.4)' : 'rgba(239, 68, 68, 0.4)'}`,
            padding: '12px 18px',
            borderRadius: '14px',
            display: 'flex',
            alignItems: 'center',
            gap: '12px'
          }}>
            <div style={{
              width: '10px',
              height: '10px',
              borderRadius: '50%',
              background: relayStatus.online ? '#22c55e' : '#ef4444',
              boxShadow: `0 0 10px ${relayStatus.online ? '#22c55e' : '#ef4444'}`
            }} />
            <div>
              <div style={{ fontSize: '0.8rem', fontWeight: 700, color: relayStatus.online ? '#86efac' : '#fca5a5' }}>
                {relayStatus.online ? 'Relay Server: ONLINE' : 'Relay Server: OFFLINE'}
              </div>
              <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                {relayStatus.online ? `Ping: ${relayStatus.pingMs}ms • Port 5001` : 'Check if relay is running'}
              </div>
            </div>
            <button
              onClick={() => testRelayConnection()}
              className="btn-secondary"
              disabled={isPinging}
              style={{ padding: '6px 10px', fontSize: '0.72rem', display: 'flex', alignItems: 'center', gap: '5px' }}
              title="Test Connection"
            >
              <RefreshCw size={12} className={isPinging ? 'spin' : ''} />
              <span>Ping</span>
            </button>
          </div>
        </div>
      </div>

      {/* Grid: 2 Columns */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(480px, 1fr))', gap: '24px' }}>
        
        {/* Column 1: Frontend Relay Connection Manager */}
        <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: '18px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', borderBottom: '1px solid rgba(255, 255, 255, 0.08)', paddingBottom: '14px' }}>
            <Server size={18} color="var(--accent-cyan)" />
            <h3 style={{ fontSize: '1.05rem', fontWeight: 700, margin: 0 }}>
              1. DApp Relay Connection Endpoint
            </h3>
          </div>

          <p style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', margin: 0, lineHeight: '1.5' }}>
            This controls where this website sends requests (scans, telemetry, bot triggers). Saved directly to your browser's local storage.
          </p>

          <div>
            <label style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: '8px', display: 'block', fontWeight: 600 }}>
              Active Relay URL
            </label>
            <div style={{ display: 'flex', gap: '10px' }}>
              <input
                type="text"
                value={relayUrl}
                onChange={(e) => setRelayUrl(e.target.value)}
                placeholder="http://localhost:5001"
                className="input-field"
                style={{ flex: 1, fontFamily: 'var(--font-mono)', fontSize: '0.85rem' }}
              />
              <button
                onClick={() => handleApplyRelayUrl()}
                className="btn-primary"
                style={{ whiteSpace: 'nowrap', padding: '0 16px', display: 'flex', alignItems: 'center', gap: '6px' }}
              >
                {saveSuccess ? <Check size={15} /> : <Save size={15} />}
                <span>{saveSuccess ? 'Saved!' : 'Save'}</span>
              </button>
            </div>
          </div>

          {/* Quick Switch Presets */}
          <div>
            <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginBottom: '8px', fontWeight: 600 }}>
              ⚡ 1-Click Quick Presets:
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '8px' }}>
              <button
                type="button"
                onClick={() => handleApplyRelayUrl('http://localhost:5001')}
                className="btn-secondary"
                style={{ padding: '8px 12px', fontSize: '0.78rem', textAlign: 'left', display: 'flex', alignItems: 'center', gap: '8px' }}
              >
                <Terminal size={14} color="var(--accent-cyan)" />
                <div>
                  <div style={{ fontWeight: 600 }}>Localhost</div>
                  <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>127.0.0.1:5001</div>
                </div>
              </button>

              <button
                type="button"
                onClick={() => handleApplyRelayUrl('http://172.20.10.2:5001')}
                className="btn-secondary"
                style={{ padding: '8px 12px', fontSize: '0.78rem', textAlign: 'left', display: 'flex', alignItems: 'center', gap: '8px' }}
              >
                <Smartphone size={14} color="#22c55e" />
                <div>
                  <div style={{ fontWeight: 600 }}>iPhone Hotspot</div>
                  <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>172.20.10.2:5001</div>
                </div>
              </button>

              <button
                type="button"
                onClick={() => handleApplyRelayUrl('http://10.80.79.100:5001')}
                className="btn-secondary"
                style={{ padding: '8px 12px', fontSize: '0.78rem', textAlign: 'left', display: 'flex', alignItems: 'center', gap: '8px' }}
              >
                <Wifi size={14} color="#eab308" />
                <div>
                  <div style={{ fontWeight: 600 }}>BMS Buildathon</div>
                  <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>10.80.79.100:5001</div>
                </div>
              </button>

              {terminalConfig.currentIp && terminalConfig.currentIp !== '10.80.79.100' && (
                <button
                  type="button"
                  onClick={() => handleApplyRelayUrl(`http://${terminalConfig.currentIp}:5001`)}
                  className="btn-secondary"
                  style={{ padding: '8px 12px', fontSize: '0.78rem', textAlign: 'left', display: 'flex', alignItems: 'center', gap: '8px' }}
                >
                  <Radio size={14} color="var(--accent-cyan)" />
                  <div>
                    <div style={{ fontWeight: 600 }}>Detected Local IP</div>
                    <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>{terminalConfig.currentIp}:5001</div>
                  </div>
                </button>
              )}
            </div>
          </div>

          {/* Diagnostics Box */}
          <div style={{
            background: 'rgba(0, 0, 0, 0.4)',
            border: '1px solid rgba(255, 255, 255, 0.08)',
            borderRadius: '12px',
            padding: '12px 16px',
            fontSize: '0.78rem',
            display: 'flex',
            flexDirection: 'column',
            gap: '6px'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--text-secondary)' }}>
              <span>Detected Host Machine IP:</span>
              <strong style={{ color: '#fff', fontFamily: 'var(--font-mono)' }}>{terminalConfig.currentIp || '10.80.79.100'}</strong>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--text-secondary)' }}>
              <span>MST Blockchain RPC:</span>
              <strong style={{ color: 'var(--accent-cyan)', fontFamily: 'var(--font-mono)' }}>MST Testnet (91562037)</strong>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--text-secondary)' }}>
              <span>Relay Signer Account:</span>
              <strong style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                {relayStatus.data?.terminalSignerAddress?.substring(0, 8)}...{relayStatus.data?.terminalSignerAddress?.substring(36)}
              </strong>
            </div>
          </div>
        </div>

        {/* Column 2: Terminal Hardware Wi-Fi Profile & Config */}
        <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: '18px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid rgba(255, 255, 255, 0.08)', paddingBottom: '14px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <Wifi size={18} color="var(--accent-cyan)" />
              <h3 style={{ fontSize: '1.05rem', fontWeight: 700, margin: 0 }}>
                2. Hardware Terminal Wi-Fi Profile
              </h3>
            </div>
            <button
              onClick={() => setShowAddPreset(!showAddPreset)}
              className="btn-secondary"
              style={{ padding: '4px 10px', fontSize: '0.72rem' }}
            >
              {showAddPreset ? 'Cancel' : '+ Add Network'}
            </button>
          </div>

          <p style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', margin: 0, lineHeight: '1.5' }}>
            Set the Wi-Fi credentials and Relay IP target for your ESP32 terminal. Saved to the relay and available for dynamic over-the-air sync.
          </p>

          {/* Add Preset Form (Conditional) */}
          {showAddPreset && (
            <form onSubmit={handleAddNewPreset} style={{
              background: 'rgba(0, 242, 254, 0.04)',
              border: '1px solid rgba(0, 242, 254, 0.2)',
              borderRadius: '12px',
              padding: '12px 14px',
              display: 'flex',
              flexDirection: 'column',
              gap: '10px'
            }}>
              <div style={{ fontSize: '0.78rem', fontWeight: 700, color: 'var(--accent-cyan)' }}>
                Add New Network to Presets:
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                <input
                  type="text"
                  placeholder="SSID (e.g. MyHotspot)"
                  value={newSsid}
                  onChange={(e) => setNewSsid(e.target.value)}
                  className="input-field"
                  style={{ fontSize: '0.78rem', padding: '8px 10px' }}
                  required
                />
                <input
                  type="password"
                  placeholder="Password"
                  value={newPass}
                  onChange={(e) => setNewPass(e.target.value)}
                  className="input-field"
                  style={{ fontSize: '0.78rem', padding: '8px 10px' }}
                />
              </div>
              <input
                type="text"
                placeholder="Description (e.g. Venue Booth #4)"
                value={newDesc}
                onChange={(e) => setNewDesc(e.target.value)}
                className="input-field"
                style={{ fontSize: '0.78rem', padding: '8px 10px' }}
              />
              <button type="submit" className="btn-primary" style={{ padding: '6px 12px', fontSize: '0.78rem' }}>
                Save Network Profile
              </button>
            </form>
          )}

          {/* Preset Buttons */}
          <div>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '8px', fontWeight: 600 }}>
              Select Known Network:
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
              {(terminalConfig.knownNetworks || []).map((net, idx) => (
                <button
                  key={idx}
                  type="button"
                  onClick={() => handleApplyPreset(net)}
                  className="btn-secondary"
                  style={{
                    padding: '6px 12px',
                    fontSize: '0.75rem',
                    background: ssidInput === net.ssid ? 'rgba(0, 242, 254, 0.15)' : undefined,
                    borderColor: ssidInput === net.ssid ? 'var(--accent-cyan)' : undefined
                  }}
                >
                  <Wifi size={12} />
                  <span>{net.ssid}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Edit Form */}
          <form onSubmit={handleSaveTerminalConfig} style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <div>
              <label style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', marginBottom: '6px', display: 'block' }}>
                Wi-Fi SSID (Network Name)
              </label>
              <input
                type="text"
                value={ssidInput}
                onChange={(e) => setSsidInput(e.target.value)}
                placeholder="e.g. BMS_Buildathon or Prit's iPhone"
                className="input-field"
                style={{ fontFamily: 'var(--font-mono)', fontSize: '0.85rem' }}
                required
              />
            </div>

            <div>
              <label style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', marginBottom: '6px', display: 'block' }}>
                Wi-Fi Password
              </label>
              <input
                type="text"
                value={passwordInput}
                onChange={(e) => setPasswordInput(e.target.value)}
                placeholder="Wi-Fi Password"
                className="input-field"
                style={{ fontFamily: 'var(--font-mono)', fontSize: '0.85rem' }}
              />
            </div>

            <div>
              <label style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', marginBottom: '6px', display: 'block' }}>
                ESP32 Target Relay URL <span style={{ color: 'var(--accent-cyan)' }}>(Port 5001 Mandatory)</span>
              </label>
              <input
                type="text"
                value={relayHostInput}
                onChange={(e) => setRelayHostInput(e.target.value)}
                placeholder="http://10.80.79.100:5001"
                className="input-field"
                style={{ fontFamily: 'var(--font-mono)', fontSize: '0.85rem' }}
                required
              />
            </div>

            <button
              type="submit"
              className="btn-primary"
              disabled={configSaveStatus?.saving}
              style={{ marginTop: '6px', padding: '10px 18px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}
            >
              <Save size={16} />
              <span>{configSaveStatus?.saving ? 'Saving...' : 'Publish Config to Relay Server'}</span>
            </button>

            {configSaveStatus && (
              <div style={{
                padding: '10px 14px',
                borderRadius: '8px',
                fontSize: '0.78rem',
                background: configSaveStatus.success ? 'rgba(34, 197, 94, 0.1)' : 'rgba(239, 68, 68, 0.1)',
                border: `1px solid ${configSaveStatus.success ? 'rgba(34, 197, 94, 0.4)' : 'rgba(239, 68, 68, 0.4)'}`,
                color: configSaveStatus.success ? '#86efac' : '#fca5a5'
              }}>
                {configSaveStatus.message}
              </div>
            )}
          </form>
        </div>
      </div>

      {/* Row 2: Over-The-Air Setup Guide & Copy-Paste Snippet */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(480px, 1fr))', gap: '24px' }}>
        
        {/* Card: Zero-Code Over-The-Air Wi-Fi Setup */}
        <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', borderBottom: '1px solid rgba(255, 255, 255, 0.08)', paddingBottom: '14px' }}>
            <Radio size={18} color="#22c55e" />
            <h3 style={{ fontSize: '1.05rem', fontWeight: 700, margin: 0 }}>
              3. Over-The-Air Setup (No USB Cable Needed)
            </h3>
          </div>

          <p style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', margin: 0, lineHeight: '1.5' }}>
            If you take the physical terminal to a new venue and it cannot find Wi-Fi, it automatically enters <strong>Access Point Config Mode</strong>:
          </p>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <div style={{
              display: 'flex',
              alignItems: 'flex-start',
              gap: '12px',
              padding: '10px 14px',
              background: 'rgba(255, 255, 255, 0.03)',
              borderRadius: '10px',
              border: '1px solid rgba(255, 255, 255, 0.06)'
            }}>
              <span className="badge badge-cyan" style={{ width: '22px', height: '22px', padding: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: '50%' }}>
                1
              </span>
              <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                Turn on the terminal. If Wi-Fi fails, the OLED displays:  
                <strong style={{ color: 'var(--accent-cyan)', display: 'block', marginTop: '3px' }}>
                  WIFI SETUP AP • 192.168.4.1
                </strong>
              </div>
            </div>

            <div style={{
              display: 'flex',
              alignItems: 'flex-start',
              gap: '12px',
              padding: '10px 14px',
              background: 'rgba(255, 255, 255, 0.03)',
              borderRadius: '10px',
              border: '1px solid rgba(255, 255, 255, 0.06)'
            }}>
              <span className="badge badge-cyan" style={{ width: '22px', height: '22px', padding: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: '50%' }}>
                2
              </span>
              <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                On your phone or laptop, connect to Wi-Fi:  
                <strong style={{ color: '#fff', display: 'block', marginTop: '3px', fontFamily: 'var(--font-mono)' }}>
                  SSID: MST-Terminal-Setup • Password: 12345678
                </strong>
              </div>
            </div>

            <div style={{
              display: 'flex',
              alignItems: 'flex-start',
              gap: '12px',
              padding: '10px 14px',
              background: 'rgba(255, 255, 255, 0.03)',
              borderRadius: '10px',
              border: '1px solid rgba(255, 255, 255, 0.06)'
            }}>
              <span className="badge badge-cyan" style={{ width: '22px', height: '22px', padding: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: '50%' }}>
                3
              </span>
              <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                Open your browser and navigate to:  
                <a
                  href="http://192.168.4.1"
                  target="_blank"
                  rel="noreferrer"
                  style={{ color: 'var(--accent-cyan)', textDecoration: 'none', fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: '4px', marginTop: '3px' }}
                >
                  <span>http://192.168.4.1</span>
                  <ExternalLink size={12} />
                </a>
                <div style={{ fontSize: '0.74rem', color: 'var(--text-muted)', marginTop: '2px' }}>
                  Select the venue Wi-Fi, enter the password and relay host, and click "Save & Reboot".
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Card: Arduino C++ Code Snippet */}
        <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid rgba(255, 255, 255, 0.08)', paddingBottom: '14px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <Terminal size={18} color="var(--accent-cyan)" />
              <h3 style={{ fontSize: '1.05rem', fontWeight: 700, margin: 0 }}>
                4. MultiSigTerminal.ino Code Snippet
              </h3>
            </div>
            <button
              onClick={handleCopyCode}
              className="btn-secondary"
              style={{ padding: '6px 12px', fontSize: '0.75rem', display: 'flex', alignItems: 'center', gap: '6px' }}
            >
              {copiedSnippet ? <Check size={14} color="#22c55e" /> : <Copy size={14} />}
              <span>{copiedSnippet ? 'Copied!' : 'Copy Code'}</span>
            </button>
          </div>

          <p style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', margin: 0 }}>
            If you ever re-flash in Arduino IDE, paste these 3 lines at line 36 of <code>MultiSigTerminal.ino</code>:
          </p>

          <pre style={{
            background: 'rgba(0, 0, 0, 0.75)',
            border: '1px solid rgba(0, 242, 254, 0.2)',
            borderRadius: '12px',
            padding: '16px',
            fontFamily: 'var(--font-mono)',
            fontSize: '0.82rem',
            color: '#a5f3fc',
            lineHeight: '1.6',
            overflowX: 'auto',
            margin: 0
          }}>
            {generatedCode}
          </pre>

          <div style={{ fontSize: '0.76rem', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <AlertCircle size={14} color="var(--accent-cyan)" style={{ flexShrink: 0 }} />
            <span>Ensure <code>:5001</code> is attached to the IP, otherwise ESP32 defaults to port 80!</span>
          </div>
        </div>
      </div>

    </div>
  );
}
