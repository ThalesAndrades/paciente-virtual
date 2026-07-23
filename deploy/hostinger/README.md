# Deploy na Hostinger (Node.js)

Este diretório contém um servidor **Node.js sem dependências externas** que roda o
protótipo interativo do Paciente Virtual em hospedagens que suportam Node — como a
hospedagem web da Hostinger (hPanel) ou um VPS. Ele reutiliza os mesmos casos
(`casos/`), rubricas (`avaliacoes/`) e a mesma página web (`paciente_virtual/web/static/`)
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
