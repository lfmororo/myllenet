import { useState, useEffect } from "react";
import { api } from "@/integrations/api/client";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Loader2, Search, RefreshCw, ChevronLeft, ChevronRight, AlertCircle } from "lucide-react";

interface EfiApiLog {
  id: string;
  created_at: string;
  method: string;
  endpoint: string;
  status_code: number | null;
  request_body: string | null;
  response_body: string | null;
  error_message: string | null;
  duration_ms: number | null;
  context: string | null;
}

const PAGE_SIZE = 20;

export default function EfiApiLogTable() {
  const [logs, setLogs] = useState<EfiApiLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const [total, setTotal] = useState(0);
  const [selectedLog, setSelectedLog] = useState<EfiApiLog | null>(null);

  const fetchLogs = async () => {
    setLoading(true);
    let query = api
      .from("efi_api_logs")
      .select("*", { count: "exact" })
      .order("created_at", { ascending: false })
      .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);

    if (search) {
      query = query.or(`endpoint.ilike.%${search}%,error_message.ilike.%${search}%,context.ilike.%${search}%`);
    }

    const { data, count, error } = await query;
    if (!error) {
      setLogs((data as EfiApiLog[]) || []);
      setTotal(count || 0);
    }
    setLoading(false);
  };

  useEffect(() => {
    fetchLogs();
  }, [page, search]);

  const totalPages = Math.ceil(total / PAGE_SIZE);

  const formatDate = (dateStr: string) =>
    new Date(dateStr).toLocaleString("pt-BR", {
      day: "2-digit", month: "2-digit", year: "numeric",
      hour: "2-digit", minute: "2-digit", second: "2-digit",
    });

  const getStatusBadge = (log: EfiApiLog) => {
    if (log.error_message) return <Badge variant="destructive" className="text-xs">Erro</Badge>;
    if (log.status_code && log.status_code >= 400) return <Badge variant="destructive" className="text-xs">{log.status_code}</Badge>;
    if (log.status_code) return <Badge variant="default" className="text-xs">{log.status_code}</Badge>;
    return <Badge variant="outline" className="text-xs">—</Badge>;
  };

  const CONTEXT_LABELS: Record<string, string> = {
    criar_boleto: "Criar Boleto",
    verificar_pagamento: "Verificar Pagamento",
    cancelar_cobranca: "Cancelar Cobrança",
    bulk_check: "Verificação em Lote",
    importar: "Importação",
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center justify-between">
        <div className="relative w-full sm:w-64">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Buscar endpoint, erro..."
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(0); }}
            className="pl-9"
          />
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
          <AlertCircle className="h-12 w-12 mb-3 opacity-30" />
          <p>Nenhum log encontrado</p>
          <p className="text-xs mt-1">Logs de erro da API EFI aparecerão aqui</p>
        </div>
      ) : (
        <>
          <div className="rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Data</TableHead>
                  <TableHead>Método</TableHead>
                  <TableHead>Endpoint</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Contexto</TableHead>
                  <TableHead>Duração</TableHead>
                  <TableHead className="w-[80px]">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {logs.map((log) => (
                  <TableRow key={log.id} className={log.error_message ? "bg-destructive/5" : ""}>
                    <TableCell className="text-xs whitespace-nowrap">{formatDate(log.created_at)}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className="text-xs font-mono">{log.method}</Badge>
                    </TableCell>
                    <TableCell className="text-xs font-mono max-w-[200px] truncate">{log.endpoint}</TableCell>
                    <TableCell>{getStatusBadge(log)}</TableCell>
                    <TableCell className="text-xs">
                      {log.context ? (CONTEXT_LABELS[log.context] || log.context) : "—"}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {log.duration_ms != null ? `${log.duration_ms}ms` : "—"}
                    </TableCell>
                    <TableCell>
                      <Button variant="ghost" size="sm" onClick={() => setSelectedLog(log)}>Ver</Button>
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
              <span className="text-sm text-muted-foreground">{page + 1} / {totalPages}</span>
              <Button variant="outline" size="icon" disabled={page >= totalPages - 1} onClick={() => setPage(p => p + 1)}>
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          )}
        </>
      )}

      <Dialog open={!!selectedLog} onOpenChange={(open) => !open && setSelectedLog(null)}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-auto">
          <DialogHeader>
            <DialogTitle>Detalhes do Log EFI</DialogTitle>
          </DialogHeader>
          {selectedLog && (
            <div className="space-y-3 text-sm">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <span className="text-muted-foreground">Data:</span>
                  <p className="font-medium">{formatDate(selectedLog.created_at)}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">Status:</span>
                  <p>{getStatusBadge(selectedLog)}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">Método:</span>
                  <p className="font-mono">{selectedLog.method}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">Duração:</span>
                  <p>{selectedLog.duration_ms != null ? `${selectedLog.duration_ms}ms` : "—"}</p>
                </div>
                <div className="col-span-2">
                  <span className="text-muted-foreground">Endpoint:</span>
                  <p className="font-mono text-xs break-all">{selectedLog.endpoint}</p>
                </div>
                {selectedLog.context && (
                  <div className="col-span-2">
                    <span className="text-muted-foreground">Contexto:</span>
                    <p>{CONTEXT_LABELS[selectedLog.context] || selectedLog.context}</p>
                  </div>
                )}
              </div>
              {selectedLog.error_message && (
                <div className="rounded-md bg-destructive/10 p-3">
                  <span className="text-muted-foreground text-xs">Erro:</span>
                  <p className="text-destructive text-xs mt-1">{selectedLog.error_message}</p>
                </div>
              )}
              {selectedLog.request_body && (
                <div>
                  <span className="text-muted-foreground">Request:</span>
                  <pre className="mt-1 whitespace-pre-wrap rounded-md bg-muted p-3 text-xs max-h-48 overflow-auto">
                    {selectedLog.request_body}
                  </pre>
                </div>
              )}
              {selectedLog.response_body && (
                <div>
                  <span className="text-muted-foreground">Response:</span>
                  <pre className="mt-1 whitespace-pre-wrap rounded-md bg-muted p-3 text-xs max-h-48 overflow-auto">
                    {selectedLog.response_body}
                  </pre>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
