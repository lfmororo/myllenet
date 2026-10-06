import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { query, queryOne, execute } from "../db.js";
import { getSetting, getSettings } from "../services/settings.js";
import {
  waSendText, waSendDocument, waSendSupportButton, waTestConnection,
  getWhatsAppConfig, formatPhone,
} from "../services/whatsapp.js";
import { efiRequest, isValidCPF, logEfiApiCall } from "../services/efi.js";
import {
  mikrotikStatus, mikrotikSync, mikrotikSpeedtest, syncCustomerToRouter,
  getActiveBase, queueMikrotikCommand, restCall, mikrotikConfig,
} from "../services/mikrotik.js";
import { config } from "../config.js";
import { createBackup, listBackups, safeBackupPath } from "../services/backup.js";
import { createReadStream, existsSync } from "node:fs";

const BOT_DISCLAIMER = "\n\n🤖 _Esta é uma mensagem automática. Para falar com um atendente, entre em contato: (85) 98680-1458_";
const DEFAULT_SATISFACTION_URL = "https://app.mororo.tech/satisfacao";

async function logNotification(p: {
  customer_id?: string | null; customer_name: string; phone?: string | null;
  type: string; message: string; status: "sent" | "failed"; error_message?: string | null;
}) {
  try {
    await execute(
      "INSERT INTO notification_logs (id, customer_id, customer_name, phone, type, message, status, error_message) VALUES (?,?,?,?,?,?,?,?)",
      [randomUUID(), p.customer_id ?? null, p.customer_name, p.phone ?? null, p.type, p.message, p.status, p.error_message ?? null]
    );
  } catch (e) {
    console.error("Failed to log notification:", e);
  }
}

async function sendPaymentNotification(invoiceId: string) {
  const invoice = await queryOne<Record<string, any>>(
    `SELECT i.*, c.nome, c.telefone, c.block_status, c.id AS customer_id FROM invoices i JOIN customers c ON c.id = i.customer_id WHERE i.id = ?`,
    [invoiceId]
  );
  if (!invoice) return;
  const customer = { nome: invoice.nome, telefone: invoice.telefone, block_status: invoice.block_status, id: invoice.customer_id };

  if (customer.block_status === "blocked") {
    const today = new Date().toISOString().slice(0, 10);
    const overdue = await query<{ c: number }[]>(
      "SELECT COUNT(*) AS c FROM invoices WHERE customer_id = ? AND status IN ('pending','overdue') AND vencimento < ? AND id <> ?",
      [customer.id, today, invoiceId]
    );
    if (Number(overdue[0]?.c ?? 0) === 0) {
      await execute("UPDATE customers SET block_status = 'active' WHERE id = ?", [customer.id]);
      await execute("INSERT INTO block_history (id, customer_id, old_status, new_status, reason) VALUES (?,?,?,?,?)", [
        randomUUID(), customer.id, "blocked", "active", "Desbloqueio automático: pagamento realizado e sem outras pendências vencidas",
      ]);
      await execute("INSERT INTO block_alerts_sent (id, customer_id, new_status, processed) VALUES (?,?,?,false)", [randomUUID(), customer.id, "active"]);
      await syncCustomerToRouter(customer.id).catch(() => {});
    }
  }

  if (!customer.telefone) {
    await logNotification({ customer_id: invoice.customer_id, customer_name: customer.nome, phone: null, type: "pagamento_confirmado", message: `Pagamento confirmado: ${invoice.descricao}`, status: "failed", error_message: "Cliente sem telefone cadastrado" });
    return;
  }
  const valor = (invoice.valor_centavos / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  const message = `Olá ${customer.nome}! 🎉\n\n✅ Pagamento confirmado!\n\n📄 ${invoice.descricao}\n💲 Valor: ${valor}\n\nObrigado por manter sua internet em dia! 🙏`;
  try {
    await waSendText(customer.telefone, message);
    await logNotification({ customer_id: invoice.customer_id, customer_name: customer.nome, phone: customer.telefone, type: "pagamento_confirmado", message, status: "sent" });
  } catch (e: any) {
    await logNotification({ customer_id: invoice.customer_id, customer_name: customer.nome, phone: customer.telefone, type: "pagamento_confirmado", message, status: "failed", error_message: e.message });
  }
}

export async function registerFunctionRoutes(app: FastifyInstance) {
  // ===================== system-backup =====================
  app.post("/api/functions/system-backup/run", async (req) => {
    const isCron = !!config.cronSecret && req.headers["x-cron-secret"] === config.cronSecret;
    return { success: true, ...(await createBackup(isCron ? "automatico" : "manual")) };
  });
  app.post("/api/functions/system-backup/list", async () => ({ backups: await listBackups() }));
  app.post("/api/functions/system-backup/download", async (req, reply) => {
    const p = safeBackupPath(String((req.body as any)?.file ?? ""));
    if (!p || !existsSync(p)) return reply.code(404).send({ error: "Backup não encontrado" });
    reply.header("Content-Type", "application/zip");
    reply.header("Content-Disposition", `attachment; filename="${p.split("/").pop()}"`);
    return reply.send(createReadStream(p));
  });

  // ===================== whatsapp-send =====================
  app.post("/api/functions/whatsapp-send/send-text", async (req, reply) => {
    const { phone, message, customer_id, customer_name } = (req.body ?? {}) as any;
    if (!phone || !message) return reply.code(400).send({ error: "phone e message obrigatórios" });
    try {
      const fullMessage = message + BOT_DISCLAIMER;
      await waSendText(phone, fullMessage);
      await waSendSupportButton(phone).catch(() => {});
      await logNotification({ customer_id, customer_name: customer_name || phone, phone, type: "manual", message: fullMessage, status: "sent" });
      return { success: true };
    } catch (e: any) {
      await logNotification({ customer_id, customer_name: customer_name || phone, phone, type: "manual", message, status: "failed", error_message: e.message });
      return reply.code(500).send({ error: e.message });
    }
  });

  app.post("/api/functions/whatsapp-send/notify-invoice", async (req, reply) => {
    const { invoice_id, type } = (req.body ?? {}) as any;
    if (!invoice_id) return reply.code(400).send({ error: "invoice_id obrigatório" });
    const invoice = await queryOne<Record<string, any>>(
      `SELECT i.*, c.nome, c.telefone, c.cpf FROM invoices i JOIN customers c ON c.id = i.customer_id WHERE i.id = ?`,
      [invoice_id]
    );
    if (!invoice) return reply.code(404).send({ error: "Fatura não encontrada" });
    if (!invoice.telefone) return reply.code(400).send({ error: "Cliente sem telefone cadastrado" });

    const valor = (invoice.valor_centavos / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
    const vencimento = new Date(invoice.vencimento + "T12:00:00").toLocaleDateString("pt-BR");
    const notifType = type || "boleto_gerado";
    let message = "";
    switch (notifType) {
      case "boleto_gerado": {
        const mesRef = new Date(invoice.vencimento + "T12:00:00").toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
        message = `Olá ${invoice.nome}! 😊\n\nSua fatura da *Mororo.Tech* referente a *${mesRef}* foi gerada:\n\n📄 ${invoice.descricao}\n💰 Valor: ${valor}\n📅 Vencimento: ${vencimento}`;
        message += "\n\nQualquer dúvida, estamos à disposição! 🙏";
        break;
      }
      case "lembrete_vencimento":
        message = `Olá ${invoice.nome}! 😊\n\n⏰ Lembrete: sua fatura da *Mororo.Tech* vence em breve!\n\n📄 ${invoice.descricao}\n💰 Valor: ${valor}\n📅 Vencimento: ${vencimento}`;
        message += "\n\nEvite a suspensão do serviço. Pague em dia! 🙏";
        break;
      case "pagamento_confirmado": {
        const mesRefPag = new Date(invoice.vencimento + "T12:00:00").toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
        message = `Olá ${invoice.nome}! 🎉\n\n✅ Pagamento confirmado!\n\n📄 ${invoice.descricao}\n💰 Valor: ${valor}\n📅 Vencimento: ${vencimento}\n📌 Referência: ${mesRefPag}\n\nObrigado por manter sua internet em dia! 🙏`;
        break;
      }
      case "cobranca_atrasada":
        message = `Olá ${invoice.nome}! 😊\n\n⚠️ Sua fatura da *Mororo.Tech* está vencida!\n\n📄 ${invoice.descricao}\n💰 Valor: ${valor}\n📅 Vencimento: ${vencimento}`;
        break;
      default:
        message = `Olá ${invoice.nome}! Informação sobre sua fatura: ${invoice.descricao} - ${valor}`;
    }

    try {
      const fullMessage = message + BOT_DISCLAIMER;
      await waSendText(invoice.telefone, fullMessage);
      await waSendSupportButton(invoice.telefone).catch(() => {});
      await logNotification({ customer_id: invoice.customer_id, customer_name: invoice.nome, phone: invoice.telefone, type: notifType, message: fullMessage, status: "sent" });
      return { success: true };
    } catch (e: any) {
      await logNotification({ customer_id: invoice.customer_id, customer_name: invoice.nome, phone: invoice.telefone, type: notifType, message, status: "failed", error_message: e.message });
      return reply.code(500).send({ error: e.message });
    }
  });

  app.post("/api/functions/whatsapp-send/test", async () => {
    const result = await waTestConnection();
    return { success: true, ...result };
  });

  // ===================== efi-boleto =====================
  app.post("/api/functions/efi-boleto/create", async (req, reply) => {
    const { customer_id, descricao, valor_centavos, vencimento, plan_id } = (req.body ?? {}) as any;
    const customer = await queryOne<Record<string, any>>("SELECT * FROM customers WHERE id = ?", [customer_id]);
    if (!customer) return reply.code(404).send({ error: "Cliente não encontrado" });
    const cpfClean = (customer.cpf || "").replace(/\D/g, "");
    if (!isValidCPF(cpfClean)) return reply.code(400).send({ error: `CPF inválido: ${cpfClean}` });

    const chargeBody = {
      items: [{ name: descricao, value: valor_centavos, amount: 1 }],
      payment: {
        banking_billet: {
          customer: {
            name: customer.nome, cpf: cpfClean, email: customer.email,
            ...(customer.telefone ? { phone_number: (customer.telefone || "").replace(/\D/g, "") } : {}),
          },
          expire_at: vencimento,
          message: `Pagamento referente a: ${descricao}`,
        },
      },
    };
    try {
      const efiResponse = await efiRequest("/v1/charge/one-step", "POST", chargeBody, "criar_boleto");
      const chargeData = efiResponse.data || efiResponse;
      const billet = chargeData.payment?.banking_billet || chargeData;
      const invoicePayload = {
        customer_id, plan_id: plan_id || null, descricao, valor_centavos, vencimento,
        status: "pending",
        efi_charge_id: chargeData.charge_id || chargeData.id,
        efi_barcode: billet.barcode || null,
        efi_pix_qrcode: billet.pix?.qrcode || null,
        efi_pix_copiacola: billet.pix?.qrcode || null,
        efi_link: billet.link || billet.pdf?.charge || null,
      };
      const id = randomUUID();
      await execute(
        `INSERT INTO invoices (id, customer_id, plan_id, descricao, valor_centavos, vencimento, status, efi_charge_id, efi_barcode, efi_pix_qrcode, efi_pix_copiacola, efi_link)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
        [id, invoicePayload.customer_id, invoicePayload.plan_id, invoicePayload.descricao, invoicePayload.valor_centavos, invoicePayload.vencimento, invoicePayload.status, invoicePayload.efi_charge_id, invoicePayload.efi_barcode, invoicePayload.efi_pix_qrcode, invoicePayload.efi_pix_copiacola, invoicePayload.efi_link]
      );
      const invoice = await queryOne("SELECT * FROM invoices WHERE id = ?", [id]);
      return { invoice };
    } catch (e: any) {
      return reply.code(500).send({ error: e.message });
    }
  });

  app.get("/api/functions/efi-boleto/check", async (req, reply) => {
    const invoiceId = (req.query as any).invoice_id || (req.body as any)?.invoice_id;
    if (!invoiceId) return reply.code(400).send({ error: "invoice_id obrigatório" });
    const invoice = await queryOne<Record<string, any>>("SELECT * FROM invoices WHERE id = ?", [invoiceId]);
    if (!invoice) return reply.code(404).send({ error: "Fatura não encontrada" });
    if (!invoice.efi_charge_id) return reply.code(400).send({ error: "Fatura sem cobrança EFI" });
    try {
      const efiResponse = await efiRequest(`/v1/charge/${invoice.efi_charge_id}`, "GET", undefined, "verificar_pagamento");
      const chargeData = efiResponse.data || efiResponse;
      const efiStatus = chargeData.status;
      let newStatus = invoice.status;
      let paidAt = invoice.paid_at;
      if (efiStatus === "paid" || efiStatus === "settled") { newStatus = "paid"; paidAt = paidAt || new Date().toISOString(); }
      else if (efiStatus === "canceled" || efiStatus === "refunded") newStatus = "cancelled";
      else if (efiStatus === "expired" || efiStatus === "unpaid") newStatus = "overdue";
      await execute("UPDATE invoices SET status = ?, paid_at = ? WHERE id = ?", [newStatus, paidAt, invoiceId]);
      if (newStatus === "paid" && invoice.status !== "paid") await sendPaymentNotification(invoiceId);
      return { invoice_id: invoiceId, status: newStatus, efi_status: efiStatus };
    } catch (e: any) {
      return reply.code(500).send({ error: e.message });
    }
  });

  app.post("/api/functions/efi-boleto/check", async (req, reply) => {
    const invoiceId = (req.body as any)?.invoice_id;
    if (!invoiceId) return reply.code(400).send({ error: "invoice_id obrigatório" });
    const invoice = await queryOne<Record<string, any>>("SELECT * FROM invoices WHERE id = ?", [invoiceId]);
    if (!invoice) return reply.code(404).send({ error: "Fatura não encontrada" });
    if (!invoice.efi_charge_id) return reply.code(400).send({ error: "Fatura sem cobrança EFI" });
    try {
      const efiResponse = await efiRequest(`/v1/charge/${invoice.efi_charge_id}`, "GET", undefined, "verificar_pagamento");
      const chargeData = efiResponse.data || efiResponse;
      const efiStatus = chargeData.status;
      let newStatus = invoice.status;
      let paidAt = invoice.paid_at;
      if (efiStatus === "paid" || efiStatus === "settled") { newStatus = "paid"; paidAt = paidAt || new Date().toISOString(); }
      else if (efiStatus === "canceled" || efiStatus === "refunded") newStatus = "cancelled";
      else if (efiStatus === "expired" || efiStatus === "unpaid") newStatus = "overdue";
      await execute("UPDATE invoices SET status = ?, paid_at = ? WHERE id = ?", [newStatus, paidAt, invoiceId]);
      if (newStatus === "paid" && invoice.status !== "paid") await sendPaymentNotification(invoiceId);
      return { invoice_id: invoiceId, status: newStatus, efi_status: efiStatus };
    } catch (e: any) {
      return reply.code(500).send({ error: e.message });
    }
  });

  app.post("/api/functions/efi-boleto/test", async () => {
    try {
      const token = await (async () => {
        const cid = config.efi.clientId, cs = config.efi.clientSecret;
        const auth = Buffer.from(`${cid}:${cs}`).toString("base64");
        const res = await fetch("https://cobrancas.api.efipay.com.br/v1/authorize", { method: "POST", headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/json" }, body: JSON.stringify({ grant_type: "client_credentials" }) });
        if (!res.ok) return "";
        const d = await res.json();
        return d.access_token || "";
      })();
      if (!token) return { success: false, error: "Falha ao autenticar na EFI" };
      return { success: true, token_preview: token.slice(0, 10) + "..." };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  });

  // Importa cobranças EFI de um cliente (por CPF) para o sistema
  app.post("/api/functions/efi-boleto/check-customer", async (req, reply) => {
    const { customer_id } = (req.body ?? {}) as any;
    const customer = await queryOne<Record<string, any>>("SELECT * FROM customers WHERE id = ?", [customer_id]);
    if (!customer) return reply.code(404).send({ error: "Cliente não encontrado" });
    const cpf = (customer.cpf || "").replace(/\D/g, "");
    const now = new Date();
    const todayStr = now.toISOString().slice(0, 10);
    let allCharges: any[] = [];
    for (const chargeType of ["billet", "carnet"]) {
      let chunkStart = new Date("2020-01-01T00:00:00");
      const finalEnd = new Date(todayStr + "T00:00:00");
      while (chunkStart <= finalEnd) {
        const chunkEnd = new Date(chunkStart);
        chunkEnd.setFullYear(chunkEnd.getFullYear() + 1);
        chunkEnd.setDate(chunkEnd.getDate() - 1);
        const effectiveEnd = chunkEnd > finalEnd ? finalEnd : chunkEnd;
        const fmt = (d: Date) => d.toISOString().slice(0, 10);
        let offset = 0; const limit = 100; let hasMore = true;
        while (hasMore) {
          try {
            const charges = await efiRequest(`/v1/charges?charge_type=${chargeType}&customer_document=${cpf}&begin_date=${fmt(chunkStart)}&end_date=${fmt(effectiveEnd)}&limit=${limit}&offset=${offset}`, "GET", undefined, "check_customer");
            const page = charges.data || charges || [];
            if (Array.isArray(page)) { allCharges = allCharges.concat(page); hasMore = page.length === limit; } else hasMore = false;
          } catch { hasMore = false; }
          offset += limit;
        }
        chunkStart = new Date(effectiveEnd);
        chunkStart.setDate(chunkStart.getDate() + 1);
      }
    }
    let imported = 0, skipped = 0;
    for (const charge of allCharges) {
      const chargeId = charge.charge_id || charge.id;
      if (!chargeId) continue;
      const existing = await queryOne("SELECT id FROM invoices WHERE efi_charge_id = ?", [chargeId]);
      if (existing) { skipped++; continue; }
      let status = "pending";
      if (charge.status === "paid" || charge.status === "settled") status = "paid";
      else if (charge.status === "canceled" || charge.status === "refunded") status = "cancelled";
      else if (charge.status === "expired" || charge.status === "unpaid") status = "overdue";
      const billet = charge.payment?.banking_billet || {};
      const value = charge.value || charge.total || billet.value || 0;
      const id = randomUUID();
      await execute(
        "INSERT INTO invoices (id, customer_id, descricao, valor_centavos, vencimento, status, efi_charge_id, efi_barcode, efi_link, paid_at) VALUES (?,?,?,?,?,?,?,?,?,?)",
        [id, customer.id, charge.message || charge.custom_id || `Cobrança EFI #${chargeId}`, value, billet.expire_at || charge.expire_at || charge.created_at?.slice(0, 10) || todayStr, status, chargeId, billet.barcode || null, billet.link || billet.pdf?.charge || null, status === "paid" ? (charge.paid_at || now.toISOString()) : null]
      );
      imported++;
    }
    return { cpf, customer_name: customer.nome, total_found: allCharges.length, imported, skipped };
  });

  app.post("/api/functions/efi-boleto/import", async (req, reply) => {
    const { begin_date, end_date } = (req.body ?? {}) as any;
    const now = new Date();
    const todayStr = now.toISOString().slice(0, 10);
    const userBegin = begin_date || "2020-01-01";
    const userEnd = end_date || todayStr;
    let allCharges: any[] = [];
    let chunkStart = new Date(userBegin + "T00:00:00");
    const finalEnd = new Date(userEnd + "T00:00:00");
    while (chunkStart <= finalEnd) {
      const chunkEnd = new Date(chunkStart);
      chunkEnd.setFullYear(chunkEnd.getFullYear() + 1);
      chunkEnd.setDate(chunkEnd.getDate() - 1);
      const effectiveEnd = chunkEnd > finalEnd ? finalEnd : chunkEnd;
      const fmt = (d: Date) => d.toISOString().slice(0, 10);
      let offset = 0; const limit = 100; let hasMore = true;
      while (hasMore) {
        const charges = await efiRequest(`/v1/charges?charge_type=billet&begin_date=${fmt(chunkStart)}&end_date=${fmt(effectiveEnd)}&limit=${limit}&offset=${offset}`, "GET");
        const page = charges.data || charges || [];
        if (Array.isArray(page)) { allCharges = allCharges.concat(page); hasMore = page.length === limit; } else hasMore = false;
        offset += limit;
      }
      chunkStart = new Date(effectiveEnd);
      chunkStart.setDate(chunkStart.getDate() + 1);
    }
    let importedCustomers = 0, importedInvoices = 0, skippedInvoices = 0;
    for (const charge of allCharges) {
      const customer = charge.customer || charge.payment?.banking_billet?.customer;
      if (!customer) continue;
      const cpf = (customer.cpf || "").replace(/\D/g, "");
      if (!cpf) continue;
      let existingCustomer = await queryOne<Record<string, any>>("SELECT id FROM customers WHERE cpf = ?", [cpf]);
      if (!existingCustomer) {
        const phone = customer.phone_number || customer.phone || null;
        const id = randomUUID();
        await execute("INSERT INTO customers (id, nome, cpf, email, telefone, usuario_pppoe, senha_pppoe) VALUES (?,?,?,?,?,?,?)", [id, customer.name || "Sem nome", cpf, customer.email || `${cpf}@importado.efi`, phone, `pppoe_${cpf}`, "importado"]);
        existingCustomer = { id };
        importedCustomers++;
      }
      const chargeId = charge.charge_id || charge.id;
      const existingInvoice = await queryOne("SELECT id FROM invoices WHERE efi_charge_id = ?", [chargeId]);
      if (existingInvoice) { skippedInvoices++; continue; }
      let status = "pending";
      if (charge.status === "paid" || charge.status === "settled") status = "paid";
      else if (charge.status === "canceled" || charge.status === "refunded") status = "cancelled";
      else if (charge.status === "expired" || charge.status === "unpaid") status = "overdue";
      const billet = charge.payment?.banking_billet || {};
      const value = charge.value || charge.total || billet.value || 0;
      const id = randomUUID();
      await execute(
        "INSERT INTO invoices (id, customer_id, descricao, valor_centavos, vencimento, status, efi_charge_id, efi_barcode, efi_link, paid_at) VALUES (?,?,?,?,?,?,?,?,?,?)",
        [id, existingCustomer.id, charge.message || charge.custom_id || `Cobrança EFI #${chargeId}`, value, billet.expire_at || charge.expire_at || charge.created_at?.slice(0, 10) || todayStr, status, chargeId, billet.barcode || null, billet.link || billet.pdf?.charge || null, status === "paid" ? (charge.paid_at || now.toISOString()) : null]
      );
      importedInvoices++;
    }
    return { total_charges: allCharges.length, imported_customers: importedCustomers, imported_invoices: importedInvoices, skipped_invoices: skippedInvoices };
  });

  app.post("/api/functions/efi-boleto/cancel", async (req, reply) => {
    const { charge_id } = (req.body ?? {}) as any;
    if (!charge_id) return reply.code(400).send({ error: "charge_id obrigatório" });
    try {
      await efiRequest(`/v1/charge/${charge_id}/cancel`, "PUT", undefined, "cancelar_cobranca");
      return { success: true };
    } catch (e: any) {
      return reply.code(500).send({ error: e.message });
    }
  });

  app.post("/api/functions/efi-boleto/settle", async (req, reply) => {
    const { charge_id } = (req.body ?? {}) as any;
    if (!charge_id) return reply.code(400).send({ error: "charge_id obrigatório" });
    try {
      await efiRequest(`/v1/charge/${charge_id}/settle`, "PUT", undefined, "baixar_manual_efi");
      return { success: true };
    } catch (e: any) {
      return reply.code(500).send({ error: e.message });
    }
  });

  app.post("/api/functions/efi-boleto/bulk-check", async (req, reply) => {
    try {
      const pending = await query<Record<string, any>[]>(
        "SELECT id, efi_charge_id, status, paid_at FROM invoices WHERE status IN ('pending','overdue') AND efi_charge_id IS NOT NULL ORDER BY updated_at ASC LIMIT 40"
      );
      let updated = 0;
      for (const inv of pending) {
        try {
          const efiResponse = await efiRequest(`/v1/charge/${inv.efi_charge_id}`, "GET", undefined, "bulk_check");
          const chargeData = efiResponse.data || efiResponse;
          const efiStatus = chargeData.status;
          let newStatus = inv.status;
          let paidAt = inv.paid_at;
          if (["paid", "settled", "finalized", "received", "liquidado"].includes(efiStatus)) { newStatus = "paid"; paidAt = paidAt || new Date().toISOString(); }
          else if (inv.paid_at) newStatus = "paid";
          else if (efiStatus === "canceled" || efiStatus === "refunded") newStatus = "cancelled";
          else if (efiStatus === "expired" || efiStatus === "unpaid") newStatus = "overdue";
          await execute("UPDATE invoices SET status = ?, paid_at = ?, updated_at = NOW() WHERE id = ?", [newStatus, paidAt, inv.id]);
          if (newStatus !== inv.status) {
            updated++;
            if (newStatus === "paid") await sendPaymentNotification(inv.id);
          }
        } catch (e) { console.error(`Error checking charge ${inv.efi_charge_id}:`, e); }
      }
      return { checked: pending.length, updated, reconciled: 0 };
    } catch (e: any) {
      return reply.code(500).send({ error: e.message });
    }
  });

  // ===================== mercadopago =====================
  const mpToken = async () => {
    const saved = await getSetting("mercadopago_access_token");
    return (saved || config.mercadopago.accessToken || "").trim();
  };
  const mpRequest = async (path: string, method = "GET", body?: unknown) => {
    const token = await mpToken();
    if (!token) throw new Error("Access Token do Mercado Pago não configurado");
    const res = await fetch(`https://api.mercadopago.com${path}`, {
      method, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    let data: any; try { data = JSON.parse(text); } catch { data = { raw: text }; }
    if (!res.ok) throw new Error(data?.message || data?.cause?.[0]?.description || `Erro Mercado Pago (${res.status})`);
    return data;
  };

  app.post("/api/functions/mercadopago/create", async (req, reply) => {
    const { customer_id, descricao, valor_centavos, vencimento, plan_id } = (req.body ?? {}) as any;
    const customer = await queryOne<Record<string, any>>("SELECT * FROM customers WHERE id = ?", [customer_id]);
    if (!customer) return reply.code(404).send({ error: "Cliente não encontrado" });
    const cpfClean = (customer.cpf || "").replace(/\D/g, "");
    const nameParts = String(customer.nome || "Cliente").trim().split(/\s+/);
    const payment = await mpRequest("/v1/payments", "POST", {
      transaction_amount: Number((valor_centavos / 100).toFixed(2)),
      description: descricao,
      payment_method_id: "pix",
      date_of_expiration: `${vencimento}T23:59:59.000-03:00`,
      external_reference: `${customer.id}|${vencimento}`,
      payer: {
        email: customer.email || `cliente${cpfClean}@mororo.tech`,
        first_name: nameParts[0],
        last_name: nameParts.slice(1).join(" ") || nameParts[0],
        identification: cpfClean ? { type: "CPF", number: cpfClean } : undefined,
      },
    });
    const tx = payment?.point_of_interaction?.transaction_data || {};
    const id = randomUUID();
    await execute(
      `INSERT INTO invoices (id, customer_id, plan_id, descricao, valor_centavos, vencimento, status, gateway, mp_payment_id, mp_pix_qrcode, mp_pix_copiacola, mp_link)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
      [id, customer_id, plan_id || null, descricao, valor_centavos, vencimento, "pending", "mercadopago", String(payment.id), tx.qr_code_base64 || null, tx.qr_code || null, tx.ticket_url || null]
    );
    const invoice = await queryOne("SELECT * FROM invoices WHERE id = ?", [id]);
    return { invoice };
  });

  app.post("/api/functions/mercadopago/webhook", async (req) => {
    const body = (req.body ?? {}) as any;
    const paymentId = body?.data?.id || String(body?.resource || "").split("/").pop() || null;
    if (!paymentId) return { received: true, ignored: true };
    try {
      const payment = await mpRequest(`/v1/payments/${paymentId}`);
      const invoice = await queryOne<Record<string, any>>("SELECT * FROM invoices WHERE mp_payment_id = ?", [String(paymentId)]);
      if (invoice && payment.status === "approved") {
        await execute("UPDATE invoices SET status = 'paid', paid_at = ? WHERE id = ?", [payment.date_approved || new Date().toISOString(), invoice.id]);
        await sendPaymentNotification(invoice.id);
      }
    } catch (e) { console.error("Webhook MP falhou:", e); }
    return { received: true };
  });

  app.post("/api/functions/mercadopago/test", async () => {
    const me = await mpRequest("/users/me");
    return { ok: true, account: me.nickname || me.email };
  });

  // ===================== generate-invoice-pdf =====================
  app.post("/api/functions/generate-invoice-pdf", async (req, reply) => {
    const { invoice_id } = (req.body ?? {}) as any;
    if (!invoice_id) return reply.code(400).send({ error: "invoice_id is required" });
    const invoice = await queryOne<Record<string, any>>(
      `SELECT i.*, c.nome AS c_nome, c.cpf AS c_cpf, c.bairro, c.cidade, c.id AS customer_id, p.nome AS plan_name
       FROM invoices i JOIN customers c ON c.id = i.customer_id LEFT JOIN plans p ON p.id = i.plan_id WHERE i.id = ?`,
      [invoice_id]
    );
    if (!invoice) return reply.code(404).send({ error: "Invoice not found" });
    const settings = await getSettings(["pix_key", "pix_name", "pix_city", "company_cnpj", "company_phone", "company_address", "payment_gateway"]);

    const metrics = await query<Record<string, any>[]>(
      `SELECT
        COALESCE(SUM(CASE WHEN prev.tx_bytes IS NULL THEN 0 WHEN l.tx_bytes >= prev.tx_bytes THEN l.tx_bytes - prev.tx_bytes ELSE l.tx_bytes END),0) AS download_bytes,
        COALESCE(SUM(CASE WHEN prev.rx_bytes IS NULL THEN 0 WHEN l.rx_bytes >= prev.rx_bytes THEN l.rx_bytes - prev.rx_bytes ELSE l.rx_bytes END),0) AS upload_bytes,
        (SELECT COUNT(*) FROM pppoe_logs d WHERE d.customer_id = l.customer_id AND d.event_type='disconnected' AND d.logged_at >= ? AND d.logged_at <= ?) AS disconnect_count
       FROM pppoe_logs l
       LEFT JOIN pppoe_logs prev ON prev.customer_id = l.customer_id AND prev.logged_at = (SELECT MAX(p2.logged_at) FROM pppoe_logs p2 WHERE p2.customer_id = l.customer_id AND p2.logged_at < l.logged_at)
       WHERE l.customer_id = ? AND l.event_type='stats' AND l.logged_at >= ? AND l.logged_at <= ?`,
      ["2020-01-01T00:00:00Z", new Date().toISOString(), invoice.customer_id, "2020-01-01T00:00:00Z", new Date().toISOString()]
    );
    const m = metrics[0] ?? {};
    const downloadBytes = Number(m.download_bytes ?? 0);
    const uploadBytes = Number(m.upload_bytes ?? 0);
    const interruptions = Number(m.disconnect_count ?? 0);

    const pixPayload = invoice.mp_pix_copiacola || invoice.efi_pix_copiacola || "";
    return {
      success: true,
      data: {
        invoice,
        customer: { id: invoice.customer_id, nome: invoice.c_nome, cpf: invoice.c_cpf, bairro: invoice.bairro, cidade: invoice.cidade },
        plan: { nome: invoice.plan_name || "Internet Residencial" },
        consumption: {
          download: formatBytes(downloadBytes), upload: formatBytes(uploadBytes),
          interruptions, connected: "0min", disconnected: "0min",
        },
        pix: {
          payload: pixPayload, source: pixPayload ? "stored" : "local",
          key: settings.pix_key, name: settings.pix_name, cnpj: settings.company_cnpj, phone: settings.company_phone,
        },
      },
    };
  });

  // ===================== satisfaction-survey =====================
  app.post("/api/functions/satisfaction-survey", async (req) => {
    const body = (req.body ?? {}) as any;
    const cfg = await getWhatsAppConfig();
    const satisfactionUrl = (await getSetting("satisfaction_url")) || DEFAULT_SATISFACTION_URL;
    const customers = body.customer_id
      ? await query<Record<string, any>[]>("SELECT id, nome, telefone FROM customers WHERE id = ?", [body.customer_id])
      : await query<Record<string, any>[]>("SELECT id, nome, telefone FROM customers WHERE ativo = true AND telefone IS NOT NULL");
    let sent = 0, failed = 0;
    for (const c of customers) {
      if (!c.telefone) { failed++; continue; }
      const message = `Olá, ${c.nome}! 👋\n\nSomos da *Mororo.Tech* e queremos garantir que sua internet esteja sempre à altura do que você espera.\n\n📝 *Avalie nosso atendimento*:\n📎 ${satisfactionUrl}\n\nAgradecemos a sua confiança! 🙏` + BOT_DISCLAIMER;
      try {
        await waSendText(c.telefone, message, cfg);
        await logNotification({ customer_id: c.id, customer_name: c.nome, phone: c.telefone, type: "pesquisa_satisfacao", message, status: "sent" });
        sent++;
      } catch (e: any) {
        await logNotification({ customer_id: c.id, customer_name: c.nome, phone: c.telefone, type: "pesquisa_satisfacao", message, status: "failed", error_message: e.message });
        failed++;
      }
    }
    return { success: true, sent, failed, total: customers.length };
  });

  // ===================== relatórios / lembretes =====================
  app.post("/api/functions/due-reminder", async () => {
    const reminderDate = new Date();
    reminderDate.setDate(reminderDate.getDate() + 3);
    const reminderStr = reminderDate.toISOString().slice(0, 10);
    const invoices = await query<Record<string, any>[]>(
      `SELECT i.*, c.nome, c.telefone FROM invoices i JOIN customers c ON c.id = i.customer_id WHERE i.vencimento = ? AND i.status = 'pending'`,
      [reminderStr]
    );
    let sent = 0, failed = 0;
    for (const inv of invoices) {
      if (!inv.telefone) continue;
      const valor = (inv.valor_centavos / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
      const message = `Olá ${inv.nome.split(" ")[0]}! 😊\n\n⏰ *Lembrete da Mororo.Tech*: sua fatura vence em *3 dias*!\n\n📄 ${inv.descricao}\n💰 Valor: ${valor}\n📅 Vencimento: ${inv.vencimento}\n\nEvite a suspensão do serviço. Pague em dia! 🙏` + BOT_DISCLAIMER;
      try {
        await waSendText(inv.telefone, message);
        await logNotification({ customer_id: inv.customer_id, customer_name: inv.nome, phone: inv.telefone, type: "lembrete_vencimento", message, status: "sent" });
        sent++;
      } catch (e: any) {
        await logNotification({ customer_id: inv.customer_id, customer_name: inv.nome, phone: inv.telefone, type: "lembrete_vencimento", message, status: "failed", error_message: e.message });
        failed++;
      }
    }
    return { invoices_due_in_3_days: invoices.length, sent, failed };
  });

  app.post("/api/functions/cutoff-warning", async () => {
    const threshold = new Date();
    threshold.setDate(threshold.getDate() - 15);
    const thresholdStr = threshold.toISOString().slice(0, 10);
    const invoices = await query<Record<string, any>[]>(
      `SELECT i.*, c.nome, c.telefone FROM invoices i JOIN customers c ON c.id = i.customer_id WHERE i.vencimento = ? AND i.status IN ('pending','overdue')`,
      [thresholdStr]
    );
    let sent = 0, failed = 0;
    for (const inv of invoices) {
      if (!inv.telefone) continue;
      const valor = (inv.valor_centavos / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
      const message = `Olá ${inv.nome.split(" ")[0]}! 😊\n\n⚠️ *AVISO IMPORTANTE da Mororo.Tech*\n\nSua fatura está com *15 dias de atraso*:\n\n📄 ${inv.descricao}\n💰 Valor: ${valor}\n📅 Vencimento: ${inv.vencimento}\n\n⚠️ *Seu sinal será cortado em 5 dias* caso o pagamento não seja regularizado.\n\nRegularize agora para evitar a suspensão do serviço!` + BOT_DISCLAIMER;
      try {
        await waSendText(inv.telefone, message);
        await logNotification({ customer_id: inv.customer_id, customer_name: inv.nome, phone: inv.telefone, type: "aviso_corte", message, status: "sent" });
        sent++;
      } catch (e: any) {
        await logNotification({ customer_id: inv.customer_id, customer_name: inv.nome, phone: inv.telefone, type: "aviso_corte", message, status: "failed", error_message: e.message });
        failed++;
      }
    }
    return { invoices_15_days_overdue: invoices.length, sent, failed };
  });

  app.post("/api/functions/auto-block-30d", async () => {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const cutoff = thirtyDaysAgo.toISOString().slice(0, 10);
    const overdue = await query<Record<string, any>[]>(
      `SELECT DISTINCT i.customer_id, c.nome FROM invoices i JOIN customers c ON c.id = i.customer_id
       WHERE i.status IN ('pending','overdue') AND i.vencimento < ? AND c.block_status = 'active' AND c.ativo = true`,
      [cutoff]
    );
    for (const c of overdue) {
      await execute("UPDATE customers SET block_status = 'blocked' WHERE id = ?", [c.customer_id]);
      await execute("INSERT INTO block_history (id, customer_id, old_status, new_status, reason) VALUES (?,?,?,?,?)", [
        randomUUID(), c.customer_id, "active", "blocked", "Bloqueio automático: fatura vencida há mais de 30 dias",
      ]);
      await execute("INSERT INTO block_alerts_sent (id, customer_id, new_status, processed) VALUES (?,?,?,false)", [randomUUID(), c.customer_id, "blocked"]);
    }
    await mikrotikSync().catch(() => {});
    return { success: true, processed: overdue.length };
  });

  app.post("/api/functions/monthly-invoice-sender", async () => {
    const customers = await query<Record<string, any>[]>(
      `SELECT c.*, p.valor_centavos AS plan_valor FROM customers c LEFT JOIN plans p ON p.id = c.plan_id WHERE c.ativo = true AND c.cortesia = false`
    );
    const results: any[] = [];
    const now = new Date();
    const firstDay = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
    for (const c of customers) {
      const existing = await queryOne("SELECT id FROM invoices WHERE customer_id = ? AND vencimento >= ?", [c.id, firstDay]);
      if (existing) continue;
      const dia = c.dia_vencimento || 10;
      const vencimento = new Date(now.getFullYear(), now.getMonth(), dia);
      const vencimentoStr = vencimento.toISOString().slice(0, 10);
      const valor = (c.plan_valor || 0) - (c.desconto_especial_centavos || 0);
      const id = randomUUID();
      await execute(
        "INSERT INTO invoices (id, customer_id, plan_id, descricao, valor_centavos, vencimento, status) VALUES (?,?,?,?,?,?,?)",
        [id, c.id, c.plan_id, `Mensalidade Internet - ${now.toLocaleDateString("pt-BR", { month: "long", year: "numeric" })}`, valor, vencimentoStr, "pending"]
      );
      results.push({ customer: c.nome, status: "created", invoice_id: id });
    }
    return { success: true, results };
  });

  // ===================== mikrotik-alerts =====================
  app.post("/api/functions/mikrotik-alerts", async () => {
    const ADMIN_PHONE = "85986801458";
    const cfg = await getWhatsAppConfig();
    const alerts = await query<Record<string, any>[]>(
      `SELECT ba.id, ba.customer_id, ba.new_status, c.nome, c.telefone
       FROM block_alerts_sent ba LEFT JOIN customers c ON c.id = ba.customer_id
       WHERE (ba.processed = false OR ba.processed IS NULL) ORDER BY ba.created_at ASC LIMIT 30`
    );
    let sent = 0;
    for (const alert of alerts) {
      if (!alert.telefone) {
        await execute("UPDATE block_alerts_sent SET processed = true WHERE id = ?", [alert.id]);
        continue;
      }
      const messages: Record<string, string> = {
        blocked: `⚠️ *Aviso de Bloqueio*\n\nOlá ${alert.nome}, seu acesso à internet foi bloqueado por pendência financeira. Entre em contato com o atendimento para regularizar a situação.`,
        active: `✅ *Sinal Liberado*\n\nOlá ${alert.nome}, seu acesso à internet foi liberado novamente. Obrigado!`,
        deactivated: `🚫 *Serviço Desativado*\n\nOlá ${alert.nome}, seu plano de internet foi desativado e seu acesso foi encerrado.`,
        reactivated: `🔄 *Serviço Reativado*\n\nOlá ${alert.nome}, seu plano de internet foi reativado e seu acesso está liberado. Bem-vindo de volta!`,
      };
      const types: Record<string, string> = {
        blocked: "cliente_bloqueado", active: "cliente_desbloqueado", deactivated: "cliente_desativado", reactivated: "cliente_reativado",
      };
      const message = messages[alert.new_status];
      if (!message) { await execute("UPDATE block_alerts_sent SET processed = true WHERE id = ?", [alert.id]); continue; }
      try {
        await waSendText(alert.telefone, message + BOT_DISCLAIMER, cfg);
        await logNotification({ customer_id: alert.customer_id, customer_name: alert.nome, phone: alert.telefone, type: types[alert.new_status] || "cliente_status", message, status: "sent" });
        sent++;
      } catch (e: any) {
        await logNotification({ customer_id: alert.customer_id, customer_name: alert.nome, phone: alert.telefone, type: types[alert.new_status] || "cliente_status", message, status: "failed", error_message: e.message });
      }
      await execute("UPDATE block_alerts_sent SET processed = true WHERE id = ?", [alert.id]);
    }
    return { sent };
  });

  // ===================== daily-report =====================
  app.post("/api/functions/daily-report", async () => {
    const today = new Date();
    const todayStr = today.toISOString().slice(0, 10);
    const dueToday = await query<Record<string, any>[]>(
      `SELECT i.*, c.nome, c.usuario_pppoe FROM invoices i JOIN customers c ON c.id = i.customer_id WHERE i.vencimento = ? AND i.status = 'pending'`,
      [todayStr]
    );
    const overdue = await query<Record<string, any>[]>(
      `SELECT i.*, c.nome, c.usuario_pppoe FROM invoices i JOIN customers c ON c.id = i.customer_id WHERE i.vencimento < ? AND i.status IN ('pending','overdue')`,
      [todayStr]
    );
    if (!dueToday.length && !overdue.length) return { message: "Nenhum inadimplente ou vencendo hoje." };
    const formatCurrency = (v: number) => (v / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
    let message = `📊 *Relatório Diário Mororo.Tech* - ${todayStr}\n\n`;
    if (dueToday.length) {
      message += `📅 *Vencendo hoje (${dueToday.length}):*\n`;
      for (const inv of dueToday) message += `🔸 ${inv.nome} (${inv.usuario_pppoe}) - ${formatCurrency(inv.valor_centavos)}\n`;
      message += "\n";
    }
    if (overdue.length) {
      const total = overdue.reduce((s, i) => s + i.valor_centavos, 0);
      message += `⚠️ *Inadimplentes (${overdue.length}) - Total: ${formatCurrency(total)}:*\n`;
      for (const inv of overdue.slice(0, 30)) {
        const daysLate = Math.floor((today.getTime() - new Date(inv.vencimento + "T12:00:00").getTime()) / 86400000);
        message += `🔸 ${inv.nome} - ${formatCurrency(inv.valor_centavos)} (${daysLate}d atraso)\n`;
      }
      message += "\n";
    }
    const admins = await query<Record<string, any>[]>(
      `SELECT u.phone FROM users u JOIN user_roles r ON r.user_id = u.id WHERE r.role = 'admin'`
    );
    let sent = 0;
    for (const a of admins) {
      if (!a.phone) continue;
      try {
        await waSendText(a.phone, message + BOT_DISCLAIMER);
        await logNotification({ customer_name: "Admin", phone: a.phone, type: "relatorio_diario", message, status: "sent" });
        sent++;
      } catch (e: any) {
        await logNotification({ customer_name: "Admin", phone: a.phone, type: "relatorio_diario", message, status: "failed", error_message: e.message });
      }
    }
    await execute("UPDATE invoices SET status = 'overdue' WHERE status = 'pending' AND vencimento < ?", [todayStr]);
    return { due_today: dueToday.length, overdue: overdue.length, notifications_sent: sent };
  });

  // ===================== mikrotik =====================
  app.post("/api/functions/mikrotik-status", async () => mikrotikStatus());
  app.post("/api/functions/mikrotik-sync", async () => mikrotikSync());
  app.post("/api/functions/mikrotik-speedtest", async () => mikrotikSpeedtest());

  app.post("/api/functions/mikrotik-customer", async (req, reply) => {
    const { customer_id, action } = (req.body ?? {}) as any;
    if (!customer_id || !["sync", "enable", "disable", "remove"].includes(action)) {
      return reply.code(400).send({ success: false, error: "Parâmetros inválidos" });
    }
    const customer = await queryOne<Record<string, any>>("SELECT * FROM customers WHERE id = ?", [customer_id]);
    if (!customer) return reply.code(404).send({ success: false, error: "Cliente não encontrado" });

    if (action === "remove") {
      const active = await getActiveBase();
      if (!active) {
        await queueMikrotikCommand(null, customer.usuario_pppoe, "remove", { nome: customer.nome, motivo: "Remoção manual" });
        return { success: true, queued: true };
      }
      const { base, auth } = active;
      const list = await restCall(base, `/ppp/secret?name=${encodeURIComponent(customer.usuario_pppoe)}`, auth);
      const existing = Array.isArray(list.data) ? list.data.find((s: any) => s.name === customer.usuario_pppoe) : null;
      if (existing) await restCall(base, `/ppp/secret/${existing[".id"]}`, auth, "DELETE");
      return { success: true, action };
    }

    if (action === "enable" || action === "disable") {
      await execute("UPDATE customers SET block_status = ? WHERE id = ?", [action === "disable" ? "blocked" : "active", customer_id]);
      await execute("INSERT INTO block_history (id, customer_id, old_status, new_status, reason) VALUES (?,?,?,?,?)", [
        randomUUID(), customer_id, customer.block_status, action === "disable" ? "blocked" : "active",
        action === "disable" ? "Desativado manualmente no Mikrotik" : "Ativado manualmente no Mikrotik",
      ]);
    }
    const result = await syncCustomerToRouter(customer_id);
    return { success: true, action, ...result };
  });

  app.post("/api/functions/mikrotik-agent-ingest", async (req, reply) => {
    const token = (req.headers["x-agent-token"] as string) || "";
    const agent = token ? await queryOne<Record<string, any>>("SELECT id, active, name FROM agent_tokens WHERE token = ?", [token]) : null;
    if (!agent || !agent.active) return reply.code(401).send({ success: false, error: "Token inválido ou inativo" });
    await execute("UPDATE agent_tokens SET last_seen_at = NOW() WHERE id = ?", [agent.id]);

    const body = (req.body ?? {}) as any;
    if (body.command_results) {
      for (const r of body.command_results) {
        if (!r?.id) continue;
        await execute("UPDATE mikrotik_commands SET status = ?, error_message = ?, result = ?, executed_at = NOW() WHERE id = ?", [
          r.success ? "done" : "error", r.success ? null : String(r.error || "Falha"), r.result ?? null, r.id,
        ]);
      }
    }
    if (body.commands_poll) {
      const pending = await query<Record<string, any>[]>(
        "SELECT * FROM mikrotik_commands WHERE status IN ('pending','running') AND attempts < 5 ORDER BY created_at ASC LIMIT 20"
      );
      const commands: any[] = [];
      for (const c of pending) {
        await execute("UPDATE mikrotik_commands SET status = 'running', attempts = attempts + 1 WHERE id = ?", [c.id]);
        commands.push({ id: c.id, action: c.action, usuario_pppoe: c.usuario_pppoe, payload: c.payload ?? {} });
      }
      return { success: true, commands };
    }

    const payloads: any[] = Array.isArray(body.batch) ? body.batch : [body];
    const customers = await query<Record<string, any>[]>("SELECT id, usuario_pppoe FROM customers WHERE usuario_pppoe IS NOT NULL");
    const customerMap = new Map<string, string>();
    for (const c of customers) customerMap.set(String(c.usuario_pppoe).toLowerCase(), c.id);

    let wan = 0, pppoe = 0, status = 0;
    for (const p of payloads) {
      const loggedAt = p.collected_at || new Date().toISOString();
      const resource = p.resource || {};
      if (p.host) {
        await execute("INSERT INTO mikrotik_status_history (id, host, online, message, diagnostics) VALUES (?,?,?,?,?)", [
          randomUUID(), p.host, p.online !== false, p.message || (p.online === false ? "Agente VPS: sem resposta" : "Agente VPS: OK"), JSON.stringify(p.diagnostics || {}),
        ]);
        status++;
      }
      if (Array.isArray(p.wan) && p.wan.length) {
        const values: unknown[] = [];
        const sql = `INSERT INTO wan_logs (id, interface_name, rx_bps, tx_bps, rx_bytes, tx_bytes, cpu_load, free_memory, total_memory, temperature, created_at) VALUES ${p.wan.map(() => "(?,?,?,?,?,?,?,?,?,?,?)").join(",")}`;
        for (const w of p.wan) {
          values.push(randomUUID(), String(w.interface_name), Math.max(0, Math.round(Number(w.rx_bps) || 0)), Math.max(0, Math.round(Number(w.tx_bps) || 0)),
            w.rx_bytes != null ? Number(w.rx_bytes) : null, w.tx_bytes != null ? Number(w.tx_bytes) : null,
            resource.cpu_load != null ? Number(resource.cpu_load) : null, resource.free_memory != null ? Number(resource.free_memory) : null,
            resource.total_memory != null ? Number(resource.total_memory) : null, resource.temperature != null ? Number(resource.temperature) : null, loggedAt);
        }
        await execute(sql, values);
        wan += p.wan.length;
      }
      if (Array.isArray(p.pppoe) && p.pppoe.length) {
        const rows: any[] = [];
        for (const s of p.pppoe) {
          const name = String(s.usuario_pppoe || "").toLowerCase();
          const customerId = customerMap.get(name);
          if (!customerId) continue;
          rows.push({ customer_id: customerId, usuario_pppoe: s.usuario_pppoe, event_type: s.event_type || "stats", ip_address: s.ip_address || null, uptime: s.uptime || null, rx_bytes: s.rx_bytes != null ? Number(s.rx_bytes) : null, tx_bytes: s.tx_bytes != null ? Number(s.tx_bytes) : null, logged_at: loggedAt });
        }
        if (rows.length) {
          const values: unknown[] = [];
          const sql = `INSERT INTO pppoe_logs (id, customer_id, usuario_pppoe, event_type, ip_address, uptime, rx_bytes, tx_bytes, logged_at) VALUES ${rows.map(() => "(?,?,?,?,?,?,?,?,?)").join(",")}`;
          for (const r of rows) values.push(randomUUID(), r.customer_id, r.usuario_pppoe, r.event_type, r.ip_address, r.uptime, r.rx_bytes, r.tx_bytes, r.logged_at);
          await execute(sql, values);
          pppoe += rows.length;
        }
      }
    }
    return { success: true, agent: agent.name, wan, pppoe, status };
  });

  // ===================== misc =====================
  app.post("/api/functions/evolution-monitor", async () => {
    const settings = await getSettings(["evolution_base_url", "evolution_api_key"]);
    const baseUrl = (settings.evolution_base_url || "").replace(/\/+$/, "");
    const apiKey = settings.evolution_api_key || "";
    if (!baseUrl || !apiKey) return { error: "Evolution API não configurada" };
    const res = await fetch(`${baseUrl}/instance/fetchInstances`, { headers: { apikey: apiKey } });
    const text = await res.text();
    if (!res.ok) throw new Error(`Evolution API [${res.status}]`);
    let list: any[] = [];
    try { const parsed = JSON.parse(text); list = Array.isArray(parsed) ? parsed : (parsed?.instances || []); } catch { list = []; }
    return { success: true, instances: list.length, states: list.map((i) => ({ name: i?.instance?.instanceName || i?.name, state: i?.instance?.connectionStatus || i?.state })) };
  });

  app.post("/api/functions/api-diagnostic-report", async (req) => {
    const body = (req.body ?? {}) as any;
    const start = body.start || new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const end = body.end || new Date().toISOString();
    const [efiLogs, notificationLogs, mikrotikLogs] = await Promise.all([
      query<Record<string, any>[]>("SELECT * FROM efi_api_logs WHERE created_at >= ? AND created_at <= ? ORDER BY created_at DESC", [start, end]),
      query<Record<string, any>[]>("SELECT * FROM notification_logs WHERE created_at >= ? AND created_at <= ? ORDER BY created_at DESC", [start, end]),
      query<Record<string, any>[]>("SELECT * FROM mikrotik_status_history WHERE logged_at >= ? AND logged_at <= ? ORDER BY logged_at DESC", [start, end]),
    ]);
    return {
      period: { start, end },
      summary: {
        total_efi_calls: efiLogs.length,
        efi_errors: efiLogs.filter((l) => l.status_code && (l.status_code < 200 || l.status_code >= 300)).length,
        total_notifications: notificationLogs.length,
        notification_failures: notificationLogs.filter((l) => l.status === "failed").length,
        mikrotik_downtime_events: mikrotikLogs.filter((l) => !l.online).length,
      },
      efi_metrics: { avg_response_time: 0, errors_by_endpoint: {}, daily_calls: {} },
      notif_metrics: { by_type: {} },
      details: { efi_logs: efiLogs.slice(-100), notification_logs: notificationLogs.slice(-100), mikrotik_logs: mikrotikLogs.slice(-100) },
    };
  });

  app.get("/api/functions/user-management/list", async () => {
    const users = await query<Record<string, any>[]>("SELECT id, email, full_name, phone, created_at, last_sign_in_at FROM users");
    const roles = await query<Record<string, any>[]>("SELECT user_id, role FROM user_roles");
    const permissions = await query<Record<string, any>[]>("SELECT user_id, report_key FROM user_report_permissions");
    const rolesMap = new Map(); for (const r of roles) rolesMap.set(r.user_id, r.role);
    return users.map((u) => ({
      id: u.id, email: u.email, full_name: u.full_name || "", phone: u.phone || "",
      role: rolesMap.get(u.id) || "user",
      report_permissions: permissions.filter((p) => p.user_id === u.id).map((p) => p.report_key),
      created_at: u.created_at, last_sign_in_at: u.last_sign_in_at,
    }));
  });

  app.post("/api/functions/user-management/create", async (req, reply) => {
    const { email, password, full_name, role, phone, report_permissions } = (req.body ?? {}) as any;
    if (!email || !password) return reply.code(400).send({ error: "Email e senha obrigatórios" });
    const { hash } = await import("bcryptjs");
    const id = randomUUID();
    await execute("INSERT INTO users (id, email, password_hash, full_name, phone) VALUES (?,?,?,?,?)", [id, email, await hash(password, 10), full_name || email, phone || null]);
    await execute("INSERT INTO profiles (id, user_id, full_name) VALUES (?,?,?)", [randomUUID(), id, full_name || email]);
    if (role === "admin") await execute("INSERT INTO user_roles (id, user_id, role) VALUES (?,?,?)", [randomUUID(), id, "admin"]);
    for (const rk of report_permissions || []) await execute("INSERT INTO user_report_permissions (id, user_id, report_key) VALUES (?,?,?)", [randomUUID(), id, rk]);
    return { success: true, user: { id, email } };
  });

  app.post("/api/functions/user-management/update", async (req, reply) => {
    const { user_id, email, password, full_name, role, phone, report_permissions } = (req.body ?? {}) as any;
    if (!user_id) return reply.code(400).send({ error: "user_id obrigatório" });
    if (full_name) await execute("UPDATE users SET full_name = ? WHERE id = ?", [full_name, user_id]);
    if (phone !== undefined) await execute("UPDATE users SET phone = ? WHERE id = ?", [phone, user_id]);
    if (email) await execute("UPDATE users SET email = ? WHERE id = ?", [email, user_id]);
    if (password) { const { hash } = await import("bcryptjs"); await execute("UPDATE users SET password_hash = ? WHERE id = ?", [await hash(password, 10), user_id]); }
    if (role) {
      await execute("DELETE FROM user_roles WHERE user_id = ?", [user_id]);
      if (role === "admin") await execute("INSERT INTO user_roles (id, user_id, role) VALUES (?,?,?)", [randomUUID(), user_id, "admin"]);
    }
    if (Array.isArray(report_permissions)) {
      await execute("DELETE FROM user_report_permissions WHERE user_id = ?", [user_id]);
      for (const rk of report_permissions) await execute("INSERT INTO user_report_permissions (id, user_id, report_key) VALUES (?,?,?)", [randomUUID(), user_id, rk]);
    }
    return { success: true };
  });

  app.post("/api/functions/user-management/delete", async (req, reply) => {
    const { user_id } = (req.body ?? {}) as any;
    if (!user_id) return reply.code(400).send({ error: "user_id obrigatório" });
    await execute("DELETE FROM users WHERE id = ?", [user_id]);
    return { success: true };
  });
}

function formatBytes(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const index = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1);
  return `${(value / Math.pow(1024, index)).toLocaleString("pt-BR", { maximumFractionDigits: 2 })} ${units[index]}`;
}
