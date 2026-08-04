// Teste ponta a ponta do servidor Node (node --test), em modo demonstração.

import assert from "node:assert/strict";
import test from "node:test";

import { criarServidor } from "../servidor.js";

// Sem Ollama acessível, o paciente deve responder em modo demo.
process.env.OLLAMA_URL = "http://127.0.0.1:9";
process.env.PV_CODIGO_ACESSO = "9271";
process.env.PV_SENHA_PROFESSOR = "senha-de-teste";

// Cliente que guarda o cookie de sessão, como o navegador faz.
function criarCliente(base) {
  let cookie = "";
  return async function api(caminho, corpo, metodo) {
    const resposta = await fetch(`${base}${caminho}`, {
      method: metodo || (corpo === undefined ? "GET" : "POST"),
      headers: { "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}) },
      body: corpo === undefined ? undefined : JSON.stringify(corpo),
    });
    const definido = resposta.headers.get("set-cookie");
    if (definido) cookie = definido.split(";")[0];
    const tipo = resposta.headers.get("content-type") || "";
    return {
      status: resposta.status,
      dados: tipo.includes("json") ? await resposta.json() : await resposta.text(),
    };
  };
}

async function subir() {
  const servidor = criarServidor();
  await new Promise((resolver) => servidor.listen(0, "127.0.0.1", resolver));
  return { servidor, api: criarCliente(`http://127.0.0.1:${servidor.address().port}`) };
}

test("health check reflete o modo conforme OLLAMA_URL", async () => {
  const { servidor, api } = await subir();
  const original = process.env.OLLAMA_URL;

  try {
    process.env.OLLAMA_URL = "http://127.0.0.1:11434";
    const comIa = await api("/healthz");
    assert.equal(comIa.status, 200);
    assert.equal(comIa.dados.status, "ok");
    assert.equal(comIa.dados.modo, "ia");

    delete process.env.OLLAMA_URL;
    const semIa = await api("/api/health");
    assert.equal(semIa.status, 200);
    assert.equal(semIa.dados.modo, "demonstracao");
  } finally {
    process.env.OLLAMA_URL = original;
    servidor.close();
  }
});

test("sem sessão, consulta e painel ficam fechados", async () => {
  const { servidor, api } = await subir();
  try {
    // A vitrine é aberta — é o que a página inicial mostra antes do código.
    assert.equal((await api("/api/casos")).status, 200);
    assert.equal((await api("/api/voz")).status, 200);

    // O que gasta API ou expõe dado de aluno, não.
    assert.equal((await api("/api/consultas", { caso: "infarto" })).status, 401);
    assert.equal((await api("/api/consultas/abc123/mensagem", { texto: "oi" })).status, 401);
    assert.equal((await api("/api/falar", { texto: "oi" })).status, 401);
    assert.equal((await api("/api/relatorio")).status, 403);

    const errado = await api("/api/acesso", { codigo: "0000" });
    assert.equal(errado.status, 401);
    // Código errado não pode abrir porta nenhuma.
    assert.equal((await api("/api/consultas", { caso: "infarto" })).status, 401);
  } finally {
    servidor.close();
  }
});

test("aluno autenticado não alcança o painel do professor", async () => {
  const { servidor, api } = await subir();
  try {
    assert.equal((await api("/api/acesso", { codigo: "9271" })).status, 200);
    assert.equal((await api("/api/consultas", { caso: "infarto" })).status, 200);

    // Sessão de aluno não vira sessão de professor.
    assert.equal((await api("/api/relatorio")).status, 403);

    assert.equal((await api("/api/acesso/professor", { senha: "errada" })).status, 401);
    assert.equal((await api("/api/relatorio")).status, 403);

    assert.equal((await api("/api/acesso/professor", { senha: "senha-de-teste" })).status, 200);
    assert.equal((await api("/api/relatorio")).status, 200);

    const estado = await api("/api/acesso");
    assert.equal(estado.dados.professor, true);
    assert.equal(estado.dados.painel_disponivel, true);

    await api("/api/sair", {});
    assert.equal((await api("/api/relatorio")).status, 403);
  } finally {
    servidor.close();
  }
});

test("rota de áudio exige sessão e recusa áudio inaproveitável", async () => {
  const { servidor } = await subir();
  const base = `http://127.0.0.1:${servidor.address().port}`;
  let cookie = "";
  const enviarAudio = (corpo, tipo) =>
    fetch(`${base}/api/transcrever`, {
      method: "POST",
      headers: { "Content-Type": tipo || "audio/webm", ...(cookie ? { Cookie: cookie } : {}) },
      body: corpo,
    });

  try {
    assert.equal((await enviarAudio(Buffer.from("abc"))).status, 401);

    const login = await fetch(`${base}/api/acesso`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ codigo: "9271" }),
    });
    cookie = login.headers.get("set-cookie").split(";")[0];

    assert.equal((await enviarAudio(Buffer.alloc(0))).status, 400);

    // Sem OPENAI_API_KEY a transcrição não existe: 422 (não 500) para a página
    // pedir que o aluno repita, em vez de mandar pergunta em branco ao paciente.
    const semChave = await enviarAudio(Buffer.from("audio-falso"));
    assert.equal(semChave.status, 422);
    assert.match((await semChave.json()).erro, /áudio/i);
  } finally {
    servidor.close();
  }
});

test("limite de uso conta por sessão, não pelo IP compartilhado da turma", async () => {
  // Dois alunos no mesmo laboratório saem pelo mesmo IP público. O contador de um
  // não pode consumir a cota do outro.
  const { servidor } = await subir();
  const base = `http://127.0.0.1:${servidor.address().port}`;
  try {
    const entrar = async () => {
      const r = await fetch(`${base}/api/acesso`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ codigo: "9271" }),
      });
      return r.headers.get("set-cookie").split(";")[0];
    };
    const a = await entrar();
    const b = await entrar();
    assert.notEqual(a, b, "cada login deve abrir uma sessão própria");

    const consultar = (cookie) =>
      fetch(`${base}/api/consultas`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: cookie },
        body: JSON.stringify({ caso: "infarto", aluno: "limite" }),
      });

    // Esgota a cota do aluno A (LIMITE_CONSULTAS = 20).
    for (let i = 0; i < 20; i++) await consultar(a);
    assert.equal((await consultar(a)).status, 429);
    // O aluno B, no mesmo IP, segue livre.
    assert.equal((await consultar(b)).status, 200);
  } finally {
    servidor.close();
  }
});

test("sem senha configurada, o painel fica desligado e não aberto", async () => {
  const original = process.env.PV_SENHA_PROFESSOR;
  delete process.env.PV_SENHA_PROFESSOR;
  const { servidor, api } = await subir();
  try {
    const saude = await api("/healthz");
    assert.equal(saude.dados.painel_professor, "desativado");

    const estado = await api("/api/acesso");
    assert.equal(estado.dados.painel_disponivel, false);

    // Nem com a senha vazia, nem por engano: fechado é fechado.
    assert.equal((await api("/api/acesso/professor", { senha: "" })).status, 401);
    assert.equal((await api("/api/acesso/professor", { senha: "qualquer" })).status, 401);
    assert.equal((await api("/api/relatorio")).status, 403);
  } finally {
    process.env.PV_SENHA_PROFESSOR = original;
    servidor.close();
  }
});

test("gabarito do caso só sai depois de encerrar, com o fechamento do aluno", async () => {
  const { servidor, api } = await subir();
  try {
    await api("/api/acesso", { codigo: "9271" });
    const c = await api("/api/consultas", { caso: "infarto", aluno: "Fechamento" });
    const id = c.dados.id;

    // Durante a consulta o diagnóstico não pode vazar por nenhuma resposta: bastaria
    // abrir a aba de rede para gabaritar a estação.
    const inicio = JSON.stringify(c.dados);
    assert.ok(!/infarto agudo|fidelidade|diagnostico_subjacente/i.test(inicio));
    const turno = await api(`/api/consultas/${id}/mensagem`, { texto: "o que o senhor sente?" });
    assert.ok(!/diagnostico_subjacente/i.test(JSON.stringify(turno.dados)));

    const fim = await api(`/api/consultas/${id}/encerrar`, {
      hipotese: "Infarto agudo do miocárdio",
      diferenciais: "Dissecção de aorta, TEP",
      conduta: "MONABCH, ECG seriado, encaminhar para hemodinâmica",
      anotacoes: "dor retroesternal\nirradia para o braço",
    });
    assert.equal(fim.status, 200);
    assert.match(fim.dados.gabarito.diagnostico, /infarto/i);
    assert.ok(fim.dados.gabarito.diferenciais.length > 0);
    assert.equal(fim.dados.fechamento.hipotese, "Infarto agudo do miocárdio");
    assert.ok(fim.dados.estatisticas.duracao_s >= 0);
    assert.equal(fim.dados.estatisticas.perguntas, 1);

    const arquivo = fim.dados.transcript;
    if (arquivo && arquivo.endsWith(".txt")) {
      try {
        await api("/api/acesso/professor", { senha: "senha-de-teste" });
        const d = await api(`/api/relatorio/${encodeURIComponent(arquivo)}`);
        assert.equal(d.dados.hipotese, "Infarto agudo do miocárdio");
        assert.match(d.dados.conduta, /hemodin/i);
        // Anotação multilinha vira uma linha só — não pode quebrar o parser nem
        // aparecer como fala solta na transcrição.
        assert.equal(d.dados.anotacoes, "dor retroesternal irradia para o braço");
        assert.ok(!d.dados.eventos.some((e) => /retroesternal/.test(e.texto || "")));
      } finally {
        const fs = await import("node:fs");
        const path = await import("node:path");
        const { fileURLToPath } = await import("node:url");
        const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
        fs.rmSync(path.join(raiz, "historico", arquivo), { force: true });
      }
    }
  } finally {
    servidor.close();
  }
});

test("fluxo completo de consulta em modo demonstração", async () => {
  const { servidor, api } = await subir();

  try {
    const casos = await api("/api/casos");
    assert.equal(casos.status, 200);
    assert.ok(casos.dados.some((caso) => caso.id === "infarto"));
    assert.ok(casos.dados.some((caso) => caso.id === "depressao"));

    const voz = await api("/api/voz");
    assert.equal(voz.dados.stt, false);
    assert.deepEqual(voz.dados.tts, { feminino: false, masculino: false });
    assert.equal(voz.dados.provedor, "nenhum");

    await api("/api/acesso", { codigo: "9271" });

    const invalido = await api("/api/consultas", { caso: "../etc/passwd" });
    assert.equal(invalido.status, 404);

    const consulta = await api("/api/consultas", { caso: "infarto", aluno: "Node E2E" });
    assert.equal(consulta.status, 200);
    assert.equal(consulta.dados.paciente.nome, "João Carlos Ferreira");
    const id = consulta.dados.id;

    const exame = await api(`/api/consultas/${id}/mensagem`, { texto: "vou aferir sua pressão" });
    assert.equal(exame.dados.eventos[0].tipo, "exame");
    assert.match(exame.dados.eventos[0].resultado, /170\/100/);
    // O paciente reage ao procedimento no mesmo turno — antes o exame era mudo.
    assert.ok(exame.dados.eventos.some((evento) => evento.tipo === "paciente"));

    const anamnese = await api(`/api/consultas/${id}/mensagem`, { texto: "quando começou a dor?" });
    const eventoPaciente = anamnese.dados.eventos.find((evento) => evento.tipo === "paciente");
    assert.equal(eventoPaciente.origem, "demo");
    assert.match(eventoPaciente.texto, /2 horas/);

    const fim = await api(`/api/consultas/${id}/encerrar`, {});
    assert.equal(fim.status, 200);
    assert.ok(fim.dados.checklist.nota_total > 0);
    assert.equal(fim.dados.parecer, null);

    // Após encerrar, a consulta é removida da memória (transcrição já em disco).
    const depois = await api(`/api/consultas/${id}/mensagem`, { texto: "oi" });
    assert.equal(depois.status, 404);

    // Painel do professor: a consulta recém-gravada aparece e é detalhável.
    const arquivo = fim.dados.transcript;
    if (arquivo && arquivo.endsWith(".txt")) {
      try {
        await api("/api/acesso/professor", { senha: "senha-de-teste" });
        const painel = await api("/api/relatorio");
        assert.equal(painel.status, 200);
        const item = painel.dados.find((consulta) => consulta.arquivo === arquivo);
        assert.ok(item, "consulta gravada deveria aparecer no painel");
        assert.equal(item.aluno, "Node E2E");
        assert.ok(item.nota > 0);

        const detalhe = await api(`/api/relatorio/${encodeURIComponent(arquivo)}`);
        assert.equal(detalhe.status, 200);
        assert.ok(detalhe.dados.eventos.some((evento) => evento.tipo === "exame"));

        const invalido = await api("/api/relatorio/..%2Fpyproject.toml");
        assert.equal(invalido.status, 404);
      } finally {
        const fs = await import("node:fs");
        const path = await import("node:path");
        const { fileURLToPath } = await import("node:url");
        const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
        fs.rmSync(path.join(raiz, "historico", arquivo), { force: true });
      }
    }
  } finally {
    servidor.close();
  }
});
