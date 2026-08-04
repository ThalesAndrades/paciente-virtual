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

// O fechamento é o raciocínio que o aluno assumiu ANTES de ver a resposta. Sem ele
// a avaliação julga só a coleta de dados; com ele julga também a conclusão — que é
// o que a consulta existe para treinar.
function blocoFechamento(fechamento) {
  if (!fechamento) return "";
  const linhas = [
    fechamento.hipotese && `Hipótese diagnóstica principal: ${fechamento.hipotese}`,
    fechamento.diferenciais && `Diagnósticos diferenciais considerados: ${fechamento.diferenciais}`,
    fechamento.conduta && `Conduta proposta: ${fechamento.conduta}`,
  ].filter(Boolean);
  if (!linhas.length) return "";
  return `
CONCLUSÃO DO ALUNO (escrita ANTES de ver o gabarito):

${linhas.join("\n")}
`;
}

function blocoGabarito(gabarito) {
  if (!gabarito || !gabarito.diagnostico) return "";
  const dif = Array.isArray(gabarito.diferenciais) ? gabarito.diferenciais.join("\n- ") : "";
  return `
GABARITO DO CASO (uso do professor — NÃO é o que o aluno escreveu):

Diagnóstico do caso: ${gabarito.diagnostico}
${dif ? `Diferenciais que o caso espera que sejam considerados:\n- ${dif}` : ""}
`;
}

export function montarPromptAvaliacao(rubrica, texto, fechamento, gabarito) {
  const extra = blocoFechamento(fechamento);
  const gab = blocoGabarito(gabarito);
  const tarefaConclusao = extra
    ? `
Sobre a CONCLUSÃO DO ALUNO, além dos critérios:

* Compare a hipótese dele com o diagnóstico do caso e diga se está CORRETA,
  PARCIALMENTE CORRETA ou INCORRETA — e por quê, com base no que ele coletou.
* Avalie se os diferenciais que ele listou fazem sentido para os achados da consulta,
  e aponte qual diferencial importante ele deixou de fora.
* Diga se a conduta proposta é adequada e segura para esse quadro.
* Se ele chegou à hipótese certa SEM ter investigado o que a sustenta, diga isso
  explicitamente — acertar por sorte não é raciocínio clínico.
`
    : "";

  return `
Você é um professor experiente da área da saúde.

Analise o histórico da consulta e os critérios da rubrica.${extra}${gab}${tarefaConclusao}

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
${extra ? "\nRACIOCÍNIO CLÍNICO (a conclusão do aluno)\n" : ""}
PONTOS FORTES

PONTOS A DESENVOLVER

RECOMENDAÇÕES

FEEDBACK PEDAGÓGICO
`;
}
