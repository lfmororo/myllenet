import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Download, Loader2, RefreshCw, Router, Wifi, WifiOff, FileCode, BookOpen, Activity, History, ArrowUpCircle, ArrowDownCircle } from "lucide-react";
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
  const [search, setSearch] = useState("");
  const { customers } = useCustomers();
  const { plans } = usePlans();
  const { wanLogs, wanHistory, loading: loadingWan } = useMikrotikLogs();
  const [syncing, setSyncing] = useState(false);



  const checkStatus = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("mikrotik-status");
      if (error) throw error;
      setStatus(data);
      if (data?.online) toast.success(data.message || "Mikrotik online");
      else toast.error(data?.message || "Mikrotik offline");
    } catch (err: any) {
      setStatus({ online: false, message: err?.message || "Erro ao verificar Mikrotik" });
      toast.error("Erro ao verificar Mikrotik");
    } finally {
      setLoading(false);
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const downloadMikrotikScript = () => {
    setExporting(true);
    try {
      if (customers.length === 0) {
        toast.error("Nenhum cliente para exportar");
        return;
      }

      let script = "# Mikrotik Import Script - Myllenet\n";
      script += "# Generated on: " + new Date().toLocaleString() + "\n\n";

      // 0. IP Pool + DNS
      script += "# --- IP Pool para clientes PPPoE ---\n";
      script += "/ip pool\n";
      script += ':if ([:len [/ip pool find name=pppoe-pool]] = 0) do={ add name=pppoe-pool ranges=10.0.0.10-10.0.3.254 }\n\n';

      script += "# --- DNS (cache local) ---\n";
      script += "/ip dns\n";
      script += "set servers=8.8.8.8,8.8.4.4 allow-remote-requests=yes\n\n";

      // 1. PPPoE Server Configuration
      script += "# --- PPPoE Server Configuration ---\n";
      script += "/ppp profile\n";
      script += ":if ([:len [/ppp profile find name=myllenet-default]] = 0) do={ add name=myllenet-default local-address=10.0.0.1 remote-address=pppoe-pool dns-server=8.8.8.8,8.8.4.4 } else={ set [find name=myllenet-default] local-address=10.0.0.1 remote-address=pppoe-pool dns-server=8.8.8.8,8.8.4.4 }\n\n";

      script += "/interface pppoe-server server\n";
      script += ":if ([:len [/interface pppoe-server server find service-name=pppoe-myllenet]] = 0) do={ add authentication=pap,chap,mschap1,mschap2 disabled=no interface=ether2 service-name=pppoe-myllenet one-session-per-host=yes }\n\n";

      // 2. Plans (Queues/Profiles)
      script += "# --- Internet Plans ---\n";
      script += "/ppp profile\n";
      plans.forEach(plan => {
        // Extrai números do nome do plano (ex: "50 Mega" ou "100MB" -> 50 ou 100)
        const matches = plan.nome.match(/\d+/);
        const speed = matches ? matches[0] : "10";
        const limit = `${speed}M/${speed}M`;
        script += `:if ([:len [/ppp profile find name="${plan.nome}"]] = 0) do={ add name="${plan.nome}" local-address=10.0.0.1 remote-address=pppoe-pool rate-limit="${limit}" dns-server=8.8.8.8,8.8.4.4 } else={ set [find name="${plan.nome}"] local-address=10.0.0.1 remote-address=pppoe-pool rate-limit="${limit}" dns-server=8.8.8.8,8.8.4.4 }\n`;
      });
      script += "\n";

      // 2.5 NAT + Firewall (navegação dos clientes)
      script += "# --- NAT (Masquerade) - permite navegacao dos clientes ---\n";
      script += "/ip firewall nat\n";
      script += ':if ([:len [/ip firewall nat find comment="myllenet-masquerade"]] = 0) do={ add chain=srcnat action=masquerade src-address=10.0.0.0/22 out-interface=ether1 comment="myllenet-masquerade" }\n\n';

      script += "# --- Firewall Filter ---\n";
      script += "/ip firewall filter\n";
      script += ':if ([:len [/ip firewall filter find comment="myllenet-established"]] = 0) do={ add chain=forward action=accept connection-state=established,related comment="myllenet-established" }\n';
      script += ':if ([:len [/ip firewall filter find comment="myllenet-clients-out"]] = 0) do={ add chain=forward action=accept src-address=10.0.0.0/22 comment="myllenet-clients-out" }\n';
      script += ':if ([:len [/ip firewall filter find comment="myllenet-clients-dns"]] = 0) do={ add chain=input action=accept protocol=udp dst-port=53 src-address=10.0.0.0/22 comment="myllenet-clients-dns" }\n';
      script += ':if ([:len [/ip firewall filter find comment="myllenet-clients-dns-tcp"]] = 0) do={ add chain=input action=accept protocol=tcp dst-port=53 src-address=10.0.0.0/22 comment="myllenet-clients-dns-tcp" }\n\n';

      script += "# --- MTU / MSS (evita paginas que nao carregam no PPPoE) ---\n";
      script += "/ip firewall mangle\n";
      script += ':if ([:len [/ip firewall mangle find comment="myllenet-mss"]] = 0) do={ add chain=forward action=change-mss new-mss=clamp-to-pmtu passthrough=yes protocol=tcp tcp-flags=syn comment="myllenet-mss" }\n\n';

      // 3. Customers (Secrets)
      script += "# --- PPPoE Users ---\n";
      script += "/ppp secret\n";
      customers.forEach(customer => {
        if (customer.ativo) {
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
      toast.success("Script Mikrotik (.rsc) gerado com sucesso!");
    } catch (err) {
      console.error(err);
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
          <p className="text-muted-foreground">sincronizar clientes do sistema com o mikrotik</p>
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
          <Button onClick={checkStatus} disabled={loading || syncing}>
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
              {loading ? (
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              ) : status?.online ? (
                <Wifi className="h-5 w-5 text-success" />
              ) : (
                <WifiOff className="h-5 w-5 text-destructive" />
              )}
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
            <p className="text-xs text-muted-foreground mt-2">
              {status?.version ? `RouterOS ${status.version}` : "Versão indisponível"}
              {status?.uptime ? ` • Uptime ${status.uptime}` : ""}
            </p>
          </CardContent>
        </Card>
        <Card className="border-l-4 border-l-accent">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Usuários PPPoE</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-2">
              <Badge variant="outline">
                {(status?.activeUsers ?? "—")} online / {customers.filter(c => c.ativo).length} cadastrados
              </Badge>
            </div>
          </CardContent>
        </Card>
        <Card className="border-l-4 border-l-warning">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Situação das WANs</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-2">
              <Activity className="h-5 w-5 text-warning" />
              <span className="text-2xl font-bold">
                {status?.online ? (wanLogs.length > 0 ? "Ativa" : "Offline") : "Offline"}
              </span>
            </div>
            <p className="text-xs text-muted-foreground mt-2">
              {wanLogs.length > 0 ? `${Object.keys(wanLogs[wanLogs.length-1]).filter(k => k !== 'time').length} interfaces monitoradas` : "Sem tráfego detectado"}
            </p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-2">
          <div>
            <CardTitle className="text-base">Monitoramento de Tráfego WAN</CardTitle>
            <CardDescription>Consumo em tempo real (Download + Upload) por interface</CardDescription>
          </div>
          <Activity className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          {loadingWan ? (
            <div className="flex h-[300px] items-center justify-center">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : wanLogs.length > 0 ? (
            <ResponsiveContainer width="100%" height={300}>
              <LineChart data={wanLogs}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" vertical={false} />
                <XAxis dataKey="time" className="text-xs" minTickGap={30} />
                <YAxis className="text-xs" tickFormatter={(v) => `${v.toFixed(1)}M`} />
                <Tooltip
                  formatter={(value: number) => [`${value.toFixed(2)} Mbps`, ""]}
                  contentStyle={{ borderRadius: "8px", border: "1px solid hsl(var(--border))", background: "hsl(var(--card))" }}
                />
                <Legend />
                {Object.keys(wanLogs[0] || {}).filter(k => k !== 'time').map((iface, index) => (
                  <Line
                    key={iface}
                    type="monotone"
                    dataKey={iface}
                    name={iface}
                    stroke={`hsl(var(--primary))`}
                    strokeWidth={2}
                    dot={false}
                    activeDot={{ r: 4 }}
                  />
                ))}
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex h-[300px] items-center justify-center text-muted-foreground">
              Nenhum dado de WAN encontrado. Certifique-se de que o Mikrotik está online e as interfaces WAN possuem "WAN" no nome ou comentário.
            </div>
          )}
        </CardContent>
      </Card>


      <div className="grid gap-6 md:grid-cols-2">
        <Card className="flex flex-col items-center justify-center text-center p-8 space-y-4">
          <div className={`p-4 rounded-full ${status?.online ? "bg-success/10" : "bg-muted"}`}>
            <Router className={`h-12 w-12 ${status?.online ? "text-success" : "text-muted-foreground"}`} />
          </div>
          <div className="max-w-md">
            <h3 className="text-lg font-semibold">
              {status?.online ? "Mikrotik conectado" : "Mikrotik inacessível"}
            </h3>
            <p className="text-sm text-muted-foreground mt-2">
              {status?.online
                ? status?.restApi
                  ? "Comunicação via API REST do RouterOS funcionando normalmente."
                  : "Host alcançável, porém a API REST não respondeu. Habilite o serviço www (RouterOS v7) e confira usuário/senha."
                : "Verifique o IP externo, se a porta está liberada no firewall do roteador e as credenciais salvas em Configurações."}
            </p>
            <div className="flex flex-wrap gap-2 justify-center mt-4 text-xs text-muted-foreground">
              <Badge variant="outline">API {status?.ports?.api ? "OK" : "bloqueada"}</Badge>
              <Badge variant="outline">HTTP {status?.ports?.http ? "OK" : "bloqueada"}</Badge>
              <Badge variant="outline">HTTPS {status?.ports?.https ? "OK" : "bloqueada"}</Badge>
            </div>
            <Button variant="outline" className="mt-6" asChild>
              <a href="/settings">Ir para Configurações</a>
            </Button>
          </div>
        </Card>

        {/* Tutorial API REST */}
        <Card className="p-8 space-y-4">
          <div className="flex items-center gap-3">
            <div className="bg-accent/10 p-3 rounded-lg">
              <BookOpen className="h-6 w-6 text-accent" />
            </div>
            <div>
              <h3 className="text-lg font-semibold">Como ativar a API REST (clientes on-line)</h3>
              <p className="text-sm text-muted-foreground">
                Necessário para exibir os usuários autenticados no PPPoE
              </p>
            </div>
          </div>

          <div className="space-y-3 text-sm">
            <div>
              <p className="font-medium">1. Habilite o serviço www no RouterOS v7 (Terminal)</p>
              <pre className="bg-muted/60 border rounded-md p-3 mt-1 text-xs overflow-x-auto">{`/ip service enable www
/ip service set www port=80
# (opcional, mais seguro)
/ip service enable www-ssl`}</pre>
            </div>
            <div>
              <p className="font-medium">2. Libere a porta no firewall (apenas do seu IP se possível)</p>
              <pre className="bg-muted/60 border rounded-md p-3 mt-1 text-xs overflow-x-auto">{`/ip firewall filter
add chain=input protocol=tcp dst-port=80 action=accept comment="API REST Myllenet" place-before=0`}</pre>
            </div>
            <div>
              <p className="font-medium">3. Garanta um usuário com permissão de leitura via web</p>
              <pre className="bg-muted/60 border rounded-md p-3 mt-1 text-xs overflow-x-auto">{`/user set admin group=full
# ou crie um usuário só para o sistema:
/user add name=myllenet password=SUA_SENHA group=full`}</pre>
            </div>
            <div>
              <p className="font-medium">4. Se usa NAT/roteador na frente do Mikrotik</p>
              <p className="text-muted-foreground text-xs mt-1">
                Encaminhe a porta escolhida (ex.: 80 ou 8080) para o IP interno do Mikrotik.
              </p>
            </div>
            <div>
              <p className="font-medium">5. Salve host, usuário, senha e a porta REST em Configurações</p>
              <p className="text-muted-foreground text-xs mt-1">
                Depois clique em "Verificar" nesta página. Testamos automaticamente as portas 80, 443, 8080, 8443, 81 e 4443.
              </p>
            </div>
          </div>

          <div className="bg-muted/50 border rounded-md p-3 text-xs space-y-1">
            <p className="font-medium">Diagnóstico atual</p>
            <p className="text-muted-foreground">Host: {status?.host || "—"}</p>
            <p className="text-muted-foreground">
              Portas abertas: {status?.openPorts?.length ? status.openPorts.join(", ") : "nenhuma detectada"}
            </p>
            <p className="text-muted-foreground">
              API REST: {status?.restApi ? `OK (porta ${status?.restPort})` : "não respondeu"}
              {status?.lastHttpStatus === 401 ? " • usuário/senha rejeitados" : ""}
            </p>
          </div>

          <Button variant="outline" className="w-full" onClick={checkStatus} disabled={loading}>
            {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
            Verificar novamente
          </Button>
        </Card>




      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <div>
              <CardTitle className="text-base font-semibold flex items-center gap-2">
                <History className="h-4 w-4 text-primary" />
                Histórico de Oscilações WAN
              </CardTitle>
              <CardDescription>Eventos de queda e reestabelecimento</CardDescription>
            </div>
          </CardHeader>
          <CardContent>
            <div className="space-y-4 max-h-[400px] overflow-y-auto pr-2">
              {wanHistory.length > 0 ? (
                wanHistory.map((event, i) => (
                  <div key={event.id || i} className="flex items-start gap-3 p-3 rounded-lg border bg-muted/30">
                    {event.status === 'up' ? (
                      <ArrowUpCircle className="h-5 w-5 text-success shrink-0 mt-0.5" />
                    ) : (
                      <ArrowDownCircle className="h-5 w-5 text-destructive shrink-0 mt-0.5" />
                    )}
                    <div className="flex-1 space-y-1">
                      <div className="flex items-center justify-between">
                        <span className="font-semibold text-sm">{event.interface_name}</span>
                        <span className="text-[10px] text-muted-foreground">
                          {format(new Date(event.created_at), "dd/MM HH:mm:ss", { locale: ptBR })}
                        </span>
                      </div>
                      <p className="text-xs text-muted-foreground leading-relaxed">
                        Status: <span className={event.status === 'up' ? "text-success font-medium" : "text-destructive font-medium"}>
                          {event.status === 'up' ? "ONLINE" : "OFFLINE"}
                        </span>
                        {event.reason && ` • ${event.reason}`}
                      </p>
                    </div>
                  </div>
                ))
              ) : (
                <div className="flex flex-col items-center justify-center py-8 text-muted-foreground italic">
                  <p className="text-sm text-center">Nenhum evento de oscilação registrado.</p>
                </div>
              )}
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
              <p className="text-sm text-muted-foreground">Importe seus dados diretamente no Winbox/Terminal</p>
            </div>
          </div>
          
          <div className="space-y-4 mt-4">
            <div className="bg-muted/50 p-4 rounded-md border text-sm space-y-2">
              <p className="font-medium flex items-center gap-2">
                <Badge variant="outline" className="text-[10px] uppercase">O que está incluído:</Badge>
              </p>
              <ul className="list-disc list-inside space-y-1 text-muted-foreground">
                <li>Configuração básica do PPPoE Server + IP Pool</li>
                <li>NAT (masquerade) e regras de firewall para navegação</li>
                <li>Ajuste de MSS/MTU para evitar sites travando</li>
                <li>Perfis de planos com limites de velocidade</li>
                <li>Usuários (Secrets) e senhas ativos</li>
              </ul>
            </div>

            <Button className="w-full gap-2" variant="default" onClick={downloadMikrotikScript} disabled={exporting}>
              {exporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
              Baixar Script (.rsc)
            </Button>
            
            <p className="text-[11px] text-center text-muted-foreground italic">
              * Para importar, abra o Terminal no seu Mikrotik e arraste o arquivo .rsc ou use "/import file-name.rsc"
            </p>
          </div>
        </Card>
      </div>

    </div>
  );
}
