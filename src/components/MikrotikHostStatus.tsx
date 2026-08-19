import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Wifi, WifiOff, Clock, AlertCircle, History, BarChart2 } from "lucide-react";
import { format, subHours, isAfter } from "date-fns";
import { ptBR } from "date-fns/locale";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, Cell } from "recharts";

interface HostStatus {
  host: string;
  online: boolean;
  logged_at: string;
  message: string;
  created_at?: string;
}

interface UptimePoint {
  time: string;
  online: number;
}

export function MikrotikHostStatus() {
  const [latestStatuses, setLatestStatuses] = useState<HostStatus[]>([]);
  const [history, setHistory] = useState<HostStatus[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchData = async () => {
    try {
      // 1. Fetch latest status per host for the main view
      const { data: latestData, error: latestError } = await supabase
        .from("mikrotik_status_history")
        .select("host, online, logged_at, message")
        .order("logged_at", { ascending: false })
        .limit(100);

      if (latestError) throw latestError;

      const latestByHost = latestData?.reduce((acc: HostStatus[], curr) => {
        if (!acc.find((h) => h.host === curr.host)) {
          acc.push(curr);
        }
        return acc;
      }, []);

      setLatestStatuses(latestByHost || []);

      // 2. Fetch recent history for the evolution view
      const { data: historyData, error: historyError } = await supabase
        .from("mikrotik_status_history")
        .select("host, online, logged_at, message")
        .order("logged_at", { ascending: false })
        .limit(50);

      if (historyError) throw historyError;
      setHistory(historyData || []);

    } catch (err) {
      console.error("Erro ao buscar status dos hosts:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
    const channel = supabase
      .channel("host-status-changes")
      .on(
        "postgres_changes",
        { 
          event: "INSERT", 
          table: "mikrotik_status_history",
          schema: "public"
        },
        () => fetchData()
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  if (loading && latestStatuses.length === 0) return null;

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="space-y-1">
            <CardTitle className="text-lg flex items-center gap-2">
              <Wifi className="h-5 w-5" /> Monitoramento de Conectividade
            </CardTitle>
            <CardDescription>
              Acompanhe o status e a evolução das verificações de cada host.
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <Tabs defaultValue="current" className="w-full">
          <TabsList className="grid w-full grid-cols-3 mb-4">
            <TabsTrigger value="current" className="flex items-center gap-2">
              <Wifi className="h-4 w-4" /> Status Atual
            </TabsTrigger>
            <TabsTrigger value="uptime" className="flex items-center gap-2">
              <BarChart2 className="h-4 w-4" /> Evolução de Uptime
            </TabsTrigger>
            <TabsTrigger value="history" className="flex items-center gap-2">
              <History className="h-4 w-4" /> Histórico
            </TabsTrigger>
          </TabsList>
          
          <TabsContent value="uptime" className="space-y-6">
            {latestStatuses.map((s) => {
              const hostHistory = history
                .filter(h => h.host === s.host)
                .slice(0, 40)
                .reverse()
                .map(h => ({
                  time: format(new Date(h.logged_at), "HH:mm", { locale: ptBR }),
                  online: h.online ? 1 : 0,
                  fullTime: format(new Date(h.logged_at), "HH:mm:ss", { locale: ptBR }),
                  message: h.message
                }));

              return (
                <div key={s.host} className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold flex items-center gap-2">
                      <span className={`h-2 w-2 rounded-full ${s.online ? 'bg-success' : 'bg-destructive'}`} />
                      {s.host}
                    </span>
                    <span className="text-[10px] text-muted-foreground">Últimas verificações</span>
                  </div>
                  <div className="h-16 w-full">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={hostHistory}>
                        <Tooltip 
                          content={({ active, payload }) => {
                            if (active && payload && payload.length) {
                              const data = payload[0].payload;
                              return (
                                <div className="bg-background border rounded p-2 shadow-sm text-[10px]">
                                  <p className="font-bold">{data.fullTime}</p>
                                  <p className={data.online ? "text-success" : "text-destructive"}>
                                    {data.online ? "Online" : "Offline"}
                                  </p>
                                  <p className="text-muted-foreground max-w-[150px] truncate">{data.message}</p>
                                </div>
                              );
                            }
                            return null;
                          }}
                        />
                        <Bar dataKey="online" radius={[2, 2, 0, 0]}>
                          {hostHistory.map((entry, index) => (
                            <Cell key={`cell-${index}`} fill={entry.online ? "#10b981" : "#ef4444"} fillOpacity={0.8} />
                          ))}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              );
            })}
          </TabsContent>

          <TabsContent value="current">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Host / IP</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Último Check</TableHead>
                  <TableHead>Mensagem / Detalhes</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {latestStatuses.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={4} className="text-center py-4 text-muted-foreground">
                      Nenhum log recebido ainda.
                    </TableCell>
                  </TableRow>
                ) : (
                  latestStatuses.map((s) => (
                    <TableRow key={s.host} className={s.message?.includes('Agente') ? "bg-primary/5" : ""}>
                      <TableCell className="font-medium">
                        <div className="flex items-center gap-2">
                          {s.host}
                          {s.message?.includes('Agente') && (
                            <Badge variant="outline" className="text-[9px] h-4 py-0 bg-primary/10 text-primary border-primary/20">
                              VPS
                            </Badge>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        {s.online ? (
                          <Badge className="bg-success/15 text-success hover:bg-success/15 flex w-fit items-center gap-1">
                            <Wifi className="h-3 w-3" /> Online
                          </Badge>
                        ) : (
                          <Badge variant="destructive" className="flex w-fit items-center gap-1">
                            <WifiOff className="h-3 w-3" /> Offline
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-xs">
                        <div className="flex items-center gap-1 text-muted-foreground">
                          <Clock className="h-3 w-3" />
                          {format(new Date(s.logged_at), "HH:mm:ss (dd/MM)", { locale: ptBR })}
                        </div>
                      </TableCell>
                      <TableCell className="text-xs">
                        <div className="flex items-start gap-1">
                          {!s.online && <AlertCircle className="h-3 w-3 text-destructive shrink-0 mt-0.5" />}
                          <span className={s.online ? "text-muted-foreground" : "text-destructive font-medium"}>
                            {s.message || (s.online ? "Conexão estável" : "Falha na resposta")}
                          </span>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </TabsContent>
          
          <TabsContent value="history">
            <div className="rounded-md border max-h-[400px] overflow-auto">
              <Table>
                <TableHeader className="sticky top-0 bg-background z-10">
                  <TableRow>
                    <TableHead>Data/Hora</TableHead>
                    <TableHead>Host</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Mensagem</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {history.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={4} className="text-center py-4 text-muted-foreground">
                        Nenhum histórico disponível.
                      </TableCell>
                    </TableRow>
                  ) : (
                    history.map((h, i) => (
                      <TableRow key={i}>
                        <TableCell className="text-xs font-mono">
                          {format(new Date(h.logged_at), "dd/MM HH:mm:ss", { locale: ptBR })}
                        </TableCell>
                        <TableCell className="text-xs font-medium">{h.host}</TableCell>
                        <TableCell>
                          <div className={`h-2 w-2 rounded-full ${h.online ? "bg-success" : "bg-destructive"}`} title={h.online ? "Online" : "Offline"} />
                        </TableCell>
                        <TableCell className="text-[10px] text-muted-foreground truncate max-w-[200px]">
                          {h.message}
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
            <p className="text-[10px] text-muted-foreground mt-2 text-right italic">
              Mostrando as últimas 50 verificações.
            </p>
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}