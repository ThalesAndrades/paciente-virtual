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
