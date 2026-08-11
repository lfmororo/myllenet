# Plan: Melhorar Layout da Fatura PDF e Corrigir QR Code PIX

O usuário relatou que o QR Code do PIX está incorreto e que o layout da fatura está "muito feio". O objetivo é redesenhar o PDF para um visual mais profissional e garantir que o payload do PIX seja gerado corretamente de acordo com os padrões do BACEN.

## Mudanças Propostas

### Backend (Edge Function: `generate-invoice-pdf`)

- **Correção do Payload PIX**: Refinar a função `generatePixPayload` para garantir que o formato do valor e dos campos esteja 100% compatível com o padrão EMV QRCPS (utilizado pelo PIX).
- **Dados Adicionais**: Incluir CNPJ/CPF do emissor (se configurado) e outros detalhes que possam enriquecer a fatura.

### Frontend (Hook: `useInvoicePDF`)

- **Design Renovado**:
  - Implementar um layout mais estruturado usando grids visuais.
  - Melhorar a tipografia e o uso de cores (usando o esquema Mororo.Tech: Deep Blue e Cyan).
  - Adicionar elementos visuais como bordas suaves, ícones (se possível via formas simples ou imagens) e áreas de destaque para o valor e vencimento.
- **Destaque ao PIX**:
  - Aumentar a área do QR Code e torná-la o foco principal das instruções de pagamento.
  - Melhorar a legibilidade do "Copia e Cola".
- **Informações de Consumo**: Apresentar os dados de download/upload de forma mais elegante.

## Detalhes Técnicos

### Estrutura do Novo PDF

- **Cabeçalho**: Logo à esquerda, "Fatura de Internet" à direita com destaque para o mês.
- **Seção do Cliente/Emissor**: Duas colunas claras.
- **Resumo do Serviço**: Tabela com Planos, Consumo e Período.
- **Destaque Financeiro**: Box com fundo escuro e texto claro para "Valor Total" e "Vencimento".
- **Área de Pagamento (PIX)**:
  - Título chamativo.
  - QR Code grande e centralizado/alinhado.
  - Passo a passo rápido de como pagar.
- **Rodapé**: Informações de suporte e copyright.

### Correção do PIX (Algoritmo)

- Verificar se o `Merchant Name` e `Merchant City` estão sem acentos e caracteres especiais (exigência do padrão PIX).
- Validar se o valor está sendo passado com ponto decimal fixo em 2 casas.
- Assegurar que o `additionalData` (campo 62) esteja formatado corretamente.

## Próximos Passos

1. Atualizar a Edge Function `supabase/functions/generate-invoice-pdf/index.ts`.
2. Atualizar o Hook `src/hooks/useInvoicePDF.ts` com o novo design.
3. Testar a geração e verificar visualmente.
