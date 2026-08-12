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
      .in('key', ['mikrotik_host', 'mikrotik_username', 'mikrotik_password', 'mikrotik_rest_port'])

    const cfg: Record<string, string> = {}
    for (const r of rows ?? []) cfg[r.key] = r.value ?? ''

    const host = (cfg.mikrotik_host || '').trim()
    const user = cfg.mikrotik_username || 'admin'
    const pass = cfg.mikrotik_password || ''
    const port = cfg.mikrotik_rest_port || '80'
    const auth = btoa(`${user}:${pass}`)

    if (!host) {
      return new Response(JSON.stringify({ error: "Host Mikrotik não configurado" }), { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      })
    }

    // 1. Get WAN interfaces to know which IPs to test from
    const resInt = await fetch(`http://${host}:${port}/rest/interface`, {
      headers: { Authorization: `Basic ${auth}`, Connection: 'close' }
    })
    
    if (!resInt.ok) {
       return new Response(JSON.stringify({ error: `Erro na API Mikrotik: ${resInt.status}` }), { 
         headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
       })
    }

    const interfaces = await resInt.json()
    // Identificar WANs conforme o script fornecido
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
      // Pegar o IP da interface (equivalente ao script .rsc)
      const resAddr = await fetch(`http://${host}:${port}/rest/ip/address?interface=${encodeURIComponent(interfaceName)}`, {
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

      // Executar o teste via Tool Fetch (equivalente ao script .rsc)
      // Nota: A API REST do Mikrotik permite executar comandos via POST /rest/tool/fetch
      // Executar o script speedteste.rsc no Mikrotik
      console.log(`[Speedtest] Executando comandos na interface ${interfaceName} (IP: ${ip})`)
      
      let mbps = 0
      let rx_bytes = 0
      let status = 'Error'

      try {
        // Definir o payload para o fetch (mesma lógica do script .rsc)
        const fetchPayload = {
          url: testUrl,
          "src-address": ip,
          duration: "10s",
          mode: "http",
          "as-value": true
        }

        // Tentar rodar o import do script primeiro
        try {
          await fetch(`http://${host}:${port}/rest/import`, {
            method: 'POST',
            headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/json', Connection: 'close' },
            body: JSON.stringify({ "file-name": "speedteste.rsc" })
          })
        } catch (e) {
          console.log("Import not supported or failed, falling back to tool fetch")
        }

        const resFetch = await fetch(`http://${host}:${port}/rest/tool/fetch`, {
          method: 'POST',
          headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/json', Connection: 'close' },
          body: JSON.stringify(fetchPayload)
        })

        if (resFetch.ok) {
          const fetchResults = await resFetch.json()
          // Mikrotik with as-value: true returns an array of progress snapshots
          // We want the last one to get total downloaded bytes
          const lastSnapshot = Array.isArray(fetchResults) 
            ? fetchResults[fetchResults.length - 1] 
            : fetchResults
          
          rx_bytes = parseInt(lastSnapshot.downloaded || '0')
          // Calculate speed based on actual duration reported by Mikrotik if available
          const reportedDurationStr = lastSnapshot.duration || '10s'
          // Extract seconds from duration (e.g., "10s", "0s", "1m2s")
          let reportedDuration = 10;
          if (reportedDurationStr.includes('s')) {
            const matches = reportedDurationStr.match(/(\d+)s/);
            if (matches) reportedDuration = Math.max(1, parseInt(matches[1]));
          }
          
          mbps = Math.round(((rx_bytes * 8) / (reportedDuration * 1000 * 1000)) * 100) / 100
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

    // Insert into wan_logs
    await supabase.from('wan_logs').insert(results.map(r => ({
      interface_name: r.interface_name,
      rx_bps: Math.round(r.mbps * 1000000),
      rx_bytes: r.rx_bytes,
      tx_bytes: r.tx_bytes,
      created_at: r.created_at
    })))

    // Send WhatsApp Report to Admin
    const ADMIN_PHONE = '85986801458'
    let message = `🚀 *SPEED TEST MIKROTIK (MORORO.TECH)* 🚀\n\n`
    const now = new Date();
    // Offset for Brazil/Fortaleza (UTC-3)
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

    // Explicitly append disclaimer here since we are invoking the internal send-text
    // which normally appends it, but we want to be sure the message matches exactly what the user sees
    // and the whatsapp-send function's sendText already adds BOT_DISCLAIMER.

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

    return new Response(JSON.stringify({ success: true, processed: results.length }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
