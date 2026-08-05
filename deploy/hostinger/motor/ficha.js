// O portão clínico como FERRAMENTA do modelo em tempo real.
//
// Na conversa por texto o servidor lê a pergunta do aluno, decide o que pode ser
// revelado e só então chama o modelo. Na conversa por voz o áudio vai direto do
// navegador ao provedor — o servidor não vê a pergunta. Se o caso inteiro fosse
// para as instruções da sessão, a revelação gradual deixaria de ser garantia e
// viraria pedido ao modelo.
//
// Então o modelo NÃO recebe o que é sensível. Ele recebe a obrigação de perguntar:
// quando o profissional toca num assunto delicado, o modelo chama `consultar_ficha`,
// e quem decide continua sendo este arquivo, no servidor, com o mesmo matcher
// determinístico do caminho por texto (`demo.js#fatoSensivelDireto`).
//
// A resposta sai em duas metades, e a separação é o ponto:
//   - `modelo` — o que o navegador devolve ao provedor. Nunca contém resultado de
//     exame: o paciente sente o procedimento acontecer, mas não sabe ler o laudo.
//   - `tela`  — o que o navegador mostra ao aluno (o resultado do exame). Não passa
//     pelo modelo, exatamente como no caminho por texto.

import { fatoSensivelDireto } from "./demo.js";
import { detectarExames } from "./exames.js";

// Teto do que entra na ficha por chamada. A pergunta chega parafraseada pelo
// modelo; o teto existe para um argumento abusivo não virar transcript gigante.
const MAX_PERGUNTA = 500;

const NEGATIVA =
  "Não há nada sobre isso na sua ficha. Responda só com o que você já sabe da sua " +
  "própria vida, no seu jeito — e NUNCA invente sintoma, exame, remédio ou fato.";

const LIBERADO =
  "Você PODE contar isto agora — com hesitação, aos poucos, no seu jeito, sem " +
  "despejar tudo de uma vez:";

const SENTIU =
  "O profissional acabou de fazer isto em você, agora. Você sentiu o procedimento " +
  "acontecer e pode reagir a ele (incômodo, medo, alívio, uma pergunta tímida), mas " +
  "você NÃO sabe interpretar o resultado e NUNCA diz números, laudo ou nome de doença:";

// Consulta a ficha e CARIMBA a passagem no transcript.
//
// O carimbo é o que sustenta a nota quando a transcrição é declarada pelo cliente:
// a linha `PERGUNTA VERIFICADA:` é prova, gerada no servidor, de que o aluno tocou
// aquele tema — e `avaliador.js` a pontua junto das falas normais.
export function consultarFicha(consulta, perguntaBruta) {
  const pergunta = String(perguntaBruta || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_PERGUNTA);

  if (!pergunta) {
    return { modelo: { revelar: null, instrucao: NEGATIVA, procedimentos: [] }, tela: [] };
  }

  const fato = fatoSensivelDireto(consulta.caso, pergunta);
  const exames = detectarExames(pergunta, consulta.caso);

  consulta.transcript += `\nPERGUNTA VERIFICADA: ${pergunta}\n`;
  consulta.perguntas += 1;

  const tela = [];
  for (const [titulo, dados] of exames) {
    consulta.transcript += `\n${titulo}: ${dados.nome}\nRESULTADO: ${dados.resultado}\n`;
    consulta.exames += 1;
    tela.push({ tipo: "exame", titulo, nome: dados.nome, resultado: dados.resultado });
  }

  const instrucoes = [fato ? `${LIBERADO} ${fato}` : NEGATIVA];
  if (exames.length) {
    instrucoes.push(`${SENTIU} ${exames.map(([, dados]) => dados.nome).join(", ")}.`);
  }

  return {
    modelo: {
      revelar: fato || null,
      instrucao: instrucoes.join(" "),
      procedimentos: exames.map(([, dados]) => dados.nome),
    },
    tela,
  };
}
