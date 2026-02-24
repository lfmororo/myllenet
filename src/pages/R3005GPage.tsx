import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Loader2, RefreshCw, Download, Wifi, WifiOff, Users, Router } from "lucide-react";
import { Input } from "@/components/ui/input";

interface CustomerStatus {
  id: string;
  nome: string;
  usuario_pppoe: string;
  ativo: boolean;
  online: boolean;
  found_in_router: boolean;
}

interface RouterUser {
  usuario_pppoe: string;
  senha_pppoe: string;
  online: boolean;
}

interface SyncResult {
  customers: CustomerStatus[];
  not_in_system: RouterUser[];
  total_router_users: number;
  total_connected: number;
}

export default function R3005GPage() {
  const [loading, setLoading] = useState(false);
  const [importing, setImporting] = useState(false);
  const [data, setData] = useState<SyncResult | null>(null);
  const [search, setSearch] = useState("");

  const fetchStatus = async () => {
    setLoading(true);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData?.session?.access_token;
      if (!token) { toast.error("Sessão expirada"); return; }

      const projectId = import.meta.env.VITE_SUPABASE_PROJECT_ID;
      const res = await fetch(
        `https://${projectId}.supabase.co/functions/v1/r3005g-sync/status`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
            apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
          },
        }
      );

      const result = await res.json();
      if (!res.ok) {
        toast.error(result.error || "Erro ao buscar status");
        return;
      }

      setData(result);
      toast.success(`${result.total_connected} usuários conectados de ${result.total_router_users} total`);
    } catch (err) {
      console.error(err);
      toast.error("Erro ao conectar com o roteador");
    } finally {
      setLoading(false);
    }
  };

  const importUsers = async () => {
    setImporting(true);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData?.session?.access_token;
      if (!token) { toast.error("Sessão expirada"); return; }

      const projectId = import.meta.env.VITE_SUPABASE_PROJECT_ID;
      const res = await fetch(
        `https://${projectId}.supabase.co/functions/v1/r3005g-sync/import`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
            apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
          },
        }
      );

      const result = await res.json();
      if (!res.ok) {
        toast.error(result.error || "Erro ao importar");
        return;
      }

      toast.success(`Importados: ${result.imported}, Falhas: ${result.failed}, Já existentes: ${result.skipped}`);
      fetchStatus();
    } catch (err) {
      console.error(err);
      toast.error("Erro ao importar usuários");
    } finally {
      setImporting(false);
    }
  };


  const term = search.trim().toLowerCase();
  const filteredCustomers = data?.customers?.filter(
    (c) =>
      !term ||
      c.nome?.toLowerCase().includes(term) ||
      c.usuario_pppoe?.toLowerCase().includes(term)
  ) || [];

  const onlineCount = data?.customers?.filter((c) => c.online).length || 0;
  const offlineCount = data?.customers?.filter((c) => c.ativo && !c.online).length || 0;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">R3005G - PPPoE</h2>
          <p className="text-muted-foreground">Sincronização com roteador Intelbras</p>
        </div>
        <div className="flex gap-2">
          <Button onClick={fetchStatus} disabled={loading}>
            {loading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <RefreshCw className="h-4 w-4 mr-2" />}
            Sincronizar Status
          </Button>
          {data && data.not_in_system.length > 0 && (
            <Button variant="outline" onClick={importUsers} disabled={importing}>
              {importing ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Download className="h-4 w-4 mr-2" />}
              Importar ({data.not_in_system.length})
            </Button>
          )}
        </div>
      </div>

      {/* KPIs */}
      {data && (
        <div className="grid gap-4 md:grid-cols-4">
          <Card className="border-l-4 border-l-primary">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium">Total no Roteador</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center gap-2">
                <Router className="h-5 w-5 text-primary" />
                <span className="text-2xl font-bold">{data.total_router_users}</span>
              </div>
            </CardContent>
          </Card>
          <Card className="border-l-4 border-l-success">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium">Conectados</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center gap-2">
                <Wifi className="h-5 w-5 text-success" />
                <span className="text-2xl font-bold text-success">{data.total_connected}</span>
              </div>
            </CardContent>
          </Card>
          <Card className="border-l-4 border-l-warning">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium">Clientes Offline</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center gap-2">
                <WifiOff className="h-5 w-5 text-warning" />
                <span className="text-2xl font-bold text-warning">{offlineCount}</span>
              </div>
            </CardContent>
          </Card>
          <Card className="border-l-4 border-l-accent">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium">Fora do Sistema</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center gap-2">
                <Users className="h-5 w-5 text-accent" />
                <span className="text-2xl font-bold text-accent">{data.not_in_system.length}</span>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {data && (
        <>
          <Input
            placeholder="Buscar por nome ou usuário PPPoE..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="max-w-sm"
          />

          {/* Customers table */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Clientes Cadastrados</CardTitle>
              <CardDescription>{filteredCustomers.length} clientes encontrados</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="rounded-md border overflow-auto max-h-[500px]">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Nome</TableHead>
                      <TableHead>Usuário PPPoE</TableHead>
                      <TableHead>Status Sistema</TableHead>
                      <TableHead>Status Online</TableHead>
                      <TableHead>No Roteador</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredCustomers.map((c) => (
                      <TableRow key={c.id}>
                        <TableCell className="font-medium">{c.nome}</TableCell>
                        <TableCell className="font-mono text-xs">{c.usuario_pppoe}</TableCell>
                        <TableCell>
                          <Badge variant={c.ativo ? "default" : "secondary"}>
                            {c.ativo ? "Ativo" : "Inativo"}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          {c.online ? (
                            <Badge className="bg-success/15 text-success border-success/30">
                              <Wifi className="h-3 w-3 mr-1" /> Conectado
                            </Badge>
                          ) : (
                            <Badge variant="outline" className="text-muted-foreground">
                              <WifiOff className="h-3 w-3 mr-1" /> Não logado
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell>
                          {c.found_in_router ? (
                            <Badge variant="outline" className="text-primary border-primary/30">Sim</Badge>
                          ) : (
                            <Badge variant="destructive">Não</Badge>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>

          {/* Users not in system */}
          {data.not_in_system.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Usuários Fora do Sistema</CardTitle>
                <CardDescription>
                  {data.not_in_system.length} usuários no roteador que não estão cadastrados
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="rounded-md border overflow-auto max-h-[400px]">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Usuário PPPoE</TableHead>
                        <TableHead>Status Conexão</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {data.not_in_system.map((u, i) => (
                        <TableRow key={i}>
                          <TableCell className="font-mono text-xs">{u.usuario_pppoe}</TableCell>
                          <TableCell>
                            {u.online ? (
                              <Badge className="bg-success/15 text-success border-success/30">
                                <Wifi className="h-3 w-3 mr-1" /> Conectado
                              </Badge>
                            ) : (
                              <Badge variant="outline" className="text-muted-foreground">
                                <WifiOff className="h-3 w-3 mr-1" /> Não logado
                              </Badge>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>
          )}
        </>
      )}

      {!data && !loading && (
        <Card className="py-12">
          <CardContent className="flex flex-col items-center gap-4 text-center">
            <Router className="h-12 w-12 text-muted-foreground/40" />
            <div>
              <p className="font-medium">Nenhum dado carregado</p>
              <p className="text-sm text-muted-foreground">Clique em "Sincronizar Status" para buscar dados do roteador</p>
            </div>
          </CardContent>
        </Card>
      )}

    </div>
  );
}
