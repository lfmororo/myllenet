import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Separator } from "@/components/ui/separator";
import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Loader2, ExternalLink, Copy, CheckCircle2, Clock, Import } from "lucide-react";
import { toast } from "sonner";
import type { Customer } from "@/hooks/useCustomers";
import type { Invoice } from "@/hooks/useInvoices";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  customer: Customer | null;
}

export default function CustomerDetailDialog({ open, onOpenChange, customer }: Props) {
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [loading, setLoading] = useState(false);
  const [checkingEfi, setCheckingEfi] = useState(false);

  const fetchInvoices = useCallback(() => {
    if (!customer) return;
    setLoading(true);
    supabase
      .from("invoices")
      .select("*")
      .eq("customer_id", customer.id)
      .order("vencimento", { ascending: false })
      .then(({ data, error }) => {
        if (error) {
          toast.error("Erro ao carregar faturas");
        } else {
          setInvoices(data as Invoice[]);
        }
        setLoading(false);
      });
  }, [customer]);

  useEffect(() => {
    if (open && customer) {
      fetchInvoices();
    } else {
      setInvoices([]);
    }
  }, [open, customer, fetchInvoices]);

  const handleCheckEfi = async () => {
    if (!customer) return;
    setCheckingEfi(true);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData?.session?.access_token;
      if (!token) { toast.error("Sessão expirada"); setCheckingEfi(false); return; }

      const projectId = import.meta.env.VITE_SUPABASE_PROJECT_ID;
      const response = await fetch(
        `https://${projectId}.supabase.co/functions/v1/efi-boleto/check-customer?customer_id=${customer.id}`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
            apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
          },
        }
      );

      const result = await response.json();
      if (!response.ok) {
        toast.error(result.error || "Erro ao consultar EFI");
      } else {
        toast.success(`Encontrados: ${result.total_found} | Importados: ${result.imported} | Já existentes: ${result.skipped}`);
        if (result.imported > 0) {
          fetchInvoices();
        }
      }
    } catch (err) {
      console.error(err);
      toast.error("Erro ao consultar cobranças na EFI");
    }
    setCheckingEfi(false);
  };

  if (!customer) return null;

  const formatCPF = (cpf: string) => {
    const d = cpf.replace(/\D/g, "");
    if (d.length !== 11) return cpf;
    return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
  };

  const formatCurrency = (cents: number) =>
    (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

  const statusConfig: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
    pending: { label: "Pendente", variant: "outline" },
    waiting: { label: "Aguardando", variant: "secondary" },
    paid: { label: "Pago", variant: "default" },
    cancelled: { label: "Cancelado", variant: "destructive" },
    expired: { label: "Vencido", variant: "destructive" },
  };

  const totalPending = invoices.filter(i => ["pending", "waiting"].includes(i.status)).reduce((s, i) => s + i.valor_centavos, 0);
  const totalPaid = invoices.filter(i => i.status === "paid").reduce((s, i) => s + i.valor_centavos, 0);

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    toast.success("Copiado!");
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {customer.nome}
            <Badge variant={customer.ativo ? "default" : "secondary"}>
              {customer.ativo ? "Ativo" : "Inativo"}
            </Badge>
          </DialogTitle>
        </DialogHeader>

        {/* Customer Info */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
          <div><span className="text-muted-foreground">CPF:</span> <span className="font-mono">{formatCPF(customer.cpf)}</span></div>
          <div><span className="text-muted-foreground">E-mail:</span> {customer.email}</div>
          <div><span className="text-muted-foreground">Telefone:</span> {customer.telefone || "—"}</div>
          <div><span className="text-muted-foreground">PPPoE:</span> <span className="font-mono">{customer.usuario_pppoe}</span></div>
          {customer.rua && (
            <div className="sm:col-span-2">
              <span className="text-muted-foreground">Endereço:</span>{" "}
              {[customer.rua, customer.numero, customer.complemento, customer.bairro, customer.cidade, customer.estado, customer.cep].filter(Boolean).join(", ")}
            </div>
          )}
        </div>

        <Separator />

        {/* Summary */}
        <div className="flex gap-4 text-sm">
          <div className="flex items-center gap-1.5">
            <Clock className="h-4 w-4 text-muted-foreground" />
            <span className="text-muted-foreground">Em aberto:</span>
            <span className="font-semibold">{formatCurrency(totalPending)}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <CheckCircle2 className="h-4 w-4 text-green-500" />
            <span className="text-muted-foreground">Pago:</span>
            <span className="font-semibold">{formatCurrency(totalPaid)}</span>
          </div>
          <div className="text-muted-foreground">
            {invoices.length} fatura{invoices.length !== 1 ? "s" : ""}
          </div>
          <div className="ml-auto">
            <Button variant="outline" size="sm" disabled={checkingEfi} onClick={handleCheckEfi}>
              {checkingEfi ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Import className="mr-1.5 h-3.5 w-3.5" />}
              Consultar EFI
            </Button>
          </div>
        </div>

        {/* Invoices Table */}
        {loading ? (
          <div className="flex justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
          </div>
        ) : invoices.length === 0 ? (
          <p className="text-center text-muted-foreground py-8">Nenhuma cobrança encontrada.</p>
        ) : (
          <div className="rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/50">
                  <TableHead>Descrição</TableHead>
                  <TableHead>Vencimento</TableHead>
                  <TableHead>Valor</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {invoices.map((inv) => {
                  const st = statusConfig[inv.status] || { label: inv.status, variant: "outline" as const };
                  return (
                    <TableRow key={inv.id}>
                      <TableCell className="text-sm">{inv.descricao}</TableCell>
                      <TableCell className="text-sm">{new Date(inv.vencimento + "T12:00:00").toLocaleDateString("pt-BR")}</TableCell>
                      <TableCell className="text-sm font-mono">{formatCurrency(inv.valor_centavos)}</TableCell>
                      <TableCell>
                        <Badge variant={st.variant} className="text-xs">{st.label}</Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-1">
                          {inv.efi_link && (
                            <Button variant="ghost" size="icon" className="h-7 w-7" asChild>
                              <a href={inv.efi_link} target="_blank" rel="noopener noreferrer" title="Abrir boleto">
                                <ExternalLink className="h-3.5 w-3.5" />
                              </a>
                            </Button>
                          )}
                          {inv.efi_pix_copiacola && (
                            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => copyToClipboard(inv.efi_pix_copiacola!)} title="Copiar PIX">
                              <Copy className="h-3.5 w-3.5" />
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
