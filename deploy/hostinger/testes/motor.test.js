// Testes de paridade do motor portado para Node (node --test).

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { extrairTextoProfissional, pontuarChecklist, termosDoItem } from "../motor/avaliador.js";
import { RESPOSTA_PADRAO, responderDemo } from "../motor/demo.js";
import { detectarExames } from "../motor/exames.js";
import { limparRaciocinio } from "../motor/ia.js";
import { criarPrompt } from "../motor/prompt.js";
import { contemTermo, normalizar } from "../motor/texto.js";

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

function lerCaso(nome) {
  return JSON.parse(fs.readFileSync(path.join(RAIZ, "casos", `${nome}.json`), "utf-8"));
}

test("normalizar remove acentos e hífens", () => {
  assert.equal(normalizar("Pressão-Arterial"), "pressao arterial");
  assert.equal(normalizar("  raio   x  "), "raio x");
});

test("contemTermo respeita limites de palavra e acentos", () => {
  assert.ok(contemTermo("vou aferir sua pressao agora", "pressão"));
  assert.ok(contemTermo("verifique a FC do paciente", "fc"));
  assert.ok(!contemTermo("solicito eletrocardiograma", "eletro"));
  assert.ok(contemTermo("solicito um raio-x de tórax", "raio x"));
});

test("anamnese não dispara exame; solicitação dispara", () => {
  const caso = lerCaso("infarto");

  assert.equal(detectarExames("o senhor tem pressão alta?", caso).length, 0);
  assert.equal(detectarExames("já fez um eletro alguma vez?", caso).length, 0);

  const entregues = detectarExames("vou aferir sua pressão e solicito um ecg", caso);
  const nomes = entregues.map(([, dados]) => dados.nome);
  assert.ok(nomes.includes("Pressão arterial"));
  assert.ok(nomes.includes("Eletrocardiograma"));
});

test("escala psicométrica dispara com 'aplicar'", () => {
  const caso = lerCaso("depressao");
  const entregues = detectarExames("vou aplicar o PHQ-9", caso);
  assert.equal(entregues.length, 1);
  assert.match(entregues[0][1].nome, /PHQ-9/);
});

test("paciente demo responde identificação e sintomas", () => {
  const infarto = lerCaso("infarto");
  assert.match(responderDemo(infarto, "Qual é o seu nome?"), /João Carlos Ferreira/);
  assert.match(responderDemo(infarto, "O senhor sente suor frio?"), /^Sim/);
  assert.match(responderDemo(infarto, "Tem diabetes?"), /^Não/);
  assert.equal(responderDemo(infarto, "xyz abc"), RESPOSTA_PADRAO);
});

test("demo só revela ideação com pergunta direta", () => {
  const depressao = lerCaso("depressao");
  const generica = responderDemo(depressao, "O que o senhor está sentindo?");
  assert.ok(!generica.toLowerCase().includes("não acordar"));

  const direta = responderDemo(depressao, "Você tem pensado em morrer ou se machucar?");
  assert.match(direta.toLowerCase(), /dormir e não acordar/);
});

test("checklist pontua só as falas do profissional", () => {
  const transcript = [
    "=".repeat(50),
    "CASO: infarto",
    "=".repeat(50),
    "",
    "PROFISSIONAL: quando começou a dor?",
    "",
    "PACIENTE: Há 2 horas. Sinto sudorese.",
    "",
    "PROFISSIONAL: solicito ecg",
    "",
    "EXAME SOLICITADO: Eletrocardiograma",
    "RESULTADO: Supradesnivelamento de ST",
  ].join("\n");

  const textoProfissional = extrairTextoProfissional(transcript);
  assert.ok(!textoProfissional.includes("sudorese"));
  assert.ok(!textoProfissional.includes("Supradesnivelamento"));

  const rubrica = {
    criterios: [
      {
        nome: "Dor",
        peso: 4,
        objetivo: "Caracterizar.",
        itens: [
          { nome: "início", termos: ["quando começou"] },
          { nome: "irradiação", termos: ["irradia"] },
        ],
      },
      {
        nome: "Exames",
        peso: 6,
        objetivo: "Solicitar.",
        itens: [{ nome: "ecg", termos: ["ecg"] }],
      },
    ],
  };

  const resultado = pontuarChecklist(rubrica, textoProfissional);
  assert.equal(resultado.nota_total, 8);
  assert.deepEqual(
    resultado.criterios.map((criterio) => criterio.nota),
    [2, 6]
  );
});

test("termosDoItem aceita string e objeto", () => {
  assert.deepEqual(termosDoItem("ecg"), ["ecg", ["ecg"]]);
  assert.deepEqual(termosDoItem({ nome: "início", termos: ["começou"] }), ["início", ["começou"]]);
});

test("prompt inclui dados do caso sem repr estranho", () => {
  const caso = lerCaso("infarto");
  const prompt = criarPrompt(caso);
  assert.ok(prompt.includes("João Carlos Ferreira"));
  assert.ok(prompt.includes("Hipertensao: Sim"));
  assert.ok(!prompt.includes("true"));
});

test("limparRaciocinio remove blocos think", () => {
  assert.equal(limparRaciocinio("<think>hum...</think>Dói no peito."), "Dói no peito.");
});

test("relatorio extrai metadados e estrutura o transcript", async () => {
  const { estruturarTranscript, extrairMetadados } = await import("../motor/relatorio.js");

  const transcript = [
    "=".repeat(50),
    "CASO: infarto",
    "ALUNO: Maria Silva",
    "INICIO: 2026-07-17 10:00:00",
    "=".repeat(50),
    "",
    "PROFISSIONAL: quando começou a dor?",
    "",
    "PACIENTE: Começou há 2 horas.",
    "Estou com muito medo, doutor.",
    "",
    "EXAME SOLICITADO: Eletrocardiograma",
    "RESULTADO: Supradesnivelamento de ST",
    "",
    "ENCERRADA: 2026-07-17 10:12:00",
  ].join("\n");

  const metadados = extrairMetadados(transcript);
  assert.equal(metadados.caso, "infarto");
  assert.equal(metadados.aluno, "Maria Silva");
  assert.equal(metadados.encerrada, true);

  const eventos = estruturarTranscript(transcript);
  assert.deepEqual(
    eventos.map((evento) => evento.tipo),
    ["profissional", "paciente", "exame"]
  );
  assert.match(eventos[1].texto, /muito medo/);
  assert.equal(eventos[2].nome, "Eletrocardiograma");
});
