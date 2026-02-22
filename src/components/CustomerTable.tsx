import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Pencil, Trash2, Eye, EyeOff, FileSearch, FileText, AlertCircle } from "lucide-react";
import { useState } from "react";
import type { Customer } from "@/hooks/useCustomers";

interface Props {
  customers: Customer[];
  onEdit: (customer: Customer) => void;
  onDelete: (customer: Customer) => void;
  onToggleActive: (id: string, ativo: boolean) => Promise<boolean>;
  onDetail: (customer: Customer) => void;
  customerIdsWithInvoice?: Set<string>;
}

export default function CustomerTable({ customers, onEdit, onDelete, onToggleActive, onDetail, customerIdsWithInvoice }: Props) {
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
              <TableHead className="font-semibold">Usuário PPPoE</TableHead>
              <TableHead className="font-semibold">Senha PPPoE</TableHead>
              {customerIdsWithInvoice && <TableHead className="font-semibold text-center">Boleto</TableHead>}
              <TableHead className="font-semibold text-center">Status</TableHead>
              <TableHead className="font-semibold text-right">Ações</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {customers.map((c) => {
              const hasInvoice = customerIdsWithInvoice?.has(c.id) ?? false;
              return (
                <TableRow key={c.id} className={`hover:bg-muted/30 ${!c.ativo ? "opacity-50" : ""}`}>
                  <TableCell className="font-medium">{c.nome}</TableCell>
                  <TableCell className="font-mono text-sm">{formatCPF(c.cpf)}</TableCell>
                  <TableCell className="hidden md:table-cell">{c.email}</TableCell>
                  <TableCell className="hidden lg:table-cell">{c.telefone || "—"}</TableCell>
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
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
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
