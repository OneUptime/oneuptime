# Aggiornamento di OneUptime

Questa guida descrive come aggiornare in modo sicuro la tua installazione self-hosted di OneUptime.

## Indicazioni Generali

- Aggiorna passo dopo passo tra le versioni principali (ad esempio, da 6 → 7 → 8). Non saltare le versioni principali.
- Puoi saltare le versioni minori/patch (ad esempio, da 8.1 → 8.4) purché tu segua le note di rilascio.
- Esegui sempre dei backup prima di aggiornare e verifica di poterli ripristinare.

## Aggiornamento da OneUptime 10 → 11

OneUptime 11 ricostruisce lo storage della telemetria su ClickHouse. Questa
pagina spiega cosa cambia, chi deve intervenire e — per le installazioni che
vogliono riportare in avanti la telemetria storica — tutte le query
necessarie per farlo.

### Cosa cambia nella v11

La telemetria (log, trace, metriche, eccezioni, profili, log dei monitor,
audit log) viene spostata in nuove tabelle ClickHouse con partizionamento
temporale, codec di compressione per colonna e le nuove colonne del modello
a entità:

| Tabella precedente    | Nuova tabella         |
| --------------------- | --------------------- |
| `LogItemV2`           | `LogItemV3`           |
| `MetricItemV2`        | `MetricItemV3`        |
| `SpanItemV2`          | `SpanItemV3`          |
| `ExceptionItemV2`     | `ExceptionItemV3`     |
| `ProfileItemV2`       | `ProfileItemV3`       |
| `ProfileSampleItemV2` | `ProfileSampleItemV3` |
| `MonitorLogV2`        | `MonitorLogV3`        |
| `AuditLogV1`          | `AuditLogV2`          |

Due colonne vengono rinominate in tutte le tabelle di telemetria:
`serviceId` → `primaryEntityId` e `serviceType` → `primaryEntityType`. Si
tratta di una rinomina definitiva — **se interroghi direttamente l'API
analytics di OneUptime con filtri su `serviceId`/`serviceType`, aggiornali
ai nuovi nomi.** Dashboard, monitor e alert all'interno di OneUptime
vengono migrati automaticamente.

Il passaggio è **solo in avanti (forward-only)**: le nuove tabelle partono
vuote, tutta la telemetria ingerita dopo l'aggiornamento vi confluisce
immediatamente e lo storico si ricostruisce naturalmente col passare del
tempo. Le vecchie tabelle vengono **eliminate automaticamente** durante
l'aggiornamento per recuperarne lo spazio su disco — se vuoi conservare la
possibilità di riportare in avanti lo storico, rinominale **prima** di
aggiornare (Passo 0 più sotto).

> **Sei già su 11.0.0 o 11.0.1?** Quelle release mantenevano le vecchie
> tabelle (si svuotavano tramite TTL e la copia poteva essere eseguita
> "in qualsiasi momento dopo l'aggiornamento"). Qualsiasi aggiornamento
> successivo **le elimina all'avvio**. Se vuoi ancora la copia dello
> storico e non l'hai ancora eseguita, esegui il Passo 0 più sotto prima
> di applicare l'aggiornamento.

### Chi deve intervenire

- **Installazioni nuove:** nulla da fare.
- **Aggiornamenti che non hanno bisogno della telemetria precedente
  all'aggiornamento nell'interfaccia:** nulla da fare. Le pagine di
  telemetria mostrano semplicemente i dati dal momento dell'aggiornamento
  in poi; le vecchie tabelle vengono eliminate durante l'aggiornamento.
- **Aggiornamenti che vogliono rendere visibile la telemetria precedente
  all'aggiornamento:** rinomina le vecchie tabelle **prima**
  dell'aggiornamento (Passo 0 più sotto), poi esegui la copia manuale in
  qualsiasi momento dopo di esso.

Come sempre: aggiorna le versioni principali passo dopo passo (10 → 11,
senza saltare) ed esegui i backup di Postgres e ClickHouse prima di
aggiornare.

### Opzionale: riportare in avanti lo storico della telemetria

Esegui queste operazioni **dopo che l'aggiornamento si è avviato
completamente** (le nuove tabelle e le loro materialized view devono
esistere). Connettiti direttamente sull'host ClickHouse — il protocollo
nativo non ha timeout HTTP, quindi istruzioni che durano più ore non sono
un problema:

```bash
clickhouse-client --database oneuptime
```

Da sapere prima di iniziare:

- La copia può essere eseguita in sicurezza mentre OneUptime è in
  funzione. La nuova telemetria scrive nelle nuove tabelle in modo
  indipendente; lo storico copiato si inserisce alle sue spalle.
- Su grandi volumi (centinaia di GB) prevedi diverse ore.
- Ogni istruzione riportata di seguito include un
  `insert_deduplication_token` e le nuove tabelle sono dotate di una
  finestra di deduplicazione — quindi **rieseguire un'istruzione fallita a
  metà è sicuro** (i blocchi già inseriti vengono saltati, anche nei
  rollup delle metriche), purché la riesecuzione avvenga in tempi
  ragionevoli. Con un'ingestione live intensa la finestra (gli ultimi
  10.000 blocchi di insert per tabella) finisce per espellere i token più
  vecchi.
- La copia delle metriche ricostruisce automaticamente anche i rollup
  pre-aggregati delle dashboard (ogni riga copiata rialimenta le
  materialized view dei rollup) — questo rende la copia delle metriche più
  lenta delle altre; eseguila per ultima.

#### Passo 1 — elencare le partizioni di origine

Ogni vecchia tabella ha al massimo 16 partizioni. Per ciascuna tabella di
origine:

```sql
SELECT DISTINCT _partition_id FROM LogItemV2 ORDER BY _partition_id;
```

#### Passo 2 — generare l'istruzione di copia

Gli insiemi di colonne possono differire leggermente tra installazioni
(deployment più datati potrebbero non avere le colonne aggiunte di
recente), quindi genera l'istruzione a partire dal tuo schema reale invece
di copiarne una fissa. Imposta `src` e `dst` nella clausola `WITH` su una
delle coppie di tabelle della tabella sopra ed esegui:

```sql
WITH 'LogItemV2' AS src, 'LogItemV3' AS dst
SELECT concat(
  'INSERT INTO ', dst, ' (`', arrayStringConcat(groupArray(name), '`, `'), '`)',
  ' SELECT ', arrayStringConcat(groupArray(selectExpr), ', '),
  ' FROM ', src,
  ' WHERE _partition_id = ''{PARTITION}''',
  ' ORDER BY ', (SELECT sorting_key FROM system.tables WHERE database = currentDatabase() AND name = dst), ', _id',
  ' SETTINGS max_execution_time = 0, max_partitions_per_insert_block = 0, insert_deduplication_token = ''v3copy:', dst, ':{PARTITION}'', deduplicate_blocks_in_dependent_materialized_views = 1'
) AS copy_sql
FROM (
  SELECT name,
    multiIf(name = 'primaryEntityId', 'serviceId', name = 'primaryEntityType', 'serviceType', name) AS srcName,
    if(srcName = name, concat('`', name, '`'), concat('`', srcName, '` AS `', name, '`')) AS selectExpr,
    position
  FROM system.columns
  WHERE database = currentDatabase() AND table = dst
    AND srcName IN (SELECT name FROM system.columns WHERE database = currentDatabase() AND table = src)
  ORDER BY position
);
```

L'istruzione generata copia solo le colonne condivise da entrambe le
tabelle (le nuove colonne assumono i loro valori predefiniti), rinomina al
volo `serviceId`/`serviceType`, ordina le righe in modo deterministico così
che un nuovo tentativo produca blocchi identici e deduplicabili, e rimuove
i limiti sul tempo di esecuzione e sul numero di partizioni di cui
un'istruzione di queste dimensioni ha bisogno.

#### Passo 3 — eseguirla, una partizione alla volta

Prendi l'istruzione generata e sostituisci `{PARTITION}` (compare due
volte — nella clausola `WHERE` e nel token) con ciascun id di partizione
ottenuto al Passo 1. Esegui le istruzioni una alla volta, poi ripeti i
Passi 1–3 per ogni coppia di tabelle.

Se un'istruzione fallisce a metà, riesegui tempestivamente la **stessa**
istruzione — i blocchi già scritti vengono deduplicati. Se la riesecuzione
avviene molto più tardi, confronta prima i conteggi delle righe (Passo 5).

#### Passo 4 (opzionale) — storico dei rollup delle metriche per host

Le righe grezze delle metriche copiate ricostruiscono automaticamente i
rollup a livello di servizio, ma non il rollup **per host** (le vecchie
righe non hanno una chiave di entità host). L'aggiornamento lascia
intenzionalmente in posizione la vecchia tabella di rollup per host, così
da poterla riportare in avanti calcolando la nuova chiave a partire
dall'hostname:

```sql
INSERT INTO MetricItemAggMV1mByHostV2 (projectId, name, hostEntityKey, bucketTime, valueSumState, valueCountState, valueMinState, valueMaxState, retentionDate)
SELECT
  projectId,
  name,
  substring(lower(hex(SHA256(concat(projectId, '|host|host.name=', lower(trimBoth(hostIdentifier)))))), 1, 16) AS hostEntityKey,
  bucketTime,
  valueSumState,
  valueCountState,
  valueMinState,
  valueMaxState,
  retentionDate
FROM MetricItemAggMV1mByHost
SETTINGS max_execution_time = 0, insert_deduplication_token = 'v3copy:MetricItemAggMV1mByHostV2:all';
```

#### Passo 5 — verifica

Confronta i totali per ciascuna coppia di tabelle (la nuova tabella
contiene anche le righe successive all'aggiornamento, quindi dovrebbe
essere maggiore o uguale alla vecchia):

```sql
SELECT
  (SELECT count() FROM LogItemV2) AS old_rows,
  (SELECT count() FROM LogItemV3) AS new_rows;
```

#### Passo 6 (opzionale) — recuperare spazio su disco in anticipo

Le vecchie tabelle si svuotano da sole tramite TTL, ma una volta
soddisfatto della copia puoi eliminarle immediatamente:

```sql
DROP TABLE IF EXISTS LogItemV2;
DROP TABLE IF EXISTS MetricItemV2;
DROP TABLE IF EXISTS SpanItemV2;
DROP TABLE IF EXISTS ExceptionItemV2;
DROP TABLE IF EXISTS ProfileItemV2;
DROP TABLE IF EXISTS ProfileSampleItemV2;
DROP TABLE IF EXISTS MonitorLogV2;
DROP TABLE IF EXISTS AuditLogV1;
DROP TABLE IF EXISTS MetricItemAggMV1mByHost;
```

> Suggerimento: come per ogni aggiornamento di versione principale, testa
> prima in un ambiente di staging e conferma che la telemetria stia
> confluendo nelle nuove tabelle prima di fare affidamento sulla copia in
> produzione.



## Aggiornamento da OneUptime 9 → 10

Nessuna modifica che richieda un intervento manuale. Segui semplicemente la procedura di aggiornamento standard.

## Aggiornamento da OneUptime 8 → 9

Il chart Helm non provvede più a una risorsa Kubernetes Ingress. OneUptime include un container ingress gateway che gestisce già la terminazione TLS, i domini delle pagine di stato e il routing del traffico per la piattaforma, quindi un ingress controller del cluster non è più necessario.

- Rimuovi qualsiasi override di `oneuptimeIngress` dai tuoi file `values.yaml` personalizzati prima dell'aggiornamento. Quelle chiavi vengono ora ignorate e causeranno errori di validazione se lasciate.
- Assicurati che `nginx.service.type` rispecchi come vuoi esporre l'ingress gateway incluso (ad esempio `LoadBalancer`, `NodePort`, o `ClusterIP` con un load balancer esterno).
- Verifica che tutti i record DNS per le pagine di stato o gli host principali puntino ancora al Service o al load balancer che si trova davanti all'ingress gateway di OneUptime.
- Dopo l'aggiornamento, conferma che i certificati TLS continuino a rinnovarsi tramite il gateway integrato e che i domini delle pagine di stato si risolvano correttamente.


## Aggiornamento da OneUptime 7 → 8

Se stai eseguendo su Kubernetes, ci sono importanti cambiamenti che causano interruzioni:

- Non usiamo più i chart Bitnami per Postgres, Redis e ClickHouse a causa delle [Modifiche alla Licenza Bitnami](https://github.com/bitnami/charts/issues/35164)
- Queste modifiche non sono retrocompatibili. Devi seguire la nuova struttura nel `values.yaml` del chart Helm.
- Esegui il backup dei tuoi dati (Postgres, ClickHouse e tutti i volumi persistenti) prima dell'aggiornamento.


> Suggerimento: Testa prima l'aggiornamento in un ambiente di staging. Conferma che i tuoi carichi di lavoro siano integri e i dati intatti prima di aggiornare la produzione.
