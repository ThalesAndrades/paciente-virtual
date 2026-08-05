// Conversa por voz em tempo real: o token efêmero e o que a sessão pode fazer.
//
// O áudio vai DIRETO do navegador ao provedor (WebRTC). O servidor não fica no
// caminho — foi decisão de arquitetura: relayar o áudio de uma turma inteira por
// este VPS, que já hospeda outros quatro serviços, é o mesmo erro que sufocou o
// host quando o Ollama foi para lá. Em troca, o servidor perde a integridade da
// transcrição (ela passa a ser declarada pelo cliente) e mantém o que importa: o
// SEGREDO CLÍNICO continua sendo dele.
//
// Como o segredo se mantém: as instruções da sessão são o MESMO personagem do
// caminho por texto (`humanizar.js#sistemaPaciente`), que por construção não contém
// diagnóstico nem `informacoes_sensiveis` — há teste cravando isso. O que é sensível
// só existe atrás da ferramenta `consultar_ficha`, respondida pelo servidor.
//
// O token é efêmero e curto de propósito: quem o interceptar tem poucos segundos
// para usá-lo, e ele só serve para abrir esta sessão.

import { baseAudio, chaveAudio, baseServeAudio } from "./audio.js";
import { sistemaPaciente } from "./humanizar.js";
import { registrarModelo } from "./ia.js";

// Cadeia de fallback, igual à do texto e à da síntese: o primeiro pode não estar
// liberado na conta, e cair para o próximo é melhor que derrubar a aula.
// O `-mini` é o padrão por custo: US$ 10/1M de áudio de entrada contra US$ 32 do
// modelo cheio, numa conversa que cobra por minuto.
const MODELOS_PADRAO = "gpt-realtime-2.1-mini,gpt-realtime-mini,gpt-realtime-2.1";

// Vozes do modelo em tempo real (catálogo próprio, diferente do TTS por frase).
const VOZ = {
  feminino: process.env.PV_RT_VOZ_F || "marin",
  masculino: process.env.PV_RT_VOZ_M || "cedar",
};

export function modelosTempoReal() {
  return (process.env.PV_RT_MODELO || MODELOS_PADRAO)
    .split(/[\s,]+/)
    .map((m) => m.trim())
    .filter(Boolean);
}

// A voz em tempo real exige a OpenAI de verdade: um gateway que só serve
// /chat/completions não tem /realtime, e anunciar o recurso para ele daria erro a
// cada tentativa. `PV_TEMPO_REAL=0` desliga mesmo com tudo configurado — é o
// interruptor de quem paga a conta.
export function tempoRealDisponivel() {
  if ((process.env.PV_TEMPO_REAL || "") === "0") return false;
  return Boolean(chaveAudio() && baseServeAudio());
}

export const FERRAMENTAS = [
  {
    type: "function",
    name: "consultar_ficha",
    description:
      "Consulta a ficha desta consulta, que está no servidor e que VOCÊ NÃO TEM. " +
      "Chame SEMPRE que o profissional (a) tocar num assunto íntimo ou delicado — " +
      "morte, vontade de morrer, se machucar, violência, medo de alguém, bebida, " +
      "remédio por conta própria, dinheiro, vergonha, culpa, solidão, sexo — ou " +
      "(b) disser que vai examinar, medir, apalpar, auscultar ou pedir um exame. " +
      "Espere a resposta antes de falar. Nunca invente o conteúdo da ficha: se ela " +
      "não trouxer nada, você não tem aquilo para contar.",
    parameters: {
      type: "object",
      properties: {
        pergunta: {
          type: "string",
          description:
            "A pergunta do profissional, com as palavras dele, na íntegra. Não resuma " +
            "nem reescreva: é por estas palavras que o servidor decide.",
        },
      },
      required: ["pergunta"],
      additionalProperties: false,
    },
  },
];

// Instruções da sessão: o personagem de sempre + o que muda quando a conversa é
// falada e pode ser interrompida.
export function instrucoesTempoReal(caso) {
  return [
    sistemaPaciente(caso),
    "",
    "━━ ESTA CONVERSA É FALADA, AO VIVO ━━",
    "Você está numa sala, falando com o profissional. Ele ouve a sua voz.",
    "- Fale em 1 ou 2 frases curtas. Ninguém responde a 'como a senhora está?' com um parágrafo.",
    "- Se ele começar a falar por cima, PARE na hora e ouça. Quem conduz a consulta é ele.",
    "- Silêncio é permitido: hesite, respire, deixe a pausa acontecer. Você não é um locutor.",
    "- Fale em português do Brasil, no seu jeito, sem termo técnico.",
    "",
    "━━ O QUE VOCÊ NÃO SABE ━━",
    "Há coisas suas que você NÃO tem aqui: só a ficha no servidor tem.",
    "Quando o profissional tocar num assunto íntimo ou disser que vai te examinar,",
    "chame a ferramenta `consultar_ficha` com as palavras dele e ESPERE a resposta.",
    "Se a ficha não trouxer nada, você não tem aquilo para contar — não invente,",
    "não deduza, não preencha o vazio. Desconverse do seu jeito e siga sendo você.",
  ].join("\n");
}

function corpoDaSessao(caso, voz, modelo, minutos) {
  return {
    session: {
      type: "realtime",
      model: modelo,
      instructions: instrucoesTempoReal(caso),
      output_modalities: ["audio"],
      audio: {
        input: {
          // A transcrição da fala do aluno é o que alimenta o transcript e, por
          // ele, a rubrica. É declarada pelo cliente por construção (o áudio não
          // passa por aqui) — o que o servidor carimba são as tool calls.
          transcription: { model: "gpt-4o-mini-transcribe", language: "pt" },
          // O aluno usa o microfone do celular ou do notebook, numa sala com outras
          // pessoas: `far_field` é exatamente esse cenário. A filtragem acontece
          // ANTES do detector de fala, então corta junto os falsos positivos —
          // ventilador, cadeira arrastando, conversa ao fundo.
          noise_reduction: { type: "far_field" },
          // `server_vad` e NÃO `semantic_vad`: o semântico decide pelo sentido da
          // frase e, combinado com a redução de ruído, é conhecido por disparar
          // latência alta. Aqui vale mais um corte previsível, com limiar alto e
          // silêncio longo — o paciente só responde quando o aluno de fato parou
          // de falar, em vez de reagir a qualquer barulho da sala.
          turn_detection: {
            type: "server_vad",
            threshold: 0.62,
            prefix_padding_ms: 300,
            silence_duration_ms: 700,
            create_response: true,
            interrupt_response: true,
          },
        },
        output: { voice: VOZ[voz] || VOZ.feminino },
      },
      tools: FERRAMENTAS,
      tool_choice: "auto",
      // Teto por fala: o paciente responde curto. Sem isto, um monólogo de um
      // minuto custa por minuto e ainda atropela a consulta.
      max_output_tokens: 300,
    },
    // O token morre em segundos; a SESSÃO é limitada pelo orçamento em minutos, que
    // o navegador encerra e o servidor debita na concessão.
    expires_after: { anchor: "created_at", seconds: 60 },
    minutos,
  };
}

// Cunha o token efêmero no provedor. Devolve { valor, expira_em, modelo }.
export async function cunharToken({ caso, voz, minutos }) {
  const chave = chaveAudio();
  if (!chave) throw new Error("Sem credencial de áudio configurada.");

  const base = baseAudio();
  let ultimoErro;

  for (const modelo of modelosTempoReal()) {
    const { minutos: _ignorado, ...corpo } = corpoDaSessao(caso, voz, modelo, minutos);
    try {
      const resposta = await fetch(`${base}/realtime/client_secrets`, {
        method: "POST",
        headers: { Authorization: `Bearer ${chave}`, "Content-Type": "application/json" },
        body: JSON.stringify(corpo),
      });
      if (!resposta.ok) {
        const detalhe = (await resposta.text()).slice(0, 300);
        throw new Error(`Realtime/${modelo} HTTP ${resposta.status} ${detalhe}`);
      }
      const dados = await resposta.json();
      const valor = dados && (dados.value || dados.client_secret || (dados.client_secret || {}).value);
      if (!valor) throw new Error(`Realtime/${modelo} devolveu resposta sem token.`);

      registrarModelo("tempo_real", modelo);
      return { valor, expira_em: dados.expires_at || null, modelo };
    } catch (erro) {
      ultimoErro = erro; // cai para o próximo modelo da cadeia
    }
  }

  throw ultimoErro || new Error("Nenhum modelo de tempo real configurado.");
}

// Para onde o NAVEGADOR manda a oferta SDP. Vem do servidor em vez de ser fixo na
// página: quem configurou outra base para o áudio configurou para tudo.
export function urlChamada() {
  return `${baseAudio()}/realtime/calls`;
}

export function infoTempoReal() {
  return {
    disponivel: tempoRealDisponivel(),
    modelo: modelosTempoReal()[0] || null,
  };
}
