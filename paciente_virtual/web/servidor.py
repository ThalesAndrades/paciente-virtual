"""Servidor web do protótipo interativo.

Expõe o mesmo motor da CLI (casos, exames, avaliação) como uma API JSON
mínima e serve a página única em ``static/index.html``. Com o extra
``voz-local`` instalado, o servidor também transcreve (Whisper) e sintetiza
(Piper) localmente, com software livre; sem ele, a página usa a Web Speech
API do navegador.

As consultas vivem em memória (o transcript vai para ``historico/`` como na
CLI). É um protótipo para uso local ou em rede de sala de aula — sem
autenticação e sem persistência de sessão entre reinícios do servidor.
"""

import io
import json
import os
import secrets

from flask import Flask, Response, jsonify, request

from ..avaliador import avaliar_com_ia, carregar_rubrica, pontuar_checklist
from ..config import DIR_CASOS
from ..demo import AVISO_DEMO, responder_demo
from ..exames import contexto_para_paciente, detectar_exames, registrar_exame
from ..ia import conversar
from ..prompt import criar_prompt
from ..registro import (
    PREFIXO_PACIENTE,
    PREFIXO_PROFISSIONAL,
    criar_historico,
    encerrar_historico,
    extrair_texto_profissional,
    registrar,
)
from ..relatorio import detalhar_consulta, listar_consultas
from ..voz import falar as sintese
from ..voz import transcricao

AVISO_SEM_PARECER = (
    "Parecer pedagógico indisponível (modelo de linguagem fora do ar). "
    "A nota objetiva acima não depende do modelo."
)

AVISO_SEM_RUBRICA = "Este caso não tem rubrica de avaliação cadastrada."


def _listar_casos():
    casos = []
    for arquivo in sorted(DIR_CASOS.glob("*.json")):
        with open(arquivo, encoding="utf-8") as f:
            caso = json.load(f)
        ident = caso.get("identificacao", {})
        # Só dados de "capa" vão para o navegador — o caso completo contém
        # as respostas (informações sensíveis, resultados de exames).
        casos.append(
            {
                "id": arquivo.stem,
                "titulo": caso.get("titulo") or arquivo.stem.replace("_", " ").capitalize(),
                "queixa": caso.get("queixa_principal", ""),
                "paciente": {
                    "nome": ident.get("nome", ""),
                    "idade": ident.get("idade", ""),
                    "sexo": ident.get("sexo", ""),
                    "profissao": ident.get("profissao", ""),
                },
                "voz": ident.get("voz", "feminino"),
            }
        )
    return casos


def criar_app():
    app = Flask(__name__)
    app.config["CONSULTAS"] = {}

    def _consulta_ativa(consulta_id):
        consulta = app.config["CONSULTAS"].get(consulta_id)
        if consulta is None:
            return None, (jsonify({"erro": "Consulta não encontrada."}), 404)
        if consulta["encerrada"]:
            return None, (jsonify({"erro": "Consulta já encerrada."}), 409)
        return consulta, None

    @app.get("/")
    def pagina():
        return app.send_static_file("index.html")

    @app.get("/api/casos")
    def listar_casos():
        return jsonify(_listar_casos())

    @app.get("/api/relatorio")
    def relatorio():
        """Painel do professor: resumo de todas as consultas gravadas."""
        return jsonify(listar_consultas())

    @app.get("/api/relatorio/<nome_arquivo>")
    def relatorio_detalhe(nome_arquivo):
        detalhe = detalhar_consulta(nome_arquivo)
        if detalhe is None:
            return jsonify({"erro": "Consulta não encontrada."}), 404
        return jsonify(detalhe)

    @app.get("/api/voz")
    def capacidades_de_voz():
        """Informa à página quais motores locais de voz estão disponíveis."""
        return jsonify(
            {
                "stt": transcricao.whisper_disponivel(),
                "tts": {
                    "feminino": sintese.voz_local_disponivel("feminino"),
                    "masculino": sintese.voz_local_disponivel("masculino"),
                },
            }
        )

    @app.post("/api/transcrever")
    def transcrever_audio():
        """Transcreve um áudio gravado no navegador (Whisper local)."""
        if not transcricao.whisper_disponivel():
            return jsonify({"erro": "Transcrição local indisponível."}), 503

        # Multipart (navegador via FormData) ou corpo bruto. Não misturar:
        # acessar request.files consome o corpo de requisições não-multipart.
        if request.mimetype == "multipart/form-data":
            arquivo = request.files.get("audio")
            conteudo = arquivo.read() if arquivo else b""
        else:
            conteudo = request.get_data()

        if not conteudo:
            return jsonify({"erro": "Áudio vazio."}), 400

        try:
            texto = transcricao.transcrever_com_whisper(io.BytesIO(conteudo))
        except Exception as erro:
            return jsonify({"erro": f"Falha na transcrição: {erro}"}), 500

        return jsonify({"texto": texto})

    @app.post("/api/falar")
    def falar_texto():
        """Sintetiza a fala do paciente com a voz neural local (Piper)."""
        dados = request.get_json(force=True, silent=True) or {}
        texto = (dados.get("texto") or "").strip()
        voz = dados.get("voz") if dados.get("voz") in ("feminino", "masculino") else "feminino"

        if not texto:
            return jsonify({"erro": "Texto vazio."}), 400
        if not sintese.voz_local_disponivel(voz):
            return jsonify({"erro": "Síntese local indisponível."}), 503

        try:
            wav = sintese.sintetizar_wav(texto, voz)
        except Exception as erro:
            return jsonify({"erro": f"Falha na síntese: {erro}"}), 500

        return Response(wav, mimetype="audio/wav")

    @app.post("/api/consultas")
    def iniciar_consulta():
        dados = request.get_json(force=True, silent=True) or {}
        caso_id = (dados.get("caso") or "").strip()
        aluno = (dados.get("aluno") or "").strip() or "aluno"

        # Compara com a lista real de casos — nunca monta caminho com a
        # entrada do usuário (evita path traversal).
        disponiveis = {arquivo.stem: arquivo for arquivo in DIR_CASOS.glob("*.json")}
        if caso_id not in disponiveis:
            return jsonify({"erro": "Caso não encontrado."}), 404

        with open(disponiveis[caso_id], encoding="utf-8") as f:
            caso = json.load(f)

        ident = caso.get("identificacao", {})
        consulta_id = secrets.token_urlsafe(8)
        app.config["CONSULTAS"][consulta_id] = {
            "caso": caso,
            "caso_id": caso_id,
            "voz": ident.get("voz", "feminino"),
            "mensagens": [{"role": "system", "content": criar_prompt(caso)}],
            "arquivo": criar_historico(caso_id, aluno),
            "encerrada": False,
        }

        return jsonify(
            {
                "id": consulta_id,
                "caso": caso_id,
                "voz": ident.get("voz", "feminino"),
                "paciente": {
                    "nome": ident.get("nome", ""),
                    "idade": ident.get("idade", ""),
                    "sexo": ident.get("sexo", ""),
                    "profissao": ident.get("profissao", ""),
                },
            }
        )

    @app.post("/api/consultas/<consulta_id>/mensagem")
    def enviar_mensagem(consulta_id):
        consulta, erro = _consulta_ativa(consulta_id)
        if erro:
            return erro

        dados = request.get_json(force=True, silent=True) or {}
        texto = (dados.get("texto") or "").strip()
        if not texto:
            return jsonify({"erro": "Mensagem vazia."}), 400

        registrar(consulta["arquivo"], f"\n{PREFIXO_PROFISSIONAL} {texto}\n")

        eventos = []

        exames = detectar_exames(texto, consulta["caso"])
        if exames:
            for titulo, dados_exame in exames:
                registrar_exame(consulta["arquivo"], titulo, dados_exame)
                eventos.append(
                    {
                        "tipo": "exame",
                        "titulo": titulo,
                        "nome": dados_exame["nome"],
                        "resultado": dados_exame["resultado"],
                    }
                )
            # O paciente precisa "saber" que foi examinado para a conversa
            # seguinte não contradizer o transcript.
            consulta["mensagens"].append(
                {
                    "role": "system",
                    "content": contexto_para_paciente([d for _, d in exames]),
                }
            )
            return jsonify({"eventos": eventos})

        consulta["mensagens"].append({"role": "user", "content": texto})

        try:
            resposta = conversar(consulta["mensagens"])
            origem = "ia"
        except Exception:
            resposta = responder_demo(consulta["caso"], texto)
            origem = "demo"
            eventos.append({"tipo": "aviso", "texto": AVISO_DEMO})

        # A resposta (mesmo em modo demo) entra no contexto do modelo para a
        # conversa continuar coerente se o Ollama voltar.
        consulta["mensagens"].append({"role": "assistant", "content": resposta})
        registrar(consulta["arquivo"], f"\n{PREFIXO_PACIENTE} {resposta}\n")

        eventos.append({"tipo": "paciente", "texto": resposta, "origem": origem})
        return jsonify({"eventos": eventos})

    @app.post("/api/consultas/<consulta_id>/encerrar")
    def encerrar_consulta(consulta_id):
        consulta, erro = _consulta_ativa(consulta_id)
        if erro:
            return erro

        encerrar_historico(consulta["arquivo"])
        consulta["encerrada"] = True

        texto = consulta["arquivo"].read_text(encoding="utf-8")
        resultado = {"transcript": consulta["arquivo"].name}

        rubrica = carregar_rubrica(consulta["caso_id"])
        if rubrica is None:
            resultado["aviso"] = AVISO_SEM_RUBRICA
            return jsonify(resultado)

        resultado["checklist"] = pontuar_checklist(
            rubrica, extrair_texto_profissional(texto)
        )

        try:
            resultado["parecer"] = avaliar_com_ia(rubrica, texto)
        except Exception:
            resultado["parecer"] = None
            resultado["aviso"] = AVISO_SEM_PARECER

        return jsonify(resultado)

    return app


def main():
    app = criar_app()
    host = os.environ.get("PACIENTE_VIRTUAL_HOST", "127.0.0.1")
    porta = int(os.environ.get("PACIENTE_VIRTUAL_PORTA", "8000"))
    print(f"\nProtótipo interativo em http://{host}:{porta}\n")
    app.run(host=host, port=porta)


if __name__ == "__main__":
    main()
