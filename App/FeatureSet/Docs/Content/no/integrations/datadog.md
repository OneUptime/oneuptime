# Datadog-integrasjon

Gjør [Datadog](https://www.datadoghq.com)-monitorvarsler om til OneUptime-hendelser, slik at Datadogs deteksjon mater inn i OneUptime-s hendelsesrespons og statussider.

Denne integrasjonen er **innkommende**: Datadogs [Webhooks-integrasjon](https://docs.datadoghq.com/integrations/webhooks/) poster til en OneUptime **[Arbeidsflyt](/docs/workflows/index)** som starter med en **Webhook-trigger**.

```text
Datadog monitor alerts  ──►  Webhook integration  ──►  OneUptime Webhook trigger  ──►  Create Incident
```

## Forutsetninger

- En Datadog-konto der du kan konfigurere integrasjoner og monitorer.
- Et OneUptime-prosjekt der du kan opprette arbeidsflyter.

## Steg 1 — Bygg OneUptime-arbeidsflyten

1. Åpne **Workflows → Create Workflow**, gi den navnet `Datadog → Incidents`, og åpne **Builder**.
2. Legg til en **Webhook**-trigger og **kopier URL-en**. Gi blokken nytt navn til `Datadog`.
3. Legg til en **Conditions**-blokk koblet til triggeren:
   - **Left**: `{{Datadog.Request Body.transition}}`
   - **Operator**: `==`
   - **Right**: `Triggered`
4. Fra **Yes**, legg til en **Create Incident**-blokk:
   - **Title**: `{{Datadog.Request Body.title}}`
   - **Description**: `{{Datadog.Request Body.body}}\nHost: {{Datadog.Request Body.host}}\n{{Datadog.Request Body.link}}`
   - **Severity**: velg én.
5. **Lagre** (la stå deaktivert til det er testet).

## Steg 2 — Opprett Datadog-webhoken

1. I Datadog, gå til **Integrations → Webhooks** (installer **Webhooks**-integrasjonen hvis du ikke har gjort det).
2. **Legg til en webhook**:
   - **Name**: `oneuptime` (dette blir `@webhook-oneuptime`).
   - **URL**: arbeidsflytens webhook-URL.
   - **Payload** — Datadog lar deg definere JSON-body-en ved hjelp av [malvariabler](https://docs.datadoghq.com/integrations/webhooks/#usage):

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

3. Lagre webhoken.

## Steg 3 — Send en monitors varsler til webhoken

Legg til webhook-håndtaket til monitorene du vil videresende. I hver monitors **varslingsmelding**, inkluder:

```text
{{#is_alert}}@webhook-oneuptime{{/is_alert}}
{{#is_recovery}}@webhook-oneuptime{{/is_recovery}}
```

Dette sender både varselet og gjenopprettingen til OneUptime. (For å videresende alt kan du også legge til `@webhook-oneuptime` i en monitor ubetinget.)

## Steg 4 — Test det

1. Aktiver arbeidsflyten.
2. Fra en monitor, bruk **Test Notifications → Alert**, eller la en ekte monitor utløse.
3. Sjekk arbeidsflytens **Logs**-fane og **Incidents**-listen din.

## Løse ved gjenoppretting (valgfritt)

`$ALERT_TRANSITION` er `Recovered` når en monitor klarnes. Legg til en ny **Conditions**-gren (`transition == Recovered`), finn den matchende hendelsen (match på `id`-en du sendte), og flytt den til din løste tilstand med **Update Incident**.

## Feilsøking

- **Ingen kjøring vises** — bekreft at monitorens melding inkluderer `@webhook-oneuptime` og at arbeidsflyten er **Enabled**.
- **Felt er tomme** — Datadog erstatter bare malvariabler som gjelder for hendelsen. Inspiser trigger-utdataene i **Logs**-fanen og juster webhook-nyttelasten din.
- **Duplikathendelser** — en monitor som varsler på nytt (renotify) sender flere `Triggered`-hendelser; dedupliser med en **Find Incident**-sjekk på `id`-en før du oppretter.

## Hvor du leser videre

- [Oversikt over integrasjoner](/docs/integrations/index) — det innkommende mønsteret.
- [Prometheus Alertmanager](/docs/integrations/prometheus-alertmanager) og [Grafana](/docs/integrations/grafana) — andre innkommende kilder.
- [Webhook-trigger](/docs/workflows/triggers#webhook) — hvordan mottaks-URL-en fungerer.
