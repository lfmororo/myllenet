import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import logoImg from "@/assets/logo.png";

const FN_URL = `https://${import.meta.env.VITE_SUPABASE_PROJECT_ID}.supabase.co/functions/v1/diagnostico`;
const NOME_PROVEDOR = "Mororo.Tech";
const ehWindows = typeof navigator !== "undefined" && navigator.userAgent.includes("Windows");

type Estado = "aguardando" | "testando" | "ok" | "alerta" | "falha";
type Veredito = "ok" | "alerta" | "falha";

interface Config {
  speedtest_url: string | null;
  dns_curinga: string | null;
  sites: { nome: string; url: string }[];
  duracao_ms: number;
  fluxos: number;
}
interface Inicial {
  ip: string;
  na_rede_provedor: boolean;
  cliente_primeiro_nome: string;
  config: Config;
}
interface Etapa {
  id: string;
  nome: string;
  estado: Estado;
  texto: string;
}

const ETAPAS_BASE: Etapa[] = [
  { id: "conexao", nome: "Conexão do aparelho", estado: "aguardando", texto: "" },
  { id: "rede", nome: "Rede do provedor", estado: "aguardando", texto: "" },
  { id: "latencia", nome: "Tempo de resposta", estado: "aguardando", texto: "" },
  { id: "download", nome: "Velocidade de download", estado: "aguardando", texto: "" },
  { id: "upload", nome: "Velocidade de upload", estado: "aguardando", texto: "" },
  { id: "dns", nome: "Endereços de sites (DNS)", estado: "aguardando", texto: "" },
  { id: "sites", nome: "Acesso a sites", estado: "aguardando", texto: "" },
];

const rnd = () => Math.random().toString(36).slice(2) + Date.now().toString(36);
const fmt = (n: number | null) => (n === null ? "—" : n >= 100 ? n.toFixed(0) : n.toFixed(1));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function fetchTimeout(url: string, opts: RequestInit, ms: number) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { ...opts, signal: ctrl.signal });
  } finally {
    clearTimeout(t);
  }
}

function coletarIpsLocais(): Promise<string[]> {
  return new Promise((resolve) => {
    const ips = new Set<string>();
    let pc: RTCPeerConnection | null = null;
    try {
      pc = new RTCPeerConnection({ iceServers: [] });
      pc.createDataChannel("d");
      pc.onicecandidate = (e) => {
        const c = e.candidate?.candidate;
        if (!c) return;
        const parts = c.split(" ");
        if (parts[4]) ips.add(parts[4]);
      };
      pc.createOffer().then((o) => pc!.setLocalDescription(o)).catch(() => {});
    } catch {
      resolve([]);
      return;
    }
    setTimeout(() => {
      try { pc?.close(); } catch { /* ignore */ }
      resolve([...ips]);
    }, 1500);
  });
}

const TITULOS: Record<Veredito, string> = {
  ok: "Sua conexão está normal",
  alerta: "Sua conexão funciona, com pontos de atenção",
  falha: "Encontramos um problema na conexão",
};

export default function DiagnosticoPage() {
  const [params] = useSearchParams();
  const token = params.get("c") ?? "";
  const [inicial, setInicial] = useState<Inicial | null>(null);
  const [erroLink, setErroLink] = useState(false);
  const [carregando, setCarregando] = useState(true);
  const [fase, setFase] = useState<"pronto" | "rodando" | "fim">("pronto");
  const [etapas, setEtapas] = useState<Etapa[]>(ETAPAS_BASE);
  const [down, setDown] = useState<number | null>(null);
  const [up, setUp] = useState<number | null>(null);
  const [veredito, setVeredito] = useState<Veredito | null>(null);
  const [protocolo, setProtocolo] = useState<string | null>(null);
  const [envioFalhou, setEnvioFalhou] = useState(false);
  const rodando = useRef(false);

  const celular =
    typeof navigator !== "undefined" && (navigator as any).connection?.type === "cellular";

  // Modo escuro conforme o sistema
  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const root = document.documentElement;
    const had = root.classList.contains("dark");
    const apply = () => root.classList.toggle("dark", mq.matches);
    apply();
    mq.addEventListener("change", apply);
    document.title = "Diagnóstico de conexão";
    return () => {
      mq.removeEventListener("change", apply);
      root.classList.toggle("dark", had);
    };
  }, []);

  useEffect(() => {
    (async () => {
      try {
        if (!token) throw new Error("sem token");
        const r = await fetch(`${FN_URL}?c=${encodeURIComponent(token)}`);
        if (!r.ok) throw new Error(String(r.status));
        setInicial(await r.json());
      } catch {
        setErroLink(true);
      } finally {
        setCarregando(false);
      }
    })();
  }, [token]);

  const upd = (id: string, estado: Estado, texto = "") =>
    setEtapas((prev) => prev.map((e) => (e.id === id ? { ...e, estado, texto } : e)));

  async function iniciar() {
    if (!inicial || rodando.current) return;
    rodando.current = true;
    setFase("rodando");
    setEtapas(ETAPAS_BASE);
    setDown(null);
    setUp(null);
    setVeredito(null);
    setProtocolo(null);
    setEnvioFalhou(false);

    const cfg = inicial.config;
    const base = (cfg.speedtest_url ?? "").replace(/\/+$/, "");
    const fluxos = Math.max(1, cfg.fluxos || 4);
    const duracao = Math.max(1000, cfg.duracao_ms || 8000);
    const estados: Record<string, Estado> = {};
    const rel: Record<string, any> = {
      versao: 1,
      iniciado_em: new Date().toISOString(),
      dispositivo: {},
      conexao: {},
      rede: {},
      latencia: {},
      velocidade: {},
      dns: {},
      sites: [],
      resumo: {},
      erros: [] as { etapa: string; mensagem: string }[],
    };

    const etapa = async (id: string, fn: () => Promise<[Estado, string]>) => {
      upd(id, "testando");
      try {
        const [e, t] = await fn();
        estados[id] = e;
        upd(id, e, t);
      } catch (err: any) {
        estados[id] = "falha";
        rel.erros.push({ etapa: id, mensagem: String(err?.message ?? err) });
        upd(id, "falha", "Não foi possível testar");
      }
    };

    // 1. Conexão do aparelho
    await etapa("conexao", async () => {
      const nc = (navigator as any).connection;
      const conexao: any = { online: navigator.onLine };
      if (nc) {
        for (const k of ["type", "effectiveType", "downlink", "rtt"]) if (nc[k] !== undefined) conexao[k] = nc[k];
      }
      const ips = await coletarIpsLocais();
      conexao.ips_locais = ips;
      conexao.ip_local_oculto = ips.length > 0 && ips.every((i) => i.endsWith(".local"));
      rel.conexao = conexao;
      rel.dispositivo = {
        user_agent: navigator.userAgent,
        plataforma: (navigator as any).userAgentData?.platform ?? navigator.platform,
        idioma: navigator.language,
        tela: `${screen.width}x${screen.height}`,
      };
      if (!navigator.onLine) return ["falha", "O aparelho está sem internet."];
      if (conexao.type === "cellular") return ["alerta", "Usando dados móveis, não o Wi-Fi."];
      return ["ok", "Aparelho conectado."];
    });

    // 2. Rede do provedor
    await etapa("rede", async () => {
      rel.rede = { ip_publico: inicial.ip, na_rede_provedor: inicial.na_rede_provedor };
      if (!inicial.na_rede_provedor)
        return ["alerta", "Este aparelho não está saindo pela nossa rede. Confira se está no Wi-Fi certo."];
      return ["ok", "Você está na nossa rede."];
    });

    // 3. Tempo de resposta
    await etapa("latencia", async () => {
      if (!base) throw new Error("speedtest_url não configurado");
      const amostras: number[] = [];
      let perdas = 0;
      for (let i = 0; i < 11; i++) {
        const t0 = performance.now();
        try {
          const r = await fetchTimeout(`${base}/empty.php?cors=true&r=${rnd()}`, { cache: "no-store" }, 5000);
          await r.arrayBuffer();
          if (i > 0) amostras.push(performance.now() - t0);
        } catch {
          if (i > 0) perdas++;
        }
      }
      const perda = (perdas / 10) * 100;
      const ord = [...amostras].sort((a, b) => a - b);
      const med = ord.length
        ? ord.length % 2
          ? ord[(ord.length - 1) / 2]
          : (ord[ord.length / 2 - 1] + ord[ord.length / 2]) / 2
        : null;
      let jitter: number | null = null;
      if (amostras.length > 1) {
        let s = 0;
        for (let i = 1; i < amostras.length; i++) s += Math.abs(amostras[i] - amostras[i - 1]);
        jitter = s / (amostras.length - 1);
      }
      rel.latencia = { ms: med, jitter_ms: jitter, perda_pct: perda, amostras };
      if (perda >= 20) return ["falha", `Muitas respostas se perderam (${perda.toFixed(0)}%).`];
      const txt = `Resposta em ${med?.toFixed(0) ?? "—"} ms.`;
      if (perda > 0) return ["alerta", `${txt} Algumas respostas se perderam (${perda.toFixed(0)}%).`];
      if ((med ?? 0) > 80) return ["alerta", `${txt} Um pouco lento.`];
      if ((jitter ?? 0) > 30) return ["alerta", `${txt} A resposta está oscilando.`];
      return ["ok", txt];
    });

    // 4. Download
    await etapa("download", async () => {
      if (!base) throw new Error("speedtest_url não configurado");
      const ctrl = new AbortController();
      let bytes = 0;
      const t0 = performance.now();
      const tick = setInterval(() => {
        const s = (performance.now() - t0) / 1000;
        if (s > 0) setDown((bytes * 8) / s / 1e6);
      }, 250);
      const timer = setTimeout(() => ctrl.abort(), duracao);
      const loop = async () => {
        while (!ctrl.signal.aborted) {
          try {
            const r = await fetch(`${base}/garbage.php?cors=true&ckSize=100&r=${rnd()}`, {
              cache: "no-store",
              signal: ctrl.signal,
            });
            const reader = r.body!.getReader();
            for (;;) {
              const { done, value } = await reader.read();
              if (done) break;
              bytes += value.byteLength;
            }
          } catch {
            if (!ctrl.signal.aborted) await sleep(100);
          }
        }
      };
      await Promise.all(Array.from({ length: fluxos }, loop));
      clearTimeout(timer);
      clearInterval(tick);
      const s = (performance.now() - t0) / 1000;
      const mbps = (bytes * 8) / s / 1e6;
      setDown(mbps);
      rel.velocidade.download_mbps = mbps;
      rel.velocidade.download_bytes = bytes;
      if (bytes === 0) return ["falha", "Não foi possível baixar dados."];
      return ["ok", `${fmt(mbps)} Mbps.`];
    });

    // 5. Upload
    await etapa("upload", async () => {
      if (!base) throw new Error("speedtest_url não configurado");
      const buf = new Uint8Array(1024 * 1024);
      for (let i = 0; i < buf.length; i += 65536) crypto.getRandomValues(buf.subarray(i, i + 65536));
      const blob = new Blob([buf]);
      const ctrl = new AbortController();
      let bytes = 0;
      const t0 = performance.now();
      const tick = setInterval(() => {
        const s = (performance.now() - t0) / 1000;
        if (s > 0) setUp((bytes * 8) / s / 1e6);
      }, 250);
      const timer = setTimeout(() => ctrl.abort(), duracao);
      const loop = async () => {
        while (!ctrl.signal.aborted) {
          try {
            const r = await fetch(`${base}/empty.php?cors=true&r=${rnd()}`, {
              method: "POST",
              body: blob,
              cache: "no-store",
              signal: ctrl.signal,
            });
            await r.arrayBuffer();
            bytes += blob.size;
          } catch {
            if (!ctrl.signal.aborted) await sleep(100);
          }
        }
      };
      await Promise.all(Array.from({ length: fluxos }, loop));
      clearTimeout(timer);
      clearInterval(tick);
      const s = (performance.now() - t0) / 1000;
      const mbps = (bytes * 8) / s / 1e6;
      setUp(mbps);
      rel.velocidade.upload_mbps = mbps;
      rel.velocidade.upload_bytes = bytes;
      if (bytes === 0) return ["falha", "Não foi possível enviar dados."];
      return ["ok", `${fmt(mbps)} Mbps.`];
    });

    // 6. DNS
    await etapa("dns", async () => {
      const dom = (cfg.dns_curinga ?? "").trim();
      if (!dom) {
        rel.dns = { verificado: false };
        return ["ok", "Verificado junto com o acesso a sites"];
      }
      const tempos: (number | null)[] = [];
      for (let i = 0; i < 3; i++) {
        const url = `https://t${rnd()}.${dom}/`;
        try {
          await fetchTimeout(url, { mode: "no-cors", cache: "no-store" }, 5000);
          await sleep(50);
          const ent = performance.getEntriesByName(url)[0] as PerformanceResourceTiming | undefined;
          tempos.push(ent ? ent.domainLookupEnd - ent.domainLookupStart : null);
        } catch {
          tempos.push(null);
        }
      }
      const ok = tempos.filter((t): t is number => t !== null);
      const falhas = 3 - ok.length;
      const media = ok.length ? ok.reduce((a, b) => a + b, 0) / ok.length : null;
      rel.dns = { tempos_ms: tempos, media_ms: media, falhas };
      if (falhas === 3) return ["falha", "Não conseguimos encontrar os endereços dos sites."];
      if (falhas > 0) return ["alerta", "Às vezes os endereços dos sites não são encontrados."];
      if ((media ?? 0) > 150) return ["alerta", "Os endereços dos sites estão demorando para responder."];
      return ["ok", "Funcionando bem."];
    });

    // 7. Sites
    await etapa("sites", async () => {
      const lista = cfg.sites ?? [];
      const res: { nome: string; ok: boolean; ms: number | null }[] = [];
      for (const s of lista) {
        const t0 = performance.now();
        try {
          const sep = s.url.includes("?") ? "&" : "?";
          await fetchTimeout(`${s.url}${sep}r=${rnd()}`, { mode: "no-cors", cache: "no-store" }, 8000);
          res.push({ nome: s.nome, ok: true, ms: performance.now() - t0 });
        } catch {
          res.push({ nome: s.nome, ok: false, ms: null });
        }
      }
      rel.sites = res;
      if (!res.length) return ["ok", "Nenhum site configurado."];
      const abertos = res.filter((r) => r.ok);
      if (!abertos.length) return ["falha", "Nenhum site abriu."];
      const naoAbriram = res.filter((r) => !r.ok).map((r) => r.nome);
      const lentos = res.filter((r) => r.ok && (r.ms ?? 0) > 1500).map((r) => r.nome);
      const partes: string[] = [];
      if (naoAbriram.length) partes.push(`Não abriu: ${naoAbriram.join(", ")}.`);
      if (lentos.length) partes.push(`Lento: ${lentos.join(", ")}.`);
      if (partes.length) return ["alerta", partes.join(" ")];
      return ["ok", "Todos os sites abriram."];
    });

    const vals = Object.values(estados);
    const v: Veredito = vals.includes("falha") ? "falha" : vals.includes("alerta") ? "alerta" : "ok";
    rel.concluido_em = new Date().toISOString();
    rel.resumo = { veredito: v, etapas: estados };
    setVeredito(v);
    setFase("fim");

    try {
      const r = await fetch(`${FN_URL}?c=${encodeURIComponent(token)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(rel),
      });
      if (!r.ok) throw new Error(String(r.status));
      const j = await r.json();
      setProtocolo(j.protocolo);
    } catch {
      setEnvioFalhou(true);
    }
    rodando.current = false;
  }

  function baixarDiagnosticoWindows() {
    const url = `${FN_URL}?c=${encodeURIComponent(token)}`;
    const conteudo = String.raw`@echo off
chcp 65001 >nul
title Diagnostico {NOME}
set "ARQ=%TEMP%\diagnostico-{NOME}.txt"
echo.
echo  Coletando informacoes da sua conexao. Aguarde cerca de 1 minuto...
echo.
(
  echo ==== DATA ====
  echo %DATE% %TIME%
  echo ==== COMPUTADOR ====
  echo %COMPUTERNAME%
  ver
  echo ==== WI-FI ^(nome, sinal, velocidade do link^) ====
  netsh wlan show interfaces
  echo ==== ADAPTADORES ^(IP local, gateway, DNS^) ====
  ipconfig /all
  echo ==== ROTAS ====
  route print -4
  echo ==== PING AO ROTEADOR ^(gateway^) ====
  for /f "tokens=3" %%g in ('route print -4 ^| findstr /r /c:"^ *0\.0\.0\.0  *0\.0\.0\.0"') do ping -n 20 %%g
  echo ==== PING INTERNET ^(8.8.8.8^) ====
  ping -n 20 8.8.8.8
  echo ==== DNS ====
  ipconfig /flushdns
  nslookup google.com
  nslookup google.com 8.8.8.8
  powershell -NoProfile -Command "foreach($d in 'google.com','youtube.com','whatsapp.com'){ $t=(Measure-Command { Resolve-DnsName $d -DnsOnly -NoHostsFile -ErrorAction SilentlyContinue }).TotalMilliseconds; '{0}: {1:N0} ms' -f $d,$t }"
  echo ==== TRACERT ====
  tracert -d -w 1000 -h 20 8.8.8.8
) > "%ARQ%" 2>&1
echo  Enviando para o suporte...
curl.exe -s -X POST -H "Content-Type: text/plain; charset=utf-8" --data-binary "@%ARQ%" "{URL}"
echo.
echo.
echo  Pronto! O relatorio foi enviado para a {NOME}. Pode fechar esta janela.
pause >nul
`
      .replaceAll("{NOME}", NOME_PROVEDOR)
      .replaceAll("{URL}", url)
      .replace(/\n/g, "\r\n");
    const blob = new Blob([conteudo], { type: "application/x-bat" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `diagnostico-${NOME_PROVEDOR}.bat`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  const titulo =
    fase === "pronto" ? "Vamos verificar sua internet" : fase === "rodando" ? "Verificando sua conexão" : TITULOS[veredito!];
  const corTitulo =
    fase !== "fim" ? "text-foreground" : veredito === "ok" ? "text-success" : veredito === "alerta" ? "text-warning" : "text-destructive";

  return (
    <div className="min-h-screen bg-background text-foreground">
      <main className="mx-auto w-full max-w-[34rem] px-5 py-8 flex flex-col gap-6">
        <header className="flex items-center gap-3">
          <img src={logoImg} alt="" className="h-9 w-auto object-contain logo-high-contrast" />
          <span className="text-lg font-semibold tracking-tight">Mororo.Tech</span>
        </header>

        {carregando ? (
          <p className="text-muted-foreground">Carregando…</p>
        ) : erroLink ? (
          <div className="rounded-xl border border-destructive/40 bg-destructive/10 p-5 text-base">
            Link incompleto ou expirado. Peça um novo link ao atendimento.
          </div>
        ) : (
          <>
            <div className="space-y-2">
              {inicial?.cliente_primeiro_nome && fase === "pronto" && (
                <p className="text-muted-foreground">Olá, {inicial.cliente_primeiro_nome}!</p>
              )}
              <h1 className={`text-3xl sm:text-4xl font-bold leading-tight ${corTitulo}`} aria-live="polite">
                {titulo}
              </h1>
            </div>

            {celular && (
              <div className="rounded-xl border border-warning/50 bg-warning/10 p-4 text-sm">
                Você está usando dados móveis. Conecte-se ao Wi-Fi de casa antes de iniciar; o teste consome dados.
              </div>
            )}

            <section className="grid grid-cols-2 gap-3" aria-label="Velocidade">
              {[
                ["Download", down],
                ["Upload", up],
              ].map(([rot, val]) => (
                <div key={rot as string} className="rounded-2xl border bg-card p-4">
                  <div className="text-sm text-muted-foreground">{rot as string}</div>
                  <div className="mt-1 flex items-baseline gap-1">
                    <span className="text-4xl font-bold tabular-nums">{fmt(val as number | null)}</span>
                    <span className="text-sm text-muted-foreground">Mbps</span>
                  </div>
                </div>
              ))}
            </section>

            {fase !== "rodando" && (
              <Button size="lg" className="h-14 text-lg rounded-xl" onClick={iniciar}>
                {fase === "fim" ? "Testar novamente" : "Iniciar diagnóstico"}
              </Button>
            )}

            {fase === "fim" && protocolo && (
              <div className="rounded-xl border-2 border-primary bg-primary/10 p-5 text-center space-y-1">
                <div className="text-sm text-muted-foreground">Protocolo</div>
                <div className="text-3xl font-bold tracking-widest tabular-nums">{protocolo}</div>
                <p className="text-sm">Resultado enviado. Informe o protocolo ao atendente se ele pedir.</p>
              </div>
            )}
            {fase === "fim" && envioFalhou && (
              <div className="rounded-xl border border-destructive/40 bg-destructive/10 p-4 text-sm">
                Não conseguimos enviar o resultado. Tire um print desta tela e mande para o nosso suporte.
              </div>
            )}

            <ol className="rounded-2xl border bg-card divide-y">
              {etapas.map((e) => (
                <li key={e.id} className="flex gap-3 p-4">
                  <span className="mt-1.5 relative flex h-3 w-3 shrink-0">
                    {e.estado === "testando" && (
                      <span className="absolute inline-flex h-full w-full rounded-full bg-primary opacity-60 animate-ping motion-reduce:animate-none" />
                    )}
                    <span
                      className={`relative inline-flex h-3 w-3 rounded-full ${
                        e.estado === "aguardando"
                          ? "bg-muted-foreground/30"
                          : e.estado === "testando"
                            ? "bg-primary"
                            : e.estado === "ok"
                              ? "bg-success"
                              : e.estado === "alerta"
                                ? "bg-warning"
                                : "bg-destructive"
                      }`}
                    />
                  </span>
                  <div className="min-w-0">
                    <div className="font-medium">{e.nome}</div>
                    <div className="text-sm text-muted-foreground">
                      {e.estado === "aguardando" ? "Aguardando" : e.estado === "testando" ? "Testando…" : e.texto}
                    </div>
                  </div>
                </li>
              ))}
            </ol>
          </>
        )}
      </main>
    </div>
  );
}
