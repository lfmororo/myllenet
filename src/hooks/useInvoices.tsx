import { useState, useEffect, useCallback, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export interface Invoice {
  id: string;
  customer_id: string;
  plan_id: string | null;
  descricao: string;
  valor_centavos: number;
  vencimento: string;
  status: string;
  efi_charge_id: number | null;
  efi_barcode: string | null;
  efi_pix_qrcode: string | null;
  efi_pix_copiacola: string | null;
  efi_link: string | null;
  paid_at: string | null;
  created_at: string;
  updated_at: string;
  // joined
  customers?: { nome: string; cpf: string; usuario_pppoe: string };
}

export interface CreateInvoiceInput {
  customer_id: string;
  descricao: string;
  valor_centavos: number;
  vencimento: string;
  plan_id?: string;
}

export function useInvoices() {
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [invoiceSearch, setInvoiceSearch] = useState("");
  const [bulkChecking, setBulkChecking] = useState(false);
  const autoCheckedRef = useRef(false);

  const fetchInvoices = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("invoices")
      .select("*, customers(nome, cpf, usuario_pppoe)")
      .order("vencimento", { ascending: true });

    if (error) {
      toast.error("Erro ao carregar faturas");
      console.error(error);
    } else {
      setInvoices(data as Invoice[]);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchInvoices();
  }, [fetchInvoices]);

  const createBoleto = async (input: CreateInvoiceInput) => {
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData?.session?.access_token;
      if (!token) {
        toast.error("Sessão expirada");
        return false;
      }

      const projectId = import.meta.env.VITE_SUPABASE_PROJECT_ID;
      const response = await fetch(
        `https://${projectId}.supabase.co/functions/v1/efi-boleto/create`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
            apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
          },
          body: JSON.stringify(input),
        }
      );

      const result = await response.json();
      if (!response.ok) {
        toast.error(result.error || "Erro ao gerar boleto");
        return false;
      }

      toast.success("Boleto gerado com sucesso!");
      fetchInvoices();
      return true;
    } catch (err) {
      console.error(err);
      toast.error("Erro ao gerar boleto");
      return false;
    }
  };

  const checkPayment = async (invoiceId: string) => {
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData?.session?.access_token;
      if (!token) {
        toast.error("Sessão expirada");
        return null;
      }

      const projectId = import.meta.env.VITE_SUPABASE_PROJECT_ID;
      const response = await fetch(
        `https://${projectId}.supabase.co/functions/v1/efi-boleto/check?invoice_id=${invoiceId}`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
            apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
          },
        }
      );

      const result = await response.json();
      if (!response.ok) {
        toast.error(result.error || "Erro ao verificar pagamento");
        return null;
      }

      fetchInvoices();
      toast.success(`Status: ${result.status === "paid" ? "Pago" : result.status}`);
      return result;
    } catch (err) {
      console.error(err);
      toast.error("Erro ao verificar pagamento");
      return null;
    }
  };

  const cancelInvoice = async (invoiceId: string) => {
    const { error } = await supabase
      .from("invoices")
      .update({ status: "cancelled" })
      .eq("id", invoiceId);

    if (error) {
      toast.error("Erro ao cancelar fatura");
      return false;
    }
    toast.success("Fatura cancelada");
    fetchInvoices();
    return true;
  };

  const importFromEfi = async (beginDate?: string, endDate?: string) => {
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData?.session?.access_token;
      if (!token) { toast.error("Sessão expirada"); return null; }

      const projectId = import.meta.env.VITE_SUPABASE_PROJECT_ID;
      const params = new URLSearchParams();
      if (beginDate) params.set("begin_date", beginDate);
      if (endDate) params.set("end_date", endDate);

      const response = await fetch(
        `https://${projectId}.supabase.co/functions/v1/efi-boleto/import?${params}`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
            apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
          },
        }
      );

      const result = await response.json();
      if (!response.ok) { toast.error(result.error || "Erro ao importar"); return null; }

      toast.success(`Importados: ${result.imported_customers} clientes, ${result.imported_invoices} faturas (${result.skipped_invoices} já existentes)`);
      fetchInvoices();
      return result;
    } catch (err) {
      console.error(err);
      toast.error("Erro ao importar da EFI");
      return null;
    }
  };

  const bulkImportInvoices = async (rows: { customer_id: string; descricao: string; valor_centavos: number; vencimento: string; status: string; paid_at?: string | null }[]) => {
    let success = 0;
    let failed = 0;
    let skipped = 0;
    for (const row of rows) {
      const { error } = await supabase.from("invoices").insert(row);
      if (error) {
        if (error.code === "23505") {
          skipped++;
        } else {
          console.error("Insert error:", error);
          failed++;
        }
      } else {
        success++;
      }
    }
    fetchInvoices();
    return { success, failed, skipped };
  };

  const bulkCheckPayments = useCallback(async () => {
    try {
      setBulkChecking(true);
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData?.session?.access_token;
      if (!token) { toast.error("Sessão expirada"); return null; }

      const projectId = import.meta.env.VITE_SUPABASE_PROJECT_ID;
      const response = await fetch(
        `https://${projectId}.supabase.co/functions/v1/efi-boleto/bulk-check`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
            apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
          },
        }
      );

      const result = await response.json();
      if (!response.ok) {
        console.error("Bulk check error:", result);
        return null;
      }

      if (result.updated > 0) {
        toast.success(`${result.updated} cobrança(s) atualizada(s) na verificação`);
        fetchInvoices();
      }
      return result;
    } catch (err) {
      console.error("Bulk check error:", err);
      return null;
    } finally {
      setBulkChecking(false);
    }
  }, [fetchInvoices]);

  // Auto-check payments on first load
  useEffect(() => {
    if (!loading && invoices.length > 0 && !autoCheckedRef.current) {
      const hasPending = invoices.some(inv => ["pending", "waiting", "overdue"].includes(inv.status) && inv.efi_charge_id);
      if (hasPending) {
        autoCheckedRef.current = true;
        bulkCheckPayments();
      }
    }
  }, [loading, invoices, bulkCheckPayments]);

  const filteredInvoices = invoices.filter((inv) => {
    if (!invoiceSearch.trim()) return true;
    const term = invoiceSearch.trim().toLowerCase();
    const nome = inv.customers?.nome?.toLowerCase() || "";
    const usuario = inv.customers?.usuario_pppoe?.toLowerCase() || "";
    return nome.includes(term) || usuario.includes(term);
  });

  return { invoices: filteredInvoices, allInvoices: invoices, loading, invoiceSearch, setInvoiceSearch, createBoleto, checkPayment, cancelInvoice, importFromEfi, bulkImportInvoices, bulkCheckPayments, bulkChecking, refetch: fetchInvoices };
}
