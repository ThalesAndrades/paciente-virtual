// Porta fiel de paciente_virtual/exames.py — detecção de solicitações de exame.

import { contemAlgumTermo, normalizar } from "./texto.js";

export const TITULO_EXAME_FISICO = "EXAME FÍSICO";
export const TITULO_EXAME_SOLICITADO = "EXAME SOLICITADO";

// Radicais de verbos de solicitação: casam qualquer flexão com \b<radical>\w*.
const MARCADORES_RADICAL = [
  "afer",
  "verific",
  "chec",
  "avali",
  "examin",
  "auscult",
  "escut",
  "confer",
  "solicit",
  "realiz",
  "aplic",
  "observ",
];

// Palavras e expressões exatas (com limite de palavra, acentos ignorados).
const MARCADORES_EXATOS = [
  "medir",
  "meça",
  "meço",
  "mede",
  "medindo",
  "tirar",
  "tire",
  "olhar",
  "olhe",
  "ver",
  "pedir",
  "peço",
  "faz",
  "faça",
  "fazer",
  "quero",
  "gostaria",
  "preciso",
  "qual",
  "quais",
  "quanto",
  "quanta",
  "como está",
  "como estão",
  "exame físico",
];

function escaparRegex(texto) {
  return texto.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const PADRAO_SOLICITACAO = new RegExp(
  [
    ...MARCADORES_RADICAL.map((radical) => `\\b${radical}\\w*`),
    ...MARCADORES_EXATOS.map((palavra) => `\\b${escaparRegex(normalizar(palavra))}\\b`),
  ].join("|")
);

function haSolicitacao(texto) {
  return PADRAO_SOLICITACAO.test(normalizar(texto));
}

function termosDoExame(chave, dados) {
  return [chave, dados.nome || "", ...(dados.sinonimos || [])].filter(Boolean);
}

function detectar(texto, exames) {
  if (!exames || !haSolicitacao(texto)) return [];
  return Object.entries(exames)
    .filter(([chave, dados]) => contemAlgumTermo(texto, termosDoExame(chave, dados)))
    .map(([, dados]) => dados);
}

// Retorna pares [titulo, dados] — complementares primeiro, exame físico depois.
export function detectarExames(texto, caso) {
  return [
    ...detectar(texto, caso.exames_disponiveis).map((dados) => [TITULO_EXAME_SOLICITADO, dados]),
    ...detectar(texto, caso.exame_fisico).map((dados) => [TITULO_EXAME_FISICO, dados]),
  ];
}

export function contextoParaPaciente(examesEntregues) {
  const itens = examesEntregues.map((dados) => `${dados.nome}: ${dados.resultado}`).join("; ");
  return (
    `O profissional acabou de realizar/solicitar: ${itens}. ` +
    "Você, como paciente, sabe que esses procedimentos aconteceram agora " +
    "e pode comentá-los se perguntado."
  );
}
