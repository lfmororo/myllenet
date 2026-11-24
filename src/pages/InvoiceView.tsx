import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useParams } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { Loader2, FileText, Download, ShieldCheck, Copy, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { toast } from "sonner";
import { jsPDF } from "jspdf";
import QRCode from "qrcode";
import { maskCustomerName, maskDocument, maskedCustomerLocation } from "@/lib/privacy";

const API_URL = (import.meta.env.VITE_API_URL as string) || "http://localhost:3333";

const InvoiceView = () => {
  const [copying, setCopying] = useState(false);
  const [pixPayload, setPixPayload] = useState<string>("");
  const { id } = useParams<{ id: string }>();

  const { data, isLoading, error } = useQuery({
    queryKey: ["public-invoice", id],
    queryFn: async () => {
      // Backend Supabase (VPS e Lovable): Edge Function pública fatura-publica
      if (((import.meta.env.VITE_BACKEND as string) || "supabase") === "supabase") {
        const base = import.meta.env.VITE_SUPABASE_URL as string;
        const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string;
        const res = await fetch(`${base}/functions/v1/fatura-publica?id=${encodeURIComponent(id || "")}`, {
          headers: { apikey: key, Authorization: `Bearer ${key}` },
        });
        if (!res.ok) throw new Error("Fatura não encontrada");
        return res.json();
      }
      const res = await fetch(`${API_URL}/api/public/invoice/${id}`);
      if (!res.ok) throw new Error("Fatura não encontrada");
      return res.json();
    },
  });

  const invoice = data?.invoice;
  const settings = data?.settings;
  const provedor: string = settings?.provedor_nome || "Mororo.Tech";
  const slogan: string = settings?.fatura_slogan ?? "MylleNet agora é Mororo.Tech";
  const telefone: string = String(settings?.atendimento_telefone || "85986801458").replace(/^55(?=\d{10,11}$)/, "");
  const telefoneFmt: string = settings?.atendimento_telefone_fmt || "(85) 98680-1458";

  const generatePix = () => {
    if (!invoice) return "";

    // Pix gerado pelo Mercado Pago tem prioridade
    const mpPix = (invoice as any).mp_pix_copiacola;
    if (mpPix) return mpPix as string;

    if (!settings) return "";

    
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
    payload += f("59", sanitize(settings.pix_name || provedor).substring(0, 25));
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
      const payload = generatePix();
      const doc = new jsPDF();
      const pageWidth = doc.internal.pageSize.getWidth();
      doc.setFillColor(13, 148, 136);
      doc.rect(0, 0, pageWidth, 5, "F");
      doc.setFontSize(20);
      doc.setTextColor(15, 23, 42);
      doc.setFont("helvetica", "bold");
      doc.text("FATURA", 20, 25);
      doc.setFontSize(10);
      doc.setTextColor(71, 85, 105);
      doc.setFont("helvetica", "normal");
      doc.text(`#${id?.substring(0, 8).toUpperCase()}`, 20, 32);
      doc.text(provedor, pageWidth - 20, 25, { align: "right" });

      doc.setFontSize(11);
      doc.setTextColor(15, 23, 42);
      doc.setFont("helvetica", "bold");
      doc.text(maskCustomerName(invoice?.customers?.nome), 20, 45);
      doc.setFont("helvetica", "normal");
      doc.text(`CPF/CNPJ: ${maskDocument(invoice?.customers?.cpf)}`, 20, 51);
      doc.text(maskedCustomerLocation(invoice?.customers), 20, 57);

      doc.text(invoice?.descricao || "", 20, 70);
      doc.text(`Vencimento: ${new Date(invoice?.vencimento + "T12:00:00").toLocaleDateString("pt-BR")}`, 20, 76);
      doc.text(`Valor: ${(invoice?.valor_centavos / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}`, 20, 82);

      if (payload) {
        doc.setFont("helvetica", "bold");
        doc.text("PAGAMENTO VIA PIX", 20, 100);
        const qr = await QRCode.toDataURL(payload, { margin: 1, width: 200 });
        doc.addImage(qr, "PNG", 20, 108, 60, 60);
        doc.setFont("helvetica", "normal");
        doc.setFontSize(7);
        doc.text(doc.splitTextToSize(payload, pageWidth - 100), 90, 115);
      }

      doc.save(`Fatura_${invoice?.descricao || "cobranca"}.pdf`);
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
              {provedor}
            </CardTitle>
            <p className="text-sm text-muted-foreground">Fatura de Serviços de Internet</p>
            {slogan && <p className="text-xs font-medium text-primary">{slogan}</p>}
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
              <p className="text-lg font-semibold text-slate-800">{maskCustomerName(customer?.nome)}</p>
              <p className="text-sm text-slate-600">CPF/CNPJ: {maskDocument(customer?.cpf)}</p>
              <p className="text-sm text-slate-600">{maskedCustomerLocation(customer)}</p>
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

              {(invoice as any).mp_pix_qrcode && (
                <div className="flex flex-col items-center gap-2">
                  <img
                    src={`data:image/png;base64,${(invoice as any).mp_pix_qrcode}`}
                    alt="QR Code PIX"
                    className="h-48 w-48 rounded-lg border bg-white p-2"
                  />
                  <p className="text-[10px] text-muted-foreground">
                    QR Code gerado pelo Mercado Pago
                  </p>
                </div>
              )}

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
          {slogan && <p className="text-sm font-semibold text-slate-800">{slogan}</p>}
          <p className="text-sm text-slate-600">
            Dúvidas? Entre em contato com nosso suporte:
          </p>
          <a 
            href={`https://wa.me/55${telefone}`}
            className="text-primary font-bold hover:underline flex items-center gap-1"
          >
            {telefoneFmt}
          </a>
        </CardFooter>
      </Card>
    </div>
  );
};

export default InvoiceView;