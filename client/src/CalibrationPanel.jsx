import { useState, useEffect } from 'react'

// ─── Format helpers matching X-talk spec ──────────────────────────────────
// Weight: XXX.XXX in kg  (e.g. 0.41 → "000.410",  5 → "005.000")
function fmtKg(val) {
  const n = parseFloat(val)
  if (isNaN(n) || n < 0 || n > 200) return null
  const whole = Math.floor(n)
  const frac = Math.round((n - whole) * 1000)
  return `${String(whole).padStart(3, '0')}.${String(frac).padStart(3, '0')}`
}

// Count: XXX  (e.g. 17 → "017")
function fmtCount(val, min = 0, max = 999) {
  const n = parseInt(val, 10)
  if (isNaN(n) || n < min || n > max) return null
  return String(n).padStart(3, '0')
}

const OUTPUT_MODES = [
  { value: '1', label: 'Pick-up only' },
  { value: '2', label: 'Pick-up + stock (incremental)' },
  { value: '3', label: 'Pick-up + stock (absolute) — default' },
  { value: '4', label: 'Stock incremental only' },
  { value: '5', label: 'Stock absolute only' },
  { value: '6', label: 'Weight measurement' },
  { value: '7', label: 'No triggers — data requests only' },
]

// ─── Small reusable pieces ─────────────────────────────────────────────────
function SectionHeader({ children }) {
  return (
    <div style={{
      fontSize: 10, fontWeight: 700, letterSpacing: '0.1em',
      textTransform: 'uppercase', color: '#64748b',
      marginBottom: 10, paddingBottom: 6,
      borderBottom: '1px solid rgba(255,255,255,0.06)',
    }}>
      {children}
    </div>
  )
}

function Row({ children }) {
  return <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8, flexWrap: 'wrap' }}>{children}</div>
}

function Label({ children }) {
  return <span style={{ fontSize: 12, color: '#94a3b8', minWidth: 180 }}>{children}</span>
}

function Input({ value, onChange, placeholder, width = 100, type = 'text' }) {
  return (
    <input
      type={type}
      value={value}
      onChange={e => onChange(e.target.value)}
      placeholder={placeholder}
      style={{
        width, padding: '5px 10px', fontSize: 12,
        background: 'rgba(0,0,0,0.4)',
        border: '1px solid rgba(255,255,255,0.15)',
        borderRadius: 6, color: '#e2e8f0',
        fontFamily: 'monospace', outline: 'none',
      }}
    />
  )
}

function Btn({ onClick, children, color = '#334155', disabled = false, danger = false }) {
  const bg = danger ? 'rgba(239,68,68,0.2)' : color
  const border = danger ? '1px solid rgba(239,68,68,0.4)' : '1px solid rgba(255,255,255,0.1)'
  const textColor = danger ? '#f87171' : '#e2e8f0'
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        padding: '5px 14px', fontSize: 12, fontWeight: 600,
        background: disabled ? 'rgba(255,255,255,0.05)' : bg,
        border, borderRadius: 6,
        color: disabled ? '#475569' : textColor,
        cursor: disabled ? 'not-allowed' : 'pointer',
        whiteSpace: 'nowrap',
        transition: 'opacity 0.15s',
      }}
    >
      {children}
    </button>
  )
}

function StatusBadge({ status }) {
  if (!status) return null
  const styles = {
    pending: { bg: 'rgba(251,191,36,0.15)', color: '#fbbf24', text: '⏳ Waiting for sensor...' },
    done:    { bg: 'rgba(74,222,128,0.15)', color: '#4ade80', text: '✓ Calibration confirmed' },
    error:   { bg: 'rgba(248,113,113,0.15)', color: '#f87171', text: '✗ No serial connection' },
    sent:    { bg: 'rgba(56,189,248,0.15)', color: '#38bdf8', text: '✓ Command sent' },
  }
  const s = styles[status] || styles.sent
  return (
    <span style={{
      fontSize: 11, padding: '3px 10px', borderRadius: 20,
      background: s.bg, color: s.color, fontWeight: 600,
    }}>
      {s.text}
    </span>
  )
}

// ─── Main component ────────────────────────────────────────────────────────
export default function CalibrationPanel({ serialConnected, lastCalibDone, theme }) {
  const [open, setOpen] = useState(false)
  const [address, setAddress] = useState('001')

  // Per-section status
  const [baseStatus, setBaseStatus]   = useState(null)
  const [weightStatus, setWeightStatus] = useState(null)
  const [itemStatus, setItemStatus]   = useState(null)
  const [stockStatus, setStockStatus] = useState(null)
  const [settingStatus, setSettingStatus] = useState(null)

  // Inputs
  const [knownKg, setKnownKg]           = useState('')
  const [itemKg, setItemKg]             = useState('')
  const [measureCount, setMeasureCount] = useState('')
  const [stockCount, setStockCount]     = useState('')
  const [outputMode, setOutputMode]     = useState('3')
  const [pickupSens, setPickupSens]     = useState('15')
  const [sampleAvg, setSampleAvg]       = useState('4')
  const [maxDev, setMaxDev]             = useState('10')

  // When CALIBRATION=DONE comes back, light up whichever section is pending
  useEffect(() => {
    if (!lastCalibDone) return
    if (baseStatus === 'pending')   setBaseStatus('done')
    if (weightStatus === 'pending') setWeightStatus('done')
    if (itemStatus === 'pending')   setItemStatus('done')
  }, [lastCalibDone]) // eslint-disable-line react-hooks/exhaustive-deps

  const addr = `X${address.padStart(3, '0')}`

  async function send(message) {
    if (!serialConnected) return 'error'
    try {
      const res = await fetch('/command', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message }),
      })
      const data = await res.json()
      return data.ok ? 'sent' : 'error'
    } catch {
      return 'error'
    }
  }

  async function handleBase() {
    setBaseStatus('pending')
    const result = await send(`${addr}B[CALIBRATE=BASE]`)
    if (result === 'error') setBaseStatus('error')
    // stays 'pending' until CALIBRATION=DONE arrives via WS
  }

  async function handleWeightCalib() {
    const kg = fmtKg(knownKg)
    if (!kg) return
    setWeightStatus('pending')
    const result = await send(`${addr}B[CALIBRATE=${kg}]`)
    if (result === 'error') setWeightStatus('error')
  }

  async function handleItemWeight() {
    const kg = fmtKg(itemKg)
    if (!kg) return
    setItemStatus('pending')
    const result = await send(`${addr}B[ITEMWEIGHT=${kg}]`)
    if (result === 'error') setItemStatus('error')
    else setItemStatus('sent')
  }

  async function handleStockMeasure() {
    const n = fmtCount(measureCount, 1, 999)
    if (!n) return
    setItemStatus('pending')
    const result = await send(`${addr}B[STOCKMEASURE=${n}]`)
    if (result === 'error') setItemStatus('error')
    // stays pending until CALIBRATION=DONE
  }

  async function handleStockSet() {
    const n = fmtCount(stockCount, 0, 999)
    if (!n && n !== '000') return
    const result = await send(`${addr}B[STOCKSET=${fmtCount(stockCount, 0, 999)}]`)
    setStockStatus(result)
    setTimeout(() => setStockStatus(null), 3000)
  }

  async function handleOutputMode() {
    const result = await send(`${addr}S[4:${outputMode}]`)
    setSettingStatus(result)
    setTimeout(() => setSettingStatus(null), 3000)
  }

  async function handleSetting(settingNum, value) {
    const n = parseInt(value, 10)
    if (isNaN(n)) return
    const result = await send(`${addr}S[${settingNum}:${n}]`)
    setSettingStatus(result)
    setTimeout(() => setSettingStatus(null), 3000)
  }

  async function handleRecallStock() {
    const result = await send(`${addr}B[RECALL=STOCK]`)
    setStockStatus(result)
    setTimeout(() => setStockStatus(null), 3000)
  }

  async function handleStoreStock() {
    const result = await send(`${addr}B[STORE=STOCK]`)
    setStockStatus(result)
    setTimeout(() => setStockStatus(null), 3000)
  }

  async function handleRequestStock() {
    const result = await send(`${addr}B[STOCK?]`)
    setStockStatus(result)
    setTimeout(() => setStockStatus(null), 3000)
  }

  const connWarning = !serialConnected && (
    <div style={{
      padding: '6px 12px', borderRadius: 6, marginBottom: 12,
      background: 'rgba(251,191,36,0.1)',
      border: '1px solid rgba(251,191,36,0.3)',
      color: '#fbbf24', fontSize: 11,
    }}>
      Hardware not connected — commands will fail. Use the Simulation panel to test instead.
    </div>
  )

  return (
    <div style={{
      margin: '16px 24px 0',
      background: 'rgba(0,0,0,0.3)',
      border: '1px solid rgba(255,255,255,0.08)',
      borderRadius: 12,
      overflow: 'hidden',
    }}>
      {/* Header */}
      <div
        onClick={() => setOpen(o => !o)}
        style={{
          padding: '10px 16px',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          cursor: 'pointer', userSelect: 'none',
          fontSize: 12, fontWeight: 600, letterSpacing: '0.08em',
          textTransform: 'uppercase', color: '#94a3b8',
        }}
      >
        <span>Sensor Calibration &amp; Settings</span>
        <span style={{ fontSize: 16 }}>{open ? '▲' : '▼'}</span>
      </div>

      {open && (
        <div style={{ padding: '14px 16px 18px', borderTop: '1px solid rgba(255,255,255,0.06)' }}>
          {connWarning}

          {/* Sensor address */}
          <Row>
            <Label>Sensor X-talk address</Label>
            <Input value={address} onChange={setAddress} placeholder="001" width={60} />
            <span style={{ fontSize: 11, color: '#475569' }}>→ commands sent to {addr}B[...]</span>
          </Row>

          <div style={{ height: 16 }} />

          {/* ── Step 1: Base Calibrate ── */}
          <SectionHeader>Step 1 — Base Calibrate (Tare)</SectionHeader>
          <div style={{ fontSize: 12, color: '#64748b', marginBottom: 8 }}>
            Remove <strong style={{ color: '#94a3b8' }}>all items</strong> from the shelf, then send. The sensor zeroes its baseline.
          </div>
          <Row>
            <Btn onClick={handleBase} disabled={!serialConnected}>
              Send {addr}B[CALIBRATE=BASE]
            </Btn>
            <StatusBadge status={baseStatus} />
          </Row>

          <div style={{ height: 14 }} />

          {/* ── Step 2: Weight Calibrate ── */}
          <SectionHeader>Step 2 — Weight Calibrate (optional but recommended)</SectionHeader>
          <div style={{ fontSize: 12, color: '#64748b', marginBottom: 8 }}>
            Place an object of <strong style={{ color: '#94a3b8' }}>known weight (5–10 kg preferred)</strong> on the shelf, enter its exact weight, then send.
          </div>
          <Row>
            <Label>Known weight (kg)</Label>
            <Input value={knownKg} onChange={setKnownKg} placeholder="5.000" width={90} type="number" />
            <Btn onClick={handleWeightCalib} disabled={!serialConnected || !fmtKg(knownKg)}>
              Send {addr}B[CALIBRATE={fmtKg(knownKg) || '???'}]
            </Btn>
            <StatusBadge status={weightStatus} />
          </Row>

          <div style={{ height: 14 }} />

          {/* ── Item Weight Setup ── */}
          <SectionHeader>Item Weight Setup (required for stock count)</SectionHeader>
          <div style={{ fontSize: 12, color: '#64748b', marginBottom: 10 }}>
            Tell the sensor how much one stocked item weighs — either manually or by letting the sensor measure a known quantity.
          </div>

          <Row>
            <Label>Manual — item weight (kg)</Label>
            <Input value={itemKg} onChange={setItemKg} placeholder="0.410" width={90} type="number" />
            <Btn onClick={handleItemWeight} disabled={!serialConnected || !fmtKg(itemKg)}>
              Send {addr}B[ITEMWEIGHT={fmtKg(itemKg) || '???'}]
            </Btn>
          </Row>

          <div style={{ fontSize: 11, color: '#475569', margin: '4px 0 8px 188px' }}>— or —</div>

          <Row>
            <Label>Auto-measure — items on shelf</Label>
            <Input value={measureCount} onChange={setMeasureCount} placeholder="14" width={60} type="number" />
            <Btn onClick={handleStockMeasure} disabled={!serialConnected || !fmtCount(measureCount, 1, 999)}>
              Send {addr}B[STOCKMEASURE={fmtCount(measureCount, 1, 999) || '???'}]
            </Btn>
          </Row>
          <div style={{ marginTop: 4 }}>
            <StatusBadge status={itemStatus} />
          </div>

          <div style={{ height: 14 }} />

          {/* ── Stock Level ── */}
          <SectionHeader>Stock Level Management</SectionHeader>

          <Row>
            <Label>Set current stock count</Label>
            <Input value={stockCount} onChange={setStockCount} placeholder="17" width={60} type="number" />
            <Btn onClick={handleStockSet} disabled={!serialConnected || fmtCount(stockCount, 0, 999) === null}>
              Send {addr}B[STOCKSET={fmtCount(stockCount, 0, 999) ?? '???'}]
            </Btn>
          </Row>
          <Row>
            <Label>Request current stock from sensor</Label>
            <Btn onClick={handleRequestStock} disabled={!serialConnected}>
              Send {addr}B[STOCK?]
            </Btn>
          </Row>
          <Row>
            <Label>Store stock to sensor memory</Label>
            <Btn onClick={handleStoreStock} disabled={!serialConnected}>
              Send {addr}B[STORE=STOCK]
            </Btn>
            <Btn onClick={handleRecallStock} disabled={!serialConnected}>
              Send {addr}B[RECALL=STOCK]
            </Btn>
          </Row>
          <div style={{ marginTop: 4 }}>
            <StatusBadge status={stockStatus} />
          </div>

          <div style={{ height: 14 }} />

          {/* ── Sensor Settings ── */}
          <SectionHeader>Sensor Settings (reset on power cycle)</SectionHeader>

          <Row>
            <Label>Output mode</Label>
            <select
              value={outputMode}
              onChange={e => setOutputMode(e.target.value)}
              style={{
                padding: '5px 10px', fontSize: 12,
                background: 'rgba(0,0,0,0.4)',
                border: '1px solid rgba(255,255,255,0.15)',
                borderRadius: 6, color: '#e2e8f0', outline: 'none',
              }}
            >
              {OUTPUT_MODES.map(m => (
                <option key={m.value} value={m.value}>{m.label}</option>
              ))}
            </select>
            <Btn onClick={handleOutputMode} disabled={!serialConnected}>
              Apply {addr}S[4:{outputMode}]
            </Btn>
          </Row>

          <Row>
            <Label>
              Pick-up sensitivity (g)
              <div style={{ fontSize: 10, color: '#475569' }}>min weight diff to trigger pickup · 1–250 · default 15</div>
            </Label>
            <Input value={pickupSens} onChange={setPickupSens} placeholder="15" width={60} type="number" />
            <Btn onClick={() => handleSetting(10, pickupSens)} disabled={!serialConnected}>
              Apply {addr}S[10:{pickupSens || '?'}]
            </Btn>
          </Row>

          <Row>
            <Label>
              Sample averaging
              <div style={{ fontSize: 10, color: '#475569' }}>1–100 · higher = more stable, less responsive · default 4</div>
            </Label>
            <Input value={sampleAvg} onChange={setSampleAvg} placeholder="4" width={60} type="number" />
            <Btn onClick={() => handleSetting(7, sampleAvg)} disabled={!serialConnected}>
              Apply {addr}S[7:{sampleAvg || '?'}]
            </Btn>
          </Row>

          <Row>
            <Label>
              Max weight deviation between samples (g)
              <div style={{ fontSize: 10, color: '#475569' }}>1–50 · higher = more responsive, less accurate · default 10</div>
            </Label>
            <Input value={maxDev} onChange={setMaxDev} placeholder="10" width={60} type="number" />
            <Btn onClick={() => handleSetting(5, maxDev)} disabled={!serialConnected}>
              Apply {addr}S[5:{maxDev || '?'}]
            </Btn>
          </Row>

          <div style={{ marginTop: 6 }}>
            <StatusBadge status={settingStatus} />
          </div>
        </div>
      )}
    </div>
  )
}
