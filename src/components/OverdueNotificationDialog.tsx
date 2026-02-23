import { useState, useMemo } from "react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Checkbox } from "@/components/ui/checkbox";
import { Progress } from "@/components/ui/progress";
import { MessageCircle, Send, Loader2, CheckCircle2, XCircle, Users, AlertTriangle, Clock } from "lucide-react";
import { useWhatsApp } from "@/hooks/useWhatsApp";
import { toast } from "sonner";
import type { Invoice } from "@/hooks/useInvoices";

interface Customer {
  id: string;
  nome: string;
  telefone: string | null;
  usuario_pppoe: string;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  customers: Customer[];
  allInvoices: Invoice[];
}

const DEFAULT_MESSAGE = `Prezado(a) {nome},

Informamos que, devido ao atraso superior a {dias} dias em sua fatura, seu acesso à internet poderá sofrer restrições imediatas.

Queremos evitar que você fique desconectado. Por favor, entre em contato agora para negociarmos o débito ou envie o comprovante de pagamento para que possamos dar baixa no sistema.

{link_pagamento}

Contamos com sua colaboração.

_Equipe Myllenet_`;

export default function OverdueNotificationDialog({ open, onOpenChange, customers, allInvoices }: Props) {
  const { sendText } = useWhatsApp();
  const [message, setMessage] = useState(DEFAULT_MESSAGE);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [sending, setSending] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0, success: 0, failed: 0 });
  const [results, setResults] = useState<Record<string, "success" | "failed" | "no_phone">>( {});

  // Build overdue info per customer
  const overdueInfo = useMemo(() => {
    const now = new Date();
    const map = new Map<string, { days: number; link: string; pix: string; vencimento: string }>();

    for (const inv of allInvoices) {
      if (!["overdue", "waiting", "pending"].includes(inv.status)) continue;
      const venc = new Date(inv.vencimento + "T12:00:00");
      if (venc >= now) continue; // not overdue yet

      const diffDays = Math.floor((now.getTime() - venc.getTime()) / (1000 * 60 * 60 * 24));
      if (diffDays <= 0) continue;

      const existing = map.get(inv.customer_id);
      // Keep the oldest (most overdue)
      if (!existing || diffDays > existing.days) {
        const linkParts: string[] = [];
        if (inv.efi_link) linkParts.push(`📄 Boleto: ${inv.efi_link}`);
        if (inv.efi_pix_copiacola) linkParts.push(`💠 PIX Copia e Cola: ${inv.efi_pix_copiacola}`);
        if (linkParts.length === 0) linkParts.push("Entre em contato para obter os dados de pagamento.");

        map.set(inv.customer_id, {
          days: diffDays,
          link: linkParts.join("\n"),
          pix: inv.efi_pix_copiacola || "",
          vencimento: venc.toLocaleDateString("pt-BR"),
        });
      }
    }
    return map;
  }, [allInvoices]);

  const overdueCustomers = useMemo(
    () => customers.filter(c => overdueInfo.has(c.id)),
    [customers, overdueInfo]
  );

  const customersWithPhone = overdueCustomers.filter(c => c.telefone);
  const customersWithoutPhone = overdueCustomers.filter(c => !c.telefone);

  const toggleAll = () => {
    if (selectedIds.size === customersWithPhone.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(customersWithPhone.map(c => c.id)));
    }
  };

  const toggleOne = (id: string) => {
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelectedIds(next);
  };

  const handleSend = async () => {
    if (selectedIds.size === 0) {
      toast.error("Selecione ao menos um cliente");
      return;
    }

    const toSend = customersWithPhone.filter(c => selectedIds.has(c.id));
    setSending(true);
    setProgress({ done: 0, total: toSend.length, success: 0, failed: 0 });
    setResults({});

    let success = 0;
    let failed = 0;

    for (let i = 0; i < toSend.length; i++) {
      const c = toSend[i];
      const info = overdueInfo.get(c.id);
      const personalizedMsg = message
        .replace(/\{nome\}/g, c.nome.split(" ")[0])
        .replace(/\{dias\}/g, String(info?.days || 0))
        .replace(/\{link_pagamento\}/g, info?.link || "")
        .replace(/\{vencimento\}/g, info?.vencimento || "");

      const ok = await sendText(c.telefone!, personalizedMsg, { customer_id: c.id, customer_name: c.nome });
      if (ok) {
        success++;
        setResults(prev => ({ ...prev, [c.id]: "success" }));
      } else {
        failed++;
        setResults(prev => ({ ...prev, [c.id]: "failed" }));
      }

      setProgress({ done: i + 1, total: toSend.length, success, failed });

      if (i < toSend.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    }

    setSending(false);
    toast.success(`Envio concluído: ${success} enviado(s), ${failed} falha(s)`);
  };

  const handleClose = (open: boolean) => {
    if (!sending) {
      onOpenChange(open);
      if (!open) {
        setResults({});
        setProgress({ done: 0, total: 0, success: 0, failed: 0 });
      }
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-2xl max-h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Clock className="h-5 w-5 text-destructive" />
            Notificar Clientes em Atraso
          </DialogTitle>
          <DialogDescription>
            Envie uma mensagem via WhatsApp para clientes com faturas vencidas.
            Use {`{nome}`}, {`{dias}`}, {`{vencimento}`} e {`{link_pagamento}`} para personalizar.
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 space-y-4 overflow-hidden">
          {/* Stats */}
          <div className="grid grid-cols-3 gap-3">
            <div className="rounded-lg border bg-card p-3 text-center">
              <Users className="h-4 w-4 mx-auto mb-1 text-muted-foreground" />
              <p className="text-2xl font-bold">{overdueCustomers.length}</p>
              <p className="text-xs text-muted-foreground">Em atraso</p>
            </div>
            <div className="rounded-lg border bg-card p-3 text-center">
              <MessageCircle className="h-4 w-4 mx-auto mb-1 text-green-500" />
              <p className="text-2xl font-bold">{customersWithPhone.length}</p>
              <p className="text-xs text-muted-foreground">Com telefone</p>
            </div>
            <div className="rounded-lg border bg-card p-3 text-center">
              <AlertTriangle className="h-4 w-4 mx-auto mb-1 text-amber-500" />
              <p className="text-2xl font-bold">{customersWithoutPhone.length}</p>
              <p className="text-xs text-muted-foreground">Sem telefone</p>
            </div>
          </div>

          {/* Message template */}
          <div className="space-y-2">
            <label className="text-sm font-medium">
              Mensagem <span className="text-muted-foreground font-normal">(variáveis: {`{nome}`}, {`{dias}`}, {`{vencimento}`}, {`{link_pagamento}`})</span>
            </label>
            <Textarea
              value={message}
              onChange={e => setMessage(e.target.value)}
              rows={8}
              className="text-sm resize-none"
              disabled={sending}
            />
          </div>

          {/* Progress */}
          {(sending || progress.done > 0) && (
            <div className="space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Progresso do envio</span>
                <span className="font-mono text-xs">
                  {progress.done}/{progress.total}
                  {progress.success > 0 && <span className="text-green-500 ml-2">✓ {progress.success}</span>}
                  {progress.failed > 0 && <span className="text-destructive ml-2">✗ {progress.failed}</span>}
                </span>
              </div>
              <Progress value={progress.total > 0 ? (progress.done / progress.total) * 100 : 0} className="h-2" />
            </div>
          )}

          {/* Customer list */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-sm font-medium">Clientes em atraso ({customersWithPhone.length} com telefone)</label>
              <Button
                variant="ghost"
                size="sm"
                onClick={toggleAll}
                disabled={sending || customersWithPhone.length === 0}
                className="text-xs h-7"
              >
                {selectedIds.size === customersWithPhone.length ? "Desmarcar todos" : "Selecionar todos"}
              </Button>
            </div>

            <ScrollArea className="h-[200px] rounded-lg border">
              <div className="p-1">
                {customersWithPhone.map(c => {
                  const info = overdueInfo.get(c.id);
                  return (
                    <label
                      key={c.id}
                      className={`flex items-center gap-3 rounded-md px-3 py-2 cursor-pointer transition-colors hover:bg-muted/50 ${
                        results[c.id] === "success" ? "bg-green-500/10" : results[c.id] === "failed" ? "bg-destructive/10" : ""
                      }`}
                    >
                      <Checkbox
                        checked={selectedIds.has(c.id)}
                        onCheckedChange={() => toggleOne(c.id)}
                        disabled={sending}
                      />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{c.nome}</p>
                        <p className="text-xs text-muted-foreground">{c.telefone} · {info?.days} dias em atraso</p>
                      </div>
                      <Badge variant="destructive" className="text-[10px] shrink-0">{info?.days}d</Badge>
                      {results[c.id] === "success" && <CheckCircle2 className="h-4 w-4 text-green-500 shrink-0" />}
                      {results[c.id] === "failed" && <XCircle className="h-4 w-4 text-destructive shrink-0" />}
                    </label>
                  );
                })}

                {customersWithoutPhone.length > 0 && (
                  <>
                    <div className="px-3 py-2 text-xs font-medium text-muted-foreground border-t mt-1 pt-2">
                      Sem telefone cadastrado ({customersWithoutPhone.length})
                    </div>
                    {customersWithoutPhone.map(c => {
                      const info = overdueInfo.get(c.id);
                      return (
                        <div key={c.id} className="flex items-center gap-3 rounded-md px-3 py-2 opacity-50">
                          <Checkbox disabled checked={false} />
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium truncate">{c.nome}</p>
                            <p className="text-xs text-muted-foreground">Sem telefone · {info?.days}d atraso</p>
                          </div>
                          <Badge variant="outline" className="text-[10px] shrink-0">Sem tel.</Badge>
                        </div>
                      );
                    })}
                  </>
                )}

                {overdueCustomers.length === 0 && (
                  <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
                    <CheckCircle2 className="h-8 w-8 mb-2 text-green-500" />
                    <p className="text-sm">Nenhum cliente em atraso!</p>
                  </div>
                )}
              </div>
            </ScrollArea>
          </div>
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={() => handleClose(false)} disabled={sending}>
            {progress.done > 0 && !sending ? "Fechar" : "Cancelar"}
          </Button>
          <Button
            onClick={handleSend}
            disabled={sending || selectedIds.size === 0}
            className="gap-2"
            variant="destructive"
          >
            {sending ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Enviando...
              </>
            ) : (
              <>
                <Send className="h-4 w-4" />
                Enviar para {selectedIds.size} cliente{selectedIds.size !== 1 ? "s" : ""}
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
