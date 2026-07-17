"""Loop principal da consulta simulada por voz."""

import json

from .config import DIR_CASOS
from .exames import verificar_exame_fisico, verificar_exames
from .ia import avisar_falha, conversar
from .prompt import criar_prompt
from .registro import (
    PREFIXO_PACIENTE,
    PREFIXO_PROFISSIONAL,
    criar_historico,
    encerrar_historico,
    registrar,
)
from .util import escolher_arquivo
from .voz.falar import falar
from .voz.ouvir import ouvir_microfone


def escolher_caso():
    casos = sorted(DIR_CASOS.glob("*.json"))
    if not casos:
        raise SystemExit(f"Nenhum caso encontrado em {DIR_CASOS}.")
    return escolher_arquivo(casos, "Casos disponíveis:", "Escolha o caso")


def obter_pergunta():
    """Lê a pergunta do profissional: digitada, ou falada se apenas ENTER."""
    entrada = input("\nPressione ENTER para falar ou digite a pergunta: ").strip()
    if entrada:
        return entrada
    return ouvir_microfone()


def _contexto_exames(exames_entregues):
    """Mensagem de sistema que informa o paciente dos exames recém-realizados."""
    itens = "; ".join(
        f"{dados['nome']}: {dados['resultado']}" for dados in exames_entregues
    )
    return (
        f"O profissional acabou de realizar/solicitar: {itens}. "
        "Você, como paciente, sabe que esses procedimentos aconteceram agora "
        "e pode comentá-los se perguntado."
    )


def main():
    print("\n" + "=" * 40)
    print("SIMULADOR CLÍNICO")
    print("=" * 40)

    arquivo_caso = escolher_caso()
    nome_aluno = input("\nNome do aluno: ").strip() or "aluno"

    with open(arquivo_caso, encoding="utf-8") as f:
        caso = json.load(f)

    voz = caso.get("identificacao", {}).get("voz", "feminino")
    arquivo_historico = criar_historico(arquivo_caso.stem, nome_aluno)

    historico = [{"role": "system", "content": criar_prompt(caso)}]

    print("\nPACIENTE VIRTUAL INICIADO\n")
    print(f"Caso: {arquivo_caso.stem}")
    print(f"Histórico: {arquivo_historico}")
    print("\nDiga ou digite 'sair' para encerrar.\n")

    while True:
        pergunta = obter_pergunta()

        if not pergunta.strip():
            print("\nNão entendi. Tente novamente.")
            continue

        print(f"\nProfissional: {pergunta}")

        if pergunta.strip().lower() == "sair":
            encerrar_historico(arquivo_historico)
            print("\nConsulta encerrada.\n")
            break

        registrar(arquivo_historico, f"\n{PREFIXO_PROFISSIONAL} {pergunta}\n")

        exames_entregues = verificar_exames(pergunta, caso, arquivo_historico, voz)
        exames_entregues += verificar_exame_fisico(pergunta, caso, arquivo_historico, voz)

        if exames_entregues:
            # O paciente precisa "saber" que foi examinado para a conversa
            # seguinte não contradizer o transcript.
            historico.append(
                {"role": "system", "content": _contexto_exames(exames_entregues)}
            )
            continue

        historico.append({"role": "user", "content": pergunta})

        try:
            resposta = conversar(historico)
        except Exception as erro:
            avisar_falha(erro)
            historico.pop()
            continue

        print(f"\nPaciente:\n{resposta}\n")

        falar(resposta, voz)

        historico.append({"role": "assistant", "content": resposta})
        registrar(arquivo_historico, f"\n{PREFIXO_PACIENTE} {resposta}\n")


if __name__ == "__main__":
    main()
