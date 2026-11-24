#!/usr/bin/env bash
# 03 — Copia os arquivos do Storage da Lovable para o Supabase do MyLLENET
# Usa o login de um usuário admin do sistema (no backend antigo) para conseguir
# baixar também o bucket privado certificates (certificado .p12 da Efí).
set -euo pipefail
cd "$(dirname "$0")"
source ./config.env
SERVICE_ROLE_KEY=$(envget SERVICE_ROLE_KEY)
LISTA="$BASE/restore/objetos.tsv"
[ -f "$LISTA" ] || { echo "rode o 02-restaurar-banco.sh primeiro"; exit 1; }

# o host *.supabase.co do .env do repo pode não ser mais o backend real: confere e,
# se não responder, descobre pelo bundle do app publicado na Lovable
if ! curl -fsS -m 10 -o /dev/null "$OLD_URL/auth/v1/health" -H "apikey: $OLD_ANON"; then
  echo "  $OLD_URL não respondeu — procurando o backend no app publicado ($OLD_APP)"
  JS=$(curl -fsS -m 20 "$OLD_APP/" | grep -oE '/assets/index-[^"]+\.js' | head -n1)
  [ -n "$JS" ] || { echo "não achei o bundle do app"; exit 1; }
  BUNDLE=$(curl -fsS -m 60 "$OLD_APP$JS")
  OLD_URL=$(printf '%s' "$BUNDLE" | grep -oE 'https://[a-z0-9]{20}\.supabase\.co' | head -n1)
  OLD_ANON=$(printf '%s' "$BUNDLE" | grep -oE 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+' | head -n1)
  [ -n "$OLD_URL" ] && [ -n "$OLD_ANON" ] || { echo "não achei a URL/chave do backend no bundle"; exit 1; }
  echo "  backend real: $OLD_URL"
fi

echo "Login de um usuário ADMIN do sistema (o mesmo de hoje na Lovable):"
read -rp "  e-mail: " OLD_EMAIL
read -rsp "  senha: " OLD_PASS; echo

OLD_URL="$OLD_URL" OLD_ANON="$OLD_ANON" OLD_EMAIL="$OLD_EMAIL" OLD_PASS="$OLD_PASS" \
NEW_URL="http://127.0.0.1:$PORTA_API" NEW_KEY="$SERVICE_ROLE_KEY" LISTA="$LISTA" \
python3 - <<'PY'
import json, os, sys, urllib.request, urllib.parse, urllib.error
E = os.environ
def req(url, data=None, headers=None, method=None):
    r = urllib.request.Request(url, data=data, headers=headers or {}, method=method)
    return urllib.request.urlopen(r, timeout=120)

token = None
try:
    r = req(f"{E['OLD_URL']}/auth/v1/token?grant_type=password",
            json.dumps({"email": E["OLD_EMAIL"], "password": E["OLD_PASS"]}).encode(),
            {"apikey": E["OLD_ANON"], "Content-Type": "application/json"})
    token = json.load(r)["access_token"]
    print("  login no backend antigo: ok")
except urllib.error.HTTPError as e:
    print(f"  login falhou ({e.code}) — vou tentar só os buckets públicos")

ok = falhou = 0
falhas = []
for linha in open(E["LISTA"], encoding="utf-8"):
    linha = linha.rstrip("\n")
    if not linha or "\t" not in linha:
        continue
    bucket, name = linha.split("\t", 1)
    if name.endswith(".emptyFolderPlaceholder"):
        continue
    path = f"{urllib.parse.quote(bucket)}/{urllib.parse.quote(name)}"
    dado = ctype = None
    tentativas = []
    if token:
        tentativas.append((f"{E['OLD_URL']}/storage/v1/object/authenticated/{path}",
                           {"apikey": E["OLD_ANON"], "Authorization": f"Bearer {token}"}))
    tentativas.append((f"{E['OLD_URL']}/storage/v1/object/public/{path}", {}))
    for url, h in tentativas:
        try:
            r = req(url, headers=h)
            dado, ctype = r.read(), r.headers.get("Content-Type", "application/octet-stream")
            break
        except urllib.error.HTTPError:
            pass
    if dado is None:
        falhou += 1; falhas.append(f"{bucket}/{name}"); continue
    try:
        req(f"{E['NEW_URL']}/storage/v1/object/{path}", dado,
            {"apikey": E["NEW_KEY"], "Authorization": f"Bearer {E['NEW_KEY']}",
             "Content-Type": ctype, "x-upsert": "true"}, method="POST")
        ok += 1
    except urllib.error.HTTPError as e:
        falhou += 1; falhas.append(f"{bucket}/{name} (upload {e.code}: {e.read()[:120]!r})")
print(f"\n  copiados: {ok}   falharam: {falhou}")
for f in falhas[:30]:
    print("   -", f)
PY
echo
echo "Próximo passo:  ./04-frontend.sh"
