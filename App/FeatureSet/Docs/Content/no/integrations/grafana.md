# Grafana-integrasjon

Gjør [Grafana](https://grafana.com)-varsler om til OneUptime-hendelser. Grafana evaluerer varslingsreglene på dashbordene dine; OneUptime registrerer, eskalerer og sporer dem.

Denne integrasjonen er **innkommende**: Grafanas varsling poster til en OneUptime **[Arbeidsflyt](/docs/workflows/index)** som starter med en **Webhook-trigger**, ved hjelp av et Grafana **Webhook contact point**.

```text
Grafana alert rule fires  ──►  Webhook contact point  ──►  OneUptime Webhook trigger  ──►  Create Incident
```

## Forutsetninger

- Grafana 9+ med [unified alerting](https://grafana.com/docs/grafana/latest/alerting/) aktivert (standard på moderne Grafana).
- Grafana må kunne nå OneUptime-instansen din over HTTPS.
- Et OneUptime-prosjekt der du kan opprette arbeidsflyter.

## Steg 1 — Bygg OneUptime-arbeidsflyten

1. Åpne **Workflows → Create Workflow**, gi den navnet `Grafana → Incidents`, og åpne **Builder**.
2. Legg til en **Webhook**-trigger og **kopier URL-en**. Gi blokken nytt navn til `Grafana`.
3. Legg til en **Conditions**-blokk koblet til triggeren:
   - **Left**: `{{Grafana.Request Body.status}}`
   - **Operator**: `==`
   - **Right**: `firing`
4. Fra **Yes**, legg til en **Create Incident**-blokk:
   - **Title**: `{{Grafana.Request Body.title}}`
   - **Description**: `{{Grafana.Request Body.message}}`
   - **Severity**: velg én (eller forgren på `{{Grafana.Request Body.commonLabels.severity}}`).
5. **Lagre** (la stå deaktivert til det er testet).

Grafanas webhook-nyttelast følger Alertmanager-formen — den inkluderer `status`, en `alerts`-matrise, `commonLabels` og `commonAnnotations`, pluss praktiske toppnivå-felt `title` og `message`.

## Steg 2 — Konfigurer Grafana contact point

1. I Grafana, gå til **Alerting → Contact points → Add contact point**.
2. **Name**: `OneUptime`. **Integration**: **Webhook**.
3. **URL**: lim inn arbeidsflytens webhook-URL. **HTTP Method**: `POST`.
4. Lagre contact point.
5. Gå til **Alerting → Notification policies** og rut varslene du ønsker (eller standardpolicyen) til **OneUptime** contact point.

## Steg 3 — Test det

1. Aktiver arbeidsflyten.
2. På contact point-skjermen, bruk **Test** for å sende en eksempelvarsling, eller la en ekte varslingsregel utløse.
3. Sjekk arbeidsflytens **Logs**-fane og **Incidents**-listen din.

## Løse ved gjenoppretting (valgfritt)

Når varselet klarnes, sender Grafana en ny varsling med `status: resolved`. Legg til en ny **Conditions**-gren (`status == resolved`), finn den matchende hendelsen, og flytt den til din løste tilstand med **Update Incident**.

## Merknader

- **Legacy alerting (Grafana 8 og tidligere)** sender en annen nyttelast (`ruleName`, `state`, `evalMatches`). Hvis du er på legacy alerting, referer `{{Grafana.Request Body.ruleName}}` og `{{Grafana.Request Body.state}}` i stedet, og forgren på `state == alerting`.
- Du kan også hoppe over Grafanas varsling helt og la OneUptime overvåke de samme metrikken direkte — se [Metrics Monitor](/docs/monitor/metrics-monitor).

## Feilsøking

- **Ingen kjøring vises** — bekreft at Grafana kan nå URL-en (sjekk Grafanas serverlogger) og at arbeidsflyten er **Enabled**.
- **Tomme felt** — inspiser trigger-utdataene i **Logs**-fanen; referer felt som eksisterer for din varslingsversjon.

## Hvor du leser videre

- [Oversikt over integrasjoner](/docs/integrations/index) — det innkommende mønsteret.
- [Prometheus Alertmanager](/docs/integrations/prometheus-alertmanager) — nært beslektet nyttelast.
- [Metrics Monitor](/docs/monitor/metrics-monitor) — overvåke metrikkene direkte i OneUptime.
