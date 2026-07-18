// Porta fiel de paciente_virtual/demo.py — paciente de demonstração sem LLM.

import { contemAlgumTermo, normalizar } from "./texto.js";

export const AVISO_DEMO =
  "Modelo de linguagem indisponível — o paciente está em modo demonstração, " +
  "com respostas fixas extraídas do caso. Configure o Ollama para a experiência completa.";

export const RESPOSTA_PADRAO =
  "Desculpe, não entendi bem a pergunta. Pode perguntar de outro jeito?";

// Sintomas que o aluno costuma investigar por palavras diferentes das do caso.
const SINONIMOS_SINTOMAS = {
  sudorese: ["suor", "sudorese", "suando", "suado"],
  nausea: ["nausea", "enjoo", "enjoada", "enjoado", "vomitar", "vomito"],
  "falta de ar": ["falta de ar", "respirar", "folego", "dispneia"],
  ansiedade: ["ansiedade", "ansiosa", "ansioso", "nervosa", "nervoso", "nervosismo"],
  choro: ["choro", "chora", "chorado", "chorando"],
  cansaco: ["cansaco", "cansada", "cansado", "fadiga", "exausto", "exausta", "esgotado"],
  concentracao: ["concentracao", "concentrar"],
  palpitac: ["palpitacao", "palpitacoes", "coracao acelerado", "coracao disparado", "taquicardia"],
  tontura: ["tontura", "tonta", "tonto", "vertigem"],
  trist: ["triste", "tristeza", "deprimido", "deprimida", "desanimo", "desanimado"],
  irritab: ["irritado", "irritada", "irritabilidade", "explosivo", "paciencia"],
};

function frase(valor) {
  if (Array.isArray(valor)) return valor.map(String).join(", ");
  return String(valor);
}

function simOuNao(valor, tema) {
  if (valor === true) return `Sim, tenho ${tema}.`;
  if (valor === false) return `Não, não tenho ${tema}.`;
  if (valor) return frase(valor);
  return null;
}

function responderSintoma(caso, pergunta) {
  const hda = caso.historia_doenca_atual || {};
  const iniciais = caso.informacoes_iniciais || {};
  const emocoes = Object.entries(caso.emocao_atual || {})
    .filter(([, presente]) => presente)
    .map(([emocao]) => emocao);

  const relatados = normalizar(
    [
      frase(hda.sintomas_associados || ""),
      frase(Object.values(iniciais)),
      emocoes.join(" "),
    ].join(" ")
  );

  for (const [sintoma, termos] of Object.entries(SINONIMOS_SINTOMAS)) {
    if (contemAlgumTermo(pergunta, termos)) {
      const relatado =
        relatados.includes(sintoma) ||
        termos.some((termo) => relatados.includes(normalizar(termo)));
      return relatado ? "Sim, tenho sentido isso também." : "Não, isso não tenho sentido.";
    }
  }
  return null;
}

function regras(caso) {
  const ident = caso.identificacao || {};
  const hda = caso.historia_doenca_atual || {};
  const habitos = caso.habitos_de_vida || {};
  const pessoais = caso.antecedentes_pessoais || {};
  const familiares = caso.antecedentes_familiares || {};
  const iniciais = caso.informacoes_iniciais || {};
  const intermediarias = caso.informacoes_intermediarias || {};
  const sensiveis = caso.informacoes_sensiveis || {};
  const rede = caso.rede_apoio || {};

  const familia = () => {
    const entradas = Object.entries(familiares);
    if (!entradas.length) return null;
    return entradas
      .map(
        ([parente, problema]) =>
          `${parente.charAt(0).toUpperCase()}${parente.slice(1)}: ${frase(problema).toLowerCase()}.`
      )
      .join(" ");
  };

  const fatores = () => {
    const partes = [];
    if (hda.fatores_piora) partes.push(`Piora com ${frase(hda.fatores_piora).toLowerCase()}`);
    if (hda.fatores_melhora) partes.push(`melhora: ${frase(hda.fatores_melhora).toLowerCase()}`);
    return partes.length ? `${partes.join(". ")}.` : null;
  };

  return [
    [["nome", "se chama"], () => ident.nome || null],
    [["idade", "quantos anos"], () => (ident.idade ? `Tenho ${ident.idade} anos.` : null)],
    [
      ["profissao", "trabalha", "trabalho", "ocupacao"],
      () => (ident.profissao ? `Sou ${frase(ident.profissao).toLowerCase()}.` : null),
    ],
    [
      ["estado civil", "casado", "casada", "solteiro", "solteira"],
      () => (ident.estado_civil ? `Sou ${frase(ident.estado_civil).toLowerCase()}.` : null),
    ],
    [
      ["sentindo", "sente", "aconteceu", "trouxe", "traz", "queixa", "incomoda"],
      () =>
        caso.queixa_principal ? `Estou com ${frase(caso.queixa_principal).toLowerCase()}.` : null,
    ],
    [
      ["quando", "comecou", "desde", "quanto tempo"],
      () => (hda.inicio ? `Começou ${frase(hda.inicio).toLowerCase()}.` : null),
    ],
    [
      ["irradia", "espalha", "vai para", "vai pro", "corre para", "corre pro", "espalha para"],
      () => (hda.irradiacao ? `Vai para: ${frase(hda.irradiacao).toLowerCase()}.` : null),
    ],
    [
      ["onde", "local", "localizacao", "regiao"],
      () => (hda.localizacao ? `${frase(hda.localizacao)}.` : null),
    ],
    [
      ["intensidade", "forte", "escala", "0 a 10", "zero a dez"],
      () => (hda.intensidade ? `É forte, uns ${frase(hda.intensidade)}.` : null),
    ],
    [["melhora", "piora", "alivia"], fatores],
    [
      ["mais alguma coisa", "mais algum", "junto", "sintoma"],
      () =>
        hda.sintomas_associados
          ? `Sinto também: ${frase(hda.sintomas_associados).toLowerCase()}.`
          : null,
    ],
    [
      ["fuma", "fumante", "cigarro", "tabagismo"],
      () => (habitos.tabagismo ? `${frase(habitos.tabagismo)}.` : null),
    ],
    [["alcool", "bebe", "bebida"], () => (habitos.alcool ? `${frase(habitos.alcool)}.` : null)],
    [
      ["exercicio", "atividade fisica", "esporte"],
      () => (habitos.atividade_fisica ? `${frase(habitos.atividade_fisica)}.` : null),
    ],
    [
      ["dorme", "sono", "dormir"],
      () => {
        const sono = habitos.sono || iniciais.sono;
        return sono ? `${frase(sono)}.` : null;
      },
    ],
    [["apetite", "fome", "comendo", "comer"], () => frase(iniciais.apetite || "") || null],
    [
      ["pressao alta", "hipertensao", "hipertenso"],
      () => simOuNao(pessoais.hipertensao, "pressão alta"),
    ],
    [["diabetes"], () => simOuNao(pessoais.diabetes, "diabetes")],
    [["colesterol", "dislipidemia"], () => simOuNao(pessoais.dislipidemia, "colesterol alto")],
    [
      ["alergia", "alergico", "alergica"],
      () => (pessoais.alergias ? `${frase(pessoais.alergias)}.` : null),
    ],
    [
      ["cirurgia", "operacao", "operado", "operada"],
      () => (pessoais.cirurgias ? `${frase(pessoais.cirurgias)}.` : null),
    ],
    [["familia", "pai", "mae", "parente", "familiar"], familia],
    // Informações intermediárias: exigem pergunta direta sobre o tema.
    [
      ["relacionamento", "casamento", "marido", "esposo", "companheiro", "parceiro"],
      () => frase(intermediarias.relacionamento || "") || null,
    ],
    [["ciume", "ciumes", "ciumento"], () => frase(intermediarias.ciumes || "") || null],
    [
      ["amigos", "amigas", "isolamento", "afastou"],
      () => frase(intermediarias.isolamento || rede.amigos || "") || null,
    ],
    // Informações sensíveis: só com perguntas específicas e aprofundadas.
    [
      ["humilha", "xinga", "ofende", "diminui", "desvaloriza"],
      () => frase(sensiveis.humilhacoes || "") || null,
    ],
    [["controla", "controle", "vigia", "celular"], () => frase(sensiveis.controle || "") || null],
    [["medo", "receio", "insegura"], () => frase(sensiveis.medo || "") || null],
    [["culpa", "culpada"], () => frase(sensiveis.culpa || "") || null],
    [
      ["apoio", "suporte", "conversar com alguem", "contar"],
      () => frase(rede.apoio || "") || null,
    ],
    [["humor", "animo"], () => frase(iniciais.desanimo || "") || null],
    [
      ["emprego", "desemprego", "desempregado", "renda", "financeiro"],
      () => frase(intermediarias.trabalho || "") || null,
    ],
    // Avaliação de risco: só com pergunta direta sobre o tema.
    [
      [
        "morrer",
        "morte",
        "se machucar",
        "suicidio",
        "nao acordar",
        "tirar a propria vida",
        "acabar com tudo",
        "sumir",
      ],
      () => frase(sensiveis.ideacao || "") || null,
    ],
    [["plano", "planejou", "intencao", "tentou"], () => frase(sensiveis.plano || "") || null],
    [
      ["te segura", "motivo para viver", "protecao", "te impede"],
      () => frase(sensiveis.protecao || "") || null,
    ],
    // Bem-estar geral (perguntas vagas): resposta em personagem, NUNCA sensível.
    // Fica perto do fim, para as perguntas específicas casarem primeiro.
    [
      [
        "como esta",
        "como voce esta",
        "como o senhor esta",
        "como a senhora esta",
        "como se sente",
        "como esta se sentindo",
        "como vai",
        "como tem passado",
        "como tem sido",
        "no geral",
        "de modo geral",
        "de forma geral",
        "como estao as coisas",
        "conte um pouco",
        "me fala um pouco",
      ],
      () => {
        const queixa = caso.queixa_principal ? frase(caso.queixa_principal).toLowerCase() : null;
        return queixa ? `Não estou bem não, doutor. É esse(a) ${queixa} que não passa.` : "Não estou muito bem, doutor.";
      },
    ],
    // Saudações por último: "bom dia, qual é o seu nome?" responde o nome.
    [["bom dia", "boa tarde", "boa noite", "ola", "oi"], () => "Olá."],
    [["obrigado", "obrigada"], () => "De nada."],
  ];
}

// Temas GATED (intermediários + sensíveis) → palavras da PERGUNTA que os liberam.
// O portão é determinístico: o assunto sensível só é entregue à IA quando o
// profissional pergunta DIRETAMENTE sobre ele. Isso garante a revelação gradual
// e impede que a IA despeje ideação/abuso numa pergunta genérica.
const GATILHOS_GATED = {
  ideacao: ["morte", "morrer", "morrendo", "suicid", "se matar", "me matar", "tirar a vida", "tirar a propria vida", "se machucar", "me machucar", "fazer algo contra", "fazer alguma coisa contra", "pensar em fazer algo", "acabar com tudo", "acabar com a vida", "por um fim", "dar um fim", "melhor nao estar", "nao estar aqui", "nao estar mais", "nao querer viver", "nao vale a pena viver", "nao vale a pena", "nao valia a pena", "valia a pena", "dormir e nao acordar", "nao acordar mais", "melhor nao existir", "desistir da vida", "vontade de viver", "vontade de morrer", "pensamento de morte", "pensou em morrer", "pensa em morrer", "pensa em morte"],
  plano: ["plano", "planejou", "planejar", "como faria", "chegou a tentar", "tentativa", "pensou em como", "ja tentou", "tentou tirar"],
  protecao: ["o que segura", "te segura", "o que te prende", "o que te impede", "motivo para viver", "motivo pra viver", "razao de viver", "o que faz continuar", "o que te faz continuar", "o que te sustenta", "o que te da forca", "esperanca", "o que te ajuda a seguir", "ficar mais leve", "vao melhorar"],
  culpa: ["culpa", "culpado", "culpada", "peso pros outros", "peso para os outros", "um peso", "fardo", "falhando", "falha", "incapaz", "se cobra", "cobranca", "se sente um peso", "esta falhando"],
  choro: ["chorar", "chora", "chorou", "chorado", "lagrimas", "se emociona", "vontade de chorar", "aperta e chora"],
  abandono: ["largar tudo", "largar a profissao", "largar o trabalho", "largar o emprego", "abandonar a profissao", "desistir da profissao", "parar de trabalhar", "jogar tudo pro alto", "pensa em largar", "pensou em largar", "sair da enfermagem", "sair da profissao"],
  automedicacao: ["por conta propria", "se automedica", "automedica", "toma pra dormir", "tomar pra dormir", "remedio pra dormir", "sem receita", "se medica sozinho", "medicacao por conta", "trocou uma medicacao", "pega remedio", "tomando algo por conta"],
  medo_enlouquecer: ["enlouquecer", "ficando louca", "ficar louca", "perdendo o controle", "perder o controle", "perder a cabeca", "ficando maluca", "medo de enlouquecer", "medo de morrer na crise", "vai morrer na crise", "ficar doida"],
  termino: ["terminou", "termino", "separou", "separacao", "rompimento", "acabou o namoro", "fim do relacionamento", "levou um fora", "terminaram", "acabou o relacionamento"],
  medo: ["medo", "receio", "com medo", "teme", "assustad", "tem medo", "da medo", "com receio", "te da medo"],
  vergonha: ["vergonha", "envergonhad", "constrang", "com vergonha", "levam a serio", "acham que e frescura"],
  controle: ["controla", "controle", "vigia", "vigiar", "olha seu celular", "ve seu celular", "proibe", "proibir", "deixa voce sair", "impede voce", "impede de sair", "da permissao", "manda em voce", "decide por voce", "sua liberdade", "te controla", "tem que dar satisfacao"],
  financas: ["controla o dinheiro", "voce tem dinheiro", "dinheiro seu", "dinheiro em casa", "tem liberdade", "sua propria", "acesso ao dinheiro", "ele que paga", "pedir dinheiro", "liberdade financeira", "conta bancaria", "gastar sem", "seu salario"],
  humilhacoes: ["humilha", "xinga", "ofende", "ofensa", "diminui", "desvaloriza", "machuca com palavra", "te machucaram", "chama voce de", "grita com voce", "te diminuiu", "te xingou", "te ofendeu", "fala coisas que te", "coisas que machucam", "palavras que"],
  minimizacao: ["ele nao e sempre assim", "ele e bom", "culpa minha", "foi minha culpa", "exagero", "nao e bem assim", "ele muda", "e so as vezes", "ele se arrepende"],
  relacionamento: ["seu relacionamento", "seu casamento", "seu marido", "seu esposo", "seu companheiro", "seu parceiro", "sua relacao", "como e em casa", "vida a dois", "relacao com ele", "com o seu marido"],
  agressao_fisica: ["bater", "bateu", "agrediu", "agressao", "empurrou", "te empurrar", "segurou", "te segurar", "te machucou fisicamente", "forca fisica", "chegou a te", "encostou a mao", "te bateu", "ja te tocou"],
  seguranca_atual: ["segura em casa", "se sente segura", "sente seguranca", "corre risco", "em perigo", "medo dele", "medo que ele", "seguro agora", "sair de casa", "lugar pra ir", "denunciar", "pedir ajuda", "protecao contra"],
  isolamento: ["se afastou", "se afastando", "foi se afastando", "se isolou", "afastado das pessoas", "afastando de amigos", "evita as pessoas", "evitando sair", "evitado companhia", "evitar companhia", "deixou de ver", "parou de sair", "nao sai mais", "se recolhe", "recolhid", "longe das pessoas", "longe da familia", "longe dos amigos", "afastou dos amigos"],
  solidao: ["solidao", "se sente so", "se sente sozinh", "sente falta dele", "solitari", "a solidao"],
  retrato: ["retrato", "foto dele", "conversa com ele", "fala com ele", "fala com o retrato", "conversar com o retrato"],
  presenca: ["ouve a voz", "escuta a voz", "sente a presenca", "ve ele", "impressao de ouvir", "impressao de ver", "sinal dele", "presenca dele", "acha que ele esta"],
  trabalho: ["no trabalho", "no servico", "no plantao", "no emprego", "no automatico", "atender no automatico", "erro no trabalho", "no hospital"],
};

// Se o profissional perguntou DIRETAMENTE sobre um tema SENSÍVEL presente no caso,
// devolve o conteúdo (para a IA revelar com cuidado). Senão, null. Só olha
// `informacoes_sensiveis` — o intermediário fica no contexto da IA. Sem fallback por
// nome de chave (evita falsos positivos com palavras comuns).
export function fatoSensivelDireto(caso, pergunta) {
  const fontes = caso.informacoes_sensiveis || {};
  for (const [chave, valor] of Object.entries(fontes)) {
    if (!valor) continue;
    const gatilhos = GATILHOS_GATED[chave];
    if (gatilhos && contemAlgumTermo(pergunta, gatilhos)) return frase(valor);
  }
  return null;
}

export function responderDemo(caso, pergunta) {
  const respostaSintoma = responderSintoma(caso, pergunta);
  if (respostaSintoma) return respostaSintoma;

  for (const [termos, responder] of regras(caso)) {
    if (contemAlgumTermo(pergunta, termos)) {
      const resposta = responder();
      if (resposta) return resposta;
    }
  }

  return RESPOSTA_PADRAO;
}
