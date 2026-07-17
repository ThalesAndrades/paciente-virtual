from paciente_virtual.prompt import criar_prompt

CASO = {
    "identificacao": {
        "nome": "João Carlos Ferreira",
        "idade": 58,
        "sexo": "Masculino",
        "voz": "masculino",
        "estado_civil": "Casado",
        "escolaridade": "Ensino Fundamental Completo",
        "profissao": "Pedreiro",
    },
    "queixa_principal": "Dor no peito",
    "historia_doenca_atual": {
        "inicio": "Há 2 horas",
        "sintomas_associados": ["Sudorese", "Náusea"],
    },
    "antecedentes_pessoais": {"hipertensao": True, "diabetes": False},
}


def test_prompt_contem_dados_do_caso():
    prompt = criar_prompt(CASO)

    assert "João Carlos Ferreira" in prompt
    assert "Dor no peito" in prompt
    assert "Há 2 horas" in prompt
    # Todos os campos de identificação entram, não só um subconjunto fixo...
    assert "Ensino Fundamental Completo" in prompt
    # ...exceto "voz", que é configuração de áudio, não dado clínico.
    assert "masculino" not in prompt


def test_prompt_formata_booleanos_e_listas():
    prompt = criar_prompt(CASO)

    assert "Hipertensao: Sim" in prompt
    assert "Diabetes: Não" in prompt
    assert "- Sudorese" in prompt
    # O prompt não deve conter repr de dicionário Python.
    assert "{'" not in prompt
    assert "True" not in prompt


def test_prompt_tolera_caso_incompleto():
    prompt = criar_prompt({"identificacao": {"nome": "Ana"}})
    assert "Ana" in prompt
