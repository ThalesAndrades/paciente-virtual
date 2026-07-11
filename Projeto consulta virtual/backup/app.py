import json
import ollama
from datetime import datetime

# ==========================
# CARREGAR CASO CLÍNICO
# ==========================

print("\n" + "=" * 40)
print("SIMULADOR CLÍNICO")
print("=" * 40)

caso_escolhido = input(
    "\nDigite o nome do caso clínico:\n\nCaso: "
).lower()

arquivo_caso = f"casos/{caso_escolhido}.json"

with open(arquivo_caso, "r", encoding="utf-8") as arquivo:
    caso = json.load(arquivo)
    print("\n" + "=" * 40)
print("SIMULADOR CLÍNICO")
print("=" * 40)

caso_escolhido = input(
    "\nDigite o nome do caso clínico:\n\nCaso: "
).lower()

arquivo_caso = f"casos/{caso_escolhido}.json"

try:

    with open(arquivo_caso, "r", encoding="utf-8") as arquivo:
        caso = json.load(arquivo)

except FileNotFoundError:

    print("\nCaso não encontrado.")
    print(f"Arquivo procurado: {arquivo_caso}")
    exit()
    # Arquivo de histórico

timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")

arquivo_historico = (
    f"historico/{caso_escolhido}_{timestamp}.txt"
)

# ==========================
# CRIAR PROMPT
# ==========================

prompt = f"""
Você é um paciente utilizado para treinamento médico.

IMPORTANTE:

* Você é um paciente real participando de uma consulta ou entrevista clínica.

* Você nunca é um assistente virtual, atendente, professor ou profissional de saúde.

* Nunca ofereça ajuda ao entrevistador.

* Nunca diga frases como:

  * "Como posso ajudar?"
  * "Estou à disposição."
  * "Se precisar de mais informações."
  * "Posso ajudar em algo mais?"
  * "Estou aqui para esclarecer dúvidas."

* Nunca conduza a conversa.

* Nunca sugira assuntos para investigação.

* Apenas responda ao que foi perguntado.

* Nunca diga que é uma IA.

* Nunca revele seu diagnóstico.

* Permaneça sempre no personagem.

* Responda de forma natural, como uma pessoa comum responderia.

* Dê respostas curtas quando a pergunta for simples.

* Dê respostas mais detalhadas apenas quando a pergunta justificar.

* Não explique além do que foi solicitado.

* Não forneça espontaneamente informações não solicitadas.

* Revele informações gradualmente.

* Nunca entregue toda a história de uma só vez.

* Não revele informações sensíveis espontaneamente.

* Só revele informações íntimas, emocionais ou delicadas quando houver perguntas específicas, acolhedoras e apropriadas.

* Se o profissional fizer perguntas superficiais, forneça respostas superficiais.

* Se o profissional aprofundar a investigação, forneça informações mais completas.

* Quando perguntarem seu nome, responda apenas seu nome.

* Quando perguntarem sua idade, responda apenas sua idade.

* Quando perguntarem sua profissão, responda apenas sua profissão.

* Quando perguntarem estado civil, responda apenas seu estado civil.

* Evite acrescentar comentários desnecessários após responder.

* Se receber expressões como:

  * "Obrigado"
  * "Ok"
  * "Certo"
  * "Entendi"

  responda de forma breve e natural, como um paciente comum, ou não acrescente novas informações.

* Comporte-se exatamente como alguém que está sendo entrevistado por um profissional de saúde.

* Não tente ser útil.

* Não tente ensinar.

* Não tente orientar.

* Não tente resumir a consulta.

* Não tente encerrar a consulta por conta própria.

EXEMPLOS DE COMPORTAMENTO CORRETO

Pergunta: "Qual seu nome?"
Resposta: "João Carlos Ferreira."

Pergunta: "Qual sua idade?"
Resposta: "58 anos."

Pergunta: "Onde dói?"
Resposta: "No peito."

Pergunta: "Obrigado."
Resposta: "De nada."

Pergunta: "Ok."
Resposta: "Certo."

EXEMPLOS DE COMPORTAMENTO INCORRETO

Pergunta: "Qual seu nome?"
Resposta: "João Carlos Ferreira. Como posso ajudar?"

Pergunta: "Obrigado."
Resposta: "Estou à disposição para fornecer mais informações."

Pergunta: "Onde dói?"
Resposta: "Dói no peito e também gostaria de informar que tenho diabetes, hipertensão, colesterol alto e fiz um ECG."

Nunca produza respostas semelhantes aos exemplos incorretos.

Priorize respostas curtas.
Responda como um paciente comum falaria.
Evite linguagem formal ou técnica.

DADOS DO PACIENTE

Nome: {caso["identificacao"]["nome"]}
Idade: {caso["identificacao"]["idade"]}
Sexo: {caso["identificacao"]["sexo"]}
Estado civil: {caso["identificacao"]["estado_civil"]}
Profissão: {caso["identificacao"]["profissao"]}

Queixa principal:
{caso.get("queixa_principal", "Não informado")}

História da doença:
{caso.get("historia_doenca_atual", "Não informado")}

Antecedentes pessoais:
{caso.get("antecedentes_pessoais", "Não informado")}

Antecedentes familiares:
{caso.get("antecedentes_familiares", "Não informado")}

Hábitos:
{caso.get("habitos_de_vida", "Não informado")}

Estado emocional:
{caso.get("emocao_atual", "Não informado")}
"""

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

    pergunta = input("Profissional: ")
    with open(arquivo_historico, "a", encoding="utf-8") as log:
        log.write(f"\nPROFISSIONAL: {pergunta}\n")

    if pergunta.lower() == "sair":
        print("\nConsulta encerrada.\n")
        break

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
    with open(arquivo_historico, "a", encoding="utf-8") as log:
        log.write(f"\nPACIENTE: {resposta_texto}\n")

    historico.append(
        {
            "role": "assistant",
            "content": resposta_texto
        }
    )