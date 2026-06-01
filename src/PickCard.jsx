import React, { useState, useEffect } from 'react'

function tierOf(c) { return c >= 90 ? 'gold' : c >= 75 ? 'high' : 'regular' }

const LEAGUE_COLORS = {
  'NBA':      { bg: 'rgba(225,114,16,0.15)',  color: '#e17210', border: 'rgba(225,114,16,0.3)' },
  'MLB':      { bg: 'rgba(74,144,217,0.12)',  color: '#4a90d9', border: 'rgba(74,144,217,0.3)' },
  'NHL':      { bg: 'rgba(255,255,255,0.08)', color: '#aab4cc', border: 'rgba(255,255,255,0.15)' },
  'NFL':      { bg: 'rgba(74,144,217,0.12)',  color: '#4a90d9', border: 'rgba(74,144,217,0.3)' },
  'WNBA':     { bg: 'rgba(255,105,0,0.12)',   color: '#ff6900', border: 'rgba(255,105,0,0.25)' },
  'CS2':      { bg: 'rgba(0,180,216,0.12)',   color: '#00b4d8', border: 'rgba(0,180,216,0.25)' },
  'LOL':      { bg: 'rgba(200,155,60,0.12)',  color: '#c89b3c', border: 'rgba(200,155,60,0.25)' },
  'VALORANT': { bg: 'rgba(255,70,85,0.12)',   color: '#ff4655', border: 'rgba(255,70,85,0.25)' },
  'COD':      { bg: 'rgba(0,230,118,0.12)',   color: '#00e676', border: 'rgba(0,230,118,0.25)' },
}

const FLAME_CONFIGS = [
  { left: '5%',  w: 14, h: 28, dur: '0.60s', delay: '0.00s', type: 0 },
  { left: '16%', w: 20, h: 42, dur: '0.85s', delay: '0.10s', type: 1 },
  { left: '27%', w: 12, h: 24, dur: '0.50s', delay: '0.05s', type: 2 },
  { left: '38%', w: 22, h: 48, dur: '0.70s', delay: '0.18s', type: 0 },
  { left: '50%', w: 16, h: 34, dur: '0.55s', delay: '0.08s', type: 1 },
  { left: '61%', w: 24, h: 52, dur: '0.90s', delay: '0.14s', type: 2 },
  { left: '73%', w: 14, h: 30, dur: '0.65s', delay: '0.03s', type: 0 },
  { left: '83%', w: 18, h: 38, dur: '0.75s', delay: '0.12s', type: 1 },
]

const FLAME_GRADIENTS = [
  'radial-gradient(ellipse at bottom, rgba(255,25,0,0.95), rgba(255,85,0,0.6) 40%, transparent 80%)',
  'radial-gradient(ellipse at bottom, rgba(255,85,0,0.9), rgba(255,155,0,0.5) 42%, transparent 80%)',
  'radial-gradient(ellipse at bottom, rgba(255,150,0,0.85), rgba(255,210,50,0.4) 45%, transparent 80%)',
]

export default function PickCard({ pick, delay = 0 }) {
  const [revealed, setRevealed] = useState(false)
  const [barWidth, setBarWidth] = useState(0)
  const [infoOpen, setInfoOpen] = useState(false)
  const t = tierOf(pick.conf)
  const up = pick.dir === 'HIGHER'
  const league = (pick.league || pick.sport || '').toUpperCase()
  const lc = LEAGUE_COLORS[league] || { bg: 'rgba(255,255,255,0.06)', color: '#7a8aaa', border: 'rgba(255,255,255,0.1)' }

  useEffect(() => {
    const t1 = setTimeout(() => setRevealed(true), delay)
    const t2 = setTimeout(() => setBarWidth(pick.conf), delay + 400)
    return () => { clearTimeout(t1); clearTimeout(t2) }
  }, [])

  const borderColor = t === 'gold' ? '#c85000' : t === 'high' ? 'rgba(16,185,129,0.3)' : 'rgba(255,255,255,0.06)'
  const confColor = t === 'gold' ? '#f5c842' : t === 'high' ? '#10b981' : '#7a8aaa'
  const fillBg = t === 'gold' ? 'linear-gradient(90deg,#d4a017,#f5c842,#fff0a0)' : t === 'high' ? '#10b981' : '#3a4a6a'

  return (
    <div style={{
      background: t === 'gold' ? 'linear-gradient(180deg,#0f1520 55%,#1c0800 100%)' : '#0f1520',
      border: `1px solid ${borderColor}`,
      borderRadius: '16px',
      overflow: 'hidden',
      position: 'relative',
      opacity: revealed ? 1 : 0,
      transform: revealed ? 'translateY(0)' : 'translateY(24px)',
      transition: t === 'gold'
        ? 'opacity 0.5s ease, transform 0.7s cubic-bezier(0.16,1,0.3,1)'
        : 'opacity 0.4s ease, transform 0.4s ease',
      boxShadow: revealed && t === 'gold' ? '0 0 0 1px rgba(200,50,0,0.35), 0 8px 40px rgba(255,70,0,0.2)' : 'none',
      animation: revealed && t === 'gold' ? 'firePulse 2s 0.7s ease infinite' : 'none'
    }}>

      {/* Image */}
      <div style={{ height: '130px', background: '#111722', display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative', overflow: 'hidden' }}>
        {pick.image
          ? <img src={pick.image} alt={pick.name} style={{ width: '100%', height: '100%', objectFit: 'cover', objectPosition: 'center top' }} />
          : <div style={{
              width: '72px', height: '72px', borderRadius: '50%',
              background: t === 'gold' ? 'linear-gradient(135deg,#2a1000,#180800)' : 'linear-gradient(135deg,#161e2e,#0c1018)',
              border: t === 'gold' ? '2px solid rgba(255,100,0,0.35)' : '2px solid rgba(255,255,255,0.08)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontFamily: "'Bebas Neue',sans-serif", fontSize: '24px',
              color: t === 'gold' ? '#f5a030' : '#7a8aaa', letterSpacing: '1px'
            }}>{pick.initials}</div>
        }

        {/* Tier badge */}
        <div style={{
          position: 'absolute', top: '8px', right: '8px',
          fontFamily: "'Barlow Condensed',sans-serif", fontSize: '10px', fontWeight: 700,
          letterSpacing: '1.5px', textTransform: 'uppercase',
          padding: '3px 9px', borderRadius: '10px',
          background: t === 'gold'
            ? 'linear-gradient(90deg,#c84000,#f59000)'
            : t === 'high' ? 'rgba(16,185,129,0.12)' : 'rgba(255,255,255,0.07)',
          color: t === 'gold' ? '#fff' : t === 'high' ? '#10b981' : '#3a4a6a',
          border: t === 'gold' ? '1px solid rgba(255,110,0,0.5)' : t === 'high' ? '1px solid rgba(16,185,129,0.25)' : 'none',
          boxShadow: t === 'gold' ? '0 0 10px rgba(255,90,0,0.45)' : 'none'
        }}>{t === 'gold' ? '🔥 GOLD' : t === 'high' ? 'HIGH' : 'PICK'}</div>

        {/* Watermark */}
        <div style={{ position: 'absolute', bottom: '7px', left: '8px', fontFamily: "'Bebas Neue',sans-serif", fontSize: '8px', letterSpacing: '1.5px', color: 'rgba(255,255,255,0.08)', zIndex: 3 }}>TRIP PREDICTS</div>

        {/* League badge */}
        <div style={{
          position: 'absolute', bottom: '6px', right: '8px', zIndex: 3,
          fontFamily: "'Barlow Condensed',sans-serif", fontSize: '10px', fontWeight: 700,
          letterSpacing: '1px', textTransform: 'uppercase',
          padding: '2px 7px', borderRadius: '6px',
          background: lc.bg, color: lc.color, border: `1px solid ${lc.border}`
        }}>{league || pick.sport}</div>

        {/* Gold shimmer */}
        {t === 'gold' && revealed && (
          <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', overflow: 'hidden', zIndex: 1 }}>
            <div style={{ position: 'absolute', top: 0, left: 0, width: '45%', height: '100%', background: 'linear-gradient(105deg,transparent,rgba(255,150,50,0.09),transparent)', animation: 'shimmerMove 2.5s 0.8s ease infinite' }} />
          </div>
        )}

        {/* Fire particles */}
        {t === 'gold' && revealed && (
          <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: '65px', pointerEvents: 'none', zIndex: 2 }}>
            {FLAME_CONFIGS.map((fc, i) => (
              <div key={i} style={{
                position: 'absolute', bottom: 0, left: fc.left,
                width: `${fc.w}px`, height: `${fc.h}px`,
                background: FLAME_GRADIENTS[fc.type],
                borderRadius: '50% 50% 20% 20%',
                filter: 'blur(3.5px)',
                animation: `flicker${fc.type} ${fc.dur} ${fc.delay} ease-in-out infinite alternate`,
              }} />
            ))}
            {/* Base glow */}
            <div style={{
              position: 'absolute', bottom: 0, left: '5%', right: '5%', height: '20px',
              background: 'radial-gradient(ellipse at bottom, rgba(255,55,0,0.55), rgba(255,110,0,0.2) 55%, transparent 80%)',
              filter: 'blur(7px)'
            }} />
            {/* Bottom dark overlay to blend flames into card */}
            <div style={{
              position: 'absolute', bottom: 0, left: 0, right: 0, height: '40px',
              background: 'linear-gradient(to top, rgba(160,35,0,0.3), transparent)'
            }} />
          </div>
        )}
      </div>

      {/* Content */}
      <div style={{ padding: '12px 13px 10px' }}>
        <div style={{ fontFamily: "'Barlow Condensed',sans-serif", fontSize: '15px', fontWeight: 700, color: '#eef2ff', letterSpacing: '0.5px', lineHeight: 1.1 }}>{pick.name}</div>
        <div style={{ fontSize: '11px', color: '#7a8aaa', marginTop: '2px' }}>{pick.meta}</div>
        {(pick.time || pick.date) && (
          <div style={{ fontSize: '10px', color: t === 'gold' ? '#ff9944' : '#f5c842', marginTop: '3px', marginBottom: '8px', fontFamily: "'Barlow Condensed',sans-serif", fontWeight: 600, letterSpacing: '0.5px' }}>
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
          background: t === 'gold' ? 'rgba(255,70,0,0.05)' : 'rgba(255,255,255,0.03)',
          border: t === 'gold' ? '1px solid rgba(255,70,0,0.15)' : '1px solid rgba(255,255,255,0.06)',
          borderRadius: '8px',
          color: t === 'gold' ? 'rgba(255,130,0,0.7)' : '#3a4a6a',
          fontFamily: "'Barlow',sans-serif", fontSize: '11px', fontWeight: 500,
          letterSpacing: '0.5px', cursor: 'pointer', transition: 'all 0.2s'
        }}>{infoOpen ? 'Hide Info ▴' : 'View Info ▾'}</button>
      </div>

      {infoOpen && (
        <div style={{ padding: '12px 13px', borderTop: `1px solid ${t === 'gold' ? 'rgba(255,70,0,0.12)' : 'rgba(255,255,255,0.06)'}`, background: t === 'gold' ? '#150900' : '#111722' }}>
          <div style={{ marginBottom: '10px' }}>
            <div style={{ fontSize: '9px', color: t === 'gold' ? 'rgba(255,120,0,0.6)' : '#3a4a6a', textTransform: 'uppercase', letterSpacing: '1.5px', marginBottom: '4px', fontFamily: "'Barlow Condensed',sans-serif", fontWeight: 600 }}>Why it's strong</div>
            <div style={{ fontSize: '12px', color: '#7a8aaa', lineHeight: 1.55 }}>{pick.bull}</div>
          </div>
          <div style={{ marginBottom: '10px' }}>
            <div style={{ fontSize: '9px', color: t === 'gold' ? 'rgba(255,120,0,0.6)' : '#3a4a6a', textTransform: 'uppercase', letterSpacing: '1.5px', marginBottom: '4px', fontFamily: "'Barlow Condensed',sans-serif", fontWeight: 600 }}>Risk factor</div>
            <div style={{ fontSize: '12px', color: '#7a8aaa', lineHeight: 1.55 }}>{pick.bear}</div>
          </div>
          <div>
            <div style={{ fontSize: '9px', color: t === 'gold' ? 'rgba(255,120,0,0.6)' : '#3a4a6a', textTransform: 'uppercase', letterSpacing: '1.5px', marginBottom: '6px', fontFamily: "'Barlow Condensed',sans-serif", fontWeight: 600 }}>Stat category breakdown</div>
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
        @keyframes firePulse {
          0%   { box-shadow: 0 0 0 1px rgba(200,45,0,0.4),  0 6px 32px rgba(255,55,0,0.22),  0 0 18px rgba(255,75,0,0.12); }
          25%  { box-shadow: 0 0 0 2px rgba(255,85,0,0.5),  0 10px 48px rgba(255,115,0,0.28), 0 0 28px rgba(255,130,0,0.18); }
          50%  { box-shadow: 0 0 0 1px rgba(255,145,0,0.42), 0 8px 40px rgba(255,175,0,0.26), 0 0 24px rgba(245,195,60,0.18); }
          75%  { box-shadow: 0 0 0 2px rgba(255,85,0,0.5),  0 10px 48px rgba(255,115,0,0.28), 0 0 28px rgba(255,100,0,0.18); }
          100% { box-shadow: 0 0 0 1px rgba(200,45,0,0.4),  0 6px 32px rgba(255,55,0,0.22),  0 0 18px rgba(255,75,0,0.12); }
        }
        @keyframes shimmerMove {
          0% { transform: translateX(-100%); }
          100% { transform: translateX(300%); }
        }
        @keyframes flicker0 {
          from { transform: scaleX(1)    translateY(2px)  rotate(-4deg); opacity: 0.9; }
          to   { transform: scaleX(0.55) translateY(-15px) rotate(5deg);  opacity: 0.08; }
        }
        @keyframes flicker1 {
          from { transform: scaleX(0.85) translateY(0px)  rotate(3deg);  opacity: 1; }
          to   { transform: scaleX(1.3)  translateY(-19px) rotate(-6deg); opacity: 0.08; }
        }
        @keyframes flicker2 {
          from { transform: scaleX(1.2)  translateY(1px)  rotate(-2deg); opacity: 0.85; }
          to   { transform: scaleX(0.65) translateY(-12px) rotate(7deg);  opacity: 0.05; }
        }
      `}</style>
    </div>
  )
}