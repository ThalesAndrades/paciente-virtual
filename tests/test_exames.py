import pytest

from paciente_virtual.exames import verificar_exame_fisico, verificar_exames

CASO = {
    "exame_fisico": {
        "pressao_arterial": {
            "nome": "Pressão arterial",
            "sinonimos": ["pressão", "pa"],
            "resultado": "170/100 mmHg",
        },
        "temperatura": {
            "nome": "Temperatura",
            "sinonimos": ["febre", "termômetro"],
            "resultado": "36,5°C",
        },
    },
    "exames_disponiveis": {
        "ecg": {
            "nome": "Eletrocardiograma",
            "sinonimos": ["ecg", "eletro"],
            "resultado": "Supradesnivelamento de ST",
        },
        "raio_x": {
            "nome": "Raio X",
            "sinonimos": ["raio x", "rx", "radiografia"],
            "resultado": "Sem alterações agudas",
        },
    },
}


@pytest.fixture
def historico(tmp_path):
    arquivo = tmp_path / "historico.txt"
    arquivo.touch()
    return arquivo


@pytest.fixture(autouse=True)
def sem_voz(monkeypatch):
    monkeypatch.setattr("paciente_virtual.exames.falar", lambda *args, **kwargs: None)


def test_anamnese_nao_dispara_exame_fisico(historico):
    # Perguntas de história clínica mencionam os mesmos termos, mas não
    # são solicitações de medição.
    assert not verificar_exame_fisico("o senhor tem pressão alta?", CASO, historico, "m")
    assert not verificar_exame_fisico("o senhor teve febre ontem?", CASO, historico, "m")
    assert not verificar_exame_fisico(
        "Sr. Medeiros, sente pressão no peito?", CASO, historico, "m"
    )
    assert historico.read_text(encoding="utf-8") == ""


def test_anamnese_nao_dispara_exame_complementar(historico):
    assert not verificar_exames("o senhor já fez um eletro alguma vez?", CASO, historico, "m")
    assert not verificar_exames("já fez exame de raio x antes?", CASO, historico, "m")
    assert historico.read_text(encoding="utf-8") == ""


def test_exame_fisico_dispara_com_verbo(historico):
    assert verificar_exame_fisico("vou aferir sua pressão", CASO, historico, "m")

    conteudo = historico.read_text(encoding="utf-8")
    assert "EXAME FÍSICO: Pressão arterial" in conteudo
    assert "RESULTADO: 170/100 mmHg" in conteudo


def test_exame_fisico_dispara_com_pergunta_de_medida(historico):
    assert verificar_exame_fisico("qual a pressão dele?", CASO, historico, "m")


def test_exame_fisico_ignora_acentos(historico):
    assert verificar_exame_fisico("vou medir sua pressao", CASO, historico, "m")


def test_exame_complementar_dispara_com_solicitacao(historico):
    entregues = verificar_exames("solicito um ecg", CASO, historico, "m")
    assert [dados["nome"] for dados in entregues] == ["Eletrocardiograma"]

    conteudo = historico.read_text(encoding="utf-8")
    assert "EXAME SOLICITADO: Eletrocardiograma" in conteudo


def test_exame_complementar_com_hifen(historico):
    assert verificar_exames("quero um raio-x de tórax", CASO, historico, "m")


def test_frase_com_varios_exames_entrega_todos(historico):
    entregues = verificar_exames("solicito ecg e raio x", CASO, historico, "m")
    assert {dados["nome"] for dados in entregues} == {"Eletrocardiograma", "Raio X"}

    conteudo = historico.read_text(encoding="utf-8")
    assert "Eletrocardiograma" in conteudo
    assert "Raio X" in conteudo


def test_exame_complementar_nao_dispara_sem_mencao(historico):
    assert not verificar_exames("solicito uma avaliação da dor", CASO, historico, "m")


def test_caso_sem_exames():
    assert not verificar_exames("solicito ecg", {}, None, "m")
    assert not verificar_exame_fisico("vou aferir a pressão", {}, None, "m")
