import { useState } from "react";
import { useCustomers } from "@/hooks/useCustomers";
import { useInvoices } from "@/hooks/useInvoices";
import { usePlans } from "@/hooks/usePlans";
import InvoiceTable from "@/components/InvoiceTable";
import InvoiceCSVImportDialog from "@/components/InvoiceCSVImportDialog";
import CreateBoletoDialog from "@/components/CreateBoletoDialog";
import OverdueNotificationDialog from "@/components/OverdueNotificationDialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Search, Loader2, Import, Upload, RefreshCw, Clock, Filter } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

export default function BillingPage() {
  const { customers, addCustomer, updateCustomer, refetch: refetchCustomers } = useCustomers();
  const { invoices, allInvoices, loading: invoicesLoading, invoiceSearch, setInvoiceSearch, createBoleto, checkPayment, cancelInvoice, markAsPaid, importFromEfi, bulkImportInvoices, bulkCheckPayments, bulkChecking, refetch: refetchInvoices } = useInvoices();
  const { plans } = usePlans();

  const [boletoOpen, setBoletoOpen] = useState(false);
  const [invoiceCsvImportOpen, setInvoiceCsvImportOpen] = useState(false);
  const [importing, setImporting] = useState(false);
  const [notifyOverdueOpen, setNotifyOverdueOpen] = useState(false);
  const [bulkCheckingEfi, setBulkCheckingEfi] = useState(false);
  const [bulkCheckProgress, setBulkCheckProgress] = useState({ done: 0, total: 0, imported: 0 });
  const [invoiceStatusFilter, setInvoiceStatusFilter] = useState<string>("overdue");

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">Cobranças</h2>
        <p className="text-muted-foreground">Gerencie faturas e boletos</p>
      </div>

      <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="relative w-full sm:w-72">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input placeholder="Buscar por cliente ou usuário PPPoE..." value={invoiceSearch} onChange={(e) => setInvoiceSearch(e.target.value)} className="pl-9" />
          </div>
          <Select value={invoiceStatusFilter} onValueChange={setInvoiceStatusFilter}>
            <SelectTrigger className="w-40">
              <Filter className="mr-2 h-4 w-4" />
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos</SelectItem>
              <SelectItem value="overdue">Vencidos</SelectItem>
              <SelectItem value="pending">Pendentes</SelectItem>
              <SelectItem value="paid">Pagos</SelectItem>
              <SelectItem value="cancelled">Cancelados</SelectItem>
            </SelectContent>
          </Select>
          <span className="text-sm text-muted-foreground whitespace-nowrap">
            {invoices.filter(i => invoiceStatusFilter === "all" || i.status === invoiceStatusFilter).length} fatura{invoices.filter(i => invoiceStatusFilter === "all" || i.status === invoiceStatusFilter).length !== 1 ? "s" : ""}
          </span>
        </div>
        <div className="flex flex-wrap gap-2">
          
          <Button variant="outline" disabled={bulkChecking} onClick={() => bulkCheckPayments()}>
            {bulkChecking ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />} Verificar Pagamentos
          </Button>
          <Button variant="outline" onClick={() => setInvoiceCsvImportOpen(true)}>
            <Upload className="mr-2 h-4 w-4" /> Importar CSV
          </Button>
          <Button variant="outline" onClick={() => setNotifyOverdueOpen(true)}>
            <Clock className="mr-2 h-4 w-4" /> Notificar Atrasos
          </Button>
          <Button onClick={() => setBoletoOpen(true)}>
            <Plus className="mr-2 h-4 w-4" /> Gerar Boleto
          </Button>
        </div>
      </div>

      {invoicesLoading ? (
        <div className="flex justify-center py-16"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>
      ) : (
        <InvoiceTable invoices={invoiceStatusFilter === "all" ? invoices : invoices.filter(i => i.status === invoiceStatusFilter)} onCheckPayment={checkPayment} onCancel={cancelInvoice} onMarkAsPaid={markAsPaid} />
      )}

      <CreateBoletoDialog open={boletoOpen} onOpenChange={setBoletoOpen} customers={customers} plans={plans} onSave={createBoleto} />
      <InvoiceCSVImportDialog open={invoiceCsvImportOpen} onOpenChange={setInvoiceCsvImportOpen} customers={customers.map(c => ({ id: c.id, nome: c.nome, cpf: c.cpf }))} onImport={bulkImportInvoices} plans={plans} onUpdateCustomer={updateCustomer} onAddCustomer={addCustomer} onRefetchCustomers={async () => { await refetchCustomers(); }} />
      <OverdueNotificationDialog open={notifyOverdueOpen} onOpenChange={setNotifyOverdueOpen} customers={customers} allInvoices={allInvoices} />
    </div>
  );
}
