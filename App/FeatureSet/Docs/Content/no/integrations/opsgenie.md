# Opsgenie-integrasjon

Opprett et [Opsgenie](https://www.atlassian.com/software/opsgenie)-varsel hver gang en OneUptime-hendelse opprettes, og lukk det når OneUptime løser.

Denne integrasjonen er **utgående**: OneUptime kaller [Opsgenie Alert API](https://docs.opsgenie.com/docs/alert-api). Den bruker en OneUptime **[Arbeidsflyt](/docs/workflows/index)** med en **Incident → On Create**-trigger og en **API-komponent**.

```text
OneUptime Incident → On Create  ──►  API component (POST /v2/alerts)  ──►  Opsgenie alert
```

## Forutsetninger

- En Opsgenie **API-nøkkel** fra en API-integrasjon: **Settings → Integrations → Add → API**. Kopier nøkkelen.
- Kjenn din region. Standard API-vert er `https://api.opsgenie.com`; EU-kontoer bruker `https://api.eu.opsgenie.com`.
- Et OneUptime-prosjekt der du kan opprette arbeidsflyter.

## Steg 1 — Lagre API-nøkkelen

1. Gå til **Workflows → Global Variables → Create**.
2. Gi den navnet `OPSGENIE_KEY`, lim inn API-nøkkelen, og slå på **Is Secret**.

## Steg 2 — Bygg "opprett varsel"-arbeidsflyten

1. Åpne **Workflows → Create Workflow**, gi den navnet `Incidents → Opsgenie`, og åpne **Builder**.
2. Legg til en **Incident**-trigger satt til **On Create**. Gi den nytt navn `Incident`.
3. Legg til en **API**-blokk koblet til triggeren:
   - **Method**: `POST`
   - **URL**: `https://api.opsgenie.com/v2/alerts`  *(bruk `api.eu.opsgenie.com` for EU)*
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

   **`alias`** knytter dette Opsgenie-varselet til OneUptime-hendelsen slik at du kan lukke det senere via alias. Merk at Opsgenie-autentiseringsmetoden er det bokstavelige ordet `GenieKey` etterfulgt av et mellomrom og nøkkelen din.
4. **Lagre**, aktiver, og opprett en testhendelse. Et `202 Accepted`-svar i arbeidsflytloggene betyr at Opsgenie satte varselet i kø.

## Steg 3 — Lukk ved OneUptime-løsning (anbefalt)

1. Opprett en **andre** arbeidsflyt kalt `Close Opsgenie` med en **Incident → On Update**-trigger.
2. Legg til en **Conditions**-blokk som sjekker at hendelsen nå er løst (forgren på `{{Incident.currentIncidentState.name}}`).
3. Fra **Yes**, legg til en **API**-blokk:
   - **Method**: `POST`
   - **URL**: `https://api.opsgenie.com/v2/alerts/oneuptime-{{Incident._id}}/close?identifierType=alias`
   - **Headers**: samme `Authorization: GenieKey {{variable.OPSGENIE_KEY}}`
   - **Body**: `{ "source": "OneUptime", "note": "Resolved in OneUptime" }`

Opsgenie slår opp varselet via alias og lukker det.

## Prioritets-mapping (valgfritt)

Opsgenie-prioriteter går fra `P1`–`P5`. Map fra OneUptime-alvorlighetsgrader med **Conditions**-grener på `{{Incident.incidentSeverity.name}}` før API-blokken.

## Feilsøking

- **`401`/`403`** — feil nøkkel, feil regionvert, eller integrasjonen mangler rettighet til å opprette varsler. Bekreft at du bruker en **API**-integrasjonsnøkkel og den samsvarende `api`/`api.eu`-verten.
- **Lukking returnerer `404`** — `alias` på lukke-kallet må matche opprettings-kallet nøyaktig, og `identifierType=alias` må være i spørrestrengen.
- **Ingenting skjer** — bekreft at arbeidsflyten er **Enabled**.

## Hvor du leser videre

- [Oversikt over integrasjoner](/docs/integrations/index) — mønstre og autentiserings-juksearket.
- [PagerDuty](/docs/integrations/pagerduty) — det samme for PagerDuty.
- [On Call](/docs/on-call/incoming-call-policy) — OneUptime-s innebygde eskalering.
