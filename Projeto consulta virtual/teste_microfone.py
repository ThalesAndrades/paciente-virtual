from voz.ouvir import ouvir_microfone

print("Teste de microfone")
print("Fale após a mensagem")

texto = ouvir_microfone()

print("\nVocê disse:")
print(texto)