import Fastify from "fastify";
import cors from "@fastify/cors";
import jwt from "@fastify/jwt";
import { config } from "./config.js";
import { randomUUID } from "node:crypto";
import { queryOne, execute, query } from "./db.js";
import { registerAuthRoutes } from "./routes/auth.js";
import { registerRestRoutes } from "./routes/rest.js";
import { registerRpcRoutes } from "./routes/rpc.js";
import { registerFunctionRoutes } from "./routes/functions.js";
import { registerJobs } from "./jobs.js";

declare module "fastify" {
  interface FastifyInstance {
    authenticate: (req: any, reply: any) => Promise<void>;
    requireAdmin: (req: any, reply: any) => Promise<void>;
  }
  interface FastifyRequest {
    userId: string;
    userRole: "admin" | "user";
  }
}

const app = Fastify({ logger: false, bodyLimit: 20 * 1024 * 1024 });

await app.register(cors, { origin: true, credentials: true });
await app.register(jwt, { secret: config.jwtSecret });

app.setErrorHandler((error, req, reply) => {
  const err = error as Error & { statusCode?: number };
  console.error(`[error] ${req.method} ${req.url}:`, err.message);
  reply.code(err.statusCode || 500).send({ error: err.message || "Erro interno" });
});

app.decorate("authenticate", async (req: any, reply: any) => {
  try {
    const token = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
    if (!token) throw new Error("missing");
    const payload = await req.jwtVerify();
    req.userId = payload.sub;
    req.userRole = payload.role || "user";
  } catch {
    return reply.code(401).send({ error: "Não autenticado" });
  }
});

app.decorate("requireAdmin", async (req: any, reply: any) => {
  try {
    const token = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
    if (!token) throw new Error("missing");
    const payload = await req.jwtVerify();
    req.userId = payload.sub;
    req.userRole = payload.role || "user";
    if (req.userRole !== "admin") return reply.code(403).send({ error: "Acesso restrito a administradores" });
  } catch {
    return reply.code(401).send({ error: "Não autenticado" });
  }
});

// Guarda global para as rotas internas
app.addHook("preHandler", async (req, reply) => {
  const path = req.url.split("?")[0];
  const cronSecret = req.headers["x-cron-secret"] as string;
  const isCron = !!config.cronSecret && cronSecret === config.cronSecret;
  const publicPaths = [
    "/api/auth/signup", "/api/auth/login",
    "/api/public/feedback", "/api/public/invoice",
    "/api/functions/mercadopago/webhook",
    "/api/functions/mikrotik-agent-ingest",
  ];
  if (publicPaths.some((p) => path === p || path.startsWith(p + "/"))) return;
  if (path === "/health" || path === "/api/health") return;
  if (!path.startsWith("/api/")) return;
  if (isCron && path.startsWith("/api/functions/")) return;

  if (path.startsWith("/api/rest/")) {
    if (path.endsWith("/select")) return await app.authenticate(req, reply);
    return await app.requireAdmin(req, reply);
  }
  if (path.startsWith("/api/rpc/")) {
    if (path.endsWith("/check_and_block_overdue_customers")) return await app.requireAdmin(req, reply);
    return await app.authenticate(req, reply);
  }
  if (path.startsWith("/api/functions/")) return await app.requireAdmin(req, reply);
  if (path.startsWith("/api/auth/")) return await app.authenticate(req, reply);
});

app.get("/health", async () => ({ ok: true }));

// Rotas públicas
app.post("/api/public/feedback", async (req, reply) => {
  const body = (req.body ?? {}) as any;
  const { nome, telefone, rating, tipo, mensagem } = body;
  const id = randomUUID();
  await execute(
    "INSERT INTO customer_feedback (id, nome, telefone, rating, tipo, mensagem) VALUES (?,?,?,?,?,?)",
    [id, nome ?? null, telefone ?? null, Number(rating) || 5, tipo || "satisfacao", mensagem ?? null]
  );
  return { success: true, id };
});

app.get("/api/public/invoice/:id", async (req, reply) => {
  const { id } = req.params as any;
  const invoice = await queryOne<Record<string, any>>(
    `SELECT i.*, c.nome, c.cpf, c.telefone, c.bairro, c.cidade FROM invoices i JOIN customers c ON c.id = i.customer_id WHERE i.id = ?`,
    [id]
  );
  if (!invoice) return reply.code(404).send({ error: "Fatura não encontrada" });
  const settings = await query<Record<string, any>[]>("SELECT `key`, value FROM settings WHERE `key` IN ('pix_key','pix_name','pix_city')");
  const pixSettings: Record<string, string> = {};
  for (const s of settings) pixSettings[s.key] = s.value ?? "";
  return {
    invoice: {
      ...invoice,
      customers: { nome: invoice.nome, cpf: invoice.cpf, telefone: invoice.telefone, bairro: invoice.bairro, cidade: invoice.cidade },
    },
    settings: pixSettings,
  };
});

await registerAuthRoutes(app);
await registerRestRoutes(app);
await registerRpcRoutes(app);
await registerFunctionRoutes(app);

registerJobs(app);

const start = async () => {
  try {
    await app.listen({ port: config.port, host: "0.0.0.0" });
    console.log(`myllenet-api listening on :${config.port}`);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
};

start();
