#!/usr/bin/env bash
# Instala as credenciais de cobrança do THM Simulados Inteligentes.
#
# Existe porque as chaves nunca devem passar por lugar nenhum além da mão de quem
# as possui e do arquivo `.env` do servidor: nem por chat, nem por commit, nem por
# parâmetro de API. Aqui elas são digitadas com o eco desligado, gravadas com
# permissão 600 e nunca aparecem na tela nem no histórico do shell.
#
# Uso, no host, dentro de /docker/paciente-virtual:
#
#   bash <(curl -fsSL https://raw.githubusercontent.com/ThalesAndrades/paciente-virtual/main/scripts/configurar-pagamentos.sh)
#
# `bash <(...)` e não `curl | bash`: com o pipe, a entrada padrão é o download, e
# o script não conseguiria ler o que você digita.

set -euo pipefail

DIR="${PV_DIR:-/docker/paciente-virtual}"
ENV="$DIR/.env"
CONTAINER="${PV_CONTAINER:-paciente-virtual}"

if [ ! -d "$DIR" ]; then
  echo "Diretório $DIR não encontrado. Rode com PV_DIR=/caminho/do/projeto." >&2
  exit 1
fi

echo "Credenciais de cobrança — THM Tecnologia"
echo "Deixe em branco para não alterar o valor atual."
echo

# Grava (ou substitui) uma variável no .env sem duplicar linha e sem ecoar valor.
definir() {
  local chave="$1" valor="$2"
  [ -z "$valor" ] && return 0
  touch "$ENV"
  # Remove a linha antiga, se houver, e acrescenta a nova no fim.
  local tmp
  tmp="$(mktemp)"
  grep -v "^${chave}=" "$ENV" > "$tmp" 2>/dev/null || true
  printf '%s=%s\n' "$chave" "$valor" >> "$tmp"
  mv "$tmp" "$ENV"
  chmod 600 "$ENV"
  echo "  ✓ $chave gravada"
}

read -rsp "WOOVI_APP_ID (Pix) ......... " WOOVI; echo
read -rsp "STRIPE_SECRET_KEY (cartão) . " STRIPE; echo
read -rsp "STRIPE_WEBHOOK_SECRET ...... " WHSEC; echo
echo

definir WOOVI_APP_ID "$WOOVI"
definir STRIPE_SECRET_KEY "$STRIPE"
definir STRIPE_WEBHOOK_SECRET "$WHSEC"
unset WOOVI STRIPE WHSEC

echo
echo "Reiniciando o container…"
docker restart "$CONTAINER" >/dev/null

# Espera o servidor responder e mostra o que ficou ligado. É a única confirmação
# que interessa: a loja passa a oferecer a forma de pagamento, ou não passa.
echo -n "Aguardando o servidor"
for _ in $(seq 1 60); do
  if curl -fsS -m 3 http://127.0.0.1:3000/api/loja >/dev/null 2>&1 ||
     curl -fsS -m 3 https://ubtec.sbs/api/loja >/dev/null 2>&1; then
    break
  fi
  echo -n "."
  sleep 2
done
echo

FORMAS="$(curl -fsS -m 10 https://ubtec.sbs/api/loja | tr -d ' \n' | grep -o '"formas":{[^}]*}' || true)"
echo "Formas de pagamento agora: ${FORMAS:-não consegui consultar}"
echo
echo "Se aparecer \"pix\":true e \"cartao\":true, está no ar."
echo "Falta cadastrar os webhooks nos painéis:"
echo "  Stripe → https://ubtec.sbs/api/webhooks/stripe"
echo "  Woovi  → https://ubtec.sbs/api/webhooks/woovi"
