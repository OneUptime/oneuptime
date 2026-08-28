# Integrasjoner

OneUptime kobler seg til verktøyene teamet ditt allerede bruker — Zabbix, Jira, PagerDuty, Slack og mange flere — gjennom **[Arbeidsflyter](/docs/workflows/index)**, den innebygde automatiseringsmotoren. Det er ingen separat plugin å installere. Du kobler en integrasjon sammen på et dra-og-slipp-lerret, og den kjører hver gang noe skjer.

Denne siden forklarer de to mønstrene enhver integrasjon bruker. Når du forstår dem, kan du koble OneUptime til nesten hva som helst, selv verktøy som ikke har sin egen side her.

## De to mønstrene

Enhver integrasjon flytter data i én av to retninger (og mange bruker begge).

### Innkommende — et annet verktøy sender data til OneUptime

Bruk dette når et eksternt system må _opprette eller oppdatere noe i OneUptime_ — vanligvis åpne en hendelse eller et varsel når det oppdager et problem.

1. Bygg en arbeidsflyt som starter med en **[Webhook-trigger](/docs/workflows/triggers#webhook)**. OneUptime gir deg en unik URL.
2. I det andre verktøyet konfigurerer du en webhook- / varslingshandling som POSTer til den URL-en når noe skjer.
3. I arbeidsflyten leser du den innkommende nyttelasten og bruker en **Create Incident**-komponent (eller Create Alert) for å registrere den.

```text
Zabbix / Prometheus / Grafana / Datadog  ──►  OneUptime Webhook trigger  ──►  Create Incident
```

> **Tips:** Spesielt for varslingsverktøy er en **[Incoming Request-monitor](/docs/monitor/incoming-request-monitor)** som regel den bedre innkommende veien. Den gir deg en webhook-URL uten at du må bygge en arbeidsflyt, åpner én hendelse per varsel i nyttelasten, eskalerer til en vaktordning og løser hver hendelse når verktøyet melder at den er gjenopprettet. Bruk en arbeidsflyt når du trenger logikk OneUptime ikke gjør nativt. Se [Prometheus Alertmanager](/docs/integrations/prometheus-alertmanager) for et fullstendig eksempel.

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
| [Microsoft Dynamics 365](/docs/integrations/microsoft-dynamics-365)   | Utgående (+ innkommende) | Åpne og løse Dynamics 365 Cases fra OneUptime-hendelser.                            |
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

1. Gå til **Arbeidsflyter → Globale variabler**.
2. Opprett en variabel — for eksempel `JIRA_AUTH` — og slå på **Secret**.
3. Referer til den hvor som helst med `{{global.variables.JIRA_AUTH}}`.

Hemmelige variabler er skjult i brukergrensesnittet etter at du lagrer, og vaskes bort fra kjøreloggene. Se [Variabler](/docs/workflows/variables#global-variables).

## Autentiserings-jukseark

De fleste utgående integrasjoner trenger en `Authorization`-header på API-blokken. De vanlige formene:

| Metode                       | Headerverdi                                        | Brukes av                           |
| --------------------------- | -------------------------------------------------- | ----------------------------------- |
| Bearer-token                | `Bearer {{global.variables.TOKEN}}`                | GitHub, mange moderne API-er        |
| Basic auth                  | `Basic {{global.variables.BASE64_USER_PASS}}`      | Jira Cloud, ServiceNow              |
| API-nøkkel-header           | `GenieKey {{global.variables.OPSGENIE_KEY}}`       | Opsgenie                            |
| Token i body                | `routing_key`-felt i JSON-body-en                  | PagerDuty Events API                |
| Private token-header        | `PRIVATE-TOKEN: {{global.variables.GITLAB_TOKEN}}` | GitLab                              |
| OAuth 2.0 client credentials | `Bearer <token fetched by an earlier API block>`   | Microsoft Dynamics 365 (Dataverse)  |

For Basic auth: base64-kod `username:password` (eller `email:api_token`) **én gang**, og lagre resultatet som hemmeligheten. På macOS/Linux:

```bash
printf '%s' 'you@example.com:your_api_token' | base64
```

## Finner du ikke verktøyet ditt?

Nesten ethvert verktøy passer inn i ett av de to mønstrene ovenfor:

- Hvis verktøyet kan **sende en webhook** når noe skjer, bruker du det **innkommende** mønsteret — pek webhooken mot en [Incoming Request-monitor](/docs/monitor/incoming-request-monitor) hvis det er et varslingsverktøy, eller mot en OneUptime Webhook-trigger hvis du trenger egendefinert logikk.
- Hvis verktøyet har et **REST API**, bruker du det **utgående** mønsteret — kall det fra en **API-komponent**.
- Hvis du trenger å omforme data mellom de to, legger du inn en **[Custom Code](/docs/workflows/components#custom-code)**-blokk.

Det dekker den lange halen — Zendesk, AWS CloudWatch (via SNS), New Relic, Splunk, StatusCake og så videre. Oppskriften er den samme; bare URL-en og nyttelasten endres.

## Hvor du leser videre

- [Oversikt over arbeidsflyter](/docs/workflows/index) — hvordan automatiseringsmotoren fungerer.
- [Triggere](/docs/workflows/triggers) — Webhook- og OneUptime-hendelsestriggere i detalj.
- [Komponenter](/docs/workflows/components) — API-, Webhook- og datakomponentene.
- [Variabler](/docs/workflows/variables) — hemmeligheter og å sende data mellom blokker.
- [Incoming Request-monitor](/docs/monitor/incoming-request-monitor) — den arbeidsflytfrie innkommende veien for varslingsverktøy.
- [Zabbix](/docs/integrations/zabbix), [Jira](/docs/integrations/jira) og [Microsoft Dynamics 365](/docs/integrations/microsoft-dynamics-365) — fullstendige utarbeidede eksempler.
