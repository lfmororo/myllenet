// mikrotik-sync-logs (vpsfaedi): coleta as sessões PPPoE direto pela API REST do MikroTik
// (via mikrotik-status) e faz o que o agente local fazia:
//   - guarda um snapshot das sessões (mikrotik_pppoe_snapshots)
//   - registra eventos "connected"/"disconnected" comparando com o snapshot anterior
//     (usados pelos alertas de desconexão, pelas faturas e pelo relatório de consumo)
//   - grava "stats" (uptime, rx/tx) a cada 5 minutos
// Agendado no pg_cron a cada minuto.
import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors'
import { createClient } from 'npm:@supabase/supabase-js@2'
import { exigir } from "../_shared/auth.ts";

const STATS_EVERY_MIN = 5

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  const negado = await exigir(req, "interno");
  if (negado) return negado;

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

    // 1. Sessões ativas, direto do MikroTik
    const { data: statusResp, error: statusErr } = await supabase.functions.invoke('mikrotik-status')
    if (statusErr) throw new Error(statusErr.message || 'Falha ao buscar status do Mikrotik')
    if (!statusResp?.restApi || statusResp?.pppoeOk !== true || !Array.isArray(statusResp?.activeList)) {
      // sem coleta válida não gera eventos (evita "desconectar" todo mundo numa falha de rede)
      return json({ success: false, skipped: true, message: statusResp?.message || 'MikroTik indisponível' })
    }

    const activeSessions = statusResp.activeList as any[]
    const host = String(statusResp.host || 'direto')
    const now = new Date()
    const loggedAt = now.toISOString()

    const norm = (v: unknown) => String(v ?? '').trim().toLowerCase()
    const sessionsByName = new Map<string, any>()
    for (const s of activeSessions) {
      const n = norm(s.name)
      if (n) sessionsByName.set(n, s)
    }
    const currentNames = [...sessionsByName.keys()]

    // 2. Clientes (usuario_pppoe -> customer_id)
    const { data: customers } = await supabase
      .from('customers')
      .select('id, usuario_pppoe')
      .not('usuario_pppoe', 'is', null)
    const customerMap = new Map((customers || []).map((c: any) => [norm(c.usuario_pppoe), c.id]))

    // 3. Snapshot anterior + novo snapshot
    const { data: previous } = await supabase
      .from('mikrotik_pppoe_snapshots')
      .select('usernames, collected_at')
      .eq('host', host)
      .eq('collection_ok', true)
      .order('collected_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    const { error: snapErr } = await supabase.from('mikrotik_pppoe_snapshots').insert({
      host,
      collected_at: loggedAt,
      collection_ok: true,
      usernames: currentNames,
    })
    if (snapErr) console.error('mikrotik_pppoe_snapshots insert error', snapErr.message)

    // 4. Eventos de conexão/desconexão
    const events: any[] = []
    if (previous) {
      const prevNames = new Set(((previous.usernames as unknown[]) || []).map(norm))
      const curr = new Set(currentNames)
      for (const n of curr) {
        if (prevNames.has(n)) continue
        const customerId = customerMap.get(n)
        const s = sessionsByName.get(n)
        if (!customerId || !s) continue
        events.push({
          customer_id: customerId,
          usuario_pppoe: s.name,
          event_type: 'connected',
          ip_address: s.address || null,
          uptime: s.uptime || null,
          logged_at: loggedAt,
        })
      }
      for (const n of prevNames) {
        if (curr.has(n)) continue
        const customerId = customerMap.get(n)
        if (!customerId) continue
        events.push({
          customer_id: customerId,
          usuario_pppoe: n,
          event_type: 'disconnected',
          ip_address: null,
          uptime: null,
          logged_at: loggedAt,
        })
      }
    }

    // 5. Estatísticas de consumo a cada STATS_EVERY_MIN minutos
    const stats: any[] = []
    if (now.getUTCMinutes() % STATS_EVERY_MIN === 0) {
      for (const [n, s] of sessionsByName) {
        const customerId = customerMap.get(n)
        if (!customerId) continue
        stats.push({
          customer_id: customerId,
          usuario_pppoe: s.name,
          event_type: 'stats',
          ip_address: s.address || null,
          uptime: s.uptime || null,
          rx_bytes: s.rx_bytes != null ? Number(s.rx_bytes) : 0,
          tx_bytes: s.tx_bytes != null ? Number(s.tx_bytes) : 0,
          logged_at: loggedAt,
        })
      }
    }

    const rows = [...events, ...stats]
    if (rows.length > 0) {
      const { error: insertErr } = await supabase.from('pppoe_logs').insert(rows)
      if (insertErr) throw insertErr
    }

    return json({
      success: true,
      sessions: currentNames.length,
      connected: events.filter((e) => e.event_type === 'connected').length,
      disconnected: events.filter((e) => e.event_type === 'disconnected').length,
      stats: stats.length,
    })
  } catch (e) {
    return json({ error: (e as Error).message }, 500)
  }
})
