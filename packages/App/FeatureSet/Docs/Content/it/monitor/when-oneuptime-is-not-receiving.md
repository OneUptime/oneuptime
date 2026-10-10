# Quando OneUptime non riceve dati

Mentre OneUptime si riavvia, viene aggiornato o smaltisce un arretrato, nulla di ciò che inviano i tuoi agenti, collector, sonde e mittenti di heartbeat può raggiungere i tuoi monitor. OneUptime registra quando accade e non conta mai quel tempo contro un server, un host o qualsiasi altra risorsa: quel tempo non è stato monitorato, quindi non è un'interruzione.

## Come funziona

Ogni processo di OneUptime che riceve dati registra ogni 30 secondi che sta ricevendo, purché raggiunga i database in cui conserva i dati. OneUptime lascia fuori tre tipi di tempo:

- Nessuna ricezione: nessun processo ha registrato nulla per più di 90 secondi. OneUptime era fermo, si stava riavviando o aggiornando, oppure non raggiungeva uno dei suoi database.
- Riconnessione: i primi 2 minuti dopo che OneUptime torna a ricevere, mentre gli agenti si riconnettono e inviano ciò che hanno conservato.
- Recupero: finché la coda dei dati in attesa di elaborazione è indietro di più di un minuto, il tempo trascorso dai dati più vecchi che vi attendono ancora.

```mermaid title="Il tempo che OneUptime lascia fuori"
flowchart LR
    receiving["Ricezione"] -->|"nessuna registrazione per 90 secondi"| down["Nessuna ricezione"]
    down -->|"un processo registra di nuovo"| grace["Riconnessione per 2 minuti"]
    grace --> again["Ricezione"]
```

Un riavvio che dura meno di 90 secondi non è un'interruzione: i collector inviano di nuovo ciò che non sono riusciti a consegnare.

## Cosa cambia in quel tempo

| Dove | Cosa fa OneUptime |
| --- | --- |
| Monitor di server / VM | **Is Online** conta solo i minuti in cui OneUptime riceveva: per impostazione predefinita, un server è offline dopo 3 minuti di silenzio che OneUptime avrebbe potuto sentire. |
| Monitor di richieste in arrivo e di email in arrivo | **Recieved In Minutes** e **Not Recieved In Minutes** contano solo i minuti in cui OneUptime riceveva. Quando un tale criterio è soddisfatto, il suo motivo dice quanti di quei minuti sono stati lasciati fuori. |
| Monitor di host, Kubernetes, Docker, metriche, log, trace e gli altri monitor che leggono la telemetria | Un controllo la cui finestra contiene tempo senza ricezione attende che quel tempo sia uscito dalla finestra, e mai più di 15 minuti dopo la sua fine. Fino ad allora non cambia nulla: nessun cambio di stato, e nessun incidente né avviso viene aperto o risolto. Finché la coda è indietro, un controllo legge fino al punto in cui si trova la coda invece che fino ad adesso. |
| Host, cluster e il resto dell'inventario | Una risorsa diventa **Disconnesso** solo dopo che la sua soglia di silenzio, 15 minuti per la maggior parte, è trascorsa mentre OneUptime riceveva. |
| Sonde e agenti IA | Diventano **Disconnesso** dopo 3 minuti di silenzio mentre OneUptime riceveva. |
| Grafici di **Disponibilità** di host, host Docker e Podman e cluster Kubernetes | Quel tempo è ombreggiato come **Non monitorato**, e la linea lì si interrompe invece di scendere a inattivo. Il badge di uptime lascia fuori quel tempo; un intervallo con dati conta comunque come attivo. |
| Uptime delle pagine di stato e SLO | Entrambi si calcolano dagli stati dei monitor: senza un falso cambio di stato, nessuna falsa interruzione. |

> [!NOTE]
> Lasciare fuori del tempo non significa riempirlo. Una risorsa non viene mai mostrata come attiva per un tempo in cui OneUptime non poteva sentirla: quel tempo semplicemente non viene giudicato. Appena OneUptime torna a ricevere, una risorsa davvero inattiva viene giudicata da quel momento in base a ciò che invia, o non invia.

## Installazioni self-hosted

### All'avvio

Mentre un processo di OneUptime si avvia, risponde a ogni richiesta, tranne ai suoi controlli di stato, con `503 Service Unavailable` e `Retry-After: 5`, e un browser riceve una pagina che si ricarica da sola. I collector e gli SDK OpenTelemetry inviano di nuovo una richiesta del genere invece di scartare i dati. `/status/ready` fallisce finché il processo non è pronto, quindi Kubernetes non gli invia traffico prima.

### Repliche worker

Un processo registra che OneUptime sta ricevendo solo quando il traffico in ingresso può raggiungerlo. Se esegui repliche che si limitano a elaborare code, senza un ingress davanti, imposta su di esse `RECEIVES_INGRESS_TRAFFIC` a `false`. Altrimenti continuano a registrare mentre tutte le repliche che ricevono traffico sono ferme, e quell'interruzione torna a contare contro le tue risorse. Il chart Helm lo imposta già sui suoi pod worker, e un singolo container di OneUptime non ha bisogno di nulla.

```yaml title="Container worker"
env:
  - name: RECEIVES_INGRESS_TRAFFIC
    value: "false"
```

### Cosa viene registrato

OneUptime inizia a tenere questa registrazione quando passi a una versione che la include; il tempo precedente viene giudicato come sempre. Finché nessun processo registra che sta ricevendo, il tempo dall'ultima registrazione è trattato come un'interruzione per un'ora al massimo; dopo, il silenzio torna a contare, così una registrazione che non viene più scritta non può nascondere a lungo un'interruzione delle tue risorse. Le registrazioni sono conservate per 400 giorni, e quando OneUptime non riesce a leggerle, giudica il silenzio come se avesse ricevuto senza interruzioni.

## Passi successivi

:::cards
- [Monitor host](/docs/monitor/host-monitor): Ricevere avvisi sulle metriche di un host.
- [Monitor server / VM](/docs/monitor/server-monitor): Sapere quando l'agente di un server smette di riferire.
- [Monitor richieste in arrivo](/docs/monitor/incoming-request-monitor): Trasformare un heartbeat in un dispositivo uomo morto.
- [Aggiornamento](/docs/installation/upgrading): Aggiornare un'installazione self-hosted.
:::
