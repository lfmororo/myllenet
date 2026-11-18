# shellcheck shell=bash
# Funções comuns dos scripts de migração (carregado com "source").
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

log()  { printf '\n\033[1;34m==> %s\033[0m\n' "$*"; }
ok()   { printf '\033[1;32m    ok:\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33mAVISO:\033[0m %s\n' "$*" >&2; }
die()  { printf '\033[1;31mERRO:\033[0m %s\n' "$*" >&2; exit 1; }

[ -f "$SCRIPT_DIR/config.env" ] || die "Crie $SCRIPT_DIR/config.env a partir de config.env.example"
# shellcheck disable=SC1091
source "$SCRIPT_DIR/config.env"

[ "$(id -u)" = "0" ] || die "Rode como root (sudo -i)."

need() { command -v "$1" >/dev/null 2>&1 || die "Comando '$1' não encontrado. Instale com: apt-get install -y $2"; }

# Lê uma variável do .env do Supabase do MyLLENET
sb_env() { grep -E "^$1=" "$SB_DIR/.env" | head -n1 | cut -d= -f2-; }

# Define/atualiza VAR=valor num arquivo .env
set_env() {
  local file="$1" var="$2" val="$3"
  if grep -qE "^${var}=" "$file"; then
    # usa | como separador; escapa | e & do valor
    local esc
    esc=$(printf '%s' "$val" | sed -e 's/[|&\\]/\\&/g')
    sed -i -E "s|^${var}=.*$|${var}=${esc}|" "$file"
  else
    printf '%s=%s\n' "$var" "$val" >> "$file"
  fi
}

compose() { (cd "$SB_DIR" && docker compose "$@"); }

# psql dentro do container do banco do MyLLENET
# uso: db_psql <usuario> [args...]   (usuário: postgres ou supabase_admin)
db_psql() {
  local user="$1"; shift
  docker exec -i -e PGPASSWORD="$(sb_env POSTGRES_PASSWORD)" myllenet-db \
    psql -v ON_ERROR_STOP=1 -h 127.0.0.1 -U "$user" -d postgres "$@"
}
