// Leitura e estruturação do transcript gravado.

import { TITULO_EXAME_FISICO, TITULO_EXAME_SOLICITADO } from "./exames.js";

const PREFIXO_PROFISSIONAL = "PROFISSIONAL:";
const PREFIXO_VERIFICADA = "PERGUNTA VERIFICADA:";
const PREFIXO_PACIENTE = "PACIENTE:";
const PREFIXO_RESULTADO = "RESULTADO:";

export function extrairMetadados(texto) {
  const campo = (nome) => {
    const encontrado = texto.match(new RegExp(`^${nome}:\\s*(.+)$`, "m"));
    return encontrado ? encontrado[1].trim() : null;
  };

  return {
    caso: campo("CASO"),
    aluno: campo("ALUNO"),
    inicio: campo("INICIO"),
    encerrada: campo("ENCERRADA") !== null,
    // Raciocínio que o aluno assumiu antes de ver o gabarito, e as anotações que
    // tomou durante a consulta. O professor lê os dois junto com a transcrição.
    hipotese: campo("HIPOTESE"),
    diferenciais: campo("DIFERENCIAIS"),
    conduta: campo("CONDUTA"),
    anotacoes: campo("ANOTACOES"),
    // Presente só quando a consulta usou voz em tempo real. O professor precisa
    // saber que ali a transcrição veio do navegador do aluno.
    modo: campo("MODO"),
  };
}

export function estruturarTranscript(texto) {
  const eventos = [];
  let atual = null;

  const fechar = () => {
    if (atual !== null) {
      atual.texto = atual.texto.trim();
      if (atual.texto || atual.tipo === "exame") eventos.push(atual);
      atual = null;
    }
  };

  for (const linha of texto.split("\n")) {
    const conteudo = linha.trim();

    if (!conteudo || /^=+$/.test(conteudo)) continue;
    // Metadados e fechamento não são falas: saem da linha do tempo (e, sem este
    // filtro, seriam grudados como continuação do último balão).
    if (/^(CASO|ALUNO|INICIO|ENCERRADA|HIPOTESE|DIFERENCIAIS|CONDUTA|ANOTACOES|MODO):/.test(conteudo)) {
      fechar();
      continue;
    }

    if (conteudo.startsWith(PREFIXO_PROFISSIONAL)) {
      fechar();
      atual = { tipo: "profissional", texto: conteudo.slice(PREFIXO_PROFISSIONAL.length).trim() };
    } else if (conteudo.startsWith(PREFIXO_VERIFICADA)) {
      // Mesma linha do tempo, com a marca de que quem viu esta pergunta foi o
      // servidor — é o que separa evidência de declaração na consulta por voz.
      fechar();
      atual = {
        tipo: "profissional",
        verificada: true,
        texto: conteudo.slice(PREFIXO_VERIFICADA.length).trim(),
      };
    } else if (conteudo.startsWith(PREFIXO_PACIENTE)) {
      fechar();
      atual = { tipo: "paciente", texto: conteudo.slice(PREFIXO_PACIENTE.length).trim() };
    } else if (
      conteudo.startsWith(`${TITULO_EXAME_FISICO}:`) ||
      conteudo.startsWith(`${TITULO_EXAME_SOLICITADO}:`)
    ) {
      fechar();
      const separador = conteudo.indexOf(":");
      atual = {
        tipo: "exame",
        titulo: conteudo.slice(0, separador),
        nome: conteudo.slice(separador + 1).trim(),
        texto: "",
      };
    } else if (conteudo.startsWith(PREFIXO_RESULTADO) && atual && atual.tipo === "exame") {
      atual.texto = conteudo.slice(PREFIXO_RESULTADO.length).trim();
    } else if (atual !== null) {
      atual.texto += `\n${conteudo}`;
    }
  }

  fechar();
  return eventos;
}
