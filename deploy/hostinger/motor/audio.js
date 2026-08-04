// Credenciais e endpoint do áudio (voz do paciente e transcrição da fala do aluno).
//
// Vive num módulo próprio porque tanto tts.js quanto transcricao.js precisam disso —
// se cada um importasse do outro, viraria ciclo de importação.
//
// O áudio pode ter credencial SEPARADA da do texto. Isso atende o caso comum: chat
// num gateway barato (OpenRouter, que serve /chat/completions e nada de áudio) e voz
// na OpenAI, que é quem tem /audio/speech e /audio/transcriptions. Sem as variáveis
// específicas, o áudio herda a configuração do texto.

export function chaveAudio() {
  return (process.env.OPENAI_AUDIO_API_KEY || process.env.OPENAI_API_KEY || "").trim();
}

export function baseAudio() {
  return (
    process.env.OPENAI_AUDIO_BASE_URL ||
    process.env.OPENAI_BASE_URL ||
    "https://api.openai.com/v1"
  ).replace(/\/+$/, "");
}

// Ter chave NÃO significa ter áudio. Apontado para um gateway que só serve chat, a
// página anunciava voz e microfone que falhavam a cada uso — melhor dizer de saída
// que não há, e cair no navegador. PV_AUDIO_FORCAR=1 libera outros gateways que
// implementem os mesmos endpoints.
export function baseServeAudio() {
  if ((process.env.PV_AUDIO_FORCAR || "") === "1") return true;
  try {
    return /(^|\.)openai\.com$/.test(new URL(baseAudio()).hostname);
  } catch {
    return false;
  }
}

export function audioDisponivel() {
  return Boolean(chaveAudio() && baseServeAudio());
}
