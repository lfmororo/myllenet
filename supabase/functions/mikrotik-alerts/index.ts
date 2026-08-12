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

    const ADMIN_PHONE = '85986801458'

    // 1. Check Mikrotik Connection Alerts (3 minutes)
    const { data: recentHistory } = await supabase
      .from('mikrotik_status_history')
      .select('*')
      .order('logged_at', { ascending: false })
      .limit(5)

    if (recentHistory && recentHistory.length >= 3) {
      const allOffline = recentHistory.slice(0, 3).every(h => !h.online)
      if (allOffline) {
        console.log("ALERT: Mikrotik Offline for > 3 minutes")
        await supabase.functions.invoke('whatsapp-send/send-text', {
          body: {
            phone: ADMIN_PHONE,
            message: `🚨 *ALERTA DE MONITORAMENTO* 🚨\n\nO servidor Mikrotik está *OFF-LINE* em todos os endereços configurados há mais de 3 minutos!\n\nÚltimo erro: ${recentHistory[0].message}`
          }
        })
      }
    }

    // 2. Check Customer Disconnection Alerts (5 minutes)
    const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString()
    const { data: disconnections } = await supabase.rpc('get_recent_disconnections', {
      since_time: fiveMinAgo
    })

    if (disconnections && disconnections.length > 0) {
      for (const disc of disconnections) {
        const { data: customer } = await supabase
          .from('customers')
          .select('alert_on_disconnect, nome')
          .eq('id', disc.customer_id)
          .single()

        if (customer?.alert_on_disconnect) {
          const { data: recentAlert } = await supabase
            .from('customer_alerts_sent')
            .select('id')
            .eq('customer_id', disc.customer_id)
            .eq('alert_type', 'disconnect')
            .gt('sent_at', new Date(Date.now() - 30 * 60 * 1000).toISOString())
            .single()

          if (!recentAlert) {
            console.log(`ALERT: Customer ${disc.usuario_pppoe} Offline`)
            await supabase.functions.invoke('whatsapp-send/send-text', {
              body: {
                phone: ADMIN_PHONE,
                message: `⚠️ *ALERTA DE DESCONEXÃO* ⚠️\n\nO cliente *${disc.nome}* (${disc.usuario_pppoe}) está off-line há mais de 5 minutos!\n\nÚltima atividade: ${new Date(disc.last_seen).toLocaleString('pt-BR')}`
              }
            })
            await supabase.from('customer_alerts_sent').insert({
              customer_id: disc.customer_id,
              alert_type: 'disconnect'
            })
          }
        }
      }
    }

    // 3. Check for Frequent Drops
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString()
    const { data: frequentDrops } = await supabase.rpc('check_frequent_drops', {
      time_threshold: oneHourAgo,
      drop_count: 3
    })

    if (frequentDrops) {
      for (const drop of frequentDrops) {
        const { data: customer } = await supabase
          .from('customers')
          .select('alert_on_frequent_drops, nome')
          .eq('id', drop.customer_id)
          .single()

        if (customer?.alert_on_frequent_drops) {
          const { data: recentAlert } = await supabase
            .from('customer_alerts_sent')
            .select('id')
            .eq('customer_id', drop.customer_id)
            .eq('alert_type', 'frequent_drops')
            .gt('sent_at', new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString())
            .single()

          if (!recentAlert) {
            await supabase.functions.invoke('whatsapp-send/send-text', {
              body: {
                phone: ADMIN_PHONE,
                message: `📉 *ALERTA DE INSTABILIDADE* 📉\n\nO cliente *${customer.nome}* teve *${drop.count} quedas* na última hora!\n\nIsso pode indicar um problema físico no cabo ou no roteador do cliente.`
              }
            })
            await supabase.from('customer_alerts_sent').insert({
              customer_id: drop.customer_id,
              alert_type: 'frequent_drops'
            })
          }
        }
      }
    }

    // 4. Check for Abnormal Usage
    const { data: highUsage } = await supabase.rpc('check_abnormal_usage', {
      bytes_threshold: 500 * 1024 * 1024 // 500 MB
    })

    if (highUsage) {
      for (const usage of highUsage) {
        const { data: customer } = await supabase
          .from('customers')
          .select('alert_on_abnormal_usage, nome')
          .eq('id', usage.customer_id)
          .single()

        if (customer?.alert_on_abnormal_usage) {
          const { data: recentAlert } = await supabase
            .from('customer_alerts_sent')
            .select('id')
            .eq('customer_id', usage.customer_id)
            .eq('alert_type', 'abnormal_usage')
            .gt('sent_at', new Date(Date.now() - 4 * 60 * 60 * 1000).toISOString())
            .single()

          if (!recentAlert) {
            const consumption = (usage.total_bytes / (1024 * 1024)).toFixed(2)
            await supabase.functions.invoke('whatsapp-send/send-text', {
              body: {
                phone: ADMIN_PHONE,
                message: `🚀 *ALERTA DE CONSUMO ANORMAL* 🚀\n\nO cliente *${customer.nome}* consumiu *${consumption} MB* nos últimos 15 minutos.\n\nVerifique se há uso indevido ou necessidade de upgrade de plano.`
              }
            })
            await supabase.from('customer_alerts_sent').insert({
              customer_id: usage.customer_id,
              alert_type: 'abnormal_usage'
            })
          }
        }
      }
    }
    
    // 5. Check WAN Status Alerts
    const { data: recentWanHistory } = await supabase
      .from('wan_status_history')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(10)

    if (recentWanHistory && recentWanHistory.length > 0) {
      for (const event of recentWanHistory) {
        const { data: alerted } = await supabase
          .from('customer_alerts_sent')
          .select('id')
          .eq('alert_type', `wan_${event.interface_name}_${event.status}`)
          .gt('sent_at', new Date(Date.now() - 60 * 60 * 1000).toISOString())
          .single()

        if (!alerted) {
          const isUp = event.status === 'up'
          const emoji = isUp ? '✅' : '❌'
          const statusText = isUp ? 'RECUPERADA' : 'FORA DO AR'
          
          await supabase.functions.invoke('whatsapp-send/send-text', {
            body: {
              phone: ADMIN_PHONE,
              message: `${emoji} *ALERTA WAN: ${event.interface_name}* ${emoji}\n\nA interface está *${statusText}*!\n\nMotivo: ${event.reason || 'N/A'}\nData: ${new Date(event.created_at).toLocaleString('pt-BR')}`
            }
          })

          await supabase.from('customer_alerts_sent').insert({
            alert_type: `wan_${event.interface_name}_${event.status}`,
            sent_at: new Date().toISOString()
          })
        }
      }
    }
    
    // 6. Check WAN Speed Alerts
    const { data: thresholdData } = await supabase
      .from('settings')
      .select('value')
      .eq('key', 'mikrotik_speed_threshold_mbps')
      .single()
    
    const { data: intervalData } = await supabase
      .from('settings')
      .select('value')
      .eq('key', 'mikrotik_alert_interval_minutes')
      .single()

    const speedThresholdMbps = parseFloat(thresholdData?.value || '10')
    const alertIntervalMinutes = parseInt(intervalData?.value || '30')
    const intervalAgo = new Date(Date.now() - alertIntervalMinutes * 60 * 1000).toISOString()
    
    const { data: speedMetrics } = await supabase
      .from('wan_logs')
      .select('interface_name, rx_bps')
      .gt('created_at', intervalAgo)

    if (speedMetrics && speedMetrics.length > 0) {
      const averages = speedMetrics.reduce((acc: Record<string, { sum: number, count: number }>, curr) => {
        if (!acc[curr.interface_name]) acc[curr.interface_name] = { sum: 0, count: 0 }
        acc[curr.interface_name].sum += Number(curr.rx_bps || 0)
        acc[curr.interface_name].count += 1
        return acc;
      }, {})

      for (const [iface, stats] of Object.entries(averages)) {
        const avgMbps = Math.min(2000, (stats.sum / stats.count) / 1_000_000)
        
        if (avgMbps < speedThresholdMbps) {
          const { data: alerted } = await supabase
            .from('customer_alerts_sent')
            .select('id')
            .eq('alert_type', `wan_speed_low_${iface}`)
            .gt('sent_at', new Date(Date.now() - 4 * 60 * 60 * 1000).toISOString())
            .single()

          if (!alerted) {
            await supabase.functions.invoke('whatsapp-send/send-text', {
              body: {
                phone: ADMIN_PHONE,
                message: `⚠️ *ALERTA DE DESEMPENHO WAN* ⚠️\n\nA interface *${iface}* está operando abaixo do limite!\n\nMédia atual: *${avgMbps.toFixed(2)} Mbps*\nLimite configurado: *${speedThresholdMbps} Mbps*\nPeríodo analisado: *${alertIntervalMinutes} min*`
              }
            })

            await supabase.from('customer_alerts_sent').insert({
              alert_type: `wan_speed_low_${iface}`,
              sent_at: new Date().toISOString()
            })
          }
        }
      }
    }

    return json({ success: true })
  } catch (e) {
    return json({ error: (e as Error).message }, 500)
  }
})