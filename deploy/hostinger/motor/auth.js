// Autenticação por MATRÍCULA, sobre Better Auth.
//
// Só o administrador cria conta. Não há auto-cadastro, e por isso não há
// verificação de e-mail nem "esqueci a senha": quem reseta é o admin. A razão é
// econômica antes de ser técnica — cada conta que existe é alguém gastando a chave
// da OpenAI do dono, então a porta é fechada por padrão.
//
// Banco: `node:sqlite`, que o Better Auth aceita nativamente desde o Node 22.5.
// Isso importa mais do que parece: o driver usual (`better-sqlite3`) compila código
// nativo e no Alpine/musl do container isso exige toolchain. Com o módulo embutido,
// a única dependência npm da aplicação é o próprio Better Auth.

import path from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { betterAuth } from "better-auth";
import { admin, username } from "better-auth/plugins";
import { createAccessControl } from "better-auth/plugins/access";
import { adminAc, defaultStatements } from "better-auth/plugins/admin/access";

const DIR_APP = path.dirname(fileURLToPath(import.meta.url));
const RAIZ = path.resolve(DIR_APP, "..", "..", "..");

// Por padrão o banco fica DENTRO da pasta que já é persistida em volume, senão o
// primeiro restart apagaria todas as contas. Em produção o caminho é explícito
// via PV_BANCO, para não depender de o symlink resolver como se espera.
const CAMINHO_BANCO = process.env.PV_BANCO || path.join(RAIZ, "historico", "pv.sqlite");

// Reusa o segredo que já existia para assinar a sessão. Sem ele, o Better Auth
// sortearia um por processo e toda sessão cairia a cada restart.
const SEGREDO = process.env.PV_SEGREDO || "";

// `COOLIFY_URL` já existe no ambiente do container e traz o endereço público.
const BASE_URL = (process.env.PV_URL || process.env.COOLIFY_URL || "").split(",")[0].trim();

// TODAS as origens em que a aplicação atende, não só a primeira.
//
// O Better Auth barra requisição com sessão cuja `Origin` não seja confiável — é
// defesa contra CSRF, e é correta. Mas o site responde em `ubtec.sbs` E em
// `www.ubtec.sbs`: usando só a primeira URL, quem entrasse pelo `www` levaria 403
// no login e o erro pareceria "senha errada". `COOLIFY_FQDN` traz os dois hosts
// sem esquema; `COOLIFY_URL` traz com.
function origensConfiaveis() {
  const brutas = [
    ...(process.env.PV_URL || "").split(","),
    ...(process.env.COOLIFY_URL || "").split(","),
    ...(process.env.COOLIFY_FQDN || "").split(",").map((h) => (h.trim() ? `https://${h.trim()}` : "")),
  ];
  return [...new Set(brutas.map((u) => u.trim()).filter(Boolean))];
}

// O Better Auth exige e-mail no modelo de usuário, mas a decisão de projeto é NÃO
// coletar e-mail de aluno. A saída é um endereço sintético derivado da matrícula:
// nunca é exibido, nunca recebe mensagem, e `.invalid` é reservado pela RFC 2606
// justamente para isto — não existe e não pode passar a existir.
export function emailSintetico(matricula) {
  return `${String(matricula).trim().toLowerCase()}@matricula.invalid`;
}

// `aluno` e `professor` não recebem nenhuma permissão de administração: a lista
// vazia é intencional, não um esquecimento. Quem pode mexer em conta é só `admin`.
const CONTROLE = createAccessControl({ ...defaultStatements });
const PAPEIS = {
  admin: adminAc,
  professor: CONTROLE.newRole({}),
  aluno: CONTROLE.newRole({}),
};

let instancia = null;

export function auth() {
  if (instancia) return instancia;

  instancia = betterAuth({
    database: new DatabaseSync(CAMINHO_BANCO),
    ...(SEGREDO ? { secret: SEGREDO } : {}),
    // Sem URL declarada, a origem é deduzida da requisição — o que atrás de um
    // proxy reverso vira redirecionamento para o host errado.
    ...(BASE_URL ? { baseURL: BASE_URL } : {}),
    trustedOrigins: origensConfiaveis(),
    emailAndPassword: {
      enabled: true,
      // A porta fechada. Sem isto, `/api/auth/sign-up` fica aberto e qualquer um
      // cria conta — que é exatamente o que este projeto existe para impedir.
      disableSignUp: true,
      requireEmailVerification: false,
    },
    plugins: [
      // O validador padrão recusa hífen e ponto — e matrícula de instituição
      // frequentemente tem os dois (`2026-001`, `20.26.001`). Com o padrão, essas
      // matrículas seriam IMPOSSÍVEIS de cadastrar. Aqui a regra é: letras,
      // dígitos, ponto, hífen e sublinhado, de 3 a 40 caracteres — largo o
      // bastante para matrícula real, estreito o bastante para não virar campo
      // livre com espaço, acento e sinal de pontuação.
      username({
        minUsernameLength: 3,
        maxUsernameLength: 40,
        usernameValidator: (valor) => /^[A-Za-z0-9._-]{3,40}$/.test(String(valor || "")),
      }),
      // TRÊS papéis, com uma separação que importa: só `admin` cria e reseta
      // conta. O `professor` lê o painel da turma — o que é permissão da
      // aplicação, concedida em `acesso.js` — mas NÃO administra usuários. Se
      // fosse tudo o mesmo papel, quem acompanha a turma poderia abrir contas, e
      // conta aberta é crédito de API gasto.
      admin({
        ac: CONTROLE,
        roles: PAPEIS,
        defaultRole: "aluno",
        adminRoles: ["admin"],
      }),
    ],
  });

  return instancia;
}

export function caminhoDoBanco() {
  return CAMINHO_BANCO;
}

// Cria as tabelas se faltarem. É idempotente: rodando de novo, não há nada a
// criar. Roda no boot porque o container é recriado do zero a cada subida e não
// existe passo de migração separado — se dependesse de alguém rodar um comando,
// a primeira subida em produção subiria sem tabela e o login responderia 500.
export async function migrar() {
  const { getMigrations } = await import("better-auth/db/migration");
  const migracoes = await getMigrations(auth().options);
  const pendentes = (migracoes.toBeCreated || []).length + (migracoes.toBeAdded || []).length;
  if (pendentes) await migracoes.runMigrations();
  return pendentes;
}

// ── Gestão de contas (só o administrador chega aqui) ──────────────────────
//
// Rotas próprias em vez de expor a API do plugin ao navegador: aqui a unidade é
// MATRÍCULA, não e-mail, e a mensagem de erro sai em português. O plugin continua
// sendo quem guarda e confere a senha.

export async function listarUsuarios() {
  const ctx = await auth().$context;
  const bruto = await ctx.internalAdapter.listUsers(1000, 0);
  const lista = Array.isArray(bruto) ? bruto : (bruto && bruto.users) || [];
  return lista.map((u) => ({
    id: u.id,
    matricula: u.displayUsername || u.username || "",
    nome: u.name || "",
    papel: u.role || "aluno",
    ativo: !u.banned,
    criado_em: u.createdAt || null,
  }));
}

// Troca a senha e DERRUBA as sessões abertas daquela pessoa. Sem derrubar, quem
// já estava logado continuaria dentro com a senha antiga válida na prática — que é
// o oposto do que "resetar a senha" significa para quem clica no botão.
export async function definirSenha(id, senha) {
  const ctx = await auth().$context;
  const contas = await ctx.internalAdapter.findAccounts(id);
  const credencial = (contas || []).find((c) => c.providerId === "credential");
  if (!credencial) throw new Error("Esta conta não tem senha para trocar.");
  await ctx.internalAdapter.updateAccount(credencial.id, {
    password: await ctx.password.hash(senha),
  });
  await ctx.internalAdapter.deleteUserSessions(id);
}

// Desativar é melhor que apagar: a pessoa perde o acesso na hora, mas as consultas
// dela continuam no painel do professor. Apagar levaria a nota junto.
export async function definirAtivo(id, ativo) {
  const ctx = await auth().$context;
  await ctx.internalAdapter.updateUser(id, {
    banned: !ativo,
    banReason: ativo ? null : "desativado pelo administrador",
    banExpires: null,
  });
  if (!ativo) await ctx.internalAdapter.deleteUserSessions(id);
}

export async function definirPapel(id, papel) {
  const ctx = await auth().$context;
  const valido = papel === "admin" || papel === "professor" ? papel : "aluno";
  await ctx.internalAdapter.updateUser(id, { role: valido });
}

export async function contarUsuarios() {
  const ctx = await auth().$context;
  return ctx.internalAdapter.countTotalUsers();
}

// Semeia o PRIMEIRO administrador a partir do ambiente. Sem ele ninguém entra —
// não há auto-cadastro, então uma instância nova sem admin é uma casa sem porta.
//
// Só age quando NÃO existe nenhum usuário. Isso é deliberado: se agisse sempre,
// deixar a variável no ambiente recriaria (ou ressuscitaria) o admin depois de o
// dono o ter removido de propósito.
export async function semearAdmin() {
  const matricula = (process.env.PV_ADMIN_MATRICULA || "").trim();
  const senha = process.env.PV_ADMIN_SENHA || "";
  if (!matricula || !senha) return { semeado: false, motivo: "sem PV_ADMIN_MATRICULA/PV_ADMIN_SENHA" };

  const ctx = await auth().$context;
  const total = await ctx.internalAdapter.countTotalUsers();
  if (total > 0) return { semeado: false, motivo: "já existe usuário" };

  await criarUsuario({
    matricula,
    senha,
    nome: process.env.PV_ADMIN_NOME || matricula,
    papel: "admin",
  });

  return { semeado: true, matricula };
}

// ── Cadastro público ──────────────────────────────────────────────────────
//
// A porta fechada continua fechada para a API do Better Auth (`disableSignUp`), e
// aberta AQUI, numa rota nossa, com as regras que o produto exige: e-mail de
// verdade (é para onde vai o recibo do pagamento), senha com tamanho mínimo,
// limite por IP e créditos de boas-vindas concedidos na mesma transação lógica.
//
// Passar pela rota própria em vez de liberar `/api/auth/sign-up` é o que permite
// tudo isso — e o que impede que amanhã um caminho esquecido crie conta sem crédito
// nem papel definido.

const EMAIL_VALIDO = /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i;

export function emailAceitavel(email) {
  const limpo = String(email || "").trim().toLowerCase();
  if (!EMAIL_VALIDO.test(limpo) || limpo.length > 160) return null;
  // `.invalid` é reservado pela RFC 2606 e é o que usamos para conta criada pelo
  // admin sem e-mail. Aceitar no cadastro público deixaria colidir de propósito.
  if (limpo.endsWith(".invalid")) return null;
  return limpo;
}

export async function usuarioPorEmail(email) {
  const ctx = await auth().$context;
  return (await ctx.internalAdapter.findUserByEmail(email)) || null;
}

// Apelido de acesso derivado do e-mail. O aluno vai poder entrar pelos dois, mas o
// resto do sistema (transcrições, painel do professor) continua identificando
// pessoas por este campo, como já fazia com matrícula.
async function apelidoLivre(base) {
  const ctx = await auth().$context;
  const limpo = String(base || "aluno")
    .toLowerCase()
    .replace(/[^a-z0-9._-]/g, "")
    .slice(0, 32) || "aluno";
  for (let tentativa = 0; tentativa < 50; tentativa++) {
    const candidato = tentativa === 0 ? limpo : `${limpo}${tentativa + 1}`;
    if (candidato.length < 3) continue;
    const existe = await ctx.internalAdapter.findUserByEmail(emailSintetico(candidato));
    const emUso = existe || (await ctx.adapter.findOne({ model: "user", where: [{ field: "username", value: candidato }] }));
    if (!emUso) return candidato;
  }
  return `aluno${Date.now().toString(36)}`;
}

export async function criarUsuarioPublico({ nome, email, senha }) {
  const enderecoLimpo = emailAceitavel(email);
  if (!enderecoLimpo) throw new Error("E-mail inválido.");
  if (String(senha || "").length < 8) throw new Error("A senha precisa ter pelo menos 8 caracteres.");

  if (await usuarioPorEmail(enderecoLimpo)) {
    throw new Error("Já existe uma conta com este e-mail.");
  }

  const ctx = await auth().$context;
  const apelido = await apelidoLivre(enderecoLimpo.split("@")[0]);
  const hash = await ctx.password.hash(senha);
  const usuario = await ctx.internalAdapter.createUser({
    email: enderecoLimpo,
    name: String(nome || "").trim().slice(0, 80) || apelido,
    // Não há verificação de e-mail: bloquear o acesso por causa dela seria travar
    // o aluno na porta por um e-mail que talvez nem chegue. O endereço serve para
    // recibo e para o aluno reconhecer a própria conta.
    emailVerified: false,
    role: "aluno",
    username: apelido,
    displayUsername: apelido,
  });
  await ctx.internalAdapter.createAccount({
    userId: usuario.id,
    providerId: "credential",
    accountId: usuario.id,
    password: hash,
  });

  return usuario;
}

// Cria uma conta. É o que o administrador usa para cadastrar a turma, e o que os
// testes usam para montar cenário — a mesma porta, para que o testado seja o que
// roda em produção.
export async function criarUsuario({ matricula, senha, nome, papel }) {
  const ctx = await auth().$context;
  const login = String(matricula).trim();

  // A senha nunca é guardada em texto: o hash usa o mesmo algoritmo que o login
  // vai conferir depois, então criar por aqui e entrar pela tela dá no mesmo.
  const hash = await ctx.password.hash(senha);
  const usuario = await ctx.internalAdapter.createUser({
    email: emailSintetico(login),
    name: nome || login,
    emailVerified: true,
    role: papel === "admin" || papel === "professor" ? papel : "aluno",
    username: login.toLowerCase(),
    displayUsername: login,
  });
  await ctx.internalAdapter.createAccount({
    userId: usuario.id,
    providerId: "credential",
    accountId: usuario.id,
    password: hash,
  });

  return usuario;
}
