# Quale usare?

Alcune cose in OneUptime si somigliano. Questa pagina mette ogni gruppo fianco a fianco, con lo scopo di ciascun elemento, così scegli quello giusto al primo colpo. Ogni tabella sta in una schermata, e la sua prima colonna apre la pagina che tratta quella scelta per esteso.

:::cards
- [Incidente, avviso o un altro tipo di problema?](#incidente-avviso-o-un-altro-tipo-di-problema): Cosa diventa un problema in OneUptime.
- [Workflow, runbook, playbook o regola IA?](#workflow-runbook-playbook-o-regola-ia): Con cosa automatizzare.
- [Gruppo di monitor, servizio o etichetta?](#gruppo-di-monitor-servizio-o-etichetta): Come raggruppare ciò che monitori.
- [Sonda, agente, collector o Runner?](#sonda-agente-collector-o-runner): Cosa installare, e la chiave che usa ciascuno.
- [Dashboard, dashboard pubblica o pagina di stato?](#dashboard-dashboard-pubblica-o-pagina-di-stato): Cosa condividere, e con chi.
:::

## Incidente, avviso o un altro tipo di problema?

La maggior parte dei problemi è un incidente o un avviso: scegli in base a chi viene colpito dal problema. Gli altri sono record che OneUptime tiene per te, e ognuno di essi può portare a un incidente o a un avviso.

| Record | Cos'è | Usalo quando |
| --- | --- | --- |
| [Incidente](/docs/incidents/index) | Un problema che riguarda i tuoi utenti. Può avvisare chi è reperibile e comparire sulle tue pagine di stato. | I clienti se ne accorgono, o se ne accorgeranno presto: un'interruzione, un rallentamento, un checkout che non va a buon fine. |
| [Avviso](/docs/alerts/index) | Un problema per il tuo team. Può avvisare chi è reperibile, ma non compare mai su una pagina di stato. | Il tuo team deve intervenire prima che gli utenti se ne accorgano: un disco che si sta riempiendo, un certificato in scadenza. |
| [Episodio](/docs/incidents/episodes) | Un gruppo di incidenti correlati, o di avvisi correlati, gestiti come uno solo. | Una sola causa ha generato molti incidenti o avvisi. Le regole di raggruppamento aprono gli episodi per te. |
| [Eccezione](/docs/telemetry/exceptions) | Tutte le occorrenze di uno stesso errore sollevato dal tuo codice, raggruppate, con il loro stack trace. | Vuoi correggere un bug. Un monitor delle eccezioni può generare un avviso o un incidente quando gli errori aumentano di colpo. |
| [Insight IA](/docs/ai/ai-sre#insight-rilevamento-proattivo) | Un problema che OneUptime ha trovato nella tua telemetria prima che scattasse qualsiasi avviso, come un picco di log di errore. | Vuoi segnali precoci. Un insight non avvisa mai nessuno e non apre mai un incidente: attende in una casella. |
| [Caso di sicurezza](/docs/telemetry/security-cases) | Una minaccia che vale la pena esaminare, con tutti i rilevamenti sullo stesso utente, host o indirizzo. | Il tuo team di sicurezza indaga. **Dichiara incidente** su un caso apre un incidente quando gli utenti sono colpiti. |

Un avviso può essere collegato all'incidente di cui si è rivelato parte, quindi iniziare con un avviso non fa perdere nulla.

## Workflow, runbook, playbook o regola IA?

Tutti e quattro possono eseguirsi da soli. Scegli in base a ciò su cui agiscono e a chi ha scritto i passaggi.

| Strumento | Cosa fa | Usalo quando |
| --- | --- | --- |
| [Workflow](/docs/workflows/index) | Blocchi su una tela che vengono eseguiti quando scatta il loro trigger: viene creato un incidente, arriva l'ora di una pianificazione, un altro strumento chiama un URL. | Vuoi collegare OneUptime ad altri strumenti, o agire sui suoi record, senza scrivere codice. |
| [Runbook](/docs/runbooks/index) | La tua procedura di risposta sotto forma di passaggi, dalle checklist manuali agli script, alle richieste HTTP e a kubectl, eseguita su un incidente, un avviso o un evento di manutenzione. | Chi risponde deve seguire gli stessi passaggi ogni volta. Le regole di runbook avviano un runbook sugli incidenti che corrispondono. |
| [Playbook](/docs/telemetry/security-cases#playbook) | Passaggi che rispondono a un caso di sicurezza: conservare le prove, avvisare chi è reperibile, sospendere un utente. | Il tuo team di sicurezza risponde allo stesso tipo di minaccia sempre allo stesso modo. |
| [Regola IA](/docs/ai/ai-sre#quali-incidenti-vengono-indagati-e-corretti) | Decide quali nuovi incidenti e avvisi OneUptime AI indaga e risolve, e se chiede prima. | OneUptime AI deve lavorare solo su alcuni incidenti, o risolvere senza chiedere. Senza alcuna regola, li indaga tutti. |

## Gruppo di monitor, servizio o etichetta?

Tutti e tre riuniscono le cose, per lettori diversi. Funzionano anche insieme: i monitor di un servizio possono formare un gruppo di monitor, e tutti possono portare la stessa etichetta.

| Scelta | Cos'è | Usalo quando |
| --- | --- | --- |
| [Gruppo di monitor](/docs/monitor/monitor-groups) | Più monitor riuniti in un unico stato, il peggiore tra loro, con una propria disponibilità. | I clienti devono vedere una sola riga su una pagina di stato per qualcosa composto da più monitor, come Checkout. |
| [Servizio](/docs/telemetry/services) | Un'applicazione che OneUptime ha trovato nella tua telemetria, con i suoi log, tracce, metriche, incidenti e proprietari su un'unica pagina. | Vuoi tutto ciò che riguarda un'applicazione in un solo posto. Compare da sola a partire dal suo `service.name`. |
| [Etichetta](/docs/configuration/label-and-owner-rules) | Un tag che applichi a monitor e alla maggior parte degli altri record. Un record può averne molte. | Vuoi filtrare elenchi, limitare le autorizzazioni di un team o selezionare record nelle regole. |

I gruppi di monitor partono disattivati: attivali in **Impostazioni del progetto → Avanzato → Flag delle funzionalità**.

## Sonda, agente, collector o Runner?

Per la maggior parte di OneUptime non serve installare nulla: installa qualcosa solo per raggiungere ciò che OneUptime non vede dall'esterno. Ognuno si collega in uscita, con una chiave del proprio tipo.

| Installazione | Cosa fa | Installalo quando | Chiave che usa |
| --- | --- | --- | --- |
| [Sonda personalizzata](/docs/probe/custom-probe) | Esegue i controlli dei tuoi monitor dall'interno della tua rete. | Ciò che controlli è dietro il tuo firewall. Le sonde di OneUptime controllano ciò che è pubblico. | Un proprio ID sonda e una propria chiave |
| [Agente dell'infrastruttura](/docs/monitor/server-monitor) | Riporta CPU, memoria, dischi e processi di una macchina a un monitor server / VM. | Vuoi un monitor per un server, con criteri sui suoi valori. | La chiave segreta del monitor |
| [OpenTelemetry Collector](/docs/telemetry/hosts) | Invia le metriche, i log e i processi di una macchina. **Aggiungi host** lo installa con un solo comando. | Vuoi una macchina in **Host**, con la sua telemetria. | Una chiave di acquisizione |
| [Agente Kubernetes](/docs/telemetry/kubernetes-agent) | Raccoglie metriche, eventi, log e tracce di un cluster. Lo installi con Helm. | Usi Kubernetes. | Una chiave di acquisizione |
| [Runner](/docs/runbooks/agents) | Esegue i passaggi dei runbook, come Bash, SSH e kubectl, all'interno della tua infrastruttura. | I tuoi runbook devono raggiungere i tuoi host e cluster. | Un proprio Runner ID e una propria chiave |

### Chiave di acquisizione o chiave API?

| Chiave | Cosa ti permette di fare | Dove la crei |
| --- | --- | --- |
| [Chiave di acquisizione](/docs/telemetry/ingestion-keys) | Inviare telemetria al progetto, e nient'altro. | **Impostazioni del progetto → Telemetria e APM → Chiavi di acquisizione** |
| [Chiave API](/docs/permissions/index#chiavi-api) | Leggere e modificare il progetto tramite l'API, la CLI, Terraform o un assistente IA, con le autorizzazioni che le dai. | **Impostazioni del progetto → Avanzato → Chiavi API** |

Nessuna delle due funziona al posto dell'altra.

## Dashboard, dashboard pubblica o pagina di stato?

Scegli in base a chi deve vederla.

| Condivisione | Chi la vede | Usala quando |
| --- | --- | --- |
| [Dashboard](/docs/dashboards/index) | Le persone che accedono al tuo progetto. | Il tuo team segue grafici ed elenchi: uno schermo per la reperibilità, la vista di un team. |
| [Dashboard pubblica](/docs/dashboards/sharing) | Chiunque abbia il link, a meno che tu non aggiunga una password, la limiti ad alcuni indirizzi IP o la pubblichi sul tuo dominio. | Persone esterne al progetto devono vedere i tuoi grafici, come un partner o uno schermo a parete. |
| [Pagina di stato](/docs/status-pages/index) | I tuoi clienti, in pubblico, o solo gli utenti privati che fai entrare. | I clienti vogliono sapere se i tuoi servizi funzionano, ed essere informati su incidenti e manutenzioni. |

Una pagina di stato parla di incidenti e usa i nomi che dai ai tuoi monitor; una dashboard mostra i numeri che ci stanno dietro.

## Passaggi successivi

:::cards
- [Glossario](/docs/introduction/glossary): Ogni parola che OneUptime usa, in una o due frasi.
- [Concetti fondamentali](/docs/introduction/core-concepts): Come si collegano i pezzi, in una sola pagina.
- [Guida rapida](/docs/introduction/quickstart): Un monitor, una chiamata a chi è reperibile e una pagina di stato in quindici minuti.
:::
