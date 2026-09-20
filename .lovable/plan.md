# Plano: Módulo de Relatórios

## Resultado
Criar o menu **Relatórios** com sete relatórios operacionais e financeiros. Cada visão terá filtros próprios, busca, paginação, totalizadores, visualização em tela, impressão e exportação em PDF, Excel e CSV.

## Dados e cadastros
- Complementar clientes com vendedor, forma de pagamento, concentrador/POP e data de cancelamento.
- Complementar cobranças com meio de pagamento, taxa e valor líquido; manter gateway e status atuais.
- Atualizar os formulários de cliente e cobrança para registrar esses campos.
- Aproveitar o histórico de bloqueios para data e motivo, os registros PPPoE para consumo e os dados atuais de planos, clientes e cobranças.
- Dados antigos sem preenchimento aparecerão como **Não informado**, sem inventar valores.

## Permissões
- Administradores terão acesso integral aos sete relatórios.
- Usuários comuns poderão receber acesso individual a cada relatório.
- Criar uma tabela separada de permissões por usuário, sem armazenar permissões no perfil.
- Incluir os seletores de acesso na gestão de usuários e proteger tanto a navegação quanto a leitura dos dados.

## Relatórios
1. **Clientes em atraso** — faixas de atraso, plano, cidade/bairro e vendedor; quantidade e valor em aberto.
2. **Clientes bloqueados** — motivo e período do bloqueio; valor em aberto e dias bloqueado.
3. **Clientes** — situação, plano, cadastro, localização e forma de pagamento; dados pessoais completos para usuários autorizados.
4. **Financeiro** — agrupamento diário, mensal ou anual; faturado, recebido, aberto, vencido e cancelado; gráfico comparativo e consolidados.
5. **Consumo de banda** — geral, por cliente e período; plano, POP e ranking Top N; download, upload, total, média e pico.
6. **Clientes sem fatura** — competência, plano e situação; última fatura e dados de vencimento.
7. **Cobranças por plataforma** — gateway/meio, status, quantidade, bruto, taxas, líquido, ticket médio e participação.

## Interface e exportações
- Página única com seletor de relatório, filtros contextuais, resumo, gráfico quando aplicável e tabela paginada.
- Busca por texto e ordenação coerente com cada relatório.
- Exportação dos resultados filtrados em PDF, XLSX e CSV.
- Cabeçalho padrão com logo, Mororo.Tech, relatório, filtros aplicados, data/hora e usuário emissor.
- Impressão com o mesmo cabeçalho e ocultação dos controles da tela.

## Implementação técnica
- Criar consultas agregadas seguras no banco para cálculos e acesso eficiente, com políticas por relatório.
- Criar utilitários compartilhados para períodos, moeda, bytes, paginação e os quatro formatos de saída.
- Usar a identidade visual existente e componentes atuais de filtros, tabelas, calendário e gráficos.
- Adicionar testes para cálculos centrais, filtros, permissões e exportações; validar visualmente em desktop e celular.
