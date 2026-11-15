# Woordenlijst

Elk woord dat OneUptime gebruikt, in een zin of twee, met de andere namen die het heeft en de pagina die het uitgebreid behandelt. De woorden zijn gegroepeerd in de volgorde waarin u ze tegenkomt: de eerste groep is de kringloop die elk project doorloopt, en de laatste bevat de woorden die meer dan één ding betekenen.

:::cards
- [Begin hier](#begin-hier): De kringloop die elk project doorloopt, van een monitor tot een oproep en een statuspagina.
- [Wat u bewaakt](#wat-u-bewaakt): Services, hosts, clusters, clouds en de doelen waaraan u ze houdt.
- [Aan een probleem werken](#aan-een-probleem-werken): Statussen, ernstniveaus, eigenaren en labels, en de andere soorten problemen.
- [Telemetrie en dashboards](#telemetrie-en-dashboards): Wat uw systemen versturen, en waar u ernaar kijkt.
- [Automatisering en AI](#automatisering-en-ai): Wat vanzelf draait, en wat OneUptime AI doet.
- [Wat u installeert en de sleutels](#wat-u-installeert-en-de-sleutels): De agents die u draait, en de sleutel die elk ervan gebruikt.
- [Woorden met meer dan één betekenis](#woorden-met-meer-dan-één-betekenis): Regel, rol, resource, instellingen en de andere woorden met meerdere taken.
:::

## Begin hier

### Project

Waar alles staat wat u inricht: monitoren, incidenten, bereikbaarheid, statuspagina's, telemetrie en instellingen. Niets in het ene project is zichtbaar in een ander, en de meeste bedrijven hebben er maar één nodig.

Zie [Kernbegrippen](/docs/introduction/core-concepts#projecten-en-mensen).

### Account

Uzelf: het e-mailadres en wachtwoord waarmee u zich aanmeldt, uw naam, tijdzone en taal. Eén account kan bij een onbeperkt aantal projecten horen.

Zie [Uw account](/docs/introduction/your-account).

### Team

Een groep mensen in een project, waarvan de machtigingen bepalen wat de leden mogen doen. Elk nieuw project begint met drie teams: Owners, Admin en Members. Nodig mensen uit onder **Gebruikers**, en groepeer ze onder **Teams**.

Zie [Gebruikers, teams en machtigingen](/docs/permissions/index).

### Monitor

Controleert één ding dat u draait, zoals een website, een API, een server of een Kubernetes-cluster, en beslist of het werkt. Wanneer de criteria ervan overeenkomen, verandert de monitor van status en kan hij een incident melden of een waarschuwing aanmaken.

Zie [Een monitor maken](/docs/monitor/create-monitor).

### Criteria

De regels van een monitor: wat elk controleresultaat betekent. Ze worden op volgorde bekeken, en de eerste die overeenkomt kan de status van de monitor wijzigen, een incident melden, een waarschuwing aanmaken, of alle drie.

Ook wel: **Bewakingscriteria**, **Monitorcriteria**, **Monitor Steps**. Zie [Criteria en statussen](/docs/monitor/criteria-and-statuses).

### Monitorstatus

Hoe een monitor er op dit moment voor staat. Elk nieuw project heeft drie monitorstatussen, **Operationeel**, **Verminderd** en **Offline**, en u kunt er zelf meer toevoegen.

Zie [Criteria en statussen](/docs/monitor/criteria-and-statuses).

### Sonde

Een machine die de controles van monitoren volgens een schema uitvoert: ze vraagt een pagina op, roept een API aan of pingt een host. OneUptime Cloud draait sondes in meerdere regio's, en een aangepaste sonde die u in uw eigen netwerk draait, controleert wat alleen dat netwerk kan bereiken.

Ook wel: **Aangepaste probes**. Zie [Aangepaste probes](/docs/probe/custom-probe).

### Incident

Een probleem dat uw gebruikers raakt, zoals een storing of een vertraging, en het dossier waarmee uw team werkt zolang het duurt. Het kan degene oproepen die dienst heeft en op uw statuspagina's verschijnen.

Zie [Incidenten – Overzicht](/docs/incidents/index).

### Waarschuwing

Een probleem waar uw team naar moet kijken voordat gebruikers het merken, zoals een schijf die volloopt of een certificaat dat bijna verloopt. Het kan degene oproepen die dienst heeft, maar verschijnt nooit op een statuspagina.

Zie [Waarschuwingen – Overzicht](/docs/alerts/index).

### Episode

Een groep gerelateerde incidenten, of gerelateerde waarschuwingen, die uw team als één geheel afhandelt, met één set eigenaren en één status. Groeperingsregels bepalen wat erin thuishoort.

Ook wel: **Incidentepisode**, **Waarschuwingsepisode**. Zie [Episodes](/docs/incidents/episodes).

### Bereikbaarheidsbeleid

Bepaalt wie wordt opgeroepen over een incident, een waarschuwing of een episode, en wie de volgende is als niemand bevestigt. De niveaus ervan zijn escalatieregels.

Ook wel: **Bereikbaarheidsdienst**, **On-Call Duty Policy**, **Piket**, `OnCallDutyPolicy`. Zie [Bereikbaarheidsbeleid](/docs/on-call/policies).

### Escalatieregel

Eén niveau van een bereikbaarheidsbeleid: wie wordt opgeroepen, en hoe lang er wordt gewacht tot iemand bevestigt voordat het volgende niveau wordt opgeroepen. Een niveau kan mensen, teams of een bereikbaarheidsschema oproepen.

Zie [Escalatieregels](/docs/on-call/escalation-rules).

### Bereikbaarheidsschema

Wie er op elk moment dienst heeft: mensen wisselen elkaar af, en ieder draagt over aan de volgende. Een escalatieregel die een schema oproept, roept degene op die daarin dienst heeft.

Ook wel: **Rotation**, **Schema van bereikbaarheidsbeleid**. Zie [Bereikbaarheidsschema's](/docs/on-call/schedules).

### Laag

Eén rotatie binnen een bereikbaarheidsschema: wie elkaar afwisselen, hoe vaak de dienst wordt overgedragen en welke uren de laag dekt. De hoogste laag waarin iemand dienst heeft, roept op, dus de hoofdrotatie komt bovenaan en de reservedekking eronder.

Zie [Bereikbaarheidsschema's](/docs/on-call/schedules#lagen).

### Meldingsmethode

Een adres waarop OneUptime u in een project mag bereiken: een e-mailadres, een telefoonnummer voor sms of oproepen, uw Slack- of Microsoft Teams-account, of de OneUptime-app op uw telefoon. Ieder voegt zijn eigen adressen toe onder **Gebruikersinstellingen**.

Zie [Meldingsmethoden](/docs/notifications/notification-methods).

### Hoe ik bereikbaar ben

Uw eigen regels om opgeroepen te worden: welke van uw meldingsmethoden een oproep probeert, en na hoe lang. Eén ladder geldt voor elk incident, elke waarschuwing en elke episode, en een ernst kan eigen regels hebben. Ieder stelt de eigen regels in onder **Gebruikersinstellingen**.

Ook wel: **Persoonlijke bereikbaarheidsregels**. Zie [Hoe ik bereikbaar ben](/docs/notifications/on-call-rules).

### Statuspagina

Een pagina die uw klanten laat zien of uw services werken, en welke incidenten en welk onderhoud ze raken. Ze kan openbaar zijn, of privé voor de mensen die u toelaat.

Zie [Statuspagina's – Overzicht](/docs/status-pages/index).

### Abonnee

Iemand die een statuspagina volgt via e-mail, sms, Slack, Microsoft Teams of webhook, en bericht krijgt wanneer een incident of onderhoud erop begint, verandert en eindigt.

Zie [Abonnees en aankondigingen](/docs/status-pages/subscribers).

### Geplande onderhoud

Gepland werk, vooraf aangekondigd. Elke onderhoudsgebeurtenis doorloopt de onderhoudsstatussen **Gepland**, **Lopend**, **Beëindigd** en **Voltooid**, en de statuspagina's waarop ze wordt getoond, informeren bezoekers en abonnees erover.

Ook wel: **Geplande onderhoudsgebeurtenis**, **Geplande gebeurtenis**, **Gebeurtenis**. Zie [Geplande onderhoud – Overzicht](/docs/scheduled-maintenance/index).

### Telemetrie

Wat uw systemen naar OneUptime sturen: logs, metrics, traces, exceptions en profielen. Applicaties versturen haar met OpenTelemetry, en de agents van OneUptime versturen haar vanaf hosts, clusters en overige infrastructuur, elk met een ingestiesleutel.

Zie [OpenTelemetry](/docs/telemetry/open-telemetry).

## Wat u bewaakt

### Monitorgroep

Meerdere monitoren samengevoegd tot één status, de slechtste onder hen, met een eigen beschikbaarheid. Een statuspagina kan de hele groep als één rij tonen. Zet monitorgroepen aan onder **Projectinstellingen → Geavanceerd → Functievlaggen**.

Zie [Monitorgroepen](/docs/monitor/monitor-groups).

### Service

Een applicatie of microservice die u draait. OneUptime voegt hem toe zodra zijn eerste telemetrie binnenkomt, genoemd naar zijn `service.name`, en brengt zijn logs, traces, metrics, exceptions, incidenten en eigenaren samen op één pagina.

Ook wel: **Servicecatalogus**, **Telemetrieservice**. Zie [Services](/docs/telemetry/services).

### Host

Een Linux-, Windows- of macOS-machine die haar metrics, processen, logs en servicestatussen via de OpenTelemetry Collector verstuurt. **Host toevoegen** installeert de collector met één opdracht, en OneUptime houdt de configuratie ervan up-to-date.

Zie [Hosts](/docs/telemetry/hosts).

### Kubernetes

Uw Kubernetes-clusters, met hun nodes, pods, workloads, gebeurtenissen en logs, verstuurd door de Kubernetes-agent die u met Helm installeert.

Zie [Kubernetes-agent](/docs/telemetry/kubernetes-agent).

### Infrastructuur

De groep in het menu met de machines en platforms die u draait: Hosts, Kubernetes, Docker, Docker Swarm, Podman, Proxmox, OpenStack, VMware, Ceph, Storage Arrays, Network en IoT. Een agent of een koppeling vult elk ervan, en elk laat zien hoe het met elke machine, elk cluster of elk apparaat erin gaat.

Zie [Hosts](/docs/telemetry/hosts).

### Netwerk

Uw switches, routers, firewalls, access points en alles wat verder een adres op uw netwerk heeft, of het nu SNMP spreekt of niet.

Zie [Netwerkapparaat-monitor](/docs/monitor/network-device-monitor).

### Cloud

Uw AWS-accounts, Azure-abonnementen en Google Cloud-projecten, gekoppeld vanuit het dashboard. OneUptime somt elke resource erin op, leest de belangrijkste metrics ervan en legt vast wat er in die accounts is veranderd.

Zie [Een cloudaccount koppelen](/docs/telemetry/cloud-accounts).

### App-platforms

De apps die u op beheerde platforms draait, zoals Amazon ECS en Fargate, Google Cloud Run en Azure App Service. Elke plek waar ze draaien is een cloud-omgeving, die OneUptime aanmaakt zodra de eerste telemetrie ervan binnenkomt.

Ook wel: **Cloud-omgeving**. Zie [Cloud-omgevingen](/docs/telemetry/cloud-environments).

### Serverless

Uw serverless functies, zoals AWS Lambda, Google Cloud Functions en Azure Functions, opgesomd met hun traces, logs en metrics zodra hun OpenTelemetry-gegevens binnenkomen.

Ook wel: **Serverless functies**. Zie [Serverless functies](/docs/telemetry/serverless-functions).

### Databases

Elke database die uw applicaties bevragen, samengesteld uit uw traces, de eigen metrics van de database en de andere bronnen die OneUptime kan lezen, met hoe het met de engine ervan gaat.

Zie [Databases](/docs/telemetry/databases).

### Wachtrijen

De berichtenwachtrijen en topics die uw services gebruiken, zoals Apache Kafka, RabbitMQ en Amazon SQS, op basis van uw traces en de metrics van uw brokers.

Zie [Wachtrijen](/docs/telemetry/queues).

### Real User Monitoring

Wat echte mensen ervaren in uw web- en mobiele apps: het laden van pagina's, verzoeken, fouten en Core Web Vitals, gemeld door de app zelf in plaats van door een sonde.

Zie [RUM – Overzicht](/docs/rum/index).

### Inventaris

Eén lijst van alles wat OneUptime over uw omgeving weet: services, hosts, Kubernetes-objecten, virtuele machines, netwerkapparaten, cloudresources en de dingen die helemaal geen telemetrie sturen. Het meeste vult zichzelf in.

Zie [Inventaris – Overzicht](/docs/inventory/overview).

### Topologie

Een kaart van hoe uw systemen met elkaar verbonden zijn, welke services welke aanroepen en wat waar draait, getekend op basis van de telemetrie die u al verstuurt.

Zie [Topologie](/docs/telemetry/topology).

### SLO

Een betrouwbaarheidsdoel voor wat u bewaakt, zoals 99,9% van de tijd beschikbaar over 30 dagen. OneUptime meet elke SLO elke 5 minuten aan de hand van zijn monitoren.

Ook wel: **Service Level Objective**. Zie [SLO's – Overzicht](/docs/slo/introduction).

### Foutbudget

De downtime die het doel van een SLO toestaat: bij 99,9% over 30 dagen is dat 43 minuten en 12 seconden. Met ruim genoeg over kunt u risico's nemen; met weinig over remt u af en investeert u in stabiliteit.

Zie [Foutbudgetten](/docs/slo/error-budget).

## Aan een probleem werken

### Status

Waar een incident of een waarschuwing in uw respons staat. Elk nieuw project begint met **Geïdentificeerd**, **Bevestigd** en **Opgelost**: bevestigen zegt dat iemand ermee bezig is en voorkomt dat het volgende escalatieniveau wordt opgeroepen, en oplossen sluit het af.

Ook wel: **Status incident**, **Status waarschuwing**. Zie [Incidentstatussen en ernstniveaus](/docs/incidents/states-and-severities).

### Ernst

Hoe zwaar een incident of een waarschuwing weegt. Een nieuw project begint met Critical Incident, Major Incident en Minor Incident voor incidenten, en **Hoog** en **Laag** voor waarschuwingen; geef ze een andere naam of kleur, of voeg er zelf toe.

Ook wel: **Ernst van incident**, **Ernst van waarschuwing**. Zie [Incidentstatussen en ernstniveaus](/docs/incidents/states-and-severities).

### Eigenaar

Een persoon of een team die verantwoordelijk is voor één record, zoals een monitor, een incident of een statuspagina. Eigenaren krijgen bericht wanneer er iets gebeurt met wat van hen is.

Zie [Label- en eigenaarsregels](/docs/configuration/label-and-owner-rules).

### Label

Een tag, zoals Production of Checkout, die u op monitoren, incidenten, statuspagina's en de meeste andere records zet om ze te filteren en te groeperen. De machtigingen van een team kunnen beperkt worden tot de records met bepaalde labels.

Zie [Label- en eigenaarsregels](/docs/configuration/label-and-owner-rules).

### Uitzondering

Een fout die uw code opwerpt. OneUptime groepeert elk voorkomen van dezelfde fout tot één uitzondering, met de stacktrace, het verloop en de verzoeken waarin ze optrad.

Ook wel: **Uitzonderingen volgen**, `/telemetry-exception`. Zie [Uitzonderingen](/docs/telemetry/exceptions).

### AI-inzichten

Problemen die OneUptime in uw telemetrie vindt voordat er iets oproept: nieuwe en sterk stijgende exceptions, pieken in foutlogs, tragere traces, verschuivende metrics en deploys die de zaak erger maakten. Inzichten roepen nooit iemand op en openen nooit incidenten; ze wachten in een inbox tot iemand kijkt. De pagina **Inzichten** in het AI-gedeelte van een product of een record is wat OneUptime AI daar heeft geleerd.

Ook wel: **Inzichten**. Zie [AI SRE](/docs/ai/ai-sre#inzichten-proactieve-detectie).

### Beveiligingsgebeurtenissen

De SIEM van OneUptime: de beveiligingsgebeurtenissen uit uw logs, uw beveiligingstools en alles wat u verder verstuurt, bewaard in één vorm naast uw telemetrie, met detectieregels die er dreigingen in vinden.

Ook wel: **SIEM**. Zie [Beveiligingsgebeurtenissen (SIEM)](/docs/telemetry/security-events).

### Beveiligingszaak

Eén ding dat het onderzoeken waard is, afkomstig van detectieregels, threat intelligence of een gekoppeld beveiligingsproduct, waarin elke detectie over dezelfde gebruiker, host of hetzelfde adres is gegroepeerd. Analisten handelen zaken af in een wachtrij, en playbooks reageren erop.

Ook wel: **Zaak**. Zie [Beveiligingszaken en playbooks (SOAR)](/docs/telemetry/security-cases).

## Telemetrie en dashboards

### Logboeken

De regels die uw services, hosts en agents schrijven, die u doorzoekt in de logboekverkenner en bewaakt met een logs-monitor.

Zie [Logboekverkenner](/docs/telemetry/logs-explorer).

### Metrieken

De getallen die uw services en infrastructuur in de loop van de tijd rapporteren, zoals aantallen verzoeken, latentie, CPU en wachtrijdiepte.

Zie [Metriekverkenner](/docs/telemetry/metrics-explorer).

### Traces

Het pad van één verzoek door uw services, stap voor stap. Elke stap is een span, met zijn timing en zijn resultaat.

Zie [Traceverkenner](/docs/telemetry/traces-explorer).

### Profielen

Hoe uw applicatie CPU-tijd en geheugen besteedt, functie voor functie, verstuurd door een profiler die naar de Pyroscope-compatibele API van OneUptime pusht.

Ook wel: **Prestatieprofielen**, **Continue profilering**. Zie [Profielen](/docs/telemetry/profiles).

### AI / LLM

De gesprekken die uw AI-apps en agents voeren: elke modelaanroep, met de tokens, kosten, latentie, prompt en het antwoord, opgebouwd uit de OpenTelemetry-spans die uw app verstuurt.

Ook wel: **AI / LLM-observability**. Zie [AI- / LLM-observability](/docs/telemetry/ai-llm-observability).

### Data Observability

Bewaakt de tabellen in uw databases en warehouses, en laat u weten wanneer de gegevens erin te laat, ontbrekend of onjuist zijn, en welke run, deploy of tabel erachter zit.

Zie [Overzicht van Data-observability](/docs/data-observability/index).

### Gegevensbeveiliging

Vindt de gevoelige gegevens die uw bedrijf bewaart, in cloudbuckets, databases, warehouses en de telemetrie die u verstuurt, en vertelt u wat er mis is met hoe ze bewaard worden.

Zie [Overzicht van Gegevensbeveiliging](/docs/data-security/index).

### Dashboard

Een pagina met widgets die u zelf indeelt: grafieken van uw metrics, logs en traces, lijsten met incidenten en monitoren, uw SLO's en meer. Een dashboard is privé voor uw project totdat u het deelt.

Zie [Dashboards – Overzicht](/docs/dashboards/index).

### Public Dashboard

Een dashboard dat via een openbare link wordt gedeeld, voor mensen die zich niet bij uw project aanmelden. Bescherm het met een wachtwoord, beperk het tot bepaalde IP-adressen of host het op uw eigen domein.

Zie [Delen en publieke dashboards](/docs/dashboards/sharing).

## Automatisering en AI

### Workflow

Een automatisering zonder code: blokken op een canvas die draaien wanneer hun trigger afgaat, zoals een bericht in Slack plaatsen wanneer een incident wordt gemeld, of een andere tool aanroepen.

Zie [Workflows – Overzicht](/docs/workflows/index).

### Runbook

Een herbruikbare responsprocedure: handmatige en geautomatiseerde stappen die uw team uitvoert bij een incident, een waarschuwing of een onderhoudsgebeurtenis, met de hand of wanneer een runbook-regel overeenkomt.

Zie [Runbooks – Overzicht](/docs/runbooks/index).

### Playbook

De stappen die reageren op een beveiligingszaak, zoals het bewijs veiligstellen, degene oproepen die dienst heeft of een gebruiker blokkeren, vanzelf uitgevoerd of met één klik.

Ook wel: **Beveiligingsplaybook**. Zie [Beveiligingszaken en playbooks (SOAR)](/docs/telemetry/security-cases#playbooks).

### AI-regel

Bepaalt welke nieuwe incidenten of waarschuwingen OneUptime AI onderzoekt en oplost, en hoe. Zonder AI-regel onderzoekt het ze allemaal, dus de meeste projecten hebben er geen nodig.

Ook wel: **Regel voor automatisch herstel**. Zie [AI SRE](/docs/ai/ai-sre#welke-incidenten-worden-onderzocht-en-hersteld).

### OneUptime AI

De AI-site-reliability-engineer van OneUptime: hij onderzoekt elk nieuw incident en elke nieuwe waarschuwing in al uw telemetrie en zet wat hij vond op hun tijdlijn. De schakelaar **AI inschakelen** in **Projectinstellingen** zet het allemaal uit.

Ook wel: **AI SRE**. Zie [AI SRE](/docs/ai/ai-sre).

### AI vragen

Een chat over de gegevens van uw project. Hij bevraagt uw logs, traces, metrics, incidenten, monitoren en meer, en antwoordt met een bronvermelding bij elke bewering.

Ook wel: **Chat**. Zie [AI vragen](/docs/ai/ask-ai).

### Code

Waar u OneUptime AI vraagt om in uw repositories te werken, zoals u een codeeragent zou vragen: een bug oplossen, tests schrijven of een wijziging aanbrengen, en een pull request terugkrijgen.

Ook wel: **Taken**. Zie [Code](/docs/ai/ai-agent).

### Formulier

Een pagina die iedereen met de link kan invullen, zonder account. Elke inzending maakt een incident aan, voor een probleemmelding, of een onderhoudsgebeurtenis, voor een wijzigingsverzoek.

Zie [Formulieren – overzicht](/docs/forms/index).

## Wat u installeert en de sleutels

### Infrastructuuragent

De service `oneuptime-infrastructure-agent` achter een Server- / VM-monitor: hij rapporteert elke 30 seconden de CPU, het geheugen, de schijven en de processen van één machine, ondertekend met de geheime sleutel van de monitor.

Zie [Server- / VM-monitor](/docs/monitor/server-monitor).

### Kubernetes-agent

Een Helm-chart die de metrics, gebeurtenissen en podlogs van een cluster verzamelt en, met eBPF, de traces ervan, en ze verstuurt met een ingestiesleutel.

Zie [Kubernetes-agent](/docs/telemetry/kubernetes-agent).

### OpenTelemetry Collector

De opensource-agent die telemetrie ontvangt, verwerkt en verstuurt. **Host toevoegen** installeert hem op een machine, de Docker-agent is er een, en uw eigen collectors sturen naar OneUptime met een ingestiesleutel.

Ook wel: **Collector**. Zie [Hosts](/docs/telemetry/hosts) en [OpenTelemetry-collector op de host](/docs/telemetry/host-otel-collector).

### Runner

Een klein proces dat u in uw eigen infrastructuur draait en dat de JavaScript-, Bash-, SSH- en kubectl-stappen van uw runbooks uitvoert. Het maakt een uitgaande verbinding met OneUptime, met een eigen Runner-ID en sleutel.

Ook wel: **Runbook-agenten**. Zie [Runbook-agenten](/docs/runbooks/agents).

### Ingestiesleutel

De sleutel waarmee iets telemetrie naar uw project kan sturen: apps met OpenTelemetry, collectors en agents. Hij gaat in de header `x-oneuptime-token`, en een API-sleutel van het project werkt niet in zijn plaats.

Ook wel: **Telemetrie Inname Key**, `oneuptime.apiKey`. Zie [Ingestiesleutels](/docs/telemetry/ingestion-keys).

### API-sleutel

Een sleutel waarmee een script, de CLI, Terraform of een AI-assistent uw project via de API kan lezen en wijzigen, met de machtigingen die u hem geeft. Maak er een aan onder **Projectinstellingen → Geavanceerd → API-sleutels**.

Zie [Gebruikers, teams en machtigingen](/docs/permissions/index#api-sleutels).

## Woorden met meer dan één betekenis

### Regel

Veel dingen in OneUptime zijn regels, en elke regel neemt één beslissing voor u: wie wordt opgeroepen (**Bereikbaarheidsregels**, **Escalatieregels**), wie eigenaar wordt van nieuwe records en hoe ze worden gelabeld (**Eigenaarsregels**, **Labelregels**), wat bij elkaar hoort (**Groeperingsregels**) en wat OneUptime AI doet (**AI-regels**). De eigen regels van een monitor zijn zijn criteria.

Zie [Kernbegrippen](/docs/introduction/core-concepts#de-soorten-regels).

### Rol

Vier verschillende dingen: de machtigingen die een team verleent, zoals Project Owner of Project Admin; een **Aangepaste rol** die u uit machtigingen samenstelt; een **Incidentrol**, de rol die iemand in één incident speelt; en een **Network Device Role**, wat een apparaat op uw netwerk doet.

Zie [Gebruikers, teams en machtigingen](/docs/permissions/index).

### Resource

Meestal de infrastructuur die OneUptime vastlegt, zoals hosts, clusters, databases en cloudresources. De **Getroffen resources** van een incident zijn de monitoren en infrastructuur die het raakt, de resources van een statuspagina zijn de monitoren en groepen die ze toont, en de resource-attributen van OpenTelemetry zeggen waar telemetrie vandaan kwam.

Zie [Inventaris – Overzicht](/docs/inventory/overview).

### Instellingen

Elk niveau heeft zijn eigen: **Projectinstellingen** voor het hele project, **Gebruikersinstellingen** voor hoe OneUptime u bereikt, en de eigen **Instellingen** van een product in het zijmenu ervan, zoals incidentstatussen en sjablonen onder **Incidenten**. De instellingen van een zelf-gehoste server staan in het Admin Dashboard.

Zie [Projectinstellingen](/docs/configuration/project-settings).

### Beleid

Meestal een **Bereikbaarheidsbeleid**: wie wordt opgeroepen, en wie de volgende is. Een beleid voor inkomende oproepen geeft uw team een telefoonnummer dat degene laat overgaan die dienst heeft, en een foutbudgetbeleid legt vast wat uw team doet als het budget van een SLO opraakt.

Zie [Bereikbaarheidsbeleid](/docs/on-call/policies).

### Sjabloon

Een opgeslagen vertrekpunt: een monitorsjabloon maakt monitoren aan, incident- en waarschuwingssjablonen vullen nieuwe records in, notitie- en postmortemsjablonen beginnen wat u schrijft, en dashboardsjablonen bouwen de widgets van een dashboard.

Zie [Monitorsjablonen](/docs/monitor/monitor-templates).

### Werkruimte

Een Slack- of Microsoft Teams-werkruimte die u onder **Werkruimte-verbindingen** aan OneUptime koppelt, om updates in uw kanalen te plaatsen en vanuit de chat op incidenten te reageren. Wat sommige andere tools een werkruimte noemen, is in OneUptime een project.

Zie [Slack](/docs/workspace-connections/slack).

### Agent

Een programma dat u installeert en dat aan OneUptime rapporteert of namens OneUptime handelt: de infrastructuur-, Kubernetes- en Docker-agents versturen wat ze verzamelen, een Runner voert runbook-stappen uit, en een AI-agent laat OneUptime AI een cluster of een host onderzoeken. De taken die u aan **Code** geeft, zijn taken voor een AI-agent.

Zie [Welke gebruik ik?](/docs/introduction/which-one#sonde-agent-collector-of-runner).

### Bereikbaarheidsregels

Onder **Incidenten** en **Waarschuwingen** kiezen bereikbaarheidsregels het bereikbaarheidsbeleid dat een nieuw incident of een nieuwe waarschuwing uitvoert. De eigen regels van iemand over hoe een oproep die persoon bereikt, heetten ook bereikbaarheidsregels: ze heten nu **Hoe ik bereikbaar ben**, onder **Gebruikersinstellingen**.

Zie [Incidentinstellingen en automatisering](/docs/incidents/settings#bereikbaarheidsregels-voor-incidenten) en [Hoe ik bereikbaar ben](/docs/notifications/on-call-rules).

### Meldingsinstellingen

Onder **Gebruikersinstellingen**: welke updates over wat van u is u bereiken, en via welke kanalen. De schakelaars van het project voor sms en oproepen, het berichtentegoed ervan en de eigen SMTP en Twilio ervan heetten ook meldingsinstellingen: ze heten nu **Meldingskanalen**, onder **Projectinstellingen**.

Zie [Meldingsinstellingen](/docs/notifications/notification-settings).

## Volgende stappen

:::cards
- [Welke gebruik ik?](/docs/introduction/which-one): Incident of waarschuwing, workflow of runbook, en de andere dingen die op elkaar lijken, naast elkaar.
- [Kernbegrippen](/docs/introduction/core-concepts): Hoe de onderdelen samenhangen, op één pagina.
- [Snelstart](/docs/introduction/quickstart): De woorden in vijftien minuten in de praktijk brengen.
:::
