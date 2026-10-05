import { useEffect, useMemo, useState } from "react";
import { api } from "@/integrations/api/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Pagination, PaginationContent, PaginationItem, PaginationLink, PaginationNext, PaginationPrevious } from "@/components/ui/pagination";
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { BarChart3, Download, FileSpreadsheet, FileText, Loader2, Printer, Search } from "lucide-react";
import { exportCSV, exportPDF, exportXLSX, ReportColumn, ReportRow } from "@/lib/reportExports";
import { toast } from "sonner";

type ReportKey = "overdue" | "blocked" | "customers" | "financial" | "bandwidth" | "missing_invoice" | "platforms";
type Customer = any;
type Invoice = any;
type Plan = any;
type Block = any;
type BandwidthUsage = {
  customer_id: string;
  download_bytes: number;
  upload_bytes: number;
  total_bytes: number;
  active_days: number;
  peak_bytes: number;
};

const REPORTS: { key: ReportKey; label: string; description: string }[] = [
  { key: "overdue", label: "Clientes em atraso", description: "Inadimplência por faixa, plano e localização" },
  { key: "blocked", label: "Clientes bloqueados", description: "Bloqueios, motivos e valores em aberto" },
  { key: "customers", label: "Relatório de clientes", description: "Base cadastral e situação dos assinantes" },
  { key: "financial", label: "Financeiro por período", description: "Evolução de valores faturados e recebidos" },
  { key: "bandwidth", label: "Consumo de banda", description: "Ranking de download e upload por cliente" },
  { key: "missing_invoice", label: "Clientes sem fatura", description: "Clientes sem cobrança na competência" },
  { key: "platforms", label: "Cobranças por plataforma", description: "Participação, taxas e valores líquidos" },
];

const money = (cents: number) => (Number(cents || 0) / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const dateBR = (value?: string | null) => value ? new Date(value.includes("T") ? value : `${value}T00:00:00`).toLocaleDateString("pt-BR") : "—";
const bytes = (value: number) => {
  if (!value) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const index = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1);
  return `${(value / 1024 ** index).toLocaleString("pt-BR", { maximumFractionDigits: 2 })} ${units[index]}`;
};
const daysBetween = (from: string, to = new Date()) => Math.max(0, Math.floor((to.getTime() - new Date(from.includes("T") ? from : `${from}T00:00:00`).getTime()) / 86400000));
const statusLabel = (status: string) => ({ paid: "Paga", pending: "Pendente", overdue: "Vencida", cancelled: "Cancelada", active: "Ativo", blocked: "Bloqueado" }[status] || status);

export default function ReportsPage() {
  const { user, isAdmin, reportPermissions } = useAuth();
  const allowed = useMemo(() => REPORTS.filter((report) => isAdmin || reportPermissions.includes(report.key)), [isAdmin, reportPermissions]);
  const [report, setReport] = useState<ReportKey>(allowed[0]?.key || "overdue");
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [blocks, setBlocks] = useState<Block[]>([]);
  const [bandwidthUsage, setBandwidthUsage] = useState<BandwidthUsage[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const today = new Date();
  const monthStart = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-01`;
  const [from, setFrom] = useState(monthStart);
  const [to, setTo] = useState(today.toISOString().slice(0, 10));
  const [plan, setPlan] = useState("all");
  const [status, setStatus] = useState("all");
  const [location, setLocation] = useState("all");
  const [seller, setSeller] = useState("all");
  const [payment, setPayment] = useState("all");
  const [pop, setPop] = useState("all");
  const [grouping, setGrouping] = useState("monthly");
  const [topN, setTopN] = useState("20");
  const [page, setPage] = useState(1);
  const pageSize = 20;

  useEffect(() => {
    if (!allowed.some((item) => item.key === report) && allowed[0]) setReport(allowed[0].key);
  }, [allowed, report]);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      const startIso = `${from}T00:00:00Z`;
      const endIso = `${to}T23:59:59Z`;
      const [c, i, p, b, usage] = await Promise.all([
        api.from("customers").select("*"),
        api.from("invoices").select("*"),
        api.from("plans").select("*"),
        api.from("block_history").select("*").gte("created_at", startIso).lte("created_at", endIso),
        report === "bandwidth"
          ? api.rpc("get_bandwidth_report", { _from: startIso, _to: endIso })
          : Promise.resolve({ data: [], error: null }),
      ]);
      const error = c.error || i.error || p.error || b.error || usage.error;
      if (error) toast.error("Não foi possível carregar os dados do relatório");
      setCustomers(c.data || []); setInvoices(i.data || []); setPlans(p.data || []); setBlocks(b.data || []); setBandwidthUsage(usage.data || []);
      setLoading(false);
    };
    if (allowed.length) load(); else setLoading(false);
  }, [from, to, report, allowed.length]);

  const planMap = useMemo(() => new Map(plans.map((item) => [item.id, item])), [plans]);
  const customerMap = useMemo(() => new Map(customers.map((item) => [item.id, item])), [customers]);
  const locations = useMemo(() => [...new Set(customers.map((c) => [c.bairro, c.cidade].filter(Boolean).join(" / ")).filter(Boolean))].sort(), [customers]);
  const sellers = useMemo(() => [...new Set(customers.map((c) => c.seller_name).filter(Boolean))].sort(), [customers]);
  const pops = useMemo(() => [...new Set(customers.map((c) => c.pop_name).filter(Boolean))].sort(), [customers]);

  const output = useMemo((): { columns: ReportColumn[]; rows: ReportRow[]; totals: { label: string; value: string }[]; chart?: any[] } => {
    const inPeriod = (value: string) => value.slice(0, 10) >= from && value.slice(0, 10) <= to;
    const matchesCustomer = (c: Customer) => (plan === "all" || c.plan_id === plan) && (location === "all" || [c.bairro, c.cidade].filter(Boolean).join(" / ") === location) && (seller === "all" || c.seller_name === seller) && (payment === "all" || c.preferred_payment_method === payment) && (pop === "all" || c.pop_name === pop);
    if (report === "overdue") {
      const map = new Map<string, any>();
      invoices.filter((i) => ["pending", "overdue"].includes(i.status) && i.vencimento < today.toISOString().slice(0, 10)).forEach((i) => {
        const c = customerMap.get(i.customer_id); if (!c || !matchesCustomer(c)) return;
        const old = map.get(c.id) || { c, count: 0, value: 0, oldest: i.vencimento };
        old.count++; old.value += i.valor_centavos; if (i.vencimento < old.oldest) old.oldest = i.vencimento; map.set(c.id, old);
      });
      const rows = [...map.values()].map(({ c, count, value, oldest }) => ({ cliente: c.nome, contato: c.telefone || c.email, plano: planMap.get(c.plan_id)?.nome || "Não informado", valor: money(value), faturas: count, dias: daysBetween(oldest), vencimento: dateBR(oldest) })).filter((r) => status === "all" || (status === "1-15" ? r.dias <= 15 : status === "16-30" ? r.dias >= 16 && r.dias <= 30 : status === "31-60" ? r.dias >= 31 && r.dias <= 60 : r.dias > 60)).sort((a,b) => b.dias-a.dias);
      return { columns: [{key:"cliente",label:"Cliente"},{key:"contato",label:"Contato"},{key:"plano",label:"Plano"},{key:"valor",label:"Valor devido"},{key:"faturas",label:"Faturas"},{key:"dias",label:"Dias em atraso"},{key:"vencimento",label:"Vencimento mais antigo"}], rows, totals: [{label:"Clientes",value:String(rows.length)},{label:"Total em aberto",value:money([...map.values()].reduce((s,r)=>s+r.value,0))}] };
    }
    if (report === "blocked") {
      const latest = new Map<string, Block>(); blocks.filter((b) => b.new_status === "blocked").forEach((b) => { const prior = latest.get(b.customer_id); if (!prior || b.created_at > prior.created_at) latest.set(b.customer_id,b); });
      const rows = customers.filter((c) => c.block_status === "blocked" && matchesCustomer(c)).map((c) => { const b = latest.get(c.id); const open = invoices.filter((i)=>i.customer_id===c.id && ["pending","overdue"].includes(i.status)).reduce((s,i)=>s+i.valor_centavos,0); return { cliente:c.nome, plano:planMap.get(c.plan_id)?.nome||"Não informado", data:dateBR(b?.created_at), motivo:b?.reason||"Manual / não informado", valor:money(open), dias:b?.created_at?daysBetween(b.created_at):"—" }; });
      return { columns:[{key:"cliente",label:"Cliente"},{key:"plano",label:"Plano"},{key:"data",label:"Data do bloqueio"},{key:"motivo",label:"Motivo"},{key:"valor",label:"Valor em aberto"},{key:"dias",label:"Dias bloqueado"}], rows, totals:[{label:"Bloqueados",value:String(rows.length)}] };
    }
    if (report === "customers") {
      const rows = customers.filter(matchesCustomer).filter((c)=>status==="all" || (status==="active"?c.ativo&&c.block_status!=="blocked":status==="blocked"?c.block_status==="blocked":!c.ativo)).filter((c)=>inPeriod(c.created_at) || (c.cancelled_at && inPeriod(c.cancelled_at))).map((c)=>({ nome:c.nome, documento:c.cpf, contato:[c.telefone,c.email].filter(Boolean).join(" / "), endereco:[c.rua,c.numero,c.bairro,c.cidade].filter(Boolean).join(", "), plano:planMap.get(c.plan_id)?.nome||"Não informado", mensal:money(planMap.get(c.plan_id)?.valor_centavos||0), status:!c.ativo?"Inativo / cancelado":c.block_status==="blocked"?"Bloqueado":"Ativo", cadastro:dateBR(c.created_at), cancelamento:dateBR(c.cancelled_at) }));
      return { columns:[{key:"nome",label:"Nome"},{key:"documento",label:"CPF/CNPJ"},{key:"contato",label:"Contato"},{key:"endereco",label:"Endereço"},{key:"plano",label:"Plano"},{key:"mensal",label:"Valor mensal"},{key:"status",label:"Situação"},{key:"cadastro",label:"Cadastro"},{key:"cancelamento",label:"Cancelamento"}], rows, totals:[{label:"Clientes",value:String(rows.length)},{label:"Ativos",value:String(rows.filter(r=>r.status==="Ativo").length)}] };
    }
    if (report === "financial") {
      const bucket = (value:string) => { const d=new Date(value.includes("T")?value:`${value}T00:00:00`); if(grouping==="daily") return d.toLocaleDateString("pt-BR"); if(grouping==="annual") return String(d.getFullYear()); return `${String(d.getMonth()+1).padStart(2,"0")}/${d.getFullYear()}`; };
      const grouped = new Map<string,any>(); invoices.filter((i)=>inPeriod(i.vencimento) && (plan==="all"||i.plan_id===plan) && (payment==="all"||(i.payment_method||i.gateway)===payment)).forEach((i)=>{const k=bucket(i.vencimento);const r=grouped.get(k)||{periodo:k,faturado:0,recebido:0,aberto:0,vencido:0,cancelado:0};r.faturado+=i.status!=="cancelled"?i.valor_centavos:0;r.recebido+=i.status==="paid"?i.valor_centavos:0;r.aberto+=["pending","waiting"].includes(i.status)?i.valor_centavos:0;r.vencido+=i.status==="overdue"?i.valor_centavos:0;r.cancelado+=i.status==="cancelled"?i.valor_centavos:0;grouped.set(k,r);});
      const raw=[...grouped.values()]; const rows=raw.map(r=>({...r,faturado:money(r.faturado),recebido:money(r.recebido),aberto:money(r.aberto),vencido:money(r.vencido),cancelado:money(r.cancelado)}));
      return { columns:[{key:"periodo",label:"Período"},{key:"faturado",label:"Faturado"},{key:"recebido",label:"Recebido"},{key:"aberto",label:"Em aberto"},{key:"vencido",label:"Vencido"},{key:"cancelado",label:"Cancelado"}], rows, totals:[{label:"Faturado",value:money(raw.reduce((s,r)=>s+r.faturado,0))},{label:"Recebido",value:money(raw.reduce((s,r)=>s+r.recebido,0))},{label:"Em aberto",value:money(raw.reduce((s,r)=>s+r.aberto+r.vencido,0))}], chart:raw.map(r=>({periodo:r.periodo,Faturado:r.faturado/100,Recebido:r.recebido/100,"Em aberto":(r.aberto+r.vencido)/100})) };
    }
    if (report === "bandwidth") {
      const raw=bandwidthUsage.map((usage)=>{const c=customerMap.get(usage.customer_id);if(!c||!matchesCustomer(c))return null;const download=Number(usage.download_bytes||0),upload=Number(usage.upload_bytes||0),total=Number(usage.total_bytes||0);return{cliente:c.nome,plano:planMap.get(c.plan_id)?.nome||"Não informado",pop:c.pop_name||"Não informado",download,upload,total,media:Math.round(total/Math.max(1,Number(usage.active_days||0))),pico:Number(usage.peak_bytes||0)};}).filter((row): row is NonNullable<typeof row>=>row!==null).sort((a,b)=>b.total-a.total).slice(0,Number(topN));
      const rows=raw.map(r=>({...r,download:bytes(r.download),upload:bytes(r.upload),total:bytes(r.total),media:bytes(r.media),pico:bytes(r.pico)}));
      return { columns:[{key:"cliente",label:"Cliente"},{key:"plano",label:"Plano"},{key:"pop",label:"POP"},{key:"download",label:"Download"},{key:"upload",label:"Upload"},{key:"total",label:"Total"},{key:"media",label:"Média diária"},{key:"pico",label:"Pico registrado"}], rows, totals:[{label:"Clientes com consumo",value:String(rows.length)},{label:"Consumo total",value:bytes(raw.reduce((s,r)=>s+r.total,0))}] };
    }
    if (report === "missing_invoice") {
      const rows=customers.filter((c)=>c.ativo&&matchesCustomer(c)&&(status==="all"||status==="active")).filter((c)=>!invoices.some((i)=>i.customer_id===c.id&&i.vencimento.slice(0,7)===from.slice(0,7)&&i.status!=="cancelled")).map((c)=>{const last=invoices.filter((i)=>i.customer_id===c.id).sort((a,b)=>b.created_at.localeCompare(a.created_at))[0];return{cliente:c.nome,plano:planMap.get(c.plan_id)?.nome||"Não informado",valor:money(planMap.get(c.plan_id)?.valor_centavos||0),vencimento:c.dia_vencimento,ultima:dateBR(last?.created_at)};});
      return { columns:[{key:"cliente",label:"Cliente"},{key:"plano",label:"Plano"},{key:"valor",label:"Valor do plano"},{key:"vencimento",label:"Dia de vencimento"},{key:"ultima",label:"Última fatura"}],rows,totals:[{label:"Sem fatura",value:String(rows.length)}] };
    }
    const grouped=new Map<string,any>(); invoices.filter((i)=>inPeriod(i.vencimento)&&(status==="all"||i.status===status)&&(payment==="all"||(i.payment_method||i.gateway)===payment)).forEach((i)=>{const k=`${i.gateway||"local"} / ${i.payment_method||"não informado"}`;const r=grouped.get(k)||{plataforma:k,qtd:0,bruto:0,taxas:0,liquido:0};r.qtd++;r.bruto+=i.valor_centavos;r.taxas+=i.gateway_fee_centavos||0;r.liquido+=i.net_amount_centavos??(i.valor_centavos-(i.gateway_fee_centavos||0));grouped.set(k,r);});
    const raw=[...grouped.values()];const total=raw.reduce((s,r)=>s+r.bruto,0);const rows=raw.map(r=>({plataforma:r.plataforma,qtd:r.qtd,bruto:money(r.bruto),taxas:money(r.taxas),liquido:money(r.liquido),ticket:money(r.qtd?r.bruto/r.qtd:0),participacao:total?`${(r.bruto/total*100).toFixed(1)}%`:"0%"}));
    return {columns:[{key:"plataforma",label:"Plataforma / meio"},{key:"qtd",label:"Cobranças"},{key:"bruto",label:"Valor bruto"},{key:"taxas",label:"Taxas"},{key:"liquido",label:"Valor líquido"},{key:"ticket",label:"Ticket médio"},{key:"participacao",label:"Participação"}],rows,totals:[{label:"Valor bruto",value:money(total)},{label:"Valor líquido",value:money(raw.reduce((s,r)=>s+r.liquido,0))}]};
  }, [report, customers, invoices, plans, blocks, bandwidthUsage, from, to, plan, status, location, seller, payment, pop, grouping, topN, customerMap, planMap]);

  const searched = useMemo(() => output.rows.filter((row)=>Object.values(row).some((value)=>String(value).toLowerCase().includes(search.toLowerCase()))), [output.rows, search]);
  const pageCount=Math.max(1,Math.ceil(searched.length/pageSize));
  const visible=searched.slice((page-1)*pageSize,page*pageSize);
  useEffect(()=>setPage(1),[report,search,from,to,plan,status,location,seller,payment,pop,grouping,topN]);
  const current=REPORTS.find((item)=>item.key===report);
  const filtersText=`Período ${dateBR(from)} a ${dateBR(to)}; plano ${plan==="all"?"todos":planMap.get(plan)?.nome||plan}; situação ${status}`;
  const meta={title:current?.label||"Relatório",filters:filtersText,user:user?.email||"Usuário"};

  if (!allowed.length) return <div className="py-16 text-center"><BarChart3 className="mx-auto h-12 w-12 text-muted-foreground"/><h2 className="mt-4 text-xl font-semibold">Sem acesso aos relatórios</h2><p className="text-muted-foreground">Solicite ao administrador a liberação dos relatórios necessários.</p></div>;
  return <div className="space-y-5 report-print-area">
    <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between no-print"><div><p className="text-xs font-semibold uppercase text-primary">Inteligência operacional</p><h1 className="text-2xl font-bold">Relatórios</h1><p className="text-muted-foreground">{current?.description}</p></div><div className="flex flex-wrap gap-2"><Button variant="outline" onClick={()=>exportCSV(meta,output.columns,searched)}><Download className="mr-2 h-4 w-4"/>CSV</Button><Button variant="outline" onClick={()=>exportXLSX(meta,output.columns,searched)}><FileSpreadsheet className="mr-2 h-4 w-4"/>Excel</Button><Button variant="outline" onClick={()=>exportPDF(meta,output.columns,searched)}><FileText className="mr-2 h-4 w-4"/>PDF</Button><Button onClick={()=>window.print()}><Printer className="mr-2 h-4 w-4"/>Imprimir</Button></div></div>
    <div className="hidden print:block border-b pb-4"><h1 className="text-xl font-bold">Mororo.Tech — {current?.label}</h1><p>{filtersText}</p><p>Emitido em {new Date().toLocaleString("pt-BR")} por {user?.email}</p></div>
    <div className="grid gap-2 md:grid-cols-[260px_1fr] no-print"><Select value={report} onValueChange={(v)=>setReport(v as ReportKey)}><SelectTrigger><SelectValue/></SelectTrigger><SelectContent>{allowed.map((r)=><SelectItem key={r.key} value={r.key}>{r.label}</SelectItem>)}</SelectContent></Select><div className="flex flex-wrap gap-2"><Input type="date" className="w-40" value={from} onChange={(e)=>setFrom(e.target.value)}/><Input type="date" className="w-40" value={to} onChange={(e)=>setTo(e.target.value)}/><Select value={plan} onValueChange={setPlan}><SelectTrigger className="w-44"><SelectValue placeholder="Plano"/></SelectTrigger><SelectContent><SelectItem value="all">Todos os planos</SelectItem>{plans.map(p=><SelectItem key={p.id} value={p.id}>{p.nome}</SelectItem>)}</SelectContent></Select></div></div>
    <div className="flex flex-wrap gap-2 no-print">
      {["overdue","customers","platforms"].includes(report)&&<Select value={status} onValueChange={setStatus}><SelectTrigger className="w-48"><SelectValue placeholder="Situação"/></SelectTrigger><SelectContent><SelectItem value="all">Todas as situações</SelectItem>{report==="overdue"?<><SelectItem value="1-15">1–15 dias</SelectItem><SelectItem value="16-30">16–30 dias</SelectItem><SelectItem value="31-60">31–60 dias</SelectItem><SelectItem value="60+">Mais de 60 dias</SelectItem></>:report==="customers"?<><SelectItem value="active">Ativos</SelectItem><SelectItem value="blocked">Bloqueados</SelectItem><SelectItem value="inactive">Inativos/cancelados</SelectItem></>:<><SelectItem value="paid">Pagas</SelectItem><SelectItem value="pending">Pendentes</SelectItem><SelectItem value="overdue">Vencidas</SelectItem><SelectItem value="cancelled">Canceladas</SelectItem></>}</SelectContent></Select>}
      {["overdue","customers"].includes(report)&&<><Select value={location} onValueChange={setLocation}><SelectTrigger className="w-48"><SelectValue placeholder="Cidade/bairro"/></SelectTrigger><SelectContent><SelectItem value="all">Todas as localidades</SelectItem>{locations.map(v=><SelectItem key={v} value={v}>{v}</SelectItem>)}</SelectContent></Select><Select value={seller} onValueChange={setSeller}><SelectTrigger className="w-44"><SelectValue placeholder="Vendedor"/></SelectTrigger><SelectContent><SelectItem value="all">Todos os vendedores</SelectItem>{sellers.map(v=><SelectItem key={v} value={v}>{v}</SelectItem>)}</SelectContent></Select></>}
      {["customers","financial","platforms"].includes(report)&&<Select value={payment} onValueChange={setPayment}><SelectTrigger className="w-48"><SelectValue placeholder="Forma de pagamento"/></SelectTrigger><SelectContent><SelectItem value="all">Todos os pagamentos</SelectItem><SelectItem value="pix">PIX</SelectItem><SelectItem value="boleto">Boleto</SelectItem><SelectItem value="card">Cartão</SelectItem><SelectItem value="cash">Dinheiro</SelectItem><SelectItem value="mercadopago">Mercado Pago</SelectItem><SelectItem value="efi">EFI</SelectItem></SelectContent></Select>}
      {report==="financial"&&<Select value={grouping} onValueChange={setGrouping}><SelectTrigger className="w-40"><SelectValue/></SelectTrigger><SelectContent><SelectItem value="daily">Diário</SelectItem><SelectItem value="monthly">Mensal</SelectItem><SelectItem value="annual">Anual</SelectItem></SelectContent></Select>}
      {report==="bandwidth"&&<><Select value={pop} onValueChange={setPop}><SelectTrigger className="w-44"><SelectValue placeholder="POP"/></SelectTrigger><SelectContent><SelectItem value="all">Todos os POPs</SelectItem>{pops.map(v=><SelectItem key={v} value={v}>{v}</SelectItem>)}</SelectContent></Select><Select value={topN} onValueChange={setTopN}><SelectTrigger className="w-32"><SelectValue/></SelectTrigger><SelectContent>{[10,20,50,100].map(n=><SelectItem key={n} value={String(n)}>Top {n}</SelectItem>)}</SelectContent></Select></>}
      <div className="relative min-w-64 flex-1"><Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground"/><Input value={search} onChange={(e)=>setSearch(e.target.value)} placeholder="Buscar nos resultados..." className="pl-9"/></div>
    </div>
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{output.totals.map((t)=><Card key={t.label}><CardContent className="p-4"><p className="text-xs uppercase text-muted-foreground">{t.label}</p><p className="mt-1 text-2xl font-bold">{t.value}</p></CardContent></Card>)}</div>
    {output.chart&&<div className="h-72 border-y py-4"><ResponsiveContainer width="100%" height="100%"><BarChart data={output.chart}><CartesianGrid strokeDasharray="3 3"/><XAxis dataKey="periodo"/><YAxis/><Tooltip formatter={(v:number)=>money(v*100)}/><Legend/><Bar dataKey="Faturado" fill="hsl(var(--primary))"/><Bar dataKey="Recebido" fill="hsl(var(--success))"/><Bar dataKey="Em aberto" fill="hsl(var(--warning))"/></BarChart></ResponsiveContainer></div>}
    {loading?<div className="flex justify-center py-20"><Loader2 className="h-8 w-8 animate-spin text-primary"/></div>:<><div className="overflow-x-auto rounded-md border"><Table><TableHeader><TableRow>{output.columns.map(c=><TableHead key={c.key} className="whitespace-nowrap">{c.label}</TableHead>)}</TableRow></TableHeader><TableBody>{visible.length?visible.map((row,index)=><TableRow key={index}>{output.columns.map(c=><TableCell key={c.key} className="whitespace-nowrap">{c.key==="status"?<Badge variant="secondary">{String(row[c.key])}</Badge>:String(row[c.key]??"—")}</TableCell>)}</TableRow>):<TableRow><TableCell colSpan={output.columns.length} className="h-28 text-center text-muted-foreground">Nenhum resultado para os filtros aplicados.</TableCell></TableRow>}</TableBody></Table></div><div className="flex items-center justify-between text-sm text-muted-foreground no-print"><span>{searched.length} resultado(s)</span><Pagination className="mx-0 w-auto"><PaginationContent><PaginationItem><PaginationPrevious href="#" onClick={(e)=>{e.preventDefault();setPage(Math.max(1,page-1));}} className={page===1?"pointer-events-none opacity-50":""}/></PaginationItem>{Array.from({length:Math.min(pageCount,5)},(_,i)=>i+1).map(n=><PaginationItem key={n}><PaginationLink href="#" isActive={page===n} onClick={(e)=>{e.preventDefault();setPage(n);}}>{n}</PaginationLink></PaginationItem>)}<PaginationItem><PaginationNext href="#" onClick={(e)=>{e.preventDefault();setPage(Math.min(pageCount,page+1));}} className={page===pageCount?"pointer-events-none opacity-50":""}/></PaginationItem></PaginationContent></Pagination></div></>}
  </div>;
}
