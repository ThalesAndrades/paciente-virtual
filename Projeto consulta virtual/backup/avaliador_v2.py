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

    caso = nome_sem_extensao.replace(
        "_historico",
        ""
    )

else:

    partes = nome_sem_extensao.split("_")

    caso = "_".join(partes[:-2])

arquivo_historico = (
    f"historico/{arquivo_escolhido}"
)

arquivo_avaliacao = (
    f"avaliacoes/{caso}_avaliacao_v2.json"
)
print("\nDEBUG")
print("Caso identificado:", caso)
print("Arquivo de avaliação:", arquivo_avaliacao)
print("")

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

for criterio in criterios["criterios"]:

    nome = criterio["nome"]
    peso = criterio["peso"]
    objetivo = criterio["objetivo"]
    itens = criterio["itens"]

    valor_item = peso / len(itens)

    nota_bloco = 0

    print(f"\n{nome.upper()}")
    print(f"Objetivo: {objetivo}")

    for item in itens:

        if item.lower() in texto:

            print(f"✓ {item}")
            nota_bloco += valor_item

        else:

            print(f"✗ {item}")

    nota_total += nota_bloco

    print(
        f"Pontuação: {nota_bloco:.2f}/{peso:.2f}"
    )

print("\n" + "=" * 50)

print(
    f"NOTA FINAL: {nota_total:.2f}/10.00"
)

print("=" * 50)
import ollama

print("\n")
print("=" * 50)
print("AVALIAÇÃO SEMÂNTICA POR IA")
print("=" * 50)

prompt_avaliacao = f"""
Você é um professor experiente da área da saúde.

Analise o histórico da consulta e os critérios da rubrica.

RÚBRICA:

{json.dumps(criterios, ensure_ascii=False, indent=2)}

HISTÓRICO DA CONSULTA:

{texto}

Para cada critério da rubrica:

* Informe se foi ATENDIDO, PARCIALMENTE ATENDIDO ou NÃO ATENDIDO.
* Justifique utilizando exemplos do histórico.
* Considere o significado das perguntas realizadas e não apenas palavras exatas.

Após analisar todos os critérios:

1. Atribua uma nota geral de 0 a 10.
2. Liste pontos fortes.
3. Liste pontos a desenvolver.
4. Produza recomendações para futuras entrevistas.
5. Produza um feedback pedagógico detalhado.

Organize a resposta em:

CRITÉRIO
STATUS
JUSTIFICATIVA

NOTA FINAL

PONTOS FORTES

PONTOS A DESENVOLVER

RECOMENDAÇÕES

FEEDBACK PEDAGÓGICO
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
