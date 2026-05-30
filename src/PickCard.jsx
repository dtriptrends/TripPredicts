import React, { useState, useEffect } from 'react'

function tierOf(c) { return c >= 90 ? 'gold' : c >= 75 ? 'high' : 'regular' }

export default function PickCard({ pick, delay = 0 }) {
  const [revealed, setRevealed] = useState(false)
  const [barWidth, setBarWidth] = useState(0)
  const [infoOpen, setInfoOpen] = useState(false)
  const t = tierOf(pick.conf)
  const up = pick.dir === 'HIGHER'

  useEffect(() => {
    const t1 = setTimeout(() => setRevealed(true), delay)
    const t2 = setTimeout(() => setBarWidth(pick.conf), delay + 400)
    return () => { clearTimeout(t1); clearTimeout(t2) }
  }, [])

  const borderColor = t === 'gold' ? '#d4a017' : t === 'high' ? 'rgba(16,185,129,0.3)' : 'rgba(255,255,255,0.06)'
  const boxShadow = t === 'gold' ? '0 0 0 1px rgba(245,200,66,0.2), 0 8px 40px rgba(245,200,66,0.25)' : 'none'
  const confColor = t === 'gold' ? '#f5c842' : t === 'high' ? '#10b981' : '#7a8aaa'
  const fillBg = t === 'gold' ? 'linear-gradient(90deg,#d4a017,#f5c842,#fff0a0)' : t === 'high' ? '#10b981' : '#3a4a6a'

  return (
    <div style={{
      background: '#0f1520',
      border: `1px solid ${borderColor}`,
      borderRadius: '16px',
      overflow: 'hidden',
      position: 'relative',
      opacity: revealed ? 1 : 0,
      transform: revealed ? 'translateY(0)' : 'translateY(24px)',
      transition: t === 'gold'
        ? 'opacity 0.5s ease, transform 0.7s cubic-bezier(0.16,1,0.3,1)'
        : 'opacity 0.4s ease, transform 0.4s ease',
      boxShadow: revealed ? boxShadow : 'none',
      animation: revealed && t === 'gold' ? 'goldPulse 2.5s 0.7s ease infinite' : 'none'
    }}>

      <div style={{ height: '115px', background: '#111722', display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative', overflow: 'hidden' }}>
        {pick.image
          ? <img src={pick.image} alt={pick.name} style={{ width: '100%', height: '100%', objectFit: 'cover', objectPosition: 'top' }} />
          : <div style={{
              width: '72px', height: '72px', borderRadius: '50%',
              background: t === 'gold' ? 'linear-gradient(135deg,#2a1f00,#1a1400)' : 'linear-gradient(135deg,#161e2e,#0c1018)',
              border: t === 'gold' ? '2px solid rgba(245,200,66,0.3)' : '2px solid rgba(255,255,255,0.08)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontFamily: "'Bebas Neue',sans-serif", fontSize: '24px',
              color: t === 'gold' ? '#f5c842' : '#7a8aaa', letterSpacing: '1px'
            }}>{pick.initials}</div>
        }
        <div style={{
          position: 'absolute', top: '8px', right: '8px',
          fontFamily: "'Barlow Condensed',sans-serif", fontSize: '10px', fontWeight: 700,
          letterSpacing: '1.5px', textTransform: 'uppercase',
          padding: '3px 9px', borderRadius: '10px',
          background: t === 'gold' ? '#f5c842' : t === 'high' ? 'rgba(16,185,129,0.12)' : 'rgba(255,255,255,0.07)',
          color: t === 'gold' ? '#1a0f00' : t === 'high' ? '#10b981' : '#3a4a6a',
          border: t === 'high' ? '1px solid rgba(16,185,129,0.25)' : 'none'
        }}>{t === 'gold' ? '★ GOLD' : t === 'high' ? 'HIGH' : 'PICK'}</div>
        <div style={{ position: 'absolute', bottom: '5px', left: '7px', fontFamily: "'Bebas Neue',sans-serif", fontSize: '8px', letterSpacing: '1.5px', color: 'rgba(255,255,255,0.08)' }}>TRIP PREDICTS</div>
        <div style={{ position: 'absolute', bottom: '5px', right: '7px', fontSize: '9px', color: 'rgba(255,255,255,0.12)', letterSpacing: '0.5px', fontFamily: "'Barlow Condensed',sans-serif", fontWeight: 600 }}>{pick.sport}</div>
        {t === 'gold' && revealed && (
          <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', overflow: 'hidden' }}>
            <div style={{ position: 'absolute', top: 0, left: 0, width: '45%', height: '100%', background: 'linear-gradient(105deg,transparent,rgba(255,220,80,0.12),transparent)', animation: 'shimmerMove 2.5s 0.8s ease infinite' }} />
          </div>
        )}
      </div>

      <div style={{ padding: '12px 13px 10px' }}>
        <div style={{ fontFamily: "'Barlow Condensed',sans-serif", fontSize: '15px', fontWeight: 700, color: '#eef2ff', letterSpacing: '0.5px', lineHeight: 1.1 }}>{pick.name}</div>
        <div style={{ fontSize: '11px', color: '#7a8aaa', marginTop: '2px' }}>{pick.meta}</div>
       {(pick.time || pick.date) && (
  <div style={{ fontSize: '10px', color: '#f5c842', marginTop: '3px', marginBottom: '8px', fontFamily: "'Barlow Condensed',sans-serif", fontWeight: 600, letterSpacing: '0.5px' }}>
    🕐 {pick.date ? `${pick.date} · ` : ''}{pick.time || ''}
  </div>
)}
{!pick.time && !pick.date && <div style={{ marginBottom: '11px' }} />}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px' }}>
          <div>
            <div style={{ fontSize: '11px', color: '#7a8aaa' }}>{pick.stat}</div>
            <div style={{ fontFamily: "'Barlow Condensed',sans-serif", fontSize: '17px', fontWeight: 700, color: '#eef2ff', lineHeight: 1 }}>{pick.val}</div>
          </div>
          <div style={{
            width: '38px', height: '38px', borderRadius: '50%',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: '20px', fontWeight: 700, flexShrink: 0,
            background: up ? 'rgba(16,185,129,0.15)' : 'rgba(239,68,68,0.15)',
            color: up ? '#10b981' : '#ef4444',
            border: up ? '1px solid rgba(16,185,129,0.2)' : '1px solid rgba(239,68,68,0.2)',
          }}>{up ? '↑' : '↓'}</div>
        </div>

        <div style={{ marginBottom: '10px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '5px' }}>
            <span style={{ fontSize: '10px', color: '#3a4a6a', textTransform: 'uppercase', letterSpacing: '1px' }}>Confidence</span>
            <span style={{ fontFamily: "'Barlow Condensed',sans-serif", fontSize: '14px', fontWeight: 700, color: confColor }}>{pick.conf}%</span>
          </div>
          <div style={{ height: '4px', background: '#111722', borderRadius: '2px', overflow: 'hidden' }}>
            <div style={{ height: '100%', borderRadius: '2px', background: fillBg, width: `${barWidth}%`, transition: 'width 1.2s cubic-bezier(0.16,1,0.3,1)' }} />
          </div>
        </div>

        <button onClick={() => setInfoOpen(!infoOpen)} style={{
          width: '100%', padding: '7px 0',
          background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: '8px',
          color: '#3a4a6a', fontFamily: "'Barlow',sans-serif", fontSize: '11px', fontWeight: 500,
          letterSpacing: '0.5px', cursor: 'pointer', transition: 'all 0.2s'
        }}>{infoOpen ? 'Hide Info ▴' : 'View Info ▾'}</button>
      </div>

      {infoOpen && (
        <div style={{ padding: '12px 13px', borderTop: '1px solid rgba(255,255,255,0.06)', background: '#111722' }}>
          <div style={{ marginBottom: '10px' }}>
            <div style={{ fontSize: '9px', color: '#3a4a6a', textTransform: 'uppercase', letterSpacing: '1.5px', marginBottom: '4px', fontFamily: "'Barlow Condensed',sans-serif", fontWeight: 600 }}>Why it's strong</div>
            <div style={{ fontSize: '12px', color: '#7a8aaa', lineHeight: 1.55 }}>{pick.bull}</div>
          </div>
          <div style={{ marginBottom: '10px' }}>
            <div style={{ fontSize: '9px', color: '#3a4a6a', textTransform: 'uppercase', letterSpacing: '1.5px', marginBottom: '4px', fontFamily: "'Barlow Condensed',sans-serif", fontWeight: 600 }}>Risk factor</div>
            <div style={{ fontSize: '12px', color: '#7a8aaa', lineHeight: 1.55 }}>{pick.bear}</div>
          </div>
          <div>
            <div style={{ fontSize: '9px', color: '#3a4a6a', textTransform: 'uppercase', letterSpacing: '1.5px', marginBottom: '6px', fontFamily: "'Barlow Condensed',sans-serif", fontWeight: 600 }}>Stat category breakdown</div>
            {pick.cats && pick.cats.map((c, i) => {
              const cc = c.p >= 90 ? '#f5c842' : c.p >= 75 ? '#10b981' : '#7a8aaa'
              return (
                <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '5px' }}>
                  <span style={{ fontSize: '11px', color: '#7a8aaa' }}>{c.n}</span>
                  <span style={{ fontSize: '11px', fontWeight: 700, fontFamily: "'Barlow Condensed',sans-serif", color: cc }}>{c.p}%</span>
                </div>
              )
            })}
          </div>
        </div>
      )}

      <style>{`
        @keyframes goldPulse {
          0%,100% { box-shadow: 0 0 0 1px rgba(245,200,66,0.2), 0 6px 32px rgba(245,200,66,0.2); }
          50% { box-shadow: 0 0 0 2px rgba(245,200,66,0.5), 0 10px 48px rgba(245,200,66,0.45); }
        }
        @keyframes shimmerMove {
          0% { transform: translateX(-100%); }
          100% { transform: translateX(300%); }
        }
      `}</style>
    </div>
  )
}