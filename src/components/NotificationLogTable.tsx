import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, Search, RefreshCw, ChevronLeft, ChevronRight, MessageCircle } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

interface NotificationLog {
  id: string;
  customer_id: string | null;
  customer_name: string;
  phone: string | null;
  type: string;
  message: string;
  status: string;
  error_message: string | null;
  created_at: string;
}

const TYPE_LABELS: Record<string, string> = {
  boleto_gerado: "Boleto Gerado",
  lembrete_vencimento: "Lembrete Vencimento",
  pagamento_confirmado: "Pagamento Confirmado",
  cobranca_atrasada: "Cobrança Atrasada",
  manual: "Manual",
  bulk: "Envio em Lote",
  relatorio_diario: "Relatório Diário",
  sem_boleto: "Sem Boleto",
};

const PAGE_SIZE = 20;

export default function NotificationLogTable() {
  const [logs, setLogs] = useState<NotificationLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [page, setPage] = useState(0);
  const [total, setTotal] = useState(0);
  const [selectedLog, setSelectedLog] = useState<NotificationLog | null>(null);

  const fetchLogs = async () => {
    setLoading(true);
    let query = supabase
      .from("notification_logs")
      .select("*", { count: "exact" })
      .order("created_at", { ascending: false })
      .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);

    if (search) {
      query = query.ilike("customer_name", `%${search}%`);
    }
    if (typeFilter !== "all") {
      query = query.eq("type", typeFilter);
    }
    if (statusFilter !== "all") {
      query = query.eq("status", statusFilter);
    }

    const { data, count, error } = await query;
    if (error) {
      console.error("Error fetching notification logs:", error);
    } else {
      setLogs((data as NotificationLog[]) || []);
      setTotal(count || 0);
    }
    setLoading(false);
  };

  useEffect(() => {
    fetchLogs();
  }, [page, search, typeFilter, statusFilter]);

  const totalPages = Math.ceil(total / PAGE_SIZE);

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleString("pt-BR", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center justify-between">
        <div className="flex items-center gap-3 flex-wrap">
          <div className="relative w-full sm:w-64">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Buscar por cliente..."
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(0); }}
              className="pl-9"
            />
          </div>
          <Select value={typeFilter} onValueChange={(v) => { setTypeFilter(v); setPage(0); }}>
            <SelectTrigger className="w-[180px]">
              <SelectValue placeholder="Tipo" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos os tipos</SelectItem>
              {Object.entries(TYPE_LABELS).map(([key, label]) => (
                <SelectItem key={key} value={key}>{label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={statusFilter} onValueChange={(v) => { setStatusFilter(v); setPage(0); }}>
            <SelectTrigger className="w-[140px]">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos</SelectItem>
              <SelectItem value="sent">Enviado</SelectItem>
              <SelectItem value="failed">Falhou</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">{total} registro{total !== 1 ? "s" : ""}</span>
          <Button variant="outline" size="icon" onClick={fetchLogs}>
            <RefreshCw className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      ) : logs.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
          <MessageCircle className="h-12 w-12 mb-3 opacity-30" />
          <p>Nenhuma notificação encontrada</p>
        </div>
      ) : (
        <>
          <div className="rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Data</TableHead>
                  <TableHead>Cliente</TableHead>
                  <TableHead>Telefone</TableHead>
                  <TableHead>Tipo</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="w-[80px]">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {logs.map((log) => (
                  <TableRow key={log.id}>
                    <TableCell className="text-xs whitespace-nowrap">{formatDate(log.created_at)}</TableCell>
                    <TableCell className="font-medium">{log.customer_name}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{log.phone || "—"}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className="text-xs">
                        {TYPE_LABELS[log.type] || log.type}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Badge variant={log.status === "sent" ? "default" : "destructive"} className="text-xs">
                        {log.status === "sent" ? "Enviado" : "Falhou"}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Button variant="ghost" size="sm" onClick={() => setSelectedLog(log)}>
                        Ver
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-2">
              <Button variant="outline" size="icon" disabled={page === 0} onClick={() => setPage(p => p - 1)}>
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <span className="text-sm text-muted-foreground">
                {page + 1} / {totalPages}
              </span>
              <Button variant="outline" size="icon" disabled={page >= totalPages - 1} onClick={() => setPage(p => p + 1)}>
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          )}
        </>
      )}

      {/* Detail Dialog */}
      <Dialog open={!!selectedLog} onOpenChange={(open) => !open && setSelectedLog(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Detalhes da Notificação</DialogTitle>
          </DialogHeader>
          {selectedLog && (
            <div className="space-y-3 text-sm">
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <span className="text-muted-foreground">Data:</span>
                  <p className="font-medium">{formatDate(selectedLog.created_at)}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">Status:</span>
                  <p>
                    <Badge variant={selectedLog.status === "sent" ? "default" : "destructive"}>
                      {selectedLog.status === "sent" ? "Enviado" : "Falhou"}
                    </Badge>
                  </p>
                </div>
                <div>
                  <span className="text-muted-foreground">Cliente:</span>
                  <p className="font-medium">{selectedLog.customer_name}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">Telefone:</span>
                  <p>{selectedLog.phone || "—"}</p>
                </div>
                <div className="col-span-2">
                  <span className="text-muted-foreground">Tipo:</span>
                  <p><Badge variant="outline">{TYPE_LABELS[selectedLog.type] || selectedLog.type}</Badge></p>
                </div>
              </div>
              {selectedLog.error_message && (
                <div className="rounded-md bg-destructive/10 p-3">
                  <span className="text-muted-foreground text-xs">Erro:</span>
                  <p className="text-destructive text-xs mt-1">{selectedLog.error_message}</p>
                </div>
              )}
              <div>
                <span className="text-muted-foreground">Mensagem:</span>
                <pre className="mt-1 whitespace-pre-wrap rounded-md bg-muted p-3 text-xs max-h-64 overflow-auto">
                  {selectedLog.message}
                </pre>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
