import { useQuery } from "@tanstack/react-query";
import { useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Loader2, FileText, Download, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { toast } from "sonner";

const InvoiceView = () => {
  const { id } = useParams<{ id: string }>();

  const { data: invoice, isLoading, error } = useQuery({
    queryKey: ["public-invoice", id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("invoices")
        .select("*, customers(nome, cpf, telefone)")
        .eq("id", id)
        .single();

      if (error) throw error;
      return data;
    },
  });

  const handleDownload = async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const pdfUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/generate-invoice-pdf?invoice_id=${id}`;
      
      const response = await fetch(pdfUrl, {
        headers: session ? {
          Authorization: `Bearer ${session.access_token}`,
        } : {},
      });

      if (!response.ok) throw new Error("Falha ao gerar PDF");

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `Fatura_${invoice?.descricao || "cobranca"}.pdf`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (err) {
      console.error(err);
      toast.error("Erro ao baixar fatura");
    }
  };

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (error || !invoice) {
    return (
      <div className="flex min-h-screen items-center justify-center p-4">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle className="text-destructive text-center">Fatura não encontrada</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-center text-muted-foreground">O link pode ter expirado ou a fatura não existe.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const valor = (invoice.valor_centavos / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  const vencimento = new Date(invoice.vencimento + "T12:00:00").toLocaleDateString("pt-BR");
  const customer = (invoice as any).customers;

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
      <Card className="w-full max-w-2xl shadow-xl border-t-4 border-t-primary">
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-7">
          <div className="space-y-1">
            <CardTitle className="text-2xl font-bold flex items-center gap-2 text-slate-900">
              <FileText className="h-6 w-6 text-primary" />
              Mororo.Tech
            </CardTitle>
            <p className="text-sm text-muted-foreground">Fatura de Serviços de Internet</p>
          </div>
          <div className="text-right">
            <span className={`px-3 py-1 rounded-full text-xs font-medium ${
              invoice.status === 'paid' ? 'bg-teal-100 text-teal-700' : 'bg-amber-100 text-amber-700'
            }`}>
              {invoice.status === 'paid' ? 'Paga' : 'Pendente'}
            </span>
          </div>
        </CardHeader>
        <CardContent className="grid gap-6">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1">
              <p className="text-sm font-medium text-muted-foreground uppercase tracking-wider">Cliente</p>
              <p className="text-lg font-semibold text-slate-800">{customer?.nome}</p>
              <p className="text-sm text-slate-600">{customer?.cpf}</p>
            </div>
            <div className="text-right space-y-1">
              <p className="text-sm font-medium text-muted-foreground uppercase tracking-wider">Vencimento</p>
              <p className="text-lg font-semibold text-slate-800">{vencimento}</p>
            </div>
          </div>
          
          <div className="bg-slate-100 p-4 rounded-lg flex justify-between items-center">
            <div className="space-y-1">
              <p className="text-sm font-medium text-muted-foreground">Descrição</p>
              <p className="font-medium text-slate-700">{invoice.descricao}</p>
            </div>
            <div className="text-right space-y-1">
              <p className="text-sm font-medium text-muted-foreground">Total</p>
              <p className="text-2xl font-bold text-primary">{valor}</p>
            </div>
          </div>

          <div className="border-2 border-dashed border-slate-200 rounded-xl p-6 flex flex-col items-center gap-4">
            <p className="text-sm font-semibold text-slate-700 text-center flex items-center gap-2">
              <ShieldCheck className="h-4 w-4 text-teal-600" />
              Pague com Segurança
            </p>
            <Button 
              onClick={handleDownload}
              className="w-full sm:w-auto h-12 px-8 text-lg font-medium shadow-lg hover:shadow-primary/20 transition-all duration-200"
            >
              <Download className="mr-2 h-5 w-5" />
              Baixar Fatura (PDF)
            </Button>
            <p className="text-xs text-muted-foreground text-center">
              Ao clicar no botão, você fará o download da sua fatura completa com o QR Code PIX para pagamento.
            </p>
          </div>
        </CardContent>
        <CardFooter className="bg-slate-50 border-t flex flex-col items-center p-6 gap-2 text-center rounded-b-xl">
          <p className="text-sm text-slate-600">
            Dúvidas? Entre em contato com nosso suporte:
          </p>
          <a 
            href="https://wa.me/5585986801458" 
            className="text-primary font-bold hover:underline flex items-center gap-1"
          >
            (85) 98680-1458
          </a>
        </CardFooter>
      </Card>
    </div>
  );
};

export default InvoiceView;