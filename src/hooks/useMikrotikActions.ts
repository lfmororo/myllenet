import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export function useMikrotikActions() {
  const [loading, setLoading] = useState<string | null>(null);

  const syncMikrotik = async (customerId: string, action: 'enable' | 'disable' | 'sync') => {
    setLoading(customerId);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error("Não autenticado");

      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/mikrotik-customer`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${session.access_token}`
          },
          body: JSON.stringify({
            customer_id: customerId,
            action
          })
        }
      );

      const result = await response.json();

      if (!response.ok || !result.success) {
        throw new Error(result.error || "Erro ao processar no Mikrotik");
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
