import { useState } from "react";
import { api } from "@/integrations/api/client";
import { toast } from "sonner";

export type NotificationType = "boleto_gerado" | "lembrete_vencimento" | "pagamento_confirmado" | "cobranca_atrasada";

export function useWhatsApp() {
  const [sending, setSending] = useState<string | null>(null);

  const sendInvoiceNotification = async (invoiceId: string, type: NotificationType) => {
    setSending(invoiceId);
    try {
      const { error } = await api.functions.invoke("whatsapp-send/notify-invoice", {
        body: { invoice_id: invoiceId, type },
      });
      if (error) {
        toast.error(error.message || "Erro ao enviar WhatsApp");
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
    let success = 0;
    let failed = 0;

    for (const id of invoiceIds) {
      setSending(id);
      try {
        const { error } = await api.functions.invoke("whatsapp-send/notify-invoice", {
          body: { invoice_id: id, type },
        });
        if (!error) success++;
        else {
          console.error(`Erro invoice ${id}:`, error.message);
          failed++;
        }
      } catch {
        failed++;
      }
      await new Promise((resolve) => setTimeout(resolve, 1500));
    }

    setSending(null);
    return { success, failed };
  };

  const sendText = async (phone: string, message: string, customerInfo?: { customer_id?: string; customer_name?: string }) => {
    try {
      const { error } = await api.functions.invoke("whatsapp-send/send-text", {
        body: { phone, message, ...customerInfo },
      });
      if (error) {
        toast.error(error.message || "Erro ao enviar WhatsApp");
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
