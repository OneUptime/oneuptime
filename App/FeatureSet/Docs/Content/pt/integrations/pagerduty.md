# Integração com o PagerDuty

Acione um incidente no [PagerDuty](https://www.pagerduty.com) sempre que um incidente do OneUptime for criado, e resolva-o quando o OneUptime resolver. Útil quando o PagerDuty gerencia seus escalonamentos e escalas de plantão e você quer que o monitoramento do OneUptime o alimente.

Esta integração é de **saída**: o OneUptime chama a [Events API v2](https://developer.pagerduty.com/docs/events-api-v2/overview/) do PagerDuty. Ela usa um **[Workflow](/docs/workflows/index)** do OneUptime com um gatilho **Incident → On Create** e um **componente API**.

> O OneUptime tem seu próprio plantão e escalonamento integrados — veja [On Call](/docs/on-call/incoming-call-policy). Use esta integração somente se você especificamente quer que os eventos também apareçam no PagerDuty.

```text
OneUptime Incident → On Create  ──►  API component (POST /v2/enqueue)  ──►  PagerDuty incident
```

## Pré-requisitos

- Um serviço no PagerDuty com uma integração **Events API v2**. No PagerDuty: **Service → Integrations → Add integration → Events API v2**. Copie a **Integration Key** (também chamada de *routing key*).
- Um projeto no OneUptime onde você possa criar workflows.

## Passo 1 — Armazene a routing key

1. Vá em **Workflows → Global Variables → Create**.
2. Nomeie como `PAGERDUTY_ROUTING_KEY`, cole a chave de integração e ative **Is Secret**.

## Passo 2 — Construa o workflow de "acionamento"

1. Abra **Workflows → Create Workflow**, nomeie-o `Incidents → PagerDuty` e abra o **Builder**.
2. Adicione um gatilho **Incident** definido como **On Create**. Renomeie-o para `Incident`.
3. Adicione um bloco **API** conectado ao gatilho:
   - **Method**: `POST`
   - **URL**: `https://events.pagerduty.com/v2/enqueue`
   - **Headers**: `Content-Type: application/json`
   - **Body**:

     ```json
     {
       "routing_key": "{{variable.PAGERDUTY_ROUTING_KEY}}",
       "event_action": "trigger",
       "dedup_key": "oneuptime-{{Incident._id}}",
       "payload": {
         "summary": "{{Incident.title}}",
         "source": "OneUptime",
         "severity": "critical",
         "custom_details": {
           "description": "{{Incident.description}}"
         }
       }
     }
     ```

   O **`dedup_key`** vincula este incidente do PagerDuty ao incidente do OneUptime para que você possa resolvê-lo mais tarde. Usar o id do incidente do OneUptime mantém-o único e previsível.
4. **Salve**, ative e crie um incidente de teste. Uma resposta `202` nos logs do workflow significa que o PagerDuty aceitou o evento.

## Passo 3 — Resolver quando o OneUptime resolver (recomendado)

1. No **mesmo** workflow, adicionar um segundo gatilho **Incident**? Não — um workflow tem um gatilho. Em vez disso, crie um **segundo** workflow chamado `Resolve PagerDuty` com um gatilho **Incident → On Update**.
2. Adicione um bloco **Conditions** para verificar se o incidente está agora resolvido (ramifique no estado do incidente / `{{Incident.currentIncidentState.name}}` igual ao nome do seu estado resolvido).
3. A partir de **Yes**, adicione um bloco **API** para o PagerDuty com o **mesmo `dedup_key`** e `event_action` definido como `resolve`:

   ```json
   {
     "routing_key": "{{variable.PAGERDUTY_ROUTING_KEY}}",
     "event_action": "resolve",
     "dedup_key": "oneuptime-{{Incident._id}}"
   }
   ```

O PagerDuty combina o `dedup_key` e fecha o incidente original.

## Mapeamento de severidade (opcional)

O campo `severity` do PagerDuty aceita `critical`, `error`, `warning` ou `info`. Para mapear a partir das severidades do OneUptime, adicione ramificações **Conditions** em `{{Incident.incidentSeverity.name}}` antes do bloco API e envie um corpo diferente de cada uma.

## Entrada (opcional)

Para fazer o caminho inverso — abrir um incidente no OneUptime a partir de um evento do PagerDuty — adicione um workflow com gatilho **Webhook** e aponte um [webhook V3](https://developer.pagerduty.com/docs/webhooks/v3-overview/) do PagerDuty (ou um Events Orchestration) para sua URL, depois use **Create Incident**. Veja o [padrão de entrada](/docs/integrations/index#inbound-another-tool-sends-data-into-oneuptime).

## Solução de problemas

- **`400` com `"invalid routing key"`** — a integração deve ser **Events API v2**, não a antiga Events API v1 ou outro tipo de integração. Re-copie a chave.
- **A resolução não fecha nada** — o `dedup_key` na chamada de resolução deve corresponder exatamente ao da chamada de acionamento.
- **Nada nos logs** — confirme que o workflow está **Enabled** e o gatilho é **On Create**.

## O que ler em seguida

- [Visão geral das integrações](/docs/integrations/index) — padrões e o guia rápido de autenticação.
- [On Call](/docs/on-call/incoming-call-policy) — o escalonamento integrado do OneUptime.
- [Opsgenie](/docs/integrations/opsgenie) — a mesma ideia para o Opsgenie.
