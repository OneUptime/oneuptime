# Integração com o Datadog

Transforme alertas de monitor do [Datadog](https://www.datadoghq.com) em incidentes do OneUptime, para que a detecção do Datadog alimente a resposta a incidentes e as páginas de status do OneUptime.

Esta integração é de **entrada**: a [integração Webhooks](https://docs.datadoghq.com/integrations/webhooks/) do Datadog faz POST para um **[Workflow](/docs/workflows/index)** do OneUptime que começa com um **gatilho Webhook**.

```text
Datadog monitor alerts  ──►  Webhook integration  ──►  OneUptime Webhook trigger  ──►  Create Incident
```

## Pré-requisitos

- Uma conta no Datadog onde você possa configurar integrações e monitores.
- Um projeto no OneUptime onde você possa criar workflows.

## Passo 1 — Construa o workflow do OneUptime

1. Abra **Workflows → Create Workflow**, nomeie-o `Datadog → Incidents` e abra o **Builder**.
2. Adicione um gatilho **Webhook** e **copie sua URL**. Renomeie o bloco para `Datadog`.
3. Adicione um bloco **Conditions** conectado ao gatilho:
   - **Left**: `{{Datadog.Request Body.transition}}`
   - **Operator**: `==`
   - **Right**: `Triggered`
4. A partir de **Yes**, adicione um bloco **Create Incident**:
   - **Title**: `{{Datadog.Request Body.title}}`
   - **Description**: `{{Datadog.Request Body.body}}\nHost: {{Datadog.Request Body.host}}\n{{Datadog.Request Body.link}}`
   - **Severity**: escolha uma.
5. **Salve** (deixe desativado até testar).

## Passo 2 — Crie o webhook no Datadog

1. No Datadog, vá em **Integrations → Webhooks** (instale a integração **Webhooks** se ainda não o fez).
2. **Adicione um webhook**:

   - **Name**: `oneuptime` (isso vira `@webhook-oneuptime`).
   - **URL**: a URL do webhook do seu workflow.
   - **Payload** — o Datadog permite definir o corpo JSON usando [variáveis de template](https://docs.datadoghq.com/integrations/webhooks/#usage):

     ```json
     {
       "title": "$EVENT_TITLE",
       "body": "$TEXT_ONLY_MSG",
       "alert_type": "$ALERT_TYPE",
       "transition": "$ALERT_TRANSITION",
       "id": "$ALERT_ID",
       "host": "$HOSTNAME",
       "link": "$LINK",
       "priority": "$PRIORITY"
     }
     ```

3. Salve o webhook.

## Passo 3 — Envie os alertas de um monitor para o webhook

Adicione o handle do webhook aos monitores que deseja encaminhar. Na **notification message** de cada monitor, inclua:

```text
{{#is_alert}}@webhook-oneuptime{{/is_alert}}
{{#is_recovery}}@webhook-oneuptime{{/is_recovery}}
```

Isso envia tanto o alerta quanto a recuperação para o OneUptime. (Para encaminhar tudo, você também pode adicionar `@webhook-oneuptime` a um monitor de forma incondicional.)

## Passo 4 — Teste

1. Ative o workflow.
2. Em um monitor, use **Test Notifications → Alert** ou deixe um monitor real disparar.
3. Verifique a aba **Logs** do workflow e sua lista de **Incidents**.

## Resolvendo na recuperação (opcional)

`$ALERT_TRANSITION` é `Recovered` quando um monitor é limpo. Adicione uma segunda ramificação **Conditions** (`transition == Recovered`), encontre o incidente correspondente (combine com o `id` enviado) e mova-o ao estado resolvido com **Update Incident**.

## Solução de problemas

- **Nenhuma execução aparece** — confirme que a mensagem do monitor inclui `@webhook-oneuptime` e que o workflow está **Enabled**.
- **Campos estão vazios** — o Datadog só substitui variáveis de template que se aplicam ao evento. Inspecione a saída do gatilho na aba **Logs** e ajuste o payload do webhook.
- **Incidentes duplicados** — um monitor que re-alerta (renotify) envia múltiplos eventos `Triggered`; desduplique com uma verificação **Find Incident** no `id` antes de criar.

## O que ler em seguida

- [Visão geral das integrações](/docs/integrations/index) — o padrão de entrada.
- [Prometheus Alertmanager](/docs/integrations/prometheus-alertmanager) e [Grafana](/docs/integrations/grafana) — outras fontes de entrada.
- [Gatilho Webhook](/docs/workflows/triggers#webhook) — como a URL receptora funciona.
