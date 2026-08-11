import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors'
import { createClient } from 'npm:@supabase/supabase-js@2'

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
      .in('key', ['mikrotik_host', 'mikrotik_username', 'mikrotik_password', 'mikrotik_rest_port'])

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
      
      // In Mikrotik, we can "block" by changing the profile to a 'bloqueado' profile 
      // or simply disabling the secret. Disabling is more direct for "no signal".
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

      if (!exists) {
        await restCall(base, '/ppp/secret', auth, 'PUT', secretData)
      } else {
        await restCall(base, `/ppp/secret/${check.data[0]['.id']}`, auth, 'PATCH', secretData)
      }
      
      // If customer was just blocked, kick their active session
      if (isBlocked) {
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
