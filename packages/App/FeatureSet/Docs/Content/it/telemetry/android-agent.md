# Agent Android

L'agent Android di OneUptime segnala a OneUptime un dispositivo Android di proprietà della tua organizzazione, come un chiosco per gli ordini, un terminale POS, un palmare o un player di digital signage: la sua memoria, lo spazio di archiviazione, la rete, la batteria e la temperatura, i riavvii, le app installate e i crash e i log di queste app. Il tuo gestore dei dispositivi lo installa e lo configura su tutta la flotta in una volta sola. Ogni dispositivo diventa un host in **Host** e un elemento in **Inventario**, accanto ai tuoi server e alle tue macchine Windows.

:::cards
- [Quando usarlo](#lagent-o-la-strumentazione-dellapp): L'agent vede il dispositivo, la strumentazione dell'app vede la tua app.
- [Distribuirlo con Esper](#distribuirlo-con-esper): Caricare l'APK, inviare le sue impostazioni, avviarlo una volta.
- [Impostazioni](#impostazioni): Ogni chiave della sua configurazione gestita.
- [Leggere i log delle altre app](#leggere-i-log-delle-altre-app): Concedere READ_LOGS una volta, con adb o con il tuo gestore dei dispositivi.
:::

## Come funziona

L'agent è una piccola app che viene eseguita come servizio in primo piano. Ogni minuto legge lo stato del dispositivo e lo invia alla tua istanza di OneUptime tramite OTLP con una chiave di acquisizione **Server**, insieme ai riavvii, alle app installate e ai log del dispositivo. Si avvia da solo quando il dispositivo si accende, conserva sul dispositivo ciò che raccoglie mentre la rete è assente e lo invia non appena la rete torna. Non tiene mai sveglio un dispositivo in sospensione e comprime ciò che invia.

```mermaid title="Dalla tua flotta a OneUptime"
flowchart TB
    mdm["Il tuo MDM:<br/>Esper, Intune, SOTI"] -->|"lo installa e<br/>lo configura"| agent["Agent Android<br/>su ogni dispositivo"]
    agent -->|"OTLP con una<br/>chiave Server"| oneuptime["OneUptime"]
    oneuptime --> hosts["Host e Inventario"]
    oneuptime --> logs["Log ed Eccezioni"]
```

## L'agent o la strumentazione dell'app

| | [OpenTelemetry Android](/docs/rum/android-setup) nella tua app | L'agent Android |
| --- | --- | --- |
| Cosa vede | La tua app: i suoi crash, gli ANR, le schermate, le sessioni, le richieste e i flussi di lavoro | Il dispositivo: memoria, archiviazione, rete, batteria, riavvii, app installate, e i crash e gli ANR di ogni app |
| Dove compare | **Monitoraggio degli utenti reali**, **Tracce** ed **Eccezioni** | **Host**, **Inventario**, **Log** ed **Eccezioni** |
| Come si installa | Nel codice della tua app | Come app, tramite il tuo gestore dei dispositivi |

Sui dispositivi di tua proprietà usa entrambi, e dai al dispositivo lo stesso nome in tutti e due: nell'impostazione `device_name` dell'agent e nell'`host.name` che imposta la tua app. Il dispositivo è allora un solo elemento in **Inventario**, che riunisce la telemetria dell'app e quella del dispositivo.

## Prima di iniziare

- Dispositivi con Android 7.0 o successivo, registrati in un gestore dei dispositivi che supporta le configurazioni gestite di Android: Esper, Microsoft Intune, Workspace ONE, SOTI e altri gestori dei dispositivi Android Enterprise. Per un singolo dispositivo basta adb.
- Una chiave di acquisizione **Server**, creata in **Impostazioni del progetto → Telemetria e APM → Chiavi di acquisizione** con **Crea chiave di acquisizione**.
- L'agent: `oneuptime-android-agent.apk`, allegato a ogni [release di OneUptime](https://github.com/OneUptime/oneuptime/releases/latest).
- HTTPS in uscita dai dispositivi verso il tuo URL di OneUptime. L'agent rifiuta qualsiasi URL che non inizi con `https://`, perché ogni richiesta trasporta la chiave di acquisizione.

## Distribuirlo con Esper

:::steps
### Caricare l'APK

Nella console di Esper, carica `oneuptime-android-agent.apk` nell'**App Library** e aggiungilo al blueprint dei dispositivi da monitorare.

### Inviare le sue impostazioni

Nel blueprint, apri la **Managed Configuration** dell'agent e incolla le sue impostazioni. Esper compila i segnaposto su ogni dispositivo, con Esper Agent 8.00.0764 o successivo:

```json title="Managed configuration"
{
  "oneuptime_url": "https://oneuptime.com",
  "oneuptime_token": "YOUR_TELEMETRY_INGESTION_TOKEN",
  "device_name": "${esper.deviceName}",
  "device_serial": "${esper.serialNumber}",
  "device_type": "kiosk",
  "labels": "region=emea"
}
```

Se ospiti OneUptime in proprio, inserisci il tuo URL in `oneuptime_url`. Poi esegui un Converge dei dispositivi, così leggono le nuove impostazioni.

### Avviarlo una volta

Android non avvia all'accensione un'app appena installata finché non è stata aperta una volta. Attiva **Launch on Start** per l'agent nel blueprint, in modalità Multi-App, oppure apri l'agent una volta su ogni dispositivo. Da quel momento si avvia da solo a ogni accensione del dispositivo, e dopo ogni aggiornamento.

### Trovare i dispositivi in OneUptime

Entro un minuto ogni dispositivo compare in **Host**, con il nome del suo `device_name`, e in **Inventario**. La schermata dell'agent sul dispositivo indica se sta inviando dati e, se non lo fa, cosa glielo impedisce.
:::

Gli altri gestori dei dispositivi funzionano allo stesso modo: aggiungi l'APK come app line-of-business o come app interna, imposta le stesse chiavi nella configurazione dell'app e aprila una volta su ogni dispositivo.

## Impostazioni

L'agent legge queste chiavi dalla sua configurazione gestita. Un dispositivo che non ne ha una si può configurare invece dalla schermata dell'agent, con l'URL, la chiave di acquisizione e il nome del dispositivo. Una chiave di acquisizione inserita lì viene salvata cifrata con l'Android Keystore.

| Chiave | Cosa imposta | Valore predefinito |
| --- | --- | --- |
| `oneuptime_url` | Il tuo URL di OneUptime | `https://oneuptime.com` |
| `oneuptime_token` | Una chiave di acquisizione **Server** | Nessuno: senza chiave l'agent non invia nulla |
| `device_name` | Il nome del dispositivo in **Host** e in **Inventario**, che lì ne costituisce l'identità | Il suo modello e l'inizio del suo Android ID |
| `device_serial` | Il suo numero di serie, che Android non fornisce alle app a partire da Android 10 | Nessuno |
| `device_type` | Che cosa è, ad esempio un chiosco, un terminale POS o un palmare | `Android device` |
| `device_location` | Dove si trova, ad esempio il numero di un negozio | Nessuno |
| `labels` | Etichette per l'host, come coppie `name=value` separate da virgole | Nessuno |
| `collection_interval_seconds` | Ogni quanto invia dati, da 30 a 600 secondi | `60` |
| `logcat_enabled` | Se invia ciò che legge da Logcat | `true` |
| `logcat_min_level` | Le righe di Logcat meno gravi che invia su Android 12 e versioni precedenti: `verbose`, `debug`, `info`, `warn`, `error` o `fatal` | `warn` |
| `installed_apps_enabled` | Se invia le app installate | `true` |

Un segnaposto che il tuo gestore dei dispositivi non ha compilato, come un `${esper.deviceName}` inviato così com'è, viene ignorato, e la schermata dell'agent lo segnala. Mantieni lo stesso `device_name` una volta che un dispositivo invia dati: un nuovo nome è un nuovo host.

## Leggere i log delle altre app

Android consente a un'app di leggere i log delle altre app solo con l'autorizzazione READ_LOGS, e solo adb può concederla: né l'app stessa né un criterio del dispositivo. Concedila una volta su ogni dispositivo, e resta concessa anche dopo riavvii e aggiornamenti:

```bash
adb shell pm grant com.oneuptime.androidagent android.permission.READ_LOGS
```

Con Esper, esegui quel comando tramite **Secure Remote ADB**: attiva l'accesso ADB per il dispositivo, connettiti con `espercli secureadb connect -d DEVICE_ID`, poi esegui il comando. Android riavvia l'agent quando l'autorizzazione viene concessa, e l'agent inizia subito a leggere.

Ciò che l'agent legge da quel momento dipende dalla versione di Android:

- Android 13 e successivi: i crash e gli ANR di ogni app. Android mostra le righe di log delle altre app solo a un'app che è sullo schermo, dopo che la persona davanti al dispositivo lo consente, quindi un agent in esecuzione in background non può leggerle.
- Android 12 e precedenti: i crash e gli ANR di ogni app, e le righe di log di ogni app di livello `logcat_min_level` o superiore.

Senza READ_LOGS, l'agent segnala tutto il resto, e la sua schermata e i log del dispositivo spiegano come concederla.

## Cosa segnala l'agent

| Cosa | Dove compare in OneUptime |
| --- | --- |
| Memoria, archiviazione, rete e tempo di attività | La pagina del dispositivo in **Host**: le stesse metriche che invia il collector di un server, quindi i modelli di avviso per gli host funzionano |
| Carica della batteria e temperatura, e se il dispositivo è collegato a un'alimentazione esterna | Le metriche `hw.battery.charge`, `hw.temperature` e `android.battery.plugged` |
| Stato termico | Le metriche `android.thermal.status` e `android.thermal.headroom` |
| Riavvii | **Log**, con `@event.name:device.boot`: da quanto tempo il dispositivo era acceso, se si è spento correttamente, per quanto tempo è rimasto spento, e i cicli di riavvio |
| App installate | **Log**, con `@event.name:android.package.inventory` una volta al giorno, e a ogni installazione, aggiornamento e rimozione |
| Crash e ANR di ogni app | **Eccezioni**, come non gestiti, con il nome dell'app |
| Marca, modello, numero di serie, versione del sistema operativo e firmware | L'elemento del dispositivo in **Inventario** |

Da Android 8 in poi, Android nasconde alle app l'uso della CPU del dispositivo, quindi l'agent segnala l'uso della CPU solo su Android 7 e sulle build che lo consentono.

I modelli di avviso per gli host adatti a un dispositivo sono Host Stopped Reporting, High Memory Utilization, High Filesystem Usage e Host Restarted. Un dispositivo che continua a riavviarsi scrive un log di livello avviso a ogni avvio, con `android.boot.recent_count` impostato sul numero di avvii nell'ultima ora.

## Risoluzione dei problemi

:::details Un dispositivo non compare in Host
Apri l'agent sul dispositivo: la sua schermata indica cosa manca, ad esempio una chiave di acquisizione, un URL che non può usare, o un invio non riuscito e il motivo. Su un dispositivo in cui l'agent non è mai stato aperto dopo l'installazione, l'agent non si è avviato: aprilo una volta, oppure attiva **Launch on Start**.
:::

:::details L'agent dice che OneUptime ha rifiutato la chiave di acquisizione
Usa una chiave **Server** attiva e non scaduta. Una chiave **Browser** viene rifiutata da un dispositivo.
:::

:::details Nessun log dalle altre app
Concedi READ_LOGS, come spiega [Leggere i log delle altre app](#leggere-i-log-delle-altre-app). Su Android 13 e successivi vengono letti solo i crash e gli ANR delle altre app.
:::

:::details Due dispositivi compaiono come un solo host
Hanno lo stesso `device_name`. Usa un segnaposto che cambi da un dispositivo all'altro, come `${esper.deviceName}` o `${esper.serialNumber}`.
:::

## Passaggi successivi

:::cards
- [Configurazione Android](/docs/rum/android-setup): Strumentare la tua app con OpenTelemetry Android.
- [Host](/docs/telemetry/hosts): Le pagine, le misure e gli avvisi di un host.
- [Monitor host](/docs/monitor/host-monitor): Ricevere un avviso quando un dispositivo smette di inviare dati o resta senza spazio di archiviazione.
- [Eccezioni](/docs/telemetry/exceptions): Smistare i crash e gli ANR che i tuoi dispositivi segnalano.
:::
