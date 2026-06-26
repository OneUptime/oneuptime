# Prometheus Alertmanager-integrasjon

Gjør [Prometheus Alertmanager](https://prometheus.io/docs/alerting/latest/alertmanager/)-varsler om til OneUptime-hendelser. Prometheus evaluerer varslingsreglene dine, Alertmanager ruter dem, og OneUptime registrerer og eskalerer dem.

Denne integrasjonen er **innkommende**: Alertmanager POSTer til en OneUptime **[Arbeidsflyt](/docs/workflows/index)** som starter med en **Webhook-trigger**.

```text
Prometheus rule fires  ──►  Alertmanager webhook receiver  ──►  OneUptime Webhook trigger  ──►  Create Incident
```

## Forutsetninger

- Et Prometheus + Alertmanager-oppsett der du kan redigere `alertmanager.yml`.
- Alertmanager må kunne nå OneUptime-instansen din over HTTPS.
- Et OneUptime-prosjekt der du kan opprette arbeidsflyter.

## Steg 1 — Bygg OneUptime-arbeidsflyten

1. Åpne **Workflows → Create Workflow**, gi den navnet `Alertmanager → Incidents`, og åpne **Builder**.
2. Legg til en **Webhook**-trigger og **kopier URL-en**. Gi blokken nytt navn til `Alertmanager`.
3. Legg til en **Conditions**-blokk koblet til triggeren:
   - **Left**: `{{Alertmanager.Request Body.status}}`
   - **Operator**: `==`
   - **Right**: `firing`
4. Fra **Yes**, legg til en **Create Incident**-blokk:
   - **Title**: `{{Alertmanager.Request Body.commonAnnotations.summary}}`
   - **Description**: `{{Alertmanager.Request Body.commonAnnotations.description}}\nAlert: {{Alertmanager.Request Body.commonLabels.alertname}}`
   - **Severity**: velg én (eller forgren på `{{Alertmanager.Request Body.commonLabels.severity}}` først).
5. **Lagre** (la stå deaktivert til det er testet).

> **Om grupperte varsler.** Alertmanager grupperer varsler og sender en `alerts`-**matrise**. `commonLabels` og `commonAnnotations` ovenfor er feltene som er felles på tvers av gruppen — perfekt for én hendelse per varsling. Hvis du vil ha **én hendelse per varsel**, legg til en [Custom Code](/docs/workflows/components#custom-code)-blokk som løper gjennom `Request Body.alerts` og oppretter en hendelse for hver. Finjuster gruppering med `group_by` i ruten din.

## Steg 2 — Konfigurer Alertmanager

Legg til en webhook-mottaker som peker mot arbeidsflyt-URL-en, og rut varsler til den. I `alertmanager.yml`:

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

Last inn Alertmanager på nytt (`curl -X POST http://localhost:9093/-/reload` eller start den på nytt).

## Steg 3 — Test det

1. Aktiver arbeidsflyten.
2. Utløs et testvarsel — for eksempel med `amtool`:

   ```bash
   amtool alert add test_alert severity=warning --annotation=summary="Test from Alertmanager" --alertmanager.url=http://localhost:9093
   ```

3. Sjekk arbeidsflytens **Logs**-fane og **Incidents**-listen din.

## Løse ved gjenoppretting (valgfritt)

Med `send_resolved: true` POSTer Alertmanager også når et varsel klarnes, denne gangen med `status: resolved`. Legg til en ny **Conditions**-gren (`status == resolved`), finn den matchende hendelsen (match på `commonLabels.alertname`), og flytt den til din løste tilstand med **Update Incident**.

## Feilsøking

- **Ingen kjøring vises** — bekreft at Alertmanager kan nå URL-en (sjekk loggene for leveringsfeil) og at arbeidsflyten er **Enabled**.
- **Hendelsesfelter er tomme** — ulike regler setter ulike merknader. Inspiser trigger-utdataene i **Logs**-fanen og referer felt som faktisk eksisterer (`commonAnnotations` vs per-varsel `annotations`).
- **For mange hendelser** — øk `group_by`/`group_interval` slik at Alertmanager grupperer relaterte varsler.

## Hvor du leser videre

- [Oversikt over integrasjoner](/docs/integrations/index) — det innkommende mønsteret.
- [Grafana](/docs/integrations/grafana) — samme idé, Grafana-varsling.
- [Webhook-trigger](/docs/workflows/triggers#webhook) — hvordan mottaks-URL-en fungerer.
