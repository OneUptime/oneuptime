# Monitor Kubernetes

Il monitoring Kubernetes vi consente di monitorare lo stato di salute e le prestazioni dei vostri cluster Kubernetes, inclusi nodi, pod, workload e componenti del control plane. OneUptime raccoglie metriche dal vostro cluster e le valuta in base ai criteri configurati.

## Panoramica

I monitor Kubernetes usano le metriche del vostro cluster per fornire una visibilità approfondita sulla vostra infrastruttura. Questo vi permette di:

- Monitorare lo stato di salute di cluster, namespace, workload, nodi e pod
- Tracciare l'utilizzo di CPU, memoria, disco e rete attraverso le risorse
- Rilevare crash dei pod, riavvii e fallimenti di pianificazione
- Monitorare la disponibilità delle repliche di deployment
- Generare alert su problemi del control plane (etcd, API server, scheduler)
- Tracciare richieste e limiti di risorse

## Creare un monitor Kubernetes

1. Andate su **Monitors** nella Dashboard di OneUptime
2. Cliccate su **Create Monitor**
3. Selezionate **Kubernetes** come tipo di monitor
4. Selezionate il cluster e l'ambito delle risorse da monitorare
5. Configurate filtri delle risorse e query delle metriche
6. Configurate i criteri di monitoring secondo necessità

## Opzioni di configurazione

### Cluster

Selezionate il cluster Kubernetes da monitorare. I cluster devono essere integrati con OneUptime tramite OpenTelemetry.

### Ambito delle risorse

Scegliete il livello al quale monitorare le risorse:

| Ambito | Descrizione |
|-------|-------------|
| Cluster | Monitora l'intero cluster |
| Namespace | Monitora le risorse all'interno di uno specifico namespace |
| Workload | Monitora uno specifico deployment, statefulset, daemonset, job o cronjob |
| Node | Monitora uno specifico nodo del cluster |
| Pod | Monitora uno specifico pod |

### Filtri delle risorse

Restringete l'ambito con filtri opzionali:

| Filtro | Descrizione | Ambiti applicabili |
|--------|-------------|-------------------|
| Namespace | Namespace Kubernetes | Namespace, Workload, Pod |
| Workload Type | deployment, statefulset, daemonset, job, cronjob | Workload |
| Workload Name | Nome del workload | Workload |
| Node Name | Nome del nodo | Node |
| Pod Name | Nome del pod | Pod |

### Query delle metriche

Configurate una o più query delle metriche da valutare. Ciascuna query specifica:

- **Metric name** — La metrica Kubernetes da interrogare
- **Aggregation** — Come aggregare i valori della metrica
- **Filters** — Filtraggio aggiuntivo basato su attributi

Potete anche creare **formule** che combinano più query di metriche utilizzando espressioni matematiche.

### Finestra temporale scorrevole

Selezionate la finestra temporale per la valutazione della metrica:

- Ultimo 1 minuto
- Ultimi 5 minuti
- Ultimi 10 minuti
- Ultimi 15 minuti
- Ultimi 30 minuti
- Ultimi 60 minuti

## Metriche Kubernetes comuni

### Metriche dei pod

| Metrica | Descrizione |
|--------|-------------|
| Pod CPU Usage | Consumo CPU da parte dei pod |
| Pod Memory Usage | Consumo di memoria da parte dei pod |
| Pod Filesystem Usage | Utilizzo del disco da parte dei pod |
| Pod Network Receive/Transmit | Traffico di rete |
| Pod Phase | Fase corrente del pod (Running, Pending, Failed, ecc.) |

### Metriche dei nodi

| Metrica | Descrizione |
|--------|-------------|
| Node CPU Usage | Utilizzo CPU per nodo |
| Node Memory Usage | Utilizzo memoria per nodo |
| Node Filesystem Usage | Utilizzo disco per nodo |
| Node Disk I/O | Operazioni di lettura/scrittura |
| Node Ready Condition | Indica se il nodo è pronto |

### Metriche dei container

| Metrica | Descrizione |
|--------|-------------|
| Container Restarts | Numero di riavvii del container |
| Container CPU/Memory Limits | Limiti di risorse |
| Container CPU/Memory Requests | Richieste di risorse |
| Container Ready Status | Indica se i container sono pronti |

### Metriche dei workload

| Metrica | Descrizione |
|--------|-------------|
| Deployment Available/Unavailable Replicas | Conteggio delle repliche |
| DaemonSet Misscheduled Nodes | Problemi di pianificazione |
| StatefulSet Ready Replicas | Conteggio delle repliche pronte |
| Job Active/Failed/Succeeded Pods | Stato del job |

## Criteri di monitoring

### Tipi di controlli disponibili

| Tipo di controllo | Descrizione |
|------------|-------------|
| Metric Value | Il valore della query di metrica o formula configurata |

### Tipi di aggregazione

| Aggregazione | Descrizione |
|-------------|-------------|
| Average | Valore medio sulla finestra temporale |
| Sum | Somma di tutti i valori |
| Maximum Value | Valore più alto nella finestra temporale |
| Minimum Value | Valore più basso nella finestra temporale |
| All Values | Tutti i valori devono corrispondere ai criteri |
| Any Value | Almeno un valore deve corrispondere |

### Tipi di filtri

- **Greater Than**, **Less Than**, **Greater Than or Equal To**, **Less Than or Equal To**, **Equal To**, **Not Equal To**

## Template di alert predefiniti

OneUptime fornisce template per scenari comuni di monitoring Kubernetes:

| Template | Descrizione | Soglia |
|----------|-------------|-----------|
| CrashLoopBackOff Detection | Conteggio dei riavvii del container | > 5 riavvii |
| Pod Stuck in Pending | Pod nella fase Pending | > 0 pod |
| Node Not Ready | Condizione di readiness del nodo | = 0 (non pronto) |
| High Node CPU | Utilizzo CPU del nodo | > 90% |
| High Node Memory | Utilizzo memoria del nodo | > 85% |
| Deployment Replica Mismatch | Repliche non disponibili | > 0 repliche |
| Job Failures | Pod falliti in un job | > 0 fallimenti |
| etcd No Leader | Leader del cluster etcd mancante | = 0 (nessun leader) |
| API Server Throttling | Richieste API scartate | > 0 richieste |
| Scheduler Backlog | Pod in attesa nello scheduler | > 0 pod |
| High Node Disk Usage | Utilizzo del filesystem del nodo | > 90% |
| DaemonSet Unavailable | Nodi con pianificazione errata | > 0 nodi |

## Requisiti di configurazione

Per utilizzare il monitoring Kubernetes, dovete installare l'agente Kubernetes di OneUptime nel vostro cluster. L'agente invia metriche del cluster, eventi, log dei pod e — per impostazione predefinita — **trace delle applicazioni e metriche RED HTTP catturate tramite eBPF** a OneUptime via OTLP. Non sono necessarie modifiche al codice o SDK per applicazione per vedere il traffico a livello di servizio.

Consultate la guida [Installare l'agente Kubernetes](/docs/monitor/kubernetes-agent) — copre l'installazione Helm con un solo comando, l'opzione `preset` per scegliere la configurazione giusta per il vostro cluster (standard, GKE Autopilot, EKS Fargate) e i toggle `ebpf.features.*` per le singole famiglie di segnali (metriche RED HTTP, service graph, flussi di rete, statistiche TCP).
