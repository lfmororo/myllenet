import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2 } from "lucide-react";
import type { Customer } from "@/hooks/useCustomers";
import type { CreateInvoiceInput } from "@/hooks/useInvoices";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  customers: Customer[];
  onSave: (data: CreateInvoiceInput) => Promise<boolean>;
}

export default function CreateBoletoDialog({ open, onOpenChange, customers, onSave }: Props) {
  const [customerId, setCustomerId] = useState("");
  const [descricao, setDescricao] = useState("");
  const [valor, setValor] = useState("");
  const [vencimento, setVencimento] = useState("");
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);

    // Parse value: user types "89.90", we need 8990 centavos
    const valorNum = parseFloat(valor.replace(",", "."));
    const centavos = Math.round(valorNum * 100);

    const success = await onSave({
      customer_id: customerId,
      descricao,
      valor_centavos: centavos,
      vencimento,
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

  // Default to 7 days from now
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
                {customers.map((c) => (
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
