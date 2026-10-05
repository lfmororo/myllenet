import { useState } from "react";
import { api } from "@/integrations/api/client";
import { toast } from "sonner";

export function useMikrotikActions() {
  const [loading, setLoading] = useState<string | null>(null);

  const syncMikrotik = async (customerId: string, action: 'enable' | 'disable' | 'sync') => {
    setLoading(customerId);
    try {
      const { data: result, error } = await api.functions.invoke("mikrotik-customer", {
        body: { customer_id: customerId, action },
      });

      if (error || !result?.success) {
        throw new Error(result?.error || error?.message || "Erro ao processar no Mikrotik");
      }

      toast.success(result.message || "Ação realizada no Mikrotik com sucesso");
      window.location.reload();
      return true;

    } catch (error: any) {
      toast.error(error.message);
      return false;
    } finally {
      setLoading(null);
    }
  };

  return {
    syncMikrotik,
    loading
  };
}
