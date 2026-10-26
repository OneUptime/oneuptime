# Trigger dei runbook

Un runbook può avviarsi da solo: secondo una pianificazione, o quando un altro strumento chiama il suo URL del webhook. Usa una pianificazione per il lavoro di routine, come una pulizia notturna o un controllo settimanale dei certificati, e il webhook per avviare un runbook da un sistema di avvisi, una pipeline CI o uno script. Entrambi si configurano nella pagina **Trigger** del runbook.

:::cards
- [Eseguire secondo una pianificazione](#eseguire-secondo-una-pianificazione): Ogni pochi minuti, ogni giorno, in alcuni giorni della settimana o con un'espressione cron.
- [Chiamare il webhook](#chiamare-il-webhook): Avviare un'esecuzione con una richiesta POST all'URL del runbook.
- [Valori inviati da una chiamata al webhook](#valori-inviati-da-una-chiamata-al-webhook): Come i passaggi leggono il JSON inviato da chi chiama.
- [Risoluzione dei problemi](#risoluzione-dei-problemi): Una pianificazione che non parte, una chiamata rifiutata.
:::

## Come un trigger avvia un'esecuzione

```mermaid title="Da una pianificazione o una chiamata al webhook a un'esecuzione"
flowchart TB
    subgraph starts["Cosa avvia l'esecuzione"]
        direction LR
        schedule["La pianificazione:<br/>arriva un orario"]
        webhook["Il webhook: un<br/>POST al suo URL"]
    end
    schedule --> checks["Il runbook è attivo<br/>e ha dei passaggi"]
    webhook --> checks
    checks --> execution["Esecuzione, contrassegnata<br/>Schedule o Webhook"]
    execution --> worker["Il Worker di OneUptime<br/>esegue i passaggi"]
```

Un trigger avvia un'esecuzione come fa **Esegui ora**: l'esecuzione riguarda i passaggi attuali del runbook e non è collegata ad alcun incidente, avviso o evento di manutenzione pianificata. Ogni esecuzione registra cosa l'ha avviata. Le **Esecuzioni** del runbook e **Runbook → Esecuzioni** lo mostrano sotto **Attivato da**, con l'orario previsto di un'esecuzione pianificata o l'indirizzo che ha chiamato il webhook, ed entrambi gli elenchi si possono filtrare in base a questo.

## Prima di iniziare

- Un runbook con almeno un passaggio e con l'interruttore **Esegui questo runbook** attivo, nella sua pagina **Impostazioni**.
- Il permesso di modificare il runbook e di eseguirlo. Vedi [Chi può configurare i trigger](#chi-può-configurare-i-trigger).

## Eseguire secondo una pianificazione

:::steps
### Aprire la pagina Trigger del runbook
Apri il runbook da **Runbook** e fai clic su **Impostazioni → Trigger** nel suo menu laterale. **Impostazioni** è inizialmente compresso: fai clic su di esso per mostrare **Trigger**.

### Configurare la pianificazione
Fai clic su **Imposta pianificazione**. In **Quando viene eseguito**, scegli un'opzione di **Ripeti** e ciò che richiede. La finestra di dialogo descrive la pianificazione in una frase, come «Viene eseguito ogni giorno feriale alle 09:00», ed elenca le prossime esecuzioni mentre la modifichi.

### Controllare il fuso orario
**Fuso orario** parte dal tuo. Gli orari della pianificazione si leggono sull'orologio di questo fuso.

### Salvarla
Fai clic su **Salva pianificazione**. La pianificazione viene attivata e la scheda la mostra in una frase con le sue **Prossime esecuzioni**.
:::

| **Ripeti** | Cosa scegli | Esempio |
| --- | --- | --- |
| **Ogni pochi minuti** | **Ogni**: 1, 2, 3, 4, 5, 6, 10, 12, 15, 20 o 30 minuti | Ogni 15 minuti |
| **Ogni poche ore** | **Ogni**: 1, 2, 3, 4, 6, 8 o 12 ore, e **Minuti dopo l'ora** | Ogni 2 ore al minuto :30 |
| **Ogni giorno** | **Ora del giorno** | Ogni giorno alle 09:00 |
| **In giorni scelti** | **In questi giorni**, con **Giorni feriali** e **Ogni giorno** come scorciatoie, e **Ora del giorno** | Ogni giorno feriale alle 09:00 |
| **Personalizzata (espressione cron)** | **Espressione cron** | `0 2 1 * *`: alle 02:00 del giorno 1 di ogni mese |

Un'espressione cron ha cinque campi: minuto, ora, giorno del mese, mese e giorno della settimana. I runbook vengono eseguiti al massimo una volta al minuto, quindi non c'è un campo dei secondi. La finestra di dialogo spiega un'espressione che non sa leggere, o una che non viene mai eseguita, come `0 0 31 2 *`, e non salva nulla finché non può essere eseguita.

La scheda mostra poi la pianificazione, le sue tre prossime esecuzioni sull'orologio del fuso, cosa fa quando un'esecuzione è ancora in corso o un orario è stato saltato, e l'**Ultima esecuzione pianificata** con **Visualizza esecuzione**. **Modifica pianificazione** apre la stessa finestra di dialogo, e l'interruttore **Esegui con questa pianificazione** mette in pausa la pianificazione senza perderla.

### Se un'esecuzione è ancora in corso

Un'esecuzione è ancora in corso finché è in coda, in esecuzione o in attesa che qualcuno completi o approvi un passaggio, comunque sia iniziata. L'impostazione **Se un'esecuzione è ancora in corso** della pianificazione, ripiegata sotto **Altri campi** nella finestra di dialogo, decide cosa fa un orario che arriva in quel momento:

| Impostazione | Cosa succede |
| --- | --- |
| **Salta quell'orario** (predefinita) | Non parte nulla. La pianificazione attende il prossimo orario. |
| **Eseguilo quando termina** | Un'esecuzione attende e parte quando termina quella in corso. Gli altri orari che arrivano nel frattempo non avviano nulla. |

### Se OneUptime ha saltato un orario

Se OneUptime era inattivo o in aggiornamento a un orario pianificato, l'orario è perso non appena ha più di 5 minuti di ritardo. **Se OneUptime ha saltato un orario** decide cosa succede quando OneUptime torna attivo:

| Impostazione | Cosa succede |
| --- | --- |
| **Esegui una volta quando OneUptime torna attivo** (predefinita) | Parte un'esecuzione, indipendentemente da quanti orari sono stati persi, contrassegnata «Eseguita una volta per recuperare gli orari saltati da OneUptime». |
| **Salta gli orari persi** | Non parte nulla fino al prossimo orario. |

Gli orari che passano mentre la pianificazione o il runbook è disattivato non sono persi: riattivare l'uno o l'altro riprende dal prossimo orario.

### Fusi orari e ora legale

Gli orari si leggono tutto l'anno sull'orologio del fuso. Una pianificazione per le 09:00 in Europe/London viene eseguita alle 09:00 ora di Londra d'inverno e d'estate. La notte in cui gli orologi vanno avanti, un orario che quella notte non esiste viene eseguito un'ora dopo sull'orologio. Quando gli orologi tornano indietro e un'ora arriva due volte, una pianificazione eseguita ogni ora viene eseguita in entrambe, e qualsiasi altra pianificazione una volta sola, nella prima.

## Chiamare il webhook

:::steps
### Attivare il webhook
Nella pagina **Trigger** del runbook, attiva **Esegui quando viene chiamato questo URL**. Il runbook riceve un proprio URL.

### Copiare l'URL
L'**URL del webhook** è mascherato: fai clic su **Mostra** per vederlo, o su **Copia URL** per copiarlo per intero. **Provalo** contiene un comando `curl` da cui partire.

### Chiamarlo dal tuo strumento
Invia una richiesta `POST` all'URL, con un oggetto JSON come corpo, o senza corpo:

```bash
curl -X POST "https://oneuptime.com/runbook/webhook/RUNBOOK_ID/SECRET_KEY" \
  -H "Content-Type: application/json" \
  -d '{"host": "web-1", "reason": "Disk almost full"}'
```

### Controllare l'esecuzione
La risposta indica l'esecuzione avviata: `{"runbookExecutionId": "...", "status": "Scheduled"}`. L'esecuzione si trova nelle **Esecuzioni** del runbook, dove **Attivato da** indica **Webhook**, e la sua pagina mostra ciò che la chiamata ha inviato sotto **Input**.
:::

**Invia richiesta di test** invia all'URL un `POST` con un corpo che scrivi tu, come farebbe un altro strumento, e collega l'esecuzione avviata. È un'esecuzione reale del runbook.

### Cosa risponde una chiamata

| Risposta | Quando |
| --- | --- |
| `200` | L'esecuzione è stata avviata. Il corpo la indica. |
| `400` | Il corpo non è un oggetto JSON, è annidato per più di 32 livelli o contiene un carattere NUL, oppure il runbook non ha passaggi. |
| `403` | Il webhook o il runbook è disattivato. |
| `404` | Nessun webhook di runbook risponde a questo URL: l'ID del runbook o la chiave è errato, oppure l'URL è stato reimpostato. |
| `405` | La richiesta è un `GET`. Un `GET` non avvia mai un'esecuzione, così l'anteprima di un link in un'app di chat non può eseguirlo per sbaglio. |
| `413` | Il corpo supera i 64 KB. |
| `429` | Il webhook ha avviato 30 esecuzioni nell'ultimo minuto, 10 delle sue esecuzioni sono ancora in corso, oppure un indirizzo ha fatto più di 120 chiamate ai webhook dei runbook in un minuto, oppure gli indirizzi di uno stesso /64 IPv6 più di 1200 insieme. L'intestazione `Retry-After` indica quando riprovare, quando possibile. |
| `503` | OneUptime non riesce a contare le chiamate in questo momento. Riprova tra un minuto. |

Una chiamata rifiutata non avvia nulla, e il suo corpo spiega il motivo in una frase, ad esempio "This runbook is turned off, so it was not started. Turn it on with Run this runbook, under the runbook's Settings."

### Mantenere privato l'URL

L'URL contiene la chiave segreta del runbook: chiunque lo abbia può avviare il runbook. La chiave è di 43 caratteri casuali, viene confrontata in tempo costante, e una chiave errata riceve la stessa risposta che si avrebbe se il runbook non esistesse.

Se l'URL viene diffuso, fai clic su **Reimposta URL**. Il runbook riceve un nuovo URL e quello vecchio smette subito di funzionare, quindi dai quello nuovo a ogni strumento che lo chiama. Disattivare e riattivare il webhook mantiene lo stesso URL.

## Valori inviati da una chiamata al webhook

I valori di primo livello del corpo diventano gli input dell'esecuzione. Raggiungono i passaggi come dati, mai come testo incollato in uno script o in un comando:

| Tipo di passaggio | Come legge gli input |
| --- | --- |
| Bash e kubectl | Variabili d'ambiente: una `ONEUPTIME_INPUT_<NAME>` per ogni valore di primo livello, `ONEUPTIME_INPUTS` con l'intero oggetto in JSON e `ONEUPTIME_TRIGGER` con ciò che ha avviato l'esecuzione, come `Webhook` o `Schedule`. |
| JavaScript | `args.inputs`, l'oggetto così come è stato inviato, e `args.trigger`. |
| AI | Nel suo prompt, contrassegnati come dati provenienti dall'esterno di OneUptime, quando **Includi il contesto del trigger** è attivo. |
| HTTP request e SSH | Per niente. Il loro URL, lo script e la destinazione sono quelli scritti nel runbook, e nulla di ciò che invia chi chiama li cambia. |

Il nome di una variabile è il nome del valore in maiuscolo, con ogni carattere diverso da una lettera o una cifra scritto come `_`: `host-name` diventa `ONEUPTIME_INPUT_HOST_NAME`. Il testo viene passato così com'è, i numeri e `true` o `false` come sono scritti, e oggetti ed elenchi in JSON. Un passaggio riceve al massimo 100 di queste variabili, e un nome più lungo di 100 caratteri non ne diventa nessuna; ogni valore resta comunque in `ONEUPTIME_INPUTS`. Ogni nome inizia con `ONEUPTIME_`, così chi chiama non può impostare `PATH` né alcun'altra variabile letta dal Runner.

È chi chiama a decidere questi valori, quindi controllali prima di agire:

```bash
set -euo pipefail
case "$ONEUPTIME_INPUT_HOST" in
  web-1|web-2|web-3) ;;
  *) echo "Unknown host: $ONEUPTIME_INPUT_HOST"; exit 1 ;;
esac
curl -fsS -X POST "http://$ONEUPTIME_INPUT_HOST.internal:8080/restart"
```

```javascript
const host = args.inputs.host;
if (!["web-1", "web-2", "web-3"].includes(host)) {
  throw new Error(`Unknown host: ${host}`);
}
console.log(`Started by ${args.trigger} for ${host}`);
return { host };
```

## Chi può configurare i trigger

Una pianificazione o un webhook avvia esecuzioni senza nessuno presente, quindi configurarne uno richiede il permesso di modificare il runbook e di eseguirlo: Project Owner, Project Admin o Runbook Admin, oppure **Edit Runbook** insieme a Project Member, Runbook Member o **Create Runbook Execution**. Contano le etichette a cui un ruolo è limitato, come per **Esegui ora**. Vedere o reimpostare l'URL del webhook richiede lo stesso.

Disattivare una pianificazione o un webhook non avvia nulla, quindi richiede solo il permesso di modificare il runbook. Chi può modificare il runbook ma non eseguirlo vede la pagina **Trigger** con **Imposta pianificazione** bloccato, e viene informato di chi può vedere l'URL del webhook.

## Risoluzione dei problemi

:::details Non viene eseguito nulla secondo la pianificazione
Il runbook è disattivato o non ha passaggi: la scheda dice quale dei due. Attiva **Esegui questo runbook** nella pagina **Impostazioni** del runbook, o aggiungi passaggi nella sua pagina **Passaggi**. Se la scheda dice che la pianificazione è in pausa, attiva **Esegui con questa pianificazione**.
:::

:::details Un orario pianificato non ha avviato nulla
Un'esecuzione era ancora in corso e la pianificazione salta questi orari, oppure OneUptime ha perso l'orario e la pianificazione salta gli orari persi. Vedi [Se un'esecuzione è ancora in corso](#se-unesecuzione-è-ancora-in-corso) e [Se OneUptime ha saltato un orario](#se-oneuptime-ha-saltato-un-orario).
:::

:::details Il salvataggio di una pianificazione non riesce con "You do not have permission to set up this runbook's schedule or webhook."
Configurare un trigger richiede il permesso di eseguire il runbook oltre a quello di modificarlo. Chiedi Runbook Admin, oppure Runbook Member o **Create Runbook Execution** oltre a **Edit Runbook**.
:::

:::details Una chiamata riceve la risposta "No runbook webhook answers at this URL."
L'URL è stato reimpostato o copiato male. Copialo di nuovo dalla pagina **Trigger** del runbook.
:::

:::details Una chiamata riceve la risposta "This runbook's webhook is turned off, so the runbook was not started."
Attiva **Esegui quando viene chiamato questo URL** nella pagina **Trigger** del runbook. L'URL è lo stesso di prima.
:::

## Passaggi successivi

:::cards
- [Eseguire un runbook](/docs/runbooks/running): Cosa mostra un'esecuzione e come farla avanzare.
- [Scrivere un runbook](/docs/runbooks/authoring): Scrivere i passaggi che un trigger esegue.
- [Configurazione e sicurezza dei runbook](/docs/runbooks/configuration): Limiti, permessi e protezione.
:::
