import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.38.4'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-agent-token',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )

  try {
    const token = req.headers.get('x-agent-token') || ''
    if (!token) return json({ success: false, error: 'Token do agente ausente' }, 401)

    const { data: agent } = await supabase
      .from('agent_tokens')
      .select('id, active, name')
      .eq('token', token)
      .maybeSingle()

    if (!agent || !agent.active) return json({ success: false, error: 'Token inválido ou inativo' }, 401)

    const ip =
      req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
      req.headers.get('cf-connecting-ip') ||
      null

    await supabase
      .from('agent_tokens')
      .update({ last_seen_at: new Date().toISOString(), last_ip: ip })
      .eq('id', agent.id)

    const body = await req.json().catch(() => ({}))

    // Support batched payloads: { batch: [payload, payload, ...] } or a single payload
    const payloads: any[] = Array.isArray(body?.batch) ? body.batch : [body]

    const result = { wan: 0, pppoe: 0, status: 0, unknown_pppoe: [] as string[] }

    // Cache PPPoE -> customer id
    const { data: customers } = await supabase
      .from('customers')
      .select('id, usuario_pppoe')
      .not('usuario_pppoe', 'is', null)

    const customerMap = new Map<string, string>()
    customers?.forEach((c: any) => customerMap.set(String(c.usuario_pppoe).toLowerCase(), c.id))

    for (const p of payloads) {
      const loggedAt = p.collected_at || new Date().toISOString()
      const resource = p.resource || {}

      // 1. Router reachability history
      if (p.host) {
        await supabase.from('mikrotik_status_history').insert({
          host: p.host,
          online: p.online !== false,
          message: p.message || (p.online === false ? 'Agente VPS: sem resposta' : 'Agente VPS: OK'),
          logged_at: loggedAt,
        })
        result.status++
      }

      // 2. WAN traffic + hardware metrics
      if (Array.isArray(p.wan) && p.wan.length > 0) {
        const rows = p.wan.map((w: any) => ({
          interface_name: String(w.interface_name),
          rx_bps: Math.max(0, Math.round(Number(w.rx_bps) || 0)),
          tx_bps: Math.max(0, Math.round(Number(w.tx_bps) || 0)),
          rx_bytes: w.rx_bytes != null ? Number(w.rx_bytes) : null,
          tx_bytes: w.tx_bytes != null ? Number(w.tx_bytes) : null,
          cpu_load: resource.cpu_load != null ? Number(resource.cpu_load) : null,
          free_memory: resource.free_memory != null ? Number(resource.free_memory) : null,
          total_memory: resource.total_memory != null ? Number(resource.total_memory) : null,
          temperature: resource.temperature != null ? Number(resource.temperature) : null,
          created_at: loggedAt,
        }))
        const { error } = await supabase.from('wan_logs').insert(rows)
        if (!error) result.wan += rows.length
        else console.error('wan_logs insert error', error.message)
      }

      // 3. PPPoE sessions per customer
      if (Array.isArray(p.pppoe) && p.pppoe.length > 0) {
        const rows: any[] = []
        for (const s of p.pppoe) {
          const name = String(s.usuario_pppoe || '').toLowerCase()
          const customerId = customerMap.get(name)
          if (!customerId) {
            if (name && !result.unknown_pppoe.includes(name)) result.unknown_pppoe.push(name)
            continue
          }
          rows.push({
            customer_id: customerId,
            usuario_pppoe: s.usuario_pppoe,
            event_type: s.event_type || 'stats',
            ip_address: s.ip_address || null,
            uptime: s.uptime || null,
            rx_bytes: s.rx_bytes != null ? Number(s.rx_bytes) : null,
            tx_bytes: s.tx_bytes != null ? Number(s.tx_bytes) : null,
            logged_at: loggedAt,
          })
        }
        if (rows.length) {
          const { error } = await supabase.from('pppoe_logs').insert(rows)
          if (!error) result.pppoe += rows.length
          else console.error('pppoe_logs insert error', error.message)
        }
      }
    }

    return json({ success: true, agent: agent.name, ...result })
  } catch (e) {
    console.error('mikrotik-agent-ingest error', e)
    return json({ success: false, error: (e as Error).message }, 500)
  }
})
