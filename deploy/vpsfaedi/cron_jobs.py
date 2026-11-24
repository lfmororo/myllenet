#!/usr/bin/env python3
"""Gera o SQL que recria os jobs do pg_cron do MyLLENET apontando para a API nova.

Fonte dos jobs, nesta ordem:
  1) os dados de cron.job que vieram no backup da Lovable (cron.sql, gerado por
     `pg_restore --data-only -n cron -t job`), se existirem;
  2) senão, a lista conhecida das migrations do repo (estado final).

Em cada comando:
  - https://<projeto antigo>.supabase.co  → http://kong:8000
  - qualquer JWT (anon/service antigos)    → SERVICE_ROLE_KEY nova
  - valor do header x-cron-secret          → CRON_SECRET novo

uso: cron_jobs.py cron.sql saida.sql   (variáveis: OLD_URL, SERVICE_ROLE_KEY, CRON_SECRET)
"""
import os
import re
import sys

entrada, saida = sys.argv[1:3]
OLD_URL = os.environ["OLD_URL"].rstrip("/")
SERVICE = os.environ["SERVICE_ROLE_KEY"]
CRON_SECRET = os.environ.get("CRON_SECRET", "")

def http_post(fn):
    return ("select net.http_post(url := 'http://kong:8000/functions/v1/%s', "
            "headers := '{\"Content-Type\": \"application/json\", \"Authorization\": \"Bearer %s\"}'::jsonb, "
            "body := '{}'::jsonb) as request_id;" % (fn, SERVICE))

CONHECIDOS = [
    ("auto-block-overdue-30d", "0 4 * * *", http_post("auto-block-30d")),
    ("bulk-check-payments-every-15min", "*/15 * * * *", http_post("efi-boleto/bulk-check")),
    ("check-overdue-blocking", "0 2 * * *", "SELECT public.check_and_block_overdue_customers()"),
    ("mikrotik-sync-every-15min", "*/15 * * * *", http_post("mikrotik-sync")),
    ("mikrotik-periodic-metrics", "0 * * * *", http_post("mikrotik-speedtest")),
    ("mikrotik-sync-logs", "*/5 * * * *", http_post("mikrotik-sync-logs")),
    ("nightly-log-cleanup", "30 6 * * *", "SELECT public.cleanup_old_logs();"),
]

def copy_unescape(v):
    if v == r"\N":
        return None
    out, i = [], 0
    esc = {"n": "\n", "t": "\t", "r": "\r", "b": "\b", "f": "\f", "v": "\v", "\\": "\\"}
    while i < len(v):
        c = v[i]
        if c == "\\" and i + 1 < len(v):
            out.append(esc.get(v[i + 1], v[i + 1])); i += 2
        else:
            out.append(c); i += 1
    return "".join(out)

jobs = []
if os.path.exists(entrada):
    COPY_RE = re.compile(r'^COPY\s+"?cron"?\."?job"?\s*\((.*)\)\s+FROM\s+stdin;')
    with open(entrada, encoding="utf-8") as f:
        it = iter(f)
        for linha in it:
            m = COPY_RE.match(linha)
            if not m:
                continue
            cols = [c.strip().strip('"') for c in m.group(1).split(",")]
            for l in it:
                l = l.rstrip("\n")
                if l == r"\.":
                    break
                rec = dict(zip(cols, (copy_unescape(x) for x in l.split("\t"))))
                if rec.get("active") in ("f", "false"):
                    continue
                nome = rec.get("jobname") or f"job-{rec.get('jobid')}"
                jobs.append((nome, rec["schedule"], rec["command"]))

origem = "backup da Lovable" if jobs else "migrations do repo (o backup não trouxe cron.job)"
if not jobs:
    jobs = CONHECIDOS

JWT = re.compile(r"eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+")
SEC = re.compile(r"""(x-cron-secret['"]?\s*(?:,|:)\s*['"])([^'"]*)(['"])""", re.I)

CONHECIDO_POR_NOME = {n: c for n, _, c in CONHECIDOS}

def ajusta(cmd, nome=""):
    # job antigo com "${Deno.env.get(...)}" literal no SQL nunca funcionou: usa o comando conhecido
    if "Deno.env" in cmd and nome in CONHECIDO_POR_NOME:
        return CONHECIDO_POR_NOME[nome]
    cmd = cmd.replace(OLD_URL, "http://kong:8000")
    cmd = JWT.sub(SERVICE, cmd)
    if CRON_SECRET:
        cmd = SEC.sub(lambda m: m.group(1) + CRON_SECRET + m.group(3), cmd)
    return cmd

with open(saida, "w", encoding="utf-8") as out:
    out.write("select cron.unschedule(jobid) from cron.job;\n")
    for nome, sched, cmd in jobs:
        cmd = ajusta(cmd, nome)
        tag = "$cmd$"
        while tag in cmd:
            tag = tag[:-1] + "x$"
        out.write(f"select cron.schedule('{nome}', '{sched}', {tag}{cmd}{tag});\n")

print(f"  {len(jobs)} jobs de cron ({origem}):")
for nome, sched, _ in jobs:
    print(f"   - {nome}  [{sched}]")
