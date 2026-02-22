import { useState, useEffect } from "react";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { Navigate, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ArrowLeft, Loader2, Save, Upload, CheckCircle, XCircle, ShieldAlert, Zap } from "lucide-react";
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

  useEffect(() => {
    if (user && isAdmin) loadSettings();
  }, [user, isAdmin]);

  const loadSettings = async () => {
    setLoadingSettings(true);
    const { data } = await supabase
      .from("settings")
      .select("key, value")
      .in("key", ["efi_client_id", "efi_client_secret", "efi_certificate_path"]);

    if (data) {
      for (const row of data) {
        if (row.key === "efi_client_id") setClientId(row.value || "");
        if (row.key === "efi_client_secret") setClientSecret(row.value || "");
        if (row.key === "efi_certificate_path") setCertUploaded(!!row.value);
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
        <Tabs defaultValue="efi">
          <TabsList>
            <TabsTrigger value="efi">API EFI</TabsTrigger>
          </TabsList>

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
        </Tabs>
      </main>
    </div>
  );
}
