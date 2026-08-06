# Estado atual — THM Simulados Inteligentes

Ponto de retomada. Este documento diz **o que está no ar hoje**, **por que cada
decisão foi tomada** e **o que ficou pendente**, para que outra sessão continue
sem reconstruir o contexto do zero.

Complementa os outros dois: [`COMPREENSAO.md`](COMPREENSAO.md) descreve *o que o
projeto é*; [`ROADMAP.md`](ROADMAP.md), *para onde ele vai*. Aqui está *onde ele
parou*.

- **Última atualização:** 6 de agosto de 2026
- **Topo da `main` publicado:** `6bba4cc`
- **Testes:** 77 passando (`npm test`, Node ≥ 22)
- **Produção:** <https://ubtec.sbs>

---

## 1. O que a ferramenta é hoje

Simulador de **estações clínicas no formato do Revalida** (2ª etapa, Edital INEP
nº 14/2026), vendido por créditos. O aluno entra com matrícula, escolhe uma
estação ou um circuito completo, atende um paciente interpretado por modelo de
linguagem (texto ou voz ao vivo) e recebe nota por **PEP** — Padrão Esperado de
Procedimentos, item a item, na escala do edital.

O que veio do edital e está implementado em `motor/revalida.js`:

- 10 minutos por estação, sem prorrogação (item 3.6.1.1)
- 0 a 10 por estação, com pesos que fecham 10 (itens 3.5 e 3.7.4)
- escala **inadequado · parcialmente adequado · adequado**, sem valor
  intermediário (item 3.7.3)
- cinco áreas: Clínica Médica, Cirurgia, Ginecologia-Obstetrícia, Pediatria e
  Medicina da Família (item 3.3.1)
- circuito com giro obrigatório e sem retorno à estação anterior (itens 3.6.2 e
  3.6.3), em `motor/prova.js`

---

## 2. Acervo

**29 estações médicas** com PEP escrito à mão, distribuídas assim:

| Área | Estações |
| --- | --- |
| Clínica Médica | 14 |
| Cirurgia | 5 |
| Pediatria | 4 |
| Ginecologia e Obstetrícia | 3 |
| Medicina da Família | 3 |

Cada estação é um par: o caso em `casos/<id>.json` (quem é o paciente, o que ele
sente, o que revela e quando) e a rubrica em `avaliacoes/<id>.json` (o impresso
da estação e o PEP). Os dois arquivos precisam ter o mesmo nome.

**Regra que o teste crava:** todo caso com `"categoria": "medicina"` PRECISA ter
estação de Revalida na rubrica. Caso médico sem PEP reprova a suíte.

Duas estações de pediatria declaram `interlocutor` no caso — quem responde é a
mãe, porque bebê não dá anamnese. Sem esse campo o modelo interpreta a criança e
a estação perde o sentido; já aconteceu.

---

## 3. Créditos e cobrança

Tabela única em `motor/planos.js` — preço espalhado é preço que diverge.

| Item | Custo |
| --- | --- |
| Estação avulsa | 10 créditos |
| Circuito de 5 estações | 40 créditos (cobrado **uma vez**, na abertura) |
| Conversa ao vivo | 2 créditos por minuto concedido |
| Boas-vindas | 20 créditos (uma experiência completa) |

Pacotes: 60/R$ 24,00 · 200/R$ 70,00 · 600/R$ 180,00.
Assinaturas: Estudante R$ 59,90 (250/mês) · Residente R$ 129,90 (600/mês).

Pagamento por **Pix (Woovi)** e **cartão (Stripe)**, ambos ativos em produção
(`GET /api/loja` devolve `formas: {pix: true, cartao: true}`).

O razão fica em `credito_lancamento`: saldo é a soma dos lançamentos, nunca um
contador. `UNIQUE(motivo, referencia)` dá a idempotência — webhook repetido não
credita duas vezes, e webhooks repetem de propósito.

### Duas armadilhas já resolvidas, que não devem voltar

1. **O circuito era cobrado por estação** (5 × 10 = 50), encarecendo justamente o
   formato que mais ensina. Hoje é pacote de 40, e `iniciarConsulta` pula o
   débito quando a estação vem de um circuito com `pago: true`.
2. **O débito acontece antes de o aluno ver as áreas sorteadas.** Quem lia
   "cirurgia" e desistia saía 40 créditos mais pobre sem ter atendido ninguém.
   `DELETE /api/provas/:id` estorna — e a marca que fecha o direito é a estação
   **aberta** (`entrouEmEstacao`), não a encerrada, senão dava para ler o caso e
   pedir o dinheiro de volta.

### Preço não pode depender do servidor

`reais()` formata à mão. `toLocaleString("pt-BR")` **não falha** num Node com ICU
reduzida — cai no inglês em silêncio, e a loja anunciou `R$180.00` em produção.
Na máquina de desenvolvimento a ICU é completa e o formato sai certo, por isso
passou despercebido. Há teste travando o formato.

---

## 4. Desempenho do aluno

`motor/desempenho.js` grava cada estação encerrada: nota, área, data, se veio de
circuito, e os itens do PEP em que o aluno **não** foi adequado. Só os perdidos —
guardar os acertos dobraria a tabela para responder a pergunta menos útil.

A tela "Meu desempenho" responde três perguntas, nesta ordem: como estou, onde
estou pior, o que sempre esqueço. E sugere a próxima estação a partir da área de
pior média (mínimo duas estações, para um dia ruim não virar veredito),
evitando os cinco casos mais recentes.

**O título da estação nunca viaja com a sugestão** — ele nomeia o diagnóstico.
O aluno escolhe a área; o caso ele descobre na sala, como na prova.

`GET /api/desempenho` responde pela **sessão**, sem id de aluno na URL: assim não
existe o caminho em que alguém troca o número e lê o histórico do colega.

---

## 5. Como o deploy funciona

1. `npm test` verde
2. `git push origin main`
3. `VPS_restartProjectV1` no VPS **1784604**, projeto `paciente-virtual`
4. verificar `/healthz`, `/api/loja` e as rotas tocadas

O contêiner **clona a `main` no start** — não há build nem registry. Por isso o
push é o deploy, e o restart é o que o aplica.

### O que está torto e precisa de terminal no host

O `docker-compose.yml` em `/docker/paciente-virtual/` está **desatualizado**:
declara `node:20-alpine` e variáveis mortas. Quem segura a produção hoje é a
auto-cura no start (`deploy/hostinger/servidor.js` virou bootstrap: instala
dependências, sobe o Node e, se nada funcionar, serve página de manutenção em vez
de tela morta).

**Não rodar `VPS_updateProjectV1` nem `createNewProjectV1` enquanto o arquivo em
disco for o antigo** — recriar a partir dele rebaixa a produção e quebra o login
(o Better Auth precisa do `node:sqlite`, que não existe no Node 20). Reconstruir
o compose a partir do que roda é tarefa para quando houver terminal no host.

---

## 6. Regras de trabalho deste projeto

- **Deploy só sob autorização explícita do dono.** Código pronto e testado fica
  esperando o "sobe".
- **Claude não manuseia credenciais.** Chaves de API e segredos de pagamento são
  instalados pelo dono, pelo painel admin → Cobrança, ou por
  `scripts/configurar-pagamentos.sh`. Chave que apareceu em conversa deve ser
  rotacionada.
- **Erro nunca bloqueia o aluno.** Absorver, auto-curar ou enfileirar para o
  admin — tela morta é o pior resultado possível.
- **O gabarito não sai antes da hora.** O impresso da estação não pode conter o
  diagnóstico, e há teste que reprova quando ele vaza.

---

## 7. Pendências

| O quê | De quem | Nota |
| --- | --- | --- |
| Trocar o `docker-compose.yml` do host | dono (precisa de terminal) | hoje a auto-cura compensa |
| Teste ponta a ponta de pagamento real | dono | gerar Pix de R$ 24,00 e conferir se o crédito cai; é o único trecho que teste local não cobre |
| Esclarecer o pedido "1000 créditos pro admin e 10001000" | dono | a funcionalidade de lançar crédito por conta existe no painel; falta saber quem é "10001000" |
| PEP escrito à mão para as 14 estações de Clínica Médica | próxima sessão | as demais áreas já têm; CM ainda usa PEP gerado |
| Persistir consultas em banco (hoje em memória) | próxima sessão | Fase 0 do ROADMAP, ainda aberta |
| Mais estações em GO, Pediatria e MFC | próxima sessão | 3–4 por área ainda repete cedo no circuito |

---

## 8. Mapa rápido de arquivos

| Arquivo | O que guarda |
| --- | --- |
| `deploy/hostinger/servidor.js` | bootstrap (auto-cura de ambiente, página de manutenção) |
| `deploy/hostinger/aplicacao.js` | servidor HTTP e todas as rotas |
| `motor/revalida.js` | PEP, escala do edital, prompt do avaliador |
| `motor/prova.js` | circuito de estações, giro, boletim |
| `motor/desempenho.js` | histórico do aluno e sugestão de treino |
| `motor/planos.js` | tabela de preços — fonte única |
| `motor/creditos.js` | razão de créditos, pagamentos, assinaturas |
| `motor/pagamentos.js` | Woovi e Stripe |
| `motor/configuracao.js` | segredos lidos do banco antes do ambiente |
| `web/index.html` | página inteira (telas, JS embutido) |
| `web/tempo-real.js` | WebRTC e portão de ruído do microfone |
| `web/presenca.js` | presença do paciente em canvas 2D |
