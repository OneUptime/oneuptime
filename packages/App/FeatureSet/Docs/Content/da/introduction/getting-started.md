# Kom godt i gang

OneUptime er en open source-platform til observability. Den tjekker, at dine websteder, API'er og servere virker, indsamler de logs, metrikker og traces, dine applikationer sender, tilkalder den, der har vagt, når noget går ned, og holder dine kunder orienteret på en statusside. Det hele sker i ét produkt: værktøjet, der opdager et problem, er det samme, der tilkalder dit team. Brug OneUptime Cloud, eller kør OneUptime på dine egne servere.

Start her:

:::cards
- [Hurtigstart](/docs/introduction/quickstart): Overvåg et websted, bliv tilkaldt når det går ned, og udgiv en statusside.
- [Grundbegreber](/docs/introduction/core-concepts): De få idéer, som alt andet bygger på, og hvordan de hænger sammen.
- [Startside og genveje](/docs/introduction/home): Find rundt i dashboardet, og de taster, der sparer dig for klik.
- [Din konto](/docs/introduction/your-account): Din profil, din adgangskode, adgangsnøgler og totrinsgodkendelse.
:::

## Sådan hænger OneUptime sammen

Alt begynder med noget, du holder øje med. En monitor tjekker det efter en tidsplan eller læser den telemetri, det sender. Når monitorens kriterier er opfyldt, erklærer OneUptime en hændelse eller opretter en advarsel, tilkalder den, der har vagt, og viser hændelsen på din statusside, hvis du ønsker det.

```mermaid title="Fra et fejlet tjek til et tilkaldt team og en opdateret statusside"
flowchart TB
    probes["Sonder tjekker dine<br/>websteder og API'er"] --> monitors["Monitorer"]
    telemetry["Dine applikationer og agenter<br/>sender telemetri"] --> monitors
    monitors -->|"kriterier opfyldt"| problems["Hændelser og advarsler"]
    problems --> oncall["Vagtpolitikker<br/>tilkalder dit team"]
    problems --> status["Statussider<br/>informerer dine kunder"]
```

- En **hændelse** er et problem, der rammer dine brugere. Den kan tilkalde den, der har vagt, og blive vist på din statusside.
- En **advarsel** er et problem, dit team bør se på, før brugerne opdager det. Den kan også tilkalde den, der har vagt, men vises aldrig på en statusside.

[Grundbegreber](/docs/introduction/core-concepts) forklarer hver del med få sætninger.

## Udforsk dokumentationen

Dokumentationen er opbygget som sidepanelet, i ni afsnit. Vælg den del, du har brug for.

### Overvågning

:::cards
- [Monitorer](/docs/monitor/create-monitor): Tjek websteder, API'er, porte, DNS, NTP-servere, certifikater og meget mere fra sonder over hele verden.
- [Infrastrukturmonitorer](/docs/monitor/server-monitor): Hold øje med servere, Kubernetes, Docker, VMware, netværksudstyr og lagring.
- [Telemetrimonitorer](/docs/monitor/logs-monitor): Få advarsler om de logs, metrikker, traces, undtagelser og profiler, du sender.
- [SLO'er](/docs/slo/introduction): Følg pålidelighedsmål, fejlbudgetter og forbrugsrater.
- [Sonder](/docs/probe/custom-probe): Kør tjek inde fra dit eget netværk.
- [Når OneUptime ikke modtager data](/docs/monitor/when-oneuptime-is-not-receiving): Hvorfor et hul hos OneUptime aldrig tæller som din nedetid.
:::

### Hændelseshåndtering

:::cards
- [Hændelser](/docs/incidents/index): Erklær, koordiner og løs hændelser med en komplet tidslinje.
- [Vagt](/docs/on-call/schedules): Rotationer, eskaleringsregler og hvem der tilkaldes hvornår.
- [Statussider](/docs/status-pages/index): Hold kunderne orienteret på offentlige eller private statussider.
- [Workspace-forbindelser](/docs/workspace-connections/slack): Arbejd med hændelser fra Slack og Microsoft Teams.
:::

### Observability

:::cards
- [Telemetri](/docs/telemetry/open-telemetry): Send logs, metrikker og traces med OpenTelemetry, og søg i dem.
- [Infrastrukturagenter](/docs/telemetry/kubernetes-agent): Installér agenterne til Kubernetes, værter, Docker, Proxmox, VMware og meget mere.
- [Cloud](/docs/telemetry/cloud-environments): Observer ECS, Cloud Run, Azure Container Apps og andre administrerede platforme.
- [AI-observability](/docs/telemetry/ai-llm-observability): Følg din AI's samtaler, og få besked, når den svarer dårligt.
- [Sikkerhed](/docs/telemetry/security-events): Indsaml sikkerhedshændelser og trusselsefterretninger.
- [Real User Monitoring](/docs/rum/index): Mål, hvad rigtige brugere oplever, med Core Web Vitals og sessionsafspilning.
- [Dashboards](/docs/dashboards/index): Byg dashboards ud fra dine metrikker, logs og monitorer.
- [Inventar](/docs/inventory/overview): Se hver tjeneste, vært og enhed, OneUptime kender.
:::

### Automatisering & AI

:::cards
- [Runbooks](/docs/runbooks/index): Gør beredskabsprocedurer til trin, dit team kan køre.
- [Formularer](/docs/forms/index): Lad alle melde et problem via en formular, der åbner en hændelse.
- [Arbejdsgange](/docs/workflows/index): Automatisér handlinger, når der sker noget i OneUptime.
- [AI](/docs/ai/ai-sre): Lad OneUptime AI undersøge hændelser og advarsler, og spørg den om dine systemer.
:::

### Integrationer

:::cards
- [Integrationer](/docs/integrations/index): Forbind Jira, ServiceNow, Grafana, Datadog, Huntress, SIEM-værktøjer, Discord, Telegram, IRC og meget mere.
:::

### Udviklere

:::cards
- [API-reference](/docs/api-reference/api-reference): Automatisér OneUptime med dets REST API.
- [CLI](/docs/cli/index): Administrér OneUptime fra din terminal og din CI.
- [Terraform-udbyder](/docs/terraform/index): Administrér monitorer, statussider og vagter som kode.
:::

### Administration

:::cards
- [Brugere og tilladelser](/docs/permissions/index): Invitér personer, organisér teams og styr, hvad de må.
- [Identitet](/docs/identity/sso): Log ind med SAML- eller OIDC-single sign-on, og klargør brugere med SCIM.
- [Konfiguration](/docs/configuration/label-and-owner-rules): Giv ressourcer etiketter og ejere automatisk.
- [E-mails](/docs/emails/smtp): Send OneUptimes e-mails via din egen SMTP-server.
- [Mobil- og desktopapps](/docs/mobile-desktop-apps/index): Bliv tilkaldt og reager på iOS, Android, macOS, Windows og Linux.
:::

### Selv-hosting

:::cards
- [Installation](/docs/installation/docker-compose): Installér, dimensionér og opgradér din egen OneUptime.
- [Selvhostet opsætning](/docs/self-hosted/architecture): Arkitektur, integrationer og Enterprise-funktioner til din egen installation.
:::

## Hvis du kommer fra et andet værktøj

### Tag din opsætning med

**Projektindstillinger → Importér fra et andet værktøj** læser din opsætning i et andet værktøj, med en API-nøgle eller, for Uptime Kuma, en fil. Den viser dig, hvad den fandt, og opretter det, du sætter flueben ved. Intet ændres i det andet værktøj, og en ny import opretter aldrig noget to gange.

| Du kommer fra | Hvad OneUptime læser |
| --- | --- |
| [Opsgenie](/docs/moving-to-oneuptime/opsgenie) | Brugere, teams, planer, eskaleringer og tjenester |
| [PagerDuty](/docs/moving-to-oneuptime/pagerduty) | Brugere, teams, planer, eskaleringspolitikker og tjenester |
| [incident.io](/docs/moving-to-oneuptime/incident-io) | Brugere, teams, planer, eskaleringsstier, tjenester og hændelsesindstillinger |
| [Splunk On-Call](/docs/moving-to-oneuptime/splunk-on-call) | Brugere, teams, rotationer og eskaleringspolitikker |
| [Grafana OnCall](/docs/moving-to-oneuptime/grafana-oncall) | Brugere, teams, planer og eskaleringskæder |
| [UptimeRobot](/docs/moving-to-oneuptime/uptimerobot) | Monitorer og offentlige statussider |
| [Atlassian Statuspage](/docs/moving-to-oneuptime/atlassian-statuspage) | Sider, deres komponenter og grupper samt e-mailabonnenter |
| [Better Stack](/docs/moving-to-oneuptime/better-stack) | Monitorer, heartbeats, statussider og e-mailabonnenter |
| [Pingdom](/docs/moving-to-oneuptime/pingdom) | Oppetidstjek |
| [StatusCake](/docs/moving-to-oneuptime/statuscake) | Oppetids-, SSL- og heartbeat-tjek |
| [Uptime Kuma](/docs/moving-to-oneuptime/uptime-kuma) | Monitorer, fra en sikkerhedskopi eller metriksiden |

### Hvad OneUptime erstatter

| Funktion | Hvad den gør | Erstatter værktøjer som |
| --- | --- | --- |
| Oppetidsovervågning | Tjekker tilgængelighed og svartid fra steder over hele verden. | Pingdom, UptimeRobot |
| Statussider | Viser kunderne den aktuelle status og historikken for dine tjenester. | Atlassian Statuspage |
| Hændelsesstyring | Fører hændelser fra start til slut, med noter, ejere og en tidslinje. | incident.io |
| Vagter og advarsler | Planlægger vagter og eskalerer, indtil nogen reagerer. | PagerDuty, Opsgenie |
| Loghåndtering | Indsamler, søger i og visualiserer logs. | Loggly |
| Arbejdsgange | Automatiserer handlinger og forbinder OneUptime med de værktøjer, du allerede bruger. | Zapier |
| Application performance monitoring | Følger traces, svartider, gennemløb og fejlrater. | New Relic, Datadog |
| Fejlsporing | Grupperer undtagelser med stakspor og kontekst. | Sentry |

## Næste trin

:::cards
- [Hurtigstart](/docs/introduction/quickstart): Opsæt din første monitor, vagtpolitik og statusside.
- [Grundbegreber](/docs/introduction/core-concepts): Lær de ord, som alle andre sider bruger.
- [Startside og genveje](/docs/introduction/home): Find enhver side, indstilling eller handling i dashboardet.
- [Docker Compose](/docs/installation/docker-compose): Kør OneUptime på din egen server.
:::
