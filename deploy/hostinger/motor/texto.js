// Normalização e busca de termos, tolerante a acento e hífen.

// Faixa dos diacríticos combinantes (U+0300–U+036F), removidos após NFKD.
const DIACRITICOS = /[̀-ͯ]/g;

export function normalizar(texto) {
  return (texto || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(DIACRITICOS, "")
    .replace(/[-_]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function escaparRegex(texto) {
  return texto.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function contemTermo(texto, termo) {
  const termoNormalizado = normalizar(termo);
  if (!termoNormalizado) return false;
  const padrao = new RegExp(`\\b${escaparRegex(termoNormalizado)}\\b`);
  return padrao.test(normalizar(texto));
}

// Chaves que descrevem o BLOCO para quem escreve o caso ("o que ela conta fácil,
// logo de cara") — são roteiro, não coisa que o paciente viveu. Sem este filtro o
// modelo lê a instrução como fato e o paciente acaba narrando o próprio roteiro.
const CHAVES_META = new Set(["descricao", "descrição", "observacao", "observação", "obs", "nota"]);

export function ehChaveMeta(chave) {
  return CHAVES_META.has(String(chave).toLowerCase());
}

export function contemAlgumTermo(texto, termos) {
  const textoNormalizado = normalizar(texto);
  return termos.some((termo) => {
    const termoNormalizado = normalizar(termo);
    if (!termoNormalizado) return false;
    return new RegExp(`\\b${escaparRegex(termoNormalizado)}\\b`).test(textoNormalizado);
  });
}
