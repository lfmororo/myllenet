import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors'
import { createClient } from 'npm:@supabase/supabase-js@2'

async function tcpCheck(host: string, port: number, timeoutMs = 4000) {
  let conn: Deno.Conn | null = null
  try {
    conn = await Promise.race([
      Deno.connect({ hostname: host, port }),
      new Promise<never>((_, rej) => setTimeout(() => rej(new Error('timeout')), timeoutMs)),
    ])
    return true
  } catch (_e) {
    return false
  } finally {
    try { conn?.close() } catch (_e) { /* ignore */ }
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
    if (!res.ok) return { ok: false, status: res.status, data: null as unknown }
    return { ok: true, status: res.status, data: await res.json() }
  } catch (e) {
    return { ok: false, status: 0, data: null as unknown, error: (e as Error).message }
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
      .in('key', [
        'mikrotik_host',
        'mikrotik_username',
        'mikrotik_password',
        'mikrotik_api_port',
        'mikrotik_rest_port',
      ])

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

    // Candidate REST ports: user-defined first, then common ones
    const configured = parseInt(cfg.mikrotik_rest_port || '', 10)
    const candidates: { port: number; scheme: 'http' | 'https' }[] = []
    if (configured) {
      candidates.push({ port: configured, scheme: configured === 443 || configured === 8443 ? 'https' : 'http' })
      candidates.push({ port: configured, scheme: configured === 443 || configured === 8443 ? 'http' : 'https' })
    }
    for (const p of [80, 443, 8080, 8443, 81, 4443, 8081]) {
      candidates.push({ port: p, scheme: p === 443 || p === 8443 || p === 4443 ? 'https' : 'http' })
    }

    // 1) Reachability
    const [apiOpen, p80, p443] = await Promise.all([
      tcpCheck(host, apiPort),
      tcpCheck(host, 80),
      tcpCheck(host, 443),
    ])

    // 2) Try RouterOS v7 REST for details on open ports
    let identity: string | null = null
    let uptime: string | null = null
    let version: string | null = null
    let activeUsers: number | null = null
    let activeList: { name: string; address?: string; uptime?: string }[] = []
    let restOk = false
    let restPort: number | null = null
    let lastStatus = 0
    let authFailed = false
    const tried = new Set<string>()
    const openPorts: number[] = []
    if (apiOpen) openPorts.push(apiPort)
    if (p80) openPorts.push(80)
    if (p443) openPorts.push(443)

    for (const c of candidates) {
      const key = `${c.scheme}:${c.port}`
      if (tried.has(key)) continue
      tried.add(key)

      if (c.port !== 80 && c.port !== 443) {
        const open = await tcpCheck(host, c.port, 3000)
        if (!open) continue
        if (!openPorts.includes(c.port)) openPorts.push(c.port)
      } else if ((c.port === 80 && !p80) || (c.port === 443 && !p443)) {
        continue
      }

      const base = `${c.scheme}://${host}:${c.port}`
      const resource = await restCall(base, '/system/resource', auth)
      lastStatus = resource.status || lastStatus
      if (resource.status === 401) authFailed = true
      if (resource.ok && resource.data) {
        const r = resource.data as Record<string, string>
        restOk = true
        restPort = c.port
        uptime = r.uptime ?? null
        version = r.version ?? null
        const idty = await restCall(base, '/system/identity', auth)
        identity = (idty.data as Record<string, string> | null)?.name ?? null
        const active = await restCall(base, '/ppp/active', auth)
        if (Array.isArray(active.data)) {
          const list = active.data as Record<string, string>[]
          activeUsers = list.length
          activeList = list.slice(0, 200).map((a) => ({
            name: a.name,
            address: a.address,
            uptime: a.uptime,
          }))
        }
        break
      }
    }

    const reachable = openPorts.length > 0
    const online = restOk || reachable

    let message: string
    if (restOk) message = `Conectado via API REST (porta ${restPort})`
    else if (authFailed) message = 'API REST respondeu, mas usuário/senha foram rejeitados (401)'
    else if (reachable) message = 'Host alcançável, mas a API REST não respondeu. Veja o tutorial para habilitar (/ip service enable www) e liberar a porta no firewall.'
    else message = 'Não foi possível alcançar o Mikrotik neste IP/portas'

    return json({
      online,
      host,
      restApi: restOk,
      restPort,
      lastHttpStatus: lastStatus,
      ports: { api: apiOpen, http: p80, https: p443 },
      openPorts,
      identity,
      version,
      uptime,
      activeUsers,
      activeList,
      message,
    })
  } catch (e) {
    return json({ online: false, message: (e as Error).message }, 200)
  }
})
