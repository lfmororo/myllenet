import { useState } from "react";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2, Star, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import logoImg from "@/assets/logo.png";

const TIPOS = [
  { value: "satisfacao", label: "Elogio / Satisfação" },
  { value: "solicitacao", label: "Solicitação" },
  { value: "reclamacao", label: "Reclamação" },
] as const;

const schema = z.object({
  nome: z.string().trim().max(100, "Nome muito longo").optional(),
  telefone: z.string().trim().max(20, "Telefone muito longo").optional(),
  rating: z.number().int().min(1, "Selecione uma nota").max(5),
  tipo: z.enum(["satisfacao", "solicitacao", "reclamacao"]),
  mensagem: z.string().trim().max(1000, "Máximo de 1000 caracteres").optional(),
});

export default function SatisfactionPage() {
  const [nome, setNome] = useState("");
  const [telefone, setTelefone] = useState("");
  const [rating, setRating] = useState(0);
  const [hover, setHover] = useState(0);
  const [tipo, setTipo] = useState<(typeof TIPOS)[number]["value"]>("satisfacao");
  const [mensagem, setMensagem] = useState("");
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = schema.safeParse({ nome, telefone, rating, tipo, mensagem });
    if (!parsed.success) {
      toast.error(parsed.error.issues[0].message);
      return;
    }
    setLoading(true);
    const { error } = await supabase.from("customer_feedback").insert({
      nome: nome.trim() || null,
      telefone: telefone.trim() || null,
      rating,
      tipo,
      mensagem: mensagem.trim() || null,
    });
    setLoading(false);
    if (error) {
      toast.error("Não foi possível enviar. Tente novamente.");
      return;
    }
    setSent(true);
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <Card className="w-full max-w-lg shadow-lg">
        <CardHeader className="text-center space-y-3">
          <div className="mx-auto flex h-14 w-full items-center justify-center">
            <img src={logoImg} alt="Mororo.Tech" className="h-14 w-auto max-w-[190px] object-contain logo-high-contrast" />
          </div>
          <CardTitle className="text-2xl font-bold tracking-tight">Sua opinião importa</CardTitle>
          <CardDescription>
            Avalie nosso atendimento e envie solicitações ou reclamações.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {sent ? (
            <div className="flex flex-col items-center gap-3 py-8 text-center">
              <CheckCircle2 className="h-14 w-14 text-primary" />
              <h2 className="text-lg font-semibold">Recebemos sua mensagem!</h2>
              <p className="text-sm text-muted-foreground">
                Obrigado pelo retorno. Nossa equipe irá analisar em breve.
              </p>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-5">
              <div className="space-y-2">
                <Label>Como você avalia nosso serviço?</Label>
                <div className="flex items-center gap-1">
                  {[1, 2, 3, 4, 5].map((n) => (
                    <button
                      key={n}
                      type="button"
                      aria-label={`Nota ${n}`}
                      onClick={() => setRating(n)}
                      onMouseEnter={() => setHover(n)}
                      onMouseLeave={() => setHover(0)}
                      className="p-1 transition-transform hover:scale-110"
                    >
                      <Star
                        className={cn(
                          "h-8 w-8",
                          (hover || rating) >= n
                            ? "fill-primary text-primary"
                            : "text-muted-foreground/40",
                        )}
                      />
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-2">
                <Label>Tipo de mensagem</Label>
                <div className="grid grid-cols-3 gap-2">
                  {TIPOS.map((t) => (
                    <Button
                      key={t.value}
                      type="button"
                      variant={tipo === t.value ? "default" : "outline"}
                      className="h-auto whitespace-normal py-2 text-xs"
                      onClick={() => setTipo(t.value)}
                    >
                      {t.label}
                    </Button>
                  ))}
                </div>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="nome">Nome (opcional)</Label>
                  <Input id="nome" value={nome} onChange={(e) => setNome(e.target.value)} maxLength={100} placeholder="Seu nome" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="telefone">Telefone (opcional)</Label>
                  <Input id="telefone" value={telefone} onChange={(e) => setTelefone(e.target.value)} maxLength={20} placeholder="(85) 99999-9999" />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="mensagem">Sua mensagem</Label>
                <Textarea
                  id="mensagem"
                  value={mensagem}
                  onChange={(e) => setMensagem(e.target.value)}
                  maxLength={1000}
                  rows={5}
                  placeholder="Conte o que podemos melhorar, sua solicitação ou reclamação..."
                />
                <p className="text-right text-[11px] text-muted-foreground">{mensagem.length}/1000</p>
              </div>

              <Button type="submit" className="w-full" disabled={loading}>
                {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Enviar avaliação
              </Button>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
