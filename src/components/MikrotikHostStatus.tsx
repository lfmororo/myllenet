import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Wifi, WifiOff, Clock, AlertCircle } from "lucide-react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";

interface HostStatus {
  host: string;
  online: boolean;
  logged_at: string;
  message: string;
}

export function MikrotikHostStatus() {
  const [statuses, setStatuses] = useState<HostStatus[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchStatus = async () => {
    try {
      // Busca o último status de cada host único
      const { data, error } = await supabase
        .from("mikrotik_status_history")
        .select("host, online, logged_at, message")
        .order("logged_at", { ascending: false });

      if (error) throw error;

      // Filtra para manter apenas a entrada mais recente de cada host
      const latestByHost = data?.reduce((acc: HostStatus[], curr) => {
        if (!acc.find((h) => h.host === curr.host)) {
          acc.push(curr);
        }
        return acc;
      }, []);

      setStatuses(latestByHost || []);
    } catch (err) {
      console.error("Erro ao buscar status dos hosts:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchStatus();
    const channel = supabase
      .channel("host-status-changes")
      .on(
        "postgres_changes",
        { 
          event: "INSERT", 
          table: "mikrotik_status_history",
          schema: "public"
        },
        () => fetchStatus()
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  if (loading && statuses.length === 0) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg flex items-center gap-2">
          <Wifi className="h-5 w-5" /> Status dos Hosts (Agente VPS)
        </CardTitle>
        <CardDescription>
          Logs recentes de conectividade reportados pela nuvem ou pelo Agente VPS.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Host / IP</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Último Check</TableHead>
              <TableHead>Mensagem / Erro</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {statuses.length === 0 ? (
              <TableRow>
                <TableCell colSpan={4} className="text-center py-4 text-muted-foreground">
                  Nenhum log de agente recebido ainda.
                </TableCell>
              </TableRow>
            ) : (
              statuses.map((s) => (
                <TableRow key={s.host + s.logged_at} className={s.message?.includes('Agente') ? "bg-primary/5" : ""}>
                  <TableCell className="font-medium flex items-center gap-2">
                    {s.host}
                    {s.message?.includes('Agente') && (
                      <Badge variant="outline" className="text-[9px] h-4 py-0 bg-primary/10 text-primary border-primary/20">
                        VPS
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell>
                    {s.online ? (
                      <Badge className="bg-success/15 text-success hover:bg-success/15 flex w-fit items-center gap-1">
                        <Wifi className="h-3 w-3" /> Ativo
                      </Badge>
                    ) : (
                      <Badge variant="destructive" className="flex w-fit items-center gap-1">
                        <WifiOff className="h-3 w-3" /> Inativo
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-xs">
                    <div className="flex items-center gap-1 text-muted-foreground">
                      <Clock className="h-3 w-3" />
                      {format(new Date(s.logged_at), "HH:mm:ss (dd/MM)", { locale: ptBR })}
                    </div>
                  </TableCell>
                  <TableCell className="text-xs max-w-[300px]">
                    <div className="flex items-start gap-1">
                      {!s.online && <AlertCircle className="h-3 w-3 text-destructive shrink-0 mt-0.5" />}
                      <span className={s.online ? "text-muted-foreground" : "text-destructive font-medium"}>
                        {s.message || (s.online ? "OK" : "Sem resposta")}
                      </span>
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
