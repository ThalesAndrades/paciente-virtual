# Estação de habilidades clínicas no formato Revalida

**Data:** 2026-08-06 · **Status:** ✅ motor e acervo médico convertidos

## O que a prova é

Edital INEP nº 14, de 12/03/2026 — 2ª etapa do Revalida 2025/2. A prova de
habilidades clínicas não é uma consulta livre; é um circuito de **10 estações**,
5 por dia, com **cerca de 10 minutos** cada (itens 3.3, 3.4, 3.6).

| Regra | Item do edital |
| --- | --- |
| Cada estação vale de 0 a 10 pontos; 100 no conjunto | 3.5 |
| Áreas: Clínica Médica, Cirurgia, GO, Pediatria, MFC + Saúde Coletiva e Mental | 3.3.1 |
| Avaliação por item do PEP na escala **inadequado · parcialmente adequado · adequado**, "que não admite pontuação intermediária" | 3.7.3 |
| Pesos definidos previamente; a soma fecha 10 por estação | 3.7.4, 3.7.4.2 |
| A tarefa pode limitar exames, hipóteses, condutas e exigir sequência | 3.8 |
| O tempo não é prorrogável | 3.6.1.1 |
| Avaliação feita depois, por Médico Avaliador, sobre a filmagem | 3.7.2 |

## O que mudou aqui

**Antes:** consulta sem tempo definido, nota por palavra-chave encontrada na
transcrição. Dizer "irradiação" pontuava, mesmo sem investigar nada.

**Agora:** o caso médico é uma estação.

1. **Impresso antes de entrar.** Área, cenário, tarefa e limites. O cronômetro só
   começa no "Entrar na estação" — ler a tarefa faz parte da prova, e na sala real
   ela é lida na porta, com o tempo parado.
2. **Cronômetro regressivo de 10 minutos**, que muda de cor aos 2 minutos e aos 30
   segundos, e encerra a estação no zero abrindo o fechamento. Sem prorrogação.
3. **Avaliação por PEP.** Um Médico Avaliador (o modelo, com o PEP na mão e a
   transcrição) classifica CADA item na escala do edital e devolve JSON. A nota é
   a soma ponderada — nunca uma nota livre.
4. **O cenário nunca entrega o diagnóstico.** Um teste crava isso para as 20
   estações: a primeira versão do gerador colocava o título do caso no impresso, e
   bastaria abrir a aba de rede para gabaritar antes de perguntar qualquer coisa.
5. **Piso determinístico.** Se o avaliador estiver fora do ar, a estação não fica
   sem nota: cai no checklist objetivo, avisando que é estimativa.

## O acervo

As 20 rubricas de medicina ganharam bloco `revalida` derivado dos critérios que já
existiam — o trabalho clínico não se perdeu, mudou de forma. Distribuição atual:

- **Clínica Médica** — 14 estações
- **Cirurgia** — 5 (apendicite, colecistite, pancreatite, cólica renal, HDA)
- **Medicina da Família** — 1 (lombalgia)

`scripts/gerar-estacoes.mjs` faz a conversão e preserva estação escrita à mão.

## O que falta

- **Ginecologia-Obstetrícia e Pediatria não existem no acervo.** São duas das cinco
  áreas do edital: sem elas, simula-se 60% da prova. É a próxima prioridade, e as
  vinhetas do caderno da 1ª etapa 2026/1 servem de ancoragem clínica.
- **Modo prova**: 5 estações em sequência com giro automático e nota /50.
- **PEP escrito à mão** para os casos de maior peso — o derivado dos critérios é
  bom, mas o do INEP é mais específico ("ausculta os focos", "calcula o escore").

## Modo prova (2026-08-06)

Treinar uma estação por vez ensina a estação. O dia da prova é outra coisa: cinco
seguidas, com **giro obrigatório** entre elas (item 3.6.2), sem voltar atrás, e a
nota que importa é a soma — 0 a 50 no dia, 0 a 100 no exame (itens 3.4 e 3.5).

- **O sorteio cobre ÁREAS, não casos.** Uma estação por área do edital, na ordem
  do item 3.3.1. Sortear cinco de Clínica Médica seria simular o conforto.
- **As áreas aparecem antes de começar; os casos, não.** Saber que a terceira é de
  pediatria é o que o participante sabe na prova; saber qual caso seria gabarito.
- **Sem volta.** Encerrada a estação, o resultado vira a porta da próxima e o botão
  de "nova consulta" sai de cena.
- **Boletim** com a soma, a média por estação — que é o número comparável com a
  nota de corte publicada por edição — e a nota de cada estação com sua área.
- Cada estação debita crédito como uma consulta; o total é avisado antes de começar.

`motor/prova.js` guarda o circuito em memória, como as consultas: o que precisa
sobreviver a um restart é o transcript de cada estação, que já vai para o disco.
