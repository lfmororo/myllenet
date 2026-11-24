import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors'
import { createClient } from 'npm:@supabase/supabase-js@2'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  )

  try {
    const { data: rows } = await supabase
      .from('settings')
      .select('key,value')
      .in('key', ['mikrotik_host', 'mikrotik_host_secondary', 'mikrotik_username', 'mikrotik_password', 'mikrotik_rest_port'])

    const cfg: Record<string, string> = {}
    for (const r of rows ?? []) cfg[r.key] = r.value ?? ''

    const hosts = [cfg.mikrotik_host, cfg.mikrotik_host_secondary].filter(Boolean)
    const user = cfg.mikrotik_username || 'admin'
    const pass = cfg.mikrotik_password || ''
    const port = cfg.mikrotik_rest_port || '80'
    const auth = btoa(`${user}:${pass}`)

    if (hosts.length === 0) {
      return new Response(JSON.stringify({ error: "Host Mikrotik não configurado" }), { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      })
    }

    // Find active host
    let activeHost = ""
    for (const host of hosts) {
      try {
        const probe = await fetch(`http://${host}:${port}/rest/system/resource`, {
          headers: { Authorization: `Basic ${auth}`, Connection: 'close' },
          signal: AbortController.timeout(4000)
        })
        if (probe.ok) {
          activeHost = host
          break
        }
      } catch (e) {
        console.error(`Host ${host} failed probe:`, e.message)
      }
    }

    if (!activeHost) {
      return new Response(JSON.stringify({ error: "Nenhum host Mikrotik respondeu" }), { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      })
    }

    // 1. Get WAN interfaces to know which IPs to test from
    const resInt = await fetch(`http://${activeHost}:${port}/rest/interface`, {
      headers: { Authorization: `Basic ${auth}`, Connection: 'close' }
    })
    
    if (!resInt.ok) {
       return new Response(JSON.stringify({ error: `Erro na API Mikrotik: ${resInt.status}` }), { 
         headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
       })
    }

    const interfaces = await resInt.json()
    const wanNames = ["BrisanetPPoe", "pppoe-out1"]
    const wanInterfaces = interfaces.filter((i: any) => wanNames.includes(i.name))

    if (wanInterfaces.length === 0) {
       return new Response(JSON.stringify({ error: "Nenhuma interface WAN encontrada" }), { 
         headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
       })
    }

    const testUrl = "http://ash-speed.hetzner.com/100MB.bin"
    const results = []

    for (const wan of wanInterfaces) {
      const interfaceName = wan.name
      const resAddr = await fetch(`http://${activeHost}:${port}/rest/ip/address?interface=${encodeURIComponent(interfaceName)}`, {
        headers: { Authorization: `Basic ${auth}`, Connection: 'close' }
      })
      const addresses = await resAddr.json()
      const rawIp = addresses?.[0]?.address || "0.0.0.0"
      const ip = rawIp.split('/')[0]

      if (ip === "0.0.0.0") {
        results.push({
          interface_name: interfaceName,
          rx_bytes: 0,
          tx_bytes: 0,
          mbps: 0,
          status: 'Offline',
          created_at: new Date().toISOString()
        })
        continue
      }

      console.log(`[Speedtest] Executando comandos na interface ${interfaceName} (IP: ${ip})`)
      
      let mbps = 0
      let rx_bytes = 0
      let status = 'Error'

      try {
        const fetchPayload = {
          url: testUrl,
          "src-address": ip,
          duration: "3s",
          mode: "http",
          "as-value": true
        }

        const resFetch = await fetch(`http://${activeHost}:${port}/rest/tool/fetch`, {
          method: 'POST',
          headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/json', Connection: 'close' },
          body: JSON.stringify(fetchPayload)
        })

        if (resFetch.ok) {
          const fetchResults = await resFetch.json()
          const lastSnapshot = Array.isArray(fetchResults) 
            ? fetchResults[fetchResults.length - 1] 
            : fetchResults
          
          rx_bytes = parseInt(lastSnapshot.downloaded || '0')
          const reportedDurationStr = lastSnapshot.duration || '3s'
          let reportedDuration = 3;
          if (reportedDurationStr.includes('s')) {
            const matches = reportedDurationStr.match(/(\d+)s/);
            if (matches) reportedDuration = Math.max(1, parseInt(matches[1]));
          }
          
          // Formula: (Bytes * 8 bits/byte) / (seconds * 1,000,000 bits/Mbit)
          const rawMbps = (rx_bytes * 8) / (reportedDuration * 1000 * 1000)
          
          // Sanity check: Mikrotik 'tool fetch' occasionally returns corrupt/cached summaries
          // If speed is > 2000 Mbps on a standard WAN, it's likely a calculation or reporting error
          mbps = rawMbps > 2000 ? 0 : Math.round(rawMbps * 100) / 100
          status = mbps > 0 ? 'Success' : 'Success (No Traffic)'
        } else {
          const errText = await resFetch.text()
          console.error(`Fetch error ${interfaceName}:`, resFetch.status, errText)
          status = 'Fetch Failed'
        }
      } catch (e: any) {
        console.error(`[Speedtest] Exception ${interfaceName}:`, e.message)
        status = 'Exception'
      }
      
      results.push({
        interface_name: interfaceName,
        rx_bytes: rx_bytes,
        tx_bytes: 0,
        mbps: mbps,
        status: status,
        created_at: new Date().toISOString()
      })
    }

    await supabase.from('wan_logs').insert(results.map(r => ({
      interface_name: r.interface_name,
      rx_bps: Math.round(r.mbps * 1000000),
      rx_bytes: r.rx_bytes,
      tx_bytes: r.tx_bytes,
      created_at: r.created_at
    })))

    const ADMIN_PHONE = '85986801458'
    let message = `🚀 *SPEED TEST MIKROTIK (MORORO.TECH)* 🚀\n\n`
    const now = new Date();
    const brDate = new Date(now.getTime() - (3 * 3600 * 1000));
    const formattedDate = brDate.toLocaleDateString('pt-BR') + ', ' + brDate.toLocaleTimeString('pt-BR');
    message += `📅 Data: ${formattedDate}\n\n`
    
    for (const res of results) {
      message += `🌐 *Interface: ${res.interface_name}*\n`
      if (res.status === 'Success') {
        message += `📥 Velocidade: *${res.mbps.toFixed(2)} Mbps*\n`
        message += `📦 Tráfego: ${(res.rx_bytes / (1024 * 1024)).toFixed(2)} MB\n`
      } else {
        message += `⚠️ Status: ${res.status}\n`
      }
      message += `\n`
    }

    await supabase.functions.invoke('whatsapp-send/send-text', {
      body: {
        phone: ADMIN_PHONE,
        message: message,
        customer_name: "Admin"
      },
      headers: {
        Authorization: `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`
      }
    })

    return new Response(JSON.stringify({ success: true, processed: results.length, host: activeHost }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})