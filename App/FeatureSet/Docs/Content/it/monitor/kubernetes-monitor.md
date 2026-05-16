# Monitor Kubernetes

Il monitoraggio Kubernetes consente di monitorare la salute e le prestazioni dei propri cluster Kubernetes, inclusi nodi, pod, workload e componenti del piano di controllo. OneUptime raccoglie metriche dal cluster e le valuta in base ai criteri configurati.

## Panoramica

I monitor Kubernetes usano le metriche del cluster per fornire visibilità approfondita dell'infrastruttura. Questo consente di:

- Monitorare la salute di cluster, namespace, workload, nodi e pod
- Tracciare l'utilizzo di CPU, memoria, disco e rete per le risorse
- Rilevare crash, riavvii e fallimenti di scheduling dei pod
- Monitorare la disponibilità delle repliche dei deployment
- Ricevere avvisi sui problemi del piano di controllo (etcd, server API, scheduler)
- Tracciare le richieste e i limiti delle risorse

## Creazione di un Monitor Kubernetes

1. Accedere a **Monitor** nel Dashboard di OneUptime
2. Fare clic su **Crea Monitor**
3. Selezionare **Kubernetes** come tipo di monitor
4. Selezionare il cluster e l'ambito della risorsa da monitorare
5. Configurare i filtri delle risorse e le query metriche
6. Configurare i criteri di monitoraggio secondo necessità

## Opzioni di Configurazione

### Cluster

Selezionare il cluster Kubernetes da monitorare. I cluster devono essere integrati con OneUptime tramite OpenTelemetry.

### Ambito delle Risorse

Scegliere il livello al quale monitorare le risorse:

| Ambito | Descrizione |
|-------|-------------|
| Cluster | Monitorare l'intero cluster |
| Namespace | Monitorare le risorse all'interno di un namespace specifico |
| Workload | Monitorare un deployment, statefulset, daemonset, job o cronjob specifico |
| Nodo | Monitorare un nodo specifico del cluster |
| Pod | Monitorare un pod specifico |

### Filtri delle Risorse

Restringere l'ambito con filtri opzionali:

| Filtro | Descrizione | Ambiti Applicabili |
|--------|-------------|-------------------|
| Namespace | Namespace Kubernetes | Namespace, Workload, Pod |
| Tipo Workload | deployment, statefulset, daemonset, job, cronjob | Workload |
| Nome Workload | Nome del workload | Workload |
| Nome Nodo | Nome del nodo | Nodo |
| Nome Pod | Nome del pod | Pod |

### Query Metriche

Configurare una o più query metriche da valutare. Ogni query specifica:

- **Nome metrica** — La metrica Kubernetes da interrogare
- **Aggregazione** — Come aggregare i valori della metrica
- **Filtri** — Filtraggio aggiuntivo basato sugli attributi

È anche possibile creare **formule** che combinano più query metriche usando espressioni matematiche.

### Finestra Temporale Mobile

Selezionare la finestra temporale per la valutazione delle metriche:

- Ultimi 1 Minuto
- Ultimi 5 Minuti
- Ultimi 10 Minuti
- Ultimi 15 Minuti
- Ultimi 30 Minuti
- Ultimi 60 Minuti

## Metriche Kubernetes Comuni

### Metriche Pod

| Metrica | Descrizione |
|--------|-------------|
| Utilizzo CPU Pod | Consumo CPU dei pod |
| Utilizzo Memoria Pod | Consumo memoria dei pod |
| Utilizzo Filesystem Pod | Utilizzo disco dei pod |
| Ricezione/Trasmissione Rete Pod | Traffico di rete |
| Fase Pod | Fase corrente del pod (Running, Pending, Failed, ecc.) |

### Metriche Nodo

| Metrica | Descrizione |
|--------|-------------|
| Utilizzo CPU Nodo | Utilizzo CPU per nodo |
| Utilizzo Memoria Nodo | Utilizzo memoria per nodo |
| Utilizzo Filesystem Nodo | Utilizzo disco per nodo |
| I/O Disco Nodo | Operazioni di lettura/scrittura |
| Condizione Pronto Nodo | Se il nodo è pronto |

### Metriche Container

| Metrica | Descrizione |
|--------|-------------|
| Riavvii Container | Numero di riavvii del container |
| Limiti CPU/Memoria Container | Limiti delle risorse |
| Richieste CPU/Memoria Container | Richieste delle risorse |
| Stato Pronto Container | Se i container sono pronti |

### Metriche Workload

| Metrica | Descrizione |
|--------|-------------|
| Repliche Disponibili/Non Disponibili Deployment | Conteggi delle repliche |
| Nodi Mal Pianificati DaemonSet | Problemi di scheduling |
| Repliche Pronte StatefulSet | Conteggio repliche pronte |
| Pod Attivi/Falliti/Completati Job | Stato del job |

## Criteri di Monitoraggio

### Tipi di Controllo Disponibili

| Tipo di Controllo | Descrizione |
|------------|-------------|
| Valore Metrica | Il valore della query metrica o formula configurata |

### Tipi di Aggregazione

| Aggregazione | Descrizione |
|-------------|-------------|
| Media | Valore medio nella finestra temporale |
| Somma | Somma di tutti i valori |
| Valore Massimo | Valore più alto nella finestra temporale |
| Valore Minimo | Valore più basso nella finestra temporale |
| Tutti i Valori | Tutti i valori devono soddisfare il criterio |
| Qualsiasi Valore | Almeno un valore deve soddisfare il criterio |

### Tipi di Filtro

- **Maggiore Di**, **Minore Di**, **Maggiore o Uguale a**, **Minore o Uguale a**, **Uguale a**, **Diverso da**

## Template di Avviso Predefiniti

OneUptime fornisce template per scenari comuni di monitoraggio Kubernetes:

| Template | Descrizione | Soglia |
|----------|-------------|-----------|
| Rilevamento CrashLoopBackOff | Conteggio riavvii container | > 5 riavvii |
| Pod Bloccato in Pending | Pod in fase Pending | > 0 pod |
| Nodo Non Pronto | Condizione di prontezza nodo | = 0 (non pronto) |
| Alta CPU Nodo | Utilizzo CPU nodo | > 90% |
| Alta Memoria Nodo | Utilizzo memoria nodo | > 85% |
| Mancata Corrispondenza Repliche Deployment | Repliche non disponibili | > 0 repliche |
| Fallimenti Job | Pod falliti in un job | > 0 fallimenti |
| etcd Senza Leader | Leader del cluster etcd mancante | = 0 (nessun leader) |
| Throttling Server API | Richieste API eliminate | > 0 richieste |
| Backlog Scheduler | Pod in attesa nello scheduler | > 0 pod |
| Alto Utilizzo Disco Nodo | Utilizzo filesystem nodo | > 90% |
| DaemonSet Non Disponibile | Nodi mal pianificati | > 0 nodi |

## Requisiti di Configurazione

Per usare il monitoraggio Kubernetes, è necessario installare l'agente Kubernetes di OneUptime nel proprio cluster. L'agente invia metriche, eventi e log dei pod del cluster a OneUptime tramite OTLP.

Vedere la guida [Installare l'Agente Kubernetes](/docs/monitor/kubernetes-agent) — include l'installazione con un singolo comando Helm e l'opzione `preset` per scegliere la configurazione giusta per il proprio cluster (standard, GKE Autopilot, EKS Fargate).
