# Panoramica delle pagine di stato

Una pagina di stato è il volto pubblico di tutto ciò che monitori: un unico URL che i tuoi clienti possono aprire invece di scriverti per chiedere se il problema è solo loro. Mostra lo stato attuale dei servizi che scegli di esporre, gli incidenti su cui stai lavorando, la manutenzione che hai in programma e qualunque annuncio tu voglia tenere fissato in cima.

Quando qualcosa si rompe alle 2 di notte, la pagina di stato è la prima cosa che il tuo supporto mette in un link. Ed è anche ciò da cui partono le notifiche ai tuoi iscritti — quindi conviene prepararla prima di averne bisogno, non durante il disservizio.

Le pagine di stato stanno sotto **Pagine di stato** nella navigazione a sinistra della dashboard, nel gruppo **essentials**. Tutto ciò che trovi qui vale per la singola pagina: un progetto può gestirne quante ne vuole — una pubblica per i clienti, una privata per un pubblico interno, una per regione dedicata a un mercato specifico.

## In sintesi

- **Si crea con due campi.** Una nuova pagina di stato chiede solo **Nome** e **Descrizione**. Risorse, branding e domini si configurano dopo.
- **Le risorse sono ciò che i visitatori vedono.** Ogni riga della pagina è una **Pagina di stato Risorsa** — un monitor (o un gruppo di monitor) con un proprio nome visualizzato, un tooltip e le sue opzioni di uptime. I gruppi dividono una pagina lunga in sezioni e possono essere annidati.
- **Un URL di anteprima fin dal primo giorno.** Ogni pagina di stato riceve un link di anteprima, così puoi guardarla prima ancora che esista un dominio personalizzato.
- **Le pagine visibili ai visitatori dipendono dalle impostazioni.** Incidenti, annunci, eventi pianificati e la pagina di iscrizione compaiono solo quando il relativo interruttore in **Impostazioni avanzate** è attivo.
- **Tre modi per renderla privata.** Utenti privati, una password principale, oppure SAML SSO / OIDC — più una whitelist IP.
- **Gli iscritti vengono avvisati da soli.** Possono seguire una pagina iscritti via email, SMS, Slack, Microsoft Teams e webhook, ciascun canale dietro il proprio interruttore.

## Termini chiave

| Termine              | Che cosa significa                                                                                                                       |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| **Pagina di stato**   | Una singola pagina, pubblica o privata, con il proprio branding, i propri domini, le proprie risorse e i propri iscritti. Il modello `StatusPage`.                    |
| **Risorsa**      | Una riga che i visitatori vedono — un monitor o un gruppo di monitor portato sulla pagina con un nome visualizzato e opzioni di uptime.                      |
| **Gruppo**         | Una sezione con un nome che contiene risorse. I gruppi si annidano dentro altri gruppi, e ogni livello riassume lo stato di tutto ciò che sta sotto. |
| **Annuncio**  | Un messaggio che pubblichi su una o più pagine di stato, con un'ora di inizio e un'ora di fine facoltativa.                                         |
| **Iscritto**    | Qualcuno (o qualcosa) che segue la pagina via email, SMS, Slack, Microsoft Teams o webhook.                                     |
| **Dominio personalizzato** | Un dominio tuo — `status.example.com` — puntato sulla pagina con un CNAME e un certificato SSL.                                 |
| **Utente privato**  | Un account che può accedere a una pagina di stato privata. È separato dagli utenti del tuo progetto OneUptime.                                    |

## Creare una pagina di stato

1. Apri **Pagine di stato → Tutte le pagine di stato** e clicca **Crea pagina di stato**.
2. Nella finestra **Create New Status Page**, compila **Nome** (obbligatorio, almeno due caratteri) e, facoltativamente, **Descrizione**.
3. Clicca **Crea pagina di stato**.

Il modulo di creazione è tutto qui. L'elenco su cui torni mostra **Nome**, **Descrizione**, **Etichette** e **Proprietari**, e si può filtrare per **ID della pagina di stato**, **Nome** e **Descrizione**.

Apri la nuova pagina e atterri sulla sua schermata **Panoramica**, che porta due schede: **Status Page Preview URL**, con un link alla pagina vera e propria, e **Dettagli della pagina di stato**, dove puoi modificare nome, descrizione ed etichette appena impostati.

Poi, più o meno in ordine di utilità:

- Aggiungi risorse, così la pagina ha qualcosa sopra — vedi [Risorse e gruppi della pagina di stato](/docs/status-pages/resources-and-groups).
- Imposta titolo, favicon, logo e copertina della pagina, poi collega un dominio personalizzato — vedi [Branding e domini della pagina di stato](/docs/status-pages/branding-and-domains).
- Decidi su quali canali le persone possono iscriversi — vedi [Iscritti e annunci](/docs/status-pages/subscribers).
- Regola che cosa compare sulla pagina da **Impostazioni avanzate**.

## Dove si trova ogni cosa

Una volta aperta una pagina di stato, il suo menu laterale è diviso in nove sezioni. Usa questa mappa come guida al resto di questo gruppo di documentazione.

| Sezione               | Che cosa contiene                                                                                                                                   |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| **Base**             | **Panoramica**, **Annunci**, **Proprietari**.                                                                                                   |
| **Risorse**         | Un'unica schermata **Risorse** — i gruppi a sinistra, i monitor del gruppo selezionato a destra.                                                |
| **Iscritti**       | **Iscritti email**, **Iscritti SMS**, **Iscritti Slack**, **Iscritti MS Teams**, **Iscritti webhook**, **Impostazioni iscritti**. |
| **Registri di notifica** | **Registri di notifica** — che cosa è stato inviato agli iscritti.                                                                                          |
| **Audit**             | **Registri di audit**.                                                                                                                                |
| **Branding**          | **Branding essenziale**, **HTML, CSS e JavaScript**, **Domini personalizzati**, **Intestazione**, **Piè di pagina**, **Pagina di panoramica**, **Lingue**.              |
| **Sicurezza**           | **Utenti privati**, **SSO**, **OIDC**, **SCIM**, **Impostazioni di autenticazione**.                                                                                   |
| **IA**                | **MCP**.                                                                                                                                       |
| **Avanzato**          | **Monitor Rules**, **Stato incorporato**, **Report**, **Campi personalizzati**, **Impostazioni avanzate**, **Elimina pagina di stato**.                         |

Due stranezze di denominazione da conoscere prima di andare a cercare:

- La voce **Risorse** si chiama **Risorse** solo quando il progetto ha i gruppi di monitor abilitati. Altrimenti si legge **Monitor**. In entrambi i casi è la stessa schermata.
- Non esiste una pagina Gruppi separata. Gruppi e risorse sono stati unificati, e il vecchio percorso `/groups` ora reindirizza alla schermata delle risorse.

Fuori dalla singola pagina, la sezione **Pagine di stato** ha a sua volta una sezione **Altro** con **Annunci**, e una sezione **Impostazioni** compressa che contiene **Modelli di annunci**, **Modelli iscritti**, **Campi personalizzati**, **Regole del proprietario** e **Regole etichette** — queste valgono per l'intero progetto e sono condivise da tutte le pagine di stato.

## Che cosa vedono i visitatori

La pagina pubblica è un'applicazione a sé, con un piccolo insieme di percorsi:

- `/` — la **Panoramica**.
- `/incidents` e `/incidents/:id` — l'elenco degli incidenti e il singolo incidente.
- `/announcements` e `/announcements/:id`.
- `/scheduled-events` e `/scheduled-events/:id`.
- `/subscribe/email`, `/subscribe/sms`, `/subscribe/slack`, `/subscribe/microsoft-teams`, `/subscribe/webhooks`.
- `/rss` — il feed.
- `/login`, `/sso` e `/master-password` — rilevanti solo su una pagina privata.

La barra di navigazione in alto mostra sempre **Panoramica**; il resto compare solo quando è abilitato. **Incidenti**, **Annunci** e **Eventi pianificati** hanno ciascuno bisogno del proprio interruttore; **Iscriviti** richiede sia **Mostra pagina iscritti** sia almeno un canale di iscrizione abilitato. Una pagina privata guadagna anche una voce **Esci**.

### La pagina di panoramica

La panoramica è la pagina che la maggior parte dei visitatori vede. Dall'alto verso il basso mostra:

1. **Gli annunci attivi** — quelli la cui ora di inizio è passata e la cui ora di fine non è ancora arrivata.
2. **Un banner di stato complessivo** — una riga che riassume se sono coinvolte tutte le risorse o solo alcune.
3. **Una percentuale di uptime complessiva**, se l'hai attivata. Disattivata per impostazione predefinita.
4. **I gruppi di risorse**, ciascuno con le sue risorse, il loro stato attuale e le barre della cronologia di uptime.
5. **Incidenti attivi**.
6. **Eventi di manutenzione pianificata**.

Una pagina appena creata e ancora vuota mostra uno stato vuoto che ti invita ad aggiungere risorse dalla dashboard — che è il tuo segnale per andare alla schermata **Risorse**.

Per capire che cosa porta un incidente su questa pagina e che cosa lo toglie, vedi [Stati e gravità degli incidenti](/docs/incidents/states-and-severities).

## Scegliere che cosa compare sulla pagina

Quasi tutti gli interruttori di visualizzazione stanno nello stesso posto: **Pagine di stato → la tua pagina → Avanzato → Impostazioni avanzate**. Ogni scheda ha il proprio pulsante **Edit Settings**.

**Impostazioni incidente**:

- **Mostra incidenti** (`showIncidentsOnStatusPage`) — attivo per impostazione predefinita. Disattivarlo rimuove anche la voce di navigazione **Incidenti**.
- **Mostra cronologia incidenti (in giorni)** (`showIncidentHistoryInDays`) — quanto indietro arriva l'elenco degli incidenti. Predefinito: 14.
- **Mostra etichette degli incidenti** (`showIncidentLabelsOnStatusPage`) — disattivo per impostazione predefinita.

**Impostazioni episodio** — gli stessi tre interruttori per gli episodi di incidente: **Mostra episodi** (`showEpisodesOnStatusPage`, attivo per impostazione predefinita), **Mostra cronologia episodi (in giorni)** (predefinito 14) e **Mostra etichette degli episodi** (disattivo per impostazione predefinita). Gli episodi sono un modello a sé con i propri endpoint, non una vista sugli incidenti.

**Impostazioni annuncio**:

- **Mostra annunci** (`showAnnouncementsOnStatusPage`) — attivo per impostazione predefinita.
- **Mostra cronologia annunci (in giorni)** (`showAnnouncementHistoryInDays`) — predefinito 14.

**Impostazioni evento pianificato**:

- **Mostra eventi di manutenzione programmata** (`showScheduledMaintenanceEventsOnStatusPage`) — attivo per impostazione predefinita.
- **Mostra cronologia eventi programmati (in giorni)** (`showScheduledEventHistoryInDays`) — predefinito 14.
- **Mostra etichette degli eventi** (`showScheduledEventLabelsOnStatusPage`) — disattivo per impostazione predefinita.

**Impostazioni cronologia di disponibilità**:

- **Mostra cronologia uptime (in giorni)** (`showUptimeHistoryInDays`) — la lunghezza della barra di uptime accanto a ogni risorsa. Predefinito 90, e deve stare tra 1 e 90. Ogni opzione **Mostra % di uptime** e **Mostra grafico cronologia stato** su una risorsa o un gruppo legge questo numero.

**Impostazioni iscritti**:

- **Mostra pagina iscritti** (`showSubscriberPageOnStatusPage`) — attivo per impostazione predefinita, insieme ai cinque interruttori dei singoli canali. Gli stessi interruttori compaiono anche nella schermata dedicata **Impostazioni iscritti**, sotto la sezione **Iscritti**; considera quella il posto giusto dove impostarli.

**Branding "Powered By OneUptime"**:

- **Nascondi il marchio Powered By OneUptime** — disattivo per impostazione predefinita, quindi il piè di pagina che i visitatori vedono riporta "Offerto da OneUptime" finché non lo attivi.

**Dove stanno i colori.** I colori della barra di uptime non sono qui — il **Colore predefinito della barra**, le regole sui colori delle barre, gli **Stati del monitor per i tempi di inattività** e **Mostra percentuale di uptime complessiva** stanno tutti in **Pagine di stato → la tua pagina → Branding → Pagina di panoramica**. Non esiste da nessuna parte un'impostazione di tema o di colore del marchio; tutto ciò che va oltre quei controlli si fa con il **CSS personalizzato**.

## Vedere l'anteprima prima di andare in produzione

La schermata **Panoramica** di ogni pagina di stato porta una scheda **Status Page Preview URL** con un link diretto alla pagina. Usala mentre stai ancora aggiungendo risorse e prima che esista un dominio personalizzato.

Dietro le quinte, ogni percorso pubblico ha un gemello di anteprima sotto `/status-page/{statusPageId}/...` — una panoramica di anteprima, un elenco incidenti di anteprima, una pagina di iscrizione di anteprima e così via. Questo significa che un URL o uno screenshot presi dall'anteprima nella dashboard non corrisponderanno a quello che vede un cliente una volta collegato un dominio personalizzato: ricontrolla ogni link che incolli in un runbook o in un'email.

## Limitare chi può vedere la pagina

Non tutte le pagine di stato sono per il pubblico. I controlli stanno tutti nella sezione **Sicurezza**.

### Utenti privati

Disattiva **È visibile al pubblico** in **Pagine di stato → la tua pagina → Sicurezza → Impostazioni di autenticazione** (la colonna `isPublicStatusPage`). I visitatori atterrano allora su `/login` e devono accedere.

Aggiungi le persone che possono accedere in **Pagine di stato → la tua pagina → Sicurezza → Utenti privati**. C'è un'azione **Aggiungi in blocco** — incolli un elenco di indirizzi email e ciascuno riceve un invito. Gli utenti privati hanno un proprio flusso di password dimenticata e reimpostazione, separato dagli account del tuo progetto OneUptime.

### Password principale

**Impostazioni di autenticazione** ha anche una scheda **Password principale** con un interruttore **Richiedi password principale** e la password stessa. I visitatori finiscono su `/master-password` e sbloccano la pagina con un unico segreto condiviso.

**Password principale e utenti privati non si sommano.** Finché la password principale è attiva, l'autenticazione degli utenti privati è disabilitata, e la schermata **Utenti privati** mostra un banner che te lo dice.

### SSO e OIDC

Per una pagina privata legata al tuo provider di identità, **Pagine di stato → la tua pagina → Sicurezza → SSO** configura SAML (URL di accesso, issuer, certificato x509, metodi di firma e di digest) e **Pagine di stato → la tua pagina → Sicurezza → OIDC** configura OpenID Connect (URL di discovery, issuer, client ID e secret, scope, nomi dei claim). **SCIM** fa il provisioning automatico degli utenti privati dall'IdP. Queste funzioni dipendono dal piano, quindi potrebbero non essere disponibili in ogni installazione.

Una scheda **Impostazioni SSO** espone **Forza SSO per l'accesso** (`requireSsoForLogin`, disattivo per impostazione predefinita). Testa la configurazione SSO prima di attivarlo — se non funziona ti chiudi fuori dalla tua stessa pagina di stato.

### Whitelist IP

**Impostazioni di autenticazione** porta anche una scheda **Whitelist IP**, basata sulla colonna `ipWhitelist`, per le pagine che devono rispondere solo a reti conosciute.

## Il badge incorporabile e il feed RSS

Due modi per mostrare lo stato altrove, fuori dalla pagina stessa.

**Badge di stato incorporato.** Attiva **Abilita badge di stato incorporato** (`enableEmbeddedOverallStatus`, disattivo per impostazione predefinita) nella scheda **Badge di stato incorporato** in **Pagine di stato → la tua pagina → Avanzato → Stato incorporato**. Si accompagna a un `embeddedOverallStatusToken` e serve il badge da `/badge/:statusPageId`, così puoi infilare lo stato complessivo attuale nella tua documentazione, nel piè di pagina della tua applicazione o in una pagina di marketing.

**Feed RSS.** Ogni pagina di stato serve `/rss` — un feed intitolato "{nome della pagina di stato} Updates" i cui elementi sono preceduti da `Incident: `, `Announcement: ` e `Scheduled Maintenance: `. Comodo per chi preferisce far confluire i tuoi aggiornamenti in un lettore di feed o in un bot di chat invece di iscriversi via email.

Se preferisci recuperare i dati da solo, la pagina di stato è servita da endpoint pubblici di sola lettura per panoramica, incidenti, eventi di manutenzione pianificata, annunci ed episodi — vedi [API pubblica](/docs/status-pages/public-api).

## Dove leggere ora

- [Risorse e gruppi della pagina di stato](/docs/status-pages/resources-and-groups) — portare i monitor sulla pagina e organizzarli in sezioni.
- [Branding e domini della pagina di stato](/docs/status-pages/branding-and-domains) — logo, favicon, piè di pagina, codice personalizzato e come puntare il tuo dominio sulla pagina.
- [Iscritti e annunci](/docs/status-pages/subscribers) — i cinque canali di iscrizione, la doppia conferma e la pubblicazione degli annunci.
- [API pubblica](/docs/status-pages/public-api) — leggere i dati della pagina di stato in modo programmatico.
- [Panoramica degli incidenti](/docs/incidents/index) — gli eventi che compaiono sulla pagina.
- [Stati e gravità degli incidenti](/docs/incidents/states-and-severities) — che cosa fa comparire un incidente su una pagina di stato e che cosa lo toglie.
