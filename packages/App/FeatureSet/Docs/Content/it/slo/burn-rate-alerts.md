# Avvisi e incidenti di tasso di consumo

I budget di errore ti dicono a che punto sei; le regole del tasso di consumo ti dicono quando alzarti dal letto. Quando uno SLO spende il suo budget di errore abbastanza in fretta da contare, una regola del tasso di consumo genera un avviso, dichiara un incidente o entrambe le cose, con titolo e descrizione tuoi, gravità, proprietari, etichette, escalation di reperibilità e notifiche dell'area di lavoro.

:::cards
- [Come decide una regola](#come-una-regola-decide-di-scattare): Due finestre, entrambe sopra la soglia.
- [Regole predefinite](#regole-predefinite): Fast burn e Slow burn, adattate alla finestra dello SLO.
- [Creare una regola](#creare-o-modificare-una-regola): Cinque passi nella pagina Burn Rate Rules dello SLO.
- [Variabili del modello](#cosa-dice-ogni-avviso-e-incidente): Scrivi titoli e descrizioni tuoi.
:::

## Cosa significa tasso di consumo

Il tasso di consumo è la velocità con cui spendi il budget di errore rispetto a un ritmo regolare:

```text
burn rate = (share of time that was bad) ÷ (share of time the target allows to be bad)
```

Con un tasso di consumo di 1 spendi il budget esattamente lungo la finestra e raggiungi l'obiettivo senza nulla di avanzo. Numeri più alti lo esauriscono prima. Per uno SLO al 99,9% su 30 giorni:

| Tasso di consumo, se dura | Budget esaurito in |
| --- | --- |
| 1 | 30 giorni |
| 2 | 15 giorni |
| 6 | 5 giorni |
| 14.4 | circa 2 giorni (50 ore) |

Il tasso di consumo non dipende da quanto budget resta. Risponde a «quanto è grave adesso?», ed è ciò che serve per decidere se avvisare qualcuno.

## Come una regola decide di scattare

OneUptime controlla ogni regola del tasso di consumo abilitata a ogni valutazione dello SLO, ogni 5 minuti. Ogni regola misura il tasso di consumo su due finestre e scatta solo quando entrambe sono alla sua soglia o sopra:

- La **finestra lunga** (per esempio 1 ora) mostra che il consumo è prolungato e significativo, non un singolo controllo fallito.
- La **finestra breve** (per esempio 5 minuti) mostra che sta ancora succedendo. Senza di essa, un picco di un'ora fa continuerebbe ad avvisare molto dopo il recupero.

È lo schema a più finestre e più tassi di consumo del Google SRE Workbook, e quello che OneUptime imposta per te.

```mermaid title="Cosa fa una regola del tasso di consumo a ogni valutazione"
flowchart TB
    start["Lo SLO viene valutato"] --> long(["Finestra lunga<br/>alla soglia<br/>o sopra?"])
    long -->|"No"| recover["Risolvere ciò che è<br/>aperto, se la risoluzione<br/>automatica è attiva"]
    long -->|"Sì"| short(["Finestra breve<br/>alla soglia<br/>o sopra?"])
    short -->|"No"| hold["Lasciare aperto<br/>ciò che è aperto"]
    short -->|"Sì"| fire["Generare l'avviso,<br/>dichiarare l'incidente<br/>o entrambi"]
```

Una regola non può scattare finché lo SLO non ha una finestra lunga completa di cronologia di monitoraggio: altrimenti il primissimo controllo fallito di un monitor, diviso per pochi minuti di cronologia, darebbe un tasso di consumo enorme. Quindi un nuovo SLO non può far scattare la sua regola **Fast burn** nella prima ora, né la sua regola **Slow burn** nelle prime sei. Se in seguito uno SLO non ha più tanta cronologia, per esempio dopo che i suoi monitor sono stati sostituiti con altri nuovi, la regola risolve ciò che ha aperto invece di lasciarlo in sospeso. Una regola non scatta nemmeno mentre uno dei monitor dello SLO è in una manutenzione pianificata: vedi [Manutenzione pianificata](#manutenzione-pianificata).

## Regole predefinite

Ogni nuovo SLO riceve due regole del tasso di consumo. Per una finestra di 30 giorni:

| Regola | Soglia | Finestra lunga | Finestra breve | Scatta quando |
| --- | --- | --- | --- | --- |
| **Fast burn** | 14.4× | 1 ora | 5 minuti | Circa il 2% del budget si consuma in un'ora: finirebbe in circa 2 giorni. |
| **Slow burn** | 6× | 6 ore | 30 minuti | Circa il 5% del budget si consuma in sei ore: finirebbe in circa 5 giorni. |

Le soglie di 14.4× e 6× sono calcolate per un budget di 30 giorni, quindi OneUptime le adatta alla finestra del tuo SLO. Ogni regola significa sempre «il 2% del budget in 1 ora» o «il 5% del budget in 6 ore»:

| Finestra dello SLO | Soglia di Fast burn | Soglia di Slow burn |
| --- | --- | --- |
| 7 giorni | 3.36× | 1.4× |
| 28 giorni | 13.44× | 5.6× |
| 30 giorni | 14.4× | 6× |
| 90 giorni | 43.2× | 18× |

Gli SLO a mese di calendario ricevono i valori di 30 giorni. Le due regole generano un avviso con la gravità di avviso più alta del progetto, con il titolo e la descrizione predefiniti, lo risolvono automaticamente e non aggiungono proprietari né etichette. Non dichiarano incidenti, quindi aggiornare OneUptime non inizia mai a dichiarare incidenti al posto tuo. Modificale, eliminale o aggiungine di tue.

## Creare o modificare una regola

Ti serve il permesso di creare regole del tasso di consumo degli SLO.

:::steps
### Aprire Burn Rate Rules

Apri lo SLO, vai a **Burn Rate Rules** e fai clic su **Crea: SLO Burn Rate Rule**, oppure modifica una delle regole predefinite.

### Dare un nome alla regola

In **Rule**, inserisci un **Nome**, come «Fast burn». **Abilitato** è attivo.

### Impostare la finestra di consumo

In **Burn Window**, imposta la **Burn Rate Threshold** (per esempio `14.4`), la **Long Window (Minutes)** e la **Short Window (Minutes)**, e se vuoi la **Re-fire Suppression (Minutes)**.

### Scegliere cosa dichiara

In **What It Declares**, attiva **Crea avviso**, **Dichiara incidente** o entrambi. **Add SLO Owners as Owners** rende anche i proprietari dello SLO proprietari di tutto ciò che la regola crea.

### Descrivere l'avviso e l'incidente

I passi **Avviso** e **Incidente** compaiono solo per ciò che la regola dichiara. Ognuno ha un titolo e una gravità, e sezioni chiuse: **Descrizione**, **Proprietà ed etichette**, **Reperibilità** e **Altri campi**, che contiene risoluzione automatica, privacy e note di correzione. Le nuove regole partono con il titolo e la descrizione predefiniti, pronti da modificare. Fai clic su **Crea: SLO Burn Rate Rule** nell'ultimo passo.
:::

OneUptime controlla i numeri di una regola quando la salvi:

| Impostazione | Deve essere |
| --- | --- |
| **Burn Rate Threshold** | Maggiore di 0. |
| **Short Window (Minutes)** | Maggiore di 0. |
| **Long Window (Minutes)** | Più lunga della finestra breve. |
| **Re-fire Suppression (Minutes)** | 0 o più. Vuoto significa la durata della finestra lunga. |

Una regola deve creare un avviso, dichiarare un incidente o entrambi: una regola con entrambi disattivati viene rifiutata, perché verrebbe controllata a ogni valutazione senza dichiarare mai nulla.

La tabella delle regole mostra per ogni regola la soglia, le finestre e la soppressione, cosa dichiara (e se l'avviso o l'incidente si risolve solo a mano, o è privato), le gravità, le politiche di reperibilità, i proprietari e le etichette.

> [!TIP]
> Un buon punto di partenza: tieni le due regole predefinite, manda la regola di consumo rapido alla tua politica di reperibilità che avvisa, con gravità alta, e lascia che la regola di consumo lento generi un avviso di gravità più bassa per l'orario di lavoro. Se il tuo team gestisce tutto con gli incidenti, attiva **Dichiara incidente** sulla regola di consumo rapido, e disattiva lì **Crea avviso** se preferisci non riceverli entrambi.

## Cosa dichiara una regola

|  | **Crea avviso** | **Dichiara incidente** |
| --- | --- | --- |
| All'inizio | Attivo | Disattivato |
| Cos'è | Il segnale leggero: finisce nell'elenco degli avvisi. | Il segnale pesante: prende un numero di incidente e avvia tutto il flusso di risposta. |
| Titolo e descrizione | I propri, o il testo predefinito | I propri, o il testo predefinito |
| Gravità | **Gravità avviso**: la più alta del progetto se vuota | **Gravità incidente**: la più alta del progetto se vuota |
| Escalation | **Alert On-Call Duty Policies** | **Incident On-Call Duty Policies** |
| Proprietari ed etichette | **Proprietari dell'avviso** e **Etichette dell'avviso** | **Proprietari dell'incidente** e **Etichette dell'incidente** |
| Privato | Disattivato | Disattivato |
| Risoluzione automatica | Attiva | Attiva |
| Pagine di stato | Mai pubblicato | Mai pubblicato |

Poiché ognuno si configura separatamente, puoi mandare un avviso breve alla rotazione del team responsabile e un incidente dettagliato alla tua rotazione per gli incidenti gravi. Vivono anche separatamente: ognuno viene deduplicato, risolto e soppresso per conto suo, quindi risolvere l'incidente non azzera la soppressione dell'avviso, né il contrario.

### Lo SLO è una risorsa interessata

Ogni avviso e incidente creato da una regola del tasso di consumo elenca il suo SLO in **Risorse interessate** e vi rimanda. Il filtro **Risorse interessate** degli elenchi di avvisi e incidenti li limita a uno SLO, e le pagine **Avvisi** e **Incidenti** dello SLO li elencano, con badge nel menu laterale che contano quelli aperti. OneUptime crea questo collegamento da solo, e modificare l'avviso o l'incidente non lo rimuove mai.

### Gli incidenti di tasso di consumo restano interni

Un budget di errore che si consuma in fretta è un segnale per l'ingegneria, non un'interruzione dichiarata. Un incidente di tasso di consumo non viene mai mostrato sulle pagine di stato e non avvisa mai gli iscritti alle pagine di stato. Non è nemmeno collegato a nessun monitor, perché risolverlo riscriverebbe altrimenti proprio la cronologia di stato dei monitor da cui si misura lo SLO.

Se risolvi un incidente del genere a mano, niente lo dichiara di nuovo finché il consumo non si è ripreso e la regola non scatta davvero di nuovo, così non ti ritrovi mai a lottare contro la regola mentre lavori a un incidente.

## Cosa dice ogni avviso e incidente

Le nuove regole partono con il titolo e la descrizione predefiniti, sia nell'avviso sia nell'incidente. Svuota un titolo o una descrizione per tornare al testo predefinito. Il titolo predefinito è:

```text
SLO burn rate: {{sloName}} — {{ruleName}}
```

La descrizione predefinita nomina la regola, indica il tasso di consumo di entrambe le finestre rispetto alla soglia e il budget di errore rimanente.

Per scrivere i tuoi, usa le variabili del modello nel titolo, nella descrizione e nelle note di correzione. Ognuno di questi campi le elenca in **Variabili del modello**: fai clic su una per inserirla dove si trova il cursore, oppure digita `{{` nel campo e scegline una. La descrizione e le note di correzione hanno anche **Inserisci variabile** nella barra degli strumenti. Le variabili vengono compilate quando la regola scatta:

| Variabile | Cosa contiene | Esempio |
| --- | --- | --- |
| `{{sloName}}` | Nome dello SLO. | `Checkout availability` |
| `{{sloId}}` | ID dello SLO. | `b7f4c2d8-1f3e-4a5b-9c6d-7e8f9a0b1c2d` |
| `{{sloLink}}` | Link allo SLO nella dashboard di OneUptime. | `https://oneuptime.com/dashboard/project-id/slos/slo-id` |
| `{{sloStatus}}` | Stato dello SLO dopo questa valutazione. | `At Risk` |
| `{{ruleName}}` | Nome della regola del tasso di consumo che è scattata. | `Fast burn` |
| `{{burnRateThreshold}}` | La soglia del tasso di consumo della regola (un multiplo del ritmo sostenibile). | `14.4` |
| `{{longWindowBurnRate}}` | Tasso di consumo misurato sulla finestra lunga della regola. | `21.5` |
| `{{shortWindowBurnRate}}` | Tasso di consumo misurato sulla finestra breve della regola. | `36` |
| `{{longWindowInMinutes}}` | Durata della finestra lunga della regola, in minuti. | `60` |
| `{{shortWindowInMinutes}}` | Durata della finestra breve della regola, in minuti. | `5` |
| `{{targetPercentage}}` | L'obiettivo dello SLO, in percentuale. | `99.9` |
| `{{currentSliPercentage}}` | Lo SLI misurato sulla finestra di conformità dello SLO, in percentuale. | `99.87` |
| `{{errorBudgetRemainingPercentage}}` | Quota del budget di errore ancora disponibile, in percentuale. Negativa quando il budget è superato. | `42.5` |
| `{{errorBudgetRemaining}}` | Budget di errore ancora disponibile, come durata. Inizia con un segno meno quando il budget è superato. | `18m 22s` |
| `{{errorBudgetRemainingMinutes}}` | Budget di errore ancora disponibile, in minuti. | `18.37` |
| `{{windowDescription}}` | La finestra di conformità dello SLO, a parole. | `rolling 30-day window` |

Per esempio, il titolo `{{ruleName}}: {{sloName}} is burning {{longWindowBurnRate}}x` diventa `Fast burn: Checkout availability is burning 21.5x`.

:::details Come vengono compilate le variabili
- I numeri sono arrotondati a due decimali.
- Gli spazi dentro le parentesi graffe vanno bene: `{{ sloName }}` funziona.
- Una variabile scritta male resta esattamente com'è, così un errore di battitura si vede nell'avviso invece di sparire in silenzio.
- I titoli possono avere 500 caratteri, e le descrizioni e le note di correzione 50.000. Un titolo che supera i 500 caratteri dopo la compilazione delle variabili viene messo su una riga e accorciato con i puntini di sospensione, così l'avviso o l'incidente viene creato comunque.
- Se il link allo SLO non si può costruire quando la regola scatta, `{{sloLink}}` resta vuoto e l'avviso o l'incidente viene creato comunque.
:::

## Proprietari, etichette e privacy

- **Proprietari dell'avviso** e **Proprietari dell'incidente** sono persone e team, scelti da un solo elenco con **Aggiungi proprietario**. Vengono aggiunti all'avviso o all'incidente appena viene creato, e ricevono una notifica. Le persone devono essere membri del progetto.
- **Add SLO Owners as Owners** aggiunge anche i proprietari dello SLO, i suoi utenti proprietari e i membri dei suoi team proprietari, a tutto ciò che la regola crea. I proprietari dello SLO sanno già dei cambi di stato dello SLO stesso, quindi questo può avvisarli due volte. È disattivato per impostazione predefinita.
- Ogni proprietario viene aggiunto una volta: un utente che è già proprietario dell'avviso o dell'incidente, per esempio tramite le regole del proprietario del progetto, o che è in un team proprietario aggiunto, non viene aggiunto di nuovo.
- **Etichette dell'avviso** e **Etichette dell'incidente** vengono aggiunte all'avviso o all'incidente, così filtri, regole del proprietario e regole di notifica dell'area di lavoro possono corrispondere.
- Un avviso o un incidente privato è visibile solo ai suoi proprietari, agli amministratori del progetto e ai proprietari del progetto.

Etichette, team proprietari e politiche di reperibilità devono appartenere al progetto dello SLO.

## Risoluzione e soppressione dei nuovi scatti

- **La risoluzione segue la finestra lunga.** Con la risoluzione automatica attiva (impostazione predefinita), OneUptime risolve l'avviso e l'incidente di una regola appena il tasso di consumo della finestra lunga scende sotto la soglia. Risolvere sulla finestra breve farebbe oscillare: un'interruzione ricorrente si risolverebbe dopo cinque minuti tranquilli e avviserebbe di nuovo tutta la notte.
- **Risoluzione automatica disattivata.** Disattiva **Risoluzione automatica dell'avviso** o **Risoluzione automatica dell'incidente** e quel record resta aperto finché qualcuno non lo risolve, anche dopo che il consumo si è ripreso. La regola non ne apre un altro sopra, e una volta risolto a mano e con la finestra lunga sotto la soglia, la regola può scattare di nuovo dopo la sua soppressione.
- **Soppressione dei nuovi scatti.** Dopo che un record si risolve, la regola non dichiara più quel tipo di record per il periodo di soppressione, per impostazione predefinita la durata della finestra lunga. Così un sistema che si sta riprendendo ha il tempo di farlo senza avvisare per il rumore che resta.

Alcune modifiche risolvono sempre ciò che una regola ha aperto, qualunque cosa dicano le sue impostazioni di risoluzione automatica, così niente continua a scalare per una regola che non può più giustificarlo:

- disattivare **Crea avviso** o **Dichiara incidente** chiude ciò che quell'uscita aveva aperto;
- disattivare la regola o eliminarla;
- disattivare la valutazione dello SLO, archiviare lo SLO o eliminarlo;
- il passaggio dello SLO a **In pausa** o **Misconfigured**, perché allora non misura nulla;
- la perdita della soglia o delle finestre della regola, o il fatto che lo SLO non abbia più una finestra lunga completa di cronologia.

## Manutenzione pianificata

Mentre un monitor dello SLO è in un evento di manutenzione pianificata in corso, le sue regole del tasso di consumo non generano avvisi né dichiarano incidenti: il lavoro pianificato non deve avvisare nessuno. Ciò che le regole hanno già aperto si risolve comunque come al solito. Il tempo conta comunque nel budget di errore, secondo gli stati di inattività dello SLO.

## Il feed dello SLO

Il **Feed** dello SLO pubblica ogni avviso generato da una regola e ogni incidente che dichiara, con un link e i tassi di consumo che lo spiegano, e quando ognuno si risolve, automaticamente o a mano. Un record che la regola riprende perché era ancora aperto non viene pubblicato due volte. Anche creare, modificare ed eliminare una regola viene pubblicato, e registrato nei **Registri di audit** dello SLO. Vedi [Feed e registri di audit degli SLO](/docs/slo/feed-and-audit-logs).

## Risoluzione dei problemi

:::details Una regola non è scattata subito dopo la creazione dello SLO
Una regola scatta solo quando lo SLO ha una finestra lunga completa di cronologia di monitoraggio: un'ora per la regola di consumo rapido predefinita, sei ore per quella di consumo lento.
:::

:::details Un avviso si è risolto mentre l'interruzione era ancora in corso
La risoluzione automatica segue la finestra lunga: appena il tasso di consumo della finestra lunga scende sotto la soglia, l'avviso si risolve. Dai alla regola una finestra lunga più lunga, oppure disattiva **Risoluzione automatica dell'avviso** e risolvi l'avviso a mano.
:::

:::details Non è scattato nulla durante un evento di manutenzione pianificata
Le regole del tasso di consumo restano in silenzio mentre uno dei monitor dello SLO è in un evento di manutenzione pianificata in corso. L'inattività conta comunque nel budget.
:::

:::details Esiste un numero minimo di campioni?
Non per gli SLO misurati dalla disponibilità dei monitor. La disponibilità si misura in secondi, quindi ogni secondo della finestra è un campione e non c'è un caso di traffico basso da cui proteggersi. Un numero minimo di campioni conta solo per gli SLI basati su eventi, che non sono ancora disponibili.
:::

## Passi successivi

:::cards
- [Budget di errore](/docs/slo/error-budget): Cos'è il budget e quanto dura.
- [Regole di escalation](/docs/on-call/escalation-rules): Chi viene avvisato, e in quale ordine.
- [Feed e registri di audit degli SLO](/docs/slo/feed-and-audit-logs): Ogni avviso e incidente generato da una regola.
:::
