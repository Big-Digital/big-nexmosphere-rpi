import { useState, useEffect, useRef, useCallback } from 'react'
import { io } from 'socket.io-client'

// ─── Theme config per shelf state ─────────────────────────────────────────
const THEMES = {
  IDLE: {
    bg: '#0f172a',
    panelBg: '#1e293b',
    accent: '#38bdf8',
    accentDim: '#0c4a6e',
    text: '#e2e8f0',
    subtext: '#94a3b8',
    label: 'MONITORING',
    description: 'Shelf is idle — waiting for activity',
    badge: '#1d4ed8',
    badgeText: '#bfdbfe',
  },
  PICKUP: {
    bg: '#450a0a',
    panelBg: '#7f1d1d',
    accent: '#f87171',
    accentDim: '#7f1d1d',
    text: '#fef2f2',
    subtext: '#fca5a5',
    label: 'ITEM PICKED UP',
    description: 'Item has been lifted from the shelf',
    badge: '#991b1b',
    badgeText: '#fee2e2',
  },
  RETURNED: {
    bg: '#052e16',
    panelBg: '#14532d',
    accent: '#4ade80',
    accentDim: '#14532d',
    text: '#f0fdf4',
    subtext: '#86efac',
    label: 'ITEM RETURNED',
    description: 'Item has been placed back on the shelf',
    badge: '#166534',
    badgeText: '#bbf7d0',
  },
}

// ─── Audio cues ───────────────────────────────────────────────────────────
function playPickupSound(ctx) {
  if (!ctx) return
  const now = ctx.currentTime
  // Two-tone descending alert: high → mid → silence
  const freqs = [880, 660]
  freqs.forEach((freq, i) => {
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.connect(gain)
    gain.connect(ctx.destination)
    osc.type = 'sine'
    osc.frequency.setValueAtTime(freq, now + i * 0.18)
    gain.gain.setValueAtTime(0.45, now + i * 0.18)
    gain.gain.exponentialRampToValueAtTime(0.001, now + i * 0.18 + 0.22)
    osc.start(now + i * 0.18)
    osc.stop(now + i * 0.18 + 0.25)
  })
}

function playReturnSound(ctx) {
  if (!ctx) return
  const now = ctx.currentTime
  // Three-note ascending chime: C5 → E5 → G5
  const notes = [523.25, 659.25, 783.99]
  notes.forEach((freq, i) => {
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.connect(gain)
    gain.connect(ctx.destination)
    osc.type = 'sine'
    osc.frequency.setValueAtTime(freq, now + i * 0.15)
    gain.gain.setValueAtTime(0.38, now + i * 0.15)
    gain.gain.exponentialRampToValueAtTime(0.001, now + i * 0.15 + 0.3)
    osc.start(now + i * 0.15)
    osc.stop(now + i * 0.15 + 0.35)
  })
}


// ─── Helpers ──────────────────────────────────────────────────────────────
function fmtTime(iso) {
  if (!iso) return '—'
  const d = new Date(iso)
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })
}

function fmtMs(iso) {
  if (!iso) return '—'
  return new Date(iso).toISOString().replace('T', ' ').slice(0, 23)
}

const TYPE_COLORS = {
  PICKUP:            ['#7f1d1d', '#fca5a5'],
  RETURNED:          ['#14532d', '#86efac'],
  STOCKCHANGE:       ['#1e3a5f', '#93c5fd'],
  STOCK:             ['#1e293b', '#94a3b8'],
  WEIGHT:            ['#2d1b69', '#c4b5fd'],
  ANOMALY_DETECTED:  ['#78350f', '#fdba74'],
  ANOMALY_CLEARED:   ['#14532d', '#86efac'],
  CALIBRATION_DONE:  ['#134e4a', '#5eead4'],
  UNKNOWN:           ['#374151', '#9ca3af'],
}

// ─── Simulation quick-send presets ────────────────────────────────────────
const SIM_PRESETS = [
  { label: 'PICKUP',             msg: 'X001B[PICKUP]',            color: '#7f1d1d' },
  { label: 'STOCK +1 (Return)',  msg: 'X001B[STOCKCHANGE=+01]',   color: '#14532d' },
  { label: 'STOCK -1',          msg: 'X001B[STOCKCHANGE=-01]',   color: '#1e3a5f' },
  { label: 'STOCK ABS = 017',   msg: 'X001B[STOCK=017]',         color: '#1e293b' },
  { label: 'WEIGHT 1.500 kg',   msg: 'X001B[WEIGHT=+001.500]',   color: '#2d1b69' },
  { label: 'CALIBRATION DONE',  msg: 'X001B[CALIBRATION=DONE]',  color: '#1c4532' },
]

// ─── Main component ───────────────────────────────────────────────────────
export default function App() {
  const [shelfState, setShelfState] = useState('IDLE')
  const [events, setEvents] = useState([])
  const [stockCount, setStockCount] = useState(null)
  const [weightKg, setWeightKg] = useState(null)
  const [lastEvent, setLastEvent] = useState(null)
  const [serialStatus, setSerialStatus] = useState({ connected: false })
  const [wsConnected, setWsConnected] = useState(false)
  const [simInput, setSimInput] = useState('')
  const [simOpen, setSimOpen] = useState(true)
  const [logFilter, setLogFilter] = useState('ALL')
  const [flashKey, setFlashKey] = useState(0)

  const audioCtxRef = useRef(null)
  const logEndRef = useRef(null)
  const autoScrollRef = useRef(true)
  const prevStateRef = useRef('IDLE')

  // Init audio context on first user interaction
  const ensureAudio = useCallback(() => {
    if (!audioCtxRef.current) {
      audioCtxRef.current = new (window.AudioContext || window.webkitAudioContext)()
    }
    if (audioCtxRef.current.state === 'suspended') {
      audioCtxRef.current.resume()
    }
  }, [])

  // Play audio + flash when state changes
  useEffect(() => {
    if (shelfState === prevStateRef.current) return
    prevStateRef.current = shelfState
    setFlashKey(k => k + 1)

    ensureAudio()
    const ctx = audioCtxRef.current
    if (shelfState === 'PICKUP') playPickupSound(ctx)
    else if (shelfState === 'RETURNED') playReturnSound(ctx)
  }, [shelfState, ensureAudio])

  // Auto-scroll log
  useEffect(() => {
    if (autoScrollRef.current && logEndRef.current) {
      logEndRef.current.scrollIntoView({ behavior: 'smooth' })
    }
  }, [events])

  // Enrich and prepend event
  const addEvent = useCallback((event) => {
    setEvents(prev => {
      // Deduplicate by raw + timestamp
      if (prev.length && prev[prev.length - 1].raw === event.raw &&
          prev[prev.length - 1].timestamp === event.timestamp) return prev
      return [...prev.slice(-499), event]
    })
    setLastEvent(event)

    if (event.type === 'STOCK' && event.stock_count != null) setStockCount(event.stock_count)
    if (event.type === 'STOCKCHANGE') {
      setStockCount(prev => prev != null ? prev + event.stock_change : null)
    }
    if (event.type === 'WEIGHT') setWeightKg(event.weight_kg)
  }, [])

  // Socket.io connection
  useEffect(() => {
    const socket = io('/', { transports: ['websocket', 'polling'] })

    socket.on('connect', () => setWsConnected(true))
    socket.on('disconnect', () => setWsConnected(false))

    socket.on('serial_status', (s) => setSerialStatus(s))

    socket.on('history', (items) => {
      setEvents(items.slice(-200))
      const lastStock = [...items].reverse().find(e => e.type === 'STOCK')
      const lastWeight = [...items].reverse().find(e => e.type === 'WEIGHT')
      if (lastStock) setStockCount(lastStock.stock_count)
      if (lastWeight) setWeightKg(lastWeight.weight_kg)
    })

    socket.on('sensor_event', (event) => {
      addEvent(event)
    })

    socket.on('state_change', ({ state }) => {
      if (state !== 'ANOMALY') setShelfState(state)
    })

    return () => socket.disconnect()
  }, [addEvent])

  // Simulate a message
  const simulate = useCallback(async (msg) => {
    ensureAudio()
    try {
      const res = await fetch('/simulate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: msg }),
      })
      const data = await res.json()
      if (!data.ok) console.error('Sim error:', data.error)
    } catch (err) {
      console.error('Sim fetch failed:', err)
    }
  }, [ensureAudio])

  const clearLog = useCallback(async () => {
    setEvents([])
    setStockCount(null)
    setWeightKg(null)
    setLastEvent(null)
    await fetch('/logs', { method: 'DELETE' })
  }, [])

  const theme = THEMES[shelfState] || THEMES.IDLE

  const filteredEvents = logFilter === 'ALL'
    ? events
    : events.filter(e => e.type === logFilter)

  const eventTypes = ['ALL', ...Array.from(new Set(events.map(e => e.type)))]

  // ── Styles ──────────────────────────────────────────────────────────────
  const s = {
    root: {
      minHeight: '100vh',
      background: theme.bg,
      color: theme.text,
      display: 'flex',
      flexDirection: 'column',
      transition: 'background 0.6s ease',
    },
    header: {
      padding: '12px 24px',
      background: 'rgba(0,0,0,0.35)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      borderBottom: `1px solid ${theme.accent}33`,
      backdropFilter: 'blur(6px)',
    },
    headerTitle: {
      fontSize: 13,
      fontWeight: 700,
      letterSpacing: '0.1em',
      textTransform: 'uppercase',
      color: theme.accent,
    },
    statusDots: { display: 'flex', gap: 10, alignItems: 'center' },
    dot: (on, color) => ({
      width: 8, height: 8, borderRadius: '50%',
      background: on ? color : '#374151',
      boxShadow: on ? `0 0 6px ${color}` : 'none',
    }),
    dotLabel: { fontSize: 11, color: theme.subtext },

    // Status panel
    statusPanel: {
      margin: '20px 24px 0',
      background: theme.panelBg,
      borderRadius: 16,
      border: `1px solid ${theme.accent}44`,
      padding: '28px 32px',
      display: 'flex',
      alignItems: 'center',
      gap: 32,
      position: 'relative',
      overflow: 'hidden',
      transition: 'background 0.6s ease, border-color 0.6s ease',
    },
    glowOrb: {
      position: 'absolute',
      top: -40, right: -40,
      width: 200, height: 200,
      borderRadius: '50%',
      background: `radial-gradient(circle, ${theme.accent}22, transparent 70%)`,
      pointerEvents: 'none',
    },
    stateLabel: {
      fontSize: 36,
      fontWeight: 800,
      letterSpacing: '0.04em',
      color: theme.accent,
      textTransform: 'uppercase',
      lineHeight: 1.1,
      transition: 'color 0.6s ease',
    },
    stateDesc: {
      fontSize: 14,
      color: theme.subtext,
      marginTop: 6,
      transition: 'color 0.6s ease',
    },
    metaGrid: {
      display: 'grid',
      gridTemplateColumns: 'repeat(3, auto)',
      gap: '8px 24px',
      marginTop: 14,
    },
    metaItem: { display: 'flex', flexDirection: 'column', gap: 2 },
    metaLabel: { fontSize: 10, letterSpacing: '0.08em', color: theme.subtext, textTransform: 'uppercase' },
    metaValue: { fontSize: 18, fontWeight: 700, color: theme.text },

    // Simulation panel
    simPanel: {
      margin: '16px 24px 0',
      background: 'rgba(0,0,0,0.3)',
      border: '1px solid rgba(255,255,255,0.08)',
      borderRadius: 12,
      overflow: 'hidden',
    },
    simHeader: {
      padding: '10px 16px',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      cursor: 'pointer',
      userSelect: 'none',
      fontSize: 12,
      fontWeight: 600,
      letterSpacing: '0.08em',
      textTransform: 'uppercase',
      color: theme.subtext,
    },
    simBody: {
      padding: '12px 16px 16px',
      borderTop: '1px solid rgba(255,255,255,0.06)',
    },
    simPresets: {
      display: 'flex',
      flexWrap: 'wrap',
      gap: 8,
      marginBottom: 12,
    },
    simBtn: (color) => ({
      padding: '6px 12px',
      fontSize: 11,
      fontWeight: 600,
      background: color,
      color: '#fff',
      border: 'none',
      borderRadius: 6,
      cursor: 'pointer',
      letterSpacing: '0.04em',
      transition: 'opacity 0.15s',
    }),
    simInputRow: { display: 'flex', gap: 8 },
    simTextInput: {
      flex: 1,
      padding: '7px 12px',
      fontSize: 12,
      background: 'rgba(0,0,0,0.4)',
      border: '1px solid rgba(255,255,255,0.15)',
      borderRadius: 6,
      color: theme.text,
      fontFamily: 'monospace',
      outline: 'none',
    },
    sendBtn: {
      padding: '7px 16px',
      fontSize: 12,
      fontWeight: 600,
      background: theme.accent,
      color: theme.bg,
      border: 'none',
      borderRadius: 6,
      cursor: 'pointer',
    },

    // Log
    logPanel: {
      flex: 1,
      margin: '16px 24px 24px',
      background: 'rgba(0,0,0,0.3)',
      border: '1px solid rgba(255,255,255,0.08)',
      borderRadius: 12,
      overflow: 'hidden',
      display: 'flex',
      flexDirection: 'column',
    },
    logHeader: {
      padding: '10px 16px',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 12,
      borderBottom: '1px solid rgba(255,255,255,0.06)',
    },
    logTitle: {
      fontSize: 12, fontWeight: 600, letterSpacing: '0.08em',
      textTransform: 'uppercase', color: theme.subtext,
    },
    logControls: { display: 'flex', gap: 8, alignItems: 'center' },
    filterSelect: {
      fontSize: 11,
      padding: '4px 8px',
      background: 'rgba(0,0,0,0.4)',
      border: '1px solid rgba(255,255,255,0.15)',
      borderRadius: 6,
      color: theme.text,
      outline: 'none',
    },
    clearBtn: {
      fontSize: 11, padding: '4px 10px',
      background: 'rgba(239,68,68,0.2)',
      border: '1px solid rgba(239,68,68,0.4)',
      borderRadius: 6,
      color: '#f87171',
      cursor: 'pointer',
    },
    logScroll: { flex: 1, overflowY: 'auto', maxHeight: 380 },
    table: { width: '100%', borderCollapse: 'collapse', fontSize: 12 },
    th: {
      padding: '8px 12px',
      textAlign: 'left',
      fontSize: 10,
      fontWeight: 700,
      letterSpacing: '0.08em',
      textTransform: 'uppercase',
      color: theme.subtext,
      background: 'rgba(0,0,0,0.2)',
      position: 'sticky',
      top: 0,
    },
    td: (isNew) => ({
      padding: '7px 12px',
      borderBottom: '1px solid rgba(255,255,255,0.04)',
      verticalAlign: 'top',
      background: isNew ? 'rgba(255,255,255,0.04)' : 'transparent',
    }),
    typeTag: (type) => {
      const [bg, fg] = TYPE_COLORS[type] || TYPE_COLORS.UNKNOWN
      return {
        display: 'inline-block',
        padding: '2px 7px',
        borderRadius: 4,
        fontSize: 10,
        fontWeight: 700,
        background: bg,
        color: fg,
        letterSpacing: '0.06em',
        whiteSpace: 'nowrap',
      }
    },
    mono: { fontFamily: 'monospace', fontSize: 11, color: theme.subtext },
    emptyLog: {
      padding: '40px 16px',
      textAlign: 'center',
      color: theme.subtext,
      fontSize: 13,
    },
    autoScrollRow: {
      padding: '8px 16px',
      display: 'flex',
      alignItems: 'center',
      gap: 8,
      borderTop: '1px solid rgba(255,255,255,0.06)',
      fontSize: 11,
      color: theme.subtext,
    },
  }

  const eventCount = events.length
  const pickupCount = events.filter(e => e.type === 'PICKUP').length
  const returnCount = events.filter(e => e.type === 'STOCKCHANGE' && e.stock_change > 0).length

  return (
    <div style={s.root} onClick={ensureAudio}>
      {/* ── Header ── */}
      <header style={s.header}>
        <div>
          <div style={s.headerTitle}>Nexmosphere XZ Weight Sensor Monitor</div>
          <div style={{ fontSize: 10, color: theme.subtext, marginTop: 2 }}>
            Shelf-type pickup & return detection
          </div>
        </div>
        <div style={s.statusDots}>
          <span style={s.dot(wsConnected, '#4ade80')} title="WebSocket" />
          <span style={{ ...s.dotLabel }}>{wsConnected ? 'WS' : 'WS off'}</span>
          <span style={s.dot(serialStatus.connected, '#38bdf8')} title="Serial" />
          <span style={s.dotLabel}>
            {serialStatus.connected ? serialStatus.port : serialStatus.demo ? 'demo' : 'serial off'}
          </span>
        </div>
      </header>

      {/* ── Status panel ── */}
      <div style={s.statusPanel} key={flashKey}>
        <div style={s.glowOrb} />
        <div style={{ flex: 1, position: 'relative' }}>
          <div style={s.stateLabel}>{theme.label}</div>
          <div style={s.stateDesc}>{theme.description}</div>

          <div style={s.metaGrid}>
            <div style={s.metaItem}>
              <span style={s.metaLabel}>Stock count</span>
              <span style={s.metaValue}>{stockCount != null ? stockCount : '—'}</span>
            </div>
            <div style={s.metaItem}>
              <span style={s.metaLabel}>Weight</span>
              <span style={s.metaValue}>{weightKg != null ? `${weightKg.toFixed(3)} kg` : '—'}</span>
            </div>
            <div style={s.metaItem}>
              <span style={s.metaLabel}>Last address</span>
              <span style={s.metaValue}>{lastEvent?.address || '—'}</span>
            </div>
            <div style={s.metaItem}>
              <span style={s.metaLabel}>Pickups</span>
              <span style={{ ...s.metaValue, color: '#f87171' }}>{pickupCount}</span>
            </div>
            <div style={s.metaItem}>
              <span style={s.metaLabel}>Returns</span>
              <span style={{ ...s.metaValue, color: '#4ade80' }}>{returnCount}</span>
            </div>
            <div style={s.metaItem}>
              <span style={s.metaLabel}>Total events</span>
              <span style={s.metaValue}>{eventCount}</span>
            </div>
          </div>

          {lastEvent && (
            <div style={{ marginTop: 14, fontSize: 11, color: theme.subtext }}>
              Last: <span style={{ fontFamily: 'monospace', color: theme.accent }}>{lastEvent.raw}</span>
              {' '}&mdash; {fmtMs(lastEvent.timestamp)}
            </div>
          )}
        </div>
      </div>

      {/* ── Simulation panel ── */}
      <div style={s.simPanel}>
        <div style={s.simHeader} onClick={() => setSimOpen(o => !o)}>
          <span>Simulation / Test</span>
          <span style={{ fontSize: 16 }}>{simOpen ? '▲' : '▼'}</span>
        </div>
        {simOpen && (
          <div style={s.simBody}>
            <div style={s.simPresets}>
              {SIM_PRESETS.map(p => (
                <button
                  key={p.msg}
                  style={s.simBtn(p.color)}
                  onClick={() => simulate(p.msg)}
                  onMouseOver={e => (e.target.style.opacity = '0.75')}
                  onMouseOut={e => (e.target.style.opacity = '1')}
                >
                  {p.label}
                </button>
              ))}
            </div>
            <div style={s.simInputRow}>
              <input
                style={s.simTextInput}
                placeholder="Custom X-talk message, e.g. X005B[PICKUP]"
                value={simInput}
                onChange={e => setSimInput(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && simInput.trim()) { simulate(simInput.trim()); setSimInput('') } }}
              />
              <button
                style={s.sendBtn}
                onClick={() => { if (simInput.trim()) { simulate(simInput.trim()); setSimInput('') } }}
              >
                Send
              </button>
            </div>
          </div>
        )}
      </div>

      {/* ── Event log ── */}
      <div style={s.logPanel}>
        <div style={s.logHeader}>
          <span style={s.logTitle}>Event Log ({filteredEvents.length})</span>
          <div style={s.logControls}>
            <select
              style={s.filterSelect}
              value={logFilter}
              onChange={e => setLogFilter(e.target.value)}
            >
              {eventTypes.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
            <button style={s.clearBtn} onClick={clearLog}>Clear</button>
          </div>
        </div>

        <div style={s.logScroll} onScroll={e => {
          const el = e.target
          autoScrollRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 50
        }}>
          {filteredEvents.length === 0 ? (
            <div style={s.emptyLog}>No events yet. Use simulation or connect a sensor.</div>
          ) : (
            <table style={s.table}>
              <thead>
                <tr>
                  <th style={s.th}>Time</th>
                  <th style={s.th}>Address</th>
                  <th style={s.th}>Type</th>
                  <th style={s.th}>Description</th>
                  <th style={s.th}>Details</th>
                  <th style={s.th}>Raw</th>
                </tr>
              </thead>
              <tbody>
                {[...filteredEvents].reverse().map((ev, i) => {
                  const isNew = i === 0
                  const details = []
                  if (ev.stock_count != null) details.push(`stock=${ev.stock_count}`)
                  if (ev.stock_change != null) details.push(`Δstock=${ev.stock_change > 0 ? '+' : ''}${ev.stock_change}`)
                  if (ev.weight_kg != null) details.push(`${ev.weight_kg.toFixed(3)} kg`)
                  if (ev.anomaly_id != null) details.push(`anomaly#${ev.anomaly_id}`)

                  return (
                    <tr key={`${ev.timestamp}-${i}`}>
                      <td style={{ ...s.td(isNew), ...s.mono, whiteSpace: 'nowrap' }}>
                        {fmtTime(ev.timestamp)}
                      </td>
                      <td style={{ ...s.td(isNew), ...s.mono, color: theme.accent }}>
                        {ev.address}
                      </td>
                      <td style={s.td(isNew)}>
                        <span style={s.typeTag(ev.type)}>{ev.type}</span>
                      </td>
                      <td style={{ ...s.td(isNew), color: theme.subtext }}>
                        {ev.event}
                      </td>
                      <td style={{ ...s.td(isNew), ...s.mono }}>
                        {details.join(', ') || '—'}
                      </td>
                      <td style={{ ...s.td(isNew), ...s.mono }}>
                        {ev.raw}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
          <div ref={logEndRef} />
        </div>

        <div style={s.autoScrollRow}>
          <input
            type="checkbox"
            id="autoscroll"
            checked={autoScrollRef.current}
            onChange={e => { autoScrollRef.current = e.target.checked }}
          />
          <label htmlFor="autoscroll" style={{ cursor: 'pointer' }}>Auto-scroll to latest</label>
          <span style={{ marginLeft: 'auto' }}>
            Serial: {serialStatus.connected
              ? `${serialStatus.port} @ ${serialStatus.baud} baud`
              : serialStatus.demo
                ? 'Demo mode (no hardware)'
                : 'Disconnected'}
          </span>
        </div>
      </div>
    </div>
  )
}
