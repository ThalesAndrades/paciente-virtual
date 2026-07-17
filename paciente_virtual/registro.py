"""Contrato do arquivo de histórico: escrita e leitura da transcrição.

Este módulo é o único dono do formato do transcript. Quem escreve
(``consulta``, ``exames``) e quem lê (``avaliador``) usa as mesmas
constantes e funções daqui — mudar o formato em um lugar só.
"""

import re
from datetime import datetime

from .config import DIR_HISTORICO

PREFIXO_PROFISSIONAL = "PROFISSIONAL:"
PREFIXO_PACIENTE = "PACIENTE:"
TITULO_EXAME_FISICO = "EXAME FÍSICO"
TITULO_EXAME_SOLICITADO = "EXAME SOLICITADO"
PREFIXO_RESULTADO = "RESULTADO:"

# Linhas que contam como ação do profissional na avaliação objetiva.
# PREFIXO_RESULTADO fica de fora de propósito: o conteúdo do resultado é
# dado do caso (o "corpo" do paciente falando), não investigação do aluno.
PREFIXOS_PROFISSIONAL = (
    PREFIXO_PROFISSIONAL,
    f"{TITULO_EXAME_FISICO}:",
    f"{TITULO_EXAME_SOLICITADO}:",
)


def sanitizar_nome(nome):
    """Remove caracteres problemáticos para nomes de arquivo."""
    nome = re.sub(r"[^\w\s-]", "", nome, flags=re.UNICODE).strip()
    return re.sub(r"\s+", "_", nome) or "aluno"


def criar_historico(nome_caso, nome_aluno):
    """Cria o arquivo de histórico com cabeçalho de metadados e o retorna."""
    DIR_HISTORICO.mkdir(parents=True, exist_ok=True)

    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    arquivo = DIR_HISTORICO / f"{nome_caso}_{sanitizar_nome(nome_aluno)}_{timestamp}.txt"

    with open(arquivo, "w", encoding="utf-8") as log:
        log.write("=" * 50 + "\n")
        log.write(f"CASO: {nome_caso}\n")
        log.write(f"ALUNO: {nome_aluno}\n")
        log.write(f"INICIO: {datetime.now():%Y-%m-%d %H:%M:%S}\n")
        log.write("=" * 50 + "\n")

    return arquivo


def encerrar_historico(arquivo):
    """Registra o encerramento deliberado da consulta."""
    registrar(arquivo, f"\nENCERRADA: {datetime.now():%Y-%m-%d %H:%M:%S}\n")


def registrar(arquivo, linha):
    """Anexa uma linha ao histórico."""
    with open(arquivo, "a", encoding="utf-8") as log:
        log.write(linha)


def extrair_caso_do_cabecalho(texto):
    """Lê o nome do caso do cabeçalho de metadados. Retorna None se ausente."""
    encontrado = re.search(r"^CASO:\s*(.+)$", texto, re.MULTILINE)
    if encontrado:
        return encontrado.group(1).strip()
    return None


def extrair_metadados(texto):
    """Lê o cabeçalho/rodapé de metadados do transcript.

    Retorna ``{"caso", "aluno", "inicio", "encerrada"}`` — campos ausentes
    (históricos antigos) vêm como None.
    """

    def campo(nome):
        encontrado = re.search(rf"^{nome}:\s*(.+)$", texto, re.MULTILINE)
        return encontrado.group(1).strip() if encontrado else None

    return {
        "caso": campo("CASO"),
        "aluno": campo("ALUNO"),
        "inicio": campo("INICIO"),
        "encerrada": campo("ENCERRADA") is not None,
    }


def estruturar_transcript(texto):
    """Converte o transcript em uma lista de eventos para exibição.

    Cada evento é ``{"tipo": "profissional"|"paciente"|"exame", ...}``;
    falas com múltiplas linhas são agrupadas no mesmo evento. Linhas de
    cabeçalho/rodapé (metadados) ficam de fora.
    """
    eventos = []
    atual = None

    def fechar():
        nonlocal atual
        if atual is not None:
            atual["texto"] = atual["texto"].strip()
            if atual["texto"] or atual["tipo"] == "exame":
                eventos.append(atual)
            atual = None

    for linha in texto.splitlines():
        conteudo = linha.strip()

        if not conteudo or set(conteudo) == {"="}:
            continue
        if re.match(r"^(CASO|ALUNO|INICIO|ENCERRADA):", conteudo):
            continue

        if conteudo.startswith(PREFIXO_PROFISSIONAL):
            fechar()
            atual = {
                "tipo": "profissional",
                "texto": conteudo[len(PREFIXO_PROFISSIONAL) :].strip(),
            }
        elif conteudo.startswith(PREFIXO_PACIENTE):
            fechar()
            atual = {
                "tipo": "paciente",
                "texto": conteudo[len(PREFIXO_PACIENTE) :].strip(),
            }
        elif conteudo.startswith((f"{TITULO_EXAME_FISICO}:", f"{TITULO_EXAME_SOLICITADO}:")):
            fechar()
            titulo, nome = conteudo.split(":", 1)
            atual = {"tipo": "exame", "titulo": titulo, "nome": nome.strip(), "texto": ""}
        elif conteudo.startswith(PREFIXO_RESULTADO) and atual and atual["tipo"] == "exame":
            atual["texto"] = conteudo[len(PREFIXO_RESULTADO) :].strip()
        elif atual is not None:
            # Continuação de uma fala com múltiplas linhas.
            atual["texto"] += f"\n{conteudo}"

    fechar()
    return eventos


def extrair_texto_profissional(texto):
    """Mantém apenas as falas do profissional e os exames que ele solicitou."""
    linhas = [
        linha
        for linha in texto.splitlines()
        if linha.strip().startswith(PREFIXOS_PROFISSIONAL)
    ]
    return "\n".join(linhas)
