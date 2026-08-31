# Feed calendario (turni di reperibilità in Google Calendar, Outlook e Calendario Apple)

I feed calendario portano i tuoi turni di reperibilità nel calendario che già consulti. OneUptime pubblica un link iCalendar (`.ics`) segreto per ogni persona, ogni pianificazione e ogni progetto; Google Calendar, Outlook, Calendario Apple, Thunderbird e qualsiasi altra app in grado di iscriversi a un calendario tramite URL interrogano quel link e mostrano un evento per turno. Non si installa nulla e non si collega alcun account: il link è l'intera integrazione.

> **Note:** Un calendario in abbonamento serve alla **pianificazione**. Le app di calendario rileggono i feed con i propri tempi — Google Calendar solo ogni 8–24 ore —, quindi uno scambio fatto un'ora prima di un turno ti raggiunge tramite i promemoria, gli avvisi di riassegnazione e le notifiche di reperibilità di OneUptime, non tramite il calendario.

## Cosa ottieni

- Un evento per turno, intitolato `On-call · <Schedule>` (con ` · <Policy>` aggiunto quando la pianificazione è collegata a esattamente una policy di escalation) nel feed personale e `<Name> · On-call · <Schedule>` in un feed condiviso. La descrizione indica chi è reperibile, la pianificazione e il suo fuso orario, il livello, il turno nel fuso della pianificazione, in UTC e nel tuo, quali policy di escalation ti avvisano tramite questa pianificazione e un link alla pianificazione nella dashboard.
- Le sostituzioni sono rispettate. Quando qualcuno ti copre, l'evento passa a quella persona (viene aggiunto `(covering for <Name>)`) e resta lo stesso evento nella tua app, quindi si aggiorna sul posto invece di duplicarsi. Una sostituzione parziale divide il turno in eventi contigui.
- Due giorni di storico e 90 giorni in avanti per impostazione predefinita. Puoi ampliare fino a 60 giorni indietro e 180 in avanti; un feed che supererebbe i 5.000 eventi viene accorciato e lo segnala nella descrizione del calendario.
- Gli eventi sono contrassegnati come liberi (`TRANSP:TRANSPARENT`), quindi un feed in abbonamento non blocca mai la tua disponibilità, e nulla è contrassegnato come privato, così un calendario di team condiviso mostra i titoli a chiunque possa vederlo.
- Gli orari sono inviati in UTC e convertiti dalla tua app; la descrizione riporta l'ora locale nel fuso della pianificazione e nel tuo. Imposta il tuo fuso in **Impostazioni utente** > **Profilo** e quello della pianificazione nella sua scheda **Impostazioni**. Una pianificazione senza fuso viene calcolata nel fuso del server, come per gli avvisi, e l'evento lo indica.

Le assegnazioni fisse — un utente o un team indicato direttamente in una regola di policy di escalation — non hanno inizio né fine e non compaiono in alcun feed. Su OneUptime Cloud i feed seguono lo stesso piano delle pianificazioni di reperibilità (Growth); un progetto al di sotto di quel piano riceve un calendario vuoto anziché un errore.

## Tre tipi di link

| Link                       | Chi lo crea                                                                                              | Cosa contiene                                                                                       | Dove                                                                         |
| -------------------------- | -------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| **Feed personale**         | Ogni utente, uno per progetto                                                                            | I tuoi turni su ogni pianificazione del progetto, più i turni in cui copri qualcuno (opzionale)     | **Impostazioni utente** > **Feed calendario**                                |
| **Feed di pianificazione** | Chiunque possa modificare la pianificazione; chiunque possa leggerla può copiare il link                 | I turni di tutti su una pianificazione, con eventi opzionali per i buchi di copertura               | La pagina della pianificazione, scheda **Iscriviti a questa pianificazione** |
| **Feed di progetto**       | Chiunque possa modificare le pianificazioni di reperibilità; chiunque possa leggerle può copiare il link | I turni di tutti su ogni pianificazione del progetto, con eventi opzionali per i buchi di copertura | **Reperibilità** > **Feed calendario**                                       |

I link hanno questo aspetto:

```
https://<tuo host>/api/on-call-calendar/user/<token>/shifts.ics
https://<tuo host>/api/on-call-calendar/schedule/<token>/schedule.ics
https://<tuo host>/api/on-call-calendar/project/<token>/project.ics
```

Il token di 43 caratteri nel percorso è l'unica credenziale: non ci sono login, cookie né chiavi API. Tratta ciascuno di questi link come una password.

## Il tuo feed personale

1. Apri **Impostazioni utente** > **Feed calendario** nel progetto di cui vuoi i turni. I feed personali sono per progetto: un secondo progetto ha un secondo link e un secondo calendario.
2. Fai clic su **Genera link calendario**. La scheda **Iscriviti ai tuoi turni di reperibilità** mostra ora il link `https://` e tre pulsanti:
   - **Google Calendar** apre Google Calendar con il link precompilato.
   - **Apple / altre app** apre la forma `webcals://` del link, che macOS, iOS e la maggior parte delle app desktop passano direttamente alla finestra di iscrizione.
   - **Copia link webcal** copia lo stesso link `webcal(s)://`, quello di cui ha bisogno Outlook classico per Windows.
3. Iscriviti nella tua app di calendario seguendo i passaggi per app riportati sotto.

Impostazioni sulla stessa scheda:

- **Includi i turni che copro per altri** (attivo per impostazione predefinita) aggiunge i turni che una sostituzione ti assegna su pianificazioni di cui non sei membro.
- **Giorni di turni passati** (predefinito 2, massimo 60) e **Giorni in avanti** (predefinito 90, tra 7 e 180).

La riga di stato mostra quando il link è stato letto l'ultima volta, da quale app, quante volte, e gli ultimi quattro caratteri del token per distinguere i link. Se nulla ha letto il link dopo due giorni, la pagina chiede se il server è raggiungibile da Internet (vedi Risoluzione dei problemi).

La pagina elenca anche i tuoi **Prossimi turni** (i prossimi 30 giorni), ciascuno con un link **Trova copertura** che apre le sostituzioni utente precompilate per quel turno, e la scheda **Ricordamelo prima dei turni** descritta più avanti.

Azioni:

- **Rigenera link** crea un nuovo token. Ogni app iscritta al vecchio link smette di aggiornarsi: per 30 giorni il vecchio link serve un calendario vuoto affinché quelle app svuotino la propria copia, poi risponde 404. Iscriviti di nuovo con il nuovo link.
- **Disattiva** mantiene il link ma serve un calendario vuoto finché non lo riattivi.
- **Elimina** rimuove il link. Le app che lo interrogano ancora ricevono 404 e continuano a mostrare l'ultimo contenuto caricato; disattiva prima se vuoi che si svuotino.

Lo stesso link personale, filtrato su una pianificazione con `?schedule=<id>`, è proposto come **Solo i miei turni su questa pianificazione** in ogni pagina di pianificazione, e il banner di reperibilità e la pagina **Le mie policy di reperibilità** contengono un link **Aggiungi i tuoi turni al tuo calendario** verso la pagina sopra.

Nell'app mobile: **Reperibilità** > **Aggiungi i turni al mio calendario** (anche in **Impostazioni** > **Feed calendario**), con un link per progetto. Su iPhone, **Apri in Calendario** apre il foglio di iscrizione nativo. Su Android non c'è modo di iscriversi a un URL dal telefono, quindi la schermata offre **Condividi link** e **Copia link https** e ti invita ad aggiungere il link su un computer, dopodiché si sincronizza sul telefono. L'elenco **I tuoi turni** dell'app proviene dagli stessi dati e ha la stessa azione **Trova copertura**.

## Iscriversi nella tua app di calendario

Usa il link `https://` a meno che l'app non chieda `webcal`; la sezione sugli schemi più sotto spiega la differenza.

### Google Calendar (web)

1. In Google Calendar sul web, accanto ad **Altri calendari** fai clic su **+** > **Da URL**.
2. Incolla il link `https://` e fai clic su **Aggiungi calendario**. Il pulsante **Google Calendar** in OneUptime fa lo stesso con il link precompilato.

Google legge il feed **dai server di Google**, circa ogni 8–24 ore e talvolta di più. Non c'è un pulsante di aggiornamento per i calendari in abbonamento, e Google ignora i suggerimenti di aggiornamento nel feed. Nome e fuso orario del calendario vengono letti **solo alla prima iscrizione**: rinominare una pianificazione in seguito non rinomina il calendario in Google; rimuovilo e aggiungilo di nuovo se il nome conta. Google scarta i promemoria contenuti nei file di calendario, quindi imposta notifiche predefinite per quel calendario nelle impostazioni di Google oppure, meglio, usa i promemoria di OneUptime. Se Google segnala che non è riuscito a recuperare l'URL, verifica di aver incollato la forma `https://` e non `webcal://`, e aggiungi `?nocache=1` per fargli riprovare (OneUptime ignora i parametri di query sconosciuti, il feed non cambia). L'app Google Calendar su Android e iOS non può iscriversi tramite URL; aggiungi il link da un computer e comparirà sul telefono.

### Outlook sul web e Outlook.com

1. Apri **Calendario** > **Aggiungi calendario** > **Sottoscrivi dal Web**.
2. Incolla il link `https://`, dai un nome al calendario e fai clic su **Importa**.

Outlook legge **dai server di Microsoft**: circa ogni 3 ore per Outlook.com e ogni 4–6 ore per gli account aziendali o scolastici, a volte più di un giorno. L'intervallo è fisso e non c'è aggiornamento manuale. Iscriviti qui anziché nell'app desktop se vuoi il calendario anche sul telefono e in Outlook sul web: le sottoscrizioni create in Outlook classico per Windows restano su quel PC. Il nuovo Outlook per Windows e Outlook per Mac usano la stessa finestra **Aggiungi calendario** > **Sottoscrivi dal Web**.

### Outlook classico per Windows

1. In OneUptime fai clic su **Copia link webcal**.
2. In Outlook apri **File** > **Impostazioni account** > **Impostazioni account** > **Calendari Internet** > **Nuovo**, incolla il link `webcals://` e fai clic su **Aggiungi**. Aprire un link `webcal` nel browser funziona anche su un PC con Outlook installato; senza Outlook, Windows non ha un gestore `webcal`.

**Non** aprire il link `https://…/shifts.ics` stesso in Outlook classico: importa un'istantanea una tantum che non si aggiorna mai. Solo `webcal://` e `webcals://` creano una sottoscrizione.

Il feed viene aggiornato a ogni **Invia/Ricevi** (F9, o l'intervallo dei gruppi di invio/ricezione). Le impostazioni della sottoscrizione hanno una casella **Limite di aggiornamento**: se spuntata, Outlook non aggiorna più velocemente dell'intervallo suggerito dall'editore. OneUptime suggerisce un'ora (`X-PUBLISHED-TTL:PT1H`), quindi il feed si aggiorna circa ogni ora. I feed senza quel suggerimento non si aggiornano mai finché la casella è spuntata; quelli di OneUptime lo includono, quindi puoi lasciarla spuntata. Outlook classico legge il feed **dal tuo PC** e convalida il certificato del server.

### Calendario Apple su macOS

1. Fai clic su **Apple / altre app** in OneUptime, oppure in Calendario scegli **File** > **Nuova iscrizione al calendario** e incolla il link.
2. Nel foglio di iscrizione imposta **Aggiornamento automatico** — ogni 5 minuti, 15 minuti, ora, giorno o settimana (ogni ora per impostazione predefinita) — e scegli **iCloud** in **Posizione** perché il calendario compaia anche su iPhone e iPad e continui ad aggiornarsi con quella frequenza.

macOS legge il feed **dal tuo Mac**, quindi funziona con un'installazione su rete privata purché il Mac possa raggiungerla. Un certificato autofirmato o di una CA interna deve prima essere considerato attendibile nel portachiavi di macOS. **Rimuovi avvisi** è spuntato per impostazione predefinita in quel foglio; qui non fa differenza perché il feed non contiene allarmi.

### iPhone e iPad

Le iscrizioni create sul dispositivo stesso si aggiornano secondo **Impostazioni** > **Calendario** > **Account** > **Scarica nuovi dati** — **Automaticamente** per impostazione predefinita, che scarica soprattutto in carica e con Wi-Fi. Per un aggiornamento affidabile, iscriviti da un Mac con **iCloud** come posizione, oppure imposta **Scarica nuovi dati** su un intervallo fisso. Per iscriverti dal dispositivo, tocca **Apri in Calendario** nell'app mobile di OneUptime, oppure vai in **Impostazioni** > **Calendario** > **Account** > **Aggiungi account** > **Altro** > **Aggiungi calendario in abbonamento** e incolla il link.

### Thunderbird

Scegli **File** > **Nuovo** > **Calendario** > **Sulla rete** > **iCalendar (ICS)**, incolla il link `https://` e scegli un intervallo di aggiornamento nelle proprietà del calendario: 1, 5, 15, 30 o 60 minuti. Thunderbird legge **dal tuo computer** e deve considerare attendibile il certificato del server.

### Fastmail, Proton e altri servizi

Fastmail aggiorna circa ogni ora e **disattiva una sottoscrizione dopo cinque letture fallite consecutive**; se succede, aggiungila di nuovo quando il server è tornato sano. Proton Calendar aggiorna ogni 4–16 ore e rifiuta i feed molto grandi: riduci **Giorni in avanti** se si lamenta. Confluence Team Calendars accetta il feed di pianificazione; il suo limite di 28 caratteri per i nomi dei calendari è rispettato.

### Android

Né l'app Google Calendar né Samsung Calendar possono iscriversi a un URL. Aggiungi il link `https://` a Google Calendar da un computer (**Altri calendari** > **+** > **Da URL**); il calendario si sincronizza poi sul telefono con tutto il resto di quell'account Google. L'app mobile di OneUptime su Android offre **Condividi link** e **Copia link https** proprio per questo.

## Con quale frequenza si aggiornano i calendari

| App di calendario                | Aggiornamento tipico                                                | Legge da            | Note                                                                                              |
| -------------------------------- | ------------------------------------------------------------------- | ------------------- | ------------------------------------------------------------------------------------------------- |
| Google Calendar (Da URL)         | 8–24 ore, a volte di più                                            | Server di Google    | Nessun aggiornamento manuale; ignora i suggerimenti; nome e fuso letti solo alla prima iscrizione |
| Outlook.com                      | Circa 3 ore                                                         | Server di Microsoft | Fisso; può superare le 24 ore                                                                     |
| Outlook sul web (lavoro, scuola) | Circa 4–6 ore                                                       | Server di Microsoft | Fisso; nessun controllo utente                                                                    |
| Outlook classico per Windows     | A ogni Invia/Ricevi; circa ogni ora con **Limite di aggiornamento** | Il tuo PC           | Richiede un link `webcal`; non si sincronizza su telefono o web                                   |
| Calendario Apple (macOS)         | Da 5 minuti a settimanale, ogni ora per impostazione predefinita    | Il tuo Mac          | Salva in iCloud per raggiungere iPhone e iPad                                                     |
| Calendario Apple (solo iOS)      | Secondo **Scarica nuovi dati**, limitato dalla batteria             | Il tuo telefono     | Iscriviti da un Mac per maggiore affidabilità                                                     |
| Thunderbird                      | 1–60 minuti                                                         | Il tuo computer     |                                                                                                   |
| Fastmail                         | Circa ogni ora                                                      | Server di Fastmail  | Disattivato dopo cinque letture fallite                                                           |
| Proton Calendar                  | 4–16 ore                                                            | Server di Proton    | Rifiuta i feed grandi                                                                             |

OneUptime stesso serve dati freschi: una modifica a un livello, a una rotazione, a una sostituzione o a un collegamento di policy invalida subito il feed, e le risposte sono in cache al massimo per cinque minuti. L'attesa che vedi è dell'app di calendario, non del server. OneUptime suggerisce un aggiornamento orario tramite `REFRESH-INTERVAL` e `X-PUBLISHED-TTL`; solo Outlook classico ne tiene conto, e solo con **Limite di aggiornamento** attivo: Calendario Apple, Thunderbird e gli altri si aggiornano con l'intervallo che imposti per ogni calendario.

## https, webcal e webcals

Tutti e tre puntano allo stesso feed. `webcal://` e `webcals://` sono il link `http://` e `https://` con lo schema rinominato, così che il sistema operativo apra un'app di calendario invece di un browser; `webcals` è la variante cifrata ed è quella che OneUptime offre quando `HTTP_PROTOCOL` è `https`.

- Google Calendar, Outlook sul web, Thunderbird e Fastmail vogliono la forma `https://`.
- Calendario Apple e Outlook classico per Windows si iscrivono da un link `webcal(s)://`; in Outlook classico la forma `https://` è un'importazione una tantum.
- `webcal://` senza la `s` non è cifrato e invia il token in chiaro a ogni lettura. Se la tua installazione gira ancora in `http` semplice, la dashboard mostra un avviso accanto al link; passa a `https` prima di condividere i link su larga scala.

## Promemoria e avvisi di riassegnazione

Le app di calendario non consegnano gli allarmi dei feed in abbonamento — Google li scarta, Apple li rimuove per impostazione predefinita, Outlook li appiattisce —, quindi OneUptime invia i propri.

In **Impostazioni utente** > **Feed calendario**, la scheda **Ricordamelo prima dei turni** ti consente di scegliere gli anticipi: **1 settimana**, **1 giorno**, **1 ora**, **15 min** o un valore personalizzato tra 15 minuti e 14 giorni, anche più di uno insieme. Ogni promemoria viene inviato una volta per turno tramite i metodi di consegna scelti per **Prima dell'inizio del mio turno di reperibilità** in **Impostazioni utente** > **Impostazioni notifiche** (scheda Reperibilità; email e push attivi per impostazione predefinita). Il messaggio indica la pianificazione, le policy tramite cui avvisa e l'ora di inizio nel tuo fuso.

- Un turno che rientra in uno dei tuoi anticipi a causa di una sostituzione tardiva — qualcuno ti passa un turno 20 minuti prima dell'inizio — riceve subito un singolo promemoria di recupero.
- Se un turno per cui sei stato avvisato viene passato a qualcun altro, ricevi **Il mio prossimo turno di reperibilità è stato riassegnato**, un tipo di evento separato che si può silenziare a parte.
- I promemoria non vengono mai inviati dopo l'inizio di un turno, né per pianificazioni non collegate ad alcuna policy di escalation, perché non possono avvisare nessuno.
- Su WhatsApp un promemoria arriva tramite il modello di reperibilità preapprovato di Meta, che nomina la pianificazione e la policy di escalation e rimanda alla pianificazione ma non riporta l'orario di inizio, e che WhatsApp consegna solo in inglese. Gli avvisi di riassegnazione non hanno un modello WhatsApp approvato, quindi ti raggiungono sugli altri canali.

## Link condivisi per una pianificazione o un progetto

Un link condiviso appartiene al **progetto**, non a chi lo ha copiato, e mostra i nomi delle persone, mai i loro indirizzi email.

**Feed di pianificazione.** Nella pagina di una pianificazione la scheda **Iscriviti a questa pianificazione** ha due metà: **Solo i miei turni su questa pianificazione** (il tuo link personale con filtro di pianificazione) e **Turni di tutti su questa pianificazione (link di team condiviso)**. Chiunque abbia il permesso **Modifica** sulle pianificazioni può **Pubblica link condiviso**, **Rigenerarlo** o **Disattivarlo**; chiunque possa leggere la pianificazione può copiarlo. La scheda mostra quando il link è stato ruotato l'ultima volta.

**Feed di progetto.** **Reperibilità** > **Feed calendario** contiene la scheda **Turni di tutti in questo progetto (link condiviso)** — un link condiviso che copre ogni pianificazione del progetto — con le stesse azioni di pubblicazione, rigenerazione e disattivazione, e un link alla tua pagina del feed personale.

Impostazioni su entrambi:

- **Mostra i buchi di copertura** (disattivo per impostazione predefinita) aggiunge un evento `No coverage · <Schedule>` ovunque un livello _dovrebbe_ coprire ma nessuno è reperibile: un livello vuoto, un livello con data di inizio futura, livelli non allineati o qualsiasi buco in una pianificazione 24×7. Le ore non lavorative di una pianificazione a orario d'ufficio non vengono mai segnalate. **Buco minimo da mostrare (minuti)** (predefinito 60) nasconde i buchi più brevi; vengono emessi al massimo 100 eventi di buco, i più vecchi prima.
- **Rigenera quando qualcuno lascia il progetto** (disattivo per impostazione predefinita) rigenera automaticamente il link quando qualcuno lascia il suo ultimo team nel progetto, così il calendario di un ex collega smette di aggiornarsi. Tutti gli altri devono poi iscriversi di nuovo, per questo è facoltativo.
- **Giorni di turni passati** e **Giorni in avanti**, come nel feed personale.

Metti il link di pianificazione in un calendario di team condiviso — Google, Outlook o Confluence — e un'unica iscrizione serve tutto il team. Ruotalo quando qualcuno che lo aveva se ne va, oppure attiva la rotazione automatica descritta sopra.

Quando una persona lascia il suo ultimo team in un progetto, OneUptime la rimuove anche dai livelli di pianificazione e dalle regole di escalation di quel progetto, elimina le sostituzioni in corso e future del progetto che la nominano (come persona sostituita o come sostituta), disattiva il suo feed personale per il progetto ed elimina i suoi promemoria lì.

## Gli eventi nel dettaglio

- Ogni turno ha un'identità stabile composta dalla pianificazione e dall'inizio del turno, così lo stesso turno è lo stesso evento nel tuo feed personale, nel feed di pianificazione e dopo la rigenerazione di un link. Le app lo aggiornano sul posto; una modifica incrementa il numero di sequenza dell'evento.
- Una sostituzione che scambia l'intero turno mantiene l'evento e cambia la persona; una sostituzione che copre parte di un turno produce tre eventi contigui, per esempio A 09:00–12:00, B 12:00–13:00, A 13:00–17:00.
- Quando una pianificazione è collegata a due o più policy di escalation e una sostituzione si applica solo a una di esse, le persone avvisate differiscono per policy. Il feed lo mostra invece di nasconderlo: il turno mantiene il suo evento per la persona avvisata dalle altre policy, con una nota che indica la policy che avvisa qualcun altro, e il sostituto riceve un evento aggiuntivo intitolato `On-call · <Schedule> · <Policy> (covering for <Name>)`.
- I turni passati riportano nella descrizione la riga "Past shifts reflect the current rotation, not who was actually paged".
- Una pianificazione non collegata ad alcuna policy di escalation viene comunque mostrata, con una nota che non avviserà nessuno.

## Pianificazione, non audit

Il feed mostra la rotazione **così com'è configurata ora**, anche per i giorni passati: una sostituzione inserita a posteriori riscrive la storia nel calendario. Per le ore effettivamente trascorse in reperibilità, le revisioni di equità e i compensi, usa **Reperibilità** > **Report** > **Tempo di reperibilità per utente**, che viene scritto a partire da ciò che il pager ha davvero fatto.

## Sicurezza

- Il token nel link è l'unica credenziale. Chiunque abbia il link vede i turni — nomi, pianificazioni, policy — finché non viene rigenerato. Non incollare i link in chat o ticket; quando un team ha bisogno di un calendario, condividi il link di pianificazione o di progetto anziché quello personale.
- I link sono per progetto. Un link personale trapelato espone i turni di un progetto, non di tutti i progetti a cui appartieni.
- **Rigenera** sposta il vecchio token in un periodo di tolleranza di 30 giorni (calendario vuoto, poi 404). **Disattiva** serve un calendario vuoto. Un link sconosciuto o scaduto risponde con un semplice 404 senza indizi. I calendari vuoti fanno svuotare la copia alle app iscritte; un 404 la fa conservare, ed è per questo che disattivare e rigenerare servono calendari vuoti.
- I token sono memorizzati con hash; la copia mostrata nella pagina delle impostazioni è cifrata con `ENCRYPTION_SECRET`. Imposta quella variabile su un segreto reale in un'installazione self-hosted: il server avvisa all'avvio quando non è impostata o è ancora uno dei segnaposto forniti da questo repository (`secret`, o il `please-change-this-to-random-value` impostato da `config.example.env`). Se la cambi in seguito, la pagina propone **Rigenera link** perché la copia memorizzata non è più leggibile; il feed continua a funzionare finché non lo fai.
- Le risposte dei feed sono contrassegnate `Cache-Control: private`, escluse dai motori di ricerca (`X-Robots-Tag: noindex`) e limitate in frequenza per link e per indirizzo client.
- L'Nginx di OneUptime tiene le richieste dei feed fuori dai propri log:

  ```
  location ~ ^/api/on-call-calendar/(user|schedule|project)/ {
      access_log off;
      error_log /dev/null crit;
      proxy_max_temp_file_size 0;
      ...
  }
  ```

  così un token non finisce mai in un file di log accanto a un indirizzo client; nemmeno l'applicazione lo registra. `access_log off` toglie la riga per richiesta, `error_log` toglie le righe che Nginx scrive quando una chiamata all'applicazione fallisce — senza di essa ogni client che scarica il feed durante un riavvio si vede registrare il token — e `proxy_max_temp_file_size 0` tiene un feed grande fuori da un file temporaneo. **Qualsiasi proxy, WAF o CDN che metti davanti a OneUptime registra comunque l'URI completo, sia nel log di accesso sia in quello degli errori** a meno che non lo configuri diversamente: verificalo prima di distribuire i feed.

## Configurazione self-hosted

Non c'è nulla da attivare: i feed funzionano su ogni installazione. Quattro variabili d'ambiente li controllano, impostate in `config.env` per Docker Compose o sotto `onCallCalendarFeed` nei valori Helm (vedi il [riferimento di configurazione](https://github.com/OneUptime/oneuptime/blob/master/HelmChart/Public/oneuptime/docs/configuration.md#on-call-calendar-feeds) del chart):

| Variabile                                               | Valore Helm                                      | Predefinito | Effetto                                                                                                                                                                       |
| ------------------------------------------------------- | ------------------------------------------------ | ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DISABLE_ON_CALL_CALENDAR_FEED`                         | `onCallCalendarFeed.disabled`                    | `false`     | Interruttore di emergenza. Ogni URL di feed risponde `503` con `Retry-After: 3600`; le app iscritte conservano la propria copia e riprovano più tardi. Nulla viene eliminato. |
| `ON_CALL_CALENDAR_FEED_RATE_LIMIT_WINDOW_SECONDS`       | `onCallCalendarFeed.rateLimit.windowSeconds`     | `60`        | Durata della finestra di limitazione.                                                                                                                                         |
| `ON_CALL_CALENDAR_FEED_RATE_LIMIT_PER_TOKEN_PER_WINDOW` | `onCallCalendarFeed.rateLimit.perTokenPerWindow` | `60`        | Letture che un link può fare da un indirizzo client per finestra.                                                                                                             |
| `ON_CALL_CALENDAR_FEED_RATE_LIMIT_PER_IP_PER_WINDOW`    | `onCallCalendarFeed.rateLimit.perIpPerWindow`    | `3000`      | Letture che un indirizzo client può fare su tutti i link per finestra: il tetto per un intero ufficio dietro un solo indirizzo.                                               |

Rilevante anche:

- **`HOST` e `HTTP_PROTOCOL`** costruiscono i link. Se `HOST` è vuoto o `localhost`, o `HTTP_PROTOCOL` è `http`, la pagina del feed mostra un avviso e i link non funzioneranno dall'esterno.
- **`TRUSTED_PROXY_HOPS`** decide quale indirizzo conta il limite per indirizzo. Il valore predefinito `1` è corretto per le configurazioni standard di Docker Compose e Helm; aggiungi uno per ogni proxy tuo — CDN, WAF o bilanciatore — che aggiunge a `X-Forwarded-For`, altrimenti ogni client di calendario sembra lo stesso indirizzo e tutti condividono un unico budget. Vedi [Trusted proxies](https://github.com/OneUptime/oneuptime/blob/master/HelmChart/Public/oneuptime/docs/configuration.md#trusted-proxies) nella documentazione del chart.
- **Redis** sostiene le cache e il limitatore. Entrambi degradano in modo controllato: senza Redis i feed vengono comunque generati, solo più lentamente, e il limitatore lascia passare le richieste.
- Nella modalità divisa del chart Helm (`worker.enabled: true`) i feed vengono generati sul livello API; dimensiona quel livello per una raffica di client di calendario che interrogano allo scoccare dell'ora.
- L'esenzione dal log di accesso di Nginx mostrata sopra fa parte del `Nginx/default.conf.template` distribuito; conservala se personalizzi il template.

## Risoluzione dei problemi

**Nulla ha letto il link, oppure "Impossibile recuperare l'URL".** Google Calendar, Outlook sul web, Fastmail e Proton leggono **dai propri server**, quindi l'host OneUptime deve essere raggiungibile da Internet pubblico con un certificato di cui si fidano. Un'installazione su rete privata, dietro una VPN o con un'autorità di certificazione interna è per loro irraggiungibile, qualunque cosa tu incolli. Calendario Apple, Thunderbird e Outlook classico leggono dal dispositivo, quindi funzionano ovunque il dispositivo possa aprire la dashboard, dopo aver considerato attendibile il certificato su quel dispositivo se è autofirmato. La riga di stato della pagina del feed ti dice se qualcosa ha già letto il link; `curl -I` sul link dall'esterno della tua rete è la verifica più rapida. Consentire a OneUptime di _raggiungere_ le reti private — [Accesso alle reti private](/docs/self-hosted/private-network-access) — è un'altra questione e qui non aiuta.

**Il calendario non è aggiornato.** Leggi prima la tabella degli aggiornamenti: per Google il ritardo è normale. Per far ricontrollare Google, rimuovi e aggiungi di nuovo il calendario oppure aggiungi `?nocache=1` al link (i parametri sconosciuti vengono ignorati, il feed è identico ma Google lo tratta come nuovo). In Outlook classico premi F9 e controlla l'impostazione **Limite di aggiornamento**. In Calendario Apple usa **Vista** > **Aggiorna calendari**. Se conta una modifica dello stesso giorno, affidati ai promemoria e agli avvisi di riassegnazione di OneUptime anziché al calendario.

**Il calendario è vuoto.** Un calendario vuoto è voluto. Significa che il link è disattivato, è un vecchio link nel suo periodo di tolleranza di 30 giorni dopo la rigenerazione, il progetto è al di sotto del piano che include le pianificazioni di reperibilità, oppure non sei più in alcuna pianificazione di quel progetto. Apri il link in un browser: la descrizione del calendario (`X-WR-CALDESC`) indica il motivo.

**404.** Il link è sconosciuto, è stato eliminato o il suo periodo di tolleranza è terminato. Generane uno nuovo e iscriviti di nuovo.

**503.** O `DISABLE_ON_CALL_CALENDAR_FEED` è impostato, oppure il server è occupato: vengono generati al massimo pochi feed alla volta, e una pianificazione che richiede troppo tempo per essere calcolata viene interrotta. Quando esiste una copia precedente del feed, il server serve quella con un'intestazione `Warning: 110`; un 503 significa quindi che non c'era nulla su cui ripiegare. I client conservano l'ultima copia e riprovano dopo l'intervallo `Retry-After`. Fastmail disattiva una sottoscrizione dopo cinque errori consecutivi; aggiungila di nuovo quando il server è sano. La metrica `oncall_calendar_render_duration_ms` mostra agli operatori quali feed sono lenti.

**429 o "troppe richieste".** Molti client dietro un unico indirizzo — un NAT d'ufficio, un gateway VPN — condividono il budget per indirizzo. Aumenta `ON_CALL_CALENDAR_FEED_RATE_LIMIT_PER_IP_PER_WINDOW` e controlla `TRUSTED_PROXY_HOPS`: se è troppo basso, ogni client viene attribuito al tuo proxy e tutti condividono un unico budget.

**Errori di certificato in Calendario Apple, Thunderbird o Outlook.** Queste app convalidano TLS sul dispositivo. Importa la tua CA interna nell'archivio di fiducia del dispositivo — il portachiavi di macOS, l'archivio certificati di Windows, il gestore certificati di Thunderbird — oppure usa un certificato pubblicamente attendibile. I lettori lato server come Google e Microsoft non possono essere indotti a fidarsi di una CA privata.

**Gli orari sono sbagliati.** Tutti gli orari nel file sono in UTC; l'app di calendario converte nel proprio fuso. Se i turni sembrano spostati di un intervallo fisso, controlla il fuso della pianificazione (scheda **Impostazioni**) e il tuo (**Impostazioni utente** > **Profilo**). Una pianificazione senza fuso viene calcolata nel fuso del server e l'evento lo indica.

**Il feed dice di essere stato accorciato.** Più di 5.000 eventi rientravano nella finestra. Riduci **Giorni in avanti**, oppure iscriviti a **Solo i miei turni su questa pianificazione** anziché a un intero progetto.

**Google mostra un vecchio nome di calendario.** Google legge il nome solo alla prima iscrizione; rimuovi e aggiungi di nuovo il calendario.

**La pagina delle impostazioni dice che il link va rigenerato.** `ENCRYPTION_SECRET` è cambiato da quando il link è stato creato, quindi il server non può più mostrarlo. L'iscrizione esistente continua a funzionare; la rigenerazione ti dà un link di nuovo copiabile e ritira il vecchio dopo 30 giorni.

**Manca un turno nel mio feed.** Compaiono solo i turni di pianificazione; le assegnazioni dirette di utente o team in una regola di policy sono fisse e non hanno eventi. Un turno preso in carico da qualcun altro tramite sostituzione esce dal tuo feed perché ora è nel suo. Attiva **Includi i turni che copro per altri** per vedere i turni ottenuti tramite sostituzioni su pianificazioni di cui non sei membro.
