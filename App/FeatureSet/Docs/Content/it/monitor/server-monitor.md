# Monitor Server / VM

Il monitoraggio di server e VM consente di monitorare la salute e le prestazioni di server, macchine virtuali e altra infrastruttura installando un agente leggero che riporta le metriche di sistema a OneUptime.

## Panoramica

I monitor server usano un agente infrastrutturale installato sui propri server per raccogliere e segnalare metriche di sistema. Questo consente di:

- Monitorare l'uptime e la disponibilità del server
- Tracciare l'utilizzo di CPU, memoria e disco
- Monitorare i processi in esecuzione
- Impostare avvisi basati su soglie di utilizzo delle risorse
- Rilevare problemi infrastrutturali prima che impattino i servizi

## Creazione di un Monitor Server

1. Accedere a **Monitor** nel Dashboard di OneUptime
2. Fare clic su **Crea Monitor**
3. Selezionare **Server / VM** come tipo di monitor
4. Verrà generata una **Chiave Segreta** per questo monitor — sarà necessaria per configurare l'agente
5. Seguire le istruzioni di installazione per configurare l'agente sul server

## Installazione dell'Agente Infrastrutturale

L'Agente Infrastrutturale di OneUptime è un daemon leggero basato su Go che raccoglie le metriche di sistema e le invia a OneUptime ogni 30 secondi. Supporta Linux, macOS e Windows.

### Linux / macOS

```bash
# Installare l'agente
curl -sSL https://oneuptime.com/docs/static/scripts/infrastructure-agent/install.sh | sudo bash

# Configurare l'agente
sudo oneuptime-infrastructure-agent configure --secret-key=VOSTRA_CHIAVE_SEGRETA --oneuptime-url=https://oneuptime.com

# Avviare l'agente
sudo oneuptime-infrastructure-agent start
```

Sostituire `VOSTRA_CHIAVE_SEGRETA` con la chiave segreta mostrata nelle impostazioni del monitor, e `https://oneuptime.com` con l'URL della propria istanza OneUptime se self-hosted.

### Windows

1. Scaricare l'agente più recente da [GitHub Releases](https://github.com/OneUptime/oneuptime/releases/latest)
   - `oneuptime-infrastructure-agent_windows_amd64.zip` per sistemi x64
   - `oneuptime-infrastructure-agent_windows_arm64.zip` per sistemi ARM64
2. Estrarre il file zip
3. Aprire il Prompt dei comandi come Amministratore ed eseguire:

```bash
# Configurare l'agente
oneuptime-infrastructure-agent configure --secret-key=VOSTRA_CHIAVE_SEGRETA --oneuptime-url=https://oneuptime.com

# Avviare l'agente
oneuptime-infrastructure-agent start
```

### Supporto Proxy

Se il server si connette a Internet tramite un proxy, è possibile configurare l'agente per usarlo:

```bash
sudo oneuptime-infrastructure-agent configure --secret-key=VOSTRA_CHIAVE_SEGRETA --oneuptime-url=https://oneuptime.com --proxy-url=http://proxy.example.com:8080
```

## Comandi dell'Agente

L'agente infrastrutturale supporta i seguenti comandi:

| Comando     | Descrizione                                                                          |
| ----------- | ------------------------------------------------------------------------------------ |
| `configure` | Configurare l'agente con la chiave segreta e l'URL di OneUptime                      |
| `start`     | Avviare il servizio agente                                                           |
| `stop`      | Fermare il servizio agente                                                           |
| `restart`   | Riavviare il servizio agente                                                         |
| `status`    | Mostrare lo stato corrente del servizio                                              |
| `logs`      | Visualizzare i log dell'agente (usare `-n` per il numero di righe, `-f` per seguire) |
| `uninstall` | Disinstallare il servizio agente                                                     |

## Metriche Raccolte

L'agente raccoglie le seguenti metriche dal server:

### CPU

- **Percentuale Utilizzo CPU** — Utilizzo complessivo della CPU come percentuale
- **Core CPU** — Numero di core CPU

### Memoria

- **Memoria Totale** — Memoria totale disponibile
- **Memoria Usata** — Memoria attualmente in uso
- **Memoria Libera** — Memoria libera disponibile
- **Percentuale Utilizzo Memoria** — Utilizzo della memoria come percentuale

### Disco

Per ogni disco/volume montato:

- **Spazio Disco Totale** — Capacità totale del disco
- **Spazio Disco Usato** — Spazio attualmente in uso
- **Spazio Disco Libero** — Spazio libero disponibile
- **Percentuale Utilizzo Disco** — Utilizzo del disco come percentuale
- **Percorso Disco** — Percorso di montaggio del disco

### Processi

- **Nome Processo** — Nome del processo in esecuzione
- **ID Processo (PID)** — Identificatore del processo
- **Comando Processo** — Comando completo usato per avviare il processo

## Criteri di Monitoraggio

È possibile configurare criteri per determinare quando il server è considerato online, degradato o offline.

### Tipi di Controllo Disponibili

| Tipo di Controllo            | Descrizione                                                                  |
| ---------------------------- | ---------------------------------------------------------------------------- |
| È Online                     | Se l'agente del server sta riportando (basato su heartbeat)                  |
| Percentuale Utilizzo CPU     | Percentuale di utilizzo della CPU corrente                                   |
| Percentuale Utilizzo Memoria | Percentuale di utilizzo della memoria corrente                               |
| Percentuale Utilizzo Disco   | Percentuale di utilizzo del disco corrente (per un percorso disco specifico) |
| Nome Processo Server         | Verificare se è in esecuzione un processo con un nome specifico              |
| Comando Processo Server      | Verificare se è in esecuzione un processo con un comando specifico           |
| PID Processo Server          | Verificare se è in esecuzione un processo con un PID specifico               |

### Tipi di Filtro

Per le metriche numeriche (CPU, memoria, disco):

- **Maggiore Di** — Il valore supera una soglia
- **Minore Di** — Il valore è inferiore a una soglia
- **Maggiore o Uguale a** — Il valore è pari o superiore a una soglia
- **Minore o Uguale a** — Il valore è pari o inferiore a una soglia
- **Valuta Nel Tempo** — Valuta usando aggregazione (Media, Somma, Massimo, Minimo, Tutti i Valori, Qualsiasi Valore) su una finestra temporale

Per i controlli dei processi:

- **È in Esecuzione** — Il processo è attualmente in esecuzione
- **Non È in Esecuzione** — Il processo non è in esecuzione

### Criteri di Esempio

#### Considerare il server offline se l'agente smette di riportare

- **Controlla Su**: È Online
- **Tipo Filtro**: Falso

#### Avviso quando l'utilizzo della CPU supera il 90%

- **Controlla Su**: Percentuale Utilizzo CPU
- **Tipo Filtro**: Maggiore Di
- **Valore**: 90

#### Avviso quando l'utilizzo del disco supera l'85%

- **Controlla Su**: Percentuale Utilizzo Disco
- **Percorso Disco**: `/`
- **Tipo Filtro**: Maggiore Di
- **Valore**: 85

#### Avviso quando l'utilizzo della memoria supera l'80%

- **Controlla Su**: Percentuale Utilizzo Memoria
- **Tipo Filtro**: Maggiore Di
- **Valore**: 80

#### Avviso se un processo critico smette di funzionare

- **Controlla Su**: Nome Processo Server
- **Tipo Filtro**: Non È in Esecuzione
- **Valore**: `nginx`

## Risoluzione dei Problemi

### L'agente non riporta

- Verificare che l'agente sia in esecuzione: `sudo oneuptime-infrastructure-agent status`
- Controllare i log dell'agente: `sudo oneuptime-infrastructure-agent logs -n 50`
- Confermare che la chiave segreta sia corretta
- Assicurarsi che il server possa raggiungere l'URL della propria istanza OneUptime
- Controllare che le regole del firewall consentano le connessioni HTTPS in uscita

### Alto utilizzo di risorse da parte dell'agente

L'agente è progettato per essere leggero. Se si nota un alto utilizzo delle risorse:

- Riavviare l'agente: `sudo oneuptime-infrastructure-agent restart`
- Controllare i log dell'agente per errori

### Problemi con il proxy

- Verificare che l'URL e la porta del proxy siano corretti
- Assicurarsi che il proxy consenta le connessioni all'istanza OneUptime
- Riconfigurare con: `sudo oneuptime-infrastructure-agent configure --proxy-url=http://proxy:porta --secret-key=VOSTRA_CHIAVE --oneuptime-url=VOSTRO_URL`

## Buone Pratiche

1. **Impostare soglie significative** — Configurare criteri di stato degradato e offline che corrispondano agli intervalli operativi normali del server
2. **Monitorare i processi critici** — Usare il monitoraggio dei processi per assicurarsi che servizi essenziali come web server e database siano sempre in esecuzione
3. **Monitorare l'utilizzo del disco in modo proattivo** — I problemi di spazio su disco possono causare a cascata fallimenti dell'applicazione; impostare avvisi ben prima che i dischi siano pieni
4. **Usare "Valuta Nel Tempo"** — Per metriche come la CPU che possono avere picchi brevi, usare l'aggregazione temporale per evitare falsi avvisi
5. **Mantenere aggiornato l'agente** — Aggiornare periodicamente l'agente infrastrutturale per ottenere i più recenti miglioramenti e correzioni
