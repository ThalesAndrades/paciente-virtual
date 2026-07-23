# Roadmap — do protótipo à plataforma de nível internacional

Este documento é o **backlog priorizado** de evolução do Paciente Virtual.
Serve como fonte de verdade do planejamento porque as *Issues* estão
desabilitadas neste repositório — cada item abaixo faria as vezes de uma issue.

Complementa a análise em [`COMPREENSAO.md`](COMPREENSAO.md): lá está *o que o
projeto é hoje*; aqui está *para onde ele vai*.

## Metas mensuráveis

| Métrica | Alvo | Por quê |
| --- | --- | --- |
| Latência de voz (fim da fala → 1º fonema do paciente) | **< 800 ms** | Separa "turnos" de conversa real |
| Barge-in (interrupção falando por cima) | **< 200 ms** | Realismo de consulta |
| Concordância da avaliação com humano (κ) | **≥ 0,8** | Confiança pedagógica da nota |
| Idiomas suportados (UI + casos + voz) | **3+** (pt · en · es) | Alcance internacional |

## As seis frentes

- **A · Arquitetura** — motor único, containerização, persistência, sessões duráveis.
- **B · Inteligência** — modelo plugável (local ↔ nuvem), RAG clínico, guardrails, avaliação calibrada.
- **C · Voz** — STT/TTS em streaming, WebRTC, barge-in, latência sub-segundo.
- **D · Produto** — auth, multi-tenant, LMS (LTI), learning analytics, modo OSCE.
- **E · Experiência** — design system, avatar animado com lip-sync, feedback visual, mobile/PWA.
- **F · Confiança** — observabilidade, i18n, conformidade LGPD/GDPR.

---

## Fase 0 — Fundação (destravar)

Nada novo antes de resolver a base. Estes quatro itens são o desbloqueio.

### 0.1 — Motor único + containerização · Arquitetura · esforço alto · impacto alto
**Problema:** o motor existe duplicado (Python `paciente_virtual/` + porta Node
`deploy/hostinger/`). A divergência já causou bug real (`demo.js` ≠ `demo.py`,
corrigido no PR #8) e obriga a replicar toda mudança à mão.
**Meta:** uma única fonte de verdade, servida por container.
- [ ] Adotar Python como motor único (mais completo/testado)
- [ ] Dockerfile + compose para dev; hospedagem vira detalhe de deploy
- [ ] Aposentar `deploy/hostinger/motor/*.js` (ou reduzir a proxy fino)
- [ ] Atualizar CI (o job `testes-node` perde o sentido) e `COMPREENSAO.md` §2
- **Aceite:** nenhuma lógica de negócio duplicada entre linguagens; deploy reproduzível.

### 0.2 — Persistência real (Postgres) · Produto · esforço médio · impacto alto
**Problema:** consultas vivem em memória (`app.config["CONSULTAS"]`); perde-se
estado a cada reinício e não escala horizontalmente.
**Meta:** persistir consultas, transcrições e notas em banco relacional.
- [ ] Modelar `aluno`, `consulta`, `mensagem`, `exame_entregue`, `avaliacao`
- [ ] Camada de dados (SQLAlchemy) + migrations (Alembic)
- [ ] Migrar `web/servidor.py` do dict em memória para o banco
- [ ] Manter o contrato do transcript (`registro.py`) como export
- **Aceite:** consultas sobrevivem a reinício; nota e parecer recuperáveis.

### 0.3 — Autenticação + multi-tenant · Produto/Infra · esforço médio · impacto alto
**Problema:** protótipo sem auth nem isolamento — inviável fora de sala de aula local.
**Meta:** contas de aluno/professor, turmas e isolamento por instituição.
- [ ] Autenticação (sessão/JWT) e papéis (aluno, professor, admin)
- [ ] Modelo multi-tenant (instituição → turmas → alunos)
- [ ] Autorização nos endpoints (quem vê o quê)
- **Aceite:** dados de uma instituição nunca vazam para outra. Compartilha modelagem com 0.2.

### 0.4 — CI E2E + testes de contrato · Infra · esforço médio · impacto médio
**Problema:** um rename de rubrica quebrou `test_web.py` — teste acoplado a nome.
**Meta:** rede de segurança que pega regressões de integração.
- [ ] Testes E2E com Playwright (já disponível no ambiente)
- [ ] Testes de contrato front ↔ API
- [ ] Teste de regressão de prompt (comportamento do paciente)
- **Aceite:** o pipeline pega divergências front/back e de rubrica antes do merge.

---

## Fase 1 — Qualidade (realismo)

- **1.1 Camada de modelo plugável** (IA · M · alto) — local para privacidade/offline; nuvem (Claude/GPT) opcional para qualidade máxima, escolha do professor.
- **1.2 RAG de fidelidade clínica** (IA · L · alto) — ancorar respostas em diretrizes reais; blindar a coerência médica hoje dependente só do prompt. Ver [`spec-voz-e-ia.md`](#) quando existir.
- **1.3 Guardrails de segurança** (IA · M · alto) — detectores de quebra de personagem, vazamento de diagnóstico e manejo de conteúdo sensível (ideação suicida exige cuidado extra).
- **1.4 Voz full-duplex + barge-in** (Voz · L · alto) — WebRTC + STT/TTS em streaming + interrupção; alvo < 800 ms. Base já iniciada nos commits `perf(fluidez)`.
- **1.5 Avaliação com LLM-judge calibrado** (IA · M · alto) — manter o checklist determinístico como baseline e somar julgamento semântico por rubrica, calibrado contra notas humanas (κ ≥ 0,8).

## Fase 2 — Produto (adoção)

- **2.1 Design system + migração do frontend** (UX · L · alto) — sair do `index.html` único vanilla para componentes com build, tokens e tema claro/escuro (WCAG 2.2 AA).
- **2.2 Avatar animado com lip-sync** (UX · L · alto) — rosto do paciente reagindo ao estado emocional do caso; salto de imersão.
- **2.3 Painel de learning analytics** (Produto · M · alto) — evolução do aluno, pontos fracos por turma, comparativos para o professor.
- **2.4 Integração LMS (LTI 1.3)** (Produto · M · alto) — Moodle/Canvas; porta de entrada para universidades.
- **2.5 Mobile-first / PWA** (UX · M · médio) — instalável e utilizável offline.

## Fase 3 — Escala (internacional)

- **3.1 Internacionalização** (Produto · L · alto) — pt · en · es, com casos e vozes localizados.
- **3.2 Conformidade LGPD / GDPR** (Infra · L · alto) — criptografia em repouso, retenção configurável, consentimento; os históricos têm dados de aluno.
- **3.3 Modo OSCE / exame cronometrado** (Produto · M · médio) — estações com tempo, como as escolas médicas avaliam de fato.
- **3.4 Observabilidade de latência e custo** (Infra · S · médio) — métricas STT/LLM/TTS, custo por consulta, taxa de fallback demo.

---

## Onde apostar primeiro

**Quick wins** (alto retorno, baixo custo): barge-in na voz · tema claro/escuro +
avatar com expressão · LLM-judge calibrado na avaliação.

**A aposta grande** (muda o patamar): **voz full-duplex de baixa latência + avatar
com lip-sync emocional** — é o que transforma "chat com um paciente" em
"simulação de consulta imersiva".

> Notação: cada item traz *frente · esforço (S/M/L) · impacto*. Estimativas são
> relativas, para priorização — não prazos.
