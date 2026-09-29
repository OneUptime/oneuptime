# Osservabilità dei costi di Kubernetes

## Panoramica

OneUptime può mostrarti quanto costa davvero ogni workload Kubernetes — spesa per namespace, per controller e per pod, con la capacità inattiva e l'efficienza request-vs-utilizzo — accanto alle metriche, ai log e alle tracce che già raccogli con il [Kubernetes Agent](/docs/telemetry/kubernetes-agent).

Abilitarla richiede un solo comando:

```bash
helm upgrade oneuptime-agent oneuptime/kubernetes-agent \
  --namespace oneuptime-agent \
  --reuse-values \
  --set cost.enabled=true
```

È un'installazione completa. Il chart include il motore open source [OpenCost](https://opencost.io) (Apache-2.0, CNCF — il [cost-model](https://github.com/kubecost/cost-model) che alimenta anche Kubecost) più un Prometheus minimale e dedicato di cui ha bisogno per lo storico di utilizzo — due piccoli pod di idraulica invisibile. OpenCost prezza i tuoi nodi, volumi e load balancer a partire dai **prezzi di listino pubblici del tuo provider cloud, automaticamente e senza credenziali** (AWS, GCP, Azure); i cluster on-prem impostano invece un listino tariffario (qui sotto).

Entro circa un'ora (la prima finestra oraria chiusa), ottieni:

- Una **pagina Costs per cluster** (_Kubernetes → il tuo cluster → Costs_): andamento della spesa, spesa per namespace con suddivisione cpu/memoria/storage, spesa per workload, spesa inattiva ed efficienza.
- Una **pagina Costs a livello di progetto** (_Kubernetes → Costs_): la spesa di tutti i cluster del progetto.
- Un **modello di dashboard Kubernetes Cost** (_Dashboard → Create → Kubernetes Cost Dashboard_): andamenti del costo orario dei nodi, costi unitari di CPU/RAM, spesa per volumi persistenti e load balancer.
- Metriche di costo grezze (`node_total_hourly_cost`, `pv_hourly_cost`, ...) nell'**Esplora metriche**, utilizzabili in dashboard personalizzate e avvisi sulle metriche.

## Come funziona

Con `cost.enabled=true` il chart esegue quattro cose:

1. **OpenCost** (incluso) — osserva il cluster, individua i prezzi di listino del cloud e calcola allocazioni di costo pre-tariffate per workload.
2. **Un Prometheus minimale** (incluso) — OpenCost richiede un endpoint PromQL per lo storico di utilizzo e prezzi. Questo esiste solo per quello: una singola replica, 3 giorni di conservazione ed esattamente due target di scraping (cAdvisor tramite il node proxy dell'API-server, e OpenCost stesso — OpenCost emette le proprie metriche delle richieste di risorse in stile KSM, quindi kube-state-metrics non è coinvolto). Non viene mai esposto fuori dal cluster e i suoi dati non lo lasciano mai.
3. **Il poller di allocazione dei costi** (`cost.agent`) — interroga l'API Allocation di OpenCost una volta per ogni finestra oraria chiusa e invia tramite POST a OneUptime righe di costo per workload (cpu / ram / gpu / pv / rete / load balancer / inattivo, più l'efficienza). Le finestre vengono spedite esattamente una volta — il server salta le finestre che ha già ingerito, quindi i riavvii non possono conteggiare due volte la spesa.
4. **Uno scraping delle metriche di costo** (`cost.metrics`) — il collector OpenTelemetry dell'agent esegue lo scraping delle metriche Prometheus di OpenCost (limitate tramite allowlist alle serie di costo) attraverso la stessa pipeline OTLP del resto delle metriche del tuo cluster.

## Esegui già Kubecost o OpenCost?

Punta invece il chart al tuo motore esistente — in quel caso non viene incluso nulla:

```bash
helm upgrade oneuptime-agent oneuptime/kubernetes-agent \
  --namespace oneuptime-agent \
  --reuse-values \
  --set cost.enabled=true \
  --set cost.engine.url=http://kubecost-cost-analyzer.kubecost.svc.cluster.local:9090
```

| Motore   | URL di servizio tipico                                           |
| -------- | ---------------------------------------------------------------- |
| OpenCost | `http://opencost.opencost.svc.cluster.local:9003`                |
| Kubecost | `http://kubecost-cost-analyzer.kubecost.svc.cluster.local:9090`  |

Il percorso dell'API Allocation viene rilevato automaticamente (`/model/allocation` per Kubecost, `/allocation/compute` o `/allocation` per OpenCost). Imposta `cost.engine.allocationPath` solo per installazioni non standard.

## Prezzi on-prem / bare metal

I cluster i cui nodi non hanno un prezzo di listino cloud pubblico possono impostare un listino tariffario — OpenCost prezza allora ogni risorsa a partire da queste cifre. Tutti i valori sono in **USD per risorsa-ora**:

```yaml
cost:
  enabled: true
  opencost:
    customPricing:
      enabled: true
      cpuPerCoreHour: "0.031611"       # ~$23 per core-month
      ramPerGiBHour: "0.004237"        # ~$3 per GiB-month
      storagePerGBHour: "0.00005479452" # ~$0.04 per GB-month
      gpuPerHour: "0.95"
```

## Parametri utili

Tutti opzionali — consulta il `values.yaml` del chart per l'elenco completo:

```yaml
cost:
  agent:
    windowSeconds: 3600   # allocation window length (hourly = native)
    includeIdle: true     # ship the engine's __idle__ allocation
    currency: USD         # currency code shown in the UI (informational)
  prometheus:
    retention: 7d         # bundled TSDB history; right-sizing reads peaks back over days
    persistence:
      enabled: false      # set true for a small PVC; emptyDir otherwise
  metrics:
    enabled: true         # cost metrics for dashboards / Metric Explorer
    scrapeInterval: 60s
```

## Avvisi sui costi

Le metriche di costo raccolte tramite scraping sono normali metriche OneUptime, quindi puoi impostarci sopra avvisi sulle metriche come su qualsiasi altra — ad esempio avvisare quando la media di `node_total_hourly_cost` supera una soglia di budget, oppure quando `pv_hourly_cost` compare per una classe di volumi che non dovrebbe esistere in un cluster.

## Modello dei dati e conservazione

Le righe di allocazione sono archiviate in ClickHouse (una riga per cluster, finestra, namespace, controller, pod e container) e seguono la conservazione della telemetria del cluster: l'impostazione `retainTelemetryDataForDays` sulla risorsa del cluster Kubernetes, con ripiego sulla conservazione dei dati del progetto. La capacità inattiva e quella non allocata sono archiviate come righe normali sotto i namespace `__idle__` / `__unallocated__`, quindi sono interrogabili con gli stessi raggruppamenti della spesa dei workload.

## Risoluzione dei problemi

- **Le pagine Costs sono vuote** — controlla i log dell'agent dei costi: `kubectl logs -n <agent namespace> deploy/<release>-kubernetes-agent-cost`. Un `401` significa che la chiave di ingestione non è valida; `cost engine did not answer any known allocation path` significa che il motore non è ancora attivo (l'OpenCost incluso ha bisogno di qualche minuto dopo l'installazione per prezzare le sue prime finestre) oppure che `cost.engine.url` è errato.
- **L'OpenCost incluso non è pronto** — `kubectl logs -n <agent namespace> deploy/<release>-kubernetes-agent-opencost`. Registra quale provider cloud ha rilevato e se i dati di prezzo sono stati caricati.
- **Il modello di dashboard non mostra dati** — il modello legge le metriche di costo raccolte tramite scraping; conferma che `cost.metrics.enabled` sia `true`.
- **I numeri differiscono dall'interfaccia del motore stesso** — OneUptime include gli aggiustamenti di riconciliazione del motore in ogni componente di costo e spedisce intere finestre chiuse; la spesa parziale dell'ora corrente appare dopo la chiusura della finestra.
- **Il pod Prometheus si è riavviato** — con lo storage `emptyDir` predefinito un riavvio perde alcune ore di storico di utilizzo, quindi le allocazioni di quelle finestre potrebbero risultare più piccole. Imposta `cost.prometheus.persistence.enabled=true` se per te è importante.
