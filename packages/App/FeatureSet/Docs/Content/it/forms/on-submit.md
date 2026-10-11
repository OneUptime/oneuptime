# Cosa crea un invio

Ogni invio tramite un modulo crea un record nel tuo progetto: un **incidente** o un **evento di manutenzione programmata**. La pagina **All'invio** di un modulo mostra quale, e come viene compilato ogni campo del nuovo record — da una risposta, da un valore predefinito, da un'impostazione che si applica sempre, o dal modello di incidente. **Modifica impostazioni** cambia i valori predefiniti e ciò che si applica sempre.

:::cards
- [Come un invio diventa un incidente](#come-un-invio-diventa-un-incidente): Ogni campo del nuovo incidente, e da dove viene il suo valore.
- [Come un invio diventa un evento di manutenzione programmata](#come-un-invio-diventa-un-evento-di-manutenzione-programmata): Lo stesso, per una richiesta di manutenzione.
- [Le impostazioni All'invio](#le-impostazioni-allinvio): Valori predefiniti, ciò che viene sempre allegato, proprietari e pubblicazione.
- [La nota privata](#la-nota-privata): Chi l'ha inviato, e le risposte che nessun campo contiene.
:::

## Cosa succede all'invio

```mermaid title="Da un invio a un incidente o a un evento di manutenzione"
flowchart TB
    submit["Invia"] --> checks["Protezioni e<br/>controllo delle risposte"]
    checks --> fields["Ogni campo: la risposta,<br/>altrimenti le impostazioni All'invio,<br/>altrimenti il modello di incidente"]
    fields --> record["L'incidente o<br/>l'evento di manutenzione"]
    record --> note["Una nota privata: chi l'ha inviato,<br/>e le altre risposte"]
    record --> runs["Vengono eseguite regole, policy<br/>di reperibilità e flussi di lavoro"]
```

Un invio che non supera un controllo non crea nulla. Vedi [Cosa protegge un modulo](/docs/forms/sharing-and-security#cosa-protegge-un-modulo).

## Cosa crea ogni invio

La scheda **Cosa crea ogni invio** contiene la scelta che hai fatto quando hai creato il modulo:

- **Incidente** — ogni invio dichiara un incidente, così il tuo team di reperibilità viene avvisato subito. Usalo per le segnalazioni di problemi.
- **Manutenzione programmata** — ogni invio programma un evento di manutenzione. Usalo per le richieste di modifica e di manutenzione.

Scegliere l'altra opzione ti chiede una conferma, perché il modulo cambia con essa:

- Il titolo, la descrizione, i monitor e le etichette restano collegati: entrambi i tipi di record li hanno.
- Ogni altra domanda collegata — una gravità, una scelta di pagina di stato, un campo personalizzato del tipo precedente — diventa una domanda propria del modulo, con lo stesso testo, la cui risposta viene elencata nella nota privata.
- Le impostazioni All'invio ripartono da zero, perché le impostazioni di un incidente e quelle di un evento sono diverse.
- Un modulo che ora crea eventi di manutenzione chiede quando la manutenzione inizia e finisce.

Le domande vengono salvate subito, insieme alla modifica. Controllale nella pagina **Costruisci**.

## Come un invio diventa un incidente

La scheda elenca ogni campo del nuovo incidente e da dove viene il suo valore:

| Campo | Viene da |
| --- | --- |
| **Titolo** | La risposta alla domanda **Titolo**. Quando il modulo non la chiede, o resta vuota: il **Titolo predefinito**, altrimenti il nome del modulo. |
| **Descrizione** | La risposta alla domanda **Descrizione**. Quando non viene chiesta o resta vuota, la descrizione del modello di incidente, se il modulo ha un modello. |
| **Gravità** | La scelta del mittente, quando il modulo la chiede. Altrimenti l'impostazione **Gravità** del modulo, altrimenti la gravità del modello di incidente. |
| **Monitor** | I monitor scelti dal mittente, insieme a quelli che le impostazioni allegano sempre. Senza né gli uni né gli altri, quelli del modello di incidente. |
| **Etichette** | Le etichette scelte dal mittente, insieme a quelle che le impostazioni aggiungono sempre. Senza né le une né le altre, quelle del modello di incidente. |
| **Inizio dell'impatto** | La risposta a **Inizio dell'impatto**, quando il modulo la chiede. |
| **Incidente Modello** | L'impostazione **Incidente Modello** del modulo. Compila tutto ciò che le risposte e le impostazioni lasciano non impostato. |
| **Policy di reperibilità** | Le policy indicate dalle impostazioni, eseguite per ogni incidente che il modulo dichiara. Senza alcuna, quelle del modello di incidente. |
| **Proprietari** | Le persone e i team indicati dalle impostazioni, insieme ai proprietari del modello. Vengono avvisati di ogni incidente. |
| **Campi personalizzati** | La risposta di ogni domanda di campo personalizzato — a meno che il campo copi il suo valore da un campo personalizzato del monitor e i monitor dell'incidente ne abbiano uno; il modello compila il resto. |
| **Pagine di stato** | Mai mostrato sulle pagine di stato, e gli iscritti non vengono avvisati, finché qualcuno del tuo team non lo pubblica. |
| **Altre risposte** | Elencate in una nota privata sull'incidente, con chi l'ha inviato. |

> [!IMPORTANT]
> **Senza gravità, niente incidente.** Un incidente ha bisogno di una gravità. Quando il modulo non ne chiede una e le sue impostazioni non ne indicano nessuna — o quella indicata è stata eliminata — e nemmeno il suo modello ne imposta una, la riga **Gravità** ti avvisa, e ogni invio viene rifiutato con "Questo modulo non può creare un incidente perché non ha una gravità. Avvisa il team che lo ha condiviso." Scegli una gravità in **Modifica impostazioni**, o un modello che ne imposti una.

### Il modello di incidente

Scegli un **Incidente Modello** nelle impostazioni e ogni incidente che il modulo dichiara viene dichiarato a partire da esso, nel modo in cui il server applica un modello ovunque — vedi [Come viene applicato un modello](/docs/incidents/settings#come-viene-applicato-un-modello). Le risposte e le impostazioni del modulo vengono prima, e il modello compila tutto il resto: lo stato iniziale, la descrizione, la gravità, le risorse interessate, le policy di reperibilità, i proprietari, le etichette, i valori dei campi personalizzati e un cambio di stato del monitor.

> [!WARNING]
> **Attenzione ai monitor.** Dichiarare un incidente su un monitor tramite un modulo influisce sul monitor esattamente come dichiararlo a mano: il monitoraggio attivo del monitor si mette in pausa finché l'incidente non viene risolto, e il **Cambia lo stato del monitor in** di un modello cambia subito lo stato del monitor — su ogni pagina di stato che elenca il monitor, anche mentre l'incidente stesso è nascosto. Con un modulo, chiunque abbia il link può farlo. Allega monitor tramite un modulo solo quando ogni invio deve metterli in pausa.

### Com'è l'incidente

Un incidente dichiarato tramite un modulo è un incidente normale, con alcune impostazioni proprie:

- **Nascosto dalle pagine di stato.** **Visibile sulla pagina di stato** è disattivato, e così **Notifica gli iscritti alla pagina di stato**. Finché un responder non lo pubblica, nulla dell'incidente raggiunge una pagina di stato o un iscritto — a parte il cambio di stato del monitor di un modello, descritto sopra.
- **Dichiarato da nessuno.** Il mittente non è un utente di OneUptime, quindi nessun utente risulta come chi ha dichiarato l'incidente.
- **I suoi proprietari vengono avvisati.** I proprietari indicati dalle impostazioni e dal modello vengono aggiunti non appena esistono i canali Slack e Microsoft Teams dell'incidente, e ricevono la notifica — la notifica **Incidente creato** dell'incidente aspetta che siano i suoi proprietari, così arriva a loro invece che ai proprietari del progetto.
- **Una nota privata registra l'invio** — vedi [La nota privata](#la-nota-privata).

Tutto ciò che viene eseguito per un nuovo incidente viene eseguito anche per questi: le regole di privacy, di proprietari, di etichette, di reperibilità e di runbook, le policy di reperibilità e i flussi di lavoro **On Create Incident**. Le regole di reperibilità corrispondono agli incidenti di un modulo come a qualsiasi altro — anche sul loro titolo e sulla loro descrizione, scritti dal mittente.

:::steps
#### Leggi cosa ha scritto il mittente

Il titolo e la descrizione compaiono sulle pagine di stato una volta pubblicato l'incidente.

#### Pubblica l'incidente

Attiva **Visibile sulla pagina di stato** dalla pagina **Impostazioni** dell'incidente.

#### Avvisa gli iscritti, se devono saperlo

Poiché l'incidente è stato dichiarato con **Notifica gli iscritti alla pagina di stato** disattivato, pubblicarlo non invia la notifica «incidente creato». Per avvisare gli iscritti, pubblica una nota pubblica con **Notifica gli iscritti alla pagina di stato** spuntato — vedi [Pubblicare una nota pubblica](/docs/incidents/notes-owners-and-feed#pubblicare-una-nota-pubblica).
:::

## Come un invio diventa un evento di manutenzione programmata

| Campo | Viene da |
| --- | --- |
| **Titolo** | La risposta alla domanda **Titolo**. Quando il modulo non la chiede, o resta vuota: il **Titolo predefinito**, altrimenti il nome del modulo. |
| **Descrizione** | La risposta alla domanda **Descrizione**. |
| **Inizia il**, **Termina il** | Le risposte a **Inizia il** e **Termina il**, che ogni modulo di manutenzione chiede e rende obbligatorie. La fine deve essere successiva all'inizio. |
| **Monitor** | I monitor scelti dal mittente, insieme a quelli che le impostazioni allegano sempre. |
| **Pagine di stato** | Le pagine di stato scelte dal mittente, insieme a quelle indicate dalle impostazioni. |
| **Etichette** | Le etichette scelte dal mittente, insieme a quelle che le impostazioni aggiungono sempre. |
| **Proprietari** | Le persone e i team indicati dalle impostazioni. Sono proprietari di ogni evento che il modulo programma. |
| **Mostra nelle pagine di stato** | **No** a meno che le impostazioni non lo attivino. |
| **Notifica agli iscritti** | **No** a meno che le impostazioni non lo attivino. |
| **Campi personalizzati** | La risposta di ogni domanda di campo personalizzato — a meno che il campo copi il suo valore da un campo personalizzato del monitor e i monitor dell'evento ne abbiano uno. |
| **Altre risposte** | Elencate in una nota privata sull'evento, con chi l'ha inviato. |

L'evento parte nello stato **Scheduled** del tuo progetto e avanza come qualsiasi altro: diventa in corso quando inizia e termina quando finisce.

Un invio è la richiesta di qualcuno, e una richiesta viene esaminata prima di essere pubblicata. Quindi, a meno che tu non lo cambi, l'evento resta fuori dalle sue pagine di stato finché qualcuno del tuo team non lo mostra, e i suoi iscritti non vengono avvisati quando viene creato, inizia o finisce. **Mostra nelle pagine di stato** e **Notifica agli iscritti**, nel passaggio **Pubblicazione** delle impostazioni, cambiano questo per ogni evento che il modulo programma — attivali solo quando ti fidi di tutti quelli che hanno il link.

## Le impostazioni All'invio

**Modifica impostazioni** apre le impostazioni a passaggi: **Avanti** va avanti, e **Salva modifiche** è nell'ultimo passaggio. Ogni passaggio è già compilato, quindi l'elenco dei passaggi accanto al modulo apre uno qualsiasi di essi, compreso l'ultimo: cambia un'impostazione nel suo passaggio, poi apri l'ultimo passaggio e salva.

| Passaggio | Modulo di incidente | Modulo di manutenzione |
| --- | --- | --- |
| **Valori predefiniti** | **Titolo predefinito**, **Gravità**, **Incidente Modello** | **Titolo predefinito** |
| **Associa sempre** | **Monitor**, **Etichette**, **Policy di reperibilità** | **Monitor**, **Pagine di stato**, **Etichette** |
| **Proprietari** | **Proprietari** | **Proprietari** |
| **Pubblicazione** | — | **Mostra nelle pagine di stato**, **Notifica agli iscritti** |

**Proprietari** è un unico selettore per persone e team: **Aggiungi proprietario** apre un unico elenco di ricerca di entrambi, e ogni scelta appare come un chip che puoi rimuovere. Tutto ciò che le impostazioni indicano deve appartenere al progetto del modulo, e i proprietari devono esserne membri. Un record eliminato dopo essere stato scelto viene saltato quando viene creato un invio, e il resto si applica comunque.

## La nota privata

Ogni invio lascia una nota privata su ciò che ha creato:

> Submitted through the form **Report a Problem** by Ada Lovelace (<ada@example.com>).
>
> **Which office are you in?**\
> Berlin

Indica il modulo e il mittente — "Submitted anonymously through the form **Report a Problem**." quando il modulo non ha chiesto chi è —, poi, quando l'invio è partito da uno dei modelli del modulo, dice quale: "Started from the template **Application Outage**." — e poi elenca le risposte alle domande proprie del modulo, ognuna sotto la sua domanda, nell'ordine del modulo. Le risposte alle domande collegate sono già sul record: il suo titolo, la sua gravità, i suoi campi personalizzati. Essendo privata, la nota non raggiunge mai una pagina di stato, ma viene pubblicata nei canali Slack e Microsoft Teams del record come qualsiasi altra nota.

L'indirizzo è un link che scrive esattamente a quell'indirizzo — nella dashboard, in Slack e nell'email ai proprietari.

## Domande nascoste e modelli

Una [domanda nascosta](/docs/forms/building#domande-nascoste) riceve la risposta dal [modello](/docs/forms/building#modelli) da cui è partito l'invio — mai dalla richiesta —, e la sua risposta va esattamente dove andrebbe una digitata: una **Descrizione** nascosta diventa la descrizione dell'incidente, un campo personalizzato nascosto il suo valore, una domanda propria del modulo nascosta una riga della nota privata. Un invio partito senza alcun modello lascia senza risposta le domande nascoste, e i loro campi vengono compilati dalle impostazioni All'invio, come per qualsiasi domanda lasciata vuota. Un modello eliminato mentre qualcuno aveva il modulo aperto non blocca il suo invio: viene creato come ha risposto, senza le risposte nascoste del modello.

Un modello può fare le domande del modulo [a modo suo](/docs/forms/building#come-un-modello-chiede-ogni-domanda), e il server applica all'invio le domande così come le fa il modello che indica. Una domanda che il modello nasconde riceve la risposta dal modello, come una domanda nascosta, anche quando il modulo la chiede; una che il modello chiede viene letta dalla richiesta, anche quando il modulo la nasconde; e a una che il modello rende obbligatoria si deve rispondere, altrimenti l'invio viene rifiutato e non viene creato nulla.

Le risposte che un modello ha compilato nella pagina diventano del mittente non appena invia: il server prende le risposte che la richiesta invia per le domande che fa la pagina, qualunque cosa dicesse il modello.

## Il testo che scrive un mittente

Un invio va dritto in luoghi dove il testo può agire da solo — canali Slack e Microsoft Teams, il browser di ogni responder, le email dei proprietari — e nessuno lo legge prima. Quindi, prima che il record venga creato:

| Cosa scrive il mittente | Cosa viene salvato |
| --- | --- |
| Una menzione, come \<!channel\>, \<!here\> o \<@U0123ABC\>, nel titolo, nella descrizione o in qualsiasi risposta di testo | **Le menzioni non avvisano nessuno.** Tutto ciò che Slack legge come una menzione riceve un carattere invisibile dopo la sua parentesi di apertura. Si legge allo stesso modo ovunque, ma nessuno strumento di chat lo interpreta. |
| Un'immagine, nella descrizione o in una risposta **Testo formattato** | **Le immagini diventano link.** Ogni immagine diventa un link allo stesso indirizzo, quindi non viene caricato nulla da dove ha scelto il mittente finché un responder non ci fa clic. |
| Un blocco di codice il cui linguaggio è `mermaid`, comunque sia scritto | **I diagrammi diventano codice.** Viene salvato come semplice codice, quindi mostra il suo testo invece di disegnare un diagramma. |
| Sintassi di immagine o un blocco di diagramma nel titolo | **Il titolo è testo semplice.** Ricevono anch'essi il carattere invisibile, quindi ovunque finisca il titolo — un episodio, un messaggio di chat, un modello di nota — non carica nulla e non disegna nulla. I caratteri invisibili contano per il limite del titolo. |

Tutto il resto — i link, il resto del Markdown, le scelte dei menu a discesa, i numeri, le date, una casella spuntata — viene salvato come l'ha fornito il mittente, e l'invio conserva il nome e l'email del mittente come sono stati digitati.

## Passaggi successivi

:::cards
- [Creare un modulo](/docs/forms/building): Le domande che alimentano questi campi, le domande nascoste e i modelli.
- [Impostazioni e automazione degli incidenti](/docs/incidents/settings): Modelli degli incidenti e campi personalizzati.
- [Note, proprietari e feed degli incidenti](/docs/incidents/notes-owners-and-feed): Note private, note pubbliche e proprietari.
- [Condivisione e sicurezza](/docs/forms/sharing-and-security): Chi può inviare, e con quale frequenza.
:::
