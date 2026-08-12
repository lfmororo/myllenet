import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { RefreshCw, ExternalLink, Copy, XCircle, Loader2, MessageCircle, CheckCircle2, Send, FileText, ShieldAlert, ShieldCheck } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import type { Invoice } from "@/hooks/useInvoices";
import { useWhatsApp, type NotificationType } from "@/hooks/useWhatsApp";
import { useInvoicePDF } from "@/hooks/useInvoicePDF";
import { useMikrotikActions } from "@/hooks/useMikrotikActions";

interface Props {
  invoices: Invoice[];
  onCheckPayment: (id: string) => Promise<unknown>;
  onCancel: (id: string) => Promise<boolean>;
  onMarkAsPaid: (id: string) => Promise<boolean>;
}

const statusMap: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
  pending: { label: "Pendente", variant: "outline" },
  paid: { label: "Pago", variant: "default" },
  overdue: { label: "Vencido", variant: "destructive" },
  cancelled: { label: "Cancelado", variant: "secondary" },
};

const whatsappOptions: { type: NotificationType; label: string; statusFilter?: string[] }[] = [
  { type: "boleto_gerado", label: "📄 Boleto gerado", statusFilter: ["pending"] },
  { type: "lembrete_vencimento", label: "⏰ Lembrete de vencimento", statusFilter: ["pending"] },
  { type: "pagamento_confirmado", label: "✅ Pagamento confirmado", statusFilter: ["paid"] },
  { type: "cobranca_atrasada", label: "⚠️ Cobrança atrasada", statusFilter: ["overdue"] },
];

export default function InvoiceTable({ invoices, onCheckPayment, onCancel, onMarkAsPaid }: Props) {
  const [checking, setChecking] = useState<string | null>(null);
  const { sendInvoiceNotification, sending } = useWhatsApp();
  const { generatePDF, generating: generatingPDF } = useInvoicePDF();
  const { syncMikrotik, loading: mikrotikLoading } = useMikrotikActions();

  const handleCheck = async (id: string) => {
    setChecking(id);
    await onCheckPayment(id);
    setChecking(null);
  };

  const copyBarcode = (barcode: string) => {
    navigator.clipboard.writeText(barcode);
    toast.success("Código de barras copiado!");
  };

  const formatCurrency = (centavos: number) => {
    return (centavos / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  };

  const formatDate = (dateStr: string) => {
    return new Date(dateStr + "T00:00:00").toLocaleDateString("pt-BR");
  };

  const getDaysOverdue = (dateStr: string, status: string) => {
    if (status !== "overdue") return null;
    const venc = new Date(dateStr + "T00:00:00");
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const diff = Math.floor((today.getTime() - venc.getTime()) / (1000 * 60 * 60 * 24));
    return diff > 0 ? diff : null;
  };

  const getAvailableWhatsappOptions = (status: string) => {
    return whatsappOptions.filter(opt => !opt.statusFilter || opt.statusFilter.includes(status));
  };

  if (invoices.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
        <p className="text-lg font-medium">Nenhuma fatura encontrada</p>
        <p className="text-sm">Gere um boleto para um cliente para começar.</p>
      </div>
    );
  }

  return (
    <div className="rounded-lg border bg-card">
      <Table>
        <TableHeader>
          <TableRow className="bg-muted/50">
            <TableHead className="font-semibold">Cliente</TableHead>
            <TableHead className="font-semibold">Descrição</TableHead>
            <TableHead className="font-semibold">Valor</TableHead>
            <TableHead className="font-semibold">Vencimento</TableHead>
            <TableHead className="font-semibold">Status</TableHead>
            <TableHead className="font-semibold text-right">Ações</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {invoices.map((inv) => {
            const status = statusMap[inv.status] || statusMap.pending;
            const waOptions = getAvailableWhatsappOptions(inv.status);
            return (
              <TableRow key={inv.id} className="hover:bg-muted/30">
                <TableCell className="font-medium">
                  {(inv as any).customers?.nome || "—"}
                </TableCell>
                <TableCell>{inv.descricao}</TableCell>
                <TableCell className="font-mono">{formatCurrency(inv.valor_centavos)}</TableCell>
                <TableCell>{formatDate(inv.vencimento)}</TableCell>
                <TableCell>
                  <div className="flex items-center gap-2">
                    <Badge variant={status.variant}>{status.label}</Badge>
                    {(() => {
                      const days = getDaysOverdue(inv.vencimento, inv.status);
                      return days ? (
                        <span className="text-xs font-medium text-destructive">{days}d</span>
                      ) : null;
                    })()}
                  </div>
                </TableCell>
                <TableCell className="text-right">
                  <div className="flex justify-end gap-1">
                    {/* PDF button */}
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-blue-600 hover:text-blue-700"
                      title="Ver Fatura PDF"
                      disabled={generatingPDF}
                      onClick={() => generatePDF(inv.id)}
                    >
                      {generatingPDF ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <FileText className="h-4 w-4" />
                      )}
                    </Button>
                    {/* WhatsApp dropdown */}
                    {waOptions.length > 0 && (
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-green-600 hover:text-green-700"
                            title="Enviar WhatsApp"
                            disabled={sending === inv.id}
                          >
                            {sending === inv.id ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <MessageCircle className="h-4 w-4" />
                            )}
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          {waOptions.map(opt => (
                            <DropdownMenuItem
                              key={opt.type}
                              onClick={() => sendInvoiceNotification(inv.id, opt.type)}
                            >
                              {opt.label}
                            </DropdownMenuItem>
                          ))}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    )}
                    {/* Send PDF button - prominent when pending/overdue */}
                    {inv.status !== "paid" && inv.status !== "cancelled" && (
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-8 text-xs px-2 text-blue-600 border-blue-200 hover:bg-blue-50 hover:text-blue-700"
                        title="Enviar Fatura PDF via WhatsApp"
                        disabled={sending === inv.id || generatingPDF}
                        onClick={() => sendInvoiceNotification(inv.id, "boleto_gerado")}
                      >
                        {sending === inv.id || generatingPDF ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />
                        ) : (
                          <Send className="h-3.5 w-3.5 mr-1" />
                        )}
                        Enviar Fatura
                      </Button>
                    )}
                    {inv.efi_barcode && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        title="Copiar código de barras"
                        onClick={() => copyBarcode(inv.efi_barcode!)}
                      >
                        <Copy className="h-4 w-4" />
                      </Button>
                    )}
                    {inv.efi_link && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        title="Abrir boleto"
                        onClick={() => window.open(inv.efi_link!, "_blank")}
                      >
                        <ExternalLink className="h-4 w-4" />
                      </Button>
                    )}
                    {inv.status !== "paid" && inv.status !== "cancelled" && (
                      <>
                        {inv.efi_charge_id && (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                            title="Verificar pagamento"
                            disabled={checking === inv.id}
                            onClick={() => handleCheck(inv.id)}
                          >
                            {checking === inv.id ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <RefreshCw className="h-4 w-4" />
                            )}
                          </Button>
                        )}
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-green-600 hover:text-green-700"
                          title="Marcar como pago"
                          onClick={() => onMarkAsPaid(inv.id)}
                        >
                          <CheckCircle2 className="h-4 w-4" />
                        </Button>
                        
                        {(inv as any).customers?.id && (
                          <div className="flex border-l ml-1 pl-1">
                            {((inv as any).customers as any).block_status === "blocked" ? (
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8 text-teal-600 hover:text-teal-700 hover:bg-teal-50"
                                title="Desbloquear no Mikrotik"
                                disabled={mikrotikLoading === (inv as any).customers.id}
                                onClick={() => syncMikrotik((inv as any).customers.id, 'enable')}
                              >
                                {mikrotikLoading === (inv as any).customers.id ? (
                                  <Loader2 className="h-4 w-4 animate-spin" />
                                ) : (
                                  <ShieldCheck className="h-4 w-4" />
                                )}
                              </Button>
                            ) : (
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8 text-orange-600 hover:text-orange-700 hover:bg-orange-50"
                                title="Bloquear no Mikrotik"
                                disabled={mikrotikLoading === (inv as any).customers.id}
                                onClick={() => syncMikrotik((inv as any).customers.id, 'disable')}
                              >
                                {mikrotikLoading === (inv as any).customers.id ? (
                                  <Loader2 className="h-4 w-4 animate-spin" />
                                ) : (
                                  <ShieldAlert className="h-4 w-4" />
                                )}
                              </Button>
                            )}
                          </div>
                        )}

                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-destructive hover:text-destructive"
                          title="Cancelar fatura"
                          onClick={() => onCancel(inv.id)}
                        >
                          <XCircle className="h-4 w-4" />
                        </Button>
                      </>
                    )}
                  </div>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
