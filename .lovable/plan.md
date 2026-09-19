# Quadro de conexões PPPoE recentes

## Objetivo
Adicionar ao menu Mikrotik um quadro que mostre as conexões e desconexões mais recentes dos clientes.

## Implementação
- Criar um quadro na tela de gestão Mikrotik com uma lista cronológica dos eventos mais recentes.
- Exibir cliente, usuário PPPoE, endereço IP, data/hora e situação “Conectou” ou “Desconectou”.
- Usar cores e ícones distintos para facilitar a leitura dos dois tipos de evento.
- Mostrar estados de carregamento e lista vazia.
- Atualizar automaticamente quando um novo evento for registrado, sem recarregar a página.

## Detalhes técnicos
- Ler os eventos `connected` e `disconnected` já registrados no histórico PPPoE, vinculando cada registro ao cliente.
- Limitar a consulta aos registros mais recentes e ordenar do mais novo para o mais antigo.
- Manter o quadro dentro da página atual `/mikrotik`, seguindo os componentes e cores existentes.
- Validar a compilação e a apresentação no desktop atual.
