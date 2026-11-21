# Cloudflare

Importa negli eventi di sicurezza di OneUptime ciò che il firewall di [Cloudflare](https://www.cloudflare.com) ha fatto all'edge: le richieste che le sue regole WAF gestite e personalizzate, la limitazione della frequenza, le IP Access Rules, la gestione dei bot e la protezione DDoS HTTP hanno bloccato, sottoposto a challenge o registrato. Ognuna sta accanto alle richieste della tua app, così un caso dice cosa ha fermato Cloudflare e cosa ha comunque raggiunto la tua app. OneUptime le legge con un token API che può solo leggere, e non cambia nulla in Cloudflare finché non attivi il blocco, che vi applica la tua blocklist.

:::cards
- [Configurare la connessione](#configurare-la-connessione): Un token API con due permessi di lettura, e il modulo della connessione.
- [Cosa viene importato](#cosa-viene-importato): Quali eventi, e come ognuno diventa un evento di sicurezza.
- [Come funziona il polling](#come-funziona-il-polling): La finestra che legge ogni interrogazione, e perché si sovrappone di 10 minuti.
- [Bloccare indirizzi su Cloudflare](#bloccare-indirizzi-su-cloudflare): La tua blocklist, applicata da due liste IP e una regola personalizzata per lista.
- [Risoluzione dei problemi](#risoluzione-dei-problemi): Cosa significa ogni errore e cosa cambiare.
:::

## Come funziona

```mermaid title="Da una richiesta trattata da Cloudflare a un evento di sicurezza"
flowchart TB
    edge["Il firewall di<br/>Cloudflare tratta<br/>una richiesta"] --> poll["OneUptime interroga<br/>all'intervallo<br/>della connessione"]
    poll --> zones["Legge gli eventi<br/>del firewall di ogni<br/>zona dall'ultima<br/>volta"]
    zones --> event["Ognuno è salvato<br/>come evento<br/>HTTP Activity"]
```

Ogni minuto, OneUptime interroga ogni connessione abilitata il cui intervallo di interrogazione è trascorso. Un'interrogazione elenca le zone dell'account, legge dal nodo settings della GraphQL Analytics API cosa consente il piano di ogni zona, e legge gli eventi del firewall di ogni zona dall'ultima interrogazione dal dataset `firewallEventsAdaptive` ([Security Events](https://developers.cloudflare.com/waf/analytics/security-events/)), dai più vecchi. Ogni evento è salvato come evento [OCSF](https://schema.ocsf.io/) HTTP Activity.

## Prima di iniziare

- In OneUptime, il ruolo Proprietario del progetto, Amministratore del progetto o Amministratore della sicurezza. I ruoli Membro della sicurezza e Visualizzatore della sicurezza vedono le connessioni e la cronologia delle loro esecuzioni, ma non possono modificarle.
- Un utente Cloudflare che può creare token API per le zone dell'account.
- Zone il cui traffico passa per Cloudflare: i loro record DNS sono in proxy.
- HTTPS in uscita dall'app e dai worker di OneUptime verso `api.cloudflare.com`.

## Configurare la connessione

La connessione legge con un [token API](https://developers.cloudflare.com/fundamentals/api/get-started/create-token/), mai con una Global API Key: un token è limitato all'account e alle sue zone, e puoi revocarlo da solo. Servono due [permessi](https://developers.cloudflare.com/fundamentals/api/reference/permissions/), entrambi di sola lettura:

| Permesso | Cosa legge OneUptime con esso |
| --- | --- |
| `Zone > Zone > Read` | Le zone, con i loro account e piani. |
| `Zone > Analytics > Read` | Gli eventi del firewall di ogni zona, tramite la GraphQL Analytics API. |

:::steps
### Creare un token API

1. Nella dashboard di Cloudflare, apri **My Profile → API Tokens**, seleziona **Create Token** e scegli **Create Custom Token**.
2. Chiamalo `oneuptime-security-events`. In **Permissions**, aggiungi `Zone > Zone > Read` e `Zone > Analytics > Read`.
3. In **Zone Resources**, includi tutte le zone dell'account, o le zone da importare.
4. Seleziona **Continue to summary**, poi **Create Token**, e copia il token. Cloudflare lo mostra una sola volta.

### Aggiungere la connessione in OneUptime

Apri **Prodotti → Eventi di sicurezza → Connessioni** (`/dashboard/{projectId}/security-events/connections`), fai clic su **Aggiungi connessione**, scegli **Cloudflare** in **Sicurezza cloud** e fai clic su **Avanti**. Incolla il token in **Token API**. OneUptime elenca quindi gli account e le zone che il token può leggere: scegli l'**Account**, e in **Zone** lascia **Tutte le zone**, o scegli le zone da importare.

### Provarla prima di salvare

Fai clic su **Prova queste impostazioni** in **Testa prima di salvare**. Il test verifica ogni permesso con i valori del modulo, nomina quello che manca e non salva nulla. Poi fai clic su **Avanti**, dai alla connessione un **Nome** e creala.
:::

| Impostazione | Cosa inserire |
| --- | --- |
| **Account** | L'account Cloudflare da leggere, scelto tra gli account che il tuo token API legge. Un token che legge un solo account lo sceglie per te. |
| **Zone** | Facoltativo. Vuoto legge ogni zona attiva dell'account, comprese quelle aggiunte in seguito. Una connessione legge al massimo 50 zone. |
| **Token API** | Solo il token, senza `Bearer`. Viene cifrato, l'API non lo restituisce mai e non viene più mostrato. Sostituiscilo con **Aggiorna le credenziali** sulla connessione. |

Il passo **Interrogazione** ha anche una **Descrizione** facoltativa, l'**Intervallo di interrogazione (minuti)**, un numero intero da `1` a `1440` che parte da `5`, e **Abilitato**, che parte attivo. Gli eventi di Cloudflare sono richieste, non avvisi, quindi il modulo non chiede **Apri casi da**: i casi vengono dalle regole di rilevamento che li leggono.

### L'accesso in scrittura è una scelta a parte

Questa connessione non cambia nulla in Cloudflare finché non attivi il blocco, sulla sua riga. Solo allora OneUptime chiede i permessi di scrittura, e li verifica prima di bloccare qualcosa: [Bloccare indirizzi su Cloudflare](#bloccare-indirizzi-su-cloudflare) li nomina uno per uno e dice a cosa servono. Aggiungili al token solo quando attivi il blocco.

## Cosa viene importato

Ogni evento ha il fornitore `Cloudflare` e il prodotto `Cloudflare WAF`, ed è un evento HTTP Activity (`4002`).

| Campo di Cloudflare | Nell'evento di sicurezza |
| --- | --- |
| `clientIP` | L'IP principale, e `client.address` |
| `clientRequestHTTPHost`, `clientRequestPath`, `clientRequestQuery` | L'host di destinazione, la risorsa di destinazione (il percorso e la query), e `url.original` |
| `clientRequestHTTPMethodName`, `userAgent` | L'attività, `http.request.method` e `user_agent.original` |
| `action` | Lo stato, e `oneuptime.edge.action` |
| `source`, `ruleId`, `description` | L'ID della regola, il nome della regola, e `cloudflare.source` |
| `rayName`, `clientCountryName`, `clientAsn` | `cloudflare.ray_id`, `cloudflare.client.country` e `cloudflare.client.asn` |
| `sampleInterval` | `oneuptime.edge.sample_interval` |

| Cosa ha fatto Cloudflare | Stato | `oneuptime.edge.action` | Esito della richiesta | Gravità |
| --- | --- | --- | --- | --- |
| Bloccata, connessione chiusa, o challenge non superata | Blocked, o Dropped per una connessione chiusa | `blocked` | Rejected | Low |
| Risposto con una challenge gestita, JS o interattiva | Challenge | `challenged` | Rejected | Low |
| Una challenge superata, o un visitatore che ne aveva già superata una | Allowed | `passed-challenge` | Nessuno | Informational |
| Registrata e lasciata passare | Logged | `logged` | Il codice di stato dell'origine | Medium; High quando l'origine ha fallito; Low quando ha respinto la richiesta |
| Lasciata passare da una tua regola skip o allow | Allowed | `let-through` | Il codice di stato dell'origine | Come per una richiesta registrata |

Una richiesta che una delle tue regole skip o allow ha lasciato passare è importata solo se porta un attacco (SQL injection, path traversal o una ricerca Log4Shell), o se il WAF attack score di Cloudflare la considera tale. Il resto è traffico che consenti di proposito, come i tuoi monitor: ogni esecuzione lo conta e lo lascia fuori.

Cloudflare campiona gli eventi di una zona molto trafficata. Ogni evento mantiene il suo intervallo di campionamento, il numero di richieste simili che rappresenta, e ogni conteggio che OneUptime ne ricava dice *circa*.

Gli eventi compaiono in Eventi, in Campagne (richieste di attacco per indirizzo), nel rischio delle entità e nelle regole di rilevamento. Un caso su un indirizzo mostra, in **All'edge** nel suo impatto, cosa ha fatto Cloudflare con le richieste dell'indirizzo accanto a ciò che ha raggiunto la tua app. Le regole Cloudflare della libreria le leggono come vengono importate qui: molte corrispondenze di regole gestite da un indirizzo, un indirizzo che ha superato una challenge e poi inviato attacchi, e un attacco che Cloudflare ha lasciato passare e che ha raggiunto la tua app.

## Limiti dei piani

Ogni piano ha gli eventi del firewall tramite l'API. **What each zone's plan gives**, in **Testa la connessione**, legge da Cloudflare i limiti propri di ogni zona.

| Piano | Free | Pro | Business | Enterprise |
| --- | --- | --- | --- | --- |
| Eventi del firewall conservati | 31 giorni | 31 giorni | 31 giorni | 31 giorni |
| Query più lunga | 30 giorni | 30 giorni | 30 giorni | 31 giorni |

Logpush di Cloudflare può anche inviare gli eventi del firewall, su ogni piano dal 30 settembre 2026, a prezzo in base all'uso. Questa connessione interroga invece, quindi non le serve altro che i due permessi di lettura.

## Come funziona il polling

- **Gli eventi sono letti in base a quando sono avvenuti all'edge.** I dati di analisi di Cloudflare sono interrogabili un minuto o due dopo la richiesta.
- **La prima interrogazione guarda indietro di 24 ore**, così una nuova connessione mostra subito i suoi eventi recenti.
- **Ogni interrogazione successiva parte 10 minuti prima del cursore salvato**, così un evento che Cloudflare rende leggibile in ritardo viene letto all'interrogazione successiva, e i duplicati vengono scartati in base al Ray ID di ogni evento all'interno del progetto.
- **Un'interrogazione legge al massimo 24 ore oltre il cursore.** Una connessione il cui cursore è rimasto indietro recupera in una serie di finestre di 24 ore.
- **Le zone sono lette a turno**, una pagina di al massimo 2.000 eventi ciascuna, così una zona molto trafficata non può esaurire un'interrogazione prima che ne sia letta una tranquilla.
- **I limiti di frequenza di Cloudflare sono rispettati.** Cloudflare consente 1.200 richieste REST e 300 query GraphQL in cinque minuti. Un `429` che chiede di attendere 30 secondi o meno viene atteso e ripetuto; uno più lungo ferma l'interrogazione, e la successiva prosegue.
- **Una zona che il token non può leggere non blocca nulla.** Le altre zone vengono importate, l'esecuzione è **Parziale**, e il suo avviso nomina la zona. Dai al token `Zone > Analytics > Read` lì, poi usa **Importa questo intervallo di tempo** per recuperare la finestra.
- **Un'esecuzione non riuscita non cambia nulla.** Dopo un errore di rete, o uno stato di errore di Cloudflare, il cursore e la lunghezza della finestra restano come erano, e l'interrogazione successiva rilegge la stessa finestra. L'unica eccezione è una richiesta scaduta: il cursore resta, ma la finestra successiva è lunga la metà, perché una finestra troppo pesante per rispondere in tempo scadrebbe a ogni tentativo.

### Quando una finestra contiene più di quanto un'interrogazione possa leggere

Un'interrogazione invia al massimo 120 richieste, legge al massimo 20.000 eventi e si ferma dopo 4 minuti. Gli eventi sono letti dai più vecchi, quindi quando un budget ferma un'interrogazione, l'esecuzione è **Parziale** e l'interrogazione successiva riprende dall'evento più vecchio fino a cui sono state lette le zone non finite. Quando non è stato possibile leggere ogni zona una volta, OneUptime accorcia invece la finestra:

1. **Restringere.** L'interrogazione successiva legge una finestra lunga la metà, dallo stesso punto di partenza, e la dimezza di nuovo finché una finestra viene letta per intero, fino a un minuto. L'avviso dell'esecuzione lo dice: `This window holds more records than one poll can read; the next poll reads a {n} minute window from the same starting point.` Gli eventi già importati dalla finestra più lunga vengono saltati come duplicati.
2. **Tornare a crescere.** Dopo che una finestra è stata letta per intero, il cursore passa alla sua fine, e la finestra successiva è di nuovo lunga il doppio, fino a 24 ore.
3. **Superare un singolo minuto.** Se anche un solo minuto contiene più di quanto un'interrogazione possa leggere, l'interrogazione lo supera, così gli eventi più recenti continuano ad arrivare. L'esecuzione resta **Parziale**, e **Ultimo errore** riporta `More records were created in the one minute from {cursor} to {end} than one poll can read. Polling moved past this minute so newer records keep arriving; use Import this time range in Diagnostics on this minute to recover what one run can read.` Importa quel minuto con **Importa questo intervallo di tempo** per recuperare ciò che un'esecuzione può leggere.

Cambiare l'**Intervallo di interrogazione (minuti)** non cambia nulla di tutto questo: decide quanto spesso parte un'interrogazione, non dove inizia la sua finestra.

### Eseguire, visualizzare in anteprima e importare su richiesta

Fai clic su **Diagnostica** su una connessione per vederne le esecuzioni recenti e lavorarci a mano. Chi può modificare la connessione può avviare queste azioni; chi può vederla può leggerne la cronologia.

- **Esegui ora** avvia subito un'interrogazione, con il cursore abituale, anche quando la connessione non è **Abilitato**.
- **Anteprima dei eventi del firewall** legge un intervallo di tempo di al massimo 7 giorni e non importa nulla.
- **Importa questo intervallo di tempo** importa un intervallo di al massimo 7 giorni, dopo la tua conferma, senza spostare il cursore. Gli eventi già importati vengono saltati. Cloudflare conserva 31 giorni di eventi del firewall.
- **Copia diagnostica** su un'esecuzione copia il suo rapporto per il supporto. Non contiene mai credenziali.

## Testare la connessione

**Testa la connessione** sulla riga di una connessione, e **Prova queste impostazioni** nel modulo, vengono eseguiti nel processo dell'API, non in un worker in background, così un test risponde anche quando il problema sono i worker. Esegue questi controlli, in ordine:

| Controllo | Cosa verifica |
| --- | --- |
| **Configurazione** | Il token, l'account e le zone sono ben formati. Se questo fallisce, non viene contattato nulla. |
| **Verify the API token** | Cloudflare accetta il token, di un utente o di proprietà dell'account, ed è attivo. Uno che scade entro 14 giorni è un avviso. |
| **List the zones** | Il token ha `Zone > Zone > Read`: elenca le zone dell'account, e ogni zona scelta. |
| **Read firewall events** | Il token ha `Zone > Analytics > Read` su ogni zona. Un errore nomina le zone su cui manca. |
| **What each zone's plan gives** | Per quanto il piano di ogni zona conserva gli eventi del firewall, e quanto può durare una query. Una zona il cui piano non ne ha è un avviso. |
| **Firewall events available to import** | Circa quanti eventi contengono le ultime 24 ore e gli ultimi 7 giorni. Nessuno è un avviso. |
| **Background workers**, **Poll scheduler**, **Security event storage** | Il lato di OneUptime stesso: un processo prende i job della coda Worker, il job di polling gira ogni minuto e l'archivio degli eventi di sicurezza risponde. |
| **Interrogazione pianificata** | Per una connessione salvata: il polling è attivo, nessuna esecuzione è bloccata in attesa di un worker e le interrogazioni girano in orario. |

Ogni richiesta di un test ha una scadenza di 20 secondi. Un test non importa mai nulla e non sposta mai il cursore, e ogni controllo fallito dice cosa cambiare.

## Bloccare indirizzi su Cloudflare

Con il blocco attivo, Cloudflare applica la [blocklist](/docs/telemetry/security-cases#blocklist) del tuo progetto. Ogni indirizzo che blocchi finisce entro un minuto in una lista IP del tuo account Cloudflare, e in ogni zona una regola personalizzata per lista blocca gli indirizzi che contiene o li sottopone a una verifica. Nella **Blocklist**, **Applicato su** nomina Cloudflare per ogni blocco che OneUptime ha riletto da Cloudflare; un blocco non riletto entro 10 minuti non vi è applicato.

Il blocco richiede permessi di scrittura sul token API della connessione:

| Permesso | Cosa ci fa OneUptime |
| --- | --- |
| `Account > Account Filter Lists > Edit` | Crea le sue due liste, e ne aggiunge e rimuove gli indirizzi. |
| `Zone > Zone WAF > Edit`, su ogni zona in cui bloccare | Aggiunge le sue regole personalizzate, e legge quelle della zona. |
| `Account > Account Firewall Access Rules > Edit` | Aggiunge e rimuove IP Access Rules, su un piano senza una lista o una regola personalizzata libera. |

:::steps
### Dare al token i permessi di scrittura

In Cloudflare, apri **My Profile → API Tokens**, modifica il token della connessione e aggiungi i permessi qui sopra. Oppure crea un token che li abbia, insieme ai due permessi di lettura.

### Attivare il blocco

Sulla riga della connessione, seleziona **Blocca indirizzi**. Incolla un nuovo token in **Nuovo token API**, o lascialo vuoto per tenere quello attuale, e in **Zone** lascia **Tutte le zone**, oppure scegli le zone in cui bloccare. **Controlla autorizzazioni** chiede a Cloudflare se il token ha ogni permesso, e non cambia nulla. **Attiva il blocco** attiva il blocco solo quando ogni controllo riesce, e OneUptime configura Cloudflare entro un minuto.
:::

Finché il blocco è attivo, **Testa la connessione** esegue gli stessi controlli: **How blocking is set up**, **Edit the lists**, **Edit custom rules in each zone** e, dove si usano IP Access Rules, **Edit IP Access Rules**.

### Cosa aggiunge OneUptime a Cloudflare

| In Cloudflare | Che cos'è |
| --- | --- |
| Le liste `oneuptime_block` e `oneuptime_challenge` | Due liste IP nell'account, una per i blocchi e una per le verifiche. La loro descrizione nomina il tuo progetto OneUptime. |
| Una regola personalizzata per lista, in ogni zona | `(ip.src in $oneuptime_block)` con l'azione Block, e `(ip.src in $oneuptime_challenge)` con l'azione Managed Challenge. La loro descrizione dice che le gestisce OneUptime. |
| Un elemento di lista per blocco | Il suo commento nomina il caso e quando finisce il blocco, ad esempio `OneUptime case CASE-42 until 2026-11-21 10:42 UTC`. |

Ogni regola va per prima tra le regole personalizzate della zona, quindi viene eseguita prima delle tue: una tua regola Skip non può far passare un indirizzo bloccato. Quando le tue regole Skip lasciano passare degli indirizzi, come quelli dei tuoi monitor o di un partner, **Stato del blocco** li nomina. **Proteggi questi indirizzi** li aggiunge alle **Entità protette**, che nessuno può bloccare.

### Limiti del piano per il blocco

| Piano | Free | Pro | Business | Enterprise |
| --- | --- | --- | --- | --- |
| Liste nell'account | 1 | 10 | 10 | 1.000 |
| Elementi di lista nell'account | 10.000 | 10.000 | 10.000 | 500.000 |
| Regole personalizzate in una zona | 5 | 20 | 100 | 1.000 |

Contano anche le tue liste e regole. Quando attivi il blocco, ogni azione prende una lista, e una regola in ogni zona, dove il piano le ha libere, Block per prima; dove no, prende IP Access Rules. Su un piano Free con l'unica lista libera, i blocchi prendono la lista e le verifiche IP Access Rules. Un account contiene 50.000 IP Access Rules, ciascuna un indirizzo, un intervallo IPv4 /16 o /24, o un intervallo IPv6 /32, /48 o /64: il blocco di un altro intervallo non vi è applicato, e la **Blocklist** dice perché. **How blocking is set up** dice cosa prende ogni azione, e perché.

### Quando qualcuno cambia una regola

OneUptime rilegge le sue liste e regole ogni 3 minuti, e non annulla mai una modifica fatta da qualcuno in Cloudflare. Una regola disattivata, eliminata o modificata lì compare sulla riga della connessione e in **Stato del blocco**, con la sua zona, e la **Blocklist** mostra i blocchi della regola di quella zona come non applicati su Cloudflare. **Ripristina** rimette a posto la regola. Finché **Zone** è **Tutte le zone**, una zona aggiunta in seguito all'account viene configurata da sola.

### Disattivare il blocco

**Disattiva il blocco** chiede se rimuovere da Cloudflare le liste e le regole di OneUptime, con **Rimuovi le liste e le regole di OneUptime da Cloudflare** selezionato. La rimozione toglie le regole di OneUptime, le sue due liste e le IP Access Rules che ha aggiunto, trovate dai nomi, riferimenti e note che ha dato loro, e nient'altro. Se le conservi, restano in Cloudflare e continuano a bloccare ciò che contengono. Una connessione che blocca indirizzi non si può eliminare: disattiva prima il blocco, ed eliminala quando la rimozione è terminata.

## Risoluzione dei problemi

L'**Ultimo errore** della connessione conserva il messaggio di errore completo, con le credenziali oscurate. Quando una connessione ha un errore, seleziona **Visualizza errore** nella sua colonna **Azioni** per leggerlo, e **Copia errore** nella finestra di dialogo per copiarlo. Ogni messaggio nomina la richiesta non riuscita e cita il motivo dato da Cloudflare.

:::details L'ultimo errore riporta `Invalid API Token (1000)`
Cloudflare non conosce il token: è stato eliminato, rinnovato o mai incollato per intero. Una Global API Key viene rifiutata prima di essere inviata. Crea un token come sopra, e salvalo con **Aggiorna le credenziali**.
:::

:::details L'ultimo errore riporta `Unauthorized to access requested resource (9109)`
Il token non può elencare le zone. Dagli `Zone > Zone > Read`, con le zone da importare in **Zone Resources**.
:::

:::details L'ultimo errore riporta `cannot read the analytics of`
Al token manca `Zone > Analytics > Read` sulle zone che il messaggio nomina. Aggiungilo lì, poi usa **Importa questo intervallo di tempo** per recuperare ciò che non è stato importato.
:::

:::details L'ultimo errore riporta `rate limit`
Qualcos'altro che usa lo stesso utente Cloudflare ha esaurito la sua quota. L'interrogazione riprende da sola una volta passati i cinque minuti; dai a OneUptime un token di un utente proprio per tenere separata la quota.
:::

:::details Ultimo errore dice `did not complete`
La richiesta non ha ricevuto risposta: un timeout, un nome che non si risolve o un indirizzo rifiutato. Verifica che l'app e i worker di OneUptime possano raggiungere `api.cloudflare.com`, attraverso qualsiasi proxy tu usi.
:::

:::details Un caso mostra le azioni di Cloudflare, ma nessuna richiesta dell'indirizzo nella tua app
Dietro Cloudflare, le richieste della tua app arrivano dagli indirizzi di Cloudflare, e l'indirizzo del visitatore è l'ultimo che Cloudflare aggiunge a `X-Forwarded-For`. Registra quell'intestazione (`http.request.header.x-forwarded-for`) e l'indirizzo proprio della connessione (`network.peer.address`) nelle tue tracce. Finché questa connessione esiste, OneUptime considera gli indirizzi di Cloudflare un proxy affidabile, quindi legge il visitatore dall'intestazione e associa le richieste della tua app all'indirizzo su cui Cloudflare è intervenuto. Un `client.address` che la tua app copia da `CF-Connecting-IP` non è considerato affidabile: chiunque raggiunga direttamente la tua app può inviare quell'intestazione.
:::

:::details Lo stato del blocco riporta `already exists in this Cloudflare account`
Un altro progetto OneUptime, o una persona, ha creato una lista chiamata `oneuptime_block` o `oneuptime_challenge`, e OneUptime non cambia mai una lista che non ha creato per questo progetto. Rinomina o elimina quella lista in Cloudflare, oppure disattiva il blocco nel progetto che l'ha creata. OneUptime configura di nuovo il blocco entro 5 minuti.
:::

:::details Il test riesce, ma Last Polled è Never
Il job di polling non è mai stato eseguito. Leggi i controlli **Background workers** e **Poll scheduler**. Su un'installazione self-hosted, la causa abituale è `DISABLE_QUEUE_WORKERS=true` sull'app, senza un deployment separato dei worker che prenda i job: impostalo su `false`, oppure esegui il deployment dei worker (Helm: `worker.enabled: true`, che è `false` per impostazione predefinita).
:::

## Prossimi passi

:::cards
- [Eventi di sicurezza](/docs/telemetry/security-events): Cerca, correla e genera avvisi su ciò che importi.
- [Casi di sicurezza](/docs/telemetry/security-cases): Guarda cosa ha fatto Cloudflare accanto a ciò che ha raggiunto la tua app.
- [Panoramica delle integrazioni](/docs/integrations/index): Gli altri strumenti che puoi collegare.
:::
