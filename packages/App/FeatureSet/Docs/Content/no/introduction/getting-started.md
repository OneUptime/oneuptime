# Kom i gang

OneUptime er en observerbarhetsplattform med åpen kildekode. Den sjekker at nettstedene, API-ene og serverne dine virker, samler inn loggene, metrikkene og sporene appene dine sender, varsler den som har vakt når noe går i stykker, og holder kundene dine oppdatert på en statusside. Alt skjer i ett produkt: verktøyet som oppdager et problem, er det samme som varsler teamet ditt. Bruk OneUptime Cloud, eller kjør OneUptime på dine egne servere.

## Hva vil du gjøre?

:::cards
- [Få beskjed når nettstedet eller API-et ditt går ned](/docs/guides/website-down): Sjekk det fra sonder over hele verden, og få en e-post eller et varsel når det feiler.
- [Bli varslet via telefon, SMS eller push, og eskaler](/docs/guides/paging): Varsle den som har vakt, og den neste hvis ingen svarer.
- [Publiser en statusside på ditt eget domene](/docs/guides/status-page): Fortell kundene dine hva som skjer, på en adresse som er din egen.
- [Send logger, metrikker og spor](/docs/telemetry/open-telemetry): Send appenes telemetri med OpenTelemetry, søk i den, og bli varslet om den.
- [Overvåk en server](/docs/telemetry/hosts): Legg til en vert med én kommando, og følg med på CPU, minne og disker.
- [Overvåk en Kubernetes-klynge](/docs/telemetry/kubernetes-agent): Installer agenten med Helm, og følg med på hver node og pod.
- [Ta med teamet ditt](/docs/permissions/index): Inviter folk, del dem inn i team, og bestem hvem som kan gjøre hva.
- [Før en hendelse fra første varsel til etteranalyse](/docs/incidents/index): Erklær den, jobb med den sammen med teamet, hold kundene oppdatert, og lær av den.
:::

## Ny i OneUptime?

:::cards
- [Hurtigstart](/docs/introduction/quickstart): Overvåk et nettsted, bli varslet når det går ned, og publiser en statusside.
- [Grunnbegreper](/docs/introduction/core-concepts): De få ideene alt annet bygger på, og hvordan de henger sammen.
- [Ordliste](/docs/introduction/glossary): Hvert ord OneUptime bruker, forklart med en setning eller to og med de andre navnene sine.
- [Hvilken skal jeg bruke?](/docs/introduction/which-one): Hendelse eller varsel, arbeidsflyt eller runbook, og de andre som ligner hverandre, side om side.
:::

Kjører du OneUptime på dine egne servere? Følg [Selv-hosting-veiledning](/docs/installation/self-hosting-guide) først: den tar deg fra en tom server til en som sender e-post og varsler folk.

## Hvis du kommer fra et annet verktøy

**Prosjektinnstillinger → Avansert → Importer fra et annet verktøy** leser oppsettet ditt i et annet verktøy, med en API-nøkkel eller, for Uptime Kuma, en fil. Den viser deg hva den fant, og oppretter det du krysser av for. Ingenting endres i det andre verktøyet, og en ny import oppretter aldri noe to ganger.

Sender du allerede telemetri med Prometheus, en Loki-klient, en Splunk-forwarder, Datadog Agent eller et Sentry SDK? Behold det, og pek det mot OneUptime med en inntaksnøkkel: [Prometheus, Loki, Splunk, Datadog & Sentry](/docs/telemetry/compatible-endpoints) viser hvordan.

:::details De elleve verktøyene importen leser fra
| Du kommer fra | Hva OneUptime leser |
| --- | --- |
| [Opsgenie](/docs/moving-to-oneuptime/opsgenie) | Brukere, team, vaktplaner, eskaleringer og tjenester |
| [PagerDuty](/docs/moving-to-oneuptime/pagerduty) | Brukere, team, vaktplaner, eskaleringspolicyer og tjenester |
| [incident.io](/docs/moving-to-oneuptime/incident-io) | Brukere, team, vaktplaner, eskaleringsstier, tjenester og hendelsesinnstillinger |
| [Splunk On-Call](/docs/moving-to-oneuptime/splunk-on-call) | Brukere, team, rotasjoner og eskaleringspolicyer |
| [Grafana OnCall](/docs/moving-to-oneuptime/grafana-oncall) | Brukere, team, vaktplaner og eskaleringskjeder |
| [UptimeRobot](/docs/moving-to-oneuptime/uptimerobot) | Monitorer og offentlige statussider |
| [Atlassian Statuspage](/docs/moving-to-oneuptime/atlassian-statuspage) | Sider, komponentene og gruppene deres, og e-postabonnenter |
| [Better Stack](/docs/moving-to-oneuptime/better-stack) | Monitorer, heartbeats, statussider og e-postabonnenter |
| [Pingdom](/docs/moving-to-oneuptime/pingdom) | Oppetidssjekker |
| [StatusCake](/docs/moving-to-oneuptime/statuscake) | Oppetids-, SSL- og heartbeat-sjekker |
| [Uptime Kuma](/docs/moving-to-oneuptime/uptime-kuma) | Monitorer, fra en sikkerhetskopi eller metrikksiden |
:::

:::details Hva OneUptime erstatter
| Funksjon | Hva den gjør | Erstatter verktøy som |
| --- | --- | --- |
| Oppetidsovervåking | Sjekker tilgjengelighet og svartid fra steder over hele verden. | Pingdom, UptimeRobot |
| Statussider | Viser kundene gjeldende status og historikk for tjenestene dine. | Atlassian Statuspage |
| Hendelseshåndtering | Fører hendelser fra start til slutt, med notater, eiere og en tidslinje. | incident.io |
| Vakt og varsler | Planlegger vakter og eskalerer til noen svarer. | PagerDuty, Opsgenie |
| Logghåndtering | Samler inn, søker i og visualiserer logger. | Loggly |
| Arbeidsflyter | Automatiserer handlinger og kobler OneUptime til verktøyene du allerede bruker. | Zapier |
| Application performance monitoring | Følger spor, svartider, gjennomstrømning og feilrater. | New Relic, Datadog |
| Feilsporing | Grupperer unntak med stakkspor og kontekst. | Sentry |
:::

## Slik henger OneUptime sammen

Alt begynner med noe du følger med på. En monitor sjekker det etter en tidsplan, eller leser telemetrien det sender. Når monitorens kriterier er oppfylt, erklærer OneUptime en hendelse eller oppretter et varsel, varsler den som har vakt, og viser hendelsen på statussiden din hvis du vil det.

```mermaid title="Fra en mislykket sjekk til et varslet team og en oppdatert statusside"
flowchart TB
    probes["Sonder sjekker nettstedene<br/>og API-ene dine"] --> monitors["Monitorer"]
    telemetry["Appene og agentene dine<br/>sender telemetri"] --> monitors
    monitors -->|"kriterier oppfylt"| problems["Hendelser og varsler"]
    problems --> oncall["Vaktpolicyer<br/>varsler teamet ditt"]
    problems --> status["Statussider<br/>informerer kundene dine"]
```

- En **hendelse** er et problem som rammer brukerne dine. Den kan varsle den som har vakt, og vises på statussiden din.
- Et **varsel** er et problem teamet ditt bør se på før brukerne merker det. Det kan også varsle den som har vakt, men vises aldri på en statusside.

[Grunnbegreper](/docs/introduction/core-concepts) forklarer hver del med noen få setninger.

## Utforsk dokumentasjonen

Dokumentasjonen er organisert som sidefeltet, i ni deler. Velg den delen du trenger.

:::details Overvåking
:::cards
- [Monitorer](/docs/monitor/create-monitor): Sjekk nettsteder, API-er, porter, DNS, NTP-servere, sertifikater og mer fra sonder over hele verden.
- [Infrastrukturmonitorer](/docs/monitor/host-monitor): Følg med på servere, Kubernetes, Docker, VMware, nettverksenheter og lagring.
- [Telemetrimonitorer](/docs/monitor/logs-monitor): Få varsler om loggene, metrikkene, sporene, unntakene og profilene du sender.
- [SLO-er](/docs/slo/introduction): Følg pålitelighetsmål, feilbudsjetter og forbruksrater.
- [Sonder](/docs/probe/custom-probe): Kjør sjekker fra innsiden av ditt eget nettverk.
- [Når OneUptime ikke mottar data](/docs/monitor/when-oneuptime-is-not-receiving): Hvorfor et brudd hos OneUptime aldri teller som din nedetid.
:::
:::

:::details Hendelseshåndtering
:::cards
- [Hendelser](/docs/incidents/index): Erklær, koordiner og løs hendelser, med en fullstendig tidslinje.
- [Varsler](/docs/alerts/index): Undersøk problemer før brukerne dine merker dem, og samle støyen i episoder.
- [Vakt](/docs/on-call/index): Retningslinjer, eskaleringsregler, rotasjoner og hvem som varsles når.
- [Notifikasjoner](/docs/notifications/index): Slik når OneUptime deg: metodene, vaktreglene og varselinnstillingene dine.
- [Statussider](/docs/status-pages/index): Hold kundene oppdatert på offentlige eller private statussider.
- [Planlagt vedlikehold](/docs/scheduled-maintenance/index): Kunngjør planlagt arbeid, og sett monitorene det berører på pause.
- [Arbeidsområdetilkoblinger](/docs/workspace-connections/slack): Jobb med hendelser fra Slack og Microsoft Teams.
:::
:::

:::details Observerbarhet
:::cards
- [Telemetri](/docs/telemetry/open-telemetry): Send logger, metrikker og spor med OpenTelemetry, og søk i dem.
- [Infrastrukturagenter](/docs/telemetry/hosts): Legg til en vert med én kommando, og installer agentene for Kubernetes, Docker, Proxmox, VMware og mer.
- [App-plattformer](/docs/telemetry/cloud-environments): Overvåk appene du kjører på ECS og Fargate, Cloud Run, App Service og andre administrerte plattformer.
- [Sky](/docs/telemetry/cloud-accounts): Koble til AWS-, Azure- og Google Cloud-kontoene dine, og overvåk hver ressurs i dem.
- [AI-observerbarhet](/docs/telemetry/ai-llm-observability): Følg samtalene til AI-en din, og få beskjed når den svarer dårlig.
- [Sikkerhet](/docs/telemetry/security-events): Samle inn sikkerhetshendelser og trusseletterretning.
- [Datasikkerhet](/docs/data-security/index): Finn de sensitive dataene i bucketene, databasene og telemetrien din, og rett hvordan de oppbevares.
- [Dataobserverbarhet](/docs/data-observability/index): Få vite når dataene i databasene og datavarehusene dine er forsinket, feil eller ødelagt, og hvilken kjøring, utrulling eller tabell som står bak.
- [Real User Monitoring](/docs/rum/index): Mål hva ekte brukere opplever, med Core Web Vitals og øktavspilling.
- [Dashbord](/docs/dashboards/index): Bygg dashbord av metrikkene, loggene og monitorene dine.
- [Inventar](/docs/inventory/overview): Se hver tjeneste, vert og enhet OneUptime kjenner til.
:::
:::

:::details Automatisering og AI
:::cards
- [Runbooks](/docs/runbooks/index): Gjør beredskapsprosedyrer til trinn teamet ditt kan kjøre.
- [Skjemaer](/docs/forms/index): La hvem som helst melde et problem gjennom et skjema som åpner en hendelse.
- [Arbeidsflyter](/docs/workflows/index): Automatiser handlinger når noe skjer i OneUptime.
- [AI](/docs/ai/ai-sre): La OneUptime AI undersøke hendelser og varsler, og spør den om systemene dine.
:::
:::

:::details Integrasjoner
:::cards
- [Integrasjoner](/docs/integrations/index): Koble til Jira, ServiceNow, Grafana, Datadog, Huntress, SIEM-verktøy, Discord, Telegram, IRC og mer.
:::
:::

:::details Utviklere
:::cards
- [API-referanse](/docs/api-reference/api-reference): Automatiser OneUptime med REST-API-et.
- [CLI](/docs/cli/index): Administrer OneUptime fra terminalen og CI-en din.
- [Terraform-leverandør](/docs/terraform/index): Administrer monitorer, statussider og vakt som kode.
- [Crossplane-leverandør](/docs/crossplane/index): Administrer prosjektet fra Kubernetes med Crossplane.
:::
:::

:::details Administrasjon
:::cards
- [Brukere og tillatelser](/docs/permissions/index): Inviter folk, organiser team og styr hva de kan gjøre.
- [Identitet](/docs/identity/sso): Logg inn med SAML- eller OIDC-single sign-on, og klargjør brukere med SCIM.
- [Konfigurasjon](/docs/configuration/label-and-owner-rules): Gi ressurser etiketter og eiere automatisk.
- [E-post](/docs/emails/smtp): Send e-posten fra OneUptime gjennom din egen SMTP-server.
- [Mobil- og skrivebordsapper](/docs/mobile-desktop-apps/index): Bli varslet og svar på iOS, Android, macOS, Windows og Linux.
:::
:::

:::details Selv-hosting
:::cards
- [Installasjon](/docs/installation/self-hosting-guide): Installer, dimensjoner og oppgrader din egen OneUptime.
- [Selvhostet oppsett](/docs/self-hosted/architecture): Arkitektur, integrasjoner og Enterprise-funksjoner for din egen installasjon.
:::
:::

## Neste steg

:::cards
- [Hurtigstart](/docs/introduction/quickstart): Sett opp din første monitor, vaktpolicy og statusside.
- [Grunnbegreper](/docs/introduction/core-concepts): Lær ordene alle de andre sidene bruker.
- [Startside og snarveier](/docs/introduction/home): Finn hvilken som helst side, innstilling eller handling i dashbordet.
- [Docker Compose](/docs/installation/docker-compose): Kjør OneUptime på din egen server.
:::
