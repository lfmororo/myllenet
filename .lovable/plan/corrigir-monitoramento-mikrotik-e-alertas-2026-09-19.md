# Corrigir monitoramento Mikrotik e alertas

## Objetivo
Fazer o painel refletir as sessões PPPoE realmente coletadas e garantir avisos de bloqueio, desbloqueio e desconexão pelo WhatsApp configurado.

## Implementação
1. **Coleta e painel de clientes online**
   - Corrigir o agente para registrar corretamente a duração da conexão e o resultado da leitura das sessões PPPoE.
   - Diferenciar “agente comunicando” de “Mikrotik conectado”, evitando mostrar o roteador online apenas porque o agente enviou um sinal.
   - No retorno via agente, contar clientes únicos vistos na amostra mais recente e preencher também a lista de clientes online.
   - Exibir diagnóstico quando a coleta PPPoE falhar, em vez de mostrar zero silenciosamente.

2. **Detecção de desconexão**
   - Comparar as amostras recentes do agente e considerar desconectado somente o cliente que estava online e deixou de aparecer por pelo menos 5 minutos.
   - Evitar alertas repetidos no intervalo configurado.
   - Enviar o aviso diretamente pelo provedor de WhatsApp selecionado e só registrar como enviado após confirmação da API.

3. **Bloqueio e desbloqueio**
   - Criar pendências de aviso em todos os caminhos: bloqueio automático, bloqueio/desbloqueio manual e desbloqueio após pagamento.
   - Aceitar registros antigos com estado pendente vazio, além dos marcados como não processados.
   - Processar os avisos separadamente da conexão direta com o Mikrotik, para que uma indisponibilidade do roteador não impeça o WhatsApp.
   - Só marcar o aviso como processado depois do envio confirmado; falhas ficam para nova tentativa.

4. **Execução automática e validação**
   - Ativar uma verificação consolidada a cada 5 minutos para desconexões e avisos pendentes.
   - Corrigir as tarefas antigas que hoje usam endereços/configurações vazios.
   - Publicar as funções alteradas e validar com dados recentes, logs de execução e resposta do painel.

## Observação técnica
A execução a cada 5 minutos ocorre 288 vezes por dia. Esse intervalo permite detectar uma desconexão em cerca de 5–10 minutos; uma execução horária reduziria custo, mas poderia atrasar o aviso em até 1 hora.
