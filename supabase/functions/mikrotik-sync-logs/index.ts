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
    const logs = activeSessions
      .filter(s => customerMap.has(s.name))
      .map(s => ({
        customer_id: customerMap.get(s.name),
        usuario_pppoe: s.name,
        ip_address: s.address,
        uptime: s.uptime,
        rx_bytes: s.rx_bytes || 0,
        tx_bytes: s.tx_bytes || 0,
        event_type: 'stats',
        logged_at: now
      }))

    if (logs.length > 0) {
      const { error: insertErr } = await supabase.from('pppoe_logs').insert(logs)
      if (insertErr) throw insertErr
    }

    return json({ success: true, processed: logs.length })
  } catch (e) {
    return json({ error: (e as Error).message }, 500)
  }
})
