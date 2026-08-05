// Controle de acesso do servidor.
//
// Antes o acesso era um CÓDIGO COMPARTILHADO: quem tivesse o código entrava, e
// todo mundo era a mesma pessoa para o sistema. Isso tinha três consequências
// ruins — o teto de uso só podia ser por IP (e uma turma inteira sai por um IP
// só), não existia nota por pessoa, e quem descobrisse o código gastava a chave
// da OpenAI do dono. Agora cada aluno tem MATRÍCULA e senha, e a conta é criada
// pelo administrador.
//
// A INTERFACE DESTE MÓDULO NÃO MUDOU. `papelDe`, `ehAluno`, `ehProfessor`,
// `sessaoDe` e `estadoAcesso` continuam síncronos e continuam recebendo `req`,
// porque o resto da aplicação depende disso — o `servidor.js` protege as consultas
// com `ehAluno(req)` e o `limite.js` conta uso por `sessaoDe(req)`. O que mudou é
// por baixo: quem responde deixou de ser um HMAC próprio e passou a ser o Better
// Auth.
//
// Para que os síncronos continuem síncronos, a sessão é resolvida UMA VEZ por
// requisição — `carregarSessao(req)` — e fica pendurada no próprio `req`. Além de
// preservar a interface, isso troca várias consultas ao banco por uma só.

import { auth } from "./auth.js";

const MARCA = Symbol.for("pv.sessao");

// Papéis que enxergam o painel do professor. `admin` é quem administra contas;
// `professor` acompanha a turma. Os dois leem transcrição de aluno.
const PAPEIS_PROFESSOR = new Set(["admin", "professor"]);

// O painel deixou de depender de alguém lembrar de configurar uma senha: agora ele
// é protegido por PAPEL. Quem não tem o papel recebe 403, e é impossível "esquecer
// de ligar a proteção" — ela é o padrão.
export function painelDisponivel() {
  return true;
}

function cabecalhosWeb(req) {
  const cabecalhos = new Headers();
  for (const [chave, valor] of Object.entries(req.headers || {})) {
    if (valor == null) continue;
    if (Array.isArray(valor)) for (const v of valor) cabecalhos.append(chave, String(v));
    else cabecalhos.set(chave, String(valor));
  }
  return cabecalhos;
}

// Resolve a sessão e pendura no `req`. Chamado uma única vez, no topo do
// tratamento da requisição. Falha de banco NÃO derruba o pedido: vira "sem
// sessão", e o pedido segue para o 401 normal — indisponibilidade do login não
// pode virar erro 500 em página pública.
export async function carregarSessao(req) {
  try {
    const sessao = await auth().api.getSession({ headers: cabecalhosWeb(req) });
    req[MARCA] = sessao && sessao.user ? sessao : null;
  } catch {
    req[MARCA] = null;
  }
  return req[MARCA];
}

function sessaoBruta(req) {
  return req && req[MARCA] ? req[MARCA] : null;
}

// Papel da requisição: "professor", "aluno" ou null.
export function papelDe(req) {
  const sessao = sessaoBruta(req);
  if (!sessao) return null;
  const papel = String((sessao.user && sessao.user.role) || "aluno");
  return PAPEIS_PROFESSOR.has(papel) ? "professor" : "aluno";
}

export function ehAluno(req) {
  return papelDe(req) !== null; // professor também é aluno
}

export function ehProfessor(req) {
  return papelDe(req) === "professor";
}

// Identificador para contar uso por PESSOA em vez de por IP. Antes era um `sid`
// anônimo sorteado por sessão; agora é o id do usuário, então o teto acompanha o
// aluno mesmo que ele troque de máquina — e o `limite.js` não precisou mudar.
export function sessaoDe(req) {
  const sessao = sessaoBruta(req);
  return (sessao && sessao.user && sessao.user.id) || null;
}

// Matrícula de quem está logado. É o que passa a identificar a consulta, no lugar
// do nome digitado à mão pelo próprio aluno.
export function matriculaDe(req) {
  const sessao = sessaoBruta(req);
  if (!sessao || !sessao.user) return null;
  return sessao.user.username || sessao.user.name || null;
}

export function nomeDe(req) {
  const sessao = sessaoBruta(req);
  return (sessao && sessao.user && sessao.user.name) || matriculaDe(req);
}

// Estado para a página decidir o que mostrar. Nunca devolve credencial.
export function estadoAcesso(req) {
  const papel = papelDe(req);
  return {
    autenticado: papel !== null,
    professor: papel === "professor",
    painel_disponivel: painelDisponivel(),
    matricula: matriculaDe(req),
    nome: nomeDe(req),
  };
}
