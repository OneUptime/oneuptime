# Integrationer

OneUptime forbinder sig med de værktøjer, dit team allerede bruger — Zabbix, Jira, PagerDuty, Slack og mange flere — via **[Workflows](/docs/workflows/index)**, det indbyggede automatiseringsmotor. Der er ingen separat plugin at installere. Du sætter en integration sammen på et træk-og-slip-lærred, og den kører, når der sker noget.

Denne side forklarer de to mønstre, som alle integrationer bruger. Når du forstår dem, kan du forbinde OneUptime med næsten alt — selv værktøjer, der ikke har deres egen side her.

## De to mønstre

Enhver integration bevæger data i én af to retninger (og mange bruger begge).

### Indgående — et andet værktøj sender data til OneUptime

Brug dette, når et eksternt system har brug for at _oprette eller opdatere noget i OneUptime_ — typisk åbne en hændelse eller en alarm, når det opdager et problem.

1. Byg et workflow, der starter med en **[Webhook-trigger](/docs/workflows/triggers#webhook)**. OneUptime giver dig en unik URL.
2. I det andet værktøj konfigurerer du en webhook/notifikationshandling, der POSTer til den URL, når noget sker.
3. I workflowet læser du den indkommende payload og bruger en **Create Incident**-komponent (eller Create Alert) til at registrere det.

```text
Zabbix / Prometheus / Grafana / Datadog  ──►  OneUptime Webhook trigger  ──►  Create Incident
```

### Udgående — OneUptime sender data til et andet værktøj

Brug dette, når _noget i OneUptime skal vises i et andet værktøj_ — åbn en Jira-ticket, kontakt nogen i PagerDuty, post til Slack.

1. Byg et workflow, der starter med en **[OneUptime event-trigger](/docs/workflows/triggers#oneuptime-event-triggers)** — for eksempel **Incident → On Create**.
2. Tilføj en **[API-komponent](/docs/workflows/components#api)**, der kalder det andet værktøjs REST API med hændelsens detaljer.
3. Gem eventuelle API-nøgler som **hemmelige [globale variabler](/docs/workflows/variables#global-variables)**, så de aldrig vises i workflowet eller dets logfiler.

```text
OneUptime Incident → On Create  ──►  API component  ──►  Jira / PagerDuty / ServiceNow / GitHub
```

## Katalog

| Værktøj                                                               | Retning                | Hvad det gør                                                                  |
| --------------------------------------------------------------------- | ---------------------- | ----------------------------------------------------------------------------- |
| [Zabbix](/docs/integrations/zabbix)                                   | Indgående              | Gør Zabbix-problemer til OneUptime-hændelser (og løser dem ved genopretning). |
| [Jira](/docs/integrations/jira)                                       | Udgående (+ indgående) | Åbn en Jira-sag for hver hændelse; synkronisér status tilbage.                |
| [PagerDuty](/docs/integrations/pagerduty)                             | Udgående (+ indgående) | Udløs og løs PagerDuty-events fra OneUptime-hændelser.                        |
| [Opsgenie](/docs/integrations/opsgenie)                               | Udgående (+ indgående) | Opret og luk Opsgenie-alarmer.                                                |
| [ServiceNow](/docs/integrations/servicenow)                           | Udgående (+ indgående) | Åbn ServiceNow-hændelser fra OneUptime.                                       |
| [Prometheus Alertmanager](/docs/integrations/prometheus-alertmanager) | Indgående              | Konvertér Alertmanager-notifikationer til hændelser.                          |
| [Grafana](/docs/integrations/grafana)                                 | Indgående              | Konvertér Grafana-alarmer til hændelser.                                      |
| [Datadog](/docs/integrations/datadog)                                 | Indgående              | Konvertér Datadog-monitoralarmer til hændelser.                               |
| [GitHub](/docs/integrations/github)                                   | Udgående               | Åbn en GitHub-sag for en hændelse.                                            |
| [GitLab](/docs/integrations/gitlab)                                   | Udgående               | Åbn en GitLab-sag for en hændelse.                                            |
| [Discord](/docs/integrations/discord)                                 | Udgående               | Post hændelsesopdateringer til en Discord-kanal.                              |
| [Telegram](/docs/integrations/telegram)                               | Udgående               | Send hændelsesopdateringer til en Telegram-chat.                              |
| [Slack](/docs/workspace-connections/slack)                            | Begge                  | Indbygget workspace-forbindelse — kanaler, alarmer og vagtplan.               |
| [Microsoft Teams](/docs/workspace-connections/microsoft-teams)        | Begge                  | Indbygget workspace-forbindelse.                                              |

> **Slack og Microsoft Teams** har en dybere, native forbindelse, der rækker ud over workflows — automatiske hændelseskanaler, tovejshandlinger og vagtnotifikationer. Brug [Slack](/docs/workspace-connections/slack)- og [Microsoft Teams](/docs/workspace-connections/microsoft-teams)-workspace-forbindelserne til dem i stedet for at bygge et workflow.

## Håndtering af hemmeligheder

Indsæt aldrig en API-nøgle eller et token direkte i en blok. Gør i stedet følgende:

1. Gå til **Workflows → Global Variables**.
2. Opret en variabel — for eksempel `JIRA_AUTH` — og slå **Is Secret** til.
3. Referer til den overalt med `{{variable.JIRA_AUTH}}`.

Hemmelige variabler er skjulte i brugergrænsefladen, efter du gemmer, og renses fra kørselslogfiler. Se [Variabler](/docs/workflows/variables#global-variables).

## Autentificeringsoversigt

De fleste udgående integrationer kræver en `Authorization`-header på API-blokken. De almindelige former:

| Skema                | Headerværdi                                | Bruges af                    |
| -------------------- | ------------------------------------------ | ---------------------------- |
| Bearer-token         | `Bearer {{variable.TOKEN}}`                | GitHub, mange moderne API'er |
| Basic auth           | `Basic {{variable.BASE64_USER_PASS}}`      | Jira, ServiceNow             |
| API-nøgleheader      | `GenieKey {{variable.OPSGENIE_KEY}}`       | Opsgenie                     |
| Token i body         | `routing_key`-feltet i JSON-bodyen         | PagerDuty Events API         |
| Private token-header | `PRIVATE-TOKEN: {{variable.GITLAB_TOKEN}}` | GitLab                       |

Til Basic auth base64-enkoder du `brugernavn:adgangskode` (eller `email:api_token`) **én gang**, og gemmer derefter resultatet som hemmelighed. På macOS/Linux:

```bash
printf '%s' 'you@example.com:your_api_token' | base64
```

## Finder du ikke dit værktøj?

Næsten ethvert værktøj passer ind i ét af de to mønstre ovenfor:

- Hvis værktøjet kan **sende en webhook**, når noget sker, brug det **indgående** mønster — peg dets webhook mod en OneUptime Webhook-trigger.
- Hvis værktøjet har en **REST API**, brug det **udgående** mønster — kald det fra en **API-komponent**.
- Hvis du har brug for at omforme data mellem de to, indsæt en **[Custom Code](/docs/workflows/components#custom-code)**-blok.

Det dækker den lange hale — Zendesk, AWS CloudWatch (via SNS), New Relic, Splunk, StatusCake og så videre. Opskriften er den samme; kun URL og payload ændrer sig.

## Læs videre

- [Workflows – Oversigt](/docs/workflows/index) — hvordan automatiseringsmotoren fungerer.
- [Triggere](/docs/workflows/triggers) — Webhook- og OneUptime event-triggere i detaljer.
- [Komponenter](/docs/workflows/components) — API-, Webhook- og datakomponenter.
- [Variabler](/docs/workflows/variables) — hemmeligheder og videregivelse af data mellem blokke.
- [Zabbix](/docs/integrations/zabbix) og [Jira](/docs/integrations/jira) — fuldt udarbejdede eksempler.
