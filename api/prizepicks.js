export default async function handler(req, res) {
  const { leagueId } = req.query
  try {
    const response = await fetch(
      `https://api.prizepicks.com/projections?league_id=${leagueId}&per_page=50&single_stat=true`,
      {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'application/json',
          'Referer': 'https://app.prizepicks.com/',
          'Origin': 'https://app.prizepicks.com'
        }
      }
    )
    const data = await response.json()
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.json(data)
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
}