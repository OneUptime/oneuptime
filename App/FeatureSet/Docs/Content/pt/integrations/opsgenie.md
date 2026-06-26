# Integração com o Opsgenie

Crie um alerta no [Opsgenie](https://www.atlassian.com/software/opsgenie) sempre que um incidente do OneUptime for criado, e feche-o quando o OneUptime resolver.

Esta integração é de **saída**: o OneUptime chama a [Alert API do Opsgenie](https://docs.opsgenie.com/docs/alert-api). Ela usa um **[Workflow](/docs/workflows/index)** do OneUptime com um gatilho **Incident → On Create** e um **componente API**.

```text
OneUptime Incident → On Create  ──►  API component (POST /v2/alerts)  ──►  Opsgenie alert
```

## Pré-requisitos

- Uma **chave de API** do Opsgenie de uma integração de API: **Settings → Integrations → Add → API**. Copie a chave.
- Saiba sua região. O host de API padrão é `https://api.opsgenie.com`; contas da UE usam `https://api.eu.opsgenie.com`.
- Um projeto no OneUptime onde você possa criar workflows.

## Passo 1 — Armazene a chave de API

1. Vá em **Workflows → Global Variables → Create**.
2. Nomeie como `OPSGENIE_KEY`, cole a chave de API e ative **Is Secret**.

## Passo 2 — Construa o workflow de "criação de alerta"

1. Abra **Workflows → Create Workflow**, nomeie-o `Incidents → Opsgenie` e abra o **Builder**.
2. Adicione um gatilho **Incident** definido como **On Create**. Renomeie-o para `Incident`.
3. Adicione um bloco **API** conectado ao gatilho:

   - **Method**: `POST`
   - **URL**: `https://api.opsgenie.com/v2/alerts` _(use `api.eu.opsgenie.com` para UE)_
   - **Headers**:

     ```text
     Authorization: GenieKey {{variable.OPSGENIE_KEY}}
     Content-Type: application/json
     ```

   - **Body**:

     ```json
     {
       "message": "{{Incident.title}}",
       "alias": "oneuptime-{{Incident._id}}",
       "description": "{{Incident.description}}",
       "priority": "P1",
       "source": "OneUptime"
     }
     ```

   O **`alias`** vincula este alerta do Opsgenie ao incidente do OneUptime para que você possa fechá-lo mais tarde pelo alias. Observe que o esquema de autenticação do Opsgenie é a palavra literal `GenieKey` seguida de um espaço e sua chave.

4. **Salve**, ative e crie um incidente de teste. Uma resposta `202 Accepted` nos logs do workflow significa que o Opsgenie colocou o alerta na fila.

## Passo 3 — Fechar quando o OneUptime resolver (recomendado)

1. Crie um **segundo** workflow chamado `Close Opsgenie` com um gatilho **Incident → On Update**.
2. Adicione um bloco **Conditions** que verifica se o incidente está agora resolvido (ramifique em `{{Incident.currentIncidentState.name}}`).
3. A partir de **Yes**, adicione um bloco **API**:
   - **Method**: `POST`
   - **URL**: `https://api.opsgenie.com/v2/alerts/oneuptime-{{Incident._id}}/close?identifierType=alias`
   - **Headers**: o mesmo `Authorization: GenieKey {{variable.OPSGENIE_KEY}}`
   - **Body**: `{ "source": "OneUptime", "note": "Resolved in OneUptime" }`

O Opsgenie localiza o alerta pelo alias e o fecha.

## Mapeamento de prioridade (opcional)

As prioridades do Opsgenie vão de `P1` a `P5`. Mapeie a partir das severidades do OneUptime com ramificações **Conditions** em `{{Incident.incidentSeverity.name}}` antes do bloco API.

## Solução de problemas

- **`401`/`403`** — chave errada, host de região errado ou a integração não tem permissão para criar alertas. Confirme que você está usando uma chave de integração **API** e o host `api`/`api.eu` correspondente.
- **O fechamento retorna `404`** — o `alias` na chamada de fechamento deve corresponder exatamente ao da chamada de criação, e `identifierType=alias` deve estar na query string.
- **Nada acontece** — confirme que o workflow está **Enabled**.

## O que ler em seguida

- [Visão geral das integrações](/docs/integrations/index) — padrões e o guia rápido de autenticação.
- [PagerDuty](/docs/integrations/pagerduty) — a mesma ideia para o PagerDuty.
- [On Call](/docs/on-call/incoming-call-policy) — o escalonamento integrado do OneUptime.
