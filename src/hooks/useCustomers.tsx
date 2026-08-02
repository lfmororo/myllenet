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
  rua: string | null;
  numero: string | null;
  complemento: string | null;
  bairro: string | null;
  cidade: string | null;
  estado: string | null;
  cep: string | null;
  ativo: boolean;
  cortesia: boolean;
  dia_vencimento: number;
  plan_id: string | null;
  desconto_especial_centavos: number;
  pago_ate: string | null;
  created_at: string;
  updated_at: string;
}

export type CustomerInput = Omit<Customer, "id" | "created_at" | "updated_at" | "ativo" | "pago_ate" | "cortesia"> & { cortesia?: boolean };

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
    const { error, data: inserted } = await supabase.from("customers").insert(customer).select("id").single();
    if (error) {
      if (error.code === "23505") {
        if (error.message.includes("cpf")) toast.error("CPF já cadastrado");
        else if (error.message.includes("email")) toast.error("E-mail já cadastrado");
        else if (error.message.includes("usuario_pppoe")) toast.error("Usuário PPPoE já em uso por outro cliente ativo");
        else toast.error("Registro duplicado");
      } else {
        toast.error("Erro ao cadastrar cliente");
      }
      return false;
    }
    toast.success("Cliente cadastrado com sucesso!");
    fetchCustomers();

    // Placeholder for Mikrotik PPPoE registration
    // toast.info("Integração Mikrotik pendente");

    // Send welcome notification via WhatsApp
    const phone = customer.telefone;
    console.log("Welcome WhatsApp check - telefone:", JSON.stringify(phone), "inserted:", inserted?.id);
    if (phone && phone.trim()) {
      try {
        const { data: sessionData } = await supabase.auth.getSession();
        const token = sessionData?.session?.access_token;
        if (token) {
          const projectId = import.meta.env.VITE_SUPABASE_PROJECT_ID;
          const message = `Olá ${customer.nome}! 🌐\n\nSeja bem-vindo(a) à *Myllenet*! 🎉\n\nSeu acesso à internet já está ativo.\n\n👤 Usuário: ${customer.usuario_pppoe}\n\nEm caso de dúvidas, estamos à disposição!\nObrigado por escolher a Myllenet! 🚀`;
          const res = await fetch(
            `https://${projectId}.supabase.co/functions/v1/whatsapp-send/send-text`,
            {
              method: "POST",
              headers: {
                Authorization: `Bearer ${token}`,
                "Content-Type": "application/json",
                apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
              },
              body: JSON.stringify({
                phone,
                message,
                customer_id: inserted?.id,
                customer_name: customer.nome,
              }),
            }
          );
          if (res.ok) {
            toast.success("Boas-vindas enviadas via WhatsApp!");
          } else {
            const err = await res.json();
            console.warn("WhatsApp welcome error:", err);
          }
        }
      } catch (e) {
        console.warn("Erro ao enviar boas-vindas WhatsApp:", e);
      }
    }

    return true;
  };

  const updateCustomer = async (id: string, customer: Partial<CustomerInput>) => {
    const { error } = await supabase.from("customers").update(customer).eq("id", id);
    if (error) {
      if (error.code === "23505" && error.message.includes("usuario_pppoe")) {
        toast.error("Usuário PPPoE já em uso por outro cliente ativo");
      } else {
        toast.error("Erro ao atualizar cliente");
      }
      return false;
    }
    toast.success("Cliente atualizado com sucesso!");
    fetchCustomers();
    return true;
  };

  const toggleCustomerActive = async (id: string, ativo: boolean) => {
    // If deactivating, cancel all pending invoices and toggle PPPoE on router
    if (!ativo) {
      // Get customer info for PPPoE toggle
      const { data: customerData } = await supabase
        .from("customers")
        .select("usuario_pppoe")
        .eq("id", id)
        .single();

      // Placeholder for Mikrotik toggle
      
      const { data: openInvoices } = await supabase
        .from("invoices")
        .select("id, efi_charge_id")
        .eq("customer_id", id)
        .in("status", ["pending", "waiting"]);

      if (openInvoices && openInvoices.length > 0) {
        // Cancel on EFI for invoices that have a charge_id
        const efiInvoices = openInvoices.filter((inv) => inv.efi_charge_id);
        if (efiInvoices.length > 0) {
          try {
            const { data: sessionData } = await supabase.auth.getSession();
            const token = sessionData?.session?.access_token;
            if (token) {
              const projectId = import.meta.env.VITE_SUPABASE_PROJECT_ID;
              for (const inv of efiInvoices) {
                try {
                  await fetch(
                    `https://${projectId}.supabase.co/functions/v1/efi-boleto/cancel`,
                    {
                      method: "POST",
                      headers: {
                        Authorization: `Bearer ${token}`,
                        "Content-Type": "application/json",
                        apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
                      },
                      body: JSON.stringify({ charge_id: inv.efi_charge_id }),
                    }
                  );
                } catch (e) {
                  console.error("Erro ao cancelar cobrança EFI:", inv.efi_charge_id, e);
                }
              }
            }
          } catch (e) {
            console.error("Erro ao obter sessão para cancelar na EFI:", e);
          }
        }

        // Cancel locally
        const { error: cancelError } = await supabase
          .from("invoices")
          .update({ status: "cancelled" })
          .eq("customer_id", id)
          .in("status", ["pending", "waiting"]);

        if (cancelError) {
          console.error("Erro ao cancelar faturas:", cancelError);
          toast.error("Erro ao cancelar faturas em aberto");
          return false;
        }
        toast.info(`${openInvoices.length} fatura(s) em aberto cancelada(s) (inclusive na EFI)`);
      }
    }

    const { error } = await supabase.from("customers").update({ ativo }).eq("id", id);
    if (error) {
      if (error.code === "23505" && error.message.includes("usuario_pppoe")) {
        toast.error("Não é possível ativar: usuário PPPoE já em uso por outro cliente ativo");
      } else {
        toast.error(ativo ? "Erro ao ativar cliente" : "Erro ao desativar cliente");
      }
      return false;
    }
    toast.success(ativo ? "Cliente ativado!" : "Cliente desativado!");
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
    const headers = ["Nome", "CPF", "E-mail", "Telefone", "Usuário PPPoE", "Senha PPPoE", "Rua", "Número", "Complemento", "Bairro", "Cidade", "Estado", "CEP"];
    const rows = customers.map((c) => [
      c.nome, c.cpf, c.email, c.telefone || "", c.usuario_pppoe, c.senha_pppoe,
      c.rua || "", c.numero || "", c.complemento || "", c.bairro || "", c.cidade || "", c.estado || "", c.cep || "",
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
    for (const item of items) {
      const cpfClean = item.cpf.replace(/\D/g, "");
      // Check if customer already exists by CPF
      const { data: existing } = await supabase
        .from("customers")
        .select("*")
        .eq("cpf", cpfClean)
        .maybeSingle();

      if (existing) {
        // Only update fields that are currently blank/null in the DB
        const updates: Record<string, unknown> = {};
        const fields: (keyof CustomerInput)[] = [
          "nome", "email", "telefone", "usuario_pppoe", "senha_pppoe",
          "rua", "numero", "complemento", "bairro", "cidade", "estado", "cep",
        ];
        for (const field of fields) {
          const dbVal = existing[field];
          const csvVal = item[field];
          if ((!dbVal || (typeof dbVal === "string" && !dbVal.trim())) && csvVal) {
            updates[field] = csvVal;
          }
        }
        if (Object.keys(updates).length > 0) {
          const { error } = await supabase.from("customers").update(updates).eq("id", existing.id);
          if (error) { console.error("Update error for CPF", cpfClean, error.message); failed++; }
          else success++;
        } else {
          success++; // nothing to update, counts as success
        }
      } else {
        // New customer — insert
        const { error } = await supabase.from("customers").insert({ ...item, cpf: cpfClean });
        if (error) { console.error("Insert error for CPF", cpfClean, error.message); failed++; }
        else success++;
      }
    }
    fetchCustomers();
    return { success, failed };
  };

  return { customers, loading, searchTerm, setSearchTerm, addCustomer, updateCustomer, deleteCustomer, toggleCustomerActive, exportCSV, bulkImport, refetch: fetchCustomers };
}
