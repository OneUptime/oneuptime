# Integrasjoner

OneUptime kobler seg til verktøyene teamet ditt allerede bruker — Zabbix, Jira, PagerDuty, Slack og mange flere — gjennom **[Arbeidsflyter](/docs/workflows/index)**, den innebygde automatiseringsmotoren. Det er ingen separat plugin å installere. Du kobler en integrasjon sammen på et dra-og-slipp-lerret, og den kjører hver gang noe skjer.

Denne siden forklarer de to mønstrene enhver integrasjon bruker. Når du forstår dem, kan du koble OneUptime til nesten hva som helst, selv verktøy som ikke har sin egen side her.

## De to mønstrene

Enhver integrasjon flytter data i én av to retninger (og mange bruker begge).

### Innkommende — et annet verktøy sender data til OneUptime

Bruk dette når et eksternt system må _opprette eller oppdatere noe i OneUptime_ — vanligvis åpne en hendelse eller et varsel når det oppdager et problem.

1. Bygg en arbeidsflyt som starter med en **[Webhook-trigger](/docs/workflows/triggers#webhook)**. OneUptime gir deg en unik URL.
2. I det andre verktøyet, konfigurer en webhook / varslingshendelse som POSTer til den URL-en når noe skjer.
3. I arbeidsflyten, les den innkommende nyttelasten og bruk en **Create Incident**-komponent (eller Create Alert) for å registrere den.

```text
Zabbix / Prometheus / Grafana / Datadog  ──►  OneUptime Webhook trigger  ──►  Create Incident
```

### Utgående — OneUptime sender data til et annet verktøy

Bruk dette når _noe i OneUptime skal vises i et annet verktøy_ — åpne en Jira-sak, varsle noen i PagerDuty, poste til Slack.

1. Bygg en arbeidsflyt som starter med en **[OneUptime-hendelsestrigger](/docs/workflows/triggers#oneuptime-event-triggers)** — for eksempel **Incident → On Create**.
2. Legg til en **[API-komponent](/docs/workflows/components#api)** som kaller det andre verktøyets REST API med hendelsens detaljer.
3. Lagre alle API-nøkler som **hemmelige [globale variabler](/docs/workflows/variables#global-variables)** slik at de aldri vises i arbeidsflyten eller dens logger.

```text
OneUptime Incident → On Create  ──►  API component  ──►  Jira / PagerDuty / ServiceNow / GitHub
```

## Katalog

| Verktøy                                                               | Retning                  | Hva det gjør                                                                        |
| --------------------------------------------------------------------- | ------------------------ | ----------------------------------------------------------------------------------- |
| [Zabbix](/docs/integrations/zabbix)                                   | Innkommende              | Gjøre Zabbix-problemer om til OneUptime-hendelser (og løse dem ved gjenoppretting). |
| [Jira](/docs/integrations/jira)                                       | Utgående (+ innkommende) | Åpne en Jira-sak for hver hendelse; synkronisere status tilbake.                    |
| [PagerDuty](/docs/integrations/pagerduty)                             | Utgående (+ innkommende) | Utløse og løse PagerDuty-hendelser fra OneUptime-hendelser.                         |
| [Opsgenie](/docs/integrations/opsgenie)                               | Utgående (+ innkommende) | Opprette og lukke Opsgenie-varsler.                                                 |
| [ServiceNow](/docs/integrations/servicenow)                           | Utgående (+ innkommende) | Åpne ServiceNow-hendelser fra OneUptime.                                            |
| [Prometheus Alertmanager](/docs/integrations/prometheus-alertmanager) | Innkommende              | Konvertere Alertmanager-varsler til hendelser.                                      |
| [Grafana](/docs/integrations/grafana)                                 | Innkommende              | Konvertere Grafana-varsler til hendelser.                                           |
| [Datadog](/docs/integrations/datadog)                                 | Innkommende              | Konvertere Datadog-monitorvarsler til hendelser.                                    |
| [GitHub](/docs/integrations/github)                                   | Utgående                 | Åpne en GitHub-sak for en hendelse.                                                 |
| [GitLab](/docs/integrations/gitlab)                                   | Utgående                 | Åpne en GitLab-sak for en hendelse.                                                 |
| [Discord](/docs/integrations/discord)                                 | Utgående                 | Poste hendelsesoppdateringer til en Discord-kanal.                                  |
| [Telegram](/docs/integrations/telegram)                               | Utgående                 | Sende hendelsesoppdateringer til en Telegram-chat.                                  |
| [Slack](/docs/workspace-connections/slack)                            | Begge                    | Innebygd arbeidsområdetilkobling — kanaler, varsler og vaktordning.                 |
| [Microsoft Teams](/docs/workspace-connections/microsoft-teams)        | Begge                    | Innebygd arbeidsområdetilkobling.                                                   |

> **Slack og Microsoft Teams** har en dypere, innebygd tilkobling som går utover arbeidsflyter — automatiske hendelseskanaler, toveis-handlinger og vaktordningsvarsler. Bruk [Slack](/docs/workspace-connections/slack)- og [Microsoft Teams](/docs/workspace-connections/microsoft-teams)-arbeidsområdetilkoblingene for dette i stedet for å bygge en arbeidsflyt.

## Håndtering av hemmeligheter

Lim aldri en API-nøkkel eller et token direkte inn i en blokk. Gjør i stedet slik:

1. Gå til **Workflows → Global Variables**.
2. Opprett en variabel — for eksempel `JIRA_AUTH` — og slå på **Is Secret**.
3. Referer til den hvor som helst med `{{variable.JIRA_AUTH}}`.

Hemmelige variabler er skjult i brukergrensesnittet etter at du lagrer, og renses fra kjøringslogger. Se [Variabler](/docs/workflows/variables#global-variables).

## Autentiserings-jukseark

De fleste utgående integrasjoner trenger en `Authorization`-header på API-blokken. De vanlige formene:

| Metode               | Headerverdi                                | Brukes av                    |
| -------------------- | ------------------------------------------ | ---------------------------- |
| Bearer-token         | `Bearer {{variable.TOKEN}}`                | GitHub, mange moderne API-er |
| Basic auth           | `Basic {{variable.BASE64_USER_PASS}}`      | Jira, ServiceNow             |
| API-nøkkel-header    | `GenieKey {{variable.OPSGENIE_KEY}}`       | Opsgenie                     |
| Token i body         | `routing_key`-felt i JSON-body-en          | PagerDuty Events API         |
| Private token-header | `PRIVATE-TOKEN: {{variable.GITLAB_TOKEN}}` | GitLab                       |

For Basic auth: base64-kod `brukernavn:passord` (eller `e-post:api_token`) **én gang**, og lagre resultatet som hemmeligheten. På macOS/Linux:

```bash
printf '%s' 'you@example.com:your_api_token' | base64
```

## Finner du ikke verktøyet ditt?

Nesten ethvert verktøy passer inn i ett av de to mønstrene ovenfor:

- Hvis verktøyet kan **sende en webhook** når noe skjer, bruk det **innkommende** mønsteret — pek webhoken mot en OneUptime Webhook-trigger.
- Hvis verktøyet har et **REST API**, bruk det **utgående** mønsteret — kall det fra en **API-komponent**.
- Hvis du trenger å omforme data mellom de to, legg inn en **[Custom Code](/docs/workflows/components#custom-code)**-blokk.

Det dekker den lange halen — Zendesk, AWS CloudWatch (via SNS), New Relic, Splunk, StatusCake og så videre. Oppskriften er den samme; bare URL-en og nyttelasten endres.

## Hvor du leser videre

- [Oversikt over arbeidsflyter](/docs/workflows/index) — hvordan automatiseringsmotoren fungerer.
- [Triggere](/docs/workflows/triggers) — Webhook- og OneUptime-hendelsestrigger i detalj.
- [Komponenter](/docs/workflows/components) — API-, Webhook- og datakomponentene.
- [Variabler](/docs/workflows/variables) — hemmeligheter og å sende data mellom blokker.
- [Zabbix](/docs/integrations/zabbix) og [Jira](/docs/integrations/jira) — fullstendige utarbeidede eksempler.
