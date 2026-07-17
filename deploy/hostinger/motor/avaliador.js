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

export function pontuarChecklist(rubrica, textoProfissional) {
  const criterios = [];
  let notaTotal = 0;

  for (const criterio of rubrica.criterios) {
    const itens = criterio.itens || [];
    const itensAvaliados = [];
    let notaBloco = 0;

    if (itens.length) {
      const valorItem = criterio.peso / itens.length;
      for (const item of itens) {
        const [nome, termos] = termosDoItem(item);
        const atendido = contemAlgumTermo(textoProfissional, termos);
        if (atendido) notaBloco += valorItem;
        itensAvaliados.push({ nome, atendido });
      }
    }

    notaTotal += notaBloco;
    criterios.push({
      nome: criterio.nome,
      objetivo: criterio.objetivo,
      peso: criterio.peso,
      nota: notaBloco,
      itens: itensAvaliados,
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
