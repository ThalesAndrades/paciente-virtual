// Gera o retrato do ator de cada caso.
//
// POR QUE FOTO E NÃO 3D. O boneco 3D já esteve aqui e saiu (commit 58d2464):
// cabeça engolida pelo cabelo, olhos esbugalhados, ombros deformados. O problema
// não era a contagem de polígonos — era animar um rosto humano em tempo real, que
// é exatamente onde mora o vale da estranheza. Um humano quase-certo é pior que
// nenhum humano.
//
// Uma FOTOGRAFIA não tem esse problema: ela não tenta se mover. O realismo vem
// pronto, e a vida vem do que o produto já tem — o texto, a voz, o cronômetro e a
// palavra de estado. O que se anima é só o que uma foto pode fazer sem denunciar:
// respirar de leve e piscar por transição suave. A boca NUNCA se mexe.
//
// As pessoas são fictícias e geradas: ninguém é retratado sem consentimento, e o
// mesmo caso rende sempre o mesmo rosto (a semente sai do id).
//
//   REPLICATE_API_TOKEN=r8_... node scripts/gerar-retratos.mjs           # o que falta
//   REPLICATE_API_TOKEN=r8_... node scripts/gerar-retratos.mjs --ver     # só mostra
//   REPLICATE_API_TOKEN=r8_... node scripts/gerar-retratos.mjs --refazer apendicite
//
// Roda de novo sem medo: caso que já tem retrato é pulado, a não ser em --refazer.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { expressaoDoCaso } from "../deploy/hostinger/motor/expressao.js";

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DIR_CASOS = path.join(RAIZ, "casos");
const DIR_RETRATOS = path.join(RAIZ, "web", "retratos");

const argv = process.argv.slice(2);
const somenteVer = argv.includes("--ver");
const refazer = argv.includes("--refazer") ? argv[argv.indexOf("--refazer") + 1] : null;

const TOKEN = (process.env.REPLICATE_API_TOKEN || "").trim();
// Um placeholder deixado no arquivo de configuração falha com 401 lá na frente,
// depois de o script já ter percorrido o acervo. Melhor dizer aqui.
if (!somenteVer && (!TOKEN || !TOKEN.startsWith("r8_"))) {
  console.error(
    "REPLICATE_API_TOKEN ausente ou inválido (um token real começa com 'r8_').\n" +
      "Configure-o antes de rodar — este script gasta crédito de API."
  );
  process.exit(2);
}

// Semente estável por caso: o mesmo paciente tem sempre o mesmo rosto, inclusive
// se o retrato precisar ser gerado de novo um dia.
function semente(texto) {
  let h = 2166136261;
  for (let i = 0; i < texto.length; i++) {
    h ^= texto.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h) % 2_000_000_000;
}

// Como a pessoa está, em inglês, para o modelo.
//
// NÃO é um mapeamento novo: sai de `expressaoDoCaso`, o mesmo módulo que já
// alimenta a presença e que é coberto por teste. Escrever um segundo mapeamento
// aqui — por palavra-chave no diagnóstico — foi a primeira tentativa, e ela já
// divergia na estreia: apendicite, que é dor abdominal aguda, saía com "rosto
// apreensivo de quem espera ser examinado". Duas fontes de verdade sobre o estado
// do paciente produzem exatamente isso.
function comoEsta(exp) {
  const traco = [];
  const forte = (v) => v >= 0.55;
  const algum = (v) => v >= 0.3;

  if (forte(exp.dor)) traco.push("visible physical pain, brow furrowed, jaw tight, body slightly braced");
  else if (algum(exp.dor)) traco.push("discomfort held in check, tension around the eyes");

  if (forte(exp.tristeza)) traco.push("deep sadness and emotional exhaustion, eyes heavy");
  else if (algum(exp.tristeza)) traco.push("a quiet heaviness in the expression");

  if (forte(exp.medo)) traco.push("frightened and alert, eyes slightly widened");
  else if (algum(exp.medo)) traco.push("apprehensive");

  if (forte(exp.retraimento)) traco.push("withdrawn and guarded, shoulders drawn in");
  else if (algum(exp.retraimento)) traco.push("reserved, not fully at ease");

  if (forte(exp.agitacao)) traco.push("restless, unable to settle");
  if (forte(exp.tensao) && !forte(exp.dor)) traco.push("visibly tense");

  // Olhar: o caso decide para onde a pessoa olha, e isso muda o retrato inteiro.
  if (exp.olhar === "baixo") traco.push("gaze lowered");
  else if (exp.olhar === "desviado") traco.push("looking away from the camera");
  else traco.push("looking directly at the camera");

  return traco.length > 1
    ? traco.join(", ")
    : "the ordinary face of someone waiting to be examined, " + traco.join(", ");
}

function prompt(caso) {
  const id = caso.identificacao || {};
  const idade = Number(id.idade) || 40;
  const sexo = String(id.sexo || "").toLowerCase().startsWith("f") ? "woman" : "man";
  // A profissão entra porque ela aparece no rosto e nas roupas — um pedreiro de 38
  // e um professor de 38 não se parecem, e o acervo fica genérico sem isso.
  const profissao = String(id.profissao || "").split(/[(,;]/)[0].trim();

  return [
    `Documentary portrait photograph of a ${idade}-year-old Brazilian ${sexo}`,
    profissao ? `who works as ${profissao}` : "",
    "sitting in a plain clinic consultation room",
    comoEsta(expressaoDoCaso(caso)),
    "soft neutral daylight from a window, plain pale wall background, shallow depth of field",
    "natural skin texture, no makeup, no retouching, candid photojournalism, 85mm lens",
    // Sem estes, o modelo devolve foto de banco de imagens: gente sorrindo, de
    // jaleco, com estetoscópio. O paciente da estação não é o profissional.
    "NOT smiling, not a doctor, no lab coat, no stethoscope, no medical uniform",
  ]
    .filter(Boolean)
    .join(", ");
}

async function gerar(caso, id) {
  const resposta = await fetch("https://api.replicate.com/v1/models/black-forest-labs/flux-schnell/predictions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      "Content-Type": "application/json",
      Prefer: "wait",
    },
    body: JSON.stringify({
      input: {
        prompt: prompt(caso),
        aspect_ratio: "4:3",
        output_format: "webp",
        output_quality: 86,
        num_inference_steps: 4,
        seed: semente(id),
      },
    }),
  });

  if (!resposta.ok) {
    throw new Error(`${resposta.status} ${(await resposta.text()).slice(0, 200)}`);
  }

  const dados = await resposta.json();
  const url = Array.isArray(dados.output) ? dados.output[0] : dados.output;
  if (!url) throw new Error("resposta sem imagem");

  const imagem = Buffer.from(await (await fetch(url)).arrayBuffer());
  fs.mkdirSync(DIR_RETRATOS, { recursive: true });
  fs.writeFileSync(path.join(DIR_RETRATOS, `${id}.webp`), imagem);
  return imagem.length;
}

const casos = fs.readdirSync(DIR_CASOS).filter((n) => n.endsWith(".json")).sort();
let feitos = 0;
let pulados = 0;
const falhas = [];

for (const arquivo of casos) {
  const id = arquivo.replace(/\.json$/, "");
  const destino = path.join(DIR_RETRATOS, `${id}.webp`);

  if (fs.existsSync(destino) && refazer !== id) {
    pulados += 1;
    continue;
  }
  if (refazer && refazer !== id) {
    pulados += 1;
    continue;
  }

  const caso = JSON.parse(fs.readFileSync(path.join(DIR_CASOS, arquivo), "utf-8"));

  if (somenteVer) {
    console.log(`\n${id}\n  ${prompt(caso)}`);
    feitos += 1;
    continue;
  }

  try {
    const bytes = await gerar(caso, id);
    console.log(`  + ${id.padEnd(34)} ${(bytes / 1024).toFixed(0)} kB`);
    feitos += 1;
  } catch (erro) {
    console.error(`  ! ${id.padEnd(34)} ${erro.message}`);
    falhas.push(id);
  }
}

console.log(
  `\n${feitos} retrato(s) ${somenteVer ? "seriam gerados" : "gerados"}, ` +
    `${pulados} já existiam, ${falhas.length} falharam.`
);
if (falhas.length) {
  console.log(`Refazer os que falharam: ${falhas.map((f) => `--refazer ${f}`).join(" ")}`);
  process.exitCode = 1;
}
