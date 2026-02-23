import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2 } from "lucide-react";
import type { Customer } from "@/hooks/useCustomers";
import type { CreateInvoiceInput } from "@/hooks/useInvoices";

interface Plan {
  id: string;
  nome: string;
  valor_centavos: number;
  desconto_centavos: number;
  dias_desconto: number;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  customers: Customer[];
  plans: Plan[];
  onSave: (data: CreateInvoiceInput) => Promise<boolean>;
}

export default function CreateBoletoDialog({ open, onOpenChange, customers, plans, onSave }: Props) {
  const [customerId, setCustomerId] = useState("");
  const [descricao, setDescricao] = useState("");
  const [valor, setValor] = useState("");
  const [vencimento, setVencimento] = useState("");
  const [saving, setSaving] = useState(false);

  // Auto-fill when customer is selected
  useEffect(() => {
    if (!customerId) return;
    const customer = customers.find(c => c.id === customerId);
    if (!customer) return;

    // Set vencimento based on dia_vencimento
    const now = new Date();
    let year = now.getFullYear();
    let month = now.getMonth(); // 0-indexed
    const dia = customer.dia_vencimento;

    // If day already passed this month, use next month
    if (now.getDate() > dia) {
      month += 1;
      if (month > 11) {
        month = 0;
        year += 1;
      }
    }

    // Clamp to last day of month
    const lastDay = new Date(year, month + 1, 0).getDate();
    const finalDia = Math.min(dia, lastDay);
    const dateStr = `${year}-${String(month + 1).padStart(2, "0")}-${String(finalDia).padStart(2, "0")}`;
    setVencimento(dateStr);

    // Set valor and descricao based on plan
    if (customer.plan_id) {
      const plan = plans.find(p => p.id === customer.plan_id);
      if (plan) {
        const valorCentavos = plan.valor_centavos - (customer.desconto_especial_centavos || 0);
        setValor((Math.max(valorCentavos, 0) / 100).toFixed(2).replace(".", ","));

        // Auto description
        const monthNames = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
        setDescricao(`Mensalidade Internet - ${monthNames[month]} de ${year}`);
      }
    }
  }, [customerId, customers, plans]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);

    const valorNum = parseFloat(valor.replace(",", "."));
    const centavos = Math.round(valorNum * 100);

    const customer = customers.find(c => c.id === customerId);

    const success = await onSave({
      customer_id: customerId,
      descricao,
      valor_centavos: centavos,
      vencimento,
      plan_id: customer?.plan_id || undefined,
    });

    setSaving(false);
    if (success) {
      onOpenChange(false);
      setCustomerId("");
      setDescricao("");
      setValor("");
      setVencimento("");
    }
  };

  const defaultDate = () => {
    const d = new Date();
    d.setDate(d.getDate() + 7);
    return d.toISOString().slice(0, 10);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Gerar Boleto</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label>Cliente *</Label>
            <Select value={customerId} onValueChange={setCustomerId} required>
              <SelectTrigger>
                <SelectValue placeholder="Selecione o cliente" />
              </SelectTrigger>
              <SelectContent>
                {customers.filter(c => !c.cortesia).map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.nome} — {c.cpf}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="descricao">Descrição *</Label>
            <Input
              id="descricao"
              value={descricao}
              onChange={(e) => setDescricao(e.target.value)}
              placeholder="Ex: Mensalidade Internet - Janeiro/2026"
              required
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="valor">Valor (R$) *</Label>
              <Input
                id="valor"
                value={valor}
                onChange={(e) => setValor(e.target.value)}
                placeholder="89,90"
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="vencimento">Vencimento *</Label>
              <Input
                id="vencimento"
                type="date"
                value={vencimento || defaultDate()}
                onChange={(e) => setVencimento(e.target.value)}
                required
              />
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={saving || !customerId}>
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Gerar Boleto
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
