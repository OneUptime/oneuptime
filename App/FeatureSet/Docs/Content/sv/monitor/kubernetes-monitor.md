# Kubernetes-monitor

Kubernetes-övervakning gör det möjligt att övervaka hälsan och prestandan hos dina Kubernetes-kluster, inklusive noder, poddar, arbetsbelastningar och kontrollplanekomponenter. OneUptime samlar in mätvärden från ditt kluster och utvärderar dem mot dina konfigurerade kriterier.

## Översikt

Kubernetes-monitorer använder mätvärden från ditt kluster för att ge djup insyn i din infrastruktur. Detta gör det möjligt att:

- Övervaka hälsan hos kluster, namespace, arbetsbelastning, nod och pod
- Spåra CPU-, minnes-, disk- och nätverksanvändning över resurser
- Upptäcka pod-krascher, omstarter och schemaläggningsfel
- Övervaka tillgänglighet för Deployment-repliker
- Larma vid problem på kontrollplanet (etcd, API-server, scheduler)
- Spåra resursförfrågningar och -gränser

## Skapa en Kubernetes-monitor

1. Gå till **Monitors** i OneUptime-dashboarden
2. Klicka på **Create Monitor**
3. Välj **Kubernetes** som monitortyp
4. Välj klustret och resursomfånget att övervaka
5. Konfigurera resursfilter och metric-frågor
6. Konfigurera övervakningskriterier efter behov

## Konfigurationsalternativ

### Kluster

Välj det Kubernetes-kluster som ska övervakas. Kluster måste vara integrerade med OneUptime via OpenTelemetry.

### Resursomfång

Välj nivån på vilken resurser ska övervakas:

| Omfång | Beskrivning |
|-------|-------------|
| Cluster | Övervaka hela klustret |
| Namespace | Övervaka resurser inom ett specifikt namespace |
| Workload | Övervaka en specifik deployment, statefulset, daemonset, job eller cronjob |
| Node | Övervaka en specifik klusternod |
| Pod | Övervaka en specifik pod |

### Resursfilter

Snäva in omfånget med valfria filter:

| Filter | Beskrivning | Tillämpliga omfång |
|--------|-------------|-------------------|
| Namespace | Kubernetes-namespace | Namespace, Workload, Pod |
| Workload Type | deployment, statefulset, daemonset, job, cronjob | Workload |
| Workload Name | Arbetsbelastningens namn | Workload |
| Node Name | Nodens namn | Node |
| Pod Name | Poddens namn | Pod |

### Metric-frågor

Konfigurera en eller flera metric-frågor att utvärdera. Varje fråga anger:

- **Metric-namn** — Det Kubernetes-mätvärde som ska frågas
- **Aggregering** — Hur metric-värden ska aggregeras
- **Filter** — Ytterligare attributbaserad filtrering

Du kan också skapa **formler** som kombinerar flera metric-frågor med matematiska uttryck.

### Rullande tidsfönster

Välj tidsfönster för metric-utvärdering:

- Senaste 1 minut
- Senaste 5 minuter
- Senaste 10 minuter
- Senaste 15 minuter
- Senaste 30 minuter
- Senaste 60 minuter

## Vanliga Kubernetes-mätvärden

### Pod-mätvärden

| Mätvärde | Beskrivning |
|--------|-------------|
| Pod CPU Usage | CPU-förbrukning av poddar |
| Pod Memory Usage | Minnesförbrukning av poddar |
| Pod Filesystem Usage | Diskanvändning av poddar |
| Pod Network Receive/Transmit | Nätverkstrafik |
| Pod Phase | Aktuell pod-fas (Running, Pending, Failed osv.) |

### Nodmätvärden

| Mätvärde | Beskrivning |
|--------|-------------|
| Node CPU Usage | CPU-utnyttjande per nod |
| Node Memory Usage | Minnesutnyttjande per nod |
| Node Filesystem Usage | Diskanvändning per nod |
| Node Disk I/O | Läs/skriv-operationer |
| Node Ready Condition | Om noden är redo |

### Containermätvärden

| Mätvärde | Beskrivning |
|--------|-------------|
| Container Restarts | Antal containeromstarter |
| Container CPU/Memory Limits | Resursgränser |
| Container CPU/Memory Requests | Resursförfrågningar |
| Container Ready Status | Om containrar är redo |

### Arbetsbelastningsmätvärden

| Mätvärde | Beskrivning |
|--------|-------------|
| Deployment Available/Unavailable Replicas | Antal repliker |
| DaemonSet Misscheduled Nodes | Schemaläggningsproblem |
| StatefulSet Ready Replicas | Antal redo-repliker |
| Job Active/Failed/Succeeded Pods | Job-status |

## Övervakningskriterier

### Tillgängliga kontrolltyper

| Kontrolltyp | Beskrivning |
|------------|-------------|
| Metric Value | Värdet på den konfigurerade metric-frågan eller formeln |

### Aggregeringstyper

| Aggregering | Beskrivning |
|-------------|-------------|
| Average | Medelvärde över tidsfönstret |
| Sum | Summan av alla värden |
| Maximum Value | Högsta värde i tidsfönstret |
| Minimum Value | Lägsta värde i tidsfönstret |
| All Values | Alla värden måste matcha kriterierna |
| Any Value | Minst ett värde måste matcha |

### Filtertyper

- **Greater Than**, **Less Than**, **Greater Than or Equal To**, **Less Than or Equal To**, **Equal To**, **Not Equal To**

## Förbyggda larmmallar

OneUptime tillhandahåller mallar för vanliga Kubernetes-övervakningsscenarier:

| Mall | Beskrivning | Tröskel |
|----------|-------------|-----------|
| CrashLoopBackOff Detection | Antal containeromstarter | > 5 omstarter |
| Pod Stuck in Pending | Poddar i Pending-fas | > 0 poddar |
| Node Not Ready | Nodens redo-villkor | = 0 (inte redo) |
| High Node CPU | CPU-utnyttjande för nod | > 90% |
| High Node Memory | Minnesutnyttjande för nod | > 85% |
| Deployment Replica Mismatch | Otillgängliga repliker | > 0 repliker |
| Job Failures | Misslyckade poddar i ett job | > 0 fel |
| etcd No Leader | etcd-klusterledare saknas | = 0 (ingen ledare) |
| API Server Throttling | Borttappade API-förfrågningar | > 0 förfrågningar |
| Scheduler Backlog | Väntande poddar i scheduler | > 0 poddar |
| High Node Disk Usage | Filsystemsanvändning för nod | > 90% |
| DaemonSet Unavailable | Felschemalagda noder | > 0 noder |

## Installationskrav

För att använda Kubernetes-övervakning behöver du installera OneUptime Kubernetes-agenten i ditt kluster. Agenten skickar klustermätvärden, händelser, pod-loggar och — som standard — **applikationsspårningar och HTTP RED-mätvärden insamlade via eBPF** till OneUptime över OTLP. Inga kodändringar eller per-app-SDK:er behövs för att se trafik på tjänstenivå.

Se guiden [Installera Kubernetes-agenten](/docs/monitor/kubernetes-agent) — den täcker Helm-installation med ett enda kommando, alternativet `preset` för att välja rätt konfiguration för ditt kluster (standard, GKE Autopilot, EKS Fargate) och växlarna `ebpf.features.*` för de enskilda signalfamiljerna (HTTP RED-mätvärden, tjänstegraf, nätverksflöden, TCP-statistik).
