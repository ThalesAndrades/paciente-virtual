"""Validação estrutural de todos os casos e rubricas versionados.

Garante que qualquer caso novo adicionado a ``casos/`` chegue com os campos
mínimos, rubrica correspondente e pesos fechando em 10 — os erros aparecem
no CI, não na frente do aluno.
"""

import json
from pathlib import Path

import pytest

from paciente_virtual.prompt import criar_prompt

RAIZ = Path(__file__).resolve().parent.parent
CASOS = sorted((RAIZ / "casos").glob("*.json"))
RUBRICAS = sorted((RAIZ / "avaliacoes").glob("*.json"))


def _carregar(arquivo):
    with open(arquivo, encoding="utf-8") as f:
        return json.load(f)


def test_ha_casos_e_rubricas():
    assert len(CASOS) >= 6
    assert len(RUBRICAS) >= 6


def test_todo_caso_tem_rubrica_e_vice_versa():
    assert {caso.stem for caso in CASOS} == {rubrica.stem for rubrica in RUBRICAS}


@pytest.mark.parametrize("arquivo", CASOS, ids=lambda a: a.stem)
def test_caso_tem_estrutura_minima(arquivo):
    caso = _carregar(arquivo)

    identificacao = caso["identificacao"]
    assert identificacao["nome"]
    assert identificacao["idade"]
    assert identificacao["voz"] in ("feminino", "masculino")
    assert caso["queixa_principal"]

    for grupo in ("exame_fisico", "exames_disponiveis"):
        for chave, dados in (caso.get(grupo) or {}).items():
            assert dados.get("nome"), f"{grupo}.{chave} sem nome"
            assert dados.get("resultado"), f"{grupo}.{chave} sem resultado"
            assert isinstance(dados.get("sinonimos", []), list)


@pytest.mark.parametrize("arquivo", CASOS, ids=lambda a: a.stem)
def test_prompt_do_caso_e_gerado(arquivo):
    caso = _carregar(arquivo)
    prompt = criar_prompt(caso)

    assert caso["identificacao"]["nome"] in prompt
    # Nada de repr Python vazando para o modelo.
    assert "{'" not in prompt
    assert "True" not in prompt


@pytest.mark.parametrize("arquivo", RUBRICAS, ids=lambda a: a.stem)
def test_rubrica_e_consistente(arquivo):
    rubrica = _carregar(arquivo)

    assert rubrica["nome_caso"]
    criterios = rubrica["criterios"]
    assert criterios

    assert sum(criterio["peso"] for criterio in criterios) == 10

    for criterio in criterios:
        assert criterio["nome"]
        assert criterio["objetivo"]
        assert criterio["itens"], f"critério '{criterio['nome']}' sem itens"
        for item in criterio["itens"]:
            assert item["nome"]
            assert item.get("termos"), f"item '{item['nome']}' sem termos"
