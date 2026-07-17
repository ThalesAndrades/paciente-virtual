import pytest

from paciente_virtual import relatorio
from paciente_virtual.registro import estruturar_transcript, extrair_metadados

TRANSCRICAO = """\
==================================================
CASO: infarto
ALUNO: Maria Silva
INICIO: 2026-07-17 10:00:00
==================================================

PROFISSIONAL: quando começou a dor?

PACIENTE: Começou há 2 horas.
Estou com muito medo, doutor.

PROFISSIONAL: solicito ecg

EXAME SOLICITADO: Eletrocardiograma
RESULTADO: Supradesnivelamento de ST

ENCERRADA: 2026-07-17 10:12:00
"""


@pytest.fixture
def historico(tmp_path, monkeypatch):
    monkeypatch.setattr(relatorio, "DIR_HISTORICO", tmp_path)
    (tmp_path / "infarto_Maria_Silva_20260717_100000.txt").write_text(
        TRANSCRICAO, encoding="utf-8"
    )
    # Histórico antigo, sem cabeçalho de metadados.
    (tmp_path / "infarto_20260101_090000.txt").write_text(
        "PROFISSIONAL: olá\n\nPACIENTE: Olá, doutor.\n", encoding="utf-8"
    )
    return tmp_path


def test_extrair_metadados():
    metadados = extrair_metadados(TRANSCRICAO)
    assert metadados == {
        "caso": "infarto",
        "aluno": "Maria Silva",
        "inicio": "2026-07-17 10:00:00",
        "encerrada": True,
    }


def test_estruturar_transcript_agrupa_falas_e_exames():
    eventos = estruturar_transcript(TRANSCRICAO)

    assert [evento["tipo"] for evento in eventos] == [
        "profissional",
        "paciente",
        "profissional",
        "exame",
    ]
    # Fala com múltiplas linhas fica no mesmo evento.
    assert "muito medo" in eventos[1]["texto"]
    assert eventos[3]["nome"] == "Eletrocardiograma"
    assert eventos[3]["texto"] == "Supradesnivelamento de ST"
    # Metadados não viram eventos.
    assert all("CASO" not in evento.get("texto", "") for evento in eventos)


def test_listar_consultas(historico):
    consultas = relatorio.listar_consultas()

    assert len(consultas) == 2
    recente, antiga = consultas

    assert recente["aluno"] == "Maria Silva"
    assert recente["caso"] == "infarto"
    assert recente["encerrada"] is True
    assert recente["nota"] > 0  # "quando começou" e "ecg" pontuam na rubrica real

    # A antiga não tem cabeçalho: caso vem do nome do arquivo.
    assert antiga["caso"] == "infarto"
    assert antiga["aluno"] is None
    assert antiga["encerrada"] is False


def test_detalhar_consulta(historico):
    detalhe = relatorio.detalhar_consulta("infarto_Maria_Silva_20260717_100000.txt")

    assert detalhe["aluno"] == "Maria Silva"
    assert detalhe["checklist"]["nota_total"] > 0
    assert [evento["tipo"] for evento in detalhe["eventos"]][:2] == ["profissional", "paciente"]


def test_detalhar_consulta_bloqueia_caminhos_estranhos(historico):
    assert relatorio.detalhar_consulta("nao_existe.txt") is None
    assert relatorio.detalhar_consulta("../pyproject.toml") is None
    assert relatorio.detalhar_consulta("../../etc/passwd") is None
