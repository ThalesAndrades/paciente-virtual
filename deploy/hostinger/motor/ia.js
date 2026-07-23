// Acesso ao modelo de linguagem por HTTP (opcional — sem ele, o servidor fica
// em modo demo).
//
// Dois backends, escolhidos em runtime a cada chamada:
//
//   1. OpenAI-compatível (/chat/completions) — ativado quando OPENAI_API_KEY
//      está definida. Serve tanto a OpenAI quanto gateways OSS como o OpenRouter
//      (via OPENAI_BASE_URL). É o caminho de máxima performance.
//   2. Ollama local — usado quando não há OPENAI_API_KEY (padrão histórico).
//
// No caminho OpenAI-compatível, OPENAI_MODEL aceita UMA LISTA de modelos
// (separados por vírgula/espaço): é uma cadeia de fallback — tenta o primeiro e,
// em erro/rate-limit/resposta vazia, passa para o próximo. A avaliação pedagógica
// pode usar uma lista própria (OPENAI_MODEL_AVALIACAO), tipicamente um modelo com
// raciocínio, enquanto a fala do paciente usa um instruct rápido.
//
// A chave NUNCA fica no código: é lida da variável de ambiente OPENAI_API_KEY,
// definida no painel de hospedagem (ex.: Environment Variables do Coolify).

// --- Configuração lida a cada chamada (respeita mudanças em runtime) ---

function chaveOpenAI() {
  return (process.env.OPENAI_API_KEY || "").trim();
}

function baseOpenAI() {
  // Sem barra final. Aceita gateways compatíveis (OpenRouter, Azure OpenAI…).
  return (process.env.OPENAI_BASE_URL || "https://api.openai.com/v1").replace(/\/+$/, "");
}

// Defaults OSS de alta performance no OpenRouter (best-first). São só padrões —
// qualquer um pode ser trocado por OPENAI_MODEL / OPENAI_MODEL_AVALIACAO.
// Paciente (fala): instruct forte em pt-BR e rápido. Avaliação (parecer): modelo
// com raciocínio, melhor para a análise pedagógica contra a rubrica.
const MODELOS_PACIENTE_PADRAO = [
  "deepseek/deepseek-chat",
  "meta-llama/llama-3.3-70b-instruct",
  "qwen/qwen-2.5-72b-instruct",
];
const MODELOS_AVALIACAO_PADRAO = [
  "deepseek/deepseek-r1",
  "deepseek/deepseek-chat",
  "meta-llama/llama-3.3-70b-instruct",
];

// Uma string "a, b c" vira ["a","b","c"] → cadeia de fallback. Slugs não têm
// espaços, então separar por espaço/vírgula/quebra de linha é seguro.
function listaModelos(valor, padrao) {
  const itens = (valor || "").split(/[\s,]+/).map((m) => m.trim()).filter(Boolean);
  return itens.length ? itens : padrao;
}

function modelosPaciente() {
  return listaModelos(process.env.OPENAI_MODEL, MODELOS_PACIENTE_PADRAO);
}

function modelosAvaliacao() {
  // Sem OPENAI_MODEL_AVALIACAO: se o usuário fixou OPENAI_MODEL, respeita essa
  // escolha para ambas as tarefas; senão, usa a lista de avaliação padrão.
  return listaModelos(
    process.env.OPENAI_MODEL_AVALIACAO,
    process.env.OPENAI_MODEL ? modelosPaciente() : MODELOS_AVALIACAO_PADRAO,
  );
}

function urlOllama() {
  return process.env.OLLAMA_URL || "http://127.0.0.1:11434";
}

function modelo() {
  return process.env.PACIENTE_VIRTUAL_MODELO || "qwen3:8b";
}

const TIMEOUT_MS = Number(process.env.LLM_TIMEOUT_MS || 120000);

export function limparRaciocinio(texto) {
  // Remove blocos de raciocínio fechados E um <think> não fechado (quando o
  // orçamento de tokens corta a resposta antes do </think>, senão o pensamento
  // interno do modelo vazaria como fala do paciente).
  return (texto || "")
    .replace(/<think>[\s\S]*?<\/think>/g, "")
    .replace(/<think>[\s\S]*$/g, "")
    .trim();
}

// --- Backend OpenAI-compatível (com cadeia de fallback entre modelos) ---

async function chamarOpenAI(mensagens, modeloId) {
  const resposta = await fetch(`${baseOpenAI()}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${chaveOpenAI()}`,
    },
    body: JSON.stringify({ model: modeloId, messages: mensagens, stream: false }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!resposta.ok) {
    const corpo = await resposta.text().catch(() => "");
    throw new Error(`OpenAI/${modeloId} HTTP ${resposta.status} ${corpo.slice(0, 200)}`);
  }
  const dados = await resposta.json();
  const escolha = dados.choices && dados.choices[0];
  const saida = limparRaciocinio(escolha && escolha.message && escolha.message.content);
  if (!saida) throw new Error(`OpenAI/${modeloId} devolveu resposta vazia`);
  return saida;
}

async function conversarOpenAI(mensagens, modelos) {
  let ultimoErro;
  for (const m of modelos) {
    try {
      return await chamarOpenAI(mensagens, m);
    } catch (erro) {
      ultimoErro = erro; // cai para o próximo modelo da cadeia
    }
  }
  throw ultimoErro || new Error("Nenhum modelo OpenAI configurado");
}

// Streaming de UM modelo: /chat/completions com stream:true devolve SSE — linhas
// "data: {json}" e um "data: [DONE]" final; o texto vem em choices[0].delta.content.
async function streamOpenAIUm(mensagens, onDelta, modeloId) {
  const resposta = await fetch(`${baseOpenAI()}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${chaveOpenAI()}`,
    },
    body: JSON.stringify({ model: modeloId, messages: mensagens, stream: true }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!resposta.ok || !resposta.body) {
    const corpo = await resposta.text().catch(() => "");
    throw new Error(`OpenAI/${modeloId} HTTP ${resposta.status} ${corpo.slice(0, 200)}`);
  }

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
      if (!linha.startsWith("data:")) continue;
      const carga = linha.slice(5).trim();
      if (carga === "[DONE]") continue;
      let obj;
      try {
        obj = JSON.parse(carga);
      } catch {
        continue;
      }
      const t = obj.choices && obj.choices[0] && obj.choices[0].delta && obj.choices[0].delta.content;
      if (t) {
        bruto += t;
        onDelta(t);
      }
    }
  }
  const saida = limparRaciocinio(bruto);
  if (!saida) throw new Error(`OpenAI/${modeloId} devolveu resposta vazia`);
  return saida;
}

async function conversarStreamOpenAI(mensagens, onDelta, modelos) {
  let ultimoErro;
  for (const m of modelos) {
    let emitido = false;
    try {
      return await streamOpenAIUm(mensagens, (t) => {
        emitido = true;
        onDelta(t);
      }, m);
    } catch (erro) {
      ultimoErro = erro;
      // Se este modelo já mostrou texto na tela, não dá para trocar no meio:
      // propaga o erro. Só cai para o próximo se falhou antes do primeiro token.
      if (emitido) throw erro;
    }
  }
  throw ultimoErro || new Error("Nenhum modelo OpenAI configurado (stream)");
}

// --- Backend Ollama local ---

async function conversarOllama(mensagens) {
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

// num_predict menor: fala do paciente é curta → gera rápido.
async function conversarStreamOllama(mensagens, onDelta) {
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

// --- Despacho ---

// opts.avaliacao=true usa a lista de modelos de avaliação (parecer pedagógico);
// opts.modelos força uma lista específica. Sem chave OpenAI, cai no Ollama.
export async function conversar(mensagens, opts = {}) {
  if (!chaveOpenAI()) return conversarOllama(mensagens);
  const modelos = opts.modelos || (opts.avaliacao ? modelosAvaliacao() : modelosPaciente());
  return conversarOpenAI(mensagens, modelos);
}

// Igual a conversar, mas em STREAMING (a fala do paciente aparece conforme é
// gerada). Sempre usa a lista de modelos do paciente.
export async function conversarStream(mensagens, onDelta, opts = {}) {
  if (!chaveOpenAI()) return conversarStreamOllama(mensagens, onDelta);
  const modelos = opts.modelos || modelosPaciente();
  return conversarStreamOpenAI(mensagens, onDelta, modelos);
}
