# Dashboard-widgets

Een widget is één tegel op een dashboard. Elke widget heeft een type (chart, value, list, …), een positie, een grootte en een configuratie. Deze pagina is de catalogus — wat elke widget toont, wat hij als input neemt, wanneer je ernaar grijpt.

Voor canvas-mechanica, zie [Een dashboard maken](/docs/dashboards/authoring).

## Tijdreeks-widgets

### Chart

Een lijn-/staaf-/vlakdiagram van één of meer metric-reeksen over het tijdsbereik van het dashboard.

**Configureer**:

- Eén of meer metric-queries (`metricQueryConfig` voor één reeks, `metricQueryConfigs` voor meerdere).
- Optionele **formule** die meerdere queries combineert (bijvoorbeeld `errors / total * 100`).
- Optionele **transformAsRate** voor cumulatieve OpenTelemetry-counters (bijvoorbeeld `system.disk.io`) — de widget berekent `(value - previousValue) / Δt` per bucket.
- Weergave: reeksen gestapeld vs. overlappend, eenheid Y-as, legenda aan/uit, type chart.

Grijp ernaar wanneer: trends ertoe doen. Request-latency, foutaantal over tijd, wachtrijdiepte, alles waar de vorm van de curve je iets vertelt.

### Value

Eén groot getal met optionele drempels en een optionele sparkline.

**Configureer**:

- Een metric-query (enkele waarde — meestal `last`, `avg` of `max` over het tijdsbereik).
- Optionele **waarschuwingsdrempel** (geel boven).
- Optionele **kritieke drempel** (rood boven).
- Weergave: getalformaat, eenheidsuffix.

Grijp ernaar wanneer: één enkel getal de vraag beantwoordt. Huidig foutpercentage, P95-latency op dit moment, aantal open incidenten.

### Gauge

Een ronde meter met een min, max, waarschuwingsband en kritieke band.

**Configureer**: de metric-query en de vier grenzen (min, max, waarschuwing, kritiek).

Grijp ernaar wanneer: de waarde binnen een bekend bereik valt. CPU-gebruik (0–100%), schijfvulling, wachtrijcapaciteit.

### Table

Een tabellarische weergave van de resultaten van een metric-query, één rij per groep.

**Configureer**: de metric-query (meestal gegroepeerd op een label zoals `host.name` of `service.name`), de te tonen kolommen en een rijlimiet.

Grijp ernaar wanneer: je liever de uitsplitsing dan de trend wilt. Top 10 luidruchtigste hosts, foutaantal per service, request-rate per endpoint.

## Annotatie-widget

### Text

Een statisch blok Markdown.

**Configureer**: de Markdown-body. Koppen, lijsten, links, nadruk, inline-code, fenced code blocks renderen allemaal.

Grijp ernaar wanneer: je een sectie-koptekst wilt, een paragraaf context ("dit dashboard dekt de checkout-service"), een lijst met links naar runbooks of gerelateerde dashboards, of een tijdelijke banner tijdens een incident.

## Logs en traces

### LogStream

Een live tail van logregels die matchen met een filter.

**Configureer**: log-filters (service, ernst, attribuutmatches), de te tonen kolommen.

Grijp ernaar wanneer: je *op dit moment* wilt zien wat de applicatie zegt op een dashboard, zonder de pagina te verlaten om de logs-explorer te openen.

### TraceList

Een lijst van recente traces die matchen met een filter, met duur, status en de servicenaam.

**Configureer**: trace-filters (service, status, attribuutmatches).

Grijp ernaar wanneer: je liever een gepagineerde weergave van recente activiteit ziet dan een chart. Veelvoorkomende combinatie: een latency-Chart bovenaan, een TraceList van trage traces eronder.

## Operationele lijsten

### IncidentList

Een live lijst van incidenten die matchen met een filter.

**Configureer**: filters op status, ernst, labels, monitor of toegewezen team.

Grijp ernaar wanneer: een dashboard bedoeld is om de vraag "wat is er nu kapot?" te beantwoorden.

### AlertList

Een live lijst van alerts die matchen met een filter.

**Configureer**: filters op status, ernst, labels.

Grijp ernaar wanneer: dashboards voor alert-gedreven workflows (bijvoorbeeld dashboards van dev-teams die de alerts van hun service in de gaten houden).

### MonitorList

Een live lijst van monitors die matchen met een filter, met de huidige status van elke monitor.

**Configureer**: filters op monitortype, labels of huidige status.

Grijp ernaar wanneer: je een fleet-level "zijn alle websites up?"-view wilt, of een per-team-lijst van gemonitorde endpoints.

## Kubernetes-resource-lijsten

Voor projecten met een [Kubernetes-agent](/docs/monitor/kubernetes-agent) geïnstalleerd, zijn de volgende live-resource-widgets beschikbaar. Elk neemt optionele filters voor `cluster`, `namespace` en labels.

- **KubernetesPodList** — pods met fase, restarts en nodetoewijzing.
- **KubernetesNodeList** — nodes met condities, capaciteit en allocaties.
- **KubernetesNamespaceList** — namespaces en hun workload-tellingen.
- **KubernetesDeploymentList** — deployments met gewenste vs. ready replicas.
- **KubernetesStatefulSetList** — stateful sets met ready replicas.
- **KubernetesDaemonSetList** — daemon sets met gewenst vs. ready.
- **KubernetesJobList** — jobs met voltooiingsstatus.
- **KubernetesCronJobList** — cron jobs met schema en laatste run.

Grijp ernaar wanneer: je één dashboard wilt dat Kubernetes-resource-state combineert met telemetry van die workloads.

## Docker-resource-lijsten

Voor projecten met een Docker-monitor geïnstalleerd:

- **DockerHostList** — hosts die Docker draaien, met aantal containers.
- **DockerContainerList** — containers met status, image, host, uptime.
- **DockerImageList** — images en hun groottes.
- **DockerNetworkList** — Docker-netwerken en aantal verbonden containers.
- **DockerVolumeList** — Docker-volumes en hun gebruik.

## Infrastructuur

### HostList

Hosts die door de servermonitor van OneUptime worden gemonitord — met huidige status, CPU, geheugen en uptime.

**Configureer**: filters op labels of huidige gezondheidsstatus.

## De juiste widget kiezen

Een paar vuistregels:

- **Trend over tijd?** Chart.
- **Eén getal dat er nu toe doet?** Value (of Gauge als het een natuurlijk bereik heeft).
- **Uitsplitsing over veel dingen?** Table.
- **Wat gebeurt er op dit moment in het systeem?** LogStream, TraceList, IncidentList.
- **Status van een specifieke vloot resources?** De bijbehorende resource-lijst-widget.
- **Een koptekst, paragraaf of link?** Text.

De meeste dashboards gebruiken een mix — een Chart bovenaan, een Value of twee ernaast, een Text-scheidingsbalk en daaronder één of twee lijsten.

## Waar verder lezen

- [Variabelen en filters](/docs/dashboards/variables) — widgets herbruikbaar maken over services / klanten / clusters heen.
- [Een dashboard maken](/docs/dashboards/authoring) — het canvas, grid en de edit-modus.
- [Delen en publieke dashboards](/docs/dashboards/sharing) — een dashboard delen buiten het team.
