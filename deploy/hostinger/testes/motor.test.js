// Testes de paridade do motor portado para Node (node --test).

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  MAX_ITENS_POR_TURNO,
  extrairTextoProfissional,
  pontuarChecklist,
  termosDoItem,
} from "../motor/avaliador.js";
import { RESPOSTA_PADRAO, fatoSensivelDireto, responderDemo } from "../motor/demo.js";
import { detectarExames } from "../motor/exames.js";
import { sistemaPaciente } from "../motor/humanizar.js";
import { limparRaciocinio } from "../motor/ia.js";
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

test("nenhum caso abre tema sensível numa pergunta genérica", () => {
  // A revelação gradual é a promessa central da estação — e ela não pode depender
  // de quem escreveu o caso ter sido cuidadoso. Três casos declaravam aberturas de
  // consulta ("como a senhora esta") como gatilho, e o portão vale também para o
  // caminho da IA: o paciente entregava o assunto mais delicado no "bom dia".
  const genericas = [
    "Como a senhora está?",
    "Como o senhor está?",
    "Como você está?",
    "Bom dia",
    "Boa tarde",
    "Como tem passado?",
    "Como se sente?",
    "Me fala um pouco de você",
    "O que trouxe você aqui?",
    "Como estão as coisas?",
    "Está tudo bem?",
    "No geral, como vai?",
  ];
  const arquivos = fs.readdirSync(path.join(RAIZ, "casos")).filter((n) => n.endsWith(".json"));
  for (const arquivo of arquivos) {
    const caso = lerCaso(arquivo.replace(/\.json$/, ""));
    for (const pergunta of genericas) {
      assert.equal(
        fatoSensivelDireto(caso, pergunta),
        null,
        `${arquivo} abriu tema sensível em "${pergunta}"`
      );
    }
  }
});

test("sem modelo de linguagem, a pergunta direta ainda revela o tema", () => {
  // O modo demonstração é o que o usuário vê quando a IA cai (cota, rate limit,
  // provedor fora do ar). Ele procurava chaves fixas (`sensiveis.ideacao`) que só
  // 8 dos 39 casos usam — então a pergunta mais importante da estação respondia
  // "não entendi bem a pergunta" na maioria dos casos.
  const casos = [
    ["ideacao_suicida", "Chegou a pensar em morrer?"],
    ["depressao", "Você tem pensado em morrer ou se machucar?"],
    ["luto", "A senhora conversa com o retrato dele?"],
    ["anorexia", "Sente culpa depois de comer?"],
    ["pielonefrite", "Tomou algum remédio por conta própria?"],
  ];
  for (const [nome, pergunta] of casos) {
    const resposta = responderDemo(lerCaso(nome), pergunta);
    assert.notEqual(resposta, RESPOSTA_PADRAO, `${nome} não respondeu a "${pergunta}"`);
  }

  // E a fala de abertura não pode sair quebrada: a queixa dos casos já é uma frase
  // em primeira pessoa, então prefixá-la com "Estou com" produzia "Estou com não tô
  // conseguindo dar conta de nada".
  const abertura = responderDemo(lerCaso("ideacao_suicida"), "Como a senhora está?");
  assert.ok(!/Estou com n[ãa]o/i.test(abertura), `fala quebrada: ${abertura}`);
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

test("prompt do paciente leva a vida inteira do caso, sem repr estranho", () => {
  const caso = lerCaso("infarto");
  const prompt = sistemaPaciente(caso);

  assert.ok(prompt.includes("João Carlos Ferreira"));
  // Booleano do JSON vira palavra de gente ("hipertensao: true" confundia o modelo).
  assert.ok(prompt.includes("hipertensao: Sim"));
  assert.ok(!/\btrue\b|\bfalse\b|\[object Object\]|undefined/.test(prompt));

  // A matriz: sem estes blocos o paciente vira um genérico com sintomas.
  for (const bloco of ["A SUA VIDA", "QUEM VOCÊ É", "COMO VOCÊ FALA", "COMO VOCÊ ESTÁ AGORA", "COMO VOCÊ SE ABRE"]) {
    assert.ok(prompt.includes(bloco), `faltou o bloco ${bloco}`);
  }
  const ctx = caso.contexto_de_vida;
  assert.ok(prompt.includes(ctx.biografia), "biografia deve entrar inteira");
  assert.ok(prompt.includes(ctx.rotina));
  assert.ok(prompt.includes(caso.persona.postura_na_consulta));
  assert.ok(prompt.includes(caso.dinamica_de_revelacao.trava_do_sensivel));
  assert.ok(caso.estilo_de_fala.bordoes_e_expressoes.every((b) => prompt.includes(b)));
});

test("prompt do paciente nunca carrega o sensível nem o exame físico", () => {
  // Quem libera tema sensível é o portão determinístico, turno a turno; quem entrega
  // achado é o detector de exames. Se vazarem para o contexto estável, o paciente
  // despeja tudo numa pergunta genérica e a estação perde o sentido.
  const caso = lerCaso("violencia_psicologica");
  const prompt = sistemaPaciente(caso);
  for (const valor of Object.values(caso.informacoes_sensiveis)) {
    assert.ok(!prompt.includes(String(valor)), "informação sensível vazou no prompt estável");
  }
  for (const exame of Object.values(lerCaso("infarto").exame_fisico)) {
    assert.ok(!sistemaPaciente(lerCaso("infarto")).includes(String(exame.resultado)));
  }
});

test("todos os casos geram um prompt íntegro", () => {
  // Piso, não igualdade: o acervo cresce (novas profissões entram), e um teste
  // preso ao número de ontem falha por sucesso. O piso ainda pega o que importa —
  // alguém apagar casos sem querer.
  const casos = fs.readdirSync(path.join(RAIZ, "casos")).filter((n) => n.endsWith(".json"));
  assert.ok(casos.length >= 40, `esperado ao menos 40 casos, há ${casos.length}`);
  for (const arquivo of casos) {
    const prompt = sistemaPaciente(lerCaso(arquivo.replace(/\.json$/, "")));
    assert.ok(prompt.length > 3000, `${arquivo}: prompt curto demais (${prompt.length})`);
    assert.ok(
      !/\btrue\b|\bfalse\b|\[object Object\]|undefined/.test(prompt),
      `${arquivo}: representação bruta vazou`
    );
  }
});

test("nenhum caso perde persona, fala ou revelação por tipo errado", () => {
  // O defeito que este teste existe para impedir já aconteceu: quatro campos
  // foram escritos como STRING em casos novos, e o motor os lê como OBJETO
  // (`persona.resumo`, `estilo_de_fala.registro`, ...). O JSON abria, o caso
  // aparecia na lista, os testes passavam — e os blocos QUEM VOCÊ É, COMO VOCÊ
  // FALA e COMO VOCÊ SE ABRE saíam VAZIOS do prompt. O paciente ficava sem
  // personalidade, em silêncio, sem nada quebrar.
  const OBJETOS = ["persona", "estilo_de_fala", "dinamica_de_revelacao", "fidelidade_clinica"];
  const BLOCOS = ["QUEM VOCÊ É", "COMO VOCÊ FALA", "COMO VOCÊ SE ABRE"];

  const casos = fs.readdirSync(path.join(RAIZ, "casos")).filter((n) => n.endsWith(".json"));
  for (const arquivo of casos) {
    const id = arquivo.replace(/\.json$/, "");
    const caso = lerCaso(id);
    for (const campo of OBJETOS) {
      assert.equal(
        typeof caso[campo],
        "object",
        `${arquivo}: "${campo}" precisa ser objeto — como string, o motor lê vazio e o caso perde ${campo}`
      );
      assert.ok(caso[campo] !== null, `${arquivo}: "${campo}" está nulo`);
    }
    // Não basta ser objeto: o bloco tem de chegar com conteúdo no prompt.
    const prompt = sistemaPaciente(caso);
    for (const bloco of BLOCOS) {
      const i = prompt.indexOf(bloco);
      assert.ok(i >= 0, `${arquivo}: o bloco "${bloco}" não aparece no prompt`);
      const trecho = prompt.slice(i + bloco.length, i + bloco.length + 400);
      assert.ok(
        trecho.replace(/[\s━─\-]/g, "").length > 60,
        `${arquivo}: o bloco "${bloco}" chegou vazio ao prompt`
      );
    }
  }
});

test("anamnese sobre o passado não entrega o valor aferido", () => {
  const caso = lerCaso("infarto");
  // Perguntar da história não é aferir: entregava o valor medido e ainda contava
  // ponto de exame físico na rubrica.
  assert.equal(detectarExames("qual a sua pressão normalmente em casa?", caso).length, 0);
  assert.equal(detectarExames("sua pressão sempre foi alta?", caso).length, 0);
  assert.equal(detectarExames("já fez um eletro alguma vez?", caso).length, 0);

  // Pedir os sinais vitais em bloco entrega o bloco inteiro, sem repetir achado.
  const vitais = detectarExames("vou verificar os sinais vitais", caso);
  const nomes = vitais.map(([, dados]) => dados.nome);
  assert.ok(nomes.includes("Pressão arterial"));
  assert.ok(nomes.includes("Saturação de oxigênio"));
  assert.equal(new Set(nomes).size, nomes.length, "achado repetido");
});

test("um único turno não fecha a rubrica inteira", () => {
  const rubrica = JSON.parse(
    fs.readFileSync(path.join(RAIZ, "avaliacoes", "infarto.json"), "utf-8")
  );
  const termos = rubrica.criterios.flatMap((criterio) =>
    (criterio.itens || []).map((item) => termosDoItem(item)[1][0])
  );

  // Despejar todos os termos numa mensagem só dava 10/10 — a nota era decorativa.
  const despejo = `PROFISSIONAL: ${termos.join(" ")}`;
  const nota = pontuarChecklist(rubrica, extrairTextoProfissional(despejo)).nota_total;
  assert.ok(nota > 0, "o turno ainda deve pontuar o que cabe no teto");
  assert.ok(nota < 2, `um turno não pode valer ${nota}`);

  const atendidos = pontuarChecklist(rubrica, extrairTextoProfissional(despejo))
    .criterios.flatMap((c) => c.itens)
    .filter((i) => i.atendido).length;
  assert.equal(atendidos, MAX_ITENS_POR_TURNO);

  // Entrevista de verdade — um tema por turno — continua pontuando normalmente.
  const entrevista = [
    "PROFISSIONAL: quando começou a dor?",
    "PROFISSIONAL: a dor irradia para algum lugar?",
    "PROFISSIONAL: o senhor fuma?",
  ].join("\n");
  const porTurno = pontuarChecklist(rubrica, extrairTextoProfissional(entrevista));
  assert.equal(porTurno.criterios.flatMap((c) => c.itens).filter((i) => i.atendido).length, 3);
});

test("voz: OpenAI entra sozinha quando já há chave; explícito continua vencendo", async () => {
  const { ttsInfo, instrucaoDeVoz } = await import("../motor/tts.js");
  const original = { ...process.env };
  try {
    for (const k of ["OPENAI_API_KEY", "KOKORO_URL", "ELEVEN_API_KEY", "PV_TTS_PROVEDOR"]) delete process.env[k];
    assert.equal(ttsInfo().provedor, "nenhum");
    assert.equal(ttsInfo().stt, false);
    assert.deepEqual(ttsInfo().tts, { feminino: false, masculino: false });

    // Ligar a IA liga a voz boa e a transcrição, sem mais configuração.
    process.env.OPENAI_API_KEY = "sk-teste";
    const comIa = ttsInfo();
    assert.equal(comIa.provedor, "openai");
    assert.equal(comIa.stt, true);
    assert.deepEqual(comIa.tts, { feminino: true, masculino: true });

    // Um provedor configurado de propósito não é atropelado pela OpenAI.
    process.env.KOKORO_URL = "http://127.0.0.1:8880";
    assert.equal(ttsInfo().provedor, "kokoro");

    // A direção de atuação sai do caso, não de um texto fixo.
    const caso = lerCaso("transtorno_de_panico");
    const instrucao = instrucaoDeVoz(caso);
    assert.ok(instrucao.includes(caso.estado_emocional.agora.slice(0, 60)));
    assert.ok(instrucao.toLowerCase().includes("português do brasil"));
    assert.equal(instrucaoDeVoz(null), "");
  } finally {
    for (const k of ["OPENAI_API_KEY", "KOKORO_URL", "ELEVEN_API_KEY", "PV_TTS_PROVEDOR"]) delete process.env[k];
    Object.assign(process.env, original);
  }
});

test("gateway que só serve chat não anuncia voz nem microfone", async () => {
  // Com o OpenRouter (chat barato, sem endpoints de áudio) a página anunciava um
  // microfone que falhava a cada uso. Chave existir não é o mesmo que ter áudio.
  const { ttsInfo } = await import("../motor/tts.js");
  const original = { ...process.env };
  const limpar = () => {
    for (const k of ["OPENAI_API_KEY", "OPENAI_BASE_URL", "OPENAI_AUDIO_API_KEY", "OPENAI_AUDIO_BASE_URL", "KOKORO_URL", "PV_AUDIO_FORCAR"]) delete process.env[k];
  };
  try {
    limpar();
    process.env.OPENAI_API_KEY = "sk-or-teste";
    process.env.OPENAI_BASE_URL = "https://openrouter.ai/api/v1";
    let info = ttsInfo();
    assert.equal(info.provedor, "nenhum");
    assert.equal(info.stt, false);
    assert.deepEqual(info.tts, { feminino: false, masculino: false });

    // Mas dá para usar chat barato e pagar áudio à parte, com credencial própria.
    process.env.OPENAI_AUDIO_API_KEY = "sk-teste";
    process.env.OPENAI_AUDIO_BASE_URL = "https://api.openai.com/v1";
    info = ttsInfo();
    assert.equal(info.provedor, "openai");
    assert.equal(info.stt, true);

    // Kokoro self-hosted resolve a voz sem custo — mas não a transcrição.
    limpar();
    process.env.OPENAI_API_KEY = "sk-or-teste";
    process.env.OPENAI_BASE_URL = "https://openrouter.ai/api/v1";
    process.env.KOKORO_URL = "http://kokoro:8880";
    info = ttsInfo();
    assert.equal(info.provedor, "kokoro");
    assert.equal(info.tts.feminino, true);
    assert.equal(info.stt, false);
  } finally {
    limpar();
    Object.assign(process.env, original);
  }
});

test("transcrição só se anuncia disponível quando há chave", async () => {
  const { transcrever, transcricaoDisponivel } = await import("../motor/transcricao.js");
  const original = process.env.OPENAI_API_KEY;
  try {
    delete process.env.OPENAI_API_KEY;
    assert.equal(transcricaoDisponivel(), false);
    await assert.rejects(() => transcrever(Buffer.from("x"), "audio/webm"), /não configurada/i);

    process.env.OPENAI_API_KEY = "sk-teste";
    assert.equal(transcricaoDisponivel(), true);
    // Áudio vazio não pode virar uma pergunta em branco ao paciente.
    await assert.rejects(() => transcrever(Buffer.alloc(0), "audio/webm"), /vazio/i);
  } finally {
    if (original === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = original;
  }
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
