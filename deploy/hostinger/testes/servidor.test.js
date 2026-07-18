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

test("health check reflete o modo conforme OLLAMA_URL", async () => {
  const servidor = criarServidor();
  await new Promise((resolver) => servidor.listen(0, "127.0.0.1", resolver));
  const base = `http://127.0.0.1:${servidor.address().port}`;
  const original = process.env.OLLAMA_URL;

  try {
    process.env.OLLAMA_URL = "http://127.0.0.1:11434";
    const comIa = await api(base, "/healthz");
    assert.equal(comIa.status, 200);
    assert.equal(comIa.dados.status, "ok");
    assert.equal(comIa.dados.modo, "ia");

    delete process.env.OLLAMA_URL;
    const semIa = await api(base, "/api/health");
    assert.equal(semIa.status, 200);
    assert.equal(semIa.dados.modo, "demonstracao");
  } finally {
    process.env.OLLAMA_URL = original;
    servidor.close();
  }
});

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

    // Painel do professor: a consulta recém-gravada aparece e é detalhável.
    const arquivo = fim.dados.transcript;
    if (arquivo && arquivo.endsWith(".txt")) {
      try {
        const painel = await api(base, "/api/relatorio");
        assert.equal(painel.status, 200);
        const item = painel.dados.find((consulta) => consulta.arquivo === arquivo);
        assert.ok(item, "consulta gravada deveria aparecer no painel");
        assert.equal(item.aluno, "Node E2E");
        assert.ok(item.nota > 0);

        const detalhe = await api(base, `/api/relatorio/${encodeURIComponent(arquivo)}`);
        assert.equal(detalhe.status, 200);
        assert.ok(detalhe.dados.eventos.some((evento) => evento.tipo === "exame"));

        const invalido = await api(base, "/api/relatorio/..%2Fpyproject.toml");
        assert.equal(invalido.status, 404);
      } finally {
        const fs = await import("node:fs");
        const path = await import("node:path");
        const { fileURLToPath } = await import("node:url");
        const raiz = path.resolve(
          path.dirname(fileURLToPath(import.meta.url)),
          "..",
          "..",
          ".."
        );
        fs.rmSync(path.join(raiz, "historico", arquivo), { force: true });
      }
    }
  } finally {
    servidor.close();
  }
});
