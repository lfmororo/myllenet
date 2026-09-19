# Alerta de inatividade do agente

## Objetivo
Notificar o administrador pelo WhatsApp quando um agente ativo ficar mais de 2 minutos sem enviar dados.

## Implementação
- Fortalecer a verificação existente para incluir agentes que nunca se comunicaram.
- Confirmar o sucesso real do envio antes de registrar o alerta, permitindo nova tentativa quando o WhatsApp falhar.
- Evitar mensagens repetidas durante a mesma indisponibilidade e liberar um novo alerta após o agente voltar a comunicar.
- Manter a verificação automática existente a cada 5 minutos.

## Validação
- Implantar a função atualizada.
- Executar uma verificação controlada e conferir o resultado e os registros da função.
