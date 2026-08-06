// Segmentação por domínio: revalidaai.med.br × ubtec.sbs
//
// As duas plataformas são o MESMO servidor, o mesmo banco e a mesma carteira de
// créditos. O que muda é o acervo que cada porta mostra e o que cada uma oferece.
//
// Estes testes existem porque a separação é fácil de fazer só na vitrine — e
// vitrine não é fronteira: sem guarda no servidor, bastaria um POST com o id do
// caso para atravessar de uma plataforma para a outra.

import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";

process.env.OLLAMA_URL = "http://127.0.0.1:9";
process.env.PV_SEGREDO = "segredo-de-teste-com-tamanho-suficiente-1234567890";

// Banco próprio, descartável. Mesmo motivo do servidor.test.js: import dinâmico
// abaixo, porque `import` estático subiria para antes desta linha e o módulo de
// autenticação leria o caminho do banco de produção.
process.env.PV_BANCO = path.join(
  fs.mkdtempSync(path.join(os.tmpdir(), "pv-marca-")),
  "pv.sqlite"
);

const { criarServidor } = await import("../aplicacao.js");
const { criarUsuario, migrar } = await import("../motor/auth.js");
const { creditar } = await import("../motor/creditos.js");
const { listarUsuarios } = await import("../motor/auth.js");
const { marcaDoHost } = await import("../motor/marca.js");

await migrar();
const SENHA = "senha-de-teste-da-marca-1234";
await criarUsuario({ matricula: "marca001", senha: SENHA, nome: "Aluno Marca", papel: "aluno" });
await criarUsuario({ matricula: "marca002", senha: SENHA, nome: "Aluno Marca Dois", papel: "aluno" });
for (const u of await listarUsuarios()) {
  if (u.papel === "aluno") creditar(u.id, 5000, "ajuste", `marca:${u.id}`);
}

// Cliente que forja o cabeçalho `Host`.
//
// `fetch` proíbe defini-lo (é header protegido pela especificação) — e é
// exatamente ele que decide a marca. Por isso aqui se fala HTTP na mão. O `Origin`
// continua sendo o real: quem valida origem é a defesa contra CSRF do Better Auth,
// que olha Origin, não Host.
function clienteCom(porta, host) {
  let cookie = "";
  return function api(caminho, corpo, metodo) {
    return new Promise((resolver, rejeitar) => {
      const dados = corpo === undefined ? null : JSON.stringify(corpo);
      const pedido = http.request(
        {
          host: "127.0.0.1",
          port: porta,
          path: caminho,
          method: metodo || (corpo === undefined ? "GET" : "POST"),
          headers: {
            Host: host,
            "Content-Type": "application/json",
            Origin: `http://127.0.0.1:${porta}`,
            ...(cookie ? { Cookie: cookie } : {}),
            ...(dados ? { "Content-Length": Buffer.byteLength(dados) } : {}),
          },
        },
        (resposta) => {
          const definido = resposta.headers["set-cookie"];
          if (definido) cookie = definido[0].split(";")[0];
          let texto = "";
          resposta.on("data", (pedaco) => (texto += pedaco));
          resposta.on("end", () => {
            const tipo = resposta.headers["content-type"] || "";
            resolver({
              status: resposta.statusCode,
              dados: tipo.includes("json") ? JSON.parse(texto || "{}") : texto,
            });
          });
        }
      );
      pedido.on("error", rejeitar);
      if (dados) pedido.write(dados);
      pedido.end();
    });
  };
}

async function subir() {
  const servidor = criarServidor();
  await new Promise((ok) => servidor.listen(0, "127.0.0.1", ok));
  const porta = servidor.address().port;
  return {
    servidor,
    med: clienteCom(porta, "revalidaai.med.br"),
    geral: clienteCom(porta, "ubtec.sbs"),
    local: clienteCom(porta, "localhost"),
    porta,
  };
}

async function entrar(api, matricula) {
  return api("/api/auth/sign-in/username", { username: matricula, password: SENHA });
}

test("o host decide a marca, e o desconhecido cai na mais restrita", () => {
  assert.equal(marcaDoHost("revalidaai.med.br").id, "med");
  assert.equal(marcaDoHost("www.revalidaai.med.br").id, "med");
  assert.equal(marcaDoHost("REVALIDAAI.MED.BR").id, "med", "host é caso-insensível");
  assert.equal(marcaDoHost("revalidaai.med.br:443").id, "med", "a porta não muda a marca");

  assert.equal(marcaDoHost("ubtec.sbs").id, "geral");
  assert.equal(marcaDoHost("www.ubtec.sbs").id, "geral");

  assert.equal(marcaDoHost("localhost:3000").id, "dev");
  assert.equal(marcaDoHost("127.0.0.1").id, "dev");

  // Host que ninguém configurou não vira Med por acidente. A porta que não se
  // reconhece tem de ser a mais restrita, nunca a que vende a prova.
  assert.equal(marcaDoHost("dominio-de-ninguem.com").id, "geral");
  assert.equal(marcaDoHost("").id, "dev");
  assert.equal(marcaDoHost(undefined).id, "dev");

  // Sufixo parecido não passa: quem registrar `revalidaai.med.br.evil.com` não
  // herda a plataforma Med.
  assert.equal(marcaDoHost("revalidaai.med.br.evil.com").id, "geral");
});

test("cada domínio mostra o seu acervo, e só o seu", async () => {
  const { servidor, med, geral, local } = await subir();

  try {
    const naMed = await med("/api/casos");
    const noGeral = await geral("/api/casos");

    assert.equal(naMed.status, 200);
    assert.equal(noGeral.status, 200);
    assert.ok(naMed.dados.length > 0, "a plataforma Med não mostrou caso nenhum");
    assert.ok(noGeral.dados.length > 0, "a plataforma geral não mostrou caso nenhum");

    assert.deepEqual(
      naMed.dados.filter((c) => c.categoria !== "medicina").map((c) => c.id),
      [],
      "caso de outra profissão vazou para revalidaai.med.br"
    );
    assert.deepEqual(
      noGeral.dados.filter((c) => c.categoria === "medicina").map((c) => c.id),
      [],
      "caso de medicina vazou para ubtec.sbs"
    );
    assert.ok(
      new Set(noGeral.dados.map((c) => c.categoria)).size >= 2,
      "a plataforma geral perdeu as demais profissões"
    );

    // Complementares: nenhum caso do acervo ficou sem porta.
    const todos = await local("/api/casos");
    assert.equal(
      naMed.dados.length + noGeral.dados.length,
      todos.dados.length,
      "algum caso não aparece em nenhuma das duas plataformas"
    );
  } finally {
    servidor.close();
  }
});

test("a estação chega à página com a área do edital", async () => {
  // A plataforma Med agrupa por Clínica, Cirurgia, GO, Pediatria e Medicina de
  // Família — que é como o participante do Revalida estuda. Sem `area` na lista,
  // a página não teria como fazer isso sem baixar as 37 rubricas.
  const { servidor, med } = await subir();

  try {
    const { dados } = await med("/api/casos");
    const estacoes = dados.filter((c) => c.estacao);
    assert.ok(estacoes.length >= 30, `poucas estações na Med (${estacoes.length})`);
    for (const caso of estacoes) {
      assert.ok(caso.area, `${caso.id}: estação sem área do edital`);
    }
    assert.ok(
      new Set(estacoes.map((c) => c.area)).size >= 5,
      "as cinco áreas do edital não chegaram à página"
    );
  } finally {
    servidor.close();
  }
});

test("a página descobre em qual plataforma está pelo domínio", async () => {
  const { servidor, med, geral } = await subir();

  try {
    const naMed = await med("/api/acesso");
    assert.equal(naMed.dados.marca.id, "med");
    assert.equal(naMed.dados.marca.circuito, true);

    const noGeral = await geral("/api/acesso");
    assert.equal(noGeral.dados.marca.id, "geral");
    assert.equal(
      noGeral.dados.marca.circuito,
      false,
      "a plataforma geral não vende a prova do Revalida"
    );
  } finally {
    servidor.close();
  }
});

test("o domínio é fronteira, não vitrine: caso de fora não abre nem por id direto", async () => {
  const { servidor, med, geral, local } = await subir();

  try {
    const todos = await local("/api/casos");
    const deMedicina = todos.dados.find((c) => c.categoria === "medicina").id;
    const deFora = todos.dados.find((c) => c.categoria !== "medicina").id;

    await entrar(med, "marca001");
    const foraNaMed = await med("/api/consultas", { caso: deFora });
    assert.equal(foraNaMed.status, 404, "caso de outra profissão abriu em revalidaai.med.br");

    await entrar(geral, "marca001");
    const medicinaNoGeral = await geral("/api/consultas", { caso: deMedicina });
    assert.equal(medicinaNoGeral.status, 404, "caso de medicina abriu em ubtec.sbs");

    // E o que É da casa continua abrindo.
    const daCasa = await med("/api/consultas", { caso: deMedicina });
    assert.equal(daCasa.status, 200, "a plataforma Med recusou um caso de medicina");
  } finally {
    servidor.close();
  }
});

test("o circuito do Revalida não existe fora da plataforma de Medicina", async () => {
  const { servidor, med, geral } = await subir();

  try {
    await entrar(geral, "marca001");
    const noGeral = await geral("/api/provas", {});
    assert.equal(noGeral.status, 404, "ubtec.sbs abriu um circuito de prova médica");

    await entrar(med, "marca001");
    const naMed = await med("/api/provas", {});
    assert.equal(naMed.status, 200, "a plataforma Med recusou o circuito");
  } finally {
    servidor.close();
  }
});

test("a carteira é a mesma nas duas plataformas — a conta não se parte por domínio", async () => {
  // A segmentação é de vitrine, não de sistema. Se o crédito comprado em um
  // domínio não valesse no outro, o aluno pagaria duas vezes pela mesma carteira
  // e nada avisaria: os dois saldos seriam números plausíveis.
  const { servidor, med, geral } = await subir();

  try {
    await entrar(med, "marca002");
    const naMed = await med("/api/creditos");

    await entrar(geral, "marca002");
    const noGeral = await geral("/api/creditos");

    assert.equal(naMed.status, 200);
    assert.equal(noGeral.status, 200);
    assert.equal(
      naMed.dados.saldo,
      noGeral.dados.saldo,
      "o saldo mudou conforme o domínio — a carteira se partiu"
    );
  } finally {
    servidor.close();
  }
});

/* ---------------------------------------------------------------------------
   A raiz: apresentação para quem chega, ferramenta para quem já entrou.

   Este teste existe porque a rota `/` não tinha nenhum, e por isso um
   `ReferenceError` (papelDe usada sem importar) passou por 96 testes verdes: a
   suíte inteira exercitava a API e nunca abria a página.
   --------------------------------------------------------------------------- */

test("visitante vê a apresentação; quem entrou vê a ferramenta", async () => {
  const { servidor, med, porta } = await subir();

  try {
    // Sem sessão: a página de entrada.
    const visitante = await med("/");
    assert.equal(visitante.status, 200);
    assert.match(visitante.dados, /<title>Revalida AI/, "a raiz não serviu a apresentação");
    assert.ok(!visitante.dados.includes('id="tela-consulta"'), "a ferramenta vazou para quem não entrou");

    // Com sessão: a ferramenta, direto.
    const aluno = clienteCom(porta, "revalidaai.med.br");
    await entrar(aluno, "marca001");
    const dentro = await aluno("/");
    assert.equal(dentro.status, 200);
    assert.ok(dentro.dados.includes('id="tela-consulta"'), "quem entrou não recebeu a ferramenta");

    // `/app` serve a ferramenta sempre — é o link direto de quem já conhece.
    const direto = await med("/app");
    assert.equal(direto.status, 200);
    assert.ok(direto.dados.includes('id="tela-consulta"'), "/app não serviu a ferramenta");
  } finally {
    servidor.close();
  }
});

test("a apresentação não é guardada em cache por engano", async () => {
  // A resposta da raiz DEPENDE do cookie. Sem `Vary: Cookie` e `no-store`, um
  // proxy no caminho pode servir a vitrine a quem já entrou — ou, muito pior,
  // servir a página autenticada de um aluno a um visitante qualquer.
  const { servidor, porta } = await subir();
  try {
    const resposta = await new Promise((ok, falha) => {
      const p = http.request(
        { host: "127.0.0.1", port: porta, path: "/", method: "GET", headers: { Host: "revalidaai.med.br" } },
        (r) => { r.resume(); r.on("end", () => ok(r.headers)); }
      );
      p.on("error", falha);
      p.end();
    });
    assert.match(String(resposta["cache-control"] || ""), /no-store/, "a raiz pode ser cacheada");
    assert.match(String(resposta.vary || ""), /Cookie/i, "a raiz não varia por cookie");
  } finally {
    servidor.close();
  }
});

test("a apresentação carrega tudo o que pede, e nada de fora", async () => {
  const { servidor, med } = await subir();
  try {
    const { dados: html } = await med("/");

    // O rosto do ator é um módulo ES importado pela página: se não for servido,
    // a sala aparece vazia e o erro só sai no console do visitante.
    assert.match(html, /from "\/rosto\.js"/, "a apresentação não importa o rosto");
    const rosto = await med("/rosto.js");
    assert.equal(rosto.status, 200, "/rosto.js não é servido");

    // Nenhuma requisição a servidor de terceiro: a página tem de abrir inteira no
    // 3G de quem estuda no ônibus, e sem entregar o visitante a uma CDN.
    const externos = html.match(/(?:src|href)\s*=\s*["']https?:\/\/[^"']+/gi) || [];
    assert.deepEqual(externos, [], `a apresentação busca recurso externo: ${externos.join(", ")}`);
  } finally {
    servidor.close();
  }
});
