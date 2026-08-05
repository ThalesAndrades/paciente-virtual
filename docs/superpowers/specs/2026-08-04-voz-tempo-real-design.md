# Conversa por voz em tempo real com o paciente

**Data:** 2026-08-04 · **Status:** design aprovado, implementação não iniciada

## O problema

Hoje a conversa por voz é *push-to-talk* em três saltos: o aluno segura o microfone,
`MediaRecorder` grava o arquivo inteiro, e só ao soltar o áudio sai do navegador —
`/api/transcrever` → `/mensagem?stream=1` → `/api/falar` por frase. O modelo de
linguagem e a síntese já são streaming; **quem não é streaming é o microfone**. O
resultado é uma espera de alguns segundos por turno e, sobretudo, a impossibilidade
de interromper o paciente no meio da fala — que é justamente o que uma entrevista
clínica real exige.

O alvo é conversa telefônica de verdade: full-duplex, resposta abaixo de um segundo,
com *barge-in*.

## A restrição que governa o design

O valor do simulador é a **integridade clínica**, não a fluidez. Duas garantias não
podem cair:

1. O modelo **nunca vê o diagnóstico**.
2. Informação sensível (ideação suicida, violência, uso de álcool) só é revelada
   quando a pergunta toca o tema diretamente — decisão do **servidor**, não do modelo.

Um modelo voz→voz gera áudio direto a partir das próprias instruções. Se o caso
inteiro for para as instruções, o portão deixa de ser garantia e vira pedido.

## Decisões tomadas

| Decisão | Escolha | Por quê |
|---|---|---|
| Alvo | Full-duplex com barge-in (Realtime API) | conversa real, não turnos mais rápidos |
| Portão clínico | Servidor entrega sob demanda via *tool* | mantém a garantia determinística |
| Freio de custo | Teto por consulta **e** teto do dia | evita fatura surpresa |
| Caminho do áudio | WebRTC direto browser ↔ OpenAI | latência mínima e VPS fora do caminho |
| Modelo | `gpt-realtime-2.1-mini` como padrão | comparar com o cheio em 2 casos antes de fixar |

### Por que WebRTC direto, e não relay pelo servidor

Um relay pelo VPS daria integridade total da transcrição, mas põe o áudio de cada
aluno simultâneo em cima do host 223 — 2 núcleos, ~3,5 Gi livres, já rodando Mailu,
Evolution, hi.events e affine. Foi esse mesmo host que sufocou quando o Ollama foi
para lá. WebRTC direto tira o áudio do caminho do servidor e ainda corta um salto
Brasil→EUA de latência.

**O preço dessa escolha:** as *tool calls* chegam no navegador, que as repassa, e a
transcrição que alimenta a rubrica passa a ser declarada pelo cliente. O segredo
clínico continua protegido (quem libera é o servidor), mas a **nota vira
auto-declarável** por quem saiba usar o DevTools.

**Mitigação:** a rubrica passa a ancorar nas *tool calls* que o servidor realmente
atendeu — prova carimbada no servidor de que o aluno tocou cada tema sensível. Os
itens de risco, que têm peso alto, ganham evidência *mais* forte que a de hoje. Só
os itens de acolhimento dependem da transcrição do cliente, e ela entra no
transcript marcada como tal.

## Arquitetura

O miolo clínico já existe e é reusado inteiro:

- `humanizar.js#sistemaPaciente(caso)` monta o personagem **sem nada sensível** — há
  teste cravando isso. É o `instructions` da sessão, sem prompt novo.
- `demo.js#fatoSensivelDireto(caso, pergunta)` é o portão. Vira o corpo da *tool*,
  sem lógica nova.

### Módulos novos

| Arquivo | Responsabilidade | Depende de |
|---|---|---|
| `motor/tempo-real.js` | cunha o token efêmero: instruções, *tools*, TTL curto, duração máxima | `humanizar.js` |
| `motor/ficha.js` | o portão como *tool*: recebe a pergunta, aplica o gate, devolve o fato ou nega | `demo.js`, `exames.js` |
| `motor/orcamento.js` | teto por consulta e do dia em minutos **concedidos**, janela deslizante | — |

### Rotas novas

- `POST /api/consultas/:id/tempo-real` — verifica orçamento, cunha o token, debita.
- `POST /api/consultas/:id/ficha` — o portão; carimba a consulta no transcript.
- `POST /api/consultas/:id/turno` — transcrição em lote vinda do navegador.

### Frontend

A camada de voz sai de `web/index.html` (1.662 linhas) para `web/tempo-real.js`. Só
a voz — o resto da página não é redesenhado.

## Fluxo de uma pergunta delicada

```
aluno fala "a senhora chegou a pensar em morrer?"
  → áudio vai direto browser → OpenAI (não passa pelo VPS)
  → o modelo NÃO sabe a resposta; é obrigado a chamar consultar_ficha({pergunta})
  → o navegador repassa: POST /api/consultas/:id/ficha
  → o SERVIDOR roda fatoSensivelDireto → libera ou nega
  → volta como function_call_output → o paciente fala
```

O diagnóstico nunca entra na sessão. A ideação só sai se o gatilho casar.

## Compatibilidade

`consulta.transcript` mantém o formato atual, então `avaliador.js`, o relatório e o
painel do professor funcionam **sem alteração**. O modo atual (segurar o microfone)
**permanece** — é o fallback e o caminho barato.

## Erros

| Situação | Comportamento |
|---|---|
| Orçamento estourado, WebRTC bloqueado, token recusado | cai no modo atual com aviso claro; nunca tela morta |
| *Tool call* falha | o paciente desconversa; **nunca** inventa o fato sensível |
| Queda de rede | a consulta sobrevive; o transcript acumulado vale |

## Testes

- As instruções da sessão nunca contêm diagnóstico nem `informacoes_sensiveis`
  (reusa o teste existente, apontado para o novo montador).
- A *tool* nega tema não tocado, nos 40 casos.
- O orçamento zera e derruba para o fallback.

## Custo

`gpt-realtime-2.1-mini`: US$ 10/1M de áudio de entrada, US$ 20/1M de saída. O modelo
cheio: US$ 32 / US$ 64. Áudio conta 600 tokens por minuto do aluno e 1.200 por
minuto do paciente.

| Modelo | Consulta de 10 min |
|---|---|
| `gpt-realtime-2.1-mini` | ~US$ 0,20–0,50 |
| `gpt-realtime-2.1` | ~US$ 0,60–1,10 |

O teto diário conta **minutos concedidos**, não consumidos — o servidor não vê o
áudio, então erra deliberadamente para menos.

## Dependência pendente

O freio de custo aqui é por IP, que é fraco. Quando o **login por matrícula**
existir, o teto passa a ser **por aluno** e esta seção deve ser revista. Por isso o
login foi priorizado antes desta implementação.

## Fontes

- <https://developers.openai.com/api/docs/pricing>
- <https://developers.openai.com/api/docs/guides/realtime-webrtc>
