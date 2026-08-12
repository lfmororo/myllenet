import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";

export function useDiagnosticPDF() {
  const [generating, setGenerating] = useState(false);

  const generatePDF = async (reportData: any) => {
    setGenerating(true);
    try {
      const doc = new jsPDF();
      const pageWidth = doc.internal.pageSize.getWidth();
      
      // Cores do sistema
      const primaryColor = [15, 23, 42]; // Slate-900
      const accentColor = [13, 148, 136]; // Teal-600
      const textColor = [30, 41, 59]; // Slate-800
      const lightTextColor = [71, 85, 105]; // Slate-600

      // Header
      doc.setFillColor(accentColor[0], accentColor[1], accentColor[2]);
      doc.rect(0, 0, pageWidth, 5, "F");

      doc.setFontSize(20);
      doc.setTextColor(primaryColor[0], primaryColor[1], primaryColor[2]);
      doc.setFont("helvetica", "bold");
      doc.text("RELATÓRIO DE DIAGNÓSTICO API", 20, 25);
      
      doc.setFontSize(10);
      doc.setTextColor(lightTextColor[0], lightTextColor[1], lightTextColor[2]);
      doc.setFont("helvetica", "normal");
      doc.text("Mororo.Tech - Sistema de Gestão", 20, 32);
      
      doc.text(`Período: ${new Date(reportData.period.start).toLocaleDateString()} a ${new Date(reportData.period.end).toLocaleDateString()}`, pageWidth - 20, 25, { align: "right" });
      doc.text(`Gerado em: ${new Date().toLocaleString()}`, pageWidth - 20, 32, { align: "right" });

      // 1. Resumo Executivo
      doc.setFontSize(14);
      doc.setTextColor(primaryColor[0], primaryColor[1], primaryColor[2]);
      doc.setFont("helvetica", "bold");
      doc.text("1. RESUMO EXECUTIVO", 20, 50);

      const summaryData = [
        ["Métrica", "Valor"],
        ["Total de Chamadas API Efí", reportData.summary.total_efi_calls.toString()],
        ["Erros na API Efí", reportData.summary.efi_errors.toString()],
        ["Taxa de Sucesso Efí", `${reportData.summary.total_efi_calls > 0 ? (100 - (reportData.summary.efi_errors / reportData.summary.total_efi_calls * 100)).toFixed(1) : 100}%`],
        ["Tempo Médio de Resposta", `${reportData.efi_metrics.avg_response_time} ms`],
        ["Total de Notificações Enviadas", reportData.summary.total_notifications.toString()],
        ["Falhas de Notificação", reportData.summary.notification_failures.toString()],
        ["Eventos de Queda Mikrotik", reportData.summary.mikrotik_downtime_events.toString()],
      ];

      autoTable(doc, {
        startY: 55,
        head: [summaryData[0]],
        body: summaryData.slice(1),
        theme: "striped",
        headStyles: { fillColor: primaryColor as [number, number, number] },
        margin: { left: 20, right: 20 }
      });

      // 2. Detalhes de Erros por Rota
      let currentY = (doc as any).lastAutoTable.finalY + 15;
      doc.setFontSize(14);
      doc.setFont("helvetica", "bold");
      doc.text("2. ERROS POR ENDPOINT (API EFÍ)", 20, currentY);

      const errorRoutes = Object.entries(reportData.efi_metrics.errors_by_endpoint);
      if (errorRoutes.length > 0) {
        const routeData = errorRoutes.map(([route, count]) => [route, count.toString()]);
        autoTable(doc, {
          startY: currentY + 5,
          head: [["Endpoint", "Qtd. Erros"]],
          body: routeData,
          theme: "grid",
          headStyles: { fillColor: [220, 38, 38] }, // Red for errors
          margin: { left: 20, right: 20 }
        });
      } else {
        doc.setFontSize(10);
        doc.setFont("helvetica", "normal");
        doc.setTextColor(textColor[0], textColor[1], textColor[2]);
        doc.text("Nenhum erro registrado no período.", 25, currentY + 10);
        (doc as any).lastAutoTable = { finalY: currentY + 10 };
      }

      // 3. Status Mikrotik
      currentY = (doc as any).lastAutoTable.finalY + 15;
      doc.setFontSize(14);
      doc.setFont("helvetica", "bold");
      doc.setTextColor(primaryColor[0], primaryColor[1], primaryColor[2]);
      doc.text("3. CONECTIVIDADE MIKROTIK", 20, currentY);

      const mktLogs = reportData.details.mikrotik_logs.slice(0, 10).map((log: any) => [
        new Date(log.logged_at).toLocaleString(),
        log.online ? "ONLINE" : "OFFLINE",
        log.message || "-"
      ]);

      autoTable(doc, {
        startY: currentY + 5,
        head: [["Horário", "Status", "Mensagem"]],
        body: mktLogs,
        theme: "striped",
        headStyles: { fillColor: accentColor as [number, number, number] },
        margin: { left: 20, right: 20 }
      });

      // Footer
      const pageCount = (doc.internal as any).getNumberOfPages();
      for (let i = 1; i <= pageCount; i++) {
        doc.setPage(i);
        doc.setFontSize(8);
        doc.setTextColor(lightTextColor[0], lightTextColor[1], lightTextColor[2]);
        doc.text(`Mororo.Tech - Diagnóstico de Infraestrutura - Página ${i} de ${pageCount}`, pageWidth / 2, doc.internal.pageSize.getHeight() - 10, { align: "center" });
      }

      doc.save(`diagnostico-api-${reportData.period.start.split('T')[0]}.pdf`);
      toast.success("PDF gerado com sucesso!");
    } catch (err: any) {
      console.error(err);
      toast.error("Erro ao gerar PDF: " + err.message);
    } finally {
      setGenerating(false);
    }
  };

  return { generatePDF, generating };
}
