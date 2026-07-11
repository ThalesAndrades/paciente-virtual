from voz.falar import falar


def verificar_exames(
    texto,
    caso,
    arquivo_historico,
    voz
):
    """
    Procura solicitações de exames complementares
    (ECG, troponina, raio-x etc.) definidos no caso.

    Retorna True se encontrou.
    Retorna False caso contrário.
    """

    if "exames_disponiveis" not in caso:
        return False

    texto_limpo = (
        texto.lower()
        .replace("-", " ")
        .replace("_", " ")
    )

    for chave_exame, dados_exame in caso["exames_disponiveis"].items():
        nome_exame = (
            dados_exame["nome"]
            .lower()
            .replace("-", " ")
            .replace("_", " ")
        )
        chave_limpa = chave_exame.lower().replace("_", " ")
        sinonimos = dados_exame.get("sinonimos", [])

        encontrou = (
            chave_limpa in texto_limpo
            or nome_exame in texto_limpo
            or any(
                sinonimo.lower()
                .replace("-", " ")
                .replace("_", " ")
                in texto_limpo
                for sinonimo in sinonimos
            )
        )

        if encontrou:
            print(
                f"\nEXAME SOLICITADO\n\n"
                f"{dados_exame['nome']}\n\n"
                f"Resultado:"
            )
            print(dados_exame["resultado"])

            falar(dados_exame["resultado"], voz)

            with open(
                arquivo_historico,
                "a",
                encoding="utf-8"
            ) as log:
                log.write(
                    f"\nRESULTADO {dados_exame['nome']}: "
                    f"{dados_exame['resultado']}\n"
                )

            print("")
            return True

    return False
