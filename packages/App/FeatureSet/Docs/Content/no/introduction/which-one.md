# Hvilken skal jeg bruke?

Noen ting i OneUptime ligner på hverandre. Denne siden stiller hvert sett opp side om side, med hva hver av dem er til, slik at du velger riktig første gang. Hver tabell får plass på én skjerm, og den første kolonnen åpner siden som dekker det valget i detalj.

:::cards
- [Hendelse, varsel eller en annen type problem?](#hendelse-varsel-eller-en-annen-type-problem): Hva et problem blir til i OneUptime.
- [Arbeidsflyt, runbook, playbook eller AI-regel?](#arbeidsflyt-runbook-playbook-eller-ai-regel): Hva du skal automatisere med.
- [Monitorgruppe, tjeneste eller etikett?](#monitorgruppe-tjeneste-eller-etikett): Hvordan du grupperer det du overvåker.
- [Sonde, agent, collector eller Runner?](#sonde-agent-collector-eller-runner): Hva du skal installere, og nøkkelen hver av dem bruker.
- [Dashbord, offentlig dashbord eller statusside?](#dashbord-offentlig-dashbord-eller-statusside): Hva du skal dele, og med hvem.
:::

## Hendelse, varsel eller en annen type problem?

De fleste problemer er en hendelse eller et varsel: velg ut fra hvem problemet rammer. De andre er poster OneUptime fører for deg, og hver av dem kan føre til en hendelse eller et varsel.

| Post | Hva det er | Bruk det når |
| --- | --- | --- |
| [Hendelse](/docs/incidents/index) | Et problem som rammer brukerne dine. Den kan tilkalle den som har vakt, og vises på statussidene dine. | Kundene merker det nå eller snart: et brudd, en treghet, en betaling som feiler. |
| [Varsel](/docs/alerts/index) | Et problem for teamet ditt. Det kan tilkalle den som har vakt, men vises aldri på en statusside. | Teamet ditt bør handle før brukerne merker det: en disk som holder på å bli full, et sertifikat som snart utløper. |
| [Episode](/docs/incidents/episodes) | En gruppe relaterte hendelser, eller relaterte varsler, som håndteres som én. | Én årsak utløste mange hendelser eller varsler. Grupperingsregler åpner episoder for deg. |
| [Unntak](/docs/telemetry/exceptions) | Hver forekomst av én feil koden din kaster, samlet, med stakksporet. | Du vil rette en feil. En unntaksmonitor kan opprette et varsel eller en hendelse når feilene skyter i været. |
| [KI-innsikt](/docs/ai/ai-sre#innsikt-proaktiv-oppdagelse) | Et problem OneUptime fant i telemetrien din før noe tilkalte noen, for eksempel en topp i feillogger. | Du vil ha tidlige signaler. En innsikt tilkaller aldri noen og åpner aldri en hendelse: den venter i en innboks. |
| [Sikkerhetssak](/docs/telemetry/security-cases) | Én trussel som er verdt å undersøke, med alle deteksjoner om samme bruker, vert eller adresse samlet i den. | Sikkerhetsteamet ditt undersøker. **Erklær hendelse** på en sak åpner en hendelse når brukere er berørt. |

Et varsel kan kobles til hendelsen det viste seg å være en del av, så du mister ingenting på å starte med et varsel.

## Arbeidsflyt, runbook, playbook eller AI-regel?

Alle fire kan kjøre av seg selv. Velg ut fra hva de handler på, og hvem som skrev trinnene.

| Verktøy | Hva det gjør | Bruk det når |
| --- | --- | --- |
| [Arbeidsflyt](/docs/workflows/index) | Blokker på et lerret som kjører når triggeren utløses: en hendelse opprettes, en tidsplan forfaller, et annet verktøy kaller en URL. | Du vil koble OneUptime til andre verktøy, eller handle på postene, uten å skrive kode. |
| [Runbook](/docs/runbooks/index) | Responsprosedyren din som trinn, fra manuelle sjekklister til skript, HTTP-forespørsler og kubectl, kjørt på en hendelse, et varsel eller en vedlikeholdshendelse. | De som håndterer hendelser, skal følge de samme trinnene hver gang. Runbook-regler starter et runbook på hendelsene som treffer. |
| [Playbook](/docs/telemetry/security-cases#playbooks) | Trinn som reagerer på en sikkerhetssak: sikre bevisene, tilkalle den som har vakt, suspendere en bruker. | Sikkerhetsteamet ditt reagerer på samme type trussel på samme måte hver gang. |
| [AI-regel](/docs/ai/ai-sre#hvilke-hendelser-som-undersøkes-og-rettes) | Avgjør hvilke nye hendelser og varsler OneUptime AI undersøker og retter, og om den spør først. | OneUptime AI skal bare jobbe med noen hendelser, eller rette uten å spørre. Uten en regel undersøker den hver eneste en. |

## Monitorgruppe, tjeneste eller etikett?

Alle tre samler ting, men for ulike lesere. De virker også sammen: monitorene til en tjeneste kan utgjøre én monitorgruppe, og alle kan ha samme etikett.

| Valg | Hva det er | Bruk det når |
| --- | --- | --- |
| [Monitorgruppe](/docs/monitor/monitor-groups) | Flere monitorer samlet i én status, den verste blant dem, med egen oppetid. | Kundene skal se én rad på en statusside for noe som består av flere monitorer, for eksempel Checkout. |
| [Tjeneste](/docs/telemetry/services) | En applikasjon OneUptime fant i telemetrien din, med logger, spor, metrikker, hendelser og eiere på én side. | Du vil ha alt om én applikasjon på ett sted. Den dukker opp av seg selv ut fra `service.name`. |
| [Etikett](/docs/configuration/label-and-owner-rules) | Et merke du setter på monitorer og de fleste andre poster. En post kan ha mange. | Du vil filtrere lister, begrense et teams tillatelser eller plukke ut poster i regler. |

Monitorgrupper er slått av fra start: slå dem på under **Prosjektinnstillinger → Avansert → Funksjonsflagg**.

## Sonde, agent, collector eller Runner?

Det meste av OneUptime trenger ingen installasjon: installer noe bare for å nå det OneUptime ikke kan se utenfra. Hver av dem kobler seg ut, med en nøkkel av sin egen type.

| Installasjon | Hva den gjør | Installer den når | Nøkkelen den bruker |
| --- | --- | --- | --- |
| [Egendefinert sonde](/docs/probe/custom-probe) | Kjører monitorenes sjekker fra innsiden av nettverket ditt. | Det du sjekker, er bak brannmuren din. OneUptimes egne sonder sjekker det som er offentlig. | Egen sonde-ID og nøkkel |
| [Infrastrukturagent](/docs/monitor/server-monitor) | Rapporterer én maskins CPU, minne, disker og prosesser til en Server / VM-monitor. | Du vil ha én monitor for én server, med kriterier på tallene. | Monitorens hemmelige nøkkel |
| [OpenTelemetry Collector](/docs/telemetry/hosts) | Sender en maskins metrikker, logger og prosesser. **Legg til vert** installerer den med én kommando. | Du vil ha en maskin under **Verter**, med telemetrien dens. | En inntaksnøkkel |
| [Kubernetes-agent](/docs/telemetry/kubernetes-agent) | Samler inn en klynges metrikker, hendelser, logger og spor. Du installerer den med Helm. | Du kjører Kubernetes. | En inntaksnøkkel |
| [Runner](/docs/runbooks/agents) | Kjører runbook-trinn, for eksempel Bash, SSH og kubectl, inne i infrastrukturen din. | Runbookene dine må nå dine egne verter og klynger. | Egen Runner-ID og nøkkel |

### Inntaksnøkkel eller API-nøkkel?

| Nøkkel | Hva den lar deg gjøre | Hvor du oppretter den |
| --- | --- | --- |
| [Inntaksnøkkel](/docs/telemetry/ingestion-keys) | Sende telemetri inn i prosjektet, og ingenting annet. | **Prosjektinnstillinger → Telemetri og APM → Inntaksnøkler** |
| [API-nøkkel](/docs/permissions/index#api-nøkler) | Lese og endre prosjektet gjennom API-et, CLI-en, Terraform eller en AI-assistent, med tillatelsene du gir den. | **Prosjektinnstillinger → Avansert → API-nøkler** |

Ingen av dem virker i stedet for den andre.

## Dashbord, offentlig dashbord eller statusside?

Velg ut fra hvem som skal se det.

| Deling | Hvem ser det | Bruk det når |
| --- | --- | --- |
| [Dashbord](/docs/dashboards/index) | Folk som logger inn i prosjektet ditt. | Teamet ditt følger med på diagrammer og lister: en vaktskjerm, et teams egen visning. |
| [Offentlig dashbord](/docs/dashboards/sharing) | Alle med lenken, med mindre du legger til et passord, begrenser det til bestemte IP-adresser eller legger det på ditt eget domene. | Folk utenfor prosjektet skal se diagrammene dine, for eksempel en partner eller en skjerm på veggen. |
| [Statusside](/docs/status-pages/index) | Kundene dine, offentlig, eller bare de private brukerne du slipper inn. | Kundene vil vite om tjenestene dine virker, og få beskjed om hendelser og vedlikehold. |

En statusside snakker i hendelser og i navnene du gir monitorene dine; et dashbord viser tallene bak dem.

## Neste steg

:::cards
- [Ordliste](/docs/introduction/glossary): Hvert ord OneUptime bruker, forklart med en setning eller to.
- [Grunnbegreper](/docs/introduction/core-concepts): Hvordan delene henger sammen, på én side.
- [Hurtigstart](/docs/introduction/quickstart): En monitor, en tilkalling og en statusside på femten minutter.
:::
