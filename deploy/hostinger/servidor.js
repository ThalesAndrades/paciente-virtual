// PONTO DE ENTRADA — garante o ambiente e só então entrega a aplicação.
//
// Este arquivo existe por causa de um acidente que derrubou a produção: o
// container clona o código a cada start, mas QUEM define o ambiente (versão do
// Node, instalação das dependências) é o `docker-compose.yml` que está no disco do
// servidor — um arquivo que o repositório não controla. Quando esse arquivo ficou
// para trás (Node 20, sem `npm ci`), o servidor passou a morrer no `import` da
// primeira dependência, em loop, e o site saiu do ar. Corrigir exigia acesso ao
// terminal do host, que nem sempre existe na hora em que o site cai.
//
// A lição: o que o repositório controla é o CÓDIGO, então é o código que precisa
// se defender. Aqui, antes de qualquer import da aplicação, o processo:
//
//   1. instala as dependências, se faltarem;
//   2. troca por um Node compatível, se o que existe for velho demais;
//   3. sobe uma página honesta de manutenção, se nada disso for possível —
//      porque um servidor que responde "estamos voltando" é infinitamente melhor
//      que um contêiner reiniciando sem parar atrás de um proxy que só diz
//      "no available server".
//
// Num ambiente correto — a stack versionada em `deploy/hostinger/docker-compose.yml`
// — as três etapas não fazem NADA: as dependências já estão lá e o Node já é o 22.
// O custo em produção é uma verificação de arquivo. É seguro deixar para sempre.

import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DIR_APP = path.dirname(fileURLToPath(import.meta.url));
const RAIZ = path.resolve(DIR_APP, "..", "..");

// `node:sqlite` — que o banco de contas usa — só existe a partir do Node 22.5.
const NODE_MINIMO = 22;

function versaoAtual() {
  return Number.parseInt(String(process.versions.node).split(".")[0], 10) || 0;
}

function log(mensagem) {
  console.log(`[entrada] ${mensagem}`);
}

function rodar(comando, argumentos, opcoes = {}) {
  // No Windows o `npm` é um `.cmd` e o spawn direto não o encontra. Produção é
  // Alpine, mas um instalador que só funciona num sistema é um instalador que
  // ninguém consegue testar antes de precisar dele — e este só é chamado
  // justamente quando algo já deu errado. Com shell, o comando vai inteiro numa
  // string: passar argumentos separados junto de `shell` é depreciado no Node.
  const noWindows = process.platform === "win32";
  const base = { cwd: RAIZ, stdio: "inherit", encoding: "utf-8", ...opcoes };
  return noWindows
    ? spawnSync([comando, ...argumentos].join(" "), { ...base, shell: true })
    : spawnSync(comando, argumentos, base);
}

// 1. Dependências ---------------------------------------------------------
function dependenciasPresentes() {
  try {
    const pacote = JSON.parse(fs.readFileSync(path.join(RAIZ, "package.json"), "utf-8"));
    const exigidas = Object.keys(pacote.dependencies || {});
    return exigidas.every((nome) => fs.existsSync(path.join(RAIZ, "node_modules", nome)));
  } catch {
    return false;
  }
}

function instalarDependencias() {
  log("dependências ausentes — instalando");
  // `npm ci` respeita o package-lock e é o certo quando ele existe. Se falhar
  // (lock incompatível com o npm da imagem), `npm install` ainda resolve.
  const comLock = fs.existsSync(path.join(RAIZ, "package-lock.json"));
  const tentativas = comLock
    ? [["ci", "--omit=dev", "--no-audit", "--no-fund"], ["install", "--omit=dev", "--no-audit", "--no-fund"]]
    : [["install", "--omit=dev", "--no-audit", "--no-fund"]];

  for (const argumentos of tentativas) {
    const r = rodar("npm", argumentos);
    if (r.status === 0 && dependenciasPresentes()) {
      log("dependências instaladas");
      return true;
    }
  }
  log("NÃO consegui instalar as dependências");
  return false;
}

// 2. Runtime --------------------------------------------------------------
//
// Troca o Node velho por um atual. Na imagem Alpine o pacote `nodejs-current`
// acompanha a versão mais nova do repositório da distribuição.
function caminhoDeNodeNovo() {
  for (const candidato of ["/usr/bin/node", "/usr/local/bin/node", "/usr/bin/nodejs"]) {
    if (candidato === process.execPath || !fs.existsSync(candidato)) continue;
    try {
      const versao = execFileSync(candidato, ["-v"], { encoding: "utf-8" }).trim();
      if (Number.parseInt(versao.replace(/^v/, ""), 10) >= NODE_MINIMO) return candidato;
    } catch {}
  }
  return null;
}

function instalarNodeAtual() {
  if (!fs.existsSync("/sbin/apk")) return null;
  log(`Node ${versaoAtual()} é antigo demais (mínimo ${NODE_MINIMO}) — instalando um atual`);
  rodar("/sbin/apk", ["add", "--no-cache", "nodejs-current"], { stdio: "ignore" });
  return caminhoDeNodeNovo();
}

// 3. Manutenção -----------------------------------------------------------
//
// Último recurso. Responde 200 na verificação de saúde para o proxy manter a
// rota viva, e uma página honesta em qualquer outro caminho. O objetivo é acabar
// com o loop de reinício e dizer a verdade a quem chegou.
function subirManutencao(motivo) {
  const porta = Number(process.env.PORT) || 3000;
  const pagina = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>THM Simulados Inteligentes — em manutenção</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#eef2f6;
font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;color:#16222e;padding:24px}
.c{max-width:460px;text-align:center;background:#fff;border:1px solid #dce3ec;border-radius:16px;
padding:32px;box-shadow:0 8px 24px rgba(16,34,46,.06)}h1{font-size:1.3rem;margin:0 0 10px}
p{color:#5a6b7b;line-height:1.55;margin:0}</style></head><body><div class="c">
<h1>Estamos voltando</h1><p>A plataforma está em manutenção neste momento. Suas consultas,
notas e créditos estão preservados. Tente de novo em alguns minutos.</p></div></body></html>`;

  console.error(`[entrada] MODO MANUTENÇÃO: ${motivo}`);
  http
    .createServer((req, res) => {
      if (req.url === "/healthz" || req.url === "/api/health") {
        res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ status: "manutencao", motivo }));
        return;
      }
      res.writeHead(503, { "Content-Type": "text/html; charset=utf-8", "Retry-After": "120" });
      res.end(pagina);
    })
    .listen(porta, process.env.HOST || "0.0.0.0", () => {
      console.error(`[entrada] página de manutenção em :${porta}`);
    });
}

// Sequência ---------------------------------------------------------------
async function entrar() {
  if (!dependenciasPresentes() && !instalarDependencias()) {
    subirManutencao("não foi possível instalar as dependências");
    return;
  }

  if (versaoAtual() < NODE_MINIMO) {
    // A guarda contra laço infinito: só uma troca de runtime por processo.
    if (process.env.THM_RUNTIME_TROCADO === "1") {
      subirManutencao(`Node ${versaoAtual()} não atende ao mínimo ${NODE_MINIMO}`);
      return;
    }
    const novo = caminhoDeNodeNovo() || instalarNodeAtual();
    if (!novo) {
      subirManutencao(`Node ${versaoAtual()} e não consegui instalar um mais novo`);
      return;
    }
    log(`reexecutando com ${novo}`);
    const r = rodar(novo, [fileURLToPath(import.meta.url)], {
      env: { ...process.env, THM_RUNTIME_TROCADO: "1" },
    });
    process.exit(r.status === null ? 1 : r.status);
  }

  const { iniciar } = await import("./aplicacao.js");
  await iniciar();
}

entrar().catch((erro) => {
  subirManutencao(`falha ao subir: ${(erro && erro.message) || erro}`);
});
