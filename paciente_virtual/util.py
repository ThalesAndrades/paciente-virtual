"""Utilitários de interface de linha de comando."""


def escolher_arquivo(arquivos, titulo, pergunta):
    """Menu numerado de arquivos; valida a entrada e retorna o escolhido."""
    print(f"\n{titulo}\n")
    for i, arquivo in enumerate(arquivos, start=1):
        print(f"{i} - {arquivo.stem}")

    while True:
        try:
            escolha = int(input(f"\n{pergunta}: "))
        except ValueError:
            print("\nDigite apenas o número.")
            continue

        if 1 <= escolha <= len(arquivos):
            return arquivos[escolha - 1]

        print("\nEscolha um número válido.")
