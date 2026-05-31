import React, { useEffect, useState } from 'react'
import PickCard from './PickCard'

const SERVER = 'https://trippredicts-production-cfad.up.railway.app'

async function fetchPrizePicksLines() {
  const results = []
  try {
    const res = await fetch(`${SERVER}/prizepicks/all`)
    const data = await res.json()
    if (!data.data || !data.included) return results
    const players = {}
    data.included.forEach(item => {
      if (item.type === 'new_player') {
        players[item.id] = {
          name: item.attributes.display_name || item.attributes.name,
          team: item.attributes.team,
          league: item.attributes.league,
          image: item.attributes.image_url
        }
      }
    })
    const now = new Date()
    data.data.forEach(proj => {
      const startTime = new Date(proj.attributes.start_time)
      const hoursUntil = (startTime - now) / (1000 * 60 * 60)
      if (proj.attributes.status !== 'pre_game') return
      if (hoursUntil < 0 || hoursUntil > 36) return
      const playerId = proj.relationships?.new_player?.data?.id
      const player = players[playerId]
      if (!player || !player.name) return
      results.push({
        name: player.name,
        team: player.team,
        league: player.league,
        image: player.image,
        stat: proj.attributes.stat_display_name,
        line: proj.attributes.line_score,
        start_time: startTime.toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit', hour12: true }) + ' ET',
        date: startTime.toLocaleDateString('en-US', { timeZone: 'America/New_York', weekday: 'short', month: 'short', day: 'numeric' })
      })
    })
  } catch (e) {
    console.log('Fetch error:', e.message)
  }
  return results
}

export default function Gold() {
  const [picks, setPicks] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const now = new Date()
  const currentTime = now.toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit', hour12: true })

  useEffect(() => {
    const t = setTimeout(() => loadPicks(), 2000)
    return () => clearTimeout(t)
  }, [])

  async function loadPicks() {
    setLoading(true)
    setError(null)
    setPicks([])
    try {
      const lines = await fetchPrizePicksLines()
      if (lines.length === 0) throw new Error('No live props on PrizePicks right now. Check back soon.')

      const res = await fetch(`${SERVER}/gold`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentTime, lines })
      })
      const data = await res.json()
      if (!data.picks) throw new Error(data.error || 'No gold picks found')

      const imageMap = {}
      lines.forEach(l => { if (l.image) imageMap[l.name] = l.image })
      data.picks.forEach(p => { if (!p.image && imageMap[p.name]) p.image = imageMap[p.name] })

      setPicks(data.picks)
    } catch (e) {
      setError(e.message || 'No gold picks available right now. Check back later.')
    }
    setLoading(false)
  }

  return (
    <div style={{ width: '100%', height: '100%', overflowY: 'auto', padding: '24px', display: 'flex', flexDirection: 'column', gap: '24px' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
        <div>
          <div style={{ fontFamily: 'var(--font-d)', fontSize: '32px', letterSpacing: '2px', lineHeight: 1, background: 'linear-gradient(90deg,#d4a017,#f5c842,#fff0a0)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>★ GOLD PICKS</div>
          <div style={{ fontSize: '12px', color: 'var(--text2)', marginTop: '4px' }}>90%+ confidence · Strongest plays available right now</div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          {!loading && (
            <button onClick={loadPicks} style={{ background: 'none', border: '1px solid var(--border2)', color: 'var(--text2)', fontFamily: 'var(--font)', fontSize: '11px', padding: '5px 12px', borderRadius: '20px', cursor: 'pointer', letterSpacing: '1px' }}>Refresh</button>
          )}
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', background: 'rgba(245,200,66,0.1)', border: '1px solid rgba(245,200,66,0.25)', color: 'var(--gold)', fontSize: '11px', fontWeight: 600, letterSpacing: '1.5px', textTransform: 'uppercase', padding: '5px 12px', borderRadius: '20px' }}>
            <div style={{ width: '6px', height: '6px', borderRadius: '50%', background: 'var(--gold)', animation: 'pulse 1.5s infinite' }} />LIVE
          </div>
        </div>
      </div>

      {loading && (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '80px 0', gap: '16px' }}>
          <div style={{ fontFamily: 'var(--font-d)', fontSize: '22px', letterSpacing: '2px', color: 'var(--gold)' }}>HUNTING GOLD PICKS</div>
          <div style={{ fontSize: '13px', color: 'var(--text2)' }}>Searching for 90%+ confidence plays...</div>
          <div style={{ display: 'flex', gap: '8px', marginTop: '8px' }}>
            {[0, 1, 2].map(i => (
              <div key={i} style={{ width: '8px', height: '8px', borderRadius: '50%', background: 'var(--gold)', animation: `dotPulse 1.3s ${i * 0.2}s infinite` }} />
            ))}
          </div>
        </div>
      )}

      {error && !loading && (
        <div style={{ textAlign: 'center', padding: '80px 0' }}>
          <div style={{ fontSize: '14px', color: 'var(--text2)', marginBottom: '16px', lineHeight: 1.6 }}>{error}</div>
          <button onClick={loadPicks} style={{ background: 'var(--accent2)', border: 'none', color: '#fff', fontFamily: 'var(--font)', fontSize: '13px', padding: '10px 24px', borderRadius: '10px', cursor: 'pointer' }}>Retry</button>
        </div>
      )}

      {!loading && !error && picks.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(220px,1fr))', gap: '16px' }}>
          {picks.map((p, i) => <PickCard key={p.id} pick={p} delay={i * 100} />)}
        </div>
      )}

      {!loading && !error && picks.length === 0 && (
        <div style={{ textAlign: 'center', padding: '80px 0' }}>
          <div style={{ fontFamily: 'var(--font-d)', fontSize: '22px', letterSpacing: '2px', color: 'var(--text2)', marginBottom: '8px' }}>NO GOLD PICKS RIGHT NOW</div>
          <div style={{ fontSize: '13px', color: 'var(--text3)', marginBottom: '20px' }}>Gold picks are rare — 90%+ confidence only. Check back later.</div>
          <button onClick={loadPicks} style={{ background: 'none', border: '1px solid var(--border2)', color: 'var(--text2)', fontFamily: 'var(--font)', fontSize: '13px', padding: '10px 24px', borderRadius: '10px', cursor: 'pointer' }}>Check Again</button>
        </div>
      )}

      <style>{`
        @keyframes pulse{0%,100%{opacity:1;}50%{opacity:0.3;}}
        @keyframes dotPulse{0%,80%,100%{opacity:0.2;transform:scale(1);}40%{opacity:1;transform:scale(1.2);}}
      `}</style>
    </div>
  )
}