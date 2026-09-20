import { useState, useMemo } from "react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Checkbox } from "@/components/ui/checkbox";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { MessageCircle, Send, Loader2, CheckCircle2, XCircle, Users, AlertTriangle, Clock } from "lucide-react";
import { useWhatsApp } from "@/hooks/useWhatsApp";
import { toast } from "sonner";
import type { Invoice } from "@/hooks/useInvoices";

interface Customer {
  id: string;
  nome: string;
  telefone: string | null;
  usuario_pppoe: string;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  customers: Customer[];
  allInvoices: Invoice[];
}

type TierKey = "amigavel" | "suspensao" | "incisivo";

const MESSAGE_TIERS: Record<TierKey, { label: string; description: string; badgeVariant: "secondary" | "default" | "destructive"; daysRange: string; template: string }> = {
  amigavel: {
    label: "Lembrete Amigável",
    description: "1 a 9 dias de atraso",
    badgeVariant: "secondary",
    daysRange: "1-9",
    template: `Olá, {nome}, tudo bem?

Passando para lembrar que o pagamento da sua fatura de internet, com vencimento em {vencimento}, ainda não consta em nosso sistema.

Sabemos que a rotina é corrida e isso pode acontecer! Caso já tenha efetuado o pagamento, por favor, desconsidere esta mensagem.

{link_pagamento}

Se precisar de uma 2ª via atualizada ou do código PIX, é só me pedir por aqui. 👋

_Equipe Myllenet_`,
  },
  suspensao: {
    label: "Alerta de Suspensão",
    description: "10 a 19 dias de atraso",
    badgeVariant: "default",
    daysRange: "10-19",
    template: `Oi, {nome}, como vai?

Notamos que sua fatura com vencimento em {vencimento} continua em aberto e, para evitar a suspensão automática do seu sinal por falta de pagamento, gostaríamos de te ajudar a regularizar essa pendência o quanto antes.

{link_pagamento}

Evite o bloqueio e taxas de religação! Podemos gerar um novo boleto para hoje?

Aguardo seu retorno para mantermos sua conexão ativa.

_Equipe Myllenet_`,
  },
  incisivo: {
    label: "Aviso Final",
    description: "20+ dias de atraso",
    badgeVariant: "destructive",
    daysRange: "20+",
    template: `Prezado(a) {nome},

Informamos que, devido ao atraso superior a {dias} dias em sua fatura (vencimento: {vencimento}), seu acesso à internet poderá sofrer restrições imediatas.

Queremos evitar que você fique desconectado. Por favor, entre em contato agora para negociarmos o débito ou envie o comprovante de pagamento para que possamos dar baixa no sistema.

{link_pagamento}

Contamos com sua colaboração.

_Equipe Myllenet_`,
  },
};

function getTierForDays(days: number): TierKey {
  if (days < 10) return "amigavel";
  if (days < 20) return "suspensao";
  return "incisivo";
}

export default function OverdueNotificationDialog({ open, onOpenChange, customers, allInvoices }: Props) {
  const { sendText } = useWhatsApp();
  const [activeTier, setActiveTier] = useState<TierKey>("amigavel");
  const [messages, setMessages] = useState<Record<TierKey, string>>({
    amigavel: MESSAGE_TIERS.amigavel.template,
    suspensao: MESSAGE_TIERS.suspensao.template,
    incisivo: MESSAGE_TIERS.incisivo.template,
  });
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [sending, setSending] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0, success: 0, failed: 0 });
  const [results, setResults] = useState<Record<string, "success" | "failed">>({});

  const overdueInfo = useMemo(() => {
    const now = new Date();
    const map = new Map<string, { days: number; link: string; vencimento: string; tier: TierKey }>();

    // First pass: find worst overdue per customer
    for (const inv of allInvoices) {
      if (!["overdue", "waiting", "pending"].includes(inv.status)) continue;
      const venc = new Date(inv.vencimento + "T12:00:00");
      if (venc >= now) continue;

      const diffDays = Math.floor((now.getTime() - venc.getTime()) / (1000 * 60 * 60 * 24));
      if (diffDays <= 0) continue;

      const existing = map.get(inv.customer_id);
      if (!existing || diffDays > existing.days) {
        map.set(inv.customer_id, {
          days: diffDays,
          link: "",
          vencimento: venc.toLocaleDateString("pt-BR"),
          tier: getTierForDays(diffDays),
        });
      }
    }

    // Second pass: collect payment links from ALL overdue invoices per customer
    for (const inv of allInvoices) {
      if (!["overdue", "waiting", "pending"].includes(inv.status)) continue;
      const info = map.get(inv.customer_id);
      if (!info) continue;

      const pixCopiaCola = (inv as any).mp_pix_copiacola || inv.efi_pix_copiacola;
      if (inv.efi_link || pixCopiaCola) {
        const linkParts: string[] = [];
        if (inv.efi_link) linkParts.push(`📄 Boleto: ${inv.efi_link}`);
        if (pixCopiaCola) linkParts.push(`💠 PIX Copia e Cola: ${pixCopiaCola}`);
        // Use the first invoice that has a link
        if (!info.link) {
          info.link = linkParts.join("\n");
        }
      }
    }

    // Set fallback for customers with no links found
    for (const [, info] of map) {
      if (!info.link) {
        info.link = "Entre em contato para obter os dados de pagamento.";
      }
    }

    return map;
  }, [allInvoices]);

  const overdueCustomers = useMemo(
    () => customers.filter(c => overdueInfo.has(c.id)),
    [customers, overdueInfo]
  );

  // Filter by active tier
  const tieredCustomers = useMemo(
    () => overdueCustomers.filter(c => overdueInfo.get(c.id)?.tier === activeTier),
    [overdueCustomers, overdueInfo, activeTier]
  );

  const customersWithPhone = tieredCustomers.filter(c => c.telefone);
  const customersWithoutPhone = tieredCustomers.filter(c => !c.telefone);

  // Counts per tier
  const tierCounts = useMemo(() => {
    const counts: Record<TierKey, number> = { amigavel: 0, suspensao: 0, incisivo: 0 };
    for (const c of overdueCustomers) {
      const info = overdueInfo.get(c.id);
      if (info) counts[info.tier]++;
    }
    return counts;
  }, [overdueCustomers, overdueInfo]);

  const toggleAll = () => {
    if (selectedIds.size === customersWithPhone.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(customersWithPhone.map(c => c.id)));
    }
  };

  const toggleOne = (id: string) => {
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelectedIds(next);
  };

  const handleTierChange = (tier: string) => {
    setActiveTier(tier as TierKey);
    setSelectedIds(new Set());
  };

  const handleSend = async () => {
    if (selectedIds.size === 0) {
      toast.error("Selecione ao menos um cliente");
      return;
    }

    const toSend = customersWithPhone.filter(c => selectedIds.has(c.id));
    setSending(true);
    setProgress({ done: 0, total: toSend.length, success: 0, failed: 0 });
    setResults({});

    let success = 0;
    let failed = 0;

    for (let i = 0; i < toSend.length; i++) {
      const c = toSend[i];
      const info = overdueInfo.get(c.id);
      const tierMsg = messages[activeTier];
      const personalizedMsg = tierMsg
        .replace(/\{nome\}/g, c.nome.split(" ")[0])
        .replace(/\{dias\}/g, String(info?.days || 0))
        .replace(/\{link_pagamento\}/g, info?.link || "")
        .replace(/\{vencimento\}/g, info?.vencimento || "");

      const ok = await sendText(c.telefone!, personalizedMsg, { customer_id: c.id, customer_name: c.nome });
      if (ok) {
        success++;
        setResults(prev => ({ ...prev, [c.id]: "success" }));
      } else {
        failed++;
        setResults(prev => ({ ...prev, [c.id]: "failed" }));
      }

      setProgress({ done: i + 1, total: toSend.length, success, failed });

      if (i < toSend.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    }

    setSending(false);
    toast.success(`Envio concluído: ${success} enviado(s), ${failed} falha(s)`);
  };

  const handleClose = (open: boolean) => {
    if (!sending) {
      onOpenChange(open);
      if (!open) {
        setResults({});
        setProgress({ done: 0, total: 0, success: 0, failed: 0 });
        setSelectedIds(new Set());
      }
    }
  };

  const currentTier = MESSAGE_TIERS[activeTier];

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-2xl max-h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Clock className="h-5 w-5 text-destructive" />
            Notificar Clientes em Atraso
          </DialogTitle>
          <DialogDescription>
            Escolha o nível de notificação conforme os dias de atraso. Variáveis: {`{nome}`}, {`{dias}`}, {`{vencimento}`}, {`{link_pagamento}`}
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 space-y-4 overflow-hidden">
          {/* Stats */}
          <div className="grid grid-cols-3 gap-3">
            <div className="rounded-lg border bg-card p-3 text-center">
              <Users className="h-4 w-4 mx-auto mb-1 text-muted-foreground" />
              <p className="text-2xl font-bold">{overdueCustomers.length}</p>
              <p className="text-xs text-muted-foreground">Total em atraso</p>
            </div>
            <div className="rounded-lg border bg-card p-3 text-center">
              <MessageCircle className="h-4 w-4 mx-auto mb-1 text-primary" />
              <p className="text-2xl font-bold">{customersWithPhone.length}</p>
              <p className="text-xs text-muted-foreground">Com telefone ({currentTier.label})</p>
            </div>
            <div className="rounded-lg border bg-card p-3 text-center">
              <AlertTriangle className="h-4 w-4 mx-auto mb-1 text-muted-foreground" />
              <p className="text-2xl font-bold">{customersWithoutPhone.length}</p>
              <p className="text-xs text-muted-foreground">Sem telefone</p>
            </div>
          </div>

          {/* Tier selector */}
          <Tabs value={activeTier} onValueChange={handleTierChange}>
            <TabsList className="w-full">
              <TabsTrigger value="amigavel" className="flex-1 gap-1.5 text-xs">
                👋 Amigável
                {tierCounts.amigavel > 0 && <Badge variant="secondary" className="text-[10px] h-4 px-1">{tierCounts.amigavel}</Badge>}
              </TabsTrigger>
              <TabsTrigger value="suspensao" className="flex-1 gap-1.5 text-xs">
                ⚠️ Suspensão
                {tierCounts.suspensao > 0 && <Badge variant="default" className="text-[10px] h-4 px-1">{tierCounts.suspensao}</Badge>}
              </TabsTrigger>
              <TabsTrigger value="incisivo" className="flex-1 gap-1.5 text-xs">
                🚨 Aviso Final
                {tierCounts.incisivo > 0 && <Badge variant="destructive" className="text-[10px] h-4 px-1">{tierCounts.incisivo}</Badge>}
              </TabsTrigger>
            </TabsList>

            {(["amigavel", "suspensao", "incisivo"] as TierKey[]).map(tier => (
              <TabsContent key={tier} value={tier} className="mt-3 space-y-3">
                <p className="text-xs text-muted-foreground">{MESSAGE_TIERS[tier].description}</p>
                <Textarea
                  value={messages[tier]}
                  onChange={e => setMessages(prev => ({ ...prev, [tier]: e.target.value }))}
                  rows={7}
                  className="text-sm resize-none"
                  disabled={sending}
                />
              </TabsContent>
            ))}
          </Tabs>

          {/* Progress */}
          {(sending || progress.done > 0) && (
            <div className="space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Progresso do envio</span>
                <span className="font-mono text-xs">
                  {progress.done}/{progress.total}
                  {progress.success > 0 && <span className="text-green-500 ml-2">✓ {progress.success}</span>}
                  {progress.failed > 0 && <span className="text-destructive ml-2">✗ {progress.failed}</span>}
                </span>
              </div>
              <Progress value={progress.total > 0 ? (progress.done / progress.total) * 100 : 0} className="h-2" />
            </div>
          )}

          {/* Customer list */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-sm font-medium">Clientes — {currentTier.label} ({customersWithPhone.length})</label>
              <Button
                variant="ghost"
                size="sm"
                onClick={toggleAll}
                disabled={sending || customersWithPhone.length === 0}
                className="text-xs h-7"
              >
                {selectedIds.size === customersWithPhone.length && customersWithPhone.length > 0 ? "Desmarcar todos" : "Selecionar todos"}
              </Button>
            </div>

            <ScrollArea className="h-[180px] rounded-lg border">
              <div className="p-1">
                {customersWithPhone.map(c => {
                  const info = overdueInfo.get(c.id);
                  return (
                    <label
                      key={c.id}
                      className={`flex items-center gap-3 rounded-md px-3 py-2 cursor-pointer transition-colors hover:bg-muted/50 ${
                        results[c.id] === "success" ? "bg-green-500/10" : results[c.id] === "failed" ? "bg-destructive/10" : ""
                      }`}
                    >
                      <Checkbox
                        checked={selectedIds.has(c.id)}
                        onCheckedChange={() => toggleOne(c.id)}
                        disabled={sending}
                      />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{c.nome}</p>
                        <p className="text-xs text-muted-foreground">{c.telefone} · venc. {info?.vencimento}</p>
                      </div>
                      <Badge variant={currentTier.badgeVariant} className="text-[10px] shrink-0">{info?.days}d</Badge>
                      {results[c.id] === "success" && <CheckCircle2 className="h-4 w-4 text-green-500 shrink-0" />}
                      {results[c.id] === "failed" && <XCircle className="h-4 w-4 text-destructive shrink-0" />}
                    </label>
                  );
                })}

                {customersWithoutPhone.length > 0 && (
                  <>
                    <div className="px-3 py-2 text-xs font-medium text-muted-foreground border-t mt-1 pt-2">
                      Sem telefone ({customersWithoutPhone.length})
                    </div>
                    {customersWithoutPhone.map(c => {
                      const info = overdueInfo.get(c.id);
                      return (
                        <div key={c.id} className="flex items-center gap-3 rounded-md px-3 py-2 opacity-50">
                          <Checkbox disabled checked={false} />
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium truncate">{c.nome}</p>
                            <p className="text-xs text-muted-foreground">Sem telefone · {info?.days}d</p>
                          </div>
                          <Badge variant="outline" className="text-[10px] shrink-0">Sem tel.</Badge>
                        </div>
                      );
                    })}
                  </>
                )}

                {tieredCustomers.length === 0 && (
                  <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
                    <CheckCircle2 className="h-8 w-8 mb-2 text-primary" />
                    <p className="text-sm">Nenhum cliente nesta faixa de atraso.</p>
                  </div>
                )}
              </div>
            </ScrollArea>
          </div>
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={() => handleClose(false)} disabled={sending}>
            {progress.done > 0 && !sending ? "Fechar" : "Cancelar"}
          </Button>
          <Button
            onClick={handleSend}
            disabled={sending || selectedIds.size === 0}
            className="gap-2"
            variant="destructive"
          >
            {sending ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Enviando...
              </>
            ) : (
              <>
                <Send className="h-4 w-4" />
                Enviar para {selectedIds.size} cliente{selectedIds.size !== 1 ? "s" : ""}
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
