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
import { expressaoDoCaso } from "../motor/expressao.js";
import { consultarFicha } from "../motor/ficha.js";
import { sistemaPaciente } from "../motor/humanizar.js";
import { conceder, zerarOrcamento } from "../motor/orcamento.js";
import { FERRAMENTAS, instrucoesTempoReal } from "../motor/tempo-real.js";
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

/* ---------- Conversa por voz em tempo real ---------- */

test("instruções da sessão ao vivo não carregam o sensível de caso nenhum", () => {
  // Mesma garantia do caminho por texto, no caminho onde ela é mais frágil: aqui as
  // instruções vão para um provedor que gera áudio direto, e o servidor não vê a
  // pergunta. Se o sensível vazasse para cá, o portão viraria decoração.
  const casos = fs.readdirSync(path.join(RAIZ, "casos")).filter((n) => n.endsWith(".json"));
  for (const arquivo of casos) {
    const caso = lerCaso(arquivo.replace(/\.json$/, ""));
    const instrucoes = instrucoesTempoReal(caso);
    for (const valor of Object.values(caso.informacoes_sensiveis || {})) {
      if (!valor || typeof valor === "object") continue;
      assert.ok(
        !instrucoes.includes(String(valor)),
        `${arquivo}: informação sensível vazou nas instruções ao vivo`
      );
    }
    const diagnostico = (caso.fidelidade_clinica || {}).diagnostico_subjacente;
    if (diagnostico) {
      assert.ok(!instrucoes.includes(diagnostico), `${arquivo}: diagnóstico vazou nas instruções ao vivo`);
    }
  }
});

test("a sessão ao vivo obriga o modelo a consultar a ficha", () => {
  const instrucoes = instrucoesTempoReal(lerCaso("ideacao_suicida"));
  assert.match(instrucoes, /consultar_ficha/);
  assert.equal(FERRAMENTAS.length, 1);
  assert.equal(FERRAMENTAS[0].name, "consultar_ficha");
  assert.deepEqual(FERRAMENTAS[0].parameters.required, ["pergunta"]);
});

test("ficha nega tema não tocado e libera na pergunta direta", () => {
  const caso = lerCaso("ideacao_suicida");
  const consulta = { caso, transcript: "", perguntas: 0, exames: 0 };

  const generica = consultarFicha(consulta, "Como a senhora está hoje?");
  assert.equal(generica.modelo.revelar, null);
  assert.match(generica.modelo.instrucao, /NUNCA invente/);

  const direta = consultarFicha(consulta, "A senhora chegou a pensar em morrer?");
  assert.ok(direta.modelo.revelar, "pergunta direta deveria abrir o tema");

  // O carimbo do servidor é o que sustenta a nota quando a transcrição é declarada
  // pelo navegador.
  assert.equal((consulta.transcript.match(/PERGUNTA VERIFICADA:/g) || []).length, 2);
  assert.match(extrairTextoProfissional(consulta.transcript), /pensar em morrer/);
});

test("ficha manda o exame para a tela e nunca o resultado para o modelo", () => {
  const caso = lerCaso("infarto");
  const consulta = { caso, transcript: "", perguntas: 0, exames: 0 };
  const saida = consultarFicha(consulta, "Vou medir a sua pressão arterial agora.");

  assert.ok(saida.tela.length >= 1, "o exame deveria aparecer na tela");
  const serializado = JSON.stringify(saida.modelo);
  for (const item of saida.tela) {
    assert.ok(!serializado.includes(item.resultado), "resultado de exame vazou para o modelo");
    assert.ok(serializado.includes(item.nome), "o paciente precisa saber que o procedimento aconteceu");
  }
  assert.match(consulta.transcript, /RESULTADO:/);
});

test("orçamento concede em blocos e fecha quando a consulta estoura o teto", () => {
  zerarOrcamento();
  const anterior = { consulta: process.env.PV_RT_MIN_CONSULTA, bloco: process.env.PV_RT_MIN_BLOCO };
  process.env.PV_RT_MIN_CONSULTA = "10";
  process.env.PV_RT_MIN_BLOCO = "5";
  try {
    const alvo = { aluno: "aluno-1", consultaId: "c1" };
    assert.equal(conceder(alvo).minutos, 5);
    assert.equal(conceder(alvo).minutos, 5);

    const terceira = conceder(alvo);
    assert.equal(terceira.ok, false);
    assert.match(terceira.motivo, /consulta/i);

    // Outra consulta do mesmo aluno continua tendo o próprio teto...
    assert.equal(conceder({ aluno: "aluno-1", consultaId: "c2" }).ok, true);
    // ...até o teto do DIA, que é por aluno.
    process.env.PV_RT_MIN_ALUNO_DIA = "10";
    const quarta = conceder({ aluno: "aluno-1", consultaId: "c3" });
    assert.equal(quarta.ok, false);
    assert.match(quarta.motivo, /hoje/i);
    // E o aluno ao lado não paga pela cota de quem gastou.
    assert.equal(conceder({ aluno: "aluno-2", consultaId: "c4" }).ok, true);
  } finally {
    process.env.PV_RT_MIN_CONSULTA = anterior.consulta ?? "";
    process.env.PV_RT_MIN_BLOCO = anterior.bloco ?? "";
    delete process.env.PV_RT_MIN_ALUNO_DIA;
    zerarOrcamento();
  }
});

test("transcript ao vivo: MODO sai da linha do tempo e a pergunta verificada fica marcada", async () => {
  const { estruturarTranscript, extrairMetadados } = await import("../motor/relatorio.js");
  const transcript = [
    "==================================================",
    "CASO: infarto",
    "ALUNO: aluno001",
    "INICIO: 2026-08-05 10:00:00",
    "MODO: tempo real (transcrição declarada pelo navegador)",
    "==================================================",
    "",
    "PROFISSIONAL: bom dia, o que trouxe o senhor aqui?",
    "PACIENTE: uma dor forte no peito, doutor",
    "",
    "PERGUNTA VERIFICADA: o senhor chegou a pensar em desistir?",
  ].join("\n");

  const metadados = extrairMetadados(transcript);
  assert.match(metadados.modo, /tempo real/);

  const eventos = estruturarTranscript(transcript);
  assert.deepEqual(eventos.map((e) => e.tipo), ["profissional", "paciente", "profissional"]);
  assert.equal(eventos[2].verificada, true);
  assert.ok(!eventos.some((e) => /tempo real/.test(e.texto)), "MODO não é fala");
});

/* ---------- Como o paciente aparece na sala ---------- */

test("a expressão traduz o estado emocional do caso em números", async () => {
  const { expressaoDoCaso } = await import("../motor/expressao.js");

  const luto = expressaoDoCaso(lerCaso("luto"));
  assert.ok(luto.tristeza > 0.6, "luto deveria pesar tristeza");
  assert.equal(luto.postura, "abatida");
  assert.equal(luto.olhar, "baixo");

  const infarto = expressaoDoCaso(lerCaso("infarto"));
  assert.ok(infarto.dor > 0.6, "infarto deveria pesar dor");
  // Dor forte vence o resto: quem infarta protege o peito, mesmo com medo.
  assert.equal(infarto.postura, "protegida");
  assert.ok(infarto.respiracao > luto.respiracao, "dor e tensão aceleram a respiração");

  // Sintoma autonômico (suor, náusea, falta de ar) não é dor: sem essa separação,
  // um caso de pânico aparecia encurvado como quem está infartando.
  const panico = expressaoDoCaso(lerCaso("transtorno_de_panico"));
  assert.ok(panico.dor < 0.5, "pânico não é dor");
  assert.ok(panico.tensao > 0.6 && panico.respiracao >= 24);
});

test("todo caso gera uma expressão dentro da faixa, e nenhuma domina o acervo", () => {
  const casos = fs.readdirSync(path.join(RAIZ, "casos")).filter((n) => n.endsWith(".json"));
  const posturas = new Map();
  for (const arquivo of casos) {
    const e = expressaoDoCaso(lerCaso(arquivo.replace(/\.json$/, "")));
    for (const dim of ["tensao", "tristeza", "dor", "medo", "agitacao", "retraimento"]) {
      assert.ok(e[dim] >= 0 && e[dim] <= 1, `${arquivo}: ${dim} fora da faixa (${e[dim]})`);
    }
    assert.ok(e.respiracao >= 12 && e.respiracao <= 40, `${arquivo}: respiração implausível`);
    posturas.set(e.postura, (posturas.get(e.postura) || 0) + 1);
  }
  // Se uma postura só cobrisse quase tudo, o mapeamento estaria decorativo, não
  // descritivo — todos os pacientes chegariam iguais.
  assert.ok(posturas.size >= 4, `pouca variedade de posturas: ${[...posturas.keys()].join(", ")}`);
  const maior = Math.max(...posturas.values());
  assert.ok(maior < casos.length * 0.75, "uma única postura domina o acervo");
});

test("a presença: respiração, resposta à voz e cor do sofrimento", async () => {
  // O módulo da presença só toca no DOM dentro de `abrir()`, então a matemática do
  // movimento pode ser testada aqui, sem navegador.
  const presenca = await import("../../../web/presenca.js");

  // Respiração: oscila em torno de 1 e a amplitude cresce com a dor.
  const semDor = [];
  const comDor = [];
  for (let t = 0; t < 6; t += 0.05) {
    semDor.push(presenca.respiracaoEm(t, 14, 0, 0));
    comDor.push(presenca.respiracaoEm(t, 26, 1, 1));
  }
  const faixa = (v) => Math.max(...v) - Math.min(...v);
  assert.ok(faixa(comDor) > faixa(semDor), "dor deveria alargar a respiração");
  assert.ok(Math.max(...semDor) < 1.05 && Math.min(...semDor) > 0.95, "respiração não pode estourar o campo");

  // A resposta à voz sobe depressa e desce devagar — o contrário treme.
  const subindo = presenca.proximaAbertura(0, 1, 1 / 60);
  const descendo = 1 - presenca.proximaAbertura(1, 0, 1 / 60);
  assert.ok(subindo > descendo, "deveria subir mais rápido do que desce");
  assert.equal(presenca.proximaAbertura(0.5, 0.5, 1 / 60), 0.5, "sem energia nova, sem movimento");

  // A cor é leitura clínica, não enfeite: sofrimento esfria e apaga; a dor esquenta.
  const neutra = presenca.tomDaExpressao({});
  const enlutada = presenca.tomDaExpressao({ tristeza: 1, retraimento: 1 });
  const comDorForte = presenca.tomDaExpressao({ dor: 1 });
  assert.ok(enlutada.luz < neutra.luz, "sofrimento deveria apagar");
  assert.ok(enlutada.saturacao < neutra.saturacao, "sofrimento deveria dessaturar");
  assert.ok(comDorForte.matiz < neutra.matiz, "dor deveria descer a roda de cor para o âmbar");
  assert.ok(enlutada.matiz > neutra.matiz, "sofrimento deveria subir para o azul frio");

  // Nenhuma combinação pode produzir cor fora da faixa (branco estourado ou preto).
  for (const dim of ["tensao", "tristeza", "dor", "medo", "agitacao", "retraimento"]) {
    for (const v of [0, 0.5, 1]) {
      const tom = presenca.tomDaExpressao({ [dim]: v });
      assert.ok(tom.luz >= 28 && tom.luz <= 66, `${dim}=${v}: luz fora da faixa`);
      assert.ok(tom.saturacao >= 12 && tom.saturacao <= 85, `${dim}=${v}: saturação fora da faixa`);
    }
  }
});

/* ---------- Estação de Revalida ---------- */

test("toda estação médica tem PEP fechando 10 e nunca entrega o diagnóstico", async () => {
  const { ehEstacao, tarefaDaEstacao, pesosNormalizados, AREAS } = await import("../motor/revalida.js");

  const arquivos = fs.readdirSync(path.join(RAIZ, "avaliacoes")).filter((n) => n.endsWith(".json"));
  let estacoes = 0;
  const porArea = new Map();

  for (const arquivo of arquivos) {
    const id = arquivo.replace(/\.json$/, "");
    const caso = lerCaso(id);
    if (caso.categoria !== "medicina") continue;

    const rubrica = JSON.parse(fs.readFileSync(path.join(RAIZ, "avaliacoes", arquivo), "utf-8"));
    assert.ok(ehEstacao(rubrica), `${id}: caso de medicina sem estação de Revalida`);
    estacoes += 1;

    const r = rubrica.revalida;
    assert.ok(AREAS[r.area], `${id}: área fora das do edital (${r.area})`);
    porArea.set(r.area, (porArea.get(r.area) || 0) + 1);
    assert.equal(r.tempo_minutos, 10, `${id}: a estação do Revalida tem 10 minutos`);

    // Os pesos precisam fechar 10: uma estação valendo 8,5 não é comparável com
    // as outras nove da prova.
    const soma = pesosNormalizados(r.pep).reduce((t, p) => t + p, 0);
    assert.ok(Math.abs(soma - 10) < 0.01, `${id}: PEP soma ${soma.toFixed(2)}, não 10`);
    assert.ok(r.pep.length >= 4, `${id}: PEP com poucos itens (${r.pep.length})`);
    for (const item of r.pep) {
      assert.ok(item.id && item.descricao && item.adequado && item.inadequado,
        `${id}: item ${item.id || "?"} sem descrição ou sem critérios da escala`);
    }

    // O IMPRESSO da estação não pode conter o diagnóstico. Já vazou uma vez: a
    // primeira versão do gerador colocava o título do caso no cenário, e o
    // participante abriria a aba de rede para gabaritar antes de perguntar nada.
    const impresso = JSON.stringify(tarefaDaEstacao(rubrica)).toLowerCase();
    const diagnostico = String((caso.fidelidade_clinica || {}).diagnostico_subjacente || "");
    if (diagnostico) {
      // Só as palavras que NOMEIAM a doença. Sem o filtro, o teste reprovava por
      // "paciente" e "agudo" — palavras que o impresso legitimamente usa.
      const comuns = new Set([
        "paciente", "aguda", "agudo", "cronica", "cronico", "grave", "moderada", "moderado",
        "direita", "esquerda", "primaria", "secundaria", "adquirida", "provavel", "quadro",
        "sinais", "alarme", "comunidade", "sistemica", "arterial", "profunda",
      ]);
      // A QUEIXA pode (e deve) estar no impresso: na prova real o cenário diz
      // "trazido por diarreia há 30 horas". O que não pode vazar é o que o
      // participante tem que deduzir — o diagnóstico, não o sintoma que a pessoa
      // relata ao chegar.
      const semAcento = (t) => t.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
      const daQueixa = new Set(semAcento(String(caso.queixa_principal || "")).split(/[^a-z]+/));
      const nucleo = semAcento(diagnostico)
        .split(/[^a-z]+/)
        .filter((p) => p.length > 5 && !comuns.has(p) && !daQueixa.has(p));
      for (const palavra of nucleo.slice(0, 3)) {
        assert.ok(!impresso.includes(palavra), `${id}: o impresso da estação entrega "${palavra}"`);
      }
    }
    assert.ok(!impresso.includes(String(caso.titulo || "").toLowerCase()), `${id}: o impresso traz o título do caso`);
  }

  assert.ok(estacoes >= 20, `esperado ao menos 20 estações, há ${estacoes}`);
  // O edital cobra cinco grandes áreas. Ter tudo numa só seria simular um terço
  // da prova e chamar de prova.
  assert.ok(porArea.size >= 3, `pouca variedade de áreas: ${[...porArea.keys()].join(", ")}`);
});

test("o PEP pontua na escala do edital, e o que não foi avaliado não pontua", async () => {
  const { pontuarPEP, lerVeredito } = await import("../motor/revalida.js");
  const rubrica = {
    nome_caso: "Teste",
    revalida: {
      area: "clinica_medica",
      pep: [
        { id: "a", descricao: "Item A", peso: 5, adequado: "x", inadequado: "y" },
        { id: "b", descricao: "Item B", peso: 3, adequado: "x", inadequado: "y" },
        { id: "c", descricao: "Item C", peso: 2, adequado: "x", inadequado: "y" },
      ],
    },
  };

  const nota = pontuarPEP(rubrica, {
    itens: [
      { id: "a", nivel: "adequado", comentario: "ok" },
      { id: "b", nivel: "parcialmente_adequado", comentario: "faltou" },
      // "c" não foi avaliado de propósito
    ],
    parecer: "parecer",
  });

  // 5 (adequado) + 1,5 (metade de 3) + 0 (não avaliado) = 6,5
  assert.equal(nota.nota, 6.5);
  assert.equal(nota.itens.length, 3);
  assert.equal(nota.itens[2].nivel, "inadequado", "item não avaliado é inadequado — na prova, o que não aparece não pontua");
  assert.equal(nota.nota_maxima, 10);

  // Nível inventado pelo modelo não vira crédito.
  const inventado = pontuarPEP(rubrica, { itens: [{ id: "a", nivel: "excelente" }] });
  assert.equal(inventado.nota, 0);

  // O veredito chega embrulhado em cerca de código com frequência.
  assert.deepEqual(lerVeredito('```json\n{"itens":[],"parecer":"x"}\n```'), { itens: [], parecer: "x" });
  assert.deepEqual(lerVeredito("Segue a avaliação: {\"itens\":[]} pronto"), { itens: [] });
  assert.equal(lerVeredito("não é json"), null);
});

test("as cinco áreas do edital estão no acervo", async () => {
  const { tarefaDaEstacao } = await import("../motor/revalida.js");
  const areas = new Set();
  for (const arquivo of fs.readdirSync(path.join(RAIZ, "avaliacoes")).filter((n) => n.endsWith(".json"))) {
    const caso = lerCaso(arquivo.replace(/\.json$/, ""));
    if (caso.categoria !== "medicina") continue;
    const rubrica = JSON.parse(fs.readFileSync(path.join(RAIZ, "avaliacoes", arquivo), "utf-8"));
    areas.add(tarefaDaEstacao(rubrica).area);
  }
  // Item 3.3.1 do edital. Faltando uma delas, o simulado treina para uma prova
  // que não é a que o participante vai prestar.
  for (const exigida of ["clinica_medica", "cirurgia", "ginecologia_obstetricia", "pediatria", "medicina_familia"]) {
    assert.ok(areas.has(exigida), `nenhuma estação de ${exigida} — o edital cobra as cinco áreas`);
  }
});

test("caso com acompanhante deixa claro que o interlocutor NÃO é o paciente", () => {
  // Na estação de pediatria quem fala é a mãe: o bebê de 8 meses não responde.
  // Sem esta instrução em primeiro lugar, o modelo interpreta a criança e a
  // estação inteira perde o sentido — foi o que aconteceu na primeira versão.
  const bebe = lerCaso("lactente_desidratacao");
  assert.ok(bebe.interlocutor, "o caso precisa declarar quem conversa com o profissional");

  const prompt = sistemaPaciente(bebe);
  assert.match(prompt, /QUEM ESTÁ DOENTE NÃO É VOCÊ/);
  assert.ok(prompt.includes(bebe.interlocutor), "o papel do acompanhante não chegou ao prompt");
  assert.ok(!/Quem está doente e sofrendo é VOCÊ/.test(prompt), "instrução contraditória no mesmo prompt");

  // O caso comum não muda: continua sendo o próprio paciente que fala.
  const adulto = sistemaPaciente(lerCaso("infarto"));
  assert.match(adulto, /Quem está doente e sofrendo é VOCÊ/);
  assert.ok(!/QUEM ESTÁ DOENTE NÃO É VOCÊ/.test(adulto));

  // E nenhum dos dois pode repetir a mesma frase duas vezes — o prompt é lido
  // por um modelo, e instrução duplicada vira ruído.
  const ocorrencias = (prompt.match(/Você NÃO é uma IA/g) || []).length;
  assert.equal(ocorrencias, 1, "instrução duplicada no prompt");
});
