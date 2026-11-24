// fatura-publica — dados da página pública /fatura/:id (link enviado ao cliente no WhatsApp)
// Substitui a rota /api/public/invoice/:id do backend Fastify, que não está no ar.
// Devolve só o necessário para exibir e pagar a fatura, com nome e documento já mascarados.
import { createClient } from "npm:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Campos da fatura que a página usa (nada de ids internos de cobrança além do necessário para pagar)
const CAMPOS_FATURA = [
  "id", "descricao", "valor_centavos", "vencimento", "status", "paid_at", "gateway", "payment_method",
  "efi_barcode", "efi_link", "efi_pix_copiacola", "efi_pix_qrcode",
  "mp_link", "mp_pix_copiacola", "mp_pix_qrcode",
];

function nomeMascarado(v?: string | null) {
  const p = (v || "").trim().split(/\s+/).filter(Boolean);
  if (p.length <= 1) return p[0] || "Cliente";
  return `${p[0]} ${p.slice(1).map((x) => `${x.charAt(0).toUpperCase()}.`).join(" ")}`;
}
// mantém o tamanho e os 2 últimos dígitos (a página aplica a máscara de CPF/CNPJ)
function documentoMascarado(v?: string | null) {
  const d = (v || "").replace(/\D/g, "");
  return d.length >= 2 ? "0".repeat(d.length - 2) + d.slice(-2) : "";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    let id = new URL(req.url).searchParams.get("id") || "";
    if (!id && req.method === "POST") id = String((await req.json().catch(() => ({})))?.id || "");
    if (!UUID.test(id)) return json({ error: "Fatura não encontrada" }, 404);

    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: inv } = await supabase
      .from("invoices")
      .select("*, customers(nome, cpf, bairro, cidade)")
      .eq("id", id)
      .maybeSingle();
    if (!inv) return json({ error: "Fatura não encontrada" }, 404);

    const fatura: Record<string, unknown> = {};
    for (const k of CAMPOS_FATURA) if (k in inv) fatura[k] = (inv as any)[k];
    const c = (inv as any).customers || {};
    fatura.customers = {
      nome: nomeMascarado(c.nome),
      cpf: documentoMascarado(c.cpf),
      bairro: c.bairro ?? null,
      cidade: c.cidade ?? null,
    };

    const { data: rows } = await supabase
      .from("settings")
      .select("key, value")
      .in("key", ["pix_key", "pix_name", "pix_city"]);
    const settings: Record<string, string> = {};
    for (const r of rows || []) settings[r.key] = r.value ?? "";

    return json({ invoice: fatura, settings });
  } catch (e) {
    console.error("fatura-publica", e);
    return json({ error: "Erro ao carregar a fatura" }, 500);
  }
});
