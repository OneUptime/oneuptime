# Kubernetes-monitor

Kubernetes-overvåking lar deg overvåke helsen og ytelsen til Kubernetes-klyngene dine, inkludert noder, pods, arbeidsmengder og kontrollplankomponenter. OneUptime samler inn metrikker fra klyngen din og evaluerer dem mot dine konfigurerte kriterier.

## Oversikt

Kubernetes-monitorer bruker metrikker fra klyngen din for å gi dyp innsikt i infrastrukturen din. Dette gjør at du kan:

- Overvåke helsen til klynge, namespace, arbeidsmengde, node og pod
- Spore CPU-, minne-, disk- og nettverksbruk på tvers av ressurser
- Oppdage pod-krasj, omstarter og planleggingsfeil
- Overvåke tilgjengelighet for Deployment-replikaer
- Varsle om problemer i kontrollplanet (etcd, API-server, scheduler)
- Spore ressursforespørsler og -grenser

## Opprette en Kubernetes-monitor

1. Gå til **Monitors** i OneUptime-dashbordet
2. Klikk **Create Monitor**
3. Velg **Kubernetes** som monitortype
4. Velg klyngen og ressursomfanget som skal overvåkes
5. Konfigurer ressursfiltre og metrikkspørringer
6. Konfigurer overvåkingskriterier etter behov

## Konfigurasjonsvalg

### Klynge

Velg Kubernetes-klyngen som skal overvåkes. Klynger må være integrert med OneUptime via OpenTelemetry.

### Ressursomfang

Velg nivået ressurser skal overvåkes på:

| Omfang | Beskrivelse |
|-------|-------------|
| Cluster | Overvåk hele klyngen |
| Namespace | Overvåk ressurser innenfor et spesifikt namespace |
| Workload | Overvåk en spesifikk deployment, statefulset, daemonset, job eller cronjob |
| Node | Overvåk en spesifikk klyngenode |
| Pod | Overvåk en spesifikk pod |

### Ressursfiltre

Snevre inn omfanget med valgfrie filtre:

| Filter | Beskrivelse | Aktuelle omfang |
|--------|-------------|-------------------|
| Namespace | Kubernetes namespace | Namespace, Workload, Pod |
| Workload Type | deployment, statefulset, daemonset, job, cronjob | Workload |
| Workload Name | Navnet på arbeidsmengden | Workload |
| Node Name | Navnet på noden | Node |
| Pod Name | Navnet på poden | Pod |

### Metrikkspørringer

Konfigurer én eller flere metrikkspørringer som skal evalueres. Hver spørring spesifiserer:

- **Metrikknavn** — Kubernetes-metrikken som skal spørres
- **Aggregering** — Hvordan metrikkverdier skal aggregeres
- **Filtre** — Ytterligere attributtbasert filtrering

Du kan også opprette **formler** som kombinerer flere metrikkspørringer ved hjelp av matematiske uttrykk.

### Rullende tidsvindu

Velg tidsvinduet for metrikkevaluering:

- Siste 1 minutt
- Siste 5 minutter
- Siste 10 minutter
- Siste 15 minutter
- Siste 30 minutter
- Siste 60 minutter

## Vanlige Kubernetes-metrikker

### Pod-metrikker

| Metrikk | Beskrivelse |
|--------|-------------|
| Pod CPU Usage | CPU-forbruk av pods |
| Pod Memory Usage | Minneforbruk av pods |
| Pod Filesystem Usage | Diskbruk av pods |
| Pod Network Receive/Transmit | Nettverkstrafikk |
| Pod Phase | Nåværende pod-fase (Running, Pending, Failed osv.) |

### Node-metrikker

| Metrikk | Beskrivelse |
|--------|-------------|
| Node CPU Usage | CPU-utnyttelse per node |
| Node Memory Usage | Minneutnyttelse per node |
| Node Filesystem Usage | Diskbruk per node |
| Node Disk I/O | Lese-/skriveoperasjoner |
| Node Ready Condition | Om noden er klar |

### Container-metrikker

| Metrikk | Beskrivelse |
|--------|-------------|
| Container Restarts | Antall container-omstarter |
| Container CPU/Memory Limits | Ressursgrenser |
| Container CPU/Memory Requests | Ressursforespørsler |
| Container Ready Status | Om containerne er klare |

### Arbeidsmengdemetrikker

| Metrikk | Beskrivelse |
|--------|-------------|
| Deployment Available/Unavailable Replicas | Antall replikaer |
| DaemonSet Misscheduled Nodes | Planleggingsproblemer |
| StatefulSet Ready Replicas | Antall klare replikaer |
| Job Active/Failed/Succeeded Pods | Jobbstatus |

## Overvåkingskriterier

### Tilgjengelige sjekktyper

| Sjekktype | Beskrivelse |
|------------|-------------|
| Metric Value | Verdien av den konfigurerte metrikkspørringen eller formelen |

### Aggregeringstyper

| Aggregering | Beskrivelse |
|-------------|-------------|
| Average | Gjennomsnittsverdi over tidsvinduet |
| Sum | Summen av alle verdier |
| Maximum Value | Høyeste verdi i tidsvinduet |
| Minimum Value | Laveste verdi i tidsvinduet |
| All Values | Alle verdier må matche kriteriet |
| Any Value | Minst én verdi må matche |

### Filtertyper

- **Greater Than**, **Less Than**, **Greater Than or Equal To**, **Less Than or Equal To**, **Equal To**, **Not Equal To**

## Forhåndsbygde varselmaler

OneUptime tilbyr maler for vanlige Kubernetes-overvåkingsscenarier:

| Mal | Beskrivelse | Terskel |
|----------|-------------|-----------|
| CrashLoopBackOff Detection | Antall container-omstarter | > 5 omstarter |
| Pod Stuck in Pending | Pods i Pending-fase | > 0 pods |
| Node Not Ready | Nodens klartilstand | = 0 (ikke klar) |
| High Node CPU | Node CPU-utnyttelse | > 90 % |
| High Node Memory | Node minneutnyttelse | > 85 % |
| Deployment Replica Mismatch | Utilgjengelige replikaer | > 0 replikaer |
| Job Failures | Mislykkede pods i en jobb | > 0 feil |
| etcd No Leader | etcd-klyngens leder mangler | = 0 (ingen leder) |
| API Server Throttling | Avslåtte API-forespørsler | > 0 forespørsler |
| Scheduler Backlog | Ventende pods i scheduler | > 0 pods |
| High Node Disk Usage | Node filsystembruk | > 90 % |
| DaemonSet Unavailable | Feilplanlagte noder | > 0 noder |

## Oppsettskrav

For å bruke Kubernetes-overvåking må du installere OneUptime Kubernetes-agenten i klyngen din. Agenten sender klyngemetrikker, hendelser, pod-logger og — som standard — **applikasjonssporinger og HTTP RED-metrikker fanget via eBPF** til OneUptime over OTLP. Ingen kodeendringer eller per-app SDK-er er nødvendig for å se trafikk på tjenestenivå.

Se veiledningen [Installere Kubernetes-agenten](/docs/monitor/kubernetes-agent) — den dekker Helm-installasjonen med én kommando, `preset`-valget for å velge riktig konfigurasjon for klyngen din (standard, GKE Autopilot, EKS Fargate), og bryterne `ebpf.features.*` for de individuelle signalfamiliene (HTTP RED-metrikker, tjenestegraf, nettverksflyt, TCP-statistikk).
