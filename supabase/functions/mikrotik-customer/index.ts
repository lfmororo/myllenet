import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors'
import { createClient } from 'npm:@supabase/supabase-js@2.38.4'

type Action = 'sync' | 'enable' | 'disable' | 'remove'

async function restCall(base: string, path: string, auth: string, method = 'GET', body?: any, timeoutMs = 8000) {
  const ac = new AbortController()
  const t = setTimeout(() => ac.abort(), timeoutMs)
  try {
    const res = await fetch(`${base}/rest${path}`, {
      method,
      headers: {
        Authorization: `Basic ${auth}`,
        'Content-Type': 'application/json',
        Connection: 'close',
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: ac.signal,
    })
    return { ok: res.ok, status: res.status, data: await res.json().catch(() => null) }
  } catch (e) {
    return { ok: false, status: 0, data: null, error: (e as Error).message }
  } finally {
    clearTimeout(t)
  }
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const body = await req.json().catch(() => ({}))
    const customerId = String(body?.customer_id || '')
    const action = (body?.action || 'sync') as Action

    if (!customerId || !['sync', 'enable', 'disable', 'remove'].includes(action)) {
      return json({ success: false, error: 'Parâmetros inválidos (customer_id, action)' }, 400)
    }

    const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

    // Authenticate the caller (validate the JWT with the service client) and require admin role
    const token = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '')
    if (!token) return json({ success: false, error: 'Não autenticado' }, 401)
    const { data: userData, error: authError } = await supabase.auth.getUser(token)
    const user = userData?.user
    if (authError || !user) return json({ success: false, error: 'Não autenticado' }, 401)

    const { data: isAdmin } = await supabase.rpc('has_role', { _user_id: user.id, _role: 'admin' })
    if (!isAdmin) return json({ success: false, error: 'Acesso restrito a administradores' }, 403)


    const { data: settings } = await supabase
      .from('settings')
      .select('key,value')
      .in('key', ['mikrotik_host', 'mikrotik_username', 'mikrotik_password', 'mikrotik_rest_port'])

    const cfg: Record<string, string> = {}
    settings?.forEach((s: any) => (cfg[s.key] = s.value))
    if (!cfg.mikrotik_host) return json({ success: false, error: 'Mikrotik não configurado' }, 400)

    const auth = btoa(`${cfg.mikrotik_username || 'admin'}:${cfg.mikrotik_password || ''}`)
    const base = `http://${cfg.mikrotik_host}:${cfg.mikrotik_rest_port || '80'}`

    const { data: customer, error: custErr } = await supabase
      .from('customers')
      .select('*, plans(nome)')
      .eq('id', customerId)
      .maybeSingle()

    if (custErr || !customer) return json({ success: false, error: 'Cliente não encontrado' }, 404)
    if (!customer.usuario_pppoe) return json({ success: false, error: 'Cliente sem usuário PPPoE' }, 400)

    const probe = await restCall(base, '/system/resource', auth, 'GET', undefined, 6000)
    if (!probe.ok) {
      return json({
        success: false,
        error: 'API REST do Mikrotik não respondeu. Habilite com /ip service enable www e libere a porta no firewall.',
      })
    }

    const username = customer.usuario_pppoe
    const planName = (customer as any).plans?.nome || 'default'

    // Find existing secret
    const list = await restCall(base, `/ppp/secret?name=${encodeURIComponent(username)}`, auth)
    const existing = Array.isArray(list.data) ? list.data.find((s: any) => s.name === username) : null

    // REMOVE
    if (action === 'remove') {
      if (!existing) return json({ success: true, action, message: 'Usuário não existe no Mikrotik' })
      const del = await restCall(base, `/ppp/secret/${existing['.id']}`, auth, 'DELETE')
      if (!del.ok) return json({ success: false, error: 'Falha ao remover no Mikrotik' })
      // kick active session
      const active = await restCall(base, `/ppp/active?name=${encodeURIComponent(username)}`, auth)
      const session = Array.isArray(active.data) ? active.data.find((a: any) => a.name === username) : null
      if (session) await restCall(base, `/ppp/active/${session['.id']}`, auth, 'DELETE')
      return json({ success: true, action, message: `Usuário ${username} removido do Mikrotik` })
    }

    const disabled = action === 'disable' ? true : action === 'enable' ? false : !customer.ativo || customer.block_status === 'blocked'

    const secretData: Record<string, string> = {
      name: username,
      password: customer.senha_pppoe || '',
      service: 'pppoe',
      profile: planName,
      disabled: disabled ? 'true' : 'false',
      comment: `ID: ${customer.id} | Status: ${customer.block_status || 'active'}`,
    }

    // Ensure the plan profile exists before assigning it
    if (planName !== 'default') {
      const profiles = await restCall(base, `/ppp/profile?name=${encodeURIComponent(planName)}`, auth)
      const hasProfile = Array.isArray(profiles.data) ? profiles.data.some((p: any) => p.name === planName) : false
      if (!hasProfile) {
        const speed = planName.match(/\d+/)?.[0] || '10'
        await restCall(base, '/ppp/profile', auth, 'PUT', {
          name: planName,
          'local-address': '10.0.0.1',
          'rate-limit': `${speed}M/${speed}M`,
        })
      }
    }

    let created = false
    if (!existing) {
      const put = await restCall(base, '/ppp/secret', auth, 'PUT', secretData)
      if (!put.ok) return json({ success: false, error: 'Falha ao cadastrar no Mikrotik' })
      created = true
    } else {
      const patch = await restCall(base, `/ppp/secret/${existing['.id']}`, auth, 'PATCH', secretData)
      if (!patch.ok) return json({ success: false, error: 'Falha ao atualizar no Mikrotik' })
    }

    // Drop the live session when disabling so the block takes effect immediately
    let kicked = false
    if (disabled) {
      const active = await restCall(base, `/ppp/active?name=${encodeURIComponent(username)}`, auth)
      const session = Array.isArray(active.data) ? active.data.find((a: any) => a.name === username) : null
      if (session) {
        await restCall(base, `/ppp/active/${session['.id']}`, auth, 'DELETE')
        kicked = true
      }
    }

    // Reflect manual enable/disable on the customer record + audit trail
    if (action === 'enable' || action === 'disable') {
      const newStatus = action === 'disable' ? 'blocked' : 'active'
      if (customer.block_status !== newStatus) {
        await supabase.from('customers').update({ block_status: newStatus }).eq('id', customer.id)
        await supabase.from('block_history').insert({
          customer_id: customer.id,
          old_status: customer.block_status,
          new_status: newStatus,
          reason: action === 'disable' ? 'Desativado manualmente no Mikrotik' : 'Ativado manualmente no Mikrotik',
          changed_by: user.id,
        })
      }
    }

    const messages: Record<string, string> = {
      sync: created ? `Cliente cadastrado no Mikrotik (${username})` : `Cliente atualizado no Mikrotik (${username})`,
      enable: `Cliente ativado no Mikrotik (${username})`,
      disable: `Cliente desativado no Mikrotik${kicked ? ' e sessão encerrada' : ''} (${username})`,
    }

    return json({ success: true, action, created, kicked, disabled, message: messages[action] })
  } catch (e) {
    return json({ success: false, error: (e as Error).message }, 500)
  }
})
