// Camada de síntese de voz AGNÓSTICA de provedor.
//
// Ordem de escolha: o que foi configurado explicitamente vence, e a OpenAI entra
// como padrão quando já existe `OPENAI_API_KEY` para o modelo de linguagem — assim
// ligar a IA já liga a voz boa, sem mais nenhuma configuração.
//
//   1. ElevenLabs   — ELEVEN_API_KEY + voz. Melhor emoção, mais caro.
//   2. Kokoro       — KOKORO_URL. Self-hosted, sem custo por chamada.
//   3. OpenAI       — OPENAI_API_KEY. É o caminho padrão hoje.
//   4. nenhum       — a página cai na voz do navegador (pt-BR sofrível).
//
// `PV_TTS_PROVEDOR` força um deles (elevenlabs|kokoro|openai|nenhum).
//
// A voz do paciente é DIRIGIDA: `gpt-4o-mini-tts` aceita `instructions`, então o
// tom acompanha o estado emocional do caso. Uma paciente em pânico e uma senhora
// enlutada deixam de ser lidas com a mesma locução neutra.

import { baseAudio, baseServeAudio, chaveAudio } from "./audio.js";
import { registrarModelo } from "./ia.js";
import { transcricaoDisponivel } from "./transcricao.js";

const KOKORO_VOZ = {
  feminino: process.env.KOKORO_VOZ_F || "pf_dora",
  masculino: process.env.KOKORO_VOZ_M || "pm_alex",
};

const ELEVEN_MODEL = process.env.ELEVEN_MODEL || "eleven_v3";
const ELEVEN_VOZ = {
  feminino: process.env.ELEVEN_VOZ_F || "",
  masculino: process.env.ELEVEN_VOZ_M || "",
};

// Vozes multilíngues da OpenAI que soam naturais em pt-BR.
const OPENAI_VOZ = {
  feminino: process.env.OPENAI_VOZ_F || "nova",
  masculino: process.env.OPENAI_VOZ_M || "onyx",
};

// Lidos a cada chamada: o env pode mudar sem rebuild da imagem.
const kokoroUrl = () => (process.env.KOKORO_URL || "").replace(/\/$/, "");
const elevenKey = () => process.env.ELEVEN_API_KEY || "";
const openaiKey = chaveAudio;
const openaiBase = baseAudio;

// Cadeia de fallback, igual à do modelo de linguagem: tenta o primeiro e cai para
// o próximo se a conta não tiver acesso àquele modelo.
function modelosTTS() {
  const bruto = process.env.OPENAI_TTS_MODEL || "gpt-4o-mini-tts,tts-1";
  return bruto.split(/[\s,]+/).map((m) => m.trim()).filter(Boolean);
}

function provedor() {
  const forcado = (process.env.PV_TTS_PROVEDOR || "").trim().toLowerCase();
  if (forcado) return forcado;
  if (elevenKey() && (ELEVEN_VOZ.feminino || ELEVEN_VOZ.masculino)) return "elevenlabs";
  if (kokoroUrl()) return "kokoro";
  if (openaiKey() && baseServeAudio()) return "openai";
  return "nenhum";
}

// Disponibilidade POR GÊNERO, espelhando o despacho de sintetizar() — assim a UI
// só habilita a voz que realmente tem síntese (evita 502 para voz anunciada).
function vozDisponivel(chave) {
  const p = provedor();
  if (p === "elevenlabs" && ELEVEN_VOZ[chave]) return true;
  if (p === "elevenlabs" && (kokoroUrl() || (openaiKey() && baseServeAudio()))) return true;
  if (p === "kokoro") return Boolean(kokoroUrl());
  if (p === "openai") return Boolean(openaiKey() && baseServeAudio());
  return false;
}

export function ttsInfo() {
  return {
    stt: transcricaoDisponivel(),
    tts: { feminino: vozDisponivel("feminino"), masculino: vozDisponivel("masculino") },
    provedor: provedor(),
  };
}

// Monta a direção de atuação a partir do caso — curta, porque é instrução de
// locução, não roteiro. Sem caso (ex.: teste de voz), devolve vazio.
// Direção de locução — CURTA de propósito.
//
// Antes isto despejava o registro e o estado emocional inteiros do caso (centenas
// de caracteres). O modelo de voz tratava aquilo como roteiro de atuação e o
// resultado saía teatral, declamado, com emoção exagerada — nada parecido com
// alguém respondendo a um médico. Instrução de locução precisa dizer COMO falar,
// não recontar quem é a pessoa: isso já está no texto que ela diz.
export function instrucaoDeVoz(caso) {
  if (!caso) return "";
  const emo = caso.estado_emocional || {};
  const id = caso.identificacao || {};
  const tom = String(emo.agora || "").split(/[.;]/)[0].trim().slice(0, 90);

  return [
    "Fale em português do Brasil natural e coloquial, como uma pessoa comum",
    `de ${id.idade || "meia"} anos conversando com um médico no consultório.`,
    tom && `Tom: ${tom}.`,
    "Ritmo de conversa, volume normal, sem locutar e sem dramatizar.",
  ]
    .filter(Boolean)
    .join(" ");
}

// Retorna { buffer, mime } com o áudio, ou lança se indisponível/erro.
export async function sintetizar(texto, sexo, instrucao) {
  const chave = sexo === "masculino" ? "masculino" : "feminino";
  const p = provedor();

  if (p === "elevenlabs" && ELEVEN_VOZ[chave]) return viaElevenLabs(texto, ELEVEN_VOZ[chave]);
  if (p === "kokoro" && kokoroUrl()) return viaKokoro(texto, KOKORO_VOZ[chave]);
  if (p === "openai" && openaiKey()) return viaOpenAI(texto, OPENAI_VOZ[chave], instrucao);
  // Provedor explícito indisponível: tenta o que houver antes de desistir.
  if (kokoroUrl()) return viaKokoro(texto, KOKORO_VOZ[chave]);
  if (openaiKey()) return viaOpenAI(texto, OPENAI_VOZ[chave], instrucao);
  throw new Error("TTS não configurado");
}

async function viaOpenAI(texto, voice, instrucao) {
  let ultimoErro;
  for (const model of modelosTTS()) {
    try {
      const corpo = {
        model,
        input: texto,
        voice,
        // mp3 toca em todo navegador (inclusive Safari/iOS); opus quebra em parte deles.
        response_format: "mp3",
      };
      // `instructions` só existe nos modelos gpt-4o-*-tts; mandar para o tts-1
      // derruba a chamada com 400.
      if (instrucao && /gpt-4o/.test(model)) corpo.instructions = instrucao;

      const resposta = await fetch(`${openaiBase()}/audio/speech`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${openaiKey()}`,
        },
        body: JSON.stringify(corpo),
        signal: AbortSignal.timeout(60000),
      });
      if (!resposta.ok) {
        const detalhe = await resposta.text().catch(() => "");
        throw new Error(`OpenAI TTS/${model} HTTP ${resposta.status} ${detalhe.slice(0, 160)}`);
      }
      const buffer = Buffer.from(await resposta.arrayBuffer());
      if (!buffer.length) throw new Error(`OpenAI TTS/${model} devolveu áudio vazio`);
      registrarModelo("voz", model);
      return { buffer, mime: "audio/mpeg" };
    } catch (erro) {
      ultimoErro = erro; // cai para o próximo modelo da cadeia
    }
  }
  throw ultimoErro || new Error("Nenhum modelo de TTS configurado");
}

async function viaKokoro(texto, voice) {
  const resposta = await fetch(`${kokoroUrl()}/v1/audio/speech`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: "kokoro", input: texto, voice, response_format: "mp3" }),
    signal: AbortSignal.timeout(60000),
  });
  if (!resposta.ok) throw new Error(`Kokoro HTTP ${resposta.status}`);
  const buffer = Buffer.from(await resposta.arrayBuffer());
  if (!buffer.length) throw new Error("Kokoro devolveu áudio vazio");
  return { buffer, mime: "audio/mpeg" };
}

async function viaElevenLabs(texto, voiceId) {
  const resposta = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}`,
    {
      method: "POST",
      headers: { "xi-api-key": elevenKey(), "Content-Type": "application/json", Accept: "audio/mpeg" },
      body: JSON.stringify({ text: texto, model_id: ELEVEN_MODEL }),
      signal: AbortSignal.timeout(60000),
    }
  );
  if (!resposta.ok) throw new Error(`ElevenLabs HTTP ${resposta.status}`);
  const buffer = Buffer.from(await resposta.arrayBuffer());
  if (!buffer.length) throw new Error("ElevenLabs devolveu áudio vazio");
  return { buffer, mime: "audio/mpeg" };
}
