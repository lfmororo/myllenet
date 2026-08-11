# Plano: Fatura com Modelo Personalizado e PIX Local

Este plano descreve a implementação de um gerador de faturas PDF baseado no modelo fornecido pela Mororo Tech, integrando dados de pagamento PIX configuráveis localmente e automatizando o envio mensal via WhatsApp.

## Alterações

### Configurações (Backend & Frontend)
- Adicionar campos de configuração para PIX (Chave, Nome, Cidade) na página de Configurações.
- Estes dados serão usados para gerar o Payload PIX e o QR Code dinamicamente para cada fatura.

### Geração de Fatura (Edge Function)
- Criar a Edge Function `generate-invoice-pdf` que:
  - Recebe o ID da fatura.
  - Busca os dados do cliente, plano e consumo (logs do Mikrotik).
  - Gera um payload PIX estático (conforme o modelo) ou dinâmico baseado no valor da fatura.
  - Renderiza um PDF seguindo o layout do arquivo `Fatura_Internet_MororoTech_Modelo.docx`.
  - O PDF incluirá: Dados do Prestador (Mororo Tech), Dados do Cliente, Detalhes do Plano, Consumo (Download/Upload), Valor Total e QR Code PIX.

### Automação de Envio (Edge Function)
- Criar/Atualizar a Edge Function `monthly-invoice-sender` que:
  - Identifica faturas pendentes do mês.
  - Gera o PDF.
  - Envia via WhatsApp (UAZAPI) com uma mensagem personalizada identificando o cliente e o mês de referência.
  - O envio será agendado via `pg_cron` para ocorrer mensalmente.

### Interface do Usuário
- Adicionar um botão "Ver Fatura PDF" na tabela de cobranças.
- Permitir o reenvio manual da fatura PDF via WhatsApp.

## Detalhes Técnicos
- **Geração de PDF**: Utilizaremos a biblioteca `jspdf` ou similar via Edge Function para gerar o documento.
- **QR Code PIX**: Implementaremos a lógica de geração de payload PIX (EMV QRCPS) para garantir que o pagamento seja identificado corretamente.
- **Consumo de Dados**: Os dados de download/upload serão extraídos da tabela `pppoe_logs` (consumo agregado do mês anterior).
- **Armazenamento**: Os PDFs gerados podem ser armazenados no Supabase Storage para consulta histórica.

## Próximos Passos
1. Executar migração SQL para adicionar as chaves de configuração PIX.
2. Criar a Edge Function de geração de PDF.
3. Atualizar a UI de Configurações e Cobranças.
4. Testar o fluxo completo de geração e envio.
