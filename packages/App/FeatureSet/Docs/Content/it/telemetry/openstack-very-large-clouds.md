# Cloud OpenStack di dimensioni molto grandi

Quanto costa un cloud di qualsiasi dimensione prima ancora di installare qualcosa: quanto pesa il monitoraggio sul suo piano di controllo, quanti dati invia e cosa fa OneUptime in modo diverso man mano che un cloud cresce. Quasi nessun cloud ha bisogno di tutto questo: i valori predefiniti dell'[agente OpenStack](/docs/telemetry/openstack) e di una [sonda](/docs/telemetry/openstack-agentless) reggono fino a migliaia di istanze senza impostare nulla.

:::cards
- [Il carico sul tuo piano di controllo](#il-carico-sul-tuo-piano-di-controllo): richieste al minuto per servizio, a ogni dimensione.
- [I dati che invia](#i-dati-che-invia): serie e gigabyte al giorno, a partire dai conteggi del tuo cloud.
- [Modalità riepilogo](#modalità-riepilogo): cosa conserva un cloud oltre 5.000 istanze, e a cosa rinuncia.
- [Condividere un cloud tra più collector](#condividere-un-cloud-tra-più-collector): un agente per regione o per servizio.
- [Il percorso dei database](#il-percorso-dei-database): leggere i cloud più grandi dai loro database.
- [A cosa è stata sottoposta la dimensione massima](#a-cosa-è-stata-sottoposta-la-dimensione-massima): un'ora a 200.000 istanze, con i suoi budget e ciò che ha misurato.
:::

## Il carico sul tuo piano di controllo

### Tramite una sonda

Una sonda resta entro un carico dichiarato per quanto grande sia il cloud. Chiede a ogni servizio una richiesta alla volta, a Placement quattro, legge le istanze per modifica tra una lettura completa e l'altra e, oltre un numero dichiarato, legge a turni ciò che costa una chiamata per elemento (l'utilizzo di un hypervisor, gli agenti di un router, le quote di un progetto). Ogni raccolta invia tutto com'era all'ultima lettura, quindi nessuna serie ha buchi: si sposta solo quanto sono aggiornate quelle parti.

Richieste al minuto con i valori predefiniti, a raccolta stabilizzata, su un cloud con OVN:

| Cloud | Keystone | Nova | Placement | Neutron | Cinder | Glance |
| --- | --- | --- | --- | --- | --- | --- |
| 10 hypervisor, 100 istanze, 20 progetti | 1,3 | 3,5 | 12,5 | 3,5 | 2,5 | 0,3 |
| 500 hypervisor, 20.000 istanze, 1.000 progetti | 1,3 | 4,2 | 253 | 7,5 | 8,5 | 0,3 |
| 5.000 hypervisor, 200.000 istanze, 10.000 progetti | 1,3 | 12,7 | 1.003 | 43,5 | 62,5 | 0,5 |

Sono conteggiate, non stimate: un test esegue il vero collector contro un'API simulata di ogni dimensione, su un orologio che sposta da sé, e confronta ciò che ha richiesto con questi numeri esattamente, servizio per servizio, ovunque scada qualcosa di diverso. Un conteggio di richieste non dipende dalla macchina su cui è stato contato.

Ciò che ogni dimensione contiene oltre ai suoi hypervisor, istanze e progetti è ipotizzato, e un cloud reale differisce: un volume ogni due istanze, uno snapshot e un backup ogni dieci volumi, una rete, una subnet, un router e un security group per progetto, un floating IP ogni dieci istanze, 40 flavor, due agenti Neutron per hypervisor, e un'immagine ogni dieci progetti, tra 10 e 1.000. Un elenco costa una richiesta ogni mille righe, quindi ciò che il tuo cloud contiene davvero sposta questi valori solo di poco. Ciò che li sposta di più:

| Cosa cambia | Quanto costa |
| --- | --- |
| La prima raccolta dopo l'avvio di una sonda | Una chiamata per gli inventari di ogni hypervisor e una per il suo utilizzo, qualunque sia il loro numero |
| ML2/OVS anziché OVN | Una chiamata per router per chiedere quali agenti L3 lo ospitano, al massimo 2.000 a raccolta |
| Istanze che cambiano | Una chiamata a Nova per ogni istanza cambiata, per leggere cosa le è successo, al massimo 25 a raccolta |
| [Limiti dei progetti](/docs/telemetry/openstack-agentless#quanto-costa-al-tuo-cloud) attivati | Quattro chiamate per progetto, al massimo 250 progetti a raccolta, quindi un cloud da 10.000 impiega 80 minuti per fare il giro |
| Raccogliere meno spesso | **Raccogli ogni** nella pagina **Impostazioni** del cloud. Il doppio del tempo è metà delle chiamate |
| Più regioni | Tutto tranne Keystone di nuovo, per regione |

Una raccolta dispone di nove decimi del suo intervallo, e al massimo dieci minuti, e ogni servizio viene letto una richiesta alla volta. Quindi la rapidità con cui rispondono le API di un cloud grande decide con che frequenza lo si può raccogliere: a 200.000 istanze e con i due minuti predefiniti, Nova deve rispondere a ogni pagina della sua lettura completa in circa mezzo secondo, e Cinder ai suoi elenchi in circa 0,8 secondi. Un servizio che non riesce a finire risulta fermo finché non ci riesce, e la scheda dice **La raccolta ha richiesto troppo tempo**. Aumenta **Raccogli ogni**, il che abbassa anche il carico, oppure usa il [percorso dei database](#il-percorso-dei-database).

### Tramite l'agente

L'exporter dell'agente effettua il login e legge ogni elenco per intero a ogni scrape, e chiede a Placement tre cose per hypervisor, una chiamata alla volta. Richieste al minuto con i valori predefiniti:

| Cloud | Keystone | Nova | Placement | Neutron | Cinder | Glance |
| --- | --- | --- | --- | --- | --- | --- |
| 10 hypervisor, 100 istanze, 20 progetti | 3,4 | 3 | 15,5 | 3,5 | 2 | 0,2 |
| 500 hypervisor, 20.000 istanze, 1.000 progetti | 3,4 | 13 | 751 | 7,5 | 7,5 | 0,2 |
| 5.000 hypervisor, 200.000 istanze, 10.000 progetti | 3,4 | 106 | 7.501 | 43,5 | 57 | 0,4 |

Sono conteggiate dal sorgente dell'exporter, e l'exporter non è stato eseguito a queste dimensioni. Uno scrape dispone di 110 secondi, quindi un Placement che risponde in 20 ms esaurisce il tempo a circa 1.800 hypervisor, e Nova a un secondo a pagina a circa 110.000 istanze. Oltre, uno scrape di essi fallisce per quanto gentilmente sia stato richiesto. Oltre queste dimensioni usa il [percorso dei database](#il-percorso-dei-database), oppure una sonda.

### Quando un'API rallenta

Una sonda osserva in quanto tempo risponde di solito ogni servizio, e quando una risposta richiede il triplo e almeno un secondo, o cinque secondi qualunque sia il valore abituale, attende quanto è durata quella risposta prima di interrogare di nuovo quel servizio. Più letture in attesa contemporaneamente si alternano, così una pausa non finisce in una raffica. Un servizio che continua a rispondere `429` o `503` viene lasciato in pace per un minuto, poi due, poi quattro, fino a mezz'ora. Nient'altro viene trattenuto: ogni servizio viene interrogato per conto suo.

La scheda **Raccolta dati** del cloud lo dice finché dura, servizio per servizio: quanto è stata lenta la sua risposta più lenta e quanto la sonda ha atteso. L'exporter dell'agente non può farlo. Uno scrape gira per intero, al suo intervallo: aumenta `scrape_interval` e `scrape_timeout` per quel job per risparmiare un servizio.

## I dati che invia

Le serie di un cloud derivano dai suoi conteggi. Il calcolatore nella pagina **Documentazione** di un cloud in OneUptime lo ricava da tre numeri. Per calcolarlo da te, per una regione:

| Serie | Quante |
| --- | --- |
| Compute | 10 per hypervisor, più flavor e servizi di controllo, più 7 |
| Placement | 15 per hypervisor, più 4. Una sonda ne aggiunge circa 2 per flavor, per [quanti esemplari di ciascuno ci stanno](/docs/telemetry/openstack#capacità) |
| Neutron | Agenti, reti, router e floating IP, 3 per subnet, più 11. Uno in più per router su ML2/OVS |
| Cinder | Servizi, snapshot e backup, 2 per pool di archiviazione, più 26 |
| Istanze e volumi, a meno che la modalità riepilogo sia attiva | 4 per istanza, 2 per volume |
| I conteggi della modalità riepilogo, quando è attiva | Uno per stato e uno per progetto: circa 6 più i progetti |
| Keystone, Glance | Progetti, domini e 9, e 2 per immagine più 5. Una sonda ne aggiunge 3 per Heat e per Magnum, che un cloud li esegua o no |

Ciò che ti viene fatturato sono le righe di ogni scrape: le prime cinque righe arrivano ogni 2 minuti, 720 volte al giorno, e l'ultima ogni 5 minuti, 288 volte. Il prezzo è quello della tua fattura, [per GB per il tempo in cui viene conservato](/docs/telemetry/openstack#quanto-costa). La fattura legge la dimensione reale di ogni riga, e questo calcolo usa 1.024 byte a riga, il valore a cui la fatturazione di OneUptime ripiega quando non ha una dimensione per una riga. Una riga con molte etichette, come quella di un'istanza, costa più di così, e una senza ne costa meno.

| Cloud | Serie | GB al giorno, ogni serie | GB al giorno, in modalità riepilogo | Un mese con 15 giorni di conservazione, in modalità riepilogo |
| --- | --- | --- | --- | --- |
| 10 hypervisor, 100 istanze, 20 progetti | 1.075 | 0,7 | Non in modalità riepilogo | $2,12 |
| 500 hypervisor, 20.000 istanze, 1.000 progetti | 123.847 | 84,5 | 16,6 | $49,71 |
| 5.000 hypervisor, 200.000 istanze, 10.000 progetti | 1.237.183 | 844,5 | 164,9 | $494,73 |

Questi valori sono tramite l'agente, con un'istanza su mille in uno stato che ne conserva le serie. Una sonda oltre la dimensione di riepilogo invia ciò che non è cambiato una volta per ciclo anziché a ogni raccolta, il che equivale a circa 13,2 GB al giorno alla seconda dimensione e 116 GB alla terza.

L'utilizzo reale per istanza, da libvirt o Ceilometer, si aggiunge a tutto questo: vedi [quanto costa](/docs/telemetry/openstack#quanto-costa).

## Modalità riepilogo

Oltre 5.000 istanze un cloud conserva conteggi e righe, anziché una serie per istanza. A quella dimensione quelle serie sono la maggior parte della fattura, circa 17 GB al giorno contro 4 GB per tutto il resto, e dicono ciò che le righe e i conteggi dicono già.

**Cosa conserva:**

- Una riga per ogni parte, in ogni pagina ed elenco, tenuta aggiornata. I cambi di stato la raggiungono come di consueto.
- Ogni serie di hypervisor, worker, reti, router, floating IP, pool di indirizzi e pool di archiviazione.
- `openstack_nova_instances_by_status` e `openstack_nova_instances_by_project`, in ogni regione.
- Le serie di qualsiasi istanza o volume in uno stato che un avviso osserva: in `ERROR`, o bloccato in `BUILD`, `RESIZE`, `attaching` e simili. Così ogni [modello di avviso](/docs/monitor/openstack-monitor#template-di-avviso-predefiniti) continua a funzionare, e continua a rientrare da solo.

**A cosa rinuncia:**

- La cronologia dello stato di ogni istanza e volume stabilizzato, e un grafico o un monitor su quelle serie. `openstack_nova_server_status`, `openstack_cinder_volume_gb` e `openstack_cinder_volume_status` si fermano per una parte una volta stabilizzata. Un monitor che ha bisogno di una sola istanza dovrebbe scegliere il suo progetto, come spiegato sotto.
- `openstack_placement_resource_provider_allocations` e `openstack_nova_server_local_gb`, a chiunque appartengano. Una sonda smette del tutto di chiedere a Placement le allocazioni.

**Per conservare comunque le serie di un'istanza**, apri le **Impostazioni** del cloud, poi **Utilizzo reale per istanza**. **Solo i progetti e gli aggregati che scelgo** conserva ogni istanza e volume di quei progetti, qualunque sia la dimensione del cloud. **Ogni istanza** disattiva la modalità riepilogo per l'intero cloud. Una sonda lo rifiuta oltre circa 480 MiB di metriche per raccolta, anziché tenerlo in memoria: usa l'agente per un cloud simile.

**Tramite una sonda** c'è un'ulteriore differenza. Oltre la dimensione di riepilogo legge tutto ogni volta, e invia solo ciò che è cambiato, ciò che qualcuno ha scelto, ciò che un avviso osserva e una parte del resto. Ogni parte torna una volta per ciclo, dimensionato in modo che l'upload di una raccolta resti intorno a 24 MiB oltre alle serie che vanno ogni volta: 6 minuti a 20.000 istanze, 44 a 200.000. La scheda **Raccolta dati** dice quanto dura il ciclo. Ne derivano due cose:

- **Gli elenchi di un nuovo cloud si riempiono nel corso del primo ciclo.** La prima raccolta sa cosa contiene il cloud, e la scheda lo dice subito, ma le sue righe arrivano una parte alla volta. Lo stesso vale per una sonda che si è riavviata, anche se nel frattempo le righe che ha lasciato restano nelle pagine. La scheda dice quando saranno arrivate tutte.
- **Una parte che non c'è più resta elencata ancora un po'.** Esce entro 15 minuti da quando nulla la riporta, più il ciclo, più due letture. Quindi 15 minuti e qualcosa sulla maggior parte dei cloud, e poco più di un'ora a 200.000 istanze. Una parte che c'è ancora non viene mai rimossa. Una lettura fallita non rimuove nulla, per quanto duri.

## Condividere un cloud tra più collector

Un solo agente legge un cloud per quante regioni abbia, ed è da lì che conviene partire. Quando uno è troppo per la macchina su cui gira o per il tempo di uno scrape, dai a ogni agente una parte. Ognuno di essi invia allo stesso cloud OneUptime con lo stesso `OPENSTACK_CLOUD_NAME`. Due regole evitano che un grafico e una fattura contino il doppio:

- **Ogni coppia di regione e servizio appartiene a un solo agente.** Una riga è la stessa riga per quanti agenti la riportino, ma le serie di ogni agente vengono archiviate e fatturate.
- **Keystone appartiene a un solo agente.** È uno solo per l'intero cloud, da qualunque regione lo si chieda.

**Un agente per regione** è ciò che serve alla maggior parte dei cloud. Elenca solo le voci di quella regione in `clouds.yaml` e `OPENSTACK_EXPORTER_CLOUDS`. Solo il primo agente conserva Keystone:

```bash
# On the agent for RegionOne, in .env
OPENSTACK_CLOUD_NAME=prod
OPENSTACK_EXPORTER_CLOUDS=[RegionOne]

# On the agent for RegionTwo
OPENSTACK_CLOUD_NAME=prod
OPENSTACK_EXPORTER_CLOUDS=[RegionTwo]
OPENSTACK_AGENT_SERVICES=compute|placement|network|volume|image
```

**Un agente per servizio** è per i cloud più grandi, dove gli elenchi di un servizio sono ciò che uno scrape non riesce a completare. `OPENSTACK_AGENT_SERVICES` conserva i job che nomina e lascia il resto a un altro agente:

```bash
# Nova and Placement, which take the most
OPENSTACK_AGENT_SERVICES=compute|placement

# And everything else
OPENSTACK_AGENT_SERVICES=identity|network|volume|image
```

Imposta `OPENSTACK_AGENT_MEMORY_LIMIT_MIB` su un agente che regge una grossa parte: tiene uno scrape in memoria mentre lo inoltra, e il valore predefinito è 512 MiB. Una riga è garantita dal proprio servizio nella propria regione, quindi un agente che si ferma non porta via nulla di ciò che legge un altro agente. Indica ciò su cui poggia un cloud, gli `OPENSTACK_RABBITMQ_TARGETS` e [gli altri simili](/docs/telemetry/openstack#variabili-dambiente), su un solo agente. Se quell'agente si ferma mentre gli altri proseguono, quelle macchine escono dalle pagine dopo 15 minuti, e tornano quando torna lui.

**Con le sonde**, un cloud ha una sola sonda. Dai a una regione una sonda propria connettendola come cloud a sé, con solo quella regione selezionata: nulla viene contato due volte, perché ognuna legge solo la propria regione, e ognuna legge Keystone per conto suo. Ognuno è poi un cloud a sé in OneUptime, con le proprie pagine e i propri avvisi.

## Il percorso dei database

Oltre **1.500 hypervisor o 100.000 istanze** l'agente può leggere i database di un cloud anziché le sue API, con [`openstack_database_exporter`](https://github.com/vexxhost/openstack_database_exporter). A quella dimensione uno scrape delle API esaurisce il tempo, e le letture che non riescono a finire sono carico inutile. Una lettura dei database non costa nulla alle API. Viene offerto solo oltre quella dimensione, perché al di sotto le API rispondono abbastanza bene e questo percorso rinuncia a qualcosa.

**Cosa ti chiede:**

- Un account di sola lettura sul database di ogni servizio: Nova, Nova API, Placement, Neutron, Cinder, Glance e Keystone. Un database escluso è un servizio che lascia stare.
- Una route dalla macchina dell'agente a quei database, che sulla maggior parte dei cloud sono tenuti ben lontani da tutto il resto. È un'ulteriore cosa che può leggere i record di ogni progetto.
- Un exporter per regione, e per cella Nova. Legge ciò che gli indichi, e una seconda cella richiede un secondo exporter.
- Che i suoi schemi seguano la tua release. Legge direttamente le tabelle di ogni servizio, quindi un aggiornamento di OpenStack può cambiare ciò che può leggere prima che lo faccia una nuova versione dell'exporter.

**Per attivarlo**, in `.env`:

```bash
COMPOSE_PROFILES=openstack-database-exporter
# Read from the databases, and from nowhere else: with the two together every series arrives twice.
OPENSTACK_EXPORTER_CLOUDS=[]
OPENSTACK_DATABASE_EXPORTER_TARGETS=[openstack-database-exporter:9180]
# What a hypervisor's full name adds to Nova's host name, so an instance finds its hypervisor.
OPENSTACK_DATABASE_EXPORTER_HOST_SUFFIX=.example.org
# oslo.db's form. Each is kept in .env, which only its owner can read.
NOVA_DATABASE_URL=mysql+pymysql://oneuptime:secret@db.example:3306/nova
NOVA_API_DATABASE_URL=mysql+pymysql://oneuptime:secret@db.example:3306/nova_api
PLACEMENT_DATABASE_URL=mysql+pymysql://oneuptime:secret@db.example:3306/placement
NEUTRON_DATABASE_URL=mysql+pymysql://oneuptime:secret@db.example:3306/neutron
CINDER_DATABASE_URL=mysql+pymysql://oneuptime:secret@db.example:3306/cinder
GLANCE_DATABASE_URL=mysql+pymysql://oneuptime:secret@db.example:3306/glance
KEYSTONE_DATABASE_URL=mysql+pymysql://oneuptime:secret@db.example:3306/keystone
# What a database cannot say, from the API: each is one small list a scrape.
OPENSTACK_WORKER_STATE_CLOUDS=[RegionOne]
```

**Cosa copre.** Le stesse serie con gli stessi nomi, quindi ogni pagina, monitor e modello di avviso le legge allo stesso modo. Un test le confronta con quelle dell'exporter delle API, nome per nome ed etichetta per etichetta.

**Cosa non copre:**

| Cosa | Perché, e cosa succede invece |
| --- | --- |
| Se ogni worker Nova è vivo | Il suo `openstack_nova_agent_state` vale 1 per qualsiasi servizio abilitato, quindi un `nova-compute` fermo risulterebbe attivo. L'agente scarta quella serie e la legge dall'API di Nova, che è un piccolo elenco |
| Quanto è pieno ogni pool di archiviazione | Ogni backend lo riporta allo scheduler di Cinder, e non è nel database. L'agente lo legge dall'API di Cinder, che è un'altra lettura |
| L'MTU di una rete | Risulta sconosciuto |
| `openstack_placement_resource_provider_allocations`, la generation di un provider | Nulla li legge |
| Quote e limiti per progetto | Può leggerli, e a 10.000 progetti sono 790.000 datapoint a scrape, quindi l'agente li esclude. Elimina quella regola in `otel-collector-config.yaml` per conservarli |
| Se un'API risponde | `openstack_<service>_up` dice se risponde il suo database. Un'API ferma con un database sano risulta attiva, quindi osserva le API stesse con un [monitor di sito web](/docs/monitor/website-monitor) |

**Quanto è provato.** Le serie sono state lette dal sorgente dell'exporter e dai suoi test al tag che l'agente fissa, e ognuna corrisponde a ciò che legge OneUptime. Non è stato eseguito qui contro un database reale.

## A cosa è stata sottoposta la dimensione massima

Il vero collector ha letto un'API simulata di 5.000 hypervisor, 200.000 istanze e 10.000 progetti ogni due minuti per 60 minuti, su un orologio reale. Ciò che ha inviato è passato attraverso il vero fold e le vere scritture in un vero Postgres, con le letture della Panoramica e lo sweep delle righe obsolete in esecuzione accanto ogni 30 secondi, e 200 istanze che cambiavano a ogni raccolta. Ogni budget qui sotto è verificato con un'asserzione, e un'esecuzione che ne manca uno fallisce.

| Cosa | Budget | Misurato |
| --- | --- | --- |
| Richieste al minuto, come richieste a ogni servizio | Esattamente ciò che dice la pianificazione del collector, servizio per servizio | Esatto. Keystone 1,3, Nova 25,1, Placement 1.166, Neutron 43,5, Cinder 62,4, Glance 0,5 |
| Raccolte saltate perché la precedente era ancora in esecuzione | Nessuna | 0 su 30 |
| Ritardo di ingestione, dall'inizio di una raccolta alla scrittura della sua ultima riga | Meno di 2 minuti | 37 s alla mediana, 112 s nel caso peggiore |
| L'apertura di una Panoramica, tutte le letture che esegue insieme | Meno di 6 secondi | 0,6 s alla mediana, 4,1 s nel caso peggiore, e 5.008 byte di ciò che richiede attenzione |
| L'attesa più lunga di qualsiasi writer su un lock della tabella dell'inventario | Meno di 5 secondi | 0,0 s, in 2.739 controlli una volta al secondo |
| Parti eliminate che erano ancora presenti | Nessuna | 0 |

E ciò che è costato, che non ha budget: 73 MiB di metriche a raccolta prima della compressione, in al massimo 2 upload, 14 s di CPU di questo processo a raccolta per leggere, inviare e scrivere insieme, e al massimo 998 MiB di heap JavaScript. Una sonda che raccoglie un cloud di questa dimensione ha bisogno di quella memoria in aggiunta al suo altro lavoro.

È stato eseguito su un Mac con 10 core, condiviso con altro lavoro a un load average di circa 33, e con PostgreSQL 14 sulla stessa macchina, quindi i tempi sono ciò che ha ottenuto una macchina occupata anziché ciò che otterrebbe un server. È stato misurato il 2026-11-05. Le richieste di un'ora comprendono la sua prima raccolta, che chiede a Placement gli inventari di ogni hypervisor, quindi risultano un po' sopra [la tabella](#tramite-una-sonda) di una raccolta stabilizzata, e le 200 istanze che cambiano a ogni raccolta sono il resto delle letture di Nova lì.

Il margine non è ampio su una macchina così occupata. Un'ora precedente, a un load average di circa 42 che ha raggiunto 95, è arrivata fino all'ultima riga di una raccolta scritta a 124 secondi, quindi la raccolta successiva è stata saltata, e ogni altro budget ha retto.

**Cosa lascia fuori.** La simulazione risponde subito, quindi questo non dice nulla su quanto siano veloci le tue API: [cosa permette il tempo di una raccolta](#tramite-una-sonda) riguarda proprio questo. Lascia fuori il server HTTP e la coda tra una sonda e l'ingestione, e ClickHouse, quindi la lettura delle serie da parte di un grafico o di un monitor non è inclusa, solo le scritture e le letture dell'inventario. Le righe hanno la forma di quelle di un vero DevStack e i conteggi sono inventati. Nessun cloud di questa dimensione è stato eseguito contro di esso.

## Cosa leggono le pagine

Le pagine di un cloud grande si leggono veloci come quelle di uno piccolo, perché nessuna legge l'intero cloud.

| Pagina | Cosa legge |
| --- | --- |
| **Panoramica** | Conteggi calcolati sul server, e le righe che possono richiedere qualcuno. Oltre 1.000 host o worker, gli altri vengono solo contati, quindi ciò che porta resta sotto un megabyte per quanto grande sia il cloud |
| **Servizi** | Lo stesso: una scheda per ogni servizio, ciò che richiede qualcuno per primo, e quanti altri stanno bene. Una ricerca interroga il server, quindi trova qualsiasi host |
| Elenchi | Una pagina alla volta, ciascuna dall'ultima riga della pagina precedente. Un salto a una pagina lontana procede per offset, che sull'ultima pagina di 200.000 righe richiede secondi anziché un millisecondo |
| **Topologia** | Oltre 5.000 parti, la struttura, ciò che è fallito e ciò che questo si porta dietro. Dice cosa ha lasciato fuori |
| **Inventory writes** | Al massimo 500 righe per istruzione, e 5.000 per una cancellazione, ciascuna nella propria transazione, così nessun writer attende a lungo un altro. Una riga su cui nulla è cambiato non viene riscritta per un massimo di 5 minuti, il che riduce il write-ahead log di oltre venti volte |

## Utilizzo e spesa

La [pagina Spend](/docs/telemetry/openstack#spesa) di un cloud legge le righe dell'inventario anziché le serie di una qualsiasi istanza, quindi funziona allo stesso modo in modalità riepilogo, e il suo costo cresce con i progetti anziché con le istanze. Legge una riga del cloud e una pagina di progetti. [La sua sezione](/docs/telemetry/openstack#a-ogni-dimensione) riporta i numeri a ogni dimensione.

## Passi successivi

:::cards
- [Agente OpenStack](/docs/telemetry/openstack): installa l'agente.
- [OpenStack senza agente](/docs/telemetry/openstack-agentless): raccogli un cloud con una sonda.
- [Monitor OpenStack](/docs/monitor/openstack-monitor): avvisa su ciò che arriva.
:::
