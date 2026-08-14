import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useCustomers } from "@/hooks/useCustomers";
import { useInvoices } from "@/hooks/useInvoices";
import { usePlans } from "@/hooks/usePlans";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Users, AlertTriangle, DollarSign, TrendingUp, Router, Wifi, WifiOff, Loader2, Activity } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend, LineChart, Line } from "recharts";

export default function DashboardHome() {
  const { customers } = useCustomers();
  const { allInvoices } = useInvoices();
  const { plans } = usePlans();

  const [routerStatus, setRouterStatus] = useState<"loading" | "online" | "offline">("loading");
  const [onlineUsers, setOnlineUsers] = useState<number | null>(null);
  const [hwInfo, setHwInfo] = useState<{ cpu: number | null, temp: number | null }>({ cpu: null, temp: null });
  const [wanLogs, setWanLogs] = useState<any[]>([]);
  const [loadingWan, setLoadingWan] = useState(true);

  useEffect(() => {
    const fetchWanLogs = async () => {
      const { data, error } = await supabase
        .from('wan_logs' as any)
        .select('*')
        .order('created_at', { ascending: false })
        .limit(100);
      
      if (!error && data) {
        // Group by created_at and interface
        const grouped: Record<string, any> = {};
        data.forEach((log: any) => {
          const time = new Date(log.created_at).toLocaleTimeString("pt-BR", { hour: '2-digit', minute: '2-digit' });
          if (!grouped[time]) grouped[time] = { time };
          grouped[time][log.interface_name] = (Number(log.rx_bps || 0) + Number(log.tx_bps || 0)) / 1024 / 1024; // Mbps
        });
        setWanLogs(Object.values(grouped).reverse());
      }
      setLoadingWan(false);
    };

    fetchWanLogs();
    
    const channel = supabase
      .channel('wan_updates')
      .on('postgres_changes' as any, { event: 'INSERT', schema: 'public', table: 'wan_logs' }, () => {
        fetchWanLogs();
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, []);

  const wanInterfaces = useMemo(() => {
    const interfaces = new Set<string>();
    wanLogs.forEach(log => {
      Object.keys(log).forEach(key => {
        if (key !== 'time') interfaces.add(key);
      });
    });
    return Array.from(interfaces);
  }, [wanLogs]);

  const colors = ["hsl(var(--primary))", "hsl(var(--accent))", "hsl(var(--success))", "hsl(var(--warning))"];


  useEffect(() => {
    let cancelled = false;
    const check = async () => {
      try {
        const { data, error } = await supabase.functions.invoke("mikrotik-status");
        if (cancelled) return;
        setRouterStatus(!error && data?.online ? "online" : "offline");
        setOnlineUsers(typeof data?.activeUsers === "number" ? data.activeUsers : null);
        setHwInfo({ 
          cpu: typeof data?.cpuLoad === "number" ? data.cpuLoad : null, 
          temp: typeof data?.temperature === "number" ? data.temperature : null 
        });
      } catch {
        if (!cancelled) {
          setRouterStatus("offline");
          setOnlineUsers(null);
        }
      }
    };
    check();
    const timer = setInterval(check, 60000);
    return () => { cancelled = true; clearInterval(timer); };
  }, []);


  const stats = useMemo(() => {
    const activeCustomers = customers.filter(c => c.ativo).length;
    const inactiveCustomers = customers.filter(c => !c.ativo).length;
    
    const now = new Date();
    const currentMonth = now.getMonth();
    const currentYear = now.getFullYear();
    
    // Invoices of current month
    const currentMonthInvoices = allInvoices.filter(i => {
      const d = new Date(i.vencimento + "T12:00:00");
      return d.getMonth() === currentMonth && d.getFullYear() === currentYear;
    });

    // Invoices paid in current month (actually based on payment date would be better, but we use status+vencimento for current month stats if payment_date is not present)
    const currentMonthPaid = currentMonthInvoices.filter(i => i.status === "paid");
    const totalReceivedMonth = currentMonthPaid.reduce((sum, i) => sum + i.valor_centavos, 0);

    const pendingInvoices = currentMonthInvoices.filter(i => i.status === "waiting" || i.status === "pending");
    
    const overdueInvoices = allInvoices.filter(i => {
      if (i.status === "paid" || i.status === "cancelled") return false;
      return new Date(i.vencimento + "T23:59:59") < new Date();
    });

    const totalReceivedAll = allInvoices.filter(i => i.status === "paid").reduce((sum, i) => sum + i.valor_centavos, 0);
    const totalPending = pendingInvoices.reduce((sum, i) => sum + i.valor_centavos, 0);
    const totalOverdue = overdueInvoices.reduce((sum, i) => sum + i.valor_centavos, 0);

    return {
      activeCustomers,
      inactiveCustomers,
      totalInvoices: allInvoices.length,
      paidCountMonth: currentMonthPaid.length,
      pendingCount: pendingInvoices.length,
      overdueCount: overdueInvoices.length,
      totalReceivedMonth,
      totalReceivedAll,
      totalPending,
      totalOverdue,
    };
  }, [customers, allInvoices]);

  // Monthly revenue data (last 6 months)
  const monthlyData = useMemo(() => {
    const months: { name: string; recebido: number; pendente: number }[] = [];
    const now = new Date();
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const year = d.getFullYear();
      const month = d.getMonth();
      const monthName = d.toLocaleDateString("pt-BR", { month: "short" }).replace(".", "");

      let recebido = 0;
      let pendente = 0;
      for (const inv of allInvoices) {
        const invDate = new Date(inv.vencimento + "T12:00:00");
        if (invDate.getFullYear() === year && invDate.getMonth() === month) {
          if (inv.status === "paid") recebido += inv.valor_centavos;
          else if (inv.status !== "cancelled") pendente += inv.valor_centavos;
        }
      }
      months.push({ name: monthName, recebido: recebido / 100, pendente: pendente / 100 });
    }
    return months;
  }, [allInvoices]);

  // Status distribution for pie chart
  const statusData = useMemo(() => {
    return [
      { name: "Pagos", value: stats.paidCountMonth, color: "hsl(var(--success))" },
      { name: "Pendentes", value: stats.pendingCount, color: "hsl(var(--warning))" },
      { name: "Vencidos", value: stats.overdueCount, color: "hsl(var(--destructive))" },
    ].filter(d => d.value > 0);
  }, [stats]);

  // Plans distribution
  const planDistribution = useMemo(() => {
    const planMap = new Map<string, number>();
    for (const c of customers) {
      if (!c.ativo) continue;
      const plan = plans.find(p => p.id === c.plan_id);
      const name = plan?.nome || "Sem plano";
      planMap.set(name, (planMap.get(name) || 0) + 1);
    }
    const colors = ["hsl(var(--primary))", "hsl(var(--accent))", "hsl(var(--success))", "hsl(var(--warning))", "hsl(var(--destructive))"];
    return Array.from(planMap.entries()).map(([name, value], i) => ({
      name,
      value,
      color: colors[i % colors.length],
    }));
  }, [customers, plans]);

  const formatCurrency = (val: number) =>
    (val / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">Dashboard</h2>
        <p className="text-muted-foreground">enviar uma alerta via whatsapp, quando o agente passar ais de 2min sem comunicacao</p>
      </div>

      {/* KPI Cards */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-6">
        {/* Router Status */}
        <Card className={`border-l-4 ${routerStatus === "online" ? "border-l-success" : routerStatus === "offline" ? "border-l-destructive" : "border-l-muted"}`}>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Mikrotik</CardTitle>
            <div className={`rounded-lg p-2 ${routerStatus === "online" ? "bg-success/10" : routerStatus === "offline" ? "bg-destructive/10" : "bg-muted/10"}`}>
              {routerStatus === "loading" ? (
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
              ) : routerStatus === "online" ? (
                <Wifi className="h-4 w-4 text-success" />
              ) : (
                <WifiOff className="h-4 w-4 text-destructive" />
              )}
            </div>
          </CardHeader>
          <CardContent>
            <div className={`text-2xl font-bold ${routerStatus === "online" ? "text-success" : routerStatus === "offline" ? "text-destructive" : "text-muted-foreground"}`}>
              {routerStatus === "loading" ? "Verificando..." : routerStatus === "online" ? "Online" : "Offline"}
            </div>
            <div className="flex gap-2 mt-1">
              {hwInfo.cpu !== null && (
                <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${hwInfo.cpu > 80 ? "bg-destructive/10 text-destructive" : hwInfo.cpu > 50 ? "bg-warning/10 text-warning" : "bg-success/10 text-success"}`}>
                  CPU: {hwInfo.cpu}%
                </span>
              )}
              {hwInfo.temp !== null && (
                <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${hwInfo.temp > 65 ? "bg-destructive/10 text-destructive" : "bg-primary/10 text-primary"}`}>
                  {hwInfo.temp}°C
                </span>
              )}
            </div>
            <p className="text-xs text-muted-foreground mt-1">Monitoramento Mikrotik</p>
          </CardContent>
        </Card>
        {/* PPPoE Online */}
        <Card className="border-l-4 border-l-accent">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Clientes On-line</CardTitle>
            <div className="rounded-lg bg-accent/10 p-2">
              {routerStatus === "loading" ? (
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
              ) : (
                <Router className="h-4 w-4 text-accent" />
              )}
            </div>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {routerStatus === "loading" ? "..." : onlineUsers !== null ? onlineUsers : "—"}
            </div>
            <p className="text-xs text-muted-foreground">
              {onlineUsers !== null ? "Autenticados no PPPoE" : "API REST do Mikrotik não respondeu. Habilite com /ip service enable www e libere a porta no firewall"}
            </p>
          </CardContent>
        </Card>

        <Card className="border-l-4 border-l-primary">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Clientes Ativos</CardTitle>
            <div className="rounded-lg bg-primary/10 p-2"><Users className="h-4 w-4 text-primary" /></div>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.activeCustomers}</div>
            <p className="text-xs text-muted-foreground">{stats.inactiveCustomers} inativos</p>
          </CardContent>
        </Card>
        <Card className="border-l-4 border-l-success">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Recebimentos do Mês</CardTitle>
            <div className="rounded-lg bg-success/10 p-2"><DollarSign className="h-4 w-4 text-success" /></div>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-success">{formatCurrency(stats.totalReceivedMonth)}</div>
            <p className="text-xs text-muted-foreground">{stats.paidCountMonth} faturas pagas este mês</p>
          </CardContent>
        </Card>
        <Card className="border-l-4 border-l-warning">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Pendente</CardTitle>
            <div className="rounded-lg bg-warning/10 p-2"><TrendingUp className="h-4 w-4 text-warning" /></div>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-warning">{formatCurrency(stats.totalPending)}</div>
            <p className="text-xs text-muted-foreground">{stats.pendingCount} faturas pendentes</p>
          </CardContent>
        </Card>
        <Card className="border-l-4 border-l-destructive">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Vencido</CardTitle>
            <div className="rounded-lg bg-destructive/10 p-2"><AlertTriangle className="h-4 w-4 text-destructive" /></div>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-destructive">{formatCurrency(stats.totalOverdue)}</div>
            <p className="text-xs text-muted-foreground">{stats.overdueCount} faturas vencidas</p>
          </CardContent>
        </Card>
      </div>

      {/* Charts */}
      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Faturamento Mensal</CardTitle>
            <CardDescription>Últimos 6 meses</CardDescription>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={monthlyData}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                <XAxis dataKey="name" className="text-xs" />
                <YAxis className="text-xs" tickFormatter={(v) => `R$${v}`} />
                <Tooltip
                  formatter={(value: number) => [`R$ ${value.toFixed(2).replace(".", ",")}`, ""]}
                  contentStyle={{ borderRadius: "8px", border: "1px solid hsl(var(--border))", background: "hsl(var(--card))" }}
                />
                <Bar dataKey="recebido" name="Recebido" fill="hsl(var(--success))" radius={[4, 4, 0, 0]} />
                <Bar dataKey="pendente" name="Pendente" fill="hsl(var(--warning))" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Status das Faturas</CardTitle>
            <CardDescription>Distribuição atual</CardDescription>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <PieChart>
                <Pie data={statusData} cx="50%" cy="50%" innerRadius={60} outerRadius={100} paddingAngle={4} dataKey="value" label={({ name, value }) => `${name}: ${value}`}>
                  {statusData.map((entry, index) => (
                    <Cell key={index} fill={entry.color} />
                  ))}
                </Pie>
                <Legend />
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      {/* Plan distribution */}
      {planDistribution.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Clientes por Plano</CardTitle>
            <CardDescription>Distribuição dos clientes ativos</CardDescription>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={250}>
              <BarChart data={planDistribution} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                <XAxis type="number" />
                <YAxis dataKey="name" type="category" width={120} className="text-xs" />
                <Tooltip contentStyle={{ borderRadius: "8px", border: "1px solid hsl(var(--border))", background: "hsl(var(--card))" }} />
                <Bar dataKey="value" name="Clientes" radius={[0, 4, 4, 0]}>
                  {planDistribution.map((entry, index) => (
                    <Cell key={index} fill={entry.color} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}
      {/* WAN Traffic Chart */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle className="text-base">Consumo WAN em Tempo Real</CardTitle>
            <CardDescription>Tráfego total (Download + Upload) por interface</CardDescription>
          </div>
          <Activity className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          {loadingWan ? (
            <div className="flex h-[300px] items-center justify-center">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : wanLogs.length > 0 ? (
            <ResponsiveContainer width="100%" height={300}>
              <LineChart data={wanLogs}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" vertical={false} />
                <XAxis 
                  dataKey="time" 
                  className="text-xs" 
                  minTickGap={30}
                />
                <YAxis 
                  className="text-xs" 
                  tickFormatter={(v) => `${v.toFixed(1)}M`}
                  label={{ value: 'Mbps', angle: -90, position: 'insideLeft', style: { textAnchor: 'middle', fontSize: '10px' } }}
                />
                <Tooltip
                  formatter={(value: number) => [`${value.toFixed(2)} Mbps`, ""]}
                  contentStyle={{ borderRadius: "8px", border: "1px solid hsl(var(--border))", background: "hsl(var(--card))" }}
                />
                <Legend />
                {wanInterfaces.map((iface, index) => (
                  <Line
                    key={iface}
                    type="monotone"
                    dataKey={iface}
                    name={iface}
                    stroke={colors[index % colors.length]}
                    strokeWidth={2}
                    dot={false}
                    activeDot={{ r: 4 }}
                  />
                ))}
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex h-[300px] items-center justify-center text-muted-foreground">
              Nenhum dado de WAN encontrado. Certifique-se de que o Mikrotik está online e as interfaces WAN estão identificadas.
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
