# Dashboard-widgets

En widget er én flise på et dashboard. Hver widget har en type (chart, value, list, …), en position, en størrelse og en konfiguration. Denne side er kataloget — hvad hver widget viser, hvad den tager som input, og hvornår du skal gribe til den.

For lærreds-mekanik, se [Opret et dashboard](/docs/dashboards/authoring).

## Tidsserie-widgets

### Chart

Et linje- / søjle- / areal-diagram af én eller flere metrik-serier over dashboardets tidsinterval.

**Konfigurér**:

- En eller flere metrik-forespørgsler (`metricQueryConfig` for en enkelt serie, `metricQueryConfigs` for flere).
- Valgfri **formula** der kombinerer flere forespørgsler (f.eks. `errors / total * 100`).
- Valgfri **transformAsRate** til OpenTelemetry-kumulative tællere (f.eks. `system.disk.io`) — widgeten beregner `(value - previousValue) / Δt` pr. bucket.
- Visning: stablede vs. overlejrede serier, Y-akse-enhed, legend on/off, diagramtype.

Grib til den, når: tendenser betyder noget. Request-latens, fejl-antal over tid, kødybde, alt hvor formen af kurven fortæller dig noget.

### Value

Et enkelt stort tal med valgfri tærskler og en valgfri sparkline.

**Konfigurér**:

- En metrik-forespørgsel (enkeltværdi — som regel `last`, `avg` eller `max` over tidsintervallet).
- Valgfri **advarselstærskel** (gul over).
- Valgfri **kritisk tærskel** (rød over).
- Visning: tal-format, enheds-suffiks.

Grib til den, når: et enkelt tal besvarer spørgsmålet. Nuværende fejlrate, P95-latens lige nu, antal åbne hændelser.

### Gauge

En cirkulær måler med min, max, advarselsbånd og kritisk bånd.

**Konfigurér**: metrik-forespørgslen og de fire grænser (min, max, advarsel, kritisk).

Grib til den, når: værdien sidder inde i et kendt interval. CPU-udnyttelse (0–100%), diskfyldning, kø-kapacitet.

### Table

En tabelvisning af resultater fra en metrik-forespørgsel, én række pr. gruppe.

**Konfigurér**: metrik-forespørgslen (typisk grupperet på en label som `host.name` eller `service.name`), de kolonner, der skal vises, og en række-grænse.

Grib til den, når: du vil have opdelingen frem for tendensen. Top 10 mest støjende hosts, fejl-antal pr. service, request-rate pr. endpoint.

## Annoterings-widget

### Text

En statisk blok af Markdown.

**Konfigurér**: Markdown-bodyen. Overskrifter, lister, links, fremhævning, code spans og fenced code blocks rendres alle.

Grib til den, når: du vil have en sektions-overskrift, et afsnit kontekst ("dette dashboard dækker checkout-servicen"), en liste af links til runbooks eller relaterede dashboards, eller et midlertidigt banner under en hændelse.

## Logs & traces

### LogStream

En live hale af loglinjer, der matcher et filter.

**Konfigurér**: log-filtre (service, severity, attribut-match), de kolonner, der skal vises.

Grib til den, når: du vil se, hvad applikationen siger *lige nu* på et dashboard, uden at forlade siden for at åbne logs-explorerne.

### TraceList

En liste over seneste traces, der matcher et filter, med varighed, status og servicenavn.

**Konfigurér**: trace-filtre (service, status, attribut-match).

Grib til den, når: du vil have en pagineret visning af nylig aktivitet i stedet for et diagram. Almindeligt par: et latens-Chart i toppen, en TraceList af langsomme traces nedenunder.

## Driftslister

### IncidentList

En live liste over hændelser, der matcher et filter.

**Konfigurér**: filtre på tilstand, severity, labels, monitor eller tildelt team.

Grib til den, når: et dashboard skal besvare "hvad er gået i stykker lige nu?"

### AlertList

En live liste over alarmer, der matcher et filter.

**Konfigurér**: filtre på tilstand, severity, labels.

Grib til den, når: dashboards til alarm-drevne workflows (f.eks. dev-team-dashboards, der overvåger deres services alarmer).

### MonitorList

En live liste over monitorer, der matcher et filter, og som viser hver monitors nuværende status.

**Konfigurér**: filtre på monitortype, labels eller nuværende tilstand.

Grib til den, når: du vil have en flåde-niveau "er alle websteder oppe?"-visning eller en per-team-liste over monitorerede endpoints.

## Kubernetes ressourcelister

For projekter med en [Kubernetes Agent](/docs/monitor/kubernetes-agent) installeret er følgende live-ressource-widgets tilgængelige. Hver enkelt tager valgfrie filtre på `cluster`, `namespace` og labels.

- **KubernetesPodList** — pods med fase, restarts og node-tildeling.
- **KubernetesNodeList** — nodes med conditions, kapacitet og allokeringer.
- **KubernetesNamespaceList** — namespaces og deres workload-antal.
- **KubernetesDeploymentList** — deployments med ønsket vs. ready replicas.
- **KubernetesStatefulSetList** — stateful sets med ready replicas.
- **KubernetesDaemonSetList** — daemon sets med ønsket vs. ready.
- **KubernetesJobList** — jobs med completion-status.
- **KubernetesCronJobList** — cron jobs med tidsplan og seneste kørsel.

Grib til disse, når: du vil have ét dashboard, der blander Kubernetes-ressourcetilstand med telemetri fra de workloads.

## Docker ressourcelister

For projekter med en Docker-monitor installeret:

- **DockerHostList** — hosts, der kører Docker, med container-antal.
- **DockerContainerList** — containers med tilstand, image, host, uptime.
- **DockerImageList** — images og deres størrelser.
- **DockerNetworkList** — Docker-netværk og antal forbundne containers.
- **DockerVolumeList** — Docker-volumener og deres forbrug.

## Infrastruktur

### HostList

Hosts overvåget af OneUptimes server-monitor — med nuværende status, CPU, hukommelse og uptime.

**Konfigurér**: filtre på labels eller nuværende sundhedstilstand.

## Vælg den rigtige widget

Et par tommelfingerregler:

- **Tendens over tid?** Chart.
- **Et tal, der betyder noget lige nu?** Value (eller Gauge, hvis det har et naturligt interval).
- **Opdeling på tværs af mange ting?** Table.
- **Hvad sker der i systemet lige nu?** LogStream, TraceList, IncidentList.
- **Tilstand for en specifik ressourceflåde?** Den matchende ressourceliste-widget.
- **En overskrift, et afsnit eller et link?** Text.

De fleste dashboards bruger en blanding — et Chart i toppen, en Value eller to ved siden af, en Text-divider og så en eller to lister nedenunder.

## Læs videre

- [Dashboard-variabler & filtre](/docs/dashboards/variables) — at gøre widgets genbrugelige på tværs af services / kunder / klynger.
- [Opret et dashboard](/docs/dashboards/authoring) — lærredet, gitteret og edit-tilstanden.
- [Deling & offentlige dashboards](/docs/dashboards/sharing) — at eksponere et dashboard uden for teamet.
