// Detecção de solicitações de exame.
//
// Um achado só é entregue quando o profissional REALIZA ou SOLICITA o exame agora —
// perguntar da história ("qual a sua pressão normalmente em casa?") é anamnese, não
// aferição, e não pode entregar o valor medido nem contar ponto na rubrica.
//
// Por isso há dois níveis de marcador:
//   AÇÃO   — verbo de procedimento ("vou aferir", "solicito", "aplicar"). Dispara sempre.
//   CONSULTA — pergunta pelo valor ("qual", "como está"). Dispara só se a frase NÃO
//              estiver falando do passado/do hábito ("normalmente", "em casa", "já").

import { contemAlgumTermo, normalizar } from "./texto.js";

export const TITULO_EXAME_FISICO = "EXAME FÍSICO";
export const TITULO_EXAME_SOLICITADO = "EXAME SOLICITADO";

// Sinais vitais / medidas rápidas — separados dos demais achados do exame físico.
// Vive aqui (e não no servidor) porque tanto a UI quanto o pedido em bloco
// ("vou verificar os sinais vitais") precisam da mesma lista.
export const CHAVES_VITAIS = new Set([
  "pressao_arterial",
  "frequencia_cardiaca",
  "frequencia_respiratoria",
  "temperatura",
  "saturacao",
  "glicemia_capilar",
  "glicemia",
  "escala_dor",
  "dor",
  "peso",
]);

// Radicais de verbos de procedimento: casam qualquer flexão com \b<radical>\w*.
const ACAO_RADICAL = [
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
  "palp",
  "percut",
  "inspecion",
];

// Verbos/expressões de procedimento sem radical comum.
const ACAO_EXATA = [
  "medir",
  "meça",
  "meço",
  "mede",
  "medindo",
  "tirar",
  "tire",
  "pedir",
  "peço",
  "faça",
  "fazer",
  "faz",
  "quero",
  "gostaria",
  "preciso",
  "vamos ver",
  "deixa eu ver",
  "deixe-me ver",
  "exame físico",
];

// Perguntas pelo valor: só valem como solicitação no aqui-e-agora.
const CONSULTA_EXATA = ["qual", "quais", "quanto", "quanta", "como está", "como estão", "ver", "olhar", "olhe"];

// Marcadores de história/hábito. Se aparecerem, uma pergunta do tipo CONSULTA é
// anamnese ("qual sua pressão normalmente?") e não entrega o valor aferido.
const HISTORIA = [
  "normalmente",
  "geralmente",
  "habitualmente",
  "em geral",
  "de costume",
  "costuma",
  "costumava",
  "em casa",
  "já",
  "ja",
  "alguma vez",
  "antes",
  "no passado",
  "outro dia",
  "última vez",
  "ultima vez",
  "toda vez",
  "sempre",
  "anteriormente",
  "recentemente",
];

// Termos que pedem o conjunto de sinais vitais de uma vez.
const TERMOS_VITAIS = ["sinais vitais", "sinais", "vitais", "dados vitais"];

function escaparRegex(texto) {
  return texto.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function padraoDe(radicais, exatos) {
  return new RegExp(
    [
      ...radicais.map((radical) => `\\b${radical}\\w*`),
      ...exatos.map((palavra) => `\\b${escaparRegex(normalizar(palavra))}\\b`),
    ].join("|")
  );
}

const PADRAO_ACAO = padraoDe(ACAO_RADICAL, ACAO_EXATA);
const PADRAO_CONSULTA = padraoDe([], CONSULTA_EXATA);
const PADRAO_HISTORIA = padraoDe([], HISTORIA);

// True quando a frase pede um procedimento AGORA (e não conta a história dele).
export function haSolicitacao(texto) {
  const t = normalizar(texto);
  if (PADRAO_ACAO.test(t)) return true;
  return PADRAO_CONSULTA.test(t) && !PADRAO_HISTORIA.test(t);
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

// "Vou verificar os sinais vitais" pede o bloco inteiro — sem isto o pedido mais
// natural da beira do leito não entregava nada.
function detectarVitais(texto, exameFisico) {
  if (!exameFisico || !haSolicitacao(texto)) return [];
  if (!contemAlgumTermo(texto, TERMOS_VITAIS)) return [];
  return Object.entries(exameFisico)
    .filter(([chave, dados]) => CHAVES_VITAIS.has(chave) && dados && typeof dados === "object")
    .map(([, dados]) => dados);
}

// Retorna pares [titulo, dados] — complementares primeiro, exame físico depois.
export function detectarExames(texto, caso) {
  const fisico = [...detectarVitais(texto, caso.exame_fisico), ...detectar(texto, caso.exame_fisico)];
  // Um pedido pode casar duas vezes (bloco de vitais + nome do sinal): mantém a
  // primeira ocorrência para não repetir o mesmo achado na tela e no transcript.
  const vistos = new Set();
  const fisicoUnico = fisico.filter((dados) => {
    const chave = dados.nome || JSON.stringify(dados);
    if (vistos.has(chave)) return false;
    vistos.add(chave);
    return true;
  });

  return [
    ...detectar(texto, caso.exames_disponiveis).map((dados) => [TITULO_EXAME_SOLICITADO, dados]),
    ...fisicoUnico.map((dados) => [TITULO_EXAME_FISICO, dados]),
  ];
}
