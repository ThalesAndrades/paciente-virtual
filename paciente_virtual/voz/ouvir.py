"""Captura de áudio do microfone com detecção de silêncio e transcrição.

O limiar de fala é calibrado a cada gravação a partir do ruído ambiente dos
primeiros blocos, com um piso configurável (``PACIENTE_VIRTUAL_LIMIAR_FALA``)
para microfones com pouco ganho.
"""

from ..config import LIMIAR_FALA_MINIMO
from . import transcricao

TAXA_AMOSTRAGEM = 16000
DURACAO_BLOCO = 0.1  # segundos por bloco de leitura
BLOCOS_CALIBRACAO = 3  # blocos iniciais usados para medir o ruído ambiente
FATOR_ACIMA_AMBIENTE = 3.0  # fala = amplitude N vezes acima do ambiente
ESPERA_MAXIMA_INICIO = 10  # segundos aguardando o início da fala
SILENCIO_PARA_ENCERRAR = 1.5  # segundos de silêncio que encerram a captura
DURACAO_MAXIMA = 60  # segundos totais de gravação


def _gravar():
    """Grava do microfone até detectar silêncio. Retorna um array int16 ou None."""
    import numpy as np
    import sounddevice as sd

    tamanho_bloco = int(TAXA_AMOSTRAGEM * DURACAO_BLOCO)
    blocos_max_inicio = int(ESPERA_MAXIMA_INICIO / DURACAO_BLOCO)
    blocos_max_total = int(DURACAO_MAXIMA / DURACAO_BLOCO)
    blocos_silencio_fim = int(SILENCIO_PARA_ENCERRAR / DURACAO_BLOCO)

    blocos = []
    bloco_anterior = None
    blocos_em_silencio = 0
    falando = False
    ambiente = []
    limiar = LIMIAR_FALA_MINIMO

    print("\nFale agora...")

    with sd.InputStream(
        samplerate=TAXA_AMOSTRAGEM,
        channels=1,
        dtype="int16",
        blocksize=tamanho_bloco,
    ) as stream:
        for i in range(blocos_max_total):
            bloco, _ = stream.read(tamanho_bloco)
            amplitude = float(np.abs(bloco).mean())

            # Calibração: mede o ruído ambiente nos primeiros blocos.
            if i < BLOCOS_CALIBRACAO:
                ambiente.append(amplitude)
                bloco_anterior = bloco.copy()
                if i == BLOCOS_CALIBRACAO - 1:
                    media_ambiente = sum(ambiente) / len(ambiente)
                    limiar = max(
                        LIMIAR_FALA_MINIMO,
                        media_ambiente * FATOR_ACIMA_AMBIENTE,
                    )
                continue

            if not falando:
                if amplitude >= limiar:
                    falando = True
                    # Inclui o bloco anterior para não cortar o início da fala.
                    if bloco_anterior is not None:
                        blocos.append(bloco_anterior)
                    blocos.append(bloco.copy())
                else:
                    bloco_anterior = bloco.copy()
                    if i >= blocos_max_inicio:
                        return None
                continue

            blocos.append(bloco.copy())

            if amplitude < limiar:
                blocos_em_silencio += 1
                if blocos_em_silencio >= blocos_silencio_fim:
                    break
            else:
                blocos_em_silencio = 0

    if not blocos:
        return None

    return np.concatenate(blocos)


def ouvir_microfone():
    """Grava a fala do usuário e devolve a transcrição.

    Retorna string vazia quando nada foi dito ou quando a captura/transcrição
    falha — nesses casos o motivo é impresso no console.
    """
    import speech_recognition as sr

    try:
        audio = _gravar()
    except Exception as erro:
        print(f"\nNão foi possível acessar o microfone: {erro}")
        return ""

    if audio is None:
        print("\nNenhuma fala detectada.")
        return ""

    # Whisper local (open source) quando instalado; senão, Google (nuvem).
    if transcricao.whisper_disponivel():
        try:
            texto = transcricao.transcrever_amostras(audio, TAXA_AMOSTRAGEM)
            if texto:
                return texto
            print("\nNão foi possível entender a fala.")
            return ""
        except Exception as erro:
            print(f"\nFalha na transcrição local: {erro}")
            if transcricao.motor_configurado() == "whisper":
                return ""
            print("(tentando o serviço do Google)")

    try:
        return transcricao.transcrever_com_google(audio, TAXA_AMOSTRAGEM)
    except sr.UnknownValueError:
        print("\nNão foi possível entender a fala.")
        return ""
    except sr.RequestError as erro:
        print(f"\nServiço de transcrição indisponível (verifique a internet): {erro}")
        return ""
