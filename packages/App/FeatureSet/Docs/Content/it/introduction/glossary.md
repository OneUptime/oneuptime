# Glossario

Ogni parola che OneUptime usa, in una o due frasi, con gli altri nomi con cui è conosciuta e la pagina che la tratta per esteso. Le parole sono raggruppate nell'ordine in cui le incontri: il primo gruppo è il ciclo che ogni progetto segue, e l'ultimo raccoglie le parole che significano più di una cosa.

:::cards
- [Da dove iniziare](#da-dove-iniziare): Il ciclo che ogni progetto segue, da un monitor a chi è reperibile e a una pagina di stato.
- [Cosa tieni sotto controllo](#cosa-tieni-sotto-controllo): Servizi, host, cluster, cloud e gli obiettivi a cui li vincoli.
- [Lavorare su un problema](#lavorare-su-un-problema): Stati, gravità, proprietari ed etichette, e gli altri tipi di problema.
- [Telemetria e dashboard](#telemetria-e-dashboard): Cosa inviano i tuoi sistemi, e dove lo consulti.
- [Automazione e IA](#automazione-e-ia): Cosa gira da solo, e cosa fa OneUptime AI.
- [Cosa installi, e le chiavi](#cosa-installi-e-le-chiavi): Gli agenti che esegui, e la chiave che usa ciascuno.
- [Parole con più di un significato](#parole-con-più-di-un-significato): Regola, ruolo, risorsa, impostazioni e le altre parole con più compiti.
:::

## Da dove iniziare

### Progetto

Dove vive tutto ciò che configuri: monitor, incidenti, reperibilità, pagine di stato, telemetria e impostazioni. Niente di un progetto è visibile in un altro, e alla maggior parte delle aziende ne basta uno.

Vedi [Concetti fondamentali](/docs/introduction/core-concepts#progetti-e-persone).

### Account

Tu: l'e-mail e la password con cui accedi, il tuo nome, il fuso orario e la lingua. Un account può appartenere a quanti progetti vuoi.

Vedi [Il tuo account](/docs/introduction/your-account).

### Team

Un gruppo di persone in un progetto, le cui autorizzazioni decidono cosa possono fare i suoi membri. Ogni nuovo progetto parte con tre team: Owners, Admin e Members. Invita le persone in **Utenti** e raggruppale in **Team**.

Vedi [Utenti, team e autorizzazioni](/docs/permissions/index).

### Monitor

Controlla una cosa che gestisci, come un sito web, un'API, un server o un cluster Kubernetes, e decide se funziona. Quando i suoi criteri corrispondono, cambia il suo stato e può dichiarare un incidente o creare un avviso.

Vedi [Creare un monitor](/docs/monitor/create-monitor).

### Criteri

Le regole di un monitor: cosa significa ogni risultato di un controllo. Vengono valutati in ordine, e il primo che corrisponde può cambiare lo stato del monitor, dichiarare un incidente, creare un avviso, o tutte e tre le cose.

Altri nomi: **Criteri di monitoraggio**, **Criteri del monitor**, **Monitor Steps**. Vedi [Criteri e stati](/docs/monitor/criteria-and-statuses).

### Stato del monitor

Com'è un monitor in questo momento. Ogni nuovo progetto ha tre stati del monitor, **Operativo**, **Degradato** e **Offline**, e puoi aggiungerne di tuoi.

Vedi [Criteri e stati](/docs/monitor/criteria-and-statuses).

### Sonda

Una macchina che esegue i controlli dei monitor secondo una pianificazione: richiede una pagina, chiama un'API o esegue il ping di un host. OneUptime Cloud esegue sonde in diverse regioni, e una sonda personalizzata che esegui nella tua rete controlla ciò che solo quella rete può raggiungere.

Altri nomi: **Sonde personalizzate**. Vedi [Sonde personalizzate](/docs/probe/custom-probe).

### Incidente

Un problema che riguarda i tuoi utenti, come un'interruzione o un rallentamento, e il record su cui lavora il tuo team finché dura. Può avvisare chi è reperibile e comparire sulle tue pagine di stato.

Vedi [Panoramica degli incidenti](/docs/incidents/index).

### Avviso

Un problema che il tuo team deve esaminare prima che gli utenti se ne accorgano, come un disco che si sta riempiendo o un certificato in scadenza. Può avvisare chi è reperibile, ma non compare mai su una pagina di stato.

Vedi [Panoramica degli avvisi](/docs/alerts/index).

### Episodio

Un gruppo di incidenti correlati, o di avvisi correlati, che il tuo team gestisce come uno solo, con un solo insieme di proprietari e un solo stato. Le regole di raggruppamento decidono cosa entra in ciascuno.

Altri nomi: **Episodio di incidenti**, **Episodio di avvisi**. Vedi [Episodi](/docs/incidents/episodes).

### Policy di reperibilità

Decide chi viene avvisato per un incidente, un avviso o un episodio, e chi viene dopo se nessuno riconosce. I suoi livelli sono regole di escalation.

Altri nomi: **Reperibilità**, **On-Call Duty Policy**, `OnCallDutyPolicy`. Vedi [Policy di reperibilità](/docs/on-call/policies).

### Regola di escalation

Un livello di una policy di reperibilità: chi viene avvisato, e quanto attendere che qualcuno riconosca prima di avvisare il livello successivo. Un livello può avvisare persone, team o una pianificazione di reperibilità.

Vedi [Regole di escalation](/docs/on-call/escalation-rules).

### Pianificazione di reperibilità

Chi è reperibile in ogni momento: le persone si danno il turno, e ciascuna passa le consegne alla successiva. Una regola di escalation che avvisa una pianificazione avvisa chi vi risulta reperibile in quel momento.

Altri nomi: **Rotation**, **Pianificazione della policy di reperibilità**. Vedi [Pianificazioni di reperibilità](/docs/on-call/schedules).

### Livello

Una rotazione all'interno di una pianificazione di reperibilità: chi si alterna, ogni quanto avviene il passaggio di consegne e quali orari copre. Avvisa il livello più alto in cui qualcuno è reperibile, quindi la rotazione principale va in cima e la copertura di riserva sotto.

Vedi [Pianificazioni di reperibilità](/docs/on-call/schedules#livelli).

### Metodo di notifica

Un recapito a cui OneUptime può raggiungerti in un progetto: un indirizzo e-mail, un numero di telefono per SMS o chiamate, il tuo account Slack o Microsoft Teams, o l'app OneUptime sul tuo telefono. Ognuno aggiunge i propri in **Impostazioni utente**.

Vedi [Metodi di notifica](/docs/notifications/notification-methods).

### Come contattarmi

Le tue regole per essere chiamato: quali dei tuoi metodi di notifica prova una chiamata, e dopo quanto tempo. Una scala copre ogni incidente, avviso ed episodio, e una gravità può avere regole proprie. Ogni persona imposta le proprie in **Impostazioni utente**.

Altri nomi: **Regole di reperibilità personali**. Vedi [Come contattarmi](/docs/notifications/on-call-rules).

### Pagina di stato

Una pagina che mostra ai tuoi clienti se i tuoi servizi funzionano, e gli incidenti e le manutenzioni che li riguardano. Può essere pubblica, o privata per le persone che fai entrare.

Vedi [Panoramica delle pagine di stato](/docs/status-pages/index).

### Iscritto

Qualcuno che segue una pagina di stato via e-mail, SMS, Slack, Microsoft Teams o webhook, e viene avvisato quando un incidente o una manutenzione su di essa inizia, cambia e finisce.

Vedi [Iscritti e annunci](/docs/status-pages/subscribers).

### Manutenzione programmata

Lavori previsti, annunciati in anticipo. Ogni evento di manutenzione passa per gli stati della manutenzione **Programmato**, **In corso**, **Terminato** e **Completato**, e le pagine di stato su cui viene mostrato ne informano visitatori e iscritti.

Altri nomi: **Evento di manutenzione programmata**, **Evento pianificato**, **Evento**. Vedi [Panoramica della manutenzione programmata](/docs/scheduled-maintenance/index).

### Telemetria

Ciò che i tuoi sistemi inviano a OneUptime: log, metriche, tracce, eccezioni e profili. Le applicazioni la inviano con OpenTelemetry, e gli agenti di OneUptime la inviano da host, cluster e dal resto dell'infrastruttura, ciascuno con una chiave di acquisizione.

Vedi [OpenTelemetry](/docs/telemetry/open-telemetry).

## Cosa tieni sotto controllo

### Gruppo di monitor

Più monitor riuniti in un unico stato, il peggiore tra loro, con una propria disponibilità. Una pagina di stato può mostrare l'intero gruppo come una sola riga. Attiva i gruppi di monitor in **Impostazioni del progetto → Avanzato → Flag delle funzionalità**.

Vedi [Gruppi di monitor](/docs/monitor/monitor-groups).

### Servizio

Un'applicazione o un microservizio che gestisci. OneUptime ne aggiunge uno la prima volta che ne arriva la telemetria, con il nome del suo `service.name`, e riunisce su un'unica pagina i suoi log, le tracce, le metriche, le eccezioni, gli incidenti e i proprietari.

Altri nomi: **Catalogo servizi**, **Servizio di telemetria**. Vedi [Servizi](/docs/telemetry/services).

### Host

Una macchina Linux, Windows o macOS che invia le sue metriche, i processi, i log e gli stati dei servizi tramite l'OpenTelemetry Collector. **Aggiungi host** installa il collector con un solo comando, e OneUptime ne mantiene aggiornata la configurazione.

Vedi [Host](/docs/telemetry/hosts).

### Kubernetes

I tuoi cluster Kubernetes, con i loro nodi, pod, carichi di lavoro, eventi e log, inviati dall'agente Kubernetes che installi con Helm.

Vedi [Agent Kubernetes](/docs/telemetry/kubernetes-agent).

### Infrastruttura

Il gruppo del menu con le macchine e le piattaforme che gestisci: Host, Kubernetes, Docker, Docker Swarm, Podman, Proxmox, OpenStack, VMware, Ceph, Array di storage, Rete e IoT. Un agente o una connessione popola ciascuna voce, e ciascuna dice come sta ogni macchina, cluster o dispositivo che contiene.

Vedi [Host](/docs/telemetry/hosts).

### Rete

I tuoi switch, router, firewall, access point e qualsiasi altra cosa abbia un indirizzo sulla tua rete, che parli SNMP o no.

Vedi [Monitor dispositivi di rete](/docs/monitor/network-device-monitor).

### Cloud

I tuoi account AWS, le sottoscrizioni Azure e i progetti Google Cloud, collegati dalla dashboard. OneUptime elenca ogni risorsa che contengono, ne legge le metriche principali e registra cosa vi è cambiato.

Vedi [Collegare un account cloud](/docs/telemetry/cloud-accounts).

### Piattaforme applicative

Le app che esegui su piattaforme gestite come Amazon ECS e Fargate, Google Cloud Run e Azure App Service. Ogni luogo in cui girano è un ambiente cloud, che OneUptime crea la prima volta che ne arriva la telemetria.

Altri nomi: **Ambiente cloud**. Vedi [Ambienti cloud](/docs/telemetry/cloud-environments).

### Serverless

Le tue funzioni serverless, come AWS Lambda, Google Cloud Functions e Azure Functions, elencate con le loro tracce, i log e le metriche non appena arrivano i loro dati OpenTelemetry.

Altri nomi: **Funzioni serverless**. Vedi [Funzioni serverless](/docs/telemetry/serverless-functions).

### Database

Ogni database che le tue applicazioni interrogano, ricostruito dalle tue tracce, dalle metriche del database stesso e dalle altre fonti che OneUptime sa leggere, con lo stato del suo motore.

Vedi [Database](/docs/telemetry/databases).

### Code di messaggi

Le code e i topic di messaggi usati dai tuoi servizi, come Apache Kafka, RabbitMQ e Amazon SQS, ricavati dalle tue tracce e dalle metriche dei tuoi broker.

Vedi [Code](/docs/telemetry/queues).

### Monitoraggio degli utenti reali

Ciò che vivono le persone reali nelle tue app web e mobili: caricamenti di pagina, richieste, errori e Core Web Vitals, riportati dall'app stessa anziché da una sonda.

Vedi [Panoramica del RUM](/docs/rum/index).

### Inventario

Un unico elenco di tutto ciò che OneUptime sa della tua infrastruttura: servizi, host, oggetti Kubernetes, macchine virtuali, dispositivi di rete, risorse cloud e le cose che non inviano alcuna telemetria. Quasi tutto si compila da solo.

Vedi [Panoramica dell'inventario](/docs/inventory/overview).

### Topologia

Una mappa di come si collegano i tuoi sistemi, quali servizi chiamano quali e cosa gira dove, disegnata dalla telemetria che già invii.

Vedi [Topologia](/docs/telemetry/topology).

### SLO

Un obiettivo di affidabilità per ciò che monitori, come essere disponibile il 99,9% del tempo su 30 giorni. OneUptime misura ogni SLO rispetto ai suoi monitor ogni 5 minuti.

Altri nomi: **Service Level Objective**. Vedi [Panoramica degli SLO](/docs/slo/introduction).

### Budget di errore

Il tempo di inattività che l'obiettivo di uno SLO consente: al 99,9% su 30 giorni, 43 minuti e 12 secondi. Con molto margine puoi rischiare; con poco, rallenta e investi nella stabilità.

Vedi [Budget di errore](/docs/slo/error-budget).

## Lavorare su un problema

### Stato

A che punto della tua risposta si trova un incidente o un avviso. Ogni nuovo progetto parte con **Identificato**, **Riconosciuto** e **Risolto**: riconoscere dice che qualcuno se ne sta occupando e impedisce che venga avvisato il livello di escalation successivo, e risolvere lo chiude.

Altri nomi: **Stato incidente**, **Stato avviso**. Vedi [Stati e gravità degli incidenti](/docs/incidents/states-and-severities).

### Gravità

Quanto conta un incidente o un avviso. Un nuovo progetto parte con Critical Incident, Major Incident e Minor Incident per gli incidenti, e **Alto** e **Basso** per gli avvisi; rinominali, cambiane il colore o aggiungine di tuoi.

Altri nomi: **Gravità incidente**, **Gravità avviso**. Vedi [Stati e gravità degli incidenti](/docs/incidents/states-and-severities).

### Proprietario

Una persona o un team responsabile di un record, come un monitor, un incidente o una pagina di stato. I proprietari vengono avvisati quando succede qualcosa a ciò che possiedono.

Vedi [Regole per etichette e proprietari](/docs/configuration/label-and-owner-rules).

### Etichetta

Un tag, come Production o Checkout, che applichi a monitor, incidenti, pagine di stato e alla maggior parte degli altri record per filtrarli e raggrupparli. Le autorizzazioni di un team possono essere limitate ai record con certe etichette.

Vedi [Regole per etichette e proprietari](/docs/configuration/label-and-owner-rules).

### Eccezione

Un errore sollevato dal tuo codice. OneUptime raggruppa ogni occorrenza dello stesso errore in un'unica eccezione, con il suo stack trace, il suo andamento e le richieste in cui si è verificato.

Altri nomi: **Tracciamento delle eccezioni**, `/telemetry-exception`. Vedi [Eccezioni](/docs/telemetry/exceptions).

### Insight IA

Problemi che OneUptime trova nella tua telemetria prima che scatti qualsiasi avviso: eccezioni nuove o in aumento, picchi di log di errore, tracce più lente, derive delle metriche e deploy che hanno peggiorato le cose. Gli insight non avvisano mai nessuno e non aprono mai incidenti; attendono in una casella finché qualcuno non li guarda. La pagina **Informazioni** nella sezione IA di un prodotto o di un record è ciò che OneUptime AI ha imparato lì.

Altri nomi: **Informazioni**. Vedi [AI SRE](/docs/ai/ai-sre#insight-rilevamento-proattivo).

### Eventi di sicurezza

Il SIEM di OneUptime: gli eventi di sicurezza dei tuoi log, dei tuoi strumenti di sicurezza e di qualsiasi altra cosa invii, conservati in un'unica forma accanto alla tua telemetria, con regole di rilevamento che vi trovano le minacce.

Altri nomi: **SIEM**. Vedi [Eventi di sicurezza (SIEM)](/docs/telemetry/security-events).

### Caso di sicurezza

Una cosa che vale la pena esaminare, proveniente da regole di rilevamento, threat intelligence o un prodotto di sicurezza collegato, in cui confluiscono tutti i rilevamenti sullo stesso utente, host o indirizzo. Gli analisti gestiscono i casi in una coda, e i playbook vi rispondono.

Altri nomi: **Caso**. Vedi [Casi di sicurezza e playbook (SOAR)](/docs/telemetry/security-cases).

## Telemetria e dashboard

### Registri

Le righe che scrivono i tuoi servizi, host e agenti, in cui cerchi con l'esploratore log e che tieni sotto controllo con un monitor log.

Vedi [Esploratore log](/docs/telemetry/logs-explorer).

### Metriche

I numeri che i tuoi servizi e la tua infrastruttura riportano nel tempo, come il numero di richieste, la latenza, la CPU e la profondità delle code.

Vedi [Esploratore metriche](/docs/telemetry/metrics-explorer).

### Tracce

Il percorso di una richiesta attraverso i tuoi servizi, passo dopo passo. Ogni passo è uno span, con la sua durata e il suo esito.

Vedi [Esploratore tracce](/docs/telemetry/traces-explorer).

### Profili

Come la tua applicazione spende tempo di CPU e memoria, funzione per funzione, inviato da un profiler che invia i dati all'API compatibile con Pyroscope di OneUptime.

Altri nomi: **Profili di prestazioni**, **Profilazione continua**. Vedi [Profili](/docs/telemetry/profiles).

### IA / LLM

Le conversazioni delle tue app e dei tuoi agenti di IA: ogni chiamata a un modello, con token, costo, latenza, prompt e risposta, ricostruita dagli span OpenTelemetry che la tua app invia.

Altri nomi: **Osservabilità AI / LLM**. Vedi [Osservabilità IA / LLM](/docs/telemetry/ai-llm-observability).

### Osservabilità dei dati

Tiene sotto controllo le tabelle dei tuoi database e data warehouse, e ti avvisa quando i loro dati sono in ritardo, mancanti o sbagliati, e quale esecuzione, deploy o tabella ne è la causa.

Vedi [Panoramica di Osservabilità dei dati](/docs/data-observability/index).

### Sicurezza dei dati

Trova i dati sensibili che la tua azienda conserva, nei bucket cloud, nei database, nei data warehouse e nella telemetria che invii, e ti dice cosa non va nel modo in cui sono conservati.

Vedi [Panoramica di Sicurezza dei dati](/docs/data-security/index).

### Dashboard

Una pagina di widget che disponi tu: grafici delle tue metriche, dei log e delle tracce, elenchi di incidenti e monitor, i tuoi SLO e altro ancora. Una dashboard resta privata al tuo progetto finché non la condividi.

Vedi [Panoramica delle dashboard](/docs/dashboards/index).

### Public Dashboard

Una dashboard condivisa tramite un link pubblico, per chi non accede al tuo progetto. Proteggila con una password, limitala ad alcuni indirizzi IP o pubblicala sul tuo dominio.

Vedi [Condivisione e dashboard pubbliche](/docs/dashboards/sharing).

## Automazione e IA

### Flusso di lavoro

Un'automazione senza codice: blocchi su una tela che vengono eseguiti quando scatta il loro trigger, per esempio per pubblicare un messaggio su Slack quando viene dichiarato un incidente, o per chiamare un altro strumento.

Vedi [Panoramica dei workflow](/docs/workflows/index).

### Runbook

Una procedura di risposta riutilizzabile: passaggi manuali e automatici che il tuo team esegue su un incidente, un avviso o un evento di manutenzione, a mano o quando corrisponde una regola di runbook.

Vedi [Panoramica dei Runbook](/docs/runbooks/index).

### Playbook

I passaggi che rispondono a un caso di sicurezza, come conservare le prove, avvisare chi è reperibile o sospendere un utente, eseguiti da soli o con un clic.

Altri nomi: **Playbook di sicurezza**. Vedi [Casi di sicurezza e playbook (SOAR)](/docs/telemetry/security-cases#playbook).

### Regola IA

Decide quali nuovi incidenti o avvisi OneUptime AI indaga e risolve, e come. Senza alcuna regola IA li indaga tutti, quindi alla maggior parte dei progetti non ne serve nessuna.

Altri nomi: **Regola di correzione automatica**. Vedi [AI SRE](/docs/ai/ai-sre#quali-incidenti-vengono-indagati-e-corretti).

### OneUptime AI

L'ingegnere di affidabilità dei siti basato sull'IA di OneUptime: indaga su ogni nuovo incidente e avviso in tutta la tua telemetria e pubblica ciò che ha trovato nella sua cronologia. L'interruttore **Abilita IA** in **Impostazioni del progetto** lo disattiva del tutto.

Altri nomi: **AI SRE**. Vedi [AI SRE](/docs/ai/ai-sre).

### Chiedi all'IA

Una chat sui dati del tuo progetto. Interroga i tuoi log, le tracce, le metriche, gli incidenti, i monitor e altro ancora, e risponde con una citazione per ogni affermazione.

Altri nomi: **Chat**. Vedi [Chiedi all'IA](/docs/ai/ask-ai).

### Codice

Dove chiedi a OneUptime AI di lavorare nei tuoi repository, come faresti con un agente di programmazione: correggere un bug, scrivere test o apportare una modifica, e ricevere in cambio una pull request.

Altri nomi: **Attività**. Vedi [Codice](/docs/ai/ai-agent).

### Modulo

Una pagina che chiunque abbia il link può compilare, senza un account. Ogni invio crea un incidente, per segnalare un problema, o un evento di manutenzione, per richiedere una modifica.

Vedi [Panoramica dei moduli](/docs/forms/index).

## Cosa installi, e le chiavi

### Agente dell'infrastruttura

Il servizio `oneuptime-infrastructure-agent` dietro un monitor server / VM: riporta CPU, memoria, dischi e processi di una macchina ogni 30 secondi, firmati con la chiave segreta del monitor.

Vedi [Monitor server / VM](/docs/monitor/server-monitor).

### Agente Kubernetes

Un chart Helm che raccoglie le metriche, gli eventi e i log dei pod di un cluster e, con eBPF, le sue tracce, e li invia con una chiave di acquisizione.

Vedi [Agent Kubernetes](/docs/telemetry/kubernetes-agent).

### OpenTelemetry Collector

L'agente open source che riceve, elabora e invia telemetria. **Aggiungi host** lo installa su una macchina, l'agente Docker è uno di questi, e i tuoi collector inviano a OneUptime con una chiave di acquisizione.

Altri nomi: **Collector**. Vedi [Host](/docs/telemetry/hosts) e [Collector OpenTelemetry sull'host](/docs/telemetry/host-otel-collector).

### Runner

Un piccolo processo che esegui nella tua infrastruttura e che esegue i passaggi JavaScript, Bash, SSH e kubectl dei tuoi runbook. Si collega in uscita a OneUptime con un proprio Runner ID e una propria chiave.

Altri nomi: **Agenti di runbook**. Vedi [Agenti di runbook](/docs/runbooks/agents).

### Chiave di acquisizione

La chiave che permette a qualcosa di inviare telemetria al tuo progetto: applicazioni con OpenTelemetry, collector e agenti. Va nell'intestazione `x-oneuptime-token`, e una chiave API del progetto non funziona al suo posto.

Altri nomi: **Telemetria Ingestione Key**, `oneuptime.apiKey`. Vedi [Chiavi di acquisizione](/docs/telemetry/ingestion-keys).

### Chiave API

Una chiave che permette a uno script, alla CLI, a Terraform o a un assistente IA di leggere e modificare il tuo progetto tramite l'API, con le autorizzazioni che le dai. Creane una in **Impostazioni del progetto → Avanzato → Chiavi API**.

Vedi [Utenti, team e autorizzazioni](/docs/permissions/index#chiavi-api).

## Parole con più di un significato

### Regola

Molte cose in OneUptime sono regole, e ciascuna prende una decisione per te: chi viene avvisato (**Regole di reperibilità**, **Regole di escalation**), chi possiede ed etichetta i nuovi record (**Regole del proprietario**, **Regole etichette**), cosa va insieme (**Regole di raggruppamento**) e cosa fa OneUptime AI (**Regole IA**). Le regole proprie di un monitor sono i suoi criteri.

Vedi [Concetti fondamentali](/docs/introduction/core-concepts#i-tipi-di-regola).

### Ruolo

Quattro cose diverse: le autorizzazioni che un team concede, come Project Owner o Project Admin; un **Ruolo personalizzato** che componi a partire dalle autorizzazioni; un **Ruolo dell'incidente**, la parte che qualcuno svolge in un incidente; e un **Network Device Role**, cosa fa un dispositivo sulla tua rete.

Vedi [Utenti, team e autorizzazioni](/docs/permissions/index).

### Risorsa

Per lo più, l'infrastruttura che OneUptime registra, come host, cluster, database e risorse cloud. Le **Risorse interessate** di un incidente sono i monitor e l'infrastruttura che tocca, le risorse di una pagina di stato sono i monitor e i gruppi che mostra, e gli attributi di risorsa di OpenTelemetry dicono da dove proviene la telemetria.

Vedi [Panoramica dell'inventario](/docs/inventory/overview).

### Impostazioni

Ogni livello ha le sue: **Impostazioni del progetto** per l'intero progetto, **Impostazioni utente** per come OneUptime ti raggiunge, e le **Impostazioni** di un prodotto nel suo menu laterale, come gli stati e i modelli degli incidenti in **Incidenti**. Le impostazioni di un server self-hosted si trovano nell'Admin Dashboard.

Vedi [Impostazioni del progetto](/docs/configuration/project-settings).

### Criterio

Per lo più una **Policy di reperibilità**: chi viene avvisato, e chi viene dopo. Una politica per le chiamate in arrivo dà al tuo team un numero di telefono che chiama chi è reperibile, e una policy del budget di errore mette per iscritto cosa fa il tuo team quando il budget di uno SLO si esaurisce.

Vedi [Policy di reperibilità](/docs/on-call/policies).

### Modello

Un punto di partenza salvato: un modello di monitor crea monitor, i modelli di incidenti e avvisi compilano i nuovi record, i modelli di note e di post-mortem avviano ciò che scrivi, e i modelli di dashboard costruiscono i widget di una dashboard.

Vedi [Modelli di monitor](/docs/monitor/monitor-templates).

### Area di lavoro

Un'area di lavoro Slack o Microsoft Teams che colleghi a OneUptime in **Connessioni dell'area di lavoro**, per pubblicare aggiornamenti nei tuoi canali e agire sugli incidenti dalla chat. Quella che altri strumenti chiamano area di lavoro, in OneUptime è un progetto.

Vedi [Slack](/docs/workspace-connections/slack).

### Agente

Un programma che installi e che riferisce a OneUptime o agisce per suo conto: gli agenti dell'infrastruttura, Kubernetes e Docker inviano ciò che raccolgono, un Runner esegue i passaggi dei runbook, e un agente IA permette a OneUptime AI di esaminare un cluster o un host. Le attività che affidi a **Codice** sono attività di un agente IA.

Vedi [Quale usare?](/docs/introduction/which-one#sonda-agente-collector-o-runner).

### Regole di reperibilità

In **Incidenti** e **Avvisi**, le regole di reperibilità scelgono le policy di reperibilità che un nuovo incidente o avviso esegue. Anche le regole personali su come una chiamata raggiunge qualcuno si chiamavano regole di reperibilità: ora sono **Come contattarmi**, in **Impostazioni utente**.

Vedi [Impostazioni e automazione degli incidenti](/docs/incidents/settings#regole-di-reperibilità-degli-incidenti) e [Come contattarmi](/docs/notifications/on-call-rules).

### Impostazioni notifiche

In **Impostazioni utente**, quali aggiornamenti ti arrivano su ciò che possiedi, e su quali canali. Anche gli interruttori del progetto per SMS e chiamate, il suo credito per i messaggi e il suo SMTP e Twilio si chiamavano impostazioni delle notifiche: ora sono **Canali di notifica**, in **Impostazioni del progetto**.

Vedi [Impostazioni notifiche](/docs/notifications/notification-settings).

## Passaggi successivi

:::cards
- [Quale usare?](/docs/introduction/which-one): Incidente o avviso, workflow o runbook, e gli altri elementi simili fianco a fianco.
- [Concetti fondamentali](/docs/introduction/core-concepts): Come si collegano i pezzi, in una sola pagina.
- [Guida rapida](/docs/introduction/quickstart): Metti in pratica queste parole in quindici minuti.
:::
