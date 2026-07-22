# Compreensão do Projeto — Paciente Virtual

Documento de análise técnica do repositório: o que o projeto faz, como está
organizado, quais são as decisões de design centrais e onde estão os pontos de
atenção. Serve como mapa de entrada para quem for manter ou estender o código.

---

## 1. O que é

**Paciente Virtual** é um simulador de **anamnese e entrevista clínica** para
treinamento de estudantes de saúde. O aluno conversa (por texto ou voz) com um
paciente interpretado por um modelo de linguagem local (Ollama), pode solicitar
exame físico e exames complementares e, ao encerrar, recebe:

1. **Nota objetiva** — checklist determinístico contra uma rubrica do caso.
2. **Parecer pedagógico** — análise semântica gerada pela IA (opcional).

O princípio pedagógico central é a **revelação gradual**: o paciente só entrega
informações sensíveis diante de perguntas específicas, acolhedoras e bem
direcionadas. A qualidade das respostas depende da qualidade da entrevista.

Versão atual: **1.1.0** (declarada em `pyproject.toml` e `package.json`).

---

## 2. Arquitetura em uma frase

O repositório contém **duas implementações do mesmo motor**, compartilhando os
mesmos dados (`casos/`, `avaliacoes/`, `paciente_virtual/web/static/`):

| Implementação | Linguagem | Uso | Entrada |
| ------------- | --------- | --- | ------- |
| **Pacote `paciente_virtual/`** | Python (Flask) | Desenvolvimento local, CLI + web, voz local (Whisper/Piper/Kokoro) | `paciente-virtual*` scripts |
| **`deploy/hostinger/`** | Node.js (sem dependências) | Hospedagem Node.js (ex.: Hostinger), só web | `npm start` / `app.js` |

O Node é uma **reimplementação portada** do motor Python — não compartilha
código, apenas os dados JSON e a página `index.html`. Isso mantém o deploy sem
dependências, mas cria o risco de as duas versões divergirem (ver §7).

---

## 3. Fluxo de uma consulta (Python / web)

```
[Navegador]  →  POST /api/consultas          → cria sessão em memória + histórico em disco
   ↓                                            (prompt de sistema montado a partir do caso)
[aluno fala/digita]
   ↓
POST /api/consultas/<id>/mensagem
   ├─ detectar_exames(texto, caso)  ── SIM ─→ entrega resultado do exame, registra, NÃO chama a IA
   └─ senão → conversar(mensagens) ─ Ollama ─→ resposta do paciente
                 └─ falha? → responder_demo() (modo demonstração, respostas fixas do caso)
   ↓
POST /api/consultas/<id>/encerrar
   ├─ pontuar_checklist(rubrica, falas do profissional)  → nota objetiva (determinística)
   └─ avaliar_com_ia(rubrica, transcript)                → parecer pedagógico (opcional)
```

Os módulos-chave e suas responsabilidades:

| Módulo | Responsabilidade |
| ------ | ---------------- |
| `prompt.py` | Monta o prompt de sistema que "programa" o comportamento do paciente (regras de não sair do personagem + revelação gradual + dados do caso). |
| `exames.py` | Detecta **solicitação ativa** de exame por palavras-chave (radicais de verbos + termos exatos). Pura, sem efeitos colaterais em `detectar_exames`. |
| `avaliador.py` | Checklist objetivo (`pontuar_checklist`) + parecer da IA (`avaliar_com_ia`). |
| `registro.py` | **Dono único do formato do transcript** — escrita e leitura das constantes de prefixo. |
| `ia.py` | Acesso ao Ollama; remove blocos de raciocínio `<think>...</think>`. |
| `demo.py` | Paciente determinístico (fallback sem Ollama), respostas extraídas só do caso. |
| `texto.py` | Normalização (ignora acentos/maiúsculas) e casamento de termos com limite de palavra. |
| `web/servidor.py` | API JSON Flask + serve a página única. Sessões em memória. |
| `voz/` | `ouvir.py` (captura + Whisper/Google), `falar.py` (Piper/Kokoro/edge-tts/pyttsx3), `transcricao.py`. |
| `relatorio.py` | Painel do professor: lista e detalha consultas gravadas. |

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
de `exames.py`.

### 4.2 A avaliação objetiva não depende do modelo
`pontuar_checklist` considera **apenas as falas do profissional e os títulos dos
exames solicitados** — respostas do paciente, conteúdo dos resultados e cabeçalho
do histórico **não pontuam** (ver `PREFIXOS_PROFISSIONAL` em `registro.py`).
Cada item da rubrica pode ser uma string ou `{"nome", "termos"}`; a comparação
ignora acentos e maiúsculas. Assim, a nota objetiva funciona mesmo sem Ollama.

### 4.3 Modo demonstração sem alucinação
Sem Ollama, `responder_demo` responde a partir **exclusivamente** dos dados do
caso, respeitando a revelação gradual de forma aproximada (sensível só sai com
pergunta que toca o tema). Nada é inventado; o restante recebe uma resposta
neutra pedindo reformulação. O transcript marca a origem (`ia` vs `demo`).

### 4.4 Revelação gradual como contrato pedagógico
O prompt de sistema (`prompt.py`) instrui camadas: informações iniciais →
intermediárias → sensíveis, cada uma exigindo perguntas progressivamente mais
específicas e acolhedoras. Os casos JSON carregam esses blocos separados
(`informacoes_iniciais`, `informacoes_intermediarias`, `informacoes_sensiveis`,
`dinamica_de_revelacao`).

### 4.5 Segurança consciente no servidor
`servidor.py` compara o `caso_id` contra a lista real de arquivos em vez de
montar caminho com entrada do usuário (evita *path traversal*). O commit
`9309c57`/`4b11557` mostram correções de revisão adversarial (XSS no frontend,
achados de backend/rubrica), indicando que o projeto já passou por revisão de
segurança.

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
  Os pesos somam ~10 (nota objetiva sobre 10).
- Casos de saúde mental incluem escalas como "exames" (PHQ-9, GAD-7, MBI) e
  itens de exame do estado mental.
- `scripts/gerar-rubricas.mjs` — utilitário de geração de rubricas.

**Exemplos de caso** (medicina): Infarto, AVC isquêmico, Apendicite, Cetoacidose
diabética, Embolia pulmonar, Dengue com sinais de alarme, DPOC, Crise asmática…
**(psicologia)**: Episódio depressivo, Ideação suicida, Pânico, Luto, Burnout,
TEPT, Anorexia, Borderline, Depressão pós-parto, Autolesão na adolescência…

---

## 6. Voz e IA (stack)

- **LLM**: Ollama local, modelo padrão `qwen3:8b` (config. por
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
- **Python** (`tests/test_demo.py`): cobre o modo demonstração (identificação,
  HDA, sintomas/antecedentes, revelação gradual em casos de psicologia).
- **Node** (`deploy/hostinger/testes/*.test.js`): testes do motor e servidor
  portados.
- **CI** (`.github/workflows/ci.yml`): dois jobs — `ruff check` + `pytest`
  (Python 3.12) e `npm test` (Node 20). Roda em push para `main` e em PRs.

### ⚠️ Ponto de atenção — teste Node falhando
No estado atual do branch, `npm test` tem **1 teste falhando**:

```
not ok 5 - paciente demo responde identificação e sintomas
  (deploy/hostinger/testes/motor.test.js:53)
  esperava /^Sim/, recebeu 'Estou com dor no peito.'
```

O `responderDemo` do motor **Node** devolve a queixa principal em vez de um
"Sim, …" para uma pergunta de sintoma — divergência em relação ao motor Python
(cujo teste equivalente passa). É exatamente o **risco de divergência entre as
duas implementações** descrito na §2: uma evoluiu e a outra não acompanhou. Vale
alinhar `deploy/hostinger/motor/demo.js` ao comportamento do `demo.py`.

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
ruff check . && pytest             # Python
npm test                           # Node
```

Sem Ollama em execução, tudo continua funcionando em **modo demonstração** (só o
parecer da IA fica indisponível; a nota objetiva não depende do modelo).

---

## 9. Mapa rápido de arquivos

```
paciente_virtual/          Pacote Python (motor de referência)
├── consulta.py            Loop da consulta (CLI)
├── avaliador.py           Checklist objetivo + parecer da IA
├── prompt.py              Prompt de sistema do paciente
├── exames.py              Detecção determinística de exames
├── registro.py            Formato do transcript (dono único)
├── ia.py / demo.py        Ollama / fallback determinístico
├── texto.py               Normalização e casamento de termos
├── web/servidor.py        API Flask + página única
└── voz/                   ouvir (STT) + falar (TTS) + transcricao
casos/         (40)        Casos clínicos — 20 medicina + 20 psicologia
avaliacoes/    (40)        Rubricas de avaliação (uma por caso)
deploy/hostinger/          Reimplementação Node sem dependências (só web)
scripts/                   gerar-rubricas.mjs
tests/                     pytest (modo demo)
.github/workflows/ci.yml   CI: ruff + pytest + npm test
```
