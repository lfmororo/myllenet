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
      .select("*, customers(nome, cpf, usuario_pppoe, block_status)")
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
        if (response.status === 409) {
          toast.info(result.error || "Cobrança já existe para este vencimento");
          return true;
        }
        const errorMsg = result.error || "Erro ao gerar boleto";
        if (errorMsg.includes("mesma pessoa")) {
          toast.error("O CPF deste cliente é o mesmo do titular da conta EFI. A EFI não permite emitir boleto para si mesmo.");
        } else {
          toast.error(errorMsg);
        }
        return false;
      }

      toast.success("Boleto gerado com sucesso!");
      fetchInvoices();

      // Auto-send WhatsApp notification
      try {
        const notifyResponse = await fetch(
          `https://${projectId}.supabase.co/functions/v1/whatsapp-send/notify-invoice`,
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${token}`,
              "Content-Type": "application/json",
              apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
            },
            body: JSON.stringify({ invoice_id: result.invoice?.id || result.invoice_id || result.id, type: "boleto_gerado" }),
          }
        );
        if (notifyResponse.ok) {
          toast.success("Notificação WhatsApp enviada ao cliente!");
        } else {
          const notifyErr = await notifyResponse.json();
          console.warn("WhatsApp notify warning:", notifyErr.error);
        }
      } catch (notifyErr) {
        console.warn("WhatsApp auto-notify failed:", notifyErr);
      }

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

  const markAsPaid = async (invoiceId: string) => {
    // Get invoice to check for efi_charge_id
    const { data: invoice } = await supabase
      .from("invoices")
      .select("efi_charge_id")
      .eq("id", invoiceId)
      .single();

    const { error } = await supabase
      .from("invoices")
      .update({ status: "paid", paid_at: new Date().toISOString() })
      .eq("id", invoiceId);

    if (error) {
      toast.error("Erro ao marcar como pago");
      return false;
    }
    toast.success("Fatura marcada como paga");
    fetchInvoices();

    const { data: sessionData } = await supabase.auth.getSession();
    const token = sessionData?.session?.access_token;
    const projectId = import.meta.env.VITE_SUPABASE_PROJECT_ID;

    // Mark as paid or settle on EFI if it has an efi_charge_id
    if (invoice?.efi_charge_id && token) {
      try {
        const settleRes = await fetch(
          `https://${projectId}.supabase.co/functions/v1/efi-boleto/settle`,
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${token}`,
              "Content-Type": "application/json",
              apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
            },
            body: JSON.stringify({ charge_id: invoice.efi_charge_id }),
          }
        );
        if (settleRes.ok) {
          toast.success("Baixa realizada na EFI");
        } else {
          const err = await settleRes.json();
          console.warn("EFI settle warning:", err.error);
        }
      } catch (e) {
        console.warn("EFI settle failed:", e);
      }
    }

    // Send payment confirmation via WhatsApp
    if (token) {
      try {
        const response = await fetch(
          `https://${projectId}.supabase.co/functions/v1/whatsapp-send/notify-invoice`,
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${token}`,
              "Content-Type": "application/json",
              apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
            },
            body: JSON.stringify({ invoice_id: invoiceId, type: "pagamento_confirmado" }),
          }
        );
        if (response.ok) {
          toast.success("Confirmação de pagamento enviada ao cliente!");
        }
      } catch (notifyErr) {
        console.warn("WhatsApp payment confirm failed:", notifyErr);
      }
    }

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

  const bulkImportInvoices = async (rows: { customer_id: string; descricao: string; valor_centavos: number; vencimento: string; status: string; paid_at?: string | null; efi_link?: string | null }[]) => {
    let success = 0;
    let failed = 0;
    let skipped = 0;
    let updated = 0;

    // Separate rows that have efi_link (update-only) from new rows
    const BATCH_SIZE = 50;

    for (let i = 0; i < rows.length; i += BATCH_SIZE) {
      const batch = rows.slice(i, i + BATCH_SIZE);
      
      for (const row of batch) {
        // Try insert first
        const { error } = await supabase.from("invoices").insert(row);
        if (error) {
          if (error.code === "23505") {
            // Duplicate — update only efi_link and/or paid status
            const updatePayload: Record<string, any> = {};
            if (row.efi_link) updatePayload.efi_link = row.efi_link;
            if (row.status === "paid") {
              updatePayload.status = "paid";
              updatePayload.paid_at = row.paid_at || new Date().toISOString();
            }

            if (Object.keys(updatePayload).length > 0) {
              const { error: updateError } = await supabase
                .from("invoices")
                .update(updatePayload)
                .eq("customer_id", row.customer_id)
                .eq("vencimento", row.vencimento);
              if (!updateError) updated++;
            }
            skipped++;
          } else {
            console.error("Insert error:", error);
            failed++;
          }
        } else {
          success++;
        }
      }
      // Yield to UI thread between batches
      await new Promise(r => setTimeout(r, 10));
    }

    fetchInvoices();
    return { success, failed, skipped, updated };
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

  return { invoices: filteredInvoices, allInvoices: invoices, loading, invoiceSearch, setInvoiceSearch, createBoleto, checkPayment, cancelInvoice, markAsPaid, importFromEfi, bulkImportInvoices, bulkCheckPayments, bulkChecking, refetch: fetchInvoices };
}
