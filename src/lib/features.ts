// Recursos ligados/desligados por variável de build.
// VITE_MIKROTIK_AGENT=off → sistema fala com o MikroTik só pela API REST (sem agente local).
// Sem a variável (ex.: na Lovable), o agente continua visível.
export const MIKROTIK_AGENT_ENABLED = import.meta.env.VITE_MIKROTIK_AGENT !== "off";
