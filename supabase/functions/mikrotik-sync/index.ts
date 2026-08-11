import { corsHeaders } from 'https://esm.sh/@supabase/supabase-js@2/cors'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.38.4'

async function restCall(base: string, path: string, auth: string, method = 'GET', body?: any) {
  const ac = new AbortController()
  const t = setTimeout(() => ac.abort(), 8000)
  try {
    const res = await fetch(`${base}/rest${path}`, {
      method,
      headers: { 
        Authorization: `Basic ${auth}`, 
        'Content-Type': 'application/json',
        Connection: 'close' 
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: ac.signal,
    })
    return { ok: res.ok, status: res.status, data: await res.json().catch(() => null) }
  } catch (e) {
    return { ok: false, status: 0, error: (e as Error).message }
  } finally {
    clearTimeout(t)
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )

    // 1. Get Mikrotik config
    const { data: settings } = await supabase
      .from('settings')
      .select('key,value')
      .in('key', ['mikrotik_host', 'mikrotik_username', 'mikrotik_password', 'mikrotik_rest_port', 'blocking_days'])

    const cfg: any = {}
    settings?.forEach(s => cfg[s.key] = s.value)
    
    const host = cfg.mikrotik_host
    const user = cfg.mikrotik_username || 'admin'
    const pass = cfg.mikrotik_password || ''
    const port = cfg.mikrotik_rest_port || '80'
    const auth = btoa(`${user}:${pass}`)
    const base = `http://${host}:${port}`

    // 2. Sync Profiles (Plans)
    const { data: plans } = await supabase.from('plans').select('*')
    for (const plan of plans || []) {
      const matches = plan.nome.match(/\d+/)
      const speed = matches ? matches[0] : '10'
      const limit = `${speed}M/${speed}M`
      
      // Check if profile exists
      const check = await restCall(base, `/ppp/profile?name=${encodeURIComponent(plan.nome)}`, auth)
      const exists = Array.isArray(check.data) && check.data.length > 0

      if (!exists) {
        await restCall(base, '/ppp/profile', auth, 'PUT', {
          name: plan.nome,
          'local-address': '10.0.0.1',
          'rate-limit': limit
        })
      } else {
        await restCall(base, `/ppp/profile/${check.data[0]['.id']}`, auth, 'PATCH', {
          'rate-limit': limit
        })
      }
    }

    // 3. Sync Customers (Secrets) & Handle Blocking
    const { data: customers } = await supabase
      .from('customers')
      .select('*, plans(nome)')
      .not('usuario_pppoe', 'is', null)

    for (const customer of customers || []) {
      const planName = customer.plans?.nome || 'default'
      const isBlocked = customer.block_status === 'blocked' || !customer.ativo
      const oldBlockStatus = customer.block_status;

      // Check if block status changed since last sync (optional, but we can detect it here if we track it)
      // For now, we will trust the database block_status and handle alerts if it changes.
      
      const secretData = {
        name: customer.usuario_pppoe,
        password: customer.senha_pppoe,
        service: 'pppoe',
        profile: planName,
        disabled: isBlocked ? 'true' : 'false',
        comment: `ID: ${customer.id} | Status: ${customer.block_status}`
      }

      const check = await restCall(base, `/ppp/secret?name=${encodeURIComponent(customer.usuario_pppoe)}`, auth)
      const exists = Array.isArray(check.data) && check.data.length > 0
      
      let changed = false;
      if (!exists) {
        await restCall(base, '/ppp/secret', auth, 'PUT', secretData)
        changed = true;
      } else {
        const currentSecret = check.data[0];
        const currentDisabled = currentSecret.disabled === 'true';
        if (currentDisabled !== isBlocked) {
          await restCall(base, `/ppp/secret/${currentSecret['.id']}`, auth, 'PATCH', secretData)
          changed = true;
      }
    }

    // 4. Send pending block alerts
    const { data: pendingAlerts } = await supabase
      .from('block_alerts_sent' as any)
      .select('*, customers(nome, telefone)')
      .is('processed' as any, null);

    if (pendingAlerts && pendingAlerts.length > 0) {
      for (const alert of pendingAlerts) {
        const customer = alert.customers;
        if (customer?.telefone) {
          const blockingDays = cfg.blocking_days || '15';
          const message = alert.new_status === 'blocked' 
            ? `⚠️ *Aviso de Bloqueio:* Olá ${customer.nome}, identificamos uma fatura com mais de ${blockingDays} dias de atraso e seu sinal foi suspenso automaticamente. Regularize para restabelecer a conexão.`
            : `✅ *Sinal Liberado:* Olá ${customer.nome}, seu pagamento foi identificado e seu sinal já foi liberado no sistema. Obrigado!`;
          
          try {
            await supabase.functions.invoke('whatsapp-send', {
              body: {
                phone: customer.telefone,
                message,
                customer_id: alert.customer_id,
                customer_name: customer.nome,
                type: 'block_alert'
              }
            });
            await supabase.from('block_alerts_sent' as any).update({ processed: true } as any).eq('id', alert.id);
          } catch (e) {
            console.error('Error sending block alert WhatsApp:', e);
          }
        }
      }
    }
      
      // If status changed on Mikrotik (or just ensuring sync), and it's a block event, kick session
      if (isBlocked && changed) {
        const active = await restCall(base, `/ppp/active?name=${encodeURIComponent(customer.usuario_pppoe)}`, auth)
        if (Array.isArray(active.data) && active.data.length > 0) {
          await restCall(base, `/ppp/active/${active.data[0]['.id']}`, auth, 'DELETE')
        }
      }
    }

    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
})
