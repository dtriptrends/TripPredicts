import React, { useEffect, useState } from 'react'

const SERVER = 'https://trippredicts-production-cfad.up.railway.app'

const LEAGUE_ORDER = ['ALL', 'MLB', 'WNBA']

function fmtOdds(n) {
  if (n == null) return '—'
  return n > 0 ? `+${n}` : `${n}`
}

function fmtTime(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  if (isNaN(d.getTime())) return ''
  return d.toLocaleString('en-US', { timeZone: 'America/New_York', weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true }) + ' ET'
}

function vendorLabel(v) {
  if (!v) return ''
  return v.charAt(0).toUpperCase() + v.slice(1)
}

function GameCard({ g }) {
  const homeFav = g.favorite === 'home'
  return (
    <div style={{
      background: 'rgba(13,18,28,0.92)', border: '1px solid rgba(255,255,255,0.06)',
      borderRadius: '16px', overflow: 'hidden', backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 13px', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
        <span style={{ fontFamily: 'var(--font-c)', fontSize: '11px', fontWeight: 700, letterSpacing: '1px', color: '#7a8aaa' }}>{g.league}</span>
        <span style={{ fontSize: '10px', color: '#3a4a6a' }}>{fmtTime(g.date)}</span>
      </div>

      <div style={{ padding: '13px' }}>
        {/* Away team row */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0 }}>
            {!homeFav && <span style={{ fontSize: '9px', color: '#f5c842' }}>★</span>}
            <div style={{ fontFamily: 'var(--font-d)', fontSize: '15px', fontWeight: 700, color: '#eef2ff', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{g.awayTeam}</div>
          </div>
          <div style={{ textAlign: 'right', flexShrink: 0, marginLeft: '10px' }}>
            <div style={{ fontFamily: 'var(--font-c)', fontSize: '16px', fontWeight: 700, color: !homeFav ? '#f5c842' : '#eef2ff' }}>{fmtOdds(g.awayOdds)}</div>
            <div style={{ fontSize: '9px', color: '#7a8aaa' }}>{g.awayImpliedPct != null ? `${g.awayImpliedPct}%` : ''} · {vendorLabel(g.awayVendor)}</div>
          </div>
        </div>

        {/* Home team row */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0 }}>
            {homeFav && <span style={{ fontSize: '9px', color: '#f5c842' }}>★</span>}
            <div style={{ fontFamily: 'var(--font-d)', fontSize: '15px', fontWeight: 700, color: '#eef2ff', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{g.homeTeam}</div>
            <span style={{ fontSize: '9px', color: '#3a4a6a' }}>(Home)</span>
          </div>
          <div style={{ textAlign: 'right', flexShrink: 0, marginLeft: '10px' }}>
            <div style={{ fontFamily: 'var(--font-c)', fontSize: '16px', fontWeight: 700, color: homeFav ? '#f5c842' : '#eef2ff' }}>{fmtOdds(g.homeOdds)}</div>
            <div style={{ fontSize: '9px', color: '#7a8aaa' }}>{g.homeImpliedPct != null ? `${g.homeImpliedPct}%` : ''} · {vendorLabel(g.homeVendor)}</div>
          </div>
        </div>
      </div>

      <div style={{ padding: '7px 13px', background: 'rgba(255,255,255,0.02)', borderTop: '1px solid rgba(255,255,255,0.05)' }}>
        <div style={{ fontSize: '9px', color: '#3a4a6a' }}>Best price shown per side across every book tracked. Real live odds, not estimated.</div>
      </div>

      {g.analysisNote && (
        <div style={{ padding: '10px 13px', borderTop: '1px solid rgba(255,255,255,0.06)' }}>
          <div style={{ fontSize: '9px', color: '#7a8aaa', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: '4px', fontFamily: 'var(--font-c)' }}>Analyst</div>
          <div style={{ fontSize: '12px', color: '#9aabcf', lineHeight: 1.5 }}>{g.analysisNote}</div>
        </div>
      )}

      {g.riskFlag && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '8px 13px', background: 'rgba(239,68,68,0.08)', borderTop: '1px solid rgba(239,68,68,0.2)' }}>
          <span style={{ fontSize: '11px' }}>⚠</span>
          <span style={{ fontSize: '11px', color: '#ff6b6b', fontWeight: 600 }}>{g.riskFlag}</span>
        </div>
      )}
    </div>
  )
}

export default function Moneylines() {
  const [allGames, setAllGames] = useState([])
  const [selectedLeague, setSelectedLeague] = useState('ALL')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`${SERVER}/moneylines`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentTime: new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }) })
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Could not load moneylines')
      setAllGames(data.games || [])
    } catch (e) {
      setError(e.message || 'Could not load moneylines')
      setAllGames([])
    }
    setLoading(false)
  }

  const availableLeagues = LEAGUE_ORDER.filter(l => l === 'ALL' || allGames.some(g => g.league === l))
  const displayGames = selectedLeague === 'ALL' ? allGames : allGames.filter(g => g.league === selectedLeague)

  return (
    <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden', background: 'var(--bg, #0a0e14)' }}>
      <div style={{ padding: '18px 20px 0', display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexShrink: 0 }}>
        <div>
          <div style={{ fontFamily: 'var(--font-d)', fontSize: '26px', letterSpacing: '1px', color: '#eef2ff', lineHeight: 1 }}>MONEYLINES</div>
          <div style={{ fontSize: '11px', color: '#7a8aaa', marginTop: '4px' }}>Real odds, best price across every book · Not scraped, not estimated</div>
        </div>
        {!loading && <button onClick={load} style={{ background: 'none', border: '1px solid rgba(255,255,255,0.1)', color: '#7a8aaa', fontFamily: 'var(--font-c)', fontSize: '11px', padding: '5px 12px', borderRadius: '7px', cursor: 'pointer', letterSpacing: '1px' }}>Refresh</button>}
      </div>

      {availableLeagues.length > 0 && (
        <div style={{ padding: '14px 20px 0', flexShrink: 0 }}>
          <div style={{ display: 'flex', gap: '8px' }}>
            {availableLeagues.map(lg => {
              const isActive = selectedLeague === lg
              const count = lg === 'ALL' ? allGames.length : allGames.filter(g => g.league === lg).length
              return (
                <button key={lg} onClick={() => setSelectedLeague(lg)} style={{
                  background: isActive ? 'rgba(245,200,66,0.12)' : 'rgba(255,255,255,0.03)',
                  border: `1px solid ${isActive ? '#f5c842' : 'rgba(255,255,255,0.08)'}`,
                  color: isActive ? '#f5c842' : '#7a8aaa',
                  fontFamily: 'var(--font-c)', fontSize: '12px', fontWeight: 700, letterSpacing: '1px',
                  padding: '8px 14px', borderRadius: '20px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px',
                }}>
                  {lg}
                  {count > 0 && <span style={{ background: isActive ? 'rgba(245,200,66,0.25)' : 'rgba(255,255,255,0.08)', color: isActive ? '#f5c842' : '#7a8aaa', fontSize: '10px', padding: '1px 6px', borderRadius: '10px' }}>{count}</span>}
                </button>
              )
            })}
          </div>
        </div>
      )}

      {loading && (
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ fontFamily: 'var(--font-c)', fontSize: '13px', letterSpacing: '2px', color: '#f5c842' }}>PULLING ODDS + RUNNING ANALYST...</div>
        </div>
      )}

      {error && !loading && (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '40px', textAlign: 'center' }}>
          <div style={{ fontSize: '14px', color: '#7a8aaa', marginBottom: '16px', lineHeight: 1.6 }}>{error}</div>
          <button onClick={load} style={{ background: '#f5c842', border: 'none', color: '#100b02', fontFamily: 'var(--font-c)', fontWeight: 700, fontSize: '13px', padding: '10px 24px', borderRadius: '8px', cursor: 'pointer' }}>Retry</button>
        </div>
      )}

      {!loading && !error && displayGames.length === 0 && (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '40px', textAlign: 'center' }}>
          <div style={{ fontSize: '14px', color: '#7a8aaa', marginBottom: '8px' }}>No moneylines available right now.</div>
          <div style={{ fontSize: '12px', color: '#3a4a6a' }}>Check back closer to game time, or try another league.</div>
        </div>
      )}

      {!loading && !error && displayGames.length > 0 && (
        <div style={{ flex: 1, overflowY: 'auto', padding: '14px 20px 24px' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '14px' }}>
            {displayGames.map(g => <GameCard key={g.id} g={g} />)}
          </div>
        </div>
      )}
    </div>
  )
}