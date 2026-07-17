"""Síntese de fala: edge-tts (vozes neurais pt-BR) com fallback local via pyttsx3."""

import asyncio
import os
import re
import tempfile

VOZES_EDGE = {
    "feminino": "pt-BR-FranciscaNeural",
    "masculino": "pt-BR-AntonioNeural",
}

VELOCIDADE = "-8%"


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


# Depois que o edge-tts falha uma vez (tipicamente por falta de internet),
# as falas seguintes vão direto para a voz local, sem repagar o timeout.
_edge_indisponivel = False


def falar(texto, tipo_voz="feminino"):
    """Fala o texto com voz neural; sem internet, usa a voz local do sistema."""
    global _edge_indisponivel

    texto = _preparar_texto(texto)
    if not texto:
        return

    if not _edge_indisponivel:
        try:
            asyncio.run(_falar_edge(texto, tipo_voz))
            return
        except Exception:
            _edge_indisponivel = True
            print("(voz neural indisponível, usando voz local nesta sessão)")

    try:
        _falar_pyttsx3(texto, tipo_voz)
    except Exception as erro:
        print(f"(síntese de voz indisponível: {erro})")
