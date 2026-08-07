# Retratos dos atores

Um arquivo `<id-do-caso>.webp` por caso. **Não são versionados à mão**: saem de

```bash
REPLICATE_API_TOKEN=r8_... node scripts/gerar-retratos.mjs
```

São pessoas fictícias, geradas — ninguém é retratado sem consentimento — e a
semente vem do id do caso, então o mesmo paciente tem sempre o mesmo rosto.

Caso sem retrato aqui **não quebra nada**: a sala desenha o rosto de reserva
(`web/rosto.js`). É o mesmo caminho de quando a imagem falha ao carregar.
