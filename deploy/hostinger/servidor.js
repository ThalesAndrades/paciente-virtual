// Servidor Node do Paciente Virtual — pronto para a hospedagem Node.js da
// Hostinger (hPanel) ou qualquer host com Node >= 18. Zero dependências.
//
// Serve a mesma página única do protótipo (paciente_virtual/web/static/) e a
// mesma API JSON do servidor Flask, reutilizando os casos e rubricas do
// repositório. Sem um Ollama acessível (OLLAMA_URL), o paciente responde em
// modo demonstração — e a avaliação objetiva funciona normalmente.
//
// Variáveis de ambiente: PORT (a Hostinger define), HOST, OLLAMA_URL,
// PACIENTE_VIRTUAL_MODELO.

import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { montarPromptAvaliacao, extrairTextoProfissional, pontuarChecklist } from "./motor/avaliador.js";
import { AVISO_DEMO, responderDemo, fatoSensivelDireto } from "./motor/demo.js";
import { detectarExames } from "./motor/exames.js";
import { conversar } from "./motor/ia.js";
import { responderComoPaciente } from "./motor/humanizar.js";
import { ttsInfo, sintetizar } from "./motor/tts.js";
import { estruturarTranscript, extrairMetadados } from "./motor/relatorio.js";

const DIR_APP = path.dirname(fileURLToPath(import.meta.url));
const RAIZ = path.resolve(DIR_APP, "..", "..");
const DIR_CASOS = path.join(RAIZ, "casos");
const DIR_AVALIACOES = path.join(RAIZ, "avaliacoes");
const DIR_HISTORICO = path.join(RAIZ, "historico");
const PAGINA = path.join(RAIZ, "paciente_virtual", "web", "static", "index.html");

const AVISO_SEM_PARECER =
  "Parecer pedagógico indisponível (modelo de linguagem fora do ar). " +
  "A nota objetiva acima não depende do modelo.";
const AVISO_SEM_RUBRICA = "Este caso não tem rubrica de avaliação cadastrada.";

const consultas = new Map();

function lerJson(caminho) {
  return JSON.parse(fs.readFileSync(caminho, "utf-8"));
}

function listarCasos() {
  return fs
    .readdirSync(DIR_CASOS)
    .filter((nome) => nome.endsWith(".json"))
    .sort()
    .map((nome) => {
      const id = nome.replace(/\.json$/, "");
      const caso = lerJson(path.join(DIR_CASOS, nome));
      const ident = caso.identificacao || {};
      return {
        id,
        titulo: caso.titulo || id.replaceAll("_", " ").replace(/^./, (c) => c.toUpperCase()),
        queixa: caso.queixa_principal || "",
        paciente: {
          nome: ident.nome || "",
          idade: ident.idade || "",
          sexo: ident.sexo || "",
          profissao: ident.profissao || "",
        },
        voz: ident.voz || "feminino",
      };
    });
}

function carregarRubrica(casoId) {
  const caminho = path.join(DIR_AVALIACOES, `${casoId}.json`);
  if (!fs.existsSync(caminho)) return null;
  return lerJson(caminho);
}

function casoDoTranscript(nomeArquivo, texto) {
  const { caso } = extrairMetadados(texto);
  if (caso) return caso;

  // Compatibilidade com históricos antigos, sem cabeçalho de metadados.
  const rubricas = fs
    .readdirSync(DIR_AVALIACOES)
    .filter((nome) => nome.endsWith(".json"))
    .map((nome) => nome.replace(/\.json$/, ""))
    .sort((a, b) => b.length - a.length);
  const base = nomeArquivo.replace(/\.txt$/, "");
  return rubricas.find((id) => base === id || base.startsWith(`${id}_`)) || null;
}

function resumirTranscript(nomeArquivo, texto) {
  const metadados = extrairMetadados(texto);
  const caso = casoDoTranscript(nomeArquivo, texto);

  let nota = null;
  const rubrica = caso ? carregarRubrica(caso) : null;
  if (rubrica) {
    nota = pontuarChecklist(rubrica, extrairTextoProfissional(texto)).nota_total;
  }

  return {
    arquivo: nomeArquivo,
    caso,
    aluno: metadados.aluno,
    inicio: metadados.inicio,
    encerrada: metadados.encerrada,
    nota,
  };
}

function transcriptsGravados() {
  try {
    return fs
      .readdirSync(DIR_HISTORICO)
      .filter((nome) => nome.endsWith(".txt"))
      .sort()
      .reverse();
  } catch {
    return [];
  }
}

function listarRelatorio() {
  return transcriptsGravados().map((nome) =>
    resumirTranscript(nome, fs.readFileSync(path.join(DIR_HISTORICO, nome), "utf-8"))
  );
}

function detalharRelatorio(nomeArquivo) {
  // Compara com a listagem real do diretório — nunca monta caminho com a
  // entrada do usuário (evita path traversal).
  if (!transcriptsGravados().includes(nomeArquivo)) return null;

  const texto = fs.readFileSync(path.join(DIR_HISTORICO, nomeArquivo), "utf-8");
  const detalhe = resumirTranscript(nomeArquivo, texto);
  detalhe.eventos = estruturarTranscript(texto);

  const rubrica = detalhe.caso ? carregarRubrica(detalhe.caso) : null;
  detalhe.checklist = rubrica
    ? pontuarChecklist(rubrica, extrairTextoProfissional(texto))
    : null;

  return detalhe;
}

function agora() {
  return new Date().toISOString().replace("T", " ").slice(0, 19);
}

function iniciarTranscript(casoId, aluno) {
  const linha = "=".repeat(50);
  return [linha, `CASO: ${casoId}`, `ALUNO: ${aluno}`, `INICIO: ${agora()}`, linha, ""].join("\n");
}

function salvarTranscript(consulta) {
  // Melhor esforço: em hospedagens com sistema de arquivos somente leitura,
  // a consulta segue funcionando (a avaliação usa o texto em memória).
  try {
    fs.mkdirSync(DIR_HISTORICO, { recursive: true });
    const aluno =
      consulta.aluno.replace(/[^\p{L}\p{N}\s-]/gu, "").trim().replace(/\s+/g, "_") || "aluno";
    const momento = new Date()
      .toISOString()
      .replace(/[-:T]/g, "")
      .slice(0, 14)
      .replace(/^(\d{8})/, "$1_");
    const nome = `${consulta.casoId}_${aluno}_${momento}.txt`;
    fs.writeFileSync(path.join(DIR_HISTORICO, nome), consulta.transcript, "utf-8");
    return nome;
  } catch {
    return null;
  }
}

function json(res, status, corpo) {
  const dados = JSON.stringify(corpo);
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(dados);
}

function lerCorpo(req) {
  return new Promise((resolver, rejeitar) => {
    const pedacos = [];
    let tamanho = 0;
    req.on("data", (pedaco) => {
      tamanho += pedaco.length;
      if (tamanho > 1024 * 1024) {
        rejeitar(new Error("Corpo grande demais."));
        req.destroy();
        return;
      }
      pedacos.push(pedaco);
    });
    req.on("end", () => {
      try {
        const texto = Buffer.concat(pedacos).toString("utf-8");
        resolver(texto ? JSON.parse(texto) : {});
      } catch {
        resolver({});
      }
    });
    req.on("error", rejeitar);
  });
}

async function iniciarConsulta(req, res) {
  const dados = await lerCorpo(req);
  const casoId = String(dados.caso || "").trim();
  const aluno = String(dados.aluno || "").trim() || "aluno";

  const disponiveis = new Set(listarCasos().map((caso) => caso.id));
  if (!disponiveis.has(casoId)) {
    return json(res, 404, { erro: "Caso não encontrado." });
  }

  const caso = lerJson(path.join(DIR_CASOS, `${casoId}.json`));
  const ident = caso.identificacao || {};
  const id = crypto.randomUUID().slice(0, 8);

  consultas.set(id, {
    caso,
    casoId,
    aluno,
    voz: ident.voz || "feminino",
    transcript: iniciarTranscript(casoId, aluno),
    encerrada: false,
  });

  json(res, 200, {
    id,
    caso: casoId,
    voz: ident.voz || "feminino",
    paciente: {
      nome: ident.nome || "",
      idade: ident.idade || "",
      sexo: ident.sexo || "",
      profissao: ident.profissao || "",
    },
  });
}

function consultaAtiva(res, id) {
  const consulta = consultas.get(id);
  if (!consulta) {
    json(res, 404, { erro: "Consulta não encontrada." });
    return null;
  }
  if (consulta.encerrada) {
    json(res, 409, { erro: "Consulta já encerrada." });
    return null;
  }
  return consulta;
}

async function enviarMensagem(req, res, id) {
  const consulta = consultaAtiva(res, id);
  if (!consulta) return;

  const dados = await lerCorpo(req);
  const texto = String(dados.texto || "").trim();
  if (!texto) {
    return json(res, 400, { erro: "Mensagem vazia." });
  }

  consulta.transcript += `\nPROFISSIONAL: ${texto}\n`;

  const eventos = [];
  const exames = detectarExames(texto, consulta.caso);

  if (exames.length) {
    for (const [titulo, dadosExame] of exames) {
      consulta.transcript += `\n${titulo}: ${dadosExame.nome}\nRESULTADO: ${dadosExame.resultado}\n`;
      eventos.push({
        tipo: "exame",
        titulo,
        nome: dadosExame.nome,
        resultado: dadosExame.resultado,
      });
    }
    return json(res, 200, { eventos });
  }

  // Portão determinístico do sensível: só entrega o tema delicado à IA se o
  // profissional perguntou diretamente sobre ele (revelação gradual garantida).
  const fatoLiberado = fatoSensivelDireto(consulta.caso, texto);

  let resposta;
  let origem;
  try {
    // A IA responde como o paciente a partir do contexto NÃO-sensível + o fato
    // liberado (quando houver). Cobre qualquer fraseado de pergunta comum.
    resposta = await responderComoPaciente(consulta.caso, texto, fatoLiberado);
    origem = "ia";
  } catch {
    // Sem IA acessível, cai no matcher de demonstração (fixo, mas correto).
    resposta = responderDemo(consulta.caso, texto);
    origem = "demo";
    eventos.push({ tipo: "aviso", texto: AVISO_DEMO });
  }

  consulta.transcript += `\nPACIENTE: ${resposta}\n`;

  eventos.push({ tipo: "paciente", texto: resposta, origem });
  json(res, 200, { eventos });
}

async function encerrarConsulta(res, id) {
  const consulta = consultaAtiva(res, id);
  if (!consulta) return;

  consulta.transcript += `\nENCERRADA: ${agora()}\n`;
  consulta.encerrada = true;

  const arquivo = salvarTranscript(consulta);
  const resultado = { transcript: arquivo || "(não gravado neste servidor)" };

  const rubrica = carregarRubrica(consulta.casoId);
  if (!rubrica) {
    resultado.aviso = AVISO_SEM_RUBRICA;
    return json(res, 200, resultado);
  }

  resultado.checklist = pontuarChecklist(rubrica, extrairTextoProfissional(consulta.transcript));

  try {
    resultado.parecer = await conversar([
      { role: "user", content: montarPromptAvaliacao(rubrica, consulta.transcript) },
    ]);
  } catch {
    resultado.parecer = null;
    resultado.aviso = AVISO_SEM_PARECER;
  }

  json(res, 200, resultado);
}

export function criarServidor() {
  return http.createServer(async (req, res) => {
    const { pathname } = new URL(req.url, "http://localhost");

    try {
      // Verificação de saúde para o painel da Hostinger / monitoramento de uptime.
      if (req.method === "GET" && (pathname === "/healthz" || pathname === "/api/health")) {
        return json(res, 200, {
          status: "ok",
          modo: process.env.OLLAMA_URL ? "ia" : "demonstracao",
        });
      }

      if (req.method === "GET" && pathname === "/favicon.ico") {
        res.writeHead(204);
        return res.end();
      }

      if (req.method === "GET" && (pathname === "/" || pathname === "/index.html")) {
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        return res.end(fs.readFileSync(PAGINA));
      }

      if (req.method === "GET" && pathname === "/api/casos") {
        return json(res, 200, listarCasos());
      }

      if (req.method === "GET" && pathname === "/api/relatorio") {
        return json(res, 200, listarRelatorio());
      }

      const relatorio = pathname.match(/^\/api\/relatorio\/([^/]+)$/);
      if (req.method === "GET" && relatorio) {
        const detalhe = detalharRelatorio(decodeURIComponent(relatorio[1]));
        if (!detalhe) return json(res, 404, { erro: "Consulta não encontrada." });
        return json(res, 200, detalhe);
      }

      if (req.method === "GET" && pathname === "/api/voz") {
        return json(res, 200, ttsInfo());
      }

      if (req.method === "POST" && pathname === "/api/falar") {
        const dados = await lerCorpo(req);
        const texto = String(dados.texto || "").trim();
        const voz = dados.voz === "masculino" ? "masculino" : "feminino";
        if (!texto) return json(res, 400, { erro: "Texto vazio." });
        try {
          const { buffer, mime } = await sintetizar(texto.slice(0, 1200), voz);
          res.writeHead(200, { "Content-Type": mime, "Content-Length": buffer.length, "Cache-Control": "no-store" });
          return res.end(buffer);
        } catch (erro) {
          return json(res, 502, { erro: `Falha na síntese de voz: ${erro.message}` });
        }
      }

      if (req.method === "POST" && pathname === "/api/consultas") {
        return await iniciarConsulta(req, res);
      }

      const mensagem = pathname.match(/^\/api\/consultas\/([\w-]+)\/mensagem$/);
      if (req.method === "POST" && mensagem) {
        return await enviarMensagem(req, res, mensagem[1]);
      }

      const encerrar = pathname.match(/^\/api\/consultas\/([\w-]+)\/encerrar$/);
      if (req.method === "POST" && encerrar) {
        return await encerrarConsulta(res, encerrar[1]);
      }

      if (pathname.startsWith("/api/")) {
        return json(res, 404, { erro: "Rota não encontrada." });
      }

      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Não encontrado");
    } catch (erro) {
      json(res, 500, { erro: `Erro interno: ${erro.message}` });
    }
  });
}

export function iniciar() {
  const bruto = process.env.PORT || process.env.PACIENTE_VIRTUAL_PORTA || 3000;
  const servidor = criarServidor();

  const anunciar = () => {
    const onde = servidor.address();
    const alvo = typeof onde === "string" ? onde : `http://${onde.address}:${onde.port}`;
    console.log(`Paciente Virtual (Node) em ${alvo}`);
  };

  // Porta numérica (Hostinger define PORT) ou caminho de socket Unix, que o
  // Phusion Passenger pode entregar em PORT em vez de um número.
  if (/^\d+$/.test(String(bruto))) {
    servidor.listen(Number(bruto), process.env.HOST || "0.0.0.0", anunciar);
  } else {
    servidor.listen(String(bruto), anunciar);
  }

  // Encerramento limpo quando a hospedagem reinicia a aplicação.
  const encerrar = () => servidor.close(() => process.exit(0));
  process.on("SIGTERM", encerrar);
  process.on("SIGINT", encerrar);

  return servidor;
}

const executadoDiretamente =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (executadoDiretamente) {
  iniciar();
}
