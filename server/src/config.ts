import "dotenv/config";

export const config = {
  db: {
    host: process.env.DB_HOST || "127.0.0.1",
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || "myllenet",
    password: process.env.DB_PASSWORD || "",
    database: process.env.DB_NAME || "myllenet",
  },
  port: Number(process.env.PORT || 3333),
  jwtSecret: process.env.JWT_SECRET || "dev-secret-change-me",
  cronSecret: process.env.CRON_SECRET || "",
  appBaseUrl: process.env.APP_BASE_URL || "http://localhost:5173",
  efi: {
    clientId: process.env.EFI_CLIENT_ID || "",
    clientSecret: process.env.EFI_CLIENT_SECRET || "",
    certFile: process.env.EFI_CERT_FILE || "",
  },
  mercadopago: {
    accessToken: process.env.MERCADOPAGO_ACCESS_TOKEN || "",
  },
  whatsapp: {
    provider: process.env.WHATSAPP_PROVIDER || "uazapi",
    uazapiBaseUrl: process.env.UAZAPI_BASE_URL || "https://ipazua.uazapi.com",
    uazapiToken: process.env.UAZAPI_TOKEN || "",
    evolutionBaseUrl: process.env.EVOLUTION_BASE_URL || "",
    evolutionApiKey: process.env.EVOLUTION_API_KEY || "",
    evolutionInstance: process.env.EVOLUTION_INSTANCE || "",
  },
  agentToken: process.env.AGENT_TOKEN || "",
};
