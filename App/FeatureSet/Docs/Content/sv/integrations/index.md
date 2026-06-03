# Integrationer

OneUptime ansluter till de verktyg ditt team redan använder — Zabbix, Jira, PagerDuty, Slack och många fler — via **[Arbetsflöden](/docs/workflows/index)**, den inbyggda automationsmotorn. Det finns inga separata plugins att installera. Du kopplar ihop en integration på en dra-och-släpp-arbetsyta, och den körs när något händer.

Den här sidan förklarar de två mönster som varje integration använder. När du förstår dem kan du ansluta OneUptime till nästan vad som helst, även verktyg som inte har en egen sida här.

## De två mönstren

Varje integration flyttar data i en av två riktningar (och många använder båda).

### Inkommande — ett annat verktyg skickar data till OneUptime

Använd detta när ett externt system behöver *skapa eller uppdatera något i OneUptime* — vanligtvis öppna en incident eller ett larm när det upptäcker ett problem.

1. Bygg ett arbetsflöde som börjar med en **[Webhook-utlösare](/docs/workflows/triggers#webhook)**. OneUptime ger dig en unik URL.
2. Konfigurera en webhook / notifieringsåtgärd i det andra verktyget som POSTar till den URL:en när något händer.
3. I arbetsflödet läser du den inkommande payload:en och använder en **Create Incident** (eller Create Alert)-komponent för att registrera den.

```text
Zabbix / Prometheus / Grafana / Datadog  ──►  OneUptime Webhook trigger  ──►  Create Incident
```

### Utgående — OneUptime skickar data till ett annat verktyg

Använd detta när *något i OneUptime ska visas i ett annat verktyg* — öppna ett Jira-ärende, larma någon i PagerDuty, posta till Slack.

1. Bygg ett arbetsflöde som börjar med en **[OneUptime-händelseutlösare](/docs/workflows/triggers#oneuptime-event-triggers)** — till exempel **Incident → On Create**.
2. Lägg till en **[API-komponent](/docs/workflows/components#api)** som anropar det andra verktygets REST API med incidentens uppgifter.
3. Spara eventuella API-nycklar som **hemliga [globala variabler](/docs/workflows/variables#global-variables)** så att de aldrig visas i arbetsflödet eller dess loggar.

```text
OneUptime Incident → On Create  ──►  API component  ──►  Jira / PagerDuty / ServiceNow / GitHub
```

## Katalog

| Verktyg | Riktning | Vad det gör |
| --- | --- | --- |
| [Zabbix](/docs/integrations/zabbix) | Inkommande | Omvandla Zabbix-problem till OneUptime-incidenter (och lös dem vid återhämtning). |
| [Jira](/docs/integrations/jira) | Utgående (+ inkommande) | Öppna ett Jira-ärende för varje incident; synkronisera status tillbaka. |
| [PagerDuty](/docs/integrations/pagerduty) | Utgående (+ inkommande) | Utlös och lös PagerDuty-händelser från OneUptime-incidenter. |
| [Opsgenie](/docs/integrations/opsgenie) | Utgående (+ inkommande) | Skapa och stäng Opsgenie-larm. |
| [ServiceNow](/docs/integrations/servicenow) | Utgående (+ inkommande) | Öppna ServiceNow-incidenter från OneUptime. |
| [Prometheus Alertmanager](/docs/integrations/prometheus-alertmanager) | Inkommande | Konvertera Alertmanager-notifieringar till incidenter. |
| [Grafana](/docs/integrations/grafana) | Inkommande | Konvertera Grafana-larm till incidenter. |
| [Datadog](/docs/integrations/datadog) | Inkommande | Konvertera Datadog-monitorlarm till incidenter. |
| [GitHub](/docs/integrations/github) | Utgående | Öppna ett GitHub-ärende för en incident. |
| [GitLab](/docs/integrations/gitlab) | Utgående | Öppna ett GitLab-ärende för en incident. |
| [Discord](/docs/integrations/discord) | Utgående | Posta incidentuppdateringar till en Discord-kanal. |
| [Telegram](/docs/integrations/telegram) | Utgående | Skicka incidentuppdateringar till en Telegram-chatt. |
| [Slack](/docs/workspace-connections/slack) | Båda | Inbyggd workspace-anslutning — kanaler, larm och jour. |
| [Microsoft Teams](/docs/workspace-connections/microsoft-teams) | Båda | Inbyggd workspace-anslutning. |

> **Slack och Microsoft Teams** har en djupare, inbyggd anslutning som går längre än arbetsflöden — automatiska incidentkanaler, tvåvägsåtgärder och journotifieringar. Använd [Slack-](/docs/workspace-connections/slack) och [Microsoft Teams-](/docs/workspace-connections/microsoft-teams)workspace-anslutningarna för dessa, i stället för att bygga ett arbetsflöde.

## Hantera hemligheter

Klistra aldrig in en API-nyckel eller token direkt i ett block. Gör så här i stället:

1. Gå till **Workflows → Global Variables**.
2. Skapa en variabel — till exempel `JIRA_AUTH` — och slå på **Is Secret**.
3. Referera till den var som helst med `{{variable.JIRA_AUTH}}`.

Hemliga variabler döljs i användargränssnittet när du sparar och rensas från körningsloggar. Se [Variabler](/docs/workflows/variables#global-variables).

## Autentiseringsfuskblad

De flesta utgående integrationer behöver en `Authorization`-header på API-blocket. Vanliga former:

| Schema | Header-värde | Används av |
| --- | --- | --- |
| Bearer-token | `Bearer {{variable.TOKEN}}` | GitHub, många moderna API:er |
| Basic auth | `Basic {{variable.BASE64_USER_PASS}}` | Jira, ServiceNow |
| API-nyckelheader | `GenieKey {{variable.OPSGENIE_KEY}}` | Opsgenie |
| Token i body | fältet `routing_key` i JSON-bodyn | PagerDuty Events API |
| Private token-header | `PRIVATE-TOKEN: {{variable.GITLAB_TOKEN}}` | GitLab |

För Basic auth, base64-koda `username:password` (eller `email:api_token`) **en gång**, spara sedan resultatet som hemligheten. På macOS/Linux:

```bash
printf '%s' 'you@example.com:your_api_token' | base64
```

## Hittar du inte ditt verktyg?

Nästan vilket verktyg som helst passar in i ett av de två mönstren ovan:

- Om verktyget kan **skicka en webhook** när något händer, använd det **inkommande** mönstret — peka dess webhook mot en OneUptime Webhook-utlösare.
- Om verktyget har ett **REST API**, använd det **utgående** mönstret — anropa det från en **API-komponent**.
- Om du behöver omforma data mellan de två, lägg till ett **[Custom Code](/docs/workflows/components#custom-code)**-block.

Det täcker den långa svansen — Zendesk, AWS CloudWatch (via SNS), New Relic, Splunk, StatusCake med flera. Receptet är detsamma; bara URL:en och payload:en ändras.

## Läs vidare

- [Översikt över arbetsflöden](/docs/workflows/index) — hur automationsmotorn fungerar.
- [Utlösare](/docs/workflows/triggers) — Webhook- och OneUptime-händelseutlösare i detalj.
- [Komponenter](/docs/workflows/components) — API-, Webhook- och datakomponenterna.
- [Variabler](/docs/workflows/variables) — hemligheter och att skicka data mellan block.
- [Zabbix](/docs/integrations/zabbix) och [Jira](/docs/integrations/jira) — fullständiga genomarbetade exempel.
