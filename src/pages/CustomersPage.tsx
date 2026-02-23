import { useState, useMemo } from "react";
import { useCustomers } from "@/hooks/useCustomers";
import { useInvoices } from "@/hooks/useInvoices";
import { usePlans } from "@/hooks/usePlans";
import type { Customer } from "@/hooks/useCustomers";
import CustomerTable from "@/components/CustomerTable";
import CustomerFormDialog from "@/components/CustomerFormDialog";
import CSVImportDialog from "@/components/CSVImportDialog";
import CustomerDetailDialog from "@/components/CustomerDetailDialog";
import NoInvoiceNotificationDialog from "@/components/NoInvoiceNotificationDialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Plus, Search, Download, Loader2, Upload, AlertTriangle, Zap, Filter, MessageCircle } from "lucide-react";
import { toast } from "sonner";

export default function CustomersPage() {
  const { customers, loading, searchTerm, setSearchTerm, addCustomer, updateCustomer, deleteCustomer, toggleCustomerActive, exportCSV, bulkImport, refetch: refetchCustomers } = useCustomers();
  const { allInvoices, createBoleto, refetch: refetchInvoices } = useInvoices();
  const { plans } = usePlans();

  const [formOpen, setFormOpen] = useState(false);
  const [editingCustomer, setEditingCustomer] = useState<Customer | null>(null);
  const [deletingCustomer, setDeletingCustomer] = useState<Customer | null>(null);
  const [csvImportOpen, setCsvImportOpen] = useState(false);
  const [detailCustomer, setDetailCustomer] = useState<Customer | null>(null);
  const [filterNoBoleto, setFilterNoBoleto] = useState(false);
  const [filterNoPlan, setFilterNoPlan] = useState(false);
  const [notifyNoBoletoOpen, setNotifyNoBoletoOpen] = useState(false);
  const [bulkGenerating, setBulkGenerating] = useState(false);
  const [customerActiveFilter, setCustomerActiveFilter] = useState<string>("active");

  const customerIdsWithInvoiceThisMonth = useMemo(() => {
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth();
    const nextMonth = month === 11 ? 0 : month + 1;
    const nextYear = month === 11 ? year + 1 : year;
    const ids = new Set<string>();
    for (const inv of allInvoices) {
      if (inv.status === "cancelled") continue;
      const d = new Date(inv.vencimento + "T12:00:00");
      const invYear = d.getFullYear();
      const invMonth = d.getMonth();
      if ((invYear === year && invMonth === month) || (invYear === nextYear && invMonth === nextMonth)) {
        ids.add(inv.customer_id);
      }
    }
    return ids;
  }, [allInvoices]);

  const activeCustomersWithoutBoleto = useMemo(() => {
    const now = new Date();
    const currentMonthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    return customers.filter(c => {
      if (!c.ativo) return false;
      if (customerIdsWithInvoiceThisMonth.has(c.id)) return false;
      if (c.pago_ate) {
        const pagoAte = new Date(c.pago_ate + "T12:00:00");
        if (pagoAte >= currentMonthEnd) return false;
      }
      return true;
    });
  }, [customers, customerIdsWithInvoiceThisMonth]);

  const activeCustomersWithoutPlan = useMemo(() => {
    return customers.filter(c => c.ativo && !c.plan_id);
  }, [customers]);

  const displayedCustomers = useMemo(() => {
    let filtered = customers;
    if (customerActiveFilter === "active") filtered = filtered.filter(c => c.ativo);
    else if (customerActiveFilter === "inactive") filtered = filtered.filter(c => !c.ativo);
    if (filterNoBoleto) {
      filtered = filtered.filter(c => {
        if (!c.ativo) return false;
        if (customerIdsWithInvoiceThisMonth.has(c.id)) return false;
        if (c.pago_ate) {
          const now = new Date();
          const currentMonthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0);
          const pagoAte = new Date(c.pago_ate + "T12:00:00");
          if (pagoAte >= currentMonthEnd) return false;
        }
        return true;
      });
    }
    if (filterNoPlan) filtered = filtered.filter(c => c.ativo && !c.plan_id);
    return filtered;
  }, [customers, customerActiveFilter, filterNoBoleto, filterNoPlan, customerIdsWithInvoiceThisMonth]);

  const handleEdit = (customer: Customer) => {
    setEditingCustomer(customer);
    setFormOpen(true);
  };

  const handleNewCustomer = () => {
    setEditingCustomer(null);
    setFormOpen(true);
  };

  const handleConfirmDelete = async () => {
    if (deletingCustomer) {
      await deleteCustomer(deletingCustomer.id);
      setDeletingCustomer(null);
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">Clientes</h2>
        <p className="text-muted-foreground">Gerencie seus clientes cadastrados</p>
      </div>

      {activeCustomersWithoutBoleto.length > 0 && !loading && (
        <div className="flex items-center gap-3 rounded-lg border border-destructive/30 bg-destructive/5 p-3">
          <AlertTriangle className="h-5 w-5 text-destructive shrink-0" />
          <div className="flex-1 text-sm">
            <strong>{activeCustomersWithoutBoleto.length}</strong> cliente{activeCustomersWithoutBoleto.length !== 1 ? "s" : ""} ativo{activeCustomersWithoutBoleto.length !== 1 ? "s" : ""} sem boleto emitido no mês atual.
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => setNotifyNoBoletoOpen(true)}>
              <MessageCircle className="mr-1.5 h-3.5 w-3.5" /> Notificar
            </Button>
            <Button variant="outline" size="sm" onClick={() => setFilterNoBoleto(!filterNoBoleto)}>
              <Filter className="mr-1.5 h-3.5 w-3.5" /> {filterNoBoleto ? "Mostrar todos" : "Filtrar"}
            </Button>
            <Button
              variant="destructive"
              size="sm"
              disabled={bulkGenerating || plans.length === 0}
              onClick={async () => {
                if (plans.length === 0) { toast.error("Cadastre pelo menos um plano antes de gerar boletos em lote"); return; }
                const now = new Date();
                const mesNome = now.toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
                setBulkGenerating(true);
                let success = 0, failed = 0;
                for (const c of activeCustomersWithoutBoleto) {
                  const customerPlan = plans.find(p => p.id === c.plan_id && p.ativo);
                  const planToUse = customerPlan || plans.find(p => p.ativo) || plans[0];
                  const diaVenc = c.dia_vencimento || 10;
                  let vencMonth = now.getMonth(), vencYear = now.getFullYear();
                  if (now.getDate() > diaVenc) { vencMonth += 1; if (vencMonth > 11) { vencMonth = 0; vencYear++; } }
                  const vencimento = new Date(vencYear, vencMonth, diaVenc).toISOString().slice(0, 10);
                  const valorFinal = customerPlan ? Math.max(0, customerPlan.valor_centavos - (c.desconto_especial_centavos || 0)) : planToUse.valor_centavos;
                  const ok = await createBoleto({ customer_id: c.id, descricao: `Mensalidade Internet - ${mesNome}`, valor_centavos: valorFinal, vencimento, plan_id: planToUse.id });
                  if (ok) success++; else failed++;
                }
                setBulkGenerating(false);
                toast.success(`Boletos gerados: ${success} sucesso, ${failed} falha(s)`);
                refetchInvoices();
              }}
            >
              {bulkGenerating ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Zap className="mr-1.5 h-3.5 w-3.5" />}
              Gerar em lote
            </Button>
          </div>
        </div>
      )}

      {activeCustomersWithoutPlan.length > 0 && !loading && (
        <div className="flex items-center gap-3 rounded-lg border border-yellow-500/30 bg-yellow-500/5 p-3">
          <AlertTriangle className="h-5 w-5 text-yellow-600 shrink-0" />
          <div className="flex-1 text-sm">
            <strong>{activeCustomersWithoutPlan.length}</strong> cliente{activeCustomersWithoutPlan.length !== 1 ? "s" : ""} ativo{activeCustomersWithoutPlan.length !== 1 ? "s" : ""} sem plano configurado.
          </div>
          <Button variant="outline" size="sm" onClick={() => setFilterNoPlan(!filterNoPlan)}>
            <Filter className="mr-1.5 h-3.5 w-3.5" /> {filterNoPlan ? "Mostrar todos" : "Filtrar"}
          </Button>
        </div>
      )}

      <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center justify-between">
        <div className="flex items-center gap-3 w-full sm:w-auto">
          <div className="relative w-full sm:max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input placeholder="Buscar por nome, CPF ou usuário PPPoE..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} className="pl-9" />
          </div>
          <Select value={customerActiveFilter} onValueChange={setCustomerActiveFilter}>
            <SelectTrigger className="w-36"><SelectValue placeholder="Status" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos</SelectItem>
              <SelectItem value="active">Ativos</SelectItem>
              <SelectItem value="inactive">Inativos</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="flex gap-2 w-full sm:w-auto">
          <Button variant="outline" onClick={exportCSV} className="flex-1 sm:flex-none">
            <Download className="mr-2 h-4 w-4" /> Exportar CSV
          </Button>
          <Button variant="outline" onClick={() => {
            if (customers.length === 0) { toast.error("Nenhum cliente"); return; }
            const headers = ["Usuário PPPoE", "Senha PPPoE", "Status", "Nome", "CPF"];
            const rows = customers.map(c => [c.usuario_pppoe, c.senha_pppoe, c.ativo ? "Ativo" : "Inativo", c.nome, c.cpf]);
            const csv = [headers.join(";"), ...rows.map(r => r.join(";"))].join("\n");
            const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
            const url = URL.createObjectURL(blob);
            const link = document.createElement("a");
            link.href = url;
            link.download = `pppoe_status_${new Date().toISOString().slice(0, 10)}.csv`;
            link.click();
            URL.revokeObjectURL(url);
            toast.success("Lista PPPoE exportada!");
          }} className="flex-1 sm:flex-none">
            <Download className="mr-2 h-4 w-4" /> PPPoE Status
          </Button>
          <Button variant="outline" onClick={() => setCsvImportOpen(true)} className="flex-1 sm:flex-none">
            <Upload className="mr-2 h-4 w-4" /> Importar CSV
          </Button>
          <Button onClick={handleNewCustomer} className="flex-1 sm:flex-none">
            <Plus className="mr-2 h-4 w-4" /> Novo Cliente
          </Button>
        </div>
      </div>

      <div className="flex items-center gap-4 text-sm text-muted-foreground">
        <span>{displayedCustomers.length} cliente{displayedCustomers.length !== 1 ? "s" : ""}{filterNoBoleto ? " sem boleto" : " cadastrado" + (displayedCustomers.length !== 1 ? "s" : "")}</span>
      </div>

      {loading ? (
        <div className="flex justify-center py-16"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>
      ) : (
        <CustomerTable customers={displayedCustomers} onEdit={handleEdit} onDelete={setDeletingCustomer} onToggleActive={toggleCustomerActive} onDetail={setDetailCustomer} customerIdsWithInvoice={customerIdsWithInvoiceThisMonth} plans={plans} />
      )}

      <CustomerFormDialog open={formOpen} onOpenChange={setFormOpen} customer={editingCustomer} onSave={addCustomer} onUpdate={updateCustomer} plans={plans} />
      <CSVImportDialog open={csvImportOpen} onOpenChange={setCsvImportOpen} onImport={bulkImport} existingCpfs={customers.map(c => c.cpf)} plans={plans} allInvoices={allInvoices} onUpdateCustomer={updateCustomer} existingCustomers={customers.map(c => ({ id: c.id, cpf: c.cpf }))} />
      <CustomerDetailDialog open={!!detailCustomer} onOpenChange={(open) => !open && setDetailCustomer(null)} customer={detailCustomer} onCustomerUpdated={refetchCustomers} />
      <AlertDialog open={!!deletingCustomer} onOpenChange={(open) => !open && setDeletingCustomer(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir cliente</AlertDialogTitle>
            <AlertDialogDescription>Tem certeza que deseja excluir <strong>{deletingCustomer?.nome}</strong>? Esta ação não pode ser desfeita.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirmDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">Excluir</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <NoInvoiceNotificationDialog open={notifyNoBoletoOpen} onOpenChange={setNotifyNoBoletoOpen} customers={activeCustomersWithoutBoleto} />
    </div>
  );
}
