# Plano: Monitoramento de Recursos Mikrotik (CPU, Memória, Temperatura)

Implementar o monitoramento de recursos de hardware do Mikrotik, exibindo CPU, uso de memória e temperatura no dashboard e na página do Mikrotik.

## Alterações no Backend (Edge Functions)

### 1. Atualizar `mikrotik-status`
- Consultar `/rest/system/resource` e `/rest/system/health`.
- Retornar `cpu_load`, `free_memory`, `total_memory`, `uptime` e `temperature`.
- Salvar esses dados na tabela `wan_logs` (adicionando novas colunas) ou `mikrotik_status_history`.

## Alterações no Banco de Dados

### 1. Atualizar Tabela `wan_logs`
- Adicionar colunas: `cpu_load` (float), `free_memory` (bigint), `total_memory` (bigint), `temperature` (float).
- Isso permite correlacionar tráfego com carga do roteador nos mesmos gráficos.

## Alterações no Frontend

### 1. Dashboard (`DashboardHome.tsx`)
- Adicionar mini-cards ou badges para CPU e Temperatura junto ao status do Mikrotik.

### 2. Página Mikrotik (`MikrotikPage.tsx`)
- Adicionar cards de hardware (CPU, RAM, Temperatura, Uptime).
- Adicionar gráfico de linha para CPU e Temperatura no monitoramento.

## Detalhes Técnicos
- Endpoint Mikrotik REST: `GET /rest/system/resource` e `GET /rest/system/health`.
- Frequência: 10s (tempo real) e persistência via cron (5min).
