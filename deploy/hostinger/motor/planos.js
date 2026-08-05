// Catálogo do THM Simulados Inteligentes: o que custa quanto, em créditos e em reais.
//
// Um único arquivo com os números porque preço espalhado é preço que diverge: a
// tela de compra, o débito da consulta e o recibo do pagamento têm que falar da
// mesma tabela, ou o aluno paga por uma coisa e recebe outra.
//
// A ancoragem é o CUSTO REAL de cada uso (API de linguagem, voz e transcrição),
// medido em agosto/2026 com o dólar a ~R$ 5,60:
//
//   consulta por texto (12 turnos + voz por frase + parecer) ....... ~R$ 0,85
//   conversa ao vivo ............................................... ~R$ 0,15/min
//
// Sobre isso a margem cobre a infraestrutura fixa (VPS, domínio, e-mail), o risco
// de um caso longo custar o dobro da média e o trabalho de manter o acervo.

// Preço de venda do crédito: R$ 0,40 no pacote de entrada, caindo até R$ 0,30 no
// maior. É o desconto por volume que faz o aluno comprar o pacote grande em vez de
// recarregar seis vezes — e cada recarga custa uma cobrança Pix a menos para nós.
export const CUSTO = {
  // Uma estação clínica inteira: entrevista, exames, fechamento e parecer.
  consulta: 10,
  // Cobrado por MINUTO CONCEDIDO de conversa ao vivo, em blocos. O servidor não vê
  // o áudio (ele vai direto do navegador ao provedor), então erra para menos: o
  // bloco é debitado inteiro na concessão e o que sobra não é devolvido.
  minuto_voz: 2,
};

// Quanto uma experiência COMPLETA costuma consumir. É o número que a página mostra
// no aviso antes de começar — não é teto nem cobrança, é expectativa honesta.
export const EXPERIENCIA_COMPLETA = CUSTO.consulta + CUSTO.minuto_voz * 5;

export const PACOTES = [
  { id: "p60", creditos: 60, centavos: 2400, rotulo: "60 créditos", nota: "≈ 6 consultas" },
  { id: "p200", creditos: 200, centavos: 7000, rotulo: "200 créditos", nota: "≈ 20 consultas", destaque: true },
  { id: "p600", creditos: 600, centavos: 18000, rotulo: "600 créditos", nota: "≈ 60 consultas" },
];

export const ASSINATURAS = [
  {
    id: "estudante",
    rotulo: "Estudante",
    creditos: 250,
    centavos: 5990,
    nota: "250 créditos todo mês · ≈ 25 consultas",
  },
  {
    id: "residente",
    rotulo: "Residente",
    creditos: 600,
    centavos: 12990,
    nota: "600 créditos todo mês · ≈ 60 consultas",
    destaque: true,
  },
];

// Créditos de boas-vindas: uma consulta inteira para conhecer a ferramenta antes de
// pagar. Deliberadamente igual a UMA experiência completa — o suficiente para
// decidir, pouco o bastante para que abrir contas descartáveis não compense.
export function creditosDeBoasVindas() {
  const bruto = Number.parseInt(process.env.THM_CREDITOS_BOAS_VINDAS || "", 10);
  return Number.isFinite(bruto) && bruto >= 0 ? bruto : EXPERIENCIA_COMPLETA;
}

export function pacotePorId(id) {
  return PACOTES.find((p) => p.id === id) || null;
}

export function assinaturaPorId(id) {
  return ASSINATURAS.find((a) => a.id === id) || null;
}

// Item do catálogo, seja pacote ou assinatura. As rotas de pagamento tratam os dois
// pelo mesmo caminho até o ponto em que a recorrência diverge.
export function itemPorId(id) {
  const pacote = pacotePorId(id);
  if (pacote) return { ...pacote, tipo: "pacote" };
  const assinatura = assinaturaPorId(id);
  if (assinatura) return { ...assinatura, tipo: "assinatura" };
  return null;
}

export function reais(centavos) {
  return (centavos / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

// Tudo o que a página precisa para montar a loja, sem ela conhecer regra nenhuma.
export function catalogo() {
  return {
    custo: CUSTO,
    experiencia_completa: EXPERIENCIA_COMPLETA,
    boas_vindas: creditosDeBoasVindas(),
    pacotes: PACOTES.map((p) => ({ ...p, preco: reais(p.centavos) })),
    assinaturas: ASSINATURAS.map((a) => ({ ...a, preco: reais(a.centavos) })),
  };
}
