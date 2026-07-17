from paciente_virtual.texto import contem_algum_termo, contem_termo, normalizar


def test_normalizar_remove_acentos_e_hifens():
    assert normalizar("Pressão-Arterial") == "pressao arterial"


def test_normalizar_colapsa_espacos():
    assert normalizar("  raio   x  ") == "raio x"


def test_normalizar_texto_vazio():
    assert normalizar(None) == ""
    assert normalizar("") == ""


def test_contem_termo_ignora_acentos():
    assert contem_termo("vou aferir sua pressao agora", "pressão")
    assert contem_termo("vou aferir sua pressão agora", "pressao")


def test_contem_termo_respeita_limites_de_palavra():
    assert contem_termo("verifique a FC do paciente", "fc")
    assert not contem_termo("solicito eletrocardiograma", "eletro")


def test_contem_termo_com_hifen():
    assert contem_termo("solicito um raio-x de tórax", "raio x")


def test_contem_termo_vazio():
    assert not contem_termo("qualquer texto", "")


def test_contem_algum_termo():
    assert contem_algum_termo("quando começou a dor?", ["início", "começou"])
    assert not contem_algum_termo("bom dia", ["início", "começou"])
