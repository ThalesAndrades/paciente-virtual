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

import { toNodeHandler } from "better-auth/node";

import {
  auth,
  contarUsuarios,
  criarUsuario,
  criarUsuarioPublico,
  definirAtivo,
  definirPapel,
  definirSenha,
  listarUsuarios,
  migrar,
  semearAdmin,
} from "./motor/auth.js";
import {
  assinaturaDoUsuario,
  creditar,
  darBoasVindas,
  debitar,
  estornar,
  extrato,
  migrarCreditos,
  pagamentosDoUsuario,
  // `saldo` já é o nome do que sobra de MINUTOS de voz em `orcamento.js`. Aqui é
  // dinheiro do aluno; misturar os dois num arquivo de 1.100 linhas seria pedir
  // para alguém debitar a coisa errada.
  saldo as saldoDeCreditos,
} from "./motor/creditos.js";
import {
  cobrarCartao,
  cobrarPix,
  conferirCartao,
  conferirPix,
  provedoresDisponiveis,
  tratarEventoStripe,
  tratarEventoWoovi,
  verificarAssinaturaStripe,
} from "./motor/pagamentos.js";
import { CUSTO, EXPERIENCIA_COMPLETA, catalogo, itemPorId } from "./motor/planos.js";
import {
  carregarSessao,
  ehAdmin,
  ehAluno,
  ehProfessor,
  emailDe,
  estadoAcesso,
  matriculaDe,
  nomeDe,
  painelDisponivel,
  sessaoDe,
} from "./motor/acesso.js";
import { montarPromptAvaliacao, extrairTextoProfissional, pontuarChecklist } from "./motor/avaliador.js";
import { AVISO_DEMO, responderDemo, fatoSensivelDireto } from "./motor/demo.js";
import { CHAVES_VITAIS, detectarExames } from "./motor/exames.js";
import { expressaoDoCaso } from "./motor/expressao.js";
import { consultarFicha } from "./motor/ficha.js";
import { conceder, saldo, tetos } from "./motor/orcamento.js";
import { cunharToken, infoTempoReal, tempoRealDisponivel, urlChamada } from "./motor/tempo-real.js";
import { conversar, modelosEmUso, registrarModelo } from "./motor/ia.js";
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

// Arquivos estáticos servidos por LISTA FIXA, não por caminho montado a partir do
// pedido. É a diferença entre servir dois arquivos conhecidos e abrir um leitor de
// disco para quem souber escrever `../`. O mesmo cuidado que o relatório já toma.
const JS = "text/javascript; charset=utf-8";
const ESTATICOS = new Map([
  ["/estilo.css", { arquivo: path.join(RAIZ, "web", "estilo.css"), tipo: "text/css; charset=utf-8" }],
  ["/tempo-real.js", { arquivo: path.join(RAIZ, "web", "tempo-real.js"), tipo: JS }],
  // A presença do paciente. Já foi uma sala em 3D com boneco humano e 750 kB de
  // biblioteca; o boneco caiu no vale da estranheza e a biblioteca cobrava a
  // franquia de dados do aluno. Hoje é um canvas 2D e nenhuma dependência.
  ["/presenca.js", { arquivo: path.join(RAIZ, "web", "presenca.js"), tipo: JS }],
]);

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
// Cada token de tempo real é um bloco de minutos já debitado do orçamento; o teto
// aqui é só contra pedir token em loop. O turno é a transcrição chegando do
// navegador — uma conversa fluida gera dezenas por consulta.
const LIMITE_TEMPO_REAL = 30;
const LIMITE_TURNO = 400;
// Cadastro e cobrança são as portas que um script tentaria forçar: uma para farmar
// crédito de boas-vindas, a outra para encher a conta de cobranças pendentes.
const LIMITE_CADASTRO = 5;
const LIMITE_PAGAMENTO = 12;

// Professor e admin não gastam crédito: eles avaliam e demonstram a ferramenta, e
// cobrar de quem administra a turma seria cobrar duas vezes pela mesma coisa.
function gastaCredito(req) {
  return ehAluno(req) && !ehProfessor(req);
}

// Identidade para a cobrança. O e-mail sintético (`@matricula.invalid`) de conta
// criada pelo admin não vai para o provedor — não existe e recibo nenhum chega lá.
function usuarioDaSessao(req) {
  return {
    id: sessaoDe(req),
    nome: nomeDe(req),
    matricula: matriculaDe(req),
    email: emailDe(req),
  };
}

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
        categoria: String(caso.categoria || "psicologia"),
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

// Corpo cru, em texto. O webhook da Stripe assina os BYTES enviados: reserializar
// o JSON mudaria espaços e ordem, e a assinatura deixaria de bater.
function lerCorpoTexto(req, maxBytes = 512 * 1024) {
  return new Promise((resolver, rejeitar) => {
    const pedacos = [];
    let tamanho = 0;
    req.on("data", (pedaco) => {
      tamanho += pedaco.length;
      if (tamanho > maxBytes) {
        rejeitar(new Error("Corpo grande demais."));
        req.destroy();
        return;
      }
      pedacos.push(pedaco);
    });
    req.on("end", () => resolver(Buffer.concat(pedacos).toString("utf-8")));
    req.on("error", rejeitar);
  });
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
  // A identidade vem da SESSÃO, nunca do corpo da requisição. Antes o aluno
  // digitava o próprio nome num campo livre — foi por ali que passou o XSS
  // corrigido na v4, e além disso qualquer um podia assinar a consulta com o nome
  // de outra pessoa. Agora a consulta é da matrícula que está logada, e ponto.
  const aluno = matriculaDe(req) || "aluno";

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

  // O crédito é debitado ANTES de a consulta existir, com o id dela como
  // referência. Debitar depois abriria a janela clássica: duas abas começam
  // consultas ao mesmo tempo e uma delas sai de graça.
  if (gastaCredito(req)) {
    const cobranca = debitar(sessaoDe(req), CUSTO.consulta, "consulta", id);
    if (!cobranca.ok) {
      return json(res, 402, {
        erro: "Créditos insuficientes para iniciar a consulta.",
        saldo: cobranca.saldo,
        custo: CUSTO.consulta,
        faltam: cobranca.faltam,
      });
    }
  }

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
    categoria: String(caso.categoria || "psicologia"),
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
    // Como esta pessoa CHEGA: seis números e duas palavras, para a sala em 3D
    // montar a postura, o olhar e a respiração. Nada de texto do caso vai junto.
    expressao: expressaoDoCaso(caso),
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
      // Login, logout e gestão de contas ficam com o Better Auth. Vem ANTES de
      // qualquer outra coisa e antes de resolver a sessão: estas rotas são
      // justamente as que existem para quem ainda não tem sessão nenhuma.
      if (pathname.startsWith("/api/auth/")) {
        return await toNodeHandler(auth())(req, res);
      }

      // A sessão é resolvida UMA vez por requisição e fica no `req`. É o que
      // permite `ehAluno(req)` e `sessaoDe(req)` continuarem síncronos no resto
      // do arquivo, com uma única consulta ao banco.
      await carregarSessao(req);

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
          // O que a cadeia de fallback REALMENTE usou — o primeiro da lista pode
          // não estar liberado na conta e o servidor rebaixar sem avisar.
          servido_por: modelosEmUso(),
          voz: ttsInfo(),
          tempo_real: { ...infoTempoReal(), tetos: tetos() },
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

      if (req.method === "GET" && ESTATICOS.has(pathname)) {
        // Mesma ordem da página: lê antes de responder, para que uma falha de
        // leitura vire 500 limpo em vez de cabeçalho enviado duas vezes.
        const { arquivo, tipo, cache } = ESTATICOS.get(pathname);
        const conteudo = fs.readFileSync(arquivo);
        res.writeHead(200, {
          "Content-Type": tipo,
          // A biblioteca 3D é imutável e pesa ~750 kB: baixar de novo a cada
          // consulta seria cobrar a franquia de dados do aluno por nada. O resto
          // é código nosso, que muda a cada deploy.
          "Cache-Control": cache ? "public, max-age=604800, immutable" : "no-cache",
        });
        return res.end(conteudo);
      }

      // ---- Acesso: a página pergunta o que já pode fazer, e troca credencial por sessão.
      if (req.method === "GET" && pathname === "/api/acesso") {
        return json(res, 200, estadoAcesso(req));
      }
      // Entrar e sair passaram a ser `/api/auth/sign-in/username` e
      // `/api/auth/sign-out`, tratados acima pelo Better Auth. As rotas antigas
      // (código compartilhado e senha de professor) deixaram de existir de
      // propósito: enquanto respondessem, seriam uma segunda porta para a mesma
      // casa — e a porta fraca é a que vale.

      // ---- Créditos, loja e cobrança ------------------------------------------

      // A vitrine de preços é pública: quem ainda não tem conta precisa saber
      // quanto custa antes de criar uma.
      if (req.method === "GET" && pathname === "/api/loja") {
        return json(res, 200, { ...catalogo(), formas: provedoresDisponiveis() });
      }

      if (req.method === "GET" && pathname === "/api/creditos") {
        if (!ehAluno(req)) return json(res, 401, { erro: "Sessão necessária." });
        const id = sessaoDe(req);
        return json(res, 200, {
          saldo: saldoDeCreditos(id),
          isento: !gastaCredito(req),
          custo: CUSTO,
          experiencia_completa: EXPERIENCIA_COMPLETA,
          assinatura: assinaturaDoUsuario(id),
          extrato: extrato(id, 20),
          pagamentos: pagamentosDoUsuario(id, 5).map((p) => ({
            id: p.id, status: p.status, creditos: p.creditos, provedor: p.provedor, criado_em: p.criado_em,
          })),
        });
      }

      // Cadastro público. A API do Better Auth continua com o `sign-up` fechado:
      // quem cria conta é esta rota, que é onde as regras do produto vivem.
      if (req.method === "POST" && pathname === "/api/cadastro") {
        if (estourouLimite(req, res, "cadastro", LIMITE_CADASTRO)) return;
        const dados = await lerCorpo(req);
        try {
          const usuario = await criarUsuarioPublico({
            nome: dados.nome,
            email: dados.email,
            senha: String(dados.senha || ""),
          });
          darBoasVindas(usuario.id);
          return json(res, 200, { ok: true, email: usuario.email });
        } catch (erro) {
          return json(res, 400, { erro: (erro && erro.message) || "Não foi possível criar a conta." });
        }
      }

      if (req.method === "POST" && pathname === "/api/pagamentos") {
        if (!ehAluno(req)) return json(res, 401, { erro: "Entre para comprar créditos." });
        if (estourouLimite(req, res, "pagamento", LIMITE_PAGAMENTO)) return;
        const dados = await lerCorpo(req);
        const item = itemPorId(String(dados.item || ""));
        if (!item) return json(res, 400, { erro: "Item indisponível." });
        const forma = dados.forma === "cartao" ? "cartao" : "pix";
        // Assinatura por Pix exigiria cobrança manual todo mês — melhor dizer isso
        // na hora do que deixar o aluno achar que assinou e não renovar.
        if (item.tipo === "assinatura" && forma === "pix") {
          return json(res, 400, { erro: "Assinatura só no cartão. No Pix, escolha um pacote de créditos." });
        }
        try {
          const usuario = usuarioDaSessao(req);
          const cobranca = forma === "cartao"
            ? await cobrarCartao({ usuario, item })
            : await cobrarPix({ usuario, item });
          return json(res, 200, { forma, ...cobranca });
        } catch (erro) {
          registrarFalhaIA("cobrança", erro);
          return json(res, 502, { erro: "Não consegui abrir a cobrança agora. Tente de novo em instantes." });
        }
      }

      // Estado de uma cobrança. Chamado pelo botão "já paguei" e pela volta do
      // cartão — e em nenhum dos dois o navegador decide: quem confirma é a API do
      // provedor, consultada aqui dentro.
      const pagamento = pathname.match(/^\/api\/pagamentos\/([\w-]+)$/);
      if (req.method === "GET" && pagamento) {
        if (!ehAluno(req)) return json(res, 401, { erro: "Sessão necessária." });
        try {
          const registro = pagamentosDoUsuario(sessaoDe(req), 50).find((p) => p.id === pagamento[1]);
          if (!registro) return json(res, 404, { erro: "Cobrança não encontrada." });
          const estado = registro.provedor === "stripe"
            ? await conferirCartao(registro.id)
            : await conferirPix(registro.id);
          return json(res, 200, { id: registro.id, pago: Boolean(estado.pago), saldo: saldoDeCreditos(sessaoDe(req)) });
        } catch (erro) {
          registrarFalhaIA("conferência de pagamento", erro);
          return json(res, 502, { erro: "Não consegui confirmar agora." });
        }
      }

      // ---- Webhooks. Sem sessão, por definição: quem chama é o provedor.
      if (req.method === "POST" && pathname === "/api/webhooks/stripe") {
        const bruto = await lerCorpoTexto(req);
        const conferido = verificarAssinaturaStripe(bruto, req.headers["stripe-signature"]);
        if (!conferido.ok) {
          console.warn(`[pagamento] webhook stripe recusado: ${conferido.motivo}`);
          return json(res, 400, { erro: "assinatura inválida" });
        }
        let evento = {};
        try {
          evento = JSON.parse(bruto);
        } catch {}
        try {
          const r = await tratarEventoStripe(evento);
          console.log(`[pagamento] stripe ${evento.type}: ${JSON.stringify(r)}`);
        } catch (erro) {
          registrarFalhaIA("webhook stripe", erro);
        }
        // 200 mesmo em falha nossa: o provedor reenviaria em loop, e a
        // reconciliação já é feita por consulta à API.
        return json(res, 200, { recebido: true });
      }

      if (req.method === "POST" && pathname === "/api/webhooks/woovi") {
        const corpo = await lerCorpo(req);
        try {
          const r = await tratarEventoWoovi(corpo);
          console.log(`[pagamento] woovi: ${JSON.stringify(r)}`);
        } catch (erro) {
          registrarFalhaIA("webhook woovi", erro);
        }
        return json(res, 200, { recebido: true });
      }

      // ---- Gestão de contas. Só o ADMIN entra aqui; professor não abre conta.
      if (pathname === "/api/alunos" || pathname.startsWith("/api/alunos/")) {
        if (!ehAdmin(req)) {
          return json(res, 403, { erro: "Restrito ao administrador." });
        }

        if (req.method === "GET" && pathname === "/api/alunos") {
          // O saldo vem junto da lista: administrar conta e administrar crédito
          // viraram a mesma conversa, e abrir duas telas para responder "quanto
          // essa pessoa tem?" seria trabalho manual sem motivo.
          const alunos = (await listarUsuarios()).map((a) => ({ ...a, creditos: saldoDeCreditos(a.id) }));
          return json(res, 200, { alunos });
        }

        // Lançamento manual de crédito. É o caminho para cortesia, suporte,
        // reembolso e turma institucional — e cada lançamento vira uma linha no
        // razão, com quem recebeu e quando. Nada de mexer no saldo por fora.
        const creditosDe = pathname.match(/^\/api\/alunos\/([\w-]+)\/creditos$/);
        if (req.method === "POST" && creditosDe) {
          const dados = await lerCorpo(req);
          const quantidade = Math.trunc(Number(dados.creditos) || 0);
          if (!quantidade || Math.abs(quantidade) > 100000) {
            return json(res, 400, { erro: "Informe quantos créditos lançar (positivo para dar, negativo para tirar)." });
          }
          // A referência carrega o instante: dois lançamentos iguais para a mesma
          // pessoa são intencionais, e o índice de idempotência recusaria o segundo
          // se a referência fosse só o id.
          const referencia = `admin:${creditosDe[1]}:${Date.now()}`;
          const resultado = quantidade > 0
            ? creditar(creditosDe[1], quantidade, "ajuste", referencia)
            : debitar(creditosDe[1], -quantidade, "ajuste", referencia);
          if (!resultado.ok) {
            return json(res, 400, { erro: "Saldo insuficiente para retirar essa quantidade.", saldo: resultado.saldo });
          }
          return json(res, 200, { ok: true, saldo: resultado.saldo });
        }

        if (req.method === "POST" && pathname === "/api/alunos") {
          const dados = await lerCorpo(req);
          const matricula = String(dados.matricula || "").trim();
          const nome = String(dados.nome || "").trim();
          const senha = String(dados.senha || "");
          const papel = String(dados.papel || "aluno");

          if (!/^[A-Za-z0-9._-]{3,40}$/.test(matricula)) {
            return json(res, 400, {
              erro: "Matrícula inválida: use de 3 a 40 caracteres, com letras, números, ponto, hífen ou sublinhado.",
            });
          }
          if (senha.length < 8) {
            return json(res, 400, { erro: "A senha precisa ter pelo menos 8 caracteres." });
          }
          try {
            const criado = await criarUsuario({ matricula, senha, nome, papel });
            // Conta criada pelo admin também nasce com os créditos de boas-vindas:
            // uma turma cadastrada na véspera da aula precisa conseguir usar a
            // ferramenta na aula, não descobrir o paywall na frente do professor.
            darBoasVindas(criado.id);
            return json(res, 200, { ok: true, id: criado.id, matricula });
          } catch (erro) {
            // Matrícula repetida é o erro comum aqui, e merece nome próprio em vez
            // de virar 500 genérico.
            const texto = String((erro && erro.message) || erro);
            const repetida = /unique|constraint|exист|already/i.test(texto);
            return json(res, repetida ? 409 : 400, {
              erro: repetida ? "Já existe uma conta com essa matrícula." : "Não foi possível criar a conta.",
            });
          }
        }

        const senhaDe = pathname.match(/^\/api\/alunos\/([\w-]+)\/senha$/);
        if (req.method === "POST" && senhaDe) {
          const dados = await lerCorpo(req);
          const senha = String(dados.senha || "");
          if (senha.length < 8) {
            return json(res, 400, { erro: "A senha precisa ter pelo menos 8 caracteres." });
          }
          await definirSenha(senhaDe[1], senha);
          return json(res, 200, { ok: true });
        }

        const ativoDe = pathname.match(/^\/api\/alunos\/([\w-]+)\/ativo$/);
        if (req.method === "POST" && ativoDe) {
          const dados = await lerCorpo(req);
          // O admin não pode desativar a própria conta: seria trancar a chave
          // dentro de casa, e ninguém mais poderia reabrir.
          if (ativoDe[1] === sessaoDe(req) && dados.ativo === false) {
            return json(res, 400, { erro: "Você não pode desativar a sua própria conta." });
          }
          await definirAtivo(ativoDe[1], dados.ativo !== false);
          return json(res, 200, { ok: true });
        }

        const papelDeAlguem = pathname.match(/^\/api\/alunos\/([\w-]+)\/papel$/);
        if (req.method === "POST" && papelDeAlguem) {
          const dados = await lerCorpo(req);
          if (papelDeAlguem[1] === sessaoDe(req)) {
            return json(res, 400, { erro: "Você não pode mudar o seu próprio papel." });
          }
          await definirPapel(papelDeAlguem[1], String(dados.papel || "aluno"));
          return json(res, 200, { ok: true });
        }

        return json(res, 404, { erro: "Rota não encontrada." });
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

      // O que a página precisa saber ANTES de oferecer o botão: se o recurso existe
      // e quanto ainda cabe hoje. Oferecer e falhar seria pior que não oferecer.
      if (req.method === "GET" && pathname === "/api/tempo-real") {
        const info = infoTempoReal();
        const aluno = sessaoDe(req);
        return json(res, 200, {
          ...info,
          tetos: tetos(),
          saldo: aluno ? saldo({ aluno, consultaId: null }) : null,
        });
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
        return json(res, 401, { erro: "Sessão expirada. Entre de novo com a sua matrícula." });
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

      // ---- Conversa por voz em tempo real (WebRTC direto navegador ↔ provedor).
      //
      // O servidor entra em três momentos e sai do caminho no resto: cunha o token
      // (debitando o orçamento), responde ao portão clínico e recebe a transcrição.
      // O áudio nunca passa por aqui.
      const emTempoReal = pathname.match(/^\/api\/consultas\/([\w-]+)\/tempo-real$/);
      if (req.method === "POST" && emTempoReal) {
        const consulta = consultaAtiva(res, emTempoReal[1]);
        if (!consulta) return;
        if (!tempoRealDisponivel()) {
          // 503 e não 500: é ausência de recurso, e a página cai no microfone de
          // segurar. Nunca tela morta.
          return json(res, 503, { erro: "Conversa em tempo real indisponível neste servidor." });
        }
        if (estourouLimite(req, res, "tempo-real", LIMITE_TEMPO_REAL)) return;

        const aluno = sessaoDe(req) || ipDe(req);
        const concessao = conceder({ aluno, consultaId: emTempoReal[1] });
        if (!concessao.ok) {
          return json(res, 429, { erro: concessao.motivo, orcamento: concessao.restante });
        }

        // Minuto de voz custa crédito. A referência carrega o instante porque o
        // mesmo aluno renova o bloco várias vezes na mesma consulta — sem ela, o
        // índice de idempotência recusaria a segunda cobrança e a voz sairia de
        // graça a partir do segundo bloco.
        const custoVoz = concessao.minutos * CUSTO.minuto_voz;
        if (gastaCredito(req)) {
          const cobranca = debitar(sessaoDe(req), custoVoz, "voz", `${emTempoReal[1]}:${Date.now()}`);
          if (!cobranca.ok) {
            return json(res, 402, {
              erro: `A conversa por voz custa ${CUSTO.minuto_voz} créditos por minuto. Você tem ${cobranca.saldo}.`,
              saldo: cobranca.saldo,
              custo: custoVoz,
              faltam: cobranca.faltam,
            });
          }
        }

        try {
          const token = await cunharToken({
            caso: consulta.caso,
            voz: consulta.voz,
            minutos: concessao.minutos,
          });
          // Marca o transcript UMA vez: quem ler depois precisa saber que dali em
          // diante a fala foi declarada pelo navegador, não vista pelo servidor.
          if (!consulta.tempoReal) {
            consulta.tempoReal = true;
            consulta.transcript += `MODO: tempo real (transcrição declarada pelo navegador)\n`;
          }
          return json(res, 200, {
            token: token.valor,
            url: urlChamada(),
            modelo: token.modelo,
            expira_em: token.expira_em,
            minutos: concessao.minutos,
            orcamento: concessao.restante,
          });
        } catch (erro) {
          registrarFalhaIA("token de tempo real", erro);
          // Cobrou e não entregou: devolve na hora. Crédito retido por falha nossa
          // é a reclamação mais cara que existe.
          if (gastaCredito(req)) estornar(sessaoDe(req), custoVoz, `falha:${emTempoReal[1]}:${Date.now()}`);
          return json(res, 502, { erro: "Não consegui abrir a conversa por voz agora." });
        }
      }

      // O portão clínico como ferramenta: o modelo pergunta, o SERVIDOR decide.
      const ficha = pathname.match(/^\/api\/consultas\/([\w-]+)\/ficha$/);
      if (req.method === "POST" && ficha) {
        const consulta = consultaAtiva(res, ficha[1]);
        if (!consulta) return;
        if (estourouLimite(req, res, "mensagens", LIMITE_MENSAGENS)) return;
        const dados = await lerCorpo(req);
        return json(res, 200, consultarFicha(consulta, dados.pergunta));
      }

      // Transcrição vinda do navegador. Declarada pelo cliente por construção — o
      // que o servidor carimba são as consultas à ficha, que é onde a rubrica pesa.
      const turno = pathname.match(/^\/api\/consultas\/([\w-]+)\/turno$/);
      if (req.method === "POST" && turno) {
        const consulta = consultaAtiva(res, turno[1]);
        if (!consulta) return;
        if (estourouLimite(req, res, "turno", LIMITE_TURNO)) return;
        const dados = await lerCorpo(req);
        const profissional = umaLinha(dados.profissional, MAX_CARACTERES_PERGUNTA);
        const paciente = umaLinha(dados.paciente, MAX_CARACTERES_PERGUNTA);
        if (!profissional && !paciente) return json(res, 400, { erro: "Turno vazio." });
        if (profissional) {
          consulta.transcript += `\nPROFISSIONAL: ${profissional}\n`;
          consulta.perguntas += 1;
        }
        if (paciente) consulta.transcript += `\nPACIENTE: ${paciente}\n`;
        return json(res, 200, { ok: true });
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

export async function iniciar() {
  const bruto = process.env.PORT || process.env.PACIENTE_VIRTUAL_PORTA || 3000;
  const servidor = criarServidor();

  // Banco e primeiro administrador ANTES de aceitar tráfego. Se falhar, o processo
  // morre em vez de subir sem tabela: um servidor que responde 500 no login é pior
  // que um que não sobe, porque o monitoramento o vê "no ar".
  try {
    const pendentes = await migrar();
    if (pendentes) console.log(`[auth] ${pendentes} migração(ões) aplicada(s)`);
    // As tabelas de crédito vivem no mesmo banco e sobem junto: um servidor no ar
    // sem elas responderia 500 na primeira consulta de qualquer aluno.
    migrarCreditos();

    // Quem já tinha conta antes de a ferramenta passar a cobrar não pode acordar
    // sem poder usá-la. Cada conta existente ganha os créditos de boas-vindas uma
    // única vez — a referência é o id do usuário, então subir de novo não repete.
    const recebidos = [];
    for (const u of await listarUsuarios()) {
      if (darBoasVindas(u.id).repetido === false) recebidos.push(u.matricula);
    }
    if (recebidos.length) {
      console.log(`[creditos] boas-vindas concedidas a ${recebidos.length} conta(s) já existente(s)`);
    }
    const semeadura = await semearAdmin();
    if (semeadura.semeado) console.log(`[auth] administrador criado: ${semeadura.matricula}`);
    else if ((await contarUsuarios()) === 0) {
      console.warn(`[auth] NENHUM USUÁRIO CADASTRADO — ${semeadura.motivo}. Ninguém consegue entrar.`);
    }
  } catch (erro) {
    console.error(`[auth] falha ao preparar o banco: ${(erro && erro.message) || erro}`);
    process.exit(1);
  }

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
