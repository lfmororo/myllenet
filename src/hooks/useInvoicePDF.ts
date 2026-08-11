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
      const pageHeight = doc.internal.pageSize.getHeight();

      // Background Color for Header
      doc.setFillColor(248, 250, 252);
      doc.rect(0, 0, pageWidth, 60, "F");

      // Logo and Header
      try {
        const img = new Image();
        img.src = "/logo.png"; 
        
        await new Promise((resolve) => {
          img.onload = resolve;
          img.onerror = () => {
            img.src = new URL("/src/assets/logo.png", window.location.origin).href;
            img.onload = resolve;
            img.onerror = () => resolve(null);
          };
        });
        
        if (img.complete && img.naturalWidth > 0) {
          const imgWidth = 55;
          const imgHeight = (img.naturalHeight * imgWidth) / img.naturalWidth;
          // PNG format preserves transparency (will show the light background)
          doc.addImage(img, "PNG", 20, 15, imgWidth, imgHeight);
        }
      } catch (e) {
        console.error("Logo loading error", e);
      }

      doc.setFontSize(22);
      doc.setTextColor(15, 23, 42); // Slate 900
      doc.setFont("helvetica", "bold");
      doc.text("FATURA MENSAL", pageWidth - 20, 30, { align: "right" });
      
      doc.setFontSize(10);
      doc.setTextColor(71, 85, 105); // Slate 600
      doc.setFont("helvetica", "normal");
      doc.text(`Nº DOCUMENTO: ${invoiceId.substring(0, 8).toUpperCase()}/${new Date().getFullYear()}`, pageWidth - 20, 38, { align: "right" });

      // Divider
      doc.setDrawColor(226, 232, 240); // Slate 200
      doc.line(20, 60, pageWidth - 20, 60);

      // Info Sections Grid
      const col1 = 20;
      const col2 = 110;
      let currentY = 75;

      // Prestador
      doc.setFontSize(11);
      doc.setTextColor(15, 23, 42);
      doc.setFont("helvetica", "bold");
      doc.text("DADOS DO EMISSOR", col1, currentY);
      
      doc.setFontSize(10);
      doc.setFont("helvetica", "normal");
      doc.setTextColor(51, 65, 85);
      doc.text("Mororo.Tech - Soluções em Tecnologia", col1, currentY + 7);
      doc.text("CNPJ: 00.000.000/0000-00", col1, currentY + 12);
      doc.text("Ipu - Ceará, Brasil", col1, currentY + 17);
      doc.text("contato@mororo.tech", col1, currentY + 22);

      // Cliente
      doc.setFontSize(11);
      doc.setFont("helvetica", "bold");
      doc.setTextColor(15, 23, 42);
      doc.text("DADOS DO CLIENTE", col2, currentY);
      
      doc.setFontSize(10);
      doc.setFont("helvetica", "normal");
      doc.setTextColor(51, 65, 85);
      doc.text(customer.nome, col2, currentY + 7);
      doc.text(`CPF/CNPJ: ${customer.cpf}`, col2, currentY + 12);
      doc.text(`${customer.rua || ""}, ${customer.numero || ""}`, col2, currentY + 17);
      doc.text(`${customer.bairro || ""} - ${customer.cidade || ""}`, col2, currentY + 22);

      currentY += 40;

      // Details Table-like Layout
      doc.setFillColor(248, 250, 252);
      doc.rect(20, currentY, pageWidth - 40, 45, "F");
      doc.setDrawColor(226, 232, 240);
      doc.rect(20, currentY, pageWidth - 40, 45, "S");

      doc.setFontSize(10);
      doc.setFont("helvetica", "bold");
      doc.setTextColor(15, 23, 42);
      
      const tableY = currentY + 10;
      doc.text("MÊS DE REFERÊNCIA", 30, tableY);
      doc.text("PLANO", 75, tableY);
      doc.text("CONSUMO (DL/UL)", 120, tableY);
      doc.text("VENCIMENTO", 175, tableY, { align: "right" });

      doc.setFont("helvetica", "normal");
      doc.setTextColor(51, 65, 85);
      const refMonth = new Date(invoice.vencimento + "T12:00:00").toLocaleDateString("pt-BR", { month: 'long', year: 'numeric' });
      doc.text(refMonth.toUpperCase(), 30, tableY + 8);
      doc.text(plan?.nome || "Internet", 75, tableY + 8);
      doc.text(`${consumption.download} / ${consumption.upload}`, 120, tableY + 8);
      doc.text(new Date(invoice.vencimento + "T12:00:00").toLocaleDateString("pt-BR"), 175, tableY + 8, { align: "right" });

      // Total Value Box
      currentY += 55;
      doc.setFillColor(15, 23, 42);
      doc.rect(pageWidth - 90, currentY, 70, 20, "F");
      
      doc.setFontSize(9);
      doc.setTextColor(255, 255, 255);
      doc.setFont("helvetica", "normal");
      doc.text("VALOR TOTAL", pageWidth - 80, currentY + 7);
      
      doc.setFontSize(16);
      doc.setFont("helvetica", "bold");
      const totalValue = (invoice.valor_centavos / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
      doc.text(totalValue, pageWidth - 80, currentY + 15);

      // Payment Section
      currentY += 35;
      doc.setFontSize(12);
      doc.setTextColor(15, 23, 42);
      doc.setFont("helvetica", "bold");
      doc.text("INSTRUÇÕES DE PAGAMENTO", 20, currentY);
      
      doc.setFontSize(10);
      doc.setFont("helvetica", "normal");
      doc.setTextColor(51, 65, 85);
      doc.text("Pague via PIX para liberação imediata do sinal.", 20, currentY + 7);

      // PIX Container
      currentY += 15;
      doc.setDrawColor(226, 232, 240);
      doc.line(20, currentY, pageWidth - 20, currentY);
      
      const pixY = currentY + 10;
      doc.setFontSize(10);
      doc.setFont("helvetica", "bold");
      doc.text("DADOS DO PIX", 20, pixY);
      
      doc.setFont("helvetica", "normal");
      doc.text(`Favorecido: ${pix.name || "Mororo Tech"}`, 20, pixY + 7);
      doc.text(`Chave PIX: ${pix.key || "Não configurada"}`, 20, pixY + 12);
      
      doc.setFont("helvetica", "bold");
      doc.text("PIX COPIA E COLA:", 20, pixY + 22);
      doc.setFontSize(8);
      doc.setFont("helvetica", "normal");
      const splitPayload = doc.splitTextToSize(pix.payload, pageWidth - 100);
      doc.text(splitPayload, 20, pixY + 28);

      // QR Code Box
      try {
        const qrCodeDataUrl = await QRCode.toDataURL(pix.payload, { 
          margin: 1, 
          width: 200,
          color: { dark: "#0f172a", light: "#ffffff" }
        });
        doc.setFillColor(255, 255, 255);
        doc.rect(pageWidth - 75, pixY, 55, 55, "F");
        doc.setDrawColor(226, 232, 240);
        doc.rect(pageWidth - 75, pixY, 55, 55, "S");
        doc.addImage(qrCodeDataUrl, "PNG", pageWidth - 72, pixY + 3, 49, 49);
        doc.setFontSize(8);
        doc.text("ESCANEIE O CÓDIGO", pageWidth - 47.5, pixY + 62, { align: "center" });
      } catch (e) {
        console.error("Error generating QR Code", e);
      }

      // Footer
      doc.setFontSize(8);
      doc.setTextColor(148, 163, 184); // Slate 400
      doc.text("Mororo.Tech © 2026 - Soluções em Tecnologia e Desenvolvimento de Sistemas", pageWidth / 2, pageHeight - 15, { align: "center" });

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
