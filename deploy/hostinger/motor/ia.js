// Acesso ao Ollama por HTTP (opcional — sem ele, o servidor fica em modo demo).

// Lidas a cada chamada, para respeitar mudanças de ambiente em runtime.
function urlOllama() {
  return process.env.OLLAMA_URL || "http://127.0.0.1:11434";
}

function modelo() {
  return process.env.PACIENTE_VIRTUAL_MODELO || "qwen3:8b";
}

export function limparRaciocinio(texto) {
  return (texto || "").replace(/<think>[\s\S]*?<\/think>/g, "").trim();
}

export async function conversar(mensagens) {
  const resposta = await fetch(`${urlOllama()}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    // keep_alive mantém o modelo carregado entre turnos (evita cold start a cada
    // pergunta em CPU); num_predict limita o tamanho da fala do paciente.
    body: JSON.stringify({
      model: modelo(),
      messages: mensagens,
      stream: false,
      keep_alive: "30m",
      options: { num_predict: 320, temperature: 0.8 },
    }),
    signal: AbortSignal.timeout(180000),
  });

  if (!resposta.ok) {
    throw new Error(`Ollama respondeu HTTP ${resposta.status}`);
  }

  const dados = await resposta.json();
  return limparRaciocinio(dados.message && dados.message.content);
}
