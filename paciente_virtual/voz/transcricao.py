"""Transcrição de fala: Whisper local (open source) com fallback no Google.

O motor preferido é o `faster-whisper <https://github.com/SYSTRAN/faster-whisper>`_
(licença MIT), que roda offline na CPU e tem ótimo desempenho em português
brasileiro. Instale com::

    pip install "paciente-virtual[voz-local]"

Na primeira transcrição o modelo é baixado do Hugging Face e fica em cache.
Sem o pacote instalado, a transcrição usa o serviço gratuito do Google
(requer internet), como antes.

Variáveis de ambiente:

- ``PACIENTE_VIRTUAL_STT``: ``auto`` (padrão), ``whisper`` ou ``google``.
- ``PACIENTE_VIRTUAL_WHISPER``: tamanho do modelo (``small`` padrão; ``base``
  é mais leve, ``medium`` mais preciso).
"""

import os

TAXA_WHISPER = 16000

_modelo_whisper = None
_whisper_indisponivel = False


def motor_configurado():
    return os.environ.get("PACIENTE_VIRTUAL_STT", "auto").lower()


def _nome_modelo():
    return os.environ.get("PACIENTE_VIRTUAL_WHISPER", "small")


def whisper_disponivel():
    """True quando o faster-whisper está instalado e não foi desativado."""
    global _whisper_indisponivel

    if motor_configurado() == "google" or _whisper_indisponivel:
        return False

    try:
        import faster_whisper  # noqa: F401
    except ImportError:
        _whisper_indisponivel = True
        return False

    return True


def _carregar_whisper():
    global _modelo_whisper

    if _modelo_whisper is None:
        from faster_whisper import WhisperModel

        print(f"(carregando modelo Whisper '{_nome_modelo()}'; na primeira vez ele é baixado)")
        _modelo_whisper = WhisperModel(_nome_modelo(), device="cpu", compute_type="int8")

    return _modelo_whisper


def transcrever_com_whisper(audio):
    """Transcreve fala em português com o Whisper local.

    ``audio`` pode ser um caminho, um arquivo/file-like em qualquer formato
    comum (wav, webm, ogg, mp3...) ou um array numpy float32 mono a 16 kHz.
    """
    modelo = _carregar_whisper()
    segmentos, _ = modelo.transcribe(audio, language="pt", beam_size=5)
    return " ".join(segmento.text.strip() for segmento in segmentos).strip()


def transcrever_amostras(amostras_int16, taxa):
    """Transcreve um array numpy int16 vindo do microfone."""
    import numpy as np

    audio = amostras_int16.astype(np.float32).flatten() / 32768.0

    if taxa != TAXA_WHISPER:
        # Reamostragem linear simples — suficiente para fala.
        destino = int(len(audio) * TAXA_WHISPER / taxa)
        audio = np.interp(
            np.linspace(0, len(audio) - 1, destino),
            np.arange(len(audio)),
            audio,
        ).astype(np.float32)

    return transcrever_com_whisper(audio)


def transcrever_com_google(amostras_int16, taxa):
    """Transcreve pelo serviço gratuito do Google (requer internet).

    Levanta ``speech_recognition.UnknownValueError`` quando a fala não é
    compreendida e ``speech_recognition.RequestError`` sem conectividade.
    """
    import speech_recognition as sr

    dados = sr.AudioData(amostras_int16.tobytes(), taxa, 2)
    reconhecedor = sr.Recognizer()
    return reconhecedor.recognize_google(dados, language="pt-BR")
