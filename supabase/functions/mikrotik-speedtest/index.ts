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

    // 1. Get WAN interfaces
    const resInt = await fetch(`http://${host}:${port}/rest/interface`, {
      headers: { Authorization: `Basic ${auth}`, Connection: 'close' }
    })
    
    if (!resInt.ok) {
       return new Response(JSON.stringify({ error: `Erro na API Mikrotik: ${resInt.status}` }), { 
         headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
       })
    }

    const interfaces = await resInt.json()
    const wanInterfaces = interfaces.filter((i: any) => /wan|uplink|internet|link/i.test(`${i.name} ${i.comment}`))

    if (wanInterfaces.length === 0) {
       return new Response(JSON.stringify({ error: "Nenhuma interface WAN encontrada" }), { 
         headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
       })
    }

    const results = []
    for (const wan of wanInterfaces) {
      const rx = parseInt(wan['rx-byte'] || '0')
      const tx = parseInt(wan['tx-byte'] || '0')
      
      results.push({
        interface_name: wan.name,
        rx_bytes: rx,
        tx_bytes: tx,
        created_at: new Date().toISOString()
      })
    }

    // Insert into wan_logs (which already exists for metrics)
    await supabase.from('wan_logs').insert(results)

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
