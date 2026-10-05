import { randomUUID } from "node:crypto";
import { config } from "../config.js";
import { execute } from "../db.js";

const EFI_BASE_URL = "https://cobrancas.api.efipay.com.br";

async function getEfiToken(): Promise<string> {
  const clientId = config.efi.clientId;
  const clientSecret = config.efi.clientSecret;
  if (!clientId || !clientSecret) throw new Error("EFI não configurada (client_id/client_secret)");
  const auth = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
  const response = await fetch(`${EFI_BASE_URL}/v1/authorize`, {
    method: "POST",
    headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/json" },
    body: JSON.stringify({ grant_type: "client_credentials" }),
  });
  if (!response.ok) {
    const err = await response.text();
    throw new Error(`EFI auth failed: ${response.status} ${err.slice(0, 300)}`);
  }
  const data = await response.json();
  return data.access_token;
}

export async function logEfiApiCall(params: {
  method: string;
  endpoint: string;
  status_code: number | null;
  request_body?: string | null;
  response_body?: string | null;
  error_message?: string | null;
  duration_ms: number;
  context?: string | null;
}) {
  try {
    await execute(
      `INSERT INTO efi_api_logs (id, method, endpoint, status_code, request_body, response_body, error_message, duration_ms, context)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        randomUUID(),
        params.method,
        params.endpoint,
        params.status_code,
        params.request_body?.slice(0, 2000) ?? null,
        params.response_body?.slice(0, 2000) ?? null,
        params.error_message?.slice(0, 1000) ?? null,
        params.duration_ms,
        params.context ?? null,
      ]
    );
  } catch (e) {
    console.error("Failed to log EFI API call:", e);
  }
}

export async function efiRequest(path: string, method: string, body?: unknown, context?: string) {
  const token = await getEfiToken();
  const options: RequestInit = {
    method,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
  };
  const bodyStr = body ? JSON.stringify(body) : null;
  if (bodyStr) options.body = bodyStr;

  const fullUrl = `${EFI_BASE_URL}${path}`;
  const startTime = Date.now();
  let response: Response;
  let responseText: string;
  try {
    response = await fetch(fullUrl, options);
    responseText = await response.text();
  } catch (fetchErr: any) {
    await logEfiApiCall({ method, endpoint: path, status_code: null, request_body: bodyStr, error_message: fetchErr.message, duration_ms: Date.now() - startTime, context });
    throw fetchErr;
  }

  const duration = Date.now() - startTime;
  let data: any;
  try { data = JSON.parse(responseText); } catch { data = { raw: responseText }; }

  if (!response.ok) {
    const errMsg = typeof data.error_description === "object"
      ? JSON.stringify(data.error_description)
      : (data.error_description || data.message || `EFI API error: ${response.status}`);
    await logEfiApiCall({ method, endpoint: path, status_code: response.status, request_body: bodyStr, response_body: responseText.slice(0, 2000), error_message: errMsg, duration_ms: duration, context });
    throw new Error(errMsg);
  }
  return data;
}

export function isValidCPF(cpf: string): boolean {
  if (cpf.length !== 11 || /^(\d)\1{10}$/.test(cpf)) return false;
  let sum = 0;
  for (let i = 0; i < 9; i++) sum += parseInt(cpf[i]) * (10 - i);
  let rest = (sum * 10) % 11;
  if (rest === 10) rest = 0;
  if (rest !== parseInt(cpf[9])) return false;
  sum = 0;
  for (let i = 0; i < 10; i++) sum += parseInt(cpf[i]) * (11 - i);
  rest = (sum * 10) % 11;
  if (rest === 10) rest = 0;
  return rest === parseInt(cpf[10]);
}
