# Widgetar

En widget är en ruta på en instrumentpanel. Varje widget har en typ (diagram, värde, lista, …), en position, en storlek och en konfiguration. Den här sidan är katalogen — vad varje widget visar, vad den tar som indata, när du ska gripa efter den.

För arbetsytans mekanik, se [Skapa en instrumentpanel](/docs/dashboards/authoring).

## Tidsserie-widgetar

### Chart

Ett linje- / stapel- / area-diagram över en eller flera metric-serier under instrumentpanelens tidsintervall.

**Konfigurera**:

- En eller flera metric-frågor (`metricQueryConfig` för en enskild serie, `metricQueryConfigs` för flera).
- Valfri **formula** som kombinerar flera frågor (t.ex. `errors / total * 100`).
- Valfri **transformAsRate** för kumulativa OpenTelemetry-räknare (t.ex. `system.disk.io`) — widgeten beräknar `(value - previousValue) / Δt` per bucket.
- Visning: staplade vs. överlagrade serier, Y-axelns enhet, legend på/av, diagramtyp.

Grip efter den när: trender spelar roll. Request-latens, felantal över tid, ködjup, allt där kurvans form berättar något för dig.

### Value

Ett enskilt stort nummer med valfria trösklar och en valfri sparkline.

**Konfigurera**:

- En metric-fråga (enskilt värde — vanligtvis `last`, `avg` eller `max` över tidsintervallet).
- Valfri **varningströskel** (gul ovanför).
- Valfri **kritisk tröskel** (röd ovanför).
- Visning: nummerformat, enhetssuffix.

Grip efter den när: ett enskilt nummer svarar på frågan. Aktuell felfrekvens, P95-latens just nu, antal öppna incidenter.

### Gauge

En cirkulär mätare med ett min, max, varningsband och kritiskt band.

**Konfigurera**: metric-frågan och de fyra gränserna (min, max, varning, kritisk).

Grip efter den när: värdet ligger inom ett känt intervall. CPU-utnyttjande (0–100%), diskfyllnad, kökapacitet.

### Table

En tabellvisning av metric-frågeresultat, en rad per grupp.

**Konfigurera**: metric-frågan (vanligtvis grupperad efter en etikett som `host.name` eller `service.name`), kolumnerna att visa och en radgräns.

Grip efter den när: du vill ha uppdelningen snarare än trenden. Topp 10 mest brusiga värdar, felantal per tjänst, request-takt per endpoint.

## Annotations-widget

### Text

Ett statiskt block med Markdown.

**Konfigurera**: Markdown-kroppen. Rubriker, listor, länkar, betoning, kodspans och staket-kodblock renderas alla.

Grip efter den när: du vill ha en sektionsrubrik, ett kontextstycke ("denna instrumentpanel täcker checkout-tjänsten"), en lista med länkar till runbooks eller relaterade instrumentpaneler, eller en tillfällig banner under en incident.

## Loggar & traces

### LogStream

En live-svans av loggrader som matchar ett filter.

**Konfigurera**: loggfilter (tjänst, allvarlighetsgrad, attributmatchningar), kolumnerna att visa.

Grip efter den när: du vill se vad applikationen säger *just nu* på en instrumentpanel, utan att lämna sidan för att öppna loggutforskaren.

### TraceList

En lista över nyligen utförda traces som matchar ett filter, med varaktighet, status och tjänstnamn.

**Konfigurera**: trace-filter (tjänst, status, attributmatchningar).

Grip efter den när: du vill ha en paginerad vy över nyligen utförd aktivitet snarare än ett diagram. Vanlig parning: ett latensdiagram (Chart) på toppen, en TraceList med långsamma traces nedanför.

## Driftslistor

### IncidentList

En live-lista över incidenter som matchar ett filter.

**Konfigurera**: filter efter tillstånd, allvarlighetsgrad, etiketter, monitor eller tilldelat team.

Grip efter den när: en instrumentpanel är menad att svara på "vad är trasigt just nu?"

### AlertList

En live-lista över larm som matchar ett filter.

**Konfigurera**: filter efter tillstånd, allvarlighetsgrad, etiketter.

Grip efter den när: instrumentpaneler för larmdrivna arbetsflöden (t.ex. utvecklingsteamsinstrumentpaneler som vakar över sin tjänsts larm).

### MonitorList

En live-lista över monitorer som matchar ett filter, som visar varje monitors aktuella status.

**Konfigurera**: filter efter monitortyp, etiketter eller aktuellt tillstånd.

Grip efter den när: du vill ha en flottnivå "är alla webbplatser uppe?"-vy, eller en per-team-lista över övervakade endpoints.

## Kubernetes-resurslistor

För projekt med en [Kubernetes Agent](/docs/monitor/kubernetes-agent) installerad är följande live-resurs-widgetar tillgängliga. Var och en tar valfria filter för `cluster`, `namespace` och etiketter.

- **KubernetesPodList** — poddar med fas, omstarter och nodtilldelning.
- **KubernetesNodeList** — noder med villkor, kapacitet och tilldelningar.
- **KubernetesNamespaceList** — namespaces och deras workload-antal.
- **KubernetesDeploymentList** — deployments med önskade vs. klara repliker.
- **KubernetesStatefulSetList** — stateful sets med klara repliker.
- **KubernetesDaemonSetList** — daemon sets med önskade vs. klara.
- **KubernetesJobList** — jobs med slutförandestatus.
- **KubernetesCronJobList** — cron jobs med schema och senaste körning.

Grip efter dessa när: du vill ha en enskild instrumentpanel som blandar Kubernetes-resurstillstånd med telemetri från dessa workloads.

## Docker-resurslistor

För projekt med en Docker-monitor installerad:

- **DockerHostList** — värdar som kör Docker, med container-antal.
- **DockerContainerList** — containers med tillstånd, image, värd, upptid.
- **DockerImageList** — images och deras storlekar.
- **DockerNetworkList** — Docker-nätverk och antal anslutna containers.
- **DockerVolumeList** — Docker-volymer och deras användning.

## Infrastruktur

### HostList

Värdar övervakade av OneUptimes server-monitor — med aktuell status, CPU, minne och upptid.

**Konfigurera**: filter efter etiketter eller aktuellt hälsotillstånd.

## Välja rätt widget

Några snabba tumregler:

- **Trend över tid?** Chart.
- **Ett nummer som spelar roll just nu?** Value (eller Gauge om det har ett naturligt intervall).
- **Uppdelning över många saker?** Table.
- **Vad händer i systemet just nu?** LogStream, TraceList, IncidentList.
- **Tillståndet för en specifik resursflotta?** Den matchande resurslistwidgeten.
- **En rubrik, ett stycke eller en länk?** Text.

De flesta instrumentpaneler använder en mix — ett Chart på toppen, ett Value eller två bredvid det, en Text-avdelare, sedan en eller två listor nedanför.

## Var läsa vidare

- [Variabler & filter](/docs/dashboards/variables) — gör widgetar återanvändbara över tjänster / kunder / kluster.
- [Skapa en instrumentpanel](/docs/dashboards/authoring) — arbetsytan, rutnätet och edit-läget.
- [Delning & offentliga instrumentpaneler](/docs/dashboards/sharing) — exponera en instrumentpanel utanför teamet.
