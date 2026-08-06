// Teste ponta a ponta do servidor Node (node --test), em modo demonstração.

import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";

// Sem Ollama acessível, o paciente deve responder em modo demo.
process.env.OLLAMA_URL = "http://127.0.0.1:9";
process.env.PV_SEGREDO = "segredo-de-teste-com-tamanho-suficiente-1234567890";

// Banco descartável, num diretório temporário. Import DINÂMICO logo abaixo porque
// `import` estático é içado para antes destas linhas — e o módulo de autenticação
// lê o caminho do banco no carregamento. Com import estático, os testes gravariam
// no banco de produção.
process.env.PV_BANCO = path.join(
  fs.mkdtempSync(path.join(os.tmpdir(), "pv-teste-")),
  "pv.sqlite"
);

const { criarServidor } = await import("../aplicacao.js");
const { criarUsuario, migrar } = await import("../motor/auth.js");

await migrar();
await criarUsuario({ matricula: "aluno001", senha: "senha-de-teste-aluno", nome: "Aluno de Teste", papel: "aluno" });
await criarUsuario({ matricula: "aluno002", senha: "senha-de-teste-dois", nome: "Outro Aluno", papel: "aluno" });
await criarUsuario({ matricula: "prof001", senha: "senha-de-teste-prof", nome: "Professor de Teste", papel: "professor" });

// Alunos exclusivos do teste de limite. Desde que a cota passou a ser POR ALUNO
// (e não por sessão), esgotar a cota do `aluno001` num teste derrubaria os outros
// testes que também entram como ele — os 429 apareceriam longe da causa.
await criarUsuario({ matricula: "limite001", senha: "senha-de-teste-lim1", nome: "Limite Um", papel: "aluno" });
await criarUsuario({ matricula: "limite002", senha: "senha-de-teste-lim2", nome: "Limite Dois", papel: "aluno" });

await criarUsuario({ matricula: "adm001", senha: "senha-de-teste-adm", nome: "Admin de Teste", papel: "admin" });

// Aluno sem um tostão, para o caminho de crédito insuficiente ter dono próprio: se
// fosse um dos outros, um teste de paywall deixaria os demais sem saldo.
await criarUsuario({ matricula: "duro001", senha: "senha-de-teste-duro", nome: "Sem Créditos", papel: "aluno" });

// Consulta e voz agora custam crédito. Os alunos dos testes começam com saldo
// folgado para que o assunto testado continue sendo o que cada teste diz testar.
const { creditar } = await import("../motor/creditos.js");
const { listarUsuarios } = await import("../motor/auth.js");
for (const u of await listarUsuarios()) {
  if (u.papel === "aluno" && u.matricula !== "duro001") creditar(u.id, 5000, "ajuste", `teste:${u.id}`);
}

const SENHAS = {
  adm001: "senha-de-teste-adm",
  aluno001: "senha-de-teste-aluno",
  aluno002: "senha-de-teste-dois",
  prof001: "senha-de-teste-prof",
  limite001: "senha-de-teste-lim1",
  limite002: "senha-de-teste-lim2",
  duro001: "senha-de-teste-duro",
};

// Entra como a matrícula pedida, pela MESMA rota que o navegador usa.
function entrar(api, matricula) {
  return api("/api/auth/sign-in/username", { username: matricula, password: SENHAS[matricula] });
}

// Cliente que guarda o cookie de sessão e envia `Origin`, como o navegador faz.
//
// O `Origin` não é detalhe: com sessão aberta, o Better Auth recusa requisição de
// origem desconhecida — é a defesa contra CSRF. Um cliente de teste que não manda
// `Origin` testaria um caminho que navegador nenhum percorre.
function criarCliente(base) {
  let cookie = "";
  return async function api(caminho, corpo, metodo) {
    const resposta = await fetch(`${base}${caminho}`, {
      method: metodo || (corpo === undefined ? "GET" : "POST"),
      headers: {
        "Content-Type": "application/json",
        Origin: base,
        ...(cookie ? { Cookie: cookie } : {}),
      },
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

    // Matrícula real com senha errada e matrícula que não existe precisam responder
    // EXATAMENTE igual — senão a diferença conta a quem perguntar quais matrículas
    // existem, e uma lista de matrículas válidas é meio caminho para invadir uma.
    const senhaErrada = await api("/api/auth/sign-in/username", {
      username: "aluno001",
      password: "nao-e-a-senha",
    });
    // Matrícula com hífen, na forma que uma instituição usa de verdade — precisa
    // ser aceita pelo validador, senão o erro sairia como "formato inválido" e
    // matrículas assim nem poderiam ser cadastradas.
    const naoExiste = await api("/api/auth/sign-in/username", {
      username: "2026-999",
      password: "nao-e-a-senha",
    });
    assert.equal(senhaErrada.status, 401);
    assert.equal(naoExiste.status, senhaErrada.status);
    assert.deepEqual(naoExiste.dados, senhaErrada.dados);

    // Login recusado não pode abrir porta nenhuma.
    assert.equal((await api("/api/consultas", { caso: "infarto" })).status, 401);
  } finally {
    servidor.close();
  }
});

test("aluno autenticado não alcança o painel do professor", async () => {
  const { servidor, api } = await subir();
  try {
    assert.equal((await entrar(api, "aluno001")).status, 200);
    assert.equal((await api("/api/consultas", { caso: "infarto" })).status, 200);

    // Sessão de aluno não vira sessão de professor.
    assert.equal((await api("/api/relatorio")).status, 403);

    // Tentar entrar como professor com a senha errada não promove a sessão que já
    // existe: o aluno continua aluno.
    assert.equal(
      (await api("/api/auth/sign-in/username", { username: "prof001", password: "errada" })).status,
      401
    );
    assert.equal((await api("/api/relatorio")).status, 403);

    assert.equal((await entrar(api, "prof001")).status, 200);
    assert.equal((await api("/api/relatorio")).status, 200);

    const estado = await api("/api/acesso");
    assert.equal(estado.dados.professor, true);
    assert.equal(estado.dados.painel_disponivel, true);

    await api("/api/auth/sign-out", {});
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

    const login = await fetch(`${base}/api/auth/sign-in/username`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "aluno001", password: SENHAS.aluno001 }),
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
    const entrarComo = async (matricula) => {
      const r = await fetch(`${base}/api/auth/sign-in/username`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: matricula, password: SENHAS[matricula] }),
      });
      return r.headers.get("set-cookie").split(";")[0];
    };
    // Duas PESSOAS diferentes, não dois logins da mesma: desde que a matrícula
    // existe, a cota acompanha o aluno e não o navegador. Dois logins do mesmo
    // aluno dividem a mesma cota de propósito — senão bastaria reentrar para
    // zerar o teto.
    const a = await entrarComo("limite001");
    const b = await entrarComo("limite002");
    assert.notEqual(a, b, "cada aluno deve abrir uma sessão própria");

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

test("o painel é protegido por PAPEL, não por configuração lembrada", async () => {
  // Antes, o painel dependia de alguém definir PV_SENHA_PROFESSOR — esquecer de
  // configurar era esquecer de proteger. Agora a proteção é o papel do usuário, que
  // não tem como ser esquecido: quem não é professor recebe 403, e pronto.
  const { servidor, api } = await subir();
  try {
    assert.equal((await api("/api/relatorio")).status, 403);

    await entrar(api, "aluno001");
    assert.equal((await api("/api/relatorio")).status, 403);
    assert.equal((await api("/api/acesso")).dados.professor, false);

    await entrar(api, "prof001");
    assert.equal((await api("/api/relatorio")).status, 200);
    assert.equal((await api("/api/acesso")).dados.professor, true);
  } finally {
    servidor.close();
  }
});

test("a consulta é assinada pela matrícula da sessão, não pelo corpo do pedido", async () => {
  const { servidor, api } = await subir();
  try {
    await entrar(api, "aluno001");
    // O cliente tenta se passar por outra pessoa. O servidor ignora.
    const consulta = await api("/api/consultas", { caso: "infarto", aluno: "prof001" });
    assert.equal(consulta.status, 200);

    await api(`/api/consultas/${consulta.dados.id}/encerrar`, { fechamento: "teste" });

    await entrar(api, "prof001");
    const relatorio = await api("/api/relatorio");
    const nosso = relatorio.dados.find((c) => c.caso === "infarto");
    assert.ok(nosso, "a consulta encerrada deveria aparecer no painel");
    assert.equal(nosso.aluno, "aluno001", "a consulta tem de sair no nome de quem estava logado");
  } finally {
    servidor.close();
  }
});

test("gabarito do caso só sai depois de encerrar, com o fechamento do aluno", async () => {
  const { servidor, api } = await subir();
  try {
    await entrar(api, "aluno001");
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
        await entrar(api, "prof001");
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

    await entrar(api, "aluno001");

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
        await entrar(api, "prof001");
        const painel = await api("/api/relatorio");
        assert.equal(painel.status, 200);
        const item = painel.dados.find((consulta) => consulta.arquivo === arquivo);
        assert.ok(item, "consulta gravada deveria aparecer no painel");
        // A consulta sai no nome de QUEM ESTAVA LOGADO. O nome que o cliente
        // mandava no corpo do pedido deixou de ser considerado.
        assert.equal(item.aluno, "aluno001");
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

test("gestão de contas é do ADMIN, não do professor", async () => {
  // Ler o painel e abrir conta são privilégios diferentes: conta aberta é crédito
  // de API gasto, e isso é decisão de quem paga, não de quem acompanha a turma.
  const { servidor, api } = await subir();
  try {
    assert.equal((await api("/api/alunos")).status, 403);

    await entrar(api, "aluno001");
    assert.equal((await api("/api/alunos")).status, 403);

    await entrar(api, "prof001");
    assert.equal((await api("/api/relatorio")).status, 200, "professor lê o painel");
    assert.equal((await api("/api/alunos")).status, 403, "mas não administra contas");

    await entrar(api, "adm001");
    assert.equal((await api("/api/alunos")).status, 200);
  } finally {
    servidor.close();
  }
});

test("admin cria conta, ela entra, e desativar corta o acesso", async () => {
  const { servidor, api } = await subir();
  const outro = criarCliente(`http://127.0.0.1:${servidor.address().port}`);
  try {
    await entrar(api, "adm001");

    const criado = await api("/api/alunos", {
      matricula: "2026-042", nome: "Turma Nova", senha: "senha-que-serve", papel: "aluno",
    });
    assert.equal(criado.status, 200);

    // A conta recém-criada entra de verdade — matrícula com hífen inclusive.
    const login = await outro("/api/auth/sign-in/username", { username: "2026-042", password: "senha-que-serve" });
    assert.equal(login.status, 200);
    assert.equal((await outro("/api/consultas", { caso: "infarto" })).status, 200);

    // Repetida não passa duas vezes.
    const repetida = await api("/api/alunos", {
      matricula: "2026-042", nome: "Outra", senha: "senha-que-serve", papel: "aluno",
    });
    assert.equal(repetida.status, 409);

    // Matrícula fora do formato e senha curta são recusadas com motivo.
    assert.equal((await api("/api/alunos", { matricula: "a b c", senha: "senha-que-serve" })).status, 400);
    assert.equal((await api("/api/alunos", { matricula: "2026-043", senha: "curta" })).status, 400);

    // Desativar corta o acesso de quem já estava dentro.
    const lista = (await api("/api/alunos")).dados.alunos;
    const alvo = lista.find((a) => a.matricula === "2026-042");
    assert.ok(alvo, "a conta criada deve aparecer na listagem");
    assert.equal((await api(`/api/alunos/${alvo.id}/ativo`, { ativo: false })).status, 200);
    assert.equal(
      (await outro("/api/consultas", { caso: "infarto" })).status,
      401,
      "sessão aberta tem de cair quando a conta é desativada"
    );
  } finally {
    servidor.close();
  }
});

test("o admin não consegue desativar a própria conta", async () => {
  // Sem esta trava, um clique distraído trancaria a chave dentro de casa: ninguém
  // mais poderia reabrir conta nenhuma.
  const { servidor, api } = await subir();
  try {
    await entrar(api, "adm001");
    const eu = (await api("/api/alunos")).dados.alunos.find((a) => a.matricula === "adm001");
    const r = await api(`/api/alunos/${eu.id}/ativo`, { ativo: false });
    assert.equal(r.status, 400);
    assert.equal((await api("/api/alunos")).status, 200, "continuo administrando");
  } finally {
    servidor.close();
  }
});

test("nova senha derruba a sessão antiga e só a nova vale", async () => {
  const { servidor, api } = await subir();
  const vitima = criarCliente(`http://127.0.0.1:${servidor.address().port}`);
  try {
    await entrar(api, "adm001");
    await api("/api/alunos", { matricula: "2026-099", nome: "Troca", senha: "senha-original", papel: "aluno" });

    assert.equal((await vitima("/api/auth/sign-in/username", { username: "2026-099", password: "senha-original" })).status, 200);
    assert.equal((await vitima("/api/consultas", { caso: "infarto" })).status, 200);

    const alvo = (await api("/api/alunos")).dados.alunos.find((a) => a.matricula === "2026-099");
    assert.equal((await api(`/api/alunos/${alvo.id}/senha`, { senha: "senha-trocada" })).status, 200);

    assert.equal((await vitima("/api/consultas", { caso: "infarto" })).status, 401, "a sessão antiga tem de cair");
    assert.equal(
      (await vitima("/api/auth/sign-in/username", { username: "2026-099", password: "senha-original" })).status,
      401,
      "a senha antiga não pode mais valer"
    );
    assert.equal((await vitima("/api/auth/sign-in/username", { username: "2026-099", password: "senha-trocada" })).status, 200);
  } finally {
    servidor.close();
  }
});

/* ---------- Conversa por voz em tempo real ---------- */

test("sem credencial de áudio, o tempo real diz que não existe em vez de falhar", async () => {
  const { servidor, api } = await subir();
  try {
    await entrar(api, "aluno001");
    const { dados: capacidade } = await api("/api/tempo-real");
    assert.equal(capacidade.disponivel, false);

    const { dados: consulta } = await api("/api/consultas", { caso: "infarto" });
    const r = await api(`/api/consultas/${consulta.id}/tempo-real`, {});
    // 503 e não 500: a página cai no microfone de segurar em vez de tela morta.
    assert.equal(r.status, 503);
    assert.match(r.dados.erro, /indispon/i);
  } finally {
    servidor.close();
  }
});

test("a ficha aplica o portão do servidor e não devolve resultado de exame ao modelo", async () => {
  const { servidor, api } = await subir();
  try {
    await entrar(api, "aluno001");
    const { dados: consulta } = await api("/api/consultas", { caso: "ideacao_suicida" });

    const generica = await api(`/api/consultas/${consulta.id}/ficha`, { pergunta: "Bom dia, tudo bem?" });
    assert.equal(generica.status, 200);
    assert.equal(generica.dados.modelo.revelar, null);

    const direta = await api(`/api/consultas/${consulta.id}/ficha`, {
      pergunta: "A senhora chegou a pensar em morrer?",
    });
    assert.ok(direta.dados.modelo.revelar, "pergunta direta deveria abrir o tema");
    assert.deepEqual(direta.dados.tela, []);
  } finally {
    servidor.close();
  }
});

test("o turno declarado pelo navegador entra no transcript e conta como pergunta", async () => {
  const { servidor, api } = await subir();
  try {
    await entrar(api, "aluno001");
    const { dados: consulta } = await api("/api/consultas", { caso: "infarto" });

    const vazio = await api(`/api/consultas/${consulta.id}/turno`, {});
    assert.equal(vazio.status, 400);

    const ok = await api(`/api/consultas/${consulta.id}/turno`, {
      profissional: "onde dói, seu José?",
      paciente: "aqui no meio do peito, doutor",
    });
    assert.equal(ok.status, 200);

    const { dados: fim } = await api(`/api/consultas/${consulta.id}/encerrar`, {});
    assert.equal(fim.estatisticas.perguntas, 1);
  } finally {
    servidor.close();
  }
});

test("consulta encerrada não aceita mais ficha nem turno", async () => {
  const { servidor, api } = await subir();
  try {
    await entrar(api, "aluno001");
    const { dados: consulta } = await api("/api/consultas", { caso: "infarto" });
    await api(`/api/consultas/${consulta.id}/encerrar`, {});

    const ficha = await api(`/api/consultas/${consulta.id}/ficha`, { pergunta: "e a pressão?" });
    const turno = await api(`/api/consultas/${consulta.id}/turno`, { profissional: "oi" });
    // A consulta some do Map ao encerrar; o que importa é não escrever nela.
    assert.ok(ficha.status >= 400, `ficha deveria recusar, veio ${ficha.status}`);
    assert.ok(turno.status >= 400, `turno deveria recusar, veio ${turno.status}`);
  } finally {
    servidor.close();
  }
});

test("tempo real e ficha exigem sessão", async () => {
  const { servidor, api } = await subir();
  try {
    const semSessao = await api("/api/consultas/qualquer/ficha", { pergunta: "e aí?" });
    assert.equal(semSessao.status, 401);
  } finally {
    servidor.close();
  }
});

test("com provedor no ar, o token é cunhado e os minutos são debitados", async () => {
  // Provedor de mentira: valida o que sai daqui (credencial, instruções, ferramenta)
  // sem gastar crédito de ninguém. É o único caminho do tempo real que fala com a
  // rede, e o freio de custo mora justamente nele.
  const { zerarOrcamento } = await import("../motor/orcamento.js");
  const pedidos = [];
  const provedor = http.createServer((req, res) => {
    let corpo = "";
    req.on("data", (p) => (corpo += p));
    req.on("end", () => {
      pedidos.push({ url: req.url, auth: req.headers.authorization, corpo: JSON.parse(corpo || "{}") });
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ value: "ek_de_teste", expires_at: 123 }));
    });
  });
  await new Promise((ok) => provedor.listen(0, "127.0.0.1", ok));

  const antes = {
    base: process.env.OPENAI_AUDIO_BASE_URL,
    chave: process.env.OPENAI_AUDIO_API_KEY,
    forcar: process.env.PV_AUDIO_FORCAR,
    modelo: process.env.PV_RT_MODELO,
    bloco: process.env.PV_RT_MIN_BLOCO,
    consulta: process.env.PV_RT_MIN_CONSULTA,
  };
  process.env.OPENAI_AUDIO_BASE_URL = `http://127.0.0.1:${provedor.address().port}/v1`;
  process.env.OPENAI_AUDIO_API_KEY = "chave-de-teste";
  process.env.PV_AUDIO_FORCAR = "1";
  process.env.PV_RT_MODELO = "modelo-de-teste";
  process.env.PV_RT_MIN_BLOCO = "5";
  process.env.PV_RT_MIN_CONSULTA = "5";
  zerarOrcamento();

  const { servidor, api } = await subir();
  try {
    await entrar(api, "aluno001");
    const { dados: consulta } = await api("/api/consultas", { caso: "ideacao_suicida" });

    const r = await api(`/api/consultas/${consulta.id}/tempo-real`, {});
    assert.equal(r.status, 200);
    assert.equal(r.dados.token, "ek_de_teste");
    assert.equal(r.dados.minutos, 5);
    assert.match(r.dados.url, /\/realtime\/calls$/);

    const pedido = pedidos.at(-1);
    assert.match(pedido.url, /\/realtime\/client_secrets$/);
    assert.equal(pedido.auth, "Bearer chave-de-teste");
    const sessao = pedido.corpo.session;
    assert.equal(sessao.tools[0].name, "consultar_ficha");
    assert.ok(sessao.audio.input.turn_detection.type, "sem VAD não há barge-in");

    // O que o provedor recebe NÃO pode conter o que o portão protege.
    const { fileURLToPath } = await import("node:url");
    const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
    const caso = JSON.parse(
      fs.readFileSync(path.join(raiz, "casos", "ideacao_suicida.json"), "utf-8")
    );
    for (const valor of Object.values(caso.informacoes_sensiveis || {})) {
      if (!valor || typeof valor === "object") continue;
      assert.ok(!sessao.instructions.includes(String(valor)), "sensível vazou para o provedor");
    }

    // Segundo pedido esgota o teto da consulta: a página cai no microfone de segurar.
    const segundo = await api(`/api/consultas/${consulta.id}/tempo-real`, {});
    assert.equal(segundo.status, 429);
    assert.match(segundo.dados.erro, /acabou/i);
  } finally {
    servidor.close();
    provedor.close();
    zerarOrcamento();
    for (const [chave, valor] of Object.entries({
      OPENAI_AUDIO_BASE_URL: antes.base,
      OPENAI_AUDIO_API_KEY: antes.chave,
      PV_AUDIO_FORCAR: antes.forcar,
      PV_RT_MODELO: antes.modelo,
      PV_RT_MIN_BLOCO: antes.bloco,
      PV_RT_MIN_CONSULTA: antes.consulta,
    })) {
      if (valor === undefined) delete process.env[chave];
      else process.env[chave] = valor;
    }
  }
});

/* ---------- Créditos, cadastro e cobrança ---------- */

test("sem crédito, a consulta não começa — e a mensagem diz quanto falta", async () => {
  const { servidor, api } = await subir();
  try {
    await entrar(api, "duro001");
    const r = await api("/api/consultas", { caso: "infarto" });
    assert.equal(r.status, 402);
    assert.equal(r.dados.saldo, 0);
    assert.ok(r.dados.faltam > 0, "o aluno precisa saber quanto falta");
  } finally {
    servidor.close();
  }
});

test("a consulta debita uma vez, e o extrato mostra de onde saiu", async () => {
  const { servidor, api } = await subir();
  try {
    await entrar(api, "aluno002");
    const antes = (await api("/api/creditos")).dados;
    const { dados: consulta } = await api("/api/consultas", { caso: "infarto" });
    assert.ok(consulta.id);
    const depois = (await api("/api/creditos")).dados;

    assert.equal(depois.saldo, antes.saldo - antes.custo.consulta);
    const lancamento = depois.extrato.find((l) => l.referencia === consulta.id);
    assert.ok(lancamento, "o débito precisa apontar para a consulta que o gerou");
    assert.equal(lancamento.delta, -antes.custo.consulta);
    assert.equal(lancamento.motivo, "consulta");
  } finally {
    servidor.close();
  }
});

test("professor não gasta crédito ao consultar", async () => {
  const { servidor, api } = await subir();
  try {
    await entrar(api, "prof001");
    const antes = (await api("/api/creditos")).dados;
    assert.equal(antes.isento, true);
    await api("/api/consultas", { caso: "infarto" });
    const depois = (await api("/api/creditos")).dados;
    assert.equal(depois.saldo, antes.saldo, "quem avalia a turma não paga pela avaliação");
  } finally {
    servidor.close();
  }
});

test("cadastro público cria conta com créditos e recusa e-mail repetido", async () => {
  const { servidor, api } = await subir();
  try {
    const email = `novo${Date.now()}@exemplo.com`;
    const criado = await api("/api/cadastro", { nome: "Aluna Nova", email, senha: "senha-boa-12345" });
    assert.equal(criado.status, 200);

    const repetido = await api("/api/cadastro", { nome: "Outra", email, senha: "senha-boa-12345" });
    assert.equal(repetido.status, 400);
    assert.match(repetido.dados.erro, /já existe/i);

    const curta = await api("/api/cadastro", { nome: "X", email: `x${Date.now()}@exemplo.com`, senha: "curta" });
    assert.equal(curta.status, 400);

    // Entra com o e-mail e encontra os créditos de boas-vindas já na conta.
    const entrada = await api("/api/auth/sign-in/email", { email, password: "senha-boa-12345" });
    assert.equal(entrada.status, 200);
    const { dados } = await api("/api/creditos");
    assert.ok(dados.saldo > 0, "conta nova precisa nascer com créditos para experimentar");
    assert.equal(dados.saldo, dados.experiencia_completa);
  } finally {
    servidor.close();
  }
});

test("a loja é pública e os preços batem com o catálogo", async () => {
  const { servidor, api } = await subir();
  try {
    const { status, dados } = await api("/api/loja");
    assert.equal(status, 200);
    assert.ok(dados.pacotes.length >= 3 && dados.assinaturas.length >= 2);
    for (const item of [...dados.pacotes, ...dados.assinaturas]) {
      assert.ok(item.centavos > 0 && item.creditos > 0, `${item.id}: preço ou crédito zerado`);
      assert.match(item.preco, /R\$/);
    }
    // O pacote maior tem que sair mais barato por crédito, senão não há motivo
    // nenhum para comprá-lo.
    const porCredito = dados.pacotes.map((p) => p.centavos / p.creditos);
    assert.ok(porCredito[porCredito.length - 1] < porCredito[0], "falta desconto por volume");
  } finally {
    servidor.close();
  }
});

test("cobrança exige sessão e item conhecido; assinatura não vai por Pix", async () => {
  const { servidor, api } = await subir();
  try {
    const semSessao = await api("/api/pagamentos", { item: "p60", forma: "pix" });
    assert.equal(semSessao.status, 401);

    await entrar(api, "aluno001");
    const inexistente = await api("/api/pagamentos", { item: "nao-existe", forma: "pix" });
    assert.equal(inexistente.status, 400);

    const assinaturaPix = await api("/api/pagamentos", { item: "estudante", forma: "pix" });
    assert.equal(assinaturaPix.status, 400);
    assert.match(assinaturaPix.dados.erro, /cart[ãa]o/i);
  } finally {
    servidor.close();
  }
});

test("webhook da Stripe sem assinatura válida não credita nada", async () => {
  const { servidor, api } = await subir();
  const antes = process.env.STRIPE_WEBHOOK_SECRET;
  process.env.STRIPE_WEBHOOK_SECRET = "whsec_de_teste";
  try {
    const forjado = await api("/api/webhooks/stripe", {
      type: "checkout.session.completed",
      data: { object: { client_reference_id: "thm_qualquer" } },
    });
    // Sem o cabeçalho `stripe-signature` correto, o evento é recusado na porta.
    assert.equal(forjado.status, 400);
  } finally {
    if (antes === undefined) delete process.env.STRIPE_WEBHOOK_SECRET;
    else process.env.STRIPE_WEBHOOK_SECRET = antes;
    servidor.close();
  }
});

test("o admin lança e retira crédito, e cada lançamento fica no razão", async () => {
  const { servidor, api } = await subir();
  try {
    await entrar(api, "adm001");
    const { dados: lista } = await api("/api/alunos");
    const alvo = lista.alunos.find((a) => a.matricula === "duro001");
    assert.equal(alvo.creditos, 0, "a listagem precisa trazer o saldo de cada conta");

    const dado = await api(`/api/alunos/${alvo.id}/creditos`, { creditos: 1000 });
    assert.equal(dado.status, 200);
    assert.equal(dado.dados.saldo, 1000);

    // Dois lançamentos iguais são intencionais (duas cortesias), e ambos valem.
    const denovo = await api(`/api/alunos/${alvo.id}/creditos`, { creditos: 1000 });
    assert.equal(denovo.dados.saldo, 2000);

    const retirada = await api(`/api/alunos/${alvo.id}/creditos`, { creditos: -1500 });
    assert.equal(retirada.dados.saldo, 500);

    // Não dá para tirar o que não existe.
    const demais = await api(`/api/alunos/${alvo.id}/creditos`, { creditos: -99999 });
    assert.equal(demais.status, 400);

    const zero = await api(`/api/alunos/${alvo.id}/creditos`, { creditos: 0 });
    assert.equal(zero.status, 400);
  } finally {
    servidor.close();
  }
});

test("professor não lança crédito para ninguém", async () => {
  const { servidor, api } = await subir();
  try {
    await entrar(api, "prof001");
    const r = await api("/api/alunos/qualquer/creditos", { creditos: 1000 });
    // Crédito é dinheiro: quem acompanha a turma não emite dinheiro.
    assert.equal(r.status, 403);
  } finally {
    servidor.close();
  }
});

test("chaves de cobrança: só o admin instala, e elas nunca voltam para a tela", async () => {
  const { servidor, api } = await subir();
  try {
    // Fechada para quem não administra.
    await entrar(api, "prof001");
    assert.equal((await api("/api/configuracao")).status, 403);
    assert.equal((await api("/api/configuracao", { WOOVI_APP_ID: "roubada" })).status, 403);

    await entrar(api, "adm001");
    const antes = await api("/api/configuracao");
    assert.equal(antes.status, 200);
    assert.equal(antes.dados.formas.pix, false);

    const gravou = await api("/api/configuracao", { WOOVI_APP_ID: "chave-secreta-de-teste-1234" });
    assert.equal(gravou.status, 200);
    // A loja passa a oferecer Pix na hora, sem reiniciar nada.
    assert.equal(gravou.dados.formas.pix, true);
    assert.equal((await api("/api/loja")).dados.formas.pix, true);

    // O valor NUNCA sai: só o estado e os últimos caracteres.
    const estado = (await api("/api/configuracao")).dados;
    const woovi = estado.segredos.find((s) => s.chave === "WOOVI_APP_ID");
    assert.equal(woovi.configurada, true);
    assert.equal(woovi.origem, "painel");
    assert.equal(woovi.final, "…1234");
    assert.ok(!JSON.stringify(estado).includes("chave-secreta-de-teste"), "a chave vazou na resposta");

    // Chave desconhecida não vira depósito de qualquer coisa.
    const lixo = await api("/api/configuracao", { QUALQUER_COISA: "x" });
    assert.equal(lixo.status, 400);

    // Apagar é mandar string vazia — e a loja volta a não oferecer.
    await api("/api/configuracao", { WOOVI_APP_ID: "" });
    assert.equal((await api("/api/loja")).dados.formas.pix, false);
  } finally {
    servidor.close();
  }
});

/* ---------- Modo prova: o circuito de estações ---------- */

test("o circuito sorteia áreas diferentes e não repete caso", async () => {
  const { servidor, api } = await subir();
  try {
    await entrar(api, "aluno001");
    const { status, dados } = await api("/api/provas", {});
    assert.equal(status, 200);
    assert.equal(dados.total, 5);
    // A prova cobre ÁREAS, não casos: cinco de clínica médica seria simular o
    // conforto, não o exame (item 3.3.1 do edital).
    assert.equal(new Set(dados.areas).size, dados.areas.length, `áreas repetidas: ${dados.areas.join(", ")}`);
    // E as áreas aparecem; os casos, não — saber qual caso cai seria gabarito.
    assert.ok(!JSON.stringify(dados).includes("infarto"));
  } finally {
    servidor.close();
  }
});

test("o giro é obrigatório: cada estação registra a nota e o boletim soma", async () => {
  const { servidor, api } = await subir();
  try {
    await entrar(api, "aluno002");
    const { dados: prova } = await api("/api/provas", {});

    const feitas = [];
    for (let i = 0; i < prova.total; i++) {
      const abertura = await api(`/api/provas/${prova.id}/estacao`, {});
      assert.equal(abertura.status, 200, `estação ${i + 1} não abriu`);
      assert.equal(abertura.dados.circuito.ordem, i + 1);
      assert.equal(abertura.dados.circuito.total, prova.total);
      // O impresso da estação vem junto, como numa estação avulsa.
      assert.ok(abertura.dados.estacao, "estação sem impresso de tarefa");
      feitas.push(abertura.dados.caso);

      const fim = await api(`/api/consultas/${abertura.dados.id}/encerrar`, {
        hipotese: "hipótese de teste", diferenciais: "d", conduta: "c",
      });
      assert.equal(fim.status, 200);
      assert.ok(fim.dados.circuito, "o encerramento precisa devolver o estado do circuito");
      assert.equal(fim.dados.circuito.estacoes_feitas, i + 1);
    }

    // Nenhum caso se repete dentro do mesmo circuito.
    assert.equal(new Set(feitas).size, feitas.length, `caso repetido: ${feitas.join(", ")}`);

    // Concluído: não abre mais estação e devolve o boletim.
    const depois = await api(`/api/provas/${prova.id}/estacao`, {});
    assert.equal(depois.status, 409);
    assert.ok(depois.dados.boletim.concluida);

    const { dados: boletim } = await api(`/api/provas/${prova.id}`);
    assert.equal(boletim.estacoes_feitas, prova.total);
    assert.equal(boletim.nota_maxima, prova.total * 10);
    assert.equal(boletim.resultados.length, prova.total);
    // A soma tem que bater com as parciais — é a nota que o participante compara
    // com a nota de corte.
    const soma = boletim.resultados.reduce((t, r) => t + r.nota, 0);
    assert.ok(Math.abs(soma - boletim.nota) < 0.01);
    assert.ok(boletim.media >= 0 && boletim.media <= 10);
  } finally {
    servidor.close();
  }
});

test("a prova de um aluno não é acessível por outro", async () => {
  const { servidor, api } = await subir();
  try {
    await entrar(api, "aluno001");
    const { dados: prova } = await api("/api/provas", {});

    await entrar(api, "aluno002");
    assert.equal((await api(`/api/provas/${prova.id}`)).status, 403);
    assert.equal((await api(`/api/provas/${prova.id}/estacao`, {})).status, 403);
    assert.equal((await api("/api/provas/nao-existe")).status, 404);
  } finally {
    servidor.close();
  }
});
