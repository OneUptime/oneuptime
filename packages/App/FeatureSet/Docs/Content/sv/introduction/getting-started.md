# Kom igång

OneUptime är en observerbarhetsplattform med öppen källkod. Den kontrollerar att dina webbplatser, API:er och servrar fungerar, samlar in loggarna, mätvärdena och spåren som dina appar skickar, larmar den som har jour när något går sönder och håller dina kunder informerade på en statussida. Allt sker i en och samma produkt: verktyget som upptäcker ett problem är samma verktyg som larmar ditt team. Använd OneUptime Cloud, eller kör OneUptime på dina egna servrar.

Börja här:

:::cards
- [Snabbstart](/docs/introduction/quickstart): Övervaka en webbplats, bli larmad när den går ner och publicera en statussida.
- [Grundbegrepp](/docs/introduction/core-concepts): De få idéer som allt annat bygger på, och hur de hänger ihop.
- [Startsida och kortkommandon](/docs/introduction/home): Hitta rätt i instrumentpanelen, och tangenterna som sparar dig klick.
- [Ditt konto](/docs/introduction/your-account): Din profil, ditt lösenord, passnycklar och tvåfaktorsautentisering.
:::

## Så hänger OneUptime ihop

Allt börjar med något som du håller koll på. En monitor kontrollerar det enligt ett schema, eller läser telemetrin som det skickar. När monitorns kriterier uppfylls deklarerar OneUptime en incident eller skapar en varning, larmar den som har jour och visar incidenten på din statussida om du vill.

```mermaid title="Från en misslyckad kontroll till ett larmat team och en uppdaterad statussida"
flowchart TB
    probes["Sonder kontrollerar dina<br/>webbplatser och API:er"] --> monitors["Monitorer"]
    telemetry["Dina appar och agenter<br/>skickar telemetri"] --> monitors
    monitors -->|"kriterier uppfyllda"| problems["Incidenter och varningar"]
    problems --> oncall["Jourpolicyer<br/>larmar ditt team"]
    problems --> status["Statussidor<br/>informerar dina kunder"]
```

- En **incident** är ett problem som drabbar dina användare. Den kan larma den som har jour och visas på din statussida.
- En **varning** är ett problem som ditt team bör titta på innan användarna märker det. Den kan också larma den som har jour, men visas aldrig på en statussida.

[Grundbegrepp](/docs/introduction/core-concepts) förklarar varje del med några få meningar.

## Utforska dokumentationen

Dokumentationen är ordnad som sidofältet, i nio avsnitt. Välj den del du behöver.

### Övervakning

:::cards
- [Monitorer](/docs/monitor/create-monitor): Kontrollera webbplatser, API:er, portar, DNS, NTP-servrar, certifikat och mer från sonder runt om i världen.
- [Infrastrukturmonitorer](/docs/monitor/server-monitor): Håll koll på servrar, Kubernetes, Docker, VMware, nätverksenheter och lagring.
- [Telemetrimonitorer](/docs/monitor/logs-monitor): Få varningar om loggarna, mätvärdena, spåren, undantagen och profilerna du skickar.
- [SLO:er](/docs/slo/introduction): Följ tillförlitlighetsmål, felbudgetar och förbrukningstakt.
- [Sonder](/docs/probe/custom-probe): Kör kontroller inifrån ditt eget nätverk.
- [När OneUptime inte tar emot data](/docs/monitor/when-oneuptime-is-not-receiving): Varför ett avbrott hos OneUptime aldrig räknas som din driftstörning.
:::

### Incidenthantering

:::cards
- [Incidenter](/docs/incidents/index): Deklarera, samordna och lös incidenter, med en fullständig tidslinje.
- [Jour](/docs/on-call/schedules): Rotationer, eskaleringsregler och vem som larmas när.
- [Statussidor](/docs/status-pages/index): Håll kunderna informerade på offentliga eller privata statussidor.
- [Arbetsytekopplingar](/docs/workspace-connections/slack): Arbeta med incidenter från Slack och Microsoft Teams.
:::

### Observerbarhet

:::cards
- [Telemetri](/docs/telemetry/open-telemetry): Skicka loggar, mätvärden och spår med OpenTelemetry, och sök i dem.
- [Infrastrukturagenter](/docs/telemetry/kubernetes-agent): Installera agenterna för Kubernetes, värdar, Docker, Proxmox, VMware och mer.
- [Moln](/docs/telemetry/cloud-environments): Observera ECS, Cloud Run, Azure Container Apps och andra hanterade plattformar.
- [AI-observerbarhet](/docs/telemetry/ai-llm-observability): Följ din AI:s konversationer och få veta när den svarar dåligt.
- [Säkerhet](/docs/telemetry/security-events): Samla in säkerhetshändelser och hotinformation.
- [Real User Monitoring](/docs/rum/index): Mät vad riktiga användare upplever, med Core Web Vitals och sessionsuppspelning.
- [Instrumentpaneler](/docs/dashboards/index): Bygg instrumentpaneler av dina mätvärden, loggar och monitorer.
- [Inventarie](/docs/inventory/overview): Se varje tjänst, värd och enhet som OneUptime känner till.
:::

### Automatisering & AI

:::cards
- [Runbooks](/docs/runbooks/index): Gör om insatsrutiner till steg som ditt team kan köra.
- [Formulär](/docs/forms/index): Låt vem som helst rapportera ett problem via ett formulär som öppnar en incident.
- [Arbetsflöden](/docs/workflows/index): Automatisera åtgärder när något händer i OneUptime.
- [AI](/docs/ai/ai-sre): Låt OneUptime AI undersöka incidenter och varningar, och fråga den om dina system.
:::

### Integrationer

:::cards
- [Integrationer](/docs/integrations/index): Koppla Jira, ServiceNow, Grafana, Datadog, Huntress, SIEM-verktyg, Discord, Telegram, IRC och mer.
:::

### Utvecklare

:::cards
- [API-referens](/docs/api-reference/api-reference): Automatisera OneUptime med dess REST-API.
- [CLI](/docs/cli/index): Hantera OneUptime från din terminal och din CI.
- [Terraform-leverantör](/docs/terraform/index): Hantera monitorer, statussidor och jour som kod.
:::

### Administration

:::cards
- [Användare och behörigheter](/docs/permissions/index): Bjud in personer, organisera team och styr vad de får göra.
- [Identitet](/docs/identity/sso): Logga in med SAML- eller OIDC-single sign-on, och etablera användare med SCIM.
- [Konfiguration](/docs/configuration/label-and-owner-rules): Ge resurser etiketter och ägare automatiskt.
- [E-post](/docs/emails/smtp): Skicka OneUptimes e-post via din egen SMTP-server.
- [Mobil- och skrivbordsappar](/docs/mobile-desktop-apps/index): Bli larmad och svara på iOS, Android, macOS, Windows och Linux.
:::

### Självhosting

:::cards
- [Installation](/docs/installation/docker-compose): Installera, dimensionera och uppgradera ditt eget OneUptime.
- [Självhostad konfiguration](/docs/self-hosted/architecture): Arkitektur, integrationer och Enterprise-funktioner för din egen installation.
:::

## Om du kommer från ett annat verktyg

### Ta med dig din konfiguration

**Projektinställningar → Importera från ett annat verktyg** läser din konfiguration i ett annat verktyg, med en API-nyckel eller, för Uptime Kuma, en fil. Den visar vad den hittade och skapar det du kryssar i. Inget ändras i det andra verktyget, och en ny import skapar aldrig något två gånger.

| Du kommer från | Vad OneUptime läser |
| --- | --- |
| [Opsgenie](/docs/moving-to-oneuptime/opsgenie) | Användare, team, scheman, eskaleringar och tjänster |
| [PagerDuty](/docs/moving-to-oneuptime/pagerduty) | Användare, team, scheman, eskaleringspolicyer och tjänster |
| [incident.io](/docs/moving-to-oneuptime/incident-io) | Användare, team, scheman, eskaleringsvägar, tjänster och incidentinställningar |
| [Splunk On-Call](/docs/moving-to-oneuptime/splunk-on-call) | Användare, team, rotationer och eskaleringspolicyer |
| [Grafana OnCall](/docs/moving-to-oneuptime/grafana-oncall) | Användare, team, scheman och eskaleringskedjor |
| [UptimeRobot](/docs/moving-to-oneuptime/uptimerobot) | Monitorer och offentliga statussidor |
| [Atlassian Statuspage](/docs/moving-to-oneuptime/atlassian-statuspage) | Sidor, deras komponenter och grupper samt e-postprenumeranter |
| [Better Stack](/docs/moving-to-oneuptime/better-stack) | Monitorer, heartbeats, statussidor och e-postprenumeranter |
| [Pingdom](/docs/moving-to-oneuptime/pingdom) | Drifttidskontroller |
| [StatusCake](/docs/moving-to-oneuptime/statuscake) | Drifttids-, SSL- och heartbeat-kontroller |
| [Uptime Kuma](/docs/moving-to-oneuptime/uptime-kuma) | Monitorer, från en säkerhetskopia eller mätvärdessidan |

### Vad OneUptime ersätter

| Funktion | Vad den gör | Ersätter verktyg som |
| --- | --- | --- |
| Drifttidsövervakning | Kontrollerar tillgänglighet och svarstid från platser runt om i världen. | Pingdom, UptimeRobot |
| Statussidor | Visar kunderna aktuell status och historik för dina tjänster. | Atlassian Statuspage |
| Incidenthantering | Driver incidenter från början till slut, med anteckningar, ägare och en tidslinje. | incident.io |
| Jour och varningar | Schemalägger jourpass och eskalerar tills någon svarar. | PagerDuty, Opsgenie |
| Logghantering | Samlar in, söker i och visualiserar loggar. | Loggly |
| Arbetsflöden | Automatiserar åtgärder och kopplar OneUptime till verktygen du redan använder. | Zapier |
| Application performance monitoring | Följer spår, svarstider, genomströmning och felfrekvenser. | New Relic, Datadog |
| Felspårning | Grupperar undantag med stackspår och sammanhang. | Sentry |

## Nästa steg

:::cards
- [Snabbstart](/docs/introduction/quickstart): Konfigurera din första monitor, jourpolicy och statussida.
- [Grundbegrepp](/docs/introduction/core-concepts): Lär dig orden som alla andra sidor använder.
- [Startsida och kortkommandon](/docs/introduction/home): Hitta vilken sida, inställning eller åtgärd som helst i instrumentpanelen.
- [Docker Compose](/docs/installation/docker-compose): Kör OneUptime på din egen server.
:::
