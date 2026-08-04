// Porta fiel de paciente_virtual/avaliador.py — avaliação objetiva e prompt do parecer.

import { contemAlgumTermo } from "./texto.js";

export const PREFIXOS_PROFISSIONAL = ["PROFISSIONAL:", "EXAME FÍSICO:", "EXAME SOLICITADO:"];

export function extrairTextoProfissional(texto) {
  return texto
    .split("\n")
    .filter((linha) => PREFIXOS_PROFISSIONAL.some((prefixo) => linha.trim().startsWith(prefixo)))
    .join("\n");
}

export function termosDoItem(item) {
  if (typeof item === "string") return [item, [item]];
  return [item.nome, item.termos && item.termos.length ? item.termos : [item.nome]];
}

// Teto de itens que UM turno do profissional pode marcar.
//
// Sem teto, a nota é gamificável numa mensagem só: despejar todos os termos da
// rubrica numa frase dava 10/10. Uma pergunta real cobre um ou dois pontos ("o
// senhor fuma? bebe?"), então o teto não atrapalha quem entrevista de verdade —
// só impede o despejo. Continua sendo pontuação por palavra-chave: quem confere
// o SENTIDO das perguntas é o parecer pedagógico da IA.
export const MAX_ITENS_POR_TURNO = 3;

// Cada linha do texto do profissional é um turno (uma fala enviada, um exame
// realizado). extrairTextoProfissional já entrega uma linha por turno.
function turnosDe(textoProfissional) {
  return String(textoProfissional || "")
    .split("\n")
    .map((linha) => linha.trim())
    .filter(Boolean);
}

export function pontuarChecklist(rubrica, textoProfissional) {
  // Achata a rubrica em alvos e resolve turno a turno, respeitando o teto.
  const alvos = [];
  for (const [ci, criterio] of (rubrica.criterios || []).entries()) {
    for (const item of criterio.itens || []) {
      const [nome, termos] = termosDoItem(item);
      alvos.push({ ci, nome, termos, atendido: false });
    }
  }

  for (const turno of turnosDe(textoProfissional)) {
    let restante = MAX_ITENS_POR_TURNO;
    for (const alvo of alvos) {
      if (restante <= 0) break;
      if (alvo.atendido) continue;
      if (contemAlgumTermo(turno, alvo.termos)) {
        alvo.atendido = true;
        restante -= 1;
      }
    }
  }

  const criterios = [];
  let notaTotal = 0;

  for (const [ci, criterio] of (rubrica.criterios || []).entries()) {
    const doCriterio = alvos.filter((alvo) => alvo.ci === ci);
    const valorItem = doCriterio.length ? criterio.peso / doCriterio.length : 0;
    const notaBloco = doCriterio.reduce((soma, alvo) => soma + (alvo.atendido ? valorItem : 0), 0);

    notaTotal += notaBloco;
    criterios.push({
      nome: criterio.nome,
      objetivo: criterio.objetivo,
      peso: criterio.peso,
      nota: notaBloco,
      itens: doCriterio.map((alvo) => ({ nome: alvo.nome, atendido: alvo.atendido })),
    });
  }

  return { criterios, nota_total: notaTotal };
}

export function montarPromptAvaliacao(rubrica, texto) {
  return `
Você é um professor experiente da área da saúde.

Analise o histórico da consulta e os critérios da rubrica.

RÚBRICA:

${JSON.stringify(rubrica, null, 2)}

HISTÓRICO DA CONSULTA:

${texto}

Para cada critério da rubrica:

* Informe se foi ATENDIDO, PARCIALMENTE ATENDIDO ou NÃO ATENDIDO.
* Justifique utilizando exemplos do histórico.
* Considere o significado das perguntas realizadas e não apenas palavras exatas.

Após analisar todos os critérios:

1. Atribua uma nota geral de 0 a 10.
2. Liste pontos fortes.
3. Liste pontos a desenvolver.
4. Produza recomendações para futuras entrevistas.
5. Produza um feedback pedagógico detalhado.

Organize a resposta em:

CRITÉRIO
STATUS
JUSTIFICATIVA

NOTA FINAL

PONTOS FORTES

PONTOS A DESENVOLVER

RECOMENDAÇÕES

FEEDBACK PEDAGÓGICO
`;
}
