import { useState, useCallback, useRef } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Upload, FileText, AlertTriangle, CheckCircle, Loader2, X, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import type { Plan } from "@/hooks/usePlans";
import type { CustomerInput } from "@/hooks/useCustomers";
import { api } from "@/integrations/api/client";
import { reconcileInvoicesFromCSV } from "@/utils/csvReconciliation";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  customers: { id: string; nome: string; cpf: string }[];
  onImport: (invoices: InvoiceRow[]) => Promise<{ success: number; failed: number; updated?: number }>;
  plans: Plan[];
  onUpdateCustomer: (id: string, data: Partial<CustomerInput>) => Promise<boolean>;
  onAddCustomer: (customer: CustomerInput) => Promise<boolean>;
  onRefetchCustomers: () => Promise<void>;
}

export interface InvoiceRow {
  customer_id: string;
  descricao: string;
  valor_centavos: number;
  vencimento: string;
  status: string;
  paid_at?: string | null;
  efi_link?: string | null;
  _cpf?: string;
  _nome?: string;
  _email?: string;
  _complemento?: string;
}

type Step = "upload" | "mapping" | "preview";

const EXPECTED_FIELDS = ["cpf", "nome", "email", "complemento", "descricao", "valor", "vencimento", "status", "link_boleto"] as const;
type FieldKey = typeof EXPECTED_FIELDS[number];

const FIELD_LABELS: Record<FieldKey, string> = {
  cpf: "CPF do Cliente",
  nome: "Nome do Cliente",
  email: "E-mail do Cliente",
  complemento: "Complemento (PPPoE)",
  descricao: "Descrição",
  valor: "Valor (R$)",
  vencimento: "Vencimento",
  status: "Status",
  link_boleto: "Link do Boleto",
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
  nome: "nome", name: "nome", nome_completo: "nome", cliente: "nome",
  email: "email", e_mail: "email",
  complemento: "complemento",
  descricao: "descricao", description: "descricao", titulo: "descricao",
  valor: "valor", value: "valor", amount: "valor", valor_centavos: "valor", total: "valor",
  vencimento: "vencimento", due_date: "vencimento", data_vencimento: "vencimento", expiration: "vencimento",
  status: "status", situacao: "status",
  link_boleto: "link_boleto", link: "link_boleto", boleto_link: "link_boleto", link_do_boleto: "link_boleto", url_boleto: "link_boleto", boleto_url: "link_boleto", boleto: "link_boleto",
};

function autoMapColumns(headers: string[]): Record<FieldKey, number | null> {
  const mapping: Record<FieldKey, number | null> = { cpf: null, nome: null, email: null, complemento: null, descricao: null, valor: null, vencimento: null, status: null, link_boleto: null };
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
  let cleaned = raw.replace(/[R$\s]/g, "");
  const lastComma = cleaned.lastIndexOf(",");
  const lastDot = cleaned.lastIndexOf(".");
  if (lastComma > lastDot) {
    cleaned = cleaned.replace(/\./g, "").replace(",", ".");
  } else if (lastDot > lastComma) {
    cleaned = cleaned.replace(/,/g, "");
  }
  const num = parseFloat(cleaned);
  if (isNaN(num)) return null;
  return Math.round(num * 100);
}

function parseDate(raw: string): string | null {
  if (!raw) return null;
  const brMatch = raw.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
  if (brMatch) {
    const [, d, m, y] = brMatch;
    return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }
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

export default function InvoiceCSVImportDialog({ open, onOpenChange, customers, onImport, plans, onUpdateCustomer, onAddCustomer, onRefetchCustomers }: Props) {
  const [step, setStep] = useState<Step>("upload");
  const [headers, setHeaders] = useState<string[]>([]);
  const [rows, setRows] = useState<string[][]>([]);
  const [mapping, setMapping] = useState<Record<FieldKey, number | null>>({ cpf: null, nome: null, email: null, complemento: null, descricao: null, valor: null, vencimento: null, status: null, link_boleto: null });
  const [issues, setIssues] = useState<ValidationIssue[]>([]);
  const [validRows, setValidRows] = useState<InvoiceRow[]>([]);
  const [importing, setImporting] = useState(false);
  const [fileName, setFileName] = useState("");
  const [rawText, setRawText] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  const reset = () => {
    setStep("upload"); setHeaders([]); setRows([]);
    setMapping({ cpf: null, nome: null, email: null, complemento: null, descricao: null, valor: null, vencimento: null, status: null, link_boleto: null });
    setIssues([]); setValidRows([]); setImporting(false); setFileName(""); setRawText("");
  };

  const handleClose = (val: boolean) => { if (!val) reset(); onOpenChange(val); };

  const handleFile = useCallback((file: File) => {
    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target?.result as string;
      if (!text) { toast.error("Arquivo vazio"); return; }
      setRawText(text);
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

  const handleReconcile = async () => {
    if (!rawText) return;
    setImporting(true);
    try {
      const { updated, errors } = await reconcileInvoicesFromCSV(rawText);
      if (updated > 0) {
        toast.success(`${updated} fatura(s) baixada(s) com sucesso!`);
        await onRefetchCustomers();
        handleClose(false);
      } else if (errors > 0) {
        toast.warning(`Nenhuma fatura pendente encontrada para baixar, mas ocorreram ${errors} erros de processamento.`);
      } else {
        toast.info("Nenhuma fatura pendente correspondente encontrada no relatório.");
      }
    } catch (err) {
      console.error(err);
      toast.error("Erro ao processar baixa via relatório.");
    } finally {
      setImporting(false);
    }
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
      if (!customer) {
        if (!cpf || (cpf.length !== 11 && cpf.length !== 14)) {
          newIssues.push({ row: rowNum, field: "CPF", message: cpf ? "Formato inválido" : "Vazio", type: "error" });
          rowValid = false;
        } else {
          const nome = getValue("nome");
          const email = getValue("email");
          if (!nome && !email) {
            newIssues.push({ row: rowNum, field: "CPF", message: "Cliente não encontrado — mapear Nome e E-mail para cadastrar", type: "error" });
            rowValid = false;
          } else {
            newIssues.push({ row: rowNum, field: "CPF", message: "Cliente será cadastrado automaticamente", type: "warning" });
          }
        }
      }

      const valorRaw = getValue("valor");
      const valorCentavos = parseValor(valorRaw);
      if (valorCentavos === null || valorCentavos <= 0) { newIssues.push({ row: rowNum, field: "Valor", message: valorRaw ? "Formato inválido" : "Vazio", type: "error" }); rowValid = false; }

      const vencRaw = getValue("vencimento");
      const vencimento = parseDate(vencRaw);
      if (!vencimento) { newIssues.push({ row: rowNum, field: "Vencimento", message: vencRaw ? "Formato inválido (use DD/MM/AAAA)" : "Vazio", type: "error" }); rowValid = false; }

      const descricao = getValue("descricao") || "Cobrança importada via CSV";
      const statusRaw = getValue("status");
      const status = statusRaw ? mapStatus(statusRaw) : "pending";
      const paid_at = status === "paid" ? vencimento + "T12:00:00Z" : null;
      const linkBoleto = getValue("link_boleto") || null;

      if (rowValid && valorCentavos && vencimento) {
        valid.push({
          customer_id: customer?.id || "__pending__",
          descricao, valor_centavos: valorCentavos, vencimento, status, paid_at,
          efi_link: linkBoleto,
          _cpf: cpf,
          _nome: getValue("nome"),
          _email: getValue("email"),
          _complemento: getValue("complemento"),
        });
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
      const pendingRows = validRows.filter(r => r.customer_id === "__pending__");
      if (pendingRows.length > 0) {
        const cpfsSeen = new Set<string>();
        let created = 0;
        for (const row of pendingRows) {
          const cpf = row._cpf || "";
          if (cpfsSeen.has(cpf)) continue;
          cpfsSeen.add(cpf);
          const complementoPPPoE = row._complemento ? row._complemento.toLowerCase().replace(/\s+/g, "") : "";
          const customerData: CustomerInput = {
            nome: row._nome || `Cliente ${cpf}`,
            cpf, email: row._email || `${cpf}@importado.com`, telefone: null,
            usuario_pppoe: complementoPPPoE || cpf, senha_pppoe: complementoPPPoE || "myllenet123",
            rua: null, numero: null, complemento: row._complemento || null,
            bairro: null, cidade: null, estado: null, cep: null, dia_vencimento: 10, plan_id: null, desconto_especial_centavos: 0,
          };
          const ok = await onAddCustomer(customerData);
          if (ok) created++;
        }
        if (created > 0) {
          toast.success(`${created} cliente(s) cadastrado(s) automaticamente`);
          await onRefetchCustomers();
        }
      }

      const { data: freshCustomers } = await api.from("customers").select("id, cpf");
      const typedFreshCustomers = (freshCustomers || []) as { id: string; cpf: string }[];
      const freshCpfMap = new Map<string, string>(
        typedFreshCustomers.map((customer) => [cleanCPF(customer.cpf), customer.id]),
      );
      const resolvedRows = validRows.map(row => {
        if (row.customer_id === "__pending__" && row._cpf) {
          return { ...row, customer_id: freshCpfMap.get(row._cpf) || "__pending__" };
        }
        return row;
      });

      const dbRows = resolvedRows
        .filter(r => r.customer_id !== "__pending__")
        .map(({ _cpf, _nome, _email, _complemento, ...rest }) => rest);

      const result = await onImport(dbRows);
      toast.success(`${result.success} cobrança(s) importada(s)!`);
      if (result.updated && result.updated > 0) toast.success(`${result.updated} cobrança(s) atualizada(s) para "pago"`);
      
      if (plans.length > 0) {
        const byCustomer = new Map<string, InvoiceRow[]>();
        for (const row of resolvedRows) {
          if (row.customer_id === "__pending__") continue;
          const arr = byCustomer.get(row.customer_id) || [];
          arr.push(row);
          byCustomer.set(row.customer_id, arr);
        }
        let updatedCount = 0;
        for (const [customerId, invoices] of byCustomer) {
          const sorted = invoices.sort((a, b) => b.vencimento.localeCompare(a.vencimento));
          const latest = sorted[0];
          const vencDate = new Date(latest.vencimento + "T12:00:00");
          const diaVencimento = vencDate.getDate();
          const matchedPlan = plans.find(p => p.ativo && p.valor_centavos === latest.valor_centavos);
          const updateData: Partial<CustomerInput> = { dia_vencimento: diaVencimento };
          if (matchedPlan) updateData.plan_id = matchedPlan.id;
          const ok = await onUpdateCustomer(customerId, updateData);
          if (ok) updatedCount++;
        }
        if (updatedCount > 0) toast.success(`${updatedCount} cliente(s) atualizado(s) com vencimento e plano`);
      }
      handleClose(false);
    } catch { toast.error("Erro durante a importação"); }
    setImporting(false);
  };

  const errors = issues.filter((i) => i.type === "error");
  const warnings = issues.filter((i) => i.type === "warning");
  const formatCentavos = (v: number) => (v / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-2xl max-h-[85vh] flex flex-col overflow-hidden">
        <DialogHeader className="flex-shrink-0">
          <DialogTitle>Importar ou Baixar Cobranças via CSV</DialogTitle>
          <DialogDescription>
            {step === "upload" && "Selecione um relatório da EFI para baixar faturas ou um CSV para importar novas."}
            {step === "mapping" && "Mapeie as colunas para importar novas faturas ou clique em 'Dar Baixa' se for um relatório EFI."}
            {step === "preview" && "Revise os dados antes de importar novas faturas."}
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
                <p className="text-sm text-muted-foreground">Relatório da EFI (Semicolon ;) ou CSV genérico.</p>
              </div>
              <input ref={fileRef} type="file" accept=".csv,.txt" className="hidden" onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])} />
            </div>
          )}

          {step === "mapping" && (
            <div className="space-y-4">
              <div className="bg-muted/50 p-4 rounded-lg flex items-center justify-between gap-4">
                <div className="flex items-center gap-2 text-sm">
                  <FileText className="h-4 w-4" />
                  <span>{fileName}</span>
                </div>
                <Button variant="default" className="bg-green-600 hover:bg-green-700" onClick={handleReconcile} disabled={importing}>
                  {importing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
                  Dar Baixa nas Faturas
                </Button>
              </div>
              <div className="separator flex items-center gap-2 my-4">
                <div className="h-px bg-border flex-1"></div>
                <span className="text-[10px] uppercase font-bold text-muted-foreground">Ou importar como novas</span>
                <div className="h-px bg-border flex-1"></div>
              </div>
              <div className="grid gap-2">
                {EXPECTED_FIELDS.filter(f => REQUIRED_FIELDS.includes(f)).map((field) => (
                  <div key={field} className="flex items-center gap-3">
                    <span className="w-32 text-sm font-medium truncate">{FIELD_LABELS[field]} *</span>
                    <Select value={mapping[field] !== null ? String(mapping[field]) : "__none__"} onValueChange={(v) => handleMapChange(field, v)}>
                      <SelectTrigger className="flex-1 h-9"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none__">— —</SelectItem>
                        {headers.map((h, i) => <SelectItem key={i} value={String(i)}>{h}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                ))}
                {EXPECTED_FIELDS.filter(f => !REQUIRED_FIELDS.includes(f)).map((field) => (
                  <div key={field} className="flex items-center gap-3">
                    <span className="w-32 text-sm font-medium truncate">{FIELD_LABELS[field]}</span>
                    <Select value={mapping[field] !== null ? String(mapping[field]) : "__none__"} onValueChange={(v) => handleMapChange(field, v)}>
                      <SelectTrigger className="flex-1 h-9"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none__">— —</SelectItem>
                        {headers.map((h, i) => <SelectItem key={i} value={String(i)}>{h}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                ))}
              </div>
            </div>
          )}

          {step === "preview" && (
            <div className="space-y-4">
              <div className="flex gap-2">
                <Badge variant="default">{validRows.length} válidos</Badge>
                {errors.length > 0 && <Badge variant="destructive">{errors.length} erros</Badge>}
              </div>
              <ScrollArea className="h-48 rounded border">
                <Table>
                  <TableHeader><TableRow><TableHead>Cliente</TableHead><TableHead>Valor</TableHead><TableHead>Vencimento</TableHead></TableRow></TableHeader>
                  <TableBody>
                    {validRows.slice(0, 10).map((r, i) => (
                      <TableRow key={i}><TableCell>{customers.find(c => c.id === r.customer_id)?.nome || "Novo"}</TableCell><TableCell>{formatCentavos(r.valor_centavos)}</TableCell><TableCell>{r.vencimento}</TableCell></TableRow>
                    ))}
                  </TableBody>
                </Table>
              </ScrollArea>
            </div>
          )}
        </div>

        <DialogFooter className="flex-shrink-0 gap-2 pt-4 border-t">
          {step === "mapping" && (
            <>
              <Button variant="outline" onClick={() => setStep("upload")}>Voltar</Button>
              <Button onClick={processPreview}>Pré-visualizar Importação</Button>
            </>
          )}
          {step === "preview" && (
            <>
              <Button variant="outline" onClick={() => setStep("mapping")}>Voltar</Button>
              <Button onClick={handleImport} disabled={importing || validRows.length === 0}>
                {importing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Upload className="mr-2 h-4 w-4" />}
                Importar {validRows.length} novas faturas
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}