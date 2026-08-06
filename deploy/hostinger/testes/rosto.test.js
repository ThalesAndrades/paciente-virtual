// A matemática das feições do ator.
//
// O rosto é desenhado no navegador, mas as funções que decidem a FORMA são puras
// e moram aqui. O que elas guardam não é estética: é a diferença entre um rosto
// que informa o estado do paciente e um rosto que mente sobre ele — um paciente
// em cólica renal com cara de consulta de rotina ensina a coisa errada.

import assert from "node:assert/strict";
import test from "node:test";

const {
  aberturaDoOlho,
  aberturaDaBoca,
  anguloDaSobrancelha,
  aparenciaDoCaso,
  curvaDaBoca,
  direcaoDoOlhar,
  semente,
} = await import("../../../web/rosto.js");

test("o rosto de quem sofre não é o rosto de quem está bem", () => {
  const calmo = { dor: 0, tristeza: 0, tensao: 0, medo: 0 };
  const comDor = { dor: 0.9, tensao: 0.6 };
  const triste = { tristeza: 0.9 };

  // Boca: sofrimento derruba os cantos. Sem isto o paciente em cólica renal
  // aparece com a mesma cara de quem veio renovar receita.
  assert.ok(curvaDaBoca(comDor) < curvaDaBoca(calmo), "a dor não derrubou a boca");
  assert.ok(curvaDaBoca(triste) < curvaDaBoca(calmo), "a tristeza não derrubou a boca");
  // E nunca vira sorriso franco: ninguém sorri numa consulta por dor.
  assert.ok(curvaDaBoca(calmo) <= 0.35, "boca alegre demais para uma consulta");

  // Sobrancelha: tristeza levanta a ponta interna, dor franze para baixo. Os dois
  // sinais têm de ter SENTIDOS OPOSTOS, senão o rosto não distingue um do outro.
  assert.ok(anguloDaSobrancelha(triste) > 0, "a sobrancelha de tristeza não subiu");
  assert.ok(anguloDaSobrancelha(comDor) < 0, "a sobrancelha de dor não franziu");
});

test("o olho pisca, e o piscar não vira tique", () => {
  const exp = { medo: 0, dor: 0 };
  // Ao longo de um ciclo inteiro o olho tem de fechar em ALGUM momento...
  const amostras = [];
  for (let t = 0; t < 10; t += 0.02) amostras.push(aberturaDoOlho(t, exp));
  const menor = Math.min(...amostras);
  const maior = Math.max(...amostras);
  assert.ok(menor < 0.35, `o olho nunca fecha (mínimo ${menor.toFixed(2)})`);
  assert.ok(maior > 0.8, `o olho nunca abre direito (máximo ${maior.toFixed(2)})`);

  // ...mas ficar fechado é raro: piscar é um instante, não um estado. Com o
  // piscar aleatório de antes, o rosto tremia a pálpebra e lia como tique
  // nervoso em todos os casos, inclusive nos calmos.
  const fechados = amostras.filter((v) => v < 0.35).length;
  assert.ok(fechados / amostras.length < 0.12, "o olho passa tempo demais fechado");

  // Medo arregala; dor aperta.
  assert.ok(aberturaDoOlho(0, { medo: 0.9 }, true) > aberturaDoOlho(0, {}, true), "o medo não arregalou");
  assert.ok(aberturaDoOlho(0, { dor: 0.9 }, true) < aberturaDoOlho(0, {}, true), "a dor não apertou os olhos");
});

test("quem está sem movimento não fica com o olho travado fechado", () => {
  // `prefers-reduced-motion` desliga a animação. Se isso zerasse a abertura, o
  // paciente apareceria de olhos fechados a consulta inteira para quem pediu
  // menos movimento — exatamente quem não vai entender o que houve.
  for (const exp of [{}, { dor: 1 }, { tristeza: 1, retraimento: 1 }, { medo: 1 }]) {
    const v = aberturaDoOlho(3.7, exp, true);
    assert.ok(v >= 0.25, `olho quase fechado (${v.toFixed(2)}) com movimento reduzido`);
  }
});

test("o olhar obedece ao caso e nunca sai da órbita", () => {
  assert.ok(direcaoDoOlhar("baixo", 0, {}, true).y > 0.3, "olhar baixo não desceu");
  assert.ok(direcaoDoOlhar("desviado", 0, {}, true).x < -0.3, "olhar desviado não desviou");
  assert.equal(direcaoDoOlhar("fixo", 0, {}, true).x, 0);

  // Com micro-sacadas ligadas, a pupila continua dentro do olho em qualquer
  // instante: passar de 1 empurraria a íris para fora da esclera.
  for (let t = 0; t < 20; t += 0.05) {
    for (const olhar of ["direto", "baixo", "desviado", "fixo"]) {
      const d = direcaoDoOlhar(olhar, t, { agitacao: 1, retraimento: 1 });
      assert.ok(Math.abs(d.x) <= 1 && Math.abs(d.y) <= 1, `pupila fora da órbita em t=${t}`);
    }
  }
});

test("a boca só abre quando há fala, e não escancara", () => {
  assert.equal(aberturaDaBoca(0.9, false), 0, "boca aberta sem estar falando");
  assert.ok(aberturaDaBoca(0.9, true) > 0, "boca fechada falando");
  // Teto: boca escancarada a cada sílaba vira caricatura.
  assert.ok(aberturaDaBoca(5, true) <= 0.62, "boca escancarada demais");
  // Piso: com voz baixa a boca ainda se move, senão a fala parece dublada.
  assert.ok(aberturaDaBoca(0.001, true) >= 0.08, "boca parada durante a fala");
});

test("o mesmo caso tem sempre o mesmo rosto", () => {
  // Sem estabilidade, o paciente trocaria de aparência a cada recarga da página —
  // e, pior, entre uma estação e outra do mesmo circuito.
  const a = aparenciaDoCaso({ id: "apendicite", idade: 22, sexo: "Feminino" });
  const b = aparenciaDoCaso({ id: "apendicite", idade: 22, sexo: "Feminino" });
  assert.deepEqual(a, b);
  assert.equal(semente("apendicite"), semente("apendicite"));

  // Casos diferentes não são todos iguais: um acervo de 63 clones não é acervo.
  const ids = ["apendicite", "infarto", "dengue", "hanseniase", "endometriose", "tvp", "pneumonia"];
  const rostos = new Set(ids.map((id) => JSON.stringify(aparenciaDoCaso({ id, idade: 40, sexo: "Masculino" }))));
  assert.ok(rostos.size >= 3, `só ${rostos.size} aparências para ${ids.length} casos`);

  // Idade aparece no cabelo: acima de 60, grisalho.
  const idoso = aparenciaDoCaso({ id: "x", idade: 72, sexo: "Masculino" });
  const jovem = aparenciaDoCaso({ id: "x", idade: 24, sexo: "Masculino" });
  assert.notEqual(idoso.cabelo, jovem.cabelo, "a idade não mudou o cabelo");
});

test("perfil vazio não quebra o rosto", () => {
  // O caso pode não trazer idade ou sexo. Um `undefined` aqui viraria NaN no
  // canvas, e o paciente sumiria da sala sem erro nenhum no console.
  for (const p of [undefined, {}, { idade: "", sexo: "" }, { idade: null }]) {
    const a = aparenciaDoCaso(p);
    assert.ok(a.pele && a.pele.base, "aparência sem pele");
    assert.ok(a.cabelo, "aparência sem cabelo");
    assert.ok(Number.isFinite(a.idade), "idade não numérica");
  }
});
