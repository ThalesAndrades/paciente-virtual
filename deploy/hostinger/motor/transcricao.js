// Transcrição de áudio (o aluno fala, o servidor devolve texto).
//
// Antes o microfone dependia de `webkitSpeechRecognition`, que só existe em
// Chrome/Edge: no Safari e no iOS o aluno só conseguia digitar. Com a transcrição
// no servidor, a página grava o áudio com MediaRecorder — que roda em todo lugar —
// e manda o arquivo para cá.
//
// Reusa a mesma OPENAI_API_KEY do modelo de linguagem; sem ela, a página volta ao
// reconhecimento do navegador.

import { audioDisponivel, baseAudio, chaveAudio } from "./audio.js";

const chave = chaveAudio;
const base = baseAudio;

// Cadeia de fallback: o `gpt-4o-mini-transcribe` é mais rápido e barato; o
// `whisper-1` é o mais disponível e serve de rede de segurança.
function modelos() {
  const bruto = process.env.OPENAI_STT_MODEL || "gpt-4o-mini-transcribe,whisper-1";
  return bruto.split(/[\s,]+/).map((m) => m.trim()).filter(Boolean);
}

// Extensão que o endpoint aceita, deduzida do Content-Type do upload. O MediaRecorder
// entrega webm no Chrome/Firefox e mp4/aac no Safari.
function nomeDoArquivo(mime) {
  const tipo = String(mime || "").toLowerCase();
  if (tipo.includes("mp4") || tipo.includes("aac")) return "audio.mp4";
  if (tipo.includes("ogg")) return "audio.ogg";
  if (tipo.includes("mpeg") || tipo.includes("mp3")) return "audio.mp3";
  if (tipo.includes("wav")) return "audio.wav";
  return "audio.webm";
}

// Chave sozinha não basta: o endpoint precisa mesmo servir /audio/transcriptions.
export function transcricaoDisponivel() {
  return audioDisponivel();
}

// Recebe o áudio bruto e devolve o texto falado. Lança se não houver chave, se o
// áudio for inaproveitável ou se todos os modelos falharem.
export async function transcrever(audio, mime) {
  if (!audioDisponivel()) throw new Error("Transcrição não configurada");
  if (!audio || !audio.length) throw new Error("Áudio vazio");

  let ultimoErro;
  for (const model of modelos()) {
    try {
      const form = new FormData();
      form.append("file", new Blob([audio], { type: mime || "audio/webm" }), nomeDoArquivo(mime));
      form.append("model", model);
      // Fixar o idioma evita o modelo "adivinhar" inglês em áudio curto e ruidoso.
      form.append("language", "pt");
      form.append("response_format", "json");

      const resposta = await fetch(`${base()}/audio/transcriptions`, {
        method: "POST",
        headers: { Authorization: `Bearer ${chave()}` },
        body: form,
        signal: AbortSignal.timeout(60000),
      });
      if (!resposta.ok) {
        const detalhe = await resposta.text().catch(() => "");
        throw new Error(`STT/${model} HTTP ${resposta.status} ${detalhe.slice(0, 160)}`);
      }
      const dados = await resposta.json();
      const texto = String((dados && dados.text) || "").trim();
      // Silêncio ou ruído: o chamador trata como "não entendi", sem virar turno.
      if (!texto) throw new Error(`STT/${model} não reconheceu fala`);
      return texto;
    } catch (erro) {
      ultimoErro = erro;
    }
  }
  throw ultimoErro || new Error("Nenhum modelo de transcrição configurado");
}
