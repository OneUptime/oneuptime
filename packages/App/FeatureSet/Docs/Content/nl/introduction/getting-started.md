# Aan de slag

OneUptime is een opensource-observabilityplatform. Het controleert of uw websites, API's en servers werken, verzamelt de logs, metrics en traces die uw applicaties versturen, roept degene op die bereikbaarheidsdienst heeft wanneer er iets kapotgaat, en informeert uw klanten op een statuspagina. Alles gebeurt in één product: de tool die een probleem opmerkt, is dezelfde die uw team oproept. Gebruik OneUptime Cloud, of draai OneUptime op uw eigen servers.

## Wat wilt u doen?

:::cards
- [Weten wanneer uw website of API uitvalt](/docs/guides/website-down): Laat hem controleren vanaf sondes over de hele wereld, en krijg een e-mail of een oproep als hij uitvalt.
- [Opgeroepen worden via telefoon, sms of push, en escaleren](/docs/guides/paging): Roep op wie bereikbaar is, en de volgende persoon als niemand reageert.
- [Een statuspagina op uw eigen domein publiceren](/docs/guides/status-page): Vertel uw klanten wat er aan de hand is, op een eigen adres.
- [Logs, metrics en traces versturen](/docs/telemetry/open-telemetry): Verstuur de telemetrie van uw applicaties met OpenTelemetry, doorzoek die, en krijg er meldingen over.
- [Een server monitoren](/docs/telemetry/hosts): Voeg een host toe met één opdracht, en houd de CPU, het geheugen en de schijven in de gaten.
- [Een Kubernetes-cluster monitoren](/docs/telemetry/kubernetes-agent): Installeer de agent met Helm, en houd elke node en pod in de gaten.
- [Uw team erbij halen](/docs/permissions/index): Nodig mensen uit, deel ze in teams in, en bepaal wie wat mag.
- [Een incident afhandelen van de eerste oproep tot de postmortem-analyse](/docs/incidents/index): Meld het, werk eraan met uw team, houd klanten op de hoogte, en leer ervan.
:::

## Nieuw bij OneUptime?

:::cards
- [Snelstart](/docs/introduction/quickstart): Een website bewaken, opgeroepen worden als die uitvalt en een statuspagina publiceren.
- [Kernbegrippen](/docs/introduction/core-concepts): De paar ideeën waarop al het andere rust, en hoe ze samenhangen.
- [Woordenlijst](/docs/introduction/glossary): Elk woord dat OneUptime gebruikt, in een zin of twee, met de andere namen die het heeft.
- [Welke gebruik ik?](/docs/introduction/which-one): Incident of waarschuwing, workflow of runbook, en de andere dingen die op elkaar lijken, naast elkaar.
:::

Draait u OneUptime op uw eigen servers? Volg eerst de [Handleiding zelf hosten](/docs/installation/self-hosting-guide): die brengt u van een lege server naar een server die e-mail verstuurt en mensen oproept.

## Overstappen van een andere tool

**Projectinstellingen → Geavanceerd → Importeren uit een andere tool** leest uw inrichting in een andere tool, met een API-sleutel of, voor Uptime Kuma, een bestand. Het laat zien wat het heeft gevonden en maakt aan wat u aanvinkt. In de andere tool verandert niets, en de import opnieuw uitvoeren maakt nooit iets dubbel aan.

Verstuurt u al telemetrie met Prometheus, een Loki-client, een Splunk-forwarder, de Datadog Agent of een Sentry SDK? Houd die en richt hem met een ingestiesleutel op OneUptime: [Prometheus, Loki, Splunk, Datadog & Sentry](/docs/telemetry/compatible-endpoints) laat zien hoe.

:::details De elf tools waaruit het importeert
| U komt van | Wat OneUptime leest |
| --- | --- |
| [Opsgenie](/docs/moving-to-oneuptime/opsgenie) | Gebruikers, teams, roosters, escalaties en services |
| [PagerDuty](/docs/moving-to-oneuptime/pagerduty) | Gebruikers, teams, roosters, escalatiebeleid en services |
| [incident.io](/docs/moving-to-oneuptime/incident-io) | Gebruikers, teams, roosters, escalatiepaden, services en incidentinstellingen |
| [Splunk On-Call](/docs/moving-to-oneuptime/splunk-on-call) | Gebruikers, teams, rotaties en escalatiebeleid |
| [Grafana OnCall](/docs/moving-to-oneuptime/grafana-oncall) | Gebruikers, teams, roosters en escalatieketens |
| [UptimeRobot](/docs/moving-to-oneuptime/uptimerobot) | Monitoren en openbare statuspagina's |
| [Atlassian Statuspage](/docs/moving-to-oneuptime/atlassian-statuspage) | Pagina's, hun componenten en groepen, en e-mailabonnees |
| [Better Stack](/docs/moving-to-oneuptime/better-stack) | Monitoren, heartbeats, statuspagina's en e-mailabonnees |
| [Pingdom](/docs/moving-to-oneuptime/pingdom) | Uptimecontroles |
| [StatusCake](/docs/moving-to-oneuptime/statuscake) | Uptime-, SSL- en heartbeatcontroles |
| [Uptime Kuma](/docs/moving-to-oneuptime/uptime-kuma) | Monitoren, uit een back-up of de metricspagina |
:::

:::details Wat OneUptime vervangt
| Functie | Wat het doet | Vervangt tools zoals |
| --- | --- | --- |
| Uptimebewaking | Controleert beschikbaarheid en responstijd vanaf locaties over de hele wereld. | Pingdom, UptimeRobot |
| Statuspagina's | Laat klanten de huidige status en geschiedenis van uw services zien. | Atlassian Statuspage |
| Incidentbeheer | Begeleidt incidenten van begin tot eind, met notities, eigenaren en een tijdlijn. | incident.io |
| Bereikbaarheid en waarschuwingen | Plant bereikbaarheidsdiensten en escaleert tot iemand reageert. | PagerDuty, Opsgenie |
| Logbeheer | Verzamelt, doorzoekt en visualiseert logs. | Loggly |
| Workflows | Automatiseert acties en koppelt OneUptime aan de tools die u al gebruikt. | Zapier |
| Application performance monitoring | Volgt traces, responstijden, doorvoer en foutpercentages. | New Relic, Datadog |
| Foutopsporing | Groepeert exceptions met stacktraces en context. | Sentry |
:::

## Hoe OneUptime in elkaar grijpt

Alles begint met iets wat u bewaakt. Een monitor controleert het volgens een schema, of leest de telemetrie die het verstuurt. Wanneer aan de criteria van de monitor wordt voldaan, meldt OneUptime een incident of maakt het een waarschuwing aan, roept het degene op die dienst heeft, en toont het het incident op uw statuspagina als u dat wilt.

```mermaid title="Van een mislukte controle naar een opgeroepen team en een bijgewerkte statuspagina"
flowchart TB
    probes["Sondes controleren<br/>uw sites en API's"] --> monitors["Monitoren"]
    telemetry["Uw applicaties en agents<br/>versturen telemetrie"] --> monitors
    monitors -->|"criteria voldaan"| problems["Incidenten en waarschuwingen"]
    problems --> oncall["Bereikbaarheidsbeleid<br/>roept uw team op"]
    problems --> status["Statuspagina's<br/>informeren uw klanten"]
```

- Een **incident** is een probleem dat uw gebruikers raakt. Het kan degene oproepen die dienst heeft, en op uw statuspagina verschijnen.
- Een **waarschuwing** is een probleem waar uw team naar moet kijken voordat gebruikers het merken. Ook die kan degene oproepen die dienst heeft, maar verschijnt nooit op een statuspagina.

[Kernbegrippen](/docs/introduction/core-concepts) legt elk onderdeel in een paar zinnen uit.

## De documentatie verkennen

De documentatie is net als de zijbalk ingedeeld in negen secties. Kies het deel dat u nodig hebt.

:::details Monitoring
:::cards
- [Monitoren](/docs/monitor/create-monitor): Websites, API's, poorten, DNS, NTP-servers, certificaten en meer controleren vanaf sondes over de hele wereld.
- [Infrastructuurmonitoren](/docs/monitor/host-monitor): Servers, Kubernetes, Docker, VMware, netwerkapparaten en opslag bewaken.
- [Telemetriemonitoren](/docs/monitor/logs-monitor): Waarschuwen op de logs, metrics, traces, exceptions en profielen die u verstuurt.
- [SLO's](/docs/slo/introduction): Betrouwbaarheidsdoelen, foutbudgetten en burn rates volgen.
- [Sondes](/docs/probe/custom-probe): Controles uitvoeren vanuit uw eigen netwerk.
- [Wanneer OneUptime geen gegevens ontvangt](/docs/monitor/when-oneuptime-is-not-receiving): Waarom een gat aan de kant van OneUptime nooit als uw downtime telt.
:::
:::

:::details Incidentrespons
:::cards
- [Incidenten](/docs/incidents/index): Incidenten melden, coördineren en oplossen, met een volledige tijdlijn.
- [Waarschuwingen](/docs/alerts/index): Problemen bekijken voordat je gebruikers ze merken, en de ruis bundelen in episodes.
- [Bereikbaarheid](/docs/on-call/index): Beleid, escalatieregels, roosters en wie wanneer wordt opgeroepen.
- [Meldingen](/docs/notifications/index): Hoe OneUptime je bereikt: je methoden, bereikbaarheidsregels en meldingsinstellingen.
- [Statuspagina's](/docs/status-pages/index): Klanten op de hoogte houden op openbare of privé-statuspagina's.
- [Gepland onderhoud](/docs/scheduled-maintenance/index): Gepland werk aankondigen, en de monitoren die het raakt pauzeren.
- [Workspace-koppelingen](/docs/workspace-connections/slack): Incidenten afhandelen vanuit Slack en Microsoft Teams.
:::
:::

:::details Observability
:::cards
- [Telemetrie](/docs/telemetry/open-telemetry): Logs, metrics en traces versturen met OpenTelemetry, en erin zoeken.
- [Infrastructuuragents](/docs/telemetry/hosts): Een host toevoegen met één opdracht, en de agents voor Kubernetes, Docker, Proxmox, VMware en meer installeren.
- [App-platforms](/docs/telemetry/cloud-environments): De apps bewaken die je draait op ECS en Fargate, Cloud Run, App Service en andere beheerde platforms.
- [Cloud](/docs/telemetry/cloud-accounts): Je AWS-, Azure- en Google Cloud-accounts koppelen en elke resource erin bewaken.
- [AI-observability](/docs/telemetry/ai-llm-observability): De gesprekken van uw AI volgen, en horen wanneer die slecht antwoordt.
- [Beveiliging](/docs/telemetry/security-events): Beveiligingsgebeurtenissen en dreigingsinformatie verzamelen.
- [Gegevensbeveiliging](/docs/data-security/index): De gevoelige gegevens in uw buckets, databases en telemetrie vinden, en verbeteren hoe ze worden bewaard.
- [Data-observability](/docs/data-observability/index): Weet wanneer de gegevens in uw databases en datawarehouses te laat, onjuist of kapot zijn, en welke run, deploy of tabel erachter zit.
- [Real User Monitoring](/docs/rum/index): Meten wat echte gebruikers ervaren, met Core Web Vitals en session replay.
- [Dashboards](/docs/dashboards/index): Dashboards bouwen van uw metrics, logs en monitoren.
- [Inventaris](/docs/inventory/overview): Elke service, host en elk apparaat zien dat OneUptime kent.
:::
:::

:::details Automatisering & AI
:::cards
- [Runbooks](/docs/runbooks/index): Responsprocedures omzetten in stappen die uw team kan uitvoeren.
- [Formulieren](/docs/forms/index): Iedereen een probleem laten melden via een formulier dat een incident opent.
- [Workflows](/docs/workflows/index): Acties automatiseren wanneer er iets gebeurt in OneUptime.
- [AI](/docs/ai/ai-sre): OneUptime AI incidenten en waarschuwingen laten onderzoeken, en er vragen over uw systemen aan stellen.
:::
:::

:::details Integraties
:::cards
- [Integraties](/docs/integrations/index): Jira, ServiceNow, Grafana, Datadog, Huntress, SIEM-tools, Discord, Telegram, IRC en meer koppelen.
:::
:::

:::details Ontwikkelaars
:::cards
- [API-referentie](/docs/api-reference/api-reference): OneUptime automatiseren met de REST API.
- [CLI](/docs/cli/index): OneUptime beheren vanuit uw terminal en uw CI.
- [Terraform-provider](/docs/terraform/index): Monitoren, statuspagina's en bereikbaarheid als code beheren.
- [Crossplane-provider](/docs/crossplane/index): Uw project met Crossplane vanuit Kubernetes beheren.
:::
:::

:::details Beheer
:::cards
- [Gebruikers en machtigingen](/docs/permissions/index): Mensen uitnodigen, teams organiseren en bepalen wat ze mogen doen.
- [Identiteit](/docs/identity/sso): Inloggen met SAML- of OIDC-single sign-on, en gebruikers inrichten met SCIM.
- [Configuratie](/docs/configuration/label-and-owner-rules): Resources automatisch labelen en aan eigenaren toewijzen.
- [E-mails](/docs/emails/smtp): De e-mail van OneUptime via uw eigen SMTP-server versturen.
- [Mobiele en desktopapps](/docs/mobile-desktop-apps/index): Opgeroepen worden en reageren op iOS, Android, macOS, Windows en Linux.
:::
:::

:::details Zelf hosten
:::cards
- [Installatie](/docs/installation/self-hosting-guide): Uw eigen OneUptime installeren, dimensioneren en bijwerken.
- [Zelf-gehoste inrichting](/docs/self-hosted/architecture): Architectuur, integraties en Enterprise-functies voor uw eigen installatie.
:::
:::

## Volgende stappen

:::cards
- [Snelstart](/docs/introduction/quickstart): Uw eerste monitor, bereikbaarheidsbeleid en statuspagina inrichten.
- [Kernbegrippen](/docs/introduction/core-concepts): De woorden leren die elke andere pagina gebruikt.
- [Startpagina en sneltoetsen](/docs/introduction/home): Elke pagina, instelling of actie in het dashboard vinden.
- [Docker Compose](/docs/installation/docker-compose): OneUptime op uw eigen server draaien.
:::
