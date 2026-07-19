// Gera avaliacoes/<id>.json (rubrica ponderada, pesos somam 10) a partir dos dados
// estruturados de cada caso. Determinístico: os termos vêm do vocabulário do próprio
// caso (gatilhos_sensiveis, sinônimos de exames), o que casa com o que o profissional
// perguntaria. Roda: node scripts/gerar-rubricas.mjs <id> [<id> ...]
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ids = process.argv.slice(2);
if (!ids.length) { console.error("uso: node scripts/gerar-rubricas.mjs <id> ..."); process.exit(1); }

// Termos curados por chave conhecida (o profissional pergunta de várias formas).
const TERMOS_ANTEC = {
  hipertensao: ["pressao alta", "hipertensao", "pressao"],
  diabetes: ["diabetes", "acucar no sangue", "glicose alta"],
  dislipidemia: ["colesterol", "gordura no sangue", "dislipidemia"],
  cardiopatia: ["problema no coracao", "cardiaco", "doenca do coracao"],
  cirurgias: ["cirurgia", "operacao", "ja operou", "ja fez cirurgia"],
  alergias: ["alergia", "alergico", "alergia a remedio"],
  medicacoes: ["remedio", "medicacao", "toma algum remedio", "uso continuo"],
  medicamentos: ["remedio", "medicacao", "toma algum remedio", "uso continuo"],
  tratamento_psicologico: ["psicologo", "terapia", "acompanhamento psicologico", "ja fez terapia"],
  tratamento_psiquiatrico: ["psiquiatra", "acompanhamento psiquiatrico", "ja tomou remedio para"],
  internacoes: ["internado", "internacao", "ja foi internado"],
  episodios_depressivos_previos: ["ja teve depressao", "episodio anterior", "ja passou por isso antes"],
  gestacoes: ["gravidez", "engravidou", "filhos", "gestacao"],
  tabagismo: ["fuma", "cigarro", "fumante"],
};
const TERMOS_SINTOMA = {
  desanimo: ["desanimo", "sem animo", "sem vontade"], animo: ["animo", "sem vontade", "desanimo"],
  sono: ["sono", "dorme", "dormir", "insonia"], insonia: ["insonia", "dorme", "acorda de madrugada"],
  apetite: ["apetite", "fome", "esta comendo"], energia: ["energia", "cansaco", "cansado"],
  humor: ["humor", "animo", "como se sente"], concentracao: ["concentracao", "concentrar", "foco"],
  choro: ["chora", "chorar", "vontade de chorar"], irritabilidade: ["irritado", "irritabilidade", "impaciente"],
  peso: ["peso", "emagreceu", "engordou"], anedonia: ["prazer", "perdeu o gosto", "coisas que gostava"],
  preocupacao: ["preocupacao", "preocupado", "ansioso"], evitacao: ["evita", "deixou de fazer", "deixa de sair"],
  compulsao: ["compulsao", "repete", "checar", "lavar", "ritual"], obsessao: ["pensamento", "obsessao", "intrusivo"],
  flashbacks: ["revive", "flashback", "pesadelo", "lembrancas"], panico: ["crise", "ataque", "coracao acelerado"],
};

function chavesComValor(obj) {
  return Object.entries(obj || {})
    .filter(([, v]) => v !== null && v !== undefined && v !== "" && !(Array.isArray(v) && !v.length))
    .map(([k]) => k);
}
function humano(chave) { return chave.replaceAll("_", " "); }

function rubrica(caso) {
  const med = caso.categoria === "medicina";
  const hda = caso.historia_doenca_atual || {};
  const crit = [];

  // 1. Identificação
  crit.push({ base: 1, nome: "Identificação do paciente", objetivo: "Obter dados básicos de identificação.", itens: [
    { nome: "nome", termos: ["nome", "se chama", "como se chama"] },
    { nome: "idade", termos: ["idade", "quantos anos"] },
    { nome: "profissao/ocupacao", termos: ["profissao", "trabalha", "ocupacao", "faz o que"] },
  ] });

  // 2. Queixa + HDA
  const itHda = [{ nome: "queixa/motivo da consulta", termos: ["o que sente", "o que houve", "o que trouxe", "me conta", "qual a queixa", "esta sentindo"] }];
  if (hda.inicio) itHda.push({ nome: "inicio/tempo de evolucao", termos: ["quando comecou", "faz quanto tempo", "desde quando", "ha quanto tempo"] });
  if (hda.localizacao) itHda.push({ nome: "localizacao", termos: ["onde doi", "onde e", "localizacao", "que lugar", "aponta onde"] });
  if (hda.irradiacao) itHda.push({ nome: "irradiacao", termos: ["irradia", "vai para", "corre para", "espalha", "vai pro braco"] });
  if (hda.intensidade) itHda.push({ nome: "intensidade", termos: ["intensidade", "forte", "de zero a dez", "escala", "quanto doi"] });
  if (hda.caracter || hda.tipo || hda.qualidade) itHda.push({ nome: "carater/tipo", termos: ["como e a dor", "tipo de dor", "aperto", "queimacao", "pontada", "latejante"] });
  if (hda.frequencia || hda.duracao) itHda.push({ nome: "frequencia/duracao", termos: ["com que frequencia", "quanto tempo dura", "vem e vai", "continua", "quantas vezes"] });
  if (hda.fatores_piora || hda.fatores_melhora) itHda.push({ nome: "fatores de melhora/piora", termos: ["melhora", "piora", "alivia", "o que faz melhorar", "o que piora"] });
  if (hda.sintomas_associados) itHda.push({ nome: "sintomas associados", termos: ["mais alguma coisa", "outros sintomas", "sente mais", "junto com", "alem disso"] });
  if (hda.evolucao || hda.curso) itHda.push({ nome: "evolucao", termos: ["melhorou ou piorou", "esta pior", "evoluiu", "desde que comecou"] });
  crit.push({ base: 3, nome: "Caracterizacao da queixa (HDA)", objetivo: "Caracterizar a queixa principal em detalhe.", itens: itHda });

  // 3. Antecedentes — item por condição reconhecida (termos curados), com fallback agregado.
  const itAnt = [];
  const antPess = chavesComValor(caso.antecedentes_pessoais);
  const antConhecidos = antPess.filter((k) => TERMOS_ANTEC[k]);
  for (const k of antConhecidos.slice(0, 4)) itAnt.push({ nome: humano(k), termos: TERMOS_ANTEC[k] });
  if (antPess.length && !antConhecidos.length) itAnt.push({ nome: "antecedentes pessoais", termos: ["problema de saude", "doenca", "pressao alta", "diabetes", "faz tratamento", "toma remedio", "cirurgia", "alergia"] });
  if (chavesComValor(caso.antecedentes_familiares).length) itAnt.push({ nome: "antecedentes familiares", termos: ["na familia", "pai", "mae", "familiar", "hereditario", "historico familiar"] });
  if (itAnt.length) crit.push({ base: 1.5, nome: "Antecedentes", objetivo: "Investigar antecedentes pessoais e familiares.", itens: itAnt });

  // 4. Hábitos
  const hb = caso.habitos_de_vida || {};
  const itHab = [];
  if (hb.tabagismo !== undefined) itHab.push({ nome: "tabagismo", termos: ["fuma", "cigarro", "tabagismo", "fumante"] });
  if (hb.alcool !== undefined) itHab.push({ nome: "alcool", termos: ["bebe", "alcool", "bebida", "etilismo"] });
  if (hb.drogas !== undefined) itHab.push({ nome: "outras substancias", termos: ["droga", "substancia", "maconha", "usa alguma coisa"] });
  if (hb.sono !== undefined) itHab.push({ nome: "sono", termos: ["dorme", "sono", "dormir", "insonia"] });
  if (hb.atividade_fisica !== undefined) itHab.push({ nome: "atividade fisica", termos: ["exercicio", "atividade fisica", "caminha", "faz esporte"] });
  if (hb.alimentacao !== undefined) itHab.push({ nome: "alimentacao", termos: ["alimentacao", "come", "come o que", "dieta"] });
  if (itHab.length) crit.push({ base: 1, nome: "Habitos de vida", objetivo: "Investigar habitos relevantes.", itens: itHab });

  if (med) {
    // 5. Exame físico / sinais vitais
    const ef = caso.exame_fisico || {};
    const itEF = [{ nome: "aferir sinais vitais", termos: ["pressao", "aferir", "frequencia cardiaca", "pulso", "saturacao", "temperatura", "sinais vitais", "medir"] }];
    for (const [k, d] of Object.entries(ef)) {
      if (["pressao_arterial", "frequencia_cardiaca", "frequencia_respiratoria", "temperatura", "saturacao", "glicemia_capilar", "glicemia"].includes(k)) continue;
      const termos = Array.isArray(d?.sinonimos) ? d.sinonimos.slice(0, 6) : [humano(k)];
      itEF.push({ nome: d?.nome || humano(k), termos });
    }
    crit.push({ base: 1.5, nome: "Exame fisico", objetivo: "Realizar exame fisico direcionado.", itens: itEF.slice(0, 6) });

    // 6. Exames complementares
    const itEx = [];
    for (const [k, d] of Object.entries(caso.exames_disponiveis || {})) {
      const termos = Array.isArray(d?.sinonimos) ? d.sinonimos.slice(0, 6) : [humano(k)];
      itEx.push({ nome: d?.nome || humano(k), termos });
    }
    if (itEx.length) crit.push({ base: 2, nome: "Exames complementares", objetivo: "Solicitar exames pertinentes ao caso.", itens: itEx });
  } else {
    // Psicologia: acolhimento, sintomas, risco (com gatilhos), rede de apoio
    crit.push({ base: 1, nome: "Acolhimento e vinculo", objetivo: "Estabelecer vinculo e escuta empatica.", itens: [
      { nome: "escuta aberta/acolhimento", termos: ["me conta", "como voce esta", "como tem sido", "fale um pouco", "quer falar", "estou aqui", "pode confiar"] },
    ] });
    const inter = { ...(caso.informacoes_iniciais || {}), ...(caso.informacoes_intermediarias || {}) };
    if (chavesComValor(inter).length) {
      const itSint = chavesComValor(inter).slice(0, 6).map((k) => ({ nome: humano(k), termos: TERMOS_SINTOMA[k] || [humano(k), ...humano(k).split(" ")].filter((t) => t.length > 3).slice(0, 4) }));
      crit.push({ base: 2.5, nome: "Investigacao dos sintomas", objetivo: "Investigar os sintomas e o contexto do quadro.", itens: itSint });
    }
    // Risco / temas sensiveis: termos = gatilhos do proprio caso
    const sens = caso.informacoes_sensiveis || {};
    const gat = caso.gatilhos_sensiveis || {};
    const chavesRisco = Object.keys(sens);
    if (chavesRisco.length) {
      const itRisco = chavesRisco.slice(0, 8).map((k) => ({ nome: humano(k), termos: (gat[k] || [humano(k)]).slice(0, 6) }));
      const temRisco = chavesRisco.some((k) => /ideacao|plano|protecao|seguranca|agressao|automedicacao|abandono/.test(k));
      crit.push({ base: temRisco ? 2.5 : 1.5, nome: temRisco ? "Avaliacao de risco e temas sensiveis" : "Temas sensiveis", objetivo: "Investigar, com acolhimento, os temas delicados do caso (inclui risco quando aplicavel).", itens: itRisco });
    }
    const rede = caso.rede_apoio || {};
    if (chavesComValor(rede).length) {
      crit.push({ base: 1, nome: "Rede de apoio e fatores de protecao", objetivo: "Mapear apoio e fatores de protecao.", itens: [
        { nome: "rede de apoio", termos: ["apoio", "com quem conta", "familia", "amigos", "quem te ajuda", "conversar com alguem", "suporte"] },
      ] });
    }
  }

  // Normaliza pesos para somar 10 (1 casa decimal; ajusta o ultimo p/ fechar exato).
  const somaBase = crit.reduce((a, c) => a + c.base, 0);
  let acum = 0;
  crit.forEach((c, i) => {
    if (i === crit.length - 1) c.peso = Math.round((10 - acum) * 10) / 10;
    else { c.peso = Math.round((c.base / somaBase) * 10 * 10) / 10; acum += c.peso; }
    delete c.base;
  });

  return { nome_caso: caso.titulo || "", criterios: crit };
}

for (const id of ids) {
  const caso = JSON.parse(readFileSync(path.join(RAIZ, "casos", `${id}.json`), "utf8"));
  const r = rubrica(caso);
  writeFileSync(path.join(RAIZ, "avaliacoes", `${id}.json`), JSON.stringify(r, null, 2) + "\n");
  const soma = r.criterios.reduce((a, c) => a + c.peso, 0);
  console.log(`${id.padEnd(24)} ${r.criterios.length} criterios · soma pesos ${soma}`);
}
