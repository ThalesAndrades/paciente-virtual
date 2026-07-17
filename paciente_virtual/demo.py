"""Paciente de demonstração: respostas determinísticas sem modelo de linguagem.

Usado quando o Ollama está indisponível, para que o protótipo continue
interativo. As respostas vêm exclusivamente dos dados do caso — nada é
inventado — e cobrem as perguntas mais comuns de anamnese; o restante recebe
uma resposta neutra pedindo reformulação.

A revelação gradual é respeitada de forma aproximada: informações
intermediárias e sensíveis só saem com perguntas que tocam diretamente o
tema (relacionamento, humilhação, controle, medo...), nunca em perguntas
genéricas.
"""

from .texto import contem_algum_termo, normalizar

AVISO_DEMO = (
    "Modelo de linguagem indisponível — o paciente está em modo demonstração, "
    "com respostas fixas extraídas do caso. Inicie o Ollama para a experiência completa."
)

RESPOSTA_PADRAO = "Desculpe, não entendi bem a pergunta. Pode perguntar de outro jeito?"

# Sintomas que o aluno costuma investigar por palavras diferentes das do caso.
# A chave é um radical procurado nos relatos do caso; os termos são as
# palavras da pergunta que ativam a verificação.
_SINONIMOS_SINTOMAS = {
    "sudorese": ["suor", "sudorese", "suando", "suado"],
    "nausea": ["nausea", "enjoo", "enjoada", "enjoado", "vomitar", "vomito"],
    "falta de ar": ["falta de ar", "respirar", "folego", "dispneia"],
    "ansiedade": ["ansiedade", "ansiosa", "ansioso", "nervosa", "nervoso", "nervosismo"],
    "choro": ["choro", "chora", "chorado", "chorando"],
    "cansaco": ["cansaco", "cansada", "cansado", "fadiga", "exausto", "exausta", "esgotado"],
    "concentracao": ["concentracao", "concentrar"],
    "palpitac": [
        "palpitacao",
        "palpitacoes",
        "coracao acelerado",
        "coracao disparado",
        "taquicardia",
    ],
    "tontura": ["tontura", "tonta", "tonto", "vertigem"],
    "trist": ["triste", "tristeza", "deprimido", "deprimida", "desanimo", "desanimado"],
    "irritab": ["irritado", "irritada", "irritabilidade", "explosivo", "paciencia"],
}


def _frase(valor):
    if isinstance(valor, list):
        return ", ".join(str(item) for item in valor)
    return str(valor)


def _sim_ou_nao(valor, tema):
    if valor is True:
        return f"Sim, tenho {tema}."
    if valor is False:
        return f"Não, não tenho {tema}."
    if valor:
        return _frase(valor)
    return None


def _responder_sintoma(caso, pergunta):
    """Responde sim/não para sintomas citados na pergunta, com base no caso."""
    emocoes = [
        emocao for emocao, presente in (caso.get("emocao_atual") or {}).items() if presente
    ]
    relatados = normalizar(
        " ".join(
            [
                _frase((caso.get("historia_doenca_atual") or {}).get("sintomas_associados", "")),
                _frase(list((caso.get("informacoes_iniciais") or {}).values())),
                " ".join(emocoes),
            ]
        )
    )

    for sintoma, termos in _SINONIMOS_SINTOMAS.items():
        if contem_algum_termo(pergunta, termos):
            relatado = sintoma in relatados or any(
                normalizar(termo) in relatados for termo in termos
            )
            if relatado:
                return "Sim, tenho sentido isso também."
            return "Não, isso não tenho sentido."
    return None


def _regras(caso):
    """Pares (termos da pergunta, função que produz a resposta)."""
    ident = caso.get("identificacao", {})
    hda = caso.get("historia_doenca_atual") or {}
    habitos = caso.get("habitos_de_vida") or {}
    pessoais = caso.get("antecedentes_pessoais") or {}
    familiares = caso.get("antecedentes_familiares") or {}
    iniciais = caso.get("informacoes_iniciais") or {}
    intermediarias = caso.get("informacoes_intermediarias") or {}
    sensiveis = caso.get("informacoes_sensiveis") or {}
    rede = caso.get("rede_apoio") or {}

    def familia():
        if not familiares:
            return None
        return " ".join(
            f"{parente.capitalize()}: {_frase(problema).lower()}."
            for parente, problema in familiares.items()
        )

    def fatores():
        partes = []
        if hda.get("fatores_piora"):
            partes.append(f"Piora com {_frase(hda['fatores_piora']).lower()}")
        if hda.get("fatores_melhora"):
            partes.append(f"melhora: {_frase(hda['fatores_melhora']).lower()}")
        return ". ".join(partes) + "." if partes else None

    return [
        (["nome", "se chama"], lambda: ident.get("nome")),
        (
            ["idade", "quantos anos"],
            lambda: f"Tenho {ident['idade']} anos." if ident.get("idade") else None,
        ),
        (
            ["profissao", "trabalha", "trabalho", "ocupacao"],
            lambda: f"Sou {_frase(ident['profissao']).lower()}."
            if ident.get("profissao")
            else None,
        ),
        (
            ["estado civil", "casado", "casada", "solteiro", "solteira"],
            lambda: f"Sou {_frase(ident['estado_civil']).lower()}."
            if ident.get("estado_civil")
            else None,
        ),
        (
            ["sentindo", "sente", "aconteceu", "trouxe", "traz", "queixa", "incomoda"],
            lambda: f"Estou com {_frase(caso['queixa_principal']).lower()}."
            if caso.get("queixa_principal")
            else None,
        ),
        (
            ["quando", "comecou", "desde", "quanto tempo"],
            lambda: f"Começou {_frase(hda['inicio']).lower()}." if hda.get("inicio") else None,
        ),
        (
            ["onde", "local", "localizacao", "regiao", "lugar"],
            lambda: _frase(hda["localizacao"]) + "." if hda.get("localizacao") else None,
        ),
        (
            ["irradia", "espalha", "vai para"],
            lambda: f"Vai para: {_frase(hda['irradiacao']).lower()}."
            if hda.get("irradiacao")
            else None,
        ),
        (
            ["intensidade", "forte", "escala", "0 a 10", "zero a dez"],
            lambda: f"É forte, uns {_frase(hda['intensidade'])}."
            if hda.get("intensidade")
            else None,
        ),
        (["melhora", "piora", "alivia"], fatores),
        (
            ["mais alguma coisa", "mais algum", "junto", "sintoma"],
            lambda: f"Sinto também: {_frase(hda['sintomas_associados']).lower()}."
            if hda.get("sintomas_associados")
            else None,
        ),
        (
            ["fuma", "fumante", "cigarro", "tabagismo"],
            lambda: _frase(habitos["tabagismo"]) + "." if habitos.get("tabagismo") else None,
        ),
        (
            ["alcool", "bebe", "bebida"],
            lambda: _frase(habitos["alcool"]) + "." if habitos.get("alcool") else None,
        ),
        (
            ["exercicio", "atividade fisica", "esporte"],
            lambda: _frase(habitos["atividade_fisica"]) + "."
            if habitos.get("atividade_fisica")
            else None,
        ),
        (
            ["dorme", "sono", "dormir"],
            lambda: _frase(habitos.get("sono") or iniciais.get("sono") or "") + "."
            if habitos.get("sono") or iniciais.get("sono")
            else None,
        ),
        (
            ["apetite", "fome", "comendo", "comer"],
            lambda: _frase(iniciais.get("apetite") or "") or None,
        ),
        (
            ["pressao alta", "hipertensao", "hipertenso"],
            lambda: _sim_ou_nao(pessoais.get("hipertensao"), "pressão alta"),
        ),
        (["diabetes"], lambda: _sim_ou_nao(pessoais.get("diabetes"), "diabetes")),
        (
            ["colesterol", "dislipidemia"],
            lambda: _sim_ou_nao(pessoais.get("dislipidemia"), "colesterol alto"),
        ),
        (
            ["alergia", "alergico", "alergica"],
            lambda: _frase(pessoais["alergias"]) + "." if pessoais.get("alergias") else None,
        ),
        (
            ["cirurgia", "operacao", "operado", "operada"],
            lambda: _frase(pessoais["cirurgias"]) + "." if pessoais.get("cirurgias") else None,
        ),
        (["familia", "pai", "mae", "parente", "familiar"], familia),
        # Informações intermediárias: exigem pergunta direta sobre o tema.
        (
            ["relacionamento", "casamento", "marido", "esposo", "companheiro", "parceiro"],
            lambda: _frase(intermediarias.get("relacionamento") or "") or None,
        ),
        (
            ["ciume", "ciumes", "ciumento"],
            lambda: _frase(intermediarias.get("ciumes") or "") or None,
        ),
        (
            ["amigos", "amigas", "isolamento", "afastou"],
            lambda: _frase(intermediarias.get("isolamento") or rede.get("amigos") or "") or None,
        ),
        # Informações sensíveis: só com perguntas específicas e aprofundadas.
        (
            ["humilha", "xinga", "ofende", "diminui", "desvaloriza"],
            lambda: _frase(sensiveis.get("humilhacoes") or "") or None,
        ),
        (
            ["controla", "controle", "vigia", "celular"],
            lambda: _frase(sensiveis.get("controle") or "") or None,
        ),
        (["medo", "receio", "insegura"], lambda: _frase(sensiveis.get("medo") or "") or None),
        (["culpa", "culpada"], lambda: _frase(sensiveis.get("culpa") or "") or None),
        (
            ["apoio", "suporte", "conversar com alguem", "contar"],
            lambda: _frase(rede.get("apoio") or "") or None,
        ),
        (
            ["humor", "animo"],
            lambda: _frase(iniciais.get("desanimo") or "") or None,
        ),
        (
            ["emprego", "desemprego", "desempregado", "renda", "financeiro"],
            lambda: _frase(intermediarias.get("trabalho") or "") or None,
        ),
        # Avaliação de risco: só com pergunta direta sobre o tema.
        (
            [
                "morrer",
                "morte",
                "se machucar",
                "suicidio",
                "nao acordar",
                "tirar a propria vida",
                "acabar com tudo",
                "sumir",
            ],
            lambda: _frase(sensiveis.get("ideacao") or "") or None,
        ),
        (
            ["plano", "planejou", "intencao", "tentou"],
            lambda: _frase(sensiveis.get("plano") or "") or None,
        ),
        (
            ["te segura", "motivo para viver", "protecao", "te impede"],
            lambda: _frase(sensiveis.get("protecao") or "") or None,
        ),
        # Saudações por último: "bom dia, qual é o seu nome?" deve responder
        # o nome, não só "Olá.".
        (["bom dia", "boa tarde", "boa noite", "ola", "oi"], lambda: "Olá."),
        (["obrigado", "obrigada"], lambda: "De nada."),
    ]


def responder_demo(caso, pergunta):
    """Resposta do paciente de demonstração para uma pergunta do profissional."""
    # Pergunta sobre um sintoma específico é mais precisa que as regras
    # genéricas ("sente suor?" não deve cair na regra da queixa por "sente").
    resposta_sintoma = _responder_sintoma(caso, pergunta)
    if resposta_sintoma:
        return resposta_sintoma

    for termos, responder in _regras(caso):
        if contem_algum_termo(pergunta, termos):
            resposta = responder()
            if resposta:
                return resposta

    return RESPOSTA_PADRAO
