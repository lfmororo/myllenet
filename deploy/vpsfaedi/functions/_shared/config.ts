// Configurações do provedor usadas nas mensagens e documentos (Configurações → Empresa)
//
//   const cfg = await carregarConfig();
//   cfg.provedor        "Mororo.Tech"
//   cfg.telefone        "85986801458"        (só dígitos, para wa.me e envio)
//   cfg.telefoneFmt     "(85) 98680-1458"
//   cfg.painel          "https://myllenet.mororo.tech"
//   cfg.admins          ["85986801458", ...] (WhatsApp dos administradores)
//   cfg.rodape          "\n\n🤖 _Esta é uma mensagem automática..._"
//   cfg.slogan          frase opcional da fatura
//
// Valores ficam na tabela settings; cache de 60 s por instância da function.
import { createClient } from "npm:@supabase/supabase-js@2";

export type ConfigProvedor = {
  provedor: string;
  telefone: string;
  telefoneFmt: string;
  painel: string;
  admins: string[];
  rodape: string;
  slogan: string;
};

const PADRAO = {
  provedor_nome: "Mororo.Tech",
  atendimento_telefone: "85986801458",
  url_painel: "https://myllenet.mororo.tech",
  fatura_slogan: "MylleNet agora é Mororo.Tech",
};

let cache: { em: number; cfg: ConfigProvedor } | null = null;

export function formatarTelefone(digitos: string): string {
  const d = digitos.replace(/\D/g, "").replace(/^55(?=\d{10,11}$)/, "");
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return digitos;
}

export async function carregarConfig(): Promise<ConfigProvedor> {
  if (cache && Date.now() - cache.em < 60_000) return cache.cfg;
  const s: Record<string, string> = {};
  try {
    const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data } = await db
      .from("settings")
      .select("key, value")
      .in("key", ["provedor_nome", "atendimento_telefone", "url_painel", "fatura_slogan", "admin_whatsapp"]);
    for (const r of data || []) s[r.key] = r.value ?? "";
  } catch (e) {
    console.error("carregarConfig: usando padrões", e);
  }
  const telefone = (s.atendimento_telefone || PADRAO.atendimento_telefone).replace(/\D/g, "");
  const telefoneFmt = formatarTelefone(telefone);
  const admins = [...new Set(
    String(s.admin_whatsapp || "").split(/[,;\s\n]+/).map((n) => n.replace(/\D/g, "")).filter((n) => n.length >= 10),
  )];
  const cfg: ConfigProvedor = {
    provedor: (s.provedor_nome || PADRAO.provedor_nome).trim(),
    telefone,
    telefoneFmt,
    painel: (s.url_painel || Deno.env.get("PAINEL_URL") || PADRAO.url_painel).replace(/\/+$/, ""),
    admins: admins.length ? admins : [telefone],
    rodape: `\n\n🤖 _Esta é uma mensagem automática. Para falar com um atendente, entre em contato: ${telefoneFmt}_`,
    slogan: s.fatura_slogan ?? PADRAO.fatura_slogan,
  };
  cache = { em: Date.now(), cfg };
  return cfg;
}
