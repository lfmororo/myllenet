import { randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import type { FastifyInstance } from "fastify";
import { query, queryOne, execute } from "../db.js";

export interface AuthUser {
  id: string;
  email: string;
  full_name: string | null;
  phone: string | null;
  role: "admin" | "user";
  report_permissions: string[];
}

export async function getUserAuth(userId: string): Promise<AuthUser | null> {
  const user = await queryOne<Record<string, unknown>>(
    "SELECT id, email, full_name, phone FROM users WHERE id = ?",
    [userId]
  );
  if (!user) return null;
  const roleRow = await queryOne<{ role: string }>(
    "SELECT role FROM user_roles WHERE user_id = ? AND role = 'admin'",
    [userId]
  );
  const perms = await query<{ report_key: string }[]>(
    "SELECT report_key FROM user_report_permissions WHERE user_id = ?",
    [userId]
  );
  return {
    id: user.id as string,
    email: user.email as string,
    full_name: (user.full_name as string) ?? null,
    phone: (user.phone as string) ?? null,
    role: roleRow ? "admin" : "user",
    report_permissions: perms.map((p) => p.report_key),
  };
}

export async function registerAuthRoutes(app: FastifyInstance) {
  app.post<{ Body: { email: string; password: string; full_name?: string } }>(
    "/api/auth/signup",
    async (req, reply) => {
      const { email, password, full_name } = req.body;
      if (!email || !password) return reply.code(400).send({ error: "Email e senha obrigatórios" });
      const existing = await queryOne("SELECT id FROM users WHERE email = ?", [email]);
      if (existing) return reply.code(409).send({ error: "Email já cadastrado" });

      const id = randomUUID();
      const hash = await bcrypt.hash(password, 10);
      await execute("INSERT INTO users (id, email, password_hash, full_name) VALUES (?, ?, ?, ?)", [
        id, email, hash, full_name ?? null,
      ]);
      await execute("INSERT INTO profiles (id, user_id, full_name) VALUES (?, ?, ?)", [
        randomUUID(), id, full_name ?? email,
      ]);

      // primeiro usuário vira admin
      const adminCount = await queryOne<{ c: number }>("SELECT COUNT(*) AS c FROM user_roles WHERE role = 'admin'");
      if (Number(adminCount?.c ?? 0) === 0) {
        await execute("INSERT INTO user_roles (id, user_id, role) VALUES (?, ?, 'admin')", [randomUUID(), id]);
      }

      const user = await getUserAuth(id);
      const token = app.jwt.sign({ sub: id, role: user!.role });
      return { token, user };
    }
  );

  app.post<{ Body: { email: string; password: string } }>(
    "/api/auth/login",
    async (req, reply) => {
      const { email, password } = req.body;
      const row = await queryOne<Record<string, unknown>>(
        "SELECT id, password_hash FROM users WHERE email = ?",
        [email]
      );
      if (!row || !(await bcrypt.compare(password, row.password_hash as string))) {
        return reply.code(401).send({ error: "Credenciais inválidas" });
      }
      await execute("UPDATE users SET last_sign_in_at = NOW() WHERE id = ?", [row.id]);
      const user = await getUserAuth(row.id as string);
      const token = app.jwt.sign({ sub: row.id, role: user!.role });
      return { token, user };
    }
  );

  app.get("/api/auth/me", { onRequest: [app.authenticate] }, async (req) => {
    const user = await getUserAuth(req.userId);
    return { user };
  });
}
