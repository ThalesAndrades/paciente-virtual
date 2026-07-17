"""Camada de acesso ao modelo de linguagem servido pelo Ollama."""

import re

from .config import MODELO_LLM

# Modelos com raciocínio (ex.: qwen3) podem emitir blocos <think> na resposta.
_PADRAO_RACIOCINIO = re.compile(r"<think>.*?</think>", re.DOTALL)


def limpar_raciocinio(texto):
    """Remove blocos ``<think>...</think>`` para que não sejam exibidos nem falados."""
    return _PADRAO_RACIOCINIO.sub("", texto or "").strip()


def conversar(mensagens, modelo=None):
    """Envia a conversa ao modelo e retorna o texto da resposta, já limpo."""
    import ollama

    resposta = ollama.chat(model=modelo or MODELO_LLM, messages=mensagens)
    return limpar_raciocinio(resposta["message"]["content"])


def avisar_falha(erro):
    """Explica ao usuário uma falha de acesso ao modelo, com orientação de recuperação."""
    print("\nNão foi possível consultar o modelo de linguagem.")
    print(f"Detalhes: {erro}")
    print("Verifique se o Ollama está em execução (`ollama serve`).")
