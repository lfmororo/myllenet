import { useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { useCustomers } from "@/hooks/useCustomers";
import { useInvoices } from "@/hooks/useInvoices";
import type { Customer } from "@/hooks/useCustomers";
import CustomerTable from "@/components/CustomerTable";
import CustomerFormDialog from "@/components/CustomerFormDialog";
import CSVImportDialog from "@/components/CSVImportDialog";
import InvoiceTable from "@/components/InvoiceTable";
import CreateBoletoDialog from "@/components/CreateBoletoDialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Wifi, Plus, Search, Download, LogOut, Loader2, ShieldAlert, FileText, Import, Settings as SettingsIcon, Upload } from "lucide-react";
import { Navigate, useNavigate } from "react-router-dom";

export default function Dashboard() {
  const { user, isAdmin, loading: authLoading, signOut } = useAuth();
  const navigate = useNavigate();
  const { customers, loading, searchTerm, setSearchTerm, addCustomer, updateCustomer, deleteCustomer, exportCSV, bulkImport } = useCustomers();
  const { invoices, loading: invoicesLoading, createBoleto, checkPayment, cancelInvoice, importFromEfi } = useInvoices();

  const [formOpen, setFormOpen] = useState(false);
  const [editingCustomer, setEditingCustomer] = useState<Customer | null>(null);
  const [deletingCustomer, setDeletingCustomer] = useState<Customer | null>(null);
  const [boletoOpen, setBoletoOpen] = useState(false);
  const [csvImportOpen, setCsvImportOpen] = useState(false);
  const [importing, setImporting] = useState(false);

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
              <span>{customers.length} cliente{customers.length !== 1 ? "s" : ""} cadastrado{customers.length !== 1 ? "s" : ""}</span>
            </div>
            {loading ? (
              <div className="flex justify-center py-16">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
              </div>
            ) : (
              <CustomerTable customers={customers} onEdit={handleEdit} onDelete={setDeletingCustomer} />
            )}
          </TabsContent>

          {/* Billing Tab */}
          <TabsContent value="billing" className="space-y-4">
            <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center justify-between">
              <div className="text-sm text-muted-foreground">
                {invoices.length} fatura{invoices.length !== 1 ? "s" : ""}
              </div>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  disabled={importing}
                  onClick={async () => {
                    setImporting(true);
                    await importFromEfi();
                    // Also refresh customers list
                    setSearchTerm(searchTerm);
                    setImporting(false);
                  }}
                >
                  {importing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Import className="mr-2 h-4 w-4" />}
                  Importar da EFI
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
