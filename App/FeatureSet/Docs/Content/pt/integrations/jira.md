# Integração com o Jira

Abra um issue no [Jira](https://www.atlassian.com/software/jira) automaticamente sempre que um incidente do OneUptime for criado — para que o trabalho de engenharia seja rastreado onde seus desenvolvedores já vivem, com um link de volta para o incidente.

Esta integração é de **saída**: o OneUptime chama a REST API do Jira. Ela usa um **[Workflow](/docs/workflows/index)** do OneUptime com um gatilho **Incident → On Create** e um **componente API**. Você pode, opcionalmente, adicionar um caminho de **entrada** para que fechar o issue no Jira resolva o incidente no OneUptime.

```text
OneUptime Incident → On Create  ──►  API component (POST /rest/api/3/issue)  ──►  Jira issue
```

## Pré-requisitos

- Um site do Jira Cloud (`https://seu-dominio.atlassian.net`) e um projeto para registrar issues — anote sua **chave de projeto** (ex.: `OPS`).
- Uma conta no Jira que possa criar issues e um **token de API** gerado em [id.atlassian.com/manage-profile/security/api-tokens](https://id.atlassian.com/manage-profile/security/api-tokens).
- Um projeto no OneUptime onde você possa criar workflows.

> Usando **Jira Data Center / Server** (auto-gerenciado)? O fluxo é idêntico — use sua própria URL base e um [Personal Access Token](https://confluence.atlassian.com/enterprise/using-personal-access-tokens-1026032365.html) com um cabeçalho de autenticação `Bearer` em vez de Basic auth. O endpoint `/rest/api/2/issue` aceita uma descrição em texto puro, o que simplifica os templates.

## Passo 1 — Armazene suas credenciais do Jira como segredo

O Jira Cloud usa **Basic auth** com seu e-mail e token de API, codificados em base64.

1. Codifique `email:api_token` em base64 uma vez. No macOS/Linux:

   ```bash
   printf '%s' 'you@example.com:your_api_token' | base64
   ```

2. No OneUptime, vá em **Workflows → Global Variables → Create**.
3. Nomeie como `JIRA_AUTH`, cole a string base64 como valor e ative **Is Secret**.

Agora você pode usar `Basic {{variable.JIRA_AUTH}}` como cabeçalho de autenticação e o token nunca aparece no workflow ou em seus logs.

## Passo 2 — Construa o workflow

1. Abra **Workflows → Create Workflow**, nomeie-o `Incidents → Jira` e abra o **Builder**.
2. Arraste um gatilho **Incident** para o canvas e escolha o evento **On Create**. Renomeie-o para `Incident`.
3. Arraste um bloco **API** e conecte o gatilho a ele. Configure:

   - **Method**: `POST`
   - **URL**: `https://seu-dominio.atlassian.net/rest/api/3/issue`
   - **Headers**:

     ```text
     Authorization: Basic {{variable.JIRA_AUTH}}
     Content-Type: application/json
     ```

   - **Body** (o Jira Cloud v3 usa o Atlassian Document Format para a descrição):

     ```json
     {
       "fields": {
         "project": { "key": "OPS" },
         "issuetype": { "name": "Bug" },
         "summary": "OneUptime incident: {{Incident.title}}",
         "description": {
           "type": "doc",
           "version": 1,
           "content": [
             {
               "type": "paragraph",
               "content": [
                 { "type": "text", "text": "{{Incident.description}}" }
               ]
             }
           ]
         }
       }
     }
     ```

   Substitua `OPS` pela sua chave de projeto e `Bug` por um tipo de issue que exista nesse projeto.

4. **Salve.** Deixe o workflow desativado até testá-lo.

## Passo 3 — Teste

1. Ative **Enabled** no workflow.
2. Crie um incidente de teste no OneUptime (ou acione um a partir de um monitor).
3. Abra a aba **Logs** do workflow. O bloco **API** deve exibir um status `201` e um corpo de resposta contendo a `key` do novo issue (por exemplo `OPS-1234`).
4. Verifique no Jira — o issue está lá.

Se o bloco API retornar um erro, expanda-o nos logs — a resposta do Jira explica exatamente qual campo foi rejeitado. Veja [Solução de problemas](#solução-de-problemas).

## Passo 4 — Vincule o incidente de volta ao issue (recomendado)

É útil armazenar a chave do issue do Jira no incidente para que as pessoas possam navegar entre eles.

- A resposta do bloco API está disponível como `{{CreateIssue.response-body.key}}` (se você nomeou o bloco `CreateIssue`).
- Adicione um bloco **Update Incident** depois e escreva a chave em um rótulo, campo personalizado ou nota do incidente.

Isso também torna possível a sincronização bidirecional opcional abaixo.

## Sincronização bidirecional (opcional)

Para resolver o incidente no OneUptime quando alguém fechar o issue no Jira, adicione um workflow de **entrada**:

1. Crie um segundo workflow que começa com um gatilho **Webhook** e copie sua URL.
2. No Jira, vá em **Project settings → Automation → Create rule**:

   - **Trigger**: _Issue transitioned_ para **Done** (ou _Issue resolved_).
   - **Action**: _Send web request_ → método `POST`, URL = URL do webhook do seu workflow, corpo inclui a chave do issue e o id do incidente do OneUptime, ex.:

     ```json
     { "issueKey": "{{issue.key}}", "status": "resolved" }
     ```

3. No workflow, use um bloco **Find Incident** para localizar o incidente pela chave armazenada e depois um bloco **Update Incident** para movê-lo ao estado resolvido.

Se você armazenou a chave do Jira no incidente no Passo 4, a correspondência é direta. Veja [Componentes → Componentes de dados do OneUptime](/docs/workflows/components#oneuptime-data-components).

## Personalizando o issue

Alguns ajustes comuns no corpo do bloco API:

- **Priority** — adicione `"priority": { "name": "High" }` dentro de `fields`. Você pode ramificar em `{{Incident.incidentSeverity.name}}` com **Conditions** para mapear severidades do OneUptime às prioridades do Jira.
- **Labels** — adicione `"labels": ["oneuptime", "incident"]`.
- **Assignee** — adicione `"assignee": { "id": "<accountId>" }` (o Jira Cloud usa IDs de conta, não nomes de usuário).
- **Campos personalizados** — adicione `"customfield_XXXXX": "..."` usando o ID do campo no seu admin do Jira.

Para descobrir os nomes exatos de campos que um projeto espera, chame o endpoint `GET /rest/api/3/issue/createmeta` do Jira uma vez pelo navegador ou `curl`.

## Solução de problemas

**`401 Unauthorized`.**

- Re-codifique `email:api_token` e atualize a variável `JIRA_AUTH`. Uma quebra de linha no final é a causa mais comum — use `printf` (não `echo`) ao codificar.
- Confirme que a conta dona do token de API pode criar issues no projeto.

**`400 Bad Request` mencionando um campo.**

- O tipo de issue ou um campo obrigatório está errado. Verifique o nome do **issue type** do projeto e se ele tem campos personalizados obrigatórios. Use `createmeta` (acima) para ver o que é obrigatório.

**`404 Not Found`.**

- Verifique a URL base e se você está usando `/rest/api/3/issue` (Cloud) ou `/rest/api/2/issue` (Server/Data Center).

**A descrição aparece como uma única linha / fica estranha.**

- A v3 exige o Atlassian Document Format mostrado acima. Se preferir enviar texto puro, use o endpoint `/rest/api/2/issue` com `"description": "{{Incident.description}}"` como uma string simples.

## O que ler em seguida

- [Visão geral das integrações](/docs/integrations/index) — os padrões de entrada/saída e o guia rápido de autenticação.
- [Componente API](/docs/workflows/components#api) — métodos, cabeçalhos e leitura da resposta.
- [Variáveis](/docs/workflows/variables) — segredos e campos de incidente.
- [PagerDuty](/docs/integrations/pagerduty) e [ServiceNow](/docs/integrations/servicenow) — o mesmo padrão de saída para outras ferramentas.
