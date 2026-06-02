import { createClient } from '@supabase/supabase-js'

const supabaseUrl = 'https://cthdkdjggxmkpcqdlafm.supabase.co'
const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImN0aGRrZGpnZ3hta3BjcWRsYWZtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA0MjA0NTQsImV4cCI6MjA5NTk5NjQ1NH0.0EtiHywLJ1QkyttQY2hVxw1EV4wJ11nQxt6u0Nnsxb8'

export const supabase = createClient(supabaseUrl, supabaseAnonKey)