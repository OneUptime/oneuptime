# Feed calendario

I feed calendario portano i tuoi turni di reperibilità nel calendario che consulti già. OneUptime pubblica un link iCalendar (`.ics`) segreto per ogni persona, ogni pianificazione e ogni progetto; Google Calendar, Outlook, Calendario di Apple, Thunderbird e qualsiasi altra app in grado di sottoscrivere un calendario tramite URL interrogano quel link e mostrano un evento per turno. Non si installa nulla e non si collega alcun account: il link è tutta l'integrazione.

```mermaid title="Le app di calendario interrogano un link segreto; alcune dai propri server"
flowchart TB
    subgraph links["Link .ics segreti"]
        direction LR
        personal["Feed personale"]
        schedule["Feed della pianificazione"]
        project["Feed del progetto"]
    end
    shifts["Pianificazioni, rotazioni<br/>e sostituzioni"] --> links
    links -->|"letti dai loro server"| serverApps["Google Calendar, Outlook sul web"]
    links -->|"letti dal tuo dispositivo"| deviceApps["Calendario di Apple, Thunderbird, Outlook classico"]
```

> [!NOTE]
> Un calendario sottoscritto serve a **pianificare**. Le app di calendario rileggono i feed con i propri tempi — Google Calendar solo ogni 8-24 ore —, quindi uno scambio fatto un'ora prima di un turno ti raggiunge tramite i promemoria, gli avvisi di riassegnazione e gli avvisi di reperibilità di OneUptime, non tramite il calendario.

## Che cosa ottieni

- Un evento per turno, intitolato `On-call · <Schedule>` (con ` · <Policy>` aggiunto quando la pianificazione è collegata a esattamente una policy di escalation) nel feed personale e `<Name> · On-call · <Schedule>` in un feed condiviso. La descrizione indica chi è reperibile, la pianificazione e il suo fuso orario, il livello, il turno nel fuso della pianificazione, in UTC e nel tuo fuso, le policy di escalation che ti avvisano tramite questa pianificazione e un link alla pianificazione nella dashboard.
- Le sostituzioni vengono rispettate. Quando qualcuno ti sostituisce, l'evento passa a quella persona (viene aggiunto `(covering for <Name>)`) e resta lo stesso evento nella tua app di calendario, così si aggiorna sul posto invece di duplicarsi. Una sostituzione parziale divide il turno in eventi contigui.
- Due giorni di storico e 90 giorni in avanti per impostazione predefinita. Puoi estenderli a 60 giorni indietro e 180 in avanti; un feed che supererebbe i 5.000 eventi viene accorciato e lo dice nella descrizione del suo calendario.
- Gli eventi sono segnati come liberi (`TRANSP:TRANSPARENT`), quindi un feed sottoscritto non blocca mai la tua disponibilità, e nulla è segnato come privato, così un calendario di team condiviso mostra i titoli a chiunque possa vederlo.
- Gli orari sono inviati in UTC e convertiti dalla tua app di calendario; la descrizione riporta l'ora locale nel fuso della pianificazione e nel tuo. Imposta il tuo fuso orario come **Fuso orario** nel tuo **Profilo** (la tua foto in alto a destra nella dashboard), e quello della pianificazione nella scheda **Schedule timezone** della sua pagina **Livelli**. Una pianificazione senza fuso orario viene calcolata nel fuso del server, come per gli avvisi, e l'evento lo indica.

Le assegnazioni fisse — un utente o un team nominato direttamente in una regola di una policy di escalation — non hanno inizio né fine e non compaiono in nessun feed. Su OneUptime Cloud i feed seguono lo stesso piano delle pianificazioni di reperibilità (Growth); un progetto sotto quel piano riceve un calendario vuoto invece di un errore.

## Tre tipi di link

| Link | Chi lo crea | Che cosa contiene | Dove |
| --- | --- | --- | --- |
| **Feed personale** | Ogni utente, uno per progetto | I tuoi turni su tutte le pianificazioni di quel progetto, più i turni in cui sostituisci qualcuno (facoltativo) | **Impostazioni utente** > **Calendario** > **Feed calendario** |
| **Feed della pianificazione** | Chiunque possa modificare la pianificazione; chiunque possa leggerla può copiare il link | I turni di tutti su una pianificazione, con eventi facoltativi per i buchi di copertura | La pagina della pianificazione, scheda **Sottoscrivi questo calendario turni** |
| **Feed del progetto** | Chiunque possa modificare le pianificazioni di reperibilità; chiunque possa leggerle può copiare il link | I turni di tutti su tutte le pianificazioni del progetto, con eventi facoltativi per i buchi di copertura | **Reperibilità** > **Feed calendario** |

I link hanno questo aspetto:

```text
https://<your host>/api/on-call-calendar/user/<token>/shifts.ics
https://<your host>/api/on-call-calendar/schedule/<token>/schedule.ics
https://<your host>/api/on-call-calendar/project/<token>/project.ics
```

> [!WARNING]
> Il token di 43 caratteri nel percorso è l'unica credenziale: non ci sono accesso, cookie né chiave API. Tratta ognuno di questi link come una password.

## Il tuo feed personale

I feed personali sono per progetto: un secondo progetto ha un secondo link e un secondo calendario.

:::steps
### Apri il tuo feed calendario

Apri **Impostazioni utente** > **Calendario** > **Feed calendario** nel progetto di cui vuoi i turni. **Calendario** è una sezione del menu laterale che parte chiusa.

### Genera il link

Fai clic su **Genera link del calendario**. La scheda **Sottoscrivi i tuoi turni di reperibilità** offre ora un unico percorso di sottoscrizione:

- **Aggiungi al tuo calendario**: **Google Calendar** apre Google Calendar, che chiede se aggiungere il calendario. **Calendario Apple / Outlook** apre la forma `webcal://` del link nell'app con cui il tuo computer o telefono sottoscrive: Calendario di Apple su Mac, iPhone o iPad, Outlook su Windows.
- **Oppure copia il link**: **Copia link** copia il link `https://` per qualsiasi altra app in grado di sottoscrivere un calendario tramite URL. Il link resta nascosto nella pagina finché non fai clic per mostrarlo.

### Sottoscrivi il link

Segui i passaggi per la tua app in «Sottoscrivere nella tua app di calendario» più sotto. I tuoi turni compaiono come eventi la prossima volta che l'app legge il link: vedi «Ogni quanto si aggiornano i calendari».
:::

### Impostazioni del feed

Fai clic su **Modifica impostazioni** nella scheda **Impostazioni del feed calendario** per cambiare che cosa include il link:

| Impostazione | Che cosa fa |
| --- | --- |
| **Includi i turni che copro per altri** | Attiva per impostazione predefinita. Aggiunge i turni che una sostituzione ti dà su pianificazioni di cui altrimenti non sei membro. |
| **Giorni di turni passati** | Fin dove arriva il calendario nel passato (2 per impostazione predefinita, al massimo 60). |
| **Giorni futuri** | Fin dove arriva il calendario nel futuro (90 per impostazione predefinita, tra 7 e 180). |

La riga di stato mostra quando il link è stato letto l'ultima volta, da quale app di calendario, quante volte, e gli ultimi quattro caratteri del token per distinguere i link. Se nulla ha letto il link dopo due giorni, la pagina chiede se il server è raggiungibile da Internet (vedi Risoluzione dei problemi).

### Gestisci il link

| Azione | Che cosa succede |
| --- | --- |
| **Rigenera link** | Crea un nuovo token. Ogni app sottoscritta al vecchio link smette di aggiornarsi: per 30 giorni il vecchio link serve un calendario vuoto perché quelle app svuotino la loro copia, poi risponde 404. Sottoscrivi di nuovo con il nuovo link. |
| **Disattiva** | Mantiene il link ma serve un calendario vuoto finché non lo riattivi. |
| **Elimina** | Rimuove il link. Le app che lo interrogano ancora ricevono 404 e continuano a mostrare ciò che hanno letto per ultimo: disattivalo prima se vuoi che si svuotino. |

### Turni in arrivo e sostituzioni

La pagina elenca anche i tuoi **Upcoming shifts** (i prossimi 30 giorni) e la scheda **Ricordamelo prima dei turni** descritta più sotto. Ognuno dei tuoi turni ha un link **Trova una copertura**: apre le sostituzioni utente nel progetto del turno con una nuova sostituzione già compilata per quel turno, tu come **Chi è assente?** e gli orari del turno come **Inizia** e **Termina** (da adesso, se il turno è iniziato), così resta solo **Chi sostituisce?**. La sostituzione invia tutti i tuoi avvisi di quegli orari a chi ti sostituisce, da ogni policy di reperibilità; un turno che esiste solo all'interno di una policy si copre invece nella pagina delle sostituzioni utente di quella policy. Un turno in cui sostituisci già qualcun altro non ha **Trova una copertura**: le sostituzioni non si concatenano, quindi sostituire una sostituzione non cambierebbe nulla.

Lo stesso link personale, filtrato su una pianificazione con `?schedule=<id>`, viene offerto come **Solo i miei turni in questo calendario turni** nella pagina di ogni pianificazione, e il banner di reperibilità e la pagina **I miei criteri di reperibilità** contengono un link **Aggiungi i tuoi turni al tuo calendario** alla pagina sopra.

### Nell'app mobile

Nell'app mobile: **On-Call** > **Add shifts to my calendar** (anche in **Settings** > **Calendar feed**), con un link per progetto. Su iPhone, **Open in Calendar** apre il foglio di sottoscrizione nativo. Su Android non c'è modo di sottoscrivere un URL sul telefono, quindi la schermata offre **Share link** e **Copy https link** e ti chiede di aggiungere il link su un computer; dopo si sincronizza sul telefono. L'elenco **Your shifts** dell'app viene dagli stessi dati e ha la stessa azione **Get cover**.

## Sottoscrivere nella tua app di calendario

Usa **Google Calendar** o **Calendario Apple / Outlook** in OneUptime quando la tua app ha un pulsante; qualsiasi altra app prende il link `https://` che ti dà **Copia link**. «Link https e webcal» più sotto spiega le due forme.

:::tabs
@tab Google Calendar
1. Fai clic su **Google Calendar** in OneUptime. Google Calendar si apre e chiede se aggiungere il calendario; fai clic su **Aggiungi**.
2. Oppure, in Google Calendar sul web, accanto ad **Altri calendari** fai clic su **+** > **Da URL**, incolla il link (**Copia link** in OneUptime) e fai clic su **Aggiungi calendario**.

Il pulsante **Google Calendar** apre la pagina di Google per aggiungere tramite URL, `https://calendar.google.com/calendar/r?cid=` seguito dalla forma `webcal://` del link, codificata con percentuali. Quella pagina accetta solo la forma `webcal://`: con la forma `https://`, Google risponde «Unable to add calendar. Check the URL.». **Da URL** accetta entrambe le forme.

Google legge il feed **dai server di Google**, quindi il server di OneUptime deve essere raggiungibile da Internet: OneUptime Cloud lo è sempre; per un'installazione self-hosted vedi Risoluzione dei problemi. La prima lettura avviene di solito pochi minuti dopo la sottoscrizione; poi Google aggiorna circa ogni 8-24 ore, a volte meno spesso. Non c'è un pulsante di aggiornamento per i calendari sottoscritti, e Google ignora le indicazioni di aggiornamento del feed. La riga di stato della pagina del feed mostra **Ultimo recupero … da Google Calendar** appena Google ha letto il link.

Il nome e il fuso orario del calendario vengono letti **solo alla prima sottoscrizione**: rinominare una pianificazione in seguito non rinomina il calendario in Google; rimuovilo e aggiungilo di nuovo se il nome conta. Google scarta i promemoria contenuti nei file di calendario, quindi imposta notifiche predefinite per quel calendario nelle impostazioni di Google o, meglio, usa i promemoria di OneUptime. Google ricorda un indirizzo che non è riuscito a leggere: dopo aver risolto ciò che lo impediva, aggiungi di nuovo il link con `?nocache=1` in fondo (OneUptime ignora i parametri di query sconosciuti, quindi il feed non cambia) oppure rigenera il link. L'app Google Calendar per Android e iOS non può sottoscrivere tramite URL; aggiungi il link su un computer e comparirà sul telefono.
@tab Outlook sul web
1. Apri **Calendario** > **Aggiungi calendario** > **Sottoscrivi dal Web**.
2. Incolla il link `https://` (**Copia link** in OneUptime), dai un nome al calendario e fai clic su **Importa**.

Funziona allo stesso modo in Outlook.com, in Outlook sul web per account aziendali e dell'istituto di istruzione, nel nuovo Outlook per Windows e in Outlook per Mac. Outlook legge **dai server di Microsoft**: circa ogni 3 ore per Outlook.com e ogni 4-6 ore per gli account aziendali e dell'istituto di istruzione, a volte più di un giorno. L'intervallo è fisso e non c'è aggiornamento manuale.

Sottoscrivi qui anziché nell'app desktop se vuoi il calendario anche sul telefono e in Outlook sul web: le sottoscrizioni create in Outlook classico per Windows restano su quel PC.
@tab Outlook classico per Windows
1. Su un PC con Outlook installato, fai clic su **Calendario Apple / Outlook** in OneUptime. Windows passa il link `webcal://` a Outlook, che chiede se aggiungere il calendario Internet. Senza Outlook, Windows non ha un gestore `webcal`.
2. Oppure, in Outlook, apri **File** > **Impostazioni account** > **Impostazioni account** > **Calendari Internet** > **Nuovo**, incolla il link (**Copia link** in OneUptime) e fai clic su **Aggiungi**.

**Non** aprire il link `https://…/shifts.ics` direttamente in Outlook classico: importa un'istantanea unica che non si aggiorna mai. Aprire il link `webcal://`, o aggiungere l'indirizzo in **Calendari Internet**, crea una sottoscrizione.

Il feed viene aggiornato a ogni **Invia/Ricevi** (F9, o l'intervallo dei gruppi di invio/ricezione). Le impostazioni della sottoscrizione hanno una casella **Limite di aggiornamento**: se è selezionata, Outlook non aggiorna più spesso dell'intervallo suggerito dall'editore. OneUptime suggerisce un'ora (`X-PUBLISHED-TTL:PT1H`), quindi il feed si aggiorna circa ogni ora. I feed senza questa indicazione non si aggiornano mai finché la casella è selezionata; quelli di OneUptime la contengono, quindi puoi lasciarla selezionata. Outlook classico legge il feed **dal tuo PC** e verifica il certificato del server.
@tab Calendario di Apple (macOS)
1. Fai clic su **Calendario Apple / Outlook** in OneUptime, oppure in Calendario scegli **File** > **Nuova sottoscrizione calendario** e incolla il link.
2. Nel foglio di sottoscrizione imposta **Aggiornamento automatico**, ogni 5 minuti, 15 minuti, ora, giorno o settimana (ogni ora per impostazione predefinita), e scegli **iCloud** in **Posizione** perché il calendario compaia anche su iPhone e iPad e continui ad aggiornarsi con quel ritmo.

macOS legge il feed **dal tuo Mac**, quindi funziona con un'installazione su una rete privata finché il Mac può raggiungerla. Un certificato autofirmato o di una CA interna va prima considerato attendibile nel portachiavi di macOS. **Rimuovi avvisi** è selezionato per impostazione predefinita in quel foglio; qui non fa differenza, perché il feed non contiene allarmi.
@tab iPhone e iPad
Per sottoscrivere sul dispositivo, tocca **Open in Calendar** nell'app mobile di OneUptime, oppure vai in **Impostazioni** > **Calendario** > **Account** > **Aggiungi account** > **Altro** > **Aggiungi calendario sottoscritto** e incolla il link.

Le sottoscrizioni create sul dispositivo stesso si aggiornano secondo **Impostazioni** > **Calendario** > **Account** > **Scarica nuovi dati**: **Automaticamente** per impostazione predefinita, che legge soprattutto durante la ricarica con il Wi-Fi. Per un aggiornamento affidabile, sottoscrivi su un Mac con **iCloud** come posizione, oppure imposta **Scarica nuovi dati** su un intervallo fisso.
@tab Thunderbird
Scegli **File** > **Nuovo** > **Calendario** > **Sulla rete** > **iCalendar (ICS)**, incolla il link `https://` e scegli un intervallo di aggiornamento nelle proprietà del calendario: 1, 5, 15, 30 o 60 minuti. Thunderbird legge **dal tuo computer** e deve considerare attendibile il certificato del server.
@tab Android
Né l'app Google Calendar né Samsung Calendar possono sottoscrivere un URL. Aggiungi il link `https://` a Google Calendar su un computer (**Altri calendari** > **+** > **Da URL**); il calendario si sincronizza poi sul telefono insieme a tutto il resto di quell'account Google. L'app mobile di OneUptime su Android offre **Share link** e **Copy https link** proprio per questo.
@tab Altri servizi
Fastmail aggiorna circa ogni ora e **disattiva una sottoscrizione dopo cinque letture fallite consecutive**; se succede, aggiungila di nuovo quando il server è di nuovo a posto. Proton Calendar aggiorna ogni 4-16 ore e rifiuta i feed molto grandi: riduci **Giorni futuri** se protesta. Confluence Team Calendars accetta il feed della pianificazione; il suo limite di 28 caratteri per i nomi di calendario viene rispettato.
:::

## Ogni quanto si aggiornano i calendari

| App di calendario | Aggiornamento tipico | Legge da | Note |
| --- | --- | --- | --- |
| Google Calendar (Da URL) | 8–24 ore, a volte di più | I server di Google | Nessun aggiornamento manuale; ignora le indicazioni; nome e fuso orario letti solo alla prima sottoscrizione |
| Outlook.com | Circa 3 ore | I server di Microsoft | Fisso; può superare le 24 ore |
| Outlook sul web (lavoro, istruzione) | Circa 4–6 ore | I server di Microsoft | Fisso; non regolabile |
| Outlook classico per Windows | A ogni Invia/Ricevi; circa ogni ora con **Limite di aggiornamento** | Il tuo PC | Sottoscrizione tramite il link `webcal`; non si sincronizza su telefono o web |
| Calendario di Apple (macOS) | Da 5 minuti a settimanale, ogni ora per impostazione predefinita | Il tuo Mac | Salva in iCloud per raggiungere iPhone e iPad |
| Calendario di Apple (solo iOS) | Secondo **Scarica nuovi dati**, limitato dalla batteria | Il tuo telefono | Sottoscrivi su un Mac per maggiore affidabilità |
| Thunderbird | 1–60 minuti | Il tuo computer | |
| Fastmail | Circa ogni ora | I server di Fastmail | Disattivato dopo cinque letture fallite |
| Proton Calendar | 4–16 ore | I server di Proton | Rifiuta i feed grandi |

OneUptime serve dati aggiornati: una modifica a un livello, a una rotazione, a una sostituzione o a un collegamento di policy invalida subito il feed, e le risposte restano in cache al massimo cinque minuti. L'attesa che vedi è quella dell'app di calendario, non del server. OneUptime suggerisce un aggiornamento orario tramite `REFRESH-INTERVAL` e `X-PUBLISHED-TTL`; solo Outlook classico tiene conto dell'indicazione, e solo con **Limite di aggiornamento** attivo: Calendario di Apple, Thunderbird e gli altri si aggiornano con l'intervallo che imposti per ogni calendario.

## Link https e webcal

Entrambi puntano allo stesso feed. `webcal://` è il link con lo schema rinominato, perché il sistema operativo apra un'app di calendario invece di un browser; l'app legge poi il feed via `https://` quando il server serve https, come fanno Calendario di Apple e Google Calendar.

- **Copia link** dà la forma `https://`. **Da URL** di Google Calendar, Outlook sul web, Thunderbird e Fastmail la accettano.
- **Calendario Apple / Outlook** apre la forma `webcal://`: Calendario di Apple e Outlook classico per Windows si sottoscrivono con essa. In Outlook classico, aprire invece la forma `https://` è un'importazione unica.
- **Google Calendar** porta la forma `webcal://` dentro il link di Google per aggiungere tramite URL, l'unica forma che quella pagina accetta.
- OneUptime non fornisce più `webcals://`: iOS non lo apre («l'indirizzo non è valido») e nemmeno Google lo accetta. Un calendario già sottoscritto con un link `webcals://` continua a funzionare.
- Se la tua installazione usa ancora `http` semplice, il feed viene letto in chiaro, token compreso, e la dashboard mostra un avviso accanto al link; passa a `https` prima di condividere i link in modo ampio.

Gli URL dei feed non reindirizzano mai. Rispondono `200` con qualsiasi schema arrivi a OneUptime, perché l'applicazione non può sapere quale schema abbia usato l'app di calendario quando TLS termina prima, su OneUptime Cloud o dietro un tuo load balancer o CDN, e lì un reindirizzamento punterebbe di nuovo allo stesso URL. Reindirizza `http` semplice a `https` sul proxy che termina TLS, l'unico passaggio che lo sa.

## Promemoria e avvisi di riassegnazione

Le app di calendario non consegnano gli allarmi dei feed sottoscritti (Google li scarta, Apple li rimuove per impostazione predefinita, Outlook li appiattisce), quindi OneUptime invia i propri.

:::steps
1. Apri **Impostazioni utente** > **Calendario** > **Feed calendario**.
2. Nella scheda **Ricordamelo prima dei turni** scegli gli anticipi: **1 settimana**, **1 giorno**, **1 ora**, **15 min** oppure, con **Personalizzato**, un valore personalizzato tra 15 minuti e 14 giorni. Puoi sceglierne diversi insieme.
3. Scegli come ti raggiungono i promemoria in **Prima dell'inizio del mio turno di reperibilità** in **Impostazioni utente** > **Impostazioni notifiche** (scheda Reperibilità). Email e push sono attivi per impostazione predefinita.
:::

Ogni promemoria viene inviato una volta per turno. Il messaggio nomina la pianificazione, le policy tramite cui avvisa e l'ora di inizio nel tuo fuso orario.

- Un turno che rientra in uno dei tuoi anticipi per una sostituzione tardiva (qualcuno ti passa un turno 20 minuti prima che inizi) riceve subito un unico promemoria di recupero.
- Se un turno di cui hai ricevuto un promemoria passa a qualcun altro, ricevi **Il mio prossimo turno di reperibilità viene riassegnato**, un tipo di evento separato che si può silenziare da solo.
- I promemoria non vengono mai inviati dopo l'inizio di un turno, né per pianificazioni non collegate ad alcuna policy di escalation, perché quelle non possono avvisare nessuno.
- Su WhatsApp un promemoria arriva con il modello di reperibilità pre-approvato da Meta, che nomina la pianificazione e la policy di escalation e collega la pianificazione ma non contiene l'ora di inizio, e che WhatsApp invia solo in inglese. Gli avvisi di riassegnazione non hanno un modello WhatsApp approvato, quindi ti raggiungono sugli altri canali.

## Link condivisi per una pianificazione o un progetto

Un link condiviso appartiene al **progetto**, non a chi l'ha copiato, e mostra i nomi delle persone, mai i loro indirizzi email. Metti il link della pianificazione in un calendario di team condiviso (Google, Outlook o Confluence) e una sola sottoscrizione serve tutto il team.

### Feed della pianificazione

Nella pagina di una pianificazione, la scheda **Sottoscrivi questo calendario turni** ha due metà: **Solo i miei turni in questo calendario turni** (il tuo link personale con un filtro di pianificazione) e **Turni di tutti in questo calendario turni (link di squadra condiviso)**. Chiunque abbia il permesso **Modifica** sulle pianificazioni può pubblicarlo con **Pubblica link condiviso**, rinnovarlo con **Rigenera link** o fermarlo con **Disattiva**; chiunque possa leggere la pianificazione può copiarlo. La scheda mostra quando il link è stato rinnovato l'ultima volta.

### Feed del progetto

**Reperibilità** > **Feed calendario** contiene la scheda **Turni di tutti in questo progetto (link condiviso)**, un unico link condiviso che copre tutte le pianificazioni del progetto, con le stesse azioni di pubblicazione, rigenerazione e disattivazione, e un link alla pagina del tuo feed personale.

### Impostazioni dei link condivisi

Fai clic su **Modifica impostazioni** nella scheda **Impostazioni del link condiviso**:

| Impostazione | Che cosa fa |
| --- | --- |
| **Mostra buchi di copertura** | Disattivata per impostazione predefinita. Aggiunge un evento `No coverage · <Schedule>` ovunque un livello _dovrebbe_ coprire ma nessuno è reperibile: un livello vuoto, un livello con data di inizio nel futuro, livelli che non combaciano o qualsiasi buco in una pianificazione 24×7. Le ore fuori orario di una pianificazione in orario d'ufficio non vengono mai segnalate, e vengono emessi al massimo 100 eventi di buco, i più vecchi per primi. |
| **Buco minimo da mostrare (minuti)** | 60 per impostazione predefinita. Nasconde i buchi più brevi. |
| **Rigenera quando qualcuno lascia il progetto** | Disattivata per impostazione predefinita. Rigenera automaticamente il link quando qualcuno lascia il suo ultimo team nel progetto, così il calendario di un ex collega smette di aggiornarsi. Tutti gli altri devono poi sottoscrivere di nuovo, per questo va attivata di proposito. |
| **Giorni di turni passati**, **Giorni futuri** | Come per il feed personale. |

Rinnova un link condiviso quando se ne va qualcuno che lo aveva, oppure attiva la rotazione automatica sopra.

Quando una persona lascia il suo ultimo team in un progetto, OneUptime la rimuove anche dai livelli delle pianificazioni e dalle regole di escalation di quel progetto, elimina le sostituzioni attive e future del progetto che la nominano (come persona sostituita o come sostituto), disattiva il suo feed personale per il progetto ed elimina lì i suoi promemoria. Un link personale mostra i turni solo finché il suo proprietario è membro del progetto: lo si verifica a ogni lettura del link, così chi se n'è andato riceve un calendario vuoto, e l'elenco dei turni in arrivo nell'app mobile copre solo i progetti di cui è ancora membro.

## Gli eventi nel dettaglio

- Ogni turno ha un'identità stabile formata dalla pianificazione e dall'inizio del turno, così lo stesso turno è lo stesso evento nel feed personale, nel feed della pianificazione e dopo la rigenerazione di un link. Le app di calendario lo aggiornano sul posto; una modifica incrementa il numero di sequenza dell'evento.
- Una sostituzione che scambia l'intero turno mantiene l'evento e cambia la persona; una sostituzione di parte di un turno produce tre eventi contigui, ad esempio A 09:00–12:00, B 12:00–13:00, A 13:00–17:00.
- Quando una pianificazione è collegata a due o più policy di escalation e una sostituzione vale solo per una di esse, le persone avvisate cambiano a seconda della policy. Il feed lo mostra invece di nasconderlo: il turno mantiene il suo evento per la persona avvisata dalle altre policy, con una nota che nomina la policy che avvisa qualcun altro, e il sostituto riceve un evento aggiuntivo intitolato `On-call · <Schedule> · <Policy> (covering for <Name>)`.
- I turni passati riportano nella descrizione la riga «Past shifts reflect the current rotation, not who was actually paged».
- Una pianificazione non collegata ad alcuna policy di escalation viene comunque mostrata, con una nota che non avviserà nessuno.

## Pianificare, non verificare

Il feed mostra la rotazione **così come è configurata adesso**, anche per i giorni passati: una sostituzione inserita dopo riscrive la storia nel calendario. Per le ore effettivamente trascorse in reperibilità, le verifiche di equità e i compensi, usa **Reperibilità** > **Report** > **Tempo di reperibilità dell'utente**, che si basa su ciò che gli avvisi hanno effettivamente fatto.

## Sicurezza

- Il token nel link è l'unica credenziale. Chiunque abbia il link vede i turni (nomi, pianificazioni, policy) finché non viene rigenerato. Non incollare i link in chat o ticket; quando un team ha bisogno di un calendario, condividi il link della pianificazione o del progetto invece del tuo personale.
- I link sono per progetto. Un link personale trapelato espone i turni di un progetto, non di tutti i progetti di cui fai parte.
- Rigenerare un link sposta il vecchio token in un periodo di tolleranza di 30 giorni (calendario vuoto, poi 404). **Disattiva** serve un calendario vuoto. Un link sconosciuto o scaduto risponde con un semplice 404 senza indizi. I calendari vuoti fanno svuotare la copia alle app sottoscritte; un 404 la fa conservare, per questo disattivare e rigenerare servono calendari vuoti.
- I token sono memorizzati come hash; la copia mostrata nella pagina delle impostazioni è cifrata con `ENCRYPTION_SECRET`. Imposta questa variabile con un vero segreto su un'installazione self-hosted: il server avvisa all'avvio quando non è impostata o è ancora uno dei segnaposto forniti da questo repository (`secret`, o il `please-change-this-to-random-value` impostato da `config.example.env`). Se la cambi in seguito, la pagina propone **Rigenera link** perché la copia memorizzata non è più leggibile; il feed continua a funzionare finché non lo fai.
- Le risposte dei feed sono contrassegnate con `Cache-Control: private`, escluse dai motori di ricerca (`X-Robots-Tag: noindex`) e soggette a limiti di frequenza per link e per indirizzo client.

Il Nginx di OneUptime tiene le richieste dei feed fuori dai suoi log:

```nginx title="default.conf.template"
location ~ ^/api/on-call-calendar/(user|schedule|project)/ {
    access_log off;
    error_log /dev/null crit;
    proxy_max_temp_file_size 0;
    ...
}
```

Così un token non finisce mai in un file di log accanto all'indirizzo di un client; nemmeno l'applicazione lo registra mai. `access_log off` elimina la riga per richiesta, `error_log` elimina le righe che Nginx scrive quando una chiamata all'applicazione non riesce (senza, viene registrato il token di ogni client che interroga durante un riavvio) e `proxy_max_temp_file_size 0` tiene un feed grande fuori da un file temporaneo.

> [!WARNING]
> **Qualsiasi proxy, WAF o CDN che metti davanti a OneUptime registra comunque l'URI completo, sia nel log di accesso sia in quello degli errori,** a meno che tu non lo configuri diversamente: verificalo prima di distribuire i feed.

## Configurazione self-hosted

Non c'è nulla da attivare: i feed funzionano su ogni installazione. Quattro variabili d'ambiente li controllano, impostate in `config.env` per Docker Compose o in `onCallCalendarFeed` nei valori Helm (vedi il [riferimento di configurazione](https://github.com/OneUptime/oneuptime/blob/master/HelmChart/Public/oneuptime/docs/configuration.md#on-call-calendar-feeds) del chart):

| Variabile | Valore Helm | Predefinito | Effetto |
| --- | --- | --- | --- |
| `DISABLE_ON_CALL_CALENDAR_FEED` | `onCallCalendarFeed.disabled` | `false` | Interruttore di emergenza. Ogni URL di feed risponde `503` con `Retry-After: 3600`; le app sottoscritte mantengono la loro copia e riprovano più tardi. Non viene eliminato nulla. |
| `ON_CALL_CALENDAR_FEED_RATE_LIMIT_WINDOW_SECONDS` | `onCallCalendarFeed.rateLimit.windowSeconds` | `60` | Durata della finestra del limite di frequenza. |
| `ON_CALL_CALENDAR_FEED_RATE_LIMIT_PER_TOKEN_PER_WINDOW` | `onCallCalendarFeed.rateLimit.perTokenPerWindow` | `60` | Letture che un link può fare da un indirizzo client per finestra. |
| `ON_CALL_CALENDAR_FEED_RATE_LIMIT_PER_IP_PER_WINDOW` | `onCallCalendarFeed.rateLimit.perIpPerWindow` | `3000` | Letture che un indirizzo client può fare su tutti i link per finestra: il tetto per un intero ufficio dietro un solo indirizzo. |

Conta anche:

- **`HOST` e `HTTP_PROTOCOL`** costruiscono i link. Se `HOST` è vuoto o è `localhost`, o se `HTTP_PROTOCOL` è `http`, la pagina del feed mostra un avviso e i link non funzioneranno dall'esterno. Se `HOST` è un indirizzo privato (`10.x`, `172.16–31.x`, `192.168.x`, un nome senza punto come quello di un container, o un nome sotto `.internal`, `.local`, `.lan` e simili), la pagina dice che Google Calendar e Outlook sul web non possono raggiungere il link; le app su un computer della stessa rete invece sì.
- **`TRUSTED_PROXY_HOPS`** decide quale indirizzo conta per il limite per indirizzo. Il valore predefinito `1` è giusto per le configurazioni standard di Docker Compose e Helm; aggiungine uno per ogni tuo proxy (CDN, WAF o load balancer) che aggiunge a `X-Forwarded-For`, altrimenti ogni client di calendario sembra lo stesso indirizzo e tutti condividono un unico budget. Vedi [Trusted proxies](https://github.com/OneUptime/oneuptime/blob/master/HelmChart/Public/oneuptime/docs/configuration.md#trusted-proxies) nella documentazione del chart.
- **Redis** sostiene le cache e il limite di frequenza. Entrambi degradano con grazia: senza Redis i feed vengono comunque generati, solo più lentamente, e il limite lascia passare le richieste.
- Nella modalità divisa del chart Helm (`worker.enabled: true`) i feed vengono generati sul livello API, quindi dimensiona quel livello per un'ondata di client di calendario che interrogano allo scoccare dell'ora.
- L'esenzione dal log di accesso di Nginx mostrata sopra fa parte del `packages/Nginx/default.conf.template` fornito; mantienila se personalizzi il modello.

## Risoluzione dei problemi

:::details Google Calendar dice "Unable to add calendar. Check the URL."
Le versioni precedenti di OneUptime mettevano la forma `https://` del link nel pulsante **Google Calendar**, mentre la pagina di Google per aggiungere tramite URL accetta solo la forma `webcal://`. Ricarica la pagina del feed e fai di nuovo clic su **Google Calendar**, oppure aggiungi il link in **Altri calendari** > **+** > **Da URL**.
:::

:::details Google Calendar mostra il calendario ma nessun turno
Controlla prima la riga di stato della pagina del feed. **Ultimo recupero … da Google Calendar** significa che Google ha letto il link: apri il link in un browser e guarda che cosa serve; un calendario vuoto indica il motivo in `X-WR-CALDESC` (vedi «Il calendario è vuoto» più sotto).

**Non ancora recuperato** significa che Google non è riuscito a leggerlo: da una macchina fuori dalla tua rete, `curl -sI <link>` deve rispondere subito `200` con `Content-Type: text/calendar`. Un reindirizzamento, una pagina di accesso, un firewall o un controllo anti-bot davanti a OneUptime ferma il lettore di Google; lo faceva anche un ciclo di reindirizzamenti nelle versioni precedenti di OneUptime, sulle installazioni con `PROVISION_SSL=true` il cui TLS termina prima di Nginx. Quando risponde `200`, aggiungi di nuovo il link con `?nocache=1` in fondo perché Google lo rilegga.
:::

:::details Nulla ha letto il link, oppure «Impossibile recuperare l'URL»
Google Calendar, Outlook sul web, Fastmail e Proton leggono **dai propri server**, quindi l'host di OneUptime deve essere raggiungibile dall'Internet pubblico con un certificato che considerano attendibile. Un'installazione su una rete privata, dietro una VPN o con un'autorità di certificazione interna è per loro irraggiungibile, qualunque cosa incolli.

Calendario di Apple, Thunderbird e Outlook classico leggono dal dispositivo, quindi funzionano ovunque il dispositivo possa aprire la dashboard, dopo aver reso attendibile il certificato su quel dispositivo se è autofirmato. La riga di stato della pagina del feed ti dice se qualcosa ha già letto il link; `curl -I` sul link da fuori dalla tua rete è il controllo più rapido:

```bash
curl -I "https://<your host>/api/on-call-calendar/user/<token>/shifts.ics"
```

Permettere a OneUptime di _raggiungere_ reti private ([Accesso alle reti private](/docs/self-hosted/private-network-access)) è un'altra questione e qui non aiuta.
:::

:::details Il calendario non è aggiornato
Leggi prima la tabella degli aggiornamenti: per Google il ritardo è normale. Per far rileggere Google, rimuovi e aggiungi di nuovo il calendario o aggiungi `?nocache=1` al link (i parametri sconosciuti vengono ignorati, quindi il feed non cambia, ma Google lo tratta come nuovo). In Outlook classico premi F9 e controlla l'impostazione **Limite di aggiornamento**. In Calendario di Apple usa **Vista** > **Aggiorna calendari**. Se conta una modifica del giorno stesso, affidati ai promemoria e agli avvisi di riassegnazione di OneUptime più che al calendario.
:::

:::details Il calendario è vuoto
Un calendario vuoto è voluto. Significa che il link è disattivato, che è un vecchio link nel suo periodo di tolleranza di 30 giorni dopo una rigenerazione, che il progetto è sotto il piano che include le pianificazioni di reperibilità, o che non sei più in nessuna pianificazione di quel progetto. Apri il link in un browser: la descrizione del calendario (`X-WR-CALDESC`) ne indica il motivo. Se hai lasciato il progetto, il link resta vuoto: mostra i turni solo finché sei membro.
:::

:::details Il link risponde 404
Il link è sconosciuto, è stato eliminato o il suo periodo di tolleranza è finito. Generane uno nuovo e sottoscrivi di nuovo.
:::

:::details Il link risponde 503
`DISABLE_ON_CALL_CALENDAR_FEED` è impostato, oppure il server è occupato: vengono generati solo pochi feed alla volta, e una pianificazione che richiede molto tempo per essere calcolata viene interrotta. Quando esiste una copia precedente del feed, il server serve quella, con un'intestazione `Warning: 110`, quindi un 503 significa che non c'era nulla su cui ripiegare. I client mantengono la loro ultima copia e riprovano dopo l'intervallo `Retry-After`. Fastmail disattiva una sottoscrizione dopo cinque errori di fila; aggiungila di nuovo quando il server è a posto. La metrica `oncall_calendar_render_duration_ms` mostra agli operatori quali feed sono lenti.
:::

:::details 429 o «troppe richieste»
Molti client dietro un unico indirizzo (un NAT d'ufficio, un gateway VPN) condividono il budget per indirizzo. Aumenta `ON_CALL_CALENDAR_FEED_RATE_LIMIT_PER_IP_PER_WINDOW` e controlla `TRUSTED_PROXY_HOPS`: se è troppo basso, ogni client viene attribuito al tuo proxy e tutti condividono un unico budget.
:::

:::details Errori di certificato in Calendario di Apple, Thunderbird o Outlook
Queste app convalidano TLS sul dispositivo. Importa la tua CA interna nell'archivio attendibile del dispositivo (il portachiavi di macOS, l'archivio certificati di Windows, il gestore certificati di Thunderbird) oppure usa un certificato pubblicamente attendibile. I lettori lato server come Google e Microsoft non possono essere indotti a considerare attendibile una CA privata.
:::

:::details Gli orari sono sbagliati
Tutti gli orari nel file sono in UTC; l'app di calendario li converte nel proprio fuso. Se i turni sembrano spostati di un intervallo fisso, controlla il fuso della pianificazione (**Schedule timezone** nella sua pagina **Livelli**) e il tuo (**Fuso orario** nel tuo **Profilo**). Una pianificazione senza fuso orario viene calcolata nel fuso del server, e l'evento lo indica.
:::

:::details Il feed dice di essere stato accorciato
Più di 5.000 eventi rientravano nella finestra. Riduci **Giorni futuri**, oppure sottoscrivi **Solo i miei turni in questo calendario turni** invece di un intero progetto.
:::

:::details Google mostra un vecchio nome di calendario
Google legge il nome solo alla prima sottoscrizione; rimuovi il calendario e aggiungilo di nuovo.
:::

:::details La pagina delle impostazioni dice che il link va rigenerato
`ENCRYPTION_SECRET` è cambiato dopo la creazione del link, quindi il server non può più mostrarlo. La sottoscrizione esistente continua a funzionare; rigenerarlo ti dà un link che puoi copiare di nuovo e ritira il vecchio dopo 30 giorni.
:::

:::details Manca un turno nel mio feed
Compaiono solo i turni delle pianificazioni; le assegnazioni dirette di utenti o team in una regola di policy sono fisse e non hanno eventi. Un turno preso da qualcun altro tramite una sostituzione esce dal tuo feed perché ora è nel suo. Attiva **Includi i turni che copro per altri** per vedere i turni ottenuti tramite sostituzioni su pianificazioni di cui non sei membro.
:::

## Passaggi successivi

:::cards
- [Pianificazioni di reperibilità](/docs/on-call/schedules): Configura le rotazioni che mostrano i tuoi feed.
- [Cronologia delle reperibilità](/docs/on-call/schedule-timeline): Guarda tutte le pianificazioni affiancate nella dashboard.
- [Regole di escalation](/docs/on-call/escalation-rules): Collega le pianificazioni alle policy perché i loro turni avvisino le persone.
:::
