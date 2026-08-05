/* A sala de atendimento em 3D.
 *
 * A consulta era uma lista de balões. O que a estação clínica precisa treinar —
 * presença, tempo, silêncio, olhar — não cabe num balão. Aqui há uma pessoa
 * sentada à frente do aluno: ela respira, pisca, se encolhe quando dói, desvia o
 * olhar quando o assunto aperta, e fica esperando quando ninguém pergunta nada.
 *
 * DECISÃO CENTRAL: realista-ESTILIZADO, nunca foto-real. Fotorrealismo de rosto
 * humano em tempo real, no navegador, para 46 identidades, não é alcançável nesta
 * infraestrutura — e, mesmo que fosse, seria errado: num caso de ideação suicida ou
 * de violência doméstica, um rosto "quase certo" cai no vale da estranheza e o
 * aluno passa a reagir ao artefato em vez de reagir à pessoa. Formas limpas,
 * movimento crível, nenhuma tentativa de enganar o olho.
 *
 * O lip-sync é dirigido pela ENERGIA DO ÁUDIO, não por fonema: as bibliotecas de
 * visema prontas não falam português, e a conversa em tempo real não emite visema
 * nenhum. Energia por quadro é agnóstica de idioma e funciona igual nos 46 casos.
 *
 * Nada aqui inventa mecânica: clicar num instrumento chama o MESMO endpoint de
 * exame que o painel lateral já usa. O 3D dá corpo ao que existe.
 */

let THREE = null;
let cena = null;
let camera = null;
let renderizador = null;
let relogio = null;
let quadro = null;
let raiz = null; // container DOM
let paciente = null; // { grupo, cabeca, olhoE, olhoD, boca, ... }
let instrumentos = []; // objetos clicáveis
let aoClicarInstrumento = () => {};
let expressao = expressaoNeutra();
let analisador = null;
let audioCtx = null;
let fontes = new WeakSet(); // elementos <audio> que já têm nó de origem
let bufferAudio = null;
let aberturaBoca = 0;
let alvoBoca = 0;
let ultimaInteracao = 0;
let ouvindoAluno = false;
let piscar = { proximo: 2, fechado: 0 };
let olhar = { x: 0, y: 0, alvoX: 0, alvoY: 0, proximo: 0 };
let semMovimento = false;
let pausado = false;

function expressaoNeutra() {
  return { tensao: 0, tristeza: 0, dor: 0, medo: 0, agitacao: 0, retraimento: 0, postura: "neutra", olhar: "direto", respiracao: 14 };
}

export function suportada() {
  try {
    const c = document.createElement("canvas");
    return Boolean(window.WebGLRenderingContext && (c.getContext("webgl2") || c.getContext("webgl")));
  } catch {
    return false;
  }
}

// Celular e máquina fraca pagam o preço do 3D em bateria e calor. Menos pixels e
// nenhuma sombra projetada — a sala continua legível, e a consulta não engasga.
function modesta() {
  const memoria = navigator.deviceMemory || 4;
  return window.innerWidth < 900 || memoria <= 4 || (navigator.hardwareConcurrency || 4) <= 4;
}

/* ---------------------------------------------------------------- materiais */
const COR = {
  parede: 0xe8e2d9,
  paredeFundo: 0xdfd7cb,
  piso: 0x9c7b5a,
  janela: 0xfff6e2,
  pele: 0xd9a882,
  cabelo: 0x3a2c26,
  roupaMed: 0x6f8fb0,
  roupaPsi: 0x8d7fa8,
  movel: 0x8a6a4d,
  estofado: 0xb9a996,
  metal: 0xb9c0c7,
};

function fosco(cor, opcoes = {}) {
  return new THREE.MeshStandardMaterial({ color: cor, roughness: 0.85, metalness: 0.02, ...opcoes });
}

function malha(geometria, material, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(geometria, material);
  m.position.set(x, y, z);
  return m;
}

/* -------------------------------------------------------------------- sala */
function montarSala(categoria) {
  const grupo = new THREE.Group();
  const clinica = categoria === "medicina" || categoria === "enfermagem" || categoria === "odontologia";

  const piso = malha(new THREE.PlaneGeometry(9, 9), fosco(COR.piso, { roughness: 0.95 }), 0, 0, 0);
  piso.rotation.x = -Math.PI / 2;
  piso.receiveShadow = true;
  grupo.add(piso);

  const fundo = malha(new THREE.PlaneGeometry(9, 3.4), fosco(COR.paredeFundo), 0, 1.7, -2.6);
  fundo.receiveShadow = true;
  grupo.add(fundo);

  const lateral = malha(new THREE.PlaneGeometry(6, 3.4), fosco(COR.parede), -3.2, 1.7, 0);
  lateral.rotation.y = Math.PI / 2;
  grupo.add(lateral);

  // A janela é o que faz o ambiente parecer um LUGAR, e não um cenário: é dela que
  // vem a direção da luz, a sombra suave e a hora do dia.
  const vidro = malha(
    new THREE.PlaneGeometry(1.8, 1.5),
    new THREE.MeshBasicMaterial({ color: COR.janela }),
    -3.18,
    1.75,
    -0.4
  );
  vidro.rotation.y = Math.PI / 2;
  grupo.add(vidro);
  const caixilho = malha(
    new THREE.BoxGeometry(0.06, 1.62, 1.92),
    fosco(0xffffff, { roughness: 0.6 }),
    -3.21,
    1.75,
    -0.4
  );
  grupo.add(caixilho);

  // Mobília por categoria: consultório clínico com maca e biombo; sala de escuta
  // com poltrona, tapete e abajur. O caso já declara a categoria.
  if (clinica) {
    const maca = new THREE.Group();
    maca.add(malha(new THREE.BoxGeometry(1.9, 0.12, 0.68), fosco(0xdfe6ea), 0, 0.62, 0));
    maca.add(malha(new THREE.BoxGeometry(1.8, 0.5, 0.6), fosco(0x51606b), 0, 0.34, 0));
    maca.position.set(2.1, 0, -1.5);
    maca.rotation.y = -0.35;
    grupo.add(maca);

    const biombo = malha(new THREE.BoxGeometry(1.3, 1.7, 0.05), fosco(0xcfd6d2), 1.5, 0.85, -2.45);
    grupo.add(biombo);
  } else {
    const tapete = malha(new THREE.CircleGeometry(1.7, 32), fosco(0xa8968a, { roughness: 1 }), 0.2, 0.01, -0.4);
    tapete.rotation.x = -Math.PI / 2;
    grupo.add(tapete);

    const abajur = new THREE.Group();
    abajur.add(malha(new THREE.CylinderGeometry(0.03, 0.03, 1.1), fosco(0x6b6b6b), 0, 0.55, 0));
    abajur.add(malha(new THREE.CylinderGeometry(0.22, 0.3, 0.3, 20), fosco(0xf2e3c8, { emissive: 0x3a2f1c }), 0, 1.2, 0));
    abajur.position.set(-1.9, 0, -1.9);
    grupo.add(abajur);
  }

  // Planta: um objeto vivo no canto muda a leitura da sala inteira.
  const planta = new THREE.Group();
  planta.add(malha(new THREE.CylinderGeometry(0.22, 0.28, 0.4, 16), fosco(0xa8674a), 0, 0.2, 0));
  for (let i = 0; i < 7; i++) {
    const folha = malha(new THREE.SphereGeometry(0.22, 10, 8), fosco(0x4a7a4a));
    folha.scale.set(1, 1.5, 0.4);
    folha.position.set(Math.cos((i / 7) * Math.PI * 2) * 0.18, 0.62 + (i % 3) * 0.14, Math.sin((i / 7) * Math.PI * 2) * 0.18);
    folha.rotation.z = Math.cos(i) * 0.5;
    planta.add(folha);
  }
  planta.position.set(2.4, 0, -2.2);
  grupo.add(planta);

  // Mesa em primeiro plano, na altura de quem atende: é o que dá a sensação de
  // estar sentado à frente da pessoa, e não flutuando na sala.
  const mesa = malha(new THREE.BoxGeometry(2.6, 0.08, 0.9), fosco(COR.movel), 0, 0.74, 1.15);
  grupo.add(mesa);

  return grupo;
}

/* --------------------------------------------------------------- paciente */
function montarPaciente(categoria, ident) {
  const g = new THREE.Group();
  const roupa = fosco(categoria === "medicina" ? COR.roupaMed : COR.roupaPsi);
  const pele = fosco(COR.pele, { roughness: 0.72 });
  const feminino = /^f/i.test(String(ident.sexo || ""));

  // Cadeira — o paciente está SENTADO. De pé, ele viraria uma estátua no meio da
  // sala; sentado, ele está numa consulta.
  const cadeira = new THREE.Group();
  cadeira.add(malha(new THREE.BoxGeometry(0.56, 0.09, 0.52), fosco(COR.estofado), 0, 0.44, 0));
  cadeira.add(malha(new THREE.BoxGeometry(0.56, 0.62, 0.08), fosco(COR.estofado), 0, 0.78, -0.24));
  for (const [x, z] of [[-0.22, -0.2], [0.22, -0.2], [-0.22, 0.2], [0.22, 0.2]]) {
    cadeira.add(malha(new THREE.CylinderGeometry(0.025, 0.025, 0.44), fosco(0x4a4a4a), x, 0.22, z));
  }
  g.add(cadeira);

  const corpo = new THREE.Group();
  corpo.position.y = 0.49;

  const tronco = malha(new THREE.CapsuleGeometry(0.19, 0.3, 6, 14), roupa, 0, 0.3, 0);
  tronco.scale.set(1, 1, 0.72);
  tronco.castShadow = true;
  corpo.add(tronco);

  const ombros = malha(new THREE.CapsuleGeometry(0.1, 0.34, 6, 12), roupa, 0, 0.47, 0);
  ombros.rotation.z = Math.PI / 2;
  ombros.scale.set(1, 1, 0.8);
  corpo.add(ombros);

  const pescoco = malha(new THREE.CylinderGeometry(0.055, 0.07, 0.1), pele, 0, 0.56, 0);
  corpo.add(pescoco);

  // Cabeça em grupo próprio: é ela que gira, assente, abaixa e desvia.
  const cabeca = new THREE.Group();
  cabeca.position.set(0, 0.62, 0);

  const cranio = malha(new THREE.SphereGeometry(0.115, 24, 18), pele);
  cranio.scale.set(1, 1.12, 0.95);
  cranio.castShadow = true;
  cabeca.add(cranio);

  const cabelo = malha(new THREE.SphereGeometry(0.121, 20, 16, 0, Math.PI * 2, 0, Math.PI * 0.62), fosco(COR.cabelo, { roughness: 0.95 }));
  cabelo.scale.set(1, 1.1, 1);
  cabelo.position.y = 0.008;
  cabeca.add(cabelo);
  if (feminino) {
    const franja = malha(new THREE.SphereGeometry(0.125, 18, 14, 0, Math.PI * 2, 0, Math.PI * 0.5), fosco(COR.cabelo, { roughness: 0.95 }));
    franja.scale.set(1, 0.85, 1.02);
    franja.position.set(0, -0.01, -0.01);
    cabeca.add(franja);
  }

  const olho = (x) => {
    const grupoOlho = new THREE.Group();
    const globo = malha(new THREE.SphereGeometry(0.023, 14, 12), fosco(0xfdfdfd, { roughness: 0.35 }));
    const iris = malha(new THREE.SphereGeometry(0.011, 12, 10), fosco(0x3d2b21, { roughness: 0.4 }), 0, 0, 0.016);
    grupoOlho.add(globo, iris);
    grupoOlho.position.set(x, 0.015, 0.098);
    return grupoOlho;
  };
  const olhoE = olho(-0.042);
  const olhoD = olho(0.042);
  cabeca.add(olhoE, olhoD);

  const sobrancelha = (x) => {
    const s = malha(new THREE.BoxGeometry(0.045, 0.008, 0.012), fosco(COR.cabelo), x, 0.052, 0.104);
    return s;
  };
  const sobE = sobrancelha(-0.042);
  const sobD = sobrancelha(0.042);
  cabeca.add(sobE, sobD);

  const nariz = malha(new THREE.SphereGeometry(0.017, 12, 10), pele, 0, -0.012, 0.108);
  nariz.scale.set(0.8, 1.1, 1.1);
  cabeca.add(nariz);

  // A boca é uma elipse achatada que ABRE com a energia do áudio. Toda a fala
  // acontece aqui: sem visema, sem fonema, sem promessa que não se cumpre.
  const boca = malha(new THREE.SphereGeometry(0.028, 16, 12), fosco(0x8c4a48, { roughness: 0.6 }), 0, -0.055, 0.095);
  boca.scale.set(1, 0.18, 0.5);
  cabeca.add(boca);

  corpo.add(cabeca);

  // Braços: cada um num grupo com pivô no ombro, para a postura poder fechá-los.
  const braco = (lado) => {
    const b = new THREE.Group();
    const superior = malha(new THREE.CapsuleGeometry(0.052, 0.17, 4, 10), roupa, 0, -0.12, 0);
    const antebraco = malha(new THREE.CapsuleGeometry(0.046, 0.16, 4, 10), pele, 0, -0.3, 0.04);
    antebraco.rotation.x = -0.5;
    const mao = malha(new THREE.SphereGeometry(0.045, 12, 10), pele, 0, -0.4, 0.11);
    mao.scale.set(1, 0.8, 0.7);
    b.add(superior, antebraco, mao);
    b.position.set(lado * 0.2, 0.46, 0);
    b.rotation.z = lado * 0.12;
    return b;
  };
  const bracoE = braco(-1);
  const bracoD = braco(1);
  corpo.add(bracoE, bracoD);

  // Pernas sentadas: coxa para a frente, canela para baixo.
  const perna = (lado) => {
    const p = new THREE.Group();
    const coxa = malha(new THREE.CapsuleGeometry(0.065, 0.2, 4, 10), fosco(0x4b5563), 0, 0, 0.14);
    coxa.rotation.x = Math.PI / 2;
    const canela = malha(new THREE.CapsuleGeometry(0.055, 0.22, 4, 10), fosco(0x4b5563), 0, -0.17, 0.26);
    const pe = malha(new THREE.BoxGeometry(0.1, 0.05, 0.2), fosco(0x2f3338), 0, -0.3, 0.33);
    p.add(coxa, canela, pe);
    p.position.set(lado * 0.09, 0.02, 0);
    return p;
  };
  corpo.add(perna(-1), perna(1));

  g.add(corpo);
  g.position.set(0, 0, -0.55);

  return { grupo: g, corpo, tronco, cabeca, olhoE, olhoD, sobE, sobD, boca, bracoE, bracoD };
}

/* ---------------------------------------------------- postura e instrumentos */
// A postura é aplicada UMA vez, na abertura, e depois só oscila. Quem chega com
// dor no peito não passa a consulta inteira mudando de corpo — o que muda é o
// quanto ela se abre, e isso é assunto da conversa, não da animação.
function aplicarPostura(p, e) {
  const inclina = e.dor * 0.22 + e.tensao * 0.06;
  p.corpo.rotation.x = inclina;
  p.corpo.position.z = inclina * 0.12;

  p.cabeca.rotation.x = -inclina * 0.5 + e.tristeza * 0.18 + e.retraimento * 0.1;
  p.corpo.position.y = 0.49 - e.retraimento * 0.02;

  // Ombros sobem com a tensão; braços se fecham com o retraimento; a mão vai ao
  // peito quando dói. Três gestos, cada um lido de longe.
  const fecha = e.retraimento * 0.5 + e.medo * 0.25;
  p.bracoE.rotation.z = -0.12 - fecha * 0.5;
  p.bracoD.rotation.z = 0.12 + fecha * 0.5;
  p.bracoE.rotation.x = -fecha * 0.6;
  p.bracoD.rotation.x = -fecha * 0.6;

  if (e.dor >= 0.6) {
    p.bracoD.rotation.x = -1.15;
    p.bracoD.rotation.z = 0.62;
  }

  // Sobrancelhas: tensão as junta e levanta por dentro; tristeza as deixa cair.
  const tensa = e.tensao + e.medo * 0.5;
  p.sobE.rotation.z = -tensa * 0.28 + e.tristeza * 0.2;
  p.sobD.rotation.z = tensa * 0.28 - e.tristeza * 0.2;
  p.sobE.position.y = p.sobD.position.y = 0.052 - e.tristeza * 0.006 + tensa * 0.004;

  p.boca.scale.z = 0.5 - e.tristeza * 0.08;
  p.boca.position.y = -0.055 - e.tristeza * 0.004;
}

function montarInstrumentos3D(disponiveis) {
  const grupo = new THREE.Group();
  instrumentos = [];

  // Só vira objeto o que o CASO oferece: uma sala cheia de instrumentos que não
  // fazem nada é pior que uma sala vazia — ensina o aluno a não clicar.
  const catalogo = [
    { chaves: ["press", "pa_", "pressao"], nome: "Pressão arterial", construir: () => {
      const g = new THREE.Group();
      g.add(malha(new THREE.BoxGeometry(0.17, 0.1, 0.11), fosco(0x2f4858), 0, 0.05, 0));
      g.add(malha(new THREE.CylinderGeometry(0.035, 0.035, 0.012, 16), fosco(0xdfe6ea), 0, 0.105, 0.01));
      return g;
    } },
    { chaves: ["ausculta", "cardiac", "pulmon", "estetos", "torax"], nome: "Estetoscópio", construir: () => {
      const g = new THREE.Group();
      g.add(malha(new THREE.TorusGeometry(0.09, 0.008, 8, 24, Math.PI), fosco(COR.metal, { metalness: 0.5, roughness: 0.35 }), 0, 0.09, 0));
      g.add(malha(new THREE.CylinderGeometry(0.032, 0.032, 0.014, 16), fosco(COR.metal, { metalness: 0.6, roughness: 0.3 }), 0.07, 0.02, 0.02));
      return g;
    } },
    { chaves: ["temperatura", "tax", "termom", "febre"], nome: "Termômetro", construir: () => {
      const g = new THREE.Group();
      const t = malha(new THREE.CylinderGeometry(0.008, 0.008, 0.14, 10), fosco(0xf5f5f5), 0, 0.02, 0);
      t.rotation.z = Math.PI / 2;
      g.add(t);
      return g;
    } },
    { chaves: ["satur", "oximet", "spo2"], nome: "Oxímetro", construir: () => {
      const g = new THREE.Group();
      g.add(malha(new THREE.BoxGeometry(0.06, 0.04, 0.08), fosco(0x36405a), 0, 0.02, 0));
      return g;
    } },
  ];

  const posicoes = [[-0.42, 0.78, 0.95], [-0.15, 0.78, 1.0], [0.15, 0.78, 1.0], [0.42, 0.78, 0.95]];
  let i = 0;
  for (const item of catalogo) {
    const achado = (disponiveis || []).find((inst) =>
      item.chaves.some((c) => String(inst.chave || "").toLowerCase().includes(c))
    );
    if (!achado) continue;
    const objeto = item.construir();
    objeto.position.set(...posicoes[i % posicoes.length]);
    objeto.userData = { chave: achado.chave, nome: achado.nome || item.nome };
    objeto.traverse((n) => {
      if (n.isMesh) n.userData.raizInstrumento = objeto;
    });
    grupo.add(objeto);
    instrumentos.push(objeto);
    i += 1;
  }

  return grupo;
}

/* ------------------------------------------------------------------- áudio */
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
  const ctx = garantirContexto();
  if (!ctx) return;
  if (!analisador) {
    analisador = ctx.createAnalyser();
    analisador.fftSize = 512;
    analisador.smoothingTimeConstant = 0.6;
    bufferAudio = new Uint8Array(analisador.fftSize);
  }
  try {
    no.connect(analisador);
  } catch {
    /* já conectado */
  }
}

// A fala do paciente por frase toca num <audio>. Um elemento só aceita UM nó de
// origem na vida — daí o WeakSet. E o nó precisa seguir para a saída, senão ligar
// o lip-sync deixaria o paciente mudo.
export function ouvirElemento(el) {
  const ctx = garantirContexto();
  if (!ctx || !el) return;
  // Só desvia o áudio para o WebAudio com o contexto JÁ rodando. Um contexto
  // suspenso (nenhum gesto do usuário ainda) engoliria a fala do paciente — e
  // perder a voz para ganhar movimento de boca é um péssimo negócio.
  if (ctx.state !== "running") return;
  try {
    if (!fontes.has(el)) {
      const origem = ctx.createMediaElementSource(el);
      fontes.add(el);
      el.__origemPV = origem;
      origem.connect(ctx.destination);
    }
    if (el.__origemPV) ligarAnalisador(el.__origemPV);
  } catch {
    /* navegador sem WebAudio para este elemento: a sala segue, sem lip-sync */
  }
}

// A conversa ao vivo chega como MediaStream. Aqui o nó NÃO vai para a saída: quem
// toca o áudio é o elemento do WebRTC, e duplicar viraria eco.
export function ouvirStream(stream) {
  const ctx = garantirContexto();
  if (!ctx || !stream) return;
  try {
    ligarAnalisador(ctx.createMediaStreamSource(stream));
  } catch {
    /* segue sem lip-sync */
  }
}

/* ---- A matemática do movimento, separada do desenho -----------------------
   Está aqui fora, sem nada de WebGL, porque animação errada não dá erro: dá um
   boneco esquisito, que ninguém consegue depurar olhando. Assim dá para provar em
   teste que a respiração acelera com a dor, que a boca fecha mais devagar do que
   abre e que quem está retraído olha para baixo. */

// Escala do tronco no ciclo respiratório. `rpm` vem do caso.
export function respiracaoEm(t, rpm, dor = 0, tensao = 0) {
  const ciclo = Math.sin((t * (rpm || 14) * Math.PI * 2) / 60);
  const amplitude = 0.012 + dor * 0.012 + tensao * 0.006;
  return 1 + ciclo * amplitude;
}

// A boca abre depressa e fecha devagar: o contrário parece dublagem ruim.
export function proximaAbertura(atual, energia, dt) {
  const taxa = energia > atual ? 22 : 9;
  return atual + (energia - atual) * Math.min(1, Math.max(0, dt) * taxa);
}

// Para onde o olhar vai. `sorteio` entra como parâmetro para o teste poder fixá-lo.
export function alvoDeOlhar(exp, sorteio = Math.random) {
  const VIES = { baixo: -0.5, evasivo: -0.25, vigilante: 0.1, movel: 0, direto: 0 };
  const vies = VIES[exp && exp.olhar] ?? 0;
  const alcance = (exp && exp.olhar) === "direto" ? 0.12 : 0.3;
  return {
    x: (sorteio() - 0.5) * alcance * 2,
    y: vies + (sorteio() - 0.5) * alcance,
  };
}

// Intervalo até a próxima piscada: tensão pisca mais.
export function intervaloDePiscar(tensao, sorteio = Math.random) {
  return Math.max(0.6, 2.2 + sorteio() * 4 - (tensao || 0) * 1.2);
}

function energiaDaVoz() {
  if (!analisador || !bufferAudio) return 0;
  analisador.getByteTimeDomainData(bufferAudio);
  let soma = 0;
  for (let i = 0; i < bufferAudio.length; i++) {
    const v = (bufferAudio[i] - 128) / 128;
    soma += v * v;
  }
  const rms = Math.sqrt(soma / bufferAudio.length);
  // A fala humana normalizada vive numa faixa estreita de RMS; esticar essa faixa
  // é o que separa uma boca que treme de uma boca que fala.
  return Math.min(1, Math.max(0, (rms - 0.012) * 9));
}

/* ------------------------------------------------------------------- laço */
function animar() {
  quadro = requestAnimationFrame(animar);
  if (pausado || document.hidden) return;

  // ATENÇÃO à ordem: `getElapsedTime()` chama `getDelta()` por dentro. Pedindo o
  // tempo primeiro, o delta seguinte vinha ~0 — e tudo que depende dele (piscar,
  // olhar, o fechamento da boca) ficava congelado, com só a respiração se mexendo.
  const dt = Math.min(0.05, relogio.getDelta());
  const t = relogio.elapsedTime;
  const p = paciente;
  if (!p) return;

  if (!semMovimento) {
    // Respiração: a frequência vem do caso (dor e ansiedade aceleram), a amplitude
    // também. É o sinal vital que o aluno vê antes de medir qualquer coisa.
    const escala = respiracaoEm(t, expressao.respiracao, expressao.dor, expressao.tensao);
    const desvio = escala - 1;
    p.tronco.scale.set(escala, 1 + desvio * 0.5, 0.72 + desvio);
    p.corpo.position.y = 0.49 - expressao.retraimento * 0.02 + desvio * 0.3;

    // Piscar: mais frequente sob tensão. Sem isso o rosto morre entre as falas, e
    // um avatar morto é pior que nenhum avatar.
    piscar.proximo -= dt;
    if (piscar.proximo <= 0) {
      piscar.fechado = 0.13;
      piscar.proximo = intervaloDePiscar(expressao.tensao);
    }
    if (piscar.fechado > 0) {
      piscar.fechado -= dt;
      const f = Math.max(0.05, 1 - piscar.fechado / 0.07);
      p.olhoE.scale.y = p.olhoD.scale.y = Math.min(1, f);
    } else {
      p.olhoE.scale.y = p.olhoD.scale.y = 1;
    }

    // Olhar: alvo que troca de tempos em tempos, enviesado pelo caso. Quem está
    // retraído olha para o chão; quem está vigilante varre a sala.
    olhar.proximo -= dt;
    if (olhar.proximo <= 0) {
      const alvo = alvoDeOlhar(expressao);
      olhar.alvoX = alvo.x;
      olhar.alvoY = alvo.y;
      olhar.proximo = 1.4 + Math.random() * 3;
      // O silêncio pesa: sem ninguém perguntando nada, ela se mexe e espera. O
      // incômodo da pausa é parte do que a estação treina.
      if (!ouvindoAluno && performance.now() - ultimaInteracao > 9000) {
        olhar.alvoX += (Math.random() - 0.5) * 0.5;
        olhar.proximo = 0.9 + Math.random() * 1.6;
      }
    }
    olhar.x += (olhar.alvoX - olhar.x) * Math.min(1, dt * 3);
    olhar.y += (olhar.alvoY - olhar.y) * Math.min(1, dt * 3);

    const deriva = Math.sin(t * 0.7) * 0.02 + Math.sin(t * 1.9) * 0.01;
    p.cabeca.rotation.y = olhar.x * 0.5 + deriva;
    p.cabeca.rotation.x =
      -(expressao.dor * 0.11) + expressao.tristeza * 0.18 + expressao.retraimento * 0.1 + olhar.y * 0.22;
    for (const o of [p.olhoE, p.olhoD]) {
      o.rotation.y = olhar.x * 0.6;
      o.rotation.x = olhar.y * 0.4;
    }

    // Quando o aluno fala, ela ergue um pouco o rosto e presta atenção. É a
    // diferença entre uma pessoa ouvindo e um boneco esperando.
    if (ouvindoAluno) p.cabeca.rotation.x -= 0.05;
  }

  // Lip-sync: energia → abertura, com ataque rápido e queda macia. Boca que fecha
  // devagar demais parece dublagem; rápida demais, gagueira.
  alvoBoca = energiaDaVoz();
  aberturaBoca = proximaAbertura(aberturaBoca, alvoBoca, dt);
  const abre = semMovimento ? 0 : aberturaBoca;
  p.boca.scale.y = 0.18 + abre * 0.85;
  p.boca.scale.x = 1 - abre * 0.12;
  p.boca.position.z = 0.095 - abre * 0.004;
  if (abre > 0.05) p.cabeca.rotation.x += abre * 0.012 * Math.sin(t * 9);

  renderizador.render(cena, camera);
}

/* ------------------------------------------------------------------ ciclo */
function dimensionar() {
  if (!renderizador || !raiz) return;
  const l = Math.max(1, raiz.clientWidth);
  const a = Math.max(1, raiz.clientHeight);
  renderizador.setSize(l, a, false);
  camera.aspect = l / a;
  camera.updateProjectionMatrix();
}

export async function abrir({ container, categoria, paciente: ident, expressao: exp, instrumentos: lista, aoInstrumento }) {
  if (cena) return true;
  if (!suportada()) return false;

  raiz = container;
  expressao = { ...expressaoNeutra(), ...(exp || {}) };
  aoClicarInstrumento = aoInstrumento || (() => {});
  semMovimento = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const mod = await import("/vendor/three.module.min.js");
  THREE = mod;

  cena = new THREE.Scene();
  cena.background = new THREE.Color(0xd8d2c8);
  cena.fog = new THREE.Fog(0xd8d2c8, 6, 14);

  // Enquadramento de CONSULTA, não de sala: a pessoa ocupa a cena, o rosto fica no
  // terço superior e o resto é contexto. Câmera na altura dos olhos de quem está
  // sentado atendendo, a pouco mais de um metro — a distância de uma conversa.
  camera = new THREE.PerspectiveCamera(34, 1, 0.1, 40);
  camera.position.set(0.06, 1.17, 0.62);
  camera.lookAt(0, 1.03, -0.55);

  const leve = modesta();
  renderizador = new THREE.WebGLRenderer({ antialias: !leve, alpha: false, powerPreference: "high-performance" });
  renderizador.setPixelRatio(Math.min(window.devicePixelRatio || 1, leve ? 1.25 : 1.75));
  renderizador.outputColorSpace = THREE.SRGBColorSpace;
  renderizador.toneMapping = THREE.ACESFilmicToneMapping;
  renderizador.toneMappingExposure = 1.05;
  renderizador.shadowMap.enabled = !leve;
  renderizador.shadowMap.type = THREE.PCFSoftShadowMap;
  raiz.appendChild(renderizador.domElement);
  renderizador.domElement.setAttribute("aria-hidden", "true");

  cena.add(new THREE.HemisphereLight(0xfff3e0, 0x6b5b4a, 1.15));
  const solDaJanela = new THREE.DirectionalLight(0xffe9c8, 1.9);
  solDaJanela.position.set(-3.4, 2.6, 0.6);
  if (!leve) {
    solDaJanela.castShadow = true;
    solDaJanela.shadow.mapSize.set(1024, 1024);
    solDaJanela.shadow.camera.near = 0.5;
    solDaJanela.shadow.camera.far = 12;
    solDaJanela.shadow.bias = -0.0012;
  }
  cena.add(solDaJanela);
  // Preenchimento fraco pela frente, para o rosto não virar silhueta contra a luz.
  const preenchimento = new THREE.DirectionalLight(0xffffff, 0.35);
  preenchimento.position.set(0.8, 1.6, 2.4);
  cena.add(preenchimento);

  cena.add(montarSala(categoria));
  paciente = montarPaciente(categoria, ident || {});
  aplicarPostura(paciente, expressao);
  cena.add(paciente.grupo);
  cena.add(montarInstrumentos3D(lista));

  relogio = new THREE.Clock();
  dimensionar();
  window.addEventListener("resize", dimensionar);
  document.addEventListener("visibilitychange", aoVoltarParaAba);
  renderizador.domElement.addEventListener("pointerdown", aoApontar);
  animar();
  return true;
}

const raio = { objeto: null, ponto: null };
function aoApontar(ev) {
  if (!instrumentos.length || !THREE) return;
  if (!raio.objeto) {
    raio.objeto = new THREE.Raycaster();
    raio.ponto = new THREE.Vector2();
  }
  const caixa = renderizador.domElement.getBoundingClientRect();
  raio.ponto.x = ((ev.clientX - caixa.left) / caixa.width) * 2 - 1;
  raio.ponto.y = -((ev.clientY - caixa.top) / caixa.height) * 2 + 1;
  raio.objeto.setFromCamera(raio.ponto, camera);
  const alvos = raio.objeto.intersectObjects(instrumentos, true);
  if (!alvos.length) return;
  const dono = alvos[0].object.userData.raizInstrumento || alvos[0].object;
  if (dono.userData && dono.userData.chave) {
    marcarInteracao();
    aoClicarInstrumento(dono.userData.chave, dono.userData.nome);
  }
}

export function marcarInteracao() {
  ultimaInteracao = performance.now();
}

// Desenha UM quadro, na hora. O laço não roda com a aba escondida (bateria não é
// detalhe num celular em sala de aula), e quando o aluno volta para a aba o
// primeiro quadro precisa sair antes do próximo `requestAnimationFrame` — senão
// ele vê por um instante a imagem congelada de minutos atrás.
export function renderizarQuadro() {
  if (renderizador && cena && camera) renderizador.render(cena, camera);
}

function aoVoltarParaAba() {
  if (!document.hidden) renderizarQuadro();
}

export function ouvindo(valor) {
  ouvindoAluno = Boolean(valor);
  if (valor) marcarInteracao();
}

export function pausar(valor) {
  pausado = Boolean(valor);
}

export function aberta() {
  return Boolean(cena);
}

export function fechar() {
  if (quadro) cancelAnimationFrame(quadro);
  quadro = null;
  window.removeEventListener("resize", dimensionar);
  document.removeEventListener("visibilitychange", aoVoltarParaAba);
  if (renderizador) {
    renderizador.domElement.removeEventListener("pointerdown", aoApontar);
    // Sem o dispose explícito, cada abrir/fechar deixaria uma cena inteira de
    // geometria e textura na GPU — três consultas e o celular trava.
    cena.traverse((n) => {
      if (n.isMesh) {
        n.geometry.dispose();
        if (Array.isArray(n.material)) n.material.forEach((m) => m.dispose());
        else n.material.dispose();
      }
    });
    renderizador.dispose();
    if (renderizador.domElement.parentNode) renderizador.domElement.remove();
  }
  cena = camera = renderizador = paciente = relogio = null;
  instrumentos = [];
  analisador = null;
  aberturaBoca = alvoBoca = 0;
}
