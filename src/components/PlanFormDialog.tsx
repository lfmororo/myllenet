import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Loader2 } from "lucide-react";
import type { Plan, PlanInput } from "@/hooks/usePlans";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  plan?: Plan | null;
  onSave: (data: PlanInput) => Promise<boolean>;
  onUpdate?: (id: string, data: Partial<PlanInput>) => Promise<boolean>;
}

const emptyForm: PlanInput = {
  nome: "",
  nome_servidor: null,
  descricao: null,
  valor_centavos: 0,
  intervalo_meses: 1,
  ativo: true,
  desconto_centavos: 0,
  dias_desconto: 0,
  juros_mensal: 0,
  multa_centavos: 0,
};

export default function PlanFormDialog({ open, onOpenChange, plan, onSave, onUpdate }: Props) {
  const [form, setForm] = useState<PlanInput>(emptyForm);
  const [saving, setSaving] = useState(false);

  // Display helpers: convert centavos to BRL string
  const centavosToDisplay = (v: number) => (v / 100).toFixed(2).replace(".", ",");
  const displayToCentavos = (s: string) => {
    const clean = s.replace(/[^\d,]/g, "").replace(",", ".");
    return Math.round(parseFloat(clean || "0") * 100);
  };

  useEffect(() => {
    if (plan) {
      setForm({
        nome: plan.nome,
        nome_servidor: plan.nome_servidor,
        descricao: plan.descricao,
        valor_centavos: plan.valor_centavos,
        intervalo_meses: plan.intervalo_meses,
        ativo: plan.ativo,
        desconto_centavos: plan.desconto_centavos,
        dias_desconto: plan.dias_desconto,
        juros_mensal: plan.juros_mensal,
        multa_centavos: plan.multa_centavos,
      });
    } else {
      setForm(emptyForm);
    }
  }, [plan, open]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    let success = false;
    if (plan && onUpdate) {
      success = await onUpdate(plan.id, form);
    } else {
      success = await onSave(form);
    }
    setSaving(false);
    if (success) onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{plan ? "Editar Plano" : "Novo Plano"}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="plan-nome">Nome do plano *</Label>
              <Input id="plan-nome" value={form.nome} onChange={(e) => setForm({ ...form, nome: e.target.value })} required maxLength={100} />
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="plan-desc">Descrição</Label>
              <Input id="plan-desc" value={form.descricao || ""} onChange={(e) => setForm({ ...form, descricao: e.target.value || null })} maxLength={200} />
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="plan-nome-servidor">Nome do plano no servidor</Label>
              <Input id="plan-nome-servidor" value={form.nome_servidor || ""} onChange={(e) => setForm({ ...form, nome_servidor: e.target.value || null })} maxLength={100} placeholder="Ex: plano_50mb" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="plan-valor">Valor (R$) *</Label>
              <Input
                id="plan-valor"
                defaultValue={centavosToDisplay(form.valor_centavos)}
                key={`valor-${plan?.id || "new"}-${open}`}
                onBlur={(e) => setForm({ ...form, valor_centavos: displayToCentavos(e.target.value) })}
                placeholder="0,00"
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="plan-intervalo">Intervalo (meses)</Label>
              <Input
                id="plan-intervalo"
                type="number"
                min={1}
                max={12}
                value={form.intervalo_meses}
                onChange={(e) => setForm({ ...form, intervalo_meses: parseInt(e.target.value) || 1 })}
              />
            </div>
          </div>

          <div className="border-t pt-4">
            <p className="text-sm font-medium mb-3 text-muted-foreground">Condições de pagamento</p>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="plan-desconto">Desconto antecipado (R$)</Label>
                <Input
                  id="plan-desconto"
                  defaultValue={centavosToDisplay(form.desconto_centavos)}
                  key={`desconto-${plan?.id || "new"}-${open}`}
                  onBlur={(e) => setForm({ ...form, desconto_centavos: displayToCentavos(e.target.value) })}
                  placeholder="0,00"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="plan-dias-desconto">Dias antes do vencimento</Label>
                <Input
                  id="plan-dias-desconto"
                  type="number"
                  min={0}
                  value={form.dias_desconto}
                  onChange={(e) => setForm({ ...form, dias_desconto: parseInt(e.target.value) || 0 })}
                  placeholder="0"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="plan-juros">Juros mensal (%)</Label>
                <Input
                  id="plan-juros"
                  type="number"
                  step="0.01"
                  min={0}
                  value={form.juros_mensal}
                  onChange={(e) => setForm({ ...form, juros_mensal: parseFloat(e.target.value) || 0 })}
                  placeholder="0,00"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="plan-multa">Multa por atraso (R$)</Label>
                <Input
                  id="plan-multa"
                  defaultValue={centavosToDisplay(form.multa_centavos)}
                  key={`multa-${plan?.id || "new"}-${open}`}
                  onBlur={(e) => setForm({ ...form, multa_centavos: displayToCentavos(e.target.value) })}
                  placeholder="0,00"
                />
              </div>
            </div>
          </div>

          <div className="flex items-center gap-3 border-t pt-4">
            <Switch checked={form.ativo} onCheckedChange={(checked) => setForm({ ...form, ativo: checked })} />
            <Label>Plano ativo</Label>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
            <Button type="submit" disabled={saving}>
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {plan ? "Salvar" : "Cadastrar"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
