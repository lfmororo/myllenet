import { corsHeaders } from "https://esm.sh/@supabase/supabase-js@2/cors";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.38.4";
import { exigir } from "../_shared/auth.ts";
import { carregarConfig } from "../_shared/config.ts";
let PROVEDOR = "Mororo.Tech";
let PAINEL = "https://myllenet.mororo.tech";
let TELEFONE_FMT = "";
let SLOGAN = "";

const START = Date.now();
const DEADLINE_MS = 100_000; // stay well under the 150s idle limit
const CONCURRENCY = 10;

const timeLeft = () => DEADLINE_MS - (Date.now() - START);

async function restCall(
  base: string,
  path: string,
  auth: string,
  method = "GET",
  body?: any,
  timeoutMs = 6000,
) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetch(`${base}/rest${path}`, {
      method,
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/json",
        Connection: "close",
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: ac.signal,
    });
    return {
      ok: res.ok,
      status: res.status,
      data: await res.json().catch(() => null),
    };
  } catch (e) {
    return { ok: false, status: 0, data: null, error: (e as Error).message };
  } finally {
    clearTimeout(t);
  }
}

async function runPool<T>(items: T[], worker: (item: T) => Promise<void>) {
  let i = 0;
  const runners = Array.from(
    { length: Math.min(CONCURRENCY, items.length) },
    async () => {
      while (i < items.length) {
        if (timeLeft() < 8000) return;
        const item = items[i++];
        try {
          await worker(item);
        } catch (_e) {
          // keep going; one bad item must not abort the sync
        }
      }
    },
  );
  await Promise.all(runners);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS")
    return new Response("ok", { headers: corsHeaders });
  const negado = await exigir(req, "usuario");
  if (negado) return negado;
  { const __c = await carregarConfig(); PROVEDOR = __c.provedor; PAINEL = __c.painel; TELEFONE_FMT = __c.telefoneFmt; SLOGAN = __c.slogan; }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: settings } = await supabase
      .from("settings")
      .select("key,value")
      .in("key", [
        "mikrotik_host",
        "mikrotik_host_secondary",
        "mikrotik_username",
        "mikrotik_password",
        "mikrotik_rest_port",
        "blocking_days",
      ]);

    const cfg: any = {};
    settings?.forEach((s) => (cfg[s.key] = s.value));

    const hosts = [cfg.mikrotik_host, cfg.mikrotik_host_secondary]
      .map((h: string) => (h || "").trim())
      .filter(Boolean);
    if (!hosts.length) {
      return new Response(
        JSON.stringify({
          success: false,
          error: "Mikrotik host não configurado",
        }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    const user = cfg.mikrotik_username || "admin";
    const pass = cfg.mikrotik_password || "";
    const port = cfg.mikrotik_rest_port || "80";
    const auth = btoa(`${user}:${pass}`);
    // vpsfaedi: tenta o host principal e, se não responder, o secundário
    let base = "";
    let probe: any = { ok: false, status: 0 };
    const tentativas: string[] = [];
    for (const h of hosts) {
      const b = `http://${h}:${port}`;
      probe = await restCall(b, "/system/resource", auth, "GET", undefined, 5000);
      tentativas.push(`${h}:${port} → ${probe.status || probe.error || "sem resposta"}`);
      if (probe.ok) { base = b; break; }
    }
    if (!probe.ok) {
      return new Response(
        JSON.stringify({
          success: false,
          error:
            "API REST do Mikrotik não respondeu. Habilite com /ip service enable www e libere a porta no firewall.",
          status: probe.status,
          tentativas,
        }),
        {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    const stats = {
      profiles: 0,
      secrets: 0,
      updated: 0,
      kicked: 0,
      alerts: 0,
      skipped: 0,
    };

    // 1. Fetch existing router state once (instead of one query per item)
    const [profilesRes, secretsRes, activeRes] = await Promise.all([
      restCall(base, "/ppp/profile", auth),
      restCall(base, "/ppp/secret", auth, "GET", undefined, 15000),
      restCall(base, "/ppp/active", auth, "GET", undefined, 15000),
    ]);

    const profileMap = new Map<string, any>();
    if (Array.isArray(profilesRes.data))
      profilesRes.data.forEach((p: any) => profileMap.set(p.name, p));
    const secretMap = new Map<string, any>();
    if (Array.isArray(secretsRes.data))
      secretsRes.data.forEach((s: any) => secretMap.set(s.name, s));
    const activeMap = new Map<string, any>();
    if (Array.isArray(activeRes.data))
      activeRes.data.forEach((a: any) => activeMap.set(a.name, a));

    // 2. Sync profiles (plans)
    const { data: plans } = await supabase.from("plans").select("*");
    await runPool(plans || [], async (plan: any) => {
      const speed = plan.nome?.match(/\d+/)?.[0] || "10";
      const limit = `${speed}M/${speed}M`;
      const existing = profileMap.get(plan.nome);
      if (!existing) {
        await restCall(base, "/ppp/profile", auth, "PUT", {
          name: plan.nome,
          "local-address": "10.0.0.1",
          "rate-limit": limit,
        });
        stats.profiles++;
      } else if (existing["rate-limit"] !== limit) {
        await restCall(base, `/ppp/profile/${existing[".id"]}`, auth, "PATCH", {
          "rate-limit": limit,
        });
        stats.profiles++;
      }
    });

    // 3. Sync customers (secrets) and handle blocking
    const { data: customers } = await supabase
      .from("customers")
      .select("*, plans(nome)")
      .not("usuario_pppoe", "is", null);

    await runPool(customers || [], async (customer: any) => {
      const planName = customer.plans?.nome || "default";
      const isBlocked = customer.block_status === "blocked" || !customer.ativo;

      const secretData = {
        name: customer.usuario_pppoe,
        password: customer.senha_pppoe,
        service: "pppoe",
        profile: planName,
        disabled: isBlocked ? "true" : "false",
        comment: `ID: ${customer.id} | Status: ${customer.block_status}`,
      };

      const existing = secretMap.get(customer.usuario_pppoe);
      let changed = false;

      if (!existing) {
        await restCall(base, "/ppp/secret", auth, "PUT", secretData);
        stats.secrets++;
        changed = true;
      } else {
        const currentDisabled = existing.disabled === "true";
        const profileDiff = existing.profile !== planName;
        const passDiff =
          customer.senha_pppoe && existing.password !== customer.senha_pppoe;
        if (currentDisabled !== isBlocked || profileDiff || passDiff) {
          await restCall(
            base,
            `/ppp/secret/${existing[".id"]}`,
            auth,
            "PATCH",
            secretData,
          );
          stats.updated++;
          changed = true;
        }
      }

      // Kick live session when the customer was just blocked
      if (isBlocked && changed) {
        const session = activeMap.get(customer.usuario_pppoe);
        if (session) {
          await restCall(base, `/ppp/active/${session[".id"]}`, auth, "DELETE");
          stats.kicked++;
        }
      }
    });

    // 4. Send pending block alerts (independent of the router loop)
    if (timeLeft() > 15000) {
      const { data: pendingAlerts } = await supabase
        .from("block_alerts_sent" as any)
        .select("*, customers(nome, telefone)")
        .or("processed.eq.false,processed.is.null")
        .limit(30);

      for (const alert of (pendingAlerts as any[]) || []) {
        if (timeLeft() < 8000) break;
        const customer = alert.customers;
        if (!customer?.telefone) continue;
        const blockingDays = cfg.blocking_days || "15";
        const invoiceUrl = alert.invoice_id
          ? `${PAINEL}/fatura/${alert.invoice_id}`
          : `${PAINEL}/clientes`;
        const message =
          alert.new_status === "blocked"
            ? `⚠️ *Aviso de Bloqueio:* Olá ${customer.nome}, identificamos uma fatura com mais de ${blockingDays} dias de atraso e seu sinal foi suspenso automaticamente. Regularize para restabelecer a conexão.\n\n🔗 *Link da Fatura:* ${invoiceUrl}`
            : `✅ *Sinal Liberado:* Olá ${customer.nome}, seu pagamento foi identificado e seu sinal já foi liberado no sistema. Obrigado!`;

        try {
          const { data: sendData, error: sendError } =
            await supabase.functions.invoke("whatsapp-send/send-text", {
              body: {
                phone: customer.telefone,
                message,
                customer_id: alert.customer_id,
                customer_name: customer.nome,
                type: "block_alert",
              },
            });
          if (sendError || (sendData && (sendData as any).error)) {
            console.error(
              "WhatsApp block alert failed:",
              sendError?.message || (sendData as any)?.error,
            );
            continue; // não marca como processado; será tentado novamente
          }
          await supabase
            .from("block_alerts_sent" as any)
            .update({ processed: true } as any)
            .eq("id", alert.id);
          stats.alerts++;
        } catch (e) {
          console.error("Error sending block alert WhatsApp:", e);
        }
      }
    }

    const partial = timeLeft() < 8000;
    return new Response(
      JSON.stringify({
        success: true,
        partial,
        elapsed_ms: Date.now() - START,
        ...stats,
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  } catch (e) {
    return new Response(
      JSON.stringify({ success: false, error: (e as Error).message }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }
});
