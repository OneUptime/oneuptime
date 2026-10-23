# Post-mortem

Un post-mortem è il resoconto dopo un incidente: cosa è successo, perché, quanto è costato ai vostri utenti e cosa cambia ora. In OneUptime lo scrivete sull'incidente stesso. Può partire da un vostro modello o da una bozza di OneUptime AI, e può essere pubblicato sulla vostra pagina di stato come aggiornamento finale dell'incidente. Ogni post-mortem ha anche uno stato, e **Incidenti → Post-mortem** elenca il post-mortem di ogni incidente, così vedete quali sono ancora da fare.

:::cards
- [Scrivere un post-mortem](#scrivere-un-post-mortem): Nella pagina Post-mortem dell'incidente, in cinque passaggi.
- [Partire da un modello o da una bozza dell'IA](#partire-da-un-modello-o-da-una-bozza-dellia): La vostra traccia, o una che OneUptime AI compila.
- [Pubblicarlo sulla vostra pagina di stato](#pubblicarlo-sulla-vostra-pagina-di-stato): Mostrarlo ai clienti e avvisare gli iscritti una sola volta.
- [Seguire a che punto è ogni post-mortem](#seguire-a-che-punto-è-ogni-post-mortem): Non iniziato, Bozza, Completato o uno stato vostro.
- [Vedere tutti i post-mortem](#vedere-tutti-i-post-mortem): Filtrare per proprietario, gravità e stato per trovare quelli ancora da fare.
- [Post-mortem degli episodi](#post-mortem-degli-episodi): Un unico resoconto per un gruppo di incidenti.
:::

## Come nasce un post-mortem

Un post-mortem ha tre parti, tutte sull'incidente: la nota, scritta in Markdown; i suoi allegati, come screenshot e report; e se compare sulla vostra pagina di stato. Si trovano nella pagina **Post-mortem** dell'incidente, sotto **Indagine** nel suo menu laterale. Un post-mortem ha anche uno stato, che dice a che punto è, e dei proprietari: quelli dell'incidente.

```mermaid title="Da un incidente risolto a un post-mortem pubblicato"
flowchart TB
    R["L'incidente è risolto"] --> A["OneUptime AI lo scrive,<br/>se le bozze sono attive"]
    R --> W["Oppure lo iniziate voi:<br/>vuoto, modello o IA"]
    A --> E["Il team lo modifica"]
    W --> E
    E --> P{"Pubblicarlo sulla<br/>pagina di stato?"}
    P -->|"Sì"| S["La pagina di stato<br/>lo mostra"]
    S --> N["Gli iscritti vengono<br/>avvisati una volta"]
    P -->|"No"| K["Resta nel vostro team"]
```

## Scrivere un post-mortem

:::steps
### Aprire il post-mortem

Aprite l'incidente, poi fate clic su **Post-mortem** sotto **Indagine** nel suo menu laterale. La scheda **Post-mortem** mostra lo **Stato** e i **Proprietari** del post-mortem, la nota, gli allegati e se il post-mortem è sulla pagina di stato.

### Fare clic su Scrivi il post-mortem

Il dialogo **Scrivi il post-mortem** si apre sul suo primo passaggio, **Post-mortem**. Una volta scritto il post-mortem, il pulsante della scheda è **Modifica nota post mortem**, che apre gli stessi passaggi.

### Scrivere la nota e allegare i file

Scrivete la **Nota del postmortem** in Markdown: cosa è successo, l'impatto, come è stato risolto e le azioni successive. Aggiungete screenshot, report o cronologie in **Allegati del postmortem**.

### Scegliere se pubblicarlo

Fate clic su **Avanti**. Nel passaggio **Pagina di stato**, **Pubblica nella pagina di stato** è disattivato, quindi il post-mortem resta nel vostro team. Per mostrarlo ai clienti, vedere [Pubblicarlo sulla vostra pagina di stato](#pubblicarlo-sulla-vostra-pagina-di-stato).

### Salvare il post-mortem

Fate clic su **Salva modifiche**. La scheda mostra la nota e gli allegati. Lo stato del post-mortem passa da **Non iniziato** a **Bozza**: vedere [Come avanza un post-mortem](#come-avanza-un-post-mortem).
:::

Ogni modifica della nota viene registrata nel feed dell'incidente, e pubblicata nel canale Slack o Microsoft Teams dell'incidente se ne ha uno. Finché il post-mortem non è pubblicato, nessun iscritto della pagina di stato ne viene a conoscenza.

Scrivere un post-mortem richiede il ruolo Project Owner, Project Admin, Project Member, Incident Admin o Incident Member, oppure un ruolo personalizzato con il permesso Edit Incident. Chi può leggere l'incidente può leggerne il post-mortem.

## Partire da un modello o da una bozza dell'IA

Due pulsanti compilano la nota al posto vostro. Finché non c'è nulla di scritto, sono accanto a **Scrivi il post-mortem**: **Inizia da un modello**, non appena il progetto ha un modello di post-mortem, e **Generate with AI**. Una volta scritto il post-mortem, sono nel menu **⋯** accanto a **Modifica nota post mortem**, come **Applica modello** e **Generate with AI**. Entrambi aprono lo stesso editor, con la nota compilata e il resto del post-mortem com'era. Nulla viene salvato finché non fate clic su **Salva modifiche**, quindi rileggete la nota e correggetela prima.

### Applicare un modello

**Applica modello** compare non appena il progetto ha un modello di post-mortem. I modelli si creano in **Incidenti → Impostazioni → Modelli post-mortem**: vedere [Modelli di post-mortem](/docs/incidents/settings#modelli-post-mortem). Su OneUptime Cloud, i modelli richiedono il piano Growth.

Fate clic su **Inizia da un modello**, oppure su **Applica modello** nel menu **⋯**, sceglietene uno in **Seleziona modello** nel dialogo **Applica modello di analisi post-incidente** e fate clic su **Applica modello**. Se il progetto ha un solo modello, è già selezionato.

### Generarlo con l'IA

Fate clic su **Generate with AI**. Il dialogo **Generate Postmortem with AI** propone una traccia in **Seleziona modello**: **Standard Postmortem**, **Detailed Technical Postmortem** o **Brief Postmortem**, poi i vostri modelli di post-mortem. **Template Preview** mostra la traccia, e potete modificarla prima di generare.

Fate clic su **Generate with AI** in fondo al dialogo. OneUptime AI legge l'incidente (la sua descrizione, la causa principale e la correzione, la cronologia degli stati, le note pubbliche e private, i messaggi del suo canale Slack o Microsoft Teams, e ciò che si è detto nelle [sue chiamate](/docs/workspace-connections/video-calls#trascrizioni-delle-chiamate)) e scrive il post-mortem secondo la vostra traccia. Poi l'editor si apre con il risultato.

La generazione richiede che l'IA sia attiva per il progetto, in **Impostazioni del progetto → IA → AI Features**, e un provider LLM: vedere [Provider LLM](/docs/ai/llm-provider). Richiede anche il ruolo Project Owner o Project Admin, oppure un ruolo personalizzato con il permesso Edit Incident: gli altri ruoli possono scrivere il post-mortem, ma non generarlo.

### Lasciare che OneUptime AI lo scriva quando un incidente viene risolto

Con **Scrivi una bozza di post-mortem quando un incidente viene risolto** attivo, OneUptime AI scrive una bozza del post-mortem ogni volta che un incidente viene risolto, la salva come nota e la pubblica nel feed dell'incidente perché il vostro team la rivegga. L'interruttore si trova in **Incidenti → IA → Impostazioni**, ed è attivo per i nuovi progetti.

- Non sostituisce mai una nota già scritta.
- Non scrive mai in un post-mortem già pubblicato, dove la bozza arriverebbe sulla pagina di stato senza revisione.
- Richiede che l'IA sia attiva per il progetto, e si ferma per la giornata non appena il progetto raggiunge i suoi limiti giornalieri di IA. Vedere [Post-mortem automatico](/docs/ai/ai-sre#post-mortem-automatico).
- Se la trascrizione della chiamata dell'incidente è ancora in arrivo quando l'incidente viene risolto, attende che OneUptime AI la legga, così che la bozza tenga conto di ciò che si è detto nella chiamata: fino a sei ore mentre il provider prepara la trascrizione. Vedere [Registrare e trascrivere ogni chiamata](/docs/workspace-connections/video-calls#registrare-e-trascrivere-ogni-chiamata).

#### Scegliere quali incidenti ricevono una bozza, e il suo modello

Senza regole, ogni incidente risolto riceve una bozza, secondo lo schema standard di OneUptime AI. Le **Regole post-mortem**, in **Altre impostazioni** nella stessa pagina, cambiano questo comportamento:

- Una regola corrisponde a **Tutti gli incidenti**, oppure a **Solo gli incidenti che soddisfano le condizioni** su monitor, gravità, label, label dei monitor, titolo e descrizione, come fa una regola IA.
- I suoi **Modelli** sono i modelli di post-mortem che la bozza può seguire. Senza alcun modello, la bozza segue lo schema standard; con uno, quel modello; con più di uno, quello che secondo OneUptime AI si adatta meglio all'incidente. Il post della bozza nel feed nomina il modello che ha seguito.
- Il suo **Provider LLM**, in **Altri campi**, è il provider con cui OneUptime AI scrive la bozza e ne sceglie il modello. Se non se ne sceglie nessuno, è il provider predefinito del progetto, altrimenti quello globale. Il post della bozza nel feed nomina il provider scelto da una regola, o quello usato al suo posto e perché. Vedere [Quale provider LLM usa una regola](/docs/ai/ai-sre#quale-provider-llm-usa-una-regola).
- Decide la prima regola abilitata che corrisponde all'incidente, partendo dall'alto dell'elenco: trascinare una regola per cambiarne la posizione. Un incidente a cui non corrisponde nessuna regola non riceve una bozza, e nessun incidente la riceve finché le regole non si possono leggere.
- **Scrivi una bozza di post-mortem quando un incidente viene risolto** resta l'unico interruttore che disattiva le bozze. Le regole decidono solo le bozze che OneUptime AI scrive da sé: **Generate with AI** offre ogni schema, qualunque cosa dicano.
- Creare, modificare e riordinare le regole richiede il ruolo Project Owner o Project Admin. Su OneUptime Cloud, i modelli richiedono il piano Growth: al di sotto, le regole decidono comunque quali incidenti ricevono una bozza, e ogni bozza segue lo schema standard.

## Pubblicarlo sulla vostra pagina di stato

Un post-mortem pubblicato è l'aggiornamento finale dell'incidente per i vostri clienti: la pagina di stato mostra la nota, evidenziata nella cronologia dell'incidente, con i suoi allegati da scaricare.

:::steps
### Aprire il passaggio Pagina di stato

Fate clic su **Modifica nota post mortem**, poi su **Avanti** per arrivare al passaggio **Pagina di stato**.

### Attivare Pubblica nella pagina di stato

Attivate **Pubblica nella pagina di stato**. Compaiono altri due campi: **Notifica agli iscritti**, attivo, e **Postmortem pubblicato il**, impostato su adesso.

### Decidere chi avvisare, e quando compare

Disattivate **Notifica agli iscritti** per pubblicare senza avvisare gli iscritti. Modificate **Postmortem pubblicato il** per mostrare un'altra ora accanto al post-mortem.

### Pubblicarlo

Fate clic su **Salva modifiche**. La scheda ora mostra **Postmortem visibile nella pagina di stato?**, **Notifica agli iscritti**, **Stato notifica iscritto** e **Postmortem pubblicato il**.
:::

Cosa decide se i clienti lo vedono, e se ne vengono a sapere:

- **L'incidente deve essere sulla pagina di stato.** Una pagina di stato mostra un post-mortem solo su un incidente che mostra: **Visibile sulla pagina di stato** attivo, e l'incidente non privato.
- **La nota deve dire qualcosa.** Un post-mortem pubblicato con la nota vuota non viene mostrato, e nessuno viene avvisato.
- **Gli iscritti vengono avvisati una volta**, la prima volta che la pagina di stato mostra il post-mortem. Salvarlo di nuovo, o modificarlo mentre è pubblicato, aggiorna la pagina senza avvisare nessuno. Toglierlo e pubblicarlo di nuovo li avvisa di nuovo. Uno pubblicato mentre il suo incidente è nascosto viene inviato quando l'incidente diventa visibile.
- **Notifica agli iscritti viene letto quando parte la notifica.** Attivarlo dopo la pubblicazione del post-mortem non invia nulla.

**Stato notifica iscritto** mostra se la notifica è partita, e offre **Riprova** se non è riuscita. Vedere [Il post-mortem](/docs/status-pages/subscribers#il-post-mortem) per ogni caso, e [Riprova e Reinvia](/docs/status-pages/subscribers#riprovare-e-inviare-di-nuovo).

**Postmortem pubblicato il** è anche il momento in cui il post-mortem conta come pubblicato per la misura **Tempo fino al post-mortem**: vedere [Misure pronte all'uso](/docs/incidents/settings#misurazioni-pronte).

## Seguire a che punto è ogni post-mortem

Il post-mortem di ogni incidente è in uno degli stati di post-mortem del progetto, mostrato sotto **Stato** in cima alla sua scheda **Post-mortem**. Un nuovo progetto ne ha quattro. Un post-mortem in **Non iniziato** o **Bozza** è ancora da fare; uno in **Completato** o **Non necessario** no:

| Stato | Cosa significa | Ancora da fare |
| --- | --- | --- |
| **Non iniziato** | Nessuno ha ancora scritto questo post-mortem. | Sì |
| **Bozza** | Il post-mortem è in fase di stesura. | Sì |
| **Completato** | Il post-mortem è scritto e concluso. | No |
| **Non necessario** | Questo incidente non ha bisogno di un post-mortem. | No |

### Come avanza un post-mortem

OneUptime sposta un post-mortem da solo in tre momenti:

- Il post-mortem di un nuovo incidente inizia in **Non iniziato**, oppure in **Bozza** quando l'incidente viene dichiarato con una nota, oppure in **Completato** quando quella nota viene pubblicata insieme.
- La prima nota di un post-mortem in **Non iniziato** lo sposta in **Bozza**, che qualcuno la scriva, applichi un modello o la stenda OneUptime AI.
- Pubblicarlo sulla pagina di stato lo sposta in **Completato**, a meno che non sia già fatto.

Non torna mai indietro: svuotare la nota, o togliere il post-mortem dalla pagina di stato, lascia il suo stato dov'è. Uno stato che qualcuno sceglie nello stesso salvataggio vale sempre.

### Spostarlo voi stessi

Fate clic sullo stato, nella pagina **Post-mortem** dell'incidente o nella sua riga dell'elenco dei post-mortem, e sceglietene uno sotto **Sposta il post-mortem in**. Il post-mortem si sposta subito. Spostare un post-mortem richiede i ruoli che lo scrivono, e chiunque possa leggere l'incidente vede a che punto è il suo post-mortem.

### Adattare gli stati al vostro processo

Se il vostro processo ha un passaggio suo, come una revisione, aggiungete uno stato apposta. Aprite **Incidenti → Impostazioni → Stati del post-mortem**, fate clic su **Crea: Stato del post-mortem** e dategli un nome, come **In revisione**, un colore e una descrizione. Un nuovo stato va subito sopra **Completato**; trascinate uno stato per cambiarne la posizione.

La posizione di uno stato decide come conta, mostrato sotto **Conta come**: sopra **Bozza**, **Non iniziato**; da **Bozza** in giù, **In corso**; da **Completato** in giù, **Fatto**, e non è più da fare. **In revisione**, in mezzo, è ancora da fare; **Non necessario**, sotto **Completato**, no.

**Non iniziato**, **Bozza** e **Completato** sono integrati, perché OneUptime vi sposta i post-mortem: potete rinominarli e cambiarne il colore, ma non eliminarli né archiviarli, e mantengono il loro ordine. Archiviate uno stato che non usate più dal menu **⋯** della sua riga: nessuno può più spostarvi un post-mortem, i post-mortem che contiene vi restano finché qualcuno non li sposta, e l'elenco filtra ancora in base a esso. **Stati post-mortem archiviati**, ripiegato sotto la tabella, li elenca, con **Annulla archiviazione** per riportarne indietro uno. Creare, modificare ed eliminare stati richiede il ruolo Project Owner, Project Admin o Incident Admin, oppure un ruolo personalizzato con il permesso corrispondente sugli stati di post-mortem.

## Vedere tutti i post-mortem

**Incidenti → Post-mortem** elenca il post-mortem di ogni incidente del progetto, dal più recente, con le colonne **Incidente**, **Titolo**, **Stato del post-mortem**, **Gravità**, **Proprietari** e **Dichiarato**. **Visualizza** su una riga apre la pagina **Post-mortem** dell'incidente.

Sopra l'elenco, un riquadro per stato conta i post-mortem che contiene. Fate clic su un riquadro per elencare solo quelli, e di nuovo per elencarli tutti.

Filtrate l'elenco con i chip sopra di esso: **Proprietario**, una persona o un team; **Gravità**; **Stato del post-mortem**; **Stato incidente**; **Etichette**; e **Risorse interessate**. Per vedere quali post-mortem un team deve ancora per i vostri incidenti più gravi, scegliete il team sotto **Proprietario**, la gravità sotto **Gravità**, e **Non iniziato** e **Bozza** sotto **Stato del post-mortem**. I filtri restano nell'indirizzo della pagina, così potete salvare l'elenco nei preferiti o condividerlo.

Per cambiarne molti in una volta, selezionateli e aprite **Azioni di massa**: **Cambia stato del post-mortem** li sposta tutti in uno stesso stato, come **Non necessario** per gli incidenti che non ne hanno bisogno, e **Add Owner** e **Remove Owner** cambiano chi ne è proprietario.

## Post-mortem degli episodi

Anche un episodio di incidenti ha una pagina **Post-mortem**, sotto **Indagine**: un unico resoconto per tutti gli incidenti dell'episodio. Fate clic su **Modifica post mortem** per scriverlo. **Applica modello** e **Generate with AI** funzionano come su un incidente, e l'IA legge l'episodio e i suoi incidenti membri.

Il post-mortem di un episodio è solo la nota: non ha allegati, e nessuna pagina di stato lo mostra. OneUptime AI non ne scrive uno da solo quando un episodio viene risolto. Generarlo richiede il ruolo Project Owner o Project Admin, oppure un ruolo personalizzato con il permesso Edit Incident Episode. Non ha nemmeno uno stato, e l'elenco dei post-mortem non lo include.

Gli avvisi e gli eventi di manutenzione programmata non hanno un post-mortem.

## Tramite l'API

Un post-mortem è un insieme di campi dell'incidente, letti e scritti tramite `/api/incident` come il resto dell'incidente:

| Campo | Cos'è |
| --- | --- |
| `postmortemNote` | La nota, in Markdown. |
| `showPostmortemOnStatusPage` | Se il post-mortem è pubblicato sulle vostre pagine di stato. Parte da `false`. |
| `notifySubscribersOnPostmortemPublished` | Se gli iscritti vengono avvisati quando viene pubblicato. Parte da `true`. |
| `postmortemPostedAt` | L'ora che la pagina di stato mostra accanto. |
| `postmortemStatusId` | Lo stato del post-mortem: uno degli stati del progetto, in `/api/incident-postmortem-status`. |

Scrivere `showPostmortemOnStatusPage` come `true` su una `postmortemNote` già scritta pubblica il post-mortem, come fa il dialogo. Sposta anche il post-mortem in **Completato**, a meno che la stessa scrittura non imposti `postmortemStatusId`.

## Risoluzione dei problemi

:::details Applica modello non compare nella scheda
Il progetto non ha ancora un modello di post-mortem, oppure il vostro ruolo non può leggerli. Createne uno in **Incidenti → Impostazioni → Modelli post-mortem**. Su OneUptime Cloud, i modelli richiedono il piano Growth.
:::

:::details Generate with AI dice che l'IA è disattivata, o che vi manca il permesso
Attivate l'IA in **Impostazioni del progetto → IA → AI Features**. La generazione richiede il ruolo Project Owner o Project Admin, oppure un ruolo personalizzato con il permesso Edit Incident, anche per chi può modificare il post-mortem.
:::

:::details Il post-mortem non è sulla pagina di stato
Controllate tre cose: **Pubblica nella pagina di stato** è attivo, la nota non è vuota, e l'incidente è mostrato sulla pagina di stato (**Visibile sulla pagina di stato** attivo, e non privato).
:::

:::details Gli iscritti non sono stati avvisati del post-mortem
**Notifica agli iscritti** era disattivato alla pubblicazione, oppure l'incidente è nascosto: in quel caso viene inviato appena l'incidente diventa visibile. **Stato notifica iscritto** nella scheda indica quale.
:::

:::details Non è comparsa alcuna bozza dell'IA quando l'incidente è stato risolto
L'incidente aveva già una nota, il post-mortem era già pubblicato, nessuna regola post-mortem gli corrispondeva, oppure **Scrivi una bozza di post-mortem quando un incidente viene risolto** è disattivato. L'IA deve essere attiva per il progetto, e il progetto non deve aver raggiunto i suoi limiti giornalieri di IA. Se la trascrizione della chiamata dell'incidente è in arrivo, la bozza arriva una volta che OneUptime AI l'ha letta.
:::

:::details Lo stato di un post-mortem non si è spostato quando è stata scritta la sua nota
Solo un post-mortem in **Non iniziato**, o in uno stato vostro sopra **Bozza**, avanza da solo, alla sua prima nota. Uno già in corso o fatto resta dov'è, come uno stato che qualcuno ha scelto nello stesso salvataggio. Spostatelo voi stessi dal suo stato: vedere [Spostarlo voi stessi](#spostarlo-voi-stessi).
:::

## Passaggi successivi

:::cards
- [Panoramica degli incidenti](/docs/incidents/index): Le altre pagine dell'incidente, dalla dichiarazione alla risoluzione.
- [Impostazioni e automazione degli incidenti](/docs/incidents/settings): I modelli di post-mortem e la misura del tempo fino al post-mortem.
- [Iscritti e annunci](/docs/status-pages/subscribers): Tutto ciò che una pagina di stato comunica ai suoi iscritti.
- [AI SRE](/docs/ai/ai-sre): Cosa fa OneUptime AI da solo dopo un incidente.
:::
