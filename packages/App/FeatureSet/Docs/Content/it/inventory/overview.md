# Panoramica dell'inventario

L'inventario è un unico elenco di tutto ciò che OneUptime sa della tua infrastruttura: servizi, host, oggetti Kubernetes, macchine virtuali, dispositivi di rete, risorse cloud, dispositivi IoT, funzioni serverless e le cose che non inviano alcuna telemetria. Quasi tutto si compila da solo a partire da ciò che OneUptime già osserva. Tu aggiungi ciò che l'osservazione non può dirgli: a cosa serve una cosa, di chi è, quando scade la sua garanzia. Il [Glossario](/docs/introduction/glossary#cosa-tieni-sotto-controllo) spiega cos'è ogni tipo di record che contiene.

:::cards
- [Come gli elementi entrano nell'inventario](#come-gli-elementi-entrano-nellinventario): Scoperti, replicati o aggiunti da te.
- [Orientarsi](#orientarsi): Le pagine dell'inventario e le pagine di ogni elemento.
- [Importare dispositivi da Esper](#importare-dispositivi-da-esper): Ogni dispositivo Android e Apple registrato dal tuo tenant Esper, sempre aggiornato.
- [Importare dispositivi da Microsoft Intune](#importare-dispositivi-da-microsoft-intune): Ogni PC Windows, Mac, iPhone, iPad e dispositivo Android gestito da Intune, sempre aggiornato.
- [Importare dispositivi da Workspace ONE UEM](#importare-dispositivi-da-workspace-one-uem): Ogni telefono, tablet e computer gestito da Workspace ONE, sempre aggiornato.
- [Importare dispositivi da SOTI MobiControl](#importare-dispositivi-da-soti-mobicontrol): Ogni dispositivo rugged, telefono, tablet e computer gestito da MobiControl, sempre aggiornato.
- [Aggiungere qualcosa a mano](#aggiungere-qualcosa-a-mano): Un'API di terze parti, un database esterno o un'appliance.
- [Archiviare invece di eliminare](#archiviare-invece-di-eliminare): Il modo di riordinare l'elenco che dura nel tempo.
:::

## Come gli elementi entrano nell'inventario

OneUptime osserva già la tua infrastruttura per monitorarla, quindi il catalogo nasce da ciò che vede e non da ciò che qualcuno si è ricordato di scrivere. Ogni elemento ha una fonte, e la fonte decide a chi appartiene l'elemento: se puoi modificarlo e se può sparire da solo.

```mermaid title="Tre strade verso un unico elenco"
flowchart TB
    T["La tua<br/>telemetria"] -->|"Discovered"| I["Inventario: un elemento<br/>per ogni cosa, con una<br/>chiave d'identità stabile"]
    R["I poller<br/>di OneUptime"] -->|"Replicato ogni<br/>15 minuti"| I
    Y["Cose senza<br/>telemetria"] -->|"Aggiunto da te"| I
    I --> L["All Items, la mappa<br/>della topologia e le<br/>pagine degli elementi"]
    I --> X["Campi personalizzati,<br/>esportazione CSV e API"]
```

| Fonte | Nell'API | Da dove viene | Quanto resta |
| --- | --- | --- | --- |
| **Rilevato** | `discovered` | Gli attributi di risorsa OpenTelemetry, letti all'arrivo della telemetria: un servizio, un host, un oggetto Kubernetes o una macchina virtuale che invia telemetria. | Registrato di nuovo a ogni batch. Rimosso quando resta in silenzio più a lungo della finestra del suo tipo (vedi sotto). |
| **Replicato** | `inventory` | Un record che un poller di OneUptime mantiene: dispositivi di rete, risorse cloud, dispositivi IoT, funzioni serverless, applicazioni RUM, host Docker, host Podman e i dispositivi importati dalla connessione a un gestore dei dispositivi. Copiato ogni 15 minuti; un dispositivo gestito, ogni volta che viene letta la sua connessione. | Finché esiste il suo record. Elimina il record e l'elemento se ne va con lui. |
| **Aggiunto da te** | `manual` | Aggiunto da te, per qualcosa che OneUptime non può vedere: un'API di terze parti, un database gestito da un fornitore, un'appliance in un rack. | Finché non lo elimini. Niente lo fa scadere. |

Un elemento scoperto o replicato non può essere rinominato né cambiare tipo: la sua fonte sovrascriverebbe la modifica al passaggio successivo. La pagina **Impostazioni** dell'elemento indica invece dove fare una modifica duratura. Quello che puoi sempre aggiungere a qualsiasi elemento, qualunque sia la sua fonte, sono i valori dei campi personalizzati: vedi [Campi personalizzati dell'inventario](/docs/inventory/custom-fields).

### Quanto resta un elemento silenzioso

Un elemento scoperto ha un battito. Ogni volta che arriva telemetria per lui, la sua ora dell'ultima osservazione avanza, e la colonna **Stato** dell'elenco dice quanto è recente. Lo stesso vale per un dispositivo gestito: ogni volta che contatta il suo gestore dei dispositivi. Gli altri elementi replicati e quelli che hai aggiunto non hanno battito, quindi il loro stato resta vuoto invece di allarmare.

| Stato | Cosa significa |
| --- | --- |
| **In diretta** | Visto negli ultimi 30 minuti. |
| **Recente** | Visto nell'ultimo giorno. |
| **Non aggiornato** | Non visto da più di un giorno. La pagina **In silenzio** li elenca. |

Ogni tre ore, OneUptime rimuove gli elementi scoperti rimasti in silenzio più a lungo della finestra del loro tipo, archiviati compresi, e i loro valori dei campi personalizzati se ne vanno con loro. Gli elementi replicati e quelli che hai aggiunto non vengono mai rimossi in questo modo.

| Tipo di elemento | Rimosso dopo questo tempo senza telemetria |
| --- | --- |
| Pod, deployment, guest Proxmox, istanze OpenStack e macchine virtuali VMware | 1 giorno |
| Nodi e namespace Kubernetes, nodi Proxmox, hypervisor OpenStack, host, cluster e datastore VMware, e i database e i servizi remoti chiamati dalle tue tracce | 7 giorni |
| Servizi, host, cluster Kubernetes, Proxmox e Ceph, cloud OpenStack, array di storage, vCenters e cluster Docker Swarm | 30 giorni |

Una relazione che OneUptime ha scoperto viene rimossa quando non viene rivista per 30 giorni.

## Orientarsi

Apri **Prodotti → Risorse → Inventario**. Il suo menu laterale ha queste pagine. **Per origine**, **Impostazioni**, **Aiuto** e **Avanzato** partono chiusi: fai clic sul titolo di una sezione per aprirla.

| Pagina | Cosa trovi |
| --- | --- |
| **Panoramica** | Quanti elementi hai, cosa sono, quanti sono diventati silenziosi e cosa è stato aggiunto più di recente. |
| **Tutti gli elementi** | Ogni elemento. Cerca per nome, descrizione o chiave d'identità, filtra l'elenco per tipo, fonte, stato o campo personalizzato e aggiungi un elemento a mano. |
| **Dispositivi gestiti** | Le tue connessioni ai gestori dei dispositivi (Esper, Microsoft Intune, Workspace ONE UEM e SOTI MobiControl), e ogni dispositivo che importano, con il suo stato, il gruppo, il modello e il sistema operativo. |
| **Mappa della topologia** | Come sono collegati gli elementi: i servizi, cosa chiamano e gli host, i pod e i dispositivi su cui girano. |
| **In silenzio** | Gli elementi di cui non si hanno notizie da più di un giorno: elementi scoperti che non hanno inviato telemetria e dispositivi che hanno smesso di contattare il loro gestore dei dispositivi. |
| **Per origine** | Gli elementi di una fonte: **Rilevato**, **Replicato** o **Aggiunto da te**. |
| **Impostazioni → Campi personalizzati** | I campi che il tuo progetto tiene su ogni elemento. |
| **Aiuto → Documentazione** | Una breve guida all'inventario, con i tipi di elemento che riconosce. |
| **Avanzato → Archiviato** | Gli elementi che hai archiviato. Ripristinali da qui. |

Apri un elemento e il suo menu laterale ha la sua **Panoramica** (tipo, fonte e stato, e ogni attributo osservato su di esso), le sue **Connessioni** e i suoi **Campi personalizzati**; i suoi **Log**, **Tracce**, **Metriche**, **Profili** ed **Eccezioni**; e i suoi **Incidenti**, **Avvisi** e **Manutenzione programmata**. In **Avanzato** ci sono le sue **Impostazioni**, i suoi **Log di audit** e **Elimina elemento**. Le pagine di telemetria mostrano ciò che l'elemento stesso ha inviato. Gli incidenti, gli avvisi e gli eventi di manutenzione sono quelli del servizio, dell'host o del cluster Kubernetes che l'elemento rappresenta; su qualsiasi altro elemento, quelle pagine dicono quale risorsa guardare.

### Dettagli dell'asset

Un host o un dispositivo di rete ha una scheda **Dettagli dell'asset** che li descrive entrambi allo stesso modo: hostname, indirizzo IP, indirizzo MAC, numero di serie, produttore, modello, versione del firmware, sistema operativo, versione del sistema operativo, tipo di dispositivo e posizione. La scheda di un dispositivo Android ha anche il suo livello patch di sicurezza, dall'Agent Android o dal suo gestore dei dispositivi. Dice anche se la patch è **Da aggiornare**, come la colonna **Livello patch di sicurezza**, e a quanti giorni fa risale. Un dato che nulla ha segnalato si legge **Sconosciuto**, e la scheda spiega perché accade e come si compilano quelli sconosciuti: un dispositivo che non li segnala via SNMP, un dispositivo non ancora letto, o un dispositivo Meraki la cui dashboard li contiene.

- I dati di un host vengono dagli attributi di risorsa della sua telemetria: i suoi indirizzi IP e MAC, l'architettura e il sistema operativo fin da subito, e il numero di serie, la marca, il modello e il firmware una volta che li apponi.
- I dati di un dispositivo di rete vengono dal suo polling SNMP, dal suo ruolo e dal suo sito. Ciò che il suo polling non ha letto viene dal rilevamento: l'ultima scansione del suo indirizzo, la tabella ARP di un router o la risoluzione DNS della sua sonda. Un dispositivo senza ENTITY-MIB, come un Meraki MX, ricava comunque marca, modello e sistema operativo dalla sua descrizione di sistema, e il suo indirizzo MAC dalle sue porte. Il suo indirizzo IP non viene mai mostrato come hostname.
- Un dispositivo Meraki prende anche dalla dashboard di Meraki ciò che il suo polling lascia vuoto, tra cui numero di serie, modello e firmware, quando una [connessione Meraki](/docs/monitor/network-traffic#cisco-meraki-senza-netflow) legge la sua organizzazione.

In **Tutti gli elementi** trovi i dispositivi Android su cui intervenire. Il filtro **Livello patch di sicurezza** elenca come **Da aggiornare** i dispositivi il cui livello patch di sicurezza ha più di 90 giorni, la stessa regola che applica l'avviso Security Patch Out of Date del [monitor host](/docs/monitor/host-monitor). Il filtro **Autorizzazioni dell'agente** elenca i dispositivi su cui all'[Agent Android](/docs/telemetry/android-agent) mancano ancora READ_LOGS, READ_DROPBOX_DATA o l'accesso ai dati di utilizzo. Ciascuno ha una colonna con lo stesso nome, nascosta finché non la attivi, e l'esportazione CSV la include. Accanto, la colonna **ID nel gestore dei dispositivi** contiene l'ID con cui il gestore dei dispositivi conosce un dispositivo, come l'ID Esper che `espercli secureadb connect --device` richiede.

La scheda indica da dove viene ogni dato e quando. La fonte condivisa dalla maggior parte dei dati, come il collector di un host, il polling SNMP proprio di un dispositivo di rete o la scansione di rilevamento che lo ha letto, viene nominata una sola volta, sotto i dati. Qualsiasi altra fonte, come la tabella ARP di un router o un valore salvato sul dispositivo, viene nominata sotto il suo dato. Un valore salvato su un dispositivo di rete non viene mai sostituito da ciò che legge il rilevamento, e quando i due differiscono, la scheda li mostra entrambi.

La scheda di un dispositivo di rete ha un pulsante **Aggiorna** per chi può modificare i dispositivi di rete. Rilegge subito il dispositivo: la sua sonda lo interroga entro un minuto e la sua connessione Meraki rilegge l'organizzazione. La scheda dice quando è arrivata la nuova lettura, o che la sonda non è riuscita a raggiungere il dispositivo, e l'elemento viene copiato dal dispositivo non appena arriva la lettura.

Gli stessi dati sono colonne dell'elenco **Tutti gli elementi**, nascoste finché non le attivi, e finiscono nella sua esportazione CSV. [Esportare in un CMDB](/docs/inventory/cmdb-sync#dettagli-dellasset) elenca le loro chiavi.

### Connessioni

La pagina **Connessioni** di un elemento elenca i suoi vicini in entrambe le direzioni, raggruppati in **Chiamate**, **Chiamato da**, **Eseguito su** e **Correlati**. Ogni gruppo mostra il suo totale (un gruppo con più di 100.000 connessioni mostra «100.000+»), e **Mostra di più** scorre il resto, così un cluster, un namespace o un nodo molto affollato mostra ogni connessione e non solo le prime. La pagina non è limitata a un intervallo di tempo: include le relazioni aggiunte a mano tramite l'API e i vicini archiviati. Un vicino che non è più nell'inventario viene mostrato con la sua chiave.

## Importare dispositivi da Esper

Collega un tenant Esper, e ogni dispositivo che registra è nell'inventario: i suoi dispositivi Android, compresi quelli la cui app non è mai partita, e i suoi iPhone, iPad e Apple TV. Ogni dispositivo è un host, con ciò che solo Esper sa di lui: il suo gruppo, il sistema operativo e la build, il numero di serie e l'IMEI, la batteria e l'archiviazione, e, per un dispositivo Android, il livello patch di sicurezza e le app installate. Esper non invia nulla da solo, quindi OneUptime lo legge secondo una pianificazione: i dispositivi ogni 15 minuti, e le app di ogni dispositivo Android ogni 6 ore.

:::steps
### Creare una chiave API in Esper

Nella console di Esper, crea una chiave in API Key Management. OneUptime si limita a leggere, quindi basta la chiave di un utente il cui ruolo Esper consente di leggere dispositivi, gruppi e app. Una chiave smette di funzionare non appena viene sostituita, o non appena il suo utente viene eliminato.

### Collegare il tenant

Vai su **Prodotti → Risorse → Inventario**, poi su **Dispositivi gestiti**, fai clic su **Collega un gestore dei dispositivi** e scegli **Esper**. Inserisci il **Tenant**, cioè il nome che precede `.esper.cloud` nell'indirizzo della tua console Esper (`acme` per `acme.esper.cloud`), e la **Chiave API**. **Altri campi** contiene il nome della connessione e ogni quanto viene letta.

### Controllare la prima lettura

**Collega** verifica la chiave prima di salvare qualsiasi cosa: dice quanti dispositivi importerà una lettura, oppure cosa non va e come risolverlo. La prima lettura inizia entro un minuto, e la riga della connessione dice com'è andata.
:::

| Cosa segnala Esper | Dove compare |
| --- | --- |
| Modello, produttore, numero di serie, sistema operativo e la sua versione, build, e indirizzi IP e MAC | La scheda **Dettagli dell'asset** del dispositivo e le colonne di **Tutti gli elementi** |
| Stato, ultimo contatto, gruppo, livello patch di sicurezza, IMEI, batteria, archiviazione e agente Esper | La scheda **Esper** del dispositivo e l'elenco **Dispositivi** di **Dispositivi gestiti** |
| Le app e le loro versioni | L'elenco **App installate** del dispositivo |
| Il suo ID dispositivo Esper | La colonna **ID nel gestore dei dispositivi** di **Tutti gli elementi** |

### Un dispositivo, non due

Un'app o l'Agent Android che invia telemetria da un dispositivo si unisce al dispositivo che Esper importa in un unico elemento quando chiama il dispositivo come lo chiama Esper. Imposta questi attributi di risorsa dalla configurazione gestita che Esper compila su ogni dispositivo:

| Attributo di risorsa | Valore della configurazione gestita | Che cos'è |
| --- | --- | --- |
| `host.name` | `${esper.deviceName}` | Il nome del dispositivo in Esper, come `ESP-ID-AAAAW`. Obbligatorio. |
| `host.serial_number` | `${esper.serialNumber}` | Il numero di serie del dispositivo. Facoltativo. |

OneUptime trova l'elemento di un dispositivo per il suo nome in Esper, poi per il suo numero di serie, e ne crea uno solo quando nessuno corrisponde. L'Agent Android imposta entrambi dalle sue impostazioni `device_name` e `device_serial`, e [Configurazione Android](/docs/rum/android-setup#importare-la-flotta-da-esper) mostra la configurazione gestita di un'app.

### Quando un dispositivo tace o lascia Esper

Un dispositivo Android che non contatta Esper da 30 minuti è **Offline**, e dice quanto tempo è passato dal suo ultimo contatto; un iPhone, un iPad o un'Apple TV, che contatta Esper quando il servizio push di Apple lo risveglia, spesso a ore di distanza, è **Offline** dopo un giorno. Lo **Stato** del suo elemento segue il suo ultimo contatto, o la sua telemetria quando è più recente, quindi un dispositivo silenzioso da un giorno compare nella pagina **In silenzio**.

Un dispositivo rimosso da Esper viene contrassegnato come **Rimosso**, e il suo elemento viene archiviato: esce dall'elenco e resta in attesa in **Avanzato → Archiviato**. Un dispositivo che torna in Esper torna nell'elenco. 30 giorni dopo la sua uscita, il dispositivo viene eliminato, e con lui il suo elemento, a meno che non gli sia stato aggiunto qualcosa, dalla telemetria o da te.

### Ricevere un avviso quando un dispositivo smette di comunicare

In **Dispositivi gestiti**, fai clic su **Configura gli avvisi** nella riga della connessione e crea **Esper Android Device Stopped Checking In** e **Esper Apple Device Stopped Checking In**. Il primo apre un avviso per ogni dispositivo Android che non contatta Esper da più di un'ora, il secondo per ogni dispositivo Apple dopo più di un giorno, ciascuno con il nome del dispositivo e risolto appena il dispositivo torna a comunicare.

Ogni lettura della connessione registra quanti minuti fa ogni dispositivo ha contattato Esper l'ultima volta, come metrica `oneuptime.managed_device.check_in.age`, e il monitor controlla l'ultimo valore di ogni dispositivo ogni 5 minuti. Un dispositivo su cui gira anche l'Agent Android è lasciato a **Host Stopped Reporting**, così non genera mai due avvisi, e un dispositivo rimosso da Esper risolve il suo avviso. Una lettura che non riesce non registra nulla dei dispositivi, quindi nessuno dei loro avvisi si apre né si risolve finché una lettura non riesce di nuovo. Per una flotta che viene spenta di notte, alza la soglia del monitor.

Crea anche **Esper Security Patch Out of Date**: ogni dispositivo Android il cui livello patch di sicurezza, secondo Esper, risale a più di 90 giorni fa apre un proprio avviso, risolto quando il dispositivo viene aggiornato. Ogni lettura registra a quanti giorni fa risale il livello patch di ogni dispositivo Android, come metrica `oneuptime.managed_device.security_patch.age`. Un dispositivo su cui gira l'Agent Android è lasciato al **Security Patch Out of Date** del suo host, così non genera mai due avvisi.

Crea anche **Esper Low Battery** ed **Esper Storage Nearly Full**: ogni dispositivo la cui batteria, secondo l'ultima lettura di Esper, è sotto il 20% apre un proprio avviso, e così ogni dispositivo la cui archiviazione è piena oltre il 90%, ciascuno risolto quando il dispositivo viene ricaricato o torna ad avere spazio. Ogni lettura registra entrambi, come metriche `oneuptime.managed_device.battery.level` e `oneuptime.managed_device.storage.used`. Un dispositivo su cui gira l'Agent Android è lasciato a **Low Battery** e **Storage Nearly Full** del suo host, che avvisano agli stessi livelli, così non genera mai due avvisi.

Gli avvisi di un dispositivo sono anche sul suo elemento: la sua scheda **Esper** elenca gli incidenti e gli avvisi aperti su di esso, ciascuno con un link alla sua pagina, e le pagine **Avvisi** e **Incidenti** di un dispositivo che l'Agent Android non segnala elencano tutti quelli che i monitor della sua connessione hanno generato su di esso.

### Ricevere un avviso quando la connessione non viene più letta

Crea **Esper Connection Stopped Reading**, e la connessione apre un proprio avviso non appena nessuna sua lettura riesce da tanto tempo quanto la sua riga attende prima che il suo **Stato** dica **Non aggiornato**: tre dei suoi intervalli di lettura più dieci minuti, e mai meno di mezz'ora, quindi 55 minuti con l'intervallo predefinito di 15. Il suo primo passaggio di debug elenca gli ultimi valori della connessione, ciascuno con l'errore con cui la sua lettura non è riuscita, e la prima lettura che riesce lo risolve. Ogni lettura, e ogni lettura per cui la connessione diventa dovuta, registra quanti minuti sono passati dall'ultima riuscita, come metrica `oneuptime.managed_device.connection.read.age`. Il monitor attende quanto dice l'intervallo di lettura della connessione al momento della sua creazione, e una connessione disattivata non registra nulla, quindi un avviso aperto resta aperto finché non lo risolvi.

## Importare dispositivi da Microsoft Intune

Collega un tenant Microsoft Intune, e ogni dispositivo gestito da Intune è nell'inventario: i suoi PC Windows, Mac, iPhone, iPad, dispositivi Android e macchine Linux. Ogni dispositivo è un host, con ciò che Intune sa di lui: la sua categoria, il sistema operativo e la sua versione, il numero di serie e l'IMEI, la conformità, la proprietà e la registrazione, l'archiviazione e le app che Intune vi ha rilevato. Intune non invia nulla da solo, quindi OneUptime lo legge secondo una pianificazione: i dispositivi ogni 15 minuti, e le app di ogni dispositivo ogni 6 ore.

:::steps
### Registra un'app in Microsoft Entra

Nell'interfaccia di amministrazione di Microsoft Entra, apri `App registrations` e fai clic su `New registration`. Dalle un nome, lascia `Accounts in this organizational directory only` e registrala. La sua pagina `Overview` mostra i due ID che chiede OneUptime: l'`Application (client) ID` e il `Directory (tenant) ID`.

### Consentile di leggere i dispositivi di Intune

In `API permissions`, fai clic su `Add a permission`, poi su `Microsoft Graph`, poi su `Application permissions`, e aggiungi `DeviceManagementManagedDevices.Read.All`. Poi fai clic su `Grant admin consent`, cosa che può fare solo un amministratore del tenant. Quest'unica autorizzazione è tutto ciò che serve a OneUptime: elenca i dispositivi e le app che Intune vi ha rilevato, e non può cambiare nulla.

### Crea un segreto client

In `Certificates & secrets`, fai clic su `New client secret` e copia il suo `Value`, non il suo `Secret ID`: Microsoft mostra il valore una sola volta. Un segreto smette di funzionare quando scade, quindi prima che succeda creane uno nuovo e inseriscilo modificando la connessione.

### Collega il tenant Intune

Vai su **Prodotti → Risorse → Inventario**, poi su **Dispositivi gestiti**, fai clic su **Collega un gestore dei dispositivi** e scegli **Microsoft Intune**. Inserisci l'**ID del tenant**, l'**ID applicazione (client)** e il **Client Secret**. Se il tenant è in un cloud del governo statunitense, sceglilo come **Cloud** in **Altri campi**. **Collega** prova la registrazione dell'app prima di salvare qualsiasi cosa: dice quanti dispositivi importerà una lettura, oppure cosa non va e come correggerlo.
:::

Un dispositivo contatta Intune circa ogni otto ore, e il suo ultimo contatto è l'ultima volta che l'ha fatto: un dispositivo che non lo fa da un giorno è **Offline**. Le sue app sono quelle che Intune vi ha rilevato, che Microsoft Graph elenca solo nella sua versione beta: per un dispositivo personale, le app gestite da Intune. I gruppi di Intune sono gruppi di Microsoft Entra, che questa autorizzazione non legge, quindi il gruppo di un dispositivo è la sua categoria di dispositivo. Non viene letto nulla sull'utente di un dispositivo.

Intune dà a un dispositivo il nome che gli ha dato il suo proprietario, quindi due dispositivi possono avere lo stesso nome: ogni iPhone che nessuno ha rinominato si chiama `iPhone`. Un nome che hanno due dispositivi di una connessione non è di nessuno dei due nell'inventario: ciascuno prende invece il nome dal suo numero di serie, e riprende il suo nome appena nessun altro dispositivo lo ha.

Per ricevere un avviso quando un dispositivo smette di comunicare, fai clic su **Configura gli avvisi** nella riga della connessione e crea **Intune Device Stopped Checking In**. Apre un avviso per ogni dispositivo che non contatta Intune da più di un giorno, con il nome del dispositivo. Un portatile spento per un fine settimana appare allo stesso modo, quindi alza la soglia del monitor se un giorno è troppo poco per i tuoi. **Intune Security Patch Out of Date** genera un avviso per ogni dispositivo Android il cui livello patch di sicurezza risale a più di 90 giorni fa, come il modello di Esper. **Intune Storage Nearly Full** e **Intune Connection Stopped Reading** generano avvisi come i modelli di Esper. Non viene offerto alcun avviso sulla batteria, perché l'elenco dei dispositivi di Intune non riporta il livello della batteria.

## Importare dispositivi da Workspace ONE UEM

Collega un server Workspace ONE UEM, e ogni dispositivo che gestisce è nell'inventario: i suoi iPhone, iPad, Mac, PC Windows, dispositivi Android e macchine Linux. Ogni dispositivo è un host, con ciò che Workspace ONE sa di lui: il suo gruppo organizzativo, il sistema operativo e la sua versione, il modello, il numero di serie e l'IMEI, la conformità, la registrazione e la proprietà, la batteria, l'archiviazione e la memoria, e le sue app. Workspace ONE non invia nulla da solo, quindi OneUptime lo legge secondo una pianificazione: i dispositivi ogni 15 minuti, e le app di ogni dispositivo ogni 6 ore.

:::steps
### Crea un ruolo di sola lettura

Nella console di Workspace ONE UEM, vai su `Accounts`, poi su `Administrators`, poi su `Roles`, e fai clic su `Add Role`. In `API`, poi in `REST`, seleziona `Read` per `Devices` e per `Apps`, e nient'altro. Quel ruolo è tutto ciò che serve a OneUptime: elenca i dispositivi e le loro app, e non può cambiare nulla.

### Crea un client OAuth

Vai su `Groups & Settings`, poi su `Configurations`, poi su `OAuth Client Management`, e fai clic su `Add`. Scegli il gruppo organizzativo di cui OneUptime legge i dispositivi, e assegna al client il ruolo che hai creato. Copia il suo `Client ID` e il suo `Client Secret`: Workspace ONE mostra il segreto una sola volta.

### Collega il server

Vai su **Prodotti → Risorse → Inventario**, poi su **Dispositivi gestiti**, fai clic su **Collega un gestore dei dispositivi** e scegli **Workspace ONE UEM**. Inserisci l'**URL dell'API REST**, che mostra `Groups & Settings`, `All Settings`, `System`, `Advanced`, `API`, `REST API`, come `https://as1234.awmdm.com`. Lascia **Client OAuth** in **Accedi con**, inserisci il **Client ID** e il **Client Secret**, e scegli la **Regione** del servizio token del tuo data center. **Collega** prova il client prima di salvare qualsiasi cosa: dice quanti dispositivi importerà una lettura, oppure cosa non va e come correggerlo.
:::

Un server Workspace ONE on-premise non ha un servizio token: scegli **Account amministratore** in **Accedi con**, e inserisci il **Nome utente** e la **Password** di un amministratore con il ruolo di sola lettura e la **Chiave API REST** dalle stesse impostazioni REST API, dove deve essere consentita l'autenticazione di base. OneUptime Cloud legge solo server su internet pubblico, quindi un server su una rete privata viene letto da un OneUptime self-hosted.

Un dispositivo comunica con Workspace ONE secondo una sua pianificazione, un iPhone a ore di distanza, quindi un dispositivo che non lo fa da un giorno è **Offline**. Un dispositivo non più registrato viene escluso. Un dispositivo prende il nome che comunica, non il suo nome descrittivo, che Workspace ONE compone con il nome del suo utente, e non viene letto nulla sull'utente di un dispositivo. Ogni richiesta conta nella quota API giornaliera del tenant, quindi una lettura legge le app di al massimo 25 dispositivi, e la lettura successiva quelle dei successivi.

Un'app o l'Agent Android che invia telemetria da un dispositivo si unisce a esso in un unico elemento tramite il numero di serie del dispositivo: assegna all'impostazione `device_serial` dell'Agent Android il valore di ricerca `{DeviceSerialNumber}` nella sua configurazione gestita.

Per ricevere un avviso quando un dispositivo smette di comunicare, fai clic su **Configura gli avvisi** nella riga della connessione e crea **Workspace ONE Device Stopped Checking In**. Apre un avviso per ogni dispositivo che non comunica con Workspace ONE da più di un giorno, con il nome del dispositivo. **Workspace ONE Security Patch Out of Date** genera un avviso per ogni dispositivo Android il cui livello patch di sicurezza risale a più di 90 giorni fa, come il modello di Esper. **Workspace ONE Low Battery**, **Workspace ONE Storage Nearly Full** e **Workspace ONE Connection Stopped Reading** generano avvisi come i modelli di Esper.

## Importare dispositivi da SOTI MobiControl

Collega un server SOTI MobiControl, nel cloud di SOTI o on-premise, e ogni dispositivo che gestisce è nell'inventario: i suoi dispositivi Android rugged, telefoni, tablet e scanner, i suoi iPhone, iPad e Mac, e i suoi computer Windows e Linux. Ogni dispositivo è un host, con ciò che MobiControl sa di lui: il suo gruppo di dispositivi, il sistema operativo e la sua versione, il modello, il numero di serie e l'IMEI, la conformità, l'agent, la batteria, l'archiviazione e la memoria, e le sue applicazioni installate. MobiControl non invia nulla da solo, quindi OneUptime lo legge secondo una pianificazione: i dispositivi ogni 15 minuti, e le app di ogni dispositivo ogni 6 ore.

:::steps
### Crea un utente MobiControl di sola lettura

Nella console web di MobiControl, aggiungi un utente proprio di MobiControl, non un utente SOTI Identity. Consenti `Web Console Access` e `View Installed Applications` nelle sue autorizzazioni generali e nient'altro, e assegnagli `View Groups` sui gruppi di dispositivi che OneUptime legge. Quell'utente è tutto ciò che serve a OneUptime: può vedere i dispositivi e le loro app, e non può cambiare nulla.

### Crea un client API

Nella console web, vai su `Global Settings`, poi su `Services`, poi su `API Client`, e aggiungine uno. Copia il suo `Client ID` e il suo `Client Secret`: MobiControl mostra il segreto una sola volta. Su un server precedente a MobiControl 2024.0, crealo sul server stesso con `MCAdmin.exe APIClientAdd -n:OneUptime`.

### Collega il server MobiControl

Vai su **Prodotti → Risorse → Inventario**, poi su **Dispositivi gestiti**, fai clic su **Collega un gestore dei dispositivi** e scegli **SOTI MobiControl**. Inserisci il **Server**, l'indirizzo della tua console web senza `/MobiControl`, come `https://acme.mobicontrolcloud.com`, e il **Client ID** e il **Client Secret** del client API, poi il **Nome utente** e la **Password** dell'utente. **Collega** prova l'accesso prima di salvare qualsiasi cosa: dice quanti dispositivi importerà una lettura, oppure cosa non va e come correggerlo.
:::

Un agent MobiControl mantiene una connessione permanente con il suo server, quindi un dispositivo il cui agent è connesso è online, e uno il cui agent non è connesso da 30 minuti è **Offline**. Un iPhone, un iPad o un Mac comunica tramite il servizio push di Apple, a ore di distanza, ed è **Offline** dopo un giorno. Un dispositivo che un amministratore ha disabilitato è **Disabilitato**, e uno in fase di annullamento della registrazione viene escluso. OneUptime Cloud legge solo server su internet pubblico, quindi un server su una rete privata viene letto da un OneUptime self-hosted. Non viene letto nulla sull'utente di un dispositivo.

Un'app o l'Agent Android che invia telemetria da un dispositivo si unisce a esso in un unico elemento tramite il numero di serie del dispositivo: assegna all'impostazione `device_serial` dell'Agent Android la macro `%SERIALNUM%` nella sua configurazione gestita.

Per ricevere un avviso quando un dispositivo smette di comunicare, fai clic su **Configura gli avvisi** nella riga della connessione e crea **SOTI Device Stopped Checking In** e **SOTI Apple Device Stopped Checking In**. Il primo apre un avviso per ogni dispositivo Android, Windows o Linux il cui agent non è connesso da più di un'ora, e il secondo per ogni dispositivo Apple che non comunica da più di un giorno, ciascuno con il nome del dispositivo. **SOTI Security Patch Out of Date** genera un avviso per ogni dispositivo Android il cui livello patch di sicurezza risale a più di 90 giorni fa, come il modello di Esper. **SOTI Low Battery**, **SOTI Storage Nearly Full** e **SOTI Connection Stopped Reading** generano avvisi come i modelli di Esper.

## Aggiungere qualcosa a mano

Aggiungi un elemento per qualcosa che OneUptime non vedrà mai da solo, così che una dipendenza finisca su qualcosa di reale e la cosa possa portare i tuoi campi personalizzati.

:::steps
### Aprire Tutti gli elementi

Vai su **Prodotti → Risorse → Inventario**, poi su **Tutti gli elementi**.

### Aggiungere l'elemento

Fai clic su **Aggiungi: Elemento**. Scegli il suo **Tipo**, dagli un **Nome** e, se vuoi, una **Descrizione**. Nome e tipo insieme sono l'identità dell'elemento, quindi due elementi dello stesso tipo non possono avere lo stesso nome.

### Compilare i suoi campi personalizzati

Apri il nuovo elemento. La sua fonte indica **Aggiunto da te**, e la sua pagina **Campi personalizzati** accoglie i valori che il tuo progetto segue.
:::

Puoi aggiungere a mano tre tipi:

- `external.service` (**Servizio esterno**): un'API di terze parti o una dipendenza software-as-a-service.
- `external.database` (**Database esterno**): un database che non è un server che OneUptime può modellare. Un server di database, self-hosted o gestito, da PostgreSQL a Snowflake, va invece in **Database → Crea: Database** ([Database](/docs/telemetry/databases)): quel record si collega alle tracce, ai container e alle metriche del motore che nominano lo stesso indirizzo, cosa che un elemento dell'inventario non fa mai, e aggiungere lo stesso server in entrambi i modi lascia due record scollegati.
- `appliance` (**Appliance**): hardware o software senza agente.

La restrizione evita i duplicati. Un elemento creato a mano di un tipo che OneUptime può osservare, come un host, sarebbe identificato dal nome che hai scritto, mentre l'elemento scoperto della stessa macchina è identificato dagli attributi che segnala. I due non si unirebbero mai, e lo stesso host comparirebbe due volte nel tuo elenco, per sempre.

## Archiviare invece di eliminare

Archiviare toglie un elemento dall'elenco mentre conserva la sua identità, la sua cronologia e i valori dei suoi campi personalizzati. Dice: l'ho visto e non lo voglio nel mio elenco. Un elemento archiviato continua a raccogliere telemetria.

| Fonte | Archiviare | Eliminare |
| --- | --- | --- |
| **Rilevato** | Resta archiviato. | Torna con il prossimo batch della sua telemetria. |
| **Replicato** | Resta archiviato. | Torna con la copia successiva. Elimina invece il record originale. |
| **Aggiunto da te** | Resta archiviato. | Sparisce per sempre. |

Per archiviare elementi, selezionali in **Tutti gli elementi** e archiviali in un colpo solo, oppure apri un elemento e usa la scheda **Archivia** della sua pagina **Impostazioni**. Gli elementi archiviati si trovano in **Inventario → Avanzato → Archiviato**, dove puoi selezionarli e ripristinarli.

> [!NOTE]
> Quando un dispositivo replicato viene rimosso dal suo record di origine, OneUptime rimuove anche il suo elemento, a meno che l'elemento porti valori di campi personalizzati che hai inserito. Quei valori sono l'unica copia e non c'è modo di annullare, quindi l'elemento viene archiviato invece che eliminato. Lo troverai in **Avanzato → Archiviato** con tutto ciò che hai scritto intatto.

## Relazioni e topologia

OneUptime collega gli elementi con relazioni orientate man mano che le osserva. **Inventario → Mappa della topologia** le disegna, e la pagina **Connessioni** di un elemento elenca le sue. Vedi [Topologia](/docs/telemetry/topology).

| Relazione | Per esempio |
| --- | --- |
| `runs-on` | Un pod gira su un nodo; una macchina virtuale gira sul suo host. |
| `member-of` | Un pod, un nodo o un namespace è membro di un cluster. |
| `hosted-on` | Un servizio è ospitato su un host. |
| `part-of` | Un pod fa parte del suo deployment. |
| `depends-on` | Un servizio ne chiama un altro, secondo gli span che passano dall'uno all'altro. |

## Passaggi successivi

:::cards
- [Campi personalizzati dell'inventario](/docs/inventory/custom-fields): Tenere traccia di numeri di serie, date di garanzia, proprietari e stato del ciclo di vita.
- [Esportare in un CMDB](/docs/inventory/cmdb-sync): Portare il catalogo nel tuo sistema di riferimento.
- [Database](/docs/telemetry/databases): Monitorare i server di database usati dai tuoi servizi.
:::
