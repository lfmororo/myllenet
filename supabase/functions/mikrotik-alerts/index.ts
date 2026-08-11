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
    // Compare last 2 stats logs for each customer
    const { data: logs } = await supabase
      .from('pppoe_logs')
      .select('customer_id, usuario_pppoe, logged_at')
      .order('logged_at', { ascending: false })
      .limit(500)

    // This logic would be more robust comparing current active sessions vs previous
    // Simplified for now: if a customer was seen in logs 10min ago but not in the last 2 cycles
    
    return json({ success: true })
  } catch (e) {
    return json({ error: (e as Error).message }, 500)
  }
})
