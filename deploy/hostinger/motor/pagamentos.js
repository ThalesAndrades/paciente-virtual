// Cobrança: Pix pela Woovi e cartão pela Stripe, ambas da THM Tecnologia.
//
// Duas regras governam este arquivo:
//
// 1. QUEM DIZ QUE FOI PAGO É O PROVEDOR, NUNCA O NAVEGADOR. O aluno voltar para a
//    página de sucesso não credita nada — credita o webhook, e mesmo ele é
//    reconferido contra a API antes de valer. Um POST forjado no nosso endpoint não
//    pode virar crédito.
// 2. Todo crédito é IDEMPOTENTE por referência. Provedor reenvia webhook de
//    propósito (é assim que se garante entrega), e reenvio não pode virar dinheiro.
//
// Sem SDK: são duas chamadas HTTP e uma verificação de HMAC. Trazer dois pacotes
// npm para isso custaria mais em superfície de atualização do que economiza.

import crypto from "node:crypto";

import {
  confirmarPagamento,
  definirProvedorId,
  marcarStatus,
  pagamentoPorId,
  pagamentoPorProvedor,
  registrarPagamento,
  salvarAssinatura,
  assinaturaPorProvedorId,
  creditar,
} from "./creditos.js";
import { assinaturaPorId, itemPorId } from "./planos.js";

const WOOVI_BASE = (process.env.WOOVI_BASE_URL || "https://api.woovi.com").replace(/\/+$/, "");
const STRIPE_BASE = "https://api.stripe.com/v1";

const chaveWoovi = () => (process.env.WOOVI_APP_ID || "").trim();
const chaveStripe = () => (process.env.STRIPE_SECRET_KEY || "").trim();
const segredoWebhookStripe = () => (process.env.STRIPE_WEBHOOK_SECRET || "").trim();

export function provedoresDisponiveis() {
  return { pix: Boolean(chaveWoovi()), cartao: Boolean(chaveStripe()) };
}

// Endereço público da aplicação, para onde a Stripe devolve o aluno.
function baseUrl() {
  const bruto = (process.env.PV_URL || process.env.COOLIFY_URL || "").split(",")[0].trim();
  return bruto.replace(/\/+$/, "") || "https://ubtec.sbs";
}

function novoIdPagamento() {
  return `thm_${crypto.randomUUID().replace(/-/g, "").slice(0, 20)}`;
}

/* ── Pix (Woovi) ─────────────────────────────────────────────────────────── */

// Cria a cobrança e devolve o que a tela precisa: o copia-e-cola, a imagem do QR e
// o link. O `correlationID` é o NOSSO id — é por ele que a confirmação encontra o
// pagamento depois, sem depender de o provedor guardar metadado nosso.
export async function cobrarPix({ usuario, item }) {
  const chave = chaveWoovi();
  if (!chave) throw new Error("Pix indisponível: falta WOOVI_APP_ID.");

  const id = novoIdPagamento();
  const resposta = await fetch(`${WOOVI_BASE}/api/v1/charge`, {
    method: "POST",
    headers: { Authorization: chave, "Content-Type": "application/json" },
    body: JSON.stringify({
      correlationID: id,
      value: item.centavos,
      comment: `THM Simulados Inteligentes — ${item.rotulo}`,
      // Expira em 1 hora: Pix parado no app do aluno vira cobrança fantasma na
      // conciliação, e um dia depois ele já esqueceu que gerou.
      expiresIn: 3600,
      customer: {
        name: usuario.nome || usuario.matricula || "Aluno",
        ...(usuario.email && !usuario.email.endsWith(".invalid") ? { email: usuario.email } : {}),
      },
    }),
  });

  const corpo = await resposta.json().catch(() => ({}));
  if (!resposta.ok) {
    throw new Error(`Woovi HTTP ${resposta.status}: ${JSON.stringify(corpo).slice(0, 200)}`);
  }

  const cobranca = corpo.charge || corpo;
  registrarPagamento({
    id,
    usuarioId: usuario.id,
    provedor: "woovi",
    provedorId: cobranca.correlationID || id,
    tipo: item.tipo,
    item: item.id,
    valorCentavos: item.centavos,
    creditos: item.creditos,
    status: "pendente",
    dados: {
      brCode: cobranca.brCode || cobranca.paymentLinkUrl || "",
      qrCode: cobranca.qrCodeImage || "",
      link: cobranca.paymentLinkUrl || "",
    },
  });

  return {
    id,
    brCode: cobranca.brCode || "",
    qrCode: cobranca.qrCodeImage || "",
    link: cobranca.paymentLinkUrl || "",
    creditos: item.creditos,
    valor_centavos: item.centavos,
  };
}

// Pergunta ao provedor se aquela cobrança foi paga. É o coração da regra 1: tanto o
// webhook quanto o botão "já paguei" da tela passam por aqui, e nenhum dos dois é
// acreditado sem esta resposta.
export async function conferirPix(id) {
  const chave = chaveWoovi();
  const pago = pagamentoPorId(id);
  if (!pago) return { encontrado: false };
  if (pago.status === "pago") return { encontrado: true, pago: true, saldo: null };
  if (!chave) return { encontrado: true, pago: false };

  const resposta = await fetch(`${WOOVI_BASE}/api/v1/charge/${encodeURIComponent(id)}`, {
    headers: { Authorization: chave },
  });
  if (!resposta.ok) return { encontrado: true, pago: false, erro: `HTTP ${resposta.status}` };

  const corpo = await resposta.json().catch(() => ({}));
  const status = String((corpo.charge && corpo.charge.status) || corpo.status || "").toUpperCase();

  if (status === "COMPLETED" || status === "CONFIRMED") {
    const resultado = confirmarPagamento(id);
    return { encontrado: true, pago: true, saldo: resultado.saldo, item: pago.item };
  }
  if (status === "EXPIRED") marcarStatus(id, "expirado");
  return { encontrado: true, pago: false, status };
}

/* ── Cartão e assinatura (Stripe) ────────────────────────────────────────── */

function formulario(objeto, prefixo = "", saida = new URLSearchParams()) {
  for (const [chave, valor] of Object.entries(objeto)) {
    if (valor === undefined || valor === null) continue;
    const nome = prefixo ? `${prefixo}[${chave}]` : chave;
    if (typeof valor === "object") formulario(valor, nome, saida);
    else saida.append(nome, String(valor));
  }
  return saida;
}

async function stripe(caminho, corpo) {
  const chave = chaveStripe();
  if (!chave) throw new Error("Cartão indisponível: falta STRIPE_SECRET_KEY.");
  const resposta = await fetch(`${STRIPE_BASE}${caminho}`, {
    method: corpo ? "POST" : "GET",
    headers: {
      Authorization: `Bearer ${chave}`,
      ...(corpo ? { "Content-Type": "application/x-www-form-urlencoded" } : {}),
    },
    ...(corpo ? { body: formulario(corpo).toString() } : {}),
  });
  const dados = await resposta.json().catch(() => ({}));
  if (!resposta.ok) {
    const detalhe = (dados.error && dados.error.message) || JSON.stringify(dados).slice(0, 200);
    throw new Error(`Stripe HTTP ${resposta.status}: ${detalhe}`);
  }
  return dados;
}

// Abre a página de pagamento da Stripe. Pacote vira cobrança única; plano vira
// assinatura mensal. Os preços são declarados na hora (`price_data`) em vez de
// exigirem produtos pré-cadastrados no painel: o catálogo tem uma fonte só, que é
// `planos.js`, e mudar um valor não pede ir configurar em dois lugares.
export async function cobrarCartao({ usuario, item }) {
  const id = novoIdPagamento();
  const recorrente = item.tipo === "assinatura";

  const sessao = await stripe("/checkout/sessions", {
    mode: recorrente ? "subscription" : "payment",
    success_url: `${baseUrl()}/?pagamento=ok&id=${id}`,
    cancel_url: `${baseUrl()}/?pagamento=cancelado`,
    client_reference_id: id,
    locale: "pt-BR",
    metadata: { pagamento: id, usuario: usuario.id, item: item.id },
    ...(recorrente
      ? { subscription_data: { metadata: { pagamento: id, usuario: usuario.id, item: item.id } } }
      : { payment_intent_data: { metadata: { pagamento: id, usuario: usuario.id } } }),
    line_items: {
      0: {
        quantity: 1,
        price_data: {
          currency: "brl",
          unit_amount: item.centavos,
          ...(recorrente ? { recurring: { interval: "month" } } : {}),
          product_data: { name: `THM Simulados Inteligentes — ${item.rotulo}` },
        },
      },
    },
  });

  registrarPagamento({
    id,
    usuarioId: usuario.id,
    provedor: "stripe",
    provedorId: sessao.id,
    tipo: item.tipo,
    item: item.id,
    valorCentavos: item.centavos,
    creditos: item.creditos,
    status: "pendente",
    dados: { url: sessao.url },
  });

  return { id, url: sessao.url, creditos: item.creditos, valor_centavos: item.centavos };
}

// Confere na API se a sessão foi mesmo paga. Mesma regra do Pix: a volta do
// navegador não credita nada sozinha.
export async function conferirCartao(id) {
  const pago = pagamentoPorId(id);
  if (!pago) return { encontrado: false };
  if (pago.status === "pago") return { encontrado: true, pago: true };
  if (!pago.provedor_id || !chaveStripe()) return { encontrado: true, pago: false };

  const sessao = await stripe(`/checkout/sessions/${encodeURIComponent(pago.provedor_id)}`);
  if (sessao.payment_status === "paid" || sessao.status === "complete") {
    const resultado = confirmarPagamento(id);
    if (pago.tipo === "assinatura" && sessao.subscription) {
      salvarAssinatura({
        usuarioId: pago.usuario_id,
        plano: pago.item,
        provedor: "stripe",
        provedorId: sessao.subscription,
        status: "ativa",
        periodoFim: null,
      });
    }
    return { encontrado: true, pago: true, saldo: resultado.saldo };
  }
  return { encontrado: true, pago: false, status: sessao.payment_status || sessao.status };
}

// Verificação da assinatura do webhook da Stripe, como o SDK faz: HMAC-SHA256 de
// `timestamp.corpo` com o segredo do endpoint. Sem isto, qualquer um que descubra a
// URL credita a própria conta com um `curl`.
export function verificarAssinaturaStripe(corpoBruto, cabecalho) {
  const segredo = segredoWebhookStripe();
  if (!segredo) return { ok: false, motivo: "sem STRIPE_WEBHOOK_SECRET" };

  const partes = Object.fromEntries(
    String(cabecalho || "")
      .split(",")
      .map((p) => p.split("=").map((x) => x.trim()))
      .filter((p) => p.length === 2)
  );
  const t = partes.t;
  const v1 = partes.v1;
  if (!t || !v1) return { ok: false, motivo: "cabeçalho sem t/v1" };

  // Janela de 5 minutos contra reenvio de um webhook capturado.
  const idade = Math.abs(Date.now() / 1000 - Number(t));
  if (!Number.isFinite(idade) || idade > 300) return { ok: false, motivo: "assinatura fora da janela" };

  const esperado = crypto.createHmac("sha256", segredo).update(`${t}.${corpoBruto}`).digest("hex");
  const a = Buffer.from(esperado, "utf8");
  const b = Buffer.from(String(v1), "utf8");
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return { ok: false, motivo: "assinatura não confere" };
  }
  return { ok: true };
}

// Trata o evento já verificado. Devolve o que aconteceu, para o log — webhook
// silencioso é dívida técnica que só aparece quando alguém reclama que pagou.
export async function tratarEventoStripe(evento) {
  const tipo = evento && evento.type;
  const objeto = (evento && evento.data && evento.data.object) || {};

  if (tipo === "checkout.session.completed") {
    const id = objeto.client_reference_id || (objeto.metadata && objeto.metadata.pagamento);
    if (!id) return { tratado: false, motivo: "sessão sem referência nossa" };
    // Reconfere na API antes de creditar, mesmo com a assinatura válida.
    const resultado = await conferirCartao(id);
    return { tratado: true, tipo, pago: Boolean(resultado.pago) };
  }

  // Renovação mensal: cada fatura paga vira uma leva de créditos, com o id da
  // fatura como referência — a mesma fatura nunca credita duas vezes.
  if (tipo === "invoice.paid" || tipo === "invoice.payment_succeeded") {
    const idAssinatura = objeto.subscription || (objeto.parent && objeto.parent.subscription_details && objeto.parent.subscription_details.subscription);
    if (!idAssinatura) return { tratado: false, motivo: "fatura sem assinatura" };
    const assinatura = assinaturaPorProvedorId(idAssinatura);
    if (!assinatura) return { tratado: false, motivo: "assinatura desconhecida" };
    const plano = assinaturaPorId(assinatura.plano);
    if (!plano) return { tratado: false, motivo: "plano fora do catálogo" };
    const lancamento = creditar(assinatura.usuario_id, plano.creditos, "assinatura", objeto.id);
    salvarAssinatura({
      usuarioId: assinatura.usuario_id,
      plano: assinatura.plano,
      provedor: "stripe",
      provedorId: idAssinatura,
      status: "ativa",
      periodoFim: objeto.period_end ? new Date(objeto.period_end * 1000).toISOString() : null,
    });
    return { tratado: true, tipo, creditados: lancamento.repetido ? 0 : plano.creditos };
  }

  if (tipo === "customer.subscription.deleted" || tipo === "customer.subscription.paused") {
    const assinatura = assinaturaPorProvedorId(objeto.id);
    if (assinatura) {
      salvarAssinatura({
        usuarioId: assinatura.usuario_id,
        plano: assinatura.plano,
        provedor: "stripe",
        provedorId: objeto.id,
        // Cancelar NÃO tira crédito já entregue: o aluno pagou por ele. Só para de
        // renovar.
        status: "cancelada",
        periodoFim: assinatura.periodo_fim,
      });
    }
    return { tratado: true, tipo };
  }

  return { tratado: false, motivo: `evento ignorado: ${tipo}` };
}

// Webhook da Woovi: o corpo traz o `correlationID`, e a conferência real acontece
// contra a API. Assim não dependemos do formato de assinatura deles nem de segredo
// combinado — o único caminho para creditar é o provedor confirmar quando
// perguntado.
export async function tratarEventoWoovi(corpo) {
  const cobranca = (corpo && (corpo.charge || corpo.pixQrCode || corpo.pix)) || {};
  const id = cobranca.correlationID || (corpo && corpo.correlationID);
  if (!id) return { tratado: false, motivo: "evento sem correlationID" };
  const resultado = await conferirPix(String(id));
  return { tratado: true, pago: Boolean(resultado.pago) };
}

export { pagamentoPorProvedor, definirProvedorId };
