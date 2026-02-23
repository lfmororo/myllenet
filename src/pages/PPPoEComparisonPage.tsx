import { useState, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Upload, AlertTriangle, UserPlus, UserMinus, CheckCircle2, Loader2, FileUp } from "lucide-react";

interface CsvUser {
  name: string;
  password: string;
  type: string;
  state: string;
  group: string;
}

interface ComparisonResult {
  inFileNotInSystem: CsvUser[];
  inSystemNotInFile: { id: string; nome: string; usuario_pppoe: string; ativo: boolean }[];
  matched: { usuario_pppoe: string; nome: string; csvState: string; csvGroup: string; ativo: boolean }[];
}

export default function PPPoEComparisonPage() {
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<ComparisonResult | null>(null);
  const [search, setSearch] = useState("");
  const [selectedForImport, setSelectedForImport] = useState<Set<string>>(new Set());

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) {
      setFile(f);
      setResult(null);
      setSelectedForImport(new Set());
    }
  };

  const parseCsv = (text: string): CsvUser[] => {
    const lines = text.trim().split("\n");
    if (lines.length < 2) return [];
    // Skip header
    return lines.slice(1).map((line) => {
      const cols = line.split(",");
      return {
        name: cols[0]?.trim() || "",
        password: cols[1]?.trim() || "",
        type: cols[2]?.trim() || "",
        state: cols[3]?.trim() || "",
        group: cols[20]?.trim() || "",
      };
    }).filter((u) => u.name.length > 0);
  };

  const compare = async () => {
    if (!file) { toast.error("Selecione um arquivo CSV"); return; }
    setLoading(true);
    try {
      const text = await file.text();
      const csvUsers = parseCsv(text);

      if (csvUsers.length === 0) {
        toast.error("Nenhum usuário encontrado no arquivo");
        return;
      }

      const { data: customers, error } = await supabase
        .from("customers")
        .select("id, nome, usuario_pppoe, ativo");

      if (error) throw error;

      const dbSet = new Map((customers || []).map((c) => [c.usuario_pppoe.toLowerCase(), c]));
      const csvSet = new Set(csvUsers.map((u) => u.name.toLowerCase()));

      const inFileNotInSystem = csvUsers.filter((u) => !dbSet.has(u.name.toLowerCase()));
      const inSystemNotInFile = (customers || []).filter((c) => !csvSet.has(c.usuario_pppoe.toLowerCase()));
      const matched = csvUsers
        .filter((u) => dbSet.has(u.name.toLowerCase()))
        .map((u) => {
          const db = dbSet.get(u.name.toLowerCase())!;
          return {
            usuario_pppoe: db.usuario_pppoe,
            nome: db.nome,
            csvState: u.state,
            csvGroup: u.group,
            ativo: db.ativo,
          };
        });

      setResult({ inFileNotInSystem, inSystemNotInFile, matched });
      setSelectedForImport(new Set(inFileNotInSystem.map((u) => u.name)));
      toast.success(`Comparação concluída: ${csvUsers.length} no arquivo, ${customers?.length || 0} no sistema`);
    } catch (err: any) {
      console.error(err);
      toast.error(err.message || "Erro ao comparar");
    } finally {
      setLoading(false);
    }
  };

  const toggleSelect = (name: string) => {
    setSelectedForImport((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  const toggleAll = () => {
    if (!result) return;
    if (selectedForImport.size === result.inFileNotInSystem.length) {
      setSelectedForImport(new Set());
    } else {
      setSelectedForImport(new Set(result.inFileNotInSystem.map((u) => u.name)));
    }
  };

  const importSelected = async () => {
    if (!result || selectedForImport.size === 0) return;
    setImporting(true);
    let imported = 0;
    let failed = 0;

    const toImport = result.inFileNotInSystem.filter((u) => selectedForImport.has(u.name));

    for (const user of toImport) {
      try {
        const { error } = await supabase.from("customers").insert({
          nome: user.name,
          usuario_pppoe: user.name,
          senha_pppoe: user.password || user.name,
          cpf: "00000000000",
          email: `${user.name}@pendente.com`,
          ativo: user.state !== "off",
        });
        if (error) throw error;
        imported++;
      } catch {
        failed++;
      }
    }

    toast.success(`Importados: ${imported}, Falhas: ${failed}`);
    if (imported > 0) {
      // Re-run comparison
      await compare();
    }
    setImporting(false);
  };

  const term = search.trim().toLowerCase();

  const filteredNotInSystem = useMemo(
    () => result?.inFileNotInSystem.filter((u) => !term || u.name.toLowerCase().includes(term)) || [],
    [result, term]
  );
  const filteredNotInFile = useMemo(
    () => result?.inSystemNotInFile.filter((c) => !term || c.usuario_pppoe.toLowerCase().includes(term) || c.nome.toLowerCase().includes(term)) || [],
    [result, term]
  );
  const filteredMatched = useMemo(
    () => result?.matched.filter((m) => !term || m.usuario_pppoe.toLowerCase().includes(term) || m.nome.toLowerCase().includes(term)) || [],
    [result, term]
  );

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">Comparação PPPoE</h2>
        <p className="text-muted-foreground">Compare usuários do roteador (CSV) com o banco de dados</p>
      </div>

      {/* Upload area */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Arquivo CSV do Roteador</CardTitle>
          <CardDescription>Exporte o arquivo de usuários do R3005G e faça upload aqui</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-end">
            <div className="flex-1">
              <label
                htmlFor="csv-upload"
                className="flex items-center gap-3 px-4 py-3 border-2 border-dashed rounded-lg cursor-pointer hover:border-primary/50 hover:bg-muted/50 transition-colors"
              >
                <FileUp className="h-5 w-5 text-muted-foreground" />
                <span className="text-sm text-muted-foreground">
                  {file ? file.name : "Selecionar arquivo CSV..."}
                </span>
                <input
                  id="csv-upload"
                  type="file"
                  accept=".csv,.txt"
                  className="hidden"
                  onChange={handleFileChange}
                />
              </label>
            </div>
            <Button onClick={compare} disabled={!file || loading}>
              {loading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Upload className="h-4 w-4 mr-2" />}
              Comparar
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* KPIs */}
      {result && (
        <div className="grid gap-4 md:grid-cols-3">
          <Card className="border-l-4 border-l-destructive">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium">No Arquivo, Sem Cadastro</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center gap-2">
                <UserPlus className="h-5 w-5 text-destructive" />
                <span className="text-2xl font-bold text-destructive">{result.inFileNotInSystem.length}</span>
              </div>
            </CardContent>
          </Card>
          <Card className="border-l-4 border-l-warning">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium">Cadastrado, Fora do Arquivo</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center gap-2">
                <UserMinus className="h-5 w-5 text-warning" />
                <span className="text-2xl font-bold text-warning">{result.inSystemNotInFile.length}</span>
              </div>
            </CardContent>
          </Card>
          <Card className="border-l-4 border-l-success">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium">Sincronizados</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center gap-2">
                <CheckCircle2 className="h-5 w-5 text-success" />
                <span className="text-2xl font-bold text-success">{result.matched.length}</span>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Tabs with tables */}
      {result && (
        <>
          <Input
            placeholder="Buscar por nome ou usuário PPPoE..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="max-w-sm"
          />

          <Tabs defaultValue="missing">
            <TabsList>
              <TabsTrigger value="missing" className="gap-1.5">
                <UserPlus className="h-3.5 w-3.5" />
                Sem Cadastro ({result.inFileNotInSystem.length})
              </TabsTrigger>
              <TabsTrigger value="extra" className="gap-1.5">
                <UserMinus className="h-3.5 w-3.5" />
                Fora do Arquivo ({result.inSystemNotInFile.length})
              </TabsTrigger>
              <TabsTrigger value="matched" className="gap-1.5">
                <CheckCircle2 className="h-3.5 w-3.5" />
                Sincronizados ({result.matched.length})
              </TabsTrigger>
            </TabsList>

            {/* Missing from system */}
            <TabsContent value="missing">
              <Card>
                <CardHeader className="flex flex-row items-center justify-between">
                  <div>
                    <CardTitle className="text-base">Usuários no Arquivo sem Cadastro</CardTitle>
                    <CardDescription>{filteredNotInSystem.length} usuários encontrados</CardDescription>
                  </div>
                  {result.inFileNotInSystem.length > 0 && (
                    <Button onClick={importSelected} disabled={importing || selectedForImport.size === 0}>
                      {importing ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <UserPlus className="h-4 w-4 mr-2" />}
                      Importar Selecionados ({selectedForImport.size})
                    </Button>
                  )}
                </CardHeader>
                <CardContent>
                  <div className="rounded-md border overflow-auto max-h-[500px]">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="w-10">
                            <input
                              type="checkbox"
                              checked={selectedForImport.size === result.inFileNotInSystem.length && result.inFileNotInSystem.length > 0}
                              onChange={toggleAll}
                              className="rounded"
                            />
                          </TableHead>
                          <TableHead>Usuário PPPoE</TableHead>
                          <TableHead>Tipo</TableHead>
                          <TableHead>Status Roteador</TableHead>
                          <TableHead>Grupo/Plano</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {filteredNotInSystem.map((u) => (
                          <TableRow key={u.name}>
                            <TableCell>
                              <input
                                type="checkbox"
                                checked={selectedForImport.has(u.name)}
                                onChange={() => toggleSelect(u.name)}
                                className="rounded"
                              />
                            </TableCell>
                            <TableCell className="font-mono text-xs font-medium">{u.name}</TableCell>
                            <TableCell><Badge variant="outline">{u.type}</Badge></TableCell>
                            <TableCell>
                              <Badge variant={u.state === "off" ? "secondary" : "default"}>
                                {u.state === "off" ? "Desconectado" : "Ativo"}
                              </Badge>
                            </TableCell>
                            <TableCell className="text-sm">{u.group}</TableCell>
                          </TableRow>
                        ))}
                        {filteredNotInSystem.length === 0 && (
                          <TableRow>
                            <TableCell colSpan={5} className="text-center text-muted-foreground py-8">
                              {term ? "Nenhum resultado para a busca" : "Todos os usuários do arquivo estão cadastrados"}
                            </TableCell>
                          </TableRow>
                        )}
                      </TableBody>
                    </Table>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

            {/* In system but not in file */}
            <TabsContent value="extra">
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Cadastrados mas Fora do Arquivo</CardTitle>
                  <CardDescription>{filteredNotInFile.length} clientes encontrados</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="rounded-md border overflow-auto max-h-[500px]">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Nome</TableHead>
                          <TableHead>Usuário PPPoE</TableHead>
                          <TableHead>Status Sistema</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {filteredNotInFile.map((c) => (
                          <TableRow key={c.id}>
                            <TableCell className="font-medium">{c.nome}</TableCell>
                            <TableCell className="font-mono text-xs">{c.usuario_pppoe}</TableCell>
                            <TableCell>
                              <Badge variant={c.ativo ? "default" : "secondary"}>
                                {c.ativo ? "Ativo" : "Inativo"}
                              </Badge>
                            </TableCell>
                          </TableRow>
                        ))}
                        {filteredNotInFile.length === 0 && (
                          <TableRow>
                            <TableCell colSpan={3} className="text-center text-muted-foreground py-8">
                              {term ? "Nenhum resultado para a busca" : "Todos os cadastrados estão no arquivo"}
                            </TableCell>
                          </TableRow>
                        )}
                      </TableBody>
                    </Table>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

            {/* Matched */}
            <TabsContent value="matched">
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Usuários Sincronizados</CardTitle>
                  <CardDescription>{filteredMatched.length} clientes encontrados em ambos</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="rounded-md border overflow-auto max-h-[500px]">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Nome</TableHead>
                          <TableHead>Usuário PPPoE</TableHead>
                          <TableHead>Status Sistema</TableHead>
                          <TableHead>Status Roteador</TableHead>
                          <TableHead>Grupo</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {filteredMatched.map((m) => (
                          <TableRow key={m.usuario_pppoe}>
                            <TableCell className="font-medium">{m.nome}</TableCell>
                            <TableCell className="font-mono text-xs">{m.usuario_pppoe}</TableCell>
                            <TableCell>
                              <Badge variant={m.ativo ? "default" : "secondary"}>
                                {m.ativo ? "Ativo" : "Inativo"}
                              </Badge>
                            </TableCell>
                            <TableCell>
                              <Badge variant={m.csvState === "off" ? "secondary" : "default"}>
                                {m.csvState === "off" ? "Desconectado" : "Ativo"}
                              </Badge>
                            </TableCell>
                            <TableCell className="text-sm">{m.csvGroup}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        </>
      )}

      {!result && !loading && (
        <Card className="py-12">
          <CardContent className="flex flex-col items-center gap-4 text-center">
            <AlertTriangle className="h-12 w-12 text-muted-foreground/40" />
            <div>
              <p className="font-medium">Nenhuma comparação realizada</p>
              <p className="text-sm text-muted-foreground">Faça upload do CSV exportado do R3005G e clique em "Comparar"</p>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
