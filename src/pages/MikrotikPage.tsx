import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Loader2, RefreshCw, Router, Wifi, WifiOff } from "lucide-react";
import { Input } from "@/components/ui/input";

export default function MikrotikPage() {
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<any>(null);
  const [search, setSearch] = useState("");

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

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Mikrotik - Gestão</h2>
          <p className="text-muted-foreground">Monitoramento e gerenciamento centralizado Mikrotik</p>
        </div>
        <Button onClick={checkStatus} disabled={loading}>
          {loading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <RefreshCw className="h-4 w-4 mr-2" />}
          Verificar Status
        </Button>
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

      <Card className="py-20 flex flex-col items-center justify-center text-center space-y-4">
        <div className="bg-muted p-4 rounded-full">
          <Router className="h-12 w-12 text-muted-foreground" />
        </div>
        <div className="max-w-md">
          <h3 className="text-lg font-semibold">Configuração Mikrotik Pendente</h3>
          <p className="text-sm text-muted-foreground mt-2">
            A integração com Mikrotik via API/SSH requer a configuração do IP externo e credenciais na aba de Configurações.
          </p>
          <Button variant="outline" className="mt-6" asChild>
            <a href="/settings">Ir para Configurações</a>
          </Button>
        </div>
      </Card>
    </div>
  );
}
