import { useState, useEffect } from 'react'
import { supabase } from './supabase'

export function useSubscription() {
  const [status, setStatus] = useState('loading') // 'loading' | 'active' | 'inactive'

  async function check() {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { setStatus('inactive'); return }

    const { data, error } = await supabase
      .from('subscriptions')
      .select('status, current_period_end')
      .eq('user_id', user.id)
      .maybeSingle()

    if (error || !data) { setStatus('inactive'); return }

    const active = data.status === 'active' || data.status === 'trialing'
    const notExpired = data.current_period_end ? new Date(data.current_period_end) > new Date() : false
    setStatus(active && notExpired ? 'active' : 'inactive')
  }

  useEffect(() => { check() }, [])

  return { status, recheck: check }
}