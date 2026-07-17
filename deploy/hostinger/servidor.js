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
import { AVISO_DEMO, responderDemo } from "./motor/demo.js";
import { contextoParaPaciente, detectarExames } from "./motor/exames.js";
import { conversar } from "./motor/ia.js";
import { criarPrompt } from "./motor/prompt.js";

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
    mensagens: [{ role: "system", content: criarPrompt(caso) }],
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
    consulta.mensagens.push({
      role: "system",
      content: contextoParaPaciente(exames.map(([, dadosExame]) => dadosExame)),
    });
    return json(res, 200, { eventos });
  }

  consulta.mensagens.push({ role: "user", content: texto });

  let resposta;
  let origem;
  try {
    resposta = await conversar(consulta.mensagens);
    origem = "ia";
  } catch {
    resposta = responderDemo(consulta.caso, texto);
    origem = "demo";
    eventos.push({ tipo: "aviso", texto: AVISO_DEMO });
  }

  consulta.mensagens.push({ role: "assistant", content: resposta });
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
      if (req.method === "GET" && (pathname === "/" || pathname === "/index.html")) {
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        return res.end(fs.readFileSync(PAGINA));
      }

      if (req.method === "GET" && pathname === "/api/casos") {
        return json(res, 200, listarCasos());
      }

      if (req.method === "GET" && pathname === "/api/voz") {
        // Sem motores locais no Node: a página usa a Web Speech API.
        return json(res, 200, { stt: false, tts: { feminino: false, masculino: false } });
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

const executadoDiretamente =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (executadoDiretamente) {
  const porta = Number(process.env.PORT || process.env.PACIENTE_VIRTUAL_PORTA || 3000);
  const host = process.env.HOST || "0.0.0.0";
  criarServidor().listen(porta, host, () => {
    console.log(`Paciente Virtual (Node) em http://${host}:${porta}`);
  });
}
