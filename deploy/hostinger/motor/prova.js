// Modo prova: o circuito de estações, como o dia da 2ª etapa acontece.
//
// Treinar uma estação por vez ensina a estação. A prova é outra coisa: são cinco
// seguidas, com giro obrigatório entre elas (item 3.6.2 do edital), sem voltar
// atrás, e a nota que importa é a SOMA — 0 a 50 no dia, 0 a 100 no exame inteiro
// (itens 3.4 e 3.5). Quem treina solto chega ao terceiro caso já cansado e
// descobre isso no dia errado.
//
// O sorteio cobre ÁREAS, não casos: o participante do Revalida não escolhe o que
// vai cair, e as cinco estações do dia atravessam a formação médica inteira
// (item 3.3.1). Sortear cinco de Clínica Médica seria simular o conforto, não a
// prova.

export const ESTACOES_POR_PROVA = 5;
export const NOTA_MAXIMA_PROVA = 50;

// Ordem em que as áreas são preenchidas. Começa pelas cinco do edital; se faltar
// caso em alguma, o sorteio completa com o que houver, sem repetir.
const AREAS_DO_DIA = [
  "clinica_medica",
  "cirurgia",
  "ginecologia_obstetricia",
  "pediatria",
  "medicina_familia",
];

// Sorteia o circuito. `sorteio` entra como parâmetro para o teste poder fixá-lo —
// prova sorteada é impossível de testar de outro jeito.
export function sortearCircuito(estacoesPorArea, quantidade = ESTACOES_POR_PROVA, sorteio = Math.random) {
  const escolhidas = [];
  const usados = new Set();

  const tirarDe = (area) => {
    const disponiveis = (estacoesPorArea[area] || []).filter((id) => !usados.has(id));
    if (!disponiveis.length) return null;
    const id = disponiveis[Math.floor(sorteio() * disponiveis.length)];
    usados.add(id);
    return { id, area };
  };

  // Uma por área, na ordem do edital.
  for (const area of AREAS_DO_DIA) {
    if (escolhidas.length >= quantidade) break;
    const escolhida = tirarDe(area);
    if (escolhida) escolhidas.push(escolhida);
  }

  // Faltou área com acervo? Completa com o que sobrou, começando pelas áreas com
  // mais casos — é o que mantém o circuito com cinco estações mesmo enquanto o
  // acervo de uma área ainda é raso.
  if (escolhidas.length < quantidade) {
    const sobra = Object.entries(estacoesPorArea)
      .flatMap(([area, ids]) => ids.filter((id) => !usados.has(id)).map((id) => ({ id, area })))
      .sort(() => sorteio() - 0.5);
    for (const item of sobra) {
      if (escolhidas.length >= quantidade) break;
      usados.add(item.id);
      escolhidas.push(item);
    }
  }

  return escolhidas;
}

// Uma prova viva. Fica em memória, como as consultas: o que precisa sobreviver a
// um restart é o transcript de cada estação, que já é gravado em disco.
export function criarProva({ id, aluno, circuito }) {
  return {
    id,
    aluno,
    circuito,
    atual: 0,
    resultados: [],
    iniciadaEm: Date.now(),
    encerradaEm: null,
  };
}

export function proximaEstacao(prova) {
  if (!prova || prova.atual >= prova.circuito.length) return null;
  return { ...prova.circuito[prova.atual], ordem: prova.atual + 1, total: prova.circuito.length };
}

// Registra o resultado de uma estação e faz o giro. Sem volta: no circuito real,
// o participante muda de sala com o auxílio da equipe e não retorna (item 3.6.3).
export function registrarResultado(prova, { caso, area, area_nome, nota, nota_maxima, titulo }) {
  prova.resultados.push({
    ordem: prova.atual + 1,
    caso,
    titulo: titulo || caso,
    area,
    // O nome legível vai junto: o boletim é lido por gente, e "clinica_medica"
    // é chave de programa, não nome de área.
    area_nome: area_nome || area,
    nota: Number(Number(nota || 0).toFixed(2)),
    nota_maxima: nota_maxima || 10,
  });
  prova.atual += 1;
  if (prova.atual >= prova.circuito.length) prova.encerradaEm = Date.now();
  return prova;
}

export function boletim(prova) {
  const soma = prova.resultados.reduce((total, r) => total + r.nota, 0);
  const maxima = prova.circuito.length * 10;
  return {
    id: prova.id,
    concluida: Boolean(prova.encerradaEm),
    estacoes_feitas: prova.resultados.length,
    estacoes_total: prova.circuito.length,
    nota: Number(soma.toFixed(2)),
    nota_maxima: maxima,
    // A média por estação é o número que se compara com a nota de corte, que o
    // INEP publica por edição — a soma bruta muda conforme o dia tem 5 ou 10.
    media: prova.resultados.length ? Number((soma / prova.resultados.length).toFixed(2)) : 0,
    duracao_s: Math.round(((prova.encerradaEm || Date.now()) - prova.iniciadaEm) / 1000),
    resultados: prova.resultados,
  };
}
