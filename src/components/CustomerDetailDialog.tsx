import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Separator } from "@/components/ui/separator";
import { Input } from "@/components/ui/input";
import { useEffect, useState, useCallback, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Loader2, ExternalLink, Copy, CheckCircle2, Clock, Import, CalendarCheck, X, XCircle, Activity, History, Bell, BellOff, AlertTriangle, ShieldCheck, ShieldAlert, Lock, Unlock } from "lucide-react";
import { toast } from "sonner";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Tooltip as UITooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import type { Customer } from "@/hooks/useCustomers";
import type { Invoice } from "@/hooks/useInvoices";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, AreaChart, Area } from 'recharts';

interface MikrotikSession {
  name: string;
  address?: string;
  uptime?: string;
  rx_bytes?: number;
  tx_bytes?: number;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  customer: Customer | null;
  onCustomerUpdated?: () => void;
  mikrotikData?: MikrotikSession | null;
}

export default function CustomerDetailDialog({ open, onOpenChange, customer, onCustomerUpdated, mikrotikData }: Props) {
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [loading, setLoading] = useState(false);
  const [checkingEfi, setCheckingEfi] = useState(false);
  const [pagoAte, setPagoAte] = useState("");
  const [savingPagoAte, setSavingPagoAte] = useState(false);
  const [logs, setLogs] = useState<any[]>([]);
  const [blockHistory, setBlockHistory] = useState<any[]>([]);
  const [loadingLogs, setLoadingLogs] = useState(false);
  const [loadingBlockHistory, setLoadingBlockHistory] = useState(false);
  const [hasMoreLogs, setHasMoreLogs] = useState(true);
  const [unlocking, setUnlocking] = useState(false);

  const fetchLogs = useCallback(async (isLoadMore = false) => {
    if (!customer) return;
    if (isLoadMore && !hasMoreLogs) return;
    
    setLoadingLogs(true);
    const from = isLoadMore ? logs.length : 0;
    const to = from + 49;

    const { data, error } = await supabase
      .from("pppoe_logs")
      .select("*")
      .eq("customer_id", customer.id)
      .order("logged_at", { ascending: false })
      .range(from, to);
    
    if (!error && data) {
      if (isLoadMore) {
        setLogs(prev => [...prev, ...data]);
      } else {
        setLogs(data);
      }
      setHasMoreLogs(data.length === 50);
    }
    setLoadingLogs(false);
  }, [customer, logs.length, hasMoreLogs]);
  
  const fetchBlockHistory = useCallback(async () => {
    if (!customer) return;
    setLoadingBlockHistory(true);
    const { data, error } = await supabase
      .from("block_history" as any)
      .select("*")
      .eq("customer_id", customer.id)
      .order("created_at", { ascending: false })
      .limit(10);
    
    if (!error && data) {
      setBlockHistory(data);
    }
    setLoadingBlockHistory(false);
  }, [customer]);

  const fetchInvoices = useCallback(() => {
    if (!customer) return;
    setLoading(true);
    supabase
      .from("invoices")
      .select("*")
      .eq("customer_id", customer.id)
      .order("vencimento", { ascending: false })
      .then(({ data, error }) => {
        if (error) {
          toast.error("Erro ao carregar faturas");
        } else {
          setInvoices(data as Invoice[]);
        }
        setLoading(false);
      });
  }, [customer]);

  useEffect(() => {
    if (open && customer) {
      fetchInvoices();
      fetchLogs();
      fetchBlockHistory();
      setPagoAte(customer.pago_ate || "");

      // Escutar mudanças em tempo real na tabela de logs para este cliente
      const channel = supabase
        .channel(`pppoe_logs_${customer.id}`)
        .on(
          'postgres_changes',
          {
            event: 'INSERT',
            schema: 'public',
            table: 'pppoe_logs',
            filter: `customer_id=eq.${customer.id}`
          },
          (payload) => {
            setLogs((prev) => [payload.new, ...prev].slice(0, 100));
          }
        )
        .subscribe();

      return () => {
        supabase.removeChannel(channel);
      };
    } else {
      setInvoices([]);
      setPagoAte("");
      setLogs([]);
      setBlockHistory([]);
    }
  }, [open, customer, fetchInvoices, fetchLogs, fetchBlockHistory]);

  const handleSavePagoAte = async () => {
    if (!customer) return;
    setSavingPagoAte(true);
    const { error } = await supabase
      .from("customers")
      .update({ pago_ate: pagoAte || null } as any)
      .eq("id", customer.id);
    if (error) {
      toast.error("Erro ao salvar");
    } else {
      toast.success("Pagamento antecipado atualizado!");
      onCustomerUpdated?.();
    }
    setSavingPagoAte(false);
  };

  const updateCustomer = async (updates: Partial<Customer>) => {
    if (!customer) return;
    const { error } = await supabase
      .from("customers")
      .update(updates as any)
      .eq("id", customer.id);
    if (error) {
      toast.error("Erro ao atualizar");
    } else {
      toast.success("Dados atualizados!");
      onCustomerUpdated?.();
    }
  };

  const handleManualUnlock = async () => {
    if (!customer) return;
    setUnlocking(true);
    try {
      const { error } = await supabase
        .from("customers")
        .update({ block_status: "active" } as any)
        .eq("id", customer.id);
      
      if (error) throw error;

      // Log the manual unlock
      const { data: { user } } = await supabase.auth.getUser();
      await supabase.from("block_history" as any).insert({
        customer_id: customer.id,
        old_status: customer.block_status,
        new_status: "active",
        reason: "Desbloqueio manual pelo administrador",
        changed_by: user?.id
      } as any);

      toast.success("Cliente desbloqueado manualmente!");
      fetchBlockHistory();
      onCustomerUpdated?.();
      
      // Request Mikrotik sync
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData?.session?.access_token;
      if (token) {
        const projectId = import.meta.env.VITE_SUPABASE_PROJECT_ID;
        fetch(`https://${projectId}.supabase.co/functions/v1/mikrotik-sync`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` }
        }).catch(e => console.error("Sync error:", e));
      }

    } catch (err) {
      console.error(err);
      toast.error("Erro ao desbloquear cliente");
    }
    setUnlocking(false);
  };

  const handleClearPagoAte = async () => {
    if (!customer) return;
    setSavingPagoAte(true);
    await updateCustomer({ pago_ate: null });
    setPagoAte("");
    setSavingPagoAte(false);
  };

  const handleCheckEfi = async () => {
    if (!customer) return;
    setCheckingEfi(true);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData?.session?.access_token;
      if (!token) { toast.error("Sessão expirada"); setCheckingEfi(false); return; }

      const projectId = import.meta.env.VITE_SUPABASE_PROJECT_ID;
      const response = await fetch(
        `https://${projectId}.supabase.co/functions/v1/efi-boleto/check-customer?customer_id=${customer.id}`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
            apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
          },
        }
      );

      const result = await response.json();
      if (!response.ok) {
        toast.error(result.error || "Erro ao consultar EFI");
      } else {
        toast.success(`Encontrados: ${result.total_found} | Importados: ${result.imported} | Já existentes: ${result.skipped}`);
        if (result.imported > 0) {
          fetchInvoices();
        }
      }
    } catch (err) {
      console.error(err);
      toast.error("Erro ao consultar cobranças na EFI");
    }
    setCheckingEfi(false);
  };

  if (!customer) return null;

  const formatCPF = (cpf: string) => {
    const d = cpf.replace(/\D/g, "");
    if (d.length !== 11) return cpf;
    return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
  };

  const formatCurrency = (cents: number) =>
    (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

  const statusConfig: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
    pending: { label: "Pendente", variant: "outline" },
    waiting: { label: "Aguardando", variant: "secondary" },
    paid: { label: "Pago", variant: "default" },
    cancelled: { label: "Cancelado", variant: "destructive" },
    expired: { label: "Vencido", variant: "destructive" },
  };

  const totalPending = invoices.filter(i => ["pending", "waiting"].includes(i.status)).reduce((s, i) => s + i.valor_centavos, 0);
  const totalPaid = invoices.filter(i => i.status === "paid").reduce((s, i) => s + i.valor_centavos, 0);

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    toast.success("Copiado!");
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {customer.nome}
            <div className="flex gap-2">
              <Badge variant={customer.ativo ? "default" : "secondary"}>
                {customer.ativo ? "Ativo" : "Inativo"}
              </Badge>
              {customer.block_status === 'blocked' && (
                <Badge variant="destructive" className="animate-pulse">
                  BLOQUEADO
                </Badge>
              )}
            </div>
            {customer.block_status === 'blocked' && (
              <Button 
                size="sm" 
                variant="outline" 
                className="h-7 text-xs border-green-500 text-green-600 hover:bg-green-50 ml-auto"
                onClick={handleManualUnlock}
                disabled={unlocking}
              >
                {unlocking ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <Unlock className="h-3 w-3 mr-1" />}
                Desbloquear Manual
              </Button>
            )}
          </DialogTitle>
        </DialogHeader>

        {/* Connection & Customer Info */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-4">
            <div className="rounded-lg border bg-muted/30 p-4 space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold flex items-center gap-2">
                  <div className={`h-2 w-2 rounded-full ${mikrotikData ? "bg-green-500 animate-pulse" : "bg-gray-300"}`} />
                  Status Mikrotik
                </h3>
                {mikrotikData && (
                  <Badge variant="outline" className="text-[10px] uppercase font-bold text-green-600 border-green-200">
                    Conectado
                  </Badge>
                )}
              </div>
              
              {mikrotikData ? (
                <div className="space-y-2 text-xs">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Tempo Online:</span>
                    <span className="font-mono font-medium">{mikrotikData.uptime || "—"}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Endereço IP:</span>
                    <span className="font-mono font-medium">{mikrotikData.address || "—"}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Serviço:</span>
                    <span className="font-medium">PPPoE</span>
                  </div>
                </div>
              ) : (
                <div className="py-2 text-xs text-muted-foreground italic">
                  O cliente não possui uma sessão PPPoE ativa no momento.
                </div>
              )}
            </div>

            {/* Consumo de Banda (Chart) */}
            <div className="rounded-lg border bg-muted/30 p-4 space-y-3">
              <h3 className="text-sm font-semibold flex items-center gap-2">
                <Activity className="h-4 w-4 text-primary" />
                Consumo de Banda (24h)
              </h3>
              
              <div className="h-[150px] w-full mt-2">
                {logs.length > 5 ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={[...logs].reverse().slice(-24)}>
                      <defs>
                        <linearGradient id="colorRx" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#0d9488" stopOpacity={0.3}/>
                          <stop offset="95%" stopColor="#0d9488" stopOpacity={0}/>
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                      <XAxis 
                        dataKey="logged_at" 
                        hide 
                      />
                      <YAxis 
                        tick={{fontSize: 10}} 
                        tickFormatter={(val) => `${(val / (1024*1024)).toFixed(0)}MB`}
                      />
                      <Tooltip 
                        labelFormatter={(label: any) => new Date(label).toLocaleString('pt-BR')}
                        formatter={(val: number) => [`${(val / (1024*1024)).toFixed(2)} MB`, 'Download']}
                      />
                      <Area type="monotone" dataKey="rx_bytes" stroke="#0d9488" fillOpacity={1} fill="url(#colorRx)" />
                    </AreaChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="h-full flex items-center justify-center text-xs text-muted-foreground italic">
                    Dados insuficientes para gerar gráfico.
                  </div>
                )}
              </div>
            </div>

            {/* Histórico de Bloqueios */}
            <div className="rounded-lg border bg-muted/30 p-4 space-y-3 border-orange-100">
              <h3 className="text-sm font-semibold flex items-center gap-2">
                <ShieldAlert className="h-4 w-4 text-orange-500" />
                Histórico de Bloqueio/Desbloqueio
              </h3>
              <div className="space-y-2 max-h-[150px] overflow-y-auto pr-2 custom-scrollbar">
                {blockHistory.length > 0 ? (
                  blockHistory.map((h, idx) => (
                    <div key={idx} className="flex flex-col text-[11px] border-b border-muted py-2 last:border-0">
                      <div className="flex items-center justify-between mb-1">
                        <span className="font-medium text-muted-foreground">
                          {new Date(h.created_at).toLocaleString('pt-BR')}
                        </span>
                        <Badge variant={h.new_status === 'active' ? 'outline' : 'destructive'} className="text-[9px] h-4 px-1 leading-none">
                          {h.new_status === 'active' ? 'LIBERADO' : 'BLOQUEADO'}
                        </Badge>
                      </div>
                      <span className="text-[10px] text-muted-foreground leading-tight italic">
                        "{h.reason}"
                      </span>
                    </div>
                  ))
                ) : loadingBlockHistory ? (
                  <div className="flex justify-center py-4"><Loader2 className="h-4 w-4 animate-spin" /></div>
                ) : (
                  <div className="text-xs text-muted-foreground italic py-2">Nenhuma alteração de status registrada.</div>
                )}
              </div>
            </div>

            {/* Histórico de Conexões */}
            <div className="rounded-lg border bg-muted/30 p-4 space-y-3">
              <h3 className="text-sm font-semibold flex items-center gap-2">
                <History className="h-4 w-4 text-primary" />
                Histórico de Conexões
              </h3>
              <div className="space-y-2 max-h-[300px] overflow-y-auto pr-2 custom-scrollbar">
                {logs.length > 0 ? (
                  <>
                    {logs.filter(l => l.event_type === 'connected' || l.event_type === 'disconnected' || (l.event_type === 'stats' && l.uptime)).map((log, idx) => (
                      <div key={idx} className="flex items-center justify-between text-[11px] border-b border-muted py-1.5 last:border-0">
                        <div className="flex flex-col">
                          <span className="font-medium text-muted-foreground">
                            {new Date(log.logged_at).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                          </span>
                          <span className="text-[10px] text-green-600">Online: {log.uptime}</span>
                        </div>
                        <Badge variant="outline" className="text-[9px] h-4 px-1">
                          {log.ip_address}
                        </Badge>
                      </div>
                    ))}
                    {hasMoreLogs && (
                      <Button 
                        variant="ghost" 
                        size="sm" 
                        className="w-full text-[10px] h-8 mt-2" 
                        onClick={() => fetchLogs(true)}
                        disabled={loadingLogs}
                      >
                        {loadingLogs ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : null}
                        Carregar mais histórico
                      </Button>
                    )}
                  </>
                ) : loadingLogs ? (
                  <div className="flex justify-center py-4"><Loader2 className="h-4 w-4 animate-spin" /></div>
                ) : (
                  <div className="text-xs text-muted-foreground italic py-2">Sem histórico disponível.</div>
                )}
              </div>
            </div>


            <div className="grid grid-cols-1 gap-2 text-sm">
              <div><span className="text-muted-foreground">CPF:</span> <span className="font-mono">{formatCPF(customer.cpf)}</span></div>
              <div><span className="text-muted-foreground">E-mail:</span> {customer.email}</div>
              <div><span className="text-muted-foreground">Telefone:</span> {customer.telefone || "—"}</div>
              <div><span className="text-muted-foreground">PPPoE:</span> <span className="font-mono">{customer.usuario_pppoe}</span></div>
            </div>
          </div>

          <div className="space-y-3 text-sm">
            {customer.rua && (
              <div className="rounded-lg border p-3 bg-muted/10">
                <span className="text-xs font-semibold text-muted-foreground uppercase block mb-1">Endereço</span>
                <p className="leading-relaxed">
                  {[customer.rua, customer.numero, customer.complemento, customer.bairro, customer.cidade, customer.estado, customer.cep].filter(Boolean).join(", ")}
                </p>
              </div>
            )}
            <div className="rounded-lg border p-3 bg-muted/10">
              <span className="text-xs font-semibold text-muted-foreground uppercase block mb-1">Dados Supabase</span>
              <div className="space-y-1 text-xs">
                <div className="flex justify-between"><span className="text-muted-foreground">ID Interno:</span> <span className="font-mono text-[10px]">{customer.id}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Criado em:</span> <span>{new Date(customer.created_at).toLocaleDateString("pt-BR")}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Vencimento:</span> <span>Dia {customer.dia_vencimento}</span></div>
              </div>
            </div>
          </div>
        </div>

        <Separator />

        {/* Pago Até (Pagamento Antecipado) */}
        <div className="rounded-lg border bg-muted/30 p-3 space-y-2">
          <div className="flex items-center gap-2 text-sm font-medium">
            <CalendarCheck className="h-4 w-4 text-primary" />
            Pagamento Antecipado (PIX direto)
          </div>
          <p className="text-xs text-muted-foreground">
            Informe até que mês o cliente já pagou. Meses cobertos não gerarão alerta de "sem boleto".
          </p>
          <div className="flex items-center gap-2">
            <Input
              type="month"
              value={pagoAte ? pagoAte.slice(0, 7) : ""}
              onChange={(e) => {
                const val = e.target.value;
                if (val) {
                  // Set to last day of the selected month
                  const [y, m] = val.split("-").map(Number);
                  const lastDay = new Date(y, m, 0).getDate();
                  setPagoAte(`${val}-${String(lastDay).padStart(2, "0")}`);
                } else {
                  setPagoAte("");
                }
              }}
              className="w-48"
            />
            <Button size="sm" onClick={handleSavePagoAte} disabled={savingPagoAte}>
              {savingPagoAte ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Salvar"}
            </Button>
            {customer.pago_ate && (
              <Button size="sm" variant="ghost" onClick={handleClearPagoAte} disabled={savingPagoAte}>
                <X className="h-3.5 w-3.5 mr-1" /> Limpar
              </Button>
            )}
          </div>
          {customer.pago_ate && (
            <p className="text-xs text-primary">
              ✅ Pago até: {new Date(customer.pago_ate + "T12:00:00").toLocaleDateString("pt-BR", { month: "long", year: "numeric" })}
            </p>
          )}
        </div>

        <Separator />

        {/* Alertas de Monitoramento */}
        <div className="rounded-lg border bg-muted/30 p-4 space-y-4">
          <div className="flex items-center gap-2 text-sm font-medium">
            <Bell className="h-4 w-4 text-primary" />
            Configurações de Alertas
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="flex items-center justify-between space-x-2">
              <div className="space-y-0.5">
                <Label className="text-sm">Quedas de Conexão</Label>
                <p className="text-[10px] text-muted-foreground">Alerta quando desconectar por 5min.</p>
              </div>
              <Switch
                checked={customer.alert_on_disconnect}
                onCheckedChange={(val) => updateCustomer({ alert_on_disconnect: val })}
              />
            </div>

            <div className="flex items-center justify-between space-x-2">
              <div className="space-y-0.5">
                <Label className="text-sm">Quedas Frequentes</Label>
                <p className="text-[10px] text-muted-foreground">Alerta se reconectar 3x em 1h.</p>
              </div>
              <Switch
                checked={customer.alert_on_frequent_drops}
                onCheckedChange={(val) => updateCustomer({ alert_on_frequent_drops: val })}
              />
            </div>

            <div className="flex items-center justify-between space-x-2">
              <div className="space-y-0.5">
                <Label className="text-sm">Consumo Anormal</Label>
                <p className="text-[10px] text-muted-foreground">Alerta tráfego {'>'} 500MB em 15min.</p>
              </div>
              <Switch
                checked={customer.alert_on_abnormal_usage}
                onCheckedChange={(val) => updateCustomer({ alert_on_abnormal_usage: val })}
              />
            </div>

            <div className="flex items-center justify-between space-x-2">
              <div className="space-y-0.5">
                <Label className="text-sm text-primary font-bold">Bloqueio Automático</Label>
                <p className="text-[10px] text-muted-foreground font-medium">Alerta WhatsApp ao ser bloqueado ou liberado.</p>
              </div>
              <Switch
                checked={customer.alert_on_block_change}
                onCheckedChange={(val) => updateCustomer({ alert_on_block_change: val })}
              />
            </div>
          </div>
        </div>

        <Separator />

        {/* Configurações de Alertas */}
        <div className="rounded-lg border bg-muted/30 p-4 space-y-4">
          <h3 className="text-sm font-semibold flex items-center gap-2">
            <Bell className="h-4 w-4 text-primary" />
            Alertas de Monitoramento (WhatsApp)
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <Label htmlFor="alert-disconnect" className="text-xs font-medium cursor-pointer">Desconexão (&gt;5min)</Label>
                <Switch 
                  id="alert-disconnect"
                  checked={customer.alert_on_disconnect} 
                  onCheckedChange={(val) => updateCustomer({ alert_on_disconnect: val })}
                />
              </div>
              <p className="text-[10px] text-muted-foreground leading-tight">
                Avisa quando o cliente fica off-line por mais de 5 minutos.
              </p>
            </div>

            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <Label htmlFor="alert-drops" className="text-xs font-medium cursor-pointer">Quedas Frequentes</Label>
                <Switch 
                  id="alert-drops"
                  checked={customer.alert_on_frequent_drops} 
                  onCheckedChange={(val) => updateCustomer({ alert_on_frequent_drops: val })}
                />
              </div>
              <p className="text-[10px] text-muted-foreground leading-tight">
                Avisa se houver 3 ou mais reconexões em 1 hora (instabilidade).
              </p>
            </div>

            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <Label htmlFor="alert-usage" className="text-xs font-medium cursor-pointer">Consumo Anormal</Label>
                <Switch 
                  id="alert-usage"
                  checked={customer.alert_on_abnormal_usage} 
                  onCheckedChange={(val) => updateCustomer({ alert_on_abnormal_usage: val })}
                />
              </div>
              <p className="text-[10px] text-muted-foreground leading-tight">
                Avisa se o consumo exceder 500MB em 15 minutos (uso extremo).
              </p>
            </div>
          </div>
        </div>

        <Separator />

        {/* Summary */}
        <div className="flex gap-4 text-sm">
          <div className="flex items-center gap-1.5">
            <Clock className="h-4 w-4 text-muted-foreground" />
            <span className="text-muted-foreground">Em aberto:</span>
            <span className="font-semibold">{formatCurrency(totalPending)}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <CheckCircle2 className="h-4 w-4 text-green-500" />
            <span className="text-muted-foreground">Pago:</span>
            <span className="font-semibold">{formatCurrency(totalPaid)}</span>
          </div>
          <div className="text-muted-foreground">
            {invoices.length} fatura{invoices.length !== 1 ? "s" : ""}
          </div>
          <div className="ml-auto">
            <Button variant="outline" size="sm" disabled={checkingEfi} onClick={handleCheckEfi}>
              {checkingEfi ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Import className="mr-1.5 h-3.5 w-3.5" />}
              Consultar EFI
            </Button>
          </div>
        </div>

        {/* Invoices Table */}
        {loading ? (
          <div className="flex justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
          </div>
        ) : invoices.length === 0 ? (
          <p className="text-center text-muted-foreground py-8">Nenhuma cobrança encontrada.</p>
        ) : (
          <div className="rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/50">
                  <TableHead>Descrição</TableHead>
                  <TableHead>Vencimento</TableHead>
                  <TableHead>Valor</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {invoices.map((inv) => {
                  const st = statusConfig[inv.status] || { label: inv.status, variant: "outline" as const };
                  return (
                    <TableRow key={inv.id}>
                      <TableCell className="text-sm">{inv.descricao}</TableCell>
                      <TableCell className="text-sm">{new Date(inv.vencimento + "T12:00:00").toLocaleDateString("pt-BR")}</TableCell>
                      <TableCell className="text-sm font-mono">{formatCurrency(inv.valor_centavos)}</TableCell>
                      <TableCell>
                        <Badge variant={st.variant} className="text-xs">{st.label}</Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-1 flex-wrap">
                          {inv.efi_link && (
                            <Button variant="outline" size="sm" className="h-7 text-xs px-2" asChild>
                              <a href={inv.efi_link} target="_blank" rel="noopener noreferrer" title="Abrir boleto">
                                <ExternalLink className="h-3 w-3 mr-1" /> Boleto
                              </a>
                            </Button>
                          )}
                          {inv.efi_pix_copiacola && (
                            <Button variant="outline" size="sm" className="h-7 text-xs px-2" onClick={() => copyToClipboard(inv.efi_pix_copiacola!)} title="Copiar PIX Copia e Cola">
                              <Copy className="h-3 w-3 mr-1" /> PIX
                            </Button>
                          )}
                          {inv.efi_barcode && (
                            <Button variant="outline" size="sm" className="h-7 text-xs px-2" onClick={() => copyToClipboard(inv.efi_barcode!)} title="Copiar código de barras">
                              <Copy className="h-3 w-3 mr-1" /> Barras
                            </Button>
                          )}
                          {inv.status !== "paid" && inv.status !== "cancelled" && (
                            <>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7 text-green-600 hover:text-green-700"
                                title="Marcar como pago"
                                onClick={async () => {
                                  const { error } = await supabase.from("invoices").update({ status: "paid", paid_at: new Date().toISOString() }).eq("id", inv.id);
                                  if (error) { toast.error("Erro ao marcar como pago"); return; }
                                  toast.success("Fatura marcada como paga"); fetchInvoices(); onCustomerUpdated?.();
                                  try {
                                    const { data: sd } = await supabase.auth.getSession();
                                    const tk = sd?.session?.access_token;
                                    if (tk) {
                                      const pid = import.meta.env.VITE_SUPABASE_PROJECT_ID;
                                      // Cancel on EFI if has charge_id
                                      if (inv.efi_charge_id) {
                                        try {
                                          const cr = await fetch(`https://${pid}.supabase.co/functions/v1/efi-boleto/cancel`, {
                                            method: "POST", headers: { Authorization: `Bearer ${tk}`, "Content-Type": "application/json", apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY },
                                            body: JSON.stringify({ charge_id: inv.efi_charge_id }),
                                          });
                                          if (cr.ok) toast.success("Cobrança cancelada na EFI");
                                        } catch (e) { console.warn("EFI cancel failed:", e); }
                                      }
                                      // WhatsApp notification
                                      const r = await fetch(`https://${pid}.supabase.co/functions/v1/whatsapp-send/notify-invoice`, {
                                        method: "POST", headers: { Authorization: `Bearer ${tk}`, "Content-Type": "application/json", apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY },
                                        body: JSON.stringify({ invoice_id: inv.id, type: "pagamento_confirmado" }),
                                      });
                                      if (r.ok) toast.success("Confirmação enviada ao cliente!");
                                    }
                                  } catch (e) { console.warn("Notify failed:", e); }
                                }}
                              >
                                <CheckCircle2 className="h-3.5 w-3.5" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7 text-destructive hover:text-destructive"
                                title="Cancelar fatura"
                                onClick={async () => {
                                  const { error } = await supabase.from("invoices").update({ status: "cancelled" }).eq("id", inv.id);
                                  if (error) { toast.error("Erro ao cancelar"); } else { toast.success("Fatura cancelada"); fetchInvoices(); onCustomerUpdated?.(); }
                                }}
                              >
                                <XCircle className="h-3.5 w-3.5" />
                              </Button>
                            </>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
