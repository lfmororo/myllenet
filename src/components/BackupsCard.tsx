// Configurações → Backups: conexão com o Google Drive, backup manual e histórico.
// O backup roda na vpsfaedi (backup-diario.sh); o painel só pede, acompanha e conecta o Drive.
import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api } from "@/integrations/api/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { CheckCircle, Copy, Database, ExternalLink, Loader2, PlayCircle, Unplug, XCircle } from "lucide-react";
import { toast } from "sonner";

type Status = {
  credenciais: boolean;
  client_id: string | null;
  conectado: boolean;
  email: string | null;
  pasta: string | null;
  pasta_url: string | null;
  conectado_em: string | null;
  redirect_uri: string;
  origem_js: string;
};
type Execucao = {
  id: number;
  criado_em: string;
  status: string;
  arquivo: string | null;
  tamanho_bytes: number | null;
  remoto: string | null;
  erro: string | null;
  origem: string | null;
};
type Pedido = { id: number; status: string; criado_em: string };

const tamanho = (b: number | null) => {
  if (!b) return "—";
  const u = ["B", "KB", "MB", "GB"];
  let i = 0;
  let v = b;
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(i ? 1 : 0)} ${u[i]}`;
};
const dataHora = (s: string) => new Date(s).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });

function Copiavel({ valor }: { valor: string }) {
  return (
    <div className="flex items-center gap-2">
      <code className="flex-1 truncate rounded bg-muted px-2 py-1 text-xs">{valor}</code>
      <Button
        size="icon"
        variant="ghost"
        className="h-7 w-7"
        onClick={() => { navigator.clipboard.writeText(valor); toast.success("Copiado"); }}
      >
        <Copy className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}

export default function BackupsCard() {
  const [params, setParams] = useSearchParams();
  const [status, setStatus] = useState<Status | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [conectando, setConectando] = useState(false);
  const [execucoes, setExecucoes] = useState<Execucao[]>([]);
  const [pedido, setPedido] = useState<Pedido | null>(null);
  const timer = useRef<number | null>(null);

  const carregarStatus = async () => {
    const { data, error } = await api.functions.invoke("google-drive/status", { method: "GET" });
    if (error) toast.error("Não foi possível ler a conexão do Google Drive: " + error.message);
    else {
      setStatus(data as Status);
      if ((data as Status).client_id) setClientId((data as Status).client_id || "");
    }
    setCarregando(false);
  };
  const carregarHistorico = async () => {
    const { data } = await api
      .from("backup_execucoes")
      .select("id, criado_em, status, arquivo, tamanho_bytes, remoto, erro, origem")
      .order("criado_em", { ascending: false })
      .limit(15);
    setExecucoes((data as Execucao[]) || []);
    const { data: p } = await api
      .from("backup_pedidos")
      .select("id, status, criado_em")
      .order("criado_em", { ascending: false })
      .limit(1);
    const ultimo = (p as Pedido[] | null)?.[0] || null;
    setPedido(ultimo && ["pendente", "rodando"].includes(ultimo.status) ? ultimo : null);
    return ultimo;
  };

  useEffect(() => {
    carregarStatus();
    carregarHistorico();
    const drive = params.get("drive");
    if (drive) {
      const msg = params.get("msg") || "";
      if (drive === "ok") toast.success(msg || "Google Drive conectado");
      else toast.error(msg || "Não foi possível conectar o Google Drive");
      params.delete("drive");
      params.delete("msg");
      setParams(params, { replace: true });
    }
    return () => { if (timer.current) window.clearInterval(timer.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // acompanha o backup manual até terminar
  useEffect(() => {
    if (!pedido) return;
    timer.current = window.setInterval(async () => {
      const ultimo = await carregarHistorico();
      if (ultimo && !["pendente", "rodando"].includes(ultimo.status)) {
        if (timer.current) window.clearInterval(timer.current);
        if (ultimo.status === "concluido") toast.success("Backup concluído");
        else toast.error("O backup falhou. Os administradores foram avisados no WhatsApp.");
      }
    }, 5000);
    return () => { if (timer.current) window.clearInterval(timer.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pedido?.id]);

  const salvarCredenciais = async () => {
    setSalvando(true);
    const { data, error } = await api.functions.invoke("google-drive/credenciais", {
      body: { client_id: clientId, client_secret: clientSecret },
    });
    setSalvando(false);
    if (error) return toast.error(error.message);
    setClientSecret("");
    toast.success((data as any)?.reconectar ? "Credenciais trocadas. Conecte o Google Drive de novo." : "Credenciais salvas");
    carregarStatus();
  };

  const conectar = async () => {
    setConectando(true);
    const { data, error } = await api.functions.invoke("google-drive/conectar", { body: {} });
    if (error || !(data as any)?.url) {
      setConectando(false);
      return toast.error(error?.message || "Não foi possível iniciar a conexão");
    }
    window.location.href = (data as any).url;
  };

  const desconectar = async () => {
    if (!window.confirm("Desconectar o Google Drive? Os backups voltam a ficar só no servidor.")) return;
    const { error } = await api.functions.invoke("google-drive/desconectar", { body: {} });
    if (error) return toast.error(error.message);
    toast.success("Google Drive desconectado");
    carregarStatus();
  };

  const backupAgora = async () => {
    const { data, error } = await api.from("backup_pedidos").insert({}).select("id, status, criado_em").single();
    if (error) return toast.error("Não foi possível pedir o backup: " + error.message);
    setPedido(data as Pedido);
    toast.info("Backup pedido. Ele começa em até 1 minuto.");
  };

  if (carregando) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Carregando…
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            Google Drive
            {status?.conectado ? (
              <Badge className="bg-success/15 text-success hover:bg-success/15"><CheckCircle className="mr-1 h-3 w-3" />Conectado</Badge>
            ) : (
              <Badge variant="secondary"><XCircle className="mr-1 h-3 w-3" />Não conectado</Badge>
            )}
          </CardTitle>
          <CardDescription>
            Cópia dos backups diários (criptografados) numa pasta do seu Google Drive.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {status?.conectado ? (
            <div className="space-y-3">
              <p className="text-sm">
                Conta: <strong>{status.email || "—"}</strong>
                {status.conectado_em && <> · desde {dataHora(status.conectado_em)}</>}
              </p>
              <div className="flex flex-wrap gap-2">
                {status.pasta_url && (
                  <Button variant="outline" asChild>
                    <a href={status.pasta_url} target="_blank" rel="noreferrer">
                      <ExternalLink className="mr-2 h-4 w-4" />Abrir pasta "{status.pasta}"
                    </a>
                  </Button>
                )}
                <Button variant="outline" onClick={desconectar}>
                  <Unplug className="mr-2 h-4 w-4" />Desconectar
                </Button>
              </div>
            </div>
          ) : (
            <>
              <div className="rounded-md border bg-muted/40 p-3 text-sm space-y-2">
                <p className="font-medium">Antes de conectar (uma vez só), no Google Cloud Console:</p>
                <ol className="list-decimal space-y-1 pl-5 text-muted-foreground">
                  <li>
                    Crie um projeto em{" "}
                    <a className="text-primary underline" href="https://console.cloud.google.com/projectcreate" target="_blank" rel="noreferrer">console.cloud.google.com</a>{" "}
                    e ative a <strong>Google Drive API</strong>.
                  </li>
                  <li>Em <strong>Google Auth Platform</strong>: público <strong>Externo</strong>, e depois <strong>Publicar app</strong> (em teste, a conexão expira em 7 dias).</li>
                  <li>Em <strong>Clientes</strong> → Criar cliente → <strong>Aplicativo da Web</strong>, com estes endereços:</li>
                </ol>
                <div className="space-y-1 pl-5">
                  <Label className="text-xs">Origem JavaScript autorizada</Label>
                  <Copiavel valor={status?.origem_js || ""} />
                  <Label className="text-xs">URI de redirecionamento autorizado</Label>
                  <Copiavel valor={status?.redirect_uri || ""} />
                </div>
                <p className="text-muted-foreground">Copie o Client ID e o Client secret gerados para os campos abaixo.</p>
              </div>

              <div className="grid gap-3">
                <div className="space-y-1">
                  <Label htmlFor="gd_client_id">Client ID</Label>
                  <Input id="gd_client_id" value={clientId} onChange={(e) => setClientId(e.target.value)} placeholder="…apps.googleusercontent.com" />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="gd_client_secret">Client secret</Label>
                  <Input
                    id="gd_client_secret"
                    type="password"
                    value={clientSecret}
                    onChange={(e) => setClientSecret(e.target.value)}
                    placeholder={status?.credenciais ? "••• salvo (preencha só para trocar)" : "GOCSPX-…"}
                  />
                </div>
              </div>

              <div className="flex flex-wrap gap-2">
                <Button variant="outline" onClick={salvarCredenciais} disabled={salvando || !clientId || !clientSecret}>
                  {salvando && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Salvar credenciais
                </Button>
                <Button onClick={conectar} disabled={!status?.credenciais || conectando}>
                  {conectando && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Conectar Google Drive
                </Button>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
          <div>
            <CardTitle className="flex items-center gap-2"><Database className="h-5 w-5" />Backups</CardTitle>
            <CardDescription>
              Automático todo dia às 03:00. Guarda 7 diários, 4 semanais e 3 mensais. Se falhar, os administradores recebem aviso no WhatsApp.
            </CardDescription>
          </div>
          <Button onClick={backupAgora} disabled={!!pedido}>
            {pedido ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <PlayCircle className="mr-2 h-4 w-4" />}
            {pedido ? (pedido.status === "rodando" ? "Fazendo backup…" : "Aguardando…") : "Fazer backup agora"}
          </Button>
        </CardHeader>
        <CardContent>
          {execucoes.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhum backup registrado ainda.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Data</TableHead>
                  <TableHead>Situação</TableHead>
                  <TableHead>Tamanho</TableHead>
                  <TableHead>Cópia externa</TableHead>
                  <TableHead>Origem</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {execucoes.map((e) => (
                  <TableRow key={e.id}>
                    <TableCell className="whitespace-nowrap">{dataHora(e.criado_em)}</TableCell>
                    <TableCell>
                      {e.status === "ok" ? (
                        <Badge className="bg-success/15 text-success hover:bg-success/15">ok</Badge>
                      ) : (
                        <Badge variant="destructive" title={e.erro || ""}>falhou</Badge>
                      )}
                      {e.status !== "ok" && e.erro && <p className="mt-1 text-xs text-muted-foreground">{e.erro}</p>}
                    </TableCell>
                    <TableCell>{tamanho(e.tamanho_bytes)}</TableCell>
                    <TableCell>{e.remoto || <span className="text-muted-foreground">só no servidor</span>}</TableCell>
                    <TableCell className="capitalize">{e.origem || "agendado"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
