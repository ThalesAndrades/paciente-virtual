from paciente_virtual.ia import limpar_raciocinio


def test_remove_bloco_de_raciocinio():
    texto = "<think>o aluno perguntou o nome...\nvou responder</think>João Carlos."
    assert limpar_raciocinio(texto) == "João Carlos."


def test_remove_multiplos_blocos():
    texto = "<think>a</think>Olá.<think>b</think> Tudo bem."
    assert limpar_raciocinio(texto) == "Olá. Tudo bem."


def test_texto_sem_raciocinio_permanece_igual():
    assert limpar_raciocinio("Dói no peito.") == "Dói no peito."


def test_texto_vazio():
    assert limpar_raciocinio(None) == ""
    assert limpar_raciocinio("") == ""
