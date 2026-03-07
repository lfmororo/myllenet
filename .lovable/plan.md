

## Plano: Adicionar aviso de robô em todas as notificações WhatsApp

### O que será feito
Adicionar ao final de **todas** as mensagens enviadas via WhatsApp um aviso informando que o número é automatizado (robô) e indicando o telefone do administrador para contato humano.

### Implementação

Adicionar uma linha de rodapé em todas as mensagens, algo como:

```
🤖 _Esta é uma mensagem automática. Para falar com um atendente, entre em contato: (85) 98680-1458_
```

**Arquivos a editar (3 edge functions):**

1. **`supabase/functions/whatsapp-send/index.ts`** — Criar uma constante `BOT_DISCLAIMER` e anexá-la ao final de todas as mensagens nos handlers `sendText`, `sendBulk`, `sendInvoiceNotification` e `resendPaidNotifications`.

2. **`supabase/functions/due-reminder/index.ts`** — Anexar o mesmo aviso nas mensagens de lembrete de vencimento.

3. **`supabase/functions/daily-report/index.ts`** — Anexar o aviso no relatório diário enviado aos admins.

### Detalhes técnicos
- Constante definida em cada function: `const BOT_DISCLAIMER = "\n\n🤖 _Esta é uma mensagem automática. Para falar com um atendente, entre em contato: (85) 98680-1458_";`
- Concatenada antes do envio: `text: message + BOT_DISCLAIMER`
- O aviso é adicionado **antes** do botão de suporte (que já é enviado separadamente via `/send/menu`).

