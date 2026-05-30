import React, { useEffect, useState } from 'react'
import PickCard from './PickCard'

export default function Tonight() {
  const [picks, setPicks] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const now = new Date()
  const dateStr = now.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })

  useEffect(() => {
  const t = setTimeout(() => loadPicks(), 3000)
  return () => clearTimeout(t)
}, [])

  async function loadPicks() {
    setLoading(true)
    setError(null)
    setPicks([])
    try {
      const res = await fetch('http://localhost:3001/picks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ date: dateStr })
      })
      const data = await res.json()
      if (!data.picks) throw new Error('No picks')
      setPicks(data.picks)
    } catch (e) {
      setError(e.message || 'Could not load picks. Tap retry to try again.')
    }
    setLoading(false)
  }

  const gold = picks.filter(p => p.conf >= 90)

  return (
    <div style={{ width: '100%', height: '100%', overflowY: 'auto', padding: '24px', display: 'flex', flexDirection: 'column', gap: '24px' }}>

      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
        <div>
          <div style={{ fontFamily: 'var(--font-d)', fontSize: '32px', letterSpacing: '2px', color: 'var(--text)', lineHeight: 1 }}>TONIGHT'S PICKS</div>
          <div style={{ fontSize: '12px', color: 'var(--text2)', marginTop: '4px' }}>{dateStr} · Best available across all sports and esports</div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          {!loading && (
            <button onClick={loadPicks} style={{
              background: 'none', border: '1px solid var(--border2)', color: 'var(--text2)',
              fontFamily: 'var(--font)', fontSize: '11px', padding: '5px 12px',
              borderRadius: '20px', cursor: 'pointer', letterSpacing: '1px'
            }}>Refresh</button>
          )}
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', background: 'rgba(16,185,129,0.1)', border: '1px solid rgba(16,185,129,0.25)', color: 'var(--high)', fontSize: '11px', fontWeight: 600, letterSpacing: '1.5px', textTransform: 'uppercase', padding: '5px 12px', borderRadius: '20px' }}>
            <div style={{ width: '6px', height: '6px', borderRadius: '50%', background: 'var(--high)', animation: 'pulse 1.5s infinite' }} />LIVE
          </div>
        </div>
      </div>

      {loading && (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '80px 0', gap: '16px' }}>
          <div style={{ fontFamily: 'var(--font-d)', fontSize: '22px', letterSpacing: '2px', color: 'var(--gold)' }}>SEARCHING TONIGHT'S SLATE</div>
          <div style={{ fontSize: '13px', color: 'var(--text2)' }}>Pulling live games and prop lines...</div>
          <div style={{ display: 'flex', gap: '8px', marginTop: '8px' }}>
            {[0, 1, 2].map(i => (
              <div key={i} style={{ width: '8px', height: '8px', borderRadius: '50%', background: 'var(--gold)', animation: `dotPulse 1.3s ${i * 0.2}s infinite` }} />
            ))}
          </div>
        </div>
      )}

      {error && !loading && (
        <div style={{ textAlign: 'center', padding: '80px 0' }}>
          <div style={{ fontSize: '14px', color: 'var(--text2)', marginBottom: '16px', textAlign: 'center', lineHeight: 1.6 }}>{error}</div>
          <button onClick={loadPicks} style={{ background: 'var(--accent2)', border: 'none', color: '#fff', fontFamily: 'var(--font)', fontSize: '13px', padding: '10px 24px', borderRadius: '10px', cursor: 'pointer' }}>Retry</button>
        </div>
      )}

      {!loading && !error && gold.length > 0 && (
        <div style={{ background: 'linear-gradient(135deg,rgba(245,200,66,0.04),rgba(245,200,66,0.01))', border: '1px solid rgba(245,200,66,0.18)', borderRadius: '18px', padding: '20px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '18px' }}>
            <span style={{ fontSize: '20px' }}>★</span>
            <span style={{ fontFamily: 'var(--font-d)', fontSize: '26px', letterSpacing: '2px', color: 'var(--gold)' }}>GOLD PICKS</span>
            <span style={{ fontSize: '12px', color: 'var(--text2)', marginLeft: 'auto' }}>90%+ Confidence · Strongest plays tonight</span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(195px,1fr))', gap: '14px' }}>
            {gold.map((p, i) => <PickCard key={p.id} pick={p} delay={i * 70} />)}
          </div>
        </div>
      )}

      {!loading && !error && picks.length > 0 && (
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '14px' }}>
            <div style={{ fontFamily: 'var(--font-c)', fontSize: '16px', fontWeight: 600, letterSpacing: '2px', textTransform: 'uppercase', color: 'var(--text2)' }}>All Picks</div>
            <div style={{ flex: 1, height: '1px', background: 'var(--border)' }} />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(195px,1fr))', gap: '14px' }}>
            {picks.map((p, i) => <PickCard key={p.id} pick={p} delay={i * 70} />)}
          </div>
        </div>
      )}

      <style>{`
        @keyframes pulse{0%,100%{opacity:1;}50%{opacity:0.3;}}
        @keyframes dotPulse{0%,80%,100%{opacity:0.2;transform:scale(1);}40%{opacity:1;transform:scale(1.2);}}
      `}</style>
    </div>
  )
}