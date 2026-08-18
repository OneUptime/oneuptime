# Panoramica delle pagine di stato

Una pagina di stato è il volto pubblico di tutto ciò che monitorate: un unico URL che i vostri clienti possono aprire invece di scrivervi via email per chiedere se il problema è solo loro. Mostra lo stato attuale dei servizi che scegliete di esporre, gli incidenti su cui state lavorando, la manutenzione pianificata e qualsiasi annuncio vogliate fissare in cima.

Quando qualcosa si rompe alle 2 del mattino, la pagina di stato è la prima cosa a cui la vostra coda di supporto rimanda. È anche ciò da cui i vostri iscritti ricevono le notifiche — quindi vale la pena configurarla prima che ne abbiate bisogno, non durante l'interruzione.

Le pagine di stato risiedono sotto **Status Pages** nella navigazione a sinistra della dashboard, nel gruppo **essentials**. Tutto in questa pagina è per singola pagina di stato: un progetto può gestirne quante ne vuole — una pubblica per i clienti, una privata per un pubblico interno, una per regione per un mercato specifico.

## In breve

- **Creata con due campi.** Una nuova pagina di stato richiede solo **Name** e **Description**. Risorse, branding e domini sono tutti configurati in seguito.
- **Le risorse sono ciò che i visitatori vedono.** Ogni riga della pagina è una **Status Page Resource** — un monitor (o gruppo di monitor) con il proprio nome visualizzato, tooltip e opzioni di uptime. I gruppi suddividono una pagina lunga in sezioni e possono essere annidati.
- **Un URL di anteprima fin dal primo giorno.** Ogni pagina di stato ottiene un link di anteprima così potete guardarla prima che esista un dominio personalizzato.
- **Le rotte rivolte ai visitatori sono controllate dalle impostazioni.** Incidenti, annunci, eventi programmati e la pagina di iscrizione compaiono ciascuno solo quando il relativo interruttore su **Advanced Settings** è attivo.
- **Tre modi per renderla privata.** Utenti privati, una password principale, oppure SAML SSO / OIDC — più una whitelist IP.
- **Gli iscritti vengono avvisati automaticamente.** Iscritti via email, SMS, Slack, Microsoft Teams e webhook possono tutti seguire una pagina, ciascun canale dietro il proprio interruttore.

## Termini chiave

| Termine              | Cosa significa                                                                                                                       |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| **Status page**   | Una pagina pubblica (o privata), con proprio branding, domini, risorse e iscritti. Il modello `StatusPage`.                    |
| **Resource**      | Una riga che i visitatori vedono — un monitor o un gruppo di monitor mostrato sulla pagina con un nome visualizzato e opzioni di uptime.                      |
| **Group**         | Una sezione con nome che contiene risorse. I gruppi si annidano dentro altri gruppi, e ogni livello riassume lo stato di tutto ciò che sta sotto. |
| **Announcement**  | Un messaggio che pubblicate su una o più pagine di stato, con un'ora di inizio e una di fine opzionale.                                         |
| **Subscriber**    | Qualcuno (o qualcosa) che segue la pagina via email, SMS, Slack, Microsoft Teams o un webhook.                                         |
| **Custom domain** | Un dominio vostro — `status.example.com` — puntato alla pagina con un CNAME e un certificato SSL.                                 |
| **Private user**  | Un account che può accedere a una pagina di stato privata. Separato dagli utenti del vostro progetto OneUptime.                                    |

## Creare una pagina di stato

1. Aprite **Status Pages → All Status Pages** e fate clic su **Create Status Page**.
2. Nella finestra modale **Create New Status Page**, compilate **Name** (obbligatorio, almeno due caratteri) e, facoltativamente, **Description**.
3. Fate clic su **Create Status Page**.

Questo è l'intero modulo di creazione. L'elenco su cui tornate mostra **Name**, **Description**, **Labels** e **Owners**, e può essere filtrato per **Status Page ID**, **Name** e **Description**.

Aprite la nuova pagina e arriverete alla sua schermata **Overview**, che porta due schede: **Status Page Preview URL** con un link alla pagina stessa, e **Status Page Details** dove potete modificare il nome, la descrizione e le etichette appena impostate.

Successivamente, in ordine approssimativo di utilità:

- Aggiungete risorse così che la pagina abbia qualcosa sopra — vedete [Risorse e gruppi della pagina di stato](/docs/status-pages/resources-and-groups).
- Impostate il titolo della pagina, favicon, logo e copertina, quindi collegate un dominio personalizzato — vedete [Branding e domini della pagina di stato](/docs/status-pages/branding-and-domains).
- Decidete su quali canali le persone possono iscriversi — vedete [Iscritti e annunci](/docs/status-pages/subscribers).
- Regolate cosa compare sulla pagina in **Advanced Settings**.

## Dove risiede tutto

Una volta aperta una pagina di stato, il suo menu laterale sinistro è raggruppato in nove sezioni. Usatelo come mappa per il resto di questo gruppo di documentazione.

| Sezione               | Cosa contiene                                                                                                                                   |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| **Basic**             | **Overview**, **Announcements**, **Owners**.                                                                                                   |
| **Resources**         | Un'unica schermata **Resources** — i gruppi a sinistra, i monitor del gruppo selezionato a destra.                                                |
| **Subscribers**       | **Email Subscribers**, **SMS Subscribers**, **Slack Subscribers**, **MS Teams Subscribers**, **Webhook Subscribers**, **Subscriber Settings**. |
| **Notification Logs** | **Notification Logs** — cosa è stato inviato agli iscritti.                                                                                          |
| **Audit**             | **Audit Logs**.                                                                                                                                |
| **Branding**          | **Essential Branding**, **HTML, CSS & JavaScript**, **Custom Domains**, **Header**, **Footer**, **Overview Page**, **Languages**.              |
| **Security**          | **Private Users**, **SSO**, **OIDC**, **SCIM**, **Authentication Settings**.                                                                   |
| **AI**                | **MCP**.                                                                                                                                       |
| **Advanced**          | **Monitor Rules**, **Embedded Status**, **Reports**, **Custom Fields**, **Advanced Settings**, **Delete Status Page**.                         |

Due particolarità di denominazione da conoscere prima di andare a cercare:

- L'elemento **Resources** si chiama **Resources** solo quando il progetto ha i gruppi di monitor abilitati. Altrimenti si legge **Monitors**. È la stessa schermata in entrambi i casi.
- Non esiste una pagina Groups separata. Gruppi e risorse sono stati uniti, e la vecchia rotta `/groups` ora reindirizza alla schermata delle risorse.

Al di fuori di una singola pagina, la sezione **Status Pages** stessa ha una sezione **More** con **Announcements**, e una sezione **Settings** compressa che contiene **Announcement Templates**, **Subscriber Templates**, **Custom Fields**, **Owner Rules** e **Label Rules** — questi sono a livello di progetto, condivisi tra tutte le pagine di stato.

## Cosa vedono i visitatori

La pagina pubblica è un'app a sé, con un piccolo insieme di rotte:

- `/` — la **Overview**.
- `/incidents` e `/incidents/:id` — l'elenco degli incidenti e un singolo incidente.
- `/announcements` e `/announcements/:id`.
- `/scheduled-events` e `/scheduled-events/:id`.
- `/subscribe/email`, `/subscribe/sms`, `/subscribe/slack`, `/subscribe/microsoft-teams`, `/subscribe/webhooks`.
- `/rss` — il feed.
- `/login`, `/sso` e `/master-password` — rilevanti solo su una pagina privata.

La barra di navigazione superiore mostra sempre **Overview**; il resto compare solo quando abilitato. **Incidents**, **Announcements** e **Scheduled Events** richiedono ciascuno il proprio interruttore attivo; **Subscribe** richiede sia **Show Subscriber Page** sia almeno un canale iscritti abilitato. Una pagina privata ottiene anche un elemento **Logout**.

### La pagina overview

L'overview è la pagina che la maggior parte dei visitatori vede mai. Dall'alto in basso rende:

1. **Eventuali annunci attivi** — annunci la cui ora di inizio è passata e la cui ora di fine non è ancora arrivata.
2. **Un banner di stato complessivo** — una singola riga che riassume se tutte o solo alcune risorse sono interessate.
3. **Una percentuale di uptime complessiva**, se l'avete attivata. Disattivata per impostazione predefinita.
4. **I gruppi di risorse**, ciascuno con le proprie risorse, il loro stato attuale e le barre della cronologia di uptime.
5. **Active Incidents**.
6. **Scheduled Maintenance Events**.

Una pagina nuova di zecca senza nulla sopra mostra uno stato vuoto che vi dice di aggiungere risorse dalla dashboard — che è il vostro segnale per dirigervi verso la schermata **Resources**.

Per cosa mette un incidente su questa pagina in primo luogo, e cosa lo rimuove di nuovo, vedete [Stati e gravità degli incidenti](/docs/incidents/states-and-severities).

## Scegliere cosa mostrare sulla pagina

La maggior parte degli interruttori di visualizzazione risiede in un unico posto: **Status Pages → your page → Advanced → Advanced Settings**. Ogni scheda ha il proprio pulsante **Edit Settings**.

**Incident Settings**:

- **Show Incidents** (`showIncidentsOnStatusPage`) — attivo per impostazione predefinita. Disattivarlo rimuove anche l'elemento di navigazione **Incidents**.
- **Show Incident History (in days)** (`showIncidentHistoryInDays`) — quanto indietro arriva l'elenco degli incidenti. Predefinito 14.
- **Show Incident Labels** (`showIncidentLabelsOnStatusPage`) — disattivato per impostazione predefinita.

**Episode Settings** — gli stessi tre interruttori per gli episodi di incidente: **Show Episodes** (`showEpisodesOnStatusPage`, attivo per impostazione predefinita), **Show Episode History (in days)** (predefinito 14), e **Show Episode Labels** (disattivato per impostazione predefinita). Gli episodi sono un modello a sé con propri endpoint, non una vista degli incidenti.

**Announcement Settings**:

- **Show Announcements** (`showAnnouncementsOnStatusPage`) — attivo per impostazione predefinita.
- **Show Announcement History (in days)** (`showAnnouncementHistoryInDays`) — predefinito 14.

**Scheduled Event Settings**:

- **Show Scheduled Maintenance Events** (`showScheduledMaintenanceEventsOnStatusPage`) — attivo per impostazione predefinita.
- **Show Scheduled Event History (in days)** (`showScheduledEventHistoryInDays`) — predefinito 14.
- **Show Event Labels** (`showScheduledEventLabelsOnStatusPage`) — disattivato per impostazione predefinita.

**Uptime History Settings**:

- **Show Uptime History (in days)** (`showUptimeHistoryInDays`) — la lunghezza della barra di uptime accanto a ogni risorsa. Predefinito 90 e deve essere compreso tra 1 e 90. Ogni opzione **Show Uptime %** e **Show Status History Chart** su una risorsa o un gruppo legge questo numero.

**Subscriber Settings**:

- **Show Subscriber Page** (`showSubscriberPageOnStatusPage`) — attivo per impostazione predefinita, più i cinque interruttori di abilitazione per canale. Gli stessi interruttori di canale compaiono anche sulla schermata dedicata **Subscriber Settings** nella sezione **Subscribers**; trattate quella come il luogo canonico per impostarli.

**Powered By OneUptime Branding**:

- **Hide Powered By OneUptime Branding** — disattivato per impostazione predefinita, così il piè di pagina visitatori legge "Powered by OneUptime" finché non attivate questa opzione.

**Dove sono i colori.** I colori della barra di uptime non sono qui — **Default Bar Color**, le regole colore barra, **Downtime Monitor Statuses** e **Show Overall Uptime Percent** risiedono tutti su **Status Pages → your page → Branding → Overview Page**. Non esiste alcuna impostazione di tema o colore del brand da nessuna parte; qualsiasi cosa oltre a questi controlli si fa con **Custom CSS**.

## Anteprima prima di andare in produzione

La schermata **Overview** di ogni pagina di stato porta una scheda **Status Page Preview URL** con un link diretto alla pagina. Usatela mentre state ancora aggiungendo risorse e prima che esista un dominio personalizzato.

Dietro le quinte, ogni rotta pubblica ha un gemello di anteprima sotto `/status-page/{statusPageId}/...` — un'overview di anteprima, un elenco incidenti di anteprima, una pagina di iscrizione di anteprima, e così via. Questo significa che un URL o uno screenshot presi dall'anteprima della dashboard non corrisponderanno a ciò che vede un cliente una volta collegato un dominio personalizzato, quindi verificate due volte qualsiasi link incolliate in un runbook o in un'email.

## Limitare chi può vedere la pagina

Non ogni pagina di stato è per il pubblico. Tutti i controlli si trovano nella sezione **Security**.

### Utenti privati

Disattivate **Is Visible to Public** su **Status Pages → your page → Security → Authentication Settings** (la colonna `isPublicStatusPage`). I visitatori atterrano quindi su `/login` e devono accedere.

Aggiungete le persone che possono accedere su **Status Pages → your page → Security → Private Users**. C'è un'azione **Add in Bulk** — incollate un elenco di indirizzi email e ciascuno riceve un'email di invito. Gli utenti privati hanno il proprio flusso di password dimenticata e reimpostazione password, separato dagli account del vostro progetto OneUptime.

### Password principale

**Authentication Settings** ha anche una scheda **Master Password** con un interruttore **Require Master Password** e la password stessa. I visitatori raggiungono quindi `/master-password` e sbloccano la pagina con un unico segreto condiviso.

**Password principale e utenti privati non si combinano.** Mentre la password principale è attiva, l'autenticazione degli utenti privati è disabilitata, e la schermata **Private Users** mostra un banner che ve lo comunica.

### SSO e OIDC

Per una pagina privata collegata al vostro identity provider, **Status Pages → your page → Security → SSO** configura SAML (URL di accesso, issuer, certificato x509, metodi di firma e digest) e **Status Pages → your page → Security → OIDC** configura OpenID Connect (URL di discovery, issuer, ID e secret del client, scope, nomi delle claim). **SCIM** effettua il provisioning degli utenti privati dall'IdP automaticamente. Questi sono limitati da una funzionalità di piano, quindi potrebbero non essere disponibili su ogni installazione.

Una scheda **SSO Settings** espone **Force SSO for Login** (`requireSsoForLogin`, disattivato per impostazione predefinita). Testate la vostra configurazione SSO prima di attivarla — se non funziona vi bloccherete fuori dalla pagina di stato.

### Whitelist IP

**Authentication Settings** porta anche una scheda **IP Whitelist**, sostenuta dalla colonna `ipWhitelist`, per le pagine che dovrebbero rispondere solo da reti conosciute.

## Il badge integrabile e il feed RSS

Due modi per mostrare lo stato altrove rispetto alla pagina stessa.

**Badge di stato integrato.** Attivate **Enable Embedded Status Badge** (`enableEmbeddedOverallStatus`, disattivato per impostazione predefinita) nella scheda **Embedded Status Badge** su **Status Pages → your page → Advanced → Embedded Status**. Si accoppia con un `embeddedOverallStatusToken` e serve il badge da `/badge/:statusPageId`, così potete inserire lo stato complessivo attuale nella vostra documentazione, nel piè di pagina della vostra app o in una pagina marketing.

**Feed RSS.** Ogni pagina di stato serve `/rss` — un feed intitolato "{status page name} Updates" i cui elementi sono preceduti da `Incident: `, `Announcement: ` e `Scheduled Maintenance: `. Utile per chi preferisce incanalare i vostri aggiornamenti in un lettore RSS o in un chat bot piuttosto che iscriversi via email.

Se preferite recuperare i dati voi stessi, la pagina di stato è sostenuta da endpoint di lettura pubblici per l'overview, gli incidenti, gli eventi di manutenzione programmata, gli annunci e gli episodi — vedete [API pubblica](/docs/status-pages/public-api).

## Dove leggere ora

- [Risorse e gruppi della pagina di stato](/docs/status-pages/resources-and-groups) — mettere monitor sulla pagina e organizzarli in sezioni.
- [Branding e domini della pagina di stato](/docs/status-pages/branding-and-domains) — logo, favicon, piè di pagina, codice personalizzato, e collegare il vostro dominio alla pagina.
- [Iscritti e annunci](/docs/status-pages/subscribers) — i cinque canali iscritti, il doppio opt-in, e la pubblicazione di annunci.
- [API pubblica](/docs/status-pages/public-api) — leggere i dati della pagina di stato in modo programmatico.
- [Panoramica degli incidenti](/docs/incidents/index) — gli eventi che compaiono sulla pagina.
- [Stati e gravità degli incidenti](/docs/incidents/states-and-severities) — cosa fa comparire un incidente su una pagina di stato e cosa lo rimuove.
