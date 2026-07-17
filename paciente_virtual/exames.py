"""Motores de exames: detectam solicitações do profissional e devolvem resultados do caso.

Os dois motores (exame físico e exames complementares) usam o mesmo critério:
o resultado só é entregue quando a frase contém uma expressão de solicitação
ativa ("vou aferir sua pressão", "solicito um ECG", "qual a saturação?").
Menção sem solicitação ("o senhor tem pressão alta?", "já fez um eletro?")
segue para o paciente como pergunta de anamnese.

O filtro é intencionalmente simples (palavras-chave, não interpretação):
frases como "costuma verificar sua pressão em casa?" ainda disparam a medição.
Casos ambíguos assim são raros e o custo é baixo; a alternativa (interpretar a
intenção com o LLM) tornaria o resultado não determinístico para avaliação.

A detecção (``detectar_exames``) é pura — sem som, console ou arquivo — para
que interfaces diferentes (CLI, web) entreguem o resultado do seu jeito.
Os ``verificar_*`` embrulham a detecção com a entrega da CLI e retornam a
lista de exames entregues (vazia se nenhum).
"""

import re

from .registro import (
    PREFIXO_RESULTADO,
    TITULO_EXAME_FISICO,
    TITULO_EXAME_SOLICITADO,
    registrar,
)
from .texto import contem_algum_termo, normalizar
from .voz.falar import falar

# Radicais de verbos de solicitação: casam qualquer flexão com \b<radical>\w*
# ("afer" cobre aferir/afira/aferindo; "solicit" cobre solicito/solicitar/solicite...).
_MARCADORES_RADICAL = [
    "afer",
    "verific",
    "chec",
    "avali",
    "examin",
    "auscult",
    "escut",
    "confer",
    "solicit",
    "realiz",
]

# Palavras e expressões exatas (com limite de palavra, acentos ignorados).
# "faz"/"faça" estão na lista, mas "fez" não: "já fez exame de pressão?" é
# pergunta de anamnese, não solicitação.
_MARCADORES_EXATOS = [
    "medir",
    "meça",
    "meço",
    "mede",
    "medindo",
    "tirar",
    "tire",
    "olhar",
    "olhe",
    "ver",
    "pedir",
    "peço",
    "faz",
    "faça",
    "fazer",
    "quero",
    "gostaria",
    "preciso",
    "qual",
    "quais",
    "quanto",
    "quanta",
    "como está",
    "como estão",
    "exame físico",
]

_PADRAO_SOLICITACAO = re.compile(
    "|".join(
        [rf"\b{radical}\w*" for radical in _MARCADORES_RADICAL]
        + [rf"\b{re.escape(normalizar(palavra))}\b" for palavra in _MARCADORES_EXATOS]
    )
)


def _ha_solicitacao(texto):
    return _PADRAO_SOLICITACAO.search(normalizar(texto)) is not None


def _termos_do_exame(chave, dados):
    termos = [chave, dados.get("nome", "")]
    termos.extend(dados.get("sinonimos", []))
    return [termo for termo in termos if termo]


def _detectar(texto, exames):
    if not exames or not _ha_solicitacao(texto):
        return []
    return [
        dados
        for chave, dados in exames.items()
        if contem_algum_termo(texto, _termos_do_exame(chave, dados))
    ]


def detectar_exames(texto, caso):
    """Exames solicitados na frase, sem efeitos colaterais.

    Retorna uma lista de pares ``(titulo, dados)`` — complementares primeiro,
    exame físico depois, na mesma ordem de entrega da CLI.
    """
    return [
        (TITULO_EXAME_SOLICITADO, dados)
        for dados in _detectar(texto, caso.get("exames_disponiveis"))
    ] + [
        (TITULO_EXAME_FISICO, dados)
        for dados in _detectar(texto, caso.get("exame_fisico"))
    ]


def registrar_exame(arquivo_historico, titulo, dados):
    """Anexa um exame entregue ao histórico, no formato que o avaliador lê."""
    registrar(arquivo_historico, f"\n{titulo}: {dados['nome']}\n")
    registrar(arquivo_historico, f"{PREFIXO_RESULTADO} {dados['resultado']}\n")


def contexto_para_paciente(exames_entregues):
    """Mensagem de sistema que informa o paciente dos exames recém-realizados."""
    itens = "; ".join(
        f"{dados['nome']}: {dados['resultado']}" for dados in exames_entregues
    )
    return (
        f"O profissional acabou de realizar/solicitar: {itens}. "
        "Você, como paciente, sabe que esses procedimentos aconteceram agora "
        "e pode comentá-los se perguntado."
    )


def _entregar_resultado(titulo, dados, arquivo_historico, voz):
    print(f"\n{titulo}\n\n{dados['nome']}\n")
    print("Resultado:\n")
    print(dados["resultado"])
    print()

    falar(dados["resultado"], voz)

    registrar_exame(arquivo_historico, titulo, dados)


def _verificar(texto, exames, titulo, arquivo_historico, voz):
    entregues = _detectar(texto, exames)
    for dados in entregues:
        _entregar_resultado(titulo, dados, arquivo_historico, voz)
    return entregues


def verificar_exames(texto, caso, arquivo_historico, voz):
    """Entrega os exames complementares solicitados na frase.

    Retorna a lista de exames entregues (vazia se nenhum).
    """
    return _verificar(
        texto,
        caso.get("exames_disponiveis"),
        TITULO_EXAME_SOLICITADO,
        arquivo_historico,
        voz,
    )


def verificar_exame_fisico(texto, caso, arquivo_historico, voz):
    """Entrega os itens de exame físico solicitados na frase.

    Retorna a lista de exames entregues (vazia se nenhum).
    """
    return _verificar(
        texto,
        caso.get("exame_fisico"),
        TITULO_EXAME_FISICO,
        arquivo_historico,
        voz,
    )
