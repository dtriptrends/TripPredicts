import React from 'react'

export default function Navbar({ tab, setTab, onAbout }) {
  return (
    <nav style={{
      height: '58px', background: 'rgba(7,9,15,0.97)', backdropFilter: 'blur(20px)',
      borderBottom: '1px solid var(--border)',
      display: 'flex', alignItems: 'center', padding: '0 24px', gap: '16px',
      position: 'sticky', top: 0, zIndex: 100, flexShrink: 0
    }}>
      <div style={{
        fontFamily: 'var(--font-d)', fontSize: '28px', letterSpacing: '3px',
        background: 'linear-gradient(90deg,var(--gold),#fff 70%)',
        WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', flexShrink: 0
      }}>TRIP PREDICTS</div>

      <div style={{ display: 'flex', gap: '2px', background: 'var(--bg3)', borderRadius: '24px', padding: '3px' }}>
        {['tonight', 'gold'].map(t => {
          const isGold = t === 'gold'
          const isActive = tab === t
          return (
            <div key={t} style={{ position: 'relative' }}>
              {/* Subtle premium glow + embers, only on the Gold tab */}
              {isGold && (
                <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', overflow: 'visible', zIndex: 0 }}>
                  {/* Warm flickering aura */}
                  <div style={{
                    position: 'absolute', inset: '-6px', borderRadius: '20px',
                    background: 'radial-gradient(ellipse at center, rgba(245,200,66,0.35) 0%, rgba(225,114,16,0.18) 45%, transparent 70%)',
                    filter: 'blur(6px)', animation: 'goldAura 2.4s ease-in-out infinite'
                  }} />
                  {/* Rising embers */}
                  <span style={{ position: 'absolute', left: '22%', bottom: '4px', width: '3px', height: '3px', borderRadius: '50%', background: '#ffcf5a', boxShadow: '0 0 4px #ffcf5a', animation: 'goldEmber 3.1s ease-in infinite', opacity: 0 }} />
                  <span style={{ position: 'absolute', left: '55%', bottom: '4px', width: '2px', height: '2px', borderRadius: '50%', background: '#ffba47', boxShadow: '0 0 4px #ffba47', animation: 'goldEmber 2.6s ease-in 0.8s infinite', opacity: 0 }} />
                  <span style={{ position: 'absolute', left: '78%', bottom: '4px', width: '2.5px', height: '2.5px', borderRadius: '50%', background: '#ffd97a', boxShadow: '0 0 4px #ffd97a', animation: 'goldEmber 3.4s ease-in 1.6s infinite', opacity: 0 }} />
                </div>
              )}

              <button onClick={() => setTab(t)} style={{
                position: 'relative', zIndex: 1,
                background: isActive ? 'var(--bg4)' : 'none',
                border: 'none',
                color: isActive ? (isGold ? 'var(--gold)' : 'var(--text)') : (isGold ? '#f5c842' : 'var(--text2)'),
                fontFamily: 'var(--font-c)', fontSize: '13px', fontWeight: 600,
                letterSpacing: '1.5px', textTransform: 'uppercase',
                padding: '5px 16px', borderRadius: '20px', cursor: 'pointer', transition: 'all 0.2s',
                textShadow: isGold ? '0 0 8px rgba(245,200,66,0.5)' : 'none'
              }}>
                {t === 'tonight' ? 'Tonight' : '★ Gold'}
              </button>
            </div>
          )
        })}
      </div>

      <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '10px' }}>
        <button onClick={onAbout} style={{
          background: 'none', border: '1px solid var(--border2)', color: 'var(--text3)',
          fontFamily: 'var(--font)', fontSize: '11px', letterSpacing: '1px', textTransform: 'uppercase',
          padding: '4px 12px', borderRadius: '20px', cursor: 'pointer', transition: 'all 0.2s'
        }}>About</button>
      </div>

      <style>{`
        @keyframes goldAura {
          0%, 100% { opacity: 0.55; transform: scale(1); }
          50% { opacity: 0.9; transform: scale(1.06); }
        }
        @keyframes goldEmber {
          0% { opacity: 0; transform: translateY(0) scale(1); }
          15% { opacity: 1; }
          100% { opacity: 0; transform: translateY(-22px) scale(0.4); }
        }
      `}</style>
    </nav>
  )
}