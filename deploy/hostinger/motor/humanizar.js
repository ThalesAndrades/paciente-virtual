// A IA responde COMO o paciente, a partir de um contexto de sistema ESTÁVEL por caso
// (dados NÃO-sensíveis: identidade, HDA, antecedentes, hábitos, vida). Isso dá cobertura
// a qualquer fraseado de pergunta. O prompt é o mesmo em todos os turnos → o Ollama
// cacheia o prefixo → respostas rápidas.
//
// Os temas SENSÍVEIS (ideação, abuso, etc.) NÃO entram no contexto estável: eles só são
// injetados no turno quando o matcher determinístico (demo.js#fatoSensivelDireto) confirma
// uma pergunta direta sobre o tema. Assim a revelação gradual é garantida e não vaza.

import { conversar, conversarStream } from "./ia.js";

function primeiroNome(caso) {
  return String((caso.identificacao || {}).nome || "o paciente").trim().split(/\s+/)[0];
}

// Converte um objeto em linhas "rótulo: valor" (só as chaves com conteúdo).
function linhasDe(obj) {
  const out = [];
  for (const [k, v] of Object.entries(obj || {})) {
    if (v === null || v === undefined || v === "") continue;
    const rotulo = k.replaceAll("_", " ");
    if (Array.isArray(v)) {
      if (v.length) out.push(`${rotulo}: ${v.join(", ")}`);
    } else if (typeof v === "object") {
      const vals = Object.values(v).filter(Boolean);
      if (vals.length) out.push(`${rotulo}: ${vals.join("; ")}`);
    } else {
      out.push(`${rotulo}: ${v}`);
    }
  }
  return out;
}

// Prompt de sistema compacto e ESTÁVEL por caso (cacheado entre turnos).
export function sistemaPaciente(caso) {
  const id = caso.identificacao || {};
  const persona = caso.persona || {};
  const estilo = caso.estilo_de_fala || {};
  const emo = caso.estado_emocional || {};
  const nome = id.nome || "o paciente";
  const primeiro = primeiroNome(caso);
  const ident = [
    id.idade && `${id.idade} anos`,
    id.sexo,
    id.profissao,
    id.estado_civil,
    id.escolaridade,
  ]
    .filter(Boolean)
    .join(", ");
  const carac = Array.isArray(estilo.caracteristicas) ? estilo.caracteristicas.slice(0, 5) : [];
  const exemplos = Array.isArray(estilo.exemplos_de_fala) ? estilo.exemplos_de_fala.slice(0, 3) : [];

  // Dados NÃO-sensíveis que a IA pode usar para responder qualquer pergunta comum.
  const dados = [];
  if (caso.queixa_principal) dados.push(`Queixa principal: ${caso.queixa_principal}`);
  dados.push(...linhasDe(caso.historia_doenca_atual).map((l) => `HDA — ${l}`));
  dados.push(...linhasDe(caso.antecedentes_pessoais).map((l) => `Antecedente pessoal — ${l}`));
  dados.push(...linhasDe(caso.antecedentes_familiares).map((l) => `Antecedente familiar — ${l}`));
  dados.push(...linhasDe(caso.habitos_de_vida).map((l) => `Hábito — ${l}`));
  dados.push(...linhasDe(caso.informacoes_iniciais).map((l) => `Sobre você — ${l}`));
  dados.push(...linhasDe(caso.informacoes_intermediarias).map((l) => `Sua vida (revele se perguntarem do tema) — ${l}`));
  dados.push(...linhasDe(caso.contexto_de_vida).map((l) => `Vida — ${l}`));
  dados.push(...linhasDe(caso.rede_apoio).map((l) => `Apoio — ${l}`));

  return [
    `Você INTERPRETA ${nome}${ident ? ` (${ident})` : ""} numa consulta clínica. Você É essa pessoa — um paciente humano, de verdade.`,
    persona.resumo ? `Quem você é: ${persona.resumo}` : "",
    estilo.registro ? `Seu jeito de falar: ${estilo.registro}.` : "",
    carac.length ? `Marcas da sua fala: ${carac.join("; ")}.` : "",
    exemplos.length ? `Exemplos de como você fala: ${exemplos.map((s) => `"${s}"`).join("  ")}` : "",
    emo.agora ? `Como você se sente agora: ${emo.agora}` : "",
    "",
    "COMO RESPONDER: o profissional te faz perguntas; responda como esse paciente responderia —",
    `uma fala curta e natural, em primeira pessoa, no jeito de ${primeiro}, com a sua emoção. Regras:`,
    "- SEJA BREVE: no MÁXIMO 1 ou 2 frases curtas por resposta. Paciente responde direto ao que",
    "  foi perguntado; só se estende se o profissional pedir ('me conta mais', 'como assim?').",
    "- Responda SÓ o que foi perguntado; não conte tudo de uma vez; não se antecipe.",
    "- Use SÓ os seus dados abaixo. Se perguntarem algo que não está neles, diga de forma natural que",
    "  não sabe, não lembra ou não tem — nunca invente sintoma, exame, remédio ou dado.",
    "- Traduza qualquer termo técnico dos seus dados para o seu jeito simples de falar.",
    "- NUNCA diga que é uma IA/assistente, nunca ofereça ajuda ao profissional, nunca diga o nome de uma",
    "  doença nem se diagnostique (mesmo se perguntarem 'o que o senhor tem?', responda com os sintomas).",
    "- Quando eu marcar [entre colchetes] que você pode revelar um assunto delicado, revele com hesitação,",
    "  aos poucos, no seu jeito — nunca de uma vez só.",
    "",
    "SEUS DADOS:",
    ...dados,
  ]
    .filter(Boolean)
    .join("\n");
}

// Monta as mensagens (system estável + turno do usuário). Compartilhado pelos
// caminhos com e sem streaming. Se `fatoLiberado` vier (o profissional tocou num
// tema sensível diretamente), ele é injetado para revelação cuidadosa neste turno.
function montarMensagens(caso, pergunta, fatoLiberado) {
  const conteudoUsuario = fatoLiberado
    ? `O profissional perguntou: "${pergunta}"\n[Ele tocou diretamente, com acolhimento, num assunto delicado. Você PODE revelar isto agora — com hesitação, aos poucos, no seu jeito, sem despejar tudo: ${fatoLiberado}]`
    : `O profissional perguntou: "${pergunta}"`;
  return [
    { role: "system", content: sistemaPaciente(caso) },
    { role: "user", content: conteudoUsuario },
  ];
}

// Responde como o paciente (não-streaming — usado como fallback e nos testes).
export async function responderComoPaciente(caso, pergunta, fatoLiberado) {
  return await conversar(montarMensagens(caso, pergunta, fatoLiberado));
}

// Versão em STREAMING: onDelta(t) recebe cada pedaço da fala; resolve com o texto completo.
export async function responderComoPacienteStream(caso, pergunta, fatoLiberado, onDelta) {
  return await conversarStream(montarMensagens(caso, pergunta, fatoLiberado), onDelta);
}
