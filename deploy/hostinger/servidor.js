// Servidor Node do Paciente Virtual — pronto para a hospedagem Node.js da
// Hostinger (hPanel) ou qualquer host com Node >= 18. Zero dependências.
//
// Serve a página única (web/index.html) e a API JSON, lendo os casos e as
// rubricas do repositório. Sem modelo de linguagem acessível, o paciente responde
// em modo demonstração — e a avaliação objetiva funciona normalmente.
//
// Variáveis de ambiente: ver deploy/hostinger/README.md.

import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  autenticar,
  cabecalhoSaida,
  cabecalhoSessao,
  ehAluno,
  ehProfessor,
  estadoAcesso,
  painelDisponivel,
  sessaoDe,
} from "./motor/acesso.js";
import { montarPromptAvaliacao, extrairTextoProfissional, pontuarChecklist } from "./motor/avaliador.js";
import { AVISO_DEMO, responderDemo, fatoSensivelDireto } from "./motor/demo.js";
import { CHAVES_VITAIS, detectarExames } from "./motor/exames.js";
import { conversar } from "./motor/ia.js";
import { podarHistorico, responderComoPaciente, responderComoPacienteStream } from "./motor/humanizar.js";
import { dentroDoLimite, ipDe, segundosAteLiberar } from "./motor/limite.js";
import { ttsInfo, sintetizar, instrucaoDeVoz } from "./motor/tts.js";
import { transcrever } from "./motor/transcricao.js";
import { estruturarTranscript, extrairMetadados } from "./motor/relatorio.js";

const DIR_APP = path.dirname(fileURLToPath(import.meta.url));
const RAIZ = path.resolve(DIR_APP, "..", "..");
const DIR_CASOS = path.join(RAIZ, "casos");
const DIR_AVALIACOES = path.join(RAIZ, "avaliacoes");
const DIR_HISTORICO = path.join(RAIZ, "historico");
const PAGINA = path.join(RAIZ, "web", "index.html");

const AVISO_SEM_PARECER =
  "Parecer pedagógico indisponível (modelo de linguagem fora do ar). " +
  "A nota objetiva acima não depende do modelo.";
const AVISO_SEM_RUBRICA = "Este caso não tem rubrica de avaliação cadastrada.";
const AVISO_IA_INTERROMPIDA =
  "A resposta do paciente foi interrompida no meio (falha no modelo de linguagem). " +
  "Pergunte de novo para ouvir a resposta completa.";

// Teto do que é enviado ao modelo por turno. Uma pergunta de consulta tem dezenas
// de caracteres; o teto existe só para um corpo abusivo não virar conta de API.
const MAX_CARACTERES_PERGUNTA = 2000;

// Tetos por IP numa janela de 5 minutos. Folgados para uma turma inteira usando ao
// mesmo tempo, apertados o bastante para um script não esvaziar o crédito.
const JANELA_MS = 5 * 60 * 1000;
const LIMITE_MENSAGENS = 60;
const LIMITE_CONSULTAS = 20;
const LIMITE_VOZ = 400; // uma frase = uma síntese; uma consulta falada gasta dezenas
const LIMITE_AUDIO = 120;
const LIMITE_LOGIN = 20;

// Áudio de uma fala do profissional. ~1 MB por minuto em webm/opus; o teto cobre
// uma pergunta longa com folga e barra upload abusivo.
const MAX_BYTES_AUDIO = 12 * 1024 * 1024;

const consultas = new Map();

// Quando o modelo falha, o aluno só vê "modo demonstração" — e quem administra não
// tem como saber se foi chave errada, cota estourada ou modelo sem acesso. Sem este
// registro o diagnóstico depende de adivinhação.
let ultimaFalhaIA = null;
function registrarFalhaIA(onde, erro) {
  const mensagem = (erro && erro.message) || String(erro);
  ultimaFalhaIA = { onde, mensagem: mensagem.slice(0, 300), quando: new Date().toISOString() };
  console.error(`[ia] falha em ${onde}: ${mensagem.slice(0, 300)}`);
}

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
        categoria: caso.categoria === "medicina" ? "medicina" : "psicologia",
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

// Instrumentos que o profissional pode acionar por clique (só faz sentido pleno na
// medicina): sinais vitais, manobras de exame físico e exames complementares.
function instrumentosDoCaso(caso) {
  const grupos = { vitais: [], fisico: [], exames: [] };
  for (const [chave, dados] of Object.entries(caso.exame_fisico || {})) {
    if (!dados || typeof dados !== "object") continue;
    const item = { chave, nome: dados.nome || chave.replaceAll("_", " ") };
    (CHAVES_VITAIS.has(chave) ? grupos.vitais : grupos.fisico).push(item);
  }
  for (const [chave, dados] of Object.entries(caso.exames_disponiveis || {})) {
    if (!dados || typeof dados !== "object") continue;
    grupos.exames.push({ chave, nome: dados.nome || chave.replaceAll("_", " ") });
  }
  return grupos;
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

  // Só no detalhe: a listagem não precisa carregar o texto do raciocínio de todos.
  const metadados = extrairMetadados(texto);
  detalhe.hipotese = metadados.hipotese;
  detalhe.diferenciais = metadados.diferenciais;
  detalhe.conduta = metadados.conduta;
  detalhe.anotacoes = metadados.anotacoes;

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
    // Sufixo aleatório: dois transcripts do mesmo caso+aluno no mesmo segundo
    // não se sobrescrevem no disco (turma rodando o mesmo caso em paralelo).
    const sufixo = crypto.randomUUID().slice(0, 6);
    const nome = `${consulta.casoId}_${aluno}_${momento}_${sufixo}.txt`;
    fs.writeFileSync(path.join(DIR_HISTORICO, nome), consulta.transcript, "utf-8");
    return nome;
  } catch {
    return null;
  }
}

function json(res, status, corpo, cabecalhos = {}) {
  // Se os cabeçalhos já foram enviados (ex.: erro no meio de uma resposta),
  // um segundo writeHead lançaria ERR_HTTP_HEADERS_ALREADY_SENT e derrubaria o
  // processo. Aborta a conexão em vez de tentar reescrever o cabeçalho.
  if (res.headersSent) {
    res.destroy();
    return;
  }
  const dados = JSON.stringify(corpo);
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", ...cabecalhos });
  res.end(dados);
}

// true = já respondeu 429 e o chamador deve parar.
//
// Conta por SESSÃO quando existe uma: numa escola a turma toda sai por um único IP
// público, e contar por IP faria um aluno usando voz derrubar a voz dos colegas.
// Sem sessão (login, rotas abertas) cai no IP, que é o que sobra.
function estourouLimite(req, res, balde, max) {
  const chave = `${balde}:${sessaoDe(req) || ipDe(req)}`;
  if (dentroDoLimite(chave, max, JANELA_MS)) return false;
  json(
    res,
    429,
    { erro: "Muitas requisições em pouco tempo. Aguarde um instante e tente de novo." },
    { "Retry-After": String(segundosAteLiberar(chave)) }
  );
  return true;
}

// A conexão chega ao Traefik por https e é repassada em http — o cookie precisa
// olhar o cabeçalho encaminhado para saber se pode ser Secure.
function conexaoSegura(req) {
  const proto = req.headers["x-forwarded-proto"];
  if (proto) return String(proto).split(",")[0].trim() === "https";
  return Boolean(req.socket && req.socket.encrypted);
}

// Corpo binário (upload de áudio). Separado de lerCorpo, que é JSON e tem teto de 1 MB.
function lerCorpoBinario(req, maxBytes) {
  return new Promise((resolver, rejeitar) => {
    const pedacos = [];
    let tamanho = 0;
    req.on("data", (pedaco) => {
      tamanho += pedaco.length;
      if (tamanho > maxBytes) {
        rejeitar(new Error("Áudio grande demais."));
        req.destroy();
        return;
      }
      pedacos.push(pedaco);
    });
    req.on("end", () => resolver(Buffer.concat(pedacos)));
    req.on("error", rejeitar);
  });
}

async function responderLogin(req, res, papelPedido, campo) {
  if (estourouLimite(req, res, "login", LIMITE_LOGIN)) return;
  const dados = await lerCorpo(req);
  const papel = autenticar(papelPedido, dados[campo]);
  if (!papel) {
    const erro =
      papelPedido === "professor" && !painelDisponivel()
        ? "Painel do professor desativado neste servidor."
        : "Código incorreto.";
    return json(res, 401, { erro });
  }
  json(res, 200, { ok: true, papel }, { "Set-Cookie": cabecalhoSessao(papel, conexaoSegura(req)) });
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
  // id curto único: nunca sobrescreve uma consulta viva por colisão de truncamento.
  let id;
  do {
    id = crypto.randomUUID().slice(0, 8);
  } while (consultas.has(id));

  // Poda de segurança: evita o Map crescer sem limite com consultas abandonadas.
  // Remove SÓ consultas encerradas — uma sessão em andamento nunca é despejada,
  // mesmo sob pico (senão o aluno perderia a consulta no meio da estação).
  if (consultas.size >= 800) {
    let remover = consultas.size - 600;
    for (const [k, c] of consultas) {
      if (remover <= 0) break;
      if (c.encerrada) {
        consultas.delete(k);
        remover--;
      }
    }
  }

  consultas.set(id, {
    caso,
    casoId,
    aluno,
    voz: ident.voz || "feminino",
    transcript: iniciarTranscript(casoId, aluno),
    encerrada: false,
    // Métricas da estação: quanto durou e quanto o aluno de fato fez. Aparecem no
    // resultado para ele comparar consultas entre si.
    iniciadaEm: Date.now(),
    perguntas: 0,
    exames: 0,
    // Memória da conversa: sem ela o paciente repetia a fala anterior e não tinha
    // como "contar mais" sobre nada.
    historico: [],
  });

  json(res, 200, {
    id,
    caso: casoId,
    categoria: caso.categoria === "medicina" ? "medicina" : "psicologia",
    voz: ident.voz || "feminino",
    paciente: {
      nome: ident.nome || "",
      idade: ident.idade || "",
      sexo: ident.sexo || "",
      profissao: ident.profissao || "",
      estado_civil: ident.estado_civil || "",
      escolaridade: ident.escolaridade || "",
    },
    instrumentos: instrumentosDoCaso(caso),
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
  const bruto = String(dados.texto || "").trim();
  if (!bruto) {
    return json(res, 400, { erro: "Mensagem vazia." });
  }
  const texto = bruto.slice(0, MAX_CARACTERES_PERGUNTA);

  consulta.transcript += `\nPROFISSIONAL: ${texto}\n`;
  consulta.perguntas += 1;

  const streaming = new URL(req.url, "http://localhost").searchParams.get("stream") === "1";
  const exames = detectarExames(texto, consulta.caso);
  // O paciente sente o procedimento acontecer e reage a ele — antes o turno do exame
  // era mudo, e perguntar "posso ver sua pressão? como a senhora está?" devolvia só
  // o número, sem ninguém do outro lado.
  const examesEntregues = exames.map(([, dadosExame]) => dadosExame);
  const fatoLiberado = fatoSensivelDireto(consulta.caso, texto);

  const registrarExames = (emitirEvento) => {
    for (const [titulo, dadosExame] of exames) {
      consulta.transcript += `\n${titulo}: ${dadosExame.nome}\nRESULTADO: ${dadosExame.resultado}\n`;
      consulta.exames += 1;
      emitirEvento({ tipo: "exame", titulo, nome: dadosExame.nome, resultado: dadosExame.resultado });
    }
  };

  // ---------- Caminho STREAMING (fala do paciente aparece conforme é gerada) ----------
  if (streaming) {
    res.writeHead(200, {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no", // não bufferizar atrás de proxy
    });
    const emitir = (obj) => {
      try {
        res.write(JSON.stringify(obj) + "\n");
      } catch {}
    };

    registrarExames(emitir);

    let acc = "";
    let resposta = "";
    let origem = "ia";
    try {
      resposta = await responderComoPacienteStream(
        consulta.caso,
        texto,
        fatoLiberado,
        (t) => {
          acc += t;
          emitir({ tipo: "delta", t });
        },
        examesEntregues,
        consulta.historico
      );
    } catch (erro) {
      registrarFalhaIA("fala do paciente (stream)", erro);
      if (acc) {
        // IA caiu depois do primeiro token: não dá para refazer a fala sem duplicar o
        // que já apareceu na tela. Mantém o trecho e AVISA — antes o aluno recebia
        // uma frase cortada achando que era o jeito do paciente.
        resposta = acc;
        emitir({ tipo: "aviso", texto: AVISO_IA_INTERROMPIDA });
      } else {
        resposta = responderDemo(consulta.caso, texto);
        origem = "demo";
        emitir({ tipo: "aviso", texto: AVISO_DEMO });
        emitir({ tipo: "delta", t: resposta });
      }
    }

    if (consulta.encerrada || !consultas.has(id)) {
      emitir({ tipo: "fim", origem, encerrada: true });
      return res.end();
    }
    consulta.transcript += `\nPACIENTE: ${resposta}\n`;
    lembrarTurno(consulta, texto, resposta);
    emitir({ tipo: "fim", origem });
    return res.end();
  }

  // ---------- Caminho JSON (fallback + testes) ----------
  const eventos = [];
  registrarExames((evento) => eventos.push(evento));

  let resposta;
  let origem;
  try {
    resposta = await responderComoPaciente(
      consulta.caso,
      texto,
      fatoLiberado,
      examesEntregues,
      consulta.historico
    );
    origem = "ia";
  } catch (erro) {
    registrarFalhaIA("fala do paciente", erro);
    resposta = responderDemo(consulta.caso, texto);
    origem = "demo";
    eventos.push({ tipo: "aviso", texto: AVISO_DEMO });
  }

  // A consulta pode ter sido encerrada concorrentemente durante o await da IA.
  if (consulta.encerrada || !consultas.has(id)) {
    return json(res, 409, { erro: "Consulta já encerrada." });
  }

  consulta.transcript += `\nPACIENTE: ${resposta}\n`;
  lembrarTurno(consulta, texto, resposta);
  eventos.push({ tipo: "paciente", texto: resposta, origem });
  json(res, 200, { eventos });
}

// Uma linha por campo: mantém o transcript legível e o parser trivial.
function umaLinha(valor, limite) {
  return String(valor || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, limite);
}

// Guarda o turno na memória da conversa. Só o texto limpo: as instruções entre
// colchetes (revelar tema sensível, exame recém-feito) valem para AQUELE turno e
// se acumulariam como ruído nos próximos.
function lembrarTurno(consulta, pergunta, resposta) {
  consulta.historico.push({ role: "user", content: pergunta });
  consulta.historico.push({ role: "assistant", content: resposta });
  consulta.historico = podarHistorico(consulta.historico);
}

// Exame acionado por clique não passa pelo modelo — mas o paciente sentiu o
// procedimento acontecer, e sem este registro ele não teria como comentá-lo depois
// ("quando o senhor apertou minha barriga...").
function lembrarExame(consulta, titulo, nome) {
  consulta.historico.push({
    role: "user",
    content: `[O profissional realizou em você: ${titulo.toLowerCase()} — ${nome}. Você sentiu, mas não sabe o resultado.]`,
  });
  consulta.historico = podarHistorico(consulta.historico);
}

async function encerrarConsulta(req, res, id) {
  const consulta = consultaAtiva(res, id);
  if (!consulta) return;

  const corpo = await lerCorpo(req);
  // O fechamento é o raciocínio que o aluno assume ANTES de ver o gabarito. É o que
  // transforma a estação de "coletar dados" em "concluir alguma coisa".
  const fechamento = {
    hipotese: umaLinha(corpo.hipotese, 400),
    diferenciais: umaLinha(corpo.diferenciais, 600),
    conduta: umaLinha(corpo.conduta, 600),
  };
  const anotacoes = umaLinha(corpo.anotacoes, 2000);
  const temFechamento = Boolean(fechamento.hipotese || fechamento.diferenciais || fechamento.conduta);

  consulta.transcript += `\nENCERRADA: ${agora()}\n`;
  if (temFechamento) {
    if (fechamento.hipotese) consulta.transcript += `HIPOTESE: ${fechamento.hipotese}\n`;
    if (fechamento.diferenciais) consulta.transcript += `DIFERENCIAIS: ${fechamento.diferenciais}\n`;
    if (fechamento.conduta) consulta.transcript += `CONDUTA: ${fechamento.conduta}\n`;
  }
  if (anotacoes) consulta.transcript += `ANOTACOES: ${anotacoes}\n`;
  consulta.encerrada = true;

  const arquivo = salvarTranscript(consulta);
  const fidelidade = consulta.caso.fidelidade_clinica || {};
  const resultado = {
    transcript: arquivo || "(não gravado neste servidor)",
    estatisticas: {
      duracao_s: Math.round((Date.now() - consulta.iniciadaEm) / 1000),
      perguntas: consulta.perguntas,
      exames: consulta.exames,
    },
    // O gabarito só existe DEPOIS de encerrar — durante a consulta ele nunca sai do
    // servidor, senão bastaria abrir a aba de rede para ver o diagnóstico.
    gabarito: {
      diagnostico: fidelidade.diagnostico_subjacente || "",
      diferenciais: fidelidade.diferenciais_a_respeitar || [],
    },
    fechamento: temFechamento ? fechamento : null,
  };

  const rubrica = carregarRubrica(consulta.casoId);
  if (!rubrica) {
    resultado.aviso = AVISO_SEM_RUBRICA;
    consultas.delete(id); // transcrição já salva em disco — libera a memória
    return json(res, 200, resultado);
  }

  resultado.checklist = pontuarChecklist(rubrica, extrairTextoProfissional(consulta.transcript));

  try {
    resultado.parecer = await conversar(
      [
        {
          role: "user",
          content: montarPromptAvaliacao(
            rubrica,
            consulta.transcript,
            temFechamento ? fechamento : null,
            resultado.gabarito
          ),
        },
      ],
      { avaliacao: true },
    );
  } catch (erro) {
    registrarFalhaIA("parecer pedagógico", erro);
    resultado.parecer = null;
    resultado.aviso = AVISO_SEM_PARECER;
  }

  consultas.delete(id); // consulta encerrada e gravada — remove do Map
  json(res, 200, resultado);
}

export function criarServidor() {
  return http.createServer(async (req, res) => {
    const { pathname } = new URL(req.url, "http://localhost");

    try {
      // Verificação de saúde para o painel da Hostinger / monitoramento de uptime.
      if (req.method === "GET" && (pathname === "/healthz" || pathname === "/api/health")) {
        const backend = (process.env.OPENAI_API_KEY || "").trim()
          ? "openai"
          : process.env.OLLAMA_URL
            ? "ollama"
            : null;
        return json(res, 200, {
          status: "ok",
          modo: backend ? "ia" : "demonstracao",
          backend: backend || "demonstracao",
          painel_professor: painelDisponivel() ? "ativo" : "desativado",
        });
      }

      // Diagnóstico para quem administra. Restrito ao professor: a mensagem de erro
      // do provedor pode citar detalhes de conta e não é assunto de aluno.
      if (req.method === "GET" && pathname === "/api/diagnostico") {
        if (!ehProfessor(req)) return json(res, 403, { erro: "Restrito ao professor." });
        return json(res, 200, {
          backend: (process.env.OPENAI_API_KEY || "").trim()
            ? "openai"
            : process.env.OLLAMA_URL
              ? "ollama"
              : "demonstracao",
          modelo_paciente: process.env.OPENAI_MODEL || "(padrão)",
          modelo_avaliacao: process.env.OPENAI_MODEL_AVALIACAO || "(padrão)",
          voz: ttsInfo(),
          ultima_falha_ia: ultimaFalhaIA,
          consultas_ativas: consultas.size,
        });
      }

      if (req.method === "GET" && pathname === "/favicon.ico") {
        res.writeHead(204);
        return res.end();
      }

      if (req.method === "GET" && (pathname === "/" || pathname === "/index.html")) {
        // Lê ANTES de enviar cabeçalhos: se o arquivo falhar, o erro cai no catch
        // com headers ainda não enviados → 500 limpo, em vez de writeHead duplo
        // (que viraria unhandledRejection e derrubaria o processo p/ todos).
        const html = fs.readFileSync(PAGINA);
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        return res.end(html);
      }

      // ---- Acesso: a página pergunta o que já pode fazer, e troca credencial por sessão.
      if (req.method === "GET" && pathname === "/api/acesso") {
        return json(res, 200, estadoAcesso(req));
      }
      if (req.method === "POST" && pathname === "/api/acesso") {
        return await responderLogin(req, res, "aluno", "codigo");
      }
      if (req.method === "POST" && pathname === "/api/acesso/professor") {
        return await responderLogin(req, res, "professor", "senha");
      }
      if (req.method === "POST" && pathname === "/api/sair") {
        return json(res, 200, { ok: true }, { "Set-Cookie": cabecalhoSaida() });
      }

      // A vitrine (título, queixa, contagem por área) fica aberta: é o que a página
      // inicial mostra antes de pedir o código. O que custa dinheiro ou contém dado
      // pessoal — consulta, voz e transcrições — exige sessão.
      if (req.method === "GET" && pathname === "/api/casos") {
        return json(res, 200, listarCasos());
      }

      if (req.method === "GET" && pathname === "/api/relatorio") {
        if (!ehProfessor(req)) {
          return json(res, 403, {
            erro: painelDisponivel()
              ? "Painel restrito ao professor."
              : "Painel do professor desativado neste servidor.",
          });
        }
        return json(res, 200, listarRelatorio());
      }

      const relatorio = pathname.match(/^\/api\/relatorio\/([^/]+)$/);
      if (req.method === "GET" && relatorio) {
        if (!ehProfessor(req)) return json(res, 403, { erro: "Painel restrito ao professor." });
        const detalhe = detalharRelatorio(decodeURIComponent(relatorio[1]));
        if (!detalhe) return json(res, 404, { erro: "Consulta não encontrada." });
        return json(res, 200, detalhe);
      }

      if (req.method === "GET" && pathname === "/api/voz") {
        return json(res, 200, ttsInfo());
      }

      if (req.method === "POST" && pathname === "/api/falar") {
        if (!ehAluno(req)) return json(res, 401, { erro: "Sessão necessária." });
        if (estourouLimite(req, res, "voz", LIMITE_VOZ)) return;
        const dados = await lerCorpo(req);
        const texto = String(dados.texto || "").trim();
        const voz = dados.voz === "masculino" ? "masculino" : "feminino";
        if (!texto) return json(res, 400, { erro: "Texto vazio." });
        // A consulta dá o caso, e o caso dá a direção de atuação: a mesma frase é
        // lida de um jeito por quem está em pânico e de outro por quem está enlutada.
        const consulta = consultas.get(String(dados.consulta || ""));
        try {
          const { buffer, mime } = await sintetizar(
            texto.slice(0, 1200),
            voz,
            consulta ? instrucaoDeVoz(consulta.caso) : ""
          );
          res.writeHead(200, { "Content-Type": mime, "Content-Length": buffer.length, "Cache-Control": "no-store" });
          return res.end(buffer);
        } catch (erro) {
          return json(res, 502, { erro: `Falha na síntese de voz: ${erro.message}` });
        }
      }

      // O aluno fala, a página manda o áudio, o servidor devolve o texto. Existe para
      // o microfone funcionar fora do Chrome/Edge (Safari e iOS não têm Web Speech).
      if (req.method === "POST" && pathname === "/api/transcrever") {
        if (!ehAluno(req)) return json(res, 401, { erro: "Sessão necessária." });
        if (estourouLimite(req, res, "audio", LIMITE_AUDIO)) return;
        let audio;
        try {
          audio = await lerCorpoBinario(req, MAX_BYTES_AUDIO);
        } catch {
          return json(res, 413, { erro: "Áudio grande demais. Grave um trecho mais curto." });
        }
        if (!audio.length) return json(res, 400, { erro: "Áudio vazio." });
        try {
          const texto = await transcrever(audio, req.headers["content-type"]);
          return json(res, 200, { texto });
        } catch (erro) {
          // 422: houve áudio, mas nada aproveitável — a página pede para repetir em
          // vez de enviar uma pergunta em branco ao paciente.
          return json(res, 422, { erro: `Não consegui entender o áudio: ${erro.message}` });
        }
      }

      // Daqui para baixo, tudo mexe numa consulta: exige sessão de aluno.
      if (pathname.startsWith("/api/consultas") && !ehAluno(req)) {
        return json(res, 401, { erro: "Sessão expirada. Informe o código de acesso de novo." });
      }

      if (req.method === "POST" && pathname === "/api/consultas") {
        if (estourouLimite(req, res, "consultas", LIMITE_CONSULTAS)) return;
        return await iniciarConsulta(req, res);
      }

      const mensagem = pathname.match(/^\/api\/consultas\/([\w-]+)\/mensagem$/);
      if (req.method === "POST" && mensagem) {
        if (estourouLimite(req, res, "mensagens", LIMITE_MENSAGENS)) return;
        return await enviarMensagem(req, res, mensagem[1]);
      }

      // Instrumento por clique: devolve direto o resultado do exame/sinal vital.
      const exame = pathname.match(/^\/api\/consultas\/([\w-]+)\/exame$/);
      if (req.method === "POST" && exame) {
        const consulta = consultaAtiva(res, exame[1]);
        if (!consulta) return;
        const dados = await lerCorpo(req);
        const chave = String(dados.chave || "");
        const noFisico = (consulta.caso.exame_fisico || {})[chave];
        const noComplementar = (consulta.caso.exames_disponiveis || {})[chave];
        const item = noFisico || noComplementar;
        if (!item || typeof item !== "object") {
          return json(res, 404, { erro: "Instrumento não disponível neste caso." });
        }
        const titulo = noFisico ? "EXAME FÍSICO" : "EXAME SOLICITADO";
        consulta.transcript += `\n${titulo}: ${item.nome}\nRESULTADO: ${item.resultado}\n`;
        consulta.exames += 1;
        lembrarExame(consulta, titulo, item.nome);
        return json(res, 200, {
          eventos: [{ tipo: "exame", titulo, nome: item.nome, resultado: item.resultado }],
        });
      }

      const encerrar = pathname.match(/^\/api\/consultas\/([\w-]+)\/encerrar$/);
      if (req.method === "POST" && encerrar) {
        return await encerrarConsulta(req, res, encerrar[1]);
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
