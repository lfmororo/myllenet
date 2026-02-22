import { useState, useCallback, useRef } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Upload, FileText, AlertTriangle, CheckCircle, Loader2, X } from "lucide-react";
import { toast } from "sonner";
import type { CustomerInput } from "@/hooks/useCustomers";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onImport: (customers: CustomerInput[]) => Promise<{ success: number; failed: number }>;
  existingCpfs: string[];
}

type Step = "upload" | "mapping" | "preview";

const EXPECTED_FIELDS = ["nome", "cpf", "email", "telefone", "usuario_pppoe", "senha_pppoe", "rua", "numero", "complemento", "bairro", "cidade", "estado", "cep"] as const;
type FieldKey = typeof EXPECTED_FIELDS[number];

const FIELD_LABELS: Record<FieldKey, string> = {
  nome: "Nome",
  cpf: "CPF",
  email: "E-mail",
  telefone: "Telefone",
  usuario_pppoe: "Usuário PPPoE",
  senha_pppoe: "Senha PPPoE",
  rua: "Rua",
  numero: "Número",
  complemento: "Complemento",
  bairro: "Bairro",
  cidade: "Cidade",
  estado: "Estado",
  cep: "CEP",
};

const REQUIRED_FIELDS: FieldKey[] = ["nome", "cpf", "email"];

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
  nome: "nome",
  name: "nome",
  nome_completo: "nome",
  cliente: "nome",
  cpf: "cpf",
  cpf_cnpj: "cpf",
  documento: "cpf",
  email: "email",
  e_mail: "email",
  telefone: "telefone",
  phone: "telefone",
  celular: "telefone",
  fone: "telefone",
  usuario_pppoe: "usuario_pppoe",
  usuario: "usuario_pppoe",
  user_pppoe: "usuario_pppoe",
  login: "usuario_pppoe",
  login_pppoe: "usuario_pppoe",
  senha_pppoe: "senha_pppoe",
  senha: "senha_pppoe",
  password: "senha_pppoe",
  password_pppoe: "senha_pppoe",
  rua: "rua",
  logradouro: "rua",
  endereco: "rua",
  numero: "numero",
  num: "numero",
  complemento: "complemento",
  bairro: "bairro",
  cidade: "cidade",
  municipio: "cidade",
  estado: "estado",
  uf: "estado",
  cep: "cep",
};

function autoMapColumns(headers: string[]): Record<FieldKey, number | null> {
  const mapping: Record<FieldKey, number | null> = {
    nome: null, cpf: null, email: null, telefone: null, usuario_pppoe: null, senha_pppoe: null,
    rua: null, numero: null, complemento: null, bairro: null, cidade: null, estado: null, cep: null,
  };

  headers.forEach((h, idx) => {
    const normalized = normalizeHeader(h);
    const field = HEADER_ALIASES[normalized];
    if (field && mapping[field] === null) {
      mapping[field] = idx;
    }
  });

  return mapping;
}

function cleanCPF(cpf: string): string {
  return cpf.replace(/\D/g, "");
}

export default function CSVImportDialog({ open, onOpenChange, onImport, existingCpfs }: Props) {
  const [step, setStep] = useState<Step>("upload");
  const [headers, setHeaders] = useState<string[]>([]);
  const [rows, setRows] = useState<string[][]>([]);
  const [mapping, setMapping] = useState<Record<FieldKey, number | null>>({
    nome: null, cpf: null, email: null, telefone: null, usuario_pppoe: null, senha_pppoe: null,
    rua: null, numero: null, complemento: null, bairro: null, cidade: null, estado: null, cep: null,
  });
  const [issues, setIssues] = useState<ValidationIssue[]>([]);
  const [validRows, setValidRows] = useState<CustomerInput[]>([]);
  const [importing, setImporting] = useState(false);
  const [fileName, setFileName] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  const reset = () => {
    setStep("upload");
    setHeaders([]);
    setRows([]);
    setMapping({ nome: null, cpf: null, email: null, telefone: null, usuario_pppoe: null, senha_pppoe: null,
      rua: null, numero: null, complemento: null, bairro: null, cidade: null, estado: null, cep: null });
    setIssues([]);
    setValidRows([]);
    setImporting(false);
    setFileName("");
  };

  const handleClose = (val: boolean) => {
    if (!val) reset();
    onOpenChange(val);
  };

  const handleFile = useCallback((file: File) => {
    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target?.result as string;
      if (!text) { toast.error("Arquivo vazio"); return; }

      const lines = text.split(/\r?\n/).filter((l) => l.trim());
      if (lines.length < 2) { toast.error("Arquivo precisa ter cabeçalho e pelo menos 1 linha de dados"); return; }

      const sep = detectSeparator(lines[0]);
      const parsedHeaders = parseCSVLine(lines[0], sep);
      const parsedRows = lines.slice(1).map((l) => parseCSVLine(l, sep));

      setHeaders(parsedHeaders);
      setRows(parsedRows);
      setMapping(autoMapColumns(parsedHeaders));
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

  const processPreview = () => {
    const newIssues: ValidationIssue[] = [];
    const valid: CustomerInput[] = [];
    const existingSet = new Set(existingCpfs.map(cleanCPF));
    const seenCpfs = new Set<string>();

    // Check required mapping
    for (const f of REQUIRED_FIELDS) {
      if (mapping[f] === null) {
        toast.error(`Mapeie a coluna obrigatória: ${FIELD_LABELS[f]}`);
        return;
      }
    }

    rows.forEach((row, idx) => {
      const rowNum = idx + 2;
      let rowValid = true;

      const getValue = (field: FieldKey): string => {
        const colIdx = mapping[field];
        if (colIdx === null || colIdx >= row.length) return "";
        return row[colIdx].trim();
      };

      const nome = getValue("nome");
      const cpfRaw = getValue("cpf");
      const email = getValue("email");
      const telefone = getValue("telefone") || null;
      const cpf = cleanCPF(cpfRaw);

      if (!nome) { newIssues.push({ row: rowNum, field: "Nome", message: "Vazio", type: "error" }); rowValid = false; }
      if (!cpf || (cpf.length !== 11 && cpf.length !== 14)) {
        newIssues.push({ row: rowNum, field: "CPF", message: cpf ? "Formato inválido" : "Vazio", type: "error" });
        rowValid = false;
      }
      if (!email || !email.includes("@")) {
        newIssues.push({ row: rowNum, field: "E-mail", message: email ? "Formato inválido" : "Vazio", type: "error" });
        rowValid = false;
      }

      if (cpf && existingSet.has(cpf)) {
        newIssues.push({ row: rowNum, field: "CPF", message: "Já cadastrado — será atualizado", type: "warning" });
      }
      if (cpf && seenCpfs.has(cpf)) {
        newIssues.push({ row: rowNum, field: "CPF", message: "Duplicado no arquivo", type: "warning" });
        rowValid = false;
      }

      if (cpf) seenCpfs.add(cpf);

      // Generate PPPoE from complemento if available (e.g. "406 Norte" -> "406norte")
      const complementoVal = getValue("complemento");
      const complementoPPPoE = complementoVal ? complementoVal.toLowerCase().replace(/\s+/g, "") : "";
      let usuario_pppoe = getValue("usuario_pppoe") || complementoPPPoE || cpf;
      let senha_pppoe = getValue("senha_pppoe") || complementoPPPoE || "myllenet123";

      if (rowValid) {
        valid.push({
          nome, cpf, email, telefone, usuario_pppoe, senha_pppoe,
          rua: getValue("rua") || null,
          numero: getValue("numero") || null,
          complemento: getValue("complemento") || null,
          bairro: getValue("bairro") || null,
          cidade: getValue("cidade") || null,
          estado: getValue("estado") || null,
          cep: getValue("cep") || null,
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
      const result = await onImport(validRows);
      toast.success(`${result.success} cliente(s) importado(s)!`);
      if (result.failed > 0) toast.error(`${result.failed} falha(s) na importação`);
      handleClose(false);
    } catch {
      toast.error("Erro durante a importação");
    }
    setImporting(false);
  };

  const errors = issues.filter((i) => i.type === "error");
  const warnings = issues.filter((i) => i.type === "warning");

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-2xl max-h-[85vh] flex flex-col overflow-hidden">
        <DialogHeader className="flex-shrink-0">
          <DialogTitle>Importar Clientes via CSV</DialogTitle>
          <DialogDescription>
            {step === "upload" && "Selecione ou arraste um arquivo CSV"}
            {step === "mapping" && "Mapeie as colunas do arquivo para os campos do sistema"}
            {step === "preview" && "Revise os dados antes de importar"}
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 min-h-0 overflow-y-auto">
          {/* Upload step */}
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
                <p className="text-sm text-muted-foreground">Suporta CSV com separador vírgula, ponto-e-vírgula ou tab</p>
              </div>
              <input
                ref={fileRef}
                type="file"
                accept=".csv,.txt"
                className="hidden"
                onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
              />
            </div>
          )}

          {/* Mapping step */}
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
                    <span className="w-28 text-sm font-medium truncate">
                      {FIELD_LABELS[field]} <span className="text-destructive">*</span>
                    </span>
                    <Select
                      value={mapping[field] !== null ? String(mapping[field]) : "__none__"}
                      onValueChange={(v) => handleMapChange(field, v)}
                    >
                      <SelectTrigger className="flex-1 h-9">
                        <SelectValue placeholder="Selecionar coluna..." />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none__">— Não mapear —</SelectItem>
                        {headers.map((h, i) => (
                          <SelectItem key={i} value={String(i)}>{h}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                ))}
              </div>

              <p className="text-xs font-medium text-muted-foreground">Campos opcionais</p>
              <div className="grid gap-2">
                {EXPECTED_FIELDS.filter(f => !REQUIRED_FIELDS.includes(f)).map((field) => (
                  <div key={field} className="flex items-center gap-3">
                    <span className="w-28 text-sm font-medium truncate">
                      {FIELD_LABELS[field]}
                    </span>
                    <Select
                      value={mapping[field] !== null ? String(mapping[field]) : "__none__"}
                      onValueChange={(v) => handleMapChange(field, v)}
                    >
                      <SelectTrigger className="flex-1 h-9">
                        <SelectValue placeholder="Selecionar coluna..." />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none__">— Não mapear —</SelectItem>
                        {headers.map((h, i) => (
                          <SelectItem key={i} value={String(i)}>{h}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                ))}
              </div>

              <p className="text-xs text-muted-foreground">
                Campos sem mapeamento: Usuário PPPoE será baseado no complemento ou CPF, Senha PPPoE será baseada no complemento ou "myllenet123"
              </p>
            </div>
          )}

          {/* Preview step */}
          {step === "preview" && (
            <div className="space-y-4">
              <div className="flex flex-wrap gap-3">
                <Badge variant="default" className="gap-1">
                  <CheckCircle className="h-3 w-3" /> {validRows.length} válidos
                </Badge>
                {errors.length > 0 && (
                  <Badge variant="destructive" className="gap-1">
                    <X className="h-3 w-3" /> {errors.length} erros
                  </Badge>
                )}
                {warnings.length > 0 && (
                  <Badge variant="outline" className="gap-1">
                    <AlertTriangle className="h-3 w-3" /> {warnings.length} avisos
                  </Badge>
                )}
              </div>

              {issues.length > 0 && (
                <ScrollArea className="max-h-32 rounded border p-2">
                  <div className="space-y-1">
                    {issues.slice(0, 50).map((issue, i) => (
                      <p key={i} className={`text-xs ${issue.type === "error" ? "text-destructive" : "text-yellow-600"}`}>
                        Linha {issue.row}: {issue.field} — {issue.message}
                      </p>
                    ))}
                    {issues.length > 50 && (
                      <p className="text-xs text-muted-foreground">... e mais {issues.length - 50} problemas</p>
                    )}
                  </div>
                </ScrollArea>
              )}

              <ScrollArea className="max-h-48 rounded border">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-muted/50">
                      <TableHead className="text-xs">Nome</TableHead>
                      <TableHead className="text-xs">CPF</TableHead>
                      <TableHead className="text-xs">E-mail</TableHead>
                      <TableHead className="text-xs">PPPoE</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {validRows.slice(0, 20).map((r, i) => (
                      <TableRow key={i}>
                        <TableCell className="text-xs py-1">{r.nome}</TableCell>
                        <TableCell className="text-xs py-1 font-mono">{r.cpf}</TableCell>
                        <TableCell className="text-xs py-1">{r.email}</TableCell>
                        <TableCell className="text-xs py-1 font-mono">{r.usuario_pppoe}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                {validRows.length > 20 && (
                  <p className="text-xs text-muted-foreground p-2">Mostrando 20 de {validRows.length}</p>
                )}
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
                Importar {validRows.length} cliente(s)
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
