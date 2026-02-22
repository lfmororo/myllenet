import { useState, useMemo } from "react";
import { useAuth } from "@/hooks/useAuth";
import { useCustomers } from "@/hooks/useCustomers";
import { useInvoices } from "@/hooks/useInvoices";
import { usePlans } from "@/hooks/usePlans";
import type { Customer } from "@/hooks/useCustomers";
import CustomerTable from "@/components/CustomerTable";
import CustomerFormDialog from "@/components/CustomerFormDialog";
import CSVImportDialog from "@/components/CSVImportDialog";
import InvoiceTable from "@/components/InvoiceTable";
import CreateBoletoDialog from "@/components/CreateBoletoDialog";
import CustomerDetailDialog from "@/components/CustomerDetailDialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Wifi, Plus, Search, Download, LogOut, Loader2, ShieldAlert, FileText, Import, Settings as SettingsIcon, Upload, AlertTriangle, Zap, Filter } from "lucide-react";
import { Navigate, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

export default function Dashboard() {
  const { user, isAdmin, loading: authLoading, signOut } = useAuth();
  const navigate = useNavigate();
  const { customers, loading, searchTerm, setSearchTerm, addCustomer, updateCustomer, deleteCustomer, toggleCustomerActive, exportCSV, bulkImport } = useCustomers();
  const { invoices, allInvoices, loading: invoicesLoading, invoiceSearch, setInvoiceSearch, createBoleto, checkPayment, cancelInvoice, importFromEfi, refetch: refetchInvoices } = useInvoices();
  const { plans } = usePlans();

  const [formOpen, setFormOpen] = useState(false);
  const [editingCustomer, setEditingCustomer] = useState<Customer | null>(null);
  const [deletingCustomer, setDeletingCustomer] = useState<Customer | null>(null);
  const [boletoOpen, setBoletoOpen] = useState(false);
  const [csvImportOpen, setCsvImportOpen] = useState(false);
  const [detailCustomer, setDetailCustomer] = useState<Customer | null>(null);
  const [importing, setImporting] = useState(false);
  const [filterNoBoleto, setFilterNoBoleto] = useState(false);
  const [bulkGenerating, setBulkGenerating] = useState(false);
  const [bulkCheckingEfi, setBulkCheckingEfi] = useState(false);
  const [bulkCheckProgress, setBulkCheckProgress] = useState({ done: 0, total: 0, imported: 0 });
  // Compute which customers have invoices this month
  const customerIdsWithInvoiceThisMonth = useMemo(() => {
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth();
    const ids = new Set<string>();
    for (const inv of allInvoices) {
      if (inv.status === "cancelled") continue;
      const d = new Date(inv.vencimento + "T12:00:00");
      if (d.getFullYear() === year && d.getMonth() === month) {
        ids.add(inv.customer_id);
      }
    }
    return ids;
  }, [allInvoices]);

  const activeCustomersWithoutBoleto = useMemo(() => {
    return customers.filter(c => c.ativo && !customerIdsWithInvoiceThisMonth.has(c.id));
  }, [customers, customerIdsWithInvoiceThisMonth]);

  const displayedCustomers = filterNoBoleto
    ? customers.filter(c => !customerIdsWithInvoiceThisMonth.has(c.id))
    : customers;

  if (authLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!user) return <Navigate to="/auth" replace />;

  if (!isAdmin) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-4">
        <div className="text-center space-y-4 max-w-md">
          <ShieldAlert className="mx-auto h-16 w-16 text-destructive" />
          <h1 className="text-2xl font-bold">Acesso Restrito</h1>
          <p className="text-muted-foreground">
            Sua conta não possui permissão de administrador. Solicite acesso ao administrador do sistema.
          </p>
          <Button variant="outline" onClick={signOut}>Sair</Button>
        </div>
      </div>
    );
  }

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
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b bg-card sticky top-0 z-10">
        <div className="container mx-auto flex items-center justify-between px-4 py-3">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary text-primary-foreground">
              <Wifi className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-lg font-bold leading-tight">Myllenet</h1>
              <p className="text-xs text-muted-foreground">Gerenciamento de Clientes</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="hidden sm:inline text-sm text-muted-foreground">{user.email}</span>
            <Button variant="ghost" size="icon" onClick={() => navigate("/settings")} title="Configurações">
              <SettingsIcon className="h-4 w-4" />
            </Button>
            <Button variant="ghost" size="icon" onClick={signOut} title="Sair">
              <LogOut className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </header>

      {/* Main */}
      <main className="container mx-auto px-4 py-6 space-y-4">
        <Tabs defaultValue="customers">
          <TabsList>
            <TabsTrigger value="customers">Clientes</TabsTrigger>
            <TabsTrigger value="billing">
              <FileText className="mr-1.5 h-4 w-4" />
              Cobranças
            </TabsTrigger>
          </TabsList>

          {/* Customers Tab */}
          <TabsContent value="customers" className="space-y-4">
            {/* Alert for customers without boleto */}
            {activeCustomersWithoutBoleto.length > 0 && !loading && (
              <div className="flex items-center gap-3 rounded-lg border border-destructive/30 bg-destructive/5 p-3">
                <AlertTriangle className="h-5 w-5 text-destructive shrink-0" />
                <div className="flex-1 text-sm">
                  <strong>{activeCustomersWithoutBoleto.length}</strong> cliente{activeCustomersWithoutBoleto.length !== 1 ? "s" : ""} ativo{activeCustomersWithoutBoleto.length !== 1 ? "s" : ""} sem boleto emitido no mês atual.
                </div>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setFilterNoBoleto(!filterNoBoleto)}
                  >
                    <Filter className="mr-1.5 h-3.5 w-3.5" />
                    {filterNoBoleto ? "Mostrar todos" : "Filtrar"}
                  </Button>
                  <Button
                    variant="destructive"
                    size="sm"
                    disabled={bulkGenerating || plans.length === 0}
                    onClick={async () => {
                      if (plans.length === 0) {
                        toast.error("Cadastre pelo menos um plano antes de gerar boletos em lote");
                        return;
                      }
                      const defaultPlan = plans.find(p => p.ativo) || plans[0];
                      const now = new Date();
                      const vencimento = new Date(now.getFullYear(), now.getMonth() + 1, 10).toISOString().slice(0, 10);
                      const mesNome = now.toLocaleDateString("pt-BR", { month: "long", year: "numeric" });

                      setBulkGenerating(true);
                      let success = 0;
                      let failed = 0;
                      for (const c of activeCustomersWithoutBoleto) {
                        const ok = await createBoleto({
                          customer_id: c.id,
                          descricao: `Mensalidade Internet - ${mesNome}`,
                          valor_centavos: defaultPlan.valor_centavos,
                          vencimento,
                          plan_id: defaultPlan.id,
                        });
                        if (ok) success++;
                        else failed++;
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

            <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center justify-between">
              <div className="relative w-full sm:max-w-sm">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Buscar por nome, CPF ou usuário PPPoE..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-9"
                />
              </div>
              <div className="flex gap-2 w-full sm:w-auto">
                <Button variant="outline" onClick={exportCSV} className="flex-1 sm:flex-none">
                  <Download className="mr-2 h-4 w-4" /> Exportar CSV
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
              <div className="flex justify-center py-16">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
              </div>
            ) : (
              <CustomerTable
                customers={displayedCustomers}
                onEdit={handleEdit}
                onDelete={setDeletingCustomer}
                onToggleActive={toggleCustomerActive}
                onDetail={setDetailCustomer}
                customerIdsWithInvoice={customerIdsWithInvoiceThisMonth}
              />
            )}
          </TabsContent>

          {/* Billing Tab */}
          <TabsContent value="billing" className="space-y-4">
            <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="relative w-full sm:w-72">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="Buscar por cliente ou usuário PPPoE..."
                    value={invoiceSearch}
                    onChange={(e) => setInvoiceSearch(e.target.value)}
                    className="pl-9"
                  />
                </div>
                <span className="text-sm text-muted-foreground whitespace-nowrap">
                  {invoices.length} fatura{invoices.length !== 1 ? "s" : ""}
                </span>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  disabled={importing}
                  onClick={async () => {
                    setImporting(true);
                    await importFromEfi();
                    setSearchTerm(searchTerm);
                    setImporting(false);
                  }}
                >
                  {importing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Import className="mr-2 h-4 w-4" />}
                  Importar da EFI
                </Button>
                <Button
                  variant="outline"
                  disabled={bulkCheckingEfi}
                  onClick={async () => {
                    const activeCustomers = customers.filter(c => c.ativo);
                    if (activeCustomers.length === 0) {
                      toast.error("Nenhum cliente ativo para consultar");
                      return;
                    }
                    setBulkCheckingEfi(true);
                    setBulkCheckProgress({ done: 0, total: activeCustomers.length, imported: 0 });

                    const { data: sessionData } = await supabase.auth.getSession();
                    const token = sessionData?.session?.access_token;
                    if (!token) { toast.error("Sessão expirada"); setBulkCheckingEfi(false); return; }

                    const projectId = import.meta.env.VITE_SUPABASE_PROJECT_ID;
                    let totalImported = 0;

                    for (let i = 0; i < activeCustomers.length; i++) {
                      const c = activeCustomers[i];
                      try {
                        const response = await fetch(
                          `https://${projectId}.supabase.co/functions/v1/efi-boleto/check-customer?customer_id=${c.id}`,
                          {
                            headers: {
                              Authorization: `Bearer ${token}`,
                              apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
                            },
                          }
                        );
                        const result = await response.json();
                        if (response.ok && result.imported > 0) {
                          totalImported += result.imported;
                        }
                      } catch (e) {
                        console.error(`Erro ao consultar EFI para ${c.nome}:`, e);
                      }
                      setBulkCheckProgress({ done: i + 1, total: activeCustomers.length, imported: totalImported });
                    }

                    setBulkCheckingEfi(false);
                    toast.success(`Consulta concluída! ${totalImported} cobrança(s) importada(s) de ${activeCustomers.length} clientes.`);
                    refetchInvoices();
                  }}
                >
                  {bulkCheckingEfi ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      {bulkCheckProgress.done}/{bulkCheckProgress.total}
                    </>
                  ) : (
                    <>
                      <Search className="mr-2 h-4 w-4" />
                      Consultar EFI (todos)
                    </>
                  )}
                </Button>
                <Button onClick={() => setBoletoOpen(true)}>
                  <Plus className="mr-2 h-4 w-4" /> Gerar Boleto
                </Button>
              </div>
            </div>
            {invoicesLoading ? (
              <div className="flex justify-center py-16">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
              </div>
            ) : (
              <InvoiceTable
                invoices={invoices}
                onCheckPayment={checkPayment}
                onCancel={cancelInvoice}
              />
            )}
          </TabsContent>
        </Tabs>
      </main>

      {/* Customer Form */}
      <CustomerFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        customer={editingCustomer}
        onSave={addCustomer}
        onUpdate={updateCustomer}
        plans={plans}
      />

      {/* Boleto Form */}
      <CreateBoletoDialog
        open={boletoOpen}
        onOpenChange={setBoletoOpen}
        customers={customers}
        onSave={createBoleto}
      />

      {/* CSV Import */}
      <CSVImportDialog
        open={csvImportOpen}
        onOpenChange={setCsvImportOpen}
        onImport={bulkImport}
        existingCpfs={customers.map((c) => c.cpf)}
      />

      {/* Customer Detail */}
      <CustomerDetailDialog
        open={!!detailCustomer}
        onOpenChange={(open) => !open && setDetailCustomer(null)}
        customer={detailCustomer}
      />

      {/* Delete confirmation */}
      <AlertDialog open={!!deletingCustomer} onOpenChange={(open) => !open && setDeletingCustomer(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir cliente</AlertDialogTitle>
            <AlertDialogDescription>
              Tem certeza que deseja excluir <strong>{deletingCustomer?.nome}</strong>? Esta ação não pode ser desfeita.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirmDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
