import { useState, useCallback, useRef } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Upload, FileText, AlertTriangle, CheckCircle, Loader2, X } from "lucide-react";
import { toast } from "sonner";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  customers: { id: string; nome: string; cpf: string }[];
  onImport: (invoices: InvoiceRow[]) => Promise<{ success: number; failed: number }>;
}

export interface InvoiceRow {
  customer_id: string;
  descricao: string;
  valor_centavos: number;
  vencimento: string;
  status: string;
}

type Step = "upload" | "mapping" | "preview";

const EXPECTED_FIELDS = ["cpf", "descricao", "valor", "vencimento", "status"] as const;
type FieldKey = typeof EXPECTED_FIELDS[number];

const FIELD_LABELS: Record<FieldKey, string> = {
  cpf: "CPF do Cliente",
  descricao: "Descrição",
  valor: "Valor (R$)",
  vencimento: "Vencimento",
  status: "Status",
};

const REQUIRED_FIELDS: FieldKey[] = ["cpf", "valor", "vencimento"];

interface ValidationIssue {
  row: number;
  field: string;
  message: string;
  type: "error" | "warning";
}

function parseCSVLine(line: string, separator: string): string[] {
  const values: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      if (inQuotes && i + 1 < line.length && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === separator && !inQuotes) {
      values.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }
  values.push(current.trim());
  return values;
}

function detectSeparator(firstLine: string): string {
  const semicolons = (firstLine.match(/;/g) || []).length;
  const commas = (firstLine.match(/,/g) || []).length;
  const tabs = (firstLine.match(/\t/g) || []).length;
  if (tabs > commas && tabs > semicolons) return "\t";
  if (semicolons > commas) return ";";
  return ",";
}

function normalizeHeader(h: string): string {
  return h.trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]/g, "_");
}

const HEADER_ALIASES: Record<string, FieldKey> = {
  cpf: "cpf", cpf_cnpj: "cpf", documento: "cpf",
  descricao: "descricao", description: "descricao", titulo: "descricao",
  valor: "valor", value: "valor", amount: "valor", valor_centavos: "valor", total: "valor",
  vencimento: "vencimento", due_date: "vencimento", data_vencimento: "vencimento", expiration: "vencimento",
  status: "status", situacao: "status",
};

function autoMapColumns(headers: string[]): Record<FieldKey, number | null> {
  const mapping: Record<FieldKey, number | null> = { cpf: null, descricao: null, valor: null, vencimento: null, status: null };
  headers.forEach((h, idx) => {
    const normalized = normalizeHeader(h);
    const field = HEADER_ALIASES[normalized];
    if (field && mapping[field] === null) mapping[field] = idx;
  });
  return mapping;
}

function cleanCPF(cpf: string): string {
  return cpf.replace(/\D/g, "");
}

function parseValor(raw: string): number | null {
  if (!raw) return null;
  // Handle "R$ 1.234,56" or "1234.56" or "1234,56"
  let cleaned = raw.replace(/[R$\s]/g, "");
  // Detect locale: if has comma as last separator, it's decimal
  const lastComma = cleaned.lastIndexOf(",");
  const lastDot = cleaned.lastIndexOf(".");
  if (lastComma > lastDot) {
    // Brazilian format: 1.234,56
    cleaned = cleaned.replace(/\./g, "").replace(",", ".");
  } else if (lastDot > lastComma) {
    // US format or no thousands: 1,234.56
    cleaned = cleaned.replace(/,/g, "");
  }
  const num = parseFloat(cleaned);
  if (isNaN(num)) return null;
  return Math.round(num * 100);
}

function parseDate(raw: string): string | null {
  if (!raw) return null;
  // Try DD/MM/YYYY
  const brMatch = raw.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
  if (brMatch) {
    const [, d, m, y] = brMatch;
    return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }
  // Try YYYY-MM-DD
  const isoMatch = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (isoMatch) return `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`;
  return null;
}

function mapStatus(raw: string): string {
  const lower = raw.toLowerCase().trim();
  if (["pago", "paid", "liquidado", "settled"].includes(lower)) return "paid";
  if (["cancelado", "cancelled", "canceled"].includes(lower)) return "cancelled";
  if (["vencido", "overdue", "expired"].includes(lower)) return "overdue";
  return "pending";
}

export default function InvoiceCSVImportDialog({ open, onOpenChange, customers, onImport }: Props) {
  const [step, setStep] = useState<Step>("upload");
  const [headers, setHeaders] = useState<string[]>([]);
  const [rows, setRows] = useState<string[][]>([]);
  const [mapping, setMapping] = useState<Record<FieldKey, number | null>>({ cpf: null, descricao: null, valor: null, vencimento: null, status: null });
  const [issues, setIssues] = useState<ValidationIssue[]>([]);
  const [validRows, setValidRows] = useState<InvoiceRow[]>([]);
  const [importing, setImporting] = useState(false);
  const [fileName, setFileName] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  const reset = () => {
    setStep("upload"); setHeaders([]); setRows([]);
    setMapping({ cpf: null, descricao: null, valor: null, vencimento: null, status: null });
    setIssues([]); setValidRows([]); setImporting(false); setFileName("");
  };

  const handleClose = (val: boolean) => { if (!val) reset(); onOpenChange(val); };

  const handleFile = useCallback((file: File) => {
    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target?.result as string;
      if (!text) { toast.error("Arquivo vazio"); return; }
      const lines = text.split(/\r?\n/).filter((l) => l.trim());
      if (lines.length < 2) { toast.error("Arquivo precisa ter cabeçalho e pelo menos 1 linha"); return; }
      const sep = detectSeparator(lines[0]);
      setHeaders(parseCSVLine(lines[0], sep));
      setRows(lines.slice(1).map((l) => parseCSVLine(l, sep)));
      setMapping(autoMapColumns(parseCSVLine(lines[0], sep)));
      setStep("mapping");
    };
    reader.readAsText(file, "UTF-8");
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  }, [handleFile]);

  const handleMapChange = (field: FieldKey, value: string) => {
    setMapping((prev) => ({ ...prev, [field]: value === "__none__" ? null : Number(value) }));
  };

  const cpfToCustomer = new Map(customers.map(c => [cleanCPF(c.cpf), c]));

  const processPreview = () => {
    const newIssues: ValidationIssue[] = [];
    const valid: InvoiceRow[] = [];

    for (const f of REQUIRED_FIELDS) {
      if (mapping[f] === null) { toast.error(`Mapeie a coluna obrigatória: ${FIELD_LABELS[f]}`); return; }
    }

    rows.forEach((row, idx) => {
      const rowNum = idx + 2;
      let rowValid = true;
      const getValue = (field: FieldKey): string => {
        const colIdx = mapping[field];
        if (colIdx === null || colIdx >= row.length) return "";
        return row[colIdx].trim();
      };

      const cpfRaw = getValue("cpf");
      const cpf = cleanCPF(cpfRaw);
      const customer = cpfToCustomer.get(cpf);
      if (!customer) { newIssues.push({ row: rowNum, field: "CPF", message: cpf ? "Cliente não encontrado" : "Vazio", type: "error" }); rowValid = false; }

      const valorRaw = getValue("valor");
      const valorCentavos = parseValor(valorRaw);
      if (valorCentavos === null || valorCentavos <= 0) { newIssues.push({ row: rowNum, field: "Valor", message: valorRaw ? "Formato inválido" : "Vazio", type: "error" }); rowValid = false; }

      const vencRaw = getValue("vencimento");
      const vencimento = parseDate(vencRaw);
      if (!vencimento) { newIssues.push({ row: rowNum, field: "Vencimento", message: vencRaw ? "Formato inválido (use DD/MM/AAAA)" : "Vazio", type: "error" }); rowValid = false; }

      const descricao = getValue("descricao") || "Cobrança importada via CSV";
      const statusRaw = getValue("status");
      const status = statusRaw ? mapStatus(statusRaw) : "pending";

      if (rowValid && customer && valorCentavos && vencimento) {
        valid.push({ customer_id: customer.id, descricao, valor_centavos: valorCentavos, vencimento, status });
      }
    });

    setIssues(newIssues);
    setValidRows(valid);
    setStep("preview");
  };

  const handleImport = async () => {
    if (validRows.length === 0) return;
    setImporting(true);
    try {
      const result = await onImport(validRows);
      toast.success(`${result.success} cobrança(s) importada(s)!`);
      if (result.failed > 0) toast.error(`${result.failed} falha(s) na importação`);
      handleClose(false);
    } catch {
      toast.error("Erro durante a importação");
    }
    setImporting(false);
  };

  const errors = issues.filter((i) => i.type === "error");
  const warnings = issues.filter((i) => i.type === "warning");

  const formatCentavos = (v: number) => (v / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-2xl max-h-[85vh] flex flex-col overflow-hidden">
        <DialogHeader className="flex-shrink-0">
          <DialogTitle>Importar Cobranças via CSV</DialogTitle>
          <DialogDescription>
            {step === "upload" && "Selecione ou arraste um arquivo CSV com as cobranças"}
            {step === "mapping" && "Mapeie as colunas do arquivo para os campos do sistema"}
            {step === "preview" && "Revise os dados antes de importar"}
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 min-h-0 overflow-y-auto">
          {step === "upload" && (
            <div
              className="flex flex-col items-center justify-center gap-4 rounded-lg border-2 border-dashed border-muted-foreground/25 p-12 cursor-pointer hover:border-primary/50 transition-colors"
              onDragOver={(e) => e.preventDefault()}
              onDrop={handleDrop}
              onClick={() => fileRef.current?.click()}
            >
              <Upload className="h-10 w-10 text-muted-foreground" />
              <div className="text-center">
                <p className="font-medium">Clique ou arraste o arquivo CSV aqui</p>
                <p className="text-sm text-muted-foreground">Colunas esperadas: CPF, Valor, Vencimento, Descrição (opcional), Status (opcional)</p>
              </div>
              <input ref={fileRef} type="file" accept=".csv,.txt" className="hidden" onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])} />
            </div>
          )}

          {step === "mapping" && (
            <div className="space-y-4">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <FileText className="h-4 w-4" />
                <span>{fileName} — {rows.length} linhas, {headers.length} colunas</span>
              </div>
              <p className="text-xs font-medium text-muted-foreground">Campos obrigatórios</p>
              <div className="grid gap-2">
                {EXPECTED_FIELDS.filter(f => REQUIRED_FIELDS.includes(f)).map((field) => (
                  <div key={field} className="flex items-center gap-3">
                    <span className="w-32 text-sm font-medium truncate">{FIELD_LABELS[field]} <span className="text-destructive">*</span></span>
                    <Select value={mapping[field] !== null ? String(mapping[field]) : "__none__"} onValueChange={(v) => handleMapChange(field, v)}>
                      <SelectTrigger className="flex-1 h-9"><SelectValue placeholder="Selecionar coluna..." /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none__">— Não mapear —</SelectItem>
                        {headers.map((h, i) => <SelectItem key={i} value={String(i)}>{h}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                ))}
              </div>
              <p className="text-xs font-medium text-muted-foreground">Campos opcionais</p>
              <div className="grid gap-2">
                {EXPECTED_FIELDS.filter(f => !REQUIRED_FIELDS.includes(f)).map((field) => (
                  <div key={field} className="flex items-center gap-3">
                    <span className="w-32 text-sm font-medium truncate">{FIELD_LABELS[field]}</span>
                    <Select value={mapping[field] !== null ? String(mapping[field]) : "__none__"} onValueChange={(v) => handleMapChange(field, v)}>
                      <SelectTrigger className="flex-1 h-9"><SelectValue placeholder="Selecionar coluna..." /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none__">— Não mapear —</SelectItem>
                        {headers.map((h, i) => <SelectItem key={i} value={String(i)}>{h}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                ))}
              </div>
              <p className="text-xs text-muted-foreground">
                O CPF será usado para vincular ao cliente. Valores em R$ (ex: 89,90 ou 89.90). Datas no formato DD/MM/AAAA ou AAAA-MM-DD.
              </p>
            </div>
          )}

          {step === "preview" && (
            <div className="space-y-4">
              <div className="flex flex-wrap gap-3">
                <Badge variant="default" className="gap-1"><CheckCircle className="h-3 w-3" /> {validRows.length} válidos</Badge>
                {errors.length > 0 && <Badge variant="destructive" className="gap-1"><X className="h-3 w-3" /> {errors.length} erros</Badge>}
                {warnings.length > 0 && <Badge variant="outline" className="gap-1"><AlertTriangle className="h-3 w-3" /> {warnings.length} avisos</Badge>}
              </div>
              {issues.length > 0 && (
                <ScrollArea className="max-h-32 rounded border p-2">
                  <div className="space-y-1">
                    {issues.slice(0, 50).map((issue, i) => (
                      <p key={i} className={`text-xs ${issue.type === "error" ? "text-destructive" : "text-yellow-600"}`}>
                        Linha {issue.row}: {issue.field} — {issue.message}
                      </p>
                    ))}
                    {issues.length > 50 && <p className="text-xs text-muted-foreground">... e mais {issues.length - 50} problemas</p>}
                  </div>
                </ScrollArea>
              )}
              <ScrollArea className="max-h-48 rounded border">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-muted/50">
                      <TableHead className="text-xs">Cliente</TableHead>
                      <TableHead className="text-xs">Valor</TableHead>
                      <TableHead className="text-xs">Vencimento</TableHead>
                      <TableHead className="text-xs">Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {validRows.slice(0, 20).map((r, i) => {
                      const cust = customers.find(c => c.id === r.customer_id);
                      return (
                        <TableRow key={i}>
                          <TableCell className="text-xs py-1">{cust?.nome || "—"}</TableCell>
                          <TableCell className="text-xs py-1 font-mono">{formatCentavos(r.valor_centavos)}</TableCell>
                          <TableCell className="text-xs py-1">{r.vencimento}</TableCell>
                          <TableCell className="text-xs py-1">{r.status}</TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
                {validRows.length > 20 && <p className="text-xs text-muted-foreground p-2">Mostrando 20 de {validRows.length}</p>}
              </ScrollArea>
            </div>
          )}
        </div>

        <DialogFooter className="flex-shrink-0 gap-2 pt-4 border-t">
          {step === "mapping" && (
            <>
              <Button variant="outline" onClick={() => setStep("upload")}>Voltar</Button>
              <Button onClick={processPreview}>Validar e Pré-visualizar</Button>
            </>
          )}
          {step === "preview" && (
            <>
              <Button variant="outline" onClick={() => setStep("mapping")}>Voltar</Button>
              <Button onClick={handleImport} disabled={importing || validRows.length === 0}>
                {importing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Upload className="mr-2 h-4 w-4" />}
                Importar {validRows.length} cobrança(s)
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
