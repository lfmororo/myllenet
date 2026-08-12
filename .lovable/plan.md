# Plan: Monitoramento de Recursos Mikrotik (CPU, Memória, Temperatura)

Implementar o monitoramento de recursos de hardware do Mikrotik, exibindo CPU, uso de memória e temperatura no dashboard e na página do Mikrotik.

## Alterações no Backend (Edge Functions)

### 1. Atualizar `mikrotik-status`
- Modificar a função para consultar o endpoint `/rest/system/resource` e `/rest/system/health` (se disponível) do Mikrotik.
- Retornar `cpu_load`, `free_memory`, `total_memory`, `uptime` e `temperature`.
- Salvar esses dados na tabela `wan_logs` ou uma nova tabela de telemetria para histórico. *Decisão: Usaremos a tabela `wan_logs` estendendo suas colunas ou criando `mikrotik_resources_logs`.*

## Alterações no Banco de Dados

### 1. Nova Tabela `mikrotik_resources_logs`
- Criar tabela para armazenar o histórico de recursos.
- Colunas: `id`, `cpu_load`, `free_memory`, `total_memory`, `temperature`, `uptime`, `created_at`.
- Garantir permissões e RLS.

## Alterações no Frontend

### 1. Dashboard (`DashboardHome.tsx`)
- Adicionar cards de métricas rápidas para CPU, Memória e Temperatura.

### 2. Página Mikrotik (`MikrotikPage.tsx`)
- Adicionar uma nova seção de "Saúde do Sistema" com gráficos de linha para CPU e Temperatura ao longo do tempo.

## Detalhes Técnicos
- Endpoint Mikrotik REST: `GET /rest/system/resource`
- Cálculo de Memória: `((total - free) / total) * 100` para porcentagem.
- Frequência de atualização: Mesma da `mikrotik-status` (já agendada).

