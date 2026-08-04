// A IA responde COMO o paciente, a partir de um contexto de sistema ESTÁVEL por caso.
//
// A MATRIZ é o contexto de vida: biografia, rotina, trabalho, família, estressores e
// rede de apoio. Tudo o que o paciente diz nasce dali — o jeito de falar, o que ele
// teme, o quanto se abre e como reage ao profissional. Os dados clínicos são só uma
// camada dessa vida, não o personagem inteiro. É isso que faz "dor no peito" virar a
// dor no peito DAQUELA pessoa, com a casa, o trabalho e o medo dela.
//
// O prompt é o mesmo em todos os turnos do caso → o provedor cacheia o prefixo →
// respostas mais rápidas e baratas. Nada que varie por turno entra aqui.
//
// Os temas SENSÍVEIS (ideação, abuso, etc.) NÃO entram neste contexto: eles só são
// injetados no turno quando o matcher determinístico (demo.js#fatoSensivelDireto)
// confirma uma pergunta direta sobre o tema. Assim a revelação gradual é garantida
// e não vaza. O exame físico também fica de fora — quem entrega achado é o detector
// determinístico (exames.js), nunca a fala do paciente.

import { conversar, conversarStream } from "./ia.js";
import { ehChaveMeta } from "./texto.js";

function primeiroNome(caso) {
  return String((caso.identificacao || {}).nome || "o paciente").trim().split(/\s+/)[0];
}

// Junta uma lista em texto corrido, ignorando entradas vazias.
function lista(valor, separador = "; ") {
  if (!Array.isArray(valor)) return valor ? String(valor).trim() : "";
  return valor.map((v) => String(v).trim()).filter(Boolean).join(separador);
}

function texto(valor) {
  return valor ? String(valor).trim() : "";
}

// Booleano do caso ("hipertensao": true) vira a palavra que um paciente usaria. Sem
// isto o modelo lê "hipertensao: true" e responde em "computês".
function valor(v) {
  if (v === true) return "Sim";
  if (v === false) return "Não";
  return String(v);
}

// Blocos de informação vêm em dois formatos nos casos: o plano ({tema: fato}) e o
// anotado ({descricao, itens: [...]}). Os dois viram a mesma lista de fatos.
function fatosDe(obj) {
  const out = [];
  for (const [k, v] of Object.entries(obj || {})) {
    if (ehChaveMeta(k)) continue;
    if (v === null || v === undefined || v === "") continue;
    if (k === "itens" && Array.isArray(v)) {
      out.push(...v.map((item) => String(item).trim()).filter(Boolean));
      continue;
    }
    out.push(...linhasDe({ [k]: v }));
  }
  return out;
}

// Converte um objeto em linhas "rótulo: valor" (só as chaves com conteúdo).
function linhasDe(obj) {
  const out = [];
  for (const [k, v] of Object.entries(obj || {})) {
    if (v === null || v === undefined || v === "") continue;
    const rotulo = k.replaceAll("_", " ");
    if (Array.isArray(v)) {
      if (v.length) out.push(`${rotulo}: ${v.map(valor).join(", ")}`);
    } else if (typeof v === "object") {
      const vals = Object.values(v).filter((x) => x !== null && x !== undefined && x !== "");
      if (vals.length) out.push(`${rotulo}: ${vals.map(valor).join("; ")}`);
    } else {
      out.push(`${rotulo}: ${valor(v)}`);
    }
  }
  return out;
}

// Um bloco só entra no prompt se tiver conteúdo — casos antigos/parciais não geram
// cabeçalhos órfãos nem linhas "undefined".
function secao(titulo, linhas) {
  const corpo = linhas.filter(Boolean);
  if (!corpo.length) return "";
  return [titulo, ...corpo].join("\n");
}

// --- A matriz: a vida da pessoa ---------------------------------------------

function blocoVida(caso) {
  const ctx = caso.contexto_de_vida || {};
  return secao("━━ A SUA VIDA — é daqui que vem TUDO o que você diz ━━", [
    texto(ctx.biografia) && `A sua história: ${texto(ctx.biografia)}`,
    texto(ctx.rotina) && `O seu dia a dia: ${texto(ctx.rotina)}`,
    texto(ctx.trabalho) && `O seu trabalho: ${texto(ctx.trabalho)}`,
    texto(ctx.familia_e_relacoes) && `A sua família e as suas relações: ${texto(ctx.familia_e_relacoes)}`,
    lista(ctx.estressores_atuais) && `O que te pesa hoje: ${lista(ctx.estressores_atuais)}`,
    ...linhasDe(caso.rede_apoio).map((l) => `Quem te apoia — ${l}`),
    "",
    "Quando o profissional perguntar de QUALQUER assunto — casa, trabalho, sono, dinheiro,",
    "fé, filhos, o que você fez ontem — responda a partir desta vida, com os detalhes dela.",
    "Nunca dê uma resposta genérica que caberia em qualquer pessoa: você tem esta história.",
  ]);
}

function blocoQuemEh(caso) {
  const persona = caso.persona || {};
  return secao("━━ QUEM VOCÊ É ━━", [
    texto(persona.resumo),
    lista(persona.temperamento) && `O seu temperamento: ${lista(persona.temperamento)}`,
    texto(persona.postura_na_consulta) && `Como você chega nesta consulta: ${texto(persona.postura_na_consulta)}`,
  ]);
}

function blocoFala(caso) {
  const estilo = caso.estilo_de_fala || {};
  const exemplos = Array.isArray(estilo.exemplos_de_fala) ? estilo.exemplos_de_fala : [];
  return secao("━━ COMO VOCÊ FALA — siga à risca, é a sua voz ━━", [
    texto(estilo.registro) && `Registro: ${texto(estilo.registro)}`,
    lista(estilo.caracteristicas) && `Marcas da sua fala: ${lista(estilo.caracteristicas)}`,
    lista(estilo.bordoes_e_expressoes) && `Expressões que você usa: ${lista(estilo.bordoes_e_expressoes)}`,
    lista(estilo.nunca_faz) && `Você NUNCA: ${lista(estilo.nunca_faz)}`,
    exemplos.length && `Exemplos reais da sua voz: ${exemplos.map((s) => `"${s}"`).join("  ")}`,
    "Combine o vocabulário com a sua escolaridade e a sua profissão. Não use termo técnico",
    "nem palavra que esta pessoa não usaria em casa.",
  ]);
}

function blocoAgora(caso) {
  const emo = caso.estado_emocional || {};
  return secao("━━ COMO VOCÊ ESTÁ AGORA ━━", [
    texto(emo.agora),
    lista(emo.manifestacoes) && `Isso aparece em você assim: ${lista(emo.manifestacoes)}`,
    texto(emo.o_que_teme) && `O que você teme: ${texto(emo.o_que_teme)}`,
    texto(emo.o_que_espera) && `O que você espera desta consulta: ${texto(emo.o_que_espera)}`,
  ]);
}

function blocoAbertura(caso) {
  const din = caso.dinamica_de_revelacao || {};
  return secao("━━ COMO VOCÊ SE ABRE — regule CADA resposta por isto ━━", [
    lista(din.abre_se_quando) && `Você se abre quando: ${lista(din.abre_se_quando)}`,
    lista(din.fecha_se_quando) && `Você se fecha quando: ${lista(din.fecha_se_quando)}`,
    texto(din.sinais_de_confianca) && `Quando confia, aparece assim: ${texto(din.sinais_de_confianca)}`,
    texto(din.trava_do_sensivel) && `Sobre o que é mais íntimo: ${texto(din.trava_do_sensivel)}`,
    "",
    "Pergunta apressada, fria ou genérica → resposta curta, contida, na defensiva.",
    "Pergunta acolhedora, específica e no seu tempo → você se abre um pouco mais.",
    "A qualidade do que você entrega depende da qualidade da entrevista dele.",
  ]);
}

function blocoClinico(caso) {
  const dados = [];
  if (caso.queixa_principal) dados.push(`Queixa principal: ${caso.queixa_principal}`);
  dados.push(...linhasDe(caso.historia_doenca_atual).map((l) => `HDA — ${l}`));
  dados.push(...linhasDe(caso.antecedentes_pessoais).map((l) => `Antecedente pessoal — ${l}`));
  dados.push(...linhasDe(caso.antecedentes_familiares).map((l) => `Antecedente familiar — ${l}`));
  dados.push(...linhasDe(caso.habitos_de_vida).map((l) => `Hábito — ${l}`));
  dados.push(...fatosDe(caso.informacoes_iniciais).map((l) => `Conta com facilidade — ${l}`));
  dados.push(
    ...fatosDe(caso.informacoes_intermediarias).map((l) => `Só conta se perguntarem do tema — ${l}`)
  );
  return secao("━━ O QUE VOCÊ SENTE E JÁ VIVEU ━━", dados);
}

// Prompt de sistema completo e ESTÁVEL por caso (cacheado entre turnos).
export function sistemaPaciente(caso) {
  const id = caso.identificacao || {};
  const nome = id.nome || "o paciente";
  const primeiro = primeiroNome(caso);
  const ident = [id.idade && `${id.idade} anos`, id.sexo, id.profissao, id.estado_civil, id.escolaridade]
    .filter(Boolean)
    .join(", ");
  // Concordância em pt-BR: "na voz dela" soa como pessoa; "na voz dele(a)" soa como
  // formulário. O sexo está em todos os casos; o masculino é só o fallback.
  const dela = /^f/i.test(String(id.sexo || ""));
  const dele = dela ? "dela" : "dele";

  return [
    `Você É ${nome}${ident ? ` (${ident})` : ""} — uma pessoa de carne e osso, sentada numa consulta.`,
    "Você NÃO é uma IA, um assistente ou um chatbot. Quem está doente e sofrendo é VOCÊ.",
    "Quem está sendo avaliado na entrevista é o profissional do outro lado.",
    "",
    blocoVida(caso),
    "",
    blocoQuemEh(caso),
    "",
    blocoFala(caso),
    "",
    blocoAgora(caso),
    "",
    blocoAbertura(caso),
    "",
    blocoClinico(caso),
    "",
    "━━ COMO RESPONDER ━━",
    `Responda como ${primeiro} responderia: em primeira pessoa, na voz ${dele}, com a emoção ${dele}.`,
    "- SEJA BREVE: no MÁXIMO 1 ou 2 frases curtas. Só se estenda se pedirem ('me conta mais').",
    "- Responda SÓ o que foi perguntado. Não se antecipe, não entregue a história toda de uma vez.",
    "- Use SÓ os seus dados. Se perguntarem algo que não está neles, diga de um jeito natural que",
    "  não sabe, não lembra ou não tem — nunca invente sintoma, exame, remédio ou fato.",
    "- NUNCA nomeie uma doença, um transtorno ou um diagnóstico — nem afirmando, nem como",
    "  hipótese ('acho que pode ser...', 'sei que parece um quadro de...'), nem com termo técnico.",
    "  Isto vale MESMO que você trabalhe ou estude na área da saúde e sabe o nome: quem precisa",
    "  chegar ao diagnóstico é o profissional à sua frente, e dizer o nome estraga a consulta dele.",
    "  Perguntaram 'o que você tem?' ou 'o que você acha que é?' → descreva o que você SENTE,",
    "  no seu jeito, e devolva a dúvida ('é isso que eu queria saber, doutor').",
    "- NUNCA diga que é uma IA, nunca ofereça ajuda ao profissional, nunca inverta os papéis.",
    "- NUNCA cite resultado de exame, pressão ou escala que o profissional não tenha feito agora.",
    "- Quando eu marcar [entre colchetes] que você pode tocar num assunto delicado, revele com",
    "  hesitação, aos poucos, no seu jeito — nunca de uma vez só.",
    "- Só a fala. Sem narração, sem aspas, sem se descrever em terceira pessoa.",
  ]
    .join("\n")
    // Blocos ausentes (caso parcial) deixam linhas em branco em sequência: colapsa
    // para o prompt não ganhar buracos.
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// Monta as mensagens (system estável + turno do usuário). Compartilhado pelos
// caminhos com e sem streaming.
// - `fatoLiberado`: o profissional tocou diretamente num tema sensível → o conteúdo
//   é injetado só neste turno, para revelação cuidadosa.
// - `examesEntregues`: exames/aferições que ACABARAM de ser feitos neste turno. O
//   paciente sabe que aconteceram (sentiu o aparelho, viu a agulha) e pode comentar,
//   mas continua sem saber ler o resultado nem nomear o diagnóstico.
function montarMensagens(caso, pergunta, fatoLiberado, examesEntregues) {
  const partes = [`O profissional perguntou: "${pergunta}"`];

  if (examesEntregues && examesEntregues.length) {
    const nomes = examesEntregues.map((dados) => dados.nome).join(", ");
    partes.push(
      `[O profissional acabou de fazer isto em você, agora: ${nomes}. Você sentiu o procedimento ` +
        "acontecer e pode reagir a ele no seu jeito (incômodo, medo, alívio, uma pergunta tímida), " +
        "mas você NÃO sabe interpretar o resultado e NUNCA diz números, laudo ou nome de doença.]"
    );
  }

  if (fatoLiberado) {
    partes.push(
      "[Ele tocou diretamente, com acolhimento, num assunto delicado. Você PODE revelar isto " +
        `agora — com hesitação, aos poucos, no seu jeito, sem despejar tudo: ${fatoLiberado}]`
    );
  }

  return [
    { role: "system", content: sistemaPaciente(caso) },
    { role: "user", content: partes.join("\n") },
  ];
}

// Responde como o paciente (não-streaming — usado como fallback e nos testes).
export async function responderComoPaciente(caso, pergunta, fatoLiberado, examesEntregues) {
  return await conversar(montarMensagens(caso, pergunta, fatoLiberado, examesEntregues));
}

// Versão em STREAMING: onDelta(t) recebe cada pedaço da fala; resolve com o texto completo.
export async function responderComoPacienteStream(
  caso,
  pergunta,
  fatoLiberado,
  onDelta,
  examesEntregues
) {
  return await conversarStream(
    montarMensagens(caso, pergunta, fatoLiberado, examesEntregues),
    onDelta
  );
}
