"""Síntese de fala em pt-BR, do motor mais aberto ao mais básico.

1. **Vozes locais open source** — rodam offline, na CPU, com modelos baixados
   do Hugging Face na primeira fala (instale com
   ``pip install "paciente-virtual[voz-local]"``):

   - `Piper <https://github.com/rhasspy/piper>`_ (MIT) — leve e rápido;
     vozes brasileiras masculinas (faber, cadu, jeff, edresson).
   - `Kokoro <https://github.com/hexgrad/kokoro>`_ (Apache-2.0) — voz
     brasileira feminina ``pf_dora`` (e masculinas ``pm_alex``/``pm_santa``).

2. **edge-tts** — vozes neurais da Microsoft (gratuitas, requer internet).
3. **pyttsx3** — voz local do sistema operacional (robótica; último recurso).

Variáveis de ambiente:

- ``PACIENTE_VIRTUAL_TTS``: ``auto`` (padrão), ``local``, ``edge`` ou ``pyttsx3``.
- ``PACIENTE_VIRTUAL_VOZ_FEMININA`` / ``PACIENTE_VIRTUAL_VOZ_MASCULINA``:
  voz local no formato ``motor:voz`` (ex.: ``piper:pt_BR-faber-medium``,
  ``kokoro:pf_dora``).
"""

import asyncio
import io
import os
import re
import tempfile
import wave

VOZES_EDGE = {
    "feminino": "pt-BR-FranciscaNeural",
    "masculino": "pt-BR-AntonioNeural",
}

# Voz local por gênero, no formato "motor:voz". O Piper não tem voz feminina
# pt-BR até o momento, por isso o feminino usa o Kokoro (pf_dora).
VOZES_LOCAIS = {
    "feminino": os.environ.get("PACIENTE_VIRTUAL_VOZ_FEMININA", "kokoro:pf_dora"),
    "masculino": os.environ.get("PACIENTE_VIRTUAL_VOZ_MASCULINA", "piper:pt_BR-faber-medium"),
}

VELOCIDADE = "-8%"

TAXA_KOKORO = 24000

_vozes_piper = {}
_pipeline_kokoro = None

# Depois que um motor falha uma vez (pacote ausente, sem internet para baixar
# o modelo...), as falas seguintes pulam direto para o próximo, sem repagar
# o custo da tentativa.
_motor_local_indisponivel = {"piper": False, "kokoro": False}
_edge_indisponivel = False


def motor_configurado():
    return os.environ.get("PACIENTE_VIRTUAL_TTS", "auto").lower()


def _preparar_texto(texto):
    texto = (texto or "").strip()
    if not texto:
        return ""
    return re.sub(r"\s+", " ", texto)


def _dividir_para_fala(texto, max_chars=2800):
    if len(texto) <= max_chars:
        return [texto]

    partes = re.split(r"(?<=[.!?])\s+", texto)
    blocos = []
    atual = ""

    for parte in partes:
        parte = parte.strip()
        if not parte:
            continue

        candidato = f"{atual} {parte}".strip()
        if len(candidato) <= max_chars:
            atual = candidato
        else:
            if atual:
                blocos.append(atual)
            atual = parte

    if atual:
        blocos.append(atual)

    return blocos or [texto]


# ==========================
# Motor 1: vozes locais open source (Piper e Kokoro)
# ==========================


def _motor_e_voz(tipo_voz):
    valor = VOZES_LOCAIS.get(tipo_voz) or ""
    if ":" not in valor:
        return None, None
    motor, voz = valor.split(":", 1)
    return motor.strip().lower(), voz.strip()


def voz_local_disponivel(tipo_voz="feminino"):
    """True quando há motor local instalado e voz configurada para o gênero."""
    if motor_configurado() in ("edge", "pyttsx3"):
        return False

    motor, voz = _motor_e_voz(tipo_voz)
    if not voz or _motor_local_indisponivel.get(motor, True):
        return False

    try:
        if motor == "piper":
            import piper  # noqa: F401
        else:
            import kokoro  # noqa: F401
    except ImportError:
        _motor_local_indisponivel[motor] = True
        return False

    return True


def _carregar_voz_piper(nome):
    if nome not in _vozes_piper:
        from huggingface_hub import hf_hub_download
        from piper import PiperVoice

        # "pt_BR-faber-medium" -> pt/pt_BR/faber/medium/pt_BR-faber-medium.onnx
        locale, voz, qualidade = nome.split("-", 2)
        idioma = locale.split("_")[0]
        caminho = f"{idioma}/{locale}/{voz}/{qualidade}/{nome}.onnx"

        print(f"(carregando voz local '{nome}'; na primeira vez ela é baixada)")
        onnx = hf_hub_download("rhasspy/piper-voices", caminho)
        config = hf_hub_download("rhasspy/piper-voices", f"{caminho}.json")

        _vozes_piper[nome] = PiperVoice.load(onnx, config_path=config)

    return _vozes_piper[nome]


def _sintetizar_piper_para_wave(voz, texto, wav):
    """Compatível com as duas gerações da API do Piper."""
    try:
        voz.synthesize(texto, wav)
    except TypeError:
        # piper >= 1.3: synthesize(texto) devolve blocos de áudio.
        primeiro = True
        for bloco in voz.synthesize(texto):
            if primeiro:
                wav.setnchannels(1)
                wav.setsampwidth(2)
                wav.setframerate(bloco.sample_rate)
                primeiro = False
            wav.writeframes(bloco.audio_int16_bytes)


def _wav_piper(texto, nome_voz):
    voz = _carregar_voz_piper(nome_voz)

    buffer = io.BytesIO()
    with wave.open(buffer, "wb") as wav:
        _sintetizar_piper_para_wave(voz, texto, wav)

    return buffer.getvalue()


def _carregar_kokoro():
    global _pipeline_kokoro

    if _pipeline_kokoro is None:
        from kokoro import KPipeline

        print("(carregando voz local Kokoro; na primeira vez o modelo é baixado)")
        # lang_code "p" = português brasileiro.
        _pipeline_kokoro = KPipeline(lang_code="p", repo_id="hexgrad/Kokoro-82M")

    return _pipeline_kokoro


def _wav_kokoro(texto, nome_voz):
    import numpy as np

    pipeline = _carregar_kokoro()

    partes = []
    for resultado in pipeline(texto, voice=nome_voz):
        audio = resultado.audio if hasattr(resultado, "audio") else resultado[2]
        if hasattr(audio, "numpy"):
            audio = audio.numpy()
        partes.append(np.asarray(audio, dtype=np.float32))

    amostras = np.concatenate(partes) if partes else np.zeros(1, dtype=np.float32)
    int16 = np.clip(amostras * 32767.0, -32768, 32767).astype(np.int16)

    buffer = io.BytesIO()
    with wave.open(buffer, "wb") as wav:
        wav.setnchannels(1)
        wav.setsampwidth(2)
        wav.setframerate(TAXA_KOKORO)
        wav.writeframes(int16.tobytes())

    return buffer.getvalue()


def sintetizar_wav(texto, tipo_voz="feminino"):
    """Gera bytes WAV com a voz local do gênero. Levanta exceção se indisponível."""
    motor, voz = _motor_e_voz(tipo_voz)

    if motor == "piper":
        return _wav_piper(texto, voz)
    if motor == "kokoro":
        return _wav_kokoro(texto, voz)

    raise ValueError(f"Nenhuma voz local configurada para '{tipo_voz}'.")


def _tocar_wav(dados):
    from playsound3 import playsound

    with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as arquivo:
        caminho = arquivo.name
        arquivo.write(dados)

    try:
        playsound(caminho, block=True)
    finally:
        try:
            os.unlink(caminho)
        except OSError:
            pass


def _falar_local(texto, tipo_voz):
    for bloco in _dividir_para_fala(texto):
        _tocar_wav(sintetizar_wav(bloco, tipo_voz))


# ==========================
# Motor 2: edge-tts (nuvem, gratuito)
# ==========================


async def _falar_edge(texto, tipo_voz):
    import edge_tts
    from playsound3 import playsound

    voz = VOZES_EDGE.get(tipo_voz, VOZES_EDGE["feminino"])

    for bloco in _dividir_para_fala(texto):
        with tempfile.NamedTemporaryFile(suffix=".mp3", delete=False) as arquivo:
            path = arquivo.name

        try:
            communicate = edge_tts.Communicate(bloco, voz, rate=VELOCIDADE)
            await communicate.save(path)
            playsound(path, block=True)
        finally:
            try:
                os.unlink(path)
            except OSError:
                pass


# ==========================
# Motor 3: pyttsx3 (voz do sistema)
# ==========================


def _criar_engine_pyttsx3():
    import pyttsx3

    try:
        return pyttsx3.init("sapi5")
    except Exception:
        return pyttsx3.init()


def _escolher_voz_pyttsx3(voices, tipo_voz="feminino"):
    if not voices:
        return None

    def match(prefs):
        for termo in prefs:
            for voz in voices:
                info = f"{voz.name} {voz.id}".lower()
                # "male" como substring casaria com "female"; exige que não
                # haja "fe" imediatamente antes.
                if termo == "male":
                    if re.search(r"(?<!fe)male", info):
                        return voz.id
                elif termo in info:
                    return voz.id
        return None

    pt_prefs = ("maria", "pt-br", "portuguese", "português")

    if tipo_voz == "masculino":
        voz_id = match(("david", "male", "masculino", "homem"))
        if voz_id:
            return voz_id
        voz_id = match(pt_prefs)
        if voz_id:
            return voz_id
    else:
        voz_id = match((*pt_prefs, "female", "feminino", "zira"))
        if voz_id:
            return voz_id

    return voices[0].id


def _falar_pyttsx3(texto, tipo_voz):
    engine = _criar_engine_pyttsx3()
    voices = engine.getProperty("voices")

    voz_id = _escolher_voz_pyttsx3(voices, tipo_voz)
    if voz_id:
        engine.setProperty("voice", voz_id)

    engine.setProperty("rate", 160)

    try:
        for bloco in _dividir_para_fala(texto, max_chars=500):
            engine.say(bloco)
        engine.runAndWait()
    finally:
        try:
            engine.stop()
        except Exception:
            pass


# ==========================
# Orquestração
# ==========================


def falar(texto, tipo_voz="feminino"):
    """Fala o texto com o melhor motor disponível para o gênero da voz."""
    global _edge_indisponivel

    texto = _preparar_texto(texto)
    if not texto:
        return

    motor = motor_configurado()

    if motor in ("auto", "local") and voz_local_disponivel(tipo_voz):
        try:
            _falar_local(texto, tipo_voz)
            return
        except Exception as erro:
            nome_motor, _ = _motor_e_voz(tipo_voz)
            _motor_local_indisponivel[nome_motor] = True
            print(f"(voz local indisponível nesta sessão: {erro})")
            if motor == "local":
                return

    if motor in ("auto", "local", "edge") and not _edge_indisponivel:
        try:
            asyncio.run(_falar_edge(texto, tipo_voz))
            return
        except Exception:
            _edge_indisponivel = True
            print("(voz neural edge-tts indisponível, usando o próximo motor)")

    try:
        _falar_pyttsx3(texto, tipo_voz)
    except Exception as erro:
        print(f"(síntese de voz indisponível: {erro})")
