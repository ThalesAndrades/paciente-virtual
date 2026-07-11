import sounddevice as sd
from scipy.io.wavfile import write
import speech_recognition as sr

def ouvir_microfone():

    print("\nFale agora...")

    duracao = 5

    audio = sd.rec(
        int(duracao * 44100),
        samplerate=44100,
        channels=1,
        dtype="int16"
    )

    sd.wait()

    write(
        "gravacao.wav",
        44100,
        audio
    )

    recognizer = sr.Recognizer()

    with sr.AudioFile("gravacao.wav") as source:

        dados = recognizer.record(source)

    try:

        texto = recognizer.recognize_google(
            dados,
            language="pt-BR"
        )

        return texto

    except:

        return ""