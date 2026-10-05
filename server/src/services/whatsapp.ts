import { config } from "../config.js";
import { getSettings } from "./settings.js";

export type WhatsAppProvider = "uazapi" | "evolution";

export interface WhatsAppConfig {
  provider: WhatsAppProvider;
  uazapiBaseUrl: string;
  uazapiToken: string;
  evolutionBaseUrl: string;
  evolutionApiKey: string;
  evolutionInstance: string;
}

const SETTINGS_KEYS = [
  "whatsapp_provider",
  "uazapi_token",
  "uazapi_base_url",
  "evolution_base_url",
  "evolution_api_key",
  "evolution_instance",
];

export async function getWhatsAppConfig(): Promise<WhatsAppConfig> {
  const map = await getSettings(SETTINGS_KEYS);
  const provider: WhatsAppProvider = map["whatsapp_provider"] === "evolution" ? "evolution" : "uazapi";
  return {
    provider,
    uazapiBaseUrl: (map["uazapi_base_url"] || config.whatsapp.uazapiBaseUrl).replace(/\/+$/, ""),
    uazapiToken: map["uazapi_token"] || config.whatsapp.uazapiToken,
    evolutionBaseUrl: (map["evolution_base_url"] || config.whatsapp.evolutionBaseUrl).replace(/\/+$/, ""),
    evolutionApiKey: map["evolution_api_key"] || config.whatsapp.evolutionApiKey,
    evolutionInstance: map["evolution_instance"] || config.whatsapp.evolutionInstance,
  };
}

export function formatPhone(phone: string): string {
  let digits = (phone || "").replace(/\D/g, "");
  if (!digits.startsWith("55")) digits = "55" + digits;
  if (digits.length === 12 && digits.startsWith("55")) {
    const ddd = digits.substring(2, 4);
    const number = digits.substring(4);
    digits = `55${ddd}9${number}`;
  }
  return digits;
}

async function request(url: string, headers: Record<string, string>, body: unknown, label: string) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
  const responseText = await response.text();
  console.log(`[WhatsApp:${label}] ${response.status} ${responseText.slice(0, 500)}`);
  let data: unknown;
  try { data = JSON.parse(responseText); } catch { data = { raw: responseText }; }
  if (!response.ok) {
    throw new Error(`WhatsApp (${label}) erro [${response.status}]: ${JSON.stringify(data).slice(0, 400)}`);
  }
  return data;
}

function assertConfigured(cfg: WhatsAppConfig) {
  if (cfg.provider === "evolution") {
    if (!cfg.evolutionBaseUrl || !cfg.evolutionApiKey || !cfg.evolutionInstance) {
      throw new Error("Evolution API não configurada.");
    }
  } else if (!cfg.uazapiToken) {
    throw new Error("Token WhatsApp não configurado.");
  }
}

export async function waSendText(phone: string, text: string, cfgIn?: WhatsAppConfig) {
  const cfg = cfgIn || (await getWhatsAppConfig());
  assertConfigured(cfg);
  const number = formatPhone(phone);
  if (cfg.provider === "evolution") {
    return request(
      `${cfg.evolutionBaseUrl}/message/sendText/${encodeURIComponent(cfg.evolutionInstance)}`,
      { apikey: cfg.evolutionApiKey },
      { number, text },
      "evolution/sendText"
    );
  }
  return request(`${cfg.uazapiBaseUrl}/send/text`, { token: cfg.uazapiToken }, { number, text }, "uazapi/send/text");
}

export async function waSendDocument(phone: string, fileUrl: string, fileName: string, caption: string, cfgIn?: WhatsAppConfig) {
  const cfg = cfgIn || (await getWhatsAppConfig());
  assertConfigured(cfg);
  const number = formatPhone(phone);
  if (cfg.provider === "evolution") {
    return request(
      `${cfg.evolutionBaseUrl}/message/sendMedia/${encodeURIComponent(cfg.evolutionInstance)}`,
      { apikey: cfg.evolutionApiKey },
      { number, mediatype: "document", mimetype: "application/pdf", media: fileUrl, fileName, caption, delay: 2000 },
      "evolution/sendMedia"
    );
  }
  return request(
    `${cfg.uazapiBaseUrl}/send/media`,
    { token: cfg.uazapiToken },
    { number, type: "document", file: fileUrl, delay: 2000, text: caption, docName: fileName },
    "uazapi/send/media"
  );
}

export async function waSendSupportButton(phone: string, cfgIn?: WhatsAppConfig) {
  try {
    const cfg = cfgIn || (await getWhatsAppConfig());
    assertConfigured(cfg);
    const number = formatPhone(phone);
    const supportUrl = "https://wa.me/5585986801458?text=Preciso%20de%20Suporte";
    if (cfg.provider === "evolution") {
      return request(
        `${cfg.evolutionBaseUrl}/message/sendButtons/${encodeURIComponent(cfg.evolutionInstance)}`,
        { apikey: cfg.evolutionApiKey },
        {
          number,
          title: "Precisa de Suporte?",
          description: "Escolha uma opção",
          footer: "Mororo.Tech",
          buttons: [{ type: "url", displayText: "Falar com Suporte", url: supportUrl }],
        },
        "evolution/sendButtons"
      );
    }
    return request(
      `${cfg.uazapiBaseUrl}/send/menu`,
      { token: cfg.uazapiToken },
      { number, type: "button", text: "Precisa de Suporte?", choices: [`Falar com Suporte|${supportUrl}`], footerText: "Escolha uma opção" },
      "uazapi/send/menu"
    );
  } catch (err) {
    console.error("Falha ao enviar botão de suporte:", err);
    return null;
  }
}

export async function waTestConnection() {
  const cfg = await getWhatsAppConfig();
  assertConfigured(cfg);
  if (cfg.provider === "evolution") {
    const url = `${cfg.evolutionBaseUrl}/instance/connectionState/${encodeURIComponent(cfg.evolutionInstance)}`;
    const res = await fetch(url, { headers: { apikey: cfg.evolutionApiKey } });
    const text = await res.text();
    if (!res.ok) throw new Error(`Evolution API [${res.status}]: ${text.slice(0, 300)}`);
    let state = text;
    try { state = (JSON.parse(text)?.instance?.state) || text; } catch { /* ignore */ }
    return { provider: cfg.provider, state };
  }
  const res = await fetch(`${cfg.uazapiBaseUrl}/instance/status`, { headers: { token: cfg.uazapiToken } });
  const text = await res.text();
  if (!res.ok) throw new Error(`uazapi [${res.status}]: ${text.slice(0, 300)}`);
  let state = text;
  try { state = JSON.parse(text)?.instance?.status || JSON.parse(text)?.status || text; } catch { /* ignore */ }
  return { provider: cfg.provider, state };
}
