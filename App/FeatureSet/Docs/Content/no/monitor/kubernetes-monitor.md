# Kubernetes-monitor

Kubernetes-overvåking lar deg overvåke helse og ytelse for Kubernetes-klyngene dine, inkludert noder, pods, arbeidsmengder og kontrollplanekomponenter. OneUptime samler inn metrikker fra klyngen din og evaluerer dem mot dine konfigurerte kriterier.

## Oversikt

Kubernetes-monitorer bruker metrikker fra klyngen din for å gi dyp synlighet inn i infrastrukturen din. Dette gjør det mulig å:

- Overvåke helse for klynge, navnerom, arbeidsmengde, node og pod
- Spore CPU-, minne-, disk- og nettverksforbruk på tvers av ressurser
- Oppdage pod-krasj, omstarter og planleggingsfeil
- Overvåke tilgjengeligheten av deployment-replikaer
- Varsle om kontrollplane-problemer (etcd, API-server, planlegger)
- Spore ressursforespørsler og -grenser

## Opprette en Kubernetes-monitor

1. Gå til **Monitors** i OneUptime-dashbordet
2. Klikk **Create Monitor**
3. Velg **Kubernetes** som monitortype
4. Velg klyngen og ressursomfanget som skal overvåkes
5. Konfigurer ressursfiltre og metrikk-spørringer
6. Konfigurer overvåkingskriterier etter behov

## Konfigurasjonsalternativer

### Klynge

Velg Kubernetes-klyngen som skal overvåkes. Klynger må integreres med OneUptime via OpenTelemetry.

### Ressursomfang

Velg nivået det skal overvåkes på:

| Omfang | Beskrivelse |
|--------|-------------|
| Cluster | Overvåke hele klyngen |
| Namespace | Overvåke ressurser innenfor et spesifikt navnerom |
| Workload | Overvåke en spesifikk deployment, statefulset, daemonset, job eller cronjob |
| Node | Overvåke en spesifikk klyngenode |
| Pod | Overvåke en spesifikk pod |

### Ressursfiltre

Begrens omfanget med valgfrie filtre:

| Filter | Beskrivelse | Gjeldende omfang |
|--------|-------------|------------------|
| Namespace | Kubernetes-navnerom | Namespace, Workload, Pod |
| Workload Type | deployment, statefulset, daemonset, job, cronjob | Workload |
| Workload Name | Navn på arbeidsmengden | Workload |
| Node Name | Navn på noden | Node |
| Pod Name | Navn på poden | Pod |

### Metrikk-spørringer

Konfigurer én eller flere metrikk-spørringer som skal evalueres. Hver spørring angir:

- **Metrikknavnet** – Kubernetes-metrikken som skal spørres
- **Aggregering** – Hvordan metrikkverdier skal aggregeres
- **Filtre** – Ytterligere attributtbasert filtrering

Du kan også opprette **formler** som kombinerer flere metrikk-spørringer ved hjelp av matematiske uttrykk.

### Rullende tidsvindu

Velg tidsvinduet for metrikkevealuering:

- Siste 1 minutt
- Siste 5 minutter
- Siste 10 minutter
- Siste 15 minutter
- Siste 30 minutter
- Siste 60 minutter

## Vanlige Kubernetes-metrikker

### Pod-metrikker

| Metrikk | Beskrivelse |
|---------|-------------|
| Pod CPU Usage | CPU-forbruk av pods |
| Pod Memory Usage | Minneforbruk av pods |
| Pod Filesystem Usage | Diskforbruk av pods |
| Pod Network Receive/Transmit | Nettverkstrafikk |
| Pod Phase | Gjeldende pod-fase (Running, Pending, Failed, osv.) |

### Node-metrikker

| Metrikk | Beskrivelse |
|---------|-------------|
| Node CPU Usage | CPU-utnyttelse per node |
| Node Memory Usage | Minneutnyttelse per node |
| Node Filesystem Usage | Diskforbruk per node |
| Node Disk I/O | Lese-/skriveoperasjoner |
| Node Ready Condition | Om noden er klar |

### Container-metrikker

| Metrikk | Beskrivelse |
|---------|-------------|
| Container Restarts | Antall container-omstarter |
| Container CPU/Memory Limits | Ressursgrenser |
| Container CPU/Memory Requests | Ressursforespørsler |
| Container Ready Status | Om containere er klare |

### Arbeidsmengde-metrikker

| Metrikk | Beskrivelse |
|---------|-------------|
| Deployment Available/Unavailable Replicas | Replikantall |
| DaemonSet Misscheduled Nodes | Planleggingsproblemer |
| StatefulSet Ready Replicas | Antall klare replikaer |
| Job Active/Failed/Succeeded Pods | Jobbstatus |

## Overvåkingskriterier

### Tilgjengelige kontrolltyper

| Kontrolltype | Beskrivelse |
|-------------|-------------|
| Metric Value | Verdien av den konfigurerte metrikk-spørringen eller formelen |

### Aggregeringstyper

| Aggregering | Beskrivelse |
|-------------|-------------|
| Average | Gjennomsnittlig verdi over tidsvinduet |
| Sum | Sum av alle verdier |
| Maximum Value | Høyeste verdi i tidsvinduet |
| Minimum Value | Laveste verdi i tidsvinduet |
| All Values | Alle verdier må samsvare med kriteriene |
| Any Value | Minst én verdi må samsvare |

### Filtertyper

- **Greater Than**, **Less Than**, **Greater Than or Equal To**, **Less Than or Equal To**, **Equal To**, **Not Equal To**

## Forhåndsbygde varslingsmaler

OneUptime tilbyr maler for vanlige Kubernetes-overvåkingsscenarier:

| Mal | Beskrivelse | Terskel |
|-----|-------------|---------|
| CrashLoopBackOff Detection | Antall container-omstarter | > 5 omstarter |
| Pod Stuck in Pending | Pods i Pending-fase | > 0 pods |
| Node Not Ready | Node-klarhetsvilkår | = 0 (ikke klar) |
| High Node CPU | Node-CPU-utnyttelse | > 90 % |
| High Node Memory | Node-minneutnyttelse | > 85 % |
| Deployment Replica Mismatch | Utilgjengelige replikaer | > 0 replikaer |
| Job Failures | Mislykkede pods i en jobb | > 0 feil |
| etcd No Leader | Manglende etcd-klyngeleder | = 0 (ingen leder) |
| API Server Throttling | Forkastede API-forespørsler | > 0 forespørsler |
| Scheduler Backlog | Ventende pods i planleggeren | > 0 pods |
| High Node Disk Usage | Node-filsystembruk | > 90 % |
| DaemonSet Unavailable | Feilplanlagte noder | > 0 noder |

## Krav til oppsett

For å bruke Kubernetes-overvåking må du installere OneUptime Kubernetes-agenten i klyngen din. Agenten sender klyngemetrikker, hendelser og pod-logger til OneUptime over OTLP.

Se guiden [Installere Kubernetes-agenten](/docs/monitor/kubernetes-agent) – den dekker den ett-kommandos Helm-installasjonen og `preset`-alternativet for å velge riktig konfigurasjon for klyngen din (standard, GKE Autopilot, EKS Fargate).
