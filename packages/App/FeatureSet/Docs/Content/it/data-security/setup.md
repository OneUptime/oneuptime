# Configurare Sicurezza dei dati

Sicurezza dei dati legge solo ciò che le permetti. Ogni connessione cloud viene letta a uno di tre livelli, un database che gestisci viene letto con una stringa di connessione che le fornisci, e la telemetria non richiede nulla. Questa pagina spiega cosa permette di leggere a OneUptime ogni scelta, i permessi esatti che concede e cosa conserva OneUptime di ciò che legge.

:::cards
- [Scegli un livello](#scegliere-un-livello-per-ogni-connessione): Disattivato, Solo configurazione, oppure Configurazione e campioni di contenuto.
- [Cosa concede ogni livello](#cosa-concede-ogni-livello): Le azioni AWS, e i ruoli Azure e Google Cloud.
- [Scansiona un database che gestisci](#scansionare-un-database-che-gestisci): Una stringa di connessione di sola lettura, o una sonda nella tua rete.
- [Cosa conserva OneUptime](#cosa-conserva-oneuptime): Conteggi, posizioni e campioni mascherati, mai un valore.
- [Lascia che Sicurezza dei dati chiuda un'esposizione](#lasciare-che-sicurezza-dei-dati-chiuda-unesposizione): L'unica scrittura che si può concedere a una connessione, disattivata finché non la attivi.
:::

## Scegliere un livello per ogni connessione

| Livello | Nel modulo | Cosa legge OneUptime |
| --- | --- | --- |
| Disattivato | **Disattivato** | Né la configurazione né il contenuto di alcun archivio. Sicurezza dei dati elenca comunque gli archivi che il tuo inventario cloud conosce, con ciò che l'inventario dice di loro: se un database RDS è cifrato, pubblico, protetto dall'eliminazione e sottoposto a backup, e se una tabella DynamoDB può essere ripristinata a un punto nel tempo. |
| Configurazione | **Solo configurazione** | Come è configurato ogni archivio dati: chi può raggiungerlo, e come è cifrato, sottoposto a backup, versionato, registrato nei log, replicato e taggato. Mai i dati, e mai un segreto. |
| Contenuto | **Configurazione e campioni di contenuto** | Tutto questo, più campioni di ciò che contengono i bucket S3, gli account di archiviazione Azure, i bucket Cloud Storage e i dataset BigQuery. |

Ogni connessione parte da **Disattivato**. [Collegare un account cloud](/docs/telemetry/cloud-accounts#sicurezza-dei-dati) mostra parola per parola il comando che ogni livello esegue su ogni cloud. Per cambiare il livello di una connessione:

:::steps
### Apri la connessione

Vai su **Cloud → Collega**. Scegli **Modifica** sulla connessione, oppure collega un nuovo account.

### Scegli il livello

In **Altri campi**, imposta **Sicurezza dei dati** sul livello che vuoi.

### Esegui di nuovo il comando

Il comando mostrato dal modulo cambia con il livello. Eseguilo nella shell del tuo cloud, come hai fatto al collegamento: concede ciò che serve al nuovo livello, e niente di più. Poi seleziona **Salva modifiche**, oppure **Collega** per una nuova connessione.
:::

Le letture al nuovo livello iniziano entro un'ora, e **Controlla ora** o **Scansiona ora** su un archivio ne avvia una subito. OneUptime legge solo ciò che indica il livello della connessione, qualunque cosa il ruolo consenta ancora: abbassa il livello, e le letture si fermano subito. Per togliere anche l'accesso, esegui il nuovo comando: su AWS sostituisce la policy con quella del livello inferiore. **Disattivato** non aggiunge nulla, quindi lascia ciò che ha concesso un comando precedente. Rimuovilo tu: su AWS con `aws iam delete-role-policy --role-name <your role> --policy-name OneUptimeDataSecurity`, e su Azure e Google Cloud rimuovendo i ruoli aggiunti dal livello del contenuto.

## Cosa concede ogni livello

### Amazon Web Services

Il livello della configurazione aggiunge al ruolo una seconda policy inline, `OneUptimeDataSecurity`, accanto a quella di sola lettura. Contiene esattamente le azioni di lettura che chiama il lettore di sicurezza dei dati. Ognuna legge un'impostazione; nessuna legge dati o scrive qualcosa:

| A cosa servono a OneUptime | Azioni |
| --- | --- |
| Elencare i bucket, e leggere chi può raggiungere ciascuno e come è cifrato, versionato, registrato nei log, copiato e taggato | `s3:ListAllMyBuckets`, `s3:GetBucketLocation`, `s3:GetBucketPolicyStatus`, `s3:GetBucketPublicAccessBlock`, `s3:GetAccountPublicAccessBlock`, `s3:GetBucketAcl`, `s3:GetBucketPolicy`, `s3:GetEncryptionConfiguration`, `s3:GetBucketVersioning`, `s3:GetBucketLogging`, `s3:GetBucketOwnershipControls`, `s3:GetReplicationConfiguration`, `s3:GetBucketTagging` |
| Leggere come si raggiungono i database, come sono cifrati e sottoposti a backup, e con chi sono condivisi i loro snapshot manuali | `rds:DescribeDBInstances`, `rds:DescribeDBClusters`, `rds:DescribeDBSnapshots`, `rds:DescribeDBSnapshotAttributes`, `rds:DescribeDBClusterSnapshots`, `rds:DescribeDBClusterSnapshotAttributes`, `dynamodb:ListTables`, `dynamodb:DescribeTable`, `dynamodb:DescribeContinuousBackups`, `redshift:DescribeClusters`, `redshift:DescribeLoggingStatus` |
| Leggere come sono configurati i domini di ricerca, le cache e i file system | `es:ListDomainNames`, `es:DescribeDomains`, `elasticache:DescribeReplicationGroups`, `elasticfilesystem:DescribeFileSystems` |
| Distinguere le chiavi proprie di AWS (alias/aws/...) dalle chiavi che gestisci tu | `kms:ListAliases` |

Il livello del contenuto aggiunge tre azioni alla stessa policy, ognuna sulle proprie risorse:

| Azione | Consentita su | A cosa serve |
| --- | --- | --- |
| `s3:ListBucket` | `arn:aws:s3:::*` | Elencare i nomi degli oggetti di un bucket |
| `s3:GetObject` | `arn:aws:s3:::*/*` | Leggere i primi byte di un oggetto campionato |
| `kms:Decrypt` | `*`, solo quando `kms:ViaService` è `s3.*.amazonaws.com` | Leggere un oggetto cifrato con una chiave KMS, solo tramite S3: mai una decifratura diretta di qualcos'altro che la chiave protegge |

Con una **Chiave di accesso** invece di un ruolo, la policy va su un gruppo, `OneUptimeDataSecurity`, a cui viene aggiunto l'utente della chiave: IAM limita le policy inline proprie di un utente a 2.048 caratteri in tutto, e la policy di sola lettura ne occupa la maggior parte. Una connessione che legge un'intera AWS Organization mette la stessa policy nel ruolo di ogni account.

:::details L'intera policy al livello del contenuto
```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "s3:ListAllMyBuckets",
        "s3:GetBucketLocation",
        "s3:GetBucketPolicyStatus",
        "s3:GetBucketPublicAccessBlock",
        "s3:GetAccountPublicAccessBlock",
        "s3:GetBucketAcl",
        "s3:GetBucketPolicy",
        "s3:GetEncryptionConfiguration",
        "s3:GetBucketVersioning",
        "s3:GetBucketLogging",
        "s3:GetBucketOwnershipControls",
        "s3:GetReplicationConfiguration",
        "s3:GetBucketTagging",
        "rds:DescribeDBInstances",
        "rds:DescribeDBClusters",
        "rds:DescribeDBSnapshots",
        "rds:DescribeDBSnapshotAttributes",
        "rds:DescribeDBClusterSnapshots",
        "rds:DescribeDBClusterSnapshotAttributes",
        "dynamodb:ListTables",
        "dynamodb:DescribeTable",
        "dynamodb:DescribeContinuousBackups",
        "redshift:DescribeClusters",
        "redshift:DescribeLoggingStatus",
        "es:ListDomainNames",
        "es:DescribeDomains",
        "elasticache:DescribeReplicationGroups",
        "elasticfilesystem:DescribeFileSystems",
        "kms:ListAliases"
      ],
      "Resource": "*"
    },
    {
      "Effect": "Allow",
      "Action": [
        "s3:ListBucket"
      ],
      "Resource": "arn:aws:s3:::*"
    },
    {
      "Effect": "Allow",
      "Action": [
        "s3:GetObject"
      ],
      "Resource": "arn:aws:s3:::*/*"
    },
    {
      "Effect": "Allow",
      "Action": [
        "kms:Decrypt"
      ],
      "Resource": "*",
      "Condition": {
        "StringLike": {
          "kms:ViaService": "s3.*.amazonaws.com"
        }
      }
    }
  ]
}
```
:::

### Microsoft Azure

Il livello della configurazione non aggiunge nulla: il ruolo **Monitoring Reader** della connessione legge già la configurazione di ogni risorsa tramite Azure Resource Manager. Il livello del contenuto aggiunge il ruolo integrato **Storage Blob Data Reader**, sullo stesso ambito della connessione: la sottoscrizione, o il gruppo di gestione radice del tenant.

### Google Cloud

Il livello della configurazione non aggiunge nulla: il ruolo **Cloud Asset Viewer** della connessione legge già la configurazione e la policy IAM di ogni risorsa. Il livello del contenuto aggiunge due ruoli, `roles/storage.objectViewer` e `roles/bigquery.dataViewer`, sul progetto o sull'organizzazione, e attiva la BigQuery API, `bigquery.googleapis.com`.

## Lasciare che Sicurezza dei dati chiuda un'esposizione

Leggere è tutto ciò che fa una connessione finché non scegli diversamente. **Risposta di sicurezza dei dati**, in **Altri campi** accanto a **Sicurezza dei dati**, permette anche a Sicurezza dei dati di bloccare l'accesso pubblico di un archivio e di interrompere la condivisione dei suoi snapshot: dal problema dell'archivio, con **Correggi da qui** (vedi [Controlli e problemi di Sicurezza dei dati](/docs/data-security/checks-and-issues#correggi-da-qui)), e dai playbook di Security Operations. Resta **Disattivato** finché non scegli **Blocca l'accesso pubblico e la condivisione**, e il comando che il modulo mostra allora concede un'unica scrittura limitata, a sé stante:

| Cloud | Cosa aggiunge il comando | Cosa può fare |
| --- | --- | --- |
| AWS | Una terza policy inline, `OneUptimeDataSecurityResponse` | `s3:GetBucketPublicAccessBlock`, `s3:PutBucketPublicAccessBlock`, `rds:DescribeDBSnapshotAttributes`, `rds:DescribeDBClusterSnapshotAttributes`, `rds:ModifyDBSnapshotAttribute` e `rds:ModifyDBClusterSnapshotAttribute`: il Block Public Access di un bucket, e con chi è condiviso uno snapshot manuale |
| Azure | Un ruolo personalizzato, `OneUptime Data Security Response`, sull'ambito della connessione | `Microsoft.Storage/storageAccounts/read` e `Microsoft.Storage/storageAccounts/write`: le impostazioni di un account di archiviazione, come l'accesso anonimo ai blob, mai le sue chiavi |
| Google Cloud | Un ruolo personalizzato, `oneuptimeDataSecurityResponse` | `storage.buckets.get` e `storage.buckets.update`: le impostazioni di un bucket, come la prevenzione dell'accesso pubblico |

Nulla di ciò che concede legge dati, elimina qualcosa o cambia chi può accedere. Reimpostala su **Disattivato** e Sicurezza dei dati smette subito di usarla. Per togliere anche l'accesso su AWS, elimina la policy con `aws iam delete-role-policy --role-name <your role> --policy-name OneUptimeDataSecurityResponse`.

## Perché i campioni di contenuto sono facoltativi

Il livello della configurazione trova ciò che è esposto: un bucket pubblico, un database aperto a Internet, cifratura, backup o log di accesso mancanti. Non può dire cosa contiene un archivio, quindi un archivio in cui non è stato trovato nulla conta come Pubblico, la sensibilità più bassa, e i suoi problemi sono gravi quanto lo sarebbero per dati pubblici. Un bucket pubblico di immagini del sito web non è un'emergenza; un bucket pubblico di numeri di carta sì.

I campioni di contenuto distinguono i due casi. Impostano la sensibilità di ogni archivio in base a ciò che contiene, così lo stesso problema è Critico sui numeri di carta e Basso sulle immagini. Trovano anche ciò che solo il contenuto mostra: segreti, codici di sicurezza delle carte, password conservate così come sono state digitate e copie di dati di produzione in un archivio di test.

Quindi l'ordine che segue la maggior parte dei team è: il livello della configurazione ovunque, poi i campioni di contenuto dove ti serve sapere cosa contiene un archivio. La scansione del contenuto si può anche disattivare per un solo archivio, con **Scansiona contenuto** nelle **Impostazioni** dell'archivio, o per l'intero progetto.

## Cosa legge una scansione del contenuto

Una scansione legge un po' di un archivio, entro i limiti del progetto, e si ferma dopo 8 minuti, qualunque cosa resti. La successiva riprende da lì: salta un oggetto che non è cambiato da quando è stato letto, a meno che ciò non sia avvenuto 7 o più giorni fa.

- **I bucket e i container** vengono campionati per tipo, non per numero. Prima vengono elencati i nomi degli oggetti, al massimo dieci volte quanti la scansione può leggerne e mai più di 200.000. Ogni nome diventa il suo pattern, con date, UUID, lunghe sequenze esadecimali e numeri trasformati in `*`, così `exports/2026-10-27/users-0001.csv` diventa `exports/*/users-*.csv`. Vengono letti gli oggetti più recenti di ogni pattern, uno per ciascuno prima di un secondo di qualsiasi, e al massimo 5 di uno stesso pattern. Ogni oggetto viene letto dall'inizio: al massimo **Byte per oggetto** di ciascuno, e **Byte per scansione** in tutto. Una scansione campiona al massimo 10 container di un account di archiviazione Azure.
- **I file vengono letti per quello che sono.** CSV e TSV per colonna, JSON e JSON lines per percorso, `.env`, `.ini`, `.properties`, TOML e YAML per chiave, XML e HTML come testo, i file Word, Excel e PowerPoint per il loro testo e le loro celle, e qualsiasi altra cosa come testo libero. Un file gzip viene prima decompresso. Immagini, Parquet, Avro, PDF e altri formati binari non vengono letti, e la scansione lo segnala.
- **I dataset e i database** vengono letti tabella per tabella: al massimo **Tabelle per scansione** tabelle, e **Righe per tabella** righe di ciascuna.

Ogni scansione tiene traccia di ciò che ha letto, per nome: gli oggetti, le tabelle o i servizi, mai il loro contenuto. Ciò che non ha potuto leggere - una richiesta rifiutata dal cloud, la scadenza, il budget di byte - è un'avvertenza sulla scansione, e la scansione viene contrassegnata come **Riuscito in parte**.

## Scansionare un database che gestisci

Sicurezza dei dati campiona i database PostgreSQL e MySQL, in uno di due modi. Un database monitorato dal prodotto Database, o uno con cui parlano i tuoi servizi sulla mappa dei servizi, è già un archivio. Un database che nessuna scansione trova, aggiungilo tu come archivio.

- **Dai worker di OneUptime.** Nelle **Impostazioni** dell'archivio, imposta **Stringa di connessione** su una che possa solo leggere, come `postgresql://reader:password@db.internal:5432/app`. Viene cifrata a riposo e mai restituita dall'API. Assegnale un utente del database che possa leggere e nient'altro.
- **Da una sonda nella tua rete.** Scegli la sonda in **Scansiona dalla sonda**, e inserisci in **Variabile di connessione della sonda** il nome della variabile d'ambiente su quella sonda che contiene la stringa di connessione. La sonda legge il database dall'interno della tua rete e rimanda solo ciò che ha trovato: la stringa di connessione non raggiunge mai OneUptime. Vedi [Sonde personalizzate](/docs/probe/custom-probe) per eseguire una sonda.

## Cosa conserva OneUptime

Per ogni tipo di dati trovato in ogni posizione - una colonna, un campo, un pattern di oggetti, un attributo di telemetria - un risultato conserva:

- quanti valori campionati lo contenevano, su quanti, e quanti di questi erano valori di test noti;
- quanti valori diversi hanno corrisposto, stimati da hash che restano nella memoria dello scanner e vengono scartati con la scansione;
- la confidenza, e se il nome della posizione indicava il tipo di dati;
- al massimo tre campioni mascherati, mascherati all'interno dello scanner prima che qualcosa ne esca.

Non conserva mai un valore grezzo. Ogni tipo di valore viene mascherato in modo che una persona possa riconoscerlo, mai usarlo:

| Valore | Campione mascherato |
| --- | --- |
| Un indirizzo email | `j***@e******.com`: la prima lettera del nome e del dominio, e l'etichetta di primo livello |
| Un numero di carta | `**** **** **** 4242`: le ultime quattro cifre, come PCI DSS consente di mostrare una carta |
| Un segreto | I primi quattro e gli ultimi quattro caratteri quando è lungo, i primi due quando è corto, e solo l'intestazione di una chiave privata |
| Un URL o una stringa di connessione | Tutto tranne la password |
| Un indirizzo IP | La prima parte, la rete, con il resto nascosto |
| Un valore trovato per nome | Il primo carattere, poi `****` |
| Una dicitura di classificazione di un documento | La dicitura così come è scritta, come «Confidential»: dice cos'è il documento |
| Qualsiasi altra cosa | Gli ultimi due-quattro caratteri, mantenendo i separatori, come `***-**-6789` |

Disattiva **Conserva campioni mascherati** nelle impostazioni del progetto per conservare solo i conteggi: dalla scansione successiva di ogni archivio, i risultati che scrive non conservano campioni.

Le copie di dati tra archivi si trovano tramite impronte, non valori: 128 numeri a 16 bit per ogni tipo di dati, sottoposti a hash con una chiave propria del progetto (vedi [Come le impronte restano private](/docs/data-security/flows-access-residency#come-le-impronte-restano-private)).

Un risultato conta per il suo archivio per 30 giorni dopo l'ultima volta che una scansione lo ha visto, perché un campione può non cogliere ciò che c'è ancora. Uno non visto per 90 giorni viene eliminato. Un archivio conserva al massimo 2.000 risultati.

## Impostazioni

Le impostazioni di Sicurezza dei dati sono un unico insieme per progetto, nella sezione **Impostazioni** del menu di Sicurezza dei dati. Partono da questi valori predefiniti:

| Impostazione | Predefinito | Cosa fa |
| --- | --- | --- |
| **Controlla la configurazione** | Attivo | Esegue i controlli su ogni archivio. Se è disattivata, nessun problema si apre, cambia o si chiude. |
| **Scansiona contenuto** | Attivo | Campiona il contenuto degli archivi dove è stato concesso il permesso sul contenuto. |
| **Scansiona telemetria** | Attivo | Campiona i log, le tracce, le eccezioni, i replay e le conversazioni IA del progetto. |
| **Conserva campioni mascherati** | Attivo | Conserva fino a tre campioni mascherati con ogni risultato. Se è disattivata, conserva solo i conteggi. |
| **Apri casi di sicurezza** | Attivo | Apre un caso di sicurezza, raggruppato per archivio, quando si apre un problema Critico. |
| **Genera avvisi** | Disattivato | Genera un avviso, che chiama chi è di reperibilità, quando si apre un problema Critico. |
| **Gravità avviso** | Vuoto | La gravità di quegli avvisi. Se è vuota, è la più grave del progetto. |
| **Dichiara incidenti** | Disattivato | Dichiara un incidente, preso in carico dal tuo processo di gestione degli incidenti, quando si apre un problema Critico. |
| **Gravità incidente** | Vuoto | La gravità di quegli incidenti. Se è vuota, è la più grave del progetto. |
| **Notifica ai proprietari** | Attivo | Invia un'email ai proprietari di un archivio quando si apre un problema su di esso. |
| **Oggetti per scansione** | 2.000 | Il numero massimo di oggetti che legge una scansione di un bucket, da 10 a 50.000. |
| **Byte per oggetto** | 65.536 (64 KB) | Il numero massimo di byte letti da un oggetto, da 1.024 a 4.194.304. |
| **Byte per scansione** | 52.428.800 (50 MB) | Il numero massimo di byte che una scansione del contenuto legge in tutto, da 65.536 a 1.073.741.824. |
| **Righe per tabella** | 1.000 | Il numero massimo di righe lette da una tabella, da 10 a 100.000. |
| **Tabelle per scansione** | 200 | Il numero massimo di tabelle che legge una scansione, da 1 a 5.000. |
| **Dimensione del campione di telemetria** | 500 | Quanti record recenti di ogni servizio e segnale legge una scansione della telemetria, da 10 a 10.000. |
| **Scansiona ogni (ore)** | 24 | Ogni quanto il contenuto di un archivio viene campionato di nuovo, da 1 a 720. |
| **Mai sensibile** | Vuoto | Valori che non sono mai risultati, come il tuo indirizzo di supporto. |
| **Tipi di dati disattivati** | Vuoto | Tipi di dati integrati che le scansioni del progetto non cercano: gli interruttori sotto **Tipi di dati integrati**. |

## Risoluzione dei problemi

:::details Un archivio dice che il suo contenuto non è stato scansionato
La scansione dice perché: «La scansione del contenuto richiede il permesso sul contenuto della connessione, oppure una stringa di connessione per un database.» Imposta la connessione dell'archivio su **Configurazione e campioni di contenuto** ed esegui di nuovo il suo comando, oppure assegna al database una stringa di connessione. Controlla anche che **Scansiona contenuto** sia attivo per l'archivio e nelle impostazioni del progetto.
:::

:::details Un controllo dice che non può stabilirlo
Un dato che il lettore non ha potuto leggere - un permesso che il ruolo non ha, un'API non attivata - è sconosciuto, mai ipotizzato. Il suo controllo segnala che non può stabilirlo, e un problema che ha aperto resta aperto: nessuno può concludere che un problema sia risolto perché OneUptime non ha potuto guardare. Le avvertenze della lettura della configurazione dicono cosa non ha potuto leggere. Esegui di nuovo il comando della connessione per concedere ciò che manca.
:::

:::details Non compaiono bucket S3 né dataset BigQuery
Vengono dalla lettura della configurazione, non dall'inventario cloud. Imposta la connessione su **Solo configurazione** o superiore, ed esegui di nuovo il suo comando.
:::

:::details Una scansione è contrassegnata come Riuscito in parte
Ha raggiunto un limite prima di leggere tutto: gli 8 minuti, **Byte per scansione** o **Oggetti per scansione**, oppure una richiesta rifiutata dal cloud. Le sue avvertenze dicono quale. La scansione successiva prosegue, saltando ciò che non è cambiato, oppure alza il limite.
:::

## Passaggi successivi

:::cards
- [Tipi di dati sensibili](/docs/data-security/data-types): Cosa cerca lo scanner in ciò che legge.
- [Controlli e problemi di Sicurezza dei dati](/docs/data-security/checks-and-issues): Cosa viene verificato nella lettura della configurazione.
- [Dati sensibili nella telemetria](/docs/data-security/telemetry): I tuoi log, le tue tracce e le tue conversazioni IA, che non richiedono configurazione.
- [Collegare un account cloud](/docs/telemetry/cloud-accounts): Collega innanzitutto AWS, Azure o Google Cloud.
:::
