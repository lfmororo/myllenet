import { useState, useEffect } from "react";
import { useAuth } from "@/hooks/useAuth";
import { api } from "@/integrations/api/client";
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
import { ArrowLeft, Loader2, Save, Upload, CheckCircle, XCircle, ShieldAlert, Zap, Plus, Pencil, Trash2, Package, MessageCircle, Users, Router, FileDown, Calendar } from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useDiagnosticPDF } from "@/hooks/useDiagnosticPDF";
import { Checkbox } from "@/components/ui/checkbox";



export default function Settings() {
  const { user, isAdmin, loading: authLoading } = useAuth();
  const navigate = useNavigate();

  const [paymentGateway, setPaymentGateway] = useState("efi");
  const [savingGateway, setSavingGateway] = useState(false);
  const [testingMp, setTestingMp] = useState(false);
  const [savingMp, setSavingMp] = useState(false);
  const [mpAccessToken, setMpAccessToken] = useState("");
  const [mpTokenSaved, setMpTokenSaved] = useState(false);
  const API_URL = (import.meta.env.VITE_API_URL as string) || "http://localhost:3333";
  const IS_SUPABASE = ((import.meta.env.VITE_BACKEND as string) || "supabase") === "supabase";
  const mpWebhookUrl = IS_SUPABASE
    ? `${((import.meta.env.VITE_SUPABASE_URL as string) || "").replace(/\/$/, "")}/functions/v1/mercadopago/webhook`
    : `${API_URL}/api/functions/mercadopago/webhook`;
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [certFile, setCertFile] = useState<File | null>(null);
  const [certUploaded, setCertUploaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loadingSettings, setLoadingSettings] = useState(true);
  const [testing, setTesting] = useState(false);

  // WhatsApp settings
  const [whatsappProvider, setWhatsappProvider] = useState("uazapi");
  const [uazapiToken, setUazapiToken] = useState("");
  const [adminWhatsapp, setAdminWhatsapp] = useState("");
  const [evolutionBaseUrl, setEvolutionBaseUrl] = useState("");
  const [evolutionApiKey, setEvolutionApiKey] = useState("");
  const [evolutionInstance, setEvolutionInstance] = useState("");
  const [savingWhatsapp, setSavingWhatsapp] = useState(false);
  const [testingWhatsapp, setTestingWhatsapp] = useState(false);


  // PIX settings
  const [pixKey, setPixKey] = useState("");
  const [pixName, setPixName] = useState("");
  const [pixCity, setPixCity] = useState("");
  const [savingPix, setSavingPix] = useState(false);

  // Mikrotik settings
  const [mikrotikHost, setMikrotikHost] = useState("");
  const [mikrotikHostSecondary, setMikrotikHostSecondary] = useState("");
  const [mikrotikUser, setMikrotikUser] = useState("");
  const [mikrotikPass, setMikrotikPass] = useState("");
  const [mikrotikApiPort, setMikrotikApiPort] = useState("8728");
  const [mikrotikRestPort, setMikrotikRestPort] = useState("80");
  const [blockingDays, setBlockingDays] = useState("15");
  const [alertOfflineMinutes, setAlertOfflineMinutes] = useState("5");
  const [alertFailureCount, setAlertFailureCount] = useState("3");

  const [savingMikrotik, setSavingMikrotik] = useState(false);
  const [generatingReport, setGeneratingReport] = useState(false);
  const { generatePDF: downloadPDF, generating: generatingPDF } = useDiagnosticPDF();
  const [reportDates, setReportDates] = useState({
    start: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
    end: new Date().toISOString().split('T')[0]
  });

  // User management state
  interface SystemUser {
    id: string;
    email: string;
    full_name: string;
    role: string;
    created_at: string;
    last_sign_in_at: string | null;
    report_permissions: string[];
  }
  const [users, setUsers] = useState<SystemUser[]>([]);
  const [usersLoading, setUsersLoading] = useState(false);
  const [userFormOpen, setUserFormOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<SystemUser | null>(null);
  const [deletingUser, setDeletingUser] = useState<SystemUser | null>(null);
  const [userForm, setUserForm] = useState({ email: "", password: "", full_name: "", role: "user", phone: "", report_permissions: [] as string[] });
  const [savingUser, setSavingUser] = useState(false);

  // Plans state
  const { plans, loading: plansLoading, addPlan, updatePlan, deletePlan } = usePlans();
  const [planFormOpen, setPlanFormOpen] = useState(false);
  const [editingPlan, setEditingPlan] = useState<Plan | null>(null);
  const [deletingPlan, setDeletingPlan] = useState<Plan | null>(null);
  useEffect(() => {
    if (user && isAdmin) {
      loadSettings();
      fetchUsers();
    }
  }, [user, isAdmin]);

  const fetchUsers = async () => {
    setUsersLoading(true);
    try {
      const { data, error } = await api.functions.invoke("user-management/list", { body: {} });
      if (!error && data) setUsers(data);
      else console.error("Fetch users error:", error);
    } catch (err) {
      console.error(err);
    }
    setUsersLoading(false);
  };

  const handleSaveUser = async () => {
    setSavingUser(true);
    try {
      if (editingUser) {
        const body: any = { user_id: editingUser.id, role: userForm.role, report_permissions: userForm.report_permissions };
        if (userForm.full_name !== editingUser.full_name) body.full_name = userForm.full_name;
        if (userForm.email !== editingUser.email) body.email = userForm.email;
        if (userForm.password) body.password = userForm.password;
        body.phone = userForm.phone;

        const { error } = await api.functions.invoke("user-management/update", { body });
        if (error) { toast.error(error.message); setSavingUser(false); return; }
        toast.success("Usuário atualizado!");
      } else {
        const { error } = await api.functions.invoke("user-management/create", { body: userForm });
        if (error) { toast.error(error.message); setSavingUser(false); return; }
        toast.success("Usuário criado!");
      }
      setUserFormOpen(false);
      fetchUsers();
    } catch (err: any) {
      toast.error(err.message || "Erro");
    }
    setSavingUser(false);
  };

  const handleDeleteUser = async () => {
    if (!deletingUser) return;
    try {
      const { error } = await api.functions.invoke("user-management/delete", { body: { user_id: deletingUser.id } });
      if (error) { toast.error(error.message); return; }
      toast.success("Usuário excluído!");
      setDeletingUser(null);
      fetchUsers();
    } catch (err: any) {
      toast.error(err.message || "Erro");
    }
  };

  const loadSettings = async () => {
    setLoadingSettings(true);
    const { data } = await api
      .from("settings")
      .select("key, value")
      .in("key", ["payment_gateway", "mercadopago_access_token", "efi_client_id", "efi_client_secret", "efi_certificate_path", "uazapi_token", "whatsapp_provider", "evolution_base_url", "evolution_api_key", "evolution_instance", "mikrotik_host", "mikrotik_host_secondary", "mikrotik_username", "mikrotik_password", "mikrotik_api_port", "mikrotik_rest_port", "blocking_days", "pix_key", "pix_name", "pix_city", "mikrotik_alert_offline_minutes", "mikrotik_alert_failure_count", "admin_whatsapp"]);

    if (data) {
      for (const row of data) {
        if (row.key === "admin_whatsapp") setAdminWhatsapp(row.value || "");
        if (row.key === "payment_gateway") setPaymentGateway(row.value || "efi");
        if (row.key === "mercadopago_access_token") setMpTokenSaved(!!row.value);
        if (row.key === "efi_client_id") setClientId(row.value || "");
        if (row.key === "efi_client_secret") setClientSecret(row.value || "");
        if (row.key === "efi_certificate_path") setCertUploaded(!!row.value);
        if (row.key === "uazapi_token") setUazapiToken(row.value || "");
        if (row.key === "whatsapp_provider") setWhatsappProvider(row.value || "uazapi");
        if (row.key === "evolution_base_url") setEvolutionBaseUrl(row.value || "");
        if (row.key === "evolution_api_key") setEvolutionApiKey(row.value || "");
        if (row.key === "evolution_instance") setEvolutionInstance(row.value || "");
        if (row.key === "mikrotik_host") setMikrotikHost(row.value || "");
        if (row.key === "mikrotik_host_secondary") setMikrotikHostSecondary(row.value || "");
        if (row.key === "mikrotik_username") setMikrotikUser(row.value || "");
        if (row.key === "mikrotik_password") setMikrotikPass(row.value || "");
        if (row.key === "mikrotik_api_port") setMikrotikApiPort(row.value || "8728");
        if (row.key === "mikrotik_rest_port") setMikrotikRestPort(row.value || "80");
        if (row.key === "blocking_days") setBlockingDays(row.value || "15");
        if (row.key === "pix_key") setPixKey(row.value || "");
        if (row.key === "pix_name") setPixName(row.value || "");
        if (row.key === "pix_city") setPixCity(row.value || "");
        if (row.key === "mikrotik_alert_offline_minutes") setAlertOfflineMinutes(row.value || "5");
        if (row.key === "mikrotik_alert_failure_count") setAlertFailureCount(row.value || "3");
      }
    }

    setLoadingSettings(false);
  };

  const upsertSetting = async (key: string, value: string) => {
    const { data: existing } = await api
      .from("settings")
      .select("id")
      .eq("key", key)
      .maybeSingle();

    if (existing) {
      await api.from("settings").update({ value }).eq("key", key);
    } else {
      await api.from("settings").insert({ key, value });
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await upsertSetting("efi_client_id", clientId);
      await upsertSetting("efi_client_secret", clientSecret);

      if (certFile) {
        await upsertSetting("efi_certificate_path", certFile.name);
        setCertUploaded(true);
      }

      toast.success("Configurações salvas com sucesso!");
    } catch (err: any) {
      toast.error("Erro ao salvar: " + (err.message || "Erro desconhecido"));
    }
    setSaving(false);
  };

  const handleSaveGateway = async () => {
    setSavingGateway(true);
    try {
      await upsertSetting("payment_gateway", paymentGateway);
      toast.success("Forma de cobrança salva!");
    } catch (err: any) {
      toast.error("Erro ao salvar: " + (err.message || "Erro desconhecido"));
    }
    setSavingGateway(false);
  };

  const handleSaveMercadoPago = async () => {
    if (!mpAccessToken.trim()) {
      toast.error("Informe o Access Token do Mercado Pago.");
      return;
    }
    setSavingMp(true);
    try {
      await upsertSetting("mercadopago_access_token", mpAccessToken.trim());
      setMpTokenSaved(true);
      setMpAccessToken("");
      toast.success("Credenciais do Mercado Pago salvas!");
    } catch (err: any) {
      toast.error("Erro ao salvar: " + (err.message || "Erro desconhecido"));
    }
    setSavingMp(false);
  };

  const handleTestMercadoPago = async () => {
    setTestingMp(true);
    try {
      const { data: result, error } = await api.functions.invoke("mercadopago/test", { body: {} });
      if (!error && result.ok) {
        toast.success(`Mercado Pago conectado: ${result.account}`);
      } else {
        toast.error("Falha: " + (result?.error || error?.message || "Erro desconhecido"));
      }
    } catch (err: any) {
      toast.error("Erro ao testar: " + (err.message || "Erro desconhecido"));
    }
    setTestingMp(false);
  };

  const handleTestConnection = async () => {
    setTesting(true);
    try {
      const { data: result, error } = await api.functions.invoke("efi-boleto/test", { body: {} });
      if (!error && result.success) {
        toast.success("Conexão com a EFI estabelecida com sucesso!");
      } else {
        toast.error("Falha: " + (result?.error || error?.message || "Erro desconhecido"));
      }
    } catch (err: any) {
      toast.error("Erro ao testar: " + (err.message || "Erro desconhecido"));
    }
    setTesting(false);
  };

  const handleDownloadDiagnosticReport = async (format: 'json' | 'pdf' = 'json') => {
    setGeneratingReport(true);
    try {
      const { data, error } = await api.functions.invoke("api-diagnostic-report", {
        body: { start: `${reportDates.start}T00:00:00Z`, end: `${reportDates.end}T23:59:59Z` },
      });
      if (error) throw error;

      if (format === 'pdf') {
        await downloadPDF(data);
      } else {
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `diagnostico-api-${reportDates.start}-a-${reportDates.end}.json`;
        document.body.appendChild(a);
        a.click();
        window.URL.revokeObjectURL(url);
        document.body.removeChild(a);
        toast.success("Relatório de diagnóstico baixado com sucesso!");
      }
    } catch (err: any) {
      toast.error("Erro ao gerar relatório: " + err.message);
    }
    setGeneratingReport(false);
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
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">Configurações</h2>
        <p className="text-muted-foreground">Gerencie as integrações do sistema</p>
      </div>

      <div className="max-w-2xl">
        <Tabs defaultValue="plans">
          <TabsList>
            <TabsTrigger value="plans">
              <Package className="mr-1.5 h-4 w-4" /> Planos
            </TabsTrigger>
            <TabsTrigger value="pagamentos">Pagamentos</TabsTrigger>
            <TabsTrigger value="efi">API EFI</TabsTrigger>
            <TabsTrigger value="whatsapp">
              <MessageCircle className="mr-1.5 h-4 w-4" /> WhatsApp
            </TabsTrigger>
            <TabsTrigger value="users">
              <Users className="mr-1.5 h-4 w-4" /> Usuários
            </TabsTrigger>
            <TabsTrigger value="mikrotik">
              <Router className="mr-1.5 h-4 w-4" /> Mikrotik
            </TabsTrigger>
            <TabsTrigger value="pix">PIX Local</TabsTrigger>
            <TabsTrigger value="diagnostic">
              <ShieldAlert className="mr-1.5 h-4 w-4" /> Diagnóstico
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

          <TabsContent value="pagamentos" className="mt-4 space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>Plataforma de cobrança</CardTitle>
                <CardDescription>
                  Escolha qual plataforma vai gerar as cobranças e o Pix dos clientes.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="payment_gateway">Plataforma em uso</Label>
                  <Select value={paymentGateway} onValueChange={setPaymentGateway}>
                    <SelectTrigger id="payment_gateway">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="mercadopago">Mercado Pago (Pix com baixa automática)</SelectItem>
                      <SelectItem value="efi">EFI Pay (boleto + Pix)</SelectItem>
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">
                    Com o Mercado Pago, cada fatura gera o Pix e o QR Code direto pela plataforma e o pagamento é
                    confirmado sozinho, liberando o cliente automaticamente.
                  </p>
                </div>
                <Button onClick={handleSaveGateway} disabled={savingGateway}>
                  {savingGateway && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Salvar plataforma
                </Button>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Mercado Pago</CardTitle>
                <CardDescription>
                  Informe o Access Token de produção (Mercado Pago → Suas integrações → Credenciais de produção).
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="mp_token">Access Token</Label>
                  <Input
                    id="mp_token"
                    type="password"
                    value={mpAccessToken}
                    onChange={(e) => setMpAccessToken(e.target.value)}
                    placeholder={mpTokenSaved ? "Token já configurado — informe outro para substituir" : "APP_USR-..."}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="mp_webhook">URL de notificações (webhook)</Label>
                  <div className="flex gap-2">
                    <Input id="mp_webhook" readOnly value={mpWebhookUrl} className="font-mono text-xs" />
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => {
                        navigator.clipboard.writeText(mpWebhookUrl);
                        toast.success("URL copiada!");
                      }}
                    >
                      Copiar
                    </Button>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Cadastre esta URL no Mercado Pago, em Webhooks, marcando o evento de Pagamentos. É isso que garante a
                    baixa imediata das faturas.
                  </p>
                </div>
                <div className="flex gap-2">
                  <Button onClick={handleSaveMercadoPago} disabled={savingMp}>
                    {savingMp && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    Salvar credenciais
                  </Button>
                  <Button variant="outline" onClick={handleTestMercadoPago} disabled={testingMp}>
                    {testingMp && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    Testar conexão
                  </Button>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="efi" className="mt-4 space-y-4">
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
                <CardTitle>WhatsApp</CardTitle>
                <CardDescription>
                  Escolha qual API será usada para o envio das notificações: uazapi ou Evolution API.
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
                      <Label htmlFor="whatsapp_provider">API em uso</Label>
                      <Select value={whatsappProvider} onValueChange={setWhatsappProvider}>
                        <SelectTrigger id="whatsapp_provider">
                          <SelectValue placeholder="Selecione a API" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="uazapi">uazapi</SelectItem>
                          <SelectItem value="evolution">Evolution API</SelectItem>
                        </SelectContent>
                      </Select>
                      <p className="text-xs text-muted-foreground">
                        Todas as notificações (faturas, lembretes, alertas) usarão a API selecionada.
                      </p>
                    </div>

                    {whatsappProvider === "uazapi" ? (
                      <div className="space-y-2">
                        <Label htmlFor="uazapi_token">Token da API (uazapi)</Label>
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
                    ) : (
                      <div className="space-y-4">
                        <div className="space-y-2">
                          <Label htmlFor="evolution_base_url">URL do servidor</Label>
                          <Input
                            id="evolution_base_url"
                            value={evolutionBaseUrl}
                            onChange={(e) => setEvolutionBaseUrl(e.target.value)}
                            placeholder="https://sua-evolution-api.com"
                          />
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="evolution_api_key">API Key (apikey)</Label>
                          <Input
                            id="evolution_api_key"
                            type="password"
                            value={evolutionApiKey}
                            onChange={(e) => setEvolutionApiKey(e.target.value)}
                            placeholder="Chave global ou da instância"
                          />
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="evolution_instance">Nome da instância</Label>
                          <Input
                            id="evolution_instance"
                            value={evolutionInstance}
                            onChange={(e) => setEvolutionInstance(e.target.value)}
                            placeholder="ex: myllenet"
                          />
                        </div>
                        <p className="text-xs text-muted-foreground">
                          Endpoints usados: /message/sendText, /message/sendMedia, /message/sendButtons e
                          /instance/connectionState.
                        </p>
                      </div>
                    )}

                    <div className="space-y-2">
                      <Label htmlFor="admin_whatsapp">WhatsApp do administrador (avisos de diagnóstico)</Label>
                      <Input
                        id="admin_whatsapp"
                        placeholder="Ex.: 85999999999"
                        value={adminWhatsapp}
                        onChange={(e) => setAdminWhatsapp(e.target.value)}
                      />
                      <p className="text-xs text-muted-foreground">
                        Recebe um resumo sempre que um cliente fizer um diagnóstico. Deixe vazio para não avisar.
                      </p>
                    </div>

                    <div className="flex flex-wrap gap-2">
                      <Button
                        onClick={async () => {
                          setSavingWhatsapp(true);
                          try {
                            await upsertSetting("whatsapp_provider", whatsappProvider);
                            await upsertSetting("admin_whatsapp", adminWhatsapp.replace(/\D/g, ""));
                            if (whatsappProvider === "uazapi") {
                              await upsertSetting("uazapi_token", uazapiToken);
                            } else {
                              await upsertSetting("evolution_base_url", evolutionBaseUrl.replace(/\/+$/, ""));
                              await upsertSetting("evolution_api_key", evolutionApiKey);
                              await upsertSetting("evolution_instance", evolutionInstance);
                            }
                            toast.success("Configurações do WhatsApp salvas!");
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
                        Salvar
                      </Button>

                      <Button
                        variant="outline"
                        onClick={async () => {
                          setTestingWhatsapp(true);
                          try {
                            const { data: result, error } = await api.functions.invoke("whatsapp-send/test", { body: {} });
                            if (!error && result.success) toast.success(`Conexão OK (${result.provider}) - ${result.state ?? "ativo"}`);
                            else toast.error("Falha: " + (result?.error || error?.message || "Erro desconhecido"));
                          } catch (err: any) {
                            toast.error("Erro ao testar: " + (err.message || "Erro desconhecido"));
                          }
                          setTestingWhatsapp(false);
                        }}
                        disabled={testingWhatsapp}
                      >
                        {testingWhatsapp ? (
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

          {/* Users Tab */}
          <TabsContent value="users" className="mt-4 space-y-4">
            <div className="flex items-center justify-between">
              <p className="text-sm text-muted-foreground">{users.length} usuário{users.length !== 1 ? "s" : ""}</p>
              <Button onClick={() => { setEditingUser(null); setUserForm({ email: "", password: "", full_name: "", role: "user", phone: "", report_permissions: [] }); setUserFormOpen(true); }}>
                <Plus className="mr-2 h-4 w-4" /> Novo Usuário
              </Button>
            </div>
            {usersLoading ? (
              <div className="flex justify-center py-8">
                <Loader2 className="h-6 w-6 animate-spin text-primary" />
              </div>
            ) : (
              <div className="rounded-lg border bg-card">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-muted/50">
                      <TableHead className="font-semibold">Nome</TableHead>
                      <TableHead className="font-semibold">E-mail</TableHead>
                      <TableHead className="font-semibold">Perfil</TableHead>
                      <TableHead className="font-semibold text-right">Ações</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {users.map((u) => (
                      <TableRow key={u.id}>
                        <TableCell className="font-medium">{u.full_name || "—"}</TableCell>
                        <TableCell>{u.email}</TableCell>
                        <TableCell>
                          <Badge variant={u.role === "admin" ? "default" : "secondary"}>
                            {u.role === "admin" ? "Admin" : "Usuário"}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-1">
                            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => {
                              setEditingUser(u);
                               setUserForm({ email: u.email, password: "", full_name: u.full_name, role: u.role, phone: (u as any).phone || "", report_permissions: u.report_permissions || [] });
                              setUserFormOpen(true);
                            }}>
                              <Pencil className="h-4 w-4" />
                            </Button>
                            {u.id !== user?.id && (
                              <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive hover:text-destructive" onClick={() => setDeletingUser(u)}>
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </TabsContent>

          {/* Mikrotik Tab */}
          <TabsContent value="mikrotik" className="mt-4">
            <Card>
              <CardHeader>
                <CardTitle>Mikrotik</CardTitle>
                <CardDescription>
                  Configure o endereço IP externo e as credenciais para o gerenciamento via API.
                </CardDescription>
              </CardHeader>
              <CardContent>
                {loadingSettings ? (
                  <div className="flex justify-center py-8">
                    <Loader2 className="h-6 w-6 animate-spin text-primary" />
                  </div>
                ) : (
                  <div className="space-y-5">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label htmlFor="mikrotik_host">IP/Host Mikrotik (Preferencial)</Label>
                        <Input
                          id="mikrotik_host"
                          value={mikrotikHost}
                          onChange={(e) => setMikrotikHost(e.target.value)}
                          placeholder="IP Externo ou DNS"
                        />
                      </div>

                      <div className="space-y-2">
                        <Label htmlFor="mikrotik_host_secondary">IP/Host Mikrotik (Secundário)</Label>
                        <Input
                          id="mikrotik_host_secondary"
                          value={mikrotikHostSecondary}
                          onChange={(e) => setMikrotikHostSecondary(e.target.value)}
                          placeholder="IP Externo ou DNS (Opcional)"
                        />
                      </div>
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="mikrotik_user">Usuário</Label>
                      <Input
                        id="mikrotik_user"
                        value={mikrotikUser}
                        onChange={(e) => setMikrotikUser(e.target.value)}
                        placeholder="admin"
                      />
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="mikrotik_pass">Senha</Label>
                      <Input
                        id="mikrotik_pass"
                        type="password"
                        value={mikrotikPass}
                        onChange={(e) => setMikrotikPass(e.target.value)}
                        placeholder="Senha do Mikrotik"
                      />
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="mikrotik_port">Porta API</Label>
                      <Input
                        id="mikrotik_port"
                        value={mikrotikApiPort}
                        onChange={(e) => setMikrotikApiPort(e.target.value)}
                        placeholder="8728"
                      />
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="mikrotik_rest_port">Porta API REST (www)</Label>
                      <Input
                        id="mikrotik_rest_port"
                        value={mikrotikRestPort}
                        onChange={(e) => setMikrotikRestPort(e.target.value)}
                        placeholder="80"
                      />
                      <p className="text-xs text-muted-foreground">
                        Porta do serviço www/www-ssl do RouterOS v7. Necessária para ver clientes on-line no PPPoE.
                      </p>
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="blocking_days">Dias para Bloqueio Automático</Label>
                      <Input
                        id="blocking_days"
                        type="number"
                        min="1"
                        max="90"
                        value={blockingDays}
                        onChange={(e) => setBlockingDays(e.target.value)}
                        placeholder="15"
                      />
                      <p className="text-xs text-muted-foreground">
                        Configure quantos dias após o vencimento o cliente deve ser bloqueado.
                      </p>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label htmlFor="alert_offline_minutes">Minutos Offline p/ Alerta</Label>
                        <Input
                          id="alert_offline_minutes"
                          type="number"
                          min="1"
                          value={alertOfflineMinutes}
                          onChange={(e) => setAlertOfflineMinutes(e.target.value)}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="alert_failure_count">Qtd. Falhas p/ Alerta</Label>
                        <Input
                          id="alert_failure_count"
                          type="number"
                          min="1"
                          value={alertFailureCount}
                          onChange={(e) => setAlertFailureCount(e.target.value)}
                        />
                      </div>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      O sistema enviará alertas no WhatsApp se o Mikrotik ficar offline por este tempo ou atingir esta quantidade de falhas consecutivas.
                    </p>

                    <Button
                      onClick={async () => {
                        setSavingMikrotik(true);
                        try {
                          await upsertSetting("mikrotik_host", mikrotikHost);
                          await upsertSetting("mikrotik_host_secondary", mikrotikHostSecondary);
                          await upsertSetting("mikrotik_username", mikrotikUser);
                          await upsertSetting("mikrotik_password", mikrotikPass);
                          await upsertSetting("mikrotik_api_port", mikrotikApiPort);
                          await upsertSetting("mikrotik_rest_port", mikrotikRestPort);
                          await upsertSetting("blocking_days", blockingDays);
                          await upsertSetting("mikrotik_alert_offline_minutes", alertOfflineMinutes);
                          await upsertSetting("mikrotik_alert_failure_count", alertFailureCount);
                          toast.success("Configurações Mikrotik salvas!");
                        } catch (err: any) {
                          toast.error("Erro ao salvar: " + (err.message || "Erro desconhecido"));
                        }
                        setSavingMikrotik(false);
                      }}
                      disabled={savingMikrotik}
                    >
                      {savingMikrotik ? (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      ) : (
                        <Save className="mr-2 h-4 w-4" />
                      )}
                      Salvar Configurações
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>

            <div className="mt-4 rounded-lg border bg-muted/40 p-4 text-sm text-muted-foreground">
              Para coletar métricas por uma VPS, use a página{" "}
              <button
                type="button"
                className="font-medium text-primary underline"
                onClick={() => navigate("/agente")}
              >
                Agente VPS
              </button>
              , com download do pacote pré-configurado e tutorial de instalação.
            </div>

          </TabsContent>

          <TabsContent value="pix" className="mt-4">
            <Card>
              <CardHeader>
                <CardTitle>Configurações PIX Local</CardTitle>
                <CardDescription>
                  Configure os dados para geração do QR Code PIX nas faturas.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label>Chave PIX</Label>
                  <Input value={pixKey} onChange={(e) => setPixKey(e.target.value)} placeholder="CNPJ, E-mail, Celular ou Chave Aleatória" />
                </div>
                <div className="space-y-2">
                  <Label>Nome do Beneficiário</Label>
                  <Input value={pixName} onChange={(e) => setPixName(e.target.value)} placeholder="Nome ou Razão Social" />
                </div>
                <div className="space-y-2">
                  <Label>Cidade</Label>
                  <Input value={pixCity} onChange={(e) => setPixCity(e.target.value)} placeholder="Cidade do beneficiário" />
                </div>
                <Button 
                  onClick={async () => {
                    setSavingPix(true);
                    try {
                      await upsertSetting("pix_key", pixKey);
                      await upsertSetting("pix_name", pixName);
                      await upsertSetting("pix_city", pixCity);
                      toast.success("Configurações PIX salvas!");
                    } catch (err: any) {
                      toast.error("Erro ao salvar: " + err.message);
                    }
                    setSavingPix(false);
                  }}
                  disabled={savingPix}
                >
                  {savingPix && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Salvar Configurações PIX
                </Button>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="diagnostic" className="mt-4">
            <Card>
              <CardHeader>
                <CardTitle>Diagnóstico da API</CardTitle>
                <CardDescription>
                  Gere um relatório completo com métricas de chamadas à API, erros por rota, tempo de resposta e histórico de falhas.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Data Inicial</Label>
                    <div className="relative">
                      <Input 
                        type="date" 
                        value={reportDates.start} 
                        onChange={(e) => setReportDates({ ...reportDates, start: e.target.value })} 
                      />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label>Data Final</Label>
                    <div className="relative">
                      <Input 
                        type="date" 
                        value={reportDates.end} 
                        onChange={(e) => setReportDates({ ...reportDates, end: e.target.value })} 
                      />
                    </div>
                  </div>
                </div>

                <div className="bg-muted/50 p-4 rounded-lg border text-sm space-y-2">
                  <p className="font-semibold flex items-center gap-2">
                    <Zap className="h-4 w-4 text-primary" /> O que este relatório inclui:
                  </p>
                  <ul className="list-disc list-inside space-y-1 text-muted-foreground">
                    <li>Métricas detalhadas da API EFI Pay (sucesso vs erro)</li>
                    <li>Tempo médio de resposta das integrações</li>
                    <li>Logs de notificações via WhatsApp (falhas e motivos)</li>
                    <li>Histórico de conectividade com o Mikrotik</li>
                    <li>Erros agrupados por rota/endpoint</li>
                  </ul>
                </div>

                <div className="flex flex-col sm:flex-row gap-3">
                  <Button 
                    onClick={() => handleDownloadDiagnosticReport('json')}
                    disabled={generatingReport || generatingPDF}
                    variant="outline"
                    className="flex-1"
                  >
                    {generatingReport && !generatingPDF ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <FileDown className="mr-2 h-4 w-4" />
                    )}
                    Baixar JSON
                  </Button>

                  <Button 
                    onClick={() => handleDownloadDiagnosticReport('pdf')}
                    disabled={generatingReport || generatingPDF}
                    className="flex-1"
                  >
                    {generatingPDF ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <FileDown className="mr-2 h-4 w-4" />
                    )}
                    Baixar PDF
                  </Button>
                </div>
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

        {/* User Form Dialog */}
        <Dialog open={userFormOpen} onOpenChange={setUserFormOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{editingUser ? "Editar Usuário" : "Novo Usuário"}</DialogTitle>
              <DialogDescription>
                {editingUser ? "Altere os dados do usuário." : "Preencha os dados para criar um novo usuário do sistema."}
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div className="space-y-2">
                <Label>Nome completo</Label>
                <Input value={userForm.full_name} onChange={(e) => setUserForm({ ...userForm, full_name: e.target.value })} placeholder="Nome do usuário" />
              </div>
              <div className="space-y-2">
                <Label>E-mail</Label>
                <Input type="email" value={userForm.email} onChange={(e) => setUserForm({ ...userForm, email: e.target.value })} placeholder="email@exemplo.com" />
              </div>
              <div className="space-y-2">
                <Label>{editingUser ? "Nova senha (deixe vazio para manter)" : "Senha"}</Label>
                <Input type="password" value={userForm.password} onChange={(e) => setUserForm({ ...userForm, password: e.target.value })} placeholder="••••••••" required={!editingUser} minLength={6} />
              </div>
              <div className="space-y-2">
                <Label>Telefone</Label>
                <Input value={userForm.phone} onChange={(e) => setUserForm({ ...userForm, phone: e.target.value })} placeholder="(00) 00000-0000" />
              </div>
              <div className="space-y-2">
                <Label>Perfil</Label>
                <Select value={userForm.role} onValueChange={(v) => setUserForm({ ...userForm, role: v })}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="user">Usuário</SelectItem>
                    <SelectItem value="admin">Administrador</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {userForm.role !== "admin" && (
                <div className="space-y-3 border-t pt-4">
                  <Label>Permissões de relatórios</Label>
                  <div className="grid gap-3 sm:grid-cols-2">
                    {[
                      ["overdue", "Clientes em atraso"], ["blocked", "Clientes bloqueados"],
                      ["customers", "Clientes"], ["financial", "Financeiro"],
                      ["bandwidth", "Consumo de banda"], ["missing_invoice", "Sem fatura"],
                      ["platforms", "Por plataforma"],
                    ].map(([key, label]) => (
                      <label key={key} className="flex items-center gap-2 text-sm">
                        <Checkbox checked={userForm.report_permissions.includes(key)} onCheckedChange={(checked) => setUserForm({ ...userForm, report_permissions: checked ? [...userForm.report_permissions, key] : userForm.report_permissions.filter((item) => item !== key) })} />
                        {label}
                      </label>
                    ))}
                  </div>
                </div>
              )}
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setUserFormOpen(false)}>Cancelar</Button>
              <Button onClick={handleSaveUser} disabled={savingUser}>
                {savingUser && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {editingUser ? "Salvar" : "Criar"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Delete User Confirmation */}
        <AlertDialog open={!!deletingUser} onOpenChange={(open) => !open && setDeletingUser(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Excluir usuário</AlertDialogTitle>
              <AlertDialogDescription>
                Tem certeza que deseja excluir <strong>{deletingUser?.email}</strong>? Esta ação não pode ser desfeita.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancelar</AlertDialogCancel>
              <AlertDialogAction onClick={handleDeleteUser} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
                Excluir
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </div>
  );
}
