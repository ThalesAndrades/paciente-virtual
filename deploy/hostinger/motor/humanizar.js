// Humanização: a ESSÊNCIA da resposta (o conteúdo honesto, com revelação gradual já
// garantida) vem do matcher determinístico em demo.js — instantâneo. A IA só reescreve
// essa essência como o paciente falaria, dando naturalidade e emoção ao diálogo.
//
// Por que é rápido: o prompt de sistema é COMPACTO e ESTÁVEL por caso. O Ollama cacheia
// o prefixo do sistema entre turnos, então cada pergunta só processa a pequena essência
// nova → respostas de poucos segundos. E a IA nunca recebe o diagnóstico nem o bloco
// sensível inteiro (só a essência do turno), então não há como vazar.

import { conversar } from "./ia.js";

function primeiroNome(caso) {
  return String((caso.identificacao || {}).nome || "o paciente").trim().split(/\s+/)[0];
}

// Prompt de sistema compacto e ESTÁVEL (idêntico em todos os turnos do mesmo caso).
export function sistemaHumanizador(caso) {
  const id = caso.identificacao || {};
  const persona = caso.persona || {};
  const estilo = caso.estilo_de_fala || {};
  const emo = caso.estado_emocional || {};
  const nome = id.nome || "o paciente";
  const primeiro = primeiroNome(caso);
  const ident = [id.idade && `${id.idade} anos`, id.sexo, id.profissao].filter(Boolean).join(", ");

  const caracteristicas = Array.isArray(estilo.caracteristicas) ? estilo.caracteristicas.slice(0, 5) : [];
  const exemplos = Array.isArray(estilo.exemplos_de_fala) ? estilo.exemplos_de_fala.slice(0, 3) : [];

  return [
    `Você INTERPRETA ${nome}${ident ? ` — ${ident}` : ""} — numa consulta clínica. Você É essa pessoa: um paciente humano, de verdade.`,
    persona.resumo ? `Quem você é: ${persona.resumo}` : "",
    estilo.registro ? `Seu jeito de falar: ${estilo.registro}.` : "",
    caracteristicas.length ? `Marcas da sua fala: ${caracteristicas.join("; ")}.` : "",
    exemplos.length ? `Exemplos de como você fala: ${exemplos.map((s) => `"${s}"`).join("  ")}` : "",
    emo.agora ? `Como você se sente agora: ${emo.agora}` : "",
    "",
    `SUA TAREFA a cada turno: eu te entrego a ESSÊNCIA da sua resposta (o conteúdo honesto e verdadeiro). Você reescreve essa essência como ${primeiro} falaria em voz alta:`,
    "- UMA fala curta e natural, em primeira pessoa, com a sua emoção e o seu jeito de falar.",
    "- Diga SÓ o que está na essência. NÃO invente sintomas, exames, datas ou qualquer dado a mais.",
    "- NUNCA diga que é uma IA, assistente ou robô. NUNCA ofereça ajuda ao profissional. NUNCA diga o nome de uma doença nem se diagnostique.",
    '- Se a essência for "(não entendi)", diga, no seu jeito, que não entendeu bem e peça para repetir.',
    "Responda apenas com a fala do paciente — sem aspas, sem preâmbulo, sem narração.",
  ]
    .filter(Boolean)
    .join("\n");
}

// Reescreve a essência na voz do paciente. Sistema estável (cacheado) + essência curta.
export async function humanizar(caso, essencia) {
  return await conversar([
    { role: "system", content: sistemaHumanizador(caso) },
    { role: "user", content: `Essência da sua resposta a esta pergunta do profissional: ${essencia}` },
  ]);
}
