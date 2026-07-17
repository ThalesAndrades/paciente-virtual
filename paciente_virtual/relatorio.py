"""Painel do professor: consolida as consultas gravadas em ``historico/``.

A nota objetiva é recalculada sob demanda com a rubrica atual do caso —
determinística e sem depender do modelo de linguagem. Se a rubrica mudar,
as notas históricas refletem a rubrica vigente.

Uso pela linha de comando::

    python -m paciente_virtual.relatorio
"""

from .avaliador import carregar_rubrica, detectar_caso, pontuar_checklist
from .config import DIR_HISTORICO
from .registro import (
    estruturar_transcript,
    extrair_metadados,
    extrair_texto_profissional,
)


def _resumir(arquivo, texto):
    metadados = extrair_metadados(texto)
    caso = detectar_caso(arquivo, texto)

    nota = None
    rubrica = carregar_rubrica(caso) if caso else None
    if rubrica:
        nota = pontuar_checklist(rubrica, extrair_texto_profissional(texto))["nota_total"]

    return {
        "arquivo": arquivo.name,
        "caso": caso,
        "aluno": metadados["aluno"],
        "inicio": metadados["inicio"],
        "encerrada": metadados["encerrada"],
        "nota": nota,
    }


def listar_consultas():
    """Resumo de todas as consultas gravadas, da mais recente para a mais antiga."""
    consultas = []
    for arquivo in sorted(DIR_HISTORICO.glob("*.txt"), reverse=True):
        try:
            texto = arquivo.read_text(encoding="utf-8")
        except OSError:
            continue
        consultas.append(_resumir(arquivo, texto))
    return consultas


def detalhar_consulta(nome_arquivo):
    """Detalhe de uma consulta: metadados, checklist e transcript estruturado.

    Retorna None se o arquivo não existir em ``historico/`` — a comparação é
    feita contra a listagem real do diretório, nunca montando caminho com a
    entrada do usuário (evita path traversal).
    """
    disponiveis = {arquivo.name: arquivo for arquivo in DIR_HISTORICO.glob("*.txt")}
    arquivo = disponiveis.get(nome_arquivo)
    if arquivo is None:
        return None

    texto = arquivo.read_text(encoding="utf-8")
    detalhe = _resumir(arquivo, texto)
    detalhe["eventos"] = estruturar_transcript(texto)

    rubrica = carregar_rubrica(detalhe["caso"]) if detalhe["caso"] else None
    detalhe["checklist"] = (
        pontuar_checklist(rubrica, extrair_texto_profissional(texto)) if rubrica else None
    )

    return detalhe


def main():
    print("\n" + "=" * 72)
    print("PAINEL DO PROFESSOR — CONSULTAS GRAVADAS")
    print("=" * 72)

    consultas = listar_consultas()
    if not consultas:
        print(f"\nNenhuma consulta encontrada em {DIR_HISTORICO}.")
        return

    print(f"\n{'Início':<20} {'Aluno':<20} {'Caso':<24} {'Nota':>5}")
    print("-" * 72)
    for consulta in consultas:
        nota = f"{consulta['nota']:.1f}" if consulta["nota"] is not None else "—"
        situacao = "" if consulta["encerrada"] else "  (em aberto)"
        print(
            f"{(consulta['inicio'] or '—'):<20} "
            f"{(consulta['aluno'] or '—'):<20} "
            f"{(consulta['caso'] or '?'):<24} "
            f"{nota:>5}{situacao}"
        )

    print(f"\nTotal: {len(consultas)} consulta(s). Detalhes: paciente-virtual-avaliador")


if __name__ == "__main__":
    main()
