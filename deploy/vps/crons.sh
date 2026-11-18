#!/usr/bin/env bash
# Liga, desliga ou lista os crons (pg_cron) do banco do MyLLENET na VPS.
# Uso: bash crons.sh status | pausar | ligar
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
case "${1:-status}" in
  pausar) db_psql postgres -X -q -c "select cron.alter_job(jobid, active := false) from cron.job" >/dev/null; ok "crons pausados" ;;
  ligar)
    read -r -p "Ligar os crons na VPS? Antes, desative os crons da Lovable para não duplicar cobranças/WhatsApp. (s/N) " a
    [ "$a" = "s" ] || [ "$a" = "S" ] || exit 1
    db_psql postgres -X -q -c "select cron.alter_job(jobid, active := true) from cron.job" >/dev/null; ok "crons ligados" ;;
  status) ;;
  *) die "Uso: bash crons.sh status | pausar | ligar" ;;
esac
db_psql postgres -X -c "select jobid, jobname, schedule, active from cron.job order by jobid"
