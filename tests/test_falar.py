from types import SimpleNamespace

from paciente_virtual.voz.falar import _dividir_para_fala, _escolher_voz_pyttsx3


def _voz(nome, id_voz):
    return SimpleNamespace(name=nome, id=id_voz)


def test_voz_masculina_nao_casa_com_female():
    vozes = [
        _voz("english+female1", "gmw/en+f1"),
        _voz("brazilian male", "pt/male1"),
    ]
    assert _escolher_voz_pyttsx3(vozes, "masculino") == "pt/male1"


def test_voz_feminina_prefere_portugues():
    vozes = [
        _voz("english female", "en/f1"),
        _voz("Maria pt-BR", "pt/maria"),
    ]
    assert _escolher_voz_pyttsx3(vozes, "feminino") == "pt/maria"


def test_sem_vozes_retorna_none():
    assert _escolher_voz_pyttsx3([], "feminino") is None


def test_dividir_para_fala_respeita_limite():
    texto = "Primeira frase. " * 300
    blocos = _dividir_para_fala(texto.strip(), max_chars=500)
    assert all(len(bloco) <= 500 for bloco in blocos)
    assert " ".join(blocos).split() == texto.split()
