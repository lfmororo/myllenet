import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Terminal } from "lucide-react";

interface CommandRow {
  id: string;
  usuario_pppoe: string;
  action: string;
  status: string;
  attempts: number;
  error_message: string | null;
  created_at: string;
  executed_at: string | null;
}

const ACTION_LABEL: Record<string, string> = {
  disable: "Bloquear",
  enable: "Desbloquear",
  remove: "Remover",
  sync: "Sincronizar",
};

const STATUS_LABEL: Record<string, string> = {
  pending: "Na fila",
  running: "Executando",
  done: "Aplicado",
  error: "Falhou",
};

export function MikrotikCommandQueue() {
  const [rows, setRows] = useState<CommandRow[]>([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    const { data } = await supabase
      .from("mikrotik_commands")
      .select(
        "id, usuario_pppoe, action, status, attempts, error_message, created_at, executed_at",
      )
      .order("created_at", { ascending: false })
      .limit(20);
    setRows((data as CommandRow[]) || []);
    setLoading(false);
  };

  useEffect(() => {
    load();
    const channel = supabase
      .channel("mikrotik_command_queue")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "mikrotik_commands" },
        () => load(),
      )
      .subscribe();
    const timer = setInterval(load, 15000);
    return () => {
      supabase.removeChannel(channel);
      clearInterval(timer);
    };
  }, []);

  const badgeVariant = (status: string) => {
    if (status === "done") return "default" as const;
    if (status === "error") return "destructive" as const;
    return "secondary" as const;
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Terminal className="h-5 w-5" />
          Comandos no Mikrotik
        </CardTitle>
        <CardDescription>
          Bloqueios e desbloqueios enviados ao agente local e o resultado de
          cada execução no roteador.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {loading ? (
          <p className="text-sm text-muted-foreground">Carregando...</p>
        ) : rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Nenhum comando enviado até agora.
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Usuário PPPoE</TableHead>
                <TableHead>Ação</TableHead>
                <TableHead>Situação</TableHead>
                <TableHead>Enviado</TableHead>
                <TableHead>Aplicado</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.id}>
                  <TableCell className="font-medium">
                    {row.usuario_pppoe}
                  </TableCell>
                  <TableCell>{ACTION_LABEL[row.action] || row.action}</TableCell>
                  <TableCell>
                    <Badge variant={badgeVariant(row.status)}>
                      {STATUS_LABEL[row.status] || row.status}
                    </Badge>
                    {row.error_message && (
                      <span className="ml-2 text-xs text-destructive">
                        {row.error_message}
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {new Date(row.created_at).toLocaleString("pt-BR")}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {row.executed_at
                      ? new Date(row.executed_at).toLocaleString("pt-BR")
                      : "—"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
