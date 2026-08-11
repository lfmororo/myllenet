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

    // 3. Process logs
    // We'll store:
    // - Bandwidth snapshots (hourly or every sync)
    // - Session events (connected/disconnected)
    
    // For bandwidth, we need interface stats which mikrotik-status doesn't have yet.
    // For now, let's just log the presence in activeList as "online" events.
    
    // Get last state from a cache or table? 
    // Let's just record the current active sessions in a "pppoe_sessions" log table
    
    const logs = activeSessions
      .filter(s => customerMap.has(s.name))
      .map(s => ({
        customer_id: customerMap.get(s.name),
        usuario_pppoe: s.name,
        ip_address: s.address,
        uptime: s.uptime,
        event_type: 'connected',
        logged_at: now
      }))

    if (logs.length > 0) {
      await supabase.from('pppoe_logs').insert(logs)
    }

    return json({ success: true, processed: logs.length })
  } catch (e) {
    return json({ error: (e as Error).message }, 500)
  }
})
