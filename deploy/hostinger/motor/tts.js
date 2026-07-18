// Camada de síntese de voz AGNÓSTICA de provedor.
// - Hoje: Kokoro (self-hosted, pt-BR, vozes masculina/feminina) via KOKORO_URL.
// - Futuro: ElevenLabs (emoção/choro por tags) — basta setar ELEVEN_API_KEY + as vozes.
// Sem provedor configurado → indisponível (a página cai na voz do navegador).

const KOKORO_URL = (process.env.KOKORO_URL || "").replace(/\/$/, "");
const KOKORO_VOZ = {
  feminino: process.env.KOKORO_VOZ_F || "pf_dora",
  masculino: process.env.KOKORO_VOZ_M || "pm_alex",
};

const ELEVEN_API_KEY = process.env.ELEVEN_API_KEY || "";
const ELEVEN_MODEL = process.env.ELEVEN_MODEL || "eleven_v3";
const ELEVEN_VOZ = {
  feminino: process.env.ELEVEN_VOZ_F || "",
  masculino: process.env.ELEVEN_VOZ_M || "",
};

function provedor() {
  if (ELEVEN_API_KEY && (ELEVEN_VOZ.feminino || ELEVEN_VOZ.masculino)) return "elevenlabs";
  if (KOKORO_URL) return "kokoro";
  return "nenhum";
}

export function ttsInfo() {
  const p = provedor();
  const on = p !== "nenhum";
  return { stt: false, tts: { feminino: on, masculino: on }, provedor: p };
}

// Retorna { buffer, mime } com o áudio, ou lança se indisponível/erro.
export async function sintetizar(texto, sexo) {
  const chave = sexo === "masculino" ? "masculino" : "feminino";
  const p = provedor();

  if (p === "elevenlabs" && ELEVEN_VOZ[chave]) {
    return viaElevenLabs(texto, ELEVEN_VOZ[chave]);
  }
  if (p === "kokoro" || (p === "elevenlabs" && KOKORO_URL)) {
    return viaKokoro(texto, KOKORO_VOZ[chave]);
  }
  throw new Error("TTS não configurado");
}

async function viaKokoro(texto, voice) {
  const resposta = await fetch(`${KOKORO_URL}/v1/audio/speech`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: "kokoro", input: texto, voice, response_format: "mp3" }),
    signal: AbortSignal.timeout(60000),
  });
  if (!resposta.ok) throw new Error(`Kokoro HTTP ${resposta.status}`);
  return { buffer: Buffer.from(await resposta.arrayBuffer()), mime: "audio/mpeg" };
}

async function viaElevenLabs(texto, voiceId) {
  const resposta = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}`,
    {
      method: "POST",
      headers: { "xi-api-key": ELEVEN_API_KEY, "Content-Type": "application/json", Accept: "audio/mpeg" },
      body: JSON.stringify({ text: texto, model_id: ELEVEN_MODEL }),
      signal: AbortSignal.timeout(60000),
    }
  );
  if (!resposta.ok) throw new Error(`ElevenLabs HTTP ${resposta.status}`);
  return { buffer: Buffer.from(await resposta.arrayBuffer()), mime: "audio/mpeg" };
}
