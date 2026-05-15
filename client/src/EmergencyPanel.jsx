import { useState } from 'react'

const API_URL = 'https://epaper-cms.vercel.app/api/emergency'

const TEMPLATES = [
  { value: 'headline', label: 'Headline' },
]

export default function EmergencyPanel() {
  const [open, setOpen]           = useState(false)
  const [pin, setPin]             = useState('')
  const [deviceId, setDeviceId]   = useState('')
  const [template, setTemplate]   = useState('headline')
  const [line1, setLine1]         = useState('EMERGENCY')
  const [line2, setLine2]         = useState('Please evacuate immediately')
  const [status, setStatus]       = useState(null) // null | 'confirming' | 'sending' | 'active' | 'cleared' | 'error'
  const [errorMsg, setErrorMsg]   = useState('')
  const [isActive, setIsActive]   = useState(false) // track whether emergency is currently live

  async function post(body) {
    setStatus('sending')
    setErrorMsg('')
    try {
      const res = await fetch(API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setErrorMsg(data.message || data.error || `HTTP ${res.status}`)
        setStatus('error')
        return false
      }
      return true
    } catch (err) {
      setErrorMsg(err.message)
      setStatus('error')
      return false
    }
  }

  function handleTriggerClick() {
    if (!pin) return
    if (status !== 'confirming') {
      setStatus('confirming')
      return
    }
    // Second click — actually send
    const body = {
      pin,
      active: true,
      template,
      line1,
      line2,
      ...(deviceId.trim() ? { deviceId: deviceId.trim() } : {}),
    }
    post(body).then(ok => {
      if (ok) { setIsActive(true); setStatus('active') }
    })
  }

  function handleClear() {
    const body = {
      pin,
      active: false,
      ...(deviceId.trim() ? { deviceId: deviceId.trim() } : {}),
    }
    post(body).then(ok => {
      if (ok) { setIsActive(false); setStatus('cleared') }
    })
  }

  function handleCancel() {
    setStatus(null)
  }

  const canTrigger = pin.length > 0 && status !== 'sending'
  const confirming = status === 'confirming'

  return (
    <div style={{
      margin: '16px 24px 0',
      borderRadius: 12,
      overflow: 'hidden',
      border: isActive
        ? '1px solid rgba(239,68,68,0.6)'
        : '1px solid rgba(239,68,68,0.25)',
      background: isActive
        ? 'rgba(127,29,29,0.35)'
        : 'rgba(0,0,0,0.3)',
      transition: 'border-color 0.3s, background 0.3s',
    }}>
      {/* Header */}
      <div
        onClick={() => setOpen(o => !o)}
        style={{
          padding: '10px 16px',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          cursor: 'pointer', userSelect: 'none',
          fontSize: 12, fontWeight: 700, letterSpacing: '0.08em',
          textTransform: 'uppercase',
          color: isActive ? '#fca5a5' : '#f87171',
        }}
      >
        <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {isActive && (
            <span style={{
              display: 'inline-block', width: 8, height: 8, borderRadius: '50%',
              background: '#ef4444',
              boxShadow: '0 0 8px #ef4444',
              animation: 'pulse 1s infinite',
            }} />
          )}
          Emergency Broadcast
          {isActive && <span style={{ fontSize: 10, color: '#fca5a5', fontWeight: 400 }}>— ACTIVE</span>}
        </span>
        <span style={{ fontSize: 16, color: '#94a3b8' }}>{open ? '▲' : '▼'}</span>
      </div>

      {open && (
        <div style={{ padding: '14px 16px 18px', borderTop: '1px solid rgba(239,68,68,0.15)' }}>

          {/* Config fields */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px 16px', marginBottom: 14 }}>
            <Field label="Admin PIN" required>
              <input
                type="password"
                value={pin}
                onChange={e => setPin(e.target.value)}
                placeholder="••••••"
                style={inputStyle}
              />
            </Field>

            <Field label="Device ID (leave blank for all devices)">
              <input
                value={deviceId}
                onChange={e => setDeviceId(e.target.value)}
                placeholder="all devices"
                style={inputStyle}
              />
            </Field>

            <Field label="Template">
              <select
                value={template}
                onChange={e => setTemplate(e.target.value)}
                style={inputStyle}
              >
                {TEMPLATES.map(t => (
                  <option key={t.value} value={t.value}>{t.label}</option>
                ))}
              </select>
            </Field>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px 16px', marginBottom: 18 }}>
            <Field label="Line 1">
              <input
                value={line1}
                onChange={e => setLine1(e.target.value)}
                placeholder="EMERGENCY"
                style={inputStyle}
              />
            </Field>
            <Field label="Line 2">
              <input
                value={line2}
                onChange={e => setLine2(e.target.value)}
                placeholder="Please evacuate immediately"
                style={inputStyle}
              />
            </Field>
          </div>

          {/* Preview */}
          <div style={{
            padding: '10px 14px', marginBottom: 16,
            background: 'rgba(0,0,0,0.4)',
            border: '1px solid rgba(255,255,255,0.06)',
            borderRadius: 8, fontSize: 11, color: '#64748b',
          }}>
            <span style={{ color: '#475569', marginRight: 8 }}>Payload preview:</span>
            <code style={{ color: '#94a3b8' }}>
              {JSON.stringify({
                pin: pin ? '••••' : '(required)',
                active: true,
                template,
                line1,
                line2,
                ...(deviceId.trim() ? { deviceId: deviceId.trim() } : {}),
              })}
            </code>
          </div>

          {/* Action buttons */}
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            {!confirming ? (
              <button
                onClick={handleTriggerClick}
                disabled={!canTrigger}
                style={{
                  padding: '9px 22px',
                  fontSize: 13, fontWeight: 800,
                  letterSpacing: '0.06em', textTransform: 'uppercase',
                  background: canTrigger ? '#dc2626' : 'rgba(255,255,255,0.05)',
                  color: canTrigger ? '#fff' : '#475569',
                  border: 'none', borderRadius: 8,
                  cursor: canTrigger ? 'pointer' : 'not-allowed',
                  boxShadow: canTrigger ? '0 0 16px rgba(220,38,38,0.4)' : 'none',
                  transition: 'all 0.2s',
                }}
              >
                Trigger Emergency
              </button>
            ) : (
              <>
                <button
                  onClick={handleTriggerClick}
                  style={{
                    padding: '9px 22px',
                    fontSize: 13, fontWeight: 800,
                    letterSpacing: '0.06em', textTransform: 'uppercase',
                    background: '#7f1d1d',
                    color: '#fca5a5',
                    border: '2px solid #ef4444',
                    borderRadius: 8, cursor: 'pointer',
                    animation: 'pulse-border 0.8s infinite',
                  }}
                >
                  Confirm — Send Emergency
                </button>
                <button
                  onClick={handleCancel}
                  style={{
                    padding: '9px 18px', fontSize: 13,
                    background: 'transparent',
                    color: '#94a3b8',
                    border: '1px solid rgba(255,255,255,0.1)',
                    borderRadius: 8, cursor: 'pointer',
                  }}
                >
                  Cancel
                </button>
              </>
            )}

            {isActive && (
              <button
                onClick={handleClear}
                disabled={status === 'sending'}
                style={{
                  padding: '9px 22px',
                  fontSize: 13, fontWeight: 700,
                  background: 'rgba(74,222,128,0.15)',
                  color: '#4ade80',
                  border: '1px solid rgba(74,222,128,0.4)',
                  borderRadius: 8, cursor: 'pointer',
                }}
              >
                Clear Emergency
              </button>
            )}

            <StatusPill status={status} error={errorMsg} />
          </div>
        </div>
      )}

      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.3; }
        }
        @keyframes pulse-border {
          0%, 100% { box-shadow: 0 0 0 0 rgba(239,68,68,0.4); }
          50% { box-shadow: 0 0 0 6px rgba(239,68,68,0); }
        }
      `}</style>
    </div>
  )
}

function Field({ label, required, children }) {
  return (
    <div>
      <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#64748b', marginBottom: 5 }}>
        {label}{required && <span style={{ color: '#ef4444', marginLeft: 3 }}>*</span>}
      </div>
      {children}
    </div>
  )
}

function StatusPill({ status, error }) {
  if (!status || status === 'confirming') return null
  const map = {
    sending: { bg: 'rgba(56,189,248,0.15)', color: '#38bdf8', text: '⏳ Sending...' },
    active:  { bg: 'rgba(239,68,68,0.15)',  color: '#f87171', text: '🚨 Emergency active on devices' },
    cleared: { bg: 'rgba(74,222,128,0.15)', color: '#4ade80', text: '✓ Emergency cleared' },
    error:   { bg: 'rgba(239,68,68,0.15)',  color: '#f87171', text: `✗ ${error}` },
  }
  const s = map[status]
  if (!s) return null
  return (
    <span style={{
      fontSize: 11, padding: '4px 12px', borderRadius: 20,
      background: s.bg, color: s.color, fontWeight: 600,
    }}>
      {s.text}
    </span>
  )
}

const inputStyle = {
  width: '100%', padding: '6px 10px', fontSize: 12,
  background: 'rgba(0,0,0,0.4)',
  border: '1px solid rgba(255,255,255,0.15)',
  borderRadius: 6, color: '#e2e8f0',
  outline: 'none', boxSizing: 'border-box',
}
