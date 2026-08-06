// Duas plataformas, um servidor só.
//
// `revalidaai.med.br` é a plataforma de Medicina: estações do Revalida, cronômetro
// de 10 minutos, PEP. `ubtec.sbs` é a plataforma das demais profissões: consulta
// em formato livre, avaliação por rubrica de anamnese.
//
// A separação é de VITRINE, não de sistema: mesmo banco de contas, mesma carteira
// de créditos, mesma cobrança. Um aluno que comprou crédito em um domínio o gasta
// no outro — é a mesma conta. O que muda é o acervo que cada porta mostra e a
// forma como a experiência se apresenta.
//
// Por que pelo Host e não por rota (`/med`) ou por conta: o domínio é o produto.
// O participante do Revalida chega por `revalidaai.med.br` e não deve ver card de
// Fonoaudiologia; o estudante de Nutrição chega por `ubtec.sbs` e não deve topar
// com uma prova de residência médica. Nenhum dos dois precisa escolher nada.

// A categoria que pertence à plataforma Med. Fora daqui, tudo o mais.
const CATEGORIA_MED = "medicina";

export const MARCAS = {
  med: {
    id: "med",
    nome: "Revalida AI",
    descricao: "Simulação de estações do Revalida — INEP",
    dominio: "revalidaai.med.br",
    mostra: (categoria) => categoria === CATEGORIA_MED,
    // A Med abre direto na sala de estações: quem chega ali já sabe o que quer.
    entrada: "estacoes",
    tema: "med",
    circuito: true,
  },
  geral: {
    id: "geral",
    nome: "Paciente Virtual",
    descricao: "Simulação clínica para as profissões da saúde",
    dominio: "ubtec.sbs",
    // Complementar de propósito: TUDO QUE NÃO É medicina. Assim, profissão nova
    // entra no acervo e aparece sozinha aqui, sem ninguém lembrar de cadastrá-la
    // — foi assim que as 6 profissões novas entraram sem tocar em código.
    mostra: (categoria) => categoria !== CATEGORIA_MED,
    entrada: "catalogo",
    tema: "geral",
    circuito: false,
  },
  // Desenvolvimento e testes, onde o host é sempre localhost. Mostra o acervo
  // INTEIRO: sem isto não haveria como abrir um caso de medicina na sua máquina
  // sem forjar um cabeçalho Host, e a suíte de testes — que é toda de medicina —
  // deixaria de exercitar o produto. Nunca é alcançada por um host público.
  dev: {
    id: "dev",
    nome: "Paciente Virtual (desenvolvimento)",
    descricao: "Acervo completo — as duas plataformas em uma",
    dominio: "localhost",
    mostra: () => true,
    entrada: "catalogo",
    tema: "geral",
    circuito: true,
  },
};

// Hosts que rodam na máquina de quem desenvolve. O healthcheck do container também
// bate em 127.0.0.1, e só pede /healthz.
const HOSTS_LOCAIS = new Set(["localhost", "127.0.0.1", "::1", "0.0.0.0", ""]);

// Hosts que servem a plataforma Med. Em minúsculas e sem porta — o Host de um
// pedido real chega como "revalidaai.med.br", mas em desenvolvimento vem
// "localhost:3000", e o teste precisa poder forçar um ou outro.
const HOSTS_MED = new Set(["revalidaai.med.br", "www.revalidaai.med.br"]);

// Nome do host, sem porta e sem colchetes de IPv6. Host inválido não derruba a
// requisição: cai na marca geral, que é a que já existia.
function nomeDoHost(host) {
  const bruto = String(host || "").toLowerCase().trim();
  if (!bruto) return "";
  if (bruto.startsWith("[")) return bruto.slice(1, bruto.indexOf("]")); // IPv6
  return bruto.split(":")[0];
}

// A marca de um host. `PV_MARCA` força uma marca no servidor inteiro — é como se
// vê a plataforma Med em desenvolvimento, onde o host é sempre localhost.
export function marcaDoHost(host) {
  const forcada = String(process.env.PV_MARCA || "").trim();
  if (forcada && MARCAS[forcada]) return MARCAS[forcada];

  const nome = nomeDoHost(host);
  if (HOSTS_MED.has(nome)) return MARCAS.med;
  if (HOSTS_LOCAIS.has(nome)) return MARCAS.dev;
  return MARCAS.geral;
}

// A marca de uma requisição. Um só lugar lê `req.headers.host`, para que trocar a
// forma de descobrir o host (proxy, cabeçalho) seja uma edição, não uma caçada.
export function marcaDoPedido(req) {
  return marcaDoHost(req && req.headers && req.headers.host);
}

// Uma categoria aparece nesta marca?
export function categoriaNaMarca(marca, categoria) {
  if (!marca || typeof marca.mostra !== "function") return true;
  return marca.mostra(String(categoria || ""));
}

// O circuito de 5 estações existe nesta marca? É a prova do Revalida: não faz
// sentido para quem estuda Nutrição ou Fonoaudiologia.
export function circuitoNaMarca(marca) {
  return Boolean(marca && marca.circuito);
}

// O que a página precisa saber sobre onde ela está. Não expõe nada de servidor.
export function vitrine(marca) {
  return {
    id: marca.id,
    nome: marca.nome,
    descricao: marca.descricao,
    entrada: marca.entrada,
    tema: marca.tema,
    circuito: Boolean(marca.circuito),
  };
}
