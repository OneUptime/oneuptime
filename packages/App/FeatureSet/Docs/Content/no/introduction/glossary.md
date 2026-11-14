# Ordliste

Hvert ord OneUptime bruker, forklart med en setning eller to, med de andre navnene det går under og siden som dekker det i detalj. Ordene er gruppert slik du møter dem: den første gruppen er løkken hvert prosjekt kjører, og den siste er ordene som betyr mer enn én ting.

:::cards
- [Start her](#start-her): Løkken hvert prosjekt kjører, fra en monitor til en tilkalling og en statusside.
- [Det du overvåker](#det-du-overvåker): Tjenester, verter, klynger, skyer og målene du holder dem til.
- [Arbeid med et problem](#arbeid-med-et-problem): Tilstander, alvorlighetsgrader, eiere og etiketter, og de andre typene problemer.
- [Telemetri og dashbord](#telemetri-og-dashbord): Det systemene dine sender, og hvor du ser på det.
- [Automatisering og AI](#automatisering-og-ai): Det som kjører av seg selv, og det OneUptime AI gjør.
- [Det du installerer, og nøklene](#det-du-installerer-og-nøklene): Agentene du kjører, og nøkkelen hver av dem bruker.
- [Ord med mer enn én betydning](#ord-med-mer-enn-én-betydning): Regel, rolle, ressurs, innstillinger og de andre ordene med flere oppgaver.
:::

## Start her

### Prosjekt

Der alt du setter opp, ligger: monitorer, hendelser, vakt, statussider, telemetri og innstillinger. Ingenting i ett prosjekt er synlig i et annet, og de fleste bedrifter trenger bare ett.

Se [Grunnbegreper](/docs/introduction/core-concepts#prosjekter-og-personer).

### Konto

Deg: e-posten og passordet du logger inn med, navnet ditt, tidssonen og språket ditt. Én konto kan høre til så mange prosjekter du vil.

Se [Kontoen din](/docs/introduction/your-account).

### Team

En gruppe personer i et prosjekt, der tillatelsene avgjør hva medlemmene kan gjøre. Hvert nytt prosjekt starter med tre team: Owners, Admin og Members. Inviter folk under **Brukere**, og grupper dem under **Team**.

Se [Brukere, team og tillatelser](/docs/permissions/index).

### Overvåking

Sjekker én ting du kjører, for eksempel et nettsted, et API, en server eller en Kubernetes-klynge, og avgjør om den virker. Når kriteriene treffer, endrer den status og kan erklære en hendelse eller opprette et varsel.

Se [Opprett en monitor](/docs/monitor/create-monitor).

### Kriterier

En monitors regler: hva hvert sjekkresultat betyr. De sjekkes i rekkefølge, og det første som treffer, kan endre monitorens status, erklære en hendelse, opprette et varsel eller alle tre.

Også kalt: **Overvåkingskriterier**, **Monitorkriterier**, **Monitor Steps**. Se [Kriterier og statuser](/docs/monitor/criteria-and-statuses).

### Monitorstatus

Det en monitor er akkurat nå. Hvert nytt prosjekt har tre monitorstatuser, **I drift**, **Redusert** og **Frakoblet**, og du kan legge til dine egne.

Se [Kriterier og statuser](/docs/monitor/criteria-and-statuses).

### Sonde

En maskin som kjører monitorenes sjekker etter en tidsplan: den henter en side, kaller et API eller pinger en vert. OneUptime Cloud kjører sonder i flere regioner, og en egendefinert sonde du kjører i ditt eget nettverk, sjekker det bare det nettverket kan nå.

Også kalt: **Egendefinerte probes**. Se [Egendefinerte probes](/docs/probe/custom-probe).

### Hendelse

Et problem som rammer brukerne dine, for eksempel et brudd eller en treghet, og posten teamet ditt jobber ut fra så lenge det varer. Den kan tilkalle den som har vakt, og vises på statussidene dine.

Se [Hendelser – Oversikt](/docs/incidents/index).

### Varsel

Et problem teamet ditt bør se på før brukerne merker det, for eksempel en disk som holder på å bli full, eller et sertifikat som snart utløper. Det kan tilkalle den som har vakt, men det vises aldri på en statusside.

Se [Varsler – Oversikt](/docs/alerts/index).

### Episode

En gruppe relaterte hendelser, eller relaterte varsler, som teamet ditt håndterer som én, med ett sett eiere og én tilstand. Grupperingsregler avgjør hva som hører til i hver.

Også kalt: **Hendelsesepisode**, **Varselsepisode**. Se [Episoder](/docs/incidents/episodes).

### Vaktpolicy

Avgjør hvem som tilkalles om en hendelse, et varsel eller en episode, og hvem som er neste hvis ingen bekrefter. Nivåene er eskaleringsregler.

Også kalt: **Vakttjeneste**, **On-Call Duty Policy**, **Vakt**, `OnCallDutyPolicy`. Se [Vaktretningslinjer](/docs/on-call/policies).

### Eskaleringsregel

Ett nivå i en vaktpolicy: hvem som tilkalles, og hvor lenge det ventes på at noen bekrefter før neste nivå tilkalles. Et nivå kan tilkalle personer, team eller en vaktplan.

Se [Eskaleringsregler](/docs/on-call/escalation-rules).

### Vakttidsplan

Hvem som har vakt til enhver tid: folk bytter på, og hver av dem overlater til den neste. En eskaleringsregel som tilkaller en vaktplan, tilkaller den som har vakt i den.

Også kalt: **Rotation**, **Vaktplan for vaktpolicy**. Se [Vaktplaner](/docs/on-call/schedules).

### Lag

Én rotasjon i en vaktplan: hvem som bytter på, hvor ofte vakten overleveres, og hvilke timer laget dekker. Det øverste laget der noen har vakt, er det som varsler, så hovedrotasjonen legges øverst og reservedekningen under.

Se [Vaktplaner](/docs/on-call/schedules#lag).

### Varselmetode

En adresse OneUptime kan nå deg på i et prosjekt: en e-postadresse, et telefonnummer for SMS eller anrop, Slack- eller Microsoft Teams-kontoen din eller OneUptime-appen på telefonen din. Hver person legger til sine egne under **Brukerinnstillinger**.

Se [Varselmetoder](/docs/notifications/notification-methods).

### Slik når man meg

Dine egne regler for å bli tilkalt: hvilke av varselmetodene dine en tilkalling prøver, og etter hvor lang tid. Én stige dekker hver hendelse, hvert varsel og hver episode, og en alvorlighetsgrad kan ha egne regler. Hver person setter opp sine egne under **Brukerinnstillinger**.

Også kalt: **Personlige vaktregler**. Se [Slik når man meg](/docs/notifications/on-call-rules).

### Statusside

En side som viser kundene dine om tjenestene dine virker, og hendelsene og vedlikeholdet som påvirker dem. Den kan være offentlig, eller privat for dem du slipper inn.

Se [Statussider – Oversikt](/docs/status-pages/index).

### Abonnent

En som følger en statusside på e-post, SMS, Slack, Microsoft Teams eller webhook, og får beskjed når en hendelse eller et vedlikehold på den starter, endres og avsluttes.

Se [Abonnenter og kunngjøringer](/docs/status-pages/subscribers).

### Planlagt vedlikehold

Planlagt arbeid, kunngjort på forhånd. Hver vedlikeholdshendelse går gjennom vedlikeholdstilstandene **Planlagt**, **Pågående**, **Avsluttet** og **Fullført**, og statussidene den vises på, forteller besøkende og abonnenter om den.

Også kalt: **Planlagt vedlikeholdshendelse**, **Planlagt hendelse**, **Hendelse**. Se [Planlagt vedlikehold – Oversikt](/docs/scheduled-maintenance/index).

### Telemetri

Det systemene dine sender til OneUptime: logger, metrikker, spor, unntak og profiler. Apper sender den med OpenTelemetry, og agentene til OneUptime sender den fra verter, klynger og annen infrastruktur, hver med en inntaksnøkkel.

Se [OpenTelemetry](/docs/telemetry/open-telemetry).

## Det du overvåker

### Monitorgruppe

Flere monitorer samlet i én status, den verste blant dem, med egen oppetid. En statusside kan vise hele gruppen som én rad. Slå på monitorgrupper under **Prosjektinnstillinger → Avansert → Funksjonsflagg**.

Se [Monitorgrupper](/docs/monitor/monitor-groups).

### Tjeneste

En applikasjon eller mikrotjeneste du kjører. OneUptime legger den til første gang telemetrien dens kommer inn, navngitt etter `service.name`, og samler loggene, sporene, metrikkene, unntakene, hendelsene og eierne dens på én side.

Også kalt: **Tjenestekatalog**, **Telemetritjeneste**. Se [Tjenester](/docs/telemetry/services).

### Vert

En Linux-, Windows- eller macOS-maskin som sender metrikkene, prosessene, loggene og tjenestetilstandene sine gjennom OpenTelemetry Collector. **Legg til vert** installerer innsamleren med én kommando, og OneUptime holder konfigurasjonen oppdatert.

Se [Verter](/docs/telemetry/hosts).

### Kubernetes

Kubernetes-klyngene dine, med noder, pods, arbeidslaster, hendelser og logger, sendt av Kubernetes-agenten du installerer med Helm.

Se [Kubernetes-agent](/docs/telemetry/kubernetes-agent).

### Infrastruktur

Menyens gruppe for maskinene og plattformene du kjører: Verter, Kubernetes, Docker, Docker Swarm, Podman, Proxmox, OpenStack, VMware, Ceph, Lagringsarrayer, Nettverk og IoT. En agent eller en tilkobling fyller hver av dem, og hver viser hvordan hver maskin, klynge eller enhet i den har det.

Se [Verter](/docs/telemetry/hosts).

### Nettverk

Svitsjene, ruterne, brannmurene og tilgangspunktene dine, og alt annet med en adresse på nettverket ditt, enten det snakker SNMP eller ikke.

Se [Nettverksenhets-overvåking](/docs/monitor/network-device-monitor).

### Sky

AWS-kontoene, Azure-abonnementene og Google Cloud-prosjektene dine, koblet til fra dashbordet. OneUptime lister opp hver ressurs i dem, leser de viktigste metrikkene deres og registrerer hva som er endret i dem.

Se [Koble til en skykonto](/docs/telemetry/cloud-accounts).

### App-plattformer

Appene du kjører på administrerte plattformer som Amazon ECS og Fargate, Google Cloud Run og Azure App Service. Hvert sted de kjører, er et skymiljø, som OneUptime oppretter første gang telemetri derfra kommer inn.

Også kalt: **Skymiljø**. Se [Skymiljøer](/docs/telemetry/cloud-environments).

### Serverløs

De serverløse funksjonene dine, for eksempel AWS Lambda, Google Cloud Functions og Azure Functions, listet opp med spor, logger og metrikker så snart OpenTelemetry-dataene deres kommer inn.

Også kalt: **Serverløse funksjoner**. Se [Serverløse funksjoner](/docs/telemetry/serverless-functions).

### Databaser

Hver database applikasjonene dine spør mot, satt sammen fra sporene dine, databasens egne metrikker og de andre kildene OneUptime kan lese, og med hvordan motoren har det.

Se [Databaser](/docs/telemetry/databases).

### Køer

Meldingskøene og emnene tjenestene dine bruker, for eksempel Apache Kafka, RabbitMQ og Amazon SQS, fra sporene dine og meglernes metrikker.

Se [Køer](/docs/telemetry/queues).

### Overvåking av reelle brukere

Det ekte mennesker opplever i nett- og mobilappene dine: sideinnlastinger, forespørsler, feil og Core Web Vitals, rapportert av appen selv og ikke av en sonde.

Se [RUM – Oversikt](/docs/rum/index).

### Inventar

Én liste over alt OneUptime vet om miljøet ditt: tjenester, verter, Kubernetes-objekter, virtuelle maskiner, nettverksenheter, skyressurser og de tingene som ikke sender telemetri i det hele tatt. Det meste fyller seg ut av seg selv.

Se [Inventar – Oversikt](/docs/inventory/overview).

### Topologi

Et kart over hvordan systemene dine henger sammen, hvilke tjenester som kaller hvilke og hva som kjører hvor, tegnet ut fra telemetrien du allerede sender.

Se [Topologi](/docs/telemetry/topology).

### SLO

Et pålitelighetsmål for det du overvåker, for eksempel tilgjengelig 99,9 % av tiden over 30 dager. OneUptime måler hvert SLO mot monitorene sine hvert 5. minutt.

Også kalt: **Service Level Objective**. Se [SLO-er – Oversikt](/docs/slo/introduction).

### Feilbudsjett

Nedetiden målet til et SLO tillater: ved 99,9 % over 30 dager er det 43 minutter og 12 sekunder. Med mye igjen kan du ta sjanser; med lite igjen bør du senke tempoet og investere i stabilitet.

Se [Feilbudsjetter](/docs/slo/error-budget).

## Arbeid med et problem

### Tilstand

Hvor langt en hendelse eller et varsel har kommet i håndteringen. Hvert nytt prosjekt starter med **Identifisert**, **Bekreftet** og **Løst**: å bekrefte sier at noen tar seg av det og hindrer at neste eskaleringsnivå tilkalles, og å løse det avslutter det.

Også kalt: **Hendelsesstatus**, **Varselsstatus**. Se [Hendelsestilstander og alvorlighetsgrader](/docs/incidents/states-and-severities).

### Alvorlighetsgrad

Hvor mye en hendelse eller et varsel betyr. Et nytt prosjekt starter med Critical Incident, Major Incident og Minor Incident for hendelser, og **Høy** og **Lav** for varsler; gi dem nye navn og farger, eller legg til dine egne.

Også kalt: **Hendelsesalvor**, **Varselsalvor**. Se [Hendelsestilstander og alvorlighetsgrader](/docs/incidents/states-and-severities).

### Eier

En person eller et team som har ansvaret for én post, for eksempel en monitor, en hendelse eller en statusside. Eiere får beskjed når noe skjer med det de eier.

Se [Etikett- og eierregler](/docs/configuration/label-and-owner-rules).

### Etikett

Et merke, for eksempel Production eller Checkout, som du setter på monitorer, hendelser, statussider og de fleste andre poster for å filtrere og gruppere dem. Et teams tillatelser kan begrenses til postene med bestemte etiketter.

Se [Etikett- og eierregler](/docs/configuration/label-and-owner-rules).

### Unntak

En feil koden din kaster. OneUptime samler hver forekomst av samme feil i ett unntak, med stakksporet, utviklingen og forespørslene det oppsto i.

Også kalt: **Unntakssporing**, `/telemetry-exception`. Se [Unntak](/docs/telemetry/exceptions).

### KI-innsikt

Problemer OneUptime finner i telemetrien din før noe tilkaller noen: nye unntak og unntak som skyter i været, topper i feillogger, tregere spor, metrikker som driver, og utrullinger som gjorde ting verre. Innsikt tilkaller aldri noen og åpner aldri hendelser; den venter i en innboks til noen ser på den. Siden **Innsikt** i AI-delen til et produkt eller en post er det OneUptime AI har lært der.

Også kalt: **Innsikt**. Se [AI SRE](/docs/ai/ai-sre#innsikt-proaktiv-oppdagelse).

### Sikkerhetshendelser

SIEM-en til OneUptime: sikkerhetshendelsene fra loggene dine, sikkerhetsverktøyene dine og alt annet du sender, lagret i én form ved siden av telemetrien din, med deteksjonsregler som finner trusler i dem.

Også kalt: **SIEM**. Se [Sikkerhetshendelser (SIEM)](/docs/telemetry/security-events).

### Sikkerhetssak

Én ting som er verdt å undersøke, fra deteksjonsregler, trusseletterretning eller et tilkoblet sikkerhetsprodukt, med alle deteksjoner om samme bruker, vert eller adresse samlet i den. Analytikere behandler saker i en kø, og playbooks reagerer på dem.

Også kalt: **Sak**. Se [Sikkerhetssaker og playbooks (SOAR)](/docs/telemetry/security-cases).

## Telemetri og dashbord

### Logger

Linjene tjenestene, vertene og agentene dine skriver, som du søker gjennom i loggutforskeren og følger med på via en logg-overvåking.

Se [Loggutforsker](/docs/telemetry/logs-explorer).

### Målinger

Tallene tjenestene og infrastrukturen din rapporterer over tid, for eksempel antall forespørsler, ventetid, CPU og kødybde.

Se [Metrikkutforsker](/docs/telemetry/metrics-explorer).

### Spor

Veien én forespørsel tar gjennom tjenestene dine, trinn for trinn. Hvert trinn er et span, med tidsbruk og resultat.

Se [Sporutforsker](/docs/telemetry/traces-explorer).

### Profiler

Hvordan applikasjonen din bruker CPU-tid og minne, funksjon for funksjon, samlet inn av en profiler som sender til det Pyroscope-kompatible API-et til OneUptime.

Også kalt: **Ytelsesprofiler**, **Kontinuerlig profilering**. Se [Profiler](/docs/telemetry/profiles).

### AI / LLM

Samtalene AI-appene og agentene dine fører: hvert modellkall, med tokens, kostnad, ventetid, prompt og svar, bygget fra OpenTelemetry-spannene appen din sender.

Også kalt: **AI / LLM-observability**. Se [AI- / LLM-observerbarhet](/docs/telemetry/ai-llm-observability).

### Dataobserverbarhet

Følger med på tabellene i databasene og datavarehusene dine, og sier fra når dataene deres er forsinket, mangler eller er feil, og hvilken kjøring, utrulling eller tabell som ligger bak.

Se [Oversikt over Dataobserverbarhet](/docs/data-observability/index).

### Datasikkerhet

Finner de sensitive dataene bedriften din oppbevarer, i skybøtter, databaser, datavarehus og telemetrien du sender, og sier hva som er galt med måten de oppbevares på.

Se [Oversikt over Datasikkerhet](/docs/data-security/index).

### Dashbord

En side med widgets du ordner selv: diagrammer over metrikkene, loggene og sporene dine, lister over hendelser og monitorer, SLO-ene dine og mer. Et dashbord er privat for prosjektet ditt til du deler det.

Se [Oversikt over dashbord](/docs/dashboards/index).

### Public Dashboard

Et dashbord som deles via en offentlig lenke, for folk som ikke logger inn i prosjektet ditt. Beskytt det med et passord, begrens det til bestemte IP-adresser, eller legg det på ditt eget domene.

Se [Deling & offentlige dashbord](/docs/dashboards/sharing).

## Automatisering og AI

### Arbeidsflyt

En automatisering uten kode: blokker på et lerret som kjører når triggeren utløses, for eksempel en melding i Slack når en hendelse erklæres, eller et kall til et annet verktøy.

Se [Oversikt over arbeidsflyter](/docs/workflows/index).

### Runbook

En gjenbrukbar responsprosedyre: manuelle og automatiserte trinn teamet ditt kjører på en hendelse, et varsel eller en vedlikeholdshendelse, for hånd eller når en runbook-regel treffer.

Se [Runbooks – Oversikt](/docs/runbooks/index).

### Playbook

Trinnene som reagerer på en sikkerhetssak, for eksempel å sikre bevisene, tilkalle den som har vakt eller suspendere en bruker, og som kjører av seg selv eller med et klikk.

Også kalt: **Sikkerhetsplaybook**. Se [Sikkerhetssaker og playbooks (SOAR)](/docs/telemetry/security-cases#playbooks).

### AI-regel

Avgjør hvilke nye hendelser eller varsler OneUptime AI undersøker og retter, og hvordan. Uten en AI-regel undersøker den hver eneste en, så de fleste prosjekter trenger ingen.

Også kalt: **Regel for automatisk utbedring**. Se [AI SRE](/docs/ai/ai-sre#hvilke-hendelser-som-undersøkes-og-rettes).

### OneUptime AI

Den AI-drevne site reliability engineeren til OneUptime: den undersøker hver ny hendelse og hvert nytt varsel på tvers av telemetrien din og legger det den fant, ut på tidslinjen. Bryteren **Aktiver AI** i **Prosjektinnstillinger** slår alt sammen av.

Også kalt: **AI SRE**. Se [AI SRE](/docs/ai/ai-sre).

### Spør AI

En chat om dataene i prosjektet ditt. Den spør i loggene, sporene, metrikkene, hendelsene og monitorene dine og mer, og svarer med en kildehenvisning for hver påstand.

Også kalt: **Chat**. Se [Spør AI](/docs/ai/ask-ai).

### Kode

Der du ber OneUptime AI om å jobbe i repositoriene dine, slik du ville bedt en kodeagent: rett en feil, skriv tester eller gjør en endring, og få en pull request tilbake.

Også kalt: **Oppgaver**. Se [Kode](/docs/ai/ai-agent).

### Skjema

En side alle med lenken kan fylle ut, uten konto. Hver innsending oppretter en hendelse, for en problemrapport, eller en vedlikeholdshendelse, for en endringsforespørsel.

Se [Skjemaer – oversikt](/docs/forms/index).

## Det du installerer, og nøklene

### Infrastrukturagent

Tjenesten `oneuptime-infrastructure-agent` bak en Server / VM-monitor: den rapporterer én maskins CPU, minne, disker og prosesser hvert 30. sekund, signert med monitorens hemmelige nøkkel.

Se [Server- / VM-overvåking](/docs/monitor/server-monitor).

### Kubernetes-agent

Et Helm-chart som samler inn en klynges metrikker, hendelser og pod-logger og, med eBPF, sporene dens, og sender dem med en inntaksnøkkel.

Se [Kubernetes-agent](/docs/telemetry/kubernetes-agent).

### OpenTelemetry Collector

Agenten med åpen kildekode som tar imot, behandler og sender telemetri. **Legg til vert** installerer den på en maskin, Docker-agenten er en slik, og dine egne collectorer sender til OneUptime med en inntaksnøkkel.

Også kalt: **Innsamler**. Se [Verter](/docs/telemetry/hosts) og [OpenTelemetry-collector på verten](/docs/telemetry/host-otel-collector).

### Runner

En liten prosess du kjører i din egen infrastruktur, som kjører JavaScript-, Bash-, SSH- og kubectl-trinnene i runbookene dine. Den kobler seg ut til OneUptime med sin egen Runner-ID og nøkkel.

Også kalt: **Runbook-agenter**. Se [Runbook-agenter](/docs/runbooks/agents).

### Inntaksnøkkel

Nøkkelen som lar noe sende telemetri inn i prosjektet ditt: apper med OpenTelemetry, collectorer og agenter. Den sendes i headeren `x-oneuptime-token`, og en API-nøkkel for prosjektet virker ikke i stedet.

Også kalt: **Telemetri Inntak Key**, `oneuptime.apiKey`. Se [Inntaksnøkler](/docs/telemetry/ingestion-keys).

### API-nøkkel

En nøkkel som lar et skript, CLI-en, Terraform eller en AI-assistent lese og endre prosjektet ditt gjennom API-et, med tillatelsene du gir den. Opprett en under **Prosjektinnstillinger → Avansert → API-nøkler**.

Se [Brukere, team og tillatelser](/docs/permissions/index#api-nøkler).

## Ord med mer enn én betydning

### Regel

Mange ting i OneUptime er regler, og hver av dem tar én avgjørelse for deg: hvem som tilkalles (**Vaktregler**, **Eskaleringsregler**), hvem som eier og merker nye poster (**Eierregler**, **Etikettregler**), hva som hører sammen (**Grupperingsregler**) og hva OneUptime AI gjør (**AI-regler**). En monitors egne regler er kriteriene dens.

Se [Grunnbegreper](/docs/introduction/core-concepts#typer-regler).

### Rolle

Fire forskjellige ting: tillatelsene et team gir, for eksempel Project Owner eller Project Admin; en **Egendefinert rolle** du setter sammen av tillatelser; en **Hendelsesrolle**, rollen noen har i én hendelse; og en **Network Device Role**, hva en enhet på nettverket ditt gjør.

Se [Brukere, team og tillatelser](/docs/permissions/index).

### Ressurs

Oftest infrastrukturen OneUptime registrerer, for eksempel verter, klynger, databaser og skyressurser. En hendelses **Berørte ressurser** er monitorene og infrastrukturen den berører, en statussides ressurser er monitorene og gruppene den viser, og ressursattributtene i OpenTelemetry sier hvor telemetrien kom fra.

Se [Inventar – Oversikt](/docs/inventory/overview).

### Innstillinger

Hvert nivå har sine egne: **Prosjektinnstillinger** for hele prosjektet, **Brukerinnstillinger** for hvordan OneUptime når deg, og et produkts egne **Innstillinger** i sidemenyen, for eksempel hendelsestilstander og maler under **Hendelser**. Innstillingene for en selvhostet server ligger i Admin Dashboard.

Se [Prosjektinnstillinger](/docs/configuration/project-settings).

### Retningslinje

Oftest en **Vaktpolicy**: hvem som tilkalles, og hvem som er neste. En policy for innkommende anrop gir teamet ditt et telefonnummer som ringer den som har vakt, og en feilbudsjettpolicy skriver ned hva teamet ditt gjør når budsjettet til et SLO tar slutt.

Se [Vaktretningslinjer](/docs/on-call/policies).

### Mal

Et lagret utgangspunkt: en monitormal oppretter monitorer, hendelses- og varselmaler fyller ut nye poster, notat- og etteranalysemaler starter det du skriver, og dashbordmaler bygger widgetene til et dashbord.

Se [Monitormaler](/docs/monitor/monitor-templates).

### Arbeidsområde

Et Slack- eller Microsoft Teams-arbeidsområde du kobler til OneUptime under **Arbeidsområdetilkoblinger**, for å legge ut oppdateringer i kanalene dine og håndtere hendelser fra chatten. Det enkelte andre verktøy kaller et arbeidsområde, er et prosjekt i OneUptime.

Se [Slack](/docs/workspace-connections/slack).

### Agent

Et program du installerer, som rapporterer til OneUptime eller handler på vegne av det: infrastruktur-, Kubernetes- og Docker-agentene sender det de samler inn, en Runner kjører runbook-trinn, og en AI-agent lar OneUptime AI undersøke en klynge eller en vert. Oppgavene du gir **Kode**, er AI-agentoppgaver.

Se [Hvilken skal jeg bruke?](/docs/introduction/which-one#sonde-agent-collector-eller-runner).

### Vaktregler

Under **Hendelser** og **Varsler** velger vaktregler vaktpolicyene en ny hendelse eller et nytt varsel kjører. En persons egne regler for hvordan en tilkalling når fram, het også vaktregler: De heter nå **Slik når man meg**, under **Brukerinnstillinger**.

Se [Hendelsesinnstillinger og automatisering](/docs/incidents/settings#vaktregler-for-hendelser) og [Slik når man meg](/docs/notifications/on-call-rules).

### Varselinnstillinger

Under **Brukerinnstillinger**: hvilke oppdateringer du får om det du eier, og på hvilke kanaler. Prosjektets brytere for SMS og anrop, meldingssaldoen og prosjektets egen SMTP og Twilio het også varselinnstillinger: De heter nå **Varslingskanaler**, under **Prosjektinnstillinger**.

Se [Varselinnstillinger](/docs/notifications/notification-settings).

## Neste steg

:::cards
- [Hvilken skal jeg bruke?](/docs/introduction/which-one): Hendelse eller varsel, arbeidsflyt eller runbook, og de andre som ligner hverandre, side om side.
- [Grunnbegreper](/docs/introduction/core-concepts): Hvordan delene henger sammen, på én side.
- [Hurtigstart](/docs/introduction/quickstart): Ta ordene i bruk på femten minutter.
:::
