/* O rosto do ator que interpreta o paciente.
 *
 * No Revalida quem está do outro lado é uma PESSOA — um ator treinado, com rosto,
 * que olha para o candidato e reage. A primeira versão disto era um boneco 3D e
 * deu errado do pior jeito (cabeça engolida pelo cabelo, olhos esbugalhados): um
 * humano quase-certo é pior que nenhum humano. A segunda foi um campo abstrato
 * que pulsava — honesto, mas não era ninguém.
 *
 * Este é o meio-termo deliberado: um rosto ILUSTRADO, que ninguém confunde com
 * fotografia. O vale da estranheza mora na tentativa de realismo; um desenho
 * assumidamente desenhado não cai nele, e ainda assim dá para ler dor, medo,
 * tristeza e atenção em uma olhada — que é o que a estação precisa.
 *
 * Nada aqui inventa quem a pessoa é: sexo e faixa etária vêm da identificação do
 * caso, e as seis dimensões emocionais vêm de `motor/expressao.js`, derivadas do
 * próprio caso clínico. O rosto é uma leitura desses números, não um personagem
 * novo.
 *
 * As funções de forma são puras e testadas em `testes/motor.test.js`.
 */

/* ---- Matemática das feições, pura ---------------------------------------- */

// Quanto o olho está aberto (0 fechado, 1 arregalado).
//
// O piscar é determinístico no tempo, não aleatório: com `Math.random()` o rosto
// piscava em quadros diferentes a cada laço e produzia um tremor de pálpebra que
// lia como tique nervoso em TODOS os casos, inclusive nos calmos.
export function aberturaDoOlho(t, exp, semMovimento = false) {
  const e = exp || {};
  // Medo arregala; dor e tristeza apertam; retraimento baixa a pálpebra.
  const base = 1 + (e.medo || 0) * 0.35 - (e.dor || 0) * 0.3 - (e.tristeza || 0) * 0.15 - (e.retraimento || 0) * 0.2;
  if (semMovimento) return Math.max(0.25, Math.min(1.35, base));

  // Um piscar a cada ~4,3 s (número primo-ish para não sincronizar com a
  // respiração e criar um padrão visível), mais rápido sob agitação.
  const periodo = 4.3 - (e.agitacao || 0) * 1.6;
  const fase = (t % periodo) / periodo;
  // O piscar ocupa ~7% do ciclo: fecha e abre depressa.
  const piscando = fase > 0.93 ? Math.sin((fase - 0.93) / 0.07 * Math.PI) : 0;
  return Math.max(0.05, Math.min(1.35, base * (1 - piscando)));
}

// Curvatura da boca. Negativo = cantos para baixo (sofrimento), positivo = para
// cima. Nunca chega a sorriso franco: ninguém sorri numa consulta por dor.
export function curvaDaBoca(exp) {
  const e = exp || {};
  const sofrimento = Math.max(e.tristeza || 0, e.dor || 0, e.retraimento || 0);
  return Math.max(-1, Math.min(0.35, 0.12 - sofrimento * 1.05 - (e.tensao || 0) * 0.15));
}

// Inclinação da sobrancelha, em radianos. Positivo levanta a ponta interna (a
// "sobrancelha de tristeza"); negativo franze para baixo e para dentro (dor,
// tensão, raiva contida).
export function anguloDaSobrancelha(exp) {
  const e = exp || {};
  const triste = (e.tristeza || 0) * 0.34 + (e.medo || 0) * 0.22;
  const franzido = (e.dor || 0) * 0.4 + (e.tensao || 0) * 0.22;
  return triste - franzido;
}

// Para onde a pupila aponta, em fração do raio da íris.
// `olhar` vem do caso: direto, baixo, desviado, fixo.
export function direcaoDoOlhar(olhar, t, exp, semMovimento = false) {
  const e = exp || {};
  let x = 0;
  let y = 0;
  if (olhar === "baixo") y = 0.42;
  else if (olhar === "desviado") { x = -0.38; y = 0.12; }
  else if (olhar === "fixo") { x = 0; y = 0; }

  if (semMovimento) return { x, y };

  // Micro-sacadas: o olho humano nunca fica parado. Sem isto o rosto lê como
  // máscara. Agitação aumenta a frequência; retraimento puxa o olhar para baixo.
  const vel = 0.7 + (e.agitacao || 0) * 1.8;
  x += Math.sin(t * vel) * 0.05 + Math.sin(t * vel * 2.3) * 0.02;
  y += Math.cos(t * vel * 0.8) * 0.03 + (e.retraimento || 0) * 0.1;
  return { x: Math.max(-1, Math.min(1, x)), y: Math.max(-1, Math.min(1, y)) };
}

// Abertura da boca ao falar. A energia da voz manda, mas com piso e teto: boca
// escancarada a cada sílaba vira caricatura.
export function aberturaDaBoca(energiaVoz, falando) {
  if (!falando) return 0;
  return Math.max(0.08, Math.min(0.62, energiaVoz * 0.85));
}

/* ---- Desenho ------------------------------------------------------------- */

// Paleta de pele em tons ilustrados — deliberadamente fora do fotorrealismo, e
// variada para que o acervo não seja um bloco de pessoas iguais. O índice sai do
// id do caso (estável: o mesmo caso tem sempre o mesmo rosto).
const PELES = [
  { base: "#f0d3bd", sombra: "#dcb69c", traco: "#6b4a38" },
  { base: "#e3bb9a", sombra: "#c99b78", traco: "#5c3d2c" },
  { base: "#c98f6a", sombra: "#ac744f", traco: "#4a2f21" },
  { base: "#9c6644", sombra: "#7f4f32", traco: "#3a2318" },
  { base: "#70452c", sombra: "#57341f", traco: "#2a1810" },
];
const CABELOS = ["#2f2a26", "#4a3728", "#6b5344", "#8a7259", "#a9a29b", "#d9d2c9"];

// Número estável a partir de um texto: o mesmo caso devolve sempre o mesmo rosto.
// Sem isto, o paciente trocaria de aparência a cada recarga da página.
export function semente(texto) {
  let h = 2166136261;
  for (let i = 0; i < String(texto || "").length; i++) {
    h ^= String(texto).charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h);
}

export function aparenciaDoCaso(perfil) {
  const p = perfil || {};
  const s = semente(p.id || p.nome || "paciente");
  const idade = Number(p.idade) || 40;
  const feminino = String(p.sexo || "").toLowerCase().startsWith("f");
  return {
    pele: PELES[s % PELES.length],
    // Cabelo embranquece com a idade: acima de 60 entra na faixa dos grisalhos.
    cabelo: idade >= 60
      ? CABELOS[4 + (s % 2)]
      : CABELOS[s % 4],
    cabeloLongo: feminino ? (s % 5) !== 0 : (s % 7) === 0,
    idade,
    feminino,
  };
}

/* Desenha o rosto inteiro. Recebe o contexto já posicionado pelo chamador.
   `r` é o raio da cabeça; tudo o mais é proporção dele, para o rosto ficar igual
   no retrato do desktop e na faixa deitada do celular. */
export function desenharRosto(ctx, opcoes) {
  const {
    cx, cy, r, exp = {}, energiaVoz = 0, t = 0,
    falando = false, aparencia, semMovimento = false,
  } = opcoes;

  const pele = aparencia.pele;
  const larguraCabeca = r * 0.82;

  // Inclinação da cabeça: quem se retrai baixa e vira o rosto.
  const inclina = (exp.retraimento || 0) * 0.13 + (exp.tristeza || 0) * 0.07;

  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(-inclina);

  // --- Pescoço e ombros. O rosto solto no ar não é uma pessoa, é uma máscara.
  ctx.fillStyle = pele.sombra;
  ctx.beginPath();
  ctx.roundRect(-r * 0.26, r * 0.55, r * 0.52, r * 0.6, r * 0.12);
  ctx.fill();

  ctx.fillStyle = pele.base;
  ctx.beginPath();
  ctx.ellipse(0, r * 1.42, r * 1.15, r * 0.62, 0, Math.PI, Math.PI * 2);
  ctx.fill();

  // --- Cabelo atrás (só quando é longo).
  if (aparencia.cabeloLongo) {
    ctx.fillStyle = aparencia.cabelo;
    ctx.beginPath();
    ctx.ellipse(0, r * 0.18, larguraCabeca * 1.22, r * 1.16, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  // --- Cabeça.
  ctx.fillStyle = pele.base;
  ctx.beginPath();
  ctx.ellipse(0, 0, larguraCabeca, r, 0, 0, Math.PI * 2);
  ctx.fill();

  // Sombra lateral: dá volume sem sombrear feição, que é onde o realismo começa a
  // dar errado.
  ctx.fillStyle = pele.sombra;
  ctx.globalAlpha = 0.35;
  ctx.beginPath();
  ctx.ellipse(larguraCabeca * 0.42, r * 0.08, larguraCabeca * 0.55, r * 0.9, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1;

  // --- Cabelo em cima.
  ctx.fillStyle = aparencia.cabelo;
  ctx.beginPath();
  ctx.ellipse(0, -r * 0.42, larguraCabeca * 1.02, r * 0.62, 0, Math.PI, Math.PI * 2);
  ctx.fill();
  // Franja assimétrica, para o rosto não ficar espelhado — simetria perfeita é
  // outro caminho para o vale da estranheza.
  ctx.beginPath();
  ctx.moveTo(-larguraCabeca * 0.98, -r * 0.36);
  ctx.quadraticCurveTo(-larguraCabeca * 0.3, -r * 0.86, larguraCabeca * 0.86, -r * 0.5);
  ctx.quadraticCurveTo(larguraCabeca * 0.2, -r * 0.52, -larguraCabeca * 0.98, -r * 0.12);
  ctx.fill();

  const olhoY = -r * 0.06;
  const olhoX = larguraCabeca * 0.4;
  const olhoR = r * 0.155;
  const abertura = aberturaDoOlho(t, exp, semMovimento);
  const olhar = direcaoDoOlhar(exp.olhar, t, exp, semMovimento);

  // --- Olhos.
  for (const lado of [-1, 1]) {
    const ox = lado * olhoX;

    // Esclera.
    ctx.save();
    ctx.beginPath();
    ctx.ellipse(ox, olhoY, olhoR, olhoR * abertura, 0, 0, Math.PI * 2);
    ctx.fillStyle = "#fbfaf8";
    ctx.fill();
    ctx.clip();

    // Íris e pupila. Ficam dentro do recorte: assim a pálpebra corta o olho,
    // como acontece de verdade, em vez de a íris flutuar por cima.
    const ix = ox + olhar.x * olhoR * 0.42;
    const iy = olhoY + olhar.y * olhoR * 0.42;
    ctx.beginPath();
    ctx.arc(ix, iy, olhoR * 0.55, 0, Math.PI * 2);
    ctx.fillStyle = "#5b4a3f";
    ctx.fill();
    ctx.beginPath();
    ctx.arc(ix, iy, olhoR * 0.26, 0, Math.PI * 2);
    ctx.fillStyle = "#1a1512";
    ctx.fill();
    // Brilho: um ponto só, fixo. É o que faz o olhar parecer vivo.
    ctx.beginPath();
    ctx.arc(ix - olhoR * 0.2, iy - olhoR * 0.22, olhoR * 0.12, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(255,255,255,.9)";
    ctx.fill();
    ctx.restore();

    // Contorno da pálpebra.
    ctx.beginPath();
    ctx.ellipse(ox, olhoY, olhoR, olhoR * abertura, 0, 0, Math.PI * 2);
    ctx.strokeStyle = pele.traco;
    ctx.lineWidth = Math.max(1, r * 0.018);
    ctx.stroke();

    // --- Sobrancelha.
    const ang = anguloDaSobrancelha(exp) * lado;
    const sy = olhoY - olhoR * 1.5 - (exp.medo || 0) * r * 0.04;
    ctx.save();
    ctx.translate(ox, sy);
    ctx.rotate(ang * lado * -1);
    ctx.beginPath();
    ctx.moveTo(-olhoR * 1.05, 0);
    ctx.quadraticCurveTo(0, -olhoR * 0.42, olhoR * 1.05, olhoR * 0.08);
    ctx.strokeStyle = aparencia.cabelo;
    ctx.lineWidth = Math.max(1.6, r * 0.045);
    ctx.lineCap = "round";
    ctx.stroke();
    ctx.restore();
  }

  // --- Nariz: duas linhas curtas. Nariz detalhado é onde o desenho começa a
  // querer ser foto.
  ctx.beginPath();
  ctx.moveTo(-r * 0.05, r * 0.02);
  ctx.quadraticCurveTo(-r * 0.09, r * 0.2, 0, r * 0.22);
  ctx.strokeStyle = pele.sombra;
  ctx.lineWidth = Math.max(1.2, r * 0.022);
  ctx.lineCap = "round";
  ctx.stroke();

  // --- Boca.
  const bocaY = r * 0.46;
  const bocaL = larguraCabeca * 0.42;
  const curva = curvaDaBoca(exp);
  const aberta = aberturaDaBoca(energiaVoz, falando) * r * 0.5;

  if (aberta > r * 0.03) {
    // Falando: a boca vira uma forma, não uma linha.
    ctx.beginPath();
    ctx.ellipse(0, bocaY + aberta * 0.3, bocaL * 0.72, aberta, 0, 0, Math.PI * 2);
    ctx.fillStyle = "#7d4b48";
    ctx.fill();
    ctx.strokeStyle = pele.traco;
    ctx.lineWidth = Math.max(1.2, r * 0.02);
    ctx.stroke();
  } else {
    ctx.beginPath();
    ctx.moveTo(-bocaL, bocaY);
    ctx.quadraticCurveTo(0, bocaY + curva * r * 0.22, bocaL, bocaY);
    ctx.strokeStyle = pele.traco;
    ctx.lineWidth = Math.max(1.5, r * 0.028);
    ctx.lineCap = "round";
    ctx.stroke();
  }

  // --- Marcas de sofrimento. Só aparecem quando há sofrimento de verdade: um
  // rosto sempre franzido não distingue a cólica renal da consulta de rotina.
  const sofrimento = Math.max(exp.dor || 0, exp.tensao || 0);
  if (sofrimento > 0.35) {
    ctx.globalAlpha = Math.min(0.7, (sofrimento - 0.35) * 1.6);
    ctx.strokeStyle = pele.traco;
    ctx.lineWidth = Math.max(1, r * 0.016);
    // Vinco entre as sobrancelhas.
    for (const lado of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(lado * r * 0.06, -r * 0.3);
      ctx.lineTo(lado * r * 0.09, -r * 0.18);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  // Palidez do sofrimento: um véu frio sobre o rosto inteiro. Sutil de propósito.
  const palidez = Math.max(exp.tristeza || 0, exp.retraimento || 0);
  if (palidez > 0.3) {
    ctx.globalAlpha = (palidez - 0.3) * 0.22;
    ctx.fillStyle = "#8fa6bd";
    ctx.beginPath();
    ctx.ellipse(0, 0, larguraCabeca, r, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  ctx.restore();
}
