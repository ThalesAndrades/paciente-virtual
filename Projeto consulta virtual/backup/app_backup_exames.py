import json
import os
import ollama
from datetime import datetime
from paciente.prompt import criar_prompt
from voz.ouvir import ouvir_microfone
from voz.falar import falar

# ==========================
# CARREGAR CASO CLÍNICO
# ==========================

print("\n" + "=" * 40)
print("SIMULADOR CLÍNICO")
print("=" * 40)

casos_disponiveis = []

for arquivo in os.listdir("casos"):

    if arquivo.endswith(".json"):

        casos_disponiveis.append(arquivo)

print("\nCasos disponíveis:\n")

for i, arquivo in enumerate(
    casos_disponiveis,
    start=1
):

    print(f"{i} - {arquivo}")

while True:

    try:

        escolha = int(
            input("\nEscolha o caso: ")
        )

        if 1 <= escolha <= len(casos_disponiveis):
            break

        print("\nEscolha um número válido.")

    except ValueError:

        print("\nDigite apenas o número do caso.")

arquivo_escolhido = (
    casos_disponiveis[escolha - 1]
)

caso_escolhido = (
    arquivo_escolhido.replace(
        ".json",
        ""
    )
)

arquivo_caso = (
    f"casos/{arquivo_escolhido}"
)

nome_aluno = input(
    "\nNome do aluno: "
)

try:
    with open(arquivo_caso, "r", encoding="utf-8") as arquivo:
        caso = json.load(arquivo)
except FileNotFoundError:
    print("\nCaso não encontrado.")
    print(f"Arquivo procurado: {arquivo_caso}")
    exit()

timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")

arquivo_historico = (
    f"historico/{caso_escolhido}_{nome_aluno}_{timestamp}.txt"
)

voz = caso.get("voz") or caso.get("identificacao", {}).get("voz", "feminino")

# ==========================
# CRIAR PROMPT
# ==========================

prompt = criar_prompt(caso)

# ==========================
# HISTÓRICO DA CONVERSA
# ==========================

historico = [
    {
        "role": "system",
        "content": prompt
    }
]

print("\nPACIENTE VIRTUAL INICIADO\n")
print(f"Caso: {caso_escolhido}")
print(f"Histórico: {arquivo_historico}")
print("\nDigite 'sair' para encerrar.\n")

# ==========================
# LOOP PRINCIPAL
# ==========================

with open(arquivo_historico, "a", encoding="utf-8") as log:
    log.write("\n")
    log.write("=" * 50 + "\n")
    log.write(f"Consulta iniciada em {datetime.now()}\n")
    log.write("=" * 50 + "\n")

while True:
    input("\nPressione ENTER e fale...")

    pergunta = ouvir_microfone()

    print(f"\nProfissional: {pergunta}")

    with open(arquivo_historico, "a", encoding="utf-8") as log:
        log.write(f"\nPROFISSIONAL: {pergunta}\n")

    if pergunta.lower() == "sair":
        print("\nConsulta encerrada.\n")
        break

    if not pergunta.strip():
        continue

    texto = pergunta.lower()

    # ==========================
    # EXAMES
    # ==========================

    if "ecg" in texto:
        print("\nRESULTADO DO ECG\n")
        print(caso["exames"]["ecg"])
        with open(arquivo_historico, "a", encoding="utf-8") as log:
            log.write(f"RESULTADO ECG: {caso['exames']['ecg']}\n")
        print("")
        continue

    if "troponina" in texto:
        print("\nRESULTADO DA TROPONINA\n")
        print(caso["exames"]["troponina"])
        with open(arquivo_historico, "a", encoding="utf-8") as log:
            log.write(f"RESULTADO TROPONINA: {caso['exames']['troponina']}\n")
        print("")
        continue

    if "raio x" in texto or "raiox" in texto or "rx" in texto:
        print("\nRESULTADO DO RAIO-X\n")
        print(caso["exames"]["raio_x"])
        with open(arquivo_historico, "a", encoding="utf-8") as log:
            log.write(f"RESULTADO RAIO-X: {caso['exames']['raio_x']}\n")
        print("")
        continue

    # ==========================
    # CONVERSA
    # ==========================

    historico.append(
        {
            "role": "user",
            "content": pergunta
        }
    )

    resposta = ollama.chat(
        model="qwen3:8b",
        messages=historico
    )

    resposta_texto = resposta["message"]["content"]

    print("\nPaciente:")
    print(resposta_texto)
    print("")

    falar(resposta_texto, voz)

    historico.append(
        {
            "role": "assistant",
            "content": resposta_texto
        }
    )

    with open(arquivo_historico, "a", encoding="utf-8") as log:
        log.write(f"\nPACIENTE: {resposta_texto}\n")
