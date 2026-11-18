#!/usr/bin/env bash
# Gera uma chave nova e imprime o código da função myllenet-export pronto para colar na Lovable.
# Uso: bash gerar-funcao-export.sh   (sempre gera chave nova; a anterior deixa de valer)
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
mkdir -p "$SECRETS_DIR"; chmod 700 "$SECRETS_DIR"
openssl rand -hex 24 > "$SECRETS_DIR/export.key"; chmod 600 "$SECRETS_DIR/export.key"
KEY=$(tr -d '[:space:]' < "$SECRETS_DIR/export.key")
SRC="$SCRIPT_DIR/lovable-export/index.ts"
grep -q '^const EXPORT_KEY = "TROQUE_PELA_CHAVE";$' "$SRC" || die "Modelo da função em formato inesperado"
echo
echo "Cole o código abaixo SOMENTE no chat da Lovable (não em outros chats)."
echo "----- copie DAQUI -----"
# troca só a linha da constante; a trava contra chave não preenchida continua intacta
sed -e "s/^const EXPORT_KEY = \"TROQUE_PELA_CHAVE\";$/const EXPORT_KEY = \"$KEY\";/" \
    -e '/^\/\/ Antes de publicar/,/^\/\/ A chave fica/d' "$SRC"
echo "----- ATÉ AQUI -----"
