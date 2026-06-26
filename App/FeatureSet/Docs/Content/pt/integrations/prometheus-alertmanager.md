# Integração com o Prometheus Alertmanager

Transforme notificações do [Prometheus Alertmanager](https://prometheus.io/docs/alerting/latest/alertmanager/) em incidentes do OneUptime. O Prometheus avalia suas regras de alerta, o Alertmanager as roteia e o OneUptime as registra e escalona.

Esta integração é de **entrada**: o Alertmanager faz POST para um **[Workflow](/docs/workflows/index)** do OneUptime que começa com um **gatilho Webhook**.

```text
Prometheus rule fires  ──►  Alertmanager webhook receiver  ──►  OneUptime Webhook trigger  ──►  Create Incident
```

## Pré-requisitos

- Uma configuração Prometheus + Alertmanager onde você possa editar `alertmanager.yml`.
- O Alertmanager deve conseguir alcançar sua instância do OneUptime via HTTPS.
- Um projeto no OneUptime onde você possa criar workflows.

## Passo 1 — Construa o workflow do OneUptime

1. Abra **Workflows → Create Workflow**, nomeie-o `Alertmanager → Incidents` e abra o **Builder**.
2. Adicione um gatilho **Webhook** e **copie sua URL**. Renomeie o bloco para `Alertmanager`.
3. Adicione um bloco **Conditions** conectado ao gatilho:
   - **Left**: `{{Alertmanager.Request Body.status}}`
   - **Operator**: `==`
   - **Right**: `firing`
4. A partir de **Yes**, adicione um bloco **Create Incident**:
   - **Title**: `{{Alertmanager.Request Body.commonAnnotations.summary}}`
   - **Description**: `{{Alertmanager.Request Body.commonAnnotations.description}}\nAlert: {{Alertmanager.Request Body.commonLabels.alertname}}`
   - **Severity**: escolha uma (ou ramifique em `{{Alertmanager.Request Body.commonLabels.severity}}` primeiro).
5. **Salve** (deixe desativado até testar).

> **Sobre alertas agrupados.** O Alertmanager agrupa alertas e envia um **array** `alerts`. Os campos `commonLabels` e `commonAnnotations` acima são compartilhados por todo o grupo — perfeito para um incidente por notificação. Se você quiser **um incidente por alerta**, adicione um bloco [Custom Code](/docs/workflows/components#custom-code) que percorra `Request Body.alerts` e crie um incidente para cada um. Ajuste o agrupamento com `group_by` na sua rota.

## Passo 2 — Configure o Alertmanager

Adicione um receptor webhook apontando para a URL do workflow e roteie os alertas para ele. No `alertmanager.yml`:

```yaml
receivers:
  - name: oneuptime
    webhook_configs:
      - url: "https://<your-workflow-webhook-url>"
        send_resolved: true

route:
  receiver: oneuptime
  group_by: ["alertname"]
  group_wait: 30s
  group_interval: 5m
  repeat_interval: 3h
```

Recarregue o Alertmanager (`curl -X POST http://localhost:9093/-/reload` ou reinicie-o).

## Passo 3 — Teste

1. Ative o workflow.
2. Dispare um alerta de teste — por exemplo, com `amtool`:

   ```bash
   amtool alert add test_alert severity=warning --annotation=summary="Test from Alertmanager" --alertmanager.url=http://localhost:9093
   ```

3. Verifique a aba **Logs** do workflow e sua lista de **Incidents**.

## Resolvendo na recuperação (opcional)

Com `send_resolved: true`, o Alertmanager também faz POST quando um alerta é limpo, desta vez com `status: resolved`. Adicione uma segunda ramificação **Conditions** (`status == resolved`), encontre o incidente correspondente (combine com `commonLabels.alertname`) e mova-o ao estado resolvido com **Update Incident**.

## Solução de problemas

- **Nenhuma execução aparece** — confirme que o Alertmanager consegue alcançar a URL (verifique seus logs para erros de entrega) e que o workflow está **Enabled**.
- **Campos do incidente estão vazios** — regras diferentes definem anotações diferentes. Inspecione a saída do gatilho na aba **Logs** e referencie campos que realmente existem (`commonAnnotations` vs `annotations` por alerta).
- **Incidentes demais** — aumente `group_by`/`group_interval` para que o Alertmanager agrupe alertas relacionados.

## O que ler em seguida

- [Visão geral das integrações](/docs/integrations/index) — o padrão de entrada.
- [Grafana](/docs/integrations/grafana) — a mesma ideia com alertas do Grafana.
- [Gatilho Webhook](/docs/workflows/triggers#webhook) — como a URL receptora funciona.
