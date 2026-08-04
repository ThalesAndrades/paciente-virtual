# Paciente Virtual

Simulador de consulta clínica para treinar **anamnese, entrevista e raciocínio
diagnóstico**. O estudante conversa — por texto ou por voz — com um paciente
interpretado por um modelo de linguagem, solicita exame físico e exames
complementares, assume uma hipótese diagnóstica e recebe ao final uma nota
objetiva por rubrica e um parecer pedagógico.

**40 casos** prontos: 20 de medicina e 20 de psicologia.

## O que torna a estação diferente de um chatbot

**O paciente é uma pessoa, não um formulário.** Cada caso traz uma vida inteira —
biografia, rotina, trabalho, família, estressores, temperamento, bordões, o que
teme e o que espera da consulta. É essa matriz que rege o que ele diz e como diz.
Perguntado "o que você acha que tem?", um porteiro aposentado responde *"Sei não,
doutor... O senhor que me diz, né?"* e uma estudante de enfermagem responde
*"Parece que desligaram uma chave dentro de mim"*.

**A informação é conquistada, não entregue.** Temas sensíveis (ideação, violência,
vergonha) só aparecem diante de pergunta direta e acolhedora sobre aquele tema —
um portão determinístico, não uma sugestão ao modelo. Um cumprimento nunca abre o
assunto delicado, em nenhum dos 40 casos.

**O paciente lembra da conversa.** Ele não repete o que já disse, responde a "me
conta mais" e reage ao exame que você acabou de fazer nele.

**O aluno precisa concluir.** Antes de encerrar, ele assume hipótese, diferenciais
e conduta — e só então vê o diagnóstico do caso. O parecer avalia o raciocínio,
inclusive o caso de acertar a hipótese sem ter investigado o que a sustenta.

## Como rodar

Servidor Node **sem nenhuma dependência externa** — não há `npm install`.

```bash
node app.js
```

Abra <http://127.0.0.1:3000>. Sem chave de modelo de linguagem configurada, o
paciente responde em modo demonstração (respostas extraídas do caso) e a nota
objetiva funciona normalmente.

Para a experiência completa, defina `OPENAI_API_KEY` (e, se quiser, um gateway
compatível em `OPENAI_BASE_URL`). A configuração completa — modelos, voz,
transcrição, controle de acesso e limites de uso — está em
[deploy/hostinger/README.md](deploy/hostinger/README.md).

```bash
npm test    # 28 testes, sem dependências
```

## Estrutura

```
app.js                     Ponto de entrada
web/index.html             Interface (página única, sem build)
deploy/hostinger/
  servidor.js              Servidor HTTP e API
  motor/                   Regras: acesso, prompt do paciente, exames,
                           avaliação, voz, transcrição, limites
  testes/                  Testes (node --test)
casos/                     40 casos clínicos (JSON)
avaliacoes/                40 rubricas de avaliação (JSON)
historico/                 Transcrições gravadas (não versionadas)
```

## Dados dos alunos

As transcrições contêm **nome e conteúdo da consulta de alunos**. O painel que as
exibe é restrito por senha e fica *desligado* se a senha não for configurada —
não existe modo "aberto por padrão". Veja a seção de acesso no README de deploy.
