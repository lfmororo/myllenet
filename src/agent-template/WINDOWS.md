# Agente de Monitoramento Mikrotik para Windows
Este guia explica como instalar o agente em ambiente Windows e configurá-lo como um serviço.

## 1. Instalar Node.js
Se você ainda não tem o Node.js instalado:
1. Acesse [nodejs.org](https://nodejs.org/)
2. Baixe e instale a versão **LTS** (Recomendado)
3. Abra o Prompt de Comando (cmd) e verifique a instalação:
   ```cmd
   node -v
   ```

## 2. Instalar o Agente
1. Baixe o pacote `.zip` do agente pelo painel do sistema.
2. Extraia o conteúdo em uma pasta permanente, por exemplo: `C:\mikrotik`.

## 3. Instalar como Serviço (Windows)
Para que o agente inicie automaticamente com o Windows, recomendamos o uso do `qckwinsvc` ou `nssm`.

### Usando qckwinsvc (Simples):
1. Abra o PowerShell ou Prompt de Comando como Administrador.
2. Instale o utilitário:
   ```cmd
   npm install -g qckwinsvc
   ```
3. Registre o serviço:
   ```cmd
   qckwinsvc
   ```
4. Siga as perguntas:
   - Service name: `mikrotik-agent`
   - Service description: `Agente de Monitoramento Mikrotik`
   - Path to node script: `C:\mikrotik\agente.js` (ajuste para sua pasta)

### Usando NSSM (Robusto):
1. Baixe o [nssm.cc](https://nssm.cc/download) e extraia o executável.
2. No Prompt como Administrador:
   ```cmd
   nssm install mikrotik-agent "C:\Program Files\nodejs\node.exe" "C:\mikrotik\agente.js"
   nssm start mikrotik-agent
   ```

## 4. Verificar Logs
Os logs serão exibidos no console se você rodar manualmente:
```cmd
node agente.js
```
Se estiver rodando como serviço, verifique o Visualizador de Eventos do Windows ou o arquivo de log gerado pelo utilitário escolhido.

### Dica de Erro: Cannot find module
Se ao rodar `node agente.js` você receber o erro `MODULE_NOT_FOUND`, verifique se você está na pasta onde o arquivo `agente.js` foi extraído.
```cmd
PS C:\mikrotik> node agente.js

node:internal/modules/cjs/loader:1520
  throw err;
  ^
Error: Cannot find module 'C:\mikrotik\agente.js'
...
Node.js v24.19.0
```
Certifique-se de que o caminho 'C:\mikrotik\agente.js' está correto e que o arquivo existe.
