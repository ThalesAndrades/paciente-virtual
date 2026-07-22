import pytest

from paciente_virtual.web import servidor
from paciente_virtual.web.servidor import criar_app


@pytest.fixture
def app(tmp_path, monkeypatch):
    monkeypatch.setattr("paciente_virtual.registro.DIR_HISTORICO", tmp_path)
    monkeypatch.setattr("paciente_virtual.relatorio.DIR_HISTORICO", tmp_path)
    return criar_app()


@pytest.fixture
def cliente(app):
    return app.test_client()


def _iniciar(cliente, caso="infarto", aluno="Teste"):
    resposta = cliente.post("/api/consultas", json={"caso": caso, "aluno": aluno})
    assert resposta.status_code == 200
    return resposta.get_json()


def _transcript(app, consulta_id):
    return app.config["CONSULTAS"][consulta_id]["arquivo"].read_text(encoding="utf-8")


def test_pagina_inicial(cliente):
    resposta = cliente.get("/")
    assert resposta.status_code == 200
    assert "Paciente Virtual" in resposta.get_data(as_text=True)


def test_listar_casos_sem_dados_sensiveis(cliente):
    resposta = cliente.get("/api/casos")
    assert resposta.status_code == 200

    casos = resposta.get_json()
    ids = {caso["id"] for caso in casos}
    assert {"infarto", "violencia_psicologica"} <= ids

    # A "capa" do caso não pode vazar as respostas para o navegador.
    corpo = resposta.get_data(as_text=True)
    assert "informacoes_sensiveis" not in corpo
    assert "exame_fisico" not in corpo
    assert "170/100" not in corpo


def test_iniciar_consulta_cria_historico(app, cliente):
    dados = _iniciar(cliente, aluno="Maria Silva")

    assert dados["paciente"]["nome"] == "João Carlos Ferreira"
    assert dados["voz"] == "masculino"

    transcript = _transcript(app, dados["id"])
    assert "CASO: infarto" in transcript
    assert "ALUNO: Maria Silva" in transcript


def test_iniciar_consulta_caso_invalido(cliente):
    assert cliente.post("/api/consultas", json={"caso": "inexistente"}).status_code == 404
    assert (
        cliente.post("/api/consultas", json={"caso": "../casos/infarto"}).status_code == 404
    )


def test_mensagem_de_exame_entrega_resultado(app, cliente):
    consulta = _iniciar(cliente)

    resposta = cliente.post(
        f"/api/consultas/{consulta['id']}/mensagem",
        json={"texto": "vou aferir sua pressão"},
    )
    assert resposta.status_code == 200

    eventos = resposta.get_json()["eventos"]
    assert eventos[0]["tipo"] == "exame"
    assert eventos[0]["nome"] == "Pressão arterial"
    assert "170/100" in eventos[0]["resultado"]

    transcript = _transcript(app, consulta["id"])
    assert "PROFISSIONAL: vou aferir sua pressão" in transcript
    assert "EXAME FÍSICO: Pressão arterial" in transcript


def test_mensagem_de_anamnese_usa_o_modelo(app, cliente, monkeypatch):
    monkeypatch.setattr(servidor, "conversar", lambda mensagens: "Dói no peito.")
    consulta = _iniciar(cliente)

    resposta = cliente.post(
        f"/api/consultas/{consulta['id']}/mensagem", json={"texto": "onde dói?"}
    )
    eventos = resposta.get_json()["eventos"]

    assert eventos == [{"tipo": "paciente", "texto": "Dói no peito.", "origem": "ia"}]
    assert "PACIENTE: Dói no peito." in _transcript(app, consulta["id"])


def test_sem_modelo_cai_no_modo_demonstracao(app, cliente, monkeypatch):
    def falhar(mensagens):
        raise ConnectionError("ollama fora do ar")

    monkeypatch.setattr(servidor, "conversar", falhar)
    consulta = _iniciar(cliente)

    resposta = cliente.post(
        f"/api/consultas/{consulta['id']}/mensagem", json={"texto": "qual é o seu nome?"}
    )
    eventos = resposta.get_json()["eventos"]

    assert eventos[0]["tipo"] == "aviso"
    assert eventos[1]["origem"] == "demo"
    assert "João Carlos" in eventos[1]["texto"]


def test_mensagem_vazia_e_consulta_inexistente(cliente):
    consulta = _iniciar(cliente)
    assert (
        cliente.post(f"/api/consultas/{consulta['id']}/mensagem", json={"texto": " "})
    ).status_code == 400
    assert (
        cliente.post("/api/consultas/nao-existe/mensagem", json={"texto": "oi"})
    ).status_code == 404


def test_encerrar_gera_avaliacao(app, cliente, monkeypatch):
    # O parecer é gerado por avaliador.avaliar_com_ia, que usa o conversar
    # importado no módulo avaliador.
    monkeypatch.setattr(
        "paciente_virtual.avaliador.conversar", lambda mensagens: "Parecer pedagógico."
    )
    consulta = _iniciar(cliente)

    cliente.post(
        f"/api/consultas/{consulta['id']}/mensagem", json={"texto": "solicito ecg"}
    )
    resultado = cliente.post(f"/api/consultas/{consulta['id']}/encerrar").get_json()

    assert resultado["parecer"] == "Parecer pedagógico."
    assert resultado["checklist"]["nota_total"] > 0
    nomes = {criterio["nome"] for criterio in resultado["checklist"]["criterios"]}
    assert "Exames complementares" in nomes
    assert "ENCERRADA:" in _transcript(app, consulta["id"])


def test_encerrar_sem_modelo_mantem_nota_objetiva(cliente, monkeypatch):
    def falhar(mensagens):
        raise ConnectionError("ollama fora do ar")

    monkeypatch.setattr(servidor, "conversar", falhar)
    consulta = _iniciar(cliente)

    resultado = cliente.post(f"/api/consultas/{consulta['id']}/encerrar").get_json()

    assert resultado["parecer"] is None
    assert "aviso" in resultado
    assert "checklist" in resultado


def test_painel_lista_e_detalha_consultas(app, cliente, monkeypatch):
    def falhar(mensagens):
        raise ConnectionError("ollama fora do ar")

    monkeypatch.setattr(servidor, "conversar", falhar)
    monkeypatch.setattr("paciente_virtual.avaliador.conversar", falhar)

    consulta = _iniciar(cliente, aluno="Painel Teste")
    cliente.post(f"/api/consultas/{consulta['id']}/mensagem", json={"texto": "solicito ecg"})
    cliente.post(f"/api/consultas/{consulta['id']}/encerrar")

    listagem = cliente.get("/api/relatorio").get_json()
    assert any(item["aluno"] == "Painel Teste" for item in listagem)

    alvo = next(item for item in listagem if item["aluno"] == "Painel Teste")
    assert alvo["nota"] > 0

    detalhe = cliente.get(f"/api/relatorio/{alvo['arquivo']}").get_json()
    assert detalhe["checklist"]["nota_total"] == alvo["nota"]
    assert any(evento["tipo"] == "exame" for evento in detalhe["eventos"])

    assert cliente.get("/api/relatorio/inexistente.txt").status_code == 404


def test_capacidades_de_voz(cliente, monkeypatch):
    monkeypatch.setattr(servidor.transcricao, "whisper_disponivel", lambda: True)
    monkeypatch.setattr(servidor.sintese, "voz_local_disponivel", lambda voz: voz == "masculino")

    dados = cliente.get("/api/voz").get_json()
    assert dados == {"stt": True, "tts": {"feminino": False, "masculino": True}}


def test_transcrever_indisponivel_sem_whisper(cliente, monkeypatch):
    monkeypatch.setattr(servidor.transcricao, "whisper_disponivel", lambda: False)
    assert cliente.post("/api/transcrever", data=b"audio").status_code == 503


def test_transcrever_usa_whisper(cliente, monkeypatch):
    monkeypatch.setattr(servidor.transcricao, "whisper_disponivel", lambda: True)
    monkeypatch.setattr(
        servidor.transcricao, "transcrever_com_whisper", lambda fonte: "onde dói?"
    )

    resposta = cliente.post("/api/transcrever", data=b"webm-falso")
    assert resposta.status_code == 200
    assert resposta.get_json() == {"texto": "onde dói?"}


def test_transcrever_aceita_multipart(cliente, monkeypatch):
    import io as modulo_io

    monkeypatch.setattr(servidor.transcricao, "whisper_disponivel", lambda: True)
    monkeypatch.setattr(
        servidor.transcricao, "transcrever_com_whisper", lambda fonte: "qual a pressão?"
    )

    resposta = cliente.post(
        "/api/transcrever",
        data={"audio": (modulo_io.BytesIO(b"webm-falso"), "fala.webm")},
        content_type="multipart/form-data",
    )
    assert resposta.status_code == 200
    assert resposta.get_json() == {"texto": "qual a pressão?"}


def test_falar_gera_wav(cliente, monkeypatch):
    monkeypatch.setattr(servidor.sintese, "voz_local_disponivel", lambda voz: True)
    monkeypatch.setattr(servidor.sintese, "sintetizar_wav", lambda texto, voz: b"RIFFwav")

    resposta = cliente.post("/api/falar", json={"texto": "Olá", "voz": "masculino"})
    assert resposta.status_code == 200
    assert resposta.mimetype == "audio/wav"
    assert resposta.data == b"RIFFwav"


def test_falar_indisponivel_e_texto_vazio(cliente, monkeypatch):
    monkeypatch.setattr(servidor.sintese, "voz_local_disponivel", lambda voz: False)
    assert cliente.post("/api/falar", json={"texto": "Olá"}).status_code == 503
    assert cliente.post("/api/falar", json={"texto": " "}).status_code == 400


def test_consulta_encerrada_nao_aceita_mensagem(cliente, monkeypatch):
    def falhar(mensagens):
        raise ConnectionError("ollama fora do ar")

    monkeypatch.setattr(servidor, "conversar", falhar)
    consulta = _iniciar(cliente)

    cliente.post(f"/api/consultas/{consulta['id']}/encerrar")
    resposta = cliente.post(
        f"/api/consultas/{consulta['id']}/mensagem", json={"texto": "oi"}
    )
    assert resposta.status_code == 409
