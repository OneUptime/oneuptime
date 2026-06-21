# Dimensionamento e pianificazione della capacità

Questa guida ti aiuta a dimensionare un'installazione self-hosted di OneUptime su Kubernetes (Helm). Copre i tre datastore da cui OneUptime dipende — **PostgreSQL**, **Redis** e **ClickHouse** — più il calcolo applicativo, e fornisce livelli iniziali che puoi regolare una volta ottenuti i numeri reali.

> **Leggi prima questo:** la chart Helm viene fornita con **nessuna richiesta o limite di CPU/memoria impostati** e piccoli volumi predefiniti da **25 Gi** per PostgreSQL e ClickHouse. Quei valori predefiniti esistono affinché la chart si installi e funzioni su qualsiasi cluster — **non** rappresentano un dimensionamento di produzione. Per qualsiasi cosa oltre una prova rapida, imposta esplicitamente le risorse e lo storage usando i numeri qui sotto.

Se invece stai eseguendo l'installazione su server singolo con Docker Compose, il dimensionamento è più semplice — vedi [Docker Compose](/docs/installation/docker-compose) (consigliato: 16 GB RAM, 8 core, 400 GB di disco).

## Cosa determina ciascun datastore

OneUptime richiede tre datastore in produzione. Scalano in base a input completamente diversi, quindi dimensionali in modo indipendente.

| Datastore | Cosa memorizza | Cosa ne determina la dimensione |
| --- | --- | --- |
| **ClickHouse** | Tutta la telemetria — log, metriche, tracce, eccezioni, profili | **Tasso di ingest × retention** della telemetria. Rappresenta circa il 95% del tuo storage ed è il costo dominante. |
| **PostgreSQL** | Configurazione e stato — monitor, incidenti, avvisi, utenti, team, progetti, workflow, pagine di stato, dashboard | **Numero di entità e cronologia**, non il volume di telemetria. Cresce lentamente. |
| **Redis** | Cache, code di lavoro e sessioni | **Profondità delle code e sessioni attive**. Vincolato alla memoria e modesto. Non è una fonte di verità. |

L'object storage (S3/MinIO) **non** è richiesto per il funzionamento di OneUptime. Viene usato solo facoltativamente per i **backup** dei database (tramite il plugin CloudNativePG Barman per PostgreSQL, o `clickhouse-backup` per ClickHouse). OneUptime non sposta la telemetria su livelli di object storage — vedi la sezione "La retention e come influisce sullo storage" più sotto.

## ClickHouse — il fattore dominante

Quasi tutto il tuo storage e una larga parte della tua RAM andranno a ClickHouse, perché ogni riga di log, punto metrico, span di traccia ed eccezione risiede lì.

### Formula dello storage

```
ClickHouse disk ≈ (daily raw telemetry GB ÷ compression) × retention days × replicas × 1.3 (headroom)
```

La compressione dipende dal segnale:

- **I log** si comprimono bene — all'incirca **5:1**.
- **Le metriche** si comprimono meno — all'incirca **2:1** — e l'elevata **cardinalità** delle label gonfia sia il disco sia la RAM più rapidamente del volume grezzo. Mantieni le label a bassa cardinalità.
- **Le tracce** si collocano nel mezzo, a seconda degli attributi degli span.

### Esempio pratico

Una flotta di **10 cluster**, ciascuno con ~10 nodi / ~100 pod a verbosità di livello INFO, produce all'incirca **50–150 GB di log grezzi per cluster in 30 giorni** (≈ 1.7–5 GB/giorno per cluster). Sull'intera flotta, aggiungendo metriche e tracce e dopo la compressione, prevedi all'incirca **5–15 GB/giorno di telemetria compressa**.

| Retention | Replica singola | 2 repliche + 30% di headroom |
| --- | --- | --- |
| 30 days | ~150–450 GB | **~0.4–1.2 TB** |
| 90 days | ~0.45–1.35 TB | **~1.2–3.5 TB** |

Lo storage scala **linearmente con la retention** — una finestra di 90 giorni costa circa 3× una finestra di 30 giorni.

### RAM e tipo di disco

- **Usa NVMe/SSD.** La telemetria è ad alta intensità di scrittura con letture di aggregazione a raffica; ClickHouse su disco meccanico farà fatica.
- **Dai a ClickHouse RAM abbondante.** Le query di aggregazione sono intensive in termini di memoria. Come regola generale, dimensiona la RAM a una frazione significativa (25–50%) del tuo dataset compresso *caldo* (interrogato di recente), con un limite pratico minimo di 16 GB per qualsiasi flotta di produzione reale.
- **Controlla la cardinalità delle metriche.** È la singola leva più importante sia per la RAM sia per il disco di ClickHouse. Imponi convenzioni di label a bassa cardinalità al livello di raccolta e monitora il numero di serie attive.

## PostgreSQL — configurazione e stato

PostgreSQL memorizza la tua configurazione e lo stato operativo, non la telemetria, quindi cresce lentamente e rimane piccolo rispetto a ClickHouse. Anche le installazioni di grandi dimensioni sono tipicamente nell'ordine di decine di GB. Il volume predefinito da **25 Gi** va bene per le installazioni piccole; pianifica 50–100 GB per quelle più grandi con headroom per la cronologia di incidenti/avvisi.

Se esegui molte repliche di applicazione, worker e probe, il numero di connessioni al database può diventare il collo di bottiglia prima dello storage. La chart Helm di OneUptime include un connection pooler **PgBouncer** facoltativo (`pgbouncer.enabled`) proprio per questo — abilitalo per le installazioni con un numero elevato di repliche.

## Redis — cache, code e sessioni

Redis è usato come cache, come coda di lavoro e come store di sessioni. È **vincolato alla memoria** e la persistenza è **disabilitata per impostazione predefinita** (qui Redis non è una fonte di verità — può essere ricostruito). Dimensionalo in base alla profondità delle code attesa e alle sessioni concorrenti; 2–8 GB di memoria coprono la maggior parte delle installazioni. Nota che la policy di eviction predefinita è `noeviction`, quindi se le code si accumulano sotto sovraccarico prolungato, monitora la memoria di Redis.

## Calcolo applicativo

Oltre ai datastore, dimensiona i carichi di lavoro stateless (ingress, web/API, worker e probe). Tutti predefiniti a **1 replica** senza limiti di risorse — impostali esplicitamente. La chart include **KEDA** in modo che worker e probe possano scalare automaticamente in base alla profondità delle code; abilitalo per i carichi variabili. I worker scalano con il volume di elaborazione di telemetria/ingest, e le probe scalano con il numero di monitor attivi.

## Livelli iniziali

Scegli il livello più vicino al tuo ambiente come punto di partenza, poi osserva l'utilizzo effettivo (`kubectl top pods`, crescita del disco di ClickHouse/Postgres) e regola.

- **Piccolo / PoC** — 1–3 cluster, ≤30 nodi, ≤5 GB/giorno di telemetria grezza, retention di 30 giorni.
- **Medio / Flotta di produzione** — ~10 cluster, ~100 nodi, 10–30 GB/giorno di telemetria grezza, retention di 30–90 giorni.
- **Grande / Multi-flotta** — 50+ cluster, 500+ nodi, 100+ GB/giorno di telemetria grezza, retention di 90 giorni.

| | Piccolo / PoC | Medio / Flotta di produzione | Grande / Multi-flotta |
| --- | --- | --- | --- |
| **ClickHouse** | 4 vCPU / 16 GB / 200 GB NVMe | 8 vCPU / 32 GB / 1–3 TB NVMe | 16+ vCPU / 64–128 GB / 5–15 TB NVMe, **sharded** |
| **PostgreSQL** | 2 vCPU / 4 GB / 50 GB SSD | 4 vCPU / 8 GB / 100 GB SSD | 8 vCPU / 16–32 GB / 250 GB SSD (+ PgBouncer) |
| **Redis** | 1 vCPU / 2 GB | 2 vCPU / 4 GB | 4 vCPU / 8–16 GB |
| **Retention assunta** | 30 days | 30–90 days | 90 days |

Questi dimensionano il **backend** di OneUptime. I collector di OneUptime che girano su ogni cluster monitorato sono dimensionati separatamente — vedi i livelli di dimensionamento dell'[Agente Kubernetes](/docs/telemetry/kubernetes-agent).

## Alta disponibilità

I datastore integrati nella chart girano come **istanze singole** per impostazione predefinita. Per l'HA in produzione:

- **PostgreSQL** — abilita l'operatore [CloudNativePG](https://cloudnative-pg.io) incluso (`postgresOperator.cnpg.enabled`) con **3 istanze** (1 primaria + 2 hot standby) per il failover automatico.
- **ClickHouse** — abilita l'operatore [Altinity](https://github.com/Altinity/clickhouse-operator) incluso (`clickhouseOperator.altinity.enabled`) con **≥2 repliche per shard** e **3 nodi ClickHouse Keeper** per il quorum. Aggiungi shard una volta che il disco o la RAM di un singolo nodo diventano il limite.
- **Redis** — la chart non ha replica interna. Per l'HA, punta OneUptime a un **Redis gestito esterno** (o a un'installazione Sentinel/cluster).

## La retention e come influisce sullo storage

La retention della telemetria è applicata come un **TTL di ClickHouse configurato in giorni**, impostato **per progetto** e affinabile **per segnale** (log, metriche, tracce, profili) e per bucket (ad esempio per gravità del log). Il valore predefinito hardcoded è 15 giorni.

Poiché la retention moltiplica direttamente lo storage di ClickHouse, decidila prima di dimensionare il disco. OneUptime **non** archivia né sposta automaticamente la vecchia telemetria su livelli di object storage — per la retention di conformità pluriennale, estendi la finestra di retention e dimensiona lo storage di ClickHouse di conseguenza (oppure esporta verso un archivio esterno a tua scelta).

## Misura prima di impegnarti

Il volume di telemetria varia enormemente in base alla verbosità dei log dell'applicazione, al numero di namespace, all'intervallo di scraping e al fatto che il logging DEBUG sia abilitato da qualche parte. Tratta i livelli sopra come punti di partenza: **strumenta il tuo ambiente per almeno quattro settimane**, misura i GB/giorno effettivi per segnale, poi dimensiona retention e storage a partire dai dati reali.

## Correlati

- [Docker Compose](/docs/installation/docker-compose) — dimensionamento su server singolo
- [Architettura Self-Hosted](/docs/self-hosted/architecture) — come si incastrano i componenti
- [Agente Kubernetes](/docs/telemetry/kubernetes-agent) — dimensionamento del collector (data-plane)
- [Chart Helm su Artifact Hub](https://artifacthub.io/packages/helm/oneuptime/oneuptime)
