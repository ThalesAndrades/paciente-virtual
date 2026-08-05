/* Conversa por voz em tempo real — a camada WebRTC da página.
 *
 * Mora fora do index.html porque é a única parte da página que fala com um
 * terceiro (o provedor de voz) e a única com máquina de estados própria: conectar,
 * ouvir, ser interrompido, renovar minutos, cair de pé.
 *
 * O que este arquivo NÃO faz, de propósito:
 *   - não sabe nada do caso (o personagem vive nas instruções cunhadas no servidor);
 *   - não decide o que é sensível (quem decide é /api/consultas/:id/ficha);
 *   - não exibe nada (devolve eventos; quem desenha é a página).
 *
 * O áudio vai direto do navegador ao provedor. O servidor entra três vezes: cunha o
 * token, responde ao portão clínico e recebe a transcrição.
 */
(function () {
  "use strict";

  const EVENTOS = "oai-events";
  // Aviso antes do fim do bloco de minutos: o aluno precisa de tempo para fechar a
  // pergunta em vez de ser cortado no meio de uma frase.
  const AVISO_ANTES_MS = 30 * 1000;
  // Espera do casamento pergunta↔resposta antes de mandar o turno assim mesmo.
  const FLUSH_MS = 4000;

  let pc = null;
  let dc = null;
  let fluxo = null;
  let audio = null;
  let consultaId = null;
  let aoEvento = () => {};
  let estado = "desligado";
  let relogios = [];
  let pendente = { profissional: "", paciente: "" };
  let flushId = null;
  const atendidas = new Set(); // call_id já respondidos (o provedor pode repetir)

  function emitir(evento) {
    try {
      aoEvento(evento);
    } catch (erro) {
      console.error("[tempo-real] ouvinte falhou", erro);
    }
  }

  function mudarEstado(novo, mensagem) {
    estado = novo;
    emitir({ tipo: "estado", estado: novo, mensagem: mensagem || "" });
  }

  function agendar(fn, ms) {
    const id = setTimeout(fn, ms);
    relogios.push(id);
    return id;
  }

  function limparRelogios() {
    for (const id of relogios) clearTimeout(id);
    relogios = [];
  }

  async function api(caminho, corpo) {
    const r = await fetch(caminho, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(corpo || {}),
    });
    let dados = {};
    try {
      dados = await r.json();
    } catch {
      /* corpo vazio ou não-JSON: o status já diz o que houve */
    }
    return { status: r.status, dados };
  }

  // ---- Transcrição -------------------------------------------------------
  //
  // Junta pergunta e resposta num turno só quando dá, para não gerar duas
  // requisições por fala. Se a resposta demorar, manda o que tem: perder a ordem do
  // transcript é pior que uma requisição a mais.
  function enviarTurno() {
    if (flushId) {
      clearTimeout(flushId);
      flushId = null;
    }
    const turno = pendente;
    pendente = { profissional: "", paciente: "" };
    if (!turno.profissional && !turno.paciente) return;
    if (!consultaId) return;
    api(`/api/consultas/${consultaId}/turno`, turno).catch(() => {
      /* melhor esforço: a consulta não pode cair porque o transcript falhou */
    });
  }

  function acumular(quem, texto) {
    const limpo = String(texto || "").trim();
    if (!limpo) return;
    if (pendente[quem]) {
      // Duas falas seguidas do mesmo lado: fecha o turno anterior antes.
      enviarTurno();
    }
    pendente[quem] = limpo;
    emitir({ tipo: quem, texto: limpo });
    if (pendente.profissional && pendente.paciente) {
      enviarTurno();
      return;
    }
    if (!flushId) flushId = setTimeout(enviarTurno, FLUSH_MS);
  }

  // ---- O portão clínico --------------------------------------------------
  async function responderFicha(callId, argumentos) {
    if (atendidas.has(callId)) return;
    atendidas.add(callId);

    let pergunta = "";
    try {
      pergunta = (JSON.parse(argumentos || "{}") || {}).pergunta || "";
    } catch {
      pergunta = "";
    }

    let saida = {
      instrucao:
        "Não consegui consultar a ficha agora. Desconverse do seu jeito e NÃO invente nada.",
    };
    try {
      const { status, dados } = await api(`/api/consultas/${consultaId}/ficha`, { pergunta });
      if (status === 200 && dados && dados.modelo) {
        saida = dados.modelo;
        // O resultado do exame vai para a TELA e nunca para o modelo: o paciente
        // sentiu o procedimento, mas não sabe ler o laudo.
        for (const item of dados.tela || []) emitir(item);
      }
    } catch {
      /* mantém a saída de falha: o paciente desconversa, nunca inventa o fato */
    }

    enviarEvento({
      type: "conversation.item.create",
      item: { type: "function_call_output", call_id: callId, output: JSON.stringify(saida) },
    });
    enviarEvento({ type: "response.create" });
  }

  function enviarEvento(obj) {
    if (dc && dc.readyState === "open") dc.send(JSON.stringify(obj));
  }

  /* ---- Portão de ruído -----------------------------------------------------
   *
   * A supressão de ruído do navegador e a do provedor trabalham no CONTEÚDO do
   * áudio; nenhuma das duas resolve o problema real de uma sala de aula, que é o
   * microfone ficar aberto o tempo todo mandando fundo — ventilador, cadeira,
   * a conversa da mesa ao lado. O paciente então responde a barulho.
   *
   * Aqui o áudio do microfone passa por um grafo antes de virar a trilha enviada:
   *
   *   microfone → passa-alta 100 Hz → compressor → ganho (portão) → trilha enviada
   *                     ↘ analisador (mede o nível e decide o portão)
   *
   * Abaixo do limiar, o ganho vai a zero: o que sai é silêncio digital, que nem o
   * detector de fala do provedor nem o modelo chegam a ver. Com histerese e uma
   * cauda de ~600 ms, para não cortar o fim das frases nem picotar quem fala baixo.
   */
  const PORTAO = { abre: 0.055, fecha: 0.03, caudaMs: 600 };
  let grafo = null;

  function nivelDoMicrofone() {
    if (!grafo) return 0;
    grafo.analisador.getByteTimeDomainData(grafo.buffer);
    let soma = 0;
    for (let i = 0; i < grafo.buffer.length; i++) {
      const v = (grafo.buffer[i] - 128) / 128;
      soma += v * v;
    }
    return Math.sqrt(soma / grafo.buffer.length);
  }

  function pulsarPortao() {
    if (!grafo) return;
    const nivel = nivelDoMicrofone();
    const agora = performance.now();

    if (nivel > PORTAO.abre) grafo.faladoAte = agora + PORTAO.caudaMs;
    const deveAbrir = nivel > PORTAO.fecha && agora < grafo.faladoAte;

    if (deveAbrir !== grafo.aberto) {
      grafo.aberto = deveAbrir;
      const t = grafo.ctx.currentTime;
      grafo.ganho.gain.cancelScheduledValues(t);
      grafo.ganho.gain.setTargetAtTime(deveAbrir ? 1 : 0, t, deveAbrir ? 0.01 : 0.08);
    }
    // O nível vai para a página desenhar o indicador de voz: sem retorno visual,
    // o aluno não sabe se está sendo ouvido e fala mais alto do que precisa.
    emitir({ tipo: "nivel", valor: nivel, aberto: grafo.aberto });
    grafo.relogio = requestAnimationFrame(pulsarPortao);
  }

  // Devolve a trilha JÁ filtrada. Se o navegador não tiver WebAudio, devolve a
  // original: melhor com ruído do que sem conversa.
  function trilhaFiltrada(entrada) {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return entrada.getAudioTracks();
    try {
      const ctx = new Ctx();
      const origem = ctx.createMediaStreamSource(entrada);

      const passaAlta = ctx.createBiquadFilter();
      passaAlta.type = "highpass";
      passaAlta.frequency.value = 100; // ronco de ar-condicionado e mesa vive abaixo disso

      const compressor = ctx.createDynamicsCompressor();
      compressor.threshold.value = -30;
      compressor.ratio.value = 3;

      const ganho = ctx.createGain();
      ganho.gain.value = 0; // nasce fechado: nada sai antes de alguém falar

      const analisador = ctx.createAnalyser();
      analisador.fftSize = 1024;
      analisador.smoothingTimeConstant = 0.25;

      const saida = ctx.createMediaStreamDestination();
      origem.connect(passaAlta);
      passaAlta.connect(compressor);
      passaAlta.connect(analisador);
      compressor.connect(ganho);
      ganho.connect(saida);

      grafo = {
        ctx,
        ganho,
        analisador,
        buffer: new Uint8Array(analisador.fftSize),
        aberto: false,
        faladoAte: 0,
        relogio: null,
        saida,
      };
      if (ctx.state === "suspended") ctx.resume().catch(() => {});
      grafo.relogio = requestAnimationFrame(pulsarPortao);
      return saida.stream.getAudioTracks();
    } catch {
      grafo = null;
      return entrada.getAudioTracks();
    }
  }

  function desligarGrafo() {
    if (!grafo) return;
    if (grafo.relogio) cancelAnimationFrame(grafo.relogio);
    try {
      grafo.ctx.close();
    } catch {}
    grafo = null;
  }

  function tratarEvento(bruto) {
    let ev;
    try {
      ev = JSON.parse(bruto);
    } catch {
      return;
    }

    switch (ev.type) {
      // O aluno falou (transcrição do microfone).
      case "conversation.item.input_audio_transcription.completed":
        acumular("profissional", ev.transcript);
        break;

      // O paciente falou (transcrição do áudio gerado).
      case "response.output_audio_transcript.done":
        acumular("paciente", ev.transcript);
        break;

      case "response.function_call_arguments.done":
        if (ev.name === "consultar_ficha") responderFicha(ev.call_id, ev.arguments);
        break;

      // Rede de segurança: em algumas versões a chamada de ferramenta só aparece
      // completa aqui. `atendidas` impede responder duas vezes ao mesmo call_id.
      case "response.done":
        for (const item of (ev.response && ev.response.output) || []) {
          if (item.type === "function_call" && item.name === "consultar_ficha") {
            responderFicha(item.call_id, item.arguments);
          }
        }
        break;

      case "error":
        console.error("[tempo-real] erro do provedor", ev.error);
        break;

      default:
        break;
    }
  }

  // ---- Ciclo de vida -----------------------------------------------------
  async function iniciar(opcoes) {
    if (estado === "ligado" || estado === "conectando") return { ok: true };
    consultaId = opcoes.consultaId;
    aoEvento = opcoes.aoEvento || (() => {});
    atendidas.clear();
    mudarEstado("conectando");

    const { status, dados } = await api(`/api/consultas/${consultaId}/tempo-real`, {});
    if (status !== 200 || !dados.token) {
      parar();
      const motivo = dados.erro || "Não consegui abrir a conversa por voz.";
      mudarEstado("erro", motivo);
      return { ok: false, motivo };
    }

    try {
      fluxo = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          // Voz é mono. Pedir estéreo dobra o áudio enviado sem ganhar nada, e em
          // alguns celulares ativa o segundo microfone, que capta a sala inteira.
          channelCount: 1,
        },
      });
    } catch {
      parar();
      const motivo = "Permita o microfone no navegador para conversar por voz.";
      mudarEstado("erro", motivo);
      return { ok: false, motivo };
    }

    try {
      pc = new RTCPeerConnection();

      audio = document.createElement("audio");
      audio.autoplay = true;
      audio.playsInline = true;
      document.body.appendChild(audio);
      pc.ontrack = (ev) => {
        audio.srcObject = ev.streams[0];
        // `autoplay` não basta no Safari/iOS quando o elemento nasce depois do
        // toque: sem este play() explícito, a consulta abre muda.
        const tocando = audio.play();
        if (tocando && tocando.catch) tocando.catch(() => {});
        // Quem estiver desenhando o paciente precisa da voz para mover a boca. O
        // stream é entregue, não interpretado: esta camada não sabe o que é sala 3D.
        emitir({ tipo: "audio", stream: ev.streams[0] });
      };

      // Envia a trilha FILTRADA pelo portão, não a crua do microfone.
      for (const trilha of trilhaFiltrada(fluxo)) pc.addTrack(trilha, fluxo);

      dc = pc.createDataChannel(EVENTOS);
      dc.onmessage = (ev) => tratarEvento(ev.data);
      dc.onopen = () => mudarEstado("ligado");

      pc.onconnectionstatechange = () => {
        if (!pc) return;
        if (pc.connectionState === "failed" || pc.connectionState === "disconnected") {
          const eraLigado = estado === "ligado";
          parar();
          mudarEstado("erro", eraLigado ? "A conversa por voz caiu." : "Não consegui conectar.");
        }
      };

      const oferta = await pc.createOffer();
      await pc.setLocalDescription(oferta);

      const resposta = await fetch(dados.url, {
        method: "POST",
        headers: { Authorization: `Bearer ${dados.token}`, "Content-Type": "application/sdp" },
        body: oferta.sdp,
      });
      if (!resposta.ok) throw new Error(`SDP HTTP ${resposta.status}`);
      await pc.setRemoteDescription({ type: "answer", sdp: await resposta.text() });
    } catch (erro) {
      console.error("[tempo-real] falha ao conectar", erro);
      parar();
      const motivo = "Não consegui abrir a conversa por voz. Use o microfone de segurar.";
      mudarEstado("erro", motivo);
      return { ok: false, motivo };
    }

    // Fim do bloco concedido. O servidor debitou estes minutos ao cunhar o token;
    // continuar depois disso seria gastar sem orçamento.
    const totalMs = Math.max(1, Number(dados.minutos) || 1) * 60 * 1000;
    if (totalMs > AVISO_ANTES_MS) {
      agendar(() => {
        emitir({ tipo: "aviso", texto: "O tempo desta rodada de voz está acabando." });
      }, totalMs - AVISO_ANTES_MS);
    }
    agendar(() => {
      parar();
      mudarEstado("desligado", "O tempo desta rodada de voz acabou. Toque de novo para continuar.");
    }, totalMs);

    return { ok: true, minutos: dados.minutos };
  }

  function parar() {
    limparRelogios();
    desligarGrafo();
    enviarTurno();
    if (dc) {
      try {
        dc.close();
      } catch {}
      dc = null;
    }
    if (pc) {
      try {
        pc.close();
      } catch {}
      pc = null;
    }
    if (fluxo) {
      for (const trilha of fluxo.getTracks()) trilha.stop();
      fluxo = null;
    }
    if (audio) {
      audio.srcObject = null;
      audio.remove();
      audio = null;
    }
    if (estado !== "desligado") mudarEstado("desligado");
  }

  window.TempoReal = {
    iniciar,
    parar,
    ativo: () => estado === "ligado" || estado === "conectando",
    estado: () => estado,
    // O navegador precisa de WebRTC e de microfone; sem isso o botão nem aparece.
    suportado: () =>
      Boolean(window.RTCPeerConnection && navigator.mediaDevices && navigator.mediaDevices.getUserMedia),
  };
})();
