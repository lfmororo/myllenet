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

    // 1. Check Mikrotik Connection Alerts (3 minutes)
    const { data: recentHistory } = await supabase
      .from('mikrotik_status_history')
      .select('*')
      .order('logged_at', { ascending: false })
      .limit(5)

    if (recentHistory && recentHistory.length >= 3) {
      const allOffline = recentHistory.slice(0, 3).every(h => !h.online)
      if (allOffline) {
        // Send alert for router offline
        console.log("ALERT: Mikrotik Offline for > 3 minutes")
        await supabase.functions.invoke('whatsapp-send/send-text', {
          body: {
            phone: '85986801458', // Admin phone from context
            message: `🚨 *ALERTA DE MONITORAMENTO* 🚨\n\nO servidor Mikrotik está *OFF-LINE* há mais de 3 minutos!\n\nHost: ${recentHistory[0].host}\nÚltimo erro: ${recentHistory[0].message}`
          }
        })
      }
    }

    // 2. Check Customer Disconnection Alerts (5 minutes)
    // We check for customers who were online in the previous sync but are not in the current one
    // AND haven't been in the current one for 5+ minutes
    const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString()
    
    // Get customers who "disappeared"
    const { data: disconnections } = await supabase.rpc('get_recent_disconnections', {
      since_time: fiveMinAgo
    })

    if (disconnections && disconnections.length > 0) {
      for (const disc of disconnections) {
        console.log(`ALERT: Customer ${disc.usuario_pppoe} Offline for > 5 minutes`)
        await supabase.functions.invoke('whatsapp-send/send-text', {
          body: {
            phone: '85986801458',
            message: `⚠️ *ALERTA DE DESCONEXÃO* ⚠️\n\nO cliente *${disc.nome}* (${disc.usuario_pppoe}) está off-line há mais de 5 minutos!\n\nÚltima atividade: ${new Date(disc.last_seen).toLocaleString('pt-BR')}`
          }
        })
      }
    }
    
    return json({ success: true })
  } catch (e) {
    return json({ error: (e as Error).message }, 500)
  }
})
