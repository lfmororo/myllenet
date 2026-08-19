# Plano de Correção: Monitoramento Mikrotik (Agente VPS)

O usuário relatou que o menu de gestão do Mikrotik mostra o dispositivo como "desconectado" e não exibe as informações coletadas pelo Agente VPS, apesar do agente estar rodando. O objetivo é unificar a visualização de status para priorizar os dados do agente quando disponíveis e garantir que o painel reflita a realidade da rede.

## Alterações Propostas

### 1. Backend (Edge Functions)
- **`mikrotik-status`**:
    - Ajustar para que, se a conexão direta da Edge Function falhar, ela retorne `online: true` se houver um agente ativo (`agent_tokens.last_seen_at < 2 min`).
    - Incluir no retorno qual fonte de dados está sendo usada (Direta vs Agente).
- **`mikrotik-agent-ingest`**:
    - Garantir que cada ingestão do agente também atualize o `mikrotik_status_history` para manter o componente `MikrotikHostStatus` atualizado.

### 2. Frontend (Interface)
- **`MikrotikPage.tsx`**:
    - Alterar o card principal de status para indicar se a conexão é via "Nuvem (Direta)" ou "Agente VPS".
    - Exibir um aviso claro se a conexão direta estiver offline mas o agente estiver online, explicando que as métricas vêm da VPS.
    - Sincronizar os contadores de hardware (CPU, RAM, Temp) para usar os logs mais recentes da tabela `wan_logs` (que o agente preenche) caso o `status` direto falhe.
- **`MikrotikHostStatus.tsx`**:
    - Melhorar o feedback visual para destacar qual host o sistema está usando como principal no momento.

### 3. Melhoria na Estabilidade
- Ajustar `useMikrotikLogs.tsx` para garantir que o agrupamento de logs por tempo não descarte dados válidos do agente devido a pequenas variações de milissegundos.

## Detalhes Técnicos
- Utilizaremos a tabela `agent_tokens` para verificar a saúde do agente.
- A função `mikrotik-status` será o hub de decisão: Direct Connection (Fallback) -> Agent Data (Primary for metrics).
- Adição de um campo `source` no objeto de status para o frontend decidir qual ícone/badge mostrar.
