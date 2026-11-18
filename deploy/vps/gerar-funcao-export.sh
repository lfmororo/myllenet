#!/usr/bin/env bash
# Gera a chave do export e imprime o código da função myllenet-export pronto para colar na Lovable.
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
mkdir -p "$SECRETS_DIR"; chmod 700 "$SECRETS_DIR"
if [ ! -s "$SECRETS_DIR/export.key" ]; then
  openssl rand -hex 24 > "$SECRETS_DIR/export.key"; chmod 600 "$SECRETS_DIR/export.key"
fi
KEY=$(tr -d '[:space:]' < "$SECRETS_DIR/export.key")
echo "----- copie DAQUI -----"
sed "s/TROQUE_PELA_CHAVE/$KEY/" "$SCRIPT_DIR/lovable-export/index.ts"
echo "----- ATÉ AQUI -----"
