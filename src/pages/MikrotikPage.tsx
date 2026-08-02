import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Download, Loader2, RefreshCw, Router, Wifi, WifiOff, FileCode } from "lucide-react";
import { Input } from "@/components/ui/input";
import { useCustomers } from "@/hooks/useCustomers";
import { usePlans } from "@/hooks/usePlans";

export default function MikrotikPage() {
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [status, setStatus] = useState<any>(null);
  const [search, setSearch] = useState("");
  const { customers } = useCustomers();
  const { plans } = usePlans();

  const checkStatus = async () => {
    setLoading(true);
    try {
      // Mocking status for now as we remove the old integration
      await new Promise(resolve => setTimeout(resolve, 1000));
      setStatus({
        online: false,
        message: "Monitoramento Mikrotik via IP Externo (Aguardando Configuração)"
      });
      toast.info("Configuração do Mikrotik pendente");
    } catch (err) {
      toast.error("Erro ao verificar Mikrotik");
    } finally {
      setLoading(false);
    }
  };

  const downloadMikrotikScript = () => {
    setExporting(true);
    try {
      if (customers.length === 0) {
        toast.error("Nenhum cliente para exportar");
        return;
      }

      let script = "# Mikrotik Import Script - Myllenet\n";
      script += "# Generated on: " + new Date().toLocaleString() + "\n\n";

      // 1. PPPoE Server Configuration
      script += "/ppp profile\n";
      script += "add name=myllenet-default local-address=10.0.0.1 dns-server=8.8.8.8,8.8.4.4\n\n";

      script += "/interface pppoe-server server\n";
      script += "add authentication=pap,chap,mschap1,mschap2 disabled=no interface=ether2 service-name=pppoe-myllenet\n\n";

      // 2. Plans (Queues/Profiles)
      script += "# --- Internet Plans ---\n";
      plans.forEach(plan => {
        // Simple queue based on plan
        const limit = plan.nome.toLowerCase().includes("mb") ? plan.nome.toLowerCase().split("mb")[0] + "M/" + plan.nome.toLowerCase().split("mb")[0] + "M" : "10M/10M";
        script += `/ppp profile add name="${plan.nome}" local-address=10.0.0.1 rate-limit=${limit} dns-server=8.8.8.8\n`;
      });
      script += "\n";

      // 3. Customers (Secrets)
      script += "# --- PPPoE Users ---\n";
      customers.forEach(customer => {
        if (customer.ativo) {
          const planName = plans.find(p => p.id === customer.plan_id)?.nome || "myllenet-default";
          script += `/ppp secret add name="${customer.usuario_pppoe}" password="${customer.senha_pppoe}" profile="${planName}" service=pppoe comment="${customer.nome} - CPF: ${customer.cpf}"\n`;
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
          <p className="text-muted-foreground">Monitoramento e gerenciamento centralizado Mikrotik</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={downloadMikrotikScript} disabled={exporting}>
            {exporting ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Download className="h-4 w-4 mr-2" />}
            Baixar Script (.rsc)
          </Button>
          <Button onClick={checkStatus} disabled={loading}>
            {loading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <RefreshCw className="h-4 w-4 mr-2" />}
            Verificar Status
          </Button>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card className="border-l-4 border-l-muted">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Status do IP Externo</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-2">
              <WifiOff className="h-5 w-5 text-muted-foreground" />
              <span className="text-2xl font-bold text-muted-foreground">Desconectado</span>
            </div>
          </CardContent>
        </Card>
        <Card className="border-l-4 border-l-muted">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Planos Ativos</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-2">
              <Router className="h-5 w-5 text-muted-foreground" />
              <span className="text-2xl font-bold">0</span>
            </div>
          </CardContent>
        </Card>
        <Card className="border-l-4 border-l-muted">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Usuários PPPoE</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-2">
              <Badge variant="outline">0 / 0</Badge>
            </div>
          </CardContent>
        </Card>
      </div>
      
      <div className="grid gap-6 md:grid-cols-2">
        <Card className="flex flex-col items-center justify-center text-center p-8 space-y-4">
          <div className="bg-muted p-4 rounded-full">
            <Router className="h-12 w-12 text-muted-foreground" />
          </div>
          <div className="max-w-md">
            <h3 className="text-lg font-semibold">Configuração Mikrotik Pendente</h3>
            <p className="text-sm text-muted-foreground mt-2">
              A integração com Mikrotik via API requer a configuração do IP externo e credenciais na aba de Configurações.
            </p>
            <Button variant="outline" className="mt-6" asChild>
              <a href="/settings">Ir para Configurações</a>
            </Button>
          </div>
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
                <li>Configuração básica do PPPoE Server</li>
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
