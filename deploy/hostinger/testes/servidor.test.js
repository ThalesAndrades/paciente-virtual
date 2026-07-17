// Teste ponta a ponta do servidor Node (node --test), em modo demonstração.

import assert from "node:assert/strict";
import test from "node:test";

import { criarServidor } from "../servidor.js";

// Sem Ollama acessível, o paciente deve responder em modo demo.
process.env.OLLAMA_URL = "http://127.0.0.1:9";

async function api(base, caminho, corpo) {
  const resposta = await fetch(`${base}${caminho}`, {
    method: corpo === undefined ? "GET" : "POST",
    headers: { "Content-Type": "application/json" },
    body: corpo === undefined ? undefined : JSON.stringify(corpo),
  });
  return { status: resposta.status, dados: await resposta.json() };
}

test("fluxo completo de consulta em modo demonstração", async () => {
  const servidor = criarServidor();
  await new Promise((resolver) => servidor.listen(0, "127.0.0.1", resolver));
  const base = `http://127.0.0.1:${servidor.address().port}`;

  try {
    const casos = await api(base, "/api/casos");
    assert.equal(casos.status, 200);
    assert.ok(casos.dados.some((caso) => caso.id === "infarto"));
    assert.ok(casos.dados.some((caso) => caso.id === "depressao"));

    const voz = await api(base, "/api/voz");
    assert.deepEqual(voz.dados, { stt: false, tts: { feminino: false, masculino: false } });

    const invalido = await api(base, "/api/consultas", { caso: "../etc/passwd" });
    assert.equal(invalido.status, 404);

    const consulta = await api(base, "/api/consultas", { caso: "infarto", aluno: "Node E2E" });
    assert.equal(consulta.status, 200);
    assert.equal(consulta.dados.paciente.nome, "João Carlos Ferreira");
    const id = consulta.dados.id;

    const exame = await api(base, `/api/consultas/${id}/mensagem`, {
      texto: "vou aferir sua pressão",
    });
    assert.equal(exame.dados.eventos[0].tipo, "exame");
    assert.match(exame.dados.eventos[0].resultado, /170\/100/);

    const anamnese = await api(base, `/api/consultas/${id}/mensagem`, {
      texto: "quando começou a dor?",
    });
    const eventoPaciente = anamnese.dados.eventos.find((evento) => evento.tipo === "paciente");
    assert.equal(eventoPaciente.origem, "demo");
    assert.match(eventoPaciente.texto, /2 horas/);

    const fim = await api(base, `/api/consultas/${id}/encerrar`, {});
    assert.equal(fim.status, 200);
    assert.ok(fim.dados.checklist.nota_total > 0);
    assert.equal(fim.dados.parecer, null);

    const depois = await api(base, `/api/consultas/${id}/mensagem`, { texto: "oi" });
    assert.equal(depois.status, 409);
  } finally {
    servidor.close();
  }
});
