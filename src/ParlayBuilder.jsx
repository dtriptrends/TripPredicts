import React, { useState } from 'react'

const SERVER = 'https://trippredicts-production-cfad.up.railway.app'
const MAX_LEGS = 6

export default function ParlayBuilder({ picks, onRemove, onClear }) {
  const [open, setOpen] = useState(false)
  const [analyzing, setAnalyzing] = useState(false)
  const [result, setResult] = useState(null)
  const [error, setError] = useState(null)

  if (!picks || picks.length === 0) return null

  // Only legs that carry verified game-log counts can call the combined
  // number a "real hit rate". With the stats feed paused every leg is
  // model-rated, so the label says so instead of overclaiming.
  const anyVerified = picks.some(p => p.realHit != null && p.realTotal)

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
        background: 'linear-gradient(180deg, rgba(10,14,22,0.9), rgba(6,9,14,0.98))',
        borderTop: '1px solid rgba(77,158,255,0.3)',
        backdropFilter: 'blur(10px)', WebkitBackdropFilter: 'blur(10px)',
        padding: '10px 14px', display: 'flex', alignItems: 'center', gap: '10px',
      }}>
        <div style={{ display: 'flex', gap: '6px', overflowX: 'auto', flex: 1, paddingBottom: '2px' }}>
          {picks.map(p => (
            <div key={p.id} style={{
              display: 'flex', alignItems: 'center', gap: '5px',
              background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(77,158,255,0.35)',
              borderRadius: '20px', padding: '4px 8px 4px 4px', flexShrink: 0,
            }}>
              {p.image
                ? <img src={p.image} alt={p.name} style={{ width: '22px', height: '22px', borderRadius: '50%', objectFit: 'cover' }} />
                : <div style={{ width: '22px', height: '22px', borderRadius: '50%', background: '#1a2333', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '9px', color: '#7a8aaa' }}>{p.initials}</div>
              }
              <span style={{ fontSize: '11px', color: '#dfe8ff', fontFamily: "'Barlow',sans-serif", whiteSpace: 'nowrap' }}>{(p.name || '').split(' ').slice(-1)[0]}</span>
              <button onClick={() => onRemove(p.id)} style={{ background: 'none', border: 'none', color: '#7a8aaa', cursor: 'pointer', fontSize: '13px', padding: 0, lineHeight: 1 }}>×</button>
            </div>
          ))}
        </div>
        <button onClick={onClear} style={{
          background: 'none', border: '1px solid rgba(255,255,255,0.1)', color: '#7a8aaa',
          borderRadius: '8px', padding: '8px 10px', fontSize: '11px', fontFamily: "'Barlow',sans-serif",
          cursor: 'pointer', flexShrink: 0
        }}>Clear</button>
        <button onClick={handleAnalyze} disabled={analyzing} style={{
          background: 'linear-gradient(90deg,#2563eb,#4d9eff)', border: 'none', color: '#fff',
          borderRadius: '8px', padding: '9px 16px', fontSize: '12px', fontWeight: 700,
          fontFamily: "'Barlow Condensed',sans-serif", letterSpacing: '0.5px',
          cursor: analyzing ? 'default' : 'pointer', flexShrink: 0, opacity: analyzing ? 0.7 : 1,
        }}>{analyzing ? 'Analyzing…' : `Analyze (${picks.length})`}</button>
      </div>

      {/* Modal */}
      {open && (
        <div onClick={() => setOpen(false)} style={{
          position: 'fixed', inset: 0, zIndex: 300, background: 'rgba(4,6,10,0.75)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px',
          backdropFilter: 'blur(3px)', WebkitBackdropFilter: 'blur(3px)',
        }}>
          <div onClick={e => e.stopPropagation()} style={{
            background: 'linear-gradient(180deg,#0d1219,#0a0e15)', border: '1px solid rgba(77,158,255,0.3)',
            borderRadius: '16px', maxWidth: '440px', width: '100%', maxHeight: '80vh', overflowY: 'auto',
            padding: '20px', boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
              <div style={{ fontFamily: "'Bebas Neue',sans-serif", fontSize: '20px', letterSpacing: '1px', color: '#4d9eff' }}>PARLAY ANALYSIS</div>
              <button onClick={() => setOpen(false)} style={{ background: 'none', border: 'none', color: '#7a8aaa', fontSize: '20px', cursor: 'pointer', lineHeight: 1 }}>×</button>
            </div>

            {analyzing && (
              <div style={{ textAlign: 'center', padding: '30px 0', color: '#7a8aaa', fontFamily: "'Barlow',sans-serif", fontSize: '13px' }}>
                Checking matchups, injury reports, and current status for {picks.length} {picks.length === 1 ? 'player' : 'players'}…
              </div>
            )}

            {error && (
              <div style={{ color: '#ff6b6b', fontSize: '13px', fontFamily: "'Barlow',sans-serif", padding: '10px 0' }}>{error}</div>
            )}

            {result && (
              <div>
                {result.combinedRate != null && (
                  <div style={{
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    background: 'rgba(77,158,255,0.08)', border: '1px solid rgba(77,158,255,0.25)',
                    borderRadius: '10px', padding: '10px 14px', marginBottom: '14px'
                  }}>
                    <span style={{ fontSize: '11px', color: '#7a8aaa', fontFamily: "'Barlow',sans-serif" }}>
                      {anyVerified ? 'Combined rate from real hit rates (assumes independence)' : 'Combined rate from each leg\'s model rating (assumes independence)'}
                    </span>
                    <span style={{ fontFamily: "'Barlow Condensed',sans-serif", fontSize: '18px', fontWeight: 700, color: '#4d9eff' }}>{result.combinedRate}%</span>
                  </div>
                )}

                {result.verdict && (
                  <div style={{
                    display: 'inline-block', padding: '4px 10px', borderRadius: '8px', marginBottom: '12px',
                    fontFamily: "'Barlow Condensed',sans-serif", fontSize: '12px', fontWeight: 700, letterSpacing: '0.5px',
                    background: result.verdict === 'Strong' ? 'rgba(21,214,143,0.15)' : result.verdict === 'Risky' ? 'rgba(239,68,68,0.15)' : 'rgba(245,200,66,0.15)',
                    color: result.verdict === 'Strong' ? '#15d68f' : result.verdict === 'Risky' ? '#ff6b6b' : '#f5c842',
                  }}>{result.verdict}</div>
                )}

                {result.summary && (
                  <div style={{ fontSize: '13px', color: '#dfe8ff', fontFamily: "'Barlow',sans-serif", lineHeight: 1.6, marginBottom: '16px' }}>{result.summary}</div>
                )}

                {result.legs && result.legs.map((leg, i) => (
                  <div key={i} style={{ borderTop: '1px solid rgba(255,255,255,0.06)', padding: '10px 0' }}>
                    <div style={{ fontSize: '12px', fontWeight: 700, color: '#eef2ff', marginBottom: '4px', fontFamily: "'Barlow Condensed',sans-serif" }}>{leg.name}</div>
                    <div style={{ fontSize: '12px', color: '#9aabcf', fontFamily: "'Barlow',sans-serif", lineHeight: 1.5 }}>{leg.note}</div>
                  </div>
                ))}

                <div style={{ fontSize: '10px', color: '#4a5a7a', marginTop: '14px', fontFamily: "'Barlow',sans-serif", lineHeight: 1.5 }}>
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