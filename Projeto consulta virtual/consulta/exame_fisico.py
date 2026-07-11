from voz.falar import falar


def verificar_exame_fisico(
    texto,
    caso,
    arquivo_historico,
    voz
):
    """
    Procura solicitações de exame físico
    (pressão, FC, FR, temperatura, saturação etc.)

    Retorna True se encontrou.
    Retorna False caso contrário.
    """

    if "exame_fisico" not in caso:
        return False

    texto_limpo = (
        texto.lower()
        .replace("-", " ")
        .replace("_", " ")
    )

    for chave_exame, dados_exame in caso["exame_fisico"].items():

        palavras = [
            chave_exame.lower().replace("_", " ")
        ]

        if "nome" in dados_exame:
            palavras.append(
                dados_exame["nome"]
                .lower()
                .replace("-", " ")
                .replace("_", " ")
            )

        if "sinonimos" in dados_exame:
            palavras.extend(
                [
                    s.lower()
                    .replace("-", " ")
                    .replace("_", " ")
                    for s in dados_exame["sinonimos"]
                ]
            )

        encontrou = any(
            palavra in texto_limpo
            for palavra in palavras
        )

        if encontrou:

            print(
                f"\nEXAME FÍSICO\n\n"
                f"{dados_exame['nome']}\n"
            )

            print("Resultado:\n")
            print(dados_exame["resultado"])
            print()

            falar(
                dados_exame["resultado"],
                voz
            )

            with open(
                arquivo_historico,
                "a",
                encoding="utf-8"
            ) as log:

                log.write(
                    f"\nEXAME FÍSICO: {dados_exame['nome']}\n"
                )

                log.write(
                    f"RESULTADO: {dados_exame['resultado']}\n"
                )

            return True

    return False