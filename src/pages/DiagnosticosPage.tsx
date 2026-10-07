import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { AlertTriangle, Copy, Loader2, Search } from "lucide-react";
import { toast } from "sonner";

type Diag = {
  id: string;
  cliente_id: string;
  criado_em: string;
  origem: string;
  ip_publico: string | null;
  na_rede_provedor: boolean | null;
  veredito: string | null;
  download_mbps: number | null;
  upload_mbps: number | null;
  latencia_ms: number | null;
  jitter_ms: number | null;
  perda_pct: number | null;
  user_agent: string | null;
  dados: any;
  status: string;
  observacao: string | null;
  atualizado_por: string | null;
  atualizado_em: string | null;
};
type Cli = { id: string; nome: string; plan_id: string | null; plans?: { nome: string; nome_servidor: string | null } | null };

const ORIGEM: Record<string, string> = { navegador: "Navegador", windows: "Windows", provedor: "Provedor" };
const STATUS: Record<string, string> = { novo: "Novo", em_analise: "Em análise", resolvido: "Resolvido" };
const VEREDITO: Record<string, string> = { ok: "Normal", alerta: "Atenção", falha: "Problema" };

const protocolo = (id: string) => id.slice(0, 8).toUpperCase();
const fmt = (n: number | null | undefined, d = 1) => (n == null ? "—" : Number(n).toFixed(d));
const dt = (s: string) => new Date(s).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });

function VereditoBadge({ v }: { v: string | null }) {
  if (!v) return <Badge variant="outline">—</Badge>;
  const cls =
    v === "ok"
      ? "bg-success/15 text-success border-success/30"
      : v === "alerta"
        ? "bg-warning/15 text-warning border-warning/30"
        : "bg-destructive/15 text-destructive border-destructive/30";
  return <Badge variant="outline" className={cls}>{VEREDITO[v] ?? v}</Badge>;
}
function StatusBadge({ s }: { s: string }) {
  const variant = s === "novo" ? "default" : s === "em_analise" ? "secondary" : "outline";
  return <Badge variant={variant as any}>{STATUS[s] ?? s}</Badge>;
}

function planoMbps(c?: Cli): number | null {
  const p = c?.plans;
  if (!p) return null;
  for (const s of [p.nome_servidor, p.nome]) {
    const m = s?.match(/(\d+(?:[.,]\d+)?)\s*(m|g)/i);
    if (m) return parseFloat(m[1].replace(",", ".")) * (m[2].toLowerCase() === "g" ? 1000 : 1);
  }
  return null;
}

// ---------- Windows parsing ----------
function pick(texto: string, labels: string[]): string | null {
  for (const l of labels) {
    const re = new RegExp(`^\\s*${l}[^:\\n]*:\\s*(.+)$`, "im");
    const m = texto.match(re);
    if (m && m[1].trim()) return m[1].trim();
  }
  return null;
}
function secao(texto: string, nome: string): string {
  const i = texto.indexOf(`==== ${nome}`);
  if (i < 0) return "";
  const resto = texto.slice(i + 5);
  const j = resto.indexOf("\n====");
  return j < 0 ? resto : resto.slice(0, j);
}
function pingInfo(bloco: string) {
  if (!bloco) return null;
  const perda = bloco.match(/\((\d+)%\s*(?:de\s*)?(?:perda|loss)/i);
  const media = bloco.match(/(?:M[ée]dia|Average)\s*=\s*(\d+)\s*ms/i);
  if (!perda && !media) return null;
  return { perda: perda ? `${perda[1]}%` : "—", media: media ? `${media[1]} ms` : "—" };
}
function parseWindows(texto: string) {
  const wlan = secao(texto, "WIFI") || texto;
  const ipc = secao(texto, "IPCONFIG") || texto;
  const ssid = wlan.match(/^\s*SSID\s*:\s*(.+)$/im)?.[1]?.trim() ?? null;
  const pings = texto.split(/\n(?=.*====)/);
  const blocoGw = pings.find((b) => /gateway/i.test(b.split("\n")[0] ?? "") && /ping/i.test(b)) ?? "";
  const bloco8 = pings.find((b) => /8\.8\.8\.8/.test(b.split("\n")[0] ?? "")) ?? "";
  return {
    ssid,
    sinal: pick(wlan, ["Sinal", "Signal"]),
    rx: pick(wlan, ["Taxa de recep", "Receive rate"]),
    tx: pick(wlan, ["Taxa de transmiss", "Transmit rate"]),
    ipv4: pick(ipc, ["Endere[cç]o IPv4", "IPv4 Address"])?.replace(/\(.*\)/, "").trim() ?? null,
    gateway: pick(ipc, ["Gateway Padr[aã]o", "Default Gateway"]),
    pingGw: pingInfo(blocoGw),
    ping8: pingInfo(bloco8),
  };
}

function Info({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-lg border bg-card p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="font-semibold">{value ?? "—"}</div>
    </div>
  );
}

// ---------- Detalhe ----------
function Detalhe({ d, cliente, onSaved, onOpenOther }: { d: Diag; cliente?: Cli; onSaved: (x: Diag) => void; onOpenOther: (x: Diag) => void }) {
  const { user } = useAuth();
  const [status, setStatus] = useState(d.status);
  const [obs, setObs] = useState(d.observacao ?? "");
  const [saving, setSaving] = useState(false);
  const [outros, setOutros] = useState<Diag[]>([]);
  const [prov, setProv] = useState<Diag | null>(null);

  useEffect(() => {
    setStatus(d.status);
    setObs(d.observacao ?? "");
    supabase
      .from("diagnosticos")
      .select("*")
      .eq("cliente_id", d.cliente_id)
      .neq("id", d.id)
      .order("criado_em", { ascending: false })
      .limit(10)
      .then(({ data }) => setOutros((data as Diag[]) ?? []));
    setProv(null);
    if (d.origem !== "provedor") {
      supabase
        .from("diagnosticos")
        .select("*")
        .eq("origem", "provedor")
        .eq("dados->>diagnostico_origem_id", d.id)
        .order("criado_em", { ascending: false })
        .limit(1)
        .then(({ data }) => setProv(((data as Diag[]) ?? [])[0] ?? null));
    }
  }, [d.id]);

  const dados = d.dados ?? {};
  const plano = planoMbps(cliente);
  const alertas: string[] = [];
  if (d.na_rede_provedor === false) alertas.push("Cliente não estava na rede do provedor");
  if (dados?.conexao?.type === "cellular" || dados?.conexao?.tipo === "cellular") alertas.push("Cliente usando dados móveis");
  if (plano && d.download_mbps != null && d.download_mbps < plano * 0.5)
    alertas.push(`Velocidade abaixo de 50% do plano (${fmt(d.download_mbps)} de ${plano} Mbps)`);
  if ((d.perda_pct ?? 0) > 0) alertas.push(`Perda de pacotes (${fmt(d.perda_pct, 0)}%)`);

  const salvar = async () => {
    setSaving(true);
    const patch = { status, observacao: obs || null, atualizado_por: user?.id ?? null, atualizado_em: new Date().toISOString() };
    const { error } = await supabase.from("diagnosticos").update(patch).eq("id", d.id);
    setSaving(false);
    if (error) return toast.error("Erro ao salvar: " + error.message);
    toast.success("Diagnóstico atualizado");
    onSaved({ ...d, ...patch });
  };

  const win = d.origem === "windows" ? parseWindows(String(dados?.texto ?? "")) : null;

  return (
    <div className="space-y-5 pb-8">
      <div className="space-y-1">
        <div className="text-lg font-semibold">
          <Link to={`/clientes?cliente=${d.cliente_id}`} className="text-primary hover:underline">
            {cliente?.nome ?? "Cliente"}
          </Link>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
          <span>{dt(d.criado_em)}</span>
          <Badge variant="outline" className="font-mono">#{protocolo(d.id)}</Badge>
          <Badge variant="secondary">{ORIGEM[d.origem] ?? d.origem}</Badge>
          <VereditoBadge v={d.veredito} />
        </div>
      </div>

      {alertas.length > 0 && (
        <div className="space-y-2">
          {alertas.map((a) => (
            <div key={a} className="flex items-center gap-2 rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-sm">
              <AlertTriangle className="h-4 w-4 text-warning" /> {a}
            </div>
          ))}
        </div>
      )}

      {d.origem === "navegador" && (
        <>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
            <Info label="Download" value={`${fmt(d.download_mbps)} Mbps`} />
            <Info label="Upload" value={`${fmt(d.upload_mbps)} Mbps`} />
            <Info label="Latência" value={`${fmt(d.latencia_ms, 0)} ms`} />
            <Info label="Jitter" value={`${fmt(d.jitter_ms, 0)} ms`} />
            <Info label="Perda" value={`${fmt(d.perda_pct, 0)}%`} />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Info label="IP público" value={d.ip_publico} />
            <Info label="Na rede do provedor?" value={d.na_rede_provedor == null ? "—" : d.na_rede_provedor ? "Sim" : "Não"} />
            <Info
              label="Tipo de conexão"
              value={[dados?.conexao?.type, dados?.conexao?.effectiveType].filter(Boolean).join(" / ") || "Desconhecido"}
            />
            <Info
              label="IPs locais"
              value={
                dados?.conexao?.ip_local_oculto || !dados?.conexao?.ips_locais?.length
                  ? "oculto pelo navegador"
                  : dados.conexao.ips_locais.join(", ")
              }
            />
          </div>
          {dados?.dns && Object.keys(dados.dns).length > 0 && (
            <div>
              <h4 className="mb-2 text-sm font-semibold">DNS</h4>
              <pre className="max-h-40 overflow-auto rounded-md bg-muted p-3 text-xs">{JSON.stringify(dados.dns, null, 2)}</pre>
            </div>
          )}
          {Array.isArray(dados?.sites) && dados.sites.length > 0 && (
            <div>
              <h4 className="mb-2 text-sm font-semibold">Sites</h4>
              <Table>
                <TableHeader><TableRow><TableHead>Site</TableHead><TableHead>Resultado</TableHead><TableHead className="text-right">Tempo</TableHead></TableRow></TableHeader>
                <TableBody>
                  {dados.sites.map((s: any, i: number) => (
                    <TableRow key={i}>
                      <TableCell>{s.nome}</TableCell>
                      <TableCell>{s.ok ? <Badge variant="outline" className="text-success">ok</Badge> : <Badge variant="destructive">falha</Badge>}</TableCell>
                      <TableCell className="text-right">{s.ms != null ? `${Math.round(s.ms)} ms` : "—"}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
          <Info label="Dispositivo" value={<span className="text-sm font-normal">{resumoUA(dados?.dispositivo?.user_agent ?? d.user_agent)}</span>} />
          {dados?.resumo?.etapas && (
            <div>
              <h4 className="mb-2 text-sm font-semibold">Etapas</h4>
              <div className="flex flex-wrap gap-2">
                {Object.entries(dados.resumo.etapas).map(([k, v]) => (
                  <span key={k} className="flex items-center gap-1 text-sm">{k}: <VereditoBadge v={String(v)} /></span>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      {win && (
        <>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            <Info label="SSID" value={win.ssid} />
            <Info label="Sinal" value={win.sinal} />
            <Info label="Recepção / Transmissão" value={`${win.rx ?? "—"} / ${win.tx ?? "—"}`} />
            <Info label="Endereço IPv4" value={win.ipv4} />
            <Info label="Gateway padrão" value={win.gateway} />
            <Info label="Ping gateway (perda / média)" value={win.pingGw ? `${win.pingGw.perda} / ${win.pingGw.media}` : "—"} />
            <Info label="Ping 8.8.8.8 (perda / média)" value={win.ping8 ? `${win.ping8.perda} / ${win.ping8.media}` : "—"} />
          </div>
          {!win.ssid && (
            <p className="text-sm text-muted-foreground">Nome do Wi-Fi indisponível (no Windows 11 é preciso ativar a Localização)</p>
          )}
          <div>
            <div className="mb-2 flex items-center justify-between">
              <h4 className="text-sm font-semibold">Relatório completo</h4>
              <Button size="sm" variant="outline" onClick={() => { navigator.clipboard.writeText(String(dados?.texto ?? "")); toast.success("Copiado"); }}>
                <Copy className="mr-1 h-4 w-4" /> Copiar
              </Button>
            </div>
            <pre className="max-h-96 overflow-auto whitespace-pre rounded-md bg-muted p-3 font-mono text-xs">{String(dados?.texto ?? "")}</pre>
          </div>
        </>
      )}

      {d.origem === "provedor" && (
        <>
          <div className="grid grid-cols-2 gap-2">
            <Info label="Login" value={dados?.pppoe?.login} />
            <Info label="IP" value={dados?.pppoe?.ip} />
            <Info label="Uptime" value={dados?.pppoe?.uptime} />
            <Info label="Caller ID" value={dados?.pppoe?.caller_id} />
          </div>
          {dados?.ping && (
            <div>
              <h4 className="mb-2 text-sm font-semibold">Ping</h4>
              <pre className="max-h-40 overflow-auto rounded-md bg-muted p-3 text-xs">{typeof dados.ping === "string" ? dados.ping : JSON.stringify(dados.ping, null, 2)}</pre>
            </div>
          )}
          {Array.isArray(dados?.traceroute) && (
            <div>
              <h4 className="mb-2 text-sm font-semibold">Traceroute</h4>
              <Table>
                <TableHeader><TableRow><TableHead>#</TableHead><TableHead>Endereço</TableHead><TableHead>Perda</TableHead><TableHead className="text-right">Tempo</TableHead></TableRow></TableHeader>
                <TableBody>
                  {dados.traceroute.map((h: any, i: number) => (
                    <TableRow key={i}>
                      <TableCell>{h.hop ?? h.salto ?? i + 1}</TableCell>
                      <TableCell className="font-mono text-xs">{h.address ?? h.ip ?? h.host ?? "—"}</TableCell>
                      <TableCell>{h.perda_pct != null ? `${h.perda_pct}%` : h.loss ?? h.perda ?? "—"}</TableCell>
                      <TableCell className="text-right">{h.media_ms != null ? `${h.media_ms} ms` : h.avg ?? h.ms ?? h.last ?? "—"}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </>
      )}

      <div className="space-y-3 rounded-lg border p-4">
        <div className="space-y-1">
          <Label>Status</Label>
          <Select value={status} onValueChange={setStatus}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {Object.entries(STATUS).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label>Observação</Label>
          <Textarea value={obs} onChange={(e) => setObs(e.target.value)} rows={3} />
        </div>
        <div className="flex items-center justify-between">
          <span className="text-xs text-muted-foreground">{d.atualizado_em ? `Atualizado em ${dt(d.atualizado_em)}` : ""}</span>
          <Button onClick={salvar} disabled={saving}>{saving && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}Salvar</Button>
        </div>
      </div>

      {prov && (() => {
        const pd = prov.dados ?? {};
        const offline = pd?.pppoe?.online === false;
        const perdaProv = Number(pd?.ping?.perda_pct ?? prov.perda_pct ?? 0);
        const resumo: string[] = [];
        if (offline) resumo.push("Cliente não está conectado ao concentrador");
        if (!offline && perdaProv > 0) resumo.push("Perda de pacotes entre o concentrador e o cliente; verificar enlace/ONU");
        if (!offline && perdaProv === 0 && prov.veredito === "ok" && d.veredito === "falha")
          resumo.push("Rede do provedor ok até o cliente; problema provável no roteador ou Wi-Fi da casa");
        return (
          <div className="space-y-3 rounded-lg border p-4">
            <h4 className="text-sm font-semibold">Visão do provedor</h4>
            {resumo.map((r) => (
              <div key={r} className="rounded-md border border-primary/30 bg-primary/10 px-3 py-2 text-sm">{r}</div>
            ))}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">Cliente <VereditoBadge v={d.veredito} /></div>
                <Info label="Latência" value={`${fmt(d.latencia_ms, 0)} ms`} />
                <Info label="Perda" value={`${fmt(d.perda_pct, 0)}%`} />
                <Info label="Download" value={`${fmt(d.download_mbps)} Mbps`} />
              </div>
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">Provedor <VereditoBadge v={prov.veredito} /></div>
                <Info label="Ping médio" value={`${fmt(pd?.ping?.media_ms ?? prov.latencia_ms, 0)} ms`} />
                <Info label="Perda" value={`${fmt(perdaProv, 0)}%`} />
                <Info label="PPPoE" value={pd?.pppoe?.online === false ? "Offline" : pd?.pppoe?.online ? `Online · ${pd.pppoe.uptime ?? ""}` : "—"} />
              </div>
            </div>
            {pd?.erro && <p className="text-sm text-destructive">Erro do agente: {String(pd.erro)}</p>}
            <Button size="sm" variant="outline" onClick={() => onOpenOther(prov)}>Abrir diagnóstico do provedor</Button>
          </div>
        );
      })()}

      <div>
        <h4 className="mb-2 text-sm font-semibold">Outros diagnósticos deste cliente</h4>
        {outros.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhum outro diagnóstico.</p>
        ) : (
          <Table>
            <TableHeader><TableRow><TableHead>Data</TableHead><TableHead>Origem</TableHead><TableHead>Veredito</TableHead><TableHead>Down</TableHead><TableHead>Lat.</TableHead></TableRow></TableHeader>
            <TableBody>
              {outros.map((o) => (
                <TableRow key={o.id} className="cursor-pointer" onClick={() => onOpenOther(o)}>
                  <TableCell>{dt(o.criado_em)}</TableCell>
                  <TableCell>{ORIGEM[o.origem] ?? o.origem}</TableCell>
                  <TableCell><VereditoBadge v={o.veredito} /></TableCell>
                  <TableCell>{fmt(o.download_mbps)}</TableCell>
                  <TableCell>{fmt(o.latencia_ms, 0)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>
    </div>
  );
}

function resumoUA(ua?: string | null) {
  if (!ua) return "—";
  const os = /Windows/.test(ua) ? "Windows" : /Android/.test(ua) ? "Android" : /iPhone|iPad/.test(ua) ? "iOS" : /Mac OS/.test(ua) ? "macOS" : /Linux/.test(ua) ? "Linux" : "Outro";
  const br = /Edg\//.test(ua) ? "Edge" : /OPR\//.test(ua) ? "Opera" : /Chrome\//.test(ua) ? "Chrome" : /Firefox\//.test(ua) ? "Firefox" : /Safari\//.test(ua) ? "Safari" : "Navegador";
  return `${br} em ${os}`;
}

// ---------- Página ----------
export default function DiagnosticosPage() {
  const [rows, setRows] = useState<Diag[]>([]);
  const [clientes, setClientes] = useState<Record<string, Cli>>({});
  const [loading, setLoading] = useState(true);
  const [dias, setDias] = useState("30");
  const [fStatus, setFStatus] = useState("all");
  const [fVeredito, setFVeredito] = useState("all");
  const [fOrigem, setFOrigem] = useState("all");
  const [busca, setBusca] = useState("");
  const [sel, setSel] = useState<Diag | null>(null);
  const clientesRef = useRef(clientes);
  clientesRef.current = clientes;

  const carregarClientes = useCallback(async (ids: string[]) => {
    const faltam = ids.filter((id) => !clientesRef.current[id]);
    if (!faltam.length) return;
    const { data } = await supabase.from("customers").select("id, nome, plan_id, plans(nome, nome_servidor)").in("id", faltam);
    setClientes((prev) => {
      const n = { ...prev };
      (data as any[] | null)?.forEach((c) => (n[c.id] = c));
      return n;
    });
    return data as Cli[] | null;
  }, []);

  const carregar = useCallback(async () => {
    setLoading(true);
    let q = supabase.from("diagnosticos").select("*").order("criado_em", { ascending: false }).limit(500);
    if (dias !== "all") q = q.gte("criado_em", new Date(Date.now() - Number(dias) * 86400000).toISOString());
    const { data, error } = await q;
    if (error) toast.error("Erro ao carregar diagnósticos");
    const list = (data as Diag[]) ?? [];
    setRows(list);
    await carregarClientes([...new Set(list.map((r) => r.cliente_id))]);
    setLoading(false);
  }, [dias, carregarClientes]);

  useEffect(() => { carregar(); }, [carregar]);

  useEffect(() => {
    const ch = supabase
      .channel("diagnosticos-painel")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "diagnosticos" }, async (p) => {
        const d = p.new as Diag;
        setRows((prev) => (prev.some((r) => r.id === d.id) ? prev : [d, ...prev]));
        const novos = await carregarClientes([d.cliente_id]);
        const nome = clientesRef.current[d.cliente_id]?.nome ?? novos?.[0]?.nome ?? "cliente";
        toast.info(`Novo diagnóstico de ${nome}`);
      })
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "diagnosticos" }, (p) => {
        const d = p.new as Diag;
        setRows((prev) => prev.map((r) => (r.id === d.id ? d : r)));
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [carregarClientes]);

  const filtrados = useMemo(() => {
    const b = busca.trim().toLowerCase();
    return rows.filter(
      (r) =>
        (fStatus === "all" || r.status === fStatus) &&
        (fVeredito === "all" || r.veredito === fVeredito) &&
        (fOrigem === "all" || r.origem === fOrigem) &&
        (!b || (clientes[r.cliente_id]?.nome ?? "").toLowerCase().includes(b)),
    );
  }, [rows, fStatus, fVeredito, fOrigem, busca, clientes]);

  const novos = rows.filter((r) => r.status === "novo").length;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Diagnósticos</h2>
          <p className="text-muted-foreground">Testes de conexão enviados pelos clientes</p>
        </div>
        <Card>
          <CardContent className="flex items-center gap-3 px-4 py-3">
            <span className="text-2xl font-bold text-primary">{novos}</span>
            <span className="text-sm text-muted-foreground">{novos === 1 ? "novo diagnóstico" : "novos diagnósticos"}</span>
          </CardContent>
        </Card>
      </div>

      <div className="flex flex-wrap gap-2">
        <div className="relative min-w-[200px] flex-1">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Buscar cliente..." value={busca} onChange={(e) => setBusca(e.target.value)} className="pl-8" />
        </div>
        <Select value={dias} onValueChange={setDias}>
          <SelectTrigger className="w-[150px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="1">Últimas 24h</SelectItem>
            <SelectItem value="7">Últimos 7 dias</SelectItem>
            <SelectItem value="30">Últimos 30 dias</SelectItem>
            <SelectItem value="90">Últimos 90 dias</SelectItem>
            <SelectItem value="all">Todo o período</SelectItem>
          </SelectContent>
        </Select>
        <Select value={fStatus} onValueChange={setFStatus}>
          <SelectTrigger className="w-[140px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos status</SelectItem>
            {Object.entries(STATUS).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={fVeredito} onValueChange={setFVeredito}>
          <SelectTrigger className="w-[150px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos vereditos</SelectItem>
            {Object.entries(VEREDITO).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={fOrigem} onValueChange={setFOrigem}>
          <SelectTrigger className="w-[140px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todas origens</SelectItem>
            {Object.entries(ORIGEM).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Data/hora</TableHead>
                <TableHead>Cliente</TableHead>
                <TableHead>Origem</TableHead>
                <TableHead>Veredito</TableHead>
                <TableHead className="text-right">Download</TableHead>
                <TableHead className="text-right">Upload</TableHead>
                <TableHead className="text-right">Latência</TableHead>
                <TableHead>Na rede?</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow><TableCell colSpan={9} className="py-8 text-center"><Loader2 className="mx-auto h-5 w-5 animate-spin" /></TableCell></TableRow>
              ) : filtrados.length === 0 ? (
                <TableRow><TableCell colSpan={9} className="py-8 text-center text-muted-foreground">Nenhum diagnóstico encontrado</TableCell></TableRow>
              ) : (
                filtrados.map((r) => (
                  <TableRow key={r.id} className="cursor-pointer" onClick={() => setSel(r)}>
                    <TableCell className="whitespace-nowrap">{dt(r.criado_em)}</TableCell>
                    <TableCell>
                      <Link to={`/clientes?cliente=${r.cliente_id}`} onClick={(e) => e.stopPropagation()} className="text-primary hover:underline">
                        {clientes[r.cliente_id]?.nome ?? "—"}
                      </Link>
                    </TableCell>
                    <TableCell>{ORIGEM[r.origem] ?? r.origem}</TableCell>
                    <TableCell><VereditoBadge v={r.veredito} /></TableCell>
                    <TableCell className="text-right">{r.download_mbps != null ? `${fmt(r.download_mbps)} Mbps` : "—"}</TableCell>
                    <TableCell className="text-right">{r.upload_mbps != null ? `${fmt(r.upload_mbps)} Mbps` : "—"}</TableCell>
                    <TableCell className="text-right">{r.latencia_ms != null ? `${fmt(r.latencia_ms, 0)} ms` : "—"}</TableCell>
                    <TableCell>{r.na_rede_provedor == null ? "—" : r.na_rede_provedor ? "Sim" : "Não"}</TableCell>
                    <TableCell><StatusBadge s={r.status} /></TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Sheet open={!!sel} onOpenChange={(o) => !o && setSel(null)}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-2xl">
          <SheetHeader><SheetTitle>Diagnóstico</SheetTitle></SheetHeader>
          {sel && (
            <div className="mt-4">
              <Detalhe
                d={sel}
                cliente={clientes[sel.cliente_id]}
                onSaved={(x) => { setSel(x); setRows((p) => p.map((r) => (r.id === x.id ? x : r))); }}
                onOpenOther={setSel}
              />
            </div>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
