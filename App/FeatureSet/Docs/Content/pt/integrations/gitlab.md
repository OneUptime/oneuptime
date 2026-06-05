# Integração com o GitLab

Abra um issue no [GitLab](https://gitlab.com) automaticamente quando um incidente do OneUptime for criado — para que o acompanhamento de engenharia fique no projeto que possui o serviço afetado.

Esta integração é de **saída**: o OneUptime chama a [REST API do GitLab](https://docs.gitlab.com/ee/api/issues.html). Ela usa um **[Workflow](/docs/workflows/index)** do OneUptime com um gatilho **Incident → On Create** e um **componente API**. Funciona da mesma forma no GitLab.com e no GitLab auto-gerenciado.

```text
OneUptime Incident → On Create  ──►  API component (POST /projects/{id}/issues)  ──►  GitLab issue
```

## Pré-requisitos

- Um projeto no GitLab e seu **Project ID** (exibido na página de visão geral do projeto, abaixo do nome do projeto).
- Um token de acesso que possa criar issues — um **Project**, **Group** ou **Personal Access Token** com o escopo `api`: **Settings → Access Tokens**.
- Um projeto no OneUptime onde você possa criar workflows.

## Passo 1 — Armazene o token

1. Vá em **Workflows → Global Variables → Create**.
2. Nomeie como `GITLAB_TOKEN`, cole o token e ative **Is Secret**.

## Passo 2 — Construa o workflow

1. Abra **Workflows → Create Workflow**, nomeie-o `Incidents → GitLab Issues` e abra o **Builder**.
2. Adicione um gatilho **Incident** definido como **On Create**. Renomeie-o para `Incident`.
3. Adicione um bloco **API** conectado ao gatilho:
   - **Method**: `POST`
   - **URL**: `https://gitlab.com/api/v4/projects/12345678/issues`  *(substitua `12345678` pelo seu Project ID; para auto-gerenciado, use seu próprio host)*
   - **Headers**:

     ```text
     PRIVATE-TOKEN: {{variable.GITLAB_TOKEN}}
     Content-Type: application/json
     ```

   - **Body**:

     ```json
     {
       "title": "OneUptime incident: {{Incident.title}}",
       "description": "{{Incident.description}}\n\nFiled automatically from OneUptime.",
       "labels": "incident,oneuptime"
     }
     ```

4. **Salve**, ative e crie um incidente de teste. Um `201 Created` nos logs do workflow significa que o issue foi criado; o corpo da resposta contém seu `iid` e `web_url`.

## Dicas

- **GitLab auto-gerenciado**: substitua `https://gitlab.com` pela URL da sua instância; o caminho `/api/v4/...` permanece o mesmo.
- **Caminho do projeto em vez de ID**: você pode codificar o caminho em URL — ex.: `group%2Fproject` — no lugar do ID numérico.
- **Assignee / data de vencimento**: adicione `"assignee_ids": [42]` ou `"due_date": "2026-01-31"` ao corpo.
- **Link de volta**: leia `{{CreateIssue.response-body.web_url}}` e armazene-o no incidente com um bloco **Update Incident**.

## Solução de problemas

- **`401`** — o token é inválido ou expirou, ou não tem o escopo `api`.
- **`404`** — o Project ID está errado, ou o token não consegue acessar um projeto privado.
- **`400`** — um campo obrigatório está ausente ou malformado; `title` é obrigatório.

## O que ler em seguida

- [Visão geral das integrações](/docs/integrations/index) — padrões e o guia rápido de autenticação.
- [GitHub](/docs/integrations/github) — a mesma ideia para o GitHub.
- [Componente API](/docs/workflows/components#api) — lendo o corpo da resposta.
