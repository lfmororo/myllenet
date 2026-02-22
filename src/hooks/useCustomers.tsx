import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export interface Customer {
  id: string;
  nome: string;
  cpf: string;
  email: string;
  telefone: string | null;
  usuario_pppoe: string;
  senha_pppoe: string;
  created_at: string;
  updated_at: string;
}

export type CustomerInput = Omit<Customer, "id" | "created_at" | "updated_at">;

export function useCustomers() {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");

  const fetchCustomers = useCallback(async () => {
    setLoading(true);
    let query = supabase.from("customers").select("*").order("nome");

    if (searchTerm.trim()) {
      const term = `%${searchTerm.trim()}%`;
      query = query.or(`nome.ilike.${term},cpf.ilike.${term},usuario_pppoe.ilike.${term}`);
    }

    const { data, error } = await query;
    if (error) {
      toast.error("Erro ao carregar clientes");
      console.error(error);
    } else {
      setCustomers(data as Customer[]);
    }
    setLoading(false);
  }, [searchTerm]);

  useEffect(() => {
    fetchCustomers();
  }, [fetchCustomers]);

  const addCustomer = async (customer: CustomerInput) => {
    const { error } = await supabase.from("customers").insert(customer);
    if (error) {
      if (error.code === "23505") {
        if (error.message.includes("cpf")) toast.error("CPF já cadastrado");
        else if (error.message.includes("email")) toast.error("E-mail já cadastrado");
        else if (error.message.includes("usuario_pppoe")) toast.error("Usuário PPPoE já cadastrado");
        else toast.error("Registro duplicado");
      } else {
        toast.error("Erro ao cadastrar cliente");
      }
      return false;
    }
    toast.success("Cliente cadastrado com sucesso!");
    fetchCustomers();
    return true;
  };

  const updateCustomer = async (id: string, customer: Partial<CustomerInput>) => {
    const { error } = await supabase.from("customers").update(customer).eq("id", id);
    if (error) {
      toast.error("Erro ao atualizar cliente");
      return false;
    }
    toast.success("Cliente atualizado com sucesso!");
    fetchCustomers();
    return true;
  };

  const deleteCustomer = async (id: string) => {
    const { error } = await supabase.from("customers").delete().eq("id", id);
    if (error) {
      toast.error("Erro ao excluir cliente");
      return false;
    }
    toast.success("Cliente excluído com sucesso!");
    fetchCustomers();
    return true;
  };

  const exportCSV = () => {
    if (customers.length === 0) {
      toast.error("Nenhum cliente para exportar");
      return;
    }
    const headers = ["Nome", "CPF", "E-mail", "Telefone", "Usuário PPPoE", "Senha PPPoE"];
    const rows = customers.map((c) => [
      c.nome, c.cpf, c.email, c.telefone || "", c.usuario_pppoe, c.senha_pppoe,
    ]);
    const csv = [headers.join(";"), ...rows.map((r) => r.join(";"))].join("\n");
    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `clientes_myllenet_${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
    toast.success("Exportação concluída!");
  };

  const bulkImport = async (items: CustomerInput[]): Promise<{ success: number; failed: number }> => {
    let success = 0;
    let failed = 0;
    // Insert in batches of 20
    for (let i = 0; i < items.length; i += 20) {
      const batch = items.slice(i, i + 20);
      const { error } = await supabase.from("customers").insert(batch);
      if (error) {
        failed += batch.length;
      } else {
        success += batch.length;
      }
    }
    fetchCustomers();
    return { success, failed };
  };

  return { customers, loading, searchTerm, setSearchTerm, addCustomer, updateCustomer, deleteCustomer, exportCSV, bulkImport, refetch: fetchCustomers };
}
