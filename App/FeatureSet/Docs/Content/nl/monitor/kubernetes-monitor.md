# Kubernetes Monitor

Kubernetes-monitoring stelt u in staat de gezondheid en prestaties van uw Kubernetes-clusters te bewaken, inclusief nodes, pods, workloads en controlplane-componenten. OneUptime verzamelt metrics van uw cluster en evalueert deze aan de hand van uw geconfigureerde criteria.

## Overzicht

Kubernetes-monitors gebruiken metrics van uw cluster om diep inzicht te bieden in uw infrastructuur. Hiermee kunt u:

- Cluster-, namespace-, workload-, node- en pod-gezondheid bewaken
- CPU-, geheugen-, schijf- en netwerkgebruik bijhouden over resources
- Pod-crashes, herstarts en planningsfouten detecteren
- Beschikbaarheid van deployment-replica's bewaken
- Meldingen ontvangen bij controlplane-problemen (etcd, API-server, scheduler)
- Resource-verzoeken en -limieten bijhouden

## Een Kubernetes Monitor aanmaken

1. Ga naar **Monitors** in het OneUptime-dashboard
2. Klik op **Monitor aanmaken**
3. Selecteer **Kubernetes** als het monitortype
4. Selecteer het cluster en resourcebereik dat u wilt bewaken
5. Configureer resourcefilters en metriekopvragen
6. Configureer monitoringcriteria naar wens

## Configuratie-opties

### Cluster

Selecteer het te bewaken Kubernetes-cluster. Clusters moeten via OpenTelemetry zijn geïntegreerd met OneUptime.

### Resourcebereik

Kies het niveau waarop u resources wilt bewaken:

| Bereik | Beschrijving |
|-------|-------------|
| Cluster | Het gehele cluster bewaken |
| Namespace | Resources bewaken binnen een specifieke namespace |
| Workload | Een specifiek deployment, statefulset, daemonset, job of cronjob bewaken |
| Node | Een specifieke clusternode bewaken |
| Pod | Een specifieke pod bewaken |

### Resourcefilters

Verklein het bereik met optionele filters:

| Filter | Beschrijving | Van toepassing op bereiken |
|--------|-------------|-------------------|
| Namespace | Kubernetes-namespace | Namespace, Workload, Pod |
| Workloadtype | deployment, statefulset, daemonset, job, cronjob | Workload |
| Workloadnaam | Naam van de workload | Workload |
| Nodenaam | Naam van de node | Node |
| Podnaam | Naam van de pod | Pod |

### Metriekopvragen

Configureer een of meer metriekopvragen om te evalueren. Elke opvraag specificeert:

- **Metrieknaam** — De te bevragen Kubernetes-metriek
- **Aggregatie** — Hoe metriekwaarden te aggregeren
- **Filters** — Aanvullende attribuutgebaseerde filtering

U kunt ook **formules** maken die meerdere metriekopvragen combineren met wiskundige expressies.

### Voortschrijdend tijdvenster

Selecteer het tijdvenster voor metriekverhoogde evaluatie:

- Afgelopen 1 minuut
- Afgelopen 5 minuten
- Afgelopen 10 minuten
- Afgelopen 15 minuten
- Afgelopen 30 minuten
- Afgelopen 60 minuten

## Veelgebruikte Kubernetes-metrics

### Pod-metrics

| Metriek | Beschrijving |
|--------|-------------|
| Pod CPU-gebruik | CPU-verbruik door pods |
| Pod-geheugengebruik | Geheugenverbruik door pods |
| Pod-bestandssysteemgebruik | Schijfgebruik door pods |
| Pod-netwerk ontvangen/verzenden | Netwerkverkeer |
| Pod-fase | Huidige pod-fase (Actief, In behandeling, Mislukt, enz.) |

### Node-metrics

| Metriek | Beschrijving |
|--------|-------------|
| Node CPU-gebruik | CPU-gebruik per node |
| Node-geheugengebruik | Geheugengebruik per node |
| Node-bestandssysteemgebruik | Schijfgebruik per node |
| Node schijf-I/O | Lees-/schrijfbewerkingen |
| Node gereed conditie | Of de node gereed is |

### Container-metrics

| Metriek | Beschrijving |
|--------|-------------|
| Container-herstarts | Aantal container-herstarts |
| Container CPU/geheugen limieten | Resourcelimieten |
| Container CPU/geheugen verzoeken | Resourceverzoeken |
| Container gereed status | Of containers gereed zijn |

### Workload-metrics

| Metriek | Beschrijving |
|--------|-------------|
| Deployment beschikbare/niet-beschikbare replica's | Replica-tellingen |
| DaemonSet verkeerd geplande nodes | Planningsproblemen |
| StatefulSet gereed replica's | Gereed replica-telling |
| Job actieve/mislukte/geslaagde pods | Taakstatus |

## Monitoringcriteria

### Beschikbare controletypen

| Controletype | Beschrijving |
|------------|-------------|
| Metriekwaarde | De waarde van de geconfigureerde metriekopvraag of formule |

### Aggregatietypen

| Aggregatie | Beschrijving |
|-------------|-------------|
| Gemiddelde | Gemiddelde waarde over het tijdvenster |
| Som | Som van alle waarden |
| Maximumwaarde | Hoogste waarde in het tijdvenster |
| Minimumwaarde | Laagste waarde in het tijdvenster |
| Alle waarden | Alle waarden moeten voldoen aan de criteria |
| Elke waarde | Ten minste één waarde moet voldoen |

### Filtertypen

- **Groter dan**, **Kleiner dan**, **Groter dan of gelijk aan**, **Kleiner dan of gelijk aan**, **Gelijk aan**, **Niet gelijk aan**

## Voorgebouwde meldingssjablonen

OneUptime biedt sjablonen voor veelgebruikte Kubernetes-monitoringscenario's:

| Sjabloon | Beschrijving | Drempelwaarde |
|----------|-------------|-----------|
| CrashLoopBackOff-detectie | Aantal container-herstarts | > 5 herstarts |
| Pod vastgelopen in In behandeling | Pods in In behandeling-fase | > 0 pods |
| Node niet gereed | Node-gereedheidconditie | = 0 (niet gereed) |
| Hoog node-CPU | Node CPU-gebruik | > 90% |
| Hoog nodegeheugen | Node-geheugengebruik | > 85% |
| Deployment replica-mismatch | Niet-beschikbare replica's | > 0 replica's |
| Taakfouten | Mislukte pods in een taak | > 0 fouten |
| etcd Geen leider | etcd-clusterleider ontbreekt | = 0 (geen leider) |
| API-server beperking | Verwijderde API-verzoeken | > 0 verzoeken |
| Scheduler-backlog | Pods in behandeling in scheduler | > 0 pods |
| Hoog node-schijfgebruik | Node-bestandssysteemgebruik | > 90% |
| DaemonSet niet beschikbaar | Verkeerd geplande nodes | > 0 nodes |

## Installatievereisten

Voor Kubernetes-monitoring moet u de OneUptime Kubernetes-agent in uw cluster installeren. De agent stuurt cluster-metrics, events en pod-logboeken via OTLP naar OneUptime.

Zie de gids [De Kubernetes Agent installeren](/docs/monitor/kubernetes-agent) — deze behandelt de ééncommando Helm-installatie en de `preset`-optie voor het kiezen van de juiste configuratie voor uw cluster (standaard, GKE Autopilot, EKS Fargate).
