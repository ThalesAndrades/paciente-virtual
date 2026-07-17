"""Avaliação de consultas: checklist objetivo por rubrica + análise semântica por IA.

O checklist considera apenas as falas do profissional e os títulos dos exames
que ele solicitou — as respostas do paciente, os conteúdos dos resultados de
exame e o cabeçalho do histórico não pontuam. Cada item da rubrica pode ser
uma string ou um objeto ``{"nome", "termos"}`` com sinônimos; a comparação
ignora acentos e maiúsculas.
"""

import json

from .config import DIR_AVALIACOES, DIR_HISTORICO
from .ia import avisar_falha, conversar
from .registro import extrair_caso_do_cabecalho, extrair_texto_profissional
from .texto import contem_algum_termo
from .util import escolher_arquivo


def listar_rubricas():
    return sorted(DIR_AVALIACOES.glob("*.json"))


def escolher_historico():
    historicos = sorted(DIR_HISTORICO.glob("*.txt"))
    if not historicos:
        raise SystemExit(f"Nenhum histórico encontrado em {DIR_HISTORICO}.")
    return escolher_arquivo(
        historicos, "Históricos encontrados:", "Escolha o número do histórico"
    )


def detectar_caso(arquivo, texto):
    """Identifica o caso pelo cabeçalho do histórico ou, na falta dele, pelo nome do arquivo."""
    caso = extrair_caso_do_cabecalho(texto)
    if caso:
        return caso

    # Compatibilidade com históricos antigos, sem cabeçalho de metadados.
    nome = arquivo.stem
    rubricas = sorted(listar_rubricas(), key=lambda r: -len(r.stem))
    for rubrica in rubricas:
        if nome == rubrica.stem or nome.startswith(rubrica.stem + "_"):
            return rubrica.stem

    return None


def termos_do_item(item):
    """Um item da rubrica pode ser uma string ou um objeto {"nome", "termos"}."""
    if isinstance(item, str):
        return item, [item]
    return item["nome"], item.get("termos") or [item["nome"]]


def avaliar_checklist(rubrica, texto_profissional):
    """Pontua a consulta pela presença dos termos da rubrica. Retorna a nota total."""
    nota_total = 0.0

    print("\n" + "=" * 50)
    print("RESULTADO DA AVALIAÇÃO OBJETIVA")
    print("=" * 50)

    for criterio in rubrica["criterios"]:
        peso = criterio["peso"]
        itens = criterio["itens"]

        print(f"\n{criterio['nome'].upper()}")
        print(f"Objetivo: {criterio['objetivo']}")

        if not itens:
            print("(critério sem itens — ignorado)")
            continue

        valor_item = peso / len(itens)
        nota_bloco = 0.0

        for item in itens:
            nome, termos = termos_do_item(item)

            if contem_algum_termo(texto_profissional, termos):
                print(f"✓ {nome}")
                nota_bloco += valor_item
            else:
                print(f"✗ {nome}")

        nota_total += nota_bloco
        print(f"Pontuação: {nota_bloco:.2f}/{peso:.2f}")

    print("\n" + "=" * 50)
    print(f"NOTA OBJETIVA: {nota_total:.2f}/10.00")
    print("=" * 50)

    return nota_total


def avaliar_com_ia(rubrica, texto):
    """Pede ao modelo de linguagem um parecer pedagógico sobre a consulta."""
    prompt = f"""
Você é um professor experiente da área da saúde.

Analise o histórico da consulta e os critérios da rubrica.

RÚBRICA:

{json.dumps(rubrica, ensure_ascii=False, indent=2)}

HISTÓRICO DA CONSULTA:

{texto}

Para cada critério da rubrica:

* Informe se foi ATENDIDO, PARCIALMENTE ATENDIDO ou NÃO ATENDIDO.
* Justifique utilizando exemplos do histórico.
* Considere o significado das perguntas realizadas e não apenas palavras exatas.

Após analisar todos os critérios:

1. Atribua uma nota geral de 0 a 10.
2. Liste pontos fortes.
3. Liste pontos a desenvolver.
4. Produza recomendações para futuras entrevistas.
5. Produza um feedback pedagógico detalhado.

Organize a resposta em:

CRITÉRIO
STATUS
JUSTIFICATIVA

NOTA FINAL

PONTOS FORTES

PONTOS A DESENVOLVER

RECOMENDAÇÕES

FEEDBACK PEDAGÓGICO
"""
    return conversar([{"role": "user", "content": prompt}])


def main():
    print("\n" + "=" * 50)
    print("AVALIADOR DE CONSULTA")
    print("=" * 50)

    arquivo_historico = escolher_historico()
    texto = arquivo_historico.read_text(encoding="utf-8")

    caso = detectar_caso(arquivo_historico, texto)
    if caso is None:
        raise SystemExit(
            f"\nNão foi possível identificar o caso de '{arquivo_historico.name}'. "
            f"Rubricas disponíveis: {[r.stem for r in listar_rubricas()]}"
        )

    arquivo_rubrica = DIR_AVALIACOES / f"{caso}.json"
    if not arquivo_rubrica.exists():
        raise SystemExit(f"\nRubrica não encontrada: {arquivo_rubrica}")

    print(f"\nCaso identificado: {caso}")

    with open(arquivo_rubrica, encoding="utf-8") as f:
        rubrica = json.load(f)

    avaliar_checklist(rubrica, extrair_texto_profissional(texto))

    print("\n" + "=" * 50)
    print("AVALIAÇÃO SEMÂNTICA POR IA")
    print("=" * 50)

    try:
        parecer = avaliar_com_ia(rubrica, texto)
    except Exception as erro:
        print("\nAvaliação semântica indisponível.")
        avisar_falha(erro)
        return

    print(f"\n{parecer}")


if __name__ == "__main__":
    main()
