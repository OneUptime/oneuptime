# Integração com o GitHub

Abra um issue no [GitHub](https://github.com) automaticamente quando um incidente do OneUptime for criado — para que o acompanhamento de engenharia seja rastreado no repositório que possui o serviço afetado.

Esta integração é de **saída**: o OneUptime chama a [REST API do GitHub](https://docs.github.com/en/rest/issues/issues). Ela usa um **[Workflow](/docs/workflows/index)** do OneUptime com um gatilho **Incident → On Create** e um **componente API**.

> **Procurando a conexão mais profunda com o GitHub?** O OneUptime também tem uma integração nativa com o **GitHub App** para conectar repositórios de código (usada pelo agente de IA e recursos de código). Ela é configurada com variáveis de ambiente, não com workflows — veja [Integração com o GitHub (auto-hospedado)](/docs/self-hosted/github-integration). Esta página é especificamente sobre *criar issues a partir de incidentes*.

```text
OneUptime Incident → On Create  ──►  API component (POST /repos/{owner}/{repo}/issues)  ──►  GitHub issue
```

## Pré-requisitos

- Um repositório no GitHub onde você quer que os issues sejam criados.
- Um token que possa criar issues:
  - **Fine-grained PAT** com escopo para esse repositório e permissão **Issues: Read and write**, ou
  - um **classic PAT** com o escopo `repo`.

  Crie um em [github.com/settings/tokens](https://github.com/settings/tokens).
- Um projeto no OneUptime onde você possa criar workflows.

## Passo 1 — Armazene o token

1. Vá em **Workflows → Global Variables → Create**.
2. Nomeie como `GITHUB_TOKEN`, cole o token e ative **Is Secret**.

## Passo 2 — Construa o workflow

1. Abra **Workflows → Create Workflow**, nomeie-o `Incidents → GitHub Issues` e abra o **Builder**.
2. Adicione um gatilho **Incident** definido como **On Create**. Renomeie-o para `Incident`.
3. Adicione um bloco **API** conectado ao gatilho:
   - **Method**: `POST`
   - **URL**: `https://api.github.com/repos/sua-org/seu-repo/issues`
   - **Headers**:

     ```text
     Authorization: Bearer {{variable.GITHUB_TOKEN}}
     Accept: application/vnd.github+json
     X-GitHub-Api-Version: 2022-11-28
     User-Agent: OneUptime
     ```

   - **Body**:

     ```json
     {
       "title": "OneUptime incident: {{Incident.title}}",
       "body": "{{Incident.description}}\n\nFiled automatically from OneUptime.",
       "labels": ["incident", "oneuptime"]
     }
     ```

4. **Salve**, ative e crie um incidente de teste. Um `201 Created` nos logs do workflow significa que o issue foi criado; o corpo da resposta contém seu `number` e `html_url`.

## Dicas

- **GitHub Enterprise Server**: use `https://seu-host/api/v3/repos/{owner}/{repo}/issues`.
- **Assignees / milestone**: adicione `"assignees": ["octocat"]` ou `"milestone": 3` ao corpo.
- **Link de volta**: leia `{{CreateIssue.response-body.html_url}}` e armazene-o no incidente com um bloco **Update Incident**.

## Solução de problemas

- **`401`** — o token está errado ou expirou. Fine-grained tokens devem conceder explicitamente o repositório e a permissão **Issues**.
- **`403` / limite de taxa** — inclua o cabeçalho `User-Agent` (o GitHub rejeita requisições sem ele) e verifique se você não atingiu o limite de taxa.
- **`404`** — o caminho `owner/repo` está errado, ou o token não consegue ver um repositório privado.
- **`422`** — um label que não existe não é problema (o GitHub cria labels referenciadas), mas um corpo malformado sim — verifique seu JSON.

## O que ler em seguida

- [Visão geral das integrações](/docs/integrations/index) — padrões e o guia rápido de autenticação.
- [GitLab](/docs/integrations/gitlab) — a mesma ideia para o GitLab.
- [Integração com o GitHub (auto-hospedado)](/docs/self-hosted/github-integration) — a conexão nativa com o GitHub App.
