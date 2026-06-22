# Integração com o ServiceNow

Abra um incidente no [ServiceNow](https://www.servicenow.com) automaticamente sempre que um incidente do OneUptime for criado — para que o ITSM e o monitoramento permaneçam em sincronia.

Esta integração é de **saída**: o OneUptime chama a [Table API](https://docs.servicenow.com/bundle/utah-application-development/page/integrate/inbound-rest/concept/c_TableAPI.html) do ServiceNow. Ela usa um **[Workflow](/docs/workflows/index)** do OneUptime com um gatilho **Incident → On Create** e um **componente API**.

```text
OneUptime Incident → On Create  ──►  API component (POST /api/now/table/incident)  ──►  ServiceNow incident
```

## Pré-requisitos

- Uma instância do ServiceNow (`https://sua-instancia.service-now.com`).
- Um usuário do ServiceNow com os papéis `rest_api_explorer` / `itil` (ou permissões suficientes para criar registros `incident`). Basic auth com as credenciais desse usuário é o início mais simples; OAuth é recomendado para produção.
- Um projeto no OneUptime onde você possa criar workflows.

## Passo 1 — Armazene as credenciais como segredo

A Table API do ServiceNow aceita **Basic auth**.

1. Codifique `username:password` em base64 uma vez:

   ```bash
   printf '%s' 'integration_user:password' | base64
   ```

2. No OneUptime, vá em **Workflows → Global Variables → Create**, nomeie como `SERVICENOW_AUTH`, cole a string base64 e ative **Is Secret**.

## Passo 2 — Construa o workflow

1. Abra **Workflows → Create Workflow**, nomeie-o `Incidents → ServiceNow` e abra o **Builder**.
2. Adicione um gatilho **Incident** definido como **On Create**. Renomeie-o para `Incident`.
3. Adicione um bloco **API** conectado ao gatilho:

   - **Method**: `POST`
   - **URL**: `https://sua-instancia.service-now.com/api/now/table/incident`
   - **Headers**:

     ```text
     Authorization: Basic {{variable.SERVICENOW_AUTH}}
     Content-Type: application/json
     Accept: application/json
     ```

   - **Body**:

     ```json
     {
       "short_description": "OneUptime: {{Incident.title}}",
       "description": "{{Incident.description}}",
       "urgency": "1",
       "impact": "1",
       "correlation_id": "oneuptime-{{Incident._id}}"
     }
     ```

   O `correlation_id` mantém um vínculo com o incidente do OneUptime — útil se você adicionar um passo de resolução depois. O `urgency`/`impact` do ServiceNow usa `1` (alto), `2` (médio), `3` (baixo).

4. **Salve**, ative e crie um incidente de teste. Uma resposta `201 Created` nos logs do workflow retorna o `sys_id` e o `number` do novo registro (por exemplo `INC0012345`).

## Passo 3 — Resolver quando o OneUptime resolver (opcional)

1. Crie um **segundo** workflow com um gatilho **Incident → On Update** e um bloco **Conditions** que verifica se o incidente está resolvido.
2. Para atualizar o registro correto no ServiceNow, você precisa do seu `sys_id`. Armazene-o no incidente do OneUptime no Passo 2 (leia `{{CreateRecord.response-body.result.sys_id}}` e escreva-o em um rótulo com **Update Incident**), ou busque o registro primeiro com um `GET` em `/api/now/table/incident?sysparm_query=correlation_id=oneuptime-{{Incident._id}}`.
3. Adicione um bloco **API**: **Method** `PATCH`, **URL** `https://sua-instancia.service-now.com/api/now/table/incident/<sys_id>`, corpo `{ "state": "6", "close_code": "Resolved by monitoring", "close_notes": "Resolved in OneUptime" }` (`state` `6` = Resolvido no workflow ITIL padrão).

## Solução de problemas

- **`401`** — re-codifique `username:password` com `printf` (não `echo`, que adiciona uma quebra de linha) e atualize `SERVICENOW_AUTH`.
- **`403`** — o usuário não tem direitos para gravar na tabela `incident`; adicione o papel `itil`.
- **`400`** — um nome de campo ou valor está errado para as personalizações da sua instância. Verifique os nomes de campo em **System Definition → Tables → incident**.
- **A instância rejeita a chamada** — algumas instâncias restringem a Table API; confirme que REST está habilitado e que seu IP não está bloqueado por uma ACL.

## O que ler em seguida

- [Visão geral das integrações](/docs/integrations/index) — padrões e o guia rápido de autenticação.
- [Jira](/docs/integrations/jira) — o mesmo padrão de saída para o Jira.
- [Componente API](/docs/workflows/components#api) — lendo o corpo da resposta.
