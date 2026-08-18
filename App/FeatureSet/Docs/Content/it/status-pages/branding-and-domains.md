# Branding e Domini Personalizzati

Una pagina di stato è l'unica superficie di OneUptime che i tuoi clienti guardano davvero, quindi dovrebbe sembrare tua e vivere sul tuo dominio. Entrambe le cose si configurano dalla sezione **Branding** del menu laterale di una pagina di stato, più un'impostazione che si nasconde in **Advanced Settings**.

La cosa da sapere prima di iniziare: il branding è diviso su sette schermate separate, e la divisione non è sempre dove te la aspetteresti. Il logo e l'immagine di copertina non sono su **Essential Branding** — sono su **Header**. La favicon è su **Essential Branding**. I colori sono su **Overview Page**. Tutto il resto che potresti pensare come "tema" è Custom CSS.

Questa pagina attraversa ogni schermata a turno, poi ti guida attraverso l'intera sequenza CNAME-poi-SSL per mettere la pagina su `status.yourcompany.com`.

## Dove vive ogni controllo di branding

Apri una pagina di stato, e la sezione **Branding** del menu laterale ha sette voci. Ecco la mappa, così smetti di cercare.

| Pagina                       | Cosa imposti lì                                                                              |
| ------------------------------- | ---------------------------------------------------------------------------------------------- |
| **Essential Branding**          | Titolo della pagina, descrizione della pagina, indicizzazione sui motori di ricerca, favicon.  |
| **Header**                      | Logo, immagine di copertina, il loro testo alternativo e la barra dei link dell'intestazione.  |
| **Footer**                      | Riga del copyright e la barra dei link del footer.                                             |
| **Overview Page**               | Descrizione della panoramica, colori delle barre del grafico della cronologia, stati di inattività, percentuale di uptime complessiva. |
| **HTML, CSS & JavaScript**      | HTML dell'intestazione, HTML del footer, CSS personalizzato, JavaScript personalizzato.        |
| **Custom Domains**              | Il tuo dominio, verifica CNAME e SSL.                                                           |
| **Languages**                   | Lingua predefinita e le lingue offerte nel selettore del footer.                                |

## Branding essenziale

**Status Pages → your page → Branding → Essential Branding** (`{id}/branding`) contiene tre card.

- **Title and Description** — la card nota che questo viene usato anche per la SEO. **Edit** apre **Page Title** (segnaposto `Please enter page title here.`) e **Page Description**. Questo è ciò che i motori di ricerca e le anteprime dei link mostrano, quindi scrivilo per un cliente, non per il tuo team.
- **Search Engine Indexing** — un unico interruttore, **Allow Search Engines to Index this Status Page**, descritto nel prodotto come il controllo su se Google e Bing possano elencare la pagina nei loro risultati. È attivo per impostazione predefinita. Disattivalo e la pagina viene servita con `noindex, nofollow` invece.
- **Favicon** — **Edit Favicon** apre il caricamento immagine **Favicon**. È la piccola icona nella scheda del browser.

Usalo quando: la pagina è solo interna o ancora in fase di configurazione. Disattiva **Allow Search Engines to Index this Status Page** così una pagina a metà non inizia a posizionarsi per il nome del tuo marchio.

## La schermata dell'intestazione

**Status Pages → your page → Branding → Header** (`{id}/header-style`). Nonostante il nome nel menu laterale, è qui che vivono i tuoi due maggiori asset di marchio.

La prima card si intitola **Logo, Cover and Favicon**, con un pulsante **Edit Images**:

- **Logo** — caricamento immagine, segnaposto `Upload logo`.
- **Logo Alt Text** — segnaposto `Logo of My Company`. Se lo lasci vuoto, viene usato invece il titolo della pagina di stato.
- **Cover** — caricamento immagine, segnaposto `Upload cover image`. Questo è il banner largo dietro l'intestazione.
- **Cover Image Alt Text** — la stessa idea per la copertina.

Sotto c'è una tabella **Header Links** ("Header Links for your status page"). Ogni link ha un **Title** e un **Link** (un URL, segnaposto `https://link.com`), e le righe vengono riordinate trascinandole. Senza nulla configurato la tabella recita "No status header link for this status page."

Utile per: rimandare i visitatori al tuo sito marketing, alla tua documentazione o a un portale di supporto senza farli indovinare l'URL.

## La schermata del footer

**Status Pages → your page → Branding → Footer** (`{id}/footer-style`) ha la stessa forma di **Header**, una card e una tabella.

- **Copyright Info** — **Edit Copyright** apre un unico campo, **Copyright Info**, con segnaposto `Acme, Inc.`.
- **Footer Links** — la stessa coppia **Title** più **Link**, ordinata per trascinamento, messaggio vuoto "No status footer link for this status page."

I link legali, sulla privacy e sui termini appartengono qui. I link dell'intestazione servono per la navigazione; i link del footer sono per la parte in piccolo.

## Branding della pagina di panoramica

**Status Pages → your page → Branding → Overview Page** (`{id}/overview-page-branding`) è l'unica schermata dove i colori sono configurabili, e decide anche cosa significa "down" sul grafico.

- **Overview Page** — **Edit Branding** apre un campo markdown, **Overview Page Description.**, che viene reso sopra l'elenco delle risorse. Usalo per una frase di contesto: cosa copre questa pagina e dove andare per il supporto.
- **Rules for Bar Colors of History Chart** — una tabella ordinata e riordinabile per trascinamento di regole. Ogni regola ha **When uptime % is greater than or equal to** e **Then, use this bar color**; le colonne della tabella recitano `When Uptime Percent >=` e `Then, Bar Color is`. L'ordine conta, quindi disponile nel modo in cui vuoi che vengano valutate.
- **Downtime Monitor Statuses** — **Edit Statuses** apre una selezione multipla descritta come "These monitor statuses are considered as down". È così che decidi se, per esempio, uno stato degradato conta contro l'uptime su questa pagina.
- **Default Bar Color of the History Chart** — **Edit Default Bar Color** apre il selettore **Default Bar Color**, il colore usato quando nessuna regola corrisponde.
- **Overall Uptime Percent** — **Edit Settings** apre l'interruttore **Show Overall Uptime Percent** e un menu a tendina **Select Uptime Precision**, che per impostazione predefinita è a due decimali (`99.99% (Two Decimal)`).

**Quanti giorni copre il grafico non si imposta qui.** Questo è **Show Uptime History (in days)** su **Status Pages → your page → Advanced → Advanced Settings** (`{id}/settings`), valido da 1 a 90.

## HTML, CSS e JavaScript personalizzati

**Status Pages → your page → Branding → HTML, CSS & JavaScript** (`{id}/custom-code`) ha quattro card modificabili indipendentemente, sostenute dalle colonne `headerHTML`, `footerHTML`, `customCSS` e `customJavaScript` sulla pagina di stato:

- **Header HTML** — segnaposto `Insert Custom HTML here.`, iniettato nell'intestazione della pagina.
- **Footer HTML** — lo stesso, per il footer.
- **Custom CSS** — segnaposto `Insert Custom CSS here.`
- **Custom JavaScript** — segnaposto `Insert Custom JavaScript here.`

**Non c'è alcun selettore di tema.** Le pagine di stato di OneUptime non hanno alcuna impostazione di tema o colore del marchio: gli unici controlli colore integrati ovunque sono **Default Bar Color** e le regole del colore delle barre del grafico della cronologia sulla schermata **Overview Page**. Font, colori di sfondo, colori d'accento e ritocchi di layout passano tutti attraverso **Custom CSS** qui. Se hai cercato un campo "colore del marchio", questa è la risposta — non esiste, e questa casella è la via d'uscita.

> Il JavaScript personalizzato viene eseguito nei browser dei tuoi visitatori su una pagina che le persone caricano proprio quando temono che qualcosa sia rotto. Mantienilo piccolo, ospitalo autonomamente dove puoi, e testalo prima di fare affidamento su di esso.

## Impostazioni della lingua

**Status Pages → your page → Branding → Languages** (`{id}/languages`) ha due card, ed entrambe riguardano il selettore di lingua che i visitatori trovano nel footer della pagina.

- **Default Language** — **Edit Default Language** apre un menu a tendina che elenca ogni lingua supportata con il nome nativo e il nome in inglese (`Deutsch (German)`). La card la descrive come la lingua che vedono i visitatori alla prima visita; i visitatori possono sempre cambiarla dal footer. Per impostazione predefinita è l'inglese.
- **Enabled Languages** — **Edit Enabled Languages** apre una selezione multipla, segnaposto `All languages`. Lasciala vuota e viene offerta ogni lingua supportata. Scegline alcune e il selettore del footer elenca solo quelle.

Sedici lingue sono incluse in OneUptime: inglese, tedesco, francese, spagnolo, italiano, portoghese, olandese, danese, norvegese, svedese, russo, giapponese, coreano, cinese (semplificato), cinese (tradizionale) e hindi.

## Domini personalizzati

Per impostazione predefinita una pagina di stato è raggiungibile all'URL di anteprima mostrato nella sua schermata **Overview**. Per metterla sul tuo hostname, vai su **Status Pages → your page → Branding → Custom Domains** (`{id}/domains`).

La card si intitola **Custom Domains** e la sua descrizione spiega direttamente il requisito: aggiungi il record CNAME della pagina di stato della tua installazione come CNAME per questi domini affinché funzioni. Senza nulla configurato la tabella recita "No custom domains found." La tabella ha due colonne, **Domain** e **Status**, e filtri per **Domain**, **CNAME Valid** e **SSL Provisioned**.

### Prima di iniziare

Due prerequisiti, e saltarne uno è il solito motivo per cui questo non funziona:

- **Il dominio genitore deve essere già verificato.** Il menu a tendina **Domain** elenca solo i domini verificati dalle impostazioni del progetto — il testo di aiuto del campo ti indirizza a **More → Project Settings → Custom Domains** per aggiungerne uno prima.
- **L'installazione deve avere un record CNAME della pagina di stato configurato.** Sulle installazioni self-hosted quella è la variabile d'ambiente `STATUS_PAGE_CNAME_RECORD` in Docker Compose, oppure `statusPage.cnameRecord` nel `values.yaml` di Helm. Senza di esso, sia la finestra modale **Add CNAME** che **Order Free SSL** mostrano un messaggio "Custom Domains not enabled for this OneUptime installation" invece delle istruzioni.

### Aggiungere il dominio

Fai clic su **Create Status Page Domain**. La finestra modale (**Create New Status Page Domain**) ha due passaggi:

**Basic**

- **Subdomain** — solo l'etichetta, segnaposto `status (leave blank for root)`. Inserisci solo `status`, non l'intero hostname. Lascialo vuoto o inserisci `@` per usare il dominio root/apex.
- **Domain** — un menu a tendina di domini verificati, segnaposto `Select domain`.

**More**

- **Upload Custom Certificate** — un interruttore, disattivo per impostazione predefinita. Lascialo disattivo e OneUptime ordina un certificato gratuito per te. Attivalo e ottieni i campi **Certificate** e **Certificate Private Key** per il tuo materiale PEM.

## Verificare il CNAME

Mentre il dominio non è verificato, la riga mostra un'azione **Add CNAME**. Apre una finestra modale intitolata **Add CNAME** che ti dà esattamente cosa incollare nel tuo provider DNS:

- **Record Type** — `CNAME`
- **Name** — il dominio completo che hai appena creato, per esempio `status.yourcompany.com`
- **Content** — il record CNAME della pagina di stato della tua installazione

La finestra modale nota che una volta che il record è a posto, la verifica automatica può richiedere fino a 24 ore. Non devi aspettare quello: il pulsante di invio della finestra modale è **Verify CNAME**, che controlla il record su richiesta.

Crea prima il record DNS, poi fai clic su **Verify CNAME**. Farlo prima che il record esista fallisce semplicemente.

## Ordinare un certificato SSL

Una volta che il CNAME è verificato — e solo se non hai caricato il tuo certificato — un'azione **Order Free SSL** appare sulla riga. La sua finestra modale, **Order Free SSL Certificate for this Status Page**, spiega che OneUptime usa LetsEncrypt, che il processo è sicuro e gratuito, e che il provisioning richiede alcune ore dopo che l'ordine è stato effettuato. Il pulsante di invio è **Order Free SSL**.

**I tempi dichiarati non concordano tra le schermate**, quindi non leggere troppo in nessun singolo numero: la finestra modale dell'ordine dice tre ore, la colonna **Status** dice un'ora, e un certificato personalizzato dice trenta minuti. Trattale tutte come "torna più tardi oggi", e contatta il supporto se non è successo nulla entro allora.

Una volta effettuato il provisioning, il rinnovo è automatico. Non c'è nulla di ricorrente da fare per te.

## Leggere la colonna Status del dominio

La colonna **Status** è l'intera macchina a stati della configurazione in una sola cella. Ogni messaggio ti dice o cosa fare dopo o che hai finito.

| Cosa dice la colonna Status                             | Cosa significa                                                                       |
| ----------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Action Required: Please add your CNAME record.              | Il CNAME non è ancora verificato. Aggiungi il record, poi **Verify CNAME**.               |
| Action Required: Please order SSL certificate.               | Il CNAME è verificato ma nessun certificato è stato ordinato. Fai clic su **Order Free SSL**. |
| No action is required, allow 30 minutes to provision.        | Hai caricato un certificato personalizzato ed è in fase di installazione.                 |
| No action is required, this will be provisioned soon.        | Il certificato gratuito è stato ordinato ed è in corso. Contatta il supporto se non arriva mai. |
| Certificate Provisioned. No action required.                 | Fatto. OneUptime rinnova il certificato automaticamente.                                  |

Se una riga rimane su "Action Required: Please add your CNAME record." molto dopo che hai creato la voce DNS, controlla che il nome del record sia il dominio completo e che il suo contenuto corrisponda esattamente al record CNAME della tua installazione.

## Powered by OneUptime

La riga "Powered by OneUptime" non è un'impostazione della sezione branding. Vive su **Status Pages → your page → Advanced → Advanced Settings** (`{id}/settings`), nella card **Powered By OneUptime Branding**, come un unico interruttore: **Hide Powered By OneUptime Branding**. **Edit Settings** lo apre, come ogni altra card di quella pagina.

## Dove leggere dopo

- [Status Pages Overview](/docs/status-pages/index) — cos'è una pagina di stato e come si incastrano i pezzi.
- [Risorse e gruppi della pagina di stato](/docs/status-pages/resources-and-groups) — scegliere cosa vedono davvero i visitatori sulla pagina.
- [Iscritti e annunci](/docs/status-pages/subscribers) — iscritti email, SMS, Slack e webhook, più annunci.
- [Public API](/docs/status-pages/public-api) — leggere programmaticamente i dati della pagina di stato.
- [Stati e gravità degli incidenti](/docs/incidents/states-and-severities) — cosa fa apparire, e scomparire, un incidente dalla pagina.
