# Compreensão do Projeto — Paciente Virtual

Documento de análise técnica do repositório: o que o projeto faz, como está
organizado, quais são as decisões de design centrais e onde estão os pontos de
atenção. Serve como mapa de entrada para quem for manter ou estender o código.

---

## 1. O que é

**Paciente Virtual** é um simulador de **anamnese e entrevista clínica** para
treinamento de estudantes de saúde. O aluno conversa (por texto ou voz) com um
paciente interpretado por um modelo de linguagem, pode solicitar
exame físico e exames complementares e, ao encerrar, recebe:

1. **Nota objetiva** — checklist determinístico contra uma rubrica do caso.
2. **Parecer pedagógico** — análise semântica gerada pela IA (opcional).

O princípio pedagógico central é a **revelação gradual**: o paciente só entrega
informações sensíveis diante de perguntas específicas, acolhedoras e bem
direcionadas. A qualidade das respostas depende da qualidade da entrevista.

Versão atual: **1.1.0** (declarada em `package.json`).

---

## 2. Arquitetura em uma frase

**Uma única implementação**, em Node.js sem dependências externas:

| Parte | Onde | Papel |
| ----- | ---- | ----- |
| Servidor e API | `deploy/hostinger/servidor.js` | HTTP, rotas, sessão, limites |
| Regras | `deploy/hostinger/motor/` | acesso, prompt do paciente, exames, avaliação, voz, transcrição |
| Interface | `web/index.html` | página única, sem build |
| Dados | `casos/`, `avaliacoes/` | 40 casos e 40 rubricas em JSON |

> **Histórico:** até agosto de 2026 o repositório mantinha **duas** implementações
> do mesmo motor — um pacote Python (Flask) e esta porta Node. A duplicação foi a
> causa raiz de defeitos reais: o motor de demonstração divergiu entre as duas, um
> prompt de personagem inteiro virou código morto, e o servidor Python parou de
> conseguir servir a página compartilhada por não acompanhar as rotas novas
> (`/api/acesso`, `/api/sair`, `/api/consultas/:id/exame`) — deixando-o quebrado e
> sem autenticação nenhuma. A stack Python foi removida; o Node é a fonte única.

---

## 3. Fluxo de uma consulta

```text
[Navegador]  →  POST /api/consultas          → cria sessão em memória + histórico em disco
   ↓                                            (prompt de sistema montado a partir do caso)
[aluno fala/digita]
   ↓
POST /api/consultas/<id>/mensagem
   ├─ detectarExames(texto, caso)  ── SIM ─→ entrega resultado do exame, registra, NÃO chama a IA
   └─ senão → conversar(mensagens) ── modelo ─→ resposta do paciente
                 └─ falha? → responderDemo() (modo demonstração, respostas fixas do caso)
   ↓
POST /api/consultas/<id>/encerrar
   ├─ pontuarChecklist(rubrica, falas do profissional)  → nota objetiva (determinística)
   └─ montarPromptAvaliacao(rubrica, transcript, fechamento)                → parecer pedagógico (opcional)
```

Os módulos-chave e suas responsabilidades:

Todos em `deploy/hostinger/motor/`, exceto o servidor:

| Módulo | Responsabilidade |
| ------ | ---------------- |
| `servidor.js` | HTTP, rotas, sessões em memória, gravação do transcript, limites por sessão. |
| `humanizar.js` | Monta o prompt do paciente a partir da **matriz de contexto de vida** do caso, e a memória da conversa (últimas 12 idas e voltas). |
| `acesso.js` | Código do aluno e senha do professor, cookie de sessão assinado. Painel *fail-closed*. |
| `exames.js` | Detecta **solicitação ativa** de exame; separa aferição de anamnese sobre o passado. |
| `avaliador.js` | Checklist objetivo (com teto de itens por turno) + prompt do parecer, incluindo o fechamento diagnóstico do aluno. |
| `demo.js` | Paciente determinístico quando não há modelo, e o **portão** dos temas sensíveis (`fatoSensivelDireto`), usado também no caminho da IA. |
| `ia.js` | Chamada ao modelo (OpenAI-compatível ou Ollama), cadeia de fallback entre modelos, streaming, limpeza de `<think>`. |
| `tts.js` / `transcricao.js` / `audio.js` | Voz do paciente, transcrição do áudio do aluno e as credenciais de áudio (que podem ser separadas das do texto). |
| `relatorio.js` | Leitura e estruturação do transcript para o painel do professor. |
| `texto.js` | Normalização (ignora acentos/maiúsculas) e casamento de termos com limite de palavra. |
| `limite.js` | Janela deslizante de uso, por sessão (e por IP quando não há sessão). |

---

## 4. Decisões de design que importam

### 4.1 Detecção de exames determinística, não interpretada
O resultado de um exame só é entregue quando a frase contém uma **solicitação
ativa** ("vou aferir sua pressão", "solicito um ECG", "qual a saturação?"). Uma
menção sem solicitação ("o senhor tem pressão alta?", "já fez um eletro?") segue
para o paciente como anamnese. A detecção usa palavras-chave (radicais de verbo
como `afer`, `solicit`, `auscult` + termos exatos), **não** interpretação de
intenção pelo LLM. É uma escolha explícita: manter o resultado **determinístico
e avaliável**, aceitando que frases ambíguas ("costuma verificar sua pressão em
casa?") disparem a medição — custo baixo, casos raros. Documentado no docstring
de `exames.js`.

### 4.2 A avaliação objetiva não depende do modelo
`pontuarChecklist` considera **apenas as falas do profissional e os títulos dos
exames solicitados** — respostas do paciente, conteúdo dos resultados e cabeçalho
do histórico **não pontuam** (ver `PREFIXOS_PROFISSIONAL` em `avaliador.js`).
Cada item da rubrica pode ser uma string ou `{"nome", "termos"}`; a comparação
ignora acentos e maiúsculas. Assim, a nota objetiva funciona mesmo sem modelo de linguagem.

### 4.3 Modo demonstração sem alucinação
Sem modelo, `responderDemo` responde a partir **exclusivamente** dos dados do
caso, respeitando a revelação gradual de forma aproximada (sensível só sai com
pergunta que toca o tema). Nada é inventado; o restante recebe uma resposta
neutra pedindo reformulação. O transcript marca a origem (`ia` vs `demo`).

### 4.4 Revelação gradual como contrato pedagógico
O prompt de sistema (`humanizar.js`) instrui camadas: informações iniciais →
intermediárias → sensíveis, cada uma exigindo perguntas progressivamente mais
específicas e acolhedoras. Os casos JSON carregam esses blocos separados
(`informacoes_iniciais`, `informacoes_intermediarias`, `informacoes_sensiveis`,
`dinamica_de_revelacao`).

### 4.5 Segurança consciente no servidor
`servidor.js` compara o `caso_id` contra a lista real de arquivos em vez de
montar caminho com entrada do usuário (evita *path traversal* — verificado em
`servidor.js`). Além disso, os commits `9309c57` e `81f5381` registram
correções pontuais de revisão adversarial em escopos específicos (XSS no
frontend/acessibilidade; achados de backend e rubrica) — são correções
localizadas, não uma auditoria de segurança do projeto como um todo.

---

## 5. Os dados: 40 casos, 40 rubricas

- **`casos/*.json`** (40 arquivos) — 20 de **medicina** e 20 de **psicologia**
  (campo `categoria`). Cada caso é ricamente caracterizado: além dos dados
  clínicos (`historia_doenca_atual`, antecedentes, hábitos, `exame_fisico`,
  `exames_disponiveis`), há blocos de **personagem** (`persona`,
  `estilo_de_fala`, `contexto_de_vida`, `estado_emocional`,
  `dinamica_de_revelacao`, `fidelidade_clinica`) que dão profundidade
  humana e coerência clínica ao paciente.
- **`avaliacoes/*.json`** (40 arquivos, um por caso) — rubricas com `criterios`,
  cada um com `nome`, `objetivo`, `peso` e `itens` (com `termos` sinônimos).
  Os pesos somam exatamente 10 (nota objetiva sobre 10) — contrato validado por
  teste (`pesos somam 10`).
- Casos de saúde mental incluem escalas como "exames" (PHQ-9, GAD-7, MBI) e
  itens de exame do estado mental.
- `scripts/gerar-rubricas.mjs` — utilitário de geração de rubricas.

**Exemplos de caso** (medicina): Infarto, AVC isquêmico, Apendicite, Cetoacidose
diabética, Embolia pulmonar, Dengue com sinais de alarme, DPOC, Crise asmática…
**(psicologia)**: Episódio depressivo, Ideação suicida, Pânico, Luto, Burnout,
TEPT, Anorexia, Borderline, Depressão pós-parto, Autolesão na adolescência…

---

## 6. Voz e IA (stack)

- **LLM**: API OpenAI-compatível (padrão) ou Ollama (config. por
  `PACIENTE_VIRTUAL_MODELO`). Blocos `<think>` são removidos.
- **Transcrição (STT)**: `faster-whisper` (local, recomendado) → Google (online).
- **Síntese (TTS)**: Piper (voz masculina `pt_BR-faber-medium`) + Kokoro (voz
  feminina `pf_dora`) → edge-tts → pyttsx3 (voz do sistema).
- Extra `voz-local` habilita o stack 100% offline em CPU; sem ele, a web usa a
  Web Speech API do navegador.
- Tudo configurável por variáveis de ambiente (tabela no README §Configuração).

---

## 7. Qualidade, testes e pontos de atenção

### Testes e CI
- **28 testes** em `deploy/hostinger/testes/` (`node --test`, sem dependências):
  motor (normalização, exames, rubrica, prompt do paciente, portão dos temas
  sensíveis, modo demonstração, voz) e servidor ponta a ponta (sessão, papéis,
  fluxo completo da consulta, fechamento diagnóstico, limites por sessão).
- Entre os contratos travados por teste: **nenhum dos 40 casos abre um tema
  sensível diante de 12 formas de cumprimento**, e um único turno do profissional
  não fecha a rubrica inteira.
- **CI** (`.github/workflows/ci.yml`): um job — `npm test` (Node 20), em push
  para `main` e em PRs.

### Achado da análise — 2 falhas de CI (diagnosticadas e corrigidas neste PR)
Sobre a base deste documento (commit `1b0162e`, **2026-07-22**), a CI tinha duas
falhas **pré-existentes** — não introduzidas por este documento (que só adiciona
Markdown). Foram diagnosticadas na análise e corrigidas neste mesmo PR:

**1. `npm test` — teste Node** (`deploy/hostinger/testes/motor.test.js:53`):
o `responderDemo` (Node, `demo.js`) rodava as **regras antes da triagem de
sintoma**, então "sente suor frio?" casava a regra da queixa por "sente" e
devolvia a queixa principal em vez de "Sim, …". O `demo.py` (Python, motor de
referência) faz o **inverso** — sintomas primeiro (`demo.py:279`). Era a
**divergência entre as duas implementações** descrita na §2. **Correção:**
`demo.js` passou a triar sintoma antes das regras, espelhando `demo.py`.

**2. `pytest` — teste Python** (`tests/test_web.py:143`,
`test_encerrar_gera_avaliacao`): o teste esperava um critério `"Solicitação de
exames"`, mas a rubrica atual do infarto (`avaliacoes/infarto.json`) nomeia esse
critério de `"Exames complementares"` (renomeado em `4b11557`). O teste estava
**desatualizado**. **Correção:** a asserção passou a esperar `"Exames
complementares"`.

Esse episódio ilustra na prática o risco de manter **duas fontes de verdade** para
o motor (§2) e de testes acoplados a nomes de rubrica.

### Outros pontos
- **Sessões em memória**: sem persistência entre reinícios, sem autenticação —
  é um protótipo para uso local/sala de aula (documentado).
- **Privacidade/LGPD**: `historico/` contém nome do aluno e conteúdo da consulta
  e **não é versionado** (`.gitignore`); tratamento de dados sob LGPD é
  responsabilidade de quem opera.
- **Duas fontes de verdade para o motor**: qualquer mudança de comportamento
  (detecção de exames, demo, avaliação) precisa ser replicada em Python e Node,
  ou a paridade quebra silenciosamente (como já aconteceu acima).

---

## 8. Como rodar (resumo)

```bash
# Python — web (recomendado)
pip install -e ".[voz-local]"      # voz 100% local; ou só ".[dev]" para dev
paciente-virtual-web               # http://127.0.0.1:8000

# Python — CLI
paciente-virtual                   # consulta   |   paciente-virtual-avaliador
paciente-virtual-relatorio         # painel do professor

# Node (deploy Hostinger)
npm start                          # http://127.0.0.1:3000

# Qualidade
node app.js                       # sobe em http://127.0.0.1:3000
npm test                           # Node
```

Sem Ollama em execução, tudo continua funcionando em **modo demonstração** (só o
parecer da IA fica indisponível; a nota objetiva não depende do modelo).

---

## 9. Mapa rápido de arquivos

```text
app.js                     Ponto de entrada
web/index.html             Interface (página única, sem build)
deploy/hostinger/
├── servidor.js            HTTP, rotas, sessões, transcript
├── motor/
│   ├── acesso.js          Código do aluno, senha do professor, cookie assinado
│   ├── humanizar.js       Prompt do paciente (matriz de vida) + memória
│   ├── demo.js            Paciente sem IA + portão dos temas sensíveis
│   ├── exames.js          Detecção determinística de exames
│   ├── avaliador.js       Checklist objetivo + prompt do parecer
│   ├── ia.js              Modelo de linguagem (cadeia de fallback, streaming)
│   ├── tts.js / transcricao.js / audio.js   Voz e transcrição
│   ├── relatorio.js       Leitura do transcript
│   ├── texto.js           Normalização e casamento de termos
│   └── limite.js          Limite de uso por sessão
└── testes/                28 testes (node --test)
casos/         (40)        Casos clínicos — 20 medicina + 20 psicologia
avaliacoes/    (40)        Rubricas de avaliação (uma por caso)
historico/                 Transcrições gravadas (não versionadas)
scripts/                   gerar-rubricas.mjs
.github/workflows/ci.yml   CI: npm test
```
