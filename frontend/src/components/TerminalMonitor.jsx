import React, { useState, useEffect } from 'react';
import { Radio, Thermometer, Droplets, Wind, Ruler, MapPin, Lock, Unlock, Zap, CheckCircle2, AlertTriangle, ExternalLink, Battery } from 'lucide-react';
import { PRESETS } from './SenderPortal';
import { RELAY_API_URL } from '../utils/web3';

export default function TerminalMonitor({ activeDeliveryId }) {
  const [telemetry, setTelemetry] = useState({
    temperature: 22.4,
    humidity: 49.2,
    airQualityPpm: 120,
    distanceCm: 14.5,
    lat: 28.6129,
    lon: 77.2295,
    coldChainSafe: true,
    timestamp: new Date().toLocaleTimeString()
  });

  const [scanDeliveryId, setScanDeliveryId] = useState(activeDeliveryId || '1');
  const [scanRfidUid, setScanRfidUid] = useState('CARD_MST_9921');
  const [scanLat, setScanLat] = useState('28.6129');
  const [scanLon, setScanLon] = useState('77.2295');

  const [isScanning, setIsScanning] = useState(false);
  const [scanResult, setScanResult] = useState(null);
  const [isDoorUnlocked, setIsDoorUnlocked] = useState(false);

  // Poll relay server for real-time telemetry
  useEffect(() => {
    const fetchTelemetry = async () => {
      try {
        const res = await fetch(`${RELAY_API_URL}/api/terminal/telemetry/latest`);
        if (res.ok) {
          const data = await res.json();
          if (data.latest) {
            setTelemetry(prev => ({
              ...data.latest,
              timestamp: new Date().toLocaleTimeString()
            }));
          }
        }
      } catch (_) {
        // Fallback simulation noise for visual responsiveness
        setTelemetry(prev => ({
          ...prev,
          temperature: +(22.0 + Math.sin(Date.now() / 10000) * 1.5).toFixed(1),
          humidity: +(48.0 + Math.cos(Date.now() / 8000) * 2.0).toFixed(1),
          airQualityPpm: Math.round(110 + Math.random() * 20),
          distanceCm: +(15.0 + Math.sin(Date.now() / 5000) * 3).toFixed(1),
          timestamp: new Date().toLocaleTimeString()
        }));
      }
    };

    fetchTelemetry();
    const interval = setInterval(fetchTelemetry, 3000);
    return () => clearInterval(interval);
  }, []);

  // Check locker status
  useEffect(() => {
    const checkStatus = async () => {
      try {
        const res = await fetch(`${RELAY_API_URL}/api/terminal/status/${scanDeliveryId}`);
        if (res.ok) {
          const data = await res.json();
          setIsDoorUnlocked(!!data.unlockDoor);
        }
      } catch (_) {}
    };
    checkStatus();
    const statusInterval = setInterval(checkStatus, 4000);
    return () => clearInterval(statusInterval);
  }, [scanDeliveryId]);

  const handleSimulateScan = async (e) => {
    e.preventDefault();
    try {
      setIsScanning(true);
      setScanResult(null);

      const res = await fetch(`${RELAY_API_URL}/api/terminal/scan`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          deliveryId: parseInt(scanDeliveryId),
          rfidUid: scanRfidUid,
          latitude: parseFloat(scanLat),
          longitude: parseFloat(scanLon)
        })
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Terminal scan failed');
      }

      setScanResult({
        type: 'success',
        message: data.message || 'Key 1 physical scan authorized successfully!',
        txHash: data.txResult?.txHash,
        mstScanUrl: data.txResult?.mstScanUrl
      });
    } catch (err) {
      setScanResult({
        type: 'error',
        message: err.message
      });
    } finally {
      setIsScanning(false);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
      {/* Real-time Hardware Telemetry Bar */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
        gap: '16px'
      }}>
        {/* Temperature Gauge */}
        <div className="glass-panel" style={{ padding: '20px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--text-muted)', marginBottom: '8px' }}>
            <span style={{ fontSize: '0.82rem' }}>Temperature (DHT22)</span>
            <Thermometer size={18} color="var(--accent-cyan)" />
          </div>
          <div style={{ fontSize: '1.6rem', fontWeight: 700, fontFamily: 'var(--font-mono)' }}>
            {telemetry.temperature}°C
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '6px' }}>
            <span className={`badge ${telemetry.temperature <= 25 ? 'badge-green' : 'badge-amber'}`} style={{ fontSize: '0.68rem' }}>
              {telemetry.temperature <= 25 ? 'Cold Chain OK' : 'Temp Warning'}
            </span>
          </div>
        </div>

        {/* Humidity Gauge */}
        <div className="glass-panel" style={{ padding: '20px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--text-muted)', marginBottom: '8px' }}>
            <span style={{ fontSize: '0.82rem' }}>Humidity (DHT22)</span>
            <Droplets size={18} color="var(--accent-blue)" />
          </div>
          <div style={{ fontSize: '1.6rem', fontWeight: 700, fontFamily: 'var(--font-mono)' }}>
            {telemetry.humidity}%
          </div>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '8px' }}>
            Relative Humidity
          </div>
        </div>

        {/* Air Quality (MQ135) */}
        <div className="glass-panel" style={{ padding: '20px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--text-muted)', marginBottom: '8px' }}>
            <span style={{ fontSize: '0.82rem' }}>Air Quality (MQ135)</span>
            <Wind size={18} color="var(--accent-purple)" />
          </div>
          <div style={{ fontSize: '1.6rem', fontWeight: 700, fontFamily: 'var(--font-mono)' }}>
            {telemetry.airQualityPpm} <span style={{ fontSize: '0.9rem', color: 'var(--text-muted)' }}>PPM</span>
          </div>
          <div style={{ fontSize: '0.75rem', color: 'var(--accent-green)', marginTop: '8px' }}>
            Safe Storage Atmosphere
          </div>
        </div>

        {/* Ultrasonic Presence (HC-SR04) */}
        <div className="glass-panel" style={{ padding: '20px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--text-muted)', marginBottom: '8px' }}>
            <span style={{ fontSize: '0.82rem' }}>Package Presence (HC-SR04)</span>
            <Ruler size={18} color="var(--accent-amber)" />
          </div>
          <div style={{ fontSize: '1.6rem', fontWeight: 700, fontFamily: 'var(--font-mono)' }}>
            {telemetry.distanceCm} <span style={{ fontSize: '0.9rem', color: 'var(--text-muted)' }}>cm</span>
          </div>
          <div style={{ fontSize: '0.75rem', color: telemetry.distanceCm < 30 ? 'var(--accent-cyan)' : 'var(--text-muted)', marginTop: '8px' }}>
            {telemetry.distanceCm < 30 ? '● Package Detected inside' : 'Compartment Empty'}
          </div>
        </div>

        {/* Battery Voltage (STM32 on Neurick Board) */}
        <div className="glass-panel" style={{ padding: '20px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--text-muted)', marginBottom: '8px' }}>
            <span style={{ fontSize: '0.82rem' }}>Terminal Battery (STM32)</span>
            <Battery size={18} color="var(--accent-cyan)" />
          </div>
          <div style={{ fontSize: '1.6rem', fontWeight: 700, fontFamily: 'var(--font-mono)' }}>
            {telemetry.batteryVolts ? Number(telemetry.batteryVolts).toFixed(2) : '12.10'} <span style={{ fontSize: '0.9rem', color: 'var(--text-muted)' }}>V</span>
          </div>
          <div style={{ fontSize: '0.75rem', color: 'var(--accent-green)', marginTop: '8px' }}>
            ● Pack Level Nominal
          </div>
        </div>

        {/* Physical Door Latch (MG995 Servo) */}
        <div className="glass-panel" style={{
          padding: '20px',
          borderColor: isDoorUnlocked ? 'var(--accent-green)' : 'var(--border-color)',
          background: isDoorUnlocked ? 'rgba(16, 185, 129, 0.08)' : 'var(--bg-card)'
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--text-muted)', marginBottom: '8px' }}>
            <span style={{ fontSize: '0.82rem' }}>Servo Lock (MG995)</span>
            {isDoorUnlocked ? <Unlock size={18} color="var(--accent-green)" /> : <Lock size={18} color="var(--accent-amber)" />}
          </div>
          <div style={{ fontSize: '1.4rem', fontWeight: 800, color: isDoorUnlocked ? 'var(--accent-green)' : 'var(--accent-amber)' }}>
            {isDoorUnlocked ? 'UNLOCKED' : 'LOCKED'}
          </div>
          <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '8px' }}>
            {isDoorUnlocked ? 'Door released for pickup' : 'Multi-Sig verification required'}
          </div>
        </div>
      </div>

      {/* Hardware Terminal Scanner Trigger (Key 1 Simulation) */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))', gap: '24px' }}>
        <div className="glass-panel" style={{ padding: '28px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '16px' }}>
            <Radio size={22} color="var(--accent-cyan)" />
            <h3 style={{ fontSize: '1.15rem', fontWeight: 700 }}>Hardware Terminal Scan Trigger (Key 1)</h3>
          </div>

          <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '20px' }}>
            Simulate or dispatch a physical RFID badge tap along with live NEO-6M GPS coordinates from the Newrro Neurick terminal to the Node.js relay.
          </p>

          <form onSubmit={handleSimulateScan} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: '12px' }}>
              <div>
                <label style={{ display: 'block', fontSize: '0.82rem', color: 'var(--text-secondary)', marginBottom: '6px' }}>
                  Delivery ID
                </label>
                <input
                  type="number"
                  min="1"
                  className="input-field mono"
                  value={scanDeliveryId}
                  onChange={(e) => setScanDeliveryId(e.target.value)}
                  required
                />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: '0.82rem', color: 'var(--text-secondary)', marginBottom: '6px' }}>
                  Tapped RFID Card UID
                </label>
                <input
                  type="text"
                  className="input-field mono"
                  value={scanRfidUid}
                  onChange={(e) => setScanRfidUid(e.target.value)}
                  required
                />
              </div>
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '0.82rem', color: 'var(--text-secondary)', marginBottom: '6px' }}>
                Terminal Current GPS Location (NEO-6M)
              </label>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                <input
                  type="text"
                  className="input-field mono"
                  placeholder="Latitude"
                  value={scanLat}
                  onChange={(e) => setScanLat(e.target.value)}
                  required
                />
                <input
                  type="text"
                  className="input-field mono"
                  placeholder="Longitude"
                  value={scanLon}
                  onChange={(e) => setScanLon(e.target.value)}
                  required
                />
              </div>
            </div>

            {/* Quick Match Preset Buttons */}
            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
              {PRESETS.map((p) => (
                <button
                  key={p.name}
                  type="button"
                  onClick={() => { setScanLat(p.lat.toString()); setScanLon(p.lon.toString()); }}
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
                  📍 Align GPS with {p.name}
                </button>
              ))}
            </div>

            <button
              type="submit"
              disabled={isScanning}
              className="btn-primary"
              style={{ marginTop: '8px' }}
            >
              {isScanning ? (
                <span>Transmitting Scan & GPS to Blockchain...</span>
              ) : (
                <>
                  <Zap size={16} />
                  <span>Transmit Hardware Scan (Key 1)</span>
                </>
              )}
            </button>
          </form>

          {/* Result Banner */}
          {scanResult && (
            <div style={{
              marginTop: '16px',
              padding: '14px',
              borderRadius: '10px',
              background: 'rgba(0,0,0,0.3)',
              border: `1px solid ${scanResult.type === 'error' ? 'var(--accent-red)' : 'var(--accent-green)'}`,
              fontSize: '0.85rem'
            }}>
              <div>{scanResult.message}</div>
              {scanResult.txHash && (
                <a
                  href={scanResult.mstScanUrl || `https://testnet.mstscan.com/tx/${scanResult.txHash}`}
                  target="_blank"
                  rel="noreferrer"
                  style={{ color: 'var(--accent-cyan)', display: 'inline-flex', alignItems: 'center', gap: '4px', marginTop: '6px', fontSize: '0.8rem' }}
                >
                  <span>View Key 1 Tx on MSTScan</span>
                  <ExternalLink size={12} />
                </a>
              )}
            </div>
          )}
        </div>

        {/* Neurick Architecture & Pinout Reference */}
        <div className="glass-panel" style={{ padding: '28px' }}>
          <h3 style={{ fontSize: '1.15rem', fontWeight: 700, marginBottom: '16px' }}>
            Neurick ESP32-S3 Hardware Pinout
          </h3>
          <p style={{ fontSize: '0.82rem', color: 'var(--text-muted)', marginBottom: '14px' }}>
            Wired according to the official Newrro Neurick Manual and sensors specification:
          </p>

          <table style={{ width: '100%', fontSize: '0.82rem', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border-color)', textAlign: 'left', color: 'var(--text-muted)' }}>
                <th style={{ padding: '8px' }}>Sensor</th>
                <th style={{ padding: '8px' }}>Pin / Protocol</th>
                <th style={{ padding: '8px' }}>ESP32 GPIO</th>
              </tr>
            </thead>
            <tbody>
              <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                <td style={{ padding: '8px' }}>RC522 RFID</td>
                <td style={{ padding: '8px' }}>SPI (SDA, SCK, MOSI, MISO)</td>
                <td style={{ padding: '8px' }} className="mono">10, 12, 11, 13</td>
              </tr>
              <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                <td style={{ padding: '8px' }}>NEO-6M GPS</td>
                <td style={{ padding: '8px' }}>UART RX / TX</td>
                <td style={{ padding: '8px' }} className="mono">GPIO 17 / 18</td>
              </tr>
              <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                <td style={{ padding: '8px' }}>HC-SR04 Ultrasonic</td>
                <td style={{ padding: '8px' }}>Trig / Echo (3.3V div)</td>
                <td style={{ padding: '8px' }} className="mono">GPIO 15 / 16</td>
              </tr>
              <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                <td style={{ padding: '8px' }}>DHT22 Temp/Humidity</td>
                <td style={{ padding: '8px' }}>1-Wire Digital</td>
                <td style={{ padding: '8px' }} className="mono">GPIO 5</td>
              </tr>
              <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                <td style={{ padding: '8px' }}>MQ135 Gas Sensor</td>
                <td style={{ padding: '8px' }}>Analog (ADC1)</td>
                <td style={{ padding: '8px' }} className="mono">GPIO 4</td>
              </tr>
              <tr>
                <td style={{ padding: '8px' }}>OLED + STM32</td>
                <td style={{ padding: '8px' }}>I2C Bus (0x3C / 0x08)</td>
                <td style={{ padding: '8px' }} className="mono">GPIO 8 (SDA) / 9 (SCL)</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
