import { useCallback, useEffect, useState } from "react";
import { ArrowDownCircle, ArrowUpCircle, History, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

type ConnectionEvent = {
  id: string;
  customer_id: string;
  usuario_pppoe: string;
  event_type: "connected" | "disconnected";
  ip_address: string | null;
  uptime: string | null;
  logged_at: string | null;
};

type CustomerName = {
  id: string;
  nome: string;
};

export function RecentPppoeConnections() {
  const [events, setEvents] = useState<ConnectionEvent[]>([]);
  const [customerNames, setCustomerNames] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);

  const fetchEvents = useCallback(async () => {
    const { data, error } = await supabase
      .from("pppoe_logs")
      .select("id, customer_id, usuario_pppoe, event_type, ip_address, uptime, logged_at")
      .in("event_type", ["connected", "disconnected"])
      .order("logged_at", { ascending: false })
      .limit(20);

    if (error) {
      console.error("Erro ao carregar conexões PPPoE:", error);
      setLoading(false);
      return;
    }

    const recentEvents = (data || []) as ConnectionEvent[];
    setEvents(recentEvents);

    const customerIds = [...new Set(recentEvents.map((event) => event.customer_id))];
    if (customerIds.length > 0) {
      const { data: customers } = await supabase
        .from("customers")
        .select("id, nome")
        .in("id", customerIds);

      setCustomerNames(
        ((customers || []) as CustomerName[]).reduce<Record<string, string>>((names, customer) => {
          names[customer.id] = customer.nome;
          return names;
        }, {}),
      );
    }

    setLoading(false);
  }, []);

  useEffect(() => {
    fetchEvents();
    const channel = supabase
      .channel("mikrotik_recent_pppoe_events")
      .on(
        "postgres_changes" as any,
        { event: "INSERT", schema: "public", table: "pppoe_logs" },
        (payload: any) => {
          if (["connected", "disconnected"].includes(payload.new?.event_type)) fetchEvents();
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [fetchEvents]);

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <History className="h-5 w-5 text-primary" />
          Últimas Conexões e Desconexões
        </CardTitle>
        <CardDescription>Movimentações mais recentes dos clientes PPPoE</CardDescription>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="flex h-32 items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : events.length === 0 ? (
          <div className="flex h-32 flex-col items-center justify-center gap-2 text-center text-muted-foreground">
            <History className="h-7 w-7" />
            <p className="text-sm">Nenhuma conexão ou desconexão registrada.</p>
          </div>
        ) : (
          <div className="max-h-[430px] overflow-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Cliente</TableHead>
                  <TableHead>Usuário PPPoE</TableHead>
                  <TableHead>Situação</TableHead>
                  <TableHead>Endereço IP</TableHead>
                  <TableHead className="text-right">Data e hora</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {events.map((event) => {
                  const connected = event.event_type === "connected";
                  return (
                    <TableRow key={event.id}>
                      <TableCell className="font-medium">
                        {customerNames[event.customer_id] || "Cliente não identificado"}
                      </TableCell>
                      <TableCell className="font-mono text-xs">{event.usuario_pppoe}</TableCell>
                      <TableCell>
                        <Badge
                          variant="outline"
                          className={connected ? "border-success/30 bg-success/10 text-success" : "border-destructive/30 bg-destructive/10 text-destructive"}
                        >
                          {connected ? <ArrowUpCircle className="mr-1 h-3.5 w-3.5" /> : <ArrowDownCircle className="mr-1 h-3.5 w-3.5" />}
                          {connected ? "Conectou" : "Desconectou"}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-muted-foreground">{event.ip_address || "—"}</TableCell>
                      <TableCell className="whitespace-nowrap text-right text-muted-foreground">
                        {event.logged_at
                          ? new Date(event.logged_at).toLocaleString("pt-BR", {
                              day: "2-digit",
                              month: "2-digit",
                              year: "numeric",
                              hour: "2-digit",
                              minute: "2-digit",
                            })
                          : "—"}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}