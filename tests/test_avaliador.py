from pathlib import Path

import pytest

from paciente_virtual import avaliador
from paciente_virtual.avaliador import (
    avaliar_checklist,
    detectar_caso,
    extrair_texto_profissional,
    termos_do_item,
)

TRANSCRICAO = """\
==================================================
CASO: infarto
ALUNO: Douglas DM
INICIO: 2026-07-10 22:39:16
==================================================

PROFISSIONAL: quando começou a dor?

PACIENTE: A dor começou há 2 horas. Sinto sudorese e náusea.

PROFISSIONAL: solicito ecg

EXAME SOLICITADO: Eletrocardiograma
RESULTADO: Supradesnivelamento de ST
"""


def test_detectar_caso_pelo_cabecalho(tmp_path):
    arquivo = tmp_path / "qualquer_nome.txt"
    assert detectar_caso(arquivo, TRANSCRICAO) == "infarto"


@pytest.fixture
def rubricas(tmp_path, monkeypatch):
    dir_avaliacoes = tmp_path / "avaliacoes"
    dir_avaliacoes.mkdir()
    (dir_avaliacoes / "infarto.json").write_text("{}", encoding="utf-8")
    (dir_avaliacoes / "violencia_psicologica.json").write_text("{}", encoding="utf-8")
    monkeypatch.setattr(avaliador, "DIR_AVALIACOES", dir_avaliacoes)
    return dir_avaliacoes


def test_detectar_caso_por_nome_de_arquivo_antigo(rubricas):
    texto_sem_cabecalho = "PROFISSIONAL: olá\n"

    # Formatos antigos de nome de arquivo, inclusive com nome de aluno
    # contendo espaço/underscore — o bug que quebrava o avaliador antigo.
    for nome in (
        "infarto_20260617_214329.txt",
        "infarto_historico.txt",
        "infarto_Douglas DM_20260710_223916.txt",
        "infarto_Douglas_Dal_Molin_20260624.txt",
    ):
        assert detectar_caso(Path(nome), texto_sem_cabecalho) == "infarto"

    assert (
        detectar_caso(Path("violencia_psicologica_20260610.txt"), texto_sem_cabecalho)
        == "violencia_psicologica"
    )


def test_detectar_caso_desconhecido(rubricas):
    assert detectar_caso(Path("caso_inexistente_20260101.txt"), "sem cabeçalho") is None


def test_extrair_texto_profissional_exclui_paciente_resultado_e_cabecalho():
    texto = extrair_texto_profissional(TRANSCRICAO)

    assert "quando começou a dor?" in texto
    assert "EXAME SOLICITADO: Eletrocardiograma" in texto
    # Fala do paciente, conteúdo de resultado e cabeçalho não pontuam.
    assert "sudorese" not in texto
    assert "Supradesnivelamento" not in texto
    assert "CASO:" not in texto
    assert "iniciada" not in texto.lower()


def test_termos_do_item_aceita_string_e_objeto():
    assert termos_do_item("ecg") == ("ecg", ["ecg"])
    assert termos_do_item({"nome": "início", "termos": ["começou"]}) == (
        "início",
        ["começou"],
    )
    assert termos_do_item({"nome": "ecg"}) == ("ecg", ["ecg"])


def test_avaliar_checklist_pontua_por_termos():
    rubrica = {
        "criterios": [
            {
                "nome": "Caracterização da dor",
                "peso": 4,
                "objetivo": "Caracterizar a dor.",
                "itens": [
                    {"nome": "início", "termos": ["quando começou", "início"]},
                    {"nome": "irradiação", "termos": ["irradia", "espalha"]},
                ],
            },
            {
                "nome": "Exames",
                "peso": 6,
                "objetivo": "Solicitar exames.",
                "itens": [{"nome": "ecg", "termos": ["ecg", "eletrocardiograma"]}],
            },
        ]
    }

    texto = extrair_texto_profissional(TRANSCRICAO)
    nota = avaliar_checklist(rubrica, texto)

    # "quando começou" e "ecg" presentes (2 + 6); "irradiação" ausente.
    assert nota == pytest.approx(8.0)


def test_avaliar_checklist_nao_pontua_fala_do_paciente_nem_resultado():
    rubrica = {
        "criterios": [
            {
                "nome": "Sintomas associados",
                "peso": 10,
                "objetivo": "Investigar sintomas.",
                "itens": [
                    {"nome": "sudorese", "termos": ["sudorese", "suor"]},
                    {"nome": "achado de exame", "termos": ["supradesnivelamento"]},
                ],
            }
        ]
    }

    # "sudorese" aparece só na fala do paciente; "supradesnivelamento" só no
    # conteúdo do resultado — nenhum dos dois é investigação do aluno.
    nota = avaliar_checklist(rubrica, extrair_texto_profissional(TRANSCRICAO))
    assert nota == pytest.approx(0.0)


def test_avaliar_checklist_ignora_criterio_sem_itens():
    rubrica = {
        "criterios": [
            {"nome": "Rascunho", "peso": 2, "objetivo": "Em construção.", "itens": []},
            {
                "nome": "Exames",
                "peso": 8,
                "objetivo": "Solicitar exames.",
                "itens": [{"nome": "ecg", "termos": ["ecg"]}],
            },
        ]
    }

    nota = avaliar_checklist(rubrica, extrair_texto_profissional(TRANSCRICAO))
    assert nota == pytest.approx(8.0)
