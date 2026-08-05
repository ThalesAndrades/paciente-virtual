// Freio de custo da conversa em tempo real.
//
// A conversa por voz é o único recurso do simulador que custa POR MINUTO em vez de
// por pergunta: o áudio vai direto do navegador para o provedor, e enquanto a
// sessão estiver aberta ela queima crédito mesmo que ninguém fale. Sem teto, uma
// aba esquecida aberta na sexta-feira é a fatura de segunda.
//
// O orçamento conta MINUTOS CONCEDIDOS, não consumidos. O servidor está fora do
// caminho do áudio (é o ponto da arquitetura WebRTC direta), então ele não tem como
// saber quantos minutos o aluno de fato usou — e erra deliberadamente para menos:
// cada bloco concedido é debitado inteiro no momento em que o token é cunhado.
//
// Três tetos, do mais estreito ao mais largo:
//   1. por CONSULTA  — uma estação não vira conversa infinita;
//   2. por ALUNO/dia — um aluno não consome a cota da turma. Só passou a ser
//      possível quando o login por matrícula existiu; antes era por IP, e uma
//      escola inteira sai por um IP só;
//   3. do SERVIDOR/dia — o teto que protege quem paga a conta, mesmo que todas as
//      contas de aluno estejam se comportando.

const DIA_MS = 24 * 60 * 60 * 1000;

// Uma concessão: { aluno, consultaId, minutos, quando }. Lista simples porque o
// volume é pequeno por natureza — são minutos de áudio, não requisições.
let concessoes = [];

function inteiro(bruto, padrao) {
  const n = Number.parseFloat(String(bruto ?? "").replace(",", "."));
  return Number.isFinite(n) && n >= 0 ? n : padrao;
}

// Lidos a cada chamada: o env pode mudar sem rebuild da imagem.
export function tetos() {
  return {
    // Uma estação clínica de verdade dura de 8 a 15 minutos.
    consulta: inteiro(process.env.PV_RT_MIN_CONSULTA, 12),
    aluno_dia: inteiro(process.env.PV_RT_MIN_ALUNO_DIA, 30),
    servidor_dia: inteiro(process.env.PV_RT_MIN_SERVIDOR_DIA, 240),
    // Tamanho do bloco concedido por token. Blocos curtos custam uma renovação a
    // mais por consulta e, em troca, é o que o aluno perde quando fecha a aba.
    bloco: Math.max(1, inteiro(process.env.PV_RT_MIN_BLOCO, 5)),
  };
}

function podar(agora) {
  const corte = agora - DIA_MS;
  if (concessoes.length && concessoes[0].quando <= corte) {
    concessoes = concessoes.filter((c) => c.quando > corte);
  }
}

function somar(filtro, agora) {
  const corte = agora - DIA_MS;
  let total = 0;
  for (const c of concessoes) {
    if (c.quando > corte && filtro(c)) total += c.minutos;
  }
  return total;
}

// Quanto ainda cabe, em minutos, por cada um dos três tetos.
export function saldo({ aluno, consultaId }) {
  const agora = Date.now();
  podar(agora);
  const t = tetos();
  const daConsulta = concessoes
    .filter((c) => c.consultaId === consultaId)
    .reduce((soma, c) => soma + c.minutos, 0);

  return {
    consulta: Math.max(0, t.consulta - daConsulta),
    aluno: Math.max(0, t.aluno_dia - somar((c) => c.aluno === aluno, agora)),
    servidor: Math.max(0, t.servidor_dia - somar(() => true, agora)),
  };
}

// Concede o próximo bloco. Devolve { ok: true, minutos } ou { ok: false, motivo },
// com o motivo escrito para o aluno ler — quem estourou o teto precisa entender que
// não é defeito, e que o modo de segurar o microfone continua ali.
export function conceder({ aluno, consultaId }) {
  const restante = saldo({ aluno, consultaId });
  const t = tetos();
  const minutos = Math.min(t.bloco, restante.consulta, restante.aluno, restante.servidor);

  if (minutos <= 0) {
    let motivo = "O tempo de conversa por voz desta consulta acabou.";
    if (restante.servidor <= 0) {
      motivo = "O tempo de conversa por voz do servidor acabou por hoje.";
    } else if (restante.aluno <= 0) {
      motivo = "Você já usou a sua cota de conversa por voz de hoje.";
    }
    return { ok: false, motivo, minutos: 0, restante };
  }

  concessoes.push({ aluno, consultaId, minutos, quando: Date.now() });
  return { ok: true, minutos, restante: saldo({ aluno, consultaId }) };
}

// Só para os testes: a janela é deslizante e de 24 h, então sem isto um teste
// contaminaria o seguinte.
export function zerarOrcamento() {
  concessoes = [];
}
