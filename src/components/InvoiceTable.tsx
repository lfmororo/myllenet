import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { RefreshCw, ExternalLink, Copy, XCircle, Loader2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import type { Invoice } from "@/hooks/useInvoices";

interface Props {
  invoices: Invoice[];
  onCheckPayment: (id: string) => Promise<unknown>;
  onCancel: (id: string) => Promise<boolean>;
}

const statusMap: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
  pending: { label: "Pendente", variant: "outline" },
  paid: { label: "Pago", variant: "default" },
  overdue: { label: "Vencido", variant: "destructive" },
  cancelled: { label: "Cancelado", variant: "secondary" },
};

export default function InvoiceTable({ invoices, onCheckPayment, onCancel }: Props) {
  const [checking, setChecking] = useState<string | null>(null);

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
            return (
              <TableRow key={inv.id} className="hover:bg-muted/30">
                <TableCell className="font-medium">
                  {(inv as any).customers?.nome || "—"}
                </TableCell>
                <TableCell>{inv.descricao}</TableCell>
                <TableCell className="font-mono">{formatCurrency(inv.valor_centavos)}</TableCell>
                <TableCell>{formatDate(inv.vencimento)}</TableCell>
                <TableCell>
                  <Badge variant={status.variant}>{status.label}</Badge>
                </TableCell>
                <TableCell className="text-right">
                  <div className="flex justify-end gap-1">
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
                    {inv.status === "pending" && (
                      <>
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
