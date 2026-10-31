# Condivisione e dashboard pubbliche

Per impostazione predefinita, una dashboard è privata del tuo progetto: solo chi accede al tuo progetto può vederla. Puoi anche condividerla tramite un link pubblico, proteggere quel link con una password, limitarlo a determinati indirizzi IP e ospitarla sul tuo dominio. Questa pagina copre tutte e quattro le cose.

:::cards
- [Chi può vedere una dashboard](#chi-può-vedere-una-dashboard): Una scelta fra tre, con il piano che richiede ciascuna.
- [Condividere con una password](#condividere-con-una-password): Condividi il link, poi la password, con le persone che devono vederla.
- [Lista di IP consentiti](#lista-di-ip-consentiti): Apri il link pubblico solo al tuo ufficio o alla tua VPN.
- [Domini personalizzati](#domini-personalizzati): Servi la dashboard sul tuo dominio, con un certificato gratuito.
:::

## Il percorso di un visitatore

Un visitatore che apre il link pubblico di una dashboard incontra ciascuno di questi controlli in ordine. I membri del progetto che accedono a OneUptime vedono la dashboard all'interno del prodotto, qualunque cosa tu scelga qui.

```mermaid title="Che cosa vede un visitatore quando apre il link pubblico"
flowchart TB
    visit["Un visitatore apre<br/>il link pubblico"] --> shared("La dashboard è<br/>condivisa pubblicamente?")
    shared -->|"No"| missing["Una pagina<br/>non trovata"]
    shared -->|"Sì"| allowed("Il suo indirizzo è<br/>nella lista di IP<br/>consentiti?")
    allowed -->|"Sì, o<br/>nessuna lista"| locked("Serve una<br/>password?")
    allowed -->|"No"| denied["Una pagina<br/>Access Denied"]
    locked -->|"Sì"| prompt["La richiesta<br/>della password"]
    prompt --> board["La dashboard"]
    locked -->|"No"| board
```

## Chi può vedere una dashboard

Apri la dashboard e scegli **⋯ → Condividi**, oppure apri **Condivisione** nel menu laterale della dashboard. La scheda **Chi può vedere questa dashboard** è un'unica scelta:

- **Solo le persone di questo progetto** (l'impostazione predefinita): i membri vedono la dashboard quando accedono a OneUptime. Non ha un link pubblico: il suo indirizzo pubblico mostra la stessa pagina non trovata di un indirizzo senza dashboard, e nulla della dashboard, nemmeno il suo nome.
- **Chiunque abbia il link**: la dashboard è pubblica. Chiunque abbia il suo link può vederla, senza accedere.
- **Chiunque abbia il link e una password**: i visitatori aprono il link, poi inseriscono una password che condividi con loro. Nessuno ha bisogno di un account.

Scegliere un'opzione chiede conferma, spiegando che cosa cambia per i visitatori, poi si applica subito. Scegliere **Chiunque abbia il link e una password** chiede la password nella stessa finestra quando la dashboard non ne ha una; finché è la scelta attiva, **Cambia password** la sostituisce. Finché la dashboard è pubblica, gli indirizzi a cui i visitatori la aprono si trovano sotto la scelta: prima i suoi domini personalizzati, poi il suo link pubblico, ciascuno con **Copia link**. Un dominio personalizzato non ancora attivo è segnato **Non ancora attivo**, con il motivo.

All'interno del progetto, i proprietari e le etichette controllano chi vede cosa: vedi [Configurazione e permessi della dashboard](/docs/dashboards/configuration). Chi può vedere la dashboard ma non modificarla vede la scelta e può copiare il link pubblico, ma non può cambiarla.

Su OneUptime Cloud, condividere una dashboard richiede il piano **Growth**: con un piano inferiore, le due scelte pubbliche mostrano il piano che richiedono e non possono essere selezionate. Rendere di nuovo privata una dashboard (**Solo le persone di questo progetto**) funziona con ogni piano, quindi una dashboard rimasta pubblica alla fine di una prova, o dopo il passaggio a un piano inferiore, può sempre smettere di essere condivisa; la finestra indica che condividerla di nuovo richiede **Growth**. Passare da **Chiunque abbia il link** a **Chiunque abbia il link e una password**, e cambiare la password, funziona con ogni piano. Una dashboard creata tramite l'API o Terraform è soggetta agli stessi piani: creata pubblica richiede **Growth**, e creata con una lista di IP consentiti **Scale**.

La scelta è memorizzata in tre colonne, che l'API e Terraform leggono e scrivono come prima: `isPublicDashboard`, `enableMasterPassword` e `masterPassword`. Solo una dashboard pubblica ha un link pubblico, e ai suoi visitatori viene chiesta la password ogni volta che `enableMasterPassword` è attivo. Una dashboard pubblica con `enableMasterPassword` attivo ma senza password impostata non fa entrare nessuno dal suo link pubblico: la pagina **Condivisione** la mostra come **Chiunque abbia il link e una password**, dice che nessuno può ancora aprire il link e offre **Imposta password**. Scegliere **Solo le persone di questo progetto** disattiva anche `enableMasterPassword` e conserva la password, così una nuova condivisione con password può riutilizzarla.

## Dashboard pubbliche

Una dashboard pubblica:

- Si apre sempre in lettura. I visitatori non possono modificarla, e non vedono mai i suoi controlli di modifica.
- Include le variabili che hai aggiunto. I visitatori scelgono dagli stessi selettori che usa il tuo team, e possono cambiare l'intervallo di tempo, ingrandire, attivare l'aggiornamento automatico e passare a schermo intero. Si apre sull'intervallo di tempo e sull'aggiornamento automatico predefiniti della dashboard, e il browser di ogni visitatore ricorda le sue scelte.
- Permette ai visitatori di [ordinare i suoi elenchi e le sue tabelle](/docs/dashboards/widgets#ordinare-elenchi-e-tabelle) facendo clic sull'intestazione di una colonna, come fa il tuo team. Il browser di ogni visitatore ricorda il suo ordinamento, e OneUptime ordina da sé l'intero elenco, sempre in base a una delle colonne del widget.
- Usa il branding che imposti nella pagina **Branding** della dashboard: titolo della pagina, descrizione, logo, tema, favicon.
- Permette a ogni visitatore di passare dalla dashboard chiara a quella scura, e viceversa, con un pulsante con il sole o la luna nella sua barra degli strumenti; [Tema](#tema) spiega come.

Tratta la condivisione di una dashboard come la pubblicazione di una pagina web. Ogni widget che contiene diventa leggibile da chiunque abbia il link. Guarda che cosa c'è sul canvas prima di condividerla.

Ogni widget pubblica solo ciò che disegna, e solo per le risorse a cui è stato puntato. Un widget SLO, per esempio, pubblica i numeri principali di quello SLO ma mai la sua definizione: vedi [SLO](/docs/dashboards/widgets#slo). I widget con una **Data Source** esterna sono l'eccezione: vengono esclusi del tutto da una dashboard pubblica invece di essere resi, perché la loro configurazione è la query stessa. Alcuni altri widget non possono essere mostrati senza una sessione con accesso, e lo indicano al loro posto: [Su una dashboard pubblica](/docs/dashboards/widgets#su-una-dashboard-pubblica) li elenca.

## Condividere con una password

Scegli **Chiunque abbia il link e una password** e inserisci la password nella finestra. I visitatori vedono una richiesta di password prima che compaia la dashboard. La richiesta mostra il nome, il titolo della pagina e la favicon della dashboard, nel tema della dashboard, e nient'altro: la descrizione, il logo e i widget compaiono una volta inserita la password. La password viene memorizzata come hash: nessuno può rileggerla. Una nuova password funziona subito; chi aveva inserito quella vecchia può continuare a vedere la dashboard per un massimo di 7 giorni.

Usa una password quando:

- Vuoi condividere con un partner o un cliente, ma non vuoi che l'URL sia utile se trapela.
- La dashboard è "semi-pubblica": abbastanza aperta da non voler invitare ogni visualizzatore come membro del team, ma non abbastanza da metterla su internet.

Per un controllo più forte (account separati per ogni visualizzatore, una traccia di audit di chi ha visto cosa), lascia la dashboard su **Solo le persone di questo progetto** e invita invece i visualizzatori come membri del team in sola lettura.

## Lista di IP consentiti

In **Altre impostazioni** nella pagina **Condivisione**, la sezione **Lista IP consentiti** (la colonna `ipWhitelist`) limita il link pubblico agli indirizzi IP o agli intervalli IPv4 che elenchi, uno per riga, per esempio `203.0.113.7` o `10.0.0.0/8`. Si applica con o senza password; i membri del progetto che accedono non sono interessati. Lasciala vuota per consentire ogni indirizzo. Si salva per conto suo, separatamente dalla scelta, e modificarla richiede il piano **Scale** su OneUptime Cloud; svuotarla funziona con ogni piano. Finché una lista è in vigore, l'intestazione chiusa di **Altre impostazioni** mostra **Lista IP consentiti** con il numero di voci che contiene. In self-hosting, modificarla fa parte della Enterprise Edition: nella Community Edition un elenco già impostato continua ad applicarsi e si può solo rimuovere.

Usala quando:

- La dashboard deve essere raggiungibile solo dal tuo ufficio o dalla tua VPN.
- Un portale per fornitori deve essere raggiungibile solo dai loro IP noti.
- Vuoi una protezione in più oltre a una password.

Le richieste da qualsiasi altro IP vengono rifiutate con una pagina **Access Denied** che non mostra nulla della dashboard: né il nome, né il branding, né la richiesta di password. Una riga che non è un indirizzo IP né un intervallo IPv4 viene rifiutata al salvataggio, perché il server la salterebbe.

## Domini personalizzati

Di base, una dashboard pubblica viene servita al suo link pubblico, sull'indirizzo di OneUptime. Per ospitarla su un tuo sottodominio come `dashboard.acme.com`, apri **Branding → Domini personalizzati** nel menu laterale della dashboard. Funziona esattamente come la pagina **Domini personalizzati** di una pagina di stato.

La scheda si intitola **Domini personalizzati** e dice che cosa fare: punta il record CNAME di ogni dominio al record CNAME per le dashboard della tua installazione, e OneUptime emette il certificato SSL del dominio e lo rinnova per te. La tabella ha due colonne, **Dominio** e **Stato**.

Mettere la dashboard sul tuo dominio richiede tre passaggi, e solo i primi due spettano a te:

1. **Aggiungi il dominio**: un sottodominio e uno dei tuoi domini verificati.
2. **Aggiungi il suo record CNAME** presso il tuo provider DNS. La finestra **Configurazione DNS** si apre con il record non appena aggiungi il dominio.
3. **Il certificato SSL gratuito viene emesso automaticamente** non appena il record viene trovato. Non c'è nessun pulsante da premere.

Una volta verificata, la dashboard è raggiungibile sia sul tuo dominio personalizzato sia sull'URL originale.

### Aggiungere il dominio

Fai clic su **Crea: Dashboard Dominio**. La finestra è una sola pagina:

- **Sottodominio**: solo l'etichetta, con il segnaposto `dashboard (leave blank for root)`. Inserisci solo `dashboard`, non l'intero nome host. Lascialo vuoto o inserisci `@` per usare il dominio radice (apex).
- **Dominio**: i domini verificati in **Impostazioni del progetto → Avanzato → Domini**, dove dimostri con un record TXT che un dominio è tuo. Un dominio che non hai verificato non è elencato, perché verrebbe rifiutato. Il link **Aggiungi un dominio** accanto al campo apre quella pagina in una nuova scheda.
- **Altri campi**: chiuso. Finché è chiuso, la sua intestazione dice quale certificato userà il dominio: "Emettiamo un certificato SSL gratuito per questo dominio e lo rinnoviamo automaticamente." Aprilo solo per usare un certificato tuo (vedi sotto).

Fai clic su **Crea: Dashboard Dominio**. La finestra si chiude e si apre la **Configurazione DNS** del nuovo dominio. Il nome completo di un dominio è fissato quando lo aggiungi, quindi **Modifica** cambia solo il suo certificato. Per usare un altro sottodominio, aggiungi quel dominio ed elimina quello vecchio.

### Configurazione DNS e Verifica ora

La finestra **Configurazione DNS** mostra il record da aggiungere presso il tuo provider DNS, un campo per riga, ciascuno con un pulsante di copia: **Tipo** `CNAME`, **Nome** il dominio completo che hai aggiunto, e **Valore** il record CNAME per le dashboard della tua installazione. Per un dominio radice, senza sottodominio, la finestra aggiunge una nota: molti provider DNS non consentono lì un record CNAME, quindi usa invece il record ALIAS, ANAME o di CNAME flattening del tuo provider, con lo stesso valore.

OneUptime verifica ogni dominio non verificato ogni 15 minuti, e quando la verifica trova il record ordina il certificato Let's Encrypt gratuito del dominio nella stessa verifica, che tu torni o meno. Per verificare subito, fai clic su **Verifica ora**:

- **Il record non è ancora stato trovato.** La finestra resta aperta e dice quale record ha cercato. Un nuovo record DNS può metterci un po' a comparire. Fai di nuovo clic su **Verifica ora** più tardi, oppure lascia fare alla verifica ogni 15 minuti.
- **Il record è stato trovato.** La finestra dice "Il tuo record CNAME è verificato." e che cosa succede poi al certificato. Il certificato gratuito viene ordinato in quel momento, e di solito è attivo entro 15 minuti.

Finché un dominio non è verificato e il suo certificato non è al suo posto, la sua riga ha un'azione **Configurazione DNS** che apre la stessa finestra. Su un dominio verificato il cui ordine del certificato continua a fallire, o il cui certificato è scaduto, **Verifica ora** da lì ordina di nuovo e mostra perché l'ultimo ordine è fallito. Ordina al massimo una volta per dominio ogni 15 minuti; nel frattempo, OneUptime continua a riprovare da solo, aspettando un po' di più dopo ogni fallimento consecutivo. Il rinnovo è automatico, ben prima che il certificato scada, e una verifica DNS fallita non rimuove mai un certificato ancora valido.

### Leggere la colonna Stato

La colonna **Stato** indica a che punto è ogni dominio sulla strada verso HTTPS, in uno di otto stati, gli stessi delle pagine di stato. Quando un ordine è fallito, il motivo si trova nella riga sottostante.

| Che cosa dice la colonna Stato | Che cosa significa |
| --- | --- |
| In attesa del DNS: aggiungi il record CNAME. | Il record CNAME non è ancora stato trovato. Apri **Configurazione DNS** per vedere il record, aggiungilo presso il tuo provider DNS, poi fai clic su **Verifica ora** o attendi la verifica ogni 15 minuti. |
| Emissione di un certificato gratuito, di solito entro 15 minuti. | Il record è verificato, e il certificato viene ordinato o scritto. Non c'è niente da fare. |
| Non è ancora stato possibile emettere un certificato gratuito. Continuiamo a provare. | Il record è verificato, ma l'ordine del suo certificato è fallito, per il motivo indicato nella riga sottostante. Correggi la causa, poi apri **Configurazione DNS** e fai clic su **Verifica ora** per ordinarlo di nuovo subito. |
| Certificato scaduto. Continuiamo a provare a rinnovarlo. | Il certificato del dominio è scaduto perché i suoi rinnovi sono falliti. Apri **Configurazione DNS** e fai clic su **Verifica ora** per rinnovarlo subito e vedere perché. |
| Certificato emesso, si rinnova automaticamente. | Fatto. Il dominio serve il suo certificato via HTTPS, e OneUptime lo rinnova. |
| Certificato emesso, ma il rinnovo non è riuscito. Continuiamo a provare. | Il dominio serve ancora un certificato valido, ma il suo ultimo rinnovo è fallito, per il motivo indicato nella riga sottostante. OneUptime riprova ben prima che il certificato scada. |
| Usa il tuo certificato caricato. | Il record è verificato, e il dominio è servito con il certificato che hai caricato. |
| Verificato. Usa l'HTTPS del tuo proxy. | Su un'installazione self-hosted senza chiave dell'account Let's Encrypt, il record è verificato e il dominio è attivo. Il suo HTTPS spetta al vostro proxy, a meno che non carichiate un certificato. |

Se un ordine fallisce, le cause abituali sono un record CAA sul tuo dominio che non consente `letsencrypt.org` e, su un'installazione self-hosted, un server che Let's Encrypt non riesce a raggiungere sulla porta 80.

### Il tuo certificato, e la riemissione

Per usare invece un tuo certificato, apri **Altri campi** quando aggiungi il dominio, attiva **Carica certificato personalizzato** e incolla il **Certificato** e la sua **Chiave privata del certificato**. OneUptime lo serve entro 15 minuti invece di ordinare un certificato Let's Encrypt, e prende il posto di qualsiasi certificato Let's Encrypt che il dominio avesse prima. Rinnovare un certificato caricato spetta a te: modifica il dominio e incolla quello nuovo. Se il dominio aveva prima un certificato gratuito, OneUptime continua a rinnovarlo mentre è in uso il tuo, quindi tornare indietro è immediato.

Una volta ordinato un certificato gratuito per un dominio, la riga mostra **Reissue SSL**, che chiede a Let's Encrypt un certificato completamente nuovo quando ne vuoi uno prima del rinnovo automatico. Ogni dominio può essere riemesso una volta ogni 24 ore.

Su un'installazione self-hosted, i domini personalizzati delle dashboard si attivano con la variabile d'ambiente `DASHBOARD_CNAME_RECORD` (`dashboard.cnameRecord` nel chart Helm), che è la destinazione a cui puntano i tuoi record CNAME. Senza di essa, la scheda e la finestra **Configurazione DNS** dicono "Custom Domains not enabled for this OneUptime installation" invece di mostrare un record, e OneUptime non verifica domini né ordina certificati per le dashboard. Un'installazione senza chiave dell'account Let's Encrypt (`LETS_ENCRYPT_ACCOUNT_KEY`, `letsEncrypt.accountKey` nel chart Helm) non ordina certificati: un dominio di dashboard è attivo non appena il suo record è verificato, servito con l'HTTPS del tuo proxy o con un certificato che carichi.

### Chi può verificare e riemettere

**Verifica ora**, l'ordine del certificato di un dominio e **Reissue SSL** modificano il dominio, quindi richiedono l'autorizzazione a modificarlo: **Edit Dashboard Domain**, o un ruolo che la includa (Project Owner, Project Admin, Project Member, Settings Admin o Settings Member).

Chi può solo leggere il dominio, come un Viewer o un Settings Viewer, vede comunque la colonna **Stato** e il record da aggiungere in **Configurazione DNS**. Per loro **Verifica ora** e **Reissue SSL** sono bloccati, e indicano quale autorizzazione serve. OneUptime continua comunque a verificare ogni dominio e a ordinarne il certificato da solo.

Lo stesso vale per le chiavi API. Una chiave che può solo leggere i domini delle dashboard non può chiamare `verify-cname`, `order-ssl` o `reissue-ssl` su `/dashboard-domain`. Dalle **Read Dashboard Domain** ed **Edit Dashboard Domain** se ne ha bisogno.

Un dominio appartiene a una sola dashboard del progetto alla volta. Puoi collegare più di un dominio personalizzato a una singola dashboard se servi lo stesso contenuto a più pubblici: una dashboard per i clienti con il tuo marchio, una dashboard per un partner con doppio marchio, o una pagina pubblica sullo stato di salute con il proprio URL. Un nome che una pagina di stato o un modulo usa già, in qualsiasi progetto, viene rifiutato: un dominio mostra una sola pagina di stato, una sola dashboard o un solo modulo.

## Branding

Nella pagina **Branding** della dashboard, puoi configurare:

- **Titolo della pagina**: ciò che appare nella scheda del browser e in cima alla pagina.
- **Descrizione della pagina**: la descrizione usata dai motori di ricerca e dalle anteprime sui social.
- **Logo**: un'immagine mostrata nell'intestazione della dashboard pubblica.
- **Tema**: chiaro, scuro o come è impostato il dispositivo di ogni visitatore; vedi [Tema](#tema).
- **Favicon**: la piccola icona nella scheda del browser.

Il logo e la favicon sono file caricati nel progetto stesso della dashboard, e questo viene verificato ogni volta che ne viene salvato uno: dalla dashboard, dall'API, da Terraform o da un workflow. Un file caricato in un altro progetto viene rifiutato con le stesse parole che riceve un file che non esiste più: "The logo's file could not be found. Upload the logo again." oppure "The favicon's file could not be found. Upload the favicon again." La dashboard pubblica mostra solo immagini del proprio progetto.

Il titolo e la descrizione della pagina compaiono anche in cima alla barra degli strumenti della dashboard per il tuo team, al posto del suo nome e della sua descrizione. Il logo, il tema e la favicon valgono solo per la dashboard pubblica.

I visitatori vedono il branding solo quando possono vedere la dashboard. Prima che venga inserita la password, una dashboard condivisa con password mostra solo il titolo della pagina, la favicon e il tema, e i motori di ricerca e le anteprime dei link vedono il titolo della pagina ma non la descrizione della pagina. Una dashboard con una lista di IP consentiti mostra il suo branding solo agli indirizzi della lista, e i motori di ricerca e le anteprime dei link non ne vedono nulla.

### Tema

La scheda **Tema**, subito sotto il logo, decide come appare la dashboard pubblica ai suoi visitatori. Scegli una delle sue tre opzioni e viene salvata subito; non c'è un pulsante **Modifica**.

| Opzione | Cosa vedono i visitatori |
| ------ | ----------------- |
| **Chiaro** | La dashboard chiara, comunque sia impostato il loro dispositivo. Le dashboard create prima che l'impostazione esistesse sono su **Chiaro**, quindi hanno l'aspetto di sempre. |
| **Scuro** | La dashboard scura, comunque sia impostato il loro dispositivo. |
| **Come il dispositivo di ogni visitatore** | Chiara o scura, come è impostato il loro dispositivo, e cambia con esso mentre la dashboard è aperta. |

Qualunque cosa tu scelga, un pulsante con il sole o la luna nella barra degli strumenti della dashboard permette a ogni visitatore di passare alla dashboard chiara o a quella scura, o di tornare al tema che hai impostato, e il suo browser ricorda la scelta per ogni dashboard pubblica di quell'indirizzo. Sulla dashboard scura il logo poggia su uno sfondo chiaro, così anche un logo pensato per una pagina bianca resta ben visibile.

Una dashboard creata da ora in poi parte con **Come il dispositivo di ogni visitatore**. Tramite l'API e Terraform il campo è `theme`, con uno dei valori `Light`, `Dark` o `System` (**Come il dispositivo di ogni visitatore**), scritti esattamente così; qualsiasi altro valore viene rifiutato. Una configurazione Terraform che non imposta alcun `theme` riceve `Light`, quindi una configurazione scritta prima dell'impostazione non pianifica mai una modifica a una dashboard che gestisce.

Il tema è nell'HTML della dashboard, quindi la dashboard viene disegnata con esso fin dall'inizio: una dashboard scura non lampeggia di bianco durante il caricamento, e anche la sua richiesta di password viene disegnata con esso. Ogni widget lo segue; il codice di un widget HTML può dare uno stile al tema scuro, come spiega [HTML](/docs/dashboards/widgets#html). Le pagine **Access Denied** e non trovata non mostrano nulla di una dashboard, quindi seguono il visitatore: la sua scelta, altrimenti il suo dispositivo.

## Incorporare

Puoi incorporare una dashboard pubblica nel tuo sito con un iframe, al suo link pubblico o a uno dei suoi domini personalizzati:

```html title="embed.html"
<iframe
  src="https://dashboard.acme.com"
  width="100%"
  height="800"
  frameborder="0"
></iframe>
```

Se la dashboard è condivisa con una password, i visitatori vedranno la richiesta della password dentro l'iframe.

Per dare a una dashboard incorporata l'aspetto del tuo sito, aggiungi `?theme=light` o `?theme=dark` al suo indirizzo, come in `https://dashboard.acme.com/?theme=dark`: la dashboard viene disegnata con quel tema per chiunque apra quell'indirizzo, qualunque siano il suo tema e la scelta del visitatore, e la sua barra degli strumenti non ha il pulsante del tema. `?theme=system` segue il dispositivo di ogni visitatore. Il tema resta anche attraverso la richiesta di password.

## Inviare un link

Il link pubblico apre la dashboard con i suoi valori predefiniti salvati. Per inviare un link che si apra su un certo valore, aggiungici la variabile come `?var-<name>=<value>`, come fa la barra degli indirizzi quando un visitatore sceglie un valore; più valori sono separati da virgole. Per aprirla su un intervallo di tempo o un aggiornamento automatico propri, aggiungi allo stesso modo `range` e `refresh`: `?range=1d&refresh=1m` si apre sull'ultimo giorno, aggiornandosi ogni minuto, come farebbe uno schermo a parete. `range` accetta `5m`, `15m`, `30m`, `1h`, `2h`, `3h`, `1d`, `2d`, `7d`, `14d`, `1mo` o `3mo`, e `refresh` accetta `off`, `5s`, `10s`, `30s`, `1m`, `5m` o `15m`. Prevalgono sui valori predefiniti della dashboard e sulle scelte del visitatore, che può comunque cambiarli. Per aprire la dashboard in un tema, aggiungi `theme=light`, `theme=dark` o `theme=system`, come descrive [Incorporare](#incorporare).

## Passaggi successivi

:::cards
- [Configurazione e permessi della dashboard](/docs/dashboards/configuration): Proprietari, etichette e chi può cambiare la condivisione.
- [Variabili e filtri della dashboard](/docs/dashboards/variables): I selettori che usano i visitatori, e i link che conservano una selezione.
- [Widget della dashboard](/docs/dashboards/widgets): Che cosa pubblica ogni widget su una dashboard pubblica.
- [Panoramica delle pagine di stato](/docs/status-pages/index): Di' ai clienti se il tuo servizio funziona.
:::
