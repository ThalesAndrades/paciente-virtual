// Porta fiel de paciente_virtual/registro.py (leitura) + relatorio.py (resumo).

import { TITULO_EXAME_FISICO, TITULO_EXAME_SOLICITADO } from "./exames.js";

const PREFIXO_PROFISSIONAL = "PROFISSIONAL:";
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
    if (/^(CASO|ALUNO|INICIO|ENCERRADA):/.test(conteudo)) continue;

    if (conteudo.startsWith(PREFIXO_PROFISSIONAL)) {
      fechar();
      atual = { tipo: "profissional", texto: conteudo.slice(PREFIXO_PROFISSIONAL.length).trim() };
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
