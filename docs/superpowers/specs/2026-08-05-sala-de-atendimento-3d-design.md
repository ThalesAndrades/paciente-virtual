# Sala de atendimento em 3D

**Data:** 2026-08-05 · **Status:** design aprovado, implementação não iniciada

## O problema

A consulta hoje é uma **lista de mensagens**. O aluno lê balões, digita ou segura o
microfone. Nada nisso se parece com estar diante de uma pessoa que sofre — e é
exatamente isso que a estação clínica precisa treinar: presença, tempo, silêncio,
olhar.

O alvo é a sala: um consultório em 3D, o paciente à frente, os instrumentos ao
alcance, o relógio correndo.

## A decisão mais importante: realista-estilizado, não foto-real

Fotorrealismo de rosto humano, em tempo real, no navegador, com 120 identidades
diferentes, **não é alcançável** nesta infraestrutura. E o mais importante: mesmo
que fosse, seria a escolha errada.

Quanto mais perto do foto-real sem chegar lá, mais forte o **vale da estranheza**.
Num caso de ideação suicida, violência doméstica ou luto, um rosto "quase certo" não
produz imersão — produz desconforto, e o aluno passa a reagir ao artefato em vez de
reagir à pessoa. O alvo é **realista-estilizado**: anatomia e movimento críveis,
sem tentar enganar o olho.

## Pilha

| Peça | Escolha | Observação |
|---|---|---|
| Render | Three.js / WebGL | padrão, roda em navegador e celular |
| Avatar | glTF com blendshapes ARKit (padrão Ready Player Me) | rigging pronto, pipeline de geração parametrizável |
| Lip-sync | **análise do áudio** (WebAudio `AnalyserNode` → visemas) | ver abaixo |

### Por que lip-sync pelo áudio, e não por fonema

As bibliotecas prontas trazem lip-sync para inglês, finlandês e lituano — **não para
português**. E a Realtime API **não emite visemas**. Sobra dirigir os visemas pela
energia por banda do áudio que já está chegando: é agnóstico de idioma, funciona
igual para os 120 casos, e não depende de o provedor de voz cooperar.

Fidelidade menor que viseme por fonema. Em troca, é a única opção que funciona com o
áudio que a conversa em tempo real já produz.

## A sala

- **Câmera em primeira pessoa**, na posição de quem atende: sentado, à frente do
  paciente, altura de olhar.
- **Mobília por categoria**: consultório clínico com maca e instrumentos para
  medicina; sala de escuta com poltronas para psicologia. Mesma sala, outro conteúdo
  — o caso já declara `categoria`.
- **Luz de janela** com sombras suaves. Iluminação é o que faz um ambiente parecer
  um lugar em vez de um cenário.
- **Instrumentos ao alcance**: estetoscópio, esfigmomanômetro, termômetro. Clicar no
  objeto **solicita o exame** — e isso liga direto no `POST /api/consultas/:id/exame`
  que já existe. O 3D não inventa mecânica nova; ele dá corpo à que já está lá.

## O paciente

- **Repouso vivo**: piscar, micro-movimentos de cabeça, respiração. Sem isso o avatar
  "morre" entre as falas e vira manequim — que é pior do que não ter avatar.
- **Postura e expressão de base vindas do caso**: `estado_emocional` já existe em
  todos os 40 casos e descreve como a pessoa está agora.
- **O silêncio pesa**: se o profissional não pergunta nada, o paciente se mexe,
  desvia o olhar, espera. O incômodo do silêncio é parte do que a estação treina.

## Desempenho — onde isto pode dar errado

O 3D disputa CPU e GPU com o áudio da conversa em tempo real. A regra é única e não
se negocia:

> **O áudio vence sempre.** Se o quadro cair, degrada-se o 3D — nunca o áudio.

- Orçamento: 60 fps no desktop, 30 fps no celular.
- **Modo leve automático**: em aparelho fraco ou bateria baixa, cai para o retrato 2D
  sem perguntar. A consulta não pode travar por causa da decoração.
- `prefers-reduced-motion`: a câmera não balança, e o repouso vivo fica mínimo.
- A lista de mensagens **permanece** como caminho completo. O 3D é uma forma de
  atender, não a única — quem usa leitor de tela ou máquina fraca continua treinando.

## O servidor

O 3D roda inteiramente no cliente: o VPS não renderiza nada. O que muda é que ele
precisa servir **assets** (modelos, texturas), e hoje serve uma lista fixa de dois
arquivos.

A regra se mantém, ampliada com cuidado: diretório fixo de assets, **allowlist por
extensão**, caminho resolvido e conferido com `path.resolve` + verificação de
prefixo. Nunca concatenação com o que veio no pedido.

## Conteúdo: 120 aparências

40 casos hoje, 120 com os novos. Desenhar um a um à mão não escala.

**Pipeline:** o JSON do caso ganha parâmetros de aparência (faixa etária, sexo,
biotipo, tom de pele, vestuário coerente com a profissão) e o avatar é **gerado a
partir deles**. A identidade visual passa a ser dado do caso, como o resto já é.

## Riscos assumidos

| Risco | Mitigação |
|---|---|
| Vale da estranheza | alvo declarado é estilizado, não foto-real |
| Peso de banda (glTF de 5–15 MB por avatar) | carregar sob demanda, compartilhar corpo entre casos, comprimir |
| 3D roubar CPU do áudio | modo leve automático; áudio tem prioridade absoluta |
| 120 avatares virarem trabalho manual | aparência é parâmetro no caso, não arte sob medida |

## Relação com os outros projetos

Esta tela **é a mesma** da conversa por voz em tempo real
(`2026-08-04-voz-tempo-real-design.md`). Desenhar as duas separadamente significaria
construir a mesma tela duas vezes: a sala é onde a conversa acontece, e a conversa é
o que dá vida à sala. Implementar juntas.

O pipeline de aparência (120 avatares) tem a mesma natureza do projeto dos 80 casos
clínicos: conteúdo em escala, gerado a partir de parâmetros declarados no caso.
