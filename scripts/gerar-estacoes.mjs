// Converte as rubricas de medicina em ESTAÇÕES no formato do Revalida.
//
// O acervo médico nasceu como checklist de anamnese por palavra-chave. A prova de
// habilidades clínicas avalia outra coisa: itens do Padrão Esperado de
// Procedimentos, na escala inadequado · parcialmente adequado · adequado, com os
// pesos fechando 10 pontos por estação.
//
// Este script escreve o bloco `revalida` em cada rubrica, derivando o PEP dos
// critérios que já existiam — o trabalho clínico feito ali não se perde, muda de
// forma. Os pesos seguem a proporção original, normalizada para 10.
//
//   node scripts/gerar-estacoes.mjs          # escreve
//   node scripts/gerar-estacoes.mjs --ver    # só mostra o que faria
//
// Roda de novo sem medo: rubrica que já tem `revalida` é preservada, para não
// atropelar estação escrita à mão.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const somenteVer = process.argv.includes("--ver");

// Área de cada caso na divisão do edital (item 3.3.1). O que é abdome agudo
// cirúrgico e litíase vai para Cirurgia; o resto do acervo atual é Clínica Médica,
// com a lombalgia em Medicina da Família, que é onde ela de fato aparece.
const AREA = {
  apendicite: "cirurgia",
  colica_biliar: "cirurgia",
  pancreatite: "cirurgia",
  colica_renal: "cirurgia",
  ulcera_peptica: "cirurgia",
  lombalgia: "medicina_familia",
};

// Os critérios de anamnese viram itens de PEP com redação de prova. A chave é o
// começo do nome do critério na rubrica.
const REDACAO = [
  [/identifica/i, "Identifica-se ao paciente e confirma a identificação dele antes de iniciar", {
    adequado: "Apresenta-se pelo nome, diz que é o(a) médico(a) e confirma nome e idade do paciente.",
    parcial: "Apresenta-se OU confirma a identificação, mas não os dois.",
    inadequado: "Inicia a anamnese sem se apresentar nem confirmar quem é o paciente.",
  }],
  [/queixa|hda|hist[óo]ria da doen/i, "Caracteriza a queixa principal e a história da doença atual", {
    adequado: "Investiga início, localização, irradiação, intensidade, fatores de melhora e piora e sintomas associados.",
    parcial: "Caracteriza a queixa de forma incompleta, deixando de fora atributos que mudam a conduta.",
    inadequado: "Não caracteriza a queixa ou apenas a registra sem investigar.",
  }],
  [/antecedente|patol[óo]gic|pessoa/i, "Investiga antecedentes pessoais, medicamentos em uso e alergias", {
    adequado: "Pergunta sobre doenças prévias, medicações em uso e alergias.",
    parcial: "Investiga parte dos antecedentes, deixando de fora medicações ou alergias.",
    inadequado: "Não investiga antecedentes.",
  }],
  [/familiar/i, "Investiga antecedentes familiares relevantes para a hipótese", {
    adequado: "Pergunta por doenças familiares que mudam o risco no caso em questão.",
    inadequado: "Não investiga antecedentes familiares.",
  }],
  [/h[áa]bito|social|vida/i, "Investiga hábitos de vida e fatores de risco", {
    adequado: "Pergunta sobre tabagismo, álcool, atividade física e outros fatores pertinentes ao caso.",
    parcial: "Investiga apenas um dos hábitos relevantes.",
    inadequado: "Não investiga hábitos nem fatores de risco.",
  }],
  [/exame f[íi]sico|vitais|f[íi]sic/i, "Realiza o exame físico dirigido, incluindo sinais vitais", {
    adequado: "Solicita sinais vitais e as manobras dirigidas à hipótese, e interpreta o que encontra.",
    parcial: "Realiza parte do exame necessário ou não interpreta os achados.",
    inadequado: "Não examina o paciente ou pede exame não pertinente ao caso.",
  }],
  [/exame complementar|complementar|solicita/i, "Solicita os exames complementares pertinentes e justificados", {
    adequado: "Solicita os exames que mudam a conduta neste caso, sem excesso.",
    parcial: "Solicita alguns dos exames necessários, ou acrescenta exames irrelevantes.",
    inadequado: "Não solicita exame ou solicita bateria sem relação com a hipótese.",
  }],
  [/diagn[óo]stic|hip[óo]tese/i, "Formula a hipótese diagnóstica principal", {
    adequado: "Enuncia a hipótese correta, compatível com o quadro apresentado.",
    parcial: "Enuncia hipótese plausível, porém imprecisa ou incompleta.",
    inadequado: "Não enuncia hipótese ou enuncia hipótese incompatível com o quadro.",
  }],
  [/diferencia/i, "Considera os diagnósticos diferenciais pertinentes", {
    adequado: "Levanta diferenciais que mudam a conduta e explica como os afasta.",
    parcial: "Cita diferenciais sem relacioná-los ao caso.",
    inadequado: "Não considera diferenciais.",
  }],
  [/conduta|tratamento|manejo|terap/i, "Define a conduta imediata adequada ao caso", {
    adequado: "Indica a conduta correta, na ordem de prioridade que o quadro exige.",
    parcial: "Indica conduta parcialmente correta ou fora da prioridade.",
    inadequado: "Não define conduta ou define conduta inadequada ao quadro.",
  }],
  [/comunica|orienta|acolh|v[íi]nculo|rela[çc]/i, "Comunica-se com o paciente em linguagem acessível e acolhedora", {
    adequado: "Explica o que está acontecendo sem jargão, checa entendimento e acolhe a preocupação do paciente.",
    parcial: "Comunica-se de forma técnica demais ou não confirma o entendimento.",
    inadequado: "Não explica nada ao paciente ou o trata com indiferença.",
  }],
];

function redacaoDe(nomeCriterio) {
  for (const [padrao, descricao, criterios] of REDACAO) {
    if (padrao.test(nomeCriterio)) return { descricao, ...criterios };
  }
  return {
    descricao: nomeCriterio.charAt(0).toUpperCase() + nomeCriterio.slice(1),
    adequado: "Contempla integralmente o que o item exige.",
    parcial: "Contempla parcialmente o que o item exige.",
    inadequado: "Não contempla o que o item exige.",
  };
}

function identificador(nome, usados) {
  const base = nome
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "")
    .slice(0, 28) || "item";
  let id = base;
  let n = 2;
  while (usados.has(id)) id = `${base}_${n++}`;
  usados.add(id);
  return id;
}

function tarefaPadrao(caso, area) {
  const ident = caso.identificacao || {};
  const idade = ident.idade ? `${ident.idade} anos` : "";
  const quem = `${ident.sexo === "Feminino" ? "paciente do sexo feminino" : "paciente do sexo masculino"}${idade ? `, ${idade}` : ""}`;
  const local = area === "medicina_familia"
    ? "em uma Unidade Básica de Saúde"
    : area === "cirurgia"
      ? "no pronto-socorro de um hospital geral"
      : "na unidade de emergência de um hospital";

  return [
    `Você é o(a) médico(a) de plantão ${local} e vai atender um(a) ${quem}.`,
    "Realize a anamnese dirigida e o exame físico pertinente ao caso.",
    "Solicite os exames complementares que julgar necessários — eles serão fornecidos pelo Chefe de Estação.",
    "Ao final, informe ao paciente a sua hipótese diagnóstica e a conduta, em linguagem acessível.",
    "Registre hipótese, diferenciais e conduta no fechamento da estação.",
  ];
}

let escritas = 0;
let preservadas = 0;
const relatorio = [];

for (const arquivo of fs.readdirSync(path.join(RAIZ, "avaliacoes")).sort()) {
  if (!arquivo.endsWith(".json")) continue;
  const id = arquivo.replace(/\.json$/, "");
  const caminhoCaso = path.join(RAIZ, "casos", arquivo);
  if (!fs.existsSync(caminhoCaso)) continue;

  const caso = JSON.parse(fs.readFileSync(caminhoCaso, "utf-8"));
  if (caso.categoria !== "medicina") continue;

  const caminhoRubrica = path.join(RAIZ, "avaliacoes", arquivo);
  const rubrica = JSON.parse(fs.readFileSync(caminhoRubrica, "utf-8"));

  if (rubrica.revalida) {
    preservadas += 1;
    relatorio.push(`  = ${id} (já tinha estação, preservada)`);
    continue;
  }

  const area = AREA[id] || "clinica_medica";
  const criterios = rubrica.criterios || [];
  const usados = new Set();
  const somaPesos = criterios.reduce((t, c) => t + (Number(c.peso) || 1), 0) || 1;

  const pep = criterios.map((criterio) => {
    const texto = redacaoDe(criterio.nome || "");
    const peso = Number((((Number(criterio.peso) || 1) * 10) / somaPesos).toFixed(2));
    return {
      id: identificador(criterio.nome || "item", usados),
      descricao: texto.descricao,
      peso,
      adequado: texto.adequado,
      ...(texto.parcial ? { parcial: texto.parcial } : {}),
      inadequado: texto.inadequado,
    };
  });

  // O cenário NUNCA cita o diagnóstico nem o título do caso. Na prova, o impresso
  // da estação diz onde você está e quem chegou — descobrir o que a pessoa tem é
  // a tarefa. Um teste crava isso para os 20 casos: já vazou uma vez, na primeira
  // versão deste script, e só não foi para produção porque o teste existia.
  const ident = caso.identificacao || {};
  const cenario = [
    area === "medicina_familia"
      ? "Unidade Básica de Saúde, atendimento de demanda espontânea."
      : area === "cirurgia"
        ? "Pronto-socorro de hospital geral."
        : "Unidade de emergência de hospital geral.",
    `Paciente do sexo ${String(ident.sexo || "").toLowerCase() || "não informado"}${ident.idade ? `, ${ident.idade} anos` : ""}, procura atendimento.`,
  ].join(" ");

  rubrica.revalida = {
    area,
    cenario,
    tempo_minutos: 10,
    tarefa: tarefaPadrao(caso, area),
    limites: { exames: 4, hipoteses: 1, condutas: 3 },
    pep,
  };

  if (!somenteVer) {
    fs.writeFileSync(caminhoRubrica, `${JSON.stringify(rubrica, null, 2)}\n`, "utf-8");
  }
  escritas += 1;
  const soma = pep.reduce((t, i) => t + i.peso, 0);
  relatorio.push(`  ${somenteVer ? "?" : "+"} ${id.padEnd(24)} ${area.padEnd(22)} ${pep.length} itens, soma ${soma.toFixed(2)}`);
}

console.log(relatorio.join("\n"));
console.log(`\n${escritas} estação(ões) ${somenteVer ? "seriam escritas" : "escritas"}, ${preservadas} preservada(s).`);
