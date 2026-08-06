// Estação de habilidades clínicas no formato do Revalida.
//
// A 2ª etapa do Exame Nacional de Revalidação (Edital INEP nº 14/2026) não é uma
// consulta livre: é uma ESTAÇÃO. O participante recebe uma tarefa impressa, tem
// cerca de 10 minutos, encontra um paciente simulado e é avaliado depois, por
// filmagem, contra um PEP — Padrão Esperado de Procedimentos.
//
// O que o edital determina, e que este arquivo implementa:
//
//   · 10 estações, 5 por dia, ~10 minutos cada (item 3.3, 3.6)
//   · cada estação vale de 0 a 10 pontos; 100 no conjunto (item 3.5)
//   · avaliação por ITEM do PEP, na escala INADEQUADO · PARCIALMENTE ADEQUADO ·
//     ADEQUADO, "que não admite pontuação intermediária ou fora de valores
//     pré-determinados" (item 3.7.3)
//   · o peso de cada item é definido previamente, e a soma fecha 10 (item 3.7.4)
//   · a tarefa pode limitar quantidade de exames, hipóteses e condutas, e exigir
//     sequência (item 3.8)
//   · o tempo não é extrapolável (item 3.6.1.1)
//
// A diferença para o checklist por palavra-chave que já existia: lá, dizer a
// palavra pontuava. Aqui, o que pontua é ter FEITO a coisa — e quem julga isso é
// um avaliador com o PEP na mão, exatamente como na prova. O checklist continua
// existindo como piso determinístico, para a nota não depender do modelo estar no ar.

// Áreas da prova, conforme item 3.3.1 do edital.
export const AREAS = {
  clinica_medica: "Clínica Médica",
  cirurgia: "Cirurgia",
  ginecologia_obstetricia: "Ginecologia e Obstetrícia",
  pediatria: "Pediatria",
  medicina_familia: "Medicina da Família e Comunidade",
  saude_coletiva: "Saúde Coletiva",
  saude_mental: "Saúde Mental",
};

export const TEMPO_PADRAO_MINUTOS = 10;
export const NOTA_MAXIMA = 10;

// Fator de cada nível da escala. `parcialmente` vale metade por padrão, mas o
// item pode declarar o próprio — o edital diz explicitamente que os scores
// "podem variar em escala, não havendo pontuação fixa para cada um deles".
const FATOR = { adequado: 1, parcialmente_adequado: 0.5, inadequado: 0 };

export function ehEstacao(rubrica) {
  return Boolean(rubrica && rubrica.revalida && Array.isArray(rubrica.revalida.pep));
}

// O que a página mostra ANTES de o cronômetro começar: é o impresso da estação.
export function tarefaDaEstacao(rubrica) {
  if (!ehEstacao(rubrica)) return null;
  const r = rubrica.revalida;
  return {
    area: r.area || "clinica_medica",
    area_nome: AREAS[r.area] || AREAS.clinica_medica,
    cenario: r.cenario || "",
    tarefa: Array.isArray(r.tarefa) ? r.tarefa : [String(r.tarefa || "")].filter(Boolean),
    limites: r.limites || null,
    tempo_minutos: Number(r.tempo_minutos) || TEMPO_PADRAO_MINUTOS,
    itens_avaliados: r.pep.length,
  };
}

// Soma dos pesos declarados. O PEP precisa fechar 10 — se não fechar, os pesos
// são normalizados, porque uma estação valendo 8,5 ou 11 não é comparável com as
// outras nove da prova.
export function pesosNormalizados(pep) {
  const soma = pep.reduce((total, item) => total + (Number(item.peso) || 0), 0);
  if (soma <= 0) return pep.map(() => NOTA_MAXIMA / Math.max(1, pep.length));
  return pep.map((item) => ((Number(item.peso) || 0) * NOTA_MAXIMA) / soma);
}

// Prompt do avaliador. Ele recebe o PEP e a transcrição e devolve, para cada
// item, um dos três níveis — nada de nota livre, que é justamente o que o
// edital proíbe.
export function montarPromptPEP(rubrica, transcript, fechamento) {
  const r = rubrica.revalida;
  const itens = r.pep
    .map((item, i) => {
      const linhas = [`${i + 1}. [${item.id || `item${i + 1}`}] ${item.descricao}`];
      if (item.adequado) linhas.push(`   ADEQUADO quando: ${item.adequado}`);
      if (item.parcial) linhas.push(`   PARCIALMENTE ADEQUADO quando: ${item.parcial}`);
      if (item.inadequado) linhas.push(`   INADEQUADO quando: ${item.inadequado}`);
      return linhas.join("\n");
    })
    .join("\n");

  const raciocinio = fechamento
    ? [
        "",
        "RACIOCÍNIO REGISTRADO PELO PARTICIPANTE AO FINAL:",
        fechamento.hipotese ? `Hipótese: ${fechamento.hipotese}` : "",
        fechamento.diferenciais ? `Diferenciais: ${fechamento.diferenciais}` : "",
        fechamento.conduta ? `Conduta: ${fechamento.conduta}` : "",
      ]
        .filter(Boolean)
        .join("\n")
    : "";

  return [
    "Você é Médico Avaliador do Exame Nacional de Revalidação de Diplomas Médicos",
    "(Revalida/INEP). Avalie a atuação do participante nesta estação de habilidades",
    "clínicas a partir da transcrição, item a item do Padrão Esperado de Procedimentos.",
    "",
    `ESTAÇÃO: ${rubrica.nome_caso} — ${AREAS[r.area] || "Clínica Médica"}`,
    r.cenario ? `CENÁRIO: ${r.cenario}` : "",
    "",
    "TAREFA QUE FOI DADA AO PARTICIPANTE:",
    (Array.isArray(r.tarefa) ? r.tarefa : [r.tarefa]).map((t) => `- ${t}`).join("\n"),
    "",
    "PADRÃO ESPERADO DE PROCEDIMENTOS (PEP):",
    itens,
    "",
    "TRANSCRIÇÃO DA ESTAÇÃO:",
    transcript,
    raciocinio,
    "",
    "REGRAS DA AVALIAÇÃO — siga à risca:",
    "1. Para CADA item do PEP, atribua exatamente um nível: \"adequado\",",
    "   \"parcialmente_adequado\" ou \"inadequado\". Não existe nota intermediária.",
    "2. Avalie o que foi FEITO, não o que foi dito por acaso. Citar a palavra sem",
    "   executar a ação é inadequado.",
    "3. Item que a transcrição não permite verificar é INADEQUADO — na prova real,",
    "   o que o avaliador não vê na filmagem não pontua.",
    "4. Seja o avaliador do Revalida: exigente, técnico e impessoal. Não invente",
    "   crédito por intenção.",
    "5. O comentário de cada item tem no máximo duas frases, e diz o que faltou.",
    "",
    "Responda SOMENTE com JSON válido, exatamente neste formato:",
    '{"itens":[{"id":"<id do item>","nivel":"adequado|parcialmente_adequado|inadequado","comentario":"<até 2 frases>"}],',
    '"parecer":"<3 a 6 frases: o que sustentou a atuação, o que a comprometeu e o que treinar antes da prova>"}',
  ]
    .filter((linha) => linha !== "")
    .join("\n");
}

// Converte a resposta do avaliador em nota. Item que ele não avaliou conta como
// inadequado: na prova, o que não aparece não pontua.
export function pontuarPEP(rubrica, resposta) {
  const pep = rubrica.revalida.pep;
  const pesos = pesosNormalizados(pep);
  const porId = new Map();
  for (const item of (resposta && resposta.itens) || []) {
    if (item && item.id) porId.set(String(item.id), item);
  }

  let nota = 0;
  const itens = pep.map((item, i) => {
    const id = item.id || `item${i + 1}`;
    const veredito = porId.get(id) || {};
    const nivel = FATOR[veredito.nivel] !== undefined ? veredito.nivel : "inadequado";
    const fator = item.fator_parcial !== undefined && nivel === "parcialmente_adequado"
      ? Number(item.fator_parcial)
      : FATOR[nivel];
    const pontos = pesos[i] * fator;
    nota += pontos;
    return {
      id,
      descricao: item.descricao,
      // O que a banca esperava. Sem isto o aluno lê "inadequado" e fica sem saber
      // o que deveria ter feito — nota sem gabarito não é estudo, é castigo.
      esperado: item.adequado || "",
      peso: Number(pesos[i].toFixed(2)),
      nivel,
      pontos: Number(pontos.toFixed(2)),
      comentario: String(veredito.comentario || "").slice(0, 300),
    };
  });

  return {
    area: rubrica.revalida.area || "clinica_medica",
    area_nome: AREAS[rubrica.revalida.area] || AREAS.clinica_medica,
    nota: Number(Math.min(NOTA_MAXIMA, nota).toFixed(2)),
    nota_maxima: NOTA_MAXIMA,
    itens,
    parecer: String((resposta && resposta.parecer) || "").slice(0, 2000),
  };
}

// Extrai o JSON da resposta do modelo. Modelos gostam de embrulhar em ```json e
// de escrever uma frase antes — nada disso pode derrubar a avaliação.
export function lerVeredito(bruto) {
  const texto = String(bruto || "").trim();
  const semCerca = texto.replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  const inicio = semCerca.indexOf("{");
  const fim = semCerca.lastIndexOf("}");
  if (inicio < 0 || fim <= inicio) return null;
  try {
    return JSON.parse(semCerca.slice(inicio, fim + 1));
  } catch {
    return null;
  }
}

// Nota da estação sem modelo de linguagem: o piso determinístico. Usa o checklist
// por palavra-chave que já existia e o converte para a escala de 10 da estação.
// Não substitui o PEP — diz, honestamente, que é uma estimativa.
export function notaDePiso(checklist) {
  if (!checklist || typeof checklist.nota_total !== "number") return null;
  return {
    nota: Number(checklist.nota_total.toFixed(2)),
    nota_maxima: NOTA_MAXIMA,
    origem: "checklist",
    aviso:
      "Nota estimada pelo checklist objetivo — o avaliador do PEP está indisponível. " +
      "Na prova real, quem pontua é o Padrão Esperado de Procedimentos.",
  };
}
