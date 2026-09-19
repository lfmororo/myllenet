import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Loader2, Star, ExternalLink, Copy } from "lucide-react";
import { toast } from "sonner";

interface Feedback {
  id: string;
  nome: string | null;
  telefone: string | null;
  rating: number;
  tipo: string;
  mensagem: string | null;
  created_at: string;
}

const tipoLabel: Record<string, string> = {
  satisfacao: "Elogio",
  solicitacao: "Solicitação",
  reclamacao: "Reclamação",
};

export default function FeedbackPage() {
  const [items, setItems] = useState<Feedback[]>([]);
  const [loading, setLoading] = useState(true);

  const publicUrl = `${window.location.origin}/satisfacao`;

  useEffect(() => {
    const load = async () => {
      const { data, error } = await supabase
        .from("customer_feedback")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(200);
      if (error) toast.error("Erro ao carregar avaliações");
      setItems((data as Feedback[]) ?? []);
      setLoading(false);
    };
    load();
  }, []);

  const media = items.length
    ? (items.reduce((s, i) => s + i.rating, 0) / items.length).toFixed(1)
    : "-";

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Link público de avaliação</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-2">
          <code className="rounded bg-muted px-3 py-2 text-xs">{publicUrl}</code>
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              navigator.clipboard.writeText(publicUrl);
              toast.success("Link copiado!");
            }}
          >
            <Copy className="mr-2 h-4 w-4" /> Copiar
          </Button>
          <Button size="sm" variant="outline" asChild>
            <a href="/satisfacao" target="_blank" rel="noreferrer">
              <ExternalLink className="mr-2 h-4 w-4" /> Abrir
            </a>
          </Button>
          <div className="ml-auto flex items-center gap-2 text-sm">
            <Star className="h-4 w-4 fill-primary text-primary" />
            <span className="font-semibold">{media}</span>
            <span className="text-muted-foreground">({items.length} respostas)</span>
          </div>
        </CardContent>
      </Card>

      {loading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
        </div>
      ) : items.length === 0 ? (
        <p className="py-12 text-center text-sm text-muted-foreground">
          Nenhuma avaliação recebida ainda.
        </p>
      ) : (
        <div className="grid gap-3">
          {items.map((f) => (
            <Card key={f.id}>
              <CardContent className="space-y-2 pt-5">
                <div className="flex flex-wrap items-center gap-2">
                  <div className="flex">
                    {[1, 2, 3, 4, 5].map((n) => (
                      <Star
                        key={n}
                        className={
                          n <= f.rating
                            ? "h-4 w-4 fill-primary text-primary"
                            : "h-4 w-4 text-muted-foreground/30"
                        }
                      />
                    ))}
                  </div>
                  <Badge variant={f.tipo === "reclamacao" ? "destructive" : "secondary"}>
                    {tipoLabel[f.tipo] ?? f.tipo}
                  </Badge>
                  <span className="text-xs text-muted-foreground">
                    {new Date(f.created_at).toLocaleString("pt-BR")}
                  </span>
                </div>
                <p className="text-sm font-medium">
                  {f.nome || "Anônimo"}
                  {f.telefone ? <span className="text-muted-foreground"> · {f.telefone}</span> : null}
                </p>
                {f.mensagem && <p className="text-sm text-muted-foreground">{f.mensagem}</p>}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
