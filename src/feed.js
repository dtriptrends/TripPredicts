// Shared season and data-feed status, read once from the server.
//
// The server decides which sport leads the app (SEASON_FOCUS in Railway) and
// which leagues have a live BALLDONTLIE feed right now (BALLDONTLIE_SPORTS
// plus a live health check). Every page reads it from here instead of keeping
// its own hardcoded list, so switching seasons or adding a data subscription
// never needs a frontend change, and no tab ever claims real data it does not
// have.

const SERVER = 'https://trippredicts-production-cfad.up.railway.app'

// Used if the server cannot be reached. Matches the server's own default.
const FALLBACK = { focus: ['NBA'], focusLabel: 'NBA', realLeagues: [], moneylineLeagues: [] }

let pending = null

export function getFeedStatus() {
  if (pending) return pending
  pending = (async () => {
    try {
      const ctrl = new AbortController()
      const timer = setTimeout(() => ctrl.abort(), 5000)
      const res = await fetch(`${SERVER}/feed-status`, { signal: ctrl.signal })
      clearTimeout(timer)
      if (!res.ok) throw new Error(`feed-status ${res.status}`)
      const d = await res.json()
      return {
        focus: Array.isArray(d.focus) && d.focus.length ? d.focus.map(s => String(s).toUpperCase()) : FALLBACK.focus,
        focusLabel: d.focusLabel || FALLBACK.focusLabel,
        realLeagues: Array.isArray(d.realLeagues) ? d.realLeagues.map(s => String(s).toUpperCase()) : [],
        moneylineLeagues: Array.isArray(d.moneylineLeagues) ? d.moneylineLeagues.map(s => String(s).toUpperCase()) : []
      }
    } catch (e) {
      // Let a later call try again instead of locking in the fallback.
      pending = null
      return FALLBACK
    }
  })()
  return pending
}

// League family helpers, matched by prefix because PrizePicks runs
// partial-game and season-long boards under their own labels
// (NBA1H, NBA1Q, NBASZN, NFL1H, CFB1H and so on).
export function isFootball(lg) {
  const l = String(lg || '').toUpperCase()
  return l.startsWith('NFL') || l.startsWith('CFB') || l.includes('FOOTBALL')
}

export function isBasketball(lg) {
  const l = String(lg || '').toUpperCase()
  return l.startsWith('NBA') || l.startsWith('WNBA') || l.startsWith('CBB') || l.startsWith('NCAAB') || l.includes('BASKETBALL')
}

export function isFocus(lg, focus) {
  const l = String(lg || '').toUpperCase()
  return (focus || FALLBACK.focus).some(f => l.startsWith(f))
}

// Tab order: ALL, then the focus sport and its variants, then football and
// its variants, then the base order, then anything else on the slate.
export function orderLeagues(leagueSet, baseOrder, focus) {
  const present = [...leagueSet].filter(Boolean).map(l => String(l).toUpperCase())
  const unique = [...new Set(present)].filter(l => l !== 'ALL')
  const rank = l => {
    if (isFocus(l, focus)) return 0
    if (isFootball(l)) return 1
    const i = baseOrder.indexOf(l)
    return i === -1 ? 1000 : 2 + i / 1000
  }
  // Within the focus and football groups, main boards come before variants
  // (NBA before NBA1H), using the base order, then alphabetical.
  const within = (a, b) => {
    const ia = baseOrder.indexOf(a), ib = baseOrder.indexOf(b)
    if (ia !== -1 || ib !== -1) return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib)
    return a.localeCompare(b)
  }
  unique.sort((a, b) => (rank(a) - rank(b)) || within(a, b))
  return ['ALL', ...unique]
}

// Icon shown on a league tab.
export function leagueIcon(lg) {
  if (isBasketball(lg)) return '🏀'
  if (isFootball(lg)) return '🏈'
  return null
}