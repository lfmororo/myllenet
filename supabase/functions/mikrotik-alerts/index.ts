import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { createClient } from "npm:@supabase/supabase-js@2";
import { getWhatsAppConfig, waSendText } from "../_shared/whatsapp.ts";

const ADMIN_PHONE = "85986801458";
const BOT_DISCLAIMER =
  "\n\n🤖 _Esta é uma mensagem automática. Para falar com um atendente, entre em contato: (85) 98680-1458_";

async function processBlockAlerts(supabase: any) {
  const { data: alerts, error } = await supabase
    .from("block_alerts_sent")
    .select(
      "id, customer_id, invoice_id, new_status, customers(nome, telefone)",
    )
    .or("processed.eq.false,processed.is.null")
    .order("created_at", { ascending: true })
    .limit(30);

  if (error) throw error;
  const cfg = await getWhatsAppConfig();
  let sent = 0;

  for (const alert of alerts || []) {
    const customer = alert.customers;
    if (!customer?.telefone) {
      console.error(`Block alert ${alert.id}: cliente sem telefone`);
      continue;
    }

    const messages: Record<string, string> = {
      blocked: `⚠️ *Aviso de Bloqueio*\n\nOlá ${customer.nome}, seu acesso à internet foi bloqueado por pendência financeira. Entre em contato com o atendimento para regularizar a situação.`,
      active: `✅ *Sinal Liberado*\n\nOlá ${customer.nome}, seu acesso à internet foi liberado novamente. Obrigado!`,
      deactivated: `🚫 *Serviço Desativado*\n\nOlá ${customer.nome}, seu plano de internet foi desativado e seu acesso foi encerrado. Se isso não estava previsto, entre em contato com o atendimento.`,
      reactivated: `🎉 *Serviço Reativado*\n\nOlá ${customer.nome}, seu plano de internet foi reativado e seu acesso está liberado. Bem-vindo de volta!`,
    };
    const types: Record<string, string> = {
      blocked: "cliente_bloqueado",
      active: "cliente_desbloqueado",
      deactivated: "cliente_desativado",
      reactivated: "cliente_reativado",
    };
    const message = messages[alert.new_status];
    const logType = types[alert.new_status] || "cliente_status";
    if (!message) {
      await supabase
        .from("block_alerts_sent")
        .update({ processed: true })
        .eq("id", alert.id);
      continue;
    }

    try {
      await waSendText(customer.telefone, message + BOT_DISCLAIMER, cfg);
      await supabase.from("notification_logs").insert({
        customer_id: alert.customer_id,
        customer_name: customer.nome,
        phone: customer.telefone,
        type: logType,
        message,
        status: "sent",
      });

      await supabase
        .from("block_alerts_sent")
        .update({ processed: true })
        .eq("id", alert.id);
      sent++;
    } catch (sendError) {
      const errorMessage = (sendError as Error).message;
      console.error(`Block alert ${alert.id} failed:`, errorMessage);
      await supabase.from("notification_logs").insert({
        customer_id: alert.customer_id,
        customer_name: customer.nome,
        phone: customer.telefone,
        type:
          alert.new_status === "blocked"
            ? "cliente_bloqueado"
            : "cliente_desbloqueado",
        message,
        status: "failed",
        error_message: errorMessage,
      });
    }
  }

  return sent;
}

async function processCustomerDisconnections(supabase: any) {
  const now = Date.now();
  const recentCutoff = new Date(now - 2 * 60 * 1000).toISOString();
  const comparisonStart = new Date(now - 10 * 60 * 1000).toISOString();
  const fiveMinutesAgo = now - 5 * 60 * 1000;
  const { data: snapshots, error } = await supabase
    .from("mikrotik_pppoe_snapshots")
    .select("host, collected_at, usernames")
    .eq("collection_ok", true)
    .gt("collected_at", comparisonStart)
    .order("collected_at", { ascending: false })
    .limit(100);

  if (error) throw error;
  const latest = snapshots?.find(
    (row: any) => row.collected_at >= recentCutoff,
  );
  if (!latest) return 0;
  const baseline = snapshots?.find(
    (row: any) =>
      row.host === latest.host &&
      new Date(row.collected_at).getTime() <= fiveMinutesAgo,
  );
  if (!baseline) return 0;

  const currentNames = new Set(
    (latest.usernames || []).map((name: unknown) => String(name).toLowerCase()),
  );
  const disconnectedNames = [
    ...new Set(
      (baseline.usernames || [])
        .map((name: unknown) => String(name).toLowerCase())
        .filter((name: string) => {
          if (currentNames.has(name)) return false;
          const lastPresence = snapshots.find((row: any) =>
            (row.usernames || []).some(
              (seen: unknown) => String(seen).toLowerCase() === name,
            ),
          );
          return (
            lastPresence &&
            new Date(lastPresence.collected_at).getTime() <= fiveMinutesAgo
          );
        }),
    ),
  ];
  if (disconnectedNames.length === 0) return 0;

  const { data: customers } = await supabase
    .from("customers")
    .select("id, nome, usuario_pppoe, alert_on_disconnect")
    .eq("ativo", true)
    .neq("block_status", "blocked")
    .eq("alert_on_disconnect", true);

  const customerMap = new Map(
    (customers || []).map((customer: any) => [
      String(customer.usuario_pppoe || "").toLowerCase(),
      customer,
    ]),
  );
  const cfg = await getWhatsAppConfig();
  let sent = 0;

  for (const username of disconnectedNames) {
    const customer = customerMap.get(username);
    if (!customer) continue;
    const { data: previousAlert } = await supabase
      .from("customer_alerts_sent")
      .select("id")
      .eq("customer_id", customer.id)
      .eq("alert_type", "disconnect")
      .gt("sent_at", new Date(now - 30 * 60 * 1000).toISOString())
      .maybeSingle();
    if (previousAlert) continue;

    const message = `⚠️ *ALERTA DE DESCONEXÃO* ⚠️\n\nO cliente *${customer.nome}* (${username}) está desconectado há pelo menos 5 minutos.\n\nÚltima presença confirmada: ${new Date(baseline.collected_at).toLocaleString("pt-BR")}`;
    try {
      await waSendText(ADMIN_PHONE, message + BOT_DISCLAIMER, cfg);
      await supabase
        .from("customer_alerts_sent")
        .insert({ customer_id: customer.id, alert_type: "disconnect" });
      sent++;
    } catch (sendError) {
      console.error(
        `Disconnect alert ${username} failed:`,
        (sendError as Error).message,
      );
    }
  }

  return sent;
}

async function processAgentCommunicationAlerts(supabase: any) {
  const thresholdMs = 2 * 60 * 1000;
  const now = Date.now();
  const { data: agents, error } = await supabase
    .from("agent_tokens")
    .select("id, name, created_at, last_seen_at")
    .eq("active", true);

  if (error) throw error;

  const cfg = await getWhatsAppConfig();
  let offlineSent = 0;
  let recoverySent = 0;

  for (const agent of agents || []) {
    const referenceTime = agent.last_seen_at || agent.created_at;
    if (!referenceTime) continue;

    const isOffline = now - new Date(referenceTime).getTime() > thresholdMs;
    const stateKey = `agent_communication_state_${agent.id}`;
    const { data: stateRow, error: stateError } = await supabase
      .from("settings")
      .select("value")
      .eq("key", stateKey)
      .maybeSingle();

    if (stateError) throw stateError;
    const previousState = stateRow?.value;

    const { data: recordedOfflineAlert, error: recordedAlertError } =
      await supabase
        .from("notification_logs")
        .select("id")
        .eq("type", "agent_offline")
        .eq("customer_name", agent.name)
        .eq("status", "sent")
        .gte("created_at", new Date(referenceTime).toISOString())
        .limit(1)
        .maybeSingle();

    if (recordedAlertError) throw recordedAlertError;

    if (isOffline && (previousState !== "offline" || !recordedOfflineAlert)) {
      const lastSeen = agent.last_seen_at
        ? new Date(agent.last_seen_at).toLocaleString("pt-BR")
        : "Nunca se comunicou";
      const message = `🚨 *ALERTA DO AGENTE* 🚨\n\nO agente *${agent.name}* está sem comunicação há mais de 2 minutos.\n\nÚltima atividade: ${lastSeen}\n\nVerifique se o serviço Node.js está em execução.`;

      try {
        await waSendText(ADMIN_PHONE, message + BOT_DISCLAIMER, cfg);
        const { error: logError } = await supabase
          .from("notification_logs")
          .insert({
            customer_name: agent.name,
            phone: ADMIN_PHONE,
            type: "agent_offline",
            message,
            status: "sent",
          });
        if (logError) throw logError;
        const { error: saveError } = await supabase
          .from("settings")
          .upsert({ key: stateKey, value: "offline" }, { onConflict: "key" });
        if (saveError) throw saveError;
        offlineSent++;
      } catch (sendError) {
        await supabase.from("notification_logs").insert({
          customer_name: agent.name,
          phone: ADMIN_PHONE,
          type: "agent_offline",
          message,
          status: "failed",
          error_message: (sendError as Error).message,
        });
        console.error(
          `Agent offline alert ${agent.id} failed:`,
          (sendError as Error).message,
        );
      }
    } else if (!isOffline && previousState === "offline") {
      const message = `✅ *AGENTE RECONECTADO* ✅\n\nO agente *${agent.name}* voltou a se comunicar normalmente.\n\nAtividade confirmada: ${new Date(referenceTime).toLocaleString("pt-BR")}`;

      try {
        await waSendText(ADMIN_PHONE, message + BOT_DISCLAIMER, cfg);
        const { error: logError } = await supabase
          .from("notification_logs")
          .insert({
            customer_name: agent.name,
            phone: ADMIN_PHONE,
            type: "agent_recovery",
            message,
            status: "sent",
          });
        if (logError) throw logError;
        const { error: saveError } = await supabase
          .from("settings")
          .upsert({ key: stateKey, value: "online" }, { onConflict: "key" });
        if (saveError) throw saveError;
        recoverySent++;
      } catch (sendError) {
        await supabase.from("notification_logs").insert({
          customer_name: agent.name,
          phone: ADMIN_PHONE,
          type: "agent_recovery",
          message,
          status: "failed",
          error_message: (sendError as Error).message,
        });
        console.error(
          `Agent recovery alert ${agent.id} failed:`,
          (sendError as Error).message,
        );
      }
    } else if (!isOffline && !previousState) {
      const { error: saveError } = await supabase
        .from("settings")
        .upsert({ key: stateKey, value: "online" }, { onConflict: "key" });
      if (saveError) throw saveError;
    }
  }

  return { offlineSent, recoverySent };
}

function errorFingerprint(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16);
}

async function processMikrotikErrorAlerts(supabase: any) {
  const since = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  const { data: history, error } = await supabase
    .from("mikrotik_status_history")
    .select("host, online, message, logged_at, diagnostics")
    .gte("logged_at", since)
    .order("logged_at", { ascending: false })
    .limit(100);

  if (error) throw error;

  const candidates: Array<{
    host: string;
    category: string;
    detail: string;
    loggedAt: string;
  }> = [];

  for (const row of history || []) {
    const diagnostics = row.diagnostics || {};
    if (!row.online) {
      candidates.push({
        host: row.host,
        category: "Falha de conexão",
        detail: diagnostics.error || row.message || "Host sem resposta",
        loggedAt: row.logged_at,
      });
    }

    const collectionErrors = [
      ["PPPoE", diagnostics.pppoe_collection_ok, diagnostics.pppoe_error],
      [
        "interfaces WAN",
        diagnostics.interface_collection_ok,
        diagnostics.interface_error,
      ],
      ["hardware", diagnostics.health_collection_ok, diagnostics.health_error],
      ["logs", diagnostics.log_collection_ok, diagnostics.log_error],
    ];
    for (const [label, collectionOk, collectionError] of collectionErrors) {
      if (collectionOk === false) {
        candidates.push({
          host: row.host,
          category: `Falha na coleta de ${label}`,
          detail: String(collectionError || "Erro sem descrição"),
          loggedAt: row.logged_at,
        });
      }
    }

    for (const routerLog of diagnostics.router_log_errors || []) {
      candidates.push({
        host: row.host,
        category: "Erro registrado no Mikrotik",
        detail: `${routerLog.topics ? `[${routerLog.topics}] ` : ""}${routerLog.message || "Erro sem descrição"}`,
        loggedAt: row.logged_at,
      });
    }
  }

  const cfg = await getWhatsAppConfig();
  const processed = new Set<string>();
  let sent = 0;

  for (const candidate of candidates) {
    const normalized =
      `${candidate.host}|${candidate.category}|${candidate.detail}`.toLowerCase();
    const alertType = `mikrotik_error_${errorFingerprint(normalized)}`;
    if (processed.has(alertType)) continue;
    processed.add(alertType);

    const { data: previousAlert } = await supabase
      .from("customer_alerts_sent")
      .select("id")
      .eq("alert_type", alertType)
      .gt("sent_at", new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString())
      .maybeSingle();
    if (previousAlert) continue;

    const message = `🚨 *ERRO NO MIKROTIK* 🚨\n\nHost: *${candidate.host}*\nTipo: *${candidate.category}*\nDetalhes: ${candidate.detail}\nData: ${new Date(candidate.loggedAt).toLocaleString("pt-BR")}`;
    try {
      await waSendText(ADMIN_PHONE, message + BOT_DISCLAIMER, cfg);
      const { error: saveError } = await supabase
        .from("customer_alerts_sent")
        .insert({ alert_type: alertType });
      if (saveError) throw saveError;
      sent++;
    } catch (sendError) {
      console.error(
        `Mikrotik error alert ${alertType} failed:`,
        (sendError as Error).message,
      );
    }
  }

  return sent;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS")
    return new Response("ok", { headers: corsHeaders });

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const blockAlertsSent = await processBlockAlerts(supabase);
    const disconnectAlertsSent = await processCustomerDisconnections(supabase);
    const agentAlerts = await processAgentCommunicationAlerts(supabase);
    const mikrotikErrorAlertsSent = await processMikrotikErrorAlerts(supabase);

    // 1. Check Mikrotik Connection Alerts with custom settings
    const { data: offlineThresholdData } = await supabase
      .from("settings")
      .select("value")
      .eq("key", "mikrotik_alert_offline_minutes")
      .single();

    const { data: countData } = await supabase
      .from("settings")
      .select("value")
      .eq("key", "mikrotik_alert_failure_count")
      .single();

    const alertMinutes = parseInt(offlineThresholdData?.value || "5");
    const failureThreshold = parseInt(countData?.value || "3");
    const timeThreshold = new Date(
      Date.now() - alertMinutes * 60 * 1000,
    ).toISOString();

    const { data: recentHistory } = await supabase
      .from("mikrotik_status_history")
      .select("*")
      .order("logged_at", { ascending: false })
      .limit(Math.max(10, failureThreshold));

    if (recentHistory && recentHistory.length >= failureThreshold) {
      const failures = recentHistory
        .slice(0, failureThreshold)
        .filter((h) => !h.online);

      if (failures.length >= failureThreshold) {
        const firstFailure = recentHistory[failures.length - 1];
        const isPersistent =
          new Date(firstFailure.logged_at).getTime() <=
          new Date(timeThreshold).getTime();

        if (isPersistent) {
          const alertType = "mikrotik_global_offline";
          const { data: alreadyAlerted } = await supabase
            .from("customer_alerts_sent")
            .select("id")
            .eq("alert_type", alertType)
            .gt("sent_at", new Date(Date.now() - 60 * 60 * 1000).toISOString())
            .single();

          if (!alreadyAlerted) {
            console.log(
              `ALERT: Mikrotik Offline for > ${alertMinutes} minutes and ${failureThreshold} failures`,
            );
            await supabase.functions.invoke("whatsapp-send/send-text", {
              body: {
                phone: ADMIN_PHONE,
                message: `🚨 *ALERTA DE MONITORAMENTO* 🚨\n\nO servidor Mikrotik está *OFF-LINE* há mais de ${alertMinutes} minutos e atingiu ${failureThreshold} falhas consecutivas!\n\nÚltimo erro: ${recentHistory[0].message}`,
              },
            });
            await supabase.from("customer_alerts_sent").insert({
              alert_type: alertType,
              sent_at: new Date().toISOString(),
            });
          }
        }
      }
    }

    // 2. Check Customer Disconnection Alerts (5 minutes)
    const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    const { data: disconnections } = await supabase.rpc(
      "get_recent_disconnections",
      {
        since_time: fiveMinAgo,
      },
    );

    if (disconnections && disconnections.length > 0) {
      for (const disc of disconnections) {
        const { data: customer } = await supabase
          .from("customers")
          .select("alert_on_disconnect, nome")
          .eq("id", disc.customer_id)
          .single();

        if (customer?.alert_on_disconnect) {
          const { data: recentAlert } = await supabase
            .from("customer_alerts_sent")
            .select("id")
            .eq("customer_id", disc.customer_id)
            .eq("alert_type", "disconnect")
            .gt("sent_at", new Date(Date.now() - 30 * 60 * 1000).toISOString())
            .single();

          if (!recentAlert) {
            console.log(`ALERT: Customer ${disc.usuario_pppoe} Offline`);
            await supabase.functions.invoke("whatsapp-send/send-text", {
              body: {
                phone: ADMIN_PHONE,
                message: `⚠️ *ALERTA DE DESCONEXÃO* ⚠️\n\nO cliente *${disc.nome}* (${disc.usuario_pppoe}) está off-line há mais de 5 minutos!\n\nÚltima atividade: ${new Date(disc.last_seen).toLocaleString("pt-BR")}`,
              },
            });
            await supabase.from("customer_alerts_sent").insert({
              customer_id: disc.customer_id,
              alert_type: "disconnect",
            });
          }
        }
      }
    }

    // 3. Check for Frequent Drops
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const { data: frequentDrops } = await supabase.rpc("check_frequent_drops", {
      time_threshold: oneHourAgo,
      drop_count: 3,
    });

    if (frequentDrops) {
      for (const drop of frequentDrops) {
        const { data: customer } = await supabase
          .from("customers")
          .select("alert_on_frequent_drops, nome")
          .eq("id", drop.customer_id)
          .single();

        if (customer?.alert_on_frequent_drops) {
          const { data: recentAlert } = await supabase
            .from("customer_alerts_sent")
            .select("id")
            .eq("customer_id", drop.customer_id)
            .eq("alert_type", "frequent_drops")
            .gt(
              "sent_at",
              new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
            )
            .single();

          if (!recentAlert) {
            await supabase.functions.invoke("whatsapp-send/send-text", {
              body: {
                phone: ADMIN_PHONE,
                message: `📉 *ALERTA DE INSTABILIDADE* 📉\n\nO cliente *${customer.nome}* teve *${drop.count} quedas* na última hora!\n\nIsso pode indicar um problema físico no cabo ou no roteador do cliente.`,
              },
            });
            await supabase.from("customer_alerts_sent").insert({
              customer_id: drop.customer_id,
              alert_type: "frequent_drops",
            });
          }
        }
      }
    }

    // 4. Check for Abnormal Usage
    const { data: highUsage } = await supabase.rpc("check_abnormal_usage", {
      bytes_threshold: 500 * 1024 * 1024, // 500 MB
    });

    if (highUsage) {
      for (const usage of highUsage) {
        const { data: customer } = await supabase
          .from("customers")
          .select("alert_on_abnormal_usage, nome")
          .eq("id", usage.customer_id)
          .single();

        if (customer?.alert_on_abnormal_usage) {
          const { data: recentAlert } = await supabase
            .from("customer_alerts_sent")
            .select("id")
            .eq("customer_id", usage.customer_id)
            .eq("alert_type", "abnormal_usage")
            .gt(
              "sent_at",
              new Date(Date.now() - 4 * 60 * 60 * 1000).toISOString(),
            )
            .single();

          if (!recentAlert) {
            const consumption = (usage.total_bytes / (1024 * 1024)).toFixed(2);
            await supabase.functions.invoke("whatsapp-send/send-text", {
              body: {
                phone: ADMIN_PHONE,
                message: `🚀 *ALERTA DE CONSUMO ANORMAL* 🚀\n\nO cliente *${customer.nome}* consumiu *${consumption} MB* nos últimos 15 minutos.\n\nVerifique se há uso indevido ou necessidade de upgrade de plano.`,
              },
            });
            await supabase.from("customer_alerts_sent").insert({
              customer_id: usage.customer_id,
              alert_type: "abnormal_usage",
            });
          }
        }
      }
    }

    // 5. Check WAN Status Alerts
    const { data: recentWanHistory } = await supabase
      .from("wan_status_history")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(10);

    if (recentWanHistory && recentWanHistory.length > 0) {
      for (const event of recentWanHistory) {
        const { data: alerted } = await supabase
          .from("customer_alerts_sent")
          .select("id")
          .eq("alert_type", `wan_${event.interface_name}_${event.status}`)
          .gt("sent_at", new Date(Date.now() - 60 * 60 * 1000).toISOString())
          .single();

        if (!alerted) {
          const isUp = event.status === "up";
          const emoji = isUp ? "✅" : "❌";
          const statusText = isUp ? "RECUPERADA" : "FORA DO AR";

          await supabase.functions.invoke("whatsapp-send/send-text", {
            body: {
              phone: ADMIN_PHONE,
              message: `${emoji} *ALERTA WAN: ${event.interface_name}* ${emoji}\n\nA interface está *${statusText}*!\n\nMotivo: ${event.reason || "N/A"}\nData: ${new Date(event.created_at).toLocaleString("pt-BR")}`,
            },
          });

          await supabase.from("customer_alerts_sent").insert({
            alert_type: `wan_${event.interface_name}_${event.status}`,
            sent_at: new Date().toISOString(),
          });
        }
      }
    }

    // 6. Check WAN Speed Alerts
    const { data: speedThresholdData } = await supabase
      .from("settings")
      .select("value")
      .eq("key", "mikrotik_speed_threshold_mbps")
      .single();

    const { data: intervalData } = await supabase
      .from("settings")
      .select("value")
      .eq("key", "mikrotik_alert_interval_minutes")
      .single();

    const speedThresholdMbps = parseFloat(speedThresholdData?.value || "10");
    const alertIntervalMinutes = parseInt(intervalData?.value || "30");
    const intervalAgo = new Date(
      Date.now() - alertIntervalMinutes * 60 * 1000,
    ).toISOString();

    const { data: speedMetrics } = await supabase
      .from("wan_logs")
      .select("interface_name, rx_bps")
      .gt("created_at", intervalAgo);

    if (speedMetrics && speedMetrics.length > 0) {
      const averages = speedMetrics.reduce(
        (acc: Record<string, { sum: number; count: number }>, curr) => {
          if (!acc[curr.interface_name])
            acc[curr.interface_name] = { sum: 0, count: 0 };
          acc[curr.interface_name].sum += Number(curr.rx_bps || 0);
          acc[curr.interface_name].count += 1;
          return acc;
        },
        {},
      );

      for (const [iface, stats] of Object.entries(averages)) {
        const avgMbps = Math.min(2000, stats.sum / stats.count / 1_000_000);

        if (avgMbps < speedThresholdMbps) {
          const { data: alerted } = await supabase
            .from("customer_alerts_sent")
            .select("id")
            .eq("alert_type", `wan_speed_low_${iface}`)
            .gt(
              "sent_at",
              new Date(Date.now() - 4 * 60 * 60 * 1000).toISOString(),
            )
            .single();

          if (!alerted) {
            await supabase.functions.invoke("whatsapp-send/send-text", {
              body: {
                phone: ADMIN_PHONE,
                message: `⚠️ *ALERTA DE DESEMPENHO WAN* ⚠️\n\nA interface *${iface}* está operando abaixo do limite!\n\nMédia atual: *${avgMbps.toFixed(2)} Mbps*\nLimite configurado: *${speedThresholdMbps} Mbps*\nPeríodo analisado: *${alertIntervalMinutes} min*`,
              },
            });

            await supabase.from("customer_alerts_sent").insert({
              alert_type: `wan_speed_low_${iface}`,
              sent_at: new Date().toISOString(),
            });
          }
        }
      }
    }

    return json({
      success: true,
      block_alerts_sent: blockAlertsSent,
      disconnect_alerts_sent: disconnectAlertsSent,
      agent_offline_alerts_sent: agentAlerts.offlineSent,
      agent_recovery_alerts_sent: agentAlerts.recoverySent,
      mikrotik_error_alerts_sent: mikrotikErrorAlertsSent,
    });
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});
