# Paciente Virtual

Simulador de paciente virtual **por voz** para treinamento de anamnese e entrevista
clínica. O estudante conversa com um paciente interpretado por um modelo de linguagem
local (via [Ollama](https://ollama.com)), solicita exames, e ao final recebe uma
avaliação objetiva (rubrica) e um parecer pedagógico gerado por IA.

## Como funciona

1. **Consulta** — pela interface web (`paciente-virtual-web`, recomendada) ou pelo
   terminal (`paciente-virtual`): o estudante escolhe um caso clínico, conversa
   com o paciente falando ao microfone (ou digitando) e pode solicitar exame físico
   e exames complementares. Toda a consulta é registrada em `historico/`.
2. **Avaliação** — ao encerrar a consulta na interface web (ou com
   `paciente-virtual-avaliador` no terminal): o transcript é pontuado contra uma
   rubrica objetiva (`avaliacoes/`) e analisado semanticamente pelo modelo de
   linguagem, que produz nota, pontos fortes e feedback pedagógico.

O paciente segue regras de **revelação gradual**: informações sensíveis só surgem
diante de perguntas específicas, acolhedoras e empáticas — a qualidade das respostas
depende da qualidade da entrevista.

## Requisitos

- Python 3.10+
- [Ollama](https://ollama.com) instalado e em execução, com o modelo baixado:

  ```bash
  ollama pull qwen3:8b
  ```

- Microfone e saída de áudio.
- Internet para a transcrição de fala (Google Speech Recognition) e para as vozes
  neurais (edge-tts). Sem internet, a fala do paciente usa a voz local do sistema
  e as perguntas podem ser digitadas.
- No Linux, a captura de áudio requer a biblioteca PortAudio
  (`sudo apt install libportaudio2`).

## Instalação

```bash
git clone https://github.com/ThalesAndrades/paciente-virtual.git
cd paciente-virtual
python -m venv .venv
source .venv/bin/activate  # Windows: .venv\Scripts\activate
pip install -e .
```

## Uso

### Protótipo interativo (web) — recomendado

```bash
paciente-virtual-web
# ou: python -m paciente_virtual.web
```

Abra <http://127.0.0.1:8000> no navegador: escolha o caso, converse com o paciente
por texto ou voz (🎤 usa o reconhecimento de fala do navegador; 🔊 lê as respostas
em voz alta) e clique em **Encerrar e avaliar** para ver a nota objetiva e o
parecer pedagógico na hora.

Sem o Ollama em execução, o protótipo continua funcionando em **modo
demonstração**: o paciente responde com dados fixos do caso (as respostas ficam
marcadas) e a avaliação objetiva é gerada normalmente — apenas o parecer da IA
fica indisponível.

### Consulta pelo terminal

```bash
paciente-virtual
# ou: python -m paciente_virtual.consulta
```

Durante a consulta, pressione ENTER para falar ao microfone ou digite a pergunta
diretamente. Diga ou digite `sair` para encerrar.

Avaliar uma consulta gravada:

```bash
paciente-virtual-avaliador
# ou: python -m paciente_virtual.avaliador
```

Testar áudio (voz e microfone):

```bash
python -m paciente_virtual.diagnostico fala
python -m paciente_virtual.diagnostico microfone
```

## Configuração

| Variável de ambiente           | Padrão       | Descrição                                            |
| ------------------------------ | ------------ | ---------------------------------------------------- |
| `PACIENTE_VIRTUAL_MODELO`      | `qwen3:8b`   | Modelo servido pelo Ollama                            |
| `PACIENTE_VIRTUAL_DIR`         | raiz do repo | Diretório com `casos/`, `avaliacoes/`, `historico/`   |
| `PACIENTE_VIRTUAL_LIMIAR_FALA` | `120`        | Piso de sensibilidade do microfone (amplitude int16) |
| `PACIENTE_VIRTUAL_HOST`        | `127.0.0.1`  | Endereço do servidor web                              |
| `PACIENTE_VIRTUAL_PORTA`       | `8000`       | Porta do servidor web                                 |

O limiar de fala é calibrado automaticamente pelo ruído ambiente no início de
cada gravação; reduza o piso se o seu microfone tiver pouco ganho.

## Estrutura do projeto

```
paciente_virtual/        # Pacote Python
├── consulta.py          # Loop principal da consulta (CLI)
├── avaliador.py         # Avaliação objetiva + semântica (CLI)
├── prompt.py            # Prompt de sistema do paciente
├── exames.py            # Motores de exame físico e complementares
├── registro.py          # Formato do histórico: escrita e leitura do transcript
├── ia.py                # Acesso ao Ollama (remove blocos <think>)
├── texto.py             # Normalização de texto (acentos, limites de palavra)
├── config.py            # Caminhos e modelo configuráveis por ambiente
├── util.py              # Menu de seleção de arquivos
├── demo.py              # Paciente de demonstração (sem Ollama)
├── diagnostico.py       # Testes manuais de áudio
├── web/
│   ├── servidor.py      # API JSON do protótipo interativo (Flask)
│   └── static/          # Página única do chat (HTML/CSS/JS)
└── voz/
    ├── ouvir.py         # Captura com detecção de silêncio + transcrição
    └── falar.py         # edge-tts com fallback pyttsx3
casos/                   # Casos clínicos (JSON)
avaliacoes/              # Rubricas de avaliação (JSON)
historico/               # Transcrições geradas (não versionadas)
tests/                   # Testes automatizados (pytest)
```

## Criando um novo caso

1. Crie `casos/<nome_do_caso>.json` com a estrutura dos casos existentes:
   `identificacao` (com `voz`: `"feminino"` ou `"masculino"`), `queixa_principal`,
   `historia_doenca_atual`, antecedentes, hábitos e, opcionalmente, os blocos de
   revelação gradual (`informacoes_iniciais`, `informacoes_intermediarias`,
   `informacoes_sensiveis`).
2. Adicione `exame_fisico` e `exames_disponiveis` com `nome`, `sinonimos` e
   `resultado` para cada exame.
3. Crie a rubrica `avaliacoes/<nome_do_caso>.json` (mesmo nome do caso) com
   `criterios`, cada um contendo `nome`, `peso`, `objetivo` e `itens`. Cada item
   pode listar `termos` (sinônimos) — a comparação ignora acentos e maiúsculas.

### Como os exames são detectados

O resultado de um exame (físico ou complementar) só é entregue quando a frase
contém uma **solicitação ativa** junto do nome/sinônimo do exame:

- "vou **aferir** sua pressão", "**solicito** um ECG", "**qual** a saturação?" →
  entrega o resultado do caso (todos os exames citados na mesma frase).
- "o senhor **tem** pressão alta?", "**já fez** um eletro?" → é anamnese: a
  pergunta segue para o paciente responder.

A detecção é por palavras-chave (determinística, avaliável), não por
interpretação de intenção — frases ambíguas como "costuma verificar sua
pressão em casa?" ainda disparam a medição.

## Desenvolvimento

```bash
pip install -e ".[dev]"
ruff check .   # lint
pytest         # testes
```

## Privacidade

As transcrições em `historico/` contêm nome do aluno e o conteúdo da consulta.
Elas **não são versionadas** (ver `.gitignore`) — trate esses arquivos conforme a
LGPD ao armazená-los ou compartilhá-los.
