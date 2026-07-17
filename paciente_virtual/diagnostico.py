"""Testes manuais de áudio.

Uso:
    python -m paciente_virtual.diagnostico fala
    python -m paciente_virtual.diagnostico microfone
"""

import sys

from .voz.falar import falar
from .voz.ouvir import ouvir_microfone


def testar_fala():
    print("Voz feminina (Francisca)...")
    falar(
        "Ana Paula Martins. A cabeça dói há cerca de 8 meses, "
        "e a frequência é quase diária.",
        "feminino",
    )

    print("Voz masculina (Antonio)...")
    falar(
        "João Carlos Ferreira. A dor no peito começou há duas horas "
        "e irradia para o braço esquerdo.",
        "masculino",
    )


def testar_microfone():
    print("Teste de microfone")
    print("Fale após a mensagem")

    texto = ouvir_microfone()

    print("\nVocê disse:")
    print(texto)


def main():
    comando = sys.argv[1] if len(sys.argv) > 1 else ""

    if comando == "fala":
        testar_fala()
    elif comando == "microfone":
        testar_microfone()
    else:
        print("Uso: python -m paciente_virtual.diagnostico [fala|microfone]")
        raise SystemExit(1)


if __name__ == "__main__":
    main()
