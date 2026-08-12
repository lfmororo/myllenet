import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export type NotificationType = "boleto_gerado" | "lembrete_vencimento" | "pagamento_confirmado" | "cobranca_atrasada";

export function useWhatsApp() {
  const [sending, setSending] = useState<string | null>(null);

  const getAuthHeaders = async () => {
    const { data: { session } } = await supabase.auth.getSession();
    const token = session?.access_token;
    if (!token) {
      toast.error("Sessão expirada");
      return null;
    }
    return {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
    };
  };

  const sendInvoiceNotification = async (invoiceId: string, type: NotificationType) => {
    const headers = await getAuthHeaders();
    if (!headers) return false;

    setSending(invoiceId);
    try {
      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/whatsapp-send/notify-invoice`,
        {
          method: "POST",
          headers,
          body: JSON.stringify({ invoice_id: invoiceId, type }),
        }
      );

      const result = await response.json();
      if (!response.ok) {
        toast.error(result.error || "Erro ao enviar WhatsApp");
        return false;
      }

      toast.success("Mensagem WhatsApp enviada!");
      return true;
    } catch (err) {
      console.error(err);
      toast.error("Erro ao enviar WhatsApp");
      return false;
    } finally {
      setSending(null);
    }
  };

  const sendBulkNotification = async (invoiceIds: string[], type: NotificationType) => {
    const headers = await getAuthHeaders();
    if (!headers) return { success: 0, failed: 0 };

    let success = 0;
    let failed = 0;

    for (const id of invoiceIds) {
      setSending(id);
      try {
        const response = await fetch(
          `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/whatsapp-send/notify-invoice`,
          {
            method: "POST",
            headers,
            body: JSON.stringify({ invoice_id: id, type }),
          }
        );

        if (response.ok) success++;
        else {
          const result = await response.json();
          console.error(`Erro invoice ${id}:`, result.error);
          failed++;
        }
      } catch {
        failed++;
      }
      // Delay between messages
      await new Promise(resolve => setTimeout(resolve, 1500));
    }

    setSending(null);
    return { success, failed };
  };

  const sendText = async (phone: string, message: string, customerInfo?: { customer_id?: string; customer_name?: string }) => {
    const headers = await getAuthHeaders();
    if (!headers) return false;

    try {
      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/whatsapp-send/send-text`,
        {
          method: "POST",
          headers,
          body: JSON.stringify({ phone, message, ...customerInfo }),
        }
      );

      const result = await response.json();
      if (!response.ok) {
        toast.error(result.error || "Erro ao enviar WhatsApp");
        return false;
      }

      toast.success("Mensagem enviada!");
      return true;
    } catch (err) {
      console.error(err);
      toast.error("Erro ao enviar WhatsApp");
      return false;
    }
  };

  return { sendInvoiceNotification, sendBulkNotification, sendText, sending };
}
