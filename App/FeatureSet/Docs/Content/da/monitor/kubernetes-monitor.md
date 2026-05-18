# Kubernetes-monitor

Kubernetes-overvågning giver dig mulighed for at overvåge sundheden og ydeevnen af dine Kubernetes-klynger, herunder noder, pods, arbejdsbelastninger og control plane-komponenter. OneUptime indsamler metrikker fra din klynge og evaluerer dem mod dine konfigurerede kriterier.

## Oversigt

Kubernetes-monitorer bruger metrikker fra din klynge til at give dyb indsigt i din infrastruktur. Dette gør det muligt at:

- Overvåge sundhed for klynge, namespace, arbejdsbelastning, node og pod
- Spore CPU-, hukommelses-, disk- og netværksforbrug på tværs af ressourcer
- Detektere pod-nedbrud, genstarter og planlægningsfejl
- Overvåge Deployment-replika-tilgængelighed
- Alarmere ved control plane-problemer (etcd, API-server, scheduler)
- Spore ressource-requests og -limits

## Oprettelse af en Kubernetes-monitor

1. Gå til **Monitors** i OneUptime Dashboard
2. Klik på **Create Monitor**
3. Vælg **Kubernetes** som monitor-type
4. Vælg klyngen og ressource-scope, der skal overvåges
5. Konfigurér ressourcefiltre og metrik-forespørgsler
6. Konfigurér overvågningskriterier efter behov

## Konfigurationsmuligheder

### Klynge

Vælg den Kubernetes-klynge, der skal overvåges. Klynger skal være integreret med OneUptime via OpenTelemetry.

### Ressource-scope

Vælg niveauet, hvorpå ressourcer skal overvåges:

| Scope | Beskrivelse |
|-------|-------------|
| Cluster | Overvåg hele klyngen |
| Namespace | Overvåg ressourcer inden for et specifikt namespace |
| Workload | Overvåg en specifik Deployment, StatefulSet, DaemonSet, job eller cronjob |
| Node | Overvåg en specifik klynge-node |
| Pod | Overvåg en specifik pod |

### Ressourcefiltre

Indsnævr scope med valgfrie filtre:

| Filter | Beskrivelse | Gældende scopes |
|--------|-------------|-------------------|
| Namespace | Kubernetes-namespace | Namespace, Workload, Pod |
| Workload Type | deployment, statefulset, daemonset, job, cronjob | Workload |
| Workload Name | Navn på arbejdsbelastningen | Workload |
| Node Name | Navn på noden | Node |
| Pod Name | Navn på pod'en | Pod |

### Metrik-forespørgsler

Konfigurér en eller flere metrik-forespørgsler, der skal evalueres. Hver forespørgsel specificerer:

- **Metric name** — Den Kubernetes-metrik, der skal forespørges
- **Aggregation** — Hvordan metrik-værdier skal aggregeres
- **Filters** — Yderligere attribut-baseret filtrering

Du kan også oprette **formler**, der kombinerer flere metrik-forespørgsler ved hjælp af matematiske udtryk.

### Rullende tidsvindue

Vælg tidsvinduet for metrik-evaluering:

- Seneste 1 minut
- Seneste 5 minutter
- Seneste 10 minutter
- Seneste 15 minutter
- Seneste 30 minutter
- Seneste 60 minutter

## Almindelige Kubernetes-metrikker

### Pod-metrikker

| Metrik | Beskrivelse |
|--------|-------------|
| Pod CPU Usage | CPU-forbrug pr. pod |
| Pod Memory Usage | Hukommelsesforbrug pr. pod |
| Pod Filesystem Usage | Diskforbrug pr. pod |
| Pod Network Receive/Transmit | Netværkstrafik |
| Pod Phase | Aktuel pod-fase (Running, Pending, Failed, osv.) |

### Node-metrikker

| Metrik | Beskrivelse |
|--------|-------------|
| Node CPU Usage | CPU-udnyttelse pr. node |
| Node Memory Usage | Hukommelsesudnyttelse pr. node |
| Node Filesystem Usage | Diskforbrug pr. node |
| Node Disk I/O | Læse-/skrive-operationer |
| Node Ready Condition | Om noden er klar |

### Container-metrikker

| Metrik | Beskrivelse |
|--------|-------------|
| Container Restarts | Antal container-genstarter |
| Container CPU/Memory Limits | Ressource-limits |
| Container CPU/Memory Requests | Ressource-requests |
| Container Ready Status | Om containere er klar |

### Arbejdsbelastnings-metrikker

| Metrik | Beskrivelse |
|--------|-------------|
| Deployment Available/Unavailable Replicas | Replika-antal |
| DaemonSet Misscheduled Nodes | Planlægningsproblemer |
| StatefulSet Ready Replicas | Antal klare replikaer |
| Job Active/Failed/Succeeded Pods | Job-status |

## Overvågningskriterier

### Tilgængelige check-typer

| Check-type | Beskrivelse |
|------------|-------------|
| Metric Value | Værdien af den konfigurerede metrik-forespørgsel eller formel |

### Aggregeringstyper

| Aggregering | Beskrivelse |
|-------------|-------------|
| Average | Gennemsnitsværdi over tidsvinduet |
| Sum | Sum af alle værdier |
| Maximum Value | Højeste værdi i tidsvinduet |
| Minimum Value | Laveste værdi i tidsvinduet |
| All Values | Alle værdier skal matche kriterierne |
| Any Value | Mindst én værdi skal matche |

### Filtertyper

- **Greater Than**, **Less Than**, **Greater Than or Equal To**, **Less Than or Equal To**, **Equal To**, **Not Equal To**

## Forudbyggede alarmskabeloner

OneUptime leverer skabeloner til almindelige Kubernetes-overvågningsscenarier:

| Skabelon | Beskrivelse | Tærskel |
|----------|-------------|-----------|
| CrashLoopBackOff-detektion | Container-genstartstælling | > 5 genstarter |
| Pod fast i Pending | Pods i Pending-fase | > 0 pods |
| Node Not Ready | Node-parathed | = 0 (ikke klar) |
| Højt node-CPU | Node-CPU-udnyttelse | > 90% |
| Høj node-hukommelse | Node-hukommelsesudnyttelse | > 85% |
| Deployment-replika-uoverensstemmelse | Utilgængelige replikaer | > 0 replikaer |
| Job-fejl | Fejlede pods i et job | > 0 fejl |
| etcd uden leder | etcd-klynge mangler leder | = 0 (ingen leder) |
| API Server-throttling | Dropped API-anmodninger | > 0 anmodninger |
| Scheduler-kø | Pending pods i scheduler | > 0 pods |
| Højt node-diskforbrug | Node-filsystemforbrug | > 90% |
| DaemonSet utilgængelig | Fejlplanlagte noder | > 0 noder |

## Opsætningskrav

For at bruge Kubernetes-overvågning skal du installere OneUptime Kubernetes-agenten i din klynge. Agenten sender klyngemetrikker, hændelser, pod-logs og — som standard — **applikations-traces og HTTP RED-metrikker indfanget via eBPF** til OneUptime over OTLP. Ingen kodeændringer eller pr.-app-SDK'er er påkrævede for at se service-niveau-trafik.

Se vejledningen [Installér Kubernetes-agenten](/docs/monitor/kubernetes-agent) — den dækker installation via Helm med én kommando, `preset`-indstillingen til at vælge den rigtige konfiguration til din klynge (standard, GKE Autopilot, EKS Fargate), og `ebpf.features.*`-skift til de individuelle signalfamilier (HTTP RED-metrikker, servicekort, netværksflows, TCP-statistik).
