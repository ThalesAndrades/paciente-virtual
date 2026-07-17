"""Utilitários de normalização e busca de termos em texto."""

import re
import unicodedata


def normalizar(texto):
    """Prepara texto para comparação: minúsculas, sem acentos, sem hífens/underscores.

    Espaços repetidos são colapsados, de modo que "Pressão-Arterial" e
    "pressao  arterial" se tornam equivalentes.
    """
    texto = (texto or "").lower()
    texto = unicodedata.normalize("NFKD", texto)
    texto = "".join(c for c in texto if not unicodedata.combining(c))
    texto = texto.replace("-", " ").replace("_", " ")
    return re.sub(r"\s+", " ", texto).strip()


def contem_termo(texto, termo):
    """Verifica se ``termo`` aparece em ``texto`` respeitando limites de palavra.

    Ambos são normalizados antes da comparação, então acentos, maiúsculas e
    hífens não afetam o resultado. "fc" casa com "verifique a FC", mas não
    com "suficiente".
    """
    return contem_algum_termo(texto, [termo])


def contem_algum_termo(texto, termos):
    """Verifica se algum dos ``termos`` aparece em ``texto`` (limites de palavra)."""
    texto_normalizado = normalizar(texto)
    return any(
        re.search(rf"\b{re.escape(t)}\b", texto_normalizado)
        for t in (normalizar(termo) for termo in termos)
        if t
    )
