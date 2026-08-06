#!/bin/bash
# Backup do volume de dados do Paciente Virtual.
#
# O QUE ESTÁ EM JOGO. O volume `paciente-virtual_historico` guarda duas coisas que
# não existem em nenhum outro lugar: o banco de contas (`pv.sqlite` — alunos,
# créditos, pagamentos, assinaturas, desempenho) e as transcrições das consultas,
# que contêm NOME E CONTEÚDO DA CONSULTA DE ALUNOS. O código se recupera de um
# `git clone`; isto aqui, não.
#
# O volume protege contra redeploy — o container faz `rm -rf /app` a cada start e
# se re-clona. Não protege contra perder o disco, o VPS ou a pasta.
#
# POR QUE NÃO COPIAR O ARQUIVO DIRETO. O SQLite escreve em páginas e mantém um
# WAL. Copiar `pv.sqlite` com o servidor rodando pode capturar um estado a meio de
# uma transação — o arquivo abre, parece íntegro e falta o último pedaço. Aqui se
# usa `VACUUM INTO`, que o próprio SQLite garante ser um instantâneo consistente
# mesmo com escrita acontecendo, e que ainda sai compactado.
#
# Uso:
#   backup.sh            # gera um backup e aplica a retenção
#   backup.sh --testar   # gera, verifica e APAGA — para conferir que funciona
#
# Instalação (timer diário) em deploy/hostinger/README.md.

set -euo pipefail

CONTAINER="${PV_CONTAINER:-paciente-virtual}"
DESTINO="${PV_BACKUP_DIR:-/var/backups/paciente-virtual}"
RETENCAO_DIAS="${PV_BACKUP_RETENCAO:-14}"
BANCO_NO_CONTAINER="/dados/historico/pv.sqlite"
CARIMBO="$(date -u +%Y%m%d-%H%M%S)"
ALVO="${DESTINO}/pv-${CARIMBO}.tar.gz"

testar=0
[ "${1:-}" = "--testar" ] && testar=1

morrer() { echo "[backup] ERRO: $*" >&2; exit 1; }

docker inspect "$CONTAINER" >/dev/null 2>&1 || morrer "container '$CONTAINER' não existe"
[ "$(docker inspect -f '{{.State.Running}}' "$CONTAINER")" = "true" ] \
  || morrer "container '$CONTAINER' não está rodando — sem ele não há como tirar um instantâneo consistente"

mkdir -p "$DESTINO"
chmod 700 "$DESTINO"   # dado de aluno: a pasta não é de leitura geral

# Instantâneo consistente do banco, DENTRO do container (é lá que o node vive).
# O destino fica no volume, ao lado do banco, e é removido no fim.
INSTANTANEO="/dados/historico/.backup-${CARIMBO}.sqlite"
docker exec "$CONTAINER" node -e "
  const { DatabaseSync } = require('node:sqlite');
  const d = new DatabaseSync('${BANCO_NO_CONTAINER}');
  d.exec(\"VACUUM INTO '${INSTANTANEO}'\");
  d.close();
" >/dev/null 2>&1 || morrer "VACUUM INTO falhou — banco inacessível dentro do container"

# Confere que o instantâneo abre e tem as tabelas do produto. Backup que não se lê
# é pior que backup nenhum: dá a sensação de estar protegido.
contas="$(docker exec "$CONTAINER" node -e "
  const { DatabaseSync } = require('node:sqlite');
  const d = new DatabaseSync('${INSTANTANEO}');
  process.stdout.write(String(d.prepare('select count(*) c from user').get().c));
  d.close();
" 2>/dev/null)" || morrer "o instantâneo não abriu — backup abortado"

# O pacote: instantâneo do banco + transcrições. O banco vivo (`pv.sqlite`, `-wal`,
# `-shm`) fica DE FORA de propósito — quem vale é o instantâneo.
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"; docker exec "$CONTAINER" rm -f "$INSTANTANEO" >/dev/null 2>&1 || true' EXIT

docker cp "${CONTAINER}:${INSTANTANEO}" "${tmp}/pv.sqlite" >/dev/null \
  || morrer "não consegui trazer o instantâneo para o host"

mkdir -p "${tmp}/transcricoes"
docker exec "$CONTAINER" sh -c 'cd /dados/historico && tar cf - ./*.txt 2>/dev/null || true' \
  | tar xf - -C "${tmp}/transcricoes" 2>/dev/null || true

transcricoes="$(find "${tmp}/transcricoes" -name '*.txt' | wc -l | tr -d ' ')"

tar czf "$ALVO" -C "$tmp" pv.sqlite transcricoes
chmod 600 "$ALVO"

# Verificação final: o pacote lê de volta?
tar tzf "$ALVO" >/dev/null || morrer "o pacote gerado não pôde ser lido"

tamanho="$(du -h "$ALVO" | cut -f1)"
echo "[backup] ${ALVO} (${tamanho}) — ${contas} contas, ${transcricoes} transcrições"

if [ "$testar" = "1" ]; then
  rm -f "$ALVO"
  echo "[backup] modo --testar: pacote verificado e removido"
  exit 0
fi

# Retenção. `-mtime +N` apaga o que passou de N dias.
apagados="$(find "$DESTINO" -name 'pv-*.tar.gz' -mtime "+${RETENCAO_DIAS}" -print -delete | wc -l | tr -d ' ')"
restantes="$(find "$DESTINO" -name 'pv-*.tar.gz' | wc -l | tr -d ' ')"
echo "[backup] retenção ${RETENCAO_DIAS}d: ${apagados} removido(s), ${restantes} em disco"
