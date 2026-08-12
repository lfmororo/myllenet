import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Download, Loader2, RefreshCw, Router, Wifi, WifiOff, FileCode, BookOpen, Activity, History, ArrowUpCircle, ArrowDownCircle, Info, Calendar, Clock, Network, Filter, BarChart3 } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useCustomers } from "@/hooks/useCustomers";
import { usePlans } from "@/hooks/usePlans";
import { useMikrotikLogs } from "@/hooks/useMikrotikLogs";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend, BarChart, Bar } from "recharts";
import { format, subDays, startOfDay, endOfDay, isWithinInterval } from "date-fns";
import { ptBR } from "date-fns/locale";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export default function MikrotikPage() {
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [status, setStatus] = useState<any>(null);
  const [selectedEvent, setSelectedEvent] = useState<any>(null);
  const { customers } = useCustomers();
  const { plans } = usePlans();
  const { wanLogs, wanHistory, loading: loadingWan } = useMikrotikLogs();
  const [syncing, setSyncing] = useState(false);
  const [live, setLive] = useState(true);
  const [dateRange, setDateRange] = useState("today"); // today, 7d, 30d
  const [selectedWan, setSelectedWan] = useState("all");
  const [drillDownData, setDrillDownData] = useState<any>(null);
  const [speedThreshold, setSpeedThreshold] = useState("10");
  const [alertInterval, setAlertInterval] = useState("30");
  const [updatingSettings, setUpdatingSettings] = useState(false);
  const [historyPage, setHistoryPage] = useState(1);
  const historyItemsPerPage = 10;





  const checkStatus = async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("mikrotik-status");
      if (error) throw error;
      setStatus(data);
      if (!silent) {
        if (data?.online) toast.success(data.message || "Mikrotik online");
        else toast.error(data?.message || "Mikrotik offline");
      }
    } catch (err: any) {
      setStatus({ online: false, message: err?.message || "Erro ao verificar Mikrotik" });
      if (!silent) toast.error("Erro ao verificar Mikrotik");
    } finally {
      if (!silent) setLoading(false);
    }
  };

  const syncWithMikrotik = async () => {
    setSyncing(true);
    try {
      const { data, error } = await supabase.functions.invoke("mikrotik-sync");
      if (error) throw error;
      toast.success("Sincronização com Mikrotik concluída com sucesso!");
    } catch (err: any) {
      console.error("Erro na sincronização:", err);
      toast.error("Erro ao sincronizar com Mikrotik");
    } finally {
      setSyncing(false);
    }
  };

  useEffect(() => {
    checkStatus();
    fetchAlertSettings();
  }, []);

  const fetchAlertSettings = async () => {
    try {
      const { data, error } = await supabase
        .from('settings')
        .select('key, value')
        .in('key', ['mikrotik_speed_threshold_mbps', 'mikrotik_alert_interval_minutes']);
      
      if (error) throw error;
      
      data?.forEach(item => {
        if (item.key === 'mikrotik_speed_threshold_mbps') setSpeedThreshold(item.value || "10");
        if (item.key === 'mikrotik_alert_interval_minutes') setAlertInterval(item.value || "30");
      });
    } catch (err) {
      console.error("Erro ao carregar configurações de alerta:", err);
    }
  };

  const saveAlertSettings = async () => {
    setUpdatingSettings(true);
    try {
      const { error: err1 } = await supabase
        .from('settings')
        .upsert({ key: 'mikrotik_speed_threshold_mbps', value: speedThreshold }, { onConflict: 'key' });
      
      const { error: err2 } = await supabase
        .from('settings')
        .upsert({ key: 'mikrotik_alert_interval_minutes', value: alertInterval }, { onConflict: 'key' });

      if (err1 || err2) throw new Error("Falha ao salvar");
      
      toast.success("Configurações de alerta atualizadas!");
    } catch (err) {
      toast.error("Erro ao salvar configurações");
    } finally {
      setUpdatingSettings(false);
    }
  };


  // Amostragem em tempo real: cada chamada coleta os contadores das WANs e grava em wan_logs
  useEffect(() => {
    if (!live) return;
    const id = setInterval(() => checkStatus(true), 10000);
    return () => clearInterval(id);
  }, [live]);


  const downloadMikrotikScript = () => {
    setExporting(true);
    try {
      if (customers.length === 0) {
        toast.error("Nenhum cliente para exportar");
        return;
      }
      let script = "# Mikrotik Import Script - Myllenet\n";
      script += "# Generated on: " + new Date().toLocaleString() + "\n\n";
      script += "/ip pool\n:if ([:len [/ip pool find name=pppoe-pool]] = 0) do={ add name=pppoe-pool ranges=10.0.0.10-10.0.3.254 }\n\n";
      script += "/ip dns\nset servers=8.8.8.8,8.8.4.4 allow-remote-requests=yes\n\n";
      script += "/ppp profile\n:if ([:len [/ppp profile find name=myllenet-default]] = 0) do={ add name=myllenet-default local-address=10.0.0.1 remote-address=pppoe-pool dns-server=8.8.8.8,8.8.4.4 }\n\n";
      script += "/interface pppoe-server server\n:if ([:len [/interface pppoe-server server find service-name=pppoe-myllenet]] = 0) do={ add authentication=pap,chap,mschap1,mschap2 disabled=no interface=ether2 service-name=pppoe-myllenet one-session-per-host=yes }\n\n";
      plans.forEach(plan => {
        const speed = plan.nome.match(/\d+/)?.[0] || "10";
        script += `:if ([:len [/ppp profile find name="${plan.nome}"]] = 0) do={ add name="${plan.nome}" local-address=10.0.0.1 remote-address=pppoe-pool rate-limit="${speed}M/${speed}M" dns-server=8.8.8.8,8.8.4.4 }\n`;
      });
      script += "\n/ppp secret\n";
      customers.forEach(customer => {
        if (customer.ativo && customer.usuario_pppoe) {
          const planName = plans.find(p => p.id === customer.plan_id)?.nome || "myllenet-default";
          script += `:if ([:len [/ppp secret find name="${customer.usuario_pppoe}"]] = 0) do={ add name="${customer.usuario_pppoe}" password="${customer.senha_pppoe}" profile="${planName}" service=pppoe comment="${customer.nome} - CPF: ${customer.cpf}" }\n`;
        }
      });
      const blob = new Blob([script], { type: "text/plain" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `importar_mikrotik_${new Date().toISOString().slice(0, 10)}.rsc`;
      link.click();
      URL.revokeObjectURL(url);
      toast.success("Script Mikrotik (.rsc) gerado!");
    } catch (err) {
      toast.error("Erro ao gerar script");
    } finally {
      setExporting(false);
    }
  };

  // Filter logic for historical logs
  const filteredLogs = wanLogs.filter(log => {
    // Filter by WAN
    if (selectedWan !== "all") {
      const keys = Object.keys(log).filter(k => k !== 'time' && k !== 'fullDate');
      const hasWan = keys.some(k => k.startsWith(selectedWan));
      if (!hasWan) return false;
    }

    // Filter by Date Range
    const logDate = log.fullDate;
    if (!logDate) return true;
    
    const now = new Date();
    if (dateRange === "today") {
      return logDate >= startOfDay(now) && logDate <= endOfDay(now);
    } else if (dateRange === "7d") {
      return logDate >= startOfDay(subDays(now, 7));
    } else if (dateRange === "30d") {
      return logDate >= startOfDay(subDays(now, 30));
    }
    
    return true;
  });


  // Calculate hourly aggregation for speedtest results
  const hourlyData = filteredLogs.reduce((acc: any[], log: any) => {
    const hour = log.time.split(':')[0] + ':00';
    let existing = acc.find(a => a.hour === hour);
    if (!existing) {
      existing = { hour };
      acc.push(existing);
    }
    
    // Sum values for the hour
    Object.keys(log).forEach(key => {
      if (key !== 'time' && key !== 'fullDate') {
        existing[key] = (existing[key] || 0) + log[key];
        existing[`${key}_count`] = (existing[`${key}_count`] || 0) + 1;
      }
    });
    return acc;
  }, []).map(item => {
    const result = { hour: item.hour };
    Object.keys(item).forEach(key => {
      if (key !== 'hour' && !key.endsWith('_count')) {
        // Only average if we have counts
        const count = item[`${key}_count`];
        result[key] = count > 0 ? item[key] / count : 0;
      }
    });
    return result;
  });

  const allEntries = wanLogs.flatMap(log => {
    const interfaces = Object.keys(log).filter(k => k !== 'time' && k !== 'fullDate' && k.endsWith('↓'));
    return interfaces.map(ifaceKey => {
      const name = ifaceKey.replace(' ↓', '');
      const download = log[ifaceKey];
      const upload = log[`${name} ↑`];
      return {
        time: log.time,
        fullDate: log.fullDate,
        interface: name,
        download,
        upload
      };
    });
  }).sort((a, b) => (b.fullDate?.getTime() || 0) - (a.fullDate?.getTime() || 0));

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Mikrotik - Gestão</h2>
          <p className="text-muted-foreground">O Mikrotik realiza testes de velocidade através do comando <code>tool fetch</code> e monitoramento das WANs periodicamente, gerando gráficos de desempenho por hora e alertas de velocidade configuráveis. Se a API REST não responder, verifique se o serviço WWW está habilitado no roteador e se a porta está liberada no firewall (<code>/ip firewall filter add chain=input action=accept protocol=tcp dst-port=80,443,8728 comment="Allow Mikrotik API"</code>).</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={downloadMikrotikScript} disabled={exporting}>
            {exporting ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Download className="h-4 w-4 mr-2" />}
            Baixar Script (.rsc)
          </Button>
          <Button variant="secondary" onClick={syncWithMikrotik} disabled={syncing || loading}>
            {syncing ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <RefreshCw className="h-4 w-4 mr-2" />}
            Sincronizar Mikrotik
          </Button>
          <Button variant={live ? "default" : "outline"} onClick={() => setLive(!live)}>
            <Activity className={`h-4 w-4 mr-2 ${live ? "animate-pulse" : ""}`} />
            {live ? "Tempo real: ON" : "Tempo real: OFF"}
          </Button>
          <Button 
            onClick={() => {
              checkStatus();
              supabase.functions.invoke("mikrotik-speedtest").then(({ data, error }) => {
                if (error) toast.error("Erro ao realizar speedtest");
                else toast.success("Speedtest realizado e relatório enviado!");
              });
            }} 
            disabled={loading || syncing}
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Activity className="h-4 w-4 mr-2" />}
            Realizar Speedtest & Report
          </Button>
        </div>
      </div>

      <div className="grid gap-6 md:grid-cols-5">
        <Card className={`border-l-4 ${status?.online ? "border-l-success" : "border-l-destructive"}`}>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Status do IP Externo</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-2">
              <span className={`text-2xl font-bold ${status?.online ? "text-success" : "text-destructive"}`}>
                {loading ? "Verificando..." : status?.online ? "Conectado" : "Desconectado"}
              </span>
            </div>
            <p className="text-xs text-muted-foreground mt-2">{status?.message}</p>
          </CardContent>
        </Card>
        <Card className="border-l-4 border-l-primary">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Roteador</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-2">
              <Router className="h-5 w-5 text-primary" />
              <div className="flex flex-col">
                <span className="text-lg font-bold truncate max-w-[120px]">{status?.identity || status?.host || "—"}</span>
                <span className="text-[10px] text-muted-foreground">Uptime: {status?.uptime || "—"}</span>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="border-l-4 border-l-accent">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Hardware</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-1">
              <div className="flex items-center justify-between text-xs">
                <span>CPU:</span>
                <span className={`font-bold ${status?.cpuLoad > 80 ? "text-destructive" : status?.cpuLoad > 50 ? "text-warning" : "text-success"}`}>
                  {status?.cpuLoad !== undefined && status?.cpuLoad !== null ? `${status.cpuLoad}%` : "—"}
                </span>
              </div>
              <div className="flex items-center justify-between text-xs">
                <span>RAM:</span>
                <span className="text-muted-foreground">
                  {status?.freeMemory ? `${(status.freeMemory / 1024 / 1024).toFixed(0)}MB livres` : "—"}
                </span>
              </div>
              {status?.temperature !== undefined && status?.temperature !== null && (
                <div className="flex items-center justify-between text-xs">
                  <span>Temp:</span>
                  <span className={`font-bold ${status.temperature > 65 ? "text-destructive" : status.temperature > 50 ? "text-warning" : "text-primary"}`}>
                    {status.temperature}°C
                  </span>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
        <Card className="border-l-4 border-l-success">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Usuários PPPoE</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-col gap-1">
              <span className="text-2xl font-bold">{status?.activeUsers ?? "—"}</span>
              <p className="text-[10px] text-muted-foreground">{customers.filter(c => c.ativo).length} cadastrados</p>
            </div>
          </CardContent>
        </Card>
        <Card className="border-l-4 border-l-warning">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">WANs Ativas</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-2">
              <Activity className="h-5 w-5 text-warning" />
              <span className="text-2xl font-bold">
                {loading ? "..." : `${(status?.wans ?? []).filter((w: any) => w.running).length}/${(status?.wans ?? []).length || 0}`}
              </span>
            </div>
            <div className="mt-2 space-y-1">
              {(status?.wans ?? []).map((w: any) => (
                <div key={w.name} className="flex items-center justify-between text-xs">
                  <span className="flex items-center gap-1">
                    {w.running ? <Wifi className="h-3 w-3 text-success" /> : <WifiOff className="h-3 w-3 text-destructive" />}
                    {w.name}
                  </span>
                  <span className="flex items-center gap-2 text-muted-foreground">
                    <span className="flex items-center gap-0.5 text-primary">
                      <ArrowDownCircle className="h-3 w-3" />
                      {Math.min(Math.max((w.rx_bps ?? 0) / 1_000_000, 0), 1000).toFixed(1)} Mbps
                    </span>
                    <span className="flex items-center gap-0.5 text-accent">
                      <ArrowUpCircle className="h-3 w-3" />
                      {Math.min(Math.max((w.tx_bps ?? 0) / 1_000_000, 0), 1000).toFixed(1)} Mbps
                    </span>
                  </span>
                </div>
              ))}
              {(!status?.wans || status.wans.length === 0) && (
                <p className="text-xs text-muted-foreground">Nenhuma interface WAN detectada</p>
              )}
            </div>

          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-2">
          <div>
            <CardTitle className="text-base">Monitoramento de Tráfego WAN</CardTitle>
            <CardDescription>
              Linha cheia = Download (↓) · linha tracejada = Upload (↑) · valores em Mbps — {live ? "atualizando a cada 10s" : "atualização pausada"}
            </CardDescription>


          </div>
          <Activity className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          {loadingWan ? (
            <div className="flex h-[300px] items-center justify-center">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : wanLogs.length > 0 ? (
            <ResponsiveContainer width="100%" height={320}>
              <LineChart data={wanLogs} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" vertical={false} />
                <XAxis dataKey="time" className="text-xs" />
                <YAxis
                  className="text-xs"
                  width={64}
                  tickFormatter={(v) => `${v.toFixed(1)} Mbps`}
                />
                <Tooltip
                  contentStyle={{
                    background: "hsl(var(--popover))",
                    border: "1px solid hsl(var(--border))",
                    borderRadius: "0.5rem",
                    fontSize: "0.75rem",
                  }}
                  labelFormatter={(l) => `Horário: ${l}`}
                  formatter={(v: any, name: any) => {
                    const num = Number(v);
                    const label = String(name).endsWith("↑") ? "Upload" : "Download";
                    const iface = String(name).replace(/ [↑↓]$/, "");
                    const value = `${num.toFixed(2)} Mbps`;
                    return [value, `${iface} · ${label}`];
                  }}
                />
                <Legend
                  verticalAlign="bottom"
                  height={56}
                  content={({ payload }) => {
                    const entries = (payload || []);
                    const groups = entries.reduce((acc: Record<string, any[]>, entry: any) => {
                      const iface = String(entry.value).replace(/ [↑↓]$/, "");
                      if (iface === 'time' || iface === 'fullDate') return acc;
                      if (!acc[iface]) acc[iface] = [];
                      acc[iface].push(entry);
                      return acc;
                    }, {});
                    return (
                      <div className="flex flex-wrap items-start justify-center gap-x-6 gap-y-2 pt-3 text-xs">
                        {Object.entries(groups).map(([iface, items]) => {
                          const down = items.find((e: any) => String(e.value).endsWith("↓"));
                          const up = items.find((e: any) => String(e.value).endsWith("↑"));
                          const lastDown = Number(wanLogs[wanLogs.length - 1]?.[down?.value] ?? 0);
                          const lastUp = Number(wanLogs[wanLogs.length - 1]?.[up?.value] ?? 0);
                          return (
                            <div key={iface} className="flex flex-col gap-1">
                              <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-tight">{iface}</span>
                              <div className="flex items-center gap-3">
                                {down && (
                                  <span className="flex items-center gap-1.5 text-muted-foreground">
                                    <svg width="14" height="6" aria-hidden="true">
                                      <line x1="0" y1="3" x2="14" y2="3" stroke={down.color} strokeWidth="2.5" />
                                    </svg>
                                    <span className="text-foreground">↓ {lastDown >= 1 ? `${lastDown.toFixed(2)}` : `${(lastDown * 1000).toFixed(0)}`}</span>
                                    <span className="text-[10px]">{lastDown >= 1 ? 'Mb/s' : 'Kb/s'}</span>
                                  </span>
                                )}
                                {up && (
                                  <span className="flex items-center gap-1.5 text-muted-foreground">
                                    <svg width="14" height="6" aria-hidden="true">
                                      <line x1="0" y1="3" x2="14" y2="3" stroke={up.color} strokeWidth="1.5" strokeDasharray="4 3" />
                                    </svg>
                                    <span className="text-foreground">↑ {lastUp >= 1 ? `${lastUp.toFixed(2)}` : `${(lastUp * 1000).toFixed(0)}`}</span>
                                    <span className="text-[10px]">{lastUp >= 1 ? 'Mb/s' : 'Kb/s'}</span>
                                  </span>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    );
                  }}
                />
                {(() => {
                  const allKeys = Array.from(new Set(wanLogs.flatMap(log => Object.keys(log).filter(k => k !== 'time' && k !== 'fullDate'))));
                  const interfaces = Array.from(new Set(allKeys.map(k => k.replace(/ [↑↓]$/, ''))));
                  const families = [
                    { download: '#14b8a6', upload: '#2dd4bf' },   // teal
                    { download: '#8b5cf6', upload: '#a78bfa' },     // violet
                    { download: '#f59e0b', upload: '#fbbf24' },     // amber
                    { download: '#f43f5e', upload: '#fb7185' },     // rose
                    { download: '#10b981', upload: '#34d399' },     // emerald
                    { download: '#3b82f6', upload: '#60a5fa' },     // blue
                  ];
                  const colorMap = new Map<string, { download: string; upload: string }>();
                  interfaces.sort().forEach((iface, i) => colorMap.set(iface, families[i % families.length]));
                  
                  return allKeys.sort().map((key) => {
                    const isUpload = key.endsWith('↑');
                    const iface = key.replace(/ [↑↓]$/, '');
                    const family = colorMap.get(iface) || families[0];
                    const color = isUpload ? family.upload : family.download;
                    return (
                      <Line
                        key={key}
                        type="monotone"
                        dataKey={key}
                        name={key}
                        stroke={color}
                        strokeWidth={isUpload ? 1.5 : 2.5}
                        strokeDasharray={isUpload ? "4 3" : undefined}
                        dot={false}
                        activeDot={{ r: 3, strokeWidth: 0, fill: color }}
                        connectNulls
                      />
                    );
                  });
                })()}

              </LineChart>
            </ResponsiveContainer>

          ) : (

            <p className="text-center py-12 text-muted-foreground">Nenhum dado de WAN encontrado.</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-2">
          <div>
            <CardTitle className="text-base font-semibold flex items-center gap-2">
              <BarChart3 className="h-5 w-5 text-primary" />
              Relatório de Desempenho por Hora
            </CardTitle>
            <CardDescription>
              Média de velocidade consumida por WAN em intervalos de 1 hora
            </CardDescription>
          </div>
          <div className="flex gap-2">
            <Select value={selectedWan} onValueChange={setSelectedWan}>
              <SelectTrigger className="w-[180px] h-8">
                <Filter className="h-3 w-3 mr-2" />
                <SelectValue placeholder="Todas Interfaces" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todas Interfaces</SelectItem>
                {status?.wans?.map((w: any) => (
                  <SelectItem key={w.name} value={w.name}>{w.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={dateRange} onValueChange={setDateRange}>
              <SelectTrigger className="w-[150px] h-8">
                <Calendar className="h-3 w-3 mr-2" />
                <SelectValue placeholder="Período" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="today">Hoje</SelectItem>
                <SelectItem value="7d">Últimos 7 dias</SelectItem>
                <SelectItem value="30d">Últimos 30 dias</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent>
          {loadingWan ? (
            <div className="flex h-[300px] items-center justify-center">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : hourlyData.length > 0 ? (
            <ResponsiveContainer width="100%" height={320}>
              <BarChart data={hourlyData} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" vertical={false} />
                <XAxis dataKey="hour" className="text-xs" />
                <YAxis
                  className="text-xs"
                  width={64}
                  tickFormatter={(v) => `${v.toFixed(1)} Mb/s`}
                />
                <Tooltip
                  contentStyle={{
                    background: "hsl(var(--popover))",
                    border: "1px solid hsl(var(--border))",
                    borderRadius: "0.5rem",
                    fontSize: "0.75rem",
                  }}
                />
                <Legend />
                {(() => {
                  const keys = Object.keys(hourlyData[0] || {}).filter(k => k !== 'hour' && k.endsWith('↓'));
                  const colors = ['#14b8a6', '#8b5cf6', '#f59e0b', '#f43f5e', '#10b981', '#3b82f6'];
                  return keys.map((key, i) => (
                    <Bar 
                      key={key} 
                      dataKey={key} 
                      name={key.replace(' ↓', '')} 
                      fill={colors[i % colors.length]} 
                      radius={[4, 4, 0, 0]}
                      onClick={(data: any) => {
                        const payload = data.payload || data;
                        const wanName = key.replace(' ↓', '');
                        setDrillDownData({
                          hour: payload.hour,
                          wan: wanName,
                          download: payload[key],
                          upload: payload[`${wanName} ↑`]
                        });
                      }}

                      cursor="pointer"
                    />
                  ));
                })()}
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <p className="text-center py-12 text-muted-foreground">Dados insuficientes para gerar o gráfico horário.</p>
          )}

          {drillDownData && (
            <Dialog open={!!drillDownData} onOpenChange={() => setDrillDownData(null)}>
              <DialogContent className="sm:max-w-[425px]">
                <DialogHeader>
                  <DialogTitle className="flex items-center gap-2">
                    <Activity className="h-5 w-5 text-primary" />
                    Detalhes do Tráfego
                  </DialogTitle>
                  <DialogDescription>
                    Métricas detalhadas para a interface <strong>{drillDownData.wan}</strong> às <strong>{drillDownData.hour}</strong>
                  </DialogDescription>
                </DialogHeader>
                <div className="grid gap-4 py-4">
                  <div className="flex items-center justify-between p-4 bg-muted/50 rounded-lg">
                    <div className="flex items-center gap-3">
                      <div className="p-2 bg-primary/10 rounded-full">
                        <ArrowDownCircle className="h-5 w-5 text-primary" />
                      </div>
                      <div>
                        <p className="text-sm font-medium text-muted-foreground">Download Médio</p>
                        <p className="text-xl font-bold">{drillDownData.download?.toFixed(2)} Mbps</p>
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center justify-between p-4 bg-muted/50 rounded-lg">
                    <div className="flex items-center gap-3">
                      <div className="p-2 bg-accent/10 rounded-full">
                        <ArrowUpCircle className="h-5 w-5 text-accent" />
                      </div>
                      <div>
                        <p className="text-sm font-medium text-muted-foreground">Upload Médio</p>
                        <p className="text-xl font-bold">{drillDownData.upload?.toFixed(2)} Mbps</p>
                      </div>
                    </div>
                  </div>
                  <div className="p-4 border rounded-lg space-y-2">
                    <h4 className="text-sm font-semibold flex items-center gap-2">
                      <Info className="h-4 w-4 text-muted-foreground" />
                      Informações Adicionais
                    </h4>
                    <p className="text-xs text-muted-foreground">
                      Estes valores representam a média aritmética de todas as amostras coletadas entre {drillDownData.hour} e {parseInt(drillDownData.hour) + 1}:00.
                    </p>
                  </div>
                </div>
              </DialogContent>
            </Dialog>
          )}

        </CardContent>
      </Card>


      <div className="grid gap-6 md:grid-cols-2">
        <Card className="md:col-span-2">
          <CardHeader className="flex flex-row items-center justify-between">
            <div>
              <CardTitle className="text-base font-semibold flex items-center gap-2">
                <History className="h-4 w-4 text-primary" />
                Histórico de Speedtests Realizados
              </CardTitle>
              <CardDescription>
                Registros das medições de tráfego efetuadas nas interfaces WAN.
              </CardDescription>
            </div>
            {wanLogs.length > 0 && (
              <div className="flex items-center gap-2">
                <Button 
                  variant="outline" 
                  size="sm" 
                  onClick={() => setHistoryPage(p => Math.max(1, p - 1))}
                  disabled={historyPage === 1}
                >
                  Anterior
                </Button>
                <span className="text-xs font-medium">Página {historyPage}</span>
                <Button 
                  variant="outline" 
                  size="sm" 
                  onClick={() => setHistoryPage(p => p + 1)}
                  disabled={historyPage * historyItemsPerPage >= (wanLogs.reduce((acc, log) => acc + Object.keys(log).filter(k => k.endsWith(' ↓')).length, 0))}
                >
                  Próxima
                </Button>
              </div>
            )}
          </CardHeader>
          <CardContent>
            <div className="rounded-md border overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/50">
                    <TableHead className="w-[180px]">Data/Hora</TableHead>
                    <TableHead>Interface</TableHead>
                    <TableHead className="text-right">Download</TableHead>
                    <TableHead className="text-right">Upload</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {loadingWan ? (
                    <TableRow>
                      <TableCell colSpan={4} className="text-center py-8">
                        <Loader2 className="h-6 w-6 animate-spin mx-auto text-muted-foreground" />
                      </TableCell>
                    </TableRow>
                  ) : wanLogs.length > 0 ? (
                    (() => {
                      const allEntries: any[] = [];
                      [...wanLogs].reverse().forEach((log) => {
                        const interfaces = Object.keys(log).filter(k => k.endsWith(' ↓')).map(k => k.replace(' ↓', ''));
                        interfaces.forEach(iface => {
                          allEntries.push({
                            date: log.fullDate,
                            iface,
                            download: log[`${iface} ↓`],
                            upload: log[`${iface} ↑`]
                          });
                        });
                      });
                      
                      const startIndex = (historyPage - 1) * historyItemsPerPage;
                      const pageEntries = allEntries.slice(startIndex, startIndex + historyItemsPerPage);
                      
                      if (pageEntries.length === 0 && historyPage > 1) {
                        setHistoryPage(1);
                        return null;
                      }

                      return pageEntries.map((entry, idx) => (
                        <TableRow key={`${idx}-${entry.iface}`}>
                          <TableCell className="font-medium text-xs">
                            {format(entry.date, "dd/MM HH:mm:ss", { locale: ptBR })}
                          </TableCell>
                          <TableCell>
                            <Badge variant="outline" className="text-[10px]">{entry.iface}</Badge>
                          </TableCell>
                          <TableCell className="text-right text-success font-semibold">
                            {entry.download?.toFixed(2)} Mbps
                          </TableCell>
                          <TableCell className="text-right text-accent">
                            {entry.upload?.toFixed(2)} Mbps
                          </TableCell>
                        </TableRow>
                      ));
                    })()
                  ) : (
                    <TableRow>
                      <TableCell colSpan={4} className="text-center py-8 text-muted-foreground italic">
                        Nenhum registro encontrado.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>


        <Card>
          <CardHeader>
            <CardTitle className="text-base font-semibold flex items-center gap-2">
              <History className="h-4 w-4 text-primary" />
              Histórico de Oscilações WAN
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4 max-h-[400px] overflow-y-auto">
              {wanHistory.length > 0 ? wanHistory.map((e, i) => (
                <Dialog key={i}>
                  <DialogTrigger asChild>
                    <div 
                      className="flex items-start gap-3 p-3 rounded-lg border bg-muted/30 cursor-pointer hover:bg-muted/50 transition-colors"
                      onClick={() => setSelectedEvent(e)}
                    >
                      {e.status === 'up' ? <ArrowUpCircle className="h-5 w-5 text-success" /> : <ArrowDownCircle className="h-5 w-5 text-destructive" />}
                      <div className="flex-1">
                        <p className="text-sm font-medium">{e.interface_name}</p>
                        <p className="text-xs text-muted-foreground">{e.status === 'up' ? "ONLINE" : "OFFLINE"} - {format(new Date(e.created_at), "dd/MM HH:mm:ss", { locale: ptBR })}</p>
                      </div>
                      <Info className="h-4 w-4 text-muted-foreground mt-1" />
                    </div>
                  </DialogTrigger>
                  <DialogContent>
                    <DialogHeader>
                      <DialogTitle className="flex items-center gap-2">
                        {e.status === 'up' ? <ArrowUpCircle className="h-5 w-5 text-success" /> : <ArrowDownCircle className="h-5 w-5 text-destructive" />}
                        Detalhes da Oscilação
                      </DialogTitle>
                      <DialogDescription>
                        Informações técnicas sobre o evento na interface {e.interface_name}
                      </DialogDescription>
                    </DialogHeader>
                    <div className="grid gap-4 py-4">
                      <div className="grid grid-cols-4 items-center gap-4 border-b pb-2">
                        <span className="text-sm font-medium flex items-center gap-2 col-span-1">
                          <Network className="h-4 w-4 text-muted-foreground" /> Interface:
                        </span>
                        <span className="text-sm col-span-3">{e.interface_name}</span>
                      </div>
                      <div className="grid grid-cols-4 items-center gap-4 border-b pb-2">
                        <span className="text-sm font-medium flex items-center gap-2 col-span-1">
                          <Activity className="h-4 w-4 text-muted-foreground" /> Status:
                        </span>
                        <Badge variant="outline" className={`w-fit col-span-3 ${e.status === 'up' ? "bg-success text-success-foreground border-transparent" : "bg-destructive text-destructive-foreground border-transparent"}`}>
                          {e.status === 'up' ? "ONLINE / UP" : "OFFLINE / DOWN"}
                        </Badge>
                      </div>
                      <div className="grid grid-cols-4 items-center gap-4 border-b pb-2">
                        <span className="text-sm font-medium flex items-center gap-2 col-span-1">
                          <Calendar className="h-4 w-4 text-muted-foreground" /> Data:
                        </span>
                        <span className="text-sm col-span-3">
                          {format(new Date(e.created_at), "dd 'de' MMMM 'de' yyyy", { locale: ptBR })}
                        </span>
                      </div>
                      <div className="grid grid-cols-4 items-center gap-4 border-b pb-2">
                        <span className="text-sm font-medium flex items-center gap-2 col-span-1">
                          <Clock className="h-4 w-4 text-muted-foreground" /> Horário:
                        </span>
                        <span className="text-sm col-span-3">
                          {format(new Date(e.created_at), "HH:mm:ss", { locale: ptBR })}
                        </span>
                      </div>
                      <div className="space-y-2">
                        <span className="text-sm font-medium flex items-center gap-2">
                          <Info className="h-4 w-4 text-muted-foreground" /> Motivo / Contexto:
                        </span>
                        <div className="text-sm bg-muted p-3 rounded-md italic">
                          {e.reason || (e.status === 'up' ? "Interface estabelecida e trafegando dados." : "Queda de link detectada ou interface desativada no roteador.")}
                        </div>
                      </div>
                      {status?.host && (
                        <div className="grid grid-cols-4 items-center gap-4 border-t pt-2 mt-2">
                          <span className="text-sm font-medium flex items-center gap-2 col-span-1">
                            <Router className="h-4 w-4 text-muted-foreground" /> Roteador:
                          </span>
                          <span className="text-xs text-muted-foreground col-span-3">{status.host}:{status.restPort || '80'}</span>
                        </div>
                      )}
                    </div>
                  </DialogContent>
                </Dialog>
              )) : <p className="text-sm text-center italic py-4">Nenhum evento registrado.</p>}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base font-semibold flex items-center gap-2">
              <Activity className="h-4 w-4 text-primary" />
              Configuração de Alertas de Velocidade
            </CardTitle>
            <CardDescription>
              Receba avisos no WhatsApp quando a média de download ficar abaixo do limite.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-xs font-medium text-muted-foreground uppercase">Limite (Mbps)</label>
                <Input 
                  type="number" 
                  value={speedThreshold} 
                  onChange={(e) => setSpeedThreshold(e.target.value)}
                  placeholder="Ex: 10"
                />
              </div>
              <div className="space-y-2">
                <label className="text-xs font-medium text-muted-foreground uppercase">Período (Minutos)</label>
                <Input 
                  type="number" 
                  value={alertInterval} 
                  onChange={(e) => setAlertInterval(e.target.value)}
                  placeholder="Ex: 30"
                />
              </div>
            </div>
            <Button className="w-full" onClick={saveAlertSettings} disabled={updatingSettings}>
              {updatingSettings ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <RefreshCw className="h-4 w-4 mr-2" />}
              Salvar Configurações
            </Button>
            <p className="text-[10px] text-muted-foreground italic text-center">
              Os alertas possuem um intervalo de segurança de 4 horas entre envios para evitar spam.
            </p>
          </CardContent>
        </Card>

        <Card className="p-8 space-y-4">
          <div className="flex items-center gap-3">
            <div className="bg-primary/10 p-3 rounded-lg">
              <FileCode className="h-6 w-6 text-primary" />
            </div>
            <div>
              <h3 className="text-lg font-semibold">Script de Importação</h3>
            </div>
          </div>
          <Button className="w-full" onClick={downloadMikrotikScript} disabled={exporting}>
            {exporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4 mr-2" />}
            Baixar Script (.rsc)
          </Button>
        </Card>

      </div>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <BookOpen className="h-5 w-5 text-primary" />
            Otimização da Integração com Mikrotik
          </CardTitle>
          <CardDescription>NAO ESTA CONSEGUINDO MONITORAR AS WANS no mikrotik</CardDescription>
        </CardHeader>
        <CardContent className="prose prose-sm dark:prose-invert max-w-none">
          <div className="space-y-4 text-sm leading-relaxed">
            <h4 className="text-base font-semibold border-b pb-1">Funcionalidade Solicitada</h4>
            <p>a comunicacao com o mikrotik esta muito falha</p>
            <ul className="list-disc pl-5 space-y-1">
              <li><strong>Monitoramento de WANs:</strong> Implementar um monitoramento confiável e em tempo real do status das conexões WAN.</li>
              <li><strong>Carregamento de Informações:</strong> Reduzir significativamente o tempo de carregamento de informações provenientes dos dispositivos Mikrotik.</li>
            </ul>

            <h4 className="text-base font-semibold border-b pb-1">Requisitos Técnicos</h4>
            <ul className="list-disc pl-5 space-y-1">
              <li>Analisar a comunicação atual entre o sistema e os dispositivos Mikrotik (protocolos, métodos de consulta).</li>
              <li>Identificar gargalos e pontos de falha no processo de monitoramento de WANs.</li>
              <li>Otimizar as consultas e o processamento de dados para agilizar o carregamento de informações.</li>
              <li>Garantir a robustez da integração para evitar falhas recorrentes.</li>
            </ul>

            <h4 className="text-base font-semibold border-b pb-1">Passos Necessários</h4>
            <ol className="list-decimal pl-5 space-y-2">
              <li><strong>Diagnóstico:</strong> Investigar a fundo as causas das falhas atuais no monitoramento de WANs e no carregamento de informações.</li>
              <li><strong>Refatoração da Integração:</strong> Reescrever ou otimizar o código responsável pela comunicação com o Mikrotik.</li>
              <li><strong>Implementação do Monitoramento de WANs:</strong> Desenvolver ou aprimorar o módulo de monitoramento, possivelmente utilizando SNMP, API ou outros métodos adequados.</li>
              <li><strong>Otimização de Performance:</strong> Aplicar técnicas de otimização para acelerar o acesso e a exibição dos dados.</li>
              <li><strong>Testes:</strong> Realizar testes exaustivos para validar a estabilidade, o desempenho e a correção das funcionalidades implementadas.</li>
            </ol>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
