/* A presença do paciente.
 *
 * A primeira tentativa foi um boneco humano em 3D. Deu errado do pior jeito: cabeça
 * engolida pelo cabelo, olhos esbugalhados, ombros deformados. Num caso de dor
 * abdominal com uma paciente de 22 anos, aquilo não produzia presença — produzia
 * distração e desconforto. É o vale da estranheza, e ele não se resolve com mais
 * polígonos: um humano quase-certo é pior que nenhum humano.
 *
 * Então isto aqui NÃO tenta ser um corpo. É a presença de alguém: um campo que
 * respira na frequência do caso, se acende quando a pessoa fala, se retrai quando
 * ela se fecha, e diz em uma palavra o que está acontecendo (ouvindo · pensando ·
 * falando). O aluno olha para cá e sabe que tem alguém do outro lado esperando —
 * que é a única coisa que a lista de balões não conseguia dizer.
 *
 * Custo: um canvas 2D e um laço. Sem biblioteca, sem download, sem GPU dedicada —
 * o que importa num celular de aluno, no meio de uma aula.
 */

import { aparenciaDoCaso, desenharRosto } from "./rosto.js";

let raiz = null;
let aparencia = aparenciaDoCaso({});
let canvas = null;
let ctx = null;
let quadro = null;
let dpr = 1;

let expressao = expressaoNeutra();
let estado = "espera";
let pausado = false;
let semMovimento = false;

let audioCtx = null;
let analisador = null;
let bufferOnda = null;
let bufferFaixas = null;
const fontes = new WeakSet();

let energiaVoz = 0;
let nivelEntrada = 0;
let ultimaInteracao = 0;
// Instante em que o aluno foi ouvido falando pela última vez. O laço DERIVA o
// estado disto, em vez de comutar a cada evento: o portão de ruído abre e fecha
// entre as palavras, e um rótulo que trocasse junto ficaria piscando.
let ultimoOuvindo = -99999;
let inicio = 0;
const ondas = new Array(72).fill(0);

function expressaoNeutra() {
  return {
    tensao: 0, tristeza: 0, dor: 0, medo: 0, agitacao: 0, retraimento: 0,
    postura: "neutra", olhar: "direto", respiracao: 14,
  };
}

export function suportada() {
  try {
    return Boolean(document.createElement("canvas").getContext("2d"));
  } catch {
    return false;
  }
}

/* ---- Matemática do movimento, pura e testável ---------------------------- */

// Escala do campo no ciclo respiratório. `rpm` vem do caso.
export function respiracaoEm(t, rpm, dor = 0, tensao = 0) {
  const ciclo = Math.sin((t * (rpm || 14) * Math.PI * 2) / 60);
  const amplitude = 0.012 + dor * 0.012 + tensao * 0.006;
  return 1 + ciclo * amplitude;
}

// A resposta à voz sobe depressa e desce devagar: o contrário treme.
export function proximaAbertura(atual, energia, dt) {
  const taxa = energia > atual ? 22 : 9;
  return atual + (energia - atual) * Math.min(1, Math.max(0, dt) * taxa);
}

// Cor da presença. Não é decoração: é a leitura do estado emocional em uma olhada.
// Sofrimento esfria e apaga; agitação satura; acolhimento devolve o tom da marca.
export function tomDaExpressao(exp) {
  // Mescla com o neutro em vez de só trocar o nulo: uma expressão PARCIAL — que é
  // o que chega quando o caso não aciona todas as dimensões — produzia `undefined`
  // nas contas e devolvia `hsla(NaN…)`, ou seja, presença invisível.
  const e = { ...expressaoNeutra(), ...(exp || {}) };
  const sofrimento = Math.max(e.tristeza, e.retraimento);
  // 172° é o verde-azulado da marca. A dor puxa para o âmbar (32°); o sofrimento,
  // para o azul frio (214°). Os dois COMPETEM em vez de somar: somando, um infarto
  // com retraimento caía no meio do caminho e virava um verde-limão que não diz
  // nada. Quem está pior manda na cor.
  const alvo = e.dor >= sofrimento ? 32 : 214;
  const forca = Math.max(e.dor, sofrimento);
  const matiz = 172 + (alvo - 172) * forca - e.medo * 8;
  const saturacao = 44 + e.agitacao * 26 + e.dor * 14 - sofrimento * 16;
  const luz = 52 - sofrimento * 12 + e.tensao * 4;
  return {
    matiz: Math.round(matiz),
    saturacao: Math.max(12, Math.min(85, Math.round(saturacao))),
    luz: Math.max(28, Math.min(66, Math.round(luz))),
  };
}

/* ---- Áudio --------------------------------------------------------------- */

function garantirContexto() {
  if (!audioCtx) {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return null;
    audioCtx = new Ctx();
  }
  if (audioCtx.state === "suspended") audioCtx.resume().catch(() => {});
  return audioCtx;
}

function ligarAnalisador(no) {
  const c = garantirContexto();
  if (!c) return;
  if (!analisador) {
    analisador = c.createAnalyser();
    analisador.fftSize = 512;
    analisador.smoothingTimeConstant = 0.55;
    bufferOnda = new Uint8Array(analisador.fftSize);
    bufferFaixas = new Uint8Array(analisador.frequencyBinCount);
  }
  try {
    no.connect(analisador);
  } catch {
    /* já conectado */
  }
}

// A fala por frase toca num <audio>. Um elemento só aceita UM nó de origem na vida
// — daí o WeakSet — e o nó precisa seguir para a saída, senão o paciente emudece.
export function ouvirElemento(el) {
  const c = garantirContexto();
  if (!c || !el) return;
  // Contexto suspenso engoliria a voz. Presença sem som é um péssimo negócio.
  if (c.state !== "running") return;
  try {
    if (!fontes.has(el)) {
      const origem = c.createMediaElementSource(el);
      fontes.add(el);
      el.__origemPV = origem;
      origem.connect(c.destination);
    }
    if (el.__origemPV) ligarAnalisador(el.__origemPV);
  } catch {
    /* sem análise: a presença continua respirando, só não pulsa com a fala */
  }
}

// A conversa ao vivo chega como MediaStream. Aqui o nó NÃO vai para a saída: quem
// toca é o elemento do WebRTC, e duplicar viraria eco.
export function ouvirStream(stream) {
  const c = garantirContexto();
  if (!c || !stream) return;
  try {
    ligarAnalisador(c.createMediaStreamSource(stream));
  } catch {
    /* segue sem pulsar */
  }
}

function energiaDaVoz() {
  if (!analisador || !bufferOnda) return 0;
  analisador.getByteTimeDomainData(bufferOnda);
  let soma = 0;
  for (let i = 0; i < bufferOnda.length; i++) {
    const v = (bufferOnda[i] - 128) / 128;
    soma += v * v;
  }
  const rms = Math.sqrt(soma / bufferOnda.length);
  return Math.min(1, Math.max(0, (rms - 0.012) * 9));
}

// Espectro simplificado em 72 setores: é o que dá a forma orgânica ao anel, em vez
// de um círculo que só cresce e encolhe.
function atualizarOndas(intensidade, dt) {
  if (analisador && bufferFaixas) analisador.getByteFrequencyData(bufferFaixas);
  const n = ondas.length;
  for (let i = 0; i < n; i++) {
    let alvo = 0;
    if (analisador && bufferFaixas && intensidade > 0.01) {
      // Só o miolo do espectro: agudos de sibilância deixariam o anel espetado.
      const faixa = Math.floor((i / n) * (bufferFaixas.length * 0.45));
      alvo = (bufferFaixas[faixa] / 255) * intensidade;
    }
    ondas[i] += (alvo - ondas[i]) * Math.min(1, dt * 12);
  }
}

/* ---- Desenho ------------------------------------------------------------- */

function corDoTema(nome, alternativa) {
  try {
    const v = getComputedStyle(raiz).getPropertyValue(nome).trim();
    return v || alternativa;
  } catch {
    return alternativa;
  }
}

const ROTULO = {
  espera: "esperando você",
  ouvindo: "ouvindo",
  pensando: "pensando",
  falando: "falando",
};

function desenhar(t, dt) {
  const l = canvas.width / dpr;
  const a = canvas.height / dpr;
  const cx = l / 2;
  // No celular o painel é uma faixa deitada (352×240); no desktop, um retrato. O
  // campo se dimensiona pelo lado MENOR para caber nos dois, e sobe um pouco para
  // deixar respiro embaixo, onde ficam a palavra de estado e a legenda.
  const cy = a * 0.44;
  const base = Math.min(l, a) * 0.32;

  const tom = tomDaExpressao(expressao);
  const cor = (luz, alfa) => `hsla(${tom.matiz}, ${tom.saturacao}%, ${luz}%, ${alfa})`;

  ctx.clearRect(0, 0, l, a);

  // Fundo: um degradê discreto. A presença precisa de um lugar, não de um palco.
  const fundo = ctx.createLinearGradient(0, 0, 0, a);
  fundo.addColorStop(0, corDoTema("--superficie-2", "#f7f9fb"));
  fundo.addColorStop(1, corDoTema("--superficie", "#ffffff"));
  ctx.fillStyle = fundo;
  ctx.fillRect(0, 0, l, a);

  const respiro = semMovimento ? 1 : respiracaoEm(t, expressao.respiracao, expressao.dor, expressao.tensao);
  // Quem se retrai ocupa menos espaço. É a postura, traduzida em tamanho.
  const raio = base * respiro * (1 - expressao.retraimento * 0.12);

  // Halo: o campo em volta. Cresce com a fala e treme de leve com o medo.
  const tremor = semMovimento ? 0 : Math.sin(t * 9) * expressao.medo * 1.5;
  const halo = ctx.createRadialGradient(cx, cy, raio * 0.2, cx + tremor, cy, raio * (2.1 + energiaVoz * 0.5));
  halo.addColorStop(0, cor(tom.luz + 12, 0.28 + energiaVoz * 0.22));
  halo.addColorStop(1, cor(tom.luz, 0));
  ctx.fillStyle = halo;
  ctx.fillRect(0, 0, l, a);

  // Anel de voz: o contorno responde ao espectro, setor a setor.
  ctx.beginPath();
  const n = ondas.length;
  for (let i = 0; i <= n; i++) {
    const idx = i % n;
    const ang = (idx / n) * Math.PI * 2 - Math.PI / 2;
    const r = raio * (1.28 + ondas[idx] * 0.42);
    const x = cx + Math.cos(ang) * r;
    const y = cy + Math.sin(ang) * r;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = cor(tom.luz + 6, 0.35 + energiaVoz * 0.4);
  ctx.stroke();

  // A pessoa. Era um núcleo abstrato — honesto, mas não era ninguém: no Revalida
  // quem está do outro lado é um ATOR, com rosto, que olha para o candidato. O
  // halo e o anel de voz continuam por baixo, agora como o ar em volta dela.
  desenharRosto(ctx, {
    cx,
    cy,
    r: raio,
    exp: expressao,
    energiaVoz,
    t,
    falando: estado === "falando",
    aparencia,
    semMovimento,
  });

  // Arco do microfone: o retorno de que ESTÁ sendo ouvido. Sem isto o aluno fala
  // mais alto do que precisa, sem saber se o sistema o escuta.
  if (nivelEntrada > 0.01) {
    const abertura = Math.min(Math.PI * 1.6, Math.PI * 0.25 + nivelEntrada * 9);
    ctx.beginPath();
    ctx.arc(cx, cy, raio * 1.62, -Math.PI / 2 - abertura / 2, -Math.PI / 2 + abertura / 2);
    ctx.lineWidth = 3;
    ctx.lineCap = "round";
    ctx.strokeStyle = corDoTema("--primaria", "#0f766e");
    ctx.globalAlpha = Math.min(0.9, 0.3 + nivelEntrada * 6);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  // O silêncio pesa: passado um tempo sem ninguém perguntar nada, o campo se move
  // de leve, como quem espera. O incômodo da pausa é parte do que se treina aqui.
  if (!semMovimento && estado === "espera" && performance.now() - ultimaInteracao > 9000) {
    const oscila = Math.sin(t * 0.9) * 3;
    ctx.beginPath();
    ctx.arc(cx + oscila, cy, raio * 1.9, 0, Math.PI * 2);
    ctx.strokeStyle = cor(tom.luz, 0.12);
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  // O estado, em uma palavra. Preso ao rodapé do painel e nunca abaixo dele: com a
  // posição amarrada ao raio, na faixa deitada do celular a palavra caía fora da
  // área visível — o aluno via um campo pulsando e nenhuma explicação.
  ctx.fillStyle = corDoTema("--texto-suave", "#5a6b7b");
  ctx.font = `600 ${Math.max(11, Math.round(base * 0.15))}px system-ui, -apple-system, "Segoe UI", sans-serif`;
  ctx.textAlign = "center";
  ctx.letterSpacing = "0.1em";
  ctx.fillText((ROTULO[estado] || "").toUpperCase(), cx, Math.min(cy + raio * 1.95, a - 46));
}

function laco() {
  quadro = requestAnimationFrame(laco);
  if (pausado || document.hidden || !ctx) return;

  const agora = performance.now();
  const dt = Math.min(0.05, (agora - (laco.ultimo || agora)) / 1000);
  laco.ultimo = agora;
  const t = (agora - inicio) / 1000;

  energiaVoz = proximaAbertura(energiaVoz, energiaDaVoz(), dt);
  // O estado é DERIVADO, não comutado a cada evento: o portão de ruído abre e
  // fecha entre as palavras, e um rótulo que trocasse junto ficaria piscando.
  const desdeFala = agora - ultimoOuvindo;
  if (desdeFala < 900) estado = "ouvindo";
  else if (energiaVoz > 0.05) estado = "falando";
  else if (desdeFala < 4000) estado = "pensando";
  else estado = "espera";
  atualizarOndas(semMovimento ? 0 : energiaVoz, dt);
  nivelEntrada += (0 - nivelEntrada) * Math.min(1, dt * 2.5); // decai sozinho entre avisos

  desenhar(t, dt);
}

/* ---- Ciclo de vida ------------------------------------------------------- */

function dimensionar() {
  if (!canvas || !raiz) return;
  dpr = Math.min(window.devicePixelRatio || 1, 2);
  const l = Math.max(1, raiz.clientWidth);
  const a = Math.max(1, raiz.clientHeight);
  canvas.width = Math.round(l * dpr);
  canvas.height = Math.round(a * dpr);
  canvas.style.width = "100%";
  canvas.style.height = "100%";
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

export async function abrir({ container, expressao: exp, perfil }) {
  if (canvas) return true;
  if (!suportada()) return false;

  raiz = container;
  expressao = { ...expressaoNeutra(), ...(exp || {}) };
  // Quem é a pessoa: sexo e faixa etária saem da identificação do caso, e o id
  // mantém o mesmo rosto entre recargas — o paciente não pode trocar de cara no
  // meio da consulta.
  aparencia = aparenciaDoCaso(perfil);
  semMovimento = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  estado = "espera";
  inicio = performance.now();
  ultimaInteracao = inicio;

  canvas = document.createElement("canvas");
  canvas.setAttribute("aria-hidden", "true");
  canvas.style.display = "block";
  ctx = canvas.getContext("2d");
  raiz.appendChild(canvas);

  dimensionar();
  window.addEventListener("resize", dimensionar);
  document.addEventListener("visibilitychange", aoVoltarParaAba);
  laco.ultimo = performance.now();
  laco();
  return true;
}

function aoVoltarParaAba() {
  if (!document.hidden) laco.ultimo = performance.now();
}

export function renderizarQuadro() {
  if (ctx) desenhar((performance.now() - inicio) / 1000, 0.016);
}

export function definirEstado(novo) {
  if (ROTULO[novo]) estado = novo;
}

// Nível do microfone, vindo da camada de voz ao vivo (0..1).
export function definirNivelEntrada(v) {
  const n = Number(v) || 0;
  nivelEntrada = Math.max(nivelEntrada, Math.min(1, n * 4));
}

export function ouvindo(valor) {
  if (valor) {
    ultimoOuvindo = performance.now();
    marcarInteracao();
  }
}

export function marcarInteracao() {
  ultimaInteracao = performance.now();
}

export function pausar(v) {
  pausado = Boolean(v);
}

export function aberta() {
  return Boolean(canvas);
}

export function fechar() {
  if (quadro) cancelAnimationFrame(quadro);
  quadro = null;
  window.removeEventListener("resize", dimensionar);
  document.removeEventListener("visibilitychange", aoVoltarParaAba);
  if (canvas && canvas.parentNode) canvas.remove();
  canvas = null;
  ctx = null;
  analisador = null;
  energiaVoz = 0;
  nivelEntrada = 0;
  ultimoOuvindo = -99999;
  ondas.fill(0);
}
