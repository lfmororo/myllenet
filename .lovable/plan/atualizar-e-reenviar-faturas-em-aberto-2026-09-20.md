# Atualizar e reenviar faturas em aberto

## Objetivo
Atualizar o PDF de todas as faturas ainda não pagas e reenviá-las aos clientes pelo WhatsApp.

## Implementação
- Calcular as métricas reais no mês de vencimento de cada fatura, respeitando reinícios dos contadores PPPoE.
- Exibir no PDF: download, upload, quantidade de desconexões, tempo total conectado e tempo total sem conexão.
- Corrigir o sentido dos dados: tráfego enviado pelo roteador é download do cliente; tráfego recebido é upload.
- Criar um processamento em lotes para faturas pendentes, vencidas ou aguardando pagamento, evitando duplicações e registrando sucessos e falhas.
- Regerar e reenviar o PDF atualizado pelo provedor de WhatsApp configurado, mantendo o aviso de mensagem automática.
- Validar o PDF, os cálculos e o envio antes de processar toda a base.

## Regras
- Período das métricas: mês da data de vencimento da fatura, limitado à data atual quando o mês ainda não terminou.
- Tempos apresentados como totais do período, não médias por sessão.
- Faturas pagas e canceladas não serão reenviadas.
