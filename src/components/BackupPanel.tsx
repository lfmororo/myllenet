import { useEffect, useState } from "react";
import { api, authToken, API_URL } from "@/integrations/api/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Database, Download, Loader2 } from "lucide-react";
import { toast } from "sonner";

interface BackupFile { file: string; size: number; created_at: string }

const fmtSize = (b: number) => (b > 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${(b / 1024).toFixed(0)} KB`);

export default function BackupPanel() {
  const [backups, setBackups] = useState<BackupFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [downloading, setDownloading] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    const { data, error } = await api.functions.invoke("system-backup/list", { body: {} });
    if (error) toast.error("Erro ao carregar backups: " + error.message);
    setBackups(data?.backups ?? []);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const download = async (file: string) => {
    setDownloading(file);
    try {
      const res = await fetch(`${API_URL}/api/functions/system-backup/download`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${authToken()}` },
        body: JSON.stringify({ file }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement("a");
      a.href = url;
      a.download = file;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e: any) {
      toast.error("Erro ao baixar: " + e.message);
    } finally {
      setDownloading(null);
    }
  };

  const runNow = async () => {
    setRunning(true);
    const { data, error } = await api.functions.invoke("system-backup/run", { body: {} });
    setRunning(false);
    if (error) return toast.error("Erro ao gerar backup: " + error.message);
    toast.success(`Backup gerado: ${data.tables} tabelas, ${data.rows} registros`);
    await load();
    download(data.file);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><Database className="h-5 w-5" /> Backup geral do sistema</CardTitle>
        <CardDescription>
          Cópia de todas as tabelas em um arquivo ZIP (um CSV por tabela). Um backup automático é gerado todo dia às 03:00 e guardado por 30 dias.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <Button onClick={runNow} disabled={running}>
          {running ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Download className="mr-2 h-4 w-4" />}
          {running ? "Gerando backup..." : "Gerar e baixar backup agora"}
        </Button>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Data</TableHead>
              <TableHead>Origem</TableHead>
              <TableHead>Tamanho</TableHead>
              <TableHead className="text-right">Ação</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground">Carregando...</TableCell></TableRow>
            ) : backups.length === 0 ? (
              <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground">Nenhum backup ainda</TableCell></TableRow>
            ) : backups.map((b) => (
              <TableRow key={b.file}>
                <TableCell>{new Date(b.created_at).toLocaleString("pt-BR")}</TableCell>
                <TableCell>
                  <Badge variant={b.file.includes("automatico") ? "secondary" : "outline"}>
                    {b.file.includes("automatico") ? "Automático" : "Manual"}
                  </Badge>
                </TableCell>
                <TableCell>{fmtSize(b.size)}</TableCell>
                <TableCell className="text-right">
                  <Button size="sm" variant="outline" onClick={() => download(b.file)} disabled={downloading === b.file}>
                    {downloading === b.file ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
