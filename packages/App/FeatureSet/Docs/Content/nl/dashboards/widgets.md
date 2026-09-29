# Widgets

Een widget is één tegel op een dashboard. Deze pagina somt elke widget op die je kunt toevoegen, wat hij toont en wanneer je ernaar grijpt.

Voor hoe je widgets over het canvas sleept, zie [Een dashboard maken](/docs/dashboards/authoring).

## Charts en getallen

### Chart

Een lijn-, balk- of vlakchart van één of meer metric-series over het tijdsbereik van het dashboard.

**Instellingen**:

- Eén of meer metric-queries.
- Een optionele formule die twee queries combineert (bijvoorbeeld `errors / total * 100` voor een foutpercentage).
- Een "show as rate"-optie voor cumulatieve counters die zonder reset blijven groeien.
- Weergaveopties: gestapeld of overlapt, Y-as-eenheid, positie van de legenda, chart-type.

Gebruik dit wanneer: trends ertoe doen. Latency in de tijd, foutaantal, wachtrijdiepte, alles waar de vorm van de lijn het verhaal vertelt.

### Value

Eén groot getal met optionele gekleurde drempels.

**Instellingen**:

- Een metric-query die één getal teruggeeft (laatste waarde, gemiddelde of max over het tijdsbereik).
- Een optionele **warning**-drempel (geel boven).
- Een optionele **critical**-drempel (rood boven).
- Getalnotatie en eenheid.

Gebruik dit wanneer: één getal de vraag beantwoordt. Huidig foutpercentage, P95-latency op dit moment, aantal openstaande incidenten.

### Gauge

Een ronde gauge met een minimum, maximum, warning-band en critical-band.

**Instellingen**: een metric-query en de vier grenzen.

Gebruik dit wanneer: de waarde binnen een bekend bereik valt. CPU-percentage (0–100%), schijfgebruik, wachtrijcapaciteit.

### Table

Een tabel met metric-resultaten, één rij per groep.

**Instellingen**: een metric-query (meestal gegroepeerd op een label zoals host of service), de kolommen om te tonen en een rijlimiet.

Gebruik dit wanneer: je een uitsplitsing wilt in plaats van een trend. Top 10 luidruchtigste hosts, foutaantal per service, requests per endpoint.

## Text

Een statisch blok Markdown.

**Instellingen**: de Markdown-body. Koppen, lijsten, links, nadruk en codeblokken worden allemaal gerenderd.

Gebruik dit wanneer: je een sectiekop wilt, een alinea context, een lijst met links naar runbooks of een tijdelijke banner tijdens een incident.

## HTML

Je eigen HTML, CSS en JavaScript, gerenderd als widget.

**Instellingen**: de HTML-body, een optionele stylesheet, een optioneel script en drie permissie-schakelaars.

Gebruik dit wanneer: je iets nodig hebt wat geen enkele ingebouwde widget dekt — een ingesloten badge van een derde partij, een tabel opgehaald uit een interne API, een eigen legenda, een set gestylede links naar je eigen tools.

### Wat het wel en niet kan

De widget wordt gerenderd in een sandboxed frame op zijn eigen geïsoleerde origin. Binnen dat frame kan je code zo'n beetje alles: DOM opbouwen, timers draaien, van elke URL fetchen, op een canvas tekenen.

Wat het niet kan, is bij de OneUptime-pagina eromheen komen. Het heeft geen toegang tot de DOM, cookies, local storage of API-sessie van het dashboard, en het kan de browsertab niet wegnavigeren. Dat geldt of het dashboard nu privé is of publiek gedeeld.

Twee gevolgen die het waard zijn om te weten voordat je er iets in plakt:

- Een `fetch` vanuit de widget is een cross-origin request vanaf een opaque origin, dus de server die je aanroept moet dat met CORS toestaan. De OneUptime-API vanaf hier aanroepen wordt niet ondersteund.
- De widget begint transparant. Zet een achtergrond op `body` in je CSS als je wilt dat hij de kaart vult.

### Dashboardvariabelen gebruiken

Schrijf `{{variableName}}` ergens in de HTML, CSS of JavaScript en het wordt vervangen door de huidige waarde van die variabele voordat de widget rendert. Een nieuwe waarde kiezen rendert de widget opnieuw. Een placeholder die een variabele noemt die niet bestaat, blijft staan zoals hij is.

Scripts krijgen dezelfde waarden, plus het tijdsbereik van het dashboard, op `window.ONEUPTIME`:

```javascript
window.ONEUPTIME.variables.environment; // huidige waarde, of "" als niet ingesteld
window.ONEUPTIME.startDate; // ISO 8601-string, begin van het tijdsbereik van het dashboard
window.ONEUPTIME.endDate; // ISO 8601-string, einde ervan
```

De widget laadt opnieuw telkens wanneer het dashboard ververst, dus een widget die zijn eigen data ophaalt blijft het refresh-interval bij.

### Permissies

**Run JavaScript** (JavaScript draaien; standaard aan) draait je script. Zet het uit om alleen markup en styles te renderen — het script wordt dan volledig uit de widget weggelaten in plaats van alleen geblokkeerd.

**Open links in a new tab** (links in een nieuw tabblad openen; standaard aan) laat links en `window.open` een browsertabblad openen. Links openen altijd in een nieuw tabblad; de widget kan het dashboard zelf nooit wegnavigeren.

**Allow forms to submit** (formulieren laten versturen; standaard uit) laat een `<form>` binnen de widget versturen.

Iedereen die het dashboard kan bewerken bepaalt wat deze widget draait, en iedereen die het dashboard bekijkt draait het — op een publiek dashboard zijn dat ook anonieme bezoekers. Behandel bewerkrechten op een dashboard met een HTML-widget zoals je toegang tot elke andere code die je uitlevert zou behandelen.

## Logs en traces

### Log Chart

Een tijdreeksgrafiek van het logvolume over het tijdsbereik van het dashboard. Elke reeks staat voor een severity, waardoor foutpieken opvallen tussen normaal verkeer.

**Instellingen**:

- Visualisatie als staaf-, lijn- of vlakdiagram. Staaf- en vlakdiagrammen stapelen de severity-reeksen.
- Optionele severity-filters.
- Optionele tekstzoekopdracht in de logtekst.
- Exacte OpenTelemetry-attribuutfilters via zoekbare key/value-rijen. Attribuutnamen en bekende waarden worden voorgesteld terwijl je typt, en eigen waarden blijven ondersteund.
- Een optionele titel.

De tijdsbereik- en verversbediening van het dashboard voert de query voor de grafiek automatisch opnieuw uit. Telemetrie-attribuutvariabelen van het dashboard gelden ook hiervoor, inclusief multi-select-variabelen.

Log Chart vereist voorlopig een dashboard met login. Publieke dashboards tonen de widget als niet beschikbaar in plaats van logaggregaten van het project anoniem prijs te geven.

Gebruik dit wanneer: je veranderingen in het logvolume wilt opmerken of errors, warnings en informatieve logs wilt vergelijken zonder het dashboard te verlaten.

### Log Stream

Een live tail van logregels die aan een filter voldoen.

**Instellingen**: log-filters (service, severity, attributen) en de kolommen om te tonen.

Gebruik dit wanneer: je wilt zien wat de applicatie nu zegt, zonder het dashboard te verlaten.

### Trace List

Een lijst met recente traces die aan een filter voldoen, met duur, status en service.

**Instellingen**: trace-filters (service, status, attributen).

Gebruik dit wanneer: je een lijst met recente activiteit wilt in plaats van een chart. Een veelvoorkomend patroon is een latency-chart bovenaan met een lijst van langzame traces eronder.

## Live lijsten

### Incident List

Een live lijst met incidenten die aan een filter voldoen.

**Instellingen**: filters op state, severity, labels, monitor of team.

Gebruik dit wanneer: het dashboard de vraag "wat is er nu kapot?" beantwoordt.

### Alert List

Een live lijst met alerts die aan een filter voldoen.

**Instellingen**: filters op state, severity, labels.

Gebruik dit wanneer: een teamdashboard alerts op zijn services volgt.

### Monitor List

Een live lijst met monitors en hun huidige status.

**Instellingen**: filters op monitortype, labels of huidige state.

Gebruik dit wanneer: je een wagenpark-view wilt — "zijn alle sites up?"

## Serviceniveaudoelstellingen

### SLO

Eén serviceniveaudoelstelling, getekend als één getal of als een lijn in de tijd.

**Instellingen**: welk SLO, welk van zijn drie getallen (SLI, Error Budget Remaining of Burn Rate), weergave als Tile of Chart, en een optionele titel.

- **Tile** toont het huidige getal, plus een tweede regel waar die er is — het doel onder de SLI, de resterende minuten onder het foutbudget. Een status-pill kleurt het geheel.
- **Chart** tekent hetzelfde getal over het tijdsbereik van het dashboard, met het doel als stippellijn op de SLI-reeks. De historie wordt elke paar minuten door de evaluatie-worker geschreven, dus een kakelvers SLO is leeg tot het voor het eerst is geëvalueerd.

Gebruik dit wanneer: het dashboard antwoord geeft op "halen we wat we hebben beloofd?" in plaats van "wat gebeurt er nu?"

De SLO-widget werkt op [publieke dashboards](/docs/dashboards/sharing). Wat er wordt gepubliceerd zijn de kerngetallen van het SLO — naam, doel, huidige SLI, resterend foutbudget, burn rate en status — ongeacht welke daarvan de widget toevallig tekent. De definitie blijft privé: de monitors die het in de gaten houdt, de labels, de beschrijving, de query en het evaluatieschema worden nooit naar een publieke bezoeker gestuurd. Een Tile-widget publiceert alleen die huidige getallen; een Chart-widget publiceert daarnaast de historie van de ene reeks die hij tekent, en niets anders.

## Kubernetes-resourcelijsten

Voor projecten met een [Kubernetes Agent](/docs/monitor/kubernetes-agent) geïnstalleerd. Elke neemt optionele filters voor cluster, namespace en labels.

- **Kubernetes Pod List** — pods met hun phase, restarts en node.
- **Kubernetes Node List** — nodes met hun conditions en capacity.
- **Kubernetes Namespace List** — namespaces en workload-aantallen.
- **Kubernetes Deployment List** — deployments met desired vs. ready replica's.
- **Kubernetes StatefulSet List** — stateful sets met ready replica's.
- **Kubernetes DaemonSet List** — daemon sets met desired vs. ready.
- **Kubernetes Job List** — jobs en hun voltooiingsstatus.
- **Kubernetes CronJob List** — cron jobs met schedule en laatste run.

Gebruik deze wanneer: je één dashboard wilt dat Kubernetes-state mengt met telemetry van die workloads.

## Docker-resourcelijsten

Voor projecten met Docker-monitoring opgezet.

- **Docker Host List** — hosts die Docker draaien, met container-aantallen.
- **Docker Container List** — containers met state, image, host, uptime.
- **Docker Image List** — images en hun groottes.
- **Docker Network List** — Docker-netwerken en verbonden containers.
- **Docker Volume List** — Docker-volumes en hun gebruik.

## Infrastructuur

### Host List

Hosts gemonitord door OneUptime's server-monitor, met status, CPU, geheugen en uptime.

**Instellingen**: filters op labels of huidige state.

## Netwerk

### Network Map

Je netwerksites getekend op de wereldkaart, elk vastgezet op zijn eigen breedte- en lengtegraad en gekleurd naar de monitorstatus die erop is samengevat. Sites die dicht bij elkaar liggen delen één marker met het aantal erin; een marker die voor precies één site staat, opent die site als je erop klikt.

De kaart kadert zichzelf op de sites die hij tekende — een park binnen één land vult het kader met dat land, een park verspreid over continenten opent op de wereld. Er zijn geen zoom- of pan-knoppen: een dashboardtegel is een plaatje, en de pagina Network Map onder Network is waar je de hiërarchie doorloopt.

Boven de kaart staat hoeveel sites down zijn, want een rode stip van twee pixels tussen tweehonderd groene leest niemand op dashboardafstand. Eronder zegt een dekkingsregel wat de kaart _niet_ toont — sites zonder coördinaten, en of de rijlimiet is geraakt.

**Instellingen**: titel, kaart- of lijstweergave, maximaal aantal getekende sites, of sitenamen worden weergegeven, en filters op sitetype en op status. Sitenamen verdwijnen automatisch wanneer de kaart te vol wordt om ze te kunnen lezen; de tooltip noemt nog steeds elke marker.

Een site verschijnt alleen als hij coördinaten heeft. Voeg breedte- en lengtegraad toe op de site (of importeer ze uit CSV) om hem vast te zetten.

## Welke widget moet ik gebruiken?

Een paar vuistregels:

- **Trend in de tijd?** Chart.
- **Logvolume of foutpieken in de tijd?** Log Chart.
- **Eén getal dat er nu toe doet?** Value (of Gauge als het een duidelijk min/max heeft).
- **Uitsplitsing over veel dingen?** Table.
- **Wat gebeurt er nu in het systeem?** Log Stream, Trace List, Incident List.
- **De state van een specifieke groep resources?** De bijbehorende lijst-widget.
- **Halen we de betrouwbaarheid die we hebben beloofd?** SLO.
- **Waar in de wereld je netwerk zit, en wat er rood is?** Network Map.
- **Een kop, alinea of link?** Text.
- **Iets wat geen van bovenstaande dekt?** HTML — maar pas nadat je hebt gecontroleerd dat een ingebouwde widget het echt niet kan.

De meeste dashboards mengen er een paar — een chart bovenaan, een value of twee ernaast, een tekstscheiding en een lijst of twee eronder.

## Waar verder lezen

- [Variabelen en filters](/docs/dashboards/variables) — widgets herbruikbaar maken voor veel services of klanten.
- [Een dashboard maken](/docs/dashboards/authoring) — de canvas-mechanica.
- [Delen en publieke dashboards](/docs/dashboards/sharing) — delen buiten je team.
