import { useEffect, useState } from "react";
import JSZip from "jszip";
import { api } from "@/integrations/api/client";
import { toast } from "sonner";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Download, Plus, Trash2, Server, RefreshCw } from "lucide-react";

import agentJs from "@/agent-template/agente.js?raw";
import agentPkg from "@/agent-template/package.json?raw";
import agentReadme from "@/agent-template/README.md?raw";
import agentInstall from "@/agent-template/install.sh?raw";
import agentService from "@/agent-template/mikrotik-agent.service?raw";
import agentWindows from "@/agent-template/WINDOWS.md?raw";

interface AgentToken {
  id: string;
  name: string;
  token: string;
  active: boolean;
  last_seen_at: string | null;
  last_ip: string | null;
}

function newToken() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export function MikrotikAgentCard() {
  const [agents, setAgents] = useState<AgentToken[]>([]);
  const [loading, setLoading] = useState(false);
  const [name, setName] = useState("vps-monitoramento");
  const [interval, setIntervalSeconds] = useState("30");
  const [wanInterfaces, setWanInterfaces] = useState("BrisanetPPoe,pppoe-out1");

  const loadAgents = async () => {
    const { data } = await api
      .from("agent_tokens")
      .select("*")
      .order("created_at", { ascending: false });
    setAgents((data as AgentToken[]) || []);
  };

  useEffect(() => {
    loadAgents();
  }, []);

  const createAgent = async () => {
    if (!name.trim()) return toast.error("Informe um nome para o agente");
    setLoading(true);
    const { error } = await api
      .from("agent_tokens")
      .insert({ name: name.trim(), token: newToken() });
    setLoading(false);
    if (error) return toast.error(error.message);
    toast.success("Agente criado. Baixe o pacote configurado.");
    loadAgents();
  };

  const revokeAgent = async (id: string) => {
    const { error } = await api.from("agent_tokens").delete().eq("id", id);
    if (error) return toast.error(error.message);
    toast.success("Agente revogado");
    loadAgents();
  };

  const downloadPackage = async (agent: AgentToken) => {
    setLoading(true);
    try {
      const { data: rows } = await api
        .from("settings")
        .select("key,value")
        .in("key", [
          "mikrotik_host",
          "mikrotik_host_secondary",
          "mikrotik_username",
          "mikrotik_password",
          "mikrotik_rest_port",
        ]);

      const cfg: Record<string, string> = {};
      rows?.forEach((r: any) => (cfg[r.key] = r.value || ""));

      if (!cfg.mikrotik_host) {
        toast.error("Cadastre o IP/Host do Mikrotik nas configurações antes de baixar o agente.");
        return;
      }

      const env = [
        "# Gerado automaticamente pelo sistema Mororo.Tech",
        `# Agente: ${agent.name} - ${new Date().toLocaleString("pt-BR")}`,
        "",
        "# Backend do sistema",
        `API_URL=${import.meta.env.VITE_API_URL || "http://localhost:3333"}`,
        `AGENT_TOKEN=${agent.token}`,
        "",
        "# Mikrotik (cadastrado nas configurações do sistema)",
        `MIKROTIK_HOST=${cfg.mikrotik_host}`,
        `MIKROTIK_HOST_SECONDARY=${cfg.mikrotik_host_secondary || ""}`,
        `MIKROTIK_USER=${cfg.mikrotik_username || "admin"}`,
        `MIKROTIK_PASSWORD=${cfg.mikrotik_password || ""}`,
        `MIKROTIK_REST_PORT=${cfg.mikrotik_rest_port || "80"}`,
        "MIKROTIK_USE_HTTPS=false",
        "",
        "# Coleta",
        `INTERVAL_SECONDS=${parseInt(interval, 10) || 30}`,
        `WAN_INTERFACES=${wanInterfaces.trim()}`,
        "COLLECT_PPPOE=true",
        "REQUEST_TIMEOUT_MS=8000",
        "",
      ].join("\n");

      const zip = new JSZip();
      const folder = zip.folder("mikrotik-agent")!;
      folder.file("agente.js", agentJs);
      folder.file("package.json", agentPkg);
      folder.file("README.md", agentReadme);
      folder.file("install.sh", agentInstall);
      folder.file("mikrotik-agent.service", agentService);
      folder.file(".env", env);
      folder.file("env.example", env.replace(agent.token, "SEU_TOKEN_AQUI"));
      folder.file("WINDOWS.md", agentWindows);

      const blob = await zip.generateAsync({ type: "blob" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `mikrotik-agent-${agent.name}.zip`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success("Pacote baixado já configurado com token e IPs do Mikrotik.");
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Server className="h-5 w-5" /> Agente VPS (Coleta Mikrotik)
        </CardTitle>
        <CardDescription>
          Baixe um agente Node.js já configurado para rodar na sua VPS. Ele coleta tráfego WAN,
          CPU, memória, temperatura e sessões PPPoE em intervalos configuráveis e envia direto ao
          sistema.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="grid gap-4 md:grid-cols-3">
          <div className="space-y-2">
            <Label htmlFor="agent_name">Nome do agente</Label>
            <Input id="agent_name" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="agent_interval">Intervalo de coleta (segundos)</Label>
            <Input
              id="agent_interval"
              type="number"
              min={5}
              value={interval}
              onChange={(e) => setIntervalSeconds(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="agent_wan">Interfaces WAN (vírgula)</Label>
            <Input
              id="agent_wan"
              value={wanInterfaces}
              onChange={(e) => setWanInterfaces(e.target.value)}
              placeholder="vazio = detecção automática"
            />
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button onClick={createAgent} disabled={loading}>
            <Plus className="mr-2 h-4 w-4" /> Criar novo agente
          </Button>
          <Button variant="outline" onClick={loadAgents} disabled={loading}>
            <RefreshCw className="mr-2 h-4 w-4" /> Atualizar status
          </Button>
        </div>

        <div className="space-y-3">
          {agents.length === 0 && (
            <p className="text-sm text-muted-foreground">
              Nenhum agente cadastrado. Crie um agente para gerar o pacote de instalação.
            </p>
          )}
          {agents.map((agent) => (
            <div
              key={agent.id}
              className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3"
            >
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <span className="font-medium">{agent.name}</span>
                  {agent.last_seen_at &&
                  Date.now() - new Date(agent.last_seen_at).getTime() < 5 * 60 * 1000 ? (
                    <Badge className="bg-primary/15 text-primary hover:bg-primary/15">Online</Badge>
                  ) : (
                    <Badge variant="secondary">Aguardando dados</Badge>
                  )}
                </div>
                <p className="text-xs text-muted-foreground">
                  {agent.last_seen_at
                    ? `Última coleta: ${new Date(agent.last_seen_at).toLocaleString("pt-BR")}${
                        agent.last_ip ? ` • IP ${agent.last_ip}` : ""
                      }`
                    : "Ainda não enviou dados"}
                </p>
              </div>
              <div className="flex gap-2">
                <Button size="sm" onClick={() => downloadPackage(agent)} disabled={loading}>
                  <Download className="mr-2 h-4 w-4" /> Baixar pacote
                </Button>
                <Button
                  size="sm"
                  variant="destructive"
                  onClick={() => revokeAgent(agent.id)}
                  disabled={loading}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </div>
          ))}
        </div>

        <div className="rounded-lg bg-muted/50 p-3 text-xs text-muted-foreground space-y-1">
          <p className="font-medium text-foreground">Instalação na VPS</p>
          <code className="block">unzip mikrotik-agent-*.zip -d /opt</code>
          <code className="block">cd /opt/mikrotik-agent && sudo bash install.sh</code>
          <p>
            No Mikrotik: <code>/ip service enable www</code> e libere a porta apenas para o IP da
            VPS.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
