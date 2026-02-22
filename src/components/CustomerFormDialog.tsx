import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2 } from "lucide-react";
import type { Customer, CustomerInput } from "@/hooks/useCustomers";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  customer?: Customer | null;
  onSave: (data: CustomerInput) => Promise<boolean>;
  onUpdate?: (id: string, data: Partial<CustomerInput>) => Promise<boolean>;
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

export default function CustomerFormDialog({ open, onOpenChange, customer, onSave, onUpdate }: Props) {
  const [form, setForm] = useState<CustomerInput>({
    nome: "", cpf: "", email: "", telefone: "", usuario_pppoe: "", senha_pppoe: "",
  });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (customer) {
      setForm({
        nome: customer.nome,
        cpf: customer.cpf,
        email: customer.email,
        telefone: customer.telefone || "",
        usuario_pppoe: customer.usuario_pppoe,
        senha_pppoe: customer.senha_pppoe,
      });
    } else {
      setForm({ nome: "", cpf: "", email: "", telefone: "", usuario_pppoe: "", senha_pppoe: "" });
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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
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
