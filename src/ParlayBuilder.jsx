import React, { useState } from 'react'

const SERVER = 'https://trippredicts-production-cfad.up.railway.app'
const MAX_LEGS = 6

// ============ SIGNAL design tokens (kept in sync with PickCard / Tonight / Gold) ============
const INK       = '#F1EEE6'
const INK_DIM   = '#9AA0AB'
const INK_FAINT = '#565A66'
const PANEL     = '#12151C'
const LINE_SOFT = 'rgba(255,255,255,0.08)'
const AMBER      = '#E3A548'
const AMBER_DIM  = 'rgba(227,165,72,0.12)'
const PULSE_BLUE = '#4FC3F7'
const PULSE_DIM  = 'rgba(79,195,247,0.14)'
const GOOD = '#3DDD8F'
const BAD  = '#F2555F'
const FONT_D = "'Space Grotesk',sans-serif"
const FONT_M = "'IBM Plex Mono',monospace"
const FONT_B = "'Barlow',sans-serif"

export default function ParlayBuilder({ picks, onRemove, onClear }) {
  const [open, setOpen] = useState(false)
  const [analyzing, setAnalyzing] = useState(false)
  const [result, setResult] = useState(null)
  const [error, setError] = useState(null)

  if (!picks || picks.length === 0) return null

  async function handleAnalyze() {
    setOpen(true)
    setAnalyzing(true)
    setError(null)
    setResult(null)
    try {
      const res = await fetch(`${SERVER}/parlay-analysis`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          currentTime: new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }),
          picks: picks.map(p => ({
            name: p.name,
            team: p.meta,
            league: p.league || p.sport,
            stat: p.stat,
            val: p.val,
            dir: p.dir,
            conf: p.conf,
            realHit: p.realHit || null,
            realTotal: p.realTotal || null,
            record: p.record || null
          }))
        })
      })
      const data = await res.json()
      if (data.error) throw new Error(data.error)
      setResult(data)
    } catch (e) {
      setError('Could not analyze right now. Try again in a moment.')
    } finally {
      setAnalyzing(false)
    }
  }

  return (
    <>
      {/* Floating tray */}
      <div style={{
        position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 200,
        background: 'linear-gradient(180deg, rgba(10,12,17,0.92), rgba(6,7,10,0.98))',
        borderTop: `1px solid ${PULSE_DIM}`,
        backdropFilter: 'blur(10px)', WebkitBackdropFilter: 'blur(10px)',
        padding: '10px 14px', display: 'flex', alignItems: 'center', gap: '10px',
      }}>
        <div style={{ display: 'flex', gap: '6px', overflowX: 'auto', flex: 1, paddingBottom: '2px' }}>
          {picks.map(p => (
            <div key={p.id} style={{
              display: 'flex', alignItems: 'center', gap: '5px',
              background: 'rgba(255,255,255,0.04)', border: `1px solid rgba(79,195,247,0.3)`,
              borderRadius: '8px', padding: '4px 8px 4px 4px', flexShrink: 0,
            }}>
              {p.image
                ? <img src={p.image} alt={p.name} style={{ width: '22px', height: '22px', borderRadius: '5px', objectFit: 'cover' }} />
                : <div style={{ width: '22px', height: '22px', borderRadius: '5px', background: '#1a1d24', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '9px', color: INK_DIM, fontFamily: FONT_M }}>{p.initials}</div>
              }
              <span style={{ fontSize: '11px', color: INK, whiteSpace: 'nowrap', fontFamily: FONT_M }}>{(p.name || '').split(' ').slice(-1)[0]}</span>
              <button onClick={() => onRemove(p.id)} style={{ background: 'none', border: 'none', color: INK_FAINT, cursor: 'pointer', fontSize: '13px', padding: 0, lineHeight: 1 }}>×</button>
            </div>
          ))}
        </div>
        <button onClick={onClear} style={{
          background: 'none', border: `1px solid ${LINE_SOFT}`, color: INK_DIM,
          borderRadius: '8px', padding: '8px 10px', fontSize: '11px', fontFamily: FONT_M,
          cursor: 'pointer', flexShrink: 0
        }}>Clear</button>
        <button onClick={handleAnalyze} disabled={analyzing} style={{
          background: PULSE_BLUE, border: 'none', color: '#04101f',
          borderRadius: '8px', padding: '9px 16px', fontSize: '12px', fontWeight: 700,
          fontFamily: FONT_D, letterSpacing: '0.3px',
          cursor: analyzing ? 'default' : 'pointer', flexShrink: 0, opacity: analyzing ? 0.7 : 1,
        }}>{analyzing ? 'Analyzing…' : `Analyze (${picks.length})`}</button>
      </div>

      {/* Modal */}
      {open && (
        <div onClick={() => setOpen(false)} style={{
          position: 'fixed', inset: 0, zIndex: 300, background: 'rgba(4,5,8,0.8)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px',
          backdropFilter: 'blur(3px)', WebkitBackdropFilter: 'blur(3px)',
        }}>
          <div onClick={e => e.stopPropagation()} style={{
            background: 'linear-gradient(180deg,#12151c,#0a0c11)', border: `1px solid rgba(79,195,247,0.3)`,
            borderRadius: '14px', maxWidth: '440px', width: '100%', maxHeight: '80vh', overflowY: 'auto',
            padding: '20px', boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
              <div style={{ fontFamily: FONT_D, fontSize: '18px', fontWeight: 700, letterSpacing: '0.3px', color: PULSE_BLUE }}>PARLAY ANALYSIS</div>
              <button onClick={() => setOpen(false)} style={{ background: 'none', border: 'none', color: INK_FAINT, fontSize: '20px', cursor: 'pointer', lineHeight: 1 }}>×</button>
            </div>

            {analyzing && (
              <div style={{ textAlign: 'center', padding: '30px 0', color: INK_DIM, fontFamily: FONT_M, fontSize: '13px' }}>
                Checking matchups and current status for {picks.length} {picks.length === 1 ? 'player' : 'players'}…
              </div>
            )}

            {error && (
              <div style={{ color: BAD, fontSize: '13px', fontFamily: FONT_B, padding: '10px 0' }}>{error}</div>
            )}

            {result && (
              <div>
                {result.combinedRate != null && (
                  <div style={{
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    background: PULSE_DIM, border: `1px solid rgba(79,195,247,0.3)`,
                    borderRadius: '10px', padding: '10px 14px', marginBottom: '14px'
                  }}>
                    <span style={{ fontSize: '11px', color: INK_DIM, fontFamily: FONT_B }}>Combined rate from real hit rates (assumes independence)</span>
                    <span style={{ fontFamily: FONT_M, fontSize: '18px', fontWeight: 700, color: PULSE_BLUE }}>{result.combinedRate}%</span>
                  </div>
                )}

                {result.verdict && (
                  <div style={{
                    display: 'inline-block', padding: '4px 10px', borderRadius: '6px', marginBottom: '12px',
                    fontFamily: FONT_M, fontSize: '12px', fontWeight: 700, letterSpacing: '0.5px',
                    background: result.verdict === 'Strong' ? 'rgba(61,221,143,0.14)' : result.verdict === 'Risky' ? 'rgba(242,85,95,0.14)' : 'rgba(227,165,72,0.14)',
                    color: result.verdict === 'Strong' ? GOOD : result.verdict === 'Risky' ? BAD : AMBER,
                  }}>{result.verdict}</div>
                )}

                {result.summary && (
                  <div style={{ fontSize: '13px', color: INK, fontFamily: FONT_B, lineHeight: 1.6, marginBottom: '16px' }}>{result.summary}</div>
                )}

                {result.legs && result.legs.map((leg, i) => (
                  <div key={i} style={{ borderTop: `1px solid ${LINE_SOFT}`, padding: '10px 0' }}>
                    <div style={{ fontSize: '12px', fontWeight: 700, color: INK, marginBottom: '4px', fontFamily: FONT_D }}>{leg.name}</div>
                    <div style={{ fontSize: '12px', color: INK_DIM, lineHeight: 1.5, fontFamily: FONT_B }}>{leg.note}</div>
                  </div>
                ))}

                <div style={{ fontSize: '10px', color: INK_FAINT, marginTop: '14px', fontFamily: FONT_B, lineHeight: 1.5 }}>
                  Matchup and status notes come from a live web search run at the time of this request, not a guaranteed-current injury feed. Confirm on the official injury report before betting.
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  )
}

export { MAX_LEGS }