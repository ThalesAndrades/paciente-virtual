// Como o paciente APARECE na sala em 3D.
//
// O caso descreve o estado emocional em prosa ("chega encolhida, evita o olhar,
// aperta a bolsa no colo"). A sala precisa de números: quanto o corpo se fecha,
// quanto a respiração acelera, para onde o olhar vai. Este módulo faz a tradução —
// no SERVIDOR, de propósito, por dois motivos:
//
//   1. a página recebe seis números e nada de texto do caso, então nada de
//      pedagógico (nem de sensível) vaza para o navegador só para animar um boneco;
//   2. a leitura é determinística e testável — a mesma pessoa chega igual todas as
//      vezes, e é assim que o aluno aprende a reconhecer o quadro.
//
// `estado_emocional` já está no prompt estável (não é informação protegida), então
// olhar para ele aqui não abre porta nenhuma que já não estivesse aberta.

import { normalizar } from "./texto.js";

// Cada dimensão tem os sinais que a acendem. Vocabulário dos casos reais, não
// genérico: os termos saíram dos 46 arquivos de `casos/`.
const SINAIS = {
  tensao: [
    "tensa", "tenso", "tensao", "ansiosa", "ansioso", "ansiedade", "apreensiv",
    "no limite", "rigida", "rigido", "contraida", "contraido", "sobressalto",
    "assustada", "assustado", "alerta", "irritada", "irritado", "impaciente",
    "punhos", "maos suadas", "tremor", "tremendo", "taquicard", "sufoc",
  ],
  tristeza: [
    "triste", "tristeza", "abatida", "abatido", "desanimad", "desesperanc",
    "chora", "chorando", "choro", "lagrimas", "vazio", "apatia", "apatica",
    "cansada de tudo", "sem forcas", "derrotad", "culpa", "luto", "saudade",
  ],
  // Só DOR. Sintoma autonômico (suor, náusea, falta de ar) não é dor — vive na
  // lista de baixo, porque acelera a respiração e a tensão sem encurvar o corpo.
  // Sem essa separação, um caso de fobia social aparecia com a mesma postura de
  // quem está infartando.
  dor: [
    "dor", "doendo", "doi", "queimando", "aperto no peito", "pontada", "colica",
    "ardencia", "latejante", "curvad", "encolhida de dor", "segura o peito",
    "leva a mao ao peito", "protege a barriga",
  ],
  medo: [
    "medo", "pavor", "panico", "aterroriz", "receio", "apavorad", "morrer",
    "morte", "perder o controle", "enlouquecer", "vergonha", "constrang",
    "desconfia", "na defensiva", "olha para a porta",
  ],
  agitacao: [
    "agitada", "agitado", "inquiet", "mexe", "remexe", "balanca a perna",
    "nao para", "anda de um lado", "acelerada", "acelerado", "fala rapido",
    "gesticula", "interrompe", "impulsiv",
  ],
  retraimento: [
    "encolhida", "encolhido", "cabisbaix", "evita o olhar", "evita contato",
    "desvia o olhar", "olhar baixo", "fala baixo", "monossilab", "calada",
    "calado", "retraida", "retraido", "fechada", "fechado", "bracos cruzados",
    "abraca a bolsa", "no colo", "timid", "desconfiada", "desconfiado", "silencio",
  ],
};

// Sintomas do sistema autônomo: puxam a respiração e a tensão, nunca a postura de
// dor. É o que separa "em pânico" de "com dor".
const AUTONOMICOS = [
  "nausea", "enjoo", "vomito", "falta de ar", "dispneia", "sufoc", "ofegante",
  "sudorese", "suando", "suor frio", "palidez", "palid", "taquicard",
  "coracao acelerado", "tontura", "formigamento", "boca seca",
];

// Quanto cada ocorrência acende a dimensão. Duas menções já deixam a dimensão
// visível; quatro a saturam — o corpo tem limite, e caricatura não ensina nada.
const PASSO = 0.28;

function textoDoEstado(caso) {
  const emo = caso.estado_emocional || {};
  const persona = caso.persona || {};
  const estilo = caso.estilo_de_fala || {};
  const hda = caso.historia_doenca_atual || {};

  const partes = [
    emo.agora,
    Array.isArray(emo.manifestacoes) ? emo.manifestacoes.join(" ") : emo.manifestacoes,
    emo.o_que_teme,
    persona.postura_na_consulta,
    Array.isArray(persona.temperamento) ? persona.temperamento.join(" ") : persona.temperamento,
    estilo.registro,
    Array.isArray(estilo.caracteristicas) ? estilo.caracteristicas.join(" ") : estilo.caracteristicas,
    caso.queixa_principal,
    hda.qualidade,
    hda.sintomas_associados,
  ];

  return normalizar(partes.filter(Boolean).map(String).join(" · "));
}

function medir(texto, termos) {
  let acertos = 0;
  for (const termo of termos) {
    if (texto.includes(normalizar(termo))) acertos += 1;
  }
  return Math.min(1, acertos * PASSO);
}

// A dor entra também pela intensidade declarada ("8/10"), que é o dado mais
// confiável quando existe — o texto pode não usar nenhuma das palavras da lista.
function intensidadeDeclarada(caso) {
  const bruto = String((caso.historia_doenca_atual || {}).intensidade || "");
  const casado = bruto.match(/(\d{1,2})\s*(?:\/|de|em)?\s*(?:10)?/);
  if (!casado) return 0;
  const n = Number(casado[1]);
  return Number.isFinite(n) && n > 0 && n <= 10 ? n / 10 : 0;
}

export function expressaoDoCaso(caso) {
  const texto = textoDoEstado(caso || {});
  const dimensoes = {};
  for (const [nome, termos] of Object.entries(SINAIS)) dimensoes[nome] = medir(texto, termos);
  dimensoes.dor = Math.max(dimensoes.dor, intensidadeDeclarada(caso || {}));

  const autonomico = medir(texto, AUTONOMICOS);
  dimensoes.tensao = Math.min(1, dimensoes.tensao + autonomico * 0.4);

  // Postura e olhar são a leitura de conjunto: o corpo faz uma coisa por vez, e é
  // a dimensão dominante que manda. Empate cai em "neutra", que é o repouso vivo.
  const ordenadas = Object.entries(dimensoes).sort((a, b) => b[1] - a[1]);
  const [dominante, forca] = ordenadas[0];
  const POSTURA = {
    tensao: "tensa",
    tristeza: "abatida",
    dor: "protegida",
    medo: "defensiva",
    agitacao: "inquieta",
    retraimento: "encolhida",
  };
  const OLHAR = {
    tensao: "vigilante",
    tristeza: "baixo",
    dor: "baixo",
    medo: "evasivo",
    agitacao: "movel",
    retraimento: "evasivo",
  };

  // Dor forte tem precedência sobre o resto: quem está com dor de infarto protege o
  // peito, mesmo morrendo de medo. O corpo resolve o empate antes da emoção.
  const chave = dimensoes.dor >= 0.6 ? "dor" : dominante;
  const intensidade = dimensoes.dor >= 0.6 ? dimensoes.dor : forca;

  return {
    ...dimensoes,
    postura: intensidade >= 0.3 ? POSTURA[chave] : "neutra",
    olhar: intensidade >= 0.3 ? OLHAR[chave] : "direto",
    // Respiração por minuto: repouso adulto (~14), acelerada por dor, tensão,
    // agitação e pelos sintomas autonômicos — é o que faz o peito de quem está em
    // crise subir e descer diferente do de quem está enlutado.
    respiracao: Math.round(
      14 + dimensoes.dor * 6 + dimensoes.tensao * 5 + dimensoes.agitacao * 3 + autonomico * 5
    ),
  };
}
