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
    const restPorts = [...new Set([configured, 80, 8080, 443, 8443, 81, 4443, 8081].filter(Boolean))] as number[]
    const schemeFor = (p: number): 'http' | 'https' => (p === 443 || p === 8443 || p === 4443 ? 'https' : 'http')

    // 1) Probe all ports in parallel with short timeouts
    const probePorts = [...new Set([apiPort, ...restPorts])]
    const probes = await Promise.all(probePorts.map((p) => tcpCheck(host, p, 1500)))
    const openMap = new Map<number, boolean>()
    probePorts.forEach((p, i) => openMap.set(p, probes[i]))

    const apiOpen = !!openMap.get(apiPort)
    const p80 = !!openMap.get(80)
    const p443 = !!openMap.get(443)
    const openPorts = probePorts.filter((p) => openMap.get(p))

    // 2) Try RouterOS v7 REST in parallel on open ports; first success wins
    let identity: string | null = null
    let uptime: string | null = null
    let version: string | null = null
    let activeUsers: number | null = null
    let activeList: { name: string; address?: string; uptime?: string; rx_bytes?: number; tx_bytes?: number }[] = []
    let restOk = false
    let restPort: number | null = null
    let lastStatus = 0
    let authFailed = false

    const openRest = restPorts.filter((p) => openMap.get(p))
    if (openRest.length) {
      const attempts = await Promise.all(
        openRest.map(async (p) => {
          const base = `${schemeFor(p)}://${host}:${p}`
          const res = await restCall(base, '/system/resource', auth, 4000)
          if (res.ok || res.status === 401) return { port: p, base, res }
          // try the alternate scheme once
          const altBase = `${schemeFor(p) === 'http' ? 'https' : 'http'}://${host}:${p}`
          const alt = await restCall(altBase, '/system/resource', auth, 4000)
          return { port: p, base: altBase, res: alt }
        }),
      )

      for (const a of attempts) {
        if (a.res.status) lastStatus = a.res.status
        if (a.res.status === 401) authFailed = true
      }

      const winner = attempts.find((a) => a.res.ok && a.res.data)
      if (winner) {
        const r = winner.res.data as Record<string, string>
        restOk = true
        restPort = winner.port
        uptime = r.uptime ?? null
        version = r.version ?? null
        const [idty, active, resource] = await Promise.all([
          restCall(winner.base, '/system/identity', auth, 4000),
          restCall(winner.base, '/ppp/active', auth, 5000),
          restCall(winner.base, '/interface', auth, 5000),
        ])
        identity = (idty.data as Record<string, string> | null)?.name ?? null
        
        const interfaces = Array.isArray(resource.data) ? resource.data as any[] : []

        // Identify WAN interfaces: prefer explicit naming, fallback to physical/uplink types
        const isWanName = (i: any) => /wan|uplink|internet|link/i.test(`${i.name ?? ''} ${i.comment ?? ''}`)
        const uplinkTypes = ['ether', 'vlan', 'pppoe-out', 'lte', 'wireless', 'wlan']
        const candidates = interfaces.filter(i => uplinkTypes.includes(String(i.type ?? '').toLowerCase()))
        let wanInterfaces = candidates.filter(isWanName)
        if (wanInterfaces.length === 0) {
          // No explicit WAN naming: use pppoe-out clients, otherwise the physical uplinks
          const pppoeOut = candidates.filter(i => String(i.type).toLowerCase() === 'pppoe-out')
          wanInterfaces = (pppoeOut.length ? pppoeOut : candidates.filter(i => String(i.type).toLowerCase() === 'ether')).slice(0, 4)
        }

        if (wanInterfaces.length > 0) {
          try {
            // Previous samples to convert cumulative byte counters into bits per second
            const { data: prevLogs } = await supabase
              .from('wan_logs')
              .select('interface_name, rx_bytes, tx_bytes, created_at')
              .in('interface_name', wanInterfaces.map(i => i.name))
              .order('created_at', { ascending: false })
              .limit(wanInterfaces.length * 3)

            const now = Date.now()
            const rows = wanInterfaces.map(i => {
              const rxBytes = parseInt(i['rx-byte'] ?? '0', 10) || 0
              const txBytes = parseInt(i['tx-byte'] ?? '0', 10) || 0
              const prev = (prevLogs ?? []).find((p: any) => p.interface_name === i.name)
              let rxBps = 0
              let txBps = 0
              if (prev) {
                const secs = Math.max(1, (now - new Date(prev.created_at).getTime()) / 1000)
                const dRx = rxBytes - Number(prev.rx_bytes ?? 0)
                const dTx = txBytes - Number(prev.tx_bytes ?? 0)
                if (dRx >= 0) rxBps = Math.round((dRx * 8) / secs)
                if (dTx >= 0) txBps = Math.round((dTx * 8) / secs)
              }
              return {
                interface_name: i.name,
                rx_bps: rxBps,
                tx_bps: txBps,
                rx_bytes: rxBytes,
                tx_bytes: txBytes,
              }
            })

            await supabase.from('wan_logs').insert(rows)

            // Check for status changes (up/down)
            for (const wan of wanInterfaces) {
              const isUp = String(wan.running) === 'true' && String(wan.disabled) !== 'true'
              const { data: lastEvents } = await supabase
                .from('wan_status_history')
                .select('status')
                .eq('interface_name', wan.name)
                .order('created_at', { ascending: false })
                .limit(1)

              const previous = lastEvents?.[0]?.status ?? null
              const currentStatus = isUp ? 'up' : 'down'
              if (previous !== currentStatus) {
                await supabase.from('wan_status_history').insert({
                  interface_name: wan.name,
                  status: currentStatus,
                  reason: isUp
                    ? 'Interface running e trafegando dados'
                    : (String(wan.disabled) === 'true' ? 'Interface desabilitada no roteador' : 'Link caiu (running=false)'),
                })
              }
            }
          } catch (e) { console.error('Error logging WAN status:', e) }
        }


        if (Array.isArray(active.data)) {
          const list = active.data as Record<string, string>[]
          activeUsers = list.length
          activeList = list.slice(0, 200).map((a) => {
            const iface = interfaces.find(i => i.name === `<pppoe-${a.name}>` || i.name.includes(a.name))
            return {
              name: a.name,
              address: a.address,
              uptime: a.uptime,
              rx_bytes: iface ? parseInt(iface['rx-byte'] || '0', 10) : 0,
              tx_bytes: iface ? parseInt(iface['tx-byte'] || '0', 10) : 0,
            }
          })
        }
      }
    }

    const reachable = openPorts.length > 0
    const online = restOk || reachable

    let message: string
    if (restOk) message = `Conectado via API REST (porta ${restPort})`
    else if (authFailed) message = 'API REST respondeu, mas usuário/senha foram rejeitados (401)'
    else if (reachable) message = 'Host alcançável, mas a API REST não respondeu. Veja o tutorial para habilitar (/ip service enable www) e liberar a porta no firewall.'
    else message = 'Não foi possível alcançar o Mikrotik neste IP/portas'

    const responseData = {
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
    }

    // Log status for alert tracking
    try {
      await supabase.from('mikrotik_status_history').insert({
        host,
        online,
        message
      })
    } catch (e) { console.error('Error logging status history:', e) }

    return json(responseData)
  } catch (e) {
    return json({ online: false, message: (e as Error).message }, 200)
  }
})
