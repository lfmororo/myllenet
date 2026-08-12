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

      // Colors - Mororo.Tech Palette
      const primaryColor = [15, 23, 42]; // Deep Blue (Slate-900)
      const accentColor = [13, 148, 136]; // Teal/Cyan (Teal-600)
      const bgColor = [248, 250, 252]; // Slate-50
      const textColor = [30, 41, 59]; // Slate-800
      const lightTextColor = [71, 85, 105]; // Slate-600
      const borderColor = [226, 232, 240]; // Slate-200

      // 1. Header with Accent Bar
      doc.setFillColor(accentColor[0], accentColor[1], accentColor[2]);
      doc.rect(0, 0, pageWidth, 5, "F");

      // Background matching for header transparency
      doc.setFillColor(255, 255, 255); // White background
      doc.rect(0, 5, pageWidth, 50, "F");

      // Logo
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
          const imgWidth = 65; // Slightly larger for the new logo
          const imgHeight = (img.naturalHeight * imgWidth) / img.naturalWidth;
          doc.addImage(img, "PNG", 18, 15, imgWidth, imgHeight);
        }
      } catch (e) { console.error(e); }

      // Invoice Title & Number
      doc.setFontSize(22);
      doc.setTextColor(primaryColor[0], primaryColor[1], primaryColor[2]);
      doc.setFont("helvetica", "bold");
      doc.text("FATURA", pageWidth - 20, 26, { align: "right" });
      
      doc.setFontSize(9);
      doc.setTextColor(lightTextColor[0], lightTextColor[1], lightTextColor[2]);
      doc.setFont("helvetica", "normal");
      doc.text("IDENTIFICAÇÃO DO DOCUMENTO", pageWidth - 20, 32, { align: "right" });
      doc.setFont("helvetica", "bold");
      doc.setTextColor(textColor[0], textColor[1], textColor[2]);
      doc.text(`#${invoiceId.substring(0, 8).toUpperCase()}`, pageWidth - 20, 37, { align: "right" });

      let currentY = 75;

      // 2. Client & Issuer Info (Grid)
      doc.setFontSize(9);
      doc.setFont("helvetica", "bold");
      doc.setTextColor(lightTextColor[0], lightTextColor[1], lightTextColor[2]);
      doc.text("DADOS DO EMISSOR", 20, currentY - 5);
      doc.text("DADOS DO CLIENTE", 110, currentY - 5);

      // Issuer Column
      doc.setFontSize(10);
      doc.setFont("helvetica", "bold");
      doc.setTextColor(primaryColor[0], primaryColor[1], primaryColor[2]);
      doc.text("Mororo.Tech - Soluções em TI", 20, currentY);
      
      doc.setFont("helvetica", "normal");
      doc.setTextColor(textColor[0], textColor[1], textColor[2]);
      doc.text(`CNPJ: ${pix.cnpj || "00.000.000/0000-00"}`, 20, currentY + 6);
      doc.text("Ipu - Ceará, Brasil", 20, currentY + 11);
      doc.text(`Contato: ${pix.phone || "(88) 99999-9999"}`, 20, currentY + 16);

      // Client Column
      doc.setFont("helvetica", "bold");
      doc.setTextColor(primaryColor[0], primaryColor[1], primaryColor[2]);
      doc.text(customer.nome, 110, currentY);
      
      doc.setFont("helvetica", "normal");
      doc.setTextColor(textColor[0], textColor[1], textColor[2]);
      doc.text(`CPF/CNPJ: ${customer.cpf}`, 110, currentY + 6);
      doc.text(`${customer.rua || ""}, ${customer.numero || ""}`, 110, currentY + 11);
      doc.text(`${customer.bairro || ""} - ${customer.cidade || ""}`, 110, currentY + 16);

      currentY += 35;

      // 3. Service Summary Table
      doc.setFillColor(primaryColor[0], primaryColor[1], primaryColor[2]);
      doc.rect(20, currentY, pageWidth - 40, 10, "F");
      
      doc.setTextColor(255, 255, 255);
      doc.setFontSize(8);
      doc.setFont("helvetica", "bold");
      doc.text("DESCRIÇÃO DO SERVIÇO", 25, currentY + 6.5);
      doc.text("REFERÊNCIA", 85, currentY + 6.5);
      doc.text("CONSUMO", 125, currentY + 6.5);
      doc.text("TOTAL", pageWidth - 25, currentY + 6.5, { align: "right" });

      currentY += 10;
      doc.setTextColor(textColor[0], textColor[1], textColor[2]);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(9);
      
      const rowHeight = 12;
      doc.setDrawColor(226, 232, 240);
      doc.line(20, currentY + rowHeight, pageWidth - 20, currentY + rowHeight);

      const refMonth = new Date(invoice.vencimento + "T12:00:00").toLocaleDateString("pt-BR", { month: 'long', year: 'numeric' }).toUpperCase();
      doc.text(plan?.nome || "Internet Residencial", 25, currentY + 8);
      doc.text(refMonth, 85, currentY + 8);
      
      doc.setFontSize(8);
      doc.text(`${consumption.download} DL / ${consumption.upload} UL`, 125, currentY + 8);
      
      doc.setFontSize(10);
      const totalValue = (invoice.valor_centavos / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
      doc.setFont("helvetica", "bold");
      doc.text(totalValue, pageWidth - 25, currentY + 8, { align: "right" });

      currentY += 20;

      // 4. Financial Highlight Box
      const boxWidth = 65;
      const boxX = pageWidth - 20 - boxWidth;
      
      doc.setFillColor(bgColor[0], bgColor[1], bgColor[2]);
      doc.rect(boxX, currentY, boxWidth, 28, "F");
      doc.setDrawColor(accentColor[0], accentColor[1], accentColor[2]);
      doc.setLineWidth(1);
      doc.line(boxX + boxWidth, currentY, boxX + boxWidth, currentY + 28);

      doc.setTextColor(lightTextColor[0], lightTextColor[1], lightTextColor[2]);
      doc.setFontSize(7.5);
      doc.setFont("helvetica", "bold");
      doc.text("TOTAL A PAGAR", boxX + 5, currentY + 9);
      doc.text("VENCIMENTO", boxX + 5, currentY + 20);

      doc.setTextColor(primaryColor[0], primaryColor[1], primaryColor[2]);
      doc.setFontSize(14);
      doc.setFont("helvetica", "bold");
      doc.text(totalValue, boxX + boxWidth - 5, currentY + 11, { align: "right" });
      
      const dueDate = new Date(invoice.vencimento + "T12:00:00").toLocaleDateString("pt-BR");
      doc.setFontSize(11);
      doc.text(dueDate, boxX + boxWidth - 5, currentY + 22, { align: "right" });

      currentY += 40;

      // 5. Payment Area (PIX Focus)
      doc.setDrawColor(226, 232, 240);
      doc.setLineWidth(0.2);
      doc.line(20, currentY, pageWidth - 20, currentY);
      
      currentY += 10;
      doc.setFontSize(13);
      doc.setTextColor(accentColor[0], accentColor[1], accentColor[2]);
      doc.setFont("helvetica", "bold");
      doc.text("PAGAMENTO VIA PIX", 20, currentY);
      
      doc.setFontSize(9);
      doc.setTextColor(lightTextColor[0], lightTextColor[1], lightTextColor[2]);
      doc.setFont("helvetica", "normal");
      doc.text("Pague com PIX e tenha liberação imediata da sua conexão.", 20, currentY + 6);

      currentY += 12;
      
      // QR Code Box
      try {
        const qrSize = 52;
        const qrCodeDataUrl = await QRCode.toDataURL(pix.payload, { 
          margin: 1, 
          width: 300,
          color: { dark: "#0f172a", light: "#ffffff" }
        });
        
        doc.setFillColor(255, 255, 255);
        doc.rect(20, currentY, qrSize + 8, qrSize + 8, "F");
        doc.setDrawColor(226, 232, 240);
        doc.rect(20, currentY, qrSize + 8, qrSize + 8, "S");
        doc.addImage(qrCodeDataUrl, "PNG", 24, currentY + 4, qrSize, qrSize);
        
        // PIX Instructions
        const textX = 85;
        doc.setFontSize(9);
        doc.setFont("helvetica", "bold");
        doc.setTextColor(primaryColor[0], primaryColor[1], primaryColor[2]);
        doc.text("PASSO A PASSO PARA PAGAR:", textX, currentY + 4);
        
        doc.setFont("helvetica", "normal");
        doc.setFontSize(8.5);
        doc.setTextColor(textColor[0], textColor[1], textColor[2]);
        doc.text("1. Abra o aplicativo do seu banco", textX, currentY + 10);
        doc.text("2. Selecione a opção PIX (QR Code ou Copia e Cola)", textX, currentY + 15);
        doc.text("3. Escaneie o QR Code ou cole o código abaixo", textX, currentY + 20);
        
        doc.setFont("helvetica", "bold");
        doc.setTextColor(accentColor[0], accentColor[1], accentColor[2]);
        doc.text("PIX COPIA E COLA:", textX, currentY + 30);
        
        doc.setFont("helvetica", "normal");
        doc.setFontSize(7.5);
        doc.setTextColor(textColor[0], textColor[1], textColor[2]);
        const splitPayload = doc.splitTextToSize(pix.payload, pageWidth - textX - 20);
        doc.text(splitPayload, textX, currentY + 35);

        doc.setFontSize(8.5);
        doc.setFont("helvetica", "bold");
        doc.setTextColor(primaryColor[0], primaryColor[1], primaryColor[2]);
        doc.text(`Identificador:`, textX, currentY + 52);
        doc.setFont("helvetica", "normal");
        const refMonthShort = new Date(invoice.vencimento + "T12:00:00").toLocaleDateString('pt-BR', { month: '2-digit', year: '2-digit' }).replace('/', '');
        const shortName = (customer.nome || "").split(' ')[0].normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-zA-Z0-9]/g, "").toUpperCase().substring(0, 10);
        const ident = `${shortName}${refMonthShort}` || `INV${invoiceId.substring(0, 8).toUpperCase()}`;
        doc.text(ident, textX + 22, currentY + 52);

        doc.setFont("helvetica", "bold");
        doc.text(`Favorecido:`, textX, currentY + 57);
        doc.setFont("helvetica", "normal");
        doc.text(`${pix.name || "Mororo Tech"}`, textX + 18, currentY + 57);
        
        doc.setFont("helvetica", "bold");
        doc.text(`Chave:`, textX, currentY + 62);
        doc.setFont("helvetica", "normal");
        doc.text(`${pix.key || "N/A"}`, textX + 11, currentY + 62);

      } catch (e) { console.error(e); }

      // 6. Footer
      doc.setFontSize(7);
      doc.setTextColor(lightTextColor[0], lightTextColor[1], lightTextColor[2]);
      const footerY = pageHeight - 12;
      doc.text("ESTA É UMA FATURA DE SERVIÇOS DE COMUNICAÇÃO MULTIMÍDIA.", 20, footerY);
      doc.setFont("helvetica", "bold");
      doc.text("Mororo.Tech © 2026", pageWidth - 20, footerY, { align: "right" });

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
