import { useState, useEffect } from "react";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { Navigate, useNavigate } from "react-router-dom";
import { usePlans } from "@/hooks/usePlans";
import type { Plan } from "@/hooks/usePlans";
import PlanFormDialog from "@/components/PlanFormDialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { ArrowLeft, Loader2, Save, Upload, CheckCircle, XCircle, ShieldAlert, Zap, Plus, Pencil, Trash2, Package, MessageCircle } from "lucide-react";
import { toast } from "sonner";

export default function Settings() {
  const { user, isAdmin, loading: authLoading } = useAuth();
  const navigate = useNavigate();

  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [certFile, setCertFile] = useState<File | null>(null);
  const [certUploaded, setCertUploaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loadingSettings, setLoadingSettings] = useState(true);
  const [testing, setTesting] = useState(false);

  // WhatsApp settings
  const [uazapiToken, setUazapiToken] = useState("");
  const [savingWhatsapp, setSavingWhatsapp] = useState(false);

  // Plans state
  const { plans, loading: plansLoading, addPlan, updatePlan, deletePlan } = usePlans();
  const [planFormOpen, setPlanFormOpen] = useState(false);
  const [editingPlan, setEditingPlan] = useState<Plan | null>(null);
  const [deletingPlan, setDeletingPlan] = useState<Plan | null>(null);
  useEffect(() => {
    if (user && isAdmin) loadSettings();
  }, [user, isAdmin]);

  const loadSettings = async () => {
    setLoadingSettings(true);
    const { data } = await supabase
      .from("settings")
      .select("key, value")
      .in("key", ["efi_client_id", "efi_client_secret", "efi_certificate_path", "uazapi_token"]);

    if (data) {
      for (const row of data) {
        if (row.key === "efi_client_id") setClientId(row.value || "");
        if (row.key === "efi_client_secret") setClientSecret(row.value || "");
        if (row.key === "efi_certificate_path") setCertUploaded(!!row.value);
        if (row.key === "uazapi_token") setUazapiToken(row.value || "");
      }
    }
    setLoadingSettings(false);
  };

  const upsertSetting = async (key: string, value: string) => {
    const { data: existing } = await supabase
      .from("settings")
      .select("id")
      .eq("key", key)
      .maybeSingle();

    if (existing) {
      await supabase.from("settings").update({ value }).eq("key", key);
    } else {
      await supabase.from("settings").insert({ key, value });
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await upsertSetting("efi_client_id", clientId);
      await upsertSetting("efi_client_secret", clientSecret);

      if (certFile) {
        const filePath = `efi/certificate.p12`;
        const { error: uploadError } = await supabase.storage
          .from("certificates")
          .upload(filePath, certFile, { upsert: true });

        if (uploadError) {
          toast.error("Erro ao enviar certificado: " + uploadError.message);
          setSaving(false);
          return;
        }
        await upsertSetting("efi_certificate_path", filePath);
        setCertUploaded(true);
      }

      toast.success("Configurações salvas com sucesso!");
    } catch (err: any) {
      toast.error("Erro ao salvar: " + (err.message || "Erro desconhecido"));
    }
    setSaving(false);
  };

  const handleTestConnection = async () => {
    setTesting(true);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      const projectId = import.meta.env.VITE_SUPABASE_PROJECT_ID;
      const res = await fetch(
        `https://${projectId}.supabase.co/functions/v1/efi-boleto/test`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
        }
      );
      const result = await res.json();
      if (result.success) {
        toast.success(result.message);
      } else {
        toast.error("Falha: " + (result.error || "Erro desconhecido"));
      }
    } catch (err: any) {
      toast.error("Erro ao testar: " + (err.message || "Erro desconhecido"));
    }
    setTesting(false);
  };

  if (authLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!user) return <Navigate to="/auth" replace />;

  if (!isAdmin) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-4">
        <div className="text-center space-y-4 max-w-md">
          <ShieldAlert className="mx-auto h-16 w-16 text-destructive" />
          <h1 className="text-2xl font-bold">Acesso Restrito</h1>
          <p className="text-muted-foreground">Sem permissão de administrador.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b bg-card sticky top-0 z-10">
        <div className="container mx-auto flex items-center gap-3 px-4 py-3">
          <Button variant="ghost" size="icon" onClick={() => navigate("/dashboard")}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div>
            <h1 className="text-lg font-bold leading-tight">Configurações</h1>
            <p className="text-xs text-muted-foreground">Gerencie as integrações do sistema</p>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-6 max-w-2xl">
        <Tabs defaultValue="plans">
          <TabsList>
            <TabsTrigger value="plans">
              <Package className="mr-1.5 h-4 w-4" /> Planos
            </TabsTrigger>
            <TabsTrigger value="efi">API EFI</TabsTrigger>
            <TabsTrigger value="whatsapp">
              <MessageCircle className="mr-1.5 h-4 w-4" /> WhatsApp
            </TabsTrigger>
          </TabsList>

          {/* Plans Tab */}
          <TabsContent value="plans" className="mt-4 space-y-4">
            <div className="flex items-center justify-between">
              <p className="text-sm text-muted-foreground">{plans.length} plano{plans.length !== 1 ? "s" : ""} cadastrado{plans.length !== 1 ? "s" : ""}</p>
              <Button onClick={() => { setEditingPlan(null); setPlanFormOpen(true); }}>
                <Plus className="mr-2 h-4 w-4" /> Novo Plano
              </Button>
            </div>
            {plansLoading ? (
              <div className="flex justify-center py-8">
                <Loader2 className="h-6 w-6 animate-spin text-primary" />
              </div>
            ) : plans.length === 0 ? (
              <Card>
                <CardContent className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                  <Package className="h-10 w-10 mb-3" />
                  <p className="font-medium">Nenhum plano cadastrado</p>
                  <p className="text-sm">Crie um plano para usar nas cobranças.</p>
                </CardContent>
              </Card>
            ) : (
              <div className="rounded-lg border bg-card">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-muted/50">
                      <TableHead className="font-semibold">Plano</TableHead>
                      <TableHead className="font-semibold">Valor</TableHead>
                      <TableHead className="font-semibold hidden md:table-cell">Intervalo</TableHead>
                      <TableHead className="font-semibold hidden lg:table-cell">Desconto</TableHead>
                      <TableHead className="font-semibold hidden lg:table-cell">Juros/Multa</TableHead>
                      <TableHead className="font-semibold text-center">Status</TableHead>
                      <TableHead className="font-semibold text-right">Ações</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {plans.map((p) => (
                      <TableRow key={p.id} className={!p.ativo ? "opacity-50" : ""}>
                        <TableCell>
                          <div>
                            <span className="font-medium">{p.nome}</span>
                            {p.descricao && <p className="text-xs text-muted-foreground">{p.descricao}</p>}
                          </div>
                        </TableCell>
                        <TableCell className="font-mono text-sm">
                          R$ {(p.valor_centavos / 100).toFixed(2).replace(".", ",")}
                        </TableCell>
                        <TableCell className="hidden md:table-cell text-sm">
                          {p.intervalo_meses === 1 ? "Mensal" : `${p.intervalo_meses} meses`}
                        </TableCell>
                        <TableCell className="hidden lg:table-cell text-sm">
                          {p.desconto_centavos > 0
                            ? `R$ ${(p.desconto_centavos / 100).toFixed(2).replace(".", ",")} (${p.dias_desconto}d antes)`
                            : "—"}
                        </TableCell>
                        <TableCell className="hidden lg:table-cell text-sm">
                          {p.juros_mensal > 0 || p.multa_centavos > 0
                            ? `${p.juros_mensal}%/mês${p.multa_centavos > 0 ? ` + R$ ${(p.multa_centavos / 100).toFixed(2).replace(".", ",")}` : ""}`
                            : "—"}
                        </TableCell>
                        <TableCell className="text-center">
                          <Badge variant={p.ativo ? "default" : "secondary"}>{p.ativo ? "Ativo" : "Inativo"}</Badge>
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-1">
                            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => { setEditingPlan(p); setPlanFormOpen(true); }}>
                              <Pencil className="h-4 w-4" />
                            </Button>
                            <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive hover:text-destructive" onClick={() => setDeletingPlan(p)}>
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </TabsContent>

          <TabsContent value="efi" className="mt-4">
            <Card>
              <CardHeader>
                <CardTitle>Credenciais EFI Pay</CardTitle>
                <CardDescription>
                  Configure o Client ID, Client Secret e o certificado P12 para integração com a API de cobranças EFI.
                </CardDescription>
              </CardHeader>
              <CardContent>
                {loadingSettings ? (
                  <div className="flex justify-center py-8">
                    <Loader2 className="h-6 w-6 animate-spin text-primary" />
                  </div>
                ) : (
                  <div className="space-y-5">
                    <div className="space-y-2">
                      <Label htmlFor="client_id">Client ID</Label>
                      <Input
                        id="client_id"
                        value={clientId}
                        onChange={(e) => setClientId(e.target.value)}
                        placeholder="Informe o Client ID da EFI"
                      />
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="client_secret">Client Secret</Label>
                      <Input
                        id="client_secret"
                        type="password"
                        value={clientSecret}
                        onChange={(e) => setClientSecret(e.target.value)}
                        placeholder="Informe o Client Secret da EFI"
                      />
                    </div>

                    <div className="space-y-2">
                      <Label>Certificado P12</Label>
                      <div className="flex items-center gap-3">
                        <label className="flex cursor-pointer items-center gap-2 rounded-md border border-input bg-background px-4 py-2 text-sm hover:bg-accent transition-colors">
                          <Upload className="h-4 w-4" />
                          {certFile ? certFile.name : "Selecionar arquivo .p12"}
                          <input
                            type="file"
                            accept=".p12,.pem,.pfx"
                            className="hidden"
                            onChange={(e) => setCertFile(e.target.files?.[0] || null)}
                          />
                        </label>
                        {certUploaded && !certFile && (
                          <span className="flex items-center gap-1 text-sm text-primary">
                          <CheckCircle className="h-4 w-4" /> Certificado enviado
                          </span>
                        )}
                        {!certUploaded && !certFile && (
                          <span className="flex items-center gap-1 text-sm text-muted-foreground">
                            <XCircle className="h-4 w-4" /> Nenhum certificado
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="flex flex-col sm:flex-row gap-3">
                      <Button onClick={handleSave} disabled={saving} className="w-full sm:w-auto">
                        {saving ? (
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        ) : (
                          <Save className="mr-2 h-4 w-4" />
                        )}
                        Salvar Configurações
                      </Button>
                      <Button variant="outline" onClick={handleTestConnection} disabled={testing} className="w-full sm:w-auto">
                        {testing ? (
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        ) : (
                          <Zap className="mr-2 h-4 w-4" />
                        )}
                        Testar Conexão
                      </Button>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* WhatsApp Tab */}
          <TabsContent value="whatsapp" className="mt-4">
            <Card>
              <CardHeader>
                <CardTitle>WhatsApp (uazapi)</CardTitle>
                <CardDescription>
                  Configure o token de acesso à API do servidor uazapi para envio de notificações via WhatsApp.
                </CardDescription>
              </CardHeader>
              <CardContent>
                {loadingSettings ? (
                  <div className="flex justify-center py-8">
                    <Loader2 className="h-6 w-6 animate-spin text-primary" />
                  </div>
                ) : (
                  <div className="space-y-5">
                    <div className="space-y-2">
                      <Label htmlFor="uazapi_token">Token da API</Label>
                      <Input
                        id="uazapi_token"
                        type="password"
                        value={uazapiToken}
                        onChange={(e) => setUazapiToken(e.target.value)}
                        placeholder="Informe o token do servidor uazapi"
                      />
                      <p className="text-xs text-muted-foreground">
                        Servidor: https://ipazua.uazapi.com
                      </p>
                    </div>

                    <Button
                      onClick={async () => {
                        setSavingWhatsapp(true);
                        try {
                          await upsertSetting("uazapi_token", uazapiToken);
                          toast.success("Token WhatsApp salvo!");
                        } catch (err: any) {
                          toast.error("Erro ao salvar: " + (err.message || "Erro desconhecido"));
                        }
                        setSavingWhatsapp(false);
                      }}
                      disabled={savingWhatsapp}
                    >
                      {savingWhatsapp ? (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      ) : (
                        <Save className="mr-2 h-4 w-4" />
                      )}
                      Salvar Token
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>

        {/* Plan Form */}
        <PlanFormDialog
          open={planFormOpen}
          onOpenChange={setPlanFormOpen}
          plan={editingPlan}
          onSave={addPlan}
          onUpdate={updatePlan}
        />

        {/* Delete Plan Confirmation */}
        <AlertDialog open={!!deletingPlan} onOpenChange={(open) => !open && setDeletingPlan(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Excluir plano</AlertDialogTitle>
              <AlertDialogDescription>
                Tem certeza que deseja excluir o plano <strong>{deletingPlan?.nome}</strong>?
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancelar</AlertDialogCancel>
              <AlertDialogAction
                onClick={async () => { if (deletingPlan) { await deletePlan(deletingPlan.id); setDeletingPlan(null); } }}
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              >
                Excluir
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </main>
    </div>
  );
}
