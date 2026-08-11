import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors'
import { createClient } from 'npm:@supabase/supabase-js@2'

async function tcpCheck(host: string, port: number, timeoutMs = 6000) {
  const ac = new AbortController()
  const t = setTimeout(() => ac.abort(), timeoutMs)
  try {
    const conn = await Deno.connect({ hostname: host, port, signal: ac.signal } as any)
    conn.close()
    return true
  } catch (_e) {
    return false
  } finally {
    clearTimeout(t)
  }
}

async function restCall(base: string, path: string, auth: string, timeoutMs = 8000) {
  const ac = new AbortController()
  const t = setTimeout(() => ac.abort(), timeoutMs)
  try {
    const res = await fetch(`${base}/rest${path}`, {
      headers: { Authorization: `Basic ${auth}`, Connection: 'close' },
      signal: ac.signal,
    })
    if (!res.ok) return null
    return await res.json()
  } catch (_e) {
    return null
  } finally {
    clearTimeout(t)
  }
}

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

    const { data: rows } = await supabase
      .from('settings')
      .select('key,value')
      .in('key', ['mikrotik_host', 'mikrotik_username', 'mikrotik_password', 'mikrotik_api_port'])

    const cfg: Record<string, string> = {}
    for (const r of rows ?? []) cfg[r.key] = r.value ?? ''

    const host = (cfg.mikrotik_host || '').trim()
    if (!host) {
      return json({ online: false, message: 'Configure o IP/Host do Mikrotik em Configurações' })
    }

    const apiPort = parseInt(cfg.mikrotik_api_port || '8728', 10) || 8728
    const user = cfg.mikrotik_username || 'admin'
    const pass = cfg.mikrotik_password || ''
    const auth = btoa(`${user}:${pass}`)

    // 1) Reachability: API port, then HTTP/HTTPS
    const checks = await Promise.all([
      tcpCheck(host, apiPort),
      tcpCheck(host, 80),
      tcpCheck(host, 443),
    ])
    const reachable = checks.some(Boolean)

    // 2) Try RouterOS v7 REST for details
    let identity: string | null = null
    let uptime: string | null = null
    let version: string | null = null
    let activeUsers: number | null = null
    let restOk = false

    for (const base of [`http://${host}`, `https://${host}`]) {
      const resource = await restCall(base, '/system/resource', auth)
      if (resource) {
        restOk = true
        uptime = resource.uptime ?? null
        version = resource.version ?? null
        const idty = await restCall(base, '/system/identity', auth)
        identity = idty?.name ?? null
        const active = await restCall(base, '/ppp/active', auth)
        if (Array.isArray(active)) activeUsers = active.length
        break
      }
    }

    const online = restOk || reachable
    return json({
      online,
      host,
      restApi: restOk,
      ports: { api: checks[0], http: checks[1], https: checks[2] },
      identity,
      version,
      uptime,
      activeUsers,
      message: restOk
        ? 'Conectado via API REST do RouterOS'
        : reachable
          ? 'Host alcançável, mas a API REST não respondeu (verifique usuário/senha ou habilite www-ssl/www)'
          : 'Não foi possível alcançar o Mikrotik neste IP/portas',
    })
  } catch (e) {
    return json({ online: false, message: (e as Error).message }, 200)
  }
})
