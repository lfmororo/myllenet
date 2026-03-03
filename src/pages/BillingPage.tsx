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
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { Plus, Search, Loader2, Upload, RefreshCw, Clock, Filter, CalendarIcon, X } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { cn } from "@/lib/utils";

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
  const [dateFrom, setDateFrom] = useState<Date | undefined>(undefined);
  const [dateTo, setDateTo] = useState<Date | undefined>(undefined);

  const filteredByDateAndStatus = invoices.filter((inv) => {
    if (invoiceStatusFilter !== "all" && inv.status !== invoiceStatusFilter) return false;
    if (dateFrom) {
      const venc = new Date(inv.vencimento + "T00:00:00");
      if (venc < dateFrom) return false;
    }
    if (dateTo) {
      const venc = new Date(inv.vencimento + "T00:00:00");
      const end = new Date(dateTo);
      end.setHours(23, 59, 59, 999);
      if (venc > end) return false;
    }
    return true;
  });

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">Cobranças</h2>
        <p className="text-muted-foreground">Gerencie faturas e boletos</p>
      </div>

      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-3">
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
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" className={cn("w-[150px] justify-start text-left font-normal", !dateFrom && "text-muted-foreground")}>
                <CalendarIcon className="mr-2 h-4 w-4" />
                {dateFrom ? format(dateFrom, "dd/MM/yyyy") : "Data início"}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="start">
              <Calendar mode="single" selected={dateFrom} onSelect={setDateFrom} locale={ptBR} initialFocus className="p-3 pointer-events-auto" />
            </PopoverContent>
          </Popover>
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" className={cn("w-[150px] justify-start text-left font-normal", !dateTo && "text-muted-foreground")}>
                <CalendarIcon className="mr-2 h-4 w-4" />
                {dateTo ? format(dateTo, "dd/MM/yyyy") : "Data fim"}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="start">
              <Calendar mode="single" selected={dateTo} onSelect={setDateTo} locale={ptBR} initialFocus className="p-3 pointer-events-auto" />
            </PopoverContent>
          </Popover>
          {(dateFrom || dateTo) && (
            <Button variant="ghost" size="icon" className="h-10 w-10" onClick={() => { setDateFrom(undefined); setDateTo(undefined); }} title="Limpar datas">
              <X className="h-4 w-4" />
            </Button>
          )}
          <span className="text-sm text-muted-foreground whitespace-nowrap">
            {filteredByDateAndStatus.length} fatura{filteredByDateAndStatus.length !== 1 ? "s" : ""}
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
        <InvoiceTable invoices={filteredByDateAndStatus} onCheckPayment={checkPayment} onCancel={cancelInvoice} onMarkAsPaid={markAsPaid} />
      )}

      <CreateBoletoDialog open={boletoOpen} onOpenChange={setBoletoOpen} customers={customers} plans={plans} onSave={createBoleto} />
      <InvoiceCSVImportDialog open={invoiceCsvImportOpen} onOpenChange={setInvoiceCsvImportOpen} customers={customers.map(c => ({ id: c.id, nome: c.nome, cpf: c.cpf }))} onImport={bulkImportInvoices} plans={plans} onUpdateCustomer={updateCustomer} onAddCustomer={addCustomer} onRefetchCustomers={async () => { await refetchCustomers(); }} />
      <OverdueNotificationDialog open={notifyOverdueOpen} onOpenChange={setNotifyOverdueOpen} customers={customers} allInvoices={allInvoices} />
    </div>
  );
}
