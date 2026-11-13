# Monitor certificato SSL

Un monitor del certificato SSL controlla i certificati TLS che presentano i vostri siti e servizi, come fa un browser, e vi avvisa prima che scadano. Mette anche il monitor offline quando un certificato non è più valido: scaduto, revocato dal suo emittente, autofirmato, emesso per un altro nome host o da un'autorità di cui i browser non si fidano.

:::cards
- [Creare il monitor](#creare-un-monitor-del-certificato-ssl): Sei passaggi nella dashboard.
- [Criteri predefiniti](#criteri-predefiniti): Un avviso di scadenza con 14 giorni di anticipo, senza configurare nulla.
- [Criteri di monitoraggio](#criteri-di-monitoraggio): Validità, scadenza, revoca e certificati autofirmati.
- [Risoluzione dei problemi](#risoluzione-dei-problemi): Certificati autofirmati e interni, e la verifica della revoca.
:::

## Come funziona

A ogni controllo, una sonda apre una connessione TLS verso l'host e la porta dell'URL, la porta `443` a meno che l'URL non ne indichi un'altra, e verifica il certificato come farebbe un browser: un emittente affidabile, un nome host che corrisponde e date che includono oggi. Se il certificato non supera la verifica, la sonda lo legge comunque, quindi la sua data di scadenza, il suo emittente e le sue impronte vengono registrati in ogni caso. Una connessione che fallisce, va in timeout o presenta un certificato non valido viene ritentata, fino al numero di tentativi che consentite. Poi OneUptime valuta il risultato con i criteri del monitor.

Un certificato che supera questi controlli viene anche controllato per la revoca, come fa un browser. La sonda legge la risposta OCSP che il server invia con il suo certificato, se ce n'è una, poi interroga il responder OCSP dell'emittente indicato nel certificato e, solo se questo non dà risposta, legge l'elenco di revoca dei certificati (CRL) dell'emittente. Si fida solo di una risposta aggiornata firmata dall'emittente o da un responder che l'emittente ha autorizzato, e controlla il certificato del server stesso, non quelli intermedi. Un certificato revocato non è valido. Quando non si riesce ad avere una risposta firmata, lo stato di revoca è sconosciuto e, come in un browser, il certificato non viene trattato come revocato.

Una risposta viene conservata fino al prossimo aggiornamento dell'emittente, per al massimo un'ora, e una ricerca non riuscita viene ritentata dopo 5 minuti. Così un nuovo certificato viene controllato subito, e un certificato revocato mentre è in uso viene rilevato entro un'ora.

```mermaid title="Come i criteri predefiniti giudicano un certificato"
flowchart TB
    connect["Handshake TLS,<br/>verificato come un browser"] --> valid{"Certificato valido?"}
    valid -->|"No, o nessuna risposta"| offline["Offline, incidente dichiarato"]
    valid -->|"Sì"| soon{"Scade entro<br/>14 giorni?"}
    soon -->|"Sì"| alert["Avviso, stato invariato"]
    soon -->|"No"| ok["Operativo"]
```

Una sonda che ha perso la propria connessione di rete non riporta alcun risultato, quindi non può segnare il vostro certificato come non valido.

## Prima di iniziare

- **Un ruolo che può creare monitor**: Project Owner, Project Admin, Project Member, Monitor Admin o Monitor Member, oppure un ruolo personalizzato con il permesso Create Monitor.
- **Una sonda che raggiunga l'host e la porta.** Le sonde predefinite del vostro progetto vengono scelte per ogni nuovo monitor. Un servizio su una rete privata ha bisogno di una [sonda personalizzata](/docs/probe/custom-probe) in quella rete.

## Creare un monitor del certificato SSL

:::steps
### Iniziare un nuovo monitor

Andate in **Monitor** e fate clic su **Crea monitor**. In **Tipo di monitor**, scegliete **Certificato SSL**.

### Dargli un nome

Inserite un **Nome**, come `example.com certificate`, poi fate clic su **Avanti**.

### Inserire l'URL

In **URL sito web**, inserite il sito di cui controllare il certificato, come `https://example.com`. Per un servizio su un'altra porta, includetela: `https://example.com:8443`.

### Testarlo

Fate clic su **Testa il monitor**, scegliete una sonda in **Seleziona sonda** e fate clic su **Esegui test**. **Risultato del test del monitor** mostra il certificato ricevuto dalla sonda, con il suo emittente e la sua data di scadenza.

### Rivedere i criteri

**Criteri** parte dai [criteri predefiniti](#criteri-predefiniti): offline quando il certificato non è valido, un avviso quando scade entro 14 giorni. Modificateli se serve, poi fate clic su **Avanti**.

### Scegliere le sonde e creare

Mantenete o cambiate le **Sonde** e l'**Intervallo di monitoraggio** (parte da **Ogni 5 minuti**; ai monitor del certificato SSL vengono offerti 5 minuti o più), poi fate clic su **Crea monitor**. Si apre la pagina del monitor.
:::

## Opzioni di configurazione

| Campo | Predefinito | Cosa inserire |
| --- | --- | --- |
| **URL sito web** | Nessuno | Il sito di cui controllare il certificato, come `https://example.com` o `https://example.com:8443`. Vengono usati solo l'host e la porta; il percorso viene ignorato. |
| **Timeout della richiesta (secondi)** (sotto **Altri campi**) | `60` | Quanto attendere l'handshake TLS a ogni tentativo. Il massimo è 60 secondi. |
| **Tentativi in caso di errore** (sotto **Altri campi**) | Predefinito della sonda, di solito `3` | Quante volte ritentare un tentativo fallito. Il massimo è 3. |

**Tentativi in caso di errore** conta i nuovi tentativi _dopo_ il primo, quindi `0` esegue il controllo una volta e `2` fino a tre volte. Se lo lasciate vuoto, usa il predefinito della sonda: 3, a meno che `PROBE_MONITOR_RETRY_LIMIT` della sonda non dica altro. Gli errori di connessione, gli errori di convalida del certificato e i timeout vengono tutti ritentati, con una pausa di un secondo tra un tentativo e l'altro.

## Criteri di monitoraggio

I criteri decidono quando il certificato conta come buono, degradato o guasto, e se questo dichiara un incidente o crea un avviso. Ogni criterio controlla uno o più filtri:

| Filtro | Condizioni | Cosa controlla |
| --- | --- | --- |
| **Certificato valido** | **Vero**, **Falso** | Il certificato supera i controlli di un browser: un emittente affidabile, un nome host che corrisponde, date che includono oggi e nessuna revoca da parte del suo emittente. **Falso** quando l'endpoint non ha risposto. |
| **Certificato non valido** | **Vero**, **Falso** | Il contrario di **Certificato valido**: **Vero** quando il certificato non supera quei controlli o non è stato possibile controllarlo. |
| **Certificato scaduto** | **Vero**, **Falso** | La data di scadenza del certificato è passata. |
| **Certificato revocato** | **Vero**, **Falso** | L'emittente del certificato lo ha revocato. **Falso** quando l'emittente dice che non è revocato, e quando non è stato possibile verificarlo. |
| **Certificato autofirmato** | **Vero**, **Falso** | Il certificato, o uno della sua catena, è autofirmato. |
| **Giorni alla scadenza** | **Maggiore di**, **Minore di**, **Maggiore o uguale a**, **Minore o uguale a** | I giorni che mancano alla scadenza del certificato. |
| **Ore alla scadenza** | **Maggiore di**, **Minore di**, **Maggiore o uguale a**, **Minore o uguale a** | Le ore che mancano alla scadenza del certificato. |

**Giorni alla scadenza** conta giorni interi: a un certificato che scade tra 14 giorni e 20 ore restano 14 giorni. **Ore alla scadenza** conta ore intere allo stesso modo.

Con due o più filtri, **Condizione di corrispondenza** decide se devono corrispondere **Tutti** o se basta **Qualsiasi** filtro. Le **Azioni** di un criterio decidono cosa fa: cambiare lo stato del monitor, creare un avviso, dichiarare un incidente, o più di queste cose.

### Criteri predefiniti

Un nuovo monitor del certificato SSL parte con tre criteri, così vi avvisa prima che un certificato scada senza configurare nulla:

1. **Il certificato non è valido** — il certificato è scaduto, è stato revocato dal suo emittente, è autofirmato, è stato emesso per un altro nome host o da un'autorità non affidabile, oppure non è stato possibile controllarlo perché l'endpoint non ha risposto. Il monitor viene segnato **Offline** e viene creato un incidente chiamato «_monitor name_ certificate is not valid». La sua causa principale dice quale di questi casi era e, per un certificato revocato, quando e perché il suo emittente lo ha revocato. L'incidente si risolve da solo appena il certificato torna valido.
2. **Il certificato scade presto** — il certificato è valido ma scade entro 14 giorni. Viene creato un **avviso** chiamato «_monitor name_ certificate expires soon».
3. **Il certificato è valido** — il monitor viene segnato **Operativo**.

L'avviso «scade presto» è un avviso, non un incidente: non compare sulle vostre pagine di stato, non chiama nessuno a meno che non gli aggiungiate una policy di reperibilità, e non cambia lo stato del monitor. Usa la seconda gravità di avviso del vostro progetto, **Basso** in un nuovo progetto. Quando viene rilevato il certificato rinnovato, il monitor torna su «Il certificato è valido» e l'avviso si risolve da solo.

I criteri vengono controllati dall'alto verso il basso, e il primo che corrisponde decide cosa succede. Per questo «scade presto» sta sopra «è valido»: un certificato in scadenza è ancora valido, quindi corrisponderebbe a entrambi.

Per essere avvisati prima, cambiate il valore del filtro **Giorni alla scadenza** nel criterio «scade presto», per esempio in `30`. Per far chiamare qualcuno invece, aprite le **Azioni** di quel criterio: attivate **Quando i filtri corrispondono, dichiara un incidente.**, oppure tenete l'avviso e aggiungetegli una policy di reperibilità in **Policy di reperibilità**.

:::details Aggiungere l'avviso a un monitor creato prima che esistesse
I monitor creati prima che OneUptime aggiungesse questo avviso non hanno un criterio «scade presto». Per aggiungerlo:

1. Sul monitor, aprite **Configurazione → Criteri** e fate clic su **Modifica criteri**.
2. Fate clic su **Aggiungi criteri**. Impostate il suo filtro su **Certificato valido** / **Vero**, fate clic su **Aggiungi filtro** e impostate il secondo su **Giorni alla scadenza** / **Minore o uguale a** / `14`. Lasciate **Condizione di corrispondenza** su **Tutti** (compare sotto i filtri quando ce ne sono due).
3. In **Azioni**, attivate **Quando i filtri corrispondono, crea un avviso.** e lasciate disattivato **Quando i filtri corrispondono, modifica lo stato del monitor.**, così crea un avviso e non cambia lo stato del monitor.
4. Trascinate il nuovo criterio sopra il criterio che segna il monitor come online, poi salvate.
:::

### Esempi di criteri

| Obiettivo | Filtro | Condizione | Valore |
| --- | --- | --- | --- |
| Avvisare con un mese di anticipo | **Giorni alla scadenza** | **Minore o uguale a** | `30` |
| Chiamare qualcuno l'ultimo giorno | **Ore alla scadenza** | **Minore di** | `24` |
| Offline solo quando il certificato è scaduto | **Certificato scaduto** | **Vero** | — |
| Segnalare un certificato autofirmato | **Certificato autofirmato** | **Vero** | — |
| Chiamare il team di sicurezza quando l'emittente revoca il certificato | **Certificato revocato** | **Vero** | — |

Un criterio sulla scadenza deve stare sopra il criterio che segna il certificato come valido: un certificato in scadenza è ancora valido, e vince il primo criterio che corrisponde. Allo stesso modo, un certificato revocato non è nemmeno valido, quindi un criterio su **Certificato revocato** deve stare sopra il criterio «non è valido».

## Buone pratiche

1. **Datevi il tempo di rinnovare** — L'avviso predefinito arriva 14 giorni prima della scadenza, il che va bene per i certificati che si rinnovano da soli. Se per voi rinnovare richiede più tempo (un certificato acquistato, o un processo di modifica), portatelo a 30 giorni.
2. **Monitorate ogni endpoint** — Se avete più domini o sottodomini, create un monitor per ciascuno. Ognuno può avere il proprio certificato.
3. **Includete le altre porte** — Anche i servizi che offrono TLS su una porta diversa da `443`, come `8443`, hanno certificati. Mettete la porta nell'URL.
4. **Controllate dopo il rinnovo** — Dopo aver rinnovato un certificato, guardate il risultato successivo del monitor: la data di scadenza mostrata dovrebbe essere quella nuova.

## Risoluzione dei problemi

:::details Il certificato va bene nel mio browser, ma il monitor dice che non è valido
La causa principale dell'incidente dice perché. Un caso comune è un server che invia il suo certificato senza i certificati intermedi: i browser spesso colmano la lacuna da soli, la sonda no. Configurate il server perché invii la catena completa. Un altro è un URL il cui nome host non è nel certificato.
:::

:::details Monitoro un servizio interno con un certificato autofirmato
Un certificato autofirmato non è mai valido, quindi i criteri predefiniti tengono il monitor offline. **Certificato autofirmato**, **Certificato scaduto** e **Giorni alla scadenza** funzionano comunque con esso, quindi costruite i criteri su questi. In **Configurazione → Criteri**:

1. Nel criterio «non è valido», fate clic su **Aggiungi filtro**, impostate il nuovo filtro su **Certificato autofirmato** / **Falso** e impostate **Condizione di corrispondenza** su **Tutti**. Il criterio mette ancora il monitor offline quando l'endpoint non risponde, o il certificato è sbagliato in un altro modo.
2. Aggiungete un criterio con **Certificato scaduto** / **Vero** che segni il monitor **Offline** e dichiari un incidente, e trascinatelo in cima.
3. Nel criterio «scade presto», sostituite **Certificato valido** / **Vero** con **Certificato scaduto** / **Falso**, così l'avviso copre anche il certificato autofirmato.

Finché il certificato è valido nel tempo, nessun criterio corrisponde e il monitor mostra il suo stato predefinito, **Operativo**.
:::

:::details Il monitor è offline con «could not be checked because the endpoint is not reachable»
La sonda non è riuscita ad aprire una connessione TLS verso l'host e la porta. Controllate la porta nell'URL, e che un firewall lasci passare le sonde. Un host su una rete privata ha bisogno di una [sonda personalizzata](/docs/probe/custom-probe).
:::

:::details Non è stato possibile verificare lo stato di revoca del certificato
Quando la sonda non riesce ad avere una risposta firmata dall'emittente del certificato, il riepilogo del monitor mostra **Stato di revoca** come **Impossibile verificare**, e **Problema nella verifica della revoca**, sotto **Mostra altri dettagli**, dice perché: il certificato non indica alcun responder OCSP né alcuna CRL, l'emittente non ha risposto in tempo, oppure non è stato possibile verificare la sua risposta. Come in un browser, un certificato del genere non viene trattato come revocato, e la sonda chiede di nuovo dopo 5 minuti.

Una [sonda personalizzata](/docs/probe/custom-probe) senza accesso a Internet non può raggiungere alcun emittente. Controlla comunque i certificati: attende qualche secondo ogni responder che non riesce a raggiungere, circa una volta ogni 5 minuti. Per farle smettere di chiedere, impostate `PROBE_CERTIFICATE_REVOCATION_CHECK_ENABLED` su `false` sulla sonda e riavviatela.
:::

## Passaggi successivi

:::cards
- [Monitor sito web](/docs/monitor/website-monitor): Controllare che il sito stesso risponda.
- [Monitor dominio](/docs/monitor/domain-monitor): Essere avvisati prima che la registrazione del dominio scada.
- [Regole di escalation](/docs/on-call/escalation-rules): Decidere chi viene chiamato dagli avvisi e dagli incidenti.
- [Panoramica degli incidenti](/docs/incidents/index): Cosa succede dopo che il monitor ne ha dichiarato uno.
:::
