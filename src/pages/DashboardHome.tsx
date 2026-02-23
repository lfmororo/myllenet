import { useMemo } from "react";
import { useCustomers } from "@/hooks/useCustomers";
import { useInvoices } from "@/hooks/useInvoices";
import { usePlans } from "@/hooks/usePlans";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Users, AlertTriangle, DollarSign, TrendingUp } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend } from "recharts";

export default function DashboardHome() {
  const { customers } = useCustomers();
  const { allInvoices } = useInvoices();
  const { plans } = usePlans();

  const stats = useMemo(() => {
    const activeCustomers = customers.filter(c => c.ativo).length;
    const inactiveCustomers = customers.filter(c => !c.ativo).length;
    const totalInvoices = allInvoices.length;
    const paidInvoices = allInvoices.filter(i => i.status === "paid");
    const pendingInvoices = allInvoices.filter(i => i.status === "waiting" || i.status === "pending");
    const overdueInvoices = allInvoices.filter(i => {
      if (i.status === "paid" || i.status === "cancelled") return false;
      return new Date(i.vencimento + "T23:59:59") < new Date();
    });

    const totalReceived = paidInvoices.reduce((sum, i) => sum + i.valor_centavos, 0);
    const totalPending = pendingInvoices.reduce((sum, i) => sum + i.valor_centavos, 0);
    const totalOverdue = overdueInvoices.reduce((sum, i) => sum + i.valor_centavos, 0);

    return {
      activeCustomers,
      inactiveCustomers,
      totalInvoices,
      paidCount: paidInvoices.length,
      pendingCount: pendingInvoices.length,
      overdueCount: overdueInvoices.length,
      totalReceived,
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
      { name: "Pagos", value: stats.paidCount, color: "hsl(142, 71%, 45%)" },
      { name: "Pendentes", value: stats.pendingCount, color: "hsl(48, 96%, 53%)" },
      { name: "Vencidos", value: stats.overdueCount, color: "hsl(0, 84%, 60%)" },
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
    const colors = ["hsl(220, 70%, 55%)", "hsl(160, 60%, 45%)", "hsl(280, 60%, 55%)", "hsl(30, 80%, 55%)", "hsl(340, 70%, 55%)"];
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
        <p className="text-muted-foreground">Visão geral do seu sistema de cobranças</p>
      </div>

      {/* KPI Cards */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Clientes Ativos</CardTitle>
            <Users className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.activeCustomers}</div>
            <p className="text-xs text-muted-foreground">{stats.inactiveCustomers} inativos</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Recebido</CardTitle>
            <DollarSign className="h-4 w-4 text-green-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-600">{formatCurrency(stats.totalReceived)}</div>
            <p className="text-xs text-muted-foreground">{stats.paidCount} faturas pagas</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Pendente</CardTitle>
            <TrendingUp className="h-4 w-4 text-yellow-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-yellow-600">{formatCurrency(stats.totalPending)}</div>
            <p className="text-xs text-muted-foreground">{stats.pendingCount} faturas pendentes</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Vencido</CardTitle>
            <AlertTriangle className="h-4 w-4 text-destructive" />
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
                <Bar dataKey="recebido" name="Recebido" fill="hsl(142, 71%, 45%)" radius={[4, 4, 0, 0]} />
                <Bar dataKey="pendente" name="Pendente" fill="hsl(48, 96%, 53%)" radius={[4, 4, 0, 0]} />
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
    </div>
  );
}
