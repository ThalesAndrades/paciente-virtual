import json
import os
import ollama

print("\n" + "=" * 50)
print("AVALIADOR DE CONSULTA")
print("=" * 50)

historicos = os.listdir("historico")

arquivos_txt = []

for arquivo in historicos:

    if arquivo.endswith(".txt"):

        arquivos_txt.append(arquivo)

print("\nHistóricos encontrados:\n")

for i, arquivo in enumerate(arquivos_txt, start=1):

    print(f"{i} - {arquivo}")

escolha = int(
    input("\nEscolha o número do histórico: ")
)

arquivo_escolhido = arquivos_txt[escolha - 1]

nome_sem_extensao = arquivo_escolhido.replace(".txt", "")

if nome_sem_extensao.endswith("_historico"):
    caso = nome_sem_extensao.replace("_historico", "")
else:
    partes = nome_sem_extensao.split("_")
    caso = "_".join(partes[:-2])

arquivo_historico = (
    f"historico/{arquivo_escolhido}"
)

arquivo_avaliacao = (
    f"avaliacoes/{caso}_avaliacao.json"
)

try:

    with open(arquivo_historico, "r", encoding="utf-8") as f:
        texto = f.read().lower()

    with open(arquivo_avaliacao, "r", encoding="utf-8") as f:
        criterios = json.load(f)

except FileNotFoundError:

    print("\nCaso não encontrado.")
    exit()

nota_total = 0

print("\n" + "=" * 50)
print("RESULTADO DA AVALIAÇÃO")
print("=" * 50)

for bloco, dados in criterios.items():

    peso_bloco = dados["peso"]

    itens = dados["itens"]

    valor_item = peso_bloco / len(itens)

    nota_bloco = 0

    print(f"\n{bloco.upper()}")

    for item, palavras in itens.items():

        encontrado = False

        for palavra in palavras:

            if palavra in texto:
                encontrado = True
                break

        if encontrado:

            print(f"✓ {item}")

            nota_bloco += valor_item

        else:

            print(f"✗ {item}")

    nota_total += nota_bloco

    print(
        f"Pontuação: {nota_bloco:.2f}/{peso_bloco:.2f}"
    )

print("\n" + "=" * 50)

print(
    f"NOTA FINAL: {nota_total:.2f}/10.00"
)

print("=" * 50)
# ==========================
# AVALIAÇÃO POR IA
# ==========================

print("\n")
print("=" * 50)
print("AVALIAÇÃO POR IA")
print("=" * 50)

prompt_avaliacao = f"""
Você é um professor experiente da área da saúde.

Sua função é avaliar uma consulta simulada realizada por um estudante.

Primeiro analise os critérios pedagógicos do caso.

CRITÉRIOS DO CASO:

{json.dumps(criterios, ensure_ascii=False, indent=2)}

Agora analise o histórico da consulta.

HISTÓRICO:

{texto}

Com base especificamente nos critérios do caso:

1. Atribua uma nota geral de 0 a 10.
2. Explique como cada critério foi atendido ou não.
3. Liste pontos fortes.
4. Liste pontos a melhorar.
5. Produza um feedback pedagógico detalhado.
6. Seja rigoroso, mas construtivo.

Organize a resposta em seções claras.

"""

resposta_ia = ollama.chat(
    model="qwen3:8b",
    messages=[
        {
            "role": "user",
            "content": prompt_avaliacao
        }
    ]
)

print("\n")
print(resposta_ia["message"]["content"])