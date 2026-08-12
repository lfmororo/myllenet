import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Pencil, Trash2, Eye, EyeOff, FileSearch, FileText, AlertCircle, Gift, ShieldAlert, ShieldCheck, Loader2 } from "lucide-react";
import { useState } from "react";
import type { Customer } from "@/hooks/useCustomers";
import type { Plan } from "@/hooks/usePlans";

interface Props {
  customers: Customer[];
  onEdit: (customer: Customer) => void;
  onDelete: (customer: Customer) => void;
  onToggleActive: (id: string, ativo: boolean) => Promise<boolean>;
  onDetail: (customer: Customer) => void;
  customerIdsWithInvoice?: Set<string>;
  plans?: Plan[];
  onlineList?: string[];
  syncMikrotik?: (id: string, action: 'enable' | 'disable' | 'sync') => Promise<boolean>;
  mikrotikLoading?: string | null;
}

export default function CustomerTable({ 
  customers, onEdit, onDelete, onToggleActive, onDetail, customerIdsWithInvoice, plans = [], onlineList = [],
  syncMikrotik, mikrotikLoading 
}: Props) {
  const now = new Date();
  const currentMonthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  const planMap = Object.fromEntries(plans.map(p => [p.id, p.nome]));
  const [showPasswords, setShowPasswords] = useState<Record<string, boolean>>({});

  const togglePassword = (id: string) => {
    setShowPasswords((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const formatCPF = (cpf: string) => {
    const d = cpf.replace(/\D/g, "");
    if (d.length !== 11) return cpf;
    return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
  };

  if (customers.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
        <p className="text-lg font-medium">Nenhum cliente encontrado</p>
        <p className="text-sm">Cadastre um novo cliente para começar.</p>
      </div>
    );
  }

  return (
    <TooltipProvider>
      <div className="rounded-lg border bg-card">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/50">
              <TableHead className="font-semibold">Nome</TableHead>
              <TableHead className="font-semibold">CPF</TableHead>
              <TableHead className="font-semibold hidden md:table-cell">E-mail</TableHead>
              <TableHead className="font-semibold hidden lg:table-cell">Telefone</TableHead>
              <TableHead className="font-semibold hidden lg:table-cell">Plano</TableHead>
              <TableHead className="font-semibold text-center">Conexão</TableHead>
              <TableHead className="font-semibold">Usuário PPPoE</TableHead>
              <TableHead className="font-semibold">Senha PPPoE</TableHead>
              {customerIdsWithInvoice && <TableHead className="font-semibold text-center">Boleto</TableHead>}
              <TableHead className="font-semibold text-center">Status Bloqueio</TableHead>
              <TableHead className="font-semibold text-center">Status</TableHead>
              <TableHead className="font-semibold text-right">Ações</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {customers.map((c) => {
              const hasPagoAte = c.pago_ate && new Date(c.pago_ate + "T12:00:00") >= currentMonthEnd;
              const hasInvoice = hasPagoAte || (customerIdsWithInvoice?.has(c.id) ?? false);
              const isOnline = onlineList.includes(c.usuario_pppoe);
              return (
                <TableRow key={c.id} className={`hover:bg-muted/30 ${!c.ativo ? "opacity-50" : ""}`}>
                  <TableCell className="font-medium">
                    <span className="flex items-center gap-1.5">
                      {c.nome}
                      {c.cortesia && (
                        <Badge variant="outline" className="text-xs gap-0.5 px-1.5 py-0 border-primary/30 text-primary">
                          <Gift className="h-3 w-3" /> Cortesia
                        </Badge>
                      )}
                    </span>
                  </TableCell>
                  <TableCell className="font-mono text-sm">{formatCPF(c.cpf)}</TableCell>
                  <TableCell className="hidden md:table-cell">{c.email}</TableCell>
                  <TableCell className="hidden lg:table-cell">{c.telefone || "—"}</TableCell>
                  <TableCell className="hidden lg:table-cell">{c.plan_id ? planMap[c.plan_id] || "—" : "—"}</TableCell>
                  <TableCell className="text-center">
                    <Tooltip>
                      <TooltipTrigger>
                        <div className="flex justify-center">
                          <div className={`h-2.5 w-2.5 rounded-full ${isOnline ? "bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.6)]" : "bg-gray-300"}`} />
                        </div>
                      </TooltipTrigger>
                      <TooltipContent>
                        {isOnline ? "Conectado agora" : "Desconectado"}
                      </TooltipContent>
                    </Tooltip>
                  </TableCell>
                  <TableCell className="font-mono text-sm">{c.usuario_pppoe}</TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1">
                      <span className="font-mono text-sm">
                        {showPasswords[c.id] ? c.senha_pppoe : "••••••"}
                      </span>
                      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => togglePassword(c.id)}>
                        {showPasswords[c.id] ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                      </Button>
                    </div>
                  </TableCell>
                  {customerIdsWithInvoice && (
                    <TableCell className="text-center">
                      {c.cortesia ? (
                        <Badge variant="outline" className="text-xs gap-1 border-primary/30 text-primary">
                          <Gift className="h-3 w-3" /> Cortesia
                        </Badge>
                      ) : (
                        <Tooltip>
                          <TooltipTrigger>
                            {hasInvoice ? (
                              <Badge variant="default" className="text-xs gap-1">
                                <FileText className="h-3 w-3" /> Emitido
                              </Badge>
                            ) : (
                              <Badge variant="destructive" className="text-xs gap-1">
                                <AlertCircle className="h-3 w-3" /> Sem boleto
                              </Badge>
                            )}
                          </TooltipTrigger>
                          <TooltipContent>
                            {hasInvoice ? "Boleto emitido no mês atual" : "Sem boleto emitido no mês atual"}
                          </TooltipContent>
                        </Tooltip>
                      )}
                    </TableCell>
                  )}
                  <TableCell className="text-center">
                    <div className="flex items-center justify-center gap-2">
                      <Switch
                        checked={c.ativo}
                        onCheckedChange={(checked) => onToggleActive(c.id, checked)}
                      />
                      <Badge variant={c.ativo ? "default" : "secondary"} className="text-xs">
                        {c.ativo ? "Ativo" : "Inativo"}
                      </Badge>
                    </div>
                  </TableCell>
                  <TableCell className="text-center">
                    <Badge variant={c.block_status === "blocked" ? "destructive" : "outline"} className="text-xs">
                      {c.block_status === "blocked" ? "Bloqueado" : "Liberado"}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      {syncMikrotik && (
                        <>
                          {c.block_status === "blocked" ? (
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 text-teal-600 hover:text-teal-700 hover:bg-teal-50"
                              title="Desbloquear no Mikrotik"
                              disabled={mikrotikLoading === c.id}
                              onClick={() => syncMikrotik(c.id, 'enable')}
                            >
                              {mikrotikLoading === c.id ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                              ) : (
                                <ShieldCheck className="h-4 w-4" />
                              )}
                            </Button>
                          ) : (
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 text-orange-600 hover:text-orange-700 hover:bg-orange-50"
                              title="Bloquear no Mikrotik"
                              disabled={mikrotikLoading === c.id}
                              onClick={() => syncMikrotik(c.id, 'disable')}
                            >
                              {mikrotikLoading === c.id ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                              ) : (
                                <ShieldAlert className="h-4 w-4" />
                              )}
                            </Button>
                          )}
                        </>
                      )}
                      <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => onDetail(c)} title="Detalhes">
                        <FileSearch className="h-4 w-4" />
                      </Button>
                      <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => onEdit(c)}>
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive hover:text-destructive" onClick={() => onDelete(c)}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </TooltipProvider>
  );
}
