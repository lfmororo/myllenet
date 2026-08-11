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
            <CardTitle className="text-sm font-medium">Situação das WANs</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-2">
              <Activity className="h-5 w-5 text-warning" />
              <span className="text-2xl font-bold">
                {status?.online ? (wanLogs.length > 0 ? "Ativa" : "Offline") : "Offline"}
              </span>
            </div>
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
                <XAxis dataKey="time" className="text-xs" />
                <YAxis className="text-xs" tickFormatter={(v) => `${v.toFixed(1)}M`} />
                <Tooltip />
                <Legend />
                {Object.keys(wanLogs[0] || {}).filter(k => k !== 'time').map((iface, index) => (
                  <Line key={iface} type="monotone" dataKey={iface} name={iface} stroke={`hsl(var(--primary))`} strokeWidth={2} dot={false} />
                ))}
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
                <div key={i} className="flex items-start gap-3 p-3 rounded-lg border bg-muted/30">
                  {e.status === 'up' ? <ArrowUpCircle className="h-5 w-5 text-success" /> : <ArrowDownCircle className="h-5 w-5 text-destructive" />}
                  <div className="flex-1">
                    <p className="text-sm font-medium">{e.interface_name}</p>
                    <p className="text-xs text-muted-foreground">{e.status === 'up' ? "ONLINE" : "OFFLINE"} - {format(new Date(e.created_at), "dd/MM HH:mm:ss", { locale: ptBR })}</p>
                  </div>
                </div>
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
            Guia: Criação de Hotspot com Autenticação Personalizada no MikroTik
          </CardTitle>
          <CardDescription>Configuração avançada para interfaces LAN</CardDescription>
        </CardHeader>
        <CardContent className="prose prose-sm dark:prose-invert max-w-none">
          <div className="space-y-4 text-sm leading-relaxed">
            <p><strong>Objetivo:</strong> Configurar um hotspot no MikroTik que direcione usuários conectados à interface LAN (com IPs locais) para uma página de autenticação personalizada, enquanto usuários conectados via PPPoE não sejam afetados por esta configuração.</p>

            <h4 className="text-base font-semibold border-b pb-1">Funcionalidades</h4>
            <ul className="list-disc pl-5 space-y-1">
              <li><strong>Detecção de Conexão:</strong> Identificar clientes que estão conectados à rede local (LAN) e não através de uma conexão PPPoE.</li>
              <li><strong>Redirecionamento para Hotspot:</strong> Encaminhar automaticamente os clientes detectados para a página de autenticação do hotspot.</li>
              <li><strong>Página de Autenticação Personalizada:</strong> Implementar uma página de login customizada para o hotspot.</li>
              <li><strong>Autenticação:</strong> Permitir a autenticação dos usuários através da página personalizada.</li>
              <li><strong>Exclusão de PPPoE:</strong> Garantir que clientes autenticados via PPPoE não passem pelo processo de autenticação do hotspot.</li>
            </ul>

            <h4 className="text-base font-semibold border-b pb-1">Requisitos Técnicos</h4>
            <ul className="list-disc pl-5 space-y-1">
              <li>Acesso administrativo ao MikroTik RouterOS.</li>
              <li>Conhecimento básico de configuração de redes, DHCP, NAT e Hotspot no MikroTik.</li>
              <li>Arquivos da página de autenticação personalizada (HTML, CSS, JavaScript, imagens).</li>
            </ul>

            <h4 className="text-base font-semibold border-b pb-1">Passos Necessários</h4>
            <ol className="list-decimal pl-5 space-y-2">
              <li><strong>Configurar a Interface LAN:</strong> Garantir que a interface LAN esteja configurada com um servidor DHCP para atribuição de IPs aos clientes.</li>
              <li><strong>Criar o Perfil do Hotspot:</strong> Definir um perfil de hotspot com as configurações básicas.</li>
              <li><strong>Configurar o Servidor Hotspot:</strong>
                <ul className="list-circle pl-5 mt-1">
                  <li>Associar o servidor hotspot à interface LAN.</li>
                  <li>Definir o nome do domínio do hotspot.</li>
                  <li>Configurar o servidor DNS.</li>
                </ul>
              </li>
              <li><strong>Implementar a Página de Autenticação Personalizada:</strong>
                <ul className="list-circle pl-5 mt-1">
                  <li>Fazer upload dos arquivos da página personalizada para o servidor web do MikroTik (geralmente na pasta <code>flash/hotspot</code>).</li>
                  <li>Configurar o servidor hotspot para usar os arquivos da página personalizada.</li>
                </ul>
              </li>
              <li><strong>Criar Perfis de Usuário e Contas (Opcional):</strong> Se necessário, criar perfis de usuário com diferentes limites de banda ou tempo de acesso e contas de teste.</li>
              <li><strong>Configurar Regras de Firewall/NAT:</strong>
                <ul className="list-circle pl-5 mt-1">
                  <li>Garantir que o tráfego dos clientes não autenticados na LAN seja redirecionado para o servidor hotspot.</li>
                  <li>Criar regras para permitir o acesso à página de autenticação antes da autenticação.</li>
                  <li>Criar regras para permitir o acesso a sites essenciais (como servidores DNS, NTP) antes da autenticação.</li>
                </ul>
              </li>
              <li><strong>Testar a Configuração:</strong>
                <ul className="list-circle pl-5 mt-1">
                  <li>Conectar um dispositivo à LAN sem autenticação PPPoE e verificar o redirecionamento para a página personalizada.</li>
                  <li>Realizar a autenticação e verificar o acesso à internet.</li>
                  <li>Conectar um dispositivo via PPPoE e verificar se ele não é afetado pelo hotspot.</li>
                </ul>
              </li>
            </ol>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
