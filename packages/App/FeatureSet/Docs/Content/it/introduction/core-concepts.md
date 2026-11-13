# Concetti fondamentali

OneUptime ha molti prodotti, ma poggiano su una manciata di idee: progetti, monitor, incidenti e avvisi, reperibilità, pagine di stato e telemetria. Intorno a esse ci sono ciò che tieni sotto controllo, ciò che installi e le regole che agiscono per te. Questa pagina spiega ciascuna in poche frasi, mostra come si collegano e rimanda alle pagine che le trattano per esteso. Leggila una volta, e tutte le altre pagine della documentazione si leggeranno più facilmente. Per una parola alla volta, vedi il [Glossario](/docs/introduction/glossary); per scegliere tra due cose che si somigliano, vedi [Quale usare?](/docs/introduction/which-one).

:::cards
- [Progetti e persone](#progetti-e-persone): Dove vive tutto, e chi può fare cosa.
- [Monitor e sonde](#monitor-e-sonde): Come OneUptime si accorge che qualcosa non va.
- [Incidenti e avvisi](#incidenti-e-avvisi): Il record su cui lavora il tuo team.
- [Reperibilità](#reperibilità): Chi viene avvisato, come, e chi viene dopo.
:::

## Come si collegano i pezzi

Un problema attraversa OneUptime in una sola direzione. Le sonde e la tua telemetria alimentano i monitor. I criteri di un monitor decidono quando qualcosa non va e cosa aprire: un incidente, un avviso o entrambi. Le policy di reperibilità avvisano le persone, e le pagine di stato informano i tuoi clienti degli incidenti.

```mermaid title="Come un problema attraversa OneUptime"
flowchart TB
    probes["Le sonde controllano"] --> monitors["Monitor"]
    telemetry["Applicazioni e agenti<br/>inviano telemetria"] --> monitors
    monitors -->|"dichiara"| incident["Incidente"]
    monitors -->|"crea"| alert["Avviso"]
    incident --> policy["Policy di reperibilità"]
    alert --> policy
    incident --> statuspage["Pagina di stato"]
    policy --> person["Chi è reperibile"]
    statuspage --> subscribers["Iscritti"]
```

## Progetti e persone

Un **progetto** contiene tutto: monitor, incidenti, policy di reperibilità, pagine di stato, telemetria e impostazioni. Alla maggior parte delle aziende ne basta uno, alcune ne tengono uno per ambiente o per unità di business. Niente di ciò che crei in un progetto è visibile in un altro.

Il tuo **account** è separato dai tuoi progetti. Un account, con un'e-mail e una password, può appartenere a quanti progetti vuoi; passa dall'uno all'altro con il selettore di progetti in alto a sinistra. Vedi [Il tuo account](/docs/introduction/your-account).

Le persone fanno parte di un progetto tramite i **team**, e le autorizzazioni di un team decidono cosa possono fare i suoi membri. Ogni nuovo progetto parte con tre team: Owners, di cui fai parte, Admin e Members. Su OneUptime Cloud, ogni progetto ha il suo piano.

:::cards
- [Utenti, team e autorizzazioni](/docs/permissions/index): Invitare persone e decidere cosa possono fare.
:::

## Monitor e sonde

Un **monitor** controlla una cosa che gestisci e decide se funziona. La maggior parte dei monitor viene controllata dalle **sonde**: macchine che eseguono il controllo secondo una pianificazione, per esempio richiedendo una pagina, chiamando un'API, eseguendo il ping di un host o interrogando un database. OneUptime Cloud esegue sonde in diverse regioni, un'installazione self-hosted esegue le proprie, e puoi aggiungere sonde personalizzate nella tua rete. Altri monitor leggono invece ciò che invii: la telemetria delle tue applicazioni, o i dati che un agente riporta dai tuoi server, dai cluster Kubernetes e dal resto dell'infrastruttura.

I **criteri** di un monitor decidono cosa significa ogni risultato. Vengono valutati in ordine, e il primo che corrisponde può cambiare lo stato del monitor, dichiarare un incidente, creare un avviso, o tutte e tre le cose. Ogni nuovo progetto ha tre stati del monitor: **Operativo**, **Degradato** e **Offline**.

:::cards
- [Creare un monitor](/docs/monitor/create-monitor): Scegliere un tipo, dire cosa controllare e ogni quanto.
- [Sonde personalizzate](/docs/probe/custom-probe): Controllare ciò che solo la tua rete può raggiungere.
:::

## Cosa tieni sotto controllo

Un monitor controlla una cosa sola. Intorno ai tuoi monitor, OneUptime tiene traccia di ciò che gestisci, e trovi questi record nel menu:

- Un **gruppo di monitor** riunisce più monitor in un unico stato, così una pagina di stato può mostrare come una sola riga qualcosa fatto di molte parti, come Checkout.
- Un **servizio** è un'applicazione o un microservizio che gestisci. OneUptime lo aggiunge la prima volta che ne arriva la telemetria, e riunisce su un'unica pagina i suoi log, le tracce, le metriche, le eccezioni e gli incidenti.
- **Host**, i cluster **Kubernetes** e il resto di **Infrastruttura** sono le macchine e le piattaforme che gestisci, popolate dagli agenti che installi.
- **Inventario** è un unico elenco di tutto questo: servizi, host, cluster, dispositivi, risorse cloud e le cose che non inviano alcuna telemetria.

Tutto si incontra dove si manifesta un problema. I monitor di un servizio possono confluire in un gruppo di monitor, uno SLO li misura, e quando uno fallisce dichiara un incidente. L'incidente elenca il servizio tra le risorse che colpisce, e la pagina di stato mostra il gruppo e l'incidente.

```mermaid title="Un servizio, cosa lo controlla e dove compare"
flowchart TB
    service["Servizio: Checkout"] -->|"controllato da"| monitors["I suoi monitor"]
    monitors --> group["Gruppo di monitor"]
    monitors --> slo["SLO"]
    monitors -->|"dichiarano"| incident["Incidente"]
    group --> statuspage["Pagina di stato"]
    incident --> statuspage
```

:::cards
- [Gruppi di monitor](/docs/monitor/monitor-groups): Riunire più monitor in un unico stato.
- [Servizi](/docs/telemetry/services): Ogni applicazione che gestisci, con una pagina ciascuna.
- [Panoramica dell'inventario](/docs/inventory/overview): Tutto ciò che OneUptime sa della tua infrastruttura.
:::

## Obiettivi di affidabilità

Uno **SLO** (obiettivo del livello di servizio) è un obiettivo di affidabilità per ciò che monitori, come essere disponibile il 99,9% del tempo su 30 giorni. OneUptime lo misura dai suoi monitor ogni 5 minuti. Il tempo di inattività che l'obiettivo consente è il suo budget di errore: con molto margine puoi rischiare, e con poco rallenti e investi nella stabilità.

:::cards
- [Panoramica degli SLO](/docs/slo/introduction): Fissare un obiettivo e vedere quanto resta del budget.
:::

## Incidenti e avvisi

Entrambi registrano un problema, ed entrambi possono avvisare chi è reperibile. Ciò che li distingue è chi viene colpito dal problema.

| | Incidente | Avviso |
| --- | --- | --- |
| **Cos'è** | Un problema che riguarda i tuoi utenti, come un'interruzione o un rallentamento | Un problema che il tuo team deve esaminare prima che gli utenti ne risentano |
| **Sulle pagine di stato** | Può comparire, e avvisa gli iscritti | Mai |
| **Stati iniziali** | **Identificato**, **Riconosciuto**, **Risolto** | **Identificato**, **Riconosciuto**, **Risolto** |
| **Gravità iniziali** | Critical Incident, Major Incident, Minor Incident | **Alto**, **Basso** |

Riconoscerlo dice che qualcuno se ne sta occupando, e impedisce alle sue policy di reperibilità di avvisare il livello successivo. Risolverlo lo chiude. Puoi aggiungere stati e gravità tuoi, e collegare gli avvisi all'incidente di cui si sono rivelati parte.

Un **episodio** raggruppa incidenti correlati, o avvisi correlati, perché il tuo team li gestisca come uno solo. Le regole di raggruppamento decidono cosa va insieme.

:::cards
- [Panoramica degli incidenti](/docs/incidents/index): Come gli incidenti vengono dichiarati, gestiti e risolti.
- [Panoramica degli avvisi](/docs/alerts/index): Da dove arrivano gli avvisi, e come gli episodi li raggruppano.
- [Avvisi collegati](/docs/incidents/linked-alerts): Collegare all'incidente gli avvisi generati da un'interruzione.
:::

## Reperibilità

Una **policy di reperibilità** decide chi viene avvisato per un incidente o un avviso, e chi viene dopo se nessuno risponde. Le sue **regole di escalation** sono i suoi livelli: ognuna avvisa le sue persone, poi attende che qualcuno riconosca prima che venga avvisato il livello successivo. Un livello può avvisare persone, team o una **pianificazione di reperibilità**, un turno che sa in ogni momento chi è reperibile.

Come viene raggiunta ogni persona lo decide lei. Nelle **Impostazioni utente**, ognuno conserva i modi in cui OneUptime può raggiungerlo, come e-mail, SMS, chiamate, notifiche push, Slack o Microsoft Teams, e quali usare quando viene avvisato.

:::cards
- [Panoramica della reperibilità](/docs/on-call/index): Come un avviso raggiunge qualcuno e dove si trova ogni elemento.
- [Regole di escalation](/docs/on-call/escalation-rules): Avvisare le persone livello per livello finché qualcuno risponde.
- [Pianificazioni di reperibilità](/docs/on-call/schedules): Turni, livelli e passaggi di consegne.
- [Come OneUptime vi raggiunge](/docs/notifications/index): I metodi, le regole e le impostazioni che decidono come viene raggiunta ogni persona.
:::

## Pagine di stato e manutenzione

Una **pagina di stato** mostra ai tuoi clienti se i tuoi servizi funzionano. Scegli quali monitor mostra, con nomi che i tuoi clienti capiscono. Finché un incidente su uno di quei monitor è attivo, la pagina lo mostra, e i suoi **iscritti** vengono avvisati via e-mail, SMS, Slack, Microsoft Teams o webhook. Una pagina di stato può essere pubblica, o privata per le persone che fai entrare.

La **manutenzione programmata** annuncia in anticipo i lavori previsti. Un evento passa per **Programmato**, **In corso**, **Terminato** e **Completato**, e le pagine di stato su cui lo mostri ne informano visitatori e iscritti.

:::cards
- [Panoramica delle pagine di stato](/docs/status-pages/index): Creare una pagina di stato e decidere cosa mostra.
- [Iscritti e annunci](/docs/status-pages/subscribers): Chi viene avvisato, e quando.
- [Panoramica della manutenzione programmata](/docs/scheduled-maintenance/index): Come si svolge un evento, e cosa mette in pausa.
:::

## Telemetria

La **telemetria** è ciò che i tuoi sistemi inviano a OneUptime: log, metriche, tracce, eccezioni e profili. Le applicazioni la inviano con OpenTelemetry, e gli agenti di OneUptime la inviano da host, cluster Kubernetes, host Docker e dal resto dell'infrastruttura. Ogni mittente usa una **chiave di acquisizione**, creata in **Impostazioni del progetto → Telemetria e APM → Chiavi di acquisizione**. Cerchi nella telemetria, la rappresenti nelle dashboard e la tieni sotto controllo con i monitor di telemetria, che aprono incidenti e avvisi come qualsiasi altro monitor. Nel menu, **Registri**, **Metriche**, **Tracce**, **Profili** ed **Eccezioni** aprono ciascuno un tipo; **IA / LLM** segue le conversazioni della tua IA, **Osservabilità dei dati** tiene sotto controllo le tabelle dei tuoi database e **Topologia** mostra come tutto si collega.

:::cards
- [OpenTelemetry](/docs/telemetry/open-telemetry): Inviare log, metriche e tracce dalle tue applicazioni.
- [Monitor log](/docs/monitor/logs-monitor): Essere avvisati quando un pattern compare nei tuoi log.
:::

## Sicurezza

**Eventi di sicurezza** conserva gli eventi di sicurezza dei tuoi log, dei tuoi strumenti di sicurezza e di qualsiasi altra cosa invii. Le sue regole di rilevamento trasformano ciò che trovano in casi di sicurezza, che il tuo team gestisce in una coda e a cui rispondono i playbook. **Sicurezza dei dati** trova i dati sensibili nei tuoi bucket, database e telemetria, e cosa non va nel modo in cui sono conservati.

:::cards
- [Primi passi con la sicurezza](/docs/telemetry/security-getting-started): Trovare minacce nei dati che hai già.
- [Panoramica di Sicurezza dei dati](/docs/data-security/index): Trovare i tuoi dati sensibili e correggere il modo in cui sono conservati.
:::

## Cosa installi, e le chiavi

Per la maggior parte di OneUptime non serve installare nulla. Installi qualcosa solo per raggiungere ciò che OneUptime non vede dall'esterno, e ogni elemento si collega in uscita a OneUptime con una chiave:

- Una sonda personalizzata esegue i controlli dei monitor nella tua rete, con un proprio ID sonda e una propria chiave.
- L'**OpenTelemetry Collector**, l'agente Kubernetes e l'agente Docker inviano telemetria con una **chiave di acquisizione**. L'agente dell'infrastruttura dietro un monitor server / VM invia con la chiave segreta di quel monitor.
- Un **Runner** esegue i passaggi dei runbook all'interno della tua infrastruttura, con un proprio Runner ID e una propria chiave.

Una chiave di acquisizione serve solo a inviare telemetria. Una **chiave API** è l'altro tipo: permette a uno script, alla CLI, a Terraform o a un assistente IA di leggere e modificare il tuo progetto, con le autorizzazioni che le dai. Nessuna delle due funziona al posto dell'altra.

:::cards
- [Quale usare?](/docs/introduction/which-one#sonda-agente-collector-o-runner): Cosa installare, e la chiave che usa ciascuno.
- [Chiavi di acquisizione](/docs/telemetry/ingestion-keys): Creare, limitare e ruotare le chiavi che inviano telemetria.
:::

## Automazione e IA

- I **Flussi di lavoro** eseguono azioni quando succede qualcosa, per esempio pubblicando un messaggio su Slack quando viene dichiarato un incidente.
- I **Runbook** trasformano una procedura di intervento in passaggi che il tuo team può eseguire, a mano o automaticamente.
- **OneUptime AI** indaga sui nuovi incidenti e avvisi e pubblica ciò che ha trovato nella loro cronologia, e **Chiedi all'IA** risponde alle domande sul tuo progetto. Un nuovo progetto parte con l'IA attiva; l'interruttore **Abilita IA** in **Impostazioni del progetto → IA → Funzionalità IA** la disattiva del tutto.

:::cards
- [Panoramica dei workflow](/docs/workflows/index): Automatizzare azioni con trigger e componenti.
- [AI SRE](/docs/ai/ai-sre): Come OneUptime AI indaga su incidenti e avvisi.
:::

## Etichette e proprietari

Le **etichette** sono tag che applichi a monitor, incidenti, pagine di stato e alla maggior parte delle altre risorse, per filtrarle e raggrupparle. Le autorizzazioni di un team possono essere limitate alle risorse con certe etichette. I **proprietari** sono le persone e i team responsabili di una risorsa: vengono avvisati quando le succede qualcosa. Le regole per etichette e proprietari aggiungono per te etichette e proprietari alle nuove risorse.

:::cards
- [Regole per etichette e proprietari](/docs/configuration/label-and-owner-rules): Etichettare le nuove risorse e assegnare loro proprietari automaticamente.
:::

## I tipi di regola

Molte cose in OneUptime si chiamano regola. Ognuna prende una decisione per te quando arriva qualcosa di nuovo, e si dividono in poche famiglie. La maggior parte si trova in **Regole**, nei menu laterali di **Incidenti** e **Avvisi**.

| Cosa decide | Regole |
| --- | --- |
| Chi viene avvisato | Le **Regole di reperibilità** scelgono le policy di reperibilità che un nuovo incidente o avviso esegue, e le **Regole di escalation** di una policy avvisano livello per livello |
| Chi ne è proprietario, e come viene etichettato | **Regole del proprietario**, **Regole etichette** e **Regole di privacy** |
| Cosa va insieme | Le **Regole di raggruppamento** aprono episodi e vi aggiungono elementi |
| Cosa viene eseguito | Le **Regole di runbook** avviano runbook, e le **Regole IA** decidono cosa OneUptime AI indaga e risolve |
| Quando dare seguito | Le **Regole SLA** tengono traccia dei tempi di risposta e di risoluzione, e le **Regole dei promemoria** fanno da promemoria ai proprietari finché resta aperto |

Le regole proprie di un monitor sono i suoi criteri. Le regole di reperibilità in **Impostazioni utente** sono ancora un'altra cosa: sono di ciascuna persona, e decidono come una chiamata raggiunge quella persona.

:::cards
- [Impostazioni e automazione degli incidenti](/docs/incidents/settings#regole-che-vengono-eseguite-alla-creazione-di-un-incidente): Le regole eseguite quando viene creato un incidente, in ordine.
- [Come contattarmi](/docs/notifications/on-call-rules): Come una chiamata ti raggiunge.
:::

## Passaggi successivi

:::cards
- [Guida rapida](/docs/introduction/quickstart): Mettere in pratica queste idee in quindici minuti.
- [Glossario](/docs/introduction/glossary): Ogni parola che OneUptime usa, in una o due frasi.
- [Quale usare?](/docs/introduction/which-one): Incidente o avviso, workflow o runbook, e gli altri elementi simili.
- [Panoramica degli incidenti](/docs/incidents/index): Cosa succede dopo che un monitor dichiara un incidente.
:::
