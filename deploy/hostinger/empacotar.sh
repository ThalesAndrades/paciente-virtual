#!/usr/bin/env bash
# Gera o ZIP de deploy para upload no Gerenciador de Arquivos da Hostinger.
#
# O pacote contém apenas o necessário para o servidor Node rodar, preservando a
# estrutura de pastas que o código espera em runtime: app.js fica na RAIZ do ZIP
# (sem pasta-invólucro), então ao extrair na pasta da aplicação Node os arquivos
# caem no lugar certo e o "arquivo de inicialização" app.js já funciona.
#
# Uso:  bash deploy/hostinger/empacotar.sh
# Saída: dist/paciente-virtual-hostinger.zip

set -euo pipefail

# Raiz do repositório (dois níveis acima deste script).
RAIZ="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$RAIZ"

SAIDA="dist/paciente-virtual-hostinger.zip"

# Arquivos e pastas incluídos (relativos à raiz do repo). Tudo o que o
# servidor.js lê em runtime, mais o que torna o pacote autossuficiente.
INCLUIR=(
  app.js
  package.json
  .nvmrc
  casos
  avaliacoes
  paciente_virtual/web/static/index.html
  deploy/hostinger/servidor.js
  deploy/hostinger/README.md
  deploy/hostinger/motor
  deploy/hostinger/testes
)

mkdir -p dist
rm -f "$SAIDA"

# -r recursivo; -X sem metadados extra; exclui caches e lixo do SO.
zip -r -X "$SAIDA" "${INCLUIR[@]}" \
  -x '*/__pycache__/*' '*.pyc' '.DS_Store' '*/.DS_Store' >/dev/null

echo "Pacote gerado: $SAIDA"
unzip -l "$SAIDA" | tail -n +2
