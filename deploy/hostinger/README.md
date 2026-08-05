# Deploy na Hostinger (Node.js)

Este diretório contém um servidor **Node.js sem dependências externas** que roda o
protótipo interativo do Paciente Virtual em hospedagens que suportam Node — como a
hospedagem web da Hostinger (hPanel) ou um VPS. Ele reutiliza os mesmos casos
(`casos/`), rubricas (`avaliacoes/`) e a página web (`web/index.html`)
do repositório: nada é duplicado além do motor, portado para JavaScript.

## O que funciona em cada cenário

| Cenário | Paciente | Avaliação | Voz |
| ------- | -------- | --------- | --- |
| Sem modelo (nenhuma chave/Ollama) | Modo demonstração (respostas do caso) | Nota objetiva completa; sem parecer de IA | Web Speech API do navegador (Chrome/Edge) |
| **OpenAI** (`OPENAI_API_KEY`) — máxima performance | IA completa (nuvem) | Nota objetiva + parecer pedagógico | Web Speech API do navegador |
| VPS com [Ollama](https://ollama.com) (`OLLAMA_URL`) | IA completa (local) | Nota objetiva + parecer pedagógico | Web Speech API do navegador |

Quando `OPENAI_API_KEY` está definida, o servidor usa a API da OpenAI; caso
contrário, cai no Ollama; sem nenhum dos dois, roda em modo demonstração.

Para voz neural local (Whisper/Piper/Kokoro) é preciso do servidor Python
(`paciente-virtual-web`) — recomendado em VPS. O servidor Node é a opção leve.

## Passo a passo (hospedagem Node.js da Hostinger)

1. No hPanel, crie um **site Node.js** (Sites → Adicionar site → Node.js) ou, em um
   site existente, abra **Avançado → Node.js**.
2. Publique este repositório no site — via **Git** (Avançado → GIT, apontando para
   `https://github.com/ThalesAndrades/paciente-virtual` e branch `main`) ou enviando
   os arquivos pelo Gerenciador de Arquivos.
3. Configure a aplicação:
   - **Versão do Node**: 18 ou superior (o repositório fixa `20` em `.nvmrc`).
   - **Arquivo de inicialização**: `app.js` (na raiz do repositório — é o valor
     que a Hostinger já pré-preenche). Alternativas equivalentes: `npm start`
     ou apontar direto para `deploy/hostinger/servidor.js`.
   - **Porta**: a Hostinger injeta a variável `PORT` automaticamente — o servidor
     a usa, seja um número ou um socket Unix (Phusion Passenger).
4. (IA por nuvem — recomendado) defina `OPENAI_API_KEY` no painel de variáveis de
   ambiente da hospedagem (no Coolify: aba **Environment Variables**). Opcional:
   `OPENAI_MODEL` (padrão `gpt-4o`). Alternativa local: exporte
   `OLLAMA_URL=http://127.0.0.1:11434` e rode `ollama pull qwen3:8b`.
5. Reinicie a aplicação. Pronto: a página do simulador estará no seu domínio.

Não há `npm install`: o servidor usa apenas módulos nativos do Node.

### Upload por ZIP (sem Git)

Se preferir enviar um arquivo pelo Gerenciador de Arquivos em vez de conectar o
Git, gere o pacote pronto:

```bash
bash deploy/hostinger/empacotar.sh
# gera dist/paciente-virtual-hostinger.zip
```

O ZIP contém apenas o necessário para rodar (motor Node, casos, rubricas e a
página) com `app.js` na raiz do arquivo. No hPanel:

1. **Gerenciador de Arquivos** → entre na pasta da aplicação Node (a
   *Application root*) → **Upload** do `paciente-virtual-hostinger.zip`.
2. Selecione o ZIP → **Extrair** ali mesmo. Os arquivos ficam na raiz da pasta
   (o `app.js` fica no topo, sem pasta-invólucro).
3. Em **Node.js**, confirme o **arquivo de inicialização** `app.js` e
   **reinicie** a aplicação.

Nada de `npm install` — o pacote não tem dependências.

### Verificar o deploy

Depois de iniciar, confira a rota de saúde no seu domínio:

```bash
curl https://SEU-DOMINIO/healthz
# {"status":"ok","modo":"demonstracao"}   (ou "ia" com OLLAMA_URL definido)
```

`modo` indica se há `OLLAMA_URL` configurado. Use `/healthz` (ou `/api/health`)
como URL de monitoramento de uptime.

## Rodando localmente

```bash
npm start          # http://127.0.0.1:3000
npm test           # testes do motor portado e do servidor (node --test)
```

## Variáveis de ambiente

| Variável | Padrão | Descrição |
| -------- | ------ | --------- |
| `PORT` | `3000` | Porta (a Hostinger define automaticamente) |
| `HOST` | `0.0.0.0` | Endereço de escuta |
| `OPENAI_API_KEY` | — | Chave da API compatível (OpenAI ou OpenRouter). **Definida** → ativa a IA por nuvem. Nunca versione a chave. |
| `OPENAI_MODEL` | lista OSS (ver abaixo) | Modelo(s) da fala do paciente. Aceita **lista** (vírgula/espaço) = cadeia de fallback: tenta o 1º, cai para o próximo em erro/rate-limit. |
| `OPENAI_MODEL_AVALIACAO` | lista OSS c/ reasoning | Modelo(s) do parecer pedagógico. Sem ela, herda `OPENAI_MODEL` (ou o default de avaliação). |
| `OPENAI_BASE_URL` | `https://api.openai.com/v1` | Endpoint compatível. Para OpenRouter: `https://openrouter.ai/api/v1`. |
| `OLLAMA_URL` | `http://127.0.0.1:11434` | Endpoint do Ollama (usado se não houver `OPENAI_API_KEY`). |
| `PACIENTE_VIRTUAL_MODELO` | `qwen3:8b` | Modelo usado no Ollama. |
| `LLM_TIMEOUT_MS` | `120000` | Tempo-limite das chamadas ao modelo. |
| `PV_BANCO` | `historico/pv.sqlite` | Banco de contas (SQLite). Fica no volume do histórico para sobreviver ao redeploy. |
| `PV_SEGREDO` | sorteado a cada start | Segredo que assina o cookie de sessão. Sem ele, as sessões caem quando o servidor reinicia. |
| `PV_ADMIN_MATRICULA` / `PV_ADMIN_SENHA` / `PV_ADMIN_NOME` | — | Semeia o **primeiro** administrador. Sem ninguém cadastrado, é uma casa sem porta. |
| `PV_URL` | — | URL pública (base do Better Auth). Sem ela, a origem é deduzida da requisição. |

### Acesso

Cada pessoa entra com **matrícula e senha** (Better Auth). Não há auto-cadastro: quem
cria e reseta conta é o administrador — e por isso também não há verificação de e-mail
nem "esqueci a senha".

Três papéis:

- **aluno** — faz consulta e usa a voz.
- **professor** — além disso, abre o painel com as transcrições.
- **admin** — além disso, cria, reseta e desativa contas.

O painel guarda **dados pessoais de alunos**, então a proteção é por PAPEL, não por
alguém lembrar de configurar uma senha: é impossível "esquecer de ligar".

### Voz (fala do paciente e envio de áudio)

Com `OPENAI_API_KEY` definida, voz e transcrição ligam sozinhas — não há mais nada a
configurar. Sem ela, a página cai na voz do navegador (pt-BR sofrível) e o microfone
volta a depender do `webkitSpeechRecognition`, que só existe em Chrome/Edge.

| Variável | Padrão | Descrição |
| -------- | ------ | --------- |
| `OPENAI_TTS_MODEL` | `gpt-4o-mini-tts,tts-1` | Modelo(s) da síntese. Cadeia de fallback, como nos modelos de texto. |
| `OPENAI_VOZ_F` / `OPENAI_VOZ_M` | `nova` / `onyx` | Voz feminina e masculina (o caso escolhe por `identificacao.voz`). |
| `OPENAI_STT_MODEL` | `gpt-4o-mini-transcribe,whisper-1` | Modelo(s) da transcrição do áudio do aluno. |
| `PV_TTS_PROVEDOR` | — | Força `elevenlabs`, `kokoro`, `openai` ou `nenhum`. Sem isto, vale a ordem abaixo. |
| `OPENAI_AUDIO_API_KEY` | herda `OPENAI_API_KEY` | Credencial só do áudio — permite chat num gateway e voz na OpenAI. |
| `OPENAI_AUDIO_BASE_URL` | herda `OPENAI_BASE_URL` | Endpoint só do áudio. |
| `PV_AUDIO_FORCAR` | — | `1` assume que o endpoint serve `/audio/*` mesmo não sendo a OpenAI. |

**Ter chave não é ter áudio.** Gateways como o OpenRouter servem `/chat/completions` e
não têm `/audio/speech` nem `/audio/transcriptions`. Por isso a voz e o microfone de
servidor só são anunciados quando o endpoint de áudio é de fato o da OpenAI (ou com
`PV_AUDIO_FORCAR=1`); caso contrário a página cai na voz e no reconhecimento do
navegador em vez de oferecer um botão que sempre falha.

Combinações típicas:

| Configuração | Fala do paciente | Microfone |
| --- | --- | --- |
| OpenAI direto | voz da OpenAI | servidor (todo navegador) |
| OpenRouter (chat gratuito) | voz do navegador | Web Speech (só Chrome/Edge) |
| OpenRouter + `KOKORO_URL` | Kokoro self-hosted | Web Speech |
| OpenRouter + `OPENAI_AUDIO_*` | voz da OpenAI | servidor |

Ordem de escolha do provedor: **ElevenLabs** (se `ELEVEN_API_KEY` + voz) → **Kokoro**
(se `KOKORO_URL`) → **OpenAI** (se `OPENAI_API_KEY`) → nenhum. Quem foi configurado de
propósito vence; a OpenAI é o padrão que aparece de graça ao ligar a IA.

Com `gpt-4o-mini-tts` a locução é **dirigida pelo caso**: o servidor monta uma
instrução de atuação a partir de `estilo_de_fala.registro` e `estado_emocional.agora`,
então a mesma frase é lida de um jeito por uma paciente em crise de pânico e de outro
por uma senhora enlutada. Modelos que não aceitam `instructions` (como o `tts-1`)
ignoram isso sem quebrar.

### Presença do paciente

Ao lado da conversa há um campo que respira na frequência do caso, se acende quando
o paciente fala, se retrai conforme a dinâmica de revelação e diz em uma palavra o
que está acontecendo (esperando · ouvindo · pensando · falando). A cor é leitura
clínica: dor puxa para o âmbar, sofrimento para o azul frio e apagado.

Isto substituiu uma primeira tentativa de sala em 3D com boneco humano. O boneco caía
no vale da estranheza — num caso de ideação suicida ou violência, um rosto quase-certo
produz desconforto, não presença — e a biblioteca 3D cobrava 750 kB da franquia de
dados do aluno. Aqui é um canvas 2D e nenhuma dependência.

Não há nada para configurar:

- `prefers-reduced-motion` abre a presença parada.
- Navegador sem canvas: o botão avisa e a consulta segue como antes.
- A expressão é calculada no servidor (`motor/expressao.js`) a partir do
  `estado_emocional` do caso. A página recebe seis números e duas palavras — nenhum
  texto do caso viaja para o navegador por causa da animação.

## Créditos, planos e cobrança

O acesso é por **créditos**. Uma consulta completa custa 10; a conversa por voz ao
vivo custa 2 por minuto concedido. Quem cria conta ganha 20 créditos — uma
experiência completa, por nossa conta.

| | |
| --- | --- |
| **Assinatura Estudante** | R$ 59,90/mês · 250 créditos |
| **Assinatura Residente** | R$ 129,90/mês · 600 créditos |
| **Avulso** | 60 créditos R$ 24 · 200 créditos R$ 70 · 600 créditos R$ 180 |

Os números vivem em [`motor/planos.js`](motor/planos.js), em um lugar só: a tela de
compra, o débito do uso e o recibo leem a mesma tabela. A ancoragem é o custo real
de API (~R$ 0,85 por consulta de texto, ~R$ 0,15 por minuto de voz), com margem para
a infraestrutura fixa e para o caso que sai mais caro que a média.

**Quem paga o quê.** Aluno gasta crédito; professor e admin não — quem avalia a
turma não paga pela avaliação. Conta criada pelo admin também nasce com os créditos
de boas-vindas, para uma turma cadastrada na véspera conseguir usar a ferramenta na
aula.

**Antes de começar**, se o saldo não cobre a experiência completa, a página avisa e
deixa o aluno decidir: começar assim mesmo ou recarregar. Ninguém é cortado no meio
de uma estação. Sem saldo para nem uma consulta, o caminho é a recarga.

### Contabilidade

`credito_lancamento` é um **razão**, não um contador: cada linha diz de onde o
crédito veio ou para onde foi (boas-vindas, compra, assinatura, consulta, voz,
estorno). Saldo é a soma. Um contador simples seria menos código e um pesadelo no
primeiro suporte — "sumiram meus créditos" sem nenhuma linha para mostrar é uma
discussão sem árbitro.

O débito da consulta acontece **antes** de ela existir, com o id dela como
referência: debitar depois abriria a janela em que duas abas começam ao mesmo tempo
e uma sai de graça. Falha nossa depois da cobrança gera **estorno automático**.

### Pix (Woovi) e cartão (Stripe)

| Variável | Descrição |
| -------- | --------- |
| `WOOVI_APP_ID` | App ID da Woovi (THM Tecnologia). Sem ela, o Pix não é oferecido. |
| `STRIPE_SECRET_KEY` | Chave secreta da Stripe (THM Tecnologia). Sem ela, o cartão não é oferecido. |
| `STRIPE_WEBHOOK_SECRET` | Segredo do endpoint de webhook. **Sem ela, nenhum webhook da Stripe é aceito.** |
| `THM_CREDITOS_BOAS_VINDAS` | Créditos da conta nova (padrão: 20). `0` desliga. |

Webhooks a cadastrar nos painéis:

- Stripe → `https://ubtec.sbs/api/webhooks/stripe` (eventos `checkout.session.completed`,
  `invoice.paid`, `customer.subscription.deleted`)
- Woovi → `https://ubtec.sbs/api/webhooks/woovi`

**Duas regras governam a cobrança**, e valem para os dois provedores:

1. **Quem diz que foi pago é o provedor, nunca o navegador.** O aluno voltar para a
   página de sucesso não credita nada: credita o webhook, e mesmo ele é reconferido
   contra a API antes de valer. Um POST forjado no nosso endpoint não vira crédito.
2. **Todo crédito é idempotente por referência.** Provedor reenvia webhook de
   propósito — é assim que se garante entrega — e reenvio não pode virar dinheiro.

Assinatura só no cartão: Pix recorrente exigiria o aluno pagar na mão todo mês, e
chamar isso de assinatura seria mentira. No Pix vão os pacotes avulsos.

## Stack de produção (VPS Docker + Traefik)

O `ubtec.sbs` não roda na hospedagem compartilhada: roda num VPS Docker, atrás do
Traefik do Coolify. A stack está em [`docker-compose.yml`](docker-compose.yml), ao
lado deste arquivo — **versionada de propósito**, porque enquanto ela só existia no
servidor ela derivou: o container que servia foi criado à mão (Node 22 + `npm ci`)
enquanto o arquivo em disco ainda descrevia a versão anterior (Node 20). Quem
reiniciasse "o projeto" ressuscitava o container antigo, que entrava em crash-loop e
podia ser registrado no Traefik por instantes.

O container é descartável e sem build: **clona a `main` a cada start**. Então:

- **Deploy de código novo** = `git push` na `main` + reiniciar o serviço.
- **Mudança de configuração** = editar o compose (ou o `.env`) + `up -d`.

Os segredos ficam num `.env` ao lado do compose (permissão `600`) — o compose só os
referencia. Hoje ele guarda `OPENAI_API_KEY` e `PV_SEGREDO`.

### Aplicando a stack pela primeira vez

No diretório do projeto no host (`/docker/paciente-virtual`):

```sh
cp .env ../pv.env.bak                     # o .env é a única coisa insubstituível
docker rm -f paciente-virtual-antigo      # o órfão do deploy anterior, se existir
# grave o docker-compose.yml deste repositório por cima do antigo
docker compose up -d --remove-orphans
docker compose logs -f --tail=50
```

O `--remove-orphans` é o que impede a repetição do problema: containers com o rótulo
do projeto que não estão no arquivo somem em vez de ficarem para trás.

Conferência (de fora, sem sessão):

```sh
curl -s https://ubtec.sbs/healthz        # status ok, backend, painel
curl -s https://ubtec.sbs/api/tempo-real # disponivel, modelo e os tetos de minuto
```

Se algo der errado, o rollback é o `.env` de volta e o compose anterior — os dados
(transcrições e o banco de contas) vivem no volume `historico` e não são tocados por
nenhuma dessas operações.

### Conversa ao vivo (voz em tempo real)

O aluno fala e o paciente responde sem apertar nada, podendo ser interrompido no meio
da frase. O áudio vai **direto do navegador ao provedor** (WebRTC): o VPS fica fora do
caminho, o que corta a latência e impede que o áudio de uma turma inteira sufoque o
host. Liga sozinha quando o áudio da OpenAI está configurado; o modo de segurar o
microfone continua existindo como fallback e como caminho barato.

**Contra o ruído da sala de aula**, três camadas, porque nenhuma resolve sozinha:

1. o navegador aplica cancelamento de eco e supressão de ruído no microfone;
2. um **portão de ruído** na página só deixa passar o que estiver acima do limiar —
   com cauda de 600 ms para não cortar o fim das frases. Abaixo disso o que sai é
   silêncio digital, e nem o detector de fala do provedor chega a ver;
3. o provedor recebe `noise_reduction: far_field` (microfone de celular ou notebook
   numa sala) e detecção de fala por `server_vad` com limiar alto e 700 ms de
   silêncio — o paciente só responde quando o aluno de fato parou de falar.

O `semantic_vad` foi abandonado de propósito: combinado com redução de ruído, ele é
conhecido por disparar latência alta, e aqui previsibilidade vale mais que sutileza.

| Variável | Padrão | Descrição |
| -------- | ------ | --------- |
| `PV_TEMPO_REAL` | ligado | `0` desliga o recurso mesmo com tudo configurado. |
| `PV_RT_MODELO` | `gpt-realtime-2.1-mini,gpt-realtime-mini,gpt-realtime-2.1` | Modelo(s) da conversa ao vivo. Cadeia de fallback. |
| `PV_RT_VOZ_F` / `PV_RT_VOZ_M` | `marin` / `cedar` | Voz do paciente ao vivo (catálogo próprio, diferente do TTS por frase). |
| `PV_RT_MIN_CONSULTA` | `12` | Teto de minutos de voz por consulta. |
| `PV_RT_MIN_ALUNO_DIA` | `30` | Teto por aluno em 24 h (janela deslizante). |
| `PV_RT_MIN_SERVIDOR_DIA` | `240` | Teto do servidor inteiro em 24 h — é o que protege quem paga a conta. |
| `PV_RT_MIN_BLOCO` | `5` | Minutos concedidos por token. Blocos curtos custam uma renovação a mais e é o que se perde ao fechar a aba. |

O orçamento conta **minutos concedidos, não consumidos**: como o servidor não vê o
áudio, ele debita o bloco inteiro ao cunhar o token e erra de propósito para menos.

**O segredo clínico continua no servidor.** As instruções da sessão são o mesmo
personagem do caminho por texto — sem diagnóstico e sem `informacoes_sensiveis`. O que
é sensível só existe atrás da ferramenta `consultar_ficha`, que o modelo é obrigado a
chamar e que **o servidor** responde, aplicando o mesmo portão determinístico. Em
troca da latência, a transcrição passa a ser declarada pelo navegador: por isso cada
consulta à ficha é carimbada no transcript como `PERGUNTA VERIFICADA:`, e é nela que a
rubrica se ancora nos itens de risco.

#### Voz sem custo por chamada: Kokoro ao lado da aplicação

Quando o chat roda num gateway sem endpoints de áudio (OpenRouter e afins), a voz do
paciente cairia para a do navegador — sofrível em pt-BR. O **Kokoro-82M** resolve isso
sem custo por chamada: são 82 milhões de parâmetros, roda em CPU a ~6× tempo real sem
GPU, tem vozes de português brasileiro e expõe `/v1/audio/speech` compatível com OpenAI.

Sobe como um contêiner ao lado, na mesma rede interna, **sem porta pública** — só a
aplicação fala com ele:

```yaml
name: kokoro
networks:
  coolify:
    external: true
services:
  kokoro:
    image: ghcr.io/remsky/kokoro-fastapi-cpu:latest
    container_name: kokoro
    restart: unless-stopped
    networks: [coolify]
    mem_limit: 2g
    cpus: 1.5
```

Depois basta `KOKORO_URL=http://kokoro:8880` na aplicação — a ordem de provedores já
faz o Kokoro ganhar da OpenAI automaticamente. Os limites de memória e CPU não são
decoração: num VPS pequeno e compartilhado, a síntese pode sufocar os outros serviços
ou provocar OOM.

Isso cobre a **fala**, não a transcrição — o áudio do aluno continua precisando de um
endpoint compatível (`OPENAI_AUDIO_*`) ou cai no reconhecimento do navegador.

`POST /api/transcrever` recebe o áudio **bruto** no corpo, com o `Content-Type` que o
`MediaRecorder` produziu (webm/opus no Chrome, mp4/aac no Safari), e devolve
`{ texto }`. Não há parsing de multipart do nosso lado. Áudio inaproveitável responde
**422**, para a página pedir que o aluno repita em vez de mandar uma pergunta em
branco ao paciente.

### Limites por sessão (janela de 5 min)

Existem para a chave da API não ser drenada por um script: 60 mensagens, 20 consultas
novas, 400 sínteses de voz, 120 transcrições e 20 tentativas de código. Cada pergunta
enviada ao modelo é cortada em 2000 caracteres e cada áudio em 12 MB.

A contagem é **por sessão**, não por IP: numa escola a turma inteira sai por um único
IP público, e contar por IP faria um aluno usando voz derrubar a voz dos colegas. As
rotas sem sessão (login) continuam contando por IP, que é o que sobra.

### Modelos open source recomendados (via OpenRouter)

Os defaults priorizam modelos **open weight** de alta performance em pt-BR, best-first
e com fallback automático. Para o paciente (fala, instruct rápido):

```
deepseek/deepseek-chat, meta-llama/llama-3.3-70b-instruct, qwen/qwen-2.5-72b-instruct
```

Para o parecer pedagógico (`OPENAI_MODEL_AVALIACAO`, com raciocínio):

```
deepseek/deepseek-r1, deepseek/deepseek-chat, meta-llama/llama-3.3-70b-instruct
```

Basta `OPENAI_BASE_URL=https://openrouter.ai/api/v1` + `OPENAI_API_KEY` do OpenRouter.
Como é uma cadeia de fallback, um slug indisponível é simplesmente pulado. Modelos
"médicos" OSS (focados em QA em inglês) tendem a piorar o role-play em pt-BR — um bom
instruct multilíngue geral rende falas de paciente mais naturais.

## Observações

- **Transcrições**: o servidor tenta gravar em `historico/`; em hospedagens com
  sistema de arquivos restrito, a consulta e a avaliação seguem funcionando (o
  transcript vive em memória durante a sessão).
- **Sessões em memória**: consultas abertas são perdidas quando a aplicação
  reinicia — adequado para demonstrações e turmas pequenas. O servidor trata
  `SIGTERM`/`SIGINT` e encerra as conexões de forma limpa nos reinícios.
- **LGPD**: como no restante do projeto, as transcrições contêm nome do aluno e o
  conteúdo da consulta; trate esses dados de acordo.
