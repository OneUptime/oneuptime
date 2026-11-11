# Welke gebruik ik?

Sommige dingen in OneUptime lijken op elkaar. Deze pagina zet elke reeks naast elkaar, met waar elk ervan voor dient, zodat u meteen de juiste kiest. Elke tabel past op één scherm, en de eerste kolom opent de pagina die die keuze uitgebreid behandelt.

:::cards
- [Incident, waarschuwing of een ander soort probleem?](#incident-waarschuwing-of-een-ander-soort-probleem): Wat een probleem in OneUptime wordt.
- [Workflow, runbook, playbook of AI-regel?](#workflow-runbook-playbook-of-ai-regel): Waarmee u automatiseert.
- [Monitorgroep, service of label?](#monitorgroep-service-of-label): Hoe u groepeert wat u bewaakt.
- [Sonde, agent, collector of Runner?](#sonde-agent-collector-of-runner): Wat u installeert, en welke sleutel elk ervan gebruikt.
- [Dashboard, openbaar dashboard of statuspagina?](#dashboard-openbaar-dashboard-of-statuspagina): Wat u deelt, en met wie.
:::

## Incident, waarschuwing of een ander soort probleem?

De meeste problemen zijn een incident of een waarschuwing: kies op basis van wie het probleem raakt. De andere zijn records die OneUptime voor u bijhoudt, en elk ervan kan tot een incident of een waarschuwing leiden.

| Record | Wat het is | Gebruik het wanneer |
| --- | --- | --- |
| [Incident](/docs/incidents/index) | Een probleem dat uw gebruikers raakt. Het kan degene oproepen die dienst heeft en op uw statuspagina's verschijnen. | Klanten merken het, of zullen het snel merken: een storing, een vertraging, een checkout die mislukt. |
| [Waarschuwing](/docs/alerts/index) | Een probleem voor uw team. Het kan degene oproepen die dienst heeft, maar verschijnt nooit op een statuspagina. | Uw team moet ingrijpen voordat gebruikers het merken: een schijf die volloopt, een certificaat dat bijna verloopt. |
| [Episode](/docs/incidents/episodes) | Een groep gerelateerde incidenten, of gerelateerde waarschuwingen, die als één geheel wordt afgehandeld. | Eén oorzaak leidde tot veel incidenten of waarschuwingen. Groeperingsregels openen episodes voor u. |
| [Uitzondering](/docs/telemetry/exceptions) | Elk voorkomen van één fout die uw code opwerpt, gegroepeerd, met de stacktrace. | U wilt een bug oplossen. Een Exceptions-monitor kan een waarschuwing of een incident openen wanneer fouten pieken. |
| [AI-inzicht](/docs/ai/ai-sre#inzichten-proactieve-detectie) | Een probleem dat OneUptime in uw telemetrie vond voordat er iemand werd opgeroepen, zoals een piek in foutlogs. | U wilt vroege waarschuwingen. Een inzicht roept nooit iemand op en opent nooit een incident: het wacht in een inbox. |
| [Beveiligingszaak](/docs/telemetry/security-cases) | Eén dreiging die het onderzoeken waard is, met daarin elke detectie over dezelfde gebruiker, host of hetzelfde adres. | Uw beveiligingsteam onderzoekt het. **Incident melden** op een zaak opent een incident wanneer gebruikers worden geraakt. |

Een waarschuwing kan worden gekoppeld aan het incident waar ze bij bleek te horen, dus beginnen met een waarschuwing kost u niets.

## Workflow, runbook, playbook of AI-regel?

Alle vier kunnen vanzelf draaien. Kies op basis van waarop ze inwerken en wie de stappen heeft geschreven.

| Hulpmiddel | Wat het doet | Gebruik het wanneer |
| --- | --- | --- |
| [Workflow](/docs/workflows/index) | Blokken op een canvas die draaien wanneer hun trigger afgaat: een incident wordt aangemaakt, een schema is aan de beurt, een andere tool roept een URL aan. | U wilt OneUptime aan andere tools koppelen, of op de records ervan reageren, zonder code te schrijven. |
| [Runbook](/docs/runbooks/index) | Uw responsprocedure als stappen, van handmatige checklists tot scripts, HTTP-verzoeken en kubectl, uitgevoerd bij een incident, een waarschuwing of een onderhoudsgebeurtenis. | Responders moeten elke keer dezelfde stappen volgen. Runbook-regels starten een runbook bij de incidenten die overeenkomen. |
| [Playbook](/docs/telemetry/security-cases#playbooks) | Stappen die reageren op een beveiligingszaak: het bewijs veiligstellen, degene oproepen die dienst heeft, een gebruiker blokkeren. | Uw beveiligingsteam reageert elke keer op dezelfde manier op hetzelfde soort dreiging. |
| [AI-regel](/docs/ai/ai-sre#welke-incidenten-worden-onderzocht-en-hersteld) | Bepaalt welke nieuwe incidenten en waarschuwingen OneUptime AI onderzoekt en oplost, en of het eerst toestemming vraagt. | OneUptime AI moet maar aan een deel van de incidenten werken, of oplossen zonder te vragen. Zonder regel onderzoekt het ze allemaal. |

## Monitorgroep, service of label?

Alle drie brengen dingen samen, voor verschillende lezers. Ze werken ook samen: de monitoren van een service kunnen samen één monitorgroep vormen, en ze kunnen allemaal hetzelfde label dragen.

| Keuze | Wat het is | Gebruik het wanneer |
| --- | --- | --- |
| [Monitorgroep](/docs/monitor/monitor-groups) | Meerdere monitoren samengevoegd tot één status, de slechtste onder hen, met een eigen beschikbaarheid. | Klanten moeten één rij op een statuspagina zien voor iets wat uit meerdere monitoren bestaat, zoals Checkout. |
| [Service](/docs/telemetry/services) | Een applicatie die OneUptime in uw telemetrie heeft gevonden, met de logs, traces, metrics, incidenten en eigenaren ervan op één pagina. | U wilt alles over één applicatie op één plek. Hij verschijnt vanzelf op basis van zijn `service.name`. |
| [Label](/docs/configuration/label-and-owner-rules) | Een tag die u op monitoren en de meeste andere records zet. Een record kan er veel dragen. | U wilt lijsten filteren, de machtigingen van een team beperken, of records in regels selecteren. |

Monitorgroepen staan standaard uit: zet ze aan onder **Projectinstellingen → Geavanceerd → Functievlaggen**.

## Sonde, agent, collector of Runner?

Voor het grootste deel van OneUptime hoeft u niets te installeren: installeer alleen iets om te bereiken wat OneUptime niet van buitenaf kan zien. Elk onderdeel maakt een uitgaande verbinding, met een sleutel van zijn eigen soort.

| Installatie | Wat het doet | Installeer het wanneer | Sleutel die het gebruikt |
| --- | --- | --- | --- |
| [Aangepaste sonde](/docs/probe/custom-probe) | Voert de controles van uw monitoren uit vanuit uw netwerk. | Wat u controleert, staat achter uw firewall. De eigen sondes van OneUptime controleren wat openbaar is. | Een eigen sonde-ID en sleutel |
| [Infrastructuuragent](/docs/monitor/server-monitor) | Rapporteert de CPU, het geheugen, de schijven en de processen van één machine aan een Server- / VM-monitor. | U wilt één monitor voor één server, met criteria op de cijfers ervan. | De geheime sleutel van de monitor |
| [OpenTelemetry Collector](/docs/telemetry/hosts) | Verstuurt de metrics, logs en processen van een machine. **Host toevoegen** installeert hem met één opdracht. | U wilt een machine onder **Hosts**, met de telemetrie ervan. | Een ingestiesleutel |
| [Kubernetes-agent](/docs/telemetry/kubernetes-agent) | Verzamelt de metrics, gebeurtenissen, logs en traces van een cluster. U installeert hem met Helm. | U draait Kubernetes. | Een ingestiesleutel |
| [Runner](/docs/runbooks/agents) | Voert runbook-stappen uit, zoals Bash, SSH en kubectl, binnen uw infrastructuur. | Uw runbooks moeten uw eigen hosts en clusters bereiken. | Een eigen Runner-ID en sleutel |

### Ingestiesleutel of API-sleutel?

| Sleutel | Wat u ermee kunt doen | Waar u hem aanmaakt |
| --- | --- | --- |
| [Ingestiesleutel](/docs/telemetry/ingestion-keys) | Telemetrie naar het project sturen, en verder niets. | **Projectinstellingen → Telemetrie & APM → Ingestiesleutels** |
| [API-sleutel](/docs/permissions/index#api-sleutels) | Het project lezen en wijzigen via de API, de CLI, Terraform of een AI-assistent, met de machtigingen die u hem geeft. | **Projectinstellingen → Geavanceerd → API-sleutels** |

Geen van beide werkt in plaats van de andere.

## Dashboard, openbaar dashboard of statuspagina?

Kies op basis van wie het moet zien.

| Delen | Wie het ziet | Gebruik het wanneer |
| --- | --- | --- |
| [Dashboard](/docs/dashboards/index) | Mensen die zich bij uw project aanmelden. | Uw team volgt grafieken en lijsten: een scherm voor de dienstdoende, de eigen weergave van een team. |
| [Openbaar dashboard](/docs/dashboards/sharing) | Iedereen met de link, tenzij u een wachtwoord toevoegt, het tot bepaalde IP-adressen beperkt of het op uw eigen domein host. | Mensen buiten het project moeten uw grafieken zien, zoals een partner of een scherm aan de muur. |
| [Statuspagina](/docs/status-pages/index) | Uw klanten, openbaar, of alleen de privégebruikers die u toelaat. | Klanten willen weten of uw services werken, en bericht krijgen over incidenten en onderhoud. |

Een statuspagina spreekt in incidenten en in de namen die u aan uw monitoren geeft; een dashboard toont de cijfers erachter.

## Volgende stappen

:::cards
- [Woordenlijst](/docs/introduction/glossary): Elk woord dat OneUptime gebruikt, in een zin of twee.
- [Kernbegrippen](/docs/introduction/core-concepts): Hoe de onderdelen samenhangen, op één pagina.
- [Snelstart](/docs/introduction/quickstart): Een monitor, een oproep en een statuspagina in vijftien minuten.
:::
