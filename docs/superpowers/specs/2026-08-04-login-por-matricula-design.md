# Login por matrícula

**Data:** 2026-08-04 · **Status:** design aprovado, implementação não iniciada

## O problema

O acesso hoje é um **código compartilhado** (`PV_CODIGO_ACESSO`, padrão `1010`) e uma
senha única de professor. Quem tem o código entra, e todo mundo é a mesma pessoa
para o sistema. Três consequências:

1. O teto de custo só pode ser por IP — e uma turma inteira num laboratório sai por
   um IP só, então um aluno usando voz derruba a voz dos outros.
2. Não existe nota por pessoa: o nome do aluno é **texto livre digitado no corpo da
   requisição**. Foi por esse campo que passou o XSS corrigido na v4.
3. Quem descobrir o código gasta a chave da OpenAI do dono.

Com a conversa por voz em tempo real, o item 1 deixa de ser incômodo e vira risco
financeiro: minutos de áudio custam por minuto.

## Decisões tomadas

| Decisão | Escolha | Por quê |
|---|---|---|
| Quem cria contas | **Só o admin** | nenhum estranho abre conta e queima crédito |
| Ferramenta | **Better Auth** + plugins *username* e *admin* | já usado no SC Mais; o plugin admin entrega a gestão de alunos pronta |
| Banco | **SQLite** em `/dados/pv.sqlite` | volume que já persiste o histórico; zero infra nova |
| Porta aberta | **Nenhuma** — login obrigatório | o código `1010` morre |

Sem auto-cadastro, não há verificação de e-mail nem fluxo de "esqueci a senha": o
admin reseta.

### Isolamento do SC Mais

São duas instalações independentes do mesmo pacote — hosts diferentes (223 × 34),
bancos diferentes (SQLite em arquivo × Postgres), domínios de cookie diferentes
(`ubtec.sbs` × `scmaisinovacao.digital`). Não compartilham sessão, segredo nem
dados. **Não** apontar este Better Auth para o Postgres do SC Mais.

## O movimento central: preservar a interface

`motor/acesso.js` já expõe exatamente o que o resto da aplicação consome:
`papelDe`, `ehAluno`, `ehProfessor`, `sessaoDe`, `estadoAcesso`. O `servidor.js`
protege as consultas com `ehAluno(req)`; o `limite.js` conta uso por `sessaoDe(req)`.

**Mantendo essa interface e trocando só o miolo**, o Better Auth entra sem que
nenhum outro arquivo precise saber. Em especial:

- `sessaoDe(req)` deixa de devolver um `sid` anônimo e passa a devolver o **id do
  aluno** — o teto de uso vira por pessoa **sem alterar uma linha do `limite.js`**.
- `autenticar()` sai (não há mais código compartilhado); entram as rotas do Better
  Auth sob `/api/auth/*`.

`acesso.js` **não é substituído** — é reimplementado por dentro.

## Modelo de dados

Tabelas do Better Auth, com coleta mínima: matrícula (username), nome, hash da
senha, papel (`aluno` | `professor` | `admin`). **Sem e-mail, sem CPF.**

## Identidade nas consultas

O campo `aluno` deixa de vir do corpo da requisição e passa a vir da sessão. O
campo de texto livre some da interface. `consulta.transcript` passa a carregar a
matrícula real, então o painel do professor vira nota por pessoa de verdade.

## Telas

- **Login** (matrícula + senha) substitui o modal do código de acesso.
- **Painel do professor** ganha aba de alunos: criar, listar, resetar senha,
  desativar — via plugin admin, sem lógica escrita à mão.
- **Primeiro admin** nasce de variável de ambiente na subida; sem ele, ninguém entra.

## Deploy — onde mora o risco

O container hoje roda `git clone --depth 1 && node deploy/hostinger/servidor.js`,
**sem `npm install`**, porque a aplicação tem zero dependências. Isso acaba aqui.

| Risco | Tratamento |
|---|---|
| Driver SQLite que compila nativo quebra no Alpine/musl | escolher driver sem build nativo ou trocar a imagem base — decidir medindo, não supondo |
| Migrações do Better Auth no boot | idempotentes; falha não pode deixar o app subir "meio pronto" em silêncio |
| **O container re-clona o `main` a cada restart** | com dependências, um restart passa a instalar pacotes novos sem gate e pode não subir. Travar junto: imagem versionada ou commit fixado |

Esse último item já era um problema antes deste projeto (qualquer restart publica o
`main` atual sem aprovação). Com dependências ele deixa de ser risco de conteúdo e
vira risco de disponibilidade.

## LGPD

Matrícula, nome e transcrição de consulta são dado pessoal, e o dono da instância é
o controlador. Coleta mínima, hash no padrão do Better Auth, e exclusão de aluno
apaga também as transcrições dele.

## Erros

| Situação | Comportamento |
|---|---|
| Matrícula inexistente **ou** senha errada | mesma mensagem genérica — não revela se a matrícula existe |
| Sem admin semeado | o app sobe, mas denuncia em `/api/health` |
| Sessão expirada | volta para o login sem perder a consulta em andamento |

## Testes

- Rota protegida sem sessão responde 401.
- Aluno não abre o painel do professor.
- Matrícula inexistente e senha errada produzem a **mesma** resposta.
- O transcript carrega a matrícula **da sessão**, nunca do corpo da requisição.
- `sessaoDe(req)` devolve o id do aluno, e o teto de uso passa a contar por pessoa.

## Efeito no projeto de voz em tempo real

O spec `2026-08-04-voz-tempo-real-design.md` registra que seu freio de custo por IP
é fraco e deve virar por aluno. Este projeto é o que torna isso possível — por isso
foi priorizado antes daquele.
