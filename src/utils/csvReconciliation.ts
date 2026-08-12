import { supabase } from "@/integrations/supabase/client";
import { format, parse } from "date-fns";

/**
 * Reconciles open/overdue invoices using a CSV report from EFI.
 * Parses the CSV, finds matching invoices in the database, and marks them as paid if they are "Pago" in the CSV.
 */
export async function reconcileInvoicesFromCSV(csvContent: string) {
  const lines = csvContent.split(/\r?\n/);
  if (lines.length < 2) return { updated: 0, errors: 0 };

  // Skip header, detect separator (semicolon or comma)
  const header = lines[0];
  const separator = header.includes(";") ? ";" : ",";
  const rows = lines.slice(1).filter(l => l.trim().length > 0);

  let updated = 0;
  let errors = 0;

  console.log(`Starting CSV reconciliation for ${rows.length} rows...`);

  for (const row of rows) {
    try {
      const columns = row.split(separator).map(c => c.replace(/"/g, "").trim());
      
      // Map columns based on the header observed in user-uploads
      // "Número da Cobrança";"Valor (R$)";"Status";"Data de Emissão";"Forma de cobrança";"Nome";"E-mail";"Telefone";"Documento";"Data de Vencimento";"Valor Pago (R$)";"Pago Em"
      const efiChargeId = columns[0];
      const status = columns[2];
      const cpf = columns[8]?.replace(/\D/g, "");
      const vencimentoRaw = columns[9]; // DD/MM/YYYY
      const pagoEmRaw = columns[11]; // DD/MM/YYYY

      if (status !== "Pago") continue;

      // Convert date to YYYY-MM-DD for database comparison
      let vencimentoIso = "";
      try {
        const parsedDate = parse(vencimentoRaw, "dd/MM/yyyy", new Date());
        vencimentoIso = format(parsedDate, "yyyy-MM-dd");
      } catch (e) {
        console.warn(`Could not parse date: ${vencimentoRaw}`);
        continue;
      }

      // Find the invoice in our DB
      // Strategy: Match by efi_charge_id OR (CPF + Vencimento)
      let query = supabase.from("invoices").select("id, status");
      
      if (efiChargeId && !isNaN(Number(efiChargeId))) {
        query = query.eq("efi_charge_id", Number(efiChargeId));
      } else {
        // Find customer by CPF first if we don't have a direct charge ID match
        const { data: customer } = await supabase
          .from("customers")
          .select("id")
          .eq("cpf", cpf)
          .maybeSingle();
          
        if (!customer) continue;
        query = query.eq("customer_id", customer.id).eq("vencimento", vencimentoIso);
      }

      const { data: invoices, error: fetchError } = await query;

      if (fetchError || !invoices || invoices.length === 0) continue;

      for (const inv of invoices) {
        if (inv.status === "paid") continue;

        const paidAt = pagoEmRaw 
          ? format(parse(pagoEmRaw, "dd/MM/yyyy", new Date()), "yyyy-MM-dd'T'HH:mm:ss")
          : new Date().toISOString();

        const { error: updateError } = await supabase
          .from("invoices")
          .update({
            status: "paid",
            paid_at: paidAt,
            efi_charge_id: efiChargeId ? Number(efiChargeId) : undefined
          })
          .eq("id", inv.id);

        if (!updateError) {
          updated++;
          // Best effort WhatsApp notification (optional, depends if we want to trigger it on import)
          // We usually skip it here to avoid mass spam if importing old data, 
          // but for "just paid" it might be desired.
        } else {
          errors++;
        }
      }
    } catch (e) {
      console.error("Error processing CSV row:", e);
      errors++;
    }
  }

  return { updated, errors };
}
