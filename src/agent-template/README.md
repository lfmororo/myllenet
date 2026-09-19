# Agente Mikrotik - Mororo.Tech

Agente Node.js para rodar em uma VPS. Ele coleta métricas do Mikrotik via SSH
pela VPN e envia para o sistema em intervalos configuráveis.

O arquivo `.env` deste pacote **já vem preenchido** com o host, usuário, senha, porta
e o token exclusivo do agente.

## Requisitos

- Node.js 18 ou superior
- Acesso da VPS ao Mikrotik pela VPN, com a porta SSH liberada

## Instalação rápida

```bash
unzip mikrotik-agent.zip -d /opt/mikrotik-agent
cd /opt/mikrotik-agent
sudo bash install.sh
```

O `install.sh` instala o serviço systemd, habilita o start automático e inicia o agente.

## Comandos úteis

```bash
systemctl status mikrotik-agent      # ver status
journalctl -u mikrotik-agent -f      # ver logs em tempo real
systemctl restart mikrotik-agent     # reiniciar após editar o .env
```

## Teste manual

```bash
node agente.js
```

## Configuração (.env)

| Variável | Descrição |
| --- | --- |
| `SUPABASE_URL` | URL do backend do sistema (já preenchida) |
| `AGENT_TOKEN` | Token exclusivo deste agente (já preenchido) |
| `MIKROTIK_HOST` | IP/host preferencial |
| `MIKROTIK_HOST_SECONDARY` | IP/host secundário (failover automático) |
| `MIKROTIK_USER` / `MIKROTIK_PASSWORD` | Credenciais do RouterOS |
| `MIKROTIK_SSH_PORT` | Porta do serviço SSH (padrão `22`) |
| `INTERVAL_SECONDS` | Intervalo de coleta (mínimo 5s) |
| `WAN_INTERFACES` | Lista de interfaces WAN separadas por vírgula (vazio = detecção automática) |
| `COLLECT_PPPOE` | `true` para coletar sessões PPPoE dos clientes |
| `REQUEST_TIMEOUT_MS` | Timeout de cada chamada ao Mikrotik |

## Segurança

- O token identifica somente este agente e pode ser revogado no sistema
  (Configurações → Agente VPS) sem afetar nada mais.
- No Mikrotik, restrinja o SSH à rede da VPN/VPS.
- Se o envio falhar, o agente guarda as amostras em `queue.json` e reenvia no próximo ciclo.

## Requisitos no Mikrotik

```
/ip service enable ssh
/ip service set ssh port=22
```
