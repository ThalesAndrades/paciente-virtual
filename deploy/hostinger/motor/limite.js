// Limite de uso por IP.
//
// As rotas que falam com o modelo de linguagem e com a síntese de voz gastam
// crédito de API a cada chamada. Sem teto, uma única pessoa (ou um script) esvazia
// a conta. É uma janela deslizante simples, em memória — não precisa ser exata,
// precisa impedir abuso sem atrapalhar uma turma inteira em aula.

const janelas = new Map();
const MAX_CHAVES = 5000;

// Atrás do Traefik o IP real vem em X-Forwarded-For; o primeiro salto é o cliente.
export function ipDe(req) {
  const encaminhado = req.headers["x-forwarded-for"];
  if (encaminhado) {
    const primeiro = String(encaminhado).split(",")[0].trim();
    if (primeiro) return primeiro;
  }
  return (req.socket && req.socket.remoteAddress) || "desconhecido";
}

function podar(agora) {
  for (const [chave, janela] of janelas) {
    if (janela.reinicio <= agora) janelas.delete(chave);
  }
  // Ainda grande depois da poda (pico real ou ataque distribuído): zera para não
  // virar vazamento de memória. O custo é liberar um ciclo de chamadas.
  if (janelas.size > MAX_CHAVES) janelas.clear();
}

// true = pode seguir. false = estourou o limite.
export function dentroDoLimite(chave, max, janelaMs) {
  const agora = Date.now();
  if (janelas.size > MAX_CHAVES) podar(agora);

  const janela = janelas.get(chave);
  if (!janela || janela.reinicio <= agora) {
    janelas.set(chave, { contagem: 1, reinicio: agora + janelaMs });
    return true;
  }
  if (janela.contagem >= max) return false;
  janela.contagem += 1;
  return true;
}

// Segundos até a janela reabrir — vira Retry-After na resposta 429.
export function segundosAteLiberar(chave) {
  const janela = janelas.get(chave);
  if (!janela) return 0;
  return Math.max(1, Math.ceil((janela.reinicio - Date.now()) / 1000));
}
