import { useEffect } from "react";
import { MikrotikAgentCard } from "@/components/MikrotikAgentCard";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Activity, Cpu, HardDrive, ShieldCheck, Terminal, Wifi } from "lucide-react";

function Code({ children }: { children: React.ReactNode }) {
  return (
    <pre className="overflow-x-auto rounded-md bg-muted p-3 text-xs leading-relaxed">
      <code>{children}</code>
    </pre>
  );
}

const steps = [
  {
    n: 1,
    title: "Prepare o Mikrotik",
    body: (
      <div className="space-y-3">
        <p className="text-sm text-muted-foreground">
          O agente utiliza a API REST do RouterOS (v7). Habilite o serviço <strong>www</strong> e
          libere o acesso apenas para o IP da sua VPS.
        </p>
        <Code>{`/ip service enable www
/ip service set www port=80
/ip firewall filter add chain=input action=accept protocol=tcp \\
  dst-port=80 src-address=IP_DA_SUA_VPS comment="Agente VPS"`}</Code>
        <p className="text-xs text-muted-foreground">
          Recomendado: usar um usuário dedicado no RouterOS com permissão de leitura (grupo{" "}
          <code>read</code>) para a coleta.
        </p>
      </div>
    ),
  },
  {
    n: 2,
    title: "Confirme os dados nas Configurações",
    body: (
      <p className="text-sm text-muted-foreground">
        Em <strong>Configurações → Mikrotik</strong>, preencha o IP/Host preferencial, o secundário
        (opcional), usuário, senha e a porta REST. Esses valores são gravados automaticamente no{" "}
        <code>.env</code> do pacote no momento do download — não é preciso editar nada depois.
      </p>
    ),
  },
  {
    n: 3,
    title: "Crie o agente e baixe o pacote",
    body: (
      <p className="text-sm text-muted-foreground">
        No painel abaixo, defina o nome, o intervalo de coleta e as interfaces WAN, clique em{" "}
        <strong>Criar novo agente</strong> e depois em <strong>Baixar pacote</strong>. O ZIP já vem
        com token exclusivo, credenciais e serviço systemd prontos.
      </p>
    ),
  },
  {
    n: 4,
    title: "Instale na VPS",
    body: (
      <div className="space-y-3">
        <p className="text-sm text-muted-foreground">
          Envie o ZIP para a VPS (por exemplo com <code>scp</code>) e rode o instalador. Ele
          verifica/instala o Node.js, cria o serviço e inicia a coleta.
        </p>
        <Code>{`scp mikrotik-agent-*.zip root@SUA_VPS:/root/

# na VPS:
apt-get update && apt-get install -y unzip curl
unzip mikrotik-agent-*.zip -d /opt
cd /opt/mikrotik-agent
sudo bash install.sh`}</Code>
      </div>
    ),
  },
  {
    n: 5,
    title: "Instalação no Windows (Opcional)",
    body: (
      <div className="space-y-3">
        <p className="text-sm text-muted-foreground">
          Caso prefira rodar o agente em um servidor Windows em vez de Linux:
        </p>
        <ul className="list-decimal space-y-2 pl-5 text-sm text-muted-foreground">
          <li>
            Instale o <strong>Node.js (LTS)</strong> em{" "}
            <a
              href="https://nodejs.org/"
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary underline"
            >
              nodejs.org
            </a>
            .
          </li>
          <li>Extraia o pacote em uma pasta (ex: <code>C:\mikrotik</code>).</li>
          <li>
            Abra o <strong>PowerShell</strong> como Administrador, navegue até a pasta e execute:
            <Code>{`node agent.js`}</Code>
          </li>
          <li>
            <strong>Dica de Erro:</strong> Se encontrar o erro <code>MODULE_NOT_FOUND</code>, certifique-se de que está na pasta correta e que o arquivo <code>agente.js</code> existe nela.
            <Code>{`PS C:\\mikrotik> node agente.js

node:internal/modules/cjs/loader:1520
  throw err;
  ^
Error: Cannot find module 'C:\\mikrotik\\agente.js'
...
Node.js v24.19.0`}</Code>
          </li>
          <li>
            Para instalar como serviço permanente, use o utilitário <code>qckwinsvc</code>:
            <Code>{`npm install -g qckwinsvc
qckwinsvc`}</Code>
            Aponte para o arquivo <code>agent.js</code> na pasta extraída.
          </li>
        </ul>
        <p className="text-xs text-muted-foreground">
          Veja o arquivo <strong>WINDOWS.md</strong> dentro do pacote para detalhes completos.
        </p>
      </div>
    ),
  },
  {
    n: 6,
    title: "Valide a coleta",
    body: (
      <div className="space-y-3">
        <p className="text-sm text-muted-foreground">
          Acompanhe os logs (no Linux use <code>journalctl</code>) e confirme no painel abaixo que o agente ficou{" "}
          <Badge className="bg-primary/15 text-primary hover:bg-primary/15">Online</Badge> com a
          data da última coleta. Os dados aparecem na página <strong>Mikrotik</strong> e no
          Dashboard.
        </p>
        <Code>{`# No Linux (Systemd):
systemctl status mikrotik-agent
journalctl -u mikrotik-agent -f`}</Code>
      </div>
    ),
  },
];

const collected = [
  { icon: Wifi, title: "Tráfego WAN", desc: "Download/upload em Mbps por interface, com contadores de bytes." },
  { icon: Cpu, title: "CPU e temperatura", desc: "Carga do processador e temperatura do equipamento." },
  { icon: HardDrive, title: "Memória", desc: "Memória livre e total do RouterOS." },
  { icon: Activity, title: "Sessões PPPoE", desc: "Clientes conectados, IP, uptime e consumo por sessão." },
];

export default function AgentPage() {
  useEffect(() => {
    document.title = "Agente Mikrotik | Download e Instalação";
    const desc = document.querySelector('meta[name="description"]');
    desc?.setAttribute(
      "content",
      "Baixe o agente Node.js já configurado para coletar métricas do Mikrotik na sua VPS e siga o tutorial de instalação.",
    );
  }, []);

  return (
    <div className="space-y-6">


      <header className="space-y-1">
        <h1 className="text-2xl font-bold tracking-tight">Agente de Monitoramento Mikrotik</h1>
        <p className="text-sm text-muted-foreground">
          Download do agente pré-configurado para sua VPS e tutorial completo de instalação.
        </p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">O que o agente coleta</CardTitle>
          <CardDescription>
            Rodando na sua VPS, o agente mantém uma conexão estável com o Mikrotik e envia amostras
            em intervalos configuráveis (a partir de 5 segundos).
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {collected.map((item) => (
            <div key={item.title} className="rounded-lg border p-3">
              <item.icon className="mb-2 h-5 w-5 text-primary" />
              <p className="text-sm font-medium">{item.title}</p>
              <p className="text-xs text-muted-foreground">{item.desc}</p>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Terminal className="h-5 w-5" /> Tutorial de instalação
          </CardTitle>
          <CardDescription>O sistema enviará um alerta via WhatsApp caso o agente fique mais de 2 minutos sem se comunicar.</CardDescription>
        </CardHeader>
        <CardContent>
          <Accordion type="single" collapsible defaultValue="step-1" className="w-full">
            {steps.map((step) => (
              <AccordionItem key={step.n} value={`step-${step.n}`}>
                <AccordionTrigger className="text-left">
                  <span className="flex items-center gap-3">
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/15 text-xs font-semibold text-primary">
                      {step.n}
                    </span>
                    {step.title}
                  </span>
                </AccordionTrigger>
                <AccordionContent>{step.body}</AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        </CardContent>
      </Card>

      <MikrotikAgentCard />

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <ShieldCheck className="h-5 w-5" /> Segurança e manutenção
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm text-muted-foreground">
          <p>
            Cada agente possui um token exclusivo, usado apenas para enviar métricas. Revogar o
            token no painel acima interrompe imediatamente o envio daquele agente.
          </p>
          <Separator />
          <div className="space-y-2">
            <p className="font-medium text-foreground">Comandos do dia a dia</p>
            <Code>{`systemctl restart mikrotik-agent   # aplicar mudanças no .env
systemctl stop mikrotik-agent      # pausar a coleta
journalctl -u mikrotik-agent -n 50 # últimas 50 linhas de log`}</Code>
          </div>
          <Separator />
          <div className="space-y-1">
            <p className="font-medium text-foreground">Se algo não funcionar</p>
            <ul className="list-disc space-y-1 pl-5">
              <li>
                <strong>Nenhum host respondeu</strong>: verifique o serviço www no RouterOS e a
                liberação da porta para o IP da VPS.
              </li>
              <li>
                <strong>Token inválido</strong>: o agente foi revogado no sistema — baixe um novo
                pacote.
              </li>
              <li>
                <strong>Sem sessões PPPoE</strong>: o usuário PPPoE do Mikrotik precisa ser igual ao
                cadastrado no cliente.
              </li>
              <li>
                Se o envio falhar, as amostras ficam em <code>queue.json</code> e são reenviadas
                automaticamente no próximo ciclo.
              </li>
            </ul>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
