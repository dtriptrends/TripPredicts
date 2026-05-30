import React, { useState, useRef, useEffect } from 'react'

export default function Chat() {
  const [messages, setMessages] = useState([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [showSugs, setShowSugs] = useState(true)
  const bottomRef = useRef(null)
  const historyRef = useRef([])

  useEffect(() => {
    setMessages([{
      role: 'ai',
      text: `Welcome to **Trip Predicts** — your AI prop pick analyst.\n\nHere's what I can do:\n• **Analyze any pick** — ask about a player or line and I'll break it down with confidence, bull case, and bear case\n• **Build lineups** — say "give me a 6 man" and I'll find the strongest picks tonight across sports and esports\n• **Gold picks** — ask for only the elite 90%+ confidence plays\n• **Mixed slates** — I pull from NBA, WNBA, NFL, MLB, CS2, LoL, Valorant, and more\n\nWhat do you want to hit tonight?`
    }])
  }, [])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  function fmtText(text) {
    return text
      .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
      .replace(/\n/g, '<br/>')
  }

  async function handleSend(text) {
    if (busy || !text.trim()) return
    setShowSugs(false)
    setBusy(true)
    setInput('')

    setMessages(prev => [...prev, { role: 'user', text }, { role: 'typing' }])
    historyRef.current = [...historyRef.current, { role: 'user', content: text }]

    try {
      const res = await fetch('https://trippredicts-production.up.railway.app/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: historyRef.current })
      })
      const data = await res.json()
      if (!data.reply) throw new Error('No reply')

      historyRef.current = [...historyRef.current, { role: 'assistant', content: data.reply }]
      setMessages(prev => prev.filter(m => m.role !== 'typing'))

      const words = data.reply.split(' ')
      let i = 0
      setMessages(prev => [...prev, { role: 'ai', text: '' }])

      const interval = setInterval(() => {
        i++
        setMessages(prev => {
          const updated = [...prev]
          updated[updated.length - 1] = { role: 'ai', text: words.slice(0, i).join(' ') }
          return updated
        })
        if (i >= words.length) {
          clearInterval(interval)
          setBusy(false)
        }
      }, 26)
    } catch (e) {
      setMessages(prev => prev.filter(m => m.role !== 'typing'))
      setMessages(prev => [...prev, { role: 'ai', text: 'Connection issue. Make sure the server is running.' }])
      setBusy(false)
    }
  }

  function handleKey(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend(input)
    }
  }

  function grow(el) {
    el.style.height = 'auto'
    el.style.height = Math.min(el.scrollHeight, 120) + 'px'
  }

  const sugs = [
    'Build me a 6 man lineup for tonight',
    'Any gold picks tonight?',
    'What sports and esports do you cover?',
    'How does the confidence system work?',
    'Give me the best esports pick tonight',
  ]

  return (
    <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div style={{ flex: 1, overflowY: 'auto', padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
        {messages.map((m, i) => (
          <div key={i} style={{
            display: 'flex', gap: '10px', maxWidth: '82%',
            alignSelf: m.role === 'user' ? 'flex-end' : 'flex-start',
            flexDirection: m.role === 'user' ? 'row-reverse' : 'row'
          }}>
            <div style={{
              width: '34px', height: '34px', borderRadius: '50%', flexShrink: 0,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontFamily: 'var(--font-d)', fontSize: '11px', letterSpacing: '1px',
              background: m.role === 'user' ? 'var(--bg3)' : 'linear-gradient(135deg,var(--accent2),var(--accent))',
              border: m.role === 'user' ? '1px solid var(--border2)' : 'none',
              color: m.role === 'user' ? 'var(--text2)' : '#fff'
            }}>{m.role === 'user' ? 'U' : 'TP'}</div>
            <div style={{
              padding: '11px 15px', fontSize: '13px', lineHeight: 1.65, color: 'var(--text)',
              background: m.role === 'user' ? 'var(--accent2)' : 'var(--card)',
              border: m.role !== 'user' ? '1px solid var(--border)' : 'none',
              borderRadius: m.role === 'user' ? '14px 2px 14px 14px' : '2px 14px 14px 14px'
            }}>
              {m.role === 'typing'
                ? <div style={{ display: 'flex', gap: '4px', alignItems: 'center', padding: '4px 0' }}>
                    {[0, 1, 2].map(j => (
                      <div key={j} style={{
                        width: '6px', height: '6px', background: 'var(--text3)', borderRadius: '50%',
                        animation: `dotPulse 1.3s ${j * 0.2}s infinite`
                      }} />
                    ))}
                  </div>
                : <div dangerouslySetInnerHTML={{ __html: fmtText(m.text) }} />
              }
            </div>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      {showSugs && (
        <div style={{ padding: '0 24px 12px', display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
          {sugs.map((s, i) => (
            <button key={i} onClick={() => handleSend(s)} style={{
              background: 'var(--bg3)', border: '1px solid var(--border)', color: 'var(--text2)',
              fontFamily: 'var(--font)', fontSize: '12px', padding: '6px 14px', borderRadius: '20px',
              cursor: 'pointer', transition: 'all 0.2s', letterSpacing: '0.3px'
            }}>{s}</button>
          ))}
        </div>
      )}

      <div style={{ padding: '12px 16px', borderTop: '1px solid var(--border)', background: 'var(--bg2)', display: 'flex', gap: '10px', alignItems: 'flex-end' }}>
        <textarea
          value={input}
          onChange={e => { setInput(e.target.value); grow(e.target) }}
          onKeyDown={handleKey}
          placeholder="Ask about a pick, build a lineup, find gold plays..."
          rows={1}
          style={{
            flex: 1, background: 'var(--bg3)', border: '1px solid var(--border)', borderRadius: '12px',
            padding: '10px 14px', color: 'var(--text)', fontFamily: 'var(--font)', fontSize: '13px',
            resize: 'none', outline: 'none', maxHeight: '120px', minHeight: '44px', lineHeight: 1.4
          }}
        />
        <button onClick={() => handleSend(input)} style={{
          width: '44px', height: '44px', borderRadius: '12px',
          background: 'var(--accent2)', border: 'none', cursor: 'pointer', flexShrink: 0,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: '18px', color: '#fff'
        }}>↑</button>
      </div>

      <style>{`@keyframes dotPulse{0%,80%,100%{opacity:0.2;transform:scale(1);}40%{opacity:1;transform:scale(1.2);}}`}</style>
    </div>
  )
}