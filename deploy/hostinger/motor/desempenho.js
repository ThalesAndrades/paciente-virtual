// Desempenho do aluno ao longo do tempo — o que o transcript sozinho não conta.
//
// Cada estação já era gravada em arquivo, item a item. Só que arquivo é memória de
// professor, não de aluno: quem estuda para o Revalida precisa saber se está
// melhorando, em QUAL área está pior e qual item do PEP erra sempre. Sem isso, a
// ferramenta devolve uma nota por vez e o aluno repete o mesmo erro em dez
// estações seguidas sem nunca ver o padrão.
//
// Guarda o mínimo que responde essas perguntas: a nota de cada estação, com área e
// data, e os itens do PEP em que ele não foi adequado. Transcrição continua em
// disco — aqui não entra nada que já esteja lá.
//
// Mesmo banco de todo o resto (Better Auth + créditos): um volume, um backup.

import { DatabaseSync } from "node:sqlite";

import { caminhoDoBanco } from "./auth.js";

let bd = null;

function banco() {
  if (bd) return bd;
  bd = new DatabaseSync(caminhoDoBanco());
  try {
    bd.exec("PRAGMA journal_mode = WAL");
  } catch {}
  criarTabelas(bd);
  return bd;
}

export function migrarDesempenho() {
  banco();
}

function criarTabelas(b) {
  b.exec(`
    CREATE TABLE IF NOT EXISTS desempenho (
      id TEXT PRIMARY KEY,
      usuario_id TEXT NOT NULL,
      caso TEXT NOT NULL,
      titulo TEXT NOT NULL,
      area TEXT NOT NULL,
      area_nome TEXT NOT NULL,
      nota REAL NOT NULL,
      nota_maxima REAL NOT NULL,
      -- Preenchido quando a estação veio de um circuito. Serve para separar
      -- "treino solto" de "simulado", que são coisas diferentes de estudar.
      prova_id TEXT,
      duracao_s INTEGER,
      criado_em TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_desempenho_usuario ON desempenho(usuario_id, criado_em);

    -- Um item do PEP em que o aluno não foi adequado. Só os perdidos: guardar os
    -- acertos dobraria a tabela para responder a pergunta menos útil.
    CREATE TABLE IF NOT EXISTS desempenho_item (
      id TEXT PRIMARY KEY,
      usuario_id TEXT NOT NULL,
      desempenho_id TEXT NOT NULL,
      area TEXT NOT NULL,
      item_id TEXT NOT NULL,
      descricao TEXT NOT NULL,
      nivel TEXT NOT NULL,
      criado_em TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_desempenho_item_usuario ON desempenho_item(usuario_id);
  `);
}

function agora() {
  return new Date().toISOString();
}

// Registra uma estação encerrada. Nunca lança: um erro de gravação de histórico
// não pode derrubar a resposta que traz a nota do aluno — ele acabou de fazer a
// estação, e perder a nota por causa do diário seria trocar o principal pelo
// acessório.
export function registrarEstacao({
  usuarioId,
  caso,
  titulo,
  area,
  areaNome,
  nota,
  notaMaxima,
  prova = null,
  duracao = null,
  itens = [],
}) {
  if (!usuarioId || !caso) return null;
  try {
    const id = crypto.randomUUID();
    const quando = agora();
    banco()
      .prepare(
        `INSERT INTO desempenho
           (id, usuario_id, caso, titulo, area, area_nome, nota, nota_maxima, prova_id, duracao_s, criado_em)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        id,
        usuarioId,
        caso,
        String(titulo || caso),
        String(area || "clinica_medica"),
        String(areaNome || area || ""),
        Number(nota) || 0,
        Number(notaMaxima) || 10,
        prova,
        duracao === null ? null : Math.round(Number(duracao) || 0),
        quando
      );

    const gravarItem = banco().prepare(
      `INSERT INTO desempenho_item
         (id, usuario_id, desempenho_id, area, item_id, descricao, nivel, criado_em)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    );
    for (const item of itens) {
      if (!item || item.nivel === "adequado") continue;
      gravarItem.run(
        crypto.randomUUID(),
        usuarioId,
        id,
        String(area || "clinica_medica"),
        String(item.id || ""),
        String(item.descricao || "").slice(0, 300),
        String(item.nivel || "inadequado"),
        quando
      );
    }
    return id;
  } catch {
    return null;
  }
}

// Tudo o que a tela "meu desempenho" mostra, numa consulta só de leitura.
export function resumoDoAluno(usuarioId, { limite = 20 } = {}) {
  const vazio = {
    estacoes: 0,
    media: 0,
    melhor: 0,
    por_area: [],
    recentes: [],
    fracos: [],
    simulados: 0,
  };
  if (!usuarioId) return vazio;

  try {
    const b = banco();
    const geral = b
      .prepare(
        `SELECT COUNT(*) AS n, AVG(nota) AS media, MAX(nota) AS melhor,
                COUNT(DISTINCT prova_id) AS provas
           FROM desempenho WHERE usuario_id = ?`
      )
      .get(usuarioId);
    if (!geral || !geral.n) return vazio;

    const porArea = b
      .prepare(
        `SELECT area, area_nome, COUNT(*) AS n, AVG(nota) AS media
           FROM desempenho WHERE usuario_id = ?
          GROUP BY area ORDER BY media ASC`
      )
      .all(usuarioId);

    const recentes = b
      .prepare(
        `SELECT caso, titulo, area_nome, nota, nota_maxima, prova_id, criado_em
           FROM desempenho WHERE usuario_id = ?
          ORDER BY criado_em DESC LIMIT ?`
      )
      .all(usuarioId, Math.max(1, Math.min(100, limite)));

    // O item que ele mais erra. É a pergunta que o aluno faria ao professor se
    // tivesse um — "o que eu sempre esqueço?".
    const fracos = b
      .prepare(
        `SELECT descricao, area, COUNT(*) AS vezes
           FROM desempenho_item WHERE usuario_id = ? AND descricao <> ''
          GROUP BY descricao HAVING vezes >= 2
          ORDER BY vezes DESC, descricao ASC LIMIT 6`
      )
      .all(usuarioId);

    return {
      estacoes: Number(geral.n) || 0,
      media: Number((Number(geral.media) || 0).toFixed(2)),
      melhor: Number((Number(geral.melhor) || 0).toFixed(2)),
      // `prova_id` nulo entra no COUNT(DISTINCT) como nada, então treino solto
      // não infla a conta de simulados.
      simulados: Number(geral.provas) || 0,
      por_area: porArea.map((a) => ({
        area: a.area,
        area_nome: a.area_nome || a.area,
        estacoes: Number(a.n) || 0,
        media: Number((Number(a.media) || 0).toFixed(2)),
      })),
      recentes: recentes.map((r) => ({
        caso: r.caso,
        titulo: r.titulo,
        area_nome: r.area_nome,
        nota: Number(r.nota),
        nota_maxima: Number(r.nota_maxima),
        simulado: Boolean(r.prova_id),
        quando: r.criado_em,
      })),
      fracos: fracos.map((f) => ({ descricao: f.descricao, area: f.area, vezes: Number(f.vezes) })),
    };
  } catch {
    return vazio;
  }
}

// Áreas em que o aluno está pior, para o sorteio poder puxar o treino para lá.
// Devolve as chaves de área ordenadas da pior média para a melhor, considerando
// só quem já tem estação suficiente para a média significar alguma coisa.
export function areasFracas(usuarioId, { minimo = 2 } = {}) {
  if (!usuarioId) return [];
  try {
    return banco()
      .prepare(
        `SELECT area FROM desempenho WHERE usuario_id = ?
          GROUP BY area HAVING COUNT(*) >= ? ORDER BY AVG(nota) ASC`
      )
      .all(usuarioId, minimo)
      .map((l) => l.area);
  } catch {
    return [];
  }
}
