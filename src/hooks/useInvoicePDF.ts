import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { jsPDF } from "jspdf";
import QRCode from "qrcode";


export function useInvoicePDF() {
  const [generating, setGenerating] = useState(false);

  const generatePDF = async (invoiceId: string, open = true) => {
    setGenerating(true);
    try {
      const { data, error } = await supabase.functions.invoke("generate-invoice-pdf", {
        body: { invoice_id: invoiceId },
      });

      if (error || !data.success) throw new Error(error?.message || "Erro ao gerar dados da fatura");

      const { invoice, customer, plan, consumption, pix } = data.data;

      const doc = new jsPDF();
      const pageWidth = doc.internal.pageSize.getWidth();

      // Logo and Header
      try {
        const img = new Image();
        img.src = "/src/assets/logo.png";
        await new Promise((resolve, reject) => {
          img.onload = resolve;
          img.onerror = reject;
        });
        doc.addImage(img, "PNG", 20, 10, 20, 20);
      } catch (e) {
        console.error("Logo not found for PDF", e);
      }

      doc.setFontSize(20);
      doc.setTextColor(0, 128, 128);
      doc.text("FATURA DE INTERNET", pageWidth / 2 + 10, 20, { align: "center" });
      
      doc.setFontSize(10);
      doc.setTextColor(100);
      doc.text(`Nº ${invoiceId.substring(0, 8).toUpperCase()}/${new Date().getFullYear()}`, pageWidth / 2 + 10, 26, { align: "center" });


      // Prestador
      doc.setFontSize(12);
      doc.setTextColor(0);
      doc.setFont("helvetica", "bold");
      doc.text("PRESTADOR", 20, 40);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(10);
      doc.text("Mororo.Tech", 20, 46);
      doc.text("CNPJ: 00.000.000/0000-00", 20, 51);
      doc.text("Ipu - CE | contato@mororo.tech", 20, 56);

      // Cliente
      doc.setFontSize(12);
      doc.setFont("helvetica", "bold");
      doc.text("CLIENTE", 110, 40);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(10);
      doc.text(customer.nome, 110, 46);
      doc.text(`CPF/CNPJ: ${customer.cpf}`, 110, 51);
      doc.text(`${customer.rua || ""}, ${customer.numero || ""}`, 110, 56);
      doc.text(`${customer.bairro || ""} - ${customer.cidade || ""} - ${customer.estado || ""}`, 110, 61);

      // Dados da Fatura
      doc.setDrawColor(200);
      doc.line(20, 70, pageWidth - 20, 70);
      
      const startY = 80;
      doc.setFont("helvetica", "bold");
      doc.text("Mês de referência:", 20, startY);
      doc.text("Plano contratado:", 20, startY + 7);
      doc.text("Consumo download:", 20, startY + 14);
      doc.text("Consumo upload:", 20, startY + 21);
      doc.text("Data de vencimento:", 20, startY + 28);

      doc.setFont("helvetica", "normal");
      const refMonth = new Date(invoice.vencimento + "T12:00:00").toLocaleDateString("pt-BR", { month: 'long', year: 'numeric' });
      doc.text(refMonth, 70, startY);
      doc.text(plan?.nome || "Plano Internet", 70, startY + 7);
      doc.text(consumption.download, 70, startY + 14);
      doc.text(consumption.upload, 70, startY + 21);
      doc.text(new Date(invoice.vencimento + "T12:00:00").toLocaleDateString("pt-BR"), 70, startY + 28);

      // Valor Total
      doc.setFillColor(240, 248, 255);
      doc.rect(20, startY + 35, pageWidth - 40, 15, "F");
      doc.setFontSize(14);
      doc.setFont("helvetica", "bold");
      doc.text("VALOR TOTAL A PAGAR:", 30, startY + 45);
      doc.text((invoice.valor_centavos / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" }), pageWidth - 30, startY + 45, { align: "right" });

      // PIX
      doc.setFontSize(12);
      doc.setTextColor(0);
      doc.setFont("helvetica", "bold");
      doc.text("PAGAMENTO VIA PIX", 20, startY + 65);
      
      doc.setFontSize(9);
      doc.setFont("helvetica", "normal");
      doc.text(`Chave PIX: ${pix.key || "Não configurada"}`, 20, startY + 72);
      doc.text(`Favorecido: ${pix.name || "Mororo Tech"}`, 20, startY + 77);
      
      doc.setFont("helvetica", "bold");
      doc.text("PIX Copia e Cola:", 20, startY + 85);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(7);
      const splitPayload = doc.splitTextToSize(pix.payload, pageWidth - 90);
      doc.text(splitPayload, 20, startY + 90);

      // QR Code
      try {
        const qrCodeDataUrl = await QRCode.toDataURL(pix.payload, { margin: 1, width: 200 });
        doc.addImage(qrCodeDataUrl, "PNG", pageWidth - 65, startY + 60, 45, 45);
        doc.setFontSize(8);
        doc.text("Escaneie para pagar", pageWidth - 42.5, startY + 108, { align: "center" });
      } catch (e) {
        console.error("Error generating QR Code", e);
      }


      // Footer
      doc.setFontSize(8);
      doc.setTextColor(150);
      doc.text("Esta é uma fatura gerada automaticamente pelo sistema Mororo.Tech.", pageWidth / 2, doc.internal.pageSize.getHeight() - 20, { align: "center" });
      doc.text("Mororo.Tech - Soluções em Tecnologia", pageWidth / 2, doc.internal.pageSize.getHeight() - 15, { align: "center" });

      if (open) {
        doc.output("dataurlnewwindow");
      }
      
      return doc.output("blob");
    } catch (err: any) {
      toast.error(err.message || "Erro ao gerar PDF");
      return null;
    } finally {
      setGenerating(false);
    }
  };

  return { generatePDF, generating };
}
