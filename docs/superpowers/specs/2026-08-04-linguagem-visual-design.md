# Linguagem visual (D1)

**Data:** 2026-08-04 · **Status:** design aprovado

## O ponto de partida, medido

O design system **já existe e é competente**: 32 tokens CSS (incluindo `--sombra`,
`--sombra-forte`, `--raio`, cores por categoria med/psi e por severidade), 426 linhas
de CSS, `color-mix()`, tema escuro e um focus ring de 4px. Isto **não é um redesign
do zero** — é uma elevação.

## Por que D1 vem antes do login

O login cria tela de entrada e aba de alunos; o tempo real cria a interface de
conversa ao vivo. Se a linguagem visual vier por último, essas telas são construídas
duas vezes. D1 é só a linguagem e o encanamento: **não muda nenhuma tela existente**.

## O pré-requisito descoberto

O servidor **não serve arquivo estático nenhum** — lê apenas `web/index.html`. Não há
rota para `.css` nem `.js`. Extrair o CSS exige criar essa rota, e o projeto de voz em
tempo real já precisava dela para `web/tempo-real.js`. Ela pertence a D1.

**Forma:** allowlist de arquivos conhecidos, nunca um caminho montado a partir do
pedido. O repositório já barra path traversal no relatório; o mesmo padrão vale aqui.

## O que entra

### 1. Elevação com significado

Hoje há dois níveis de sombra sem regra de quando usar cada um. Passa a haver três,
com propósito semântico:

| Nível | Uso |
|---|---|
| repouso | card na grade, superfície em descanso |
| levantado | hover e foco — o elemento respondeu |
| sobreposto | modal e drawer — está acima de tudo |

A sombra passa a comunicar hierarquia, e não a ser decoração.

### 2. Movimento

Durações `--rapido: 150ms`, `--normal: 220ms`, `--lento: 320ms`, com três curvas
(entrada suave, saída rápida, padrão). Saída mais rápida que entrada: o elemento
some sem fazer o usuário esperar, e aparece sem sobressalto.

### 3. Tipografia

Escala com hierarquia explícita, em vez de tamanhos escolhidos caso a caso.

### 4. Primitivas

Card, botão (primário, secundário, perigo), campo e modal — cada um com os cinco
estados: repouso, hover, foco, ativo, desabilitado. O focus ring de 4px que já existe
vira regra única.

## O princípio: deferência, não exuberância

O pedido foi "cards sombreados, efeitos responsivos e interativos". O princípio real
da Apple é **deferência**: a interface recua para o conteúdo liderar. Este é um
simulador clínico cronometrado — vidro fosco atrás de texto corrido e movimento
exuberante prejudicam contraste e distraem quem está sendo avaliado.

**Não entra:**

- vidro fosco (blur) atrás de texto corrido;
- animação em elemento que o aluno precisa ler sob cronômetro.

`prefers-reduced-motion` desliga `transform` e mantém só opacidade. Não é preferência
de estilo: o aplicativo tem casos de pânico e trauma, e interface saltitante ali é
ativamente ruim. Acessibilidade em primeiro lugar é HIG de verdade.

## Verificação

- Contraste AA nos dois temas.
- Alvo de toque ≥ 44px (a v4 já havia acertado; não pode regredir).
- `prefers-reduced-motion` honrado.
- Sem regressão em mobile e safe-areas.
- A suíte de testes continua verde.

## Fora de escopo

Aplicar a linguagem nas telas existentes (home, grade de casos, consulta, resultado)
é **D2**, depois do login e do tempo real.
