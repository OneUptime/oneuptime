# Branding e domini personalizzati

Una pagina di stato è l'unica superficie di OneUptime che i tuoi clienti guardano davvero, quindi dovrebbe sembrare tua e vivere sul tuo dominio. Entrambe le cose si configurano dalla sezione **Branding** del menu laterale di una pagina di stato, più un'impostazione nascosta nelle **Impostazioni avanzate**.

Quello che conviene sapere prima di iniziare: il branding è diviso su sette schermate distinte, e la divisione non è sempre dove te l'aspetteresti. Il logo e l'immagine di copertina non stanno in **Branding essenziale** — stanno in **Intestazione**. La favicon sta in **Branding essenziale**. I colori stanno in **Pagina di panoramica**. Tutto il resto che chiameresti "tema" si fa in CSS personalizzato.

Questa pagina percorre una schermata alla volta, poi ti accompagna nella sequenza completa CNAME-poi-SSL per mettere la pagina su `status.tuaazienda.com`.

## Dove si trova ogni controllo di branding

Apri una pagina di stato: la sezione **Branding** del menu laterale ha sette voci. Ecco la mappa, così smetti di cercare.

| Pagina                       | Che cosa imposti lì                                                                         |
| -------------------------- | ------------------------------------------------------------------------------------------ |
| **Branding essenziale**     | Titolo della pagina, descrizione della pagina, indicizzazione sui motori di ricerca, favicon.                             |
| **Intestazione**                 | Logo, immagine di copertina, il loro testo alternativo e la barra dei link dell'intestazione.                                |
| **Piè di pagina**                 | La riga di copyright e la barra dei link del piè di pagina.                                                    |
| **Pagina di panoramica**          | Descrizione della panoramica, colori delle barre del grafico cronologico, stati di inattività, percentuale di uptime complessiva. |
| **HTML, CSS e JavaScript** | HTML dell'intestazione, HTML del piè di pagina, CSS personalizzato, JavaScript personalizzato.                                                   |
| **Domini personalizzati**         | Il tuo dominio, la verifica del CNAME e l'SSL.                                              |
| **Lingue**              | La lingua predefinita e le lingue offerte nel selettore del piè di pagina.                                         |

## Branding essenziale

**Pagine di stato → la tua pagina → Branding → Branding essenziale** (`{id}/branding`) contiene tre schede.

- **Titolo e descrizione** — la scheda avverte che questi dati servono anche per la SEO. **Modifica** apre **Titolo della pagina** (segnaposto `Please enter page title here.`) e **Descrizione della pagina**. È ciò che mostrano i motori di ricerca e le anteprime dei link, quindi scrivili per un cliente, non per il tuo team.
- **Search Engine Indexing** — un unico interruttore, **Allow Search Engines to Index this Status Page**, descritto nel prodotto come il controllo che decide se Google e Bing possono elencare la pagina nei loro risultati. È attivo per impostazione predefinita. Disattivalo e la pagina viene servita con `noindex, nofollow`.
- **Favicon** — **Edit Favicon** apre il caricamento dell'immagine **Favicon**. È l'iconcina nella scheda del browser.

Da usare quando: la pagina è solo interna o è ancora in costruzione. Disattiva **Allow Search Engines to Index this Status Page** così una pagina a metà non inizia a posizionarsi sul nome del tuo marchio.

## La schermata Intestazione

**Pagine di stato → la tua pagina → Branding → Intestazione** (`{id}/header-style`). Nonostante il nome nel menu laterale, è qui che vivono i tuoi due asset di marca più importanti.

La prima scheda si intitola **Logo, copertina e favicon**, con un pulsante **Edit Images**:

- **Logo** — caricamento immagine, segnaposto `Upload logo`.
- **Logo Alt Text** — segnaposto `Logo of My Company`. Se lo lasci vuoto viene usato il titolo della pagina di stato.
- **Copertina** — caricamento immagine, segnaposto `Upload cover image`. È il banner largo dietro l'intestazione.
- **Cover Image Alt Text** — la stessa idea per la copertina.

Sotto c'è una tabella **Link intestazione** ("Link dell'intestazione per la tua pagina di stato"). Ogni link ha un **Titolo** e un **Collegamento** (un URL, segnaposto `https://link.com`), e le righe si riordinano trascinandole. Senza nulla di configurato la tabella recita "No status header link for this status page."

Utile per: riportare i visitatori al tuo sito di marketing, alla tua documentazione o a un portale di supporto senza costringerli a indovinare l'URL.

## La schermata Piè di pagina

**Pagine di stato → la tua pagina → Branding → Piè di pagina** (`{id}/footer-style`) ha la stessa forma di **Intestazione**: una scheda e una tabella.

- **Informazioni sul copyright** — **Edit Copyright** apre un unico campo, **Informazioni sul copyright**, con il segnaposto `Acme, Inc.`.
- **Link del footer** — la stessa coppia **Titolo** più **Collegamento**, ordinabile per trascinamento, con il messaggio vuoto "No status footer link for this status page."

Qui vanno i link legali, la privacy e i termini. I link dell'intestazione servono per navigare; quelli del piè di pagina per le note in calce.

## Il branding della pagina di panoramica

**Pagine di stato → la tua pagina → Branding → Pagina di panoramica** (`{id}/overview-page-branding`) è l'unica schermata in cui i colori si possono configurare, ed è anche quella che decide che cosa significa "down" sul grafico.

- **Pagina di panoramica** — **Edit Branding** apre un campo markdown, **Descrizione della pagina panoramica.**, che viene mostrato sopra l'elenco delle risorse. Usalo per una frase di contesto: che cosa copre questa pagina e dove rivolgersi per assistenza.
- **Rules for Bar Colors of History Chart** — una tabella ordinata di regole, riordinabile per trascinamento. Ogni regola ha **Quando la % di uptime è maggiore o uguale a** e **Quindi, usa questo colore della barra**; le colonne della tabella riportano **Quando la percentuale di uptime >=** e **Quindi, il colore della barra è**. L'ordine conta, quindi disponile come vuoi che vengano valutate.
- **Stati del monitor per i tempi di inattività** — **Edit Statuses** apre una selezione multipla descritta come "Questi stati del monitor sono considerati come inattivi". È così che decidi se, per esempio, uno stato degradato pesa sull'uptime di questa pagina.
- **Colore predefinito della barra del grafico cronologico** — **Edit Default Bar Color** apre il selettore **Colore predefinito della barra**, il colore usato quando nessuna regola corrisponde.
- **Percentuale di uptime complessiva** — **Edit Settings** apre l'interruttore **Mostra percentuale di uptime complessiva** e un menu **Seleziona precisione del tempo di attività**, che per impostazione predefinita usa due decimali (`99.99% (Two Decimal)`).

**Quanti giorni copre il grafico non si imposta qui.** Quello è **Mostra cronologia uptime (in giorni)**, in **Pagine di stato → la tua pagina → Avanzato → Impostazioni avanzate** (`{id}/settings`), valido da 1 a 90.

## HTML, CSS e JavaScript personalizzati

**Pagine di stato → la tua pagina → Branding → HTML, CSS e JavaScript** (`{id}/custom-code`) ha quattro schede modificabili in modo indipendente, appoggiate alle colonne `headerHTML`, `footerHTML`, `customCSS` e `customJavaScript` della pagina di stato:

- **HTML intestazione** — segnaposto `Insert Custom HTML here.`, iniettato nell'intestazione della pagina.
- **HTML del footer** — lo stesso, per il piè di pagina.
- **CSS personalizzato** — segnaposto `Insert Custom CSS here.`
- **JavaScript personalizzato** — segnaposto `Insert Custom JavaScript here.`

**Non esiste un selettore di tema.** Le pagine di stato di OneUptime non hanno un'impostazione di tema o di colore del marchio: gli unici controlli di colore integrati, ovunque, sono il **Colore predefinito della barra** e le regole sui colori delle barre nella schermata **Pagina di panoramica**. Font, colori di sfondo, colori d'accento e ritocchi al layout passano tutti dal **CSS personalizzato** che trovi qui. Se stavi cercando un campo "colore del marchio", la risposta è questa: non c'è, e questa casella è la via d'uscita.

> Il JavaScript personalizzato gira nei browser dei tuoi visitatori, su una pagina che le persone caricano proprio quando temono che qualcosa sia rotto. Tienilo piccolo, ospitalo tu dove puoi, e provalo prima di farci affidamento.

## Impostazioni della lingua

**Pagine di stato → la tua pagina → Branding → Lingue** (`{id}/languages`) ha due schede, ed entrambe riguardano il selettore di lingua che i visitatori trovano nel piè di pagina.

- **Lingua predefinita** — **Edit Default Language** apre un menu a discesa che elenca ogni lingua supportata con il nome nativo e quello inglese (`Deutsch (German)`). La scheda la descrive come la lingua che i visitatori vedono la prima volta; possono sempre cambiarla dal piè di pagina. Il valore predefinito è l'inglese.
- **Lingue abilitate** — **Edit Enabled Languages** apre una selezione multipla, segnaposto `All languages`. Lasciala vuota e vengono offerte tutte le lingue supportate. Scegline alcune e il selettore nel piè di pagina elenca solo quelle.

OneUptime arriva con sedici lingue: inglese, tedesco, francese, spagnolo, italiano, portoghese, olandese, danese, norvegese, svedese, russo, giapponese, coreano, cinese semplificato, cinese tradizionale e hindi.

## Domini personalizzati

Per impostazione predefinita una pagina di stato è raggiungibile all'URL di anteprima mostrato nella sua schermata **Panoramica**. Per metterla sul tuo hostname, vai su **Pagine di stato → la tua pagina → Branding → Domini personalizzati** (`{id}/domains`).

La scheda si intitola **Domini personalizzati** e la sua descrizione dice il requisito senza giri di parole: aggiungi il record CNAME della pagina di stato della tua installazione come CNAME di questi domini, altrimenti non funziona. Senza nulla di configurato la tabella recita "Nessun dominio personalizzato trovato." La tabella ha due colonne, **Dominio** e **Stato**, e filtri per **Dominio**, **CNAME valido** e **SSL provisionato**.

### Prima di cominciare

Due prerequisiti, e saltarne uno è il motivo più comune per cui la cosa non funziona:

- **Il dominio principale deve essere già verificato.** Il menu **Dominio** elenca solo i domini verificati nelle impostazioni del progetto — il testo di aiuto del campo ti rimanda a **Altro → Impostazioni del progetto → Domini personalizzati** per aggiungerne uno prima.
- **L'installazione deve avere un record CNAME per la pagina di stato configurato.** Nelle installazioni self-hosted è la variabile d'ambiente `STATUS_PAGE_CNAME_RECORD` in Docker Compose, oppure `statusPage.cnameRecord` nel `values.yaml` di Helm. Senza di essa, le finestre **Aggiungi CNAME** e **Ordina SSL gratuito** mostrano il messaggio "Custom Domains not enabled for this OneUptime installation" al posto delle istruzioni.

### Aggiungere il dominio

Clicca **Create Status Page Domain**. La finestra (**Create New Status Page Domain**) ha due passaggi:

**Base**

- **Sottodominio** — solo l'etichetta, segnaposto `status (leave blank for root)`. Scrivi soltanto `status`, non l'hostname intero. Lascialo vuoto o inserisci `@` per usare il dominio radice.
- **Dominio** — un menu a discesa dei domini verificati, segnaposto `Select domain`.

**Altro**

- **Carica certificato personalizzato** — un interruttore, disattivo per impostazione predefinita. Lascialo disattivo e OneUptime ordina un certificato gratuito per te. Attivalo e compaiono i campi **Certificato** e **Chiave privata del certificato** per il tuo materiale PEM.

## Verificare il CNAME

Finché il dominio non è verificato, la riga mostra un'azione **Aggiungi CNAME**. Apre una finestra intitolata **Aggiungi CNAME** che ti dà esattamente ciò che devi incollare nel tuo provider DNS:

- **Tipo di record** — `CNAME`
- **Nome** — il dominio completo appena creato, per esempio `status.tuaazienda.com`
- **Contenuto** — il record CNAME della pagina di stato della tua installazione

La finestra avverte che, una volta creato il record, la verifica automatica può richiedere fino a 24 ore. Non sei obbligato ad aspettare: il pulsante di conferma della finestra è **Verifica CNAME**, che controlla il record su richiesta.

Crea prima il record DNS, poi clicca **Verifica CNAME**. Cliccarlo prima che il record esista fallisce e basta.

## Ordinare un certificato SSL

Una volta verificato il CNAME — e solo se non hai caricato un certificato tuo — sulla riga compare un'azione **Ordina SSL gratuito**. La sua finestra, **Order Free SSL Certificate for this Status Page**, spiega che OneUptime usa LetsEncrypt, che il processo è sicuro e gratuito e che il provisioning richiede qualche ora dopo l'ordine. Il pulsante di conferma è **Ordina SSL gratuito**.

**I tempi dichiarati non concordano tra una schermata e l'altra**, quindi non prendere alla lettera nessun singolo numero: la finestra dell'ordine dice tre ore, la colonna **Stato** dice un'ora e un certificato personalizzato dice trenta minuti. Considerali tutti come "torna più tardi in giornata", e contatta il supporto se per allora non è successo nulla.

Una volta effettuato il provisioning, il rinnovo è automatico. Non c'è nulla di ricorrente da fare.

## Leggere la colonna Stato del dominio

La colonna **Stato** è l'intera macchina a stati della configurazione dentro una cella. Ogni messaggio ti dice o che cosa fare dopo, o che hai finito.

| Che cosa dice la colonna Stato                           | Che cosa significa                                                                     |
| ----------------------------------------------------- | --------------------------------------------------------------------------------- |
| Action Required: Please add your CNAME record.        | Il CNAME non è ancora verificato. Aggiungi il record, poi **Verifica CNAME**.             |
| Action Required: Please order SSL certificate.        | Il CNAME è verificato ma non c'è nessun certificato in ordine. Clicca **Ordina SSL gratuito**.       |
| No action is required, allow 30 minutes to provision. | Hai caricato un certificato personalizzato ed è in fase di installazione.                      |
| No action is required, this will be provisioned soon. | Il certificato gratuito è stato ordinato ed è in arrivo. Contatta il supporto se non arriva mai. |
| Certificate Provisioned. No action required.          | Fatto. OneUptime rinnova il certificato automaticamente.                                 |

Se una riga resta ferma su "Action Required: Please add your CNAME record." molto dopo che hai creato la voce DNS, controlla che il nome del record sia il dominio completo e che il suo contenuto corrisponda esattamente al record CNAME della tua installazione.

## Powered by OneUptime

La riga "Offerto da OneUptime" non è un'impostazione della sezione branding. Sta in **Pagine di stato → la tua pagina → Avanzato → Impostazioni avanzate** (`{id}/settings`), nella scheda **Branding "Powered By OneUptime"**, come singolo interruttore: **Nascondi il marchio Powered By OneUptime**. **Edit Settings** lo apre, come per ogni altra scheda di quella pagina.

## Dove leggere ora

- [Panoramica delle pagine di stato](/docs/status-pages/index) — che cos'è una pagina di stato e come si incastrano i pezzi.
- [Risorse e gruppi della pagina di stato](/docs/status-pages/resources-and-groups) — scegliere che cosa i visitatori vedono davvero sulla pagina.
- [Iscritti e annunci](/docs/status-pages/subscribers) — iscritti via email, SMS, Slack e webhook, più gli annunci.
- [API pubblica](/docs/status-pages/public-api) — leggere i dati della pagina di stato in modo programmatico.
- [Stati e gravità degli incidenti](/docs/incidents/states-and-severities) — che cosa fa comparire e sparire un incidente dalla pagina.
