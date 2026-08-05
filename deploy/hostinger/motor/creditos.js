// Créditos: o livro-razão de quem pode usar a ferramenta e quanto já usou.
//
// É um RAZÃO, não um contador. Saldo é a soma dos lançamentos, e todo lançamento
// diz de onde veio (boas-vindas, compra, assinatura, consulta, voz, estorno). Um
// contador simples seria menos código e um pesadelo no primeiro suporte: "sumiram
// meus créditos" sem nenhuma linha para mostrar é uma discussão sem árbitro.
//
// Vive no MESMO SQLite do Better Auth: um banco só, um volume só, um backup só. O
// `node:sqlite` é síncrono, o que aqui é virtude — o débito acontece dentro da
// mesma transação da checagem de saldo, sem janela para gastar duas vezes.

import { DatabaseSync } from "node:sqlite";

import { caminhoDoBanco } from "./auth.js";
import { creditosDeBoasVindas } from "./planos.js";

let bd = null;

function banco() {
  if (bd) return bd;
  bd = new DatabaseSync(caminhoDoBanco());
  // WAL: leitura e escrita concorrentes sem travar a aula inteira quando o
  // professor abre o painel no meio de uma turma consultando.
  try {
    bd.exec("PRAGMA journal_mode = WAL");
  } catch {}
  // As tabelas nascem junto com a conexão, não num passo separado que alguém
  // precise lembrar de chamar. Um servidor no ar sem elas responderia 500 na
  // primeira consulta de qualquer aluno — e "esqueci de migrar" não é uma
  // explicação aceitável para uma turma parada.
  criarTabelas(bd);
  return bd;
}

// Idempotente por construção: roda a cada abertura de conexão e não faz nada
// quando já está tudo lá.
export function migrarCreditos() {
  banco();
}

function criarTabelas(b) {
  b.exec(`
    CREATE TABLE IF NOT EXISTS credito_lancamento (
      id TEXT PRIMARY KEY,
      usuario_id TEXT NOT NULL,
      delta INTEGER NOT NULL,
      motivo TEXT NOT NULL,
      referencia TEXT,
      criado_em TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_credito_usuario ON credito_lancamento(usuario_id);
    -- A chave da IDEMPOTÊNCIA: um webhook repetido (e eles repetem) não credita
    -- duas vezes, porque o par motivo+referência já existe.
    CREATE UNIQUE INDEX IF NOT EXISTS idx_credito_referencia
      ON credito_lancamento(motivo, referencia) WHERE referencia IS NOT NULL;

    CREATE TABLE IF NOT EXISTS pagamento (
      id TEXT PRIMARY KEY,
      usuario_id TEXT NOT NULL,
      provedor TEXT NOT NULL,
      provedor_id TEXT,
      tipo TEXT NOT NULL,
      item TEXT NOT NULL,
      valor_centavos INTEGER NOT NULL,
      creditos INTEGER NOT NULL,
      status TEXT NOT NULL,
      criado_em TEXT NOT NULL,
      pago_em TEXT,
      dados TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_pagamento_usuario ON pagamento(usuario_id);
    CREATE INDEX IF NOT EXISTS idx_pagamento_provedor ON pagamento(provedor, provedor_id);

    CREATE TABLE IF NOT EXISTS assinatura (
      usuario_id TEXT PRIMARY KEY,
      plano TEXT NOT NULL,
      provedor TEXT NOT NULL,
      provedor_id TEXT,
      status TEXT NOT NULL,
      periodo_fim TEXT,
      atualizado_em TEXT NOT NULL
    );
  `);
}

function agora() {
  return new Date().toISOString();
}

function novoId() {
  return crypto.randomUUID();
}

export function saldo(usuarioId) {
  if (!usuarioId) return 0;
  const linha = banco()
    .prepare("SELECT COALESCE(SUM(delta), 0) AS total FROM credito_lancamento WHERE usuario_id = ?")
    .get(usuarioId);
  return Number(linha && linha.total) || 0;
}

// Lança créditos. Devolve `{ ok, saldo, repetido }` — `repetido` quando a
// referência já tinha sido lançada, que é o caso normal de webhook reenviado e
// NÃO é erro.
export function creditar(usuarioId, quantidade, motivo, referencia = null) {
  const valor = Math.trunc(Number(quantidade) || 0);
  if (!usuarioId || valor <= 0) return { ok: false, saldo: saldo(usuarioId), repetido: false };
  try {
    banco()
      .prepare(
        "INSERT INTO credito_lancamento (id, usuario_id, delta, motivo, referencia, criado_em) VALUES (?, ?, ?, ?, ?, ?)"
      )
      .run(novoId(), usuarioId, valor, motivo, referencia, agora());
    return { ok: true, saldo: saldo(usuarioId), repetido: false };
  } catch (erro) {
    // Violação do índice único = já creditado. Silenciar aqui é o comportamento
    // correto: o provedor manda o mesmo evento várias vezes de propósito.
    if (String(erro && erro.message).includes("UNIQUE")) {
      return { ok: true, saldo: saldo(usuarioId), repetido: true };
    }
    throw erro;
  }
}

// Debita se houver saldo. Tudo dentro de uma transação: entre conferir e gastar
// não pode caber uma segunda requisição da mesma pessoa (duas abas, dois cliques).
export function debitar(usuarioId, quantidade, motivo, referencia = null) {
  const valor = Math.trunc(Number(quantidade) || 0);
  if (!usuarioId) return { ok: false, saldo: 0, faltam: valor };
  if (valor <= 0) return { ok: true, saldo: saldo(usuarioId), faltam: 0 };

  const b = banco();
  b.exec("BEGIN IMMEDIATE");
  try {
    const atual = saldo(usuarioId);
    if (atual < valor) {
      b.exec("ROLLBACK");
      return { ok: false, saldo: atual, faltam: valor - atual };
    }
    b.prepare(
      "INSERT INTO credito_lancamento (id, usuario_id, delta, motivo, referencia, criado_em) VALUES (?, ?, ?, ?, ?, ?)"
    ).run(novoId(), usuarioId, -valor, motivo, referencia, agora());
    b.exec("COMMIT");
    return { ok: true, saldo: atual - valor, faltam: 0 };
  } catch (erro) {
    try {
      b.exec("ROLLBACK");
    } catch {}
    throw erro;
  }
}

// Devolve o que não foi usado. Existe para o caso em que a consulta é debitada e
// falha ANTES de começar de verdade — cobrar por algo que não aconteceu é o tipo
// de erro que destrói a confiança na ferramenta inteira.
export function estornar(usuarioId, quantidade, referencia) {
  return creditar(usuarioId, quantidade, "estorno", referencia);
}

// Uma vez por conta, na criação. A referência é o próprio id do usuário, então
// nem um bug de chamada dupla dá crédito de graça duas vezes.
export function darBoasVindas(usuarioId) {
  const quantidade = creditosDeBoasVindas();
  if (quantidade <= 0) return { ok: false, saldo: saldo(usuarioId), repetido: false };
  return creditar(usuarioId, quantidade, "boas-vindas", usuarioId);
}

export function extrato(usuarioId, limite = 30) {
  return banco()
    .prepare(
      `SELECT delta, motivo, referencia, criado_em FROM credito_lancamento
       WHERE usuario_id = ? ORDER BY criado_em DESC LIMIT ?`
    )
    .all(usuarioId, Math.min(200, Math.max(1, limite)))
    .map((l) => ({ ...l, delta: Number(l.delta) }));
}

/* ── Pagamentos ─────────────────────────────────────────────────────────── */

export function registrarPagamento(p) {
  banco()
    .prepare(
      `INSERT INTO pagamento (id, usuario_id, provedor, provedor_id, tipo, item, valor_centavos, creditos, status, criado_em, dados)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      p.id,
      p.usuarioId,
      p.provedor,
      p.provedorId || null,
      p.tipo,
      p.item,
      p.valorCentavos,
      p.creditos,
      p.status || "pendente",
      agora(),
      p.dados ? JSON.stringify(p.dados) : null
    );
}

export function pagamentoPorId(id) {
  const linha = banco().prepare("SELECT * FROM pagamento WHERE id = ?").get(id);
  if (!linha) return null;
  return { ...linha, dados: linha.dados ? JSON.parse(linha.dados) : null };
}

export function pagamentoPorProvedor(provedor, provedorId) {
  const linha = banco()
    .prepare("SELECT * FROM pagamento WHERE provedor = ? AND provedor_id = ?")
    .get(provedor, provedorId);
  if (!linha) return null;
  return { ...linha, dados: linha.dados ? JSON.parse(linha.dados) : null };
}

export function definirProvedorId(id, provedorId) {
  banco().prepare("UPDATE pagamento SET provedor_id = ? WHERE id = ?").run(provedorId, id);
}

// Marca como pago E credita, em uma operação só. Se a mesma confirmação chegar
// duas vezes, a segunda não move saldo — quem garante é o índice único do razão.
export function confirmarPagamento(id) {
  const pago = pagamentoPorId(id);
  if (!pago) return { ok: false, motivo: "pagamento desconhecido" };
  if (pago.status === "pago") return { ok: true, repetido: true, saldo: saldo(pago.usuario_id) };

  const lancamento = creditar(pago.usuario_id, pago.creditos, "compra", pago.id);
  banco().prepare("UPDATE pagamento SET status = 'pago', pago_em = ? WHERE id = ?").run(agora(), id);
  return { ok: true, repetido: Boolean(lancamento.repetido), saldo: lancamento.saldo, pagamento: pago };
}

export function marcarStatus(id, status) {
  banco().prepare("UPDATE pagamento SET status = ? WHERE id = ?").run(status, id);
}

export function pagamentosDoUsuario(usuarioId, limite = 10) {
  return banco()
    .prepare("SELECT * FROM pagamento WHERE usuario_id = ? ORDER BY criado_em DESC LIMIT ?")
    .all(usuarioId, limite)
    .map((l) => ({ ...l, dados: l.dados ? JSON.parse(l.dados) : null }));
}

/* ── Assinaturas ────────────────────────────────────────────────────────── */

export function salvarAssinatura({ usuarioId, plano, provedor, provedorId, status, periodoFim }) {
  banco()
    .prepare(
      `INSERT INTO assinatura (usuario_id, plano, provedor, provedor_id, status, periodo_fim, atualizado_em)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(usuario_id) DO UPDATE SET
         plano = excluded.plano, provedor = excluded.provedor, provedor_id = excluded.provedor_id,
         status = excluded.status, periodo_fim = excluded.periodo_fim, atualizado_em = excluded.atualizado_em`
    )
    .run(usuarioId, plano, provedor, provedorId || null, status, periodoFim || null, agora());
}

export function assinaturaDoUsuario(usuarioId) {
  return banco().prepare("SELECT * FROM assinatura WHERE usuario_id = ?").get(usuarioId) || null;
}

export function assinaturaPorProvedorId(provedorId) {
  return banco().prepare("SELECT * FROM assinatura WHERE provedor_id = ?").get(provedorId) || null;
}

// Só para os testes: cada arquivo de teste roda contra um banco temporário, e o
// módulo guarda a conexão em memória entre eles.
export function fecharBanco() {
  if (bd) {
    try {
      bd.close();
    } catch {}
    bd = null;
  }
}
