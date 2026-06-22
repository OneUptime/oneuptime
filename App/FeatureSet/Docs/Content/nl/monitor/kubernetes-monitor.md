# Kubernetes-monitor

Met Kubernetes-monitoring kunt u de gezondheid en prestaties van uw Kubernetes-clusters monitoren, inclusief nodes, pods, workloads en control plane-componenten. OneUptime verzamelt metrics uit uw cluster en evalueert deze aan de hand van uw geconfigureerde criteria.

## Overzicht

Kubernetes-monitors gebruiken metrics uit uw cluster om diepgaande zichtbaarheid in uw infrastructuur te bieden. Dit stelt u in staat om:

- De gezondheid van cluster, namespace, workload, node en pod te monitoren
- CPU-, geheugen-, schijf- en netwerkgebruik over resources te volgen
- Pod-crashes, herstarts en planningsfouten te detecteren
- De beschikbaarheid van deployment-replicas te monitoren
- Te waarschuwen bij problemen met het control plane (etcd, API-server, scheduler)
- Resource-requests en -limits te volgen

## Een Kubernetes-monitor aanmaken

1. Ga naar **Monitors** in het OneUptime-dashboard
2. Klik op **Create Monitor**
3. Selecteer **Kubernetes** als het monitortype
4. Selecteer het cluster en de resource-scope om te monitoren
5. Configureer resource-filters en metric-queries
6. Configureer monitoring-criteria naar behoefte

## Configuratieopties

### Cluster

Selecteer het Kubernetes-cluster om te monitoren. Clusters moeten via OpenTelemetry zijn geïntegreerd met OneUptime.

### Resource-scope

Kies het niveau waarop u resources wilt monitoren:

| Scope     | Beschrijving                                                              |
| --------- | ------------------------------------------------------------------------- |
| Cluster   | Monitor het hele cluster                                                  |
| Namespace | Monitor resources binnen een specifieke namespace                         |
| Workload  | Monitor een specifieke deployment, statefulset, daemonset, job of cronjob |
| Node      | Monitor een specifieke cluster-node                                       |
| Pod       | Monitor een specifieke pod                                                |

### Resource-filters

Versmal de scope met optionele filters:

| Filter        | Beschrijving                                     | Toepasselijke scopes     |
| ------------- | ------------------------------------------------ | ------------------------ |
| Namespace     | Kubernetes-namespace                             | Namespace, Workload, Pod |
| Workload Type | deployment, statefulset, daemonset, job, cronjob | Workload                 |
| Workload Name | Naam van de workload                             | Workload                 |
| Node Name     | Naam van de node                                 | Node                     |
| Pod Name      | Naam van de pod                                  | Pod                      |

### Metric-queries

Configureer een of meer metric-queries om te evalueren. Elke query specificeert:

- **Metric name** — De Kubernetes-metric om te bevragen
- **Aggregation** — Hoe metric-waarden moeten worden geaggregeerd
- **Filters** — Aanvullende filtering op basis van attributen

U kunt ook **formules** maken die meerdere metric-queries combineren met behulp van wiskundige expressies.

### Rollend tijdvenster

Selecteer het tijdvenster voor metric-evaluatie:

- Afgelopen 1 minuut
- Afgelopen 5 minuten
- Afgelopen 10 minuten
- Afgelopen 15 minuten
- Afgelopen 30 minuten
- Afgelopen 60 minuten

## Veelvoorkomende Kubernetes-metrics

### Pod-metrics

| Metric                       | Beschrijving                                      |
| ---------------------------- | ------------------------------------------------- |
| Pod CPU Usage                | CPU-verbruik door pods                            |
| Pod Memory Usage             | Geheugenverbruik door pods                        |
| Pod Filesystem Usage         | Schijfgebruik door pods                           |
| Pod Network Receive/Transmit | Netwerkverkeer                                    |
| Pod Phase                    | Huidige pod-fase (Running, Pending, Failed, etc.) |

### Node-metrics

| Metric                | Beschrijving               |
| --------------------- | -------------------------- |
| Node CPU Usage        | CPU-benutting per node     |
| Node Memory Usage     | Geheugenbenutting per node |
| Node Filesystem Usage | Schijfgebruik per node     |
| Node Disk I/O         | Lees-/schrijfbewerkingen   |
| Node Ready Condition  | Of de node gereed is       |

### Container-metrics

| Metric                        | Beschrijving               |
| ----------------------------- | -------------------------- |
| Container Restarts            | Aantal container-herstarts |
| Container CPU/Memory Limits   | Resource-limits            |
| Container CPU/Memory Requests | Resource-requests          |
| Container Ready Status        | Of containers gereed zijn  |

### Workload-metrics

| Metric                                    | Beschrijving            |
| ----------------------------------------- | ----------------------- |
| Deployment Available/Unavailable Replicas | Aantal replicas         |
| DaemonSet Misscheduled Nodes              | Planningsproblemen      |
| StatefulSet Ready Replicas                | Aantal gereede replicas |
| Job Active/Failed/Succeeded Pods          | Job-status              |

## Monitoring-criteria

### Beschikbare check-types

| Check Type   | Beschrijving                                             |
| ------------ | -------------------------------------------------------- |
| Metric Value | De waarde van de geconfigureerde metric-query of formule |

### Aggregatietypes

| Aggregation   | Beschrijving                                |
| ------------- | ------------------------------------------- |
| Average       | Gemiddelde waarde over het tijdvenster      |
| Sum           | Som van alle waarden                        |
| Maximum Value | Hoogste waarde in het tijdvenster           |
| Minimum Value | Laagste waarde in het tijdvenster           |
| All Values    | Alle waarden moeten aan de criteria voldoen |
| Any Value     | Ten minste één waarde moet overeenkomen     |

### Filtertypes

- **Greater Than**, **Less Than**, **Greater Than or Equal To**, **Less Than or Equal To**, **Equal To**, **Not Equal To**

## Vooraf gebouwde alert-templates

OneUptime biedt templates voor veelvoorkomende Kubernetes-monitoring-scenario's:

| Template                    | Beschrijving                    | Drempel           |
| --------------------------- | ------------------------------- | ----------------- |
| CrashLoopBackOff Detection  | Aantal container-herstarts      | > 5 herstarts     |
| Pod Stuck in Pending        | Pods in Pending-fase            | > 0 pods          |
| Node Not Ready              | Node-gereedheidsstatus          | = 0 (niet gereed) |
| High Node CPU               | CPU-benutting van node          | > 90%             |
| High Node Memory            | Geheugenbenutting van node      | > 85%             |
| Deployment Replica Mismatch | Niet-beschikbare replicas       | > 0 replicas      |
| Job Failures                | Mislukte pods in een job        | > 0 mislukkingen  |
| etcd No Leader              | etcd-cluster-leader ontbreekt   | = 0 (geen leider) |
| API Server Throttling       | Afgewezen API-verzoeken         | > 0 verzoeken     |
| Scheduler Backlog           | Pods in afwachting in scheduler | > 0 pods          |
| High Node Disk Usage        | Bestandssysteemgebruik van node | > 90%             |
| DaemonSet Unavailable       | Verkeerd geplande nodes         | > 0 nodes         |

## Installatievereisten

Om Kubernetes-monitoring te gebruiken, moet u de OneUptime Kubernetes-agent installeren in uw cluster. De agent stuurt cluster-metrics, events, pod-logboeken en — standaard — **applicatie-traces en HTTP RED-metrics vastgelegd via eBPF** naar OneUptime via OTLP. Geen codewijzigingen of per-app SDKs zijn vereist om service-niveau verkeer te zien.

Zie de [De Kubernetes-agent installeren](/docs/monitor/kubernetes-agent)-handleiding — deze behandelt de Helm-installatie met één commando, de `preset`-optie voor het kiezen van de juiste configuratie voor uw cluster (standard, GKE Autopilot, EKS Fargate) en de `ebpf.features.*`-schakelaars voor de individuele signaal-families (HTTP RED-metrics, service-graph, netwerk-flows, TCP-statistieken).
