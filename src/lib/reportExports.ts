import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import * as XLSX from "xlsx";

export type ReportColumn = { key: string; label: string };
export type ReportRow = Record<string, string | number>;
export type ReportMeta = { title: string; filters: string; user: string };

const stamp = () => new Date().toLocaleString("pt-BR");
const safeName = (title: string) => title.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-zA-Z0-9]+/g, "_").toLowerCase();
const download = (blob: Blob, name: string) => {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  URL.revokeObjectURL(url);
};

export function exportCSV(meta: ReportMeta, columns: ReportColumn[], rows: ReportRow[]) {
  const escape = (value: unknown) => `"${String(value ?? "").replace(/"/g, '""')}"`;
  const lines = [
    ["Mororo.Tech", meta.title].map(escape).join(";"),
    ["Filtros", meta.filters].map(escape).join(";"),
    ["Emitido em", stamp(), "Usuário", meta.user].map(escape).join(";"),
    "",
    columns.map((column) => escape(column.label)).join(";"),
    ...rows.map((row) => columns.map((column) => escape(row[column.key])).join(";")),
  ];
  download(new Blob(["\uFEFF" + lines.join("\n")], { type: "text/csv;charset=utf-8" }), `${safeName(meta.title)}.csv`);
}

export function exportXLSX(meta: ReportMeta, columns: ReportColumn[], rows: ReportRow[]) {
  const aoa = [
    ["Mororo.Tech", meta.title],
    ["Filtros aplicados", meta.filters],
    ["Data/hora de emissão", stamp()],
    ["Usuário", meta.user],
    [],
    columns.map((column) => column.label),
    ...rows.map((row) => columns.map((column) => row[column.key] ?? "")),
  ];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws["!cols"] = columns.map((column) => ({ wch: Math.max(14, column.label.length + 3) }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Relatório");
  XLSX.writeFile(wb, `${safeName(meta.title)}.xlsx`);
}

export function exportPDF(meta: ReportMeta, columns: ReportColumn[], rows: ReportRow[]) {
  const doc = new jsPDF({ orientation: columns.length > 6 ? "landscape" : "portrait" });
  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.text("Mororo.Tech", 14, 14);
  doc.setFontSize(12);
  doc.text(meta.title, 14, 21);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.text(`Filtros: ${meta.filters}`, 14, 27, { maxWidth: 250 });
  doc.text(`Emitido em ${stamp()} por ${meta.user}`, 14, 33);
  autoTable(doc, {
    startY: 38,
    head: [columns.map((column) => column.label)],
    body: rows.map((row) => columns.map((column) => String(row[column.key] ?? ""))),
    styles: { fontSize: 7, cellPadding: 2 },
    headStyles: { fillColor: [0, 122, 153] },
  });
  doc.save(`${safeName(meta.title)}.pdf`);
}
