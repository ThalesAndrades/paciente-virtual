"""Configurações centrais do simulador.

Os valores podem ser sobrescritos por variáveis de ambiente:

- ``PACIENTE_VIRTUAL_DIR``: diretório com ``casos/``, ``avaliacoes/`` e ``historico/``.
- ``PACIENTE_VIRTUAL_MODELO``: nome do modelo servido pelo Ollama.
- ``PACIENTE_VIRTUAL_LIMIAR_FALA``: sensibilidade mínima do microfone (amplitude int16).
"""

import os
from pathlib import Path


def _dir_base_padrao():
    # Instalação editável / execução a partir do repositório: os dados
    # moram ao lado do pacote. Instalação comum (site-packages): usa o
    # diretório de trabalho atual.
    raiz_repositorio = Path(__file__).resolve().parent.parent
    if (raiz_repositorio / "casos").is_dir():
        return raiz_repositorio
    return Path.cwd()


DIR_BASE = Path(os.environ.get("PACIENTE_VIRTUAL_DIR") or _dir_base_padrao())

DIR_CASOS = DIR_BASE / "casos"
DIR_AVALIACOES = DIR_BASE / "avaliacoes"
DIR_HISTORICO = DIR_BASE / "historico"

MODELO_LLM = os.environ.get("PACIENTE_VIRTUAL_MODELO", "qwen3:8b")

LIMIAR_FALA_MINIMO = int(os.environ.get("PACIENTE_VIRTUAL_LIMIAR_FALA", "120"))
