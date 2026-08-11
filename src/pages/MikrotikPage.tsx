import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Download, Loader2, RefreshCw, Router, Wifi, WifiOff, FileCode, BookOpen, Activity, History, ArrowUpCircle, ArrowDownCircle, Info, Calendar, Clock, Network } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useCustomers } from "@/hooks/useCustomers";
import { usePlans } from "@/hooks/usePlans";
import { useMikrotikLogs } from "@/hooks/useMikrotikLogs";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from "recharts";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";

export default function MikrotikPage() {
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [status, setStatus] = useState<any>(null);
  const [selectedEvent, setSelectedEvent] = useState<any>(null);
  const { customers } = useCustomers();
  const { plans } = usePlans();
  const { wanLogs, wanHistory, loading: loadingWan } = useMikrotikLogs();
  const [syncing, setSyncing] = useState(false);
  const [live, setLive] = useState(true);

  const checkStatus = async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("mikrotik-status");
      if (error) throw error;
      setStatus(data);
      if (!silent) {
        if (data?.online) toast.success(data.message || "Mikrotik online");
        else toast.error(data?.message || "Mikrotik offline");
      }
    } catch (err: any) {
      setStatus({ online: false, message: err?.message || "Erro ao verificar Mikrotik" });
      if (!silent) toast.error("Erro ao verificar Mikrotik");
    } finally {
      if (!silent) setLoading(false);
    }
  };

  const syncWithMikrotik = async () => {
    setSyncing(true);
    try {
      const { data, error } = await supabase.functions.invoke("mikrotik-sync");
      if (error) throw error;
      toast.success("Sincronização com Mikrotik concluída com sucesso!");
    } catch (err: any) {
      console.error("Erro na sincronização:", err);
      toast.error("Erro ao sincronizar com Mikrotik");
    } finally {
      setSyncing(false);
    }
  };

  useEffect(() => {
    checkStatus();
  }, []);

  // Amostragem em tempo real: cada chamada coleta os contadores das WANs e grava em wan_logs
  useEffect(() => {
    if (!live) return;
    const id = setInterval(() => checkStatus(true), 10000);
    return () => clearInterval(id);
  }, [live]);


  const downloadMikrotikScript = () => {
    setExporting(true);
    try {
      if (customers.length === 0) {
        toast.error("Nenhum cliente para exportar");
        return;
      }
      let script = "# Mikrotik Import Script - Myllenet\n";
      script += "# Generated on: " + new Date().toLocaleString() + "\n\n";
      script += "/ip pool\n:if ([:len [/ip pool find name=pppoe-pool]] = 0) do={ add name=pppoe-pool ranges=10.0.0.10-10.0.3.254 }\n\n";
      script += "/ip dns\nset servers=8.8.8.8,8.8.4.4 allow-remote-requests=yes\n\n";
      script += "/ppp profile\n:if ([:len [/ppp profile find name=myllenet-default]] = 0) do={ add name=myllenet-default local-address=10.0.0.1 remote-address=pppoe-pool dns-server=8.8.8.8,8.8.4.4 }\n\n";
      script += "/interface pppoe-server server\n:if ([:len [/interface pppoe-server server find service-name=pppoe-myllenet]] = 0) do={ add authentication=pap,chap,mschap1,mschap2 disabled=no interface=ether2 service-name=pppoe-myllenet one-session-per-host=yes }\n\n";
      plans.forEach(plan => {
        const speed = plan.nome.match(/\d+/)?.[0] || "10";
        script += `:if ([:len [/ppp profile find name="${plan.nome}"]] = 0) do={ add name="${plan.nome}" local-address=10.0.0.1 remote-address=pppoe-pool rate-limit="${speed}M/${speed}M" dns-server=8.8.8.8,8.8.4.4 }\n`;
      });
      script += "\n/ppp secret\n";
      customers.forEach(customer => {
        if (customer.ativo && customer.usuario_pppoe) {
          const planName = plans.find(p => p.id === customer.plan_id)?.nome || "myllenet-default";
          script += `:if ([:len [/ppp secret find name="${customer.usuario_pppoe}"]] = 0) do={ add name="${customer.usuario_pppoe}" password="${customer.senha_pppoe}" profile="${planName}" service=pppoe comment="${customer.nome} - CPF: ${customer.cpf}" }\n`;
        }
      });
      const blob = new Blob([script], { type: "text/plain" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `importar_mikrotik_${new Date().toISOString().slice(0, 10)}.rsc`;
      link.click();
      URL.revokeObjectURL(url);
      toast.success("Script Mikrotik (.rsc) gerado!");
    } catch (err) {
      toast.error("Erro ao gerar script");
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Mikrotik - Gestão</h2>
          <p className="text-muted-foreground">Configure alertas automáticos quando uma WAN cair ou recuperar, com notificação e registro do motivo no histórico.</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={downloadMikrotikScript} disabled={exporting}>
            {exporting ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Download className="h-4 w-4 mr-2" />}
            Baixar Script (.rsc)
          </Button>
          <Button variant="secondary" onClick={syncWithMikrotik} disabled={syncing || loading}>
            {syncing ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <RefreshCw className="h-4 w-4 mr-2" />}
            Sincronizar Mikrotik
          </Button>
          <Button variant={live ? "default" : "outline"} onClick={() => setLive(!live)}>
            <Activity className={`h-4 w-4 mr-2 ${live ? "animate-pulse" : ""}`} />
            {live ? "Tempo real: ON" : "Tempo real: OFF"}
          </Button>
          <Button onClick={() => checkStatus()} disabled={loading || syncing}>

            {loading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Router className="h-4 w-4 mr-2" />}
            Verificar Status
          </Button>
        </div>
      </div>

      <div className="grid gap-6 md:grid-cols-4">
        <Card className={`border-l-4 ${status?.online ? "border-l-success" : "border-l-destructive"}`}>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Status do IP Externo</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-2">
              <span className={`text-2xl font-bold ${status?.online ? "text-success" : "text-destructive"}`}>
                {loading ? "Verificando..." : status?.online ? "Conectado" : "Desconectado"}
              </span>
            </div>
            <p className="text-xs text-muted-foreground mt-2">{status?.message}</p>
          </CardContent>
        </Card>
        <Card className="border-l-4 border-l-primary">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Roteador</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-2">
              <Router className="h-5 w-5 text-primary" />
              <span className="text-lg font-bold">{status?.identity || status?.host || "—"}</span>
            </div>
          </CardContent>
        </Card>
        <Card className="border-l-4 border-l-accent">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Usuários PPPoE</CardTitle>
          </CardHeader>
          <CardContent>
            <Badge variant="outline">
              {(status?.activeUsers ?? "—")} online / {customers.filter(c => c.ativo).length} cadastrados
            </Badge>
          </CardContent>
        </Card>
        <Card className="border-l-4 border-l-warning">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">WANs Ativas</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-2">
              <Activity className="h-5 w-5 text-warning" />
              <span className="text-2xl font-bold">
                {loading ? "..." : `${(status?.wans ?? []).filter((w: any) => w.running).length}/${(status?.wans ?? []).length || 0}`}
              </span>
            </div>
            <div className="mt-2 space-y-1">
              {(status?.wans ?? []).map((w: any) => (
                <div key={w.name} className="flex items-center justify-between text-xs">
                  <span className="flex items-center gap-1">
                    {w.running ? <Wifi className="h-3 w-3 text-success" /> : <WifiOff className="h-3 w-3 text-destructive" />}
                    {w.name}
                  </span>
                  <span className="flex items-center gap-2 text-muted-foreground">
                    <span className="flex items-center gap-0.5 text-primary">
                      <ArrowDownCircle className="h-3 w-3" />
                      {((w.rx_bps ?? 0) / 1_000_000).toFixed(1)}
                    </span>
                    <span className="flex items-center gap-0.5 text-accent">
                      <ArrowUpCircle className="h-3 w-3" />
                      {((w.tx_bps ?? 0) / 1_000_000).toFixed(1)}
                    </span>
                    <span>Mbps</span>
                  </span>
                </div>
              ))}
              {(!status?.wans || status.wans.length === 0) && (
                <p className="text-xs text-muted-foreground">Nenhuma interface WAN detectada</p>
              )}
            </div>

          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-2">
          <div>
            <CardTitle className="text-base">Monitoramento de Tráfego WAN</CardTitle>
            <CardDescription>
              Linha cheia = Download (↓) · linha tracejada = Upload (↑) · valores em Mb/s — {live ? "atualizando a cada 10s" : "atualização pausada"}
            </CardDescription>


          </div>
          <Activity className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          {loadingWan ? (
            <div className="flex h-[300px] items-center justify-center">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : wanLogs.length > 0 ? (
            <ResponsiveContainer width="100%" height={320}>
              <LineChart data={wanLogs} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" vertical={false} />
                <XAxis dataKey="time" className="text-xs" />
                <YAxis
                  className="text-xs"
                  width={64}
                  tickFormatter={(v) => (v >= 1 ? `${v.toFixed(1)} Mb/s` : `${(v * 1000).toFixed(0)} Kb/s`)}
                />
                <Tooltip
                  contentStyle={{
                    background: "hsl(var(--popover))",
                    border: "1px solid hsl(var(--border))",
                    borderRadius: "0.5rem",
                    fontSize: "0.75rem",
                  }}
                  labelFormatter={(l) => `Horário: ${l}`}
                  formatter={(v: any, name: any) => {
                    const num = Number(v);
                    const label = String(name).endsWith("↑") ? "Upload" : "Download";
                    const iface = String(name).replace(/ [↑↓]$/, "");
                    const value = num >= 1 ? `${num.toFixed(2)} Mb/s` : `${(num * 1000).toFixed(0)} Kb/s`;
                    return [value, `${iface} · ${label}`];
                  }}
                />
                <Legend
                  verticalAlign="bottom"
                  height={44}
                  content={({ payload }) => (
                    <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 pt-3 text-xs">
                      {(payload || []).map((entry: any) => {
                        const isUpload = String(entry.value).endsWith("↑");
                        const iface = String(entry.value).replace(/ [↑↓]$/, "");
                        const last = Number(wanLogs[wanLogs.length - 1]?.[entry.value] ?? 0);
                        return (
                          <span key={entry.value} className="flex items-center gap-1.5 text-muted-foreground">
                            <svg width="18" height="8" aria-hidden="true">
                              <line
                                x1="0"
                                y1="4"
                                x2="18"
                                y2="4"
                                stroke={entry.color}
                                strokeWidth="2.5"
                                strokeDasharray={isUpload ? "4 3" : undefined}
                              />
                            </svg>
                            <span className="font-medium text-foreground">{iface}</span>
                            <span>{isUpload ? "Upload ↑" : "Download ↓"}</span>
                            <span className="tabular-nums">
                              {last >= 1 ? `${last.toFixed(2)} Mb/s` : `${(last * 1000).toFixed(0)} Kb/s`}
                            </span>
                          </span>
                        );
                      })}
                    </div>
                  )}
                />
                {Object.keys(wanLogs[wanLogs.length - 1] || {}).filter(k => k !== 'time').map((key, index) => {
                  const isUpload = key.endsWith('↑');
                  const palette = ["hsl(var(--primary))", "hsl(var(--warning))", "hsl(var(--success))", "hsl(var(--destructive))"];
                  const color = isUpload ? "hsl(var(--accent))" : palette[Math.floor(index / 2) % palette.length];
                  return (
                    <Line
                      key={key}
                      type="monotone"
                      dataKey={key}
                      name={key}
                      stroke={color}
                      strokeWidth={2}
                      strokeDasharray={isUpload ? "4 3" : undefined}
                      dot={false}
                      activeDot={{ r: 3 }}
                    />
                  );
                })}
              </LineChart>
            </ResponsiveContainer>

          ) : (

            <p className="text-center py-12 text-muted-foreground">Nenhum dado de WAN encontrado.</p>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base font-semibold flex items-center gap-2">
              <History className="h-4 w-4 text-primary" />
              Histórico de Oscilações WAN
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4 max-h-[400px] overflow-y-auto">
              {wanHistory.length > 0 ? wanHistory.map((e, i) => (
                <Dialog key={i}>
                  <DialogTrigger asChild>
                    <div 
                      className="flex items-start gap-3 p-3 rounded-lg border bg-muted/30 cursor-pointer hover:bg-muted/50 transition-colors"
                      onClick={() => setSelectedEvent(e)}
                    >
                      {e.status === 'up' ? <ArrowUpCircle className="h-5 w-5 text-success" /> : <ArrowDownCircle className="h-5 w-5 text-destructive" />}
                      <div className="flex-1">
                        <p className="text-sm font-medium">{e.interface_name}</p>
                        <p className="text-xs text-muted-foreground">{e.status === 'up' ? "ONLINE" : "OFFLINE"} - {format(new Date(e.created_at), "dd/MM HH:mm:ss", { locale: ptBR })}</p>
                      </div>
                      <Info className="h-4 w-4 text-muted-foreground mt-1" />
                    </div>
                  </DialogTrigger>
                  <DialogContent>
                    <DialogHeader>
                      <DialogTitle className="flex items-center gap-2">
                        {e.status === 'up' ? <ArrowUpCircle className="h-5 w-5 text-success" /> : <ArrowDownCircle className="h-5 w-5 text-destructive" />}
                        Detalhes da Oscilação
                      </DialogTitle>
                      <DialogDescription>
                        Informações técnicas sobre o evento na interface {e.interface_name}
                      </DialogDescription>
                    </DialogHeader>
                    <div className="grid gap-4 py-4">
                      <div className="grid grid-cols-4 items-center gap-4 border-b pb-2">
                        <span className="text-sm font-medium flex items-center gap-2 col-span-1">
                          <Network className="h-4 w-4 text-muted-foreground" /> Interface:
                        </span>
                        <span className="text-sm col-span-3">{e.interface_name}</span>
                      </div>
                      <div className="grid grid-cols-4 items-center gap-4 border-b pb-2">
                        <span className="text-sm font-medium flex items-center gap-2 col-span-1">
                          <Activity className="h-4 w-4 text-muted-foreground" /> Status:
                        </span>
                        <Badge variant="outline" className={`w-fit col-span-3 ${e.status === 'up' ? "bg-success text-success-foreground border-transparent" : "bg-destructive text-destructive-foreground border-transparent"}`}>
                          {e.status === 'up' ? "ONLINE / UP" : "OFFLINE / DOWN"}
                        </Badge>
                      </div>
                      <div className="grid grid-cols-4 items-center gap-4 border-b pb-2">
                        <span className="text-sm font-medium flex items-center gap-2 col-span-1">
                          <Calendar className="h-4 w-4 text-muted-foreground" /> Data:
                        </span>
                        <span className="text-sm col-span-3">
                          {format(new Date(e.created_at), "dd 'de' MMMM 'de' yyyy", { locale: ptBR })}
                        </span>
                      </div>
                      <div className="grid grid-cols-4 items-center gap-4 border-b pb-2">
                        <span className="text-sm font-medium flex items-center gap-2 col-span-1">
                          <Clock className="h-4 w-4 text-muted-foreground" /> Horário:
                        </span>
                        <span className="text-sm col-span-3">
                          {format(new Date(e.created_at), "HH:mm:ss", { locale: ptBR })}
                        </span>
                      </div>
                      <div className="space-y-2">
                        <span className="text-sm font-medium flex items-center gap-2">
                          <Info className="h-4 w-4 text-muted-foreground" /> Motivo / Contexto:
                        </span>
                        <div className="text-sm bg-muted p-3 rounded-md italic">
                          {e.reason || (e.status === 'up' ? "Interface estabelecida e trafegando dados." : "Queda de link detectada ou interface desativada no roteador.")}
                        </div>
                      </div>
                      {status?.host && (
                        <div className="grid grid-cols-4 items-center gap-4 border-t pt-2 mt-2">
                          <span className="text-sm font-medium flex items-center gap-2 col-span-1">
                            <Router className="h-4 w-4 text-muted-foreground" /> Roteador:
                          </span>
                          <span className="text-xs text-muted-foreground col-span-3">{status.host}:{status.restPort || '80'}</span>
                        </div>
                      )}
                    </div>
                  </DialogContent>
                </Dialog>
              )) : <p className="text-sm text-center italic py-4">Nenhum evento registrado.</p>}
            </div>
          </CardContent>
        </Card>

        <Card className="p-8 space-y-4">
          <div className="flex items-center gap-3">
            <div className="bg-primary/10 p-3 rounded-lg">
              <FileCode className="h-6 w-6 text-primary" />
            </div>
            <div>
              <h3 className="text-lg font-semibold">Script de Importação</h3>
            </div>
          </div>
          <Button className="w-full" onClick={downloadMikrotikScript} disabled={exporting}>
            {exporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4 mr-2" />}
            Baixar Script (.rsc)
          </Button>
        </Card>
      </div>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <BookOpen className="h-5 w-5 text-primary" />
            Otimização da Integração com Mikrotik
          </CardTitle>
          <CardDescription>NAO ESTA CONSEGUINDO MONITORAR AS WANS no mikrotik</CardDescription>
        </CardHeader>
        <CardContent className="prose prose-sm dark:prose-invert max-w-none">
          <div className="space-y-4 text-sm leading-relaxed">
            <h4 className="text-base font-semibold border-b pb-1">Funcionalidade Solicitada</h4>
            <p>a comunicacao com o mikrotik esta muito falha</p>
            <ul className="list-disc pl-5 space-y-1">
              <li><strong>Monitoramento de WANs:</strong> Implementar um monitoramento confiável e em tempo real do status das conexões WAN.</li>
              <li><strong>Carregamento de Informações:</strong> Reduzir significativamente o tempo de carregamento de informações provenientes dos dispositivos Mikrotik.</li>
            </ul>

            <h4 className="text-base font-semibold border-b pb-1">Requisitos Técnicos</h4>
            <ul className="list-disc pl-5 space-y-1">
              <li>Analisar a comunicação atual entre o sistema e os dispositivos Mikrotik (protocolos, métodos de consulta).</li>
              <li>Identificar gargalos e pontos de falha no processo de monitoramento de WANs.</li>
              <li>Otimizar as consultas e o processamento de dados para agilizar o carregamento de informações.</li>
              <li>Garantir a robustez da integração para evitar falhas recorrentes.</li>
            </ul>

            <h4 className="text-base font-semibold border-b pb-1">Passos Necessários</h4>
            <ol className="list-decimal pl-5 space-y-2">
              <li><strong>Diagnóstico:</strong> Investigar a fundo as causas das falhas atuais no monitoramento de WANs e no carregamento de informações.</li>
              <li><strong>Refatoração da Integração:</strong> Reescrever ou otimizar o código responsável pela comunicação com o Mikrotik.</li>
              <li><strong>Implementação do Monitoramento de WANs:</strong> Desenvolver ou aprimorar o módulo de monitoramento, possivelmente utilizando SNMP, API ou outros métodos adequados.</li>
              <li><strong>Otimização de Performance:</strong> Aplicar técnicas de otimização para acelerar o acesso e a exibição dos dados.</li>
              <li><strong>Testes:</strong> Realizar testes exaustivos para validar a estabilidade, o desempenho e a correção das funcionalidades implementadas.</li>
            </ol>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
