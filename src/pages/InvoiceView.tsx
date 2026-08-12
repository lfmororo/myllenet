import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useParams } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { Loader2, FileText, Download, ShieldCheck, Copy, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { toast } from "sonner";

const InvoiceView = () => {
  const [copying, setCopying] = useState(false);
  const [pixPayload, setPixPayload] = useState<string>("");
  const { id } = useParams<{ id: string }>();

  const { data: invoice, isLoading, error } = useQuery({
    queryKey: ["public-invoice", id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("invoices")
        .select("*, customers(*)")
        .eq("id", id)
        .single();

      if (error) throw error;
      return data;
    },
  });

  const { data: settings } = useQuery({
    queryKey: ["pix-settings"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("settings")
        .select("key, value")
        .in("key", ["pix_key", "pix_name", "pix_city"]);
      if (error) throw error;
      return Object.fromEntries(data.map(s => [s.key, s.value]));
    },
  });

  const generatePix = () => {
    if (!invoice || !settings) return "";
    
    // Minimal PIX CRC16 implementation for client-side display
    const crc16 = (data: string) => {
      let crc = 0xFFFF;
      for (let i = 0; i < data.length; i++) {
        crc ^= (data.charCodeAt(i) << 8);
        for (let j = 0; j < 8; j++) {
          if (crc & 0x8000) crc = (crc << 1) ^ 0x1021;
          else crc <<= 1;
          crc &= 0xFFFF;
        }
      }
      return crc.toString(16).toUpperCase().padStart(4, "0");
    };

    const sanitize = (str: string) => str.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-zA-Z0-9 ]/g, "").toUpperCase();
    const f = (id: string, val: string) => id + val.length.toString().padStart(2, "0") + val;
    
    const customer = (invoice as any).customers;
    const refDate = new Date(invoice.vencimento + "T12:00:00");
    const refMonth = refDate.toLocaleDateString('pt-BR', { month: '2-digit', year: '2-digit' }).replace('/', '');
    const shortName = sanitize(customer?.nome || "").split(' ')[0].substring(0, 10);
    const txid = `${shortName}${refMonth}`;

    const merchantAccountInfo = f("00", "BR.GOV.BCB.PIX") + f("01", settings.pix_key || "00000000000");
    let payload = f("00", "01");
    payload += f("26", merchantAccountInfo);
    payload += f("52", "0000");
    payload += f("53", "986");
    payload += f("54", (invoice.valor_centavos / 100).toFixed(2));
    payload += f("58", "BR");
    payload += f("59", sanitize(settings.pix_name || "Mororo Tech").substring(0, 25));
    payload += f("60", sanitize(settings.pix_city || "Ipu").substring(0, 15));
    payload += f("62", f("05", txid));
    payload += "6304";
    payload += crc16(payload);
    return payload;
  };

  const handleCopyPix = () => {
    const payload = generatePix();
    if (!payload) return;
    navigator.clipboard.writeText(payload);
    setCopying(true);
    toast.success("PIX Copia e Cola copiado!");
    setTimeout(() => setCopying(false), 2000);
  };

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

          {invoice.status !== 'paid' && (
            <div className="bg-slate-50 border border-slate-200 rounded-xl p-6 flex flex-col gap-4">
              <div className="flex items-center justify-between">
                <p className="text-sm font-semibold text-slate-700 flex items-center gap-2">
                  <ShieldCheck className="h-4 w-4 text-teal-600" />
                  Pagamento PIX
                </p>
                <Badge variant="outline" className="bg-teal-50 text-teal-700 border-teal-200">
                  Liberação Imediata
                </Badge>
              </div>

              <div className="flex flex-col sm:flex-row gap-3">
                <Button 
                  onClick={handleCopyPix}
                  variant="outline"
                  className="flex-1 h-12 border-primary text-primary hover:bg-primary/5 font-semibold"
                >
                  {copying ? (
                    <>
                      <Check className="mr-2 h-4 w-4" />
                      Copiado!
                    </>
                  ) : (
                    <>
                      <Copy className="mr-2 h-4 w-4" />
                      Copiar PIX Copia e Cola
                    </>
                  )}
                </Button>
                
                <Button 
                  onClick={handleDownload}
                  className="flex-1 h-12 shadow-lg hover:shadow-primary/20 transition-all duration-200"
                >
                  <Download className="mr-2 h-4 w-4" />
                  Baixar PDF Completo
                </Button>
              </div>

              <p className="text-[10px] text-muted-foreground text-center">
                O PIX Copia e Cola permite pagar rapidamente pelo aplicativo do seu banco sem precisar escanear o QR Code.
              </p>
            </div>
          )}

          {invoice.status === 'paid' && (
            <div className="border-2 border-dashed border-slate-200 rounded-xl p-6 flex flex-col items-center gap-4">
              <div className="bg-teal-100 p-3 rounded-full">
                <ShieldCheck className="h-8 w-8 text-teal-600" />
              </div>
              <div className="text-center">
                <h3 className="text-lg font-bold text-slate-900">Pagamento Confirmado</h3>
                <p className="text-sm text-muted-foreground">Esta fatura já foi quitada. Obrigado!</p>
              </div>
              <Button 
                onClick={handleDownload}
                variant="outline"
                className="w-full sm:w-auto"
              >
                <Download className="mr-2 h-4 w-4" />
                Baixar Comprovante (PDF)
              </Button>
            </div>
          )}
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