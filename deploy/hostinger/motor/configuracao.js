// Configuração guardada no banco, para o que precisa mudar sem redeploy.
//
// Nasceu de um problema concreto: as chaves de cobrança viviam só no `.env` do
// host, e o `docker-compose.yml` do servidor — arquivo que o repositório não
// controla — precisava declarar cada variável para ela chegar ao container. Um
// compose desatualizado significava chave instalada e invisível para a aplicação,
// sem nenhum sinal de que era isso.
//
// Aqui a ordem de precedência é: BANCO primeiro, ambiente depois. Assim o dono
// instala a chave pelo painel, de qualquer lugar, e ela vale na hora; e quem
// preferir o `.env` continua funcionando exatamente como antes.
//
// O valor NUNCA volta para a tela. A interface mostra se está configurada e os
// últimos caracteres, o bastante para conferir qual chave é sem exibi-la.

import { DatabaseSync } from "node:sqlite";

import { caminhoDoBanco } from "./auth.js";

// As únicas chaves que podem ser guardadas aqui. Lista fechada de propósito: sem
// ela, a rota viraria um depósito de qualquer coisa que alguém resolvesse mandar.
export const CHAVES = ["WOOVI_APP_ID", "STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET"];

let bd = null;

function banco() {
  if (bd) return bd;
  bd = new DatabaseSync(caminhoDoBanco());
  bd.exec(`
    CREATE TABLE IF NOT EXISTS configuracao (
      chave TEXT PRIMARY KEY,
      valor TEXT NOT NULL,
      atualizado_em TEXT NOT NULL
    );
  `);
  return bd;
}

// Cache em memória: `segredo()` é chamado a cada cobrança e a cada webhook, e
// bater no disco para ler três linhas seria desperdício. Invalidado ao gravar.
let cache = null;

function carregar() {
  if (cache) return cache;
  cache = new Map();
  try {
    for (const linha of banco().prepare("SELECT chave, valor FROM configuracao").all()) {
      cache.set(linha.chave, linha.valor);
    }
  } catch {
    /* banco indisponível: cai no ambiente, que é o comportamento antigo */
  }
  return cache;
}

// O valor efetivo de um segredo. Banco vence ambiente.
export function segredo(nome) {
  const doBanco = carregar().get(nome);
  if (doBanco) return doBanco;
  return (process.env[nome] || "").trim();
}

export function definirSegredo(nome, valor) {
  if (!CHAVES.includes(nome)) throw new Error(`Chave desconhecida: ${nome}`);
  const limpo = String(valor || "").trim();
  const b = banco();
  if (!limpo) {
    b.prepare("DELETE FROM configuracao WHERE chave = ?").run(nome);
  } else {
    b.prepare(
      `INSERT INTO configuracao (chave, valor, atualizado_em) VALUES (?, ?, ?)
       ON CONFLICT(chave) DO UPDATE SET valor = excluded.valor, atualizado_em = excluded.atualizado_em`
    ).run(nome, limpo, new Date().toISOString());
  }
  cache = null;
  return true;
}

// O que a tela pode ver: se está configurada, de onde veio e os últimos quatro
// caracteres. Nunca o valor.
export function estadoDosSegredos() {
  const doBanco = carregar();
  return CHAVES.map((nome) => {
    const valor = segredo(nome);
    return {
      chave: nome,
      configurada: Boolean(valor),
      origem: doBanco.get(nome) ? "painel" : valor ? "ambiente" : null,
      final: valor ? `…${valor.slice(-4)}` : null,
    };
  });
}

export function fecharConfiguracao() {
  cache = null;
  if (bd) {
    try {
      bd.close();
    } catch {}
    bd = null;
  }
}
