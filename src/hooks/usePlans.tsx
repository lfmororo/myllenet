import { useState, useEffect, useCallback } from "react";
import { api } from "@/integrations/api/client";
import { toast } from "sonner";

export interface Plan {
  id: string;
  nome: string;
  nome_servidor: string | null;
  descricao: string | null;
  valor_centavos: number;
  intervalo_meses: number;
  ativo: boolean;
  desconto_centavos: number;
  dias_desconto: number;
  juros_mensal: number;
  multa_centavos: number;
  created_at: string;
  updated_at: string;
}

export type PlanInput = Omit<Plan, "id" | "created_at" | "updated_at">;

export function usePlans() {
  const [plans, setPlans] = useState<Plan[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchPlans = useCallback(async () => {
    setLoading(true);
    const { data, error } = await api
      .from("plans")
      .select("*")
      .order("nome");

    if (error) {
      toast.error("Erro ao carregar planos");
      console.error(error);
    } else {
      setPlans(data as Plan[]);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchPlans();
  }, [fetchPlans]);

  const addPlan = async (plan: PlanInput) => {
    const { error } = await api.from("plans").insert(plan);
    if (error) {
      toast.error("Erro ao cadastrar plano");
      return false;
    }
    toast.success("Plano cadastrado!");
    fetchPlans();
    return true;
  };

  const updatePlan = async (id: string, plan: Partial<PlanInput>) => {
    const { error } = await api.from("plans").update(plan).eq("id", id);
    if (error) {
      toast.error("Erro ao atualizar plano");
      return false;
    }
    toast.success("Plano atualizado!");
    fetchPlans();
    return true;
  };

  const deletePlan = async (id: string) => {
    const { error } = await api.from("plans").delete().eq("id", id);
    if (error) {
      toast.error("Erro ao excluir plano");
      return false;
    }
    toast.success("Plano excluído!");
    fetchPlans();
    return true;
  };

  return { plans, loading, addPlan, updatePlan, deletePlan, refetch: fetchPlans };
}
