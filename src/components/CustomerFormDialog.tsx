import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2 } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import type { Customer, CustomerInput } from "@/hooks/useCustomers";
import type { Plan } from "@/hooks/usePlans";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  customer?: Customer | null;
  onSave: (data: CustomerInput) => Promise<boolean>;
  onUpdate?: (id: string, data: Partial<CustomerInput>) => Promise<boolean>;
  plans?: Plan[];
}

const formatCPF = (value: string) => {
  const digits = value.replace(/\D/g, "").slice(0, 11);
  return digits
    .replace(/(\d{3})(\d)/, "$1.$2")
    .replace(/(\d{3})(\d)/, "$1.$2")
    .replace(/(\d{3})(\d{1,2})$/, "$1-$2");
};

const formatPhone = (value: string) => {
  const digits = value.replace(/\D/g, "").slice(0, 11);
  if (digits.length <= 10) {
    return digits.replace(/(\d{2})(\d)/, "($1) $2").replace(/(\d{4})(\d)/, "$1-$2");
  }
  return digits.replace(/(\d{2})(\d)/, "($1) $2").replace(/(\d{5})(\d)/, "$1-$2");
};

const formatCEP = (value: string) => {
  const digits = value.replace(/\D/g, "").slice(0, 8);
  return digits.replace(/(\d{5})(\d)/, "$1-$2");
};

const formatCurrency = (cents: number) =>
  (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

export default function CustomerFormDialog({ open, onOpenChange, customer, onSave, onUpdate, plans = [] }: Props) {
  const [form, setForm] = useState<CustomerInput & { cortesia: boolean }>({
    nome: "", cpf: "", email: "", telefone: "", usuario_pppoe: "", senha_pppoe: "",
    rua: null, numero: null, complemento: null, bairro: null, cidade: null, estado: null, cep: null,
    dia_vencimento: 10, plan_id: null, desconto_especial_centavos: 0, cortesia: false,
  });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (customer) {
      setForm({
        nome: customer.nome, cpf: customer.cpf, email: customer.email,
        telefone: customer.telefone || "", usuario_pppoe: customer.usuario_pppoe, senha_pppoe: customer.senha_pppoe,
        rua: customer.rua || null, numero: customer.numero || null, complemento: customer.complemento || null,
        bairro: customer.bairro || null, cidade: customer.cidade || null, estado: customer.estado || null, cep: customer.cep || null,
        dia_vencimento: customer.dia_vencimento, plan_id: customer.plan_id, desconto_especial_centavos: customer.desconto_especial_centavos,
        cortesia: customer.cortesia ?? false,
      });
    } else {
      setForm({
        nome: "", cpf: "", email: "", telefone: "", usuario_pppoe: "", senha_pppoe: "",
        rua: null, numero: null, complemento: null, bairro: null, cidade: null, estado: null, cep: null,
        dia_vencimento: 10, plan_id: null, desconto_especial_centavos: 0, cortesia: false,
      });
    }
  }, [customer, open]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    const cleanCPF = form.cpf.replace(/\D/g, "");
    const data = { ...form, cpf: cleanCPF, telefone: form.telefone || null };

    let success = false;
    if (customer && onUpdate) {
      success = await onUpdate(customer.id, data);
    } else {
      success = await onSave(data as CustomerInput);
    }
    setSaving(false);
    if (success) onOpenChange(false);
  };

  const activePlans = plans.filter(p => p.ativo);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{customer ? "Editar Cliente" : "Novo Cliente"}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="nome">Nome completo *</Label>
              <Input id="nome" value={form.nome} onChange={(e) => setForm({ ...form, nome: e.target.value })} required maxLength={100} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="cpf">CPF *</Label>
              <Input id="cpf" value={form.cpf} onChange={(e) => setForm({ ...form, cpf: formatCPF(e.target.value) })} placeholder="000.000.000-00" required maxLength={14} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="email">E-mail *</Label>
              <Input id="email" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required maxLength={255} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="telefone">Telefone</Label>
              <Input id="telefone" value={form.telefone || ""} onChange={(e) => setForm({ ...form, telefone: formatPhone(e.target.value) })} placeholder="(00) 00000-0000" maxLength={15} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="usuario_pppoe">Usuário PPPoE *</Label>
              <Input id="usuario_pppoe" value={form.usuario_pppoe} onChange={(e) => setForm({ ...form, usuario_pppoe: e.target.value })} required maxLength={50} />
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="senha_pppoe">Senha PPPoE *</Label>
              <Input id="senha_pppoe" value={form.senha_pppoe} onChange={(e) => setForm({ ...form, senha_pppoe: e.target.value })} required maxLength={50} />
            </div>
          </div>

          {/* Faturamento */}
          <div className="border-t pt-4">
            <p className="text-sm font-medium mb-3 text-muted-foreground">Faturamento</p>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="plan_id">Plano</Label>
                <Select
                  value={form.plan_id || "none"}
                  onValueChange={(v) => setForm({ ...form, plan_id: v === "none" ? null : v })}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Selecione um plano" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Nenhum</SelectItem>
                    {activePlans.map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.nome} — {formatCurrency(p.valor_centavos)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="dia_vencimento">Dia de vencimento</Label>
                <Select
                  value={String(form.dia_vencimento)}
                  onValueChange={(v) => setForm({ ...form, dia_vencimento: Number(v) })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Array.from({ length: 28 }, (_, i) => i + 1).map((d) => (
                      <SelectItem key={d} value={String(d)}>{d}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2 sm:col-span-2">
                <Label htmlFor="desconto_especial">Desconto especial (pagamento antecipado)</Label>
                <div className="flex items-center gap-2">
                  <span className="text-sm text-muted-foreground">R$</span>
                  <Input
                    id="desconto_especial"
                    type="number"
                    min={0}
                    step={0.01}
                    value={(form.desconto_especial_centavos / 100).toFixed(2)}
                    onChange={(e) => setForm({ ...form, desconto_especial_centavos: Math.round(Number(e.target.value) * 100) })}
                    placeholder="0.00"
                  />
                </div>
                <p className="text-xs text-muted-foreground">Desconto adicional ao do plano para este cliente</p>
              </div>
              <div className="flex items-center justify-between sm:col-span-2 rounded-lg border p-3 bg-muted/30">
                <div>
                  <Label htmlFor="cortesia" className="text-sm font-medium">Cortesia</Label>
                  <p className="text-xs text-muted-foreground">Cliente cortesia não gera boleto</p>
                </div>
                <Switch
                  id="cortesia"
                  checked={form.cortesia}
                  onCheckedChange={(checked) => setForm({ ...form, cortesia: checked })}
                />
              </div>
            </div>
          </div>

          {/* Endereço */}
          <div className="border-t pt-4">
            <p className="text-sm font-medium mb-3 text-muted-foreground">Endereço</p>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2 sm:col-span-2">
                <Label htmlFor="rua">Rua</Label>
                <Input id="rua" value={form.rua || ""} onChange={(e) => setForm({ ...form, rua: e.target.value || null })} maxLength={200} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="numero">Número</Label>
                <Input id="numero" value={form.numero || ""} onChange={(e) => setForm({ ...form, numero: e.target.value || null })} maxLength={20} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="complemento">Complemento</Label>
                <Input id="complemento" value={form.complemento || ""} onChange={(e) => setForm({ ...form, complemento: e.target.value || null })} maxLength={100} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="bairro">Bairro</Label>
                <Input id="bairro" value={form.bairro || ""} onChange={(e) => setForm({ ...form, bairro: e.target.value || null })} maxLength={100} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="cidade">Cidade</Label>
                <Input id="cidade" value={form.cidade || ""} onChange={(e) => setForm({ ...form, cidade: e.target.value || null })} maxLength={100} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="estado">Estado</Label>
                <Input id="estado" value={form.estado || ""} onChange={(e) => setForm({ ...form, estado: e.target.value.toUpperCase() || null })} placeholder="UF" maxLength={2} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="cep">CEP</Label>
                <Input id="cep" value={form.cep || ""} onChange={(e) => setForm({ ...form, cep: formatCEP(e.target.value) })} placeholder="00000-000" maxLength={9} />
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
            <Button type="submit" disabled={saving}>
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {customer ? "Salvar" : "Cadastrar"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
