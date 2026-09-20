# Plano: proteção de dados e nova identidade nas faturas

## Alterações
- Mascarar CPF/CNPJ e endereço do cliente na página pública da fatura e nos dois formatos de PDF.
- Manter somente dados parciais suficientes para o cliente reconhecer a própria cobrança, sem expor o cadastro completo.
- Exibir a mensagem institucional **“MylleNet agora é Mororo.Tech”** no cabeçalho e no rodapé das faturas.
- Preservar valor, vencimento, descrição, plano, consumo e dados de pagamento.

## Detalhes técnicos
- Centralizar regras equivalentes de máscara nos geradores do navegador e do servidor.
- CPF: ocultar os dígitos centrais; CNPJ: ocultar o miolo.
- Endereço: ocultar número e reduzir os dados exibidos ao bairro/cidade quando disponíveis.
- Atualizar apenas as apresentações de fatura, sem alterar o cadastro original do cliente.
- Validar a compilação e a geração visual da página pública e do PDF.
