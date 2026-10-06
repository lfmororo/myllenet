import cron from "node-cron";
import type { FastifyInstance } from "fastify";
import { config } from "./config.js";

async function invoke(app: FastifyInstance, url: string) {
  try {
    const res = await app.inject({
      method: "POST",
      url,
      headers: { "x-cron-secret": config.cronSecret },
    });
    if (res.statusCode >= 400) console.error(`[job ${url}] ${res.statusCode}: ${res.body}`);
  } catch (e) {
    console.error(`[job ${url}] erro:`, e);
  }
}

export function registerJobs(app: FastifyInstance) {
  // Bloqueio automático por inadimplência (15 dias, configurável)
  cron.schedule("0 2 * * *", () => invoke(app, "/api/rpc/check_and_block_overdue_customers"));
  // Bloqueio de 30 dias (legado)
  cron.schedule("0 4 * * *", () => invoke(app, "/api/functions/auto-block-30d"));

  // Checagem de pagamentos EFI a cada 15 min
  cron.schedule("*/15 * * * *", () => invoke(app, "/api/functions/efi-boleto/bulk-check"));
  // Sincronização Mikrotik a cada 15 min
  cron.schedule("*/15 * * * *", () => invoke(app, "/api/functions/mikrotik-sync"));
  // Alertas Mikrotik / bloqueio / desconexões a cada 5 min
  cron.schedule("*/5 * * * *", () => invoke(app, "/api/functions/mikrotik-alerts"));
  cron.schedule("*/5 * * * *", () => invoke(app, "/api/functions/evolution-monitor"));
  // Speedtest horário
  cron.schedule("0 * * * *", () => invoke(app, "/api/functions/mikrotik-speedtest"));

  // Lembretes e relatórios
  cron.schedule("0 7 * * *", () => invoke(app, "/api/functions/daily-report"));
  cron.schedule("0 8 * * *", () => invoke(app, "/api/functions/due-reminder"));
  cron.schedule("0 9 * * *", () => invoke(app, "/api/functions/cutoff-warning"));
  // Geração mensal de faturas (dia 1)
  cron.schedule("0 6 1 * *", () => invoke(app, "/api/functions/monthly-invoice-sender"));

  // Backup geral diário (03:00)
  cron.schedule("0 3 * * *", () => invoke(app, "/api/functions/system-backup/run"));

  console.log("[jobs] Cron agendado.");
}
