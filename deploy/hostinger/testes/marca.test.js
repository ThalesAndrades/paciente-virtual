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

/* ---------------------------------------------------------------------------
   O caminho de quem chega: criar conta e entrar.

   Este teste existe porque a página de entrada nasceu mandando `matricula` para
   uma rota que espera `email`. O servidor respondia 400 "E-mail inválido", a
   pessoa não tinha como adivinhar o que estava errado, e NENHUM teste falhou:
   a suíte cobria o cadastro chamando a rota com o contrato certo, nunca com o
   que a página realmente enviava.
   --------------------------------------------------------------------------- */

test("o contrato do cadastro é {nome, email, senha} — e a página precisa respeitá-lo", async () => {
  const { servidor, med } = await subir();

  try {
    // O que a página de entrada manda hoje.
    const bom = await med("/api/cadastro", {
      nome: "Marina Duarte",
      email: "marina.fluxo@exemplo.com",
      senha: "senha-boa-12345",
    });
    assert.equal(bom.status, 200, `cadastro recusou o contrato correto: ${JSON.stringify(bom.dados)}`);
    assert.ok(bom.dados.email, "o cadastro precisa devolver o e-mail para o login logo em seguida");

    // O que ela mandava antes. Continua sendo recusado — o teste guarda a forma
    // do contrato, não só o caminho feliz.
    const errado = await med("/api/cadastro", { matricula: "semarroba", senha: "senha-boa-12345" });
    assert.equal(errado.status, 400, "cadastro sem e-mail deveria ser recusado");

    // Senha curta não passa: a página valida antes, mas a fronteira é aqui.
    const curta = await med("/api/cadastro", { nome: "X", email: "curta@exemplo.com", senha: "1234" });
    assert.equal(curta.status, 400, "senha curta deveria ser recusada");
  } finally {
    servidor.close();
  }
});

test("quem cria conta consegue entrar e já tem crédito para a primeira consulta", async () => {
  // O funil inteiro num teste: criar → entrar → ter saldo → conseguir abrir UMA
  // consulta. Se qualquer elo quebrar, a pessoa que acabou de se cadastrar bate
  // num paywall — e essa é a impressão que fica do produto.
  // Este teste é sobre o FUNIL, não sobre a marca — e por isso o cliente precisa
  // de Host e Origin COERENTES. Com Host forjado, o login por e-mail cai na
  // defesa contra CSRF do Better Auth (403), e o teste passaria a medir o CSRF
  // em vez do cadastro.
  const { servidor, porta } = await subir();
  const med = clienteCom(porta, `127.0.0.1:${porta}`);

  try {
    const email = "novato.fluxo@exemplo.com";
    const senha = "senha-boa-12345";

    const criado = await med("/api/cadastro", { nome: "Novato", email, senha });
    assert.equal(criado.status, 200);

    const entrada = await med("/api/auth/sign-in/email", { email: criado.dados.email || email, password: senha });
    assert.equal(entrada.status, 200, "quem acabou de criar conta não conseguiu entrar");

    const creditos = await med("/api/creditos");
    assert.equal(creditos.status, 200);
    assert.ok(creditos.dados.saldo > 0, "conta nova sem créditos de boas-vindas");
    assert.ok(
      creditos.dados.saldo >= creditos.dados.custo.consulta,
      `boas-vindas (${creditos.dados.saldo}) não cobrem nem uma consulta (${creditos.dados.custo.consulta})`
    );

    const casos = await med("/api/casos");
    const primeiro = casos.dados[0].id;
    const consulta = await med("/api/consultas", { caso: primeiro });
    assert.equal(consulta.status, 200, "conta recém-criada não conseguiu abrir a primeira consulta");
  } finally {
    servidor.close();
  }
});

test("o retrato do ator não vira um leitor de disco", async () => {
  // Esta é a ÚNICA rota que serve arquivo por um nome vindo do pedido — todas as
  // outras usam lista fixa. O id é validado contra o acervo e o caminho é montado
  // a partir do que passou, mas isso precisa estar cravado: um dia alguém
  // "simplifica" para path.join(DIR, req.url) e abre o disco inteiro.
  const { servidor, local } = await subir();

  try {
    const travessias = [
      "/retratos/..%2f..%2fpackage.json.webp",
      "/retratos/../../package.json.webp",
      "/retratos/....//package.json.webp",
      "/retratos/nao-existe-esse-caso.webp",
      "/retratos/.webp",
    ];
    for (const caminho of travessias) {
      const r = await local(caminho);
      assert.ok(
        r.status === 404 || r.status === 400,
        `${caminho} devolveu ${r.status} — deveria ser recusado`
      );
      assert.ok(
        !String(r.dados).includes("\"dependencies\""),
        `${caminho} vazou conteúdo de arquivo do servidor`
      );
    }

    // Caso REAL sem retrato gerado também é 404 — e isso é normal: a página
    // desenha o rosto de reserva. O que não pode é 500 nem vazamento.
    const casos = await local("/api/casos");
    const real = await local(`/retratos/${casos.dados[0].id}.webp`);
    assert.ok([200, 404].includes(real.status), `caso real devolveu ${real.status}`);
  } finally {
    servidor.close();
  }
});
