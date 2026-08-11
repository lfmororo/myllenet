import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors'
import { createClient } from 'npm:@supabase/supabase-js@2'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )

    // 1. Fetch current status from Mikrotik
    const { data: statusResp, error: statusErr } = await supabase.functions.invoke('mikrotik-status')
    if (statusErr || !statusResp?.activeList) {
      throw new Error(statusErr?.message || 'Falha ao buscar status do Mikrotik')
    }

    const activeSessions = statusResp.activeList as any[]
    const now = new Date().toISOString()

    // 2. Fetch all customers to match user_pppoe -> customer_id
    const { data: customers } = await supabase
      .from('customers')
      .select('id, usuario_pppoe')
      .not('usuario_pppoe', 'is', null)

    if (!customers) return json({ message: 'Nenhum cliente para processar' })

    const customerMap = new Map(customers.map(c => [c.usuario_pppoe, c.id]))

    // 3. Process logs and check for drops
    const { data: lastLogs } = await supabase
      .from('pppoe_logs')
      .select('usuario_pppoe, uptime, rx_bytes, tx_bytes')
      .in('usuario_pppoe', activeSessions.map(s => s.name))
      .order('logged_at', { ascending: false })
      .limit(activeSessions.length * 2)

    const lastLogMap = new Map(lastLogs?.map(l => [l.usuario_pppoe, l]))

    const logs = []
    const drops = []

    for (const s of activeSessions) {
      if (!customerMap.has(s.name)) continue
      
      const customerId = customerMap.get(s.name)
      const lastLog = lastLogMap.get(s.name)
      
      // Check if it's a "drop" (reconnection)
      // If the current uptime is less than the previous uptime, it means it reconnected
      if (lastLog && s.uptime && lastLog.uptime) {
        // Simple string comparison for Mikrotik uptime (e.g., "1d02:03:04") might be tricky, 
        // but usually, if the connection is active, we just store stats.
        // A better way is to detect when a user is MISSING from active sessions (done in alerts)
        // or if we see a new session with a very small uptime.
      }

      logs.push({
        customer_id: customerId,
        usuario_pppoe: s.name,
        ip_address: s.address,
        uptime: s.uptime,
        rx_bytes: s.rx_bytes || 0,
        tx_bytes: s.tx_bytes || 0,
        event_type: 'stats',
        logged_at: now
      })
    }

    if (logs.length > 0) {
      const { error: insertErr } = await supabase.from('pppoe_logs').insert(logs)
      if (insertErr) throw insertErr
    }

    return json({ success: true, processed: logs.length })
  } catch (e) {
    return json({ error: (e as Error).message }, 500)
  }
})
