"""Testes da camada de voz.

Os testes de integração (síntese e transcrição reais) só rodam quando o
extra ``voz-local`` está instalado — no CI eles são pulados.
"""

import pytest

from paciente_virtual.voz import falar as sintese
from paciente_virtual.voz import transcricao


@pytest.fixture(autouse=True)
def motores_reativados(monkeypatch):
    """Isola as memórias de indisponibilidade entre os testes."""
    monkeypatch.setattr(transcricao, "_whisper_indisponivel", False)
    monkeypatch.setattr(
        sintese, "_motor_local_indisponivel", {"piper": False, "kokoro": False}
    )


def test_motor_stt_padrao_e_auto(monkeypatch):
    monkeypatch.delenv("PACIENTE_VIRTUAL_STT", raising=False)
    assert transcricao.motor_configurado() == "auto"


def test_stt_google_desativa_whisper(monkeypatch):
    monkeypatch.setenv("PACIENTE_VIRTUAL_STT", "google")
    assert not transcricao.whisper_disponivel()


def test_tts_edge_desativa_voz_local(monkeypatch):
    monkeypatch.setenv("PACIENTE_VIRTUAL_TTS", "edge")
    assert not sintese.voz_local_disponivel("masculino")


def test_voz_local_exige_configuracao_do_genero(monkeypatch):
    monkeypatch.delenv("PACIENTE_VIRTUAL_TTS", raising=False)
    monkeypatch.setitem(sintese.VOZES_LOCAIS, "feminino", "")
    assert not sintese.voz_local_disponivel("feminino")


def test_sintetizar_sem_voz_configurada_levanta_erro(monkeypatch):
    monkeypatch.setitem(sintese.VOZES_LOCAIS, "feminino", "")
    with pytest.raises(ValueError):
        sintese.sintetizar_wav("Olá", "feminino")


def test_ida_e_volta_piper_whisper(monkeypatch):
    """Piper fala uma frase e o Whisper a transcreve de volta."""
    pytest.importorskip("piper")
    pytest.importorskip("faster_whisper")
    monkeypatch.delenv("PACIENTE_VIRTUAL_TTS", raising=False)
    monkeypatch.delenv("PACIENTE_VIRTUAL_STT", raising=False)

    import io

    frase = "O paciente está com dor no peito há duas horas."
    try:
        wav = sintese.sintetizar_wav(frase, "masculino")
        assert wav[:4] == b"RIFF"
        texto = transcricao.transcrever_com_whisper(io.BytesIO(wav))
    except Exception as erro:  # modelos exigem download do Hugging Face
        pytest.skip(f"modelos locais indisponíveis neste ambiente: {erro}")

    assert "dor no peito" in texto.lower()


def test_ida_e_volta_kokoro_whisper(monkeypatch):
    """Kokoro (voz feminina) fala uma frase e o Whisper a transcreve."""
    pytest.importorskip("kokoro")
    pytest.importorskip("faster_whisper")
    monkeypatch.delenv("PACIENTE_VIRTUAL_TTS", raising=False)
    monkeypatch.delenv("PACIENTE_VIRTUAL_STT", raising=False)

    import io

    frase = "Estou com muita dor de cabeça e não durmo bem."
    try:
        wav = sintese.sintetizar_wav(frase, "feminino")
        assert wav[:4] == b"RIFF"
        texto = transcricao.transcrever_com_whisper(io.BytesIO(wav))
    except Exception as erro:
        pytest.skip(f"modelos locais indisponíveis neste ambiente: {erro}")

    assert "dor de cabe" in texto.lower()
