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
        {['tonight', 'gold'].map(t => (
          <button key={t} onClick={() => setTab(t)} style={{
            background: tab === t ? 'var(--bg4)' : 'none',
            border: 'none',
            color: tab === t ? (t === 'gold' ? 'var(--gold)' : 'var(--text)') : 'var(--text2)',
            fontFamily: 'var(--font-c)', fontSize: '13px', fontWeight: 600,
            letterSpacing: '1.5px', textTransform: 'uppercase',
            padding: '5px 16px', borderRadius: '20px', cursor: 'pointer', transition: 'all 0.2s'
          }}>
            {t === 'tonight' ? 'Tonight' : '★ Gold'}
          </button>
        ))}
      </div>

      <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '10px' }}>
        <button onClick={onAbout} style={{
          background: 'none', border: '1px solid var(--border2)', color: 'var(--text3)',
          fontFamily: 'var(--font)', fontSize: '11px', letterSpacing: '1px', textTransform: 'uppercase',
          padding: '4px 12px', borderRadius: '20px', cursor: 'pointer', transition: 'all 0.2s'
        }}>About</button>
      </div>
    </nav>
  )
}