# Dashboards – Overzicht

Dashboards zijn de manier waarop je de telemetry die OneUptime al verzamelt — metrics, logs, traces, incidenten, monitors, Kubernetes- en Docker-resources — omzet in één enkele pagina waar iemand in één oogopslag de gezondheid van een systeem kan zien.

Zet een chart voor request-latency naast een lijst met openstaande incidenten naast een gauge voor CPU-gebruik naast een statuszin in eenvoudig Nederlands. Sla het op. Deel de link.

## In één oogopslag

- **Top-level feature** in het OneUptime-dashboard onder **Dashboards**.
- **Grid-gebaseerd canvas** — standaard 12 eenheden breed en 60 eenheden hoog. Sleep widgets erin, vergroot of verklein ze, snap ze aan het grid.
- **Meer dan 20 widget-types** — charts, enkele waarden, gauges, tabellen, tekstblokken, log-streams, trace-lijsten en live resource-lijsten voor incidenten, alerts, monitors, Kubernetes (pods, nodes, deployments, …), Docker en hosts.
- **Variabelen en filters** — verander één dashboard in een template-weergave die je hergebruikt voor elke cluster, service, klant of omgeving.
- **Publiek delen** — zet een schakelaar om en het dashboard is bereikbaar via een openbare URL, met optionele wachtwoordbeveiliging en IP-allowlisting.
- **Custom domains** — host een openbaar dashboard op `status.your-domain.com` in plaats van op OneUptime's domein.

## Waarom dashboards gebruiken?

Dashboards verdienen hun plek wanneer één van deze waar is:

- **Je hebt een "is alles oké?"-pagina nodig** voor een oproepdienstrotatie, een team-standup of een CEO die langs de muur-TV loopt.
- **Je moet signalen correleren** — een CPU-piek op exact dezelfde minuut als een toename in trace-latency en een geopend incident is veel duidelijker op één dashboard dan verspreid over drie tabbladen.
- **Je bent aan het onderzoeken** — een freeform dashboard dat je tijdens een debugsessie opbouwt is sneller dan tien queries met de hand draaien.
- **Je publiceert extern** — een klantgericht performance-dashboard, een partner-gericht overzicht, een openbaar gezondheidsbord voor een opensource-service.

## Kernbegrippen

| Term | Betekenis |
| --- | --- |
| **Dashboard** | Het canvas. Een benoemde, herbruikbare weergave die een lijst widgets, een tijdsbereik-control en een set variabelen bevat. |
| **Widget** | Eén component op het canvas — een chart, een waarde, een tabel, een tekstblok, een lijst. Elk heeft een type en een JSON-stijl-configuratie. |
| **Dashboard-eenheid** | Het gridvak. Widgets worden in dashboard-eenheden gemeten (bijvoorbeeld "4 breed × 6 hoog"). Eenheden worden geconverteerd naar pixels op basis van de viewport. |
| **Variabele** | Een benoemde waarde die de kijker uit een dropdown kiest (of typt) en die het dashboard in de query van elke widget injecteert. Cluster, service, klant, omgeving — wat je maar wilt filteren. |
| **Tijdsbereik** | Het venster waartegen elke widget querydraait. Kies een preset ("afgelopen 24 uur") of een aangepast bereik. |
| **Refresh-interval** | Hoe vaak widgets opnieuw queryen in **View**-modus. Uit, 5s, 10s, 30s, 1m, 5m, 15m. |
| **Modus** | `Edit` (slepen, vergroten/verkleinen, configureren) of `View` (alleen lezen). De twee delen hetzelfde canvas. |

## De widget-catalogus

Een niet-uitputtende kaart van wat je op een dashboard kunt zetten:

| Categorie | Widgets |
| --- | --- |
| **Tijdreeksen** | Chart |
| **Enkel getal** | Value, Gauge |
| **Tabellarisch** | Table |
| **Annotatie** | Text |
| **Logs en traces** | LogStream, TraceList |
| **Operationele lijsten** | IncidentList, AlertList, MonitorList |
| **Kubernetes** | KubernetesPodList, KubernetesNodeList, KubernetesNamespaceList, KubernetesDeploymentList, KubernetesStatefulSetList, KubernetesDaemonSetList, KubernetesJobList, KubernetesCronJobList |
| **Docker** | DockerHostList, DockerContainerList, DockerImageList, DockerNetworkList, DockerVolumeList |
| **Infrastructuur** | HostList |

Voor de argumenten van elke en wanneer je ernaar grijpt, zie [Widgets](/docs/dashboards/widgets).

## Waar dashboards leven in het dashboard

| Pagina | Wat je daar doet |
| --- | --- |
| **Dashboards** | Dashboards doorbladeren, aanmaken, zoeken, labelen. |
| **Een dashboard → View** | Het canvas — Edit-modus voor auteurs, View-modus voor iedereen anders. Wissel tussen beide in de header. |
| **Een dashboard → Overview** | Beschrijving, eigenaarschap, labels. |
| **Een dashboard → Settings** | Publiek delen, master-wachtwoord, IP-allowlist, custom domains, branding (paginatitel, beschrijving, logo, favicon). |
| **Een dashboard → Owners** | Gebruikers en teams met expliciet eigenaarschap. |
| **Een dashboard → Delete** | Verwijder het dashboard (onomkeerbaar). |

## De levenscyclus van een dashboard

1. **Aanmaken** — Onder **Dashboards → Create Dashboard** geef je het een naam. Het canvas opent leeg.
2. **Widgets plaatsen** — Kies in het widget-palet een type, configureer de bron (een metric-query, een lijstfilter, een vrije tekst-body). Positioneer en pas de grootte aan.
3. **(Optioneel) Variabelen toevoegen** — Definieer een dropdown zoals `cluster` of `service`, zodat hetzelfde dashboard voor elke waarde rendert.
4. **Stel het tijdsbereik en de refresh-interval in** — De standaarden werken prima; afstellen kan later.
5. **(Optioneel) Publiek delen** — Onder **Settings** zet je **Public Dashboard** aan. Voeg een master-wachtwoord toe als je een gate wilt, of beperk op IP.
6. **(Optioneel) Custom domain** — Voeg een `dashboard.your-domain.com`-record toe en verifieer de DNS, dan serveer je het dashboard op je eigen URL.

## Een uitgewerkt voorbeeld

Doel: een oncall-pagina voor de checkout-service met latency, foutpercentage, openstaande incidenten en een recente log-tail.

1. Maak een dashboard "Checkout oncall" aan.
2. Voeg een `service`-variabele toe van het type **Telemetry Attribute**, gekoppeld aan attribuutsleutel `service.name`. Standaardwaarde `checkout`.
3. Voeg een **Chart**-widget toe: P95-latency uit je APM-metric, gefilterd op `service.name = {{service}}`. Tijdsbereik volgt het dashboard.
4. Daarnaast een **Value**-widget: foutpercentage met een waarschuwingsdrempel op 1% en een kritieke drempel op 5%.
5. Daaronder een **IncidentList**-widget, gefilterd op labels die `checkout` bevatten.
6. Daaronder een **LogStream**-widget, gefilterd op `service.name = {{service}}`.
7. Opslaan. Verander de variabele-dropdown naar `payments` — het hele dashboard rerendert voor de payments-service. Zelfde template, ander filter.

## Hoe dashboards samenwerken met de rest van OneUptime

- **Monitors en telemetry** voeden dashboards met ruwe data — elke metric die je hebt geconfigureerd, elke logregel die je hebt geïngest, elke trace-span is queryable op een widget.
- **Incidenten en alerts** verschijnen in **IncidentList**- en **AlertList**-widgets — dashboards zijn alleen-lezen views erop; entiteiten aanmaken/bewerken doe je elders.
- **Statuspagina's** zijn een klantgericht communicatiemiddel ("is het systeem nu up?"). Dashboards zijn een analytisch middel ("hoe gedraagt het systeem zich in detail?"). De twee zijn complementair, geen vervangers.
- **Workflows** zijn de schrijfkant van OneUptime — dashboards zijn de leeskant.

## Waar verder lezen

- [Een dashboard maken](/docs/dashboards/authoring) — het canvas gebruiken, het grid, edit-vs-view-modus.
- [Widgets](/docs/dashboards/widgets) — de catalogus en configuratie per widget.
- [Variabelen en filters](/docs/dashboards/variables) — een dashboard templaten zodat het voor veel services / klanten / clusters werkt.
- [Delen en publieke dashboards](/docs/dashboards/sharing) — openbare URL's, master-wachtwoord, IP-allowlist, custom domains.
- [Configuratie en machtigingen](/docs/dashboards/configuration) — eigenaarschap, labels, retentie, rolgebaseerde toegang.
