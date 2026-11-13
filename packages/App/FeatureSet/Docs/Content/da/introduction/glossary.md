# Ordliste

Hvert ord, OneUptime bruger, forklaret med en sætning eller to, med de andre navne, det går under, og den side, der dækker det i detaljer. Ordene er grupperet i den rækkefølge, du møder dem: den første gruppe er det forløb, hvert projekt kører, og den sidste er de ord, der betyder mere end én ting.

:::cards
- [Start her](#start-her): Det forløb, hvert projekt kører, fra en monitor til et tilkald og en statusside.
- [Det, du overvåger](#det-du-overvåger): Tjenester, værter, klynger, clouds og de mål, du holder dem op på.
- [Arbejdet med et problem](#arbejdet-med-et-problem): Tilstande, alvorsgrader, ejere og etiketter, og de andre slags problemer.
- [Telemetri og dashboards](#telemetri-og-dashboards): Det, dine systemer sender, og hvor du ser på det.
- [Automatisering og AI](#automatisering-og-ai): Det, der kører af sig selv, og det, OneUptime AI gør.
- [Det, du installerer, og nøglerne](#det-du-installerer-og-nøglerne): De agenter, du kører, og den nøgle, hver af dem bruger.
- [Ord med mere end én betydning](#ord-med-mere-end-én-betydning): Regel, rolle, ressource, indstillinger og de andre ord med flere opgaver.
:::

## Start her

### Projekt

Der, hvor alt, du sætter op, ligger: monitorer, hændelser, vagter, statussider, telemetri og indstillinger. Intet i ét projekt kan ses i et andet, og de fleste virksomheder har kun brug for ét.

Se [Grundbegreber](/docs/introduction/core-concepts#projekter-og-personer).

### Konto

Dig: den e-mail og adgangskode, du logger ind med, dit navn, din tidszone og dit sprog. Én konto kan høre til så mange projekter, du vil.

Se [Din konto](/docs/introduction/your-account).

### Team

En gruppe personer i et projekt, hvis tilladelser afgør, hvad medlemmerne må. Hvert nyt projekt starter med tre teams: Owners, Admin og Members. Invitér personer under **Brugere**, og saml dem under **Teams**.

Se [Brugere, teams og tilladelser](/docs/permissions/index).

### Overvågning

Tjekker én ting, du kører, for eksempel et websted, et API, en server eller en Kubernetes-klynge, og afgør, om den virker. Når dens kriterier passer, ændrer den sin status og kan erklære en hændelse eller oprette en advarsel.

Se [Opret en monitor](/docs/monitor/create-monitor).

### Kriterier

En monitors regler: hvad hvert tjekresultat betyder. De tjekkes i rækkefølge, og det første, der passer, kan ændre monitorens status, erklære en hændelse, oprette en advarsel eller alle tre.

Også kaldet: **Overvågningskriterier**, **Monitorkriterier**, **Monitor Steps**. Se [Kriterier og statusser](/docs/monitor/criteria-and-statuses).

### Monitorstatus

Det, en monitor er lige nu. Hvert nyt projekt har tre monitorstatusser, **I drift**, **Forringet** og **Offline**, og du kan tilføje dine egne.

Se [Kriterier og statusser](/docs/monitor/criteria-and-statuses).

### Sonde

En maskine, der kører monitorernes tjek efter en tidsplan: den henter en side, kalder et API eller pinger en vært. OneUptime Cloud kører sonder i flere regioner, og en brugerdefineret sonde, du kører i dit eget netværk, tjekker det, som kun det netværk kan nå.

Også kaldet: **Brugerdefinerede probes**. Se [Brugerdefinerede probes](/docs/probe/custom-probe).

### Hændelse

Et problem, der rammer dine brugere, for eksempel et nedbrud eller en opbremsning, og den post, dit team arbejder ud fra, så længe det varer. Den kan tilkalde den, der har vagt, og vises på dine statussider.

Se [Hændelser – Oversigt](/docs/incidents/index).

### Advarsel

Et problem, dit team bør se på, før brugerne opdager det, for eksempel en disk, der er ved at blive fuld, eller et certifikat, der snart udløber. Den kan tilkalde den, der har vagt, men den vises aldrig på en statusside.

Se [Advarsler – Oversigt](/docs/alerts/index).

### Episode

En gruppe relaterede hændelser, eller relaterede advarsler, som dit team håndterer som én, med ét sæt ejere og én tilstand. Grupperingsregler afgør, hvad der hører til i hver.

Også kaldet: **Hændelsesepisode**, **Advarselsepisode**. Se [Episoder](/docs/incidents/episodes).

### Vagtpolitik

Afgør, hvem der tilkaldes om en hændelse, en advarsel eller en episode, og hvem der er den næste, hvis ingen bekræfter. Dens niveauer er eskaleringsregler.

Også kaldet: **Vagtordning**, **On-Call Duty Policy**, **Vagt**, `OnCallDutyPolicy`. Se [Vagtpolitikker](/docs/on-call/policies).

### Eskaleringsregel

Ét niveau i en vagtpolitik: hvem der tilkaldes, og hvor længe der ventes på, at nogen bekræfter, før det næste niveau tilkaldes. Et niveau kan tilkalde personer, teams eller en vagtplan.

Se [Eskaleringsregler](/docs/on-call/escalation-rules).

### Vagttidsplan

Hvem der har vagt på et givet tidspunkt: personerne skiftes, og hver enkelt overdrager til den næste. En eskaleringsregel, der tilkalder en vagtplan, tilkalder den, der har vagt i den.

Også kaldet: **Rotation**, **Vagtplan for vagtpolitik**. Se [Vagtplaner](/docs/on-call/schedules).

### Lag

Én rotation i en vagtplan: hvem der skiftes, hvor ofte vagten overdrages, og hvilke timer laget dækker. Det øverste lag, hvor nogen har vagt, er det, der tilkalder, så hovedrotationen skal øverst og reservedækningen under den.

Se [Vagtplaner](/docs/on-call/schedules#lag).

### Notifikationsmetode

En adresse, OneUptime kan kontakte dig på i et projekt: en e-mailadresse, et telefonnummer til SMS eller opkald, din Slack- eller Microsoft Teams-konto eller OneUptime-appen på din telefon. Hver person tilføjer sine egne under **Brugerindstillinger**.

Se [Notifikationsmetoder](/docs/notifications/notification-methods).

### Sådan når man mig

Dine egne regler for at blive tilkaldt: hvilke af dine notifikationsmetoder et tilkald prøver, og efter hvor lang tid. Én stige dækker hver hændelse, advarsel og episode, og en alvorsgrad kan have sine egne regler. Hver person indstiller sine egne under **Brugerindstillinger**.

Også kaldet: **Personlige vagtregler**. Se [Sådan når man mig](/docs/notifications/on-call-rules).

### Statusside

En side, der viser dine kunder, om dine tjenester virker, og de hændelser og den vedligeholdelse, der påvirker dem. Den kan være offentlig eller privat for dem, du lukker ind.

Se [Statussider – Oversigt](/docs/status-pages/index).

### Abonnent

En person, der følger en statusside via e-mail, SMS, Slack, Microsoft Teams eller webhook og får besked, når en hændelse eller vedligeholdelse på den starter, ændrer sig og slutter.

Se [Abonnenter og meddelelser](/docs/status-pages/subscribers).

### Planlagt vedligeholdelse

Planlagt arbejde, annonceret på forhånd. Hver vedligeholdelseshændelse går gennem vedligeholdelsestilstandene **Planlagt**, **Igangværende**, **Afsluttet** og **Fuldført**, og de statussider, den vises på, fortæller besøgende og abonnenter om den.

Også kaldet: **Planlagt vedligeholdelsesbegivenhed**, **Planlagt hændelse**, **Begivenhed**. Se [Planlagt vedligeholdelse – Oversigt](/docs/scheduled-maintenance/index).

### Telemetri

Det, dine systemer sender til OneUptime: logs, metrikker, traces, undtagelser og profiler. Applikationer sender den med OpenTelemetry, og OneUptimes agenter sender den fra værter, klynger og øvrig infrastruktur, hver med en indtagelsesnøgle.

Se [OpenTelemetry](/docs/telemetry/open-telemetry).

## Det, du overvåger

### Monitorgruppe

Flere monitorer samlet i én status, den værste blandt dem, med sin egen oppetid. En statusside kan vise hele gruppen som én række. Slå monitorgrupper til under **Projektindstillinger → Avanceret → Funktionsflag**.

Se [Monitorgrupper](/docs/monitor/monitor-groups).

### Tjeneste

En applikation eller microservice, du kører. OneUptime tilføjer den, første gang dens telemetri ankommer, navngivet efter dens `service.name`, og samler dens logs, traces, metrikker, undtagelser, hændelser og ejere på én side.

Også kaldet: **Tjenestekatalog**, **Telemetritjeneste**. Se [Tjenester](/docs/telemetry/services).

### Vært

En Linux-, Windows- eller macOS-maskine, der sender sine metrikker, processer, logs og tjenestetilstande gennem OpenTelemetry Collector. **Tilføj vært** installerer collectoren med én kommando, og OneUptime holder dens konfiguration opdateret.

Se [Værter](/docs/telemetry/hosts).

### Kubernetes

Dine Kubernetes-klynger med deres noder, pods, workloads, begivenheder og logs, sendt af den Kubernetes-agent, du installerer med Helm.

Se [Kubernetes-agent](/docs/telemetry/kubernetes-agent).

### Infrastruktur

Menuens gruppe for de maskiner og platforme, du kører: Værter, Kubernetes, Docker, Docker Swarm, Podman, Proxmox, OpenStack, VMware, Ceph, Lagerarrays, Netværk og IoT. En agent eller en forbindelse fylder hver af dem, og hver viser, hvordan hver maskine, klynge eller enhed i den har det.

Se [Værter](/docs/telemetry/hosts).

### Netværk

Dine switche, routere, firewalls, access points og alt andet med en adresse på dit netværk, uanset om det taler SNMP eller ej.

Se [Netværksenheds-monitor](/docs/monitor/network-device-monitor).

### Cloud

Dine AWS-konti, Azure-abonnementer og Google Cloud-projekter, forbundet fra dashboardet. OneUptime oplister hver ressource i dem, læser deres vigtigste metrikker og registrerer, hvad der er ændret i dem.

Se [Forbind en cloudkonto](/docs/telemetry/cloud-accounts).

### App-platforme

De apps, du kører på administrerede platforme som Amazon ECS og Fargate, Google Cloud Run og Azure App Service. Hvert sted, de kører, er et cloud-miljø, som OneUptime opretter, første gang dets telemetri ankommer.

Også kaldet: **Cloud-miljø**. Se [Cloud-miljøer](/docs/telemetry/cloud-environments).

### Serverløs

Dine serverløse funktioner, for eksempel AWS Lambda, Google Cloud Functions og Azure Functions, vist med deres traces, logs og metrikker, så snart deres OpenTelemetry-data ankommer.

Også kaldet: **Serverløse funktioner**. Se [Serverløse funktioner](/docs/telemetry/serverless-functions).

### Databaser

Hver database, dine applikationer forespørger, sat sammen ud fra dine traces, databasens egne metrikker og de andre kilder, OneUptime kan læse, og med, hvordan dens motor har det.

Se [Databaser](/docs/telemetry/databases).

### Køer

De beskedkøer og topics, dine tjenester bruger, for eksempel Apache Kafka, RabbitMQ og Amazon SQS, ud fra dine traces og dine brokeres metrikker.

Se [Køer](/docs/telemetry/queues).

### Overvågning af reelle brugere

Det, rigtige mennesker oplever i dine web- og mobilapps: sideindlæsninger, anmodninger, fejl og Core Web Vitals, rapporteret af appen selv i stedet for af en sonde.

Se [RUM – Oversigt](/docs/rum/index).

### Inventar

Én liste over alt, hvad OneUptime ved om dit miljø: tjenester, værter, Kubernetes-objekter, virtuelle maskiner, netværksenheder, cloudressourcer og de ting, der slet ikke sender telemetri. Det meste udfylder sig selv.

Se [Inventar – Oversigt](/docs/inventory/overview).

### Topologi

Et kort over, hvordan dine systemer hænger sammen, hvilke tjenester der kalder hvilke, og hvad der kører hvor, tegnet ud fra den telemetri, du allerede sender.

Se [Topologi](/docs/telemetry/topology).

### SLO

Et pålidelighedsmål for det, du overvåger, for eksempel tilgængelig 99,9 % af tiden over 30 dage. OneUptime måler hvert SLO mod dets monitorer hvert 5. minut.

Også kaldet: **Service Level Objective**. Se [SLO'er – Oversigt](/docs/slo/introduction).

### Fejlbudget

Den nedetid, et SLO's mål tillader: ved 99,9 % over 30 dage er det 43 minutter og 12 sekunder. Med meget tilbage kan du tage chancer; med lidt tilbage skal du sætte tempoet ned og investere i stabilitet.

Se [Fejlbudgetter](/docs/slo/error-budget).

## Arbejdet med et problem

### Tilstand

Hvor langt en hændelse eller en advarsel er nået i jeres håndtering. Hvert nyt projekt starter med **Identificeret**, **Bekræftet** og **Løst**: at bekræfte siger, at nogen tager sig af den, og forhindrer, at det næste eskaleringsniveau tilkaldes, og at løse den afslutter den.

Også kaldet: **Hændelsesstatus**, **Advarselsstatus**. Se [Hændelsestilstande og alvorsgrader](/docs/incidents/states-and-severities).

### Alvorlighed

Hvor meget en hændelse eller en advarsel betyder. Et nyt projekt starter med Critical Incident, Major Incident og Minor Incident for hændelser og **Høj** og **Lav** for advarsler; omdøb dem, giv dem nye farver, eller tilføj dine egne.

Også kaldet: **Hændelsesalvor**, **Advarselsalvor**. Se [Hændelsestilstande og alvorsgrader](/docs/incidents/states-and-severities).

### Ejer

En person eller et team, der er ansvarlig for én post, for eksempel en monitor, en hændelse eller en statusside. Ejere får besked, når der sker noget med det, de ejer.

Se [Etiket- og ejerregler](/docs/configuration/label-and-owner-rules).

### Mærkat

Et mærke, for eksempel Production eller Checkout, som du sætter på monitorer, hændelser, statussider og de fleste andre poster for at filtrere og gruppere dem. Et teams tilladelser kan begrænses til de poster, der har bestemte mærkater.

Se [Etiket- og ejerregler](/docs/configuration/label-and-owner-rules).

### Undtagelse

En fejl, din kode kaster. OneUptime samler hver forekomst af den samme fejl i én undtagelse med dens stack trace, dens udvikling og de anmodninger, den opstod i.

Også kaldet: **Undtagelsessporing**, `/telemetry-exception`. Se [Undtagelser](/docs/telemetry/exceptions).

### AI-indsigter

Problemer, OneUptime finder i din telemetri, før noget tilkalder nogen: nye undtagelser og undtagelser, der stiger brat, spidser i fejllogs, langsommere traces, metrikker, der driver, og udrulninger, der gjorde tingene værre. Indsigter tilkalder aldrig nogen og åbner aldrig hændelser; de venter i en indbakke, til nogen kigger på dem. Siden **Indsigter** i et produkts eller en posts AI-afsnit er det, OneUptime AI har lært der.

Også kaldet: **Indsigter**. Se [AI SRE](/docs/ai/ai-sre#indsigter-proaktiv-detektion).

### Sikkerhedshændelser

OneUptimes SIEM: sikkerhedsbegivenhederne fra dine logs, dine sikkerhedsværktøjer og alt andet, du sender, gemt i én form ved siden af din telemetri, med detektionsregler, der finder trusler i dem.

Også kaldet: **SIEM**. Se [Sikkerhedsbegivenheder (SIEM)](/docs/telemetry/security-events).

### Sikkerhedssag

Én ting, der er værd at undersøge, fra detektionsregler, trusselsintelligens eller et forbundet sikkerhedsprodukt, med alle detektioner om den samme bruger, vært eller adresse samlet i den. Analytikere behandler sager i en kø, og playbooks reagerer på dem.

Også kaldet: **Sag**. Se [Sikkerhedssager og playbooks (SOAR)](/docs/telemetry/security-cases).

## Telemetri og dashboards

### Protokoller

De linjer, dine tjenester, værter og agenter skriver, og som du gennemsøger i protokoludforskeren og holder øje med via en log-monitor.

Se [Protokoludforsker](/docs/telemetry/logs-explorer).

### Metrikker

De tal, dine tjenester og din infrastruktur rapporterer over tid, for eksempel antal anmodninger, latens, CPU og kødybde.

Se [Måleudforsker](/docs/telemetry/metrics-explorer).

### Spor

Den vej, én anmodning tager gennem dine tjenester, trin for trin. Hvert trin er et span med sin tidsmåling og sit resultat.

Se [Sporudforsker](/docs/telemetry/traces-explorer).

### Profiler

Hvordan din applikation bruger CPU-tid og hukommelse, funktion for funktion, indsamlet af en profiler, der sender til OneUptimes Pyroscope-kompatible API.

Også kaldet: **Ydeevneprofiler**, **Kontinuerlig profilering**. Se [Profiler](/docs/telemetry/profiles).

### AI / LLM

De samtaler, dine AI-apps og agenter fører: hvert modelkald med dets tokens, omkostning, latens, prompt og svar, bygget ud fra de OpenTelemetry-spans, din app sender.

Også kaldet: **AI / LLM-observability**. Se [AI- / LLM-observability](/docs/telemetry/ai-llm-observability).

### Dataobservabilitet

Holder øje med tabellerne i dine databaser og datavarehuse og fortæller dig, når deres data er forsinkede, mangler eller er forkerte, og hvilken kørsel, udrulning eller tabel der står bag.

Se [Oversigt over Dataobservabilitet](/docs/data-observability/index).

### Datasikkerhed

Finder de følsomme data, din virksomhed opbevarer, i cloud-buckets, databaser, datavarehuse og den telemetri, du sender, og fortæller dig, hvad der er galt med måden, de opbevares på.

Se [Oversigt over Datasikkerhed](/docs/data-security/index).

### Dashboard

En side med widgets, som du selv arrangerer: diagrammer over dine metrikker, logs og traces, lister over hændelser og monitorer, dine SLO'er og mere. Et dashboard er privat for dit projekt, indtil du deler det.

Se [Dashboards – Oversigt](/docs/dashboards/index).

### Public Dashboard

Et dashboard, der deles via et offentligt link, til personer, der ikke logger ind i dit projekt. Beskyt det med en adgangskode, begræns det til bestemte IP-adresser, eller host det på dit eget domæne.

Se [Deling & offentlige dashboards](/docs/dashboards/sharing).

## Automatisering og AI

### Arbejdsgang

En automatisering uden kode: blokke på et lærred, der kører, når deres trigger udløses, for eksempel en besked i Slack, når en hændelse erklæres, eller et kald til et andet værktøj.

Se [Workflows – Oversigt](/docs/workflows/index).

### Runbook

En genbrugelig responsprocedure: manuelle og automatiserede trin, som dit team kører på en hændelse, en advarsel eller en vedligeholdelsesbegivenhed, manuelt eller når en runbook-regel passer.

Se [Runbooks – Oversigt](/docs/runbooks/index).

### Playbook

De trin, der reagerer på en sikkerhedssag, for eksempel at sikre beviserne, tilkalde den, der har vagt, eller suspendere en bruger, og som kører af sig selv eller med et klik.

Også kaldet: **Sikkerhedsplaybook**. Se [Sikkerhedssager og playbooks (SOAR)](/docs/telemetry/security-cases#playbooks).

### AI-regel

Afgør, hvilke nye hændelser eller advarsler OneUptime AI undersøger og retter, og hvordan. Uden en AI-regel undersøger den hver eneste, så de fleste projekter har ikke brug for nogen.

Også kaldet: **Regel for automatisk afhjælpning**. Se [AI SRE](/docs/ai/ai-sre#hvilke-hændelser-der-undersøges-og-rettes).

### OneUptime AI

OneUptimes AI-drevne site reliability engineer: den undersøger hver ny hændelse og advarsel på tværs af din telemetri og poster det, den fandt, på deres tidslinje. Kontakten **Aktivér AI** i **Projektindstillinger** slår det hele fra.

Også kaldet: **AI SRE**. Se [AI SRE](/docs/ai/ai-sre).

### Spørg AI

En chat om dit projekts data. Den forespørger dine logs, traces, metrikker, hændelser, monitorer og mere og svarer med en kildehenvisning for hver påstand.

Også kaldet: **Chat**. Se [Spørg AI](/docs/ai/ask-ai).

### Kode

Der, hvor du beder OneUptime AI om at arbejde i dine repositories, på samme måde som du ville bede en kodeagent: ret en fejl, skriv tests eller lav en ændring, og få en pull request tilbage.

Også kaldet: **Opgaver**. Se [Kode](/docs/ai/ai-agent).

### Formular

En side, som alle med linket kan udfylde, uden en konto. Hver indsendelse opretter en hændelse, for en problemrapport, eller en planlagt vedligeholdelsesbegivenhed, for en ændringsanmodning.

Se [Formularer – overblik](/docs/forms/index).

## Det, du installerer, og nøglerne

### Infrastrukturagent

Tjenesten `oneuptime-infrastructure-agent` bag en Server / VM-monitor: den rapporterer én maskines CPU, hukommelse, diske og processer hvert 30. sekund, signeret med monitorens hemmelige nøgle.

Se [Server- / VM-monitor](/docs/monitor/server-monitor).

### Kubernetes-agent

Et Helm-chart, der indsamler en klynges metrikker, begivenheder og pod-logs og, med eBPF, dens traces, og sender dem med en indtagelsesnøgle.

Se [Kubernetes-agent](/docs/telemetry/kubernetes-agent).

### OpenTelemetry Collector

Open source-agenten, der modtager, behandler og sender telemetri. **Tilføj vært** installerer den på en maskine, Docker-agenten er én, og dine egne collectors sender til OneUptime med en indtagelsesnøgle.

Også kaldet: **Collector**. Se [Værter](/docs/telemetry/hosts) og [OpenTelemetry-collector på værten](/docs/telemetry/host-otel-collector).

### Runner

En lille proces, du kører i din egen infrastruktur, og som kører JavaScript-, Bash-, SSH- og kubectl-trinene i dine runbooks. Den forbinder ud til OneUptime med sit eget Runner-ID og sin egen nøgle.

Også kaldet: **Runbook-agenter**. Se [Runbook-agenter](/docs/runbooks/agents).

### Indtagelsesnøgle

Den nøgle, der lader noget sende telemetri ind i dit projekt: applikationer med OpenTelemetry, collectors og agenter. Den sendes i headeren `x-oneuptime-token`, og en API-nøgle til projektet virker ikke i stedet for den.

Også kaldet: **Telemetri Ingestion Key**, `oneuptime.apiKey`. Se [Indtagelsesnøgler](/docs/telemetry/ingestion-keys).

### API-nøgle

En nøgle, der lader et script, CLI'en, Terraform eller en AI-assistent læse og ændre dit projekt via API'et, med de tilladelser, du giver den. Opret en under **Projektindstillinger → Avanceret → API-nøgler**.

Se [Brugere, teams og tilladelser](/docs/permissions/index#api-nøgler).

## Ord med mere end én betydning

### Regel

Mange ting i OneUptime er regler, og hver af dem træffer én beslutning for dig: hvem der tilkaldes (**Vagtregler**, **Eskaleringsregler**), hvem der ejer og mærker nye poster (**Ejerregler**, **Etiketregler**), hvad der hører sammen (**Grupperingsregler**), og hvad OneUptime AI gør (**AI-regler**). En monitors egne regler er dens kriterier.

Se [Grundbegreber](/docs/introduction/core-concepts#regeltyperne).

### Rolle

Fire forskellige ting: de tilladelser, et team giver, for eksempel Project Owner eller Project Admin; en **Brugerdefineret rolle**, du sætter sammen af tilladelser; en **Hændelsesrolle**, den rolle, nogen har i én hændelse; og en **Network Device Role**, hvad en enhed på dit netværk gør.

Se [Brugere, teams og tilladelser](/docs/permissions/index).

### Ressource

Oftest den infrastruktur, OneUptime registrerer, for eksempel værter, klynger, databaser og cloudressourcer. En hændelses **Berørte ressourcer** er de monitorer og den infrastruktur, den rammer, en statussides ressourcer er de monitorer og grupper, den viser, og OpenTelemetrys ressourceattributter fortæller, hvor telemetrien kom fra.

Se [Inventar – Oversigt](/docs/inventory/overview).

### Indstillinger

Hvert niveau har sine egne: **Projektindstillinger** for hele projektet, **Brugerindstillinger** for, hvordan OneUptime når dig, og et produkts egne **Indstillinger** i dets sidemenu, for eksempel hændelsestilstande og skabeloner under **Hændelser**. En selvhostet servers indstillinger findes i Admin Dashboard.

Se [Projektindstillinger](/docs/configuration/project-settings).

### Politik

Oftest en **Vagtpolitik**: hvem der tilkaldes, og hvem der er den næste. En politik for indgående opkald giver dit team et telefonnummer, der ringer til den, der har vagt, og en fejlbudgetpolitik skriver ned, hvad dit team gør, når et SLO's budget er ved at slippe op.

Se [Vagtpolitikker](/docs/on-call/policies).

### Skabelon

Et gemt udgangspunkt: en monitorskabelon opretter monitorer, hændelses- og advarselsskabeloner udfylder nye poster, note- og postmortem-skabeloner starter det, du skriver, og dashboardskabeloner bygger et dashboards widgets.

Se [Monitorskabeloner](/docs/monitor/monitor-templates).

### Arbejdsområde

Et Slack- eller Microsoft Teams-arbejdsområde, du forbinder til OneUptime under **Arbejdsområdeforbindelser** for at poste opdateringer i dine kanaler og handle på hændelser fra chatten. Det, som nogle andre værktøjer kalder et arbejdsområde, er et projekt i OneUptime.

Se [Slack](/docs/workspace-connections/slack).

### Agent

Et program, du installerer, og som rapporterer til OneUptime eller handler på dets vegne: infrastruktur-, Kubernetes- og Docker-agenterne sender det, de indsamler, en Runner kører runbook-trin, og en AI-agent lader OneUptime AI undersøge en klynge eller en vært. De opgaver, du giver **Kode**, er AI-agentopgaver.

Se [Hvilken skal jeg bruge?](/docs/introduction/which-one#sonde-agent-collector-eller-runner).

### Vagtregler

Under **Hændelser** og **Advarsler** vælger vagtregler de vagtpolitikker, en ny hændelse eller advarsel kører. En persons egne regler for, hvordan et tilkald når frem, hed også vagtregler: De hedder nu **Sådan når man mig**, under **Brugerindstillinger**.

Se [Hændelsesindstillinger og automatisering](/docs/incidents/settings#vagtregler-for-hændelser) og [Sådan når man mig](/docs/notifications/on-call-rules).

### Notifikationsindstillinger

Under **Brugerindstillinger**: hvilke opdateringer du får om det, du ejer, og på hvilke kanaler. Projektets kontakter for SMS og opkald, dets beskedsaldo og dets egen SMTP og Twilio hed også notifikationsindstillinger: De hedder nu **Notifikationskanaler**, under **Projektindstillinger**.

Se [Notifikationsindstillinger](/docs/notifications/notification-settings).

## Næste trin

:::cards
- [Hvilken skal jeg bruge?](/docs/introduction/which-one): Hændelse eller advarsel, arbejdsgang eller runbook, og de andre ting, der ligner hinanden, side om side.
- [Grundbegreber](/docs/introduction/core-concepts): Hvordan delene hænger sammen, på én side.
- [Hurtigstart](/docs/introduction/quickstart): Brug ordene i praksis på femten minutter.
:::
