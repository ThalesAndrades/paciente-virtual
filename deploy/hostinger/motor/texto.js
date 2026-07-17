// Porta fiel de paciente_virtual/texto.py — normalização e busca de termos.

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

export function contemAlgumTermo(texto, termos) {
  const textoNormalizado = normalizar(texto);
  return termos.some((termo) => {
    const termoNormalizado = normalizar(termo);
    if (!termoNormalizado) return false;
    return new RegExp(`\\b${escaparRegex(termoNormalizado)}\\b`).test(textoNormalizado);
  });
}
