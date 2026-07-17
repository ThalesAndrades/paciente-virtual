import json
from pathlib import Path

import pytest

from paciente_virtual.demo import RESPOSTA_PADRAO, responder_demo

RAIZ = Path(__file__).resolve().parent.parent


@pytest.fixture(scope="module")
def infarto():
    with open(RAIZ / "casos" / "infarto.json", encoding="utf-8") as f:
        return json.load(f)


@pytest.fixture(scope="module")
def violencia():
    with open(RAIZ / "casos" / "violencia_psicologica.json", encoding="utf-8") as f:
        return json.load(f)


def test_responde_identificacao(infarto):
    assert "João Carlos Ferreira" in responder_demo(infarto, "Qual é o seu nome?")
    assert "58" in responder_demo(infarto, "Quantos anos o senhor tem?")
    assert "pedreiro" in responder_demo(infarto, "Qual a sua profissão?")


def test_responde_historia_da_doenca(infarto):
    assert "2 horas" in responder_demo(infarto, "Quando começou a dor?")
    assert "tórax" in responder_demo(infarto, "Onde é a dor?")
    assert "8/10" in responder_demo(infarto, "Qual a intensidade da dor?")


def test_responde_sintomas_e_antecedentes(infarto):
    assert responder_demo(infarto, "O senhor sente suor frio?").startswith("Sim")
    assert "Sim" in responder_demo(infarto, "O senhor tem pressão alta?")
    assert "Não" in responder_demo(infarto, "Tem diabetes?")
    assert "maço" in responder_demo(infarto, "O senhor fuma?")
    assert "infarto aos 62" in responder_demo(infarto, "Alguém na família teve problema?")


def test_pergunta_desconhecida_cai_no_padrao(infarto):
    assert responder_demo(infarto, "xyz abc") == RESPOSTA_PADRAO


def test_nao_revela_sensivel_em_pergunta_generica(violencia):
    resposta = responder_demo(violencia, "O que a senhora está sentindo?")
    assert "inútil" not in resposta
    assert "insônia" in resposta.lower()


def test_revela_intermediaria_e_sensivel_com_pergunta_direta(violencia):
    assert "casamento" in responder_demo(violencia, "Como vai o seu casamento?")
    assert "inútil" in responder_demo(violencia, "Ele às vezes humilha a senhora?")


@pytest.fixture(scope="module")
def depressao():
    with open(RAIZ / "casos" / "depressao.json", encoding="utf-8") as f:
        return json.load(f)


@pytest.fixture(scope="module")
def panico():
    with open(RAIZ / "casos" / "transtorno_de_panico.json", encoding="utf-8") as f:
        return json.load(f)


def test_caso_de_psicologia_responde_sintomas(depressao, panico):
    assert responder_demo(depressao, "O senhor tem se sentido triste?").startswith("Sim")
    assert "apetite" in responder_demo(depressao, "Como está o apetite?").lower()
    assert responder_demo(panico, "Sente o coração acelerado?").startswith("Sim")
    assert responder_demo(panico, "Você tem sentido tristeza?").startswith("Não")


def test_sensivel_de_psicologia_so_com_pergunta_direta(depressao):
    generica = responder_demo(depressao, "O que o senhor está sentindo?")
    assert "não acordar" not in generica.lower()

    direta = responder_demo(depressao, "Você tem pensado em morrer ou se machucar?")
    assert "dormir e não acordar" in direta.lower()
