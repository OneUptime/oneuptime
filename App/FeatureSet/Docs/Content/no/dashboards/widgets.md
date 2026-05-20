# Widgets

En widget er én flis på et dashbord. Hver widget har en type (diagram, verdi, liste, …), en posisjon, en størrelse og en konfigurasjon. Denne siden er katalogen — hva hver widget viser, hva den tar som input, når du skal gripe til den.

For lerretsmekanikk, se [Opprette et dashbord](/docs/dashboards/authoring).

## Tidsserie-widgets

### Chart

Et linje- / søyle- / arealdiagram av én eller flere metrikkserier over dashbordets tidsperiode.

**Konfigurer**:

- En eller flere metrikkspørringer (`metricQueryConfig` for én serie, `metricQueryConfigs` for flere).
- Valgfri **formula** som kombinerer flere spørringer (f.eks. `errors / total * 100`).
- Valgfri **transformAsRate** for OpenTelemetry kumulative tellere (f.eks. `system.disk.io`) — widgeten beregner `(value - previousValue) / Δt` per intervall.
- Visning: stablede vs. overlappede serier, Y-akse-enhet, forklaring på/av, diagramtype.

Grip til den når: trender betyr noe. Forespørselslatens, feilantall over tid, kødybde — alt der formen på kurven forteller deg noe.

### Value

Et enkelt stort tall med valgfrie terskler og en valgfri sparkline.

**Konfigurer**:

- En metrikkspørring (enkeltverdi — vanligvis `last`, `avg` eller `max` over tidsperioden).
- Valgfri **advarselsterskel** (gul over).
- Valgfri **kritisk terskel** (rød over).
- Visning: tallformat, enhetssuffiks.

Grip til den når: et enkelt tall svarer på spørsmålet. Nåværende feilrate, P95-latens akkurat nå, antall åpne hendelser.

### Gauge

En sirkulær måler med en min, maks, advarselsbånd og kritisk bånd.

**Konfigurer**: metrikkspørringen og de fire grensene (min, maks, advarsel, kritisk).

Grip til den når: verdien ligger innenfor et kjent intervall. CPU-bruk (0–100 %), diskfyll, kø-kapasitet.

### Table

En tabellbasert visning av metrikkspørringsresultater, én rad per gruppe.

**Konfigurer**: metrikkspørringen (typisk gruppert etter en etikett som `host.name` eller `service.name`), kolonnene som skal vises, og en radgrense.

Grip til den når: du vil ha oppdelingen i stedet for trenden. Topp 10 mest støyende hoster, feilantall per tjeneste, forespørselsrate per endepunkt.

## Annoteringswidget

### Text

En statisk blokk med Markdown.

**Konfigurer**: Markdown-bodyen. Overskrifter, lister, lenker, emfase, kode-spans og innelukket kode-blokker rendres alle.

Grip til den når: du vil ha en seksjonsoverskrift, et avsnitt med kontekst ("dette dashbordet dekker checkout-tjenesten"), en liste over lenker til runbooks eller relaterte dashbord, eller et midlertidig banner under en hendelse.

## Logger & sporinger

### LogStream

En live tail av loggelinjer som matcher et filter.

**Konfigurer**: loggfiltre (tjeneste, alvorlighetsgrad, attributt-treff), kolonnene som skal vises.

Grip til den når: du vil se hva applikasjonen sier *akkurat nå* på et dashbord, uten å forlate siden for å åpne logg-utforskeren.

### TraceList

En liste over nylige sporinger som matcher et filter, med varighet, status og tjenestenavn.

**Konfigurer**: sporingsfiltre (tjeneste, status, attributt-treff).

Grip til den når: du vil ha en paginert visning av nylig aktivitet i stedet for et diagram. Vanlig sammenslutning: et latens-Chart øverst, en TraceList over trege sporinger nedenfor.

## Operasjonelle lister

### IncidentList

En live liste over hendelser som matcher et filter.

**Konfigurer**: filtre etter tilstand, alvorlighetsgrad, etiketter, monitor eller tildelt team.

Grip til den når: et dashbord skal svare på "hva er ødelagt akkurat nå?"

### AlertList

En live liste over varsler som matcher et filter.

**Konfigurer**: filtre etter tilstand, alvorlighetsgrad, etiketter.

Grip til den når: dashbord for varsel-drevne arbeidsflyter (f.eks. dev-team-dashbord som overvåker tjenestens varsler).

### MonitorList

En live liste over monitorer som matcher et filter, som viser hver monitors nåværende status.

**Konfigurer**: filtre etter monitortype, etiketter eller nåværende tilstand.

Grip til den når: du vil ha en flåtenivå "er alle nettsidene oppe?"-visning, eller en per-team-liste over overvåkede endepunkter.

## Kubernetes-ressurslister

For prosjekter med en [Kubernetes-agent](/docs/monitor/kubernetes-agent) installert er følgende live-ressurs-widgets tilgjengelige. Hver tar valgfrie filtre for `cluster`, `namespace` og etiketter.

- **KubernetesPodList** — pods med fase, omstart og nodetildeling.
- **KubernetesNodeList** — noder med tilstander, kapasitet og tildelinger.
- **KubernetesNamespaceList** — navnerom og deres workload-tellinger.
- **KubernetesDeploymentList** — deployments med ønskede vs. klare replikaer.
- **KubernetesStatefulSetList** — stateful sets med klare replikaer.
- **KubernetesDaemonSetList** — daemon sets med ønskede vs. klare.
- **KubernetesJobList** — jobber med fullføringsstatus.
- **KubernetesCronJobList** — cron-jobber med tidsplan og siste kjøring.

Grip til disse når: du vil ha et enkelt dashbord som blander Kubernetes-ressurstilstand med telemetri fra disse workloadene.

## Docker-ressurslister

For prosjekter med en Docker-monitor installert:

- **DockerHostList** — hoster som kjører Docker, med container-tellinger.
- **DockerContainerList** — containere med tilstand, image, host, oppetid.
- **DockerImageList** — images og størrelsene deres.
- **DockerNetworkList** — Docker-nettverk og tilkoblede container-tellinger.
- **DockerVolumeList** — Docker-volumer og deres bruk.

## Infrastruktur

### HostList

Hoster overvåket av OneUptimes server-monitor — med nåværende status, CPU, minne og oppetid.

**Konfigurer**: filtre etter etiketter eller nåværende helsetilstand.

## Velge riktig widget

Noen raske tommelfingerregler:

- **Trend over tid?** Chart.
- **Ett tall som betyr noe akkurat nå?** Value (eller Gauge hvis det har et naturlig intervall).
- **Oppdeling på tvers av mange ting?** Table.
- **Hva skjer i systemet akkurat nå?** LogStream, TraceList, IncidentList.
- **Tilstand til en spesifikk ressursflåte?** Den matchende ressurslistewidgeten.
- **En overskrift, et avsnitt eller en lenke?** Text.

De fleste dashbord bruker en blanding — et Chart øverst, en Value eller to ved siden, en Text-skilletegn, og så én eller to lister nedenfor.

## Les videre

- [Variabler & filtre](/docs/dashboards/variables) — gjøre widgets gjenbrukbare på tvers av tjenester / kunder / klynger.
- [Opprette et dashbord](/docs/dashboards/authoring) — lerretet, rutenettet og redigeringsmodusen.
- [Deling & offentlige dashbord](/docs/dashboards/sharing) — eksponere et dashbord utenfor teamet.
