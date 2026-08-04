// Controle de acesso do servidor.
//
// Antes o "código de acesso" existia só no JavaScript da página: qualquer um lia o
// código no ver-fonte e, pior, chamava a API direto sem passar por ele. Como o
// servidor gasta a chave do modelo de linguagem e guarda transcrições com dados de
// alunos, a verificação passou para cá.
//
// Dois papéis:
//   aluno     — pode fazer consulta e usar a voz. Código em PV_CODIGO_ACESSO.
//   professor — além disso, lê o painel com as transcrições. Senha em PV_SENHA_PROFESSOR.
//
// Sem PV_SENHA_PROFESSOR definida o painel fica DESLIGADO (não é "aberto por
// padrão"): dado pessoal de aluno não pode depender de alguém lembrar de configurar.
// O fluxo do aluno nunca fica travado por configuração ausente — PV_CODIGO_ACESSO
// tem um padrão, então uma instância recém-subida continua utilizável.

import crypto from "node:crypto";

const CODIGO_PADRAO = "1010";
const DURACAO_MS = 12 * 60 * 60 * 1000; // uma jornada de aula
const COOKIE = "pv_sessao";

// Segredo de assinatura. Sem PV_SEGREDO, sorteia um por processo: as sessões caem
// quando o servidor reinicia, o que é aceitável (o aluno redigita o código) e é
// melhor do que um segredo fixo no código-fonte público.
const SEGREDO = process.env.PV_SEGREDO || crypto.randomBytes(32).toString("hex");

function codigoAluno() {
  return (process.env.PV_CODIGO_ACESSO || CODIGO_PADRAO).trim();
}

function senhaProfessor() {
  return (process.env.PV_SENHA_PROFESSOR || "").trim();
}

export function painelDisponivel() {
  return senhaProfessor().length > 0;
}

// Comparação em tempo constante: não vaza o tamanho nem o prefixo do código por
// diferença de tempo de resposta.
function iguais(a, b) {
  const ba = Buffer.from(String(a), "utf-8");
  const bb = Buffer.from(String(b), "utf-8");
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

function assinar(carga) {
  return crypto.createHmac("sha256", SEGREDO).update(carga).digest("base64url");
}

function criarToken(papel) {
  // `sid` identifica a sessão para o rate limit. Sem ele, o limite só pode ser por
  // IP — e uma turma inteira num laboratório sai por um único IP público, então um
  // aluno usando voz derrubaria a voz de todos os outros.
  const dados = { papel, sid: crypto.randomUUID(), exp: Date.now() + DURACAO_MS };
  const carga = Buffer.from(JSON.stringify(dados), "utf-8").toString("base64url");
  return `${carga}.${assinar(carga)}`;
}

function lerToken(token) {
  if (!token || typeof token !== "string") return null;
  const ponto = token.lastIndexOf(".");
  if (ponto <= 0) return null;
  const carga = token.slice(0, ponto);
  if (!iguais(token.slice(ponto + 1), assinar(carga))) return null;
  try {
    const dados = JSON.parse(Buffer.from(carga, "base64url").toString("utf-8"));
    if (!dados || typeof dados.exp !== "number" || dados.exp < Date.now()) return null;
    return dados;
  } catch {
    return null;
  }
}

function cookiesDe(req) {
  const bruto = req.headers.cookie || "";
  const out = {};
  for (const parte of bruto.split(";")) {
    const igual = parte.indexOf("=");
    if (igual < 0) continue;
    out[parte.slice(0, igual).trim()] = decodeURIComponent(parte.slice(igual + 1).trim());
  }
  return out;
}

// Papel da requisição: "professor", "aluno" ou null.
export function papelDe(req) {
  const dados = lerToken(cookiesDe(req)[COOKIE]);
  if (!dados) return null;
  if (dados.papel === "professor" && !painelDisponivel()) return "aluno"; // senha foi removida
  return dados.papel === "professor" ? "professor" : "aluno";
}

export function ehAluno(req) {
  return papelDe(req) !== null; // professor também é aluno
}

// Identificador da sessão, para contar uso por aluno em vez de por IP.
export function sessaoDe(req) {
  const dados = lerToken(cookiesDe(req)[COOKIE]);
  return (dados && dados.sid) || null;
}

export function ehProfessor(req) {
  return papelDe(req) === "professor";
}

// Confere a credencial e devolve o papel obtido, ou null.
export function autenticar(papelPedido, segredoInformado) {
  const informado = String(segredoInformado || "").trim();
  if (!informado) return null;
  if (papelPedido === "professor") {
    if (!painelDisponivel()) return null;
    return iguais(informado, senhaProfessor()) ? "professor" : null;
  }
  return iguais(informado, codigoAluno()) ? "aluno" : null;
}

export function cabecalhoSessao(papel, seguro) {
  const atributos = [
    `${COOKIE}=${criarToken(papel)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${Math.floor(DURACAO_MS / 1000)}`,
  ];
  // Secure só quando a conexão é https — senão o cookie some em teste local.
  if (seguro) atributos.push("Secure");
  return atributos.join("; ");
}

export function cabecalhoSaida() {
  return `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

// Estado para a página decidir o que mostrar (nunca devolve o código nem a senha).
export function estadoAcesso(req) {
  const papel = papelDe(req);
  return {
    autenticado: papel !== null,
    professor: papel === "professor",
    painel_disponivel: painelDisponivel(),
  };
}
