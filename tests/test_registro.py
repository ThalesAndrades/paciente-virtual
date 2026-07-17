import pytest

from paciente_virtual import exames, registro
from paciente_virtual.registro import (
    criar_historico,
    extrair_caso_do_cabecalho,
    extrair_texto_profissional,
    sanitizar_nome,
)


def test_sanitizar_nome():
    assert sanitizar_nome("Douglas Dal Molin") == "Douglas_Dal_Molin"
    assert sanitizar_nome("a/b\\c: d") == "abc_d"
    assert sanitizar_nome("   ") == "aluno"


def test_criar_historico_escreve_cabecalho(tmp_path, monkeypatch):
    monkeypatch.setattr(registro, "DIR_HISTORICO", tmp_path)

    arquivo = criar_historico("infarto", "Douglas DM")

    assert arquivo.parent == tmp_path
    conteudo = arquivo.read_text(encoding="utf-8")
    assert extrair_caso_do_cabecalho(conteudo) == "infarto"
    assert "ALUNO: Douglas DM" in conteudo


def test_extrair_caso_sem_cabecalho():
    assert extrair_caso_do_cabecalho("PROFISSIONAL: olá\n") is None


def test_roundtrip_escrita_do_motor_e_leitura_do_avaliador(tmp_path, monkeypatch):
    """O que os motores de exame escrevem deve ser reconhecido pelo leitor —
    e o conteúdo do RESULTADO (dado do caso) deve ficar de fora."""
    monkeypatch.setattr("paciente_virtual.exames.falar", lambda *a, **k: None)

    arquivo = tmp_path / "h.txt"
    arquivo.touch()

    caso = {
        "exame_fisico": {
            "afetividade": {
                "nome": "Afetividade",
                "sinonimos": ["humor"],
                "resultado": "Triste e ansiosa durante toda a entrevista.",
            }
        }
    }
    assert exames.verificar_exame_fisico("vou avaliar seu humor", caso, arquivo, "f")

    texto = extrair_texto_profissional(arquivo.read_text(encoding="utf-8"))

    assert "EXAME FÍSICO: Afetividade" in texto
    # O resultado descreve o estado da paciente; não é investigação do aluno
    # e não pode pontuar a rubrica (ex.: itens "tristeza"/"ansiedade").
    assert "Triste" not in texto
    assert "ansiosa" not in texto


@pytest.mark.parametrize(
    "linha, mantida",
    [
        ("PROFISSIONAL: quando começou?", True),
        ("EXAME FÍSICO: Pressão arterial", True),
        ("EXAME SOLICITADO: Eletrocardiograma", True),
        ("RESULTADO: 170/100 mmHg", False),
        ("PACIENTE: começou há 2 horas", False),
        ("CASO: infarto", False),
    ],
)
def test_filtro_de_linhas_do_profissional(linha, mantida):
    assert (linha in extrair_texto_profissional(linha)) is mantida
