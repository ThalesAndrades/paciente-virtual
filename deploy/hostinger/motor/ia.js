// Acesso ao Ollama por HTTP (opcional — sem ele, o servidor fica em modo demo).

// Lidas a cada chamada, para respeitar mudanças de ambiente em runtime.
function urlOllama() {
  return process.env.OLLAMA_URL || "http://127.0.0.1:11434";
}

function modelo() {
  return process.env.PACIENTE_VIRTUAL_MODELO || "qwen3:8b";
}

export function limparRaciocinio(texto) {
  // Remove blocos de raciocínio fechados E um <think> não fechado (quando o
  // orçamento de tokens corta a resposta antes do </think>, senão o pensamento
  // interno do modelo vazaria como fala do paciente).
  return (texto || "")
    .replace(/<think>[\s\S]*?<\/think>/g, "")
    .replace(/<think>[\s\S]*$/g, "")
    .trim();
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
      // think:false desliga o raciocínio de modelos como qwen3 — não consome o
      // orçamento de num_predict nem arrisca vazar o chain-of-thought. Ignorado
      // silenciosamente por modelos sem raciocínio (qwen2.5).
      think: false,
      // num_ctx 8192: o prompt do personagem tem ~2000 tokens; com o padrão (2048)
      // ele estoura o contexto, trunca o prompt e quebra o cache de prefixo entre
      // turnos (cada pergunta reprocessa tudo). Com folga, os turnos seguintes reusam
      // o cache e ficam bem mais rápidos.
      keep_alive: "4h",
      options: { num_predict: 300, temperature: 0.7, num_ctx: 8192 },
    }),
    signal: AbortSignal.timeout(180000),
  });

  if (!resposta.ok) {
    throw new Error(`Ollama respondeu HTTP ${resposta.status}`);
  }

  const dados = await resposta.json();
  const saida = limparRaciocinio(dados.message && dados.message.content);
  // Resposta vazia (ou só-raciocínio, ou message.content undefined) é falha:
  // lança para o chamador cair no fallback determinístico, em vez de gravar um
  // turno em branco como fala do paciente.
  if (!saida) throw new Error("Ollama devolveu resposta vazia");
  return saida;
}

// Igual a conversar, mas em STREAMING: chama onDelta(t) a cada pedaço de texto
// (a fala do paciente aparece na tela conforme é gerada) e resolve com o texto
// completo já limpo. num_predict menor: fala do paciente é curta → gera rápido.
export async function conversarStream(mensagens, onDelta) {
  const resposta = await fetch(`${urlOllama()}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: modelo(),
      messages: mensagens,
      stream: true,
      think: false,
      keep_alive: "4h",
      options: { num_predict: 160, temperature: 0.7, num_ctx: 8192 },
    }),
    signal: AbortSignal.timeout(180000),
  });
  if (!resposta.ok || !resposta.body) throw new Error(`Ollama respondeu HTTP ${resposta.status}`);

  // /api/chat com stream:true devolve NDJSON (uma linha JSON por chunk).
  const reader = resposta.body.getReader();
  const dec = new TextDecoder();
  let buffer = "";
  let bruto = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += dec.decode(value, { stream: true });
    let nl;
    while ((nl = buffer.indexOf("\n")) >= 0) {
      const linha = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (!linha) continue;
      let obj;
      try {
        obj = JSON.parse(linha);
      } catch {
        continue;
      }
      const t = obj.message && obj.message.content;
      if (t) {
        bruto += t;
        onDelta(t);
      }
    }
  }
  const saida = limparRaciocinio(bruto);
  if (!saida) throw new Error("Ollama devolveu resposta vazia");
  return saida;
}
