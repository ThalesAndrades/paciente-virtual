// Cupons de teste do beta.
//
// A porta do produto fechou: não se cria mais conta sozinho. Entra quem tem um
// cupom, e quem emite cupom é o administrador. É a diferença entre um beta
// convidado e um cadastro aberto — e, num produto que dá crédito de boas-vindas,
// cadastro aberto é uma torneira de custo ligada para qualquer um na internet.
//
// O que um cupom carrega: quantos créditos deposita, quantas contas pode abrir e
// até quando vale. Nada disso é opcional por acaso — cupom sem teto de uso e sem
// validade, publicado num grupo de WhatsApp, vira exatamente a torneira que o
// fechamento veio tapar.

import { DatabaseSync } from "node:sqlite";
import crypto from "node:crypto";

import { caminhoDoBanco } from "./auth.js";

let bd = null;

function banco() {
  if (bd) return bd;
  bd = new DatabaseSync(caminhoDoBanco());
  // As tabelas nascem junto com a conexão, como no resto do motor, e não num
  // passo separado que alguém precise lembrar de chamar. A primeira versão disto
  // separava os dois e o efeito apareceu na hora: a rota de cupom respondia 500
  // na suíte inteira, porque os testes sobem o servidor sem passar pelo boot que
  // roda a migração. Em produção seria pior — a porta do produto é o cupom, e uma
  // tabela faltando trancaria a casa.
  criarTabelas(bd);
  return bd;
}

function criarTabelas(b) {
  b.exec(`
    CREATE TABLE IF NOT EXISTS cupom (
      codigo TEXT PRIMARY KEY,
      creditos INTEGER NOT NULL,
      usos_max INTEGER NOT NULL DEFAULT 1,
      usos INTEGER NOT NULL DEFAULT 0,
      expira_em TEXT,
      observacao TEXT,
      criado_por TEXT,
      criado_em TEXT NOT NULL,
      revogado INTEGER NOT NULL DEFAULT 0
    );

    -- Quem resgatou o quê. Existe para duas coisas: impedir que a mesma conta
    -- consuma um cupom de vários usos duas vezes, e responder "de onde veio este
    -- aluno" quando o beta acabar.
    CREATE TABLE IF NOT EXISTS cupom_uso (
      codigo TEXT NOT NULL,
      usuario_id TEXT NOT NULL,
      email TEXT,
      usado_em TEXT NOT NULL,
      PRIMARY KEY (codigo, usuario_id)
    );
    CREATE INDEX IF NOT EXISTS idx_cupom_uso_codigo ON cupom_uso(codigo);
  `);
}

function agora() {
  return new Date().toISOString();
}

// Idempotente por construção: roda a cada abertura de conexão e não faz nada
// quando já está tudo lá.
export function migrarCupons() {
  banco();
}

/* ── Código ───────────────────────────────────────────────────────────────
   Alfabeto sem os pares que se confundem em voz alta e à mão: 0/O, 1/I/L, 5/S,
   2/Z, 8/B. O cupom vai ser ditado no telefone e digitado errado no celular, e
   cada caractere ambíguo vira um "não funciona" que chega como suporte. */
const ALFABETO = "ACDEFGHJKMNPQRTUVWXY34679";

export function gerarCodigo(prefixo = "BETA") {
  const bytes = crypto.randomBytes(10);
  let corpo = "";
  for (let i = 0; i < 8; i++) corpo += ALFABETO[bytes[i] % ALFABETO.length];
  const limpo = String(prefixo || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8);
  return `${limpo || "BETA"}-${corpo.slice(0, 4)}-${corpo.slice(4)}`;
}

// Normaliza o que a pessoa digitou: espaço sobrando, minúscula, e o hífen que
// ela esqueceu. "beta abcd efgh" e "BETA-ABCD-EFGH" são o mesmo cupom.
export function normalizar(codigo) {
  return String(codigo || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function comparavel(codigo) {
  return normalizar(codigo);
}

/* ── Emissão ──────────────────────────────────────────────────────────────── */

export function criarCupom({ creditos, usosMax = 1, diasParaExpirar = 30, observacao = "", criadoPor = null, prefixo = "BETA" }) {
  const qtd = Math.max(1, Math.min(100000, Math.floor(Number(creditos) || 0)));
  const usos = Math.max(1, Math.min(1000, Math.floor(Number(usosMax) || 1)));
  const dias = Math.max(0, Math.min(365, Math.floor(Number(diasParaExpirar) || 0)));

  const codigo = gerarCodigo(prefixo);
  const expira = dias > 0 ? new Date(Date.now() + dias * 86400000).toISOString() : null;

  banco()
    .prepare(
      `INSERT INTO cupom (codigo, creditos, usos_max, usos, expira_em, observacao, criado_por, criado_em, revogado)
       VALUES (?, ?, ?, 0, ?, ?, ?, ?, 0)`
    )
    .run(comparavel(codigo), qtd, usos, expira, String(observacao || "").slice(0, 200), criadoPor, agora());

  // Devolve o código FORMATADO (com hífen), que é como ele será lido e ditado; o
  // banco guarda a forma comparável.
  return { codigo, creditos: qtd, usos_max: usos, expira_em: expira, observacao };
}

export function revogarCupom(codigo) {
  const r = banco().prepare("UPDATE cupom SET revogado = 1 WHERE codigo = ?").run(comparavel(codigo));
  return r.changes > 0;
}

export function listarCupons(limite = 100) {
  return banco()
    .prepare(
      `SELECT codigo, creditos, usos_max, usos, expira_em, observacao, criado_em, revogado
       FROM cupom ORDER BY criado_em DESC LIMIT ?`
    )
    .all(Math.max(1, Math.min(500, limite)))
    .map((c) => ({
      ...c,
      revogado: Boolean(c.revogado),
      esgotado: c.usos >= c.usos_max,
      expirado: Boolean(c.expira_em && new Date(c.expira_em) < new Date()),
    }));
}

/* ── Validação e resgate ──────────────────────────────────────────────────── */

// Por que as mensagens são específicas ("expirou", "esgotado") em vez de uma só:
// o código tem entropia alta demais para ser adivinhado, então dizer o motivo não
// entrega nada — e um convidado legítimo com cupom vencido precisa saber que o
// problema é a data, não o que ele digitou. A mensagem genérica aqui mandaria a
// pessoa redigitar o mesmo código dez vezes.
export function conferirCupom(codigo) {
  const chave = comparavel(codigo);
  if (!chave) return { ok: false, motivo: "Informe o cupom." };

  const c = banco().prepare("SELECT * FROM cupom WHERE codigo = ?").get(chave);
  if (!c) return { ok: false, motivo: "Cupom não encontrado. Confira o código." };
  if (c.revogado) return { ok: false, motivo: "Este cupom foi cancelado." };
  if (c.expira_em && new Date(c.expira_em) < new Date()) {
    return { ok: false, motivo: "Este cupom expirou." };
  }
  if (c.usos >= c.usos_max) return { ok: false, motivo: "Este cupom já foi usado." };

  return { ok: true, creditos: c.creditos, restam: c.usos_max - c.usos };
}

// Marca o uso. Recebe o usuário porque o mesmo cupom de vários usos não pode ser
// resgatado duas vezes pela mesma conta.
//
// A contagem sobe com uma condição na PRÓPRIA atualização (`usos < usos_max`), e
// não com um "confere e depois grava": dois resgates simultâneos do último uso
// passariam os dois pela conferência e o cupom entregaria crédito a mais.
export function resgatarCupom({ codigo, usuarioId, email }) {
  const chave = comparavel(codigo);
  const conferencia = conferirCupom(chave);
  if (!conferencia.ok) return conferencia;

  const jaUsou = banco()
    .prepare("SELECT 1 FROM cupom_uso WHERE codigo = ? AND usuario_id = ?")
    .get(chave, usuarioId);
  if (jaUsou) return { ok: false, motivo: "Este cupom já foi usado por esta conta." };

  const r = banco()
    .prepare("UPDATE cupom SET usos = usos + 1 WHERE codigo = ? AND usos < usos_max AND revogado = 0")
    .run(chave);
  if (r.changes === 0) return { ok: false, motivo: "Este cupom já foi usado." };

  banco()
    .prepare("INSERT INTO cupom_uso (codigo, usuario_id, email, usado_em) VALUES (?, ?, ?, ?)")
    .run(chave, usuarioId, email || null, agora());

  return { ok: true, creditos: conferencia.creditos };
}

export function usosDoCupom(codigo, limite = 200) {
  return banco()
    .prepare("SELECT usuario_id, email, usado_em FROM cupom_uso WHERE codigo = ? ORDER BY usado_em DESC LIMIT ?")
    .all(comparavel(codigo), Math.max(1, Math.min(500, limite)));
}
