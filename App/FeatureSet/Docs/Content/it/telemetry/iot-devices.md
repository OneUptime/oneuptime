# Dispositivi IoT di OneUptime

## Panoramica

OneUptime monitora flotte di dispositivi IoT — sensori, gateway, controller e box edge — acquisendo un piccolo insieme di metriche `iot_*`, contrassegnate dalla **flotta** a cui appartiene ogni lettura e dal proprio **device id**. OneUptime raggruppa quelle metriche in una flotta, costruisce un inventario di dispositivi in tempo reale e tiene traccia, per ogni dispositivo, di batteria, connettività, temperatura, CPU, memoria e disponibilità.

I dispositivi possono inviare le letture in due modi, ed entrambi alimentano esattamente lo stesso inventario di flotta, le stesse dashboard e gli stessi monitor:

- **OpenTelemetry (OTLP)** — un SDK OTel sul dispositivo, oppure un OpenTelemetry Collector su un gateway che distribuisce verso molti dispositivi.
- **MQTT** — connettiti direttamente all'endpoint MQTT integrato di OneUptime (MQTT su WebSocket all'indirizzo `wss://<your-host>/mqtt`, oppure MQTT TCP grezzo nei deployment self-hosted) e pubblica letture JSON. Nessun collector richiesto, e il supporto Last Will offre un rilevamento offline immediato.

Non c'è alcun agente proprietario da installare sul lato dispositivo. Questa pagina è la **guida all'acquisizione**. Per configurare i monitor e gli avvisi IoT sopra i dati che invii, consulta [IoT Device Monitor](/docs/monitor/iot-device-monitor).

## Prerequisiti

- Un dispositivo, gateway o collector in grado di inviare OTLP/HTTP a OneUptime
- Raggiungibilità di rete dal dispositivo/gateway verso la tua istanza di OneUptime
- Un **OneUptime Telemetry Ingestion Token** — creane uno da _Project Settings → Telemetry Ingestion Keys_ e copia il valore `x-oneuptime-token`

## Come OneUptime Modella l'IoT

OneUptime mappa i tuoi dispositivi su due concetti utilizzando gli attributi di risorsa di OpenTelemetry:

- **Flotta** — un gruppo logico di dispositivi (per esempio `building-a-sensors` o `field-gateways`). La flotta è derivata dall'attributo di risorsa `iot.fleet.name` e appare in OneUptime come il servizio di telemetria `iot/<fleet>`. Imposta `service.name=iot/<fleet>` in modo che log e metriche si allineino sotto lo stesso servizio.
- **Dispositivo** — un singolo dispositivo all'interno di una flotta, identificato dall'attributo `device.id`. OneUptime costruisce e mantiene un inventario di dispositivi per flotta indicizzato su `device.id`.

Gli attributi opzionali affinano il modo in cui ciascun dispositivo è classificato e delimitato nei monitor:

| Attributo            | Obbligatorio | Descrizione                                                                      |
| -------------------- | -------- | -------------------------------------------------------------------------------- |
| `iot.fleet.name`     | Sì       | La flotta a cui appartiene questo dispositivo. Diventa il servizio OneUptime `iot/<fleet>`    |
| `device.id`          | Sì       | Id stabile e univoco del dispositivo all'interno della flotta                                |
| `iot.device.kind`    | No       | La classe del dispositivo — per esempio `Device`, `Sensor` o `Gateway`. Il valore predefinito è `Device` |
| `iot.device.type`    | No       | Un tipo/modello di dispositivo più specifico usato per filtrare i monitor (per esempio `temp-sensor`) |
| `iot.device.firmware`| No       | Versione del firmware riportata dal dispositivo                                          |

## Invio delle Metriche tramite l'SDK OpenTelemetry

Se il tuo dispositivo esegue direttamente un SDK OpenTelemetry, puntalo a OneUptime e applica gli attributi di risorsa IoT tramite le variabili d'ambiente standard `OTEL_*`. Sostituisci il token, l'endpoint, il nome della flotta e il device id con i valori del tuo ambiente.

```bash
export OTEL_EXPORTER_OTLP_ENDPOINT=https://oneuptime.com/otlp
export OTEL_EXPORTER_OTLP_HEADERS=x-oneuptime-token=YOUR_TELEMETRY_INGESTION_TOKEN
export OTEL_RESOURCE_ATTRIBUTES=iot.fleet.name=building-a-sensors,device.id=sensor-001,service.name=iot/building-a-sensors
```

| Variabile d'Ambiente          | Obbligatoria | Descrizione                                                                                          |
| ----------------------------- | -------- | ---------------------------------------------------------------------------------------------------- |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | Sì       | Endpoint OTLP di OneUptime (`https://oneuptime.com/otlp`, oppure `http(s)://YOUR-ONEUPTIME-HOST/otlp` in self-hosted) |
| `OTEL_EXPORTER_OTLP_HEADERS`  | Sì       | `x-oneuptime-token=YOUR_TELEMETRY_INGESTION_TOKEN`                                                    |
| `OTEL_RESOURCE_ATTRIBUTES`    | Sì       | Attributi di risorsa separati da virgole. Devono includere `iot.fleet.name`, `device.id` e `service.name=iot/<fleet>` |

Emetti le tue letture come metriche utilizzando i nomi `iot_*` riportati di seguito (vedi [Convenzioni sulle Metriche](#convenzioni-sulle-metriche)). Entro circa un minuto il dispositivo appare nella sezione **IoT** della dashboard di OneUptime.

## Invio delle Metriche tramite un OpenTelemetry Collector

Quando molti dispositivi riportano attraverso un gateway, esegui un OpenTelemetry Collector sul gateway ed esporta verso OneUptime. Il processore `resource` applica gli attributi della flotta; ricevi le letture dai tuoi dispositivi (OTLP, bridge MQTT, file di log, ecc.) e inoltrale:

```yaml
receivers:
  otlp:
    protocols:
      grpc:
        endpoint: 0.0.0.0:4317
      http:
        endpoint: 0.0.0.0:4318

processors:
  batch:
    send_batch_size: 512
    timeout: 5s
  resource:
    attributes:
      - key: iot.fleet.name
        value: field-gateways
        action: upsert
      - key: service.name
        value: iot/field-gateways
        action: upsert

exporters:
  otlphttp:
    endpoint: "https://oneuptime.com/otlp"
    headers:
      "x-oneuptime-token": "YOUR_TELEMETRY_INGESTION_TOKEN"

service:
  pipelines:
    metrics:
      receivers: [otlp]
      processors: [resource, batch]
      exporters: [otlphttp]
```

- **`resource`** applica a ogni record gli attributi della flotta. Imposta `iot.fleet.name` (e il corrispondente `service.name=iot/<fleet>`) per ciascun gateway in modo che i dispositivi di ogni gateway finiscano nella flotta corretta.
- Mantieni `device.id` (e facoltativamente `iot.device.kind` / `iot.device.type` / `iot.device.firmware`) su ciascun datapoint affinché OneUptime possa risolvere il singolo dispositivo all'interno della flotta.
- **`otlphttp`** invia a OneUptime tramite HTTPS con il token di acquisizione allegato. Sono accettate sia la codifica protobuf predefinita sia `encoding: json`.

## Invio delle Metriche tramite MQTT

OneUptime include un endpoint MQTT integrato, così i dispositivi che parlano già MQTT possono inviare le letture direttamente — senza alcun SDK OpenTelemetry, collector o bridge. Tutto ciò che viene pubblicato tramite MQTT finisce nella stessa pipeline di OTLP: le flotte vengono create automaticamente, l'inventario dei dispositivi si aggiorna e ogni monitor e template di avviso IoT funziona senza modifiche.

**Endpoint**

| Trasporto             | Indirizzo                              | Note                                                                                     |
| --------------------- | -------------------------------------- | ----------------------------------------------------------------------------------------- |
| MQTT su WebSocket     | `wss://<your-host>/mqtt`               | Funziona su qualsiasi deployment — viaggia sulla normale porta HTTPS attraverso l'ingress di OneUptime |
| MQTT su TCP           | `<app-host>:1883` (`MQTT_INGEST_PORT`) | Self-hosted: per impostazione predefinita interno alla rete del cluster/compose; esponilo se ti serve |

**Autenticazione** — due opzioni:

- **A livello di progetto**: invia il tuo **Telemetry Ingestion Token** come password MQTT (lo username viene ignorato; se il tuo client espone solo un campo username, inserisci lì il token). Adatto ai gateway che pubblicano per conto di molti dispositivi.
- **Per dispositivo** (consigliato per i dispositivi che si connettono direttamente): registra il dispositivo nella scheda **Device Registry** della flotta all'interno della dashboard. La registrazione emette una credenziale per dispositivo — l'id della credenziale è lo **username** MQTT e il segreto è la **password**. I client autenticati per dispositivo possono pubblicare solo sotto i propri topic `oneuptime/<fleet>/<device>/…`, un singolo dispositivo compromesso può essere revocato dalla dashboard senza toccare il resto della flotta (la revoca ha effetto entro circa un minuto, anche per le sessioni già connesse) e i dispositivi registrati ottengono il **rilevamento offline anche in caso di morte silenziosa**: restano nell'inventario come Offline invece di scomparire quando smettono di riportare, e il template di avviso Device Offline si attiva per loro anche se muoiono senza un Last Will.

Le credenziali non valide vengono rifiutate al CONNECT con return code 4 (bad username or password), così un dispositivo mal configurato fallisce in modo evidente.

**Topic** — pubblica sotto il prefisso fisso `oneuptime/`. I segmenti di flotta e dispositivo non devono contenere `/`, `+` o `#` e sono limitati a 100 caratteri:

| Topic                                            | Payload                                                                                              |
| ------------------------------------------------ | ---------------------------------------------------------------------------------------------------- |
| `oneuptime/<fleet>/<device>/telemetry`           | Oggetto JSON di letture — `{ "metrics": { "iot_temperature_celsius": 21.5 } }`, oppure un oggetto piatto i cui campi numerici sono le metriche |
| `oneuptime/<fleet>/<device>/metrics/<metricName>`| Un singolo valore — un numero semplice (`23.4`) oppure `{ "value": 23.4 }`                            |
| `oneuptime/<fleet>/<device>/status`              | `"online"` oppure `"offline"` (anche `1`/`0`, `true`/`false`, `up`/`down`) — mappato su `iot_device_up` |

I payload di telemetria possono anche portare `"attributes"` (una mappa di stringhe applicata a ogni datapoint — usala per `iot.device.kind`, `iot.device.type`, `iot.device.firmware` o per le tue etichette) e `"timestamp"` (ISO-8601, oppure secondi/millisecondi unix). Entrambi sono facoltativi; quando `timestamp` è assente viene usato l'orario di acquisizione.

**Rilevamento offline con Last Will** — registra un Last Will MQTT su `oneuptime/<fleet>/<device>/status` con payload `offline`. Se il dispositivo muore o esce dalla rete, il broker pubblica `iot_device_up = 0` per suo conto nel momento in cui la sessione termina — il che fa scattare il template di avviso **Device Offline** predefinito e porta il dispositivo a Down nell'inventario, senza polling e senza attendere uno scrape mancato. Pubblica `online` sullo stesso topic dopo la connessione affinché il dispositivo torni a mostrarsi come Up.

Esempio con `mosquitto_pub` (TCP grezzo, self-hosted):

```bash
mosquitto_pub -h YOUR-ONEUPTIME-APP-HOST -p 1883 \
  -u oneuptime -P "YOUR_TELEMETRY_INGESTION_TOKEN" \
  -t "oneuptime/building-a-sensors/sensor-001/telemetry" \
  -m '{"metrics":{"iot_device_up":1,"iot_battery_percent":87,"iot_temperature_celsius":21.5},"attributes":{"iot.device.type":"temp-sensor","iot.device.firmware":"1.4.2"}}'
```

Esempio con `mqtt` per Node.js su WebSocket (funziona con oneuptime.com e con qualsiasi istanza self-hosted):

```javascript
const mqtt = require("mqtt");

const client = mqtt.connect("wss://oneuptime.com/mqtt", {
  username: "oneuptime", // ignorato — è il token qui sotto che autentica
  password: "YOUR_TELEMETRY_INGESTION_TOKEN",
  will: {
    topic: "oneuptime/building-a-sensors/sensor-001/status",
    payload: "offline",
  },
});

client.on("connect", () => {
  client.publish("oneuptime/building-a-sensors/sensor-001/status", "online");
  setInterval(() => {
    client.publish(
      "oneuptime/building-a-sensors/sensor-001/telemetry",
      JSON.stringify({
        metrics: {
          iot_device_up: 1,
          iot_battery_percent: readBattery(),
          iot_temperature_celsius: readTemperature(),
        },
      }),
    );
  }, 60 * 1000);
});
```

Esempio con `paho-mqtt` per Python su WebSocket:

```python
import json
import paho.mqtt.client as mqtt

client = mqtt.Client(transport="websockets")
client.username_pw_set("oneuptime", "YOUR_TELEMETRY_INGESTION_TOKEN")
client.tls_set()
client.will_set("oneuptime/building-a-sensors/sensor-001/status", "offline")
client.ws_set_options(path="/mqtt")
client.connect("oneuptime.com", 443)

client.publish("oneuptime/building-a-sensors/sensor-001/status", "online")
client.publish(
    "oneuptime/building-a-sensors/sensor-001/telemetry",
    json.dumps({"metrics": {"iot_device_up": 1, "iot_temperature_celsius": 21.5}}),
)
```

Note:

- L'endpoint è di **sola acquisizione**: le sottoscrizioni vengono rifiutate (SUBACK con esito negativo). Usa QoS 1 se vuoi che il broker confermi la ricezione. L'acquisizione è **at-least-once** — una ritrasmissione QoS 1/2 dopo una conferma persa può produrre datapoint duplicati.
- Le pubblicazioni al di fuori del contratto dei topic o con payload malformati vengono accettate e **scartate** (MQTT 3.1.1 non prevede una risposta di errore per messaggio) — il server registra un warning con il motivo, quindi controlla i log dell'app OneUptime se i dati non arrivano.
- Sull'endpoint WebSocket, mantieni il keepalive MQTT **sotto i 5 minuti** — l'ingress di OneUptime chiude le connessioni WebSocket inattive dopo 300 secondi, il che farebbe scattare il tuo Last Will e un falso avviso Device Offline. I valori predefiniti delle librerie client (60 s per `mqtt` e `paho-mqtt`) vanno bene. L'endpoint TCP grezzo non ha questo limite.
- I payload sono limitati a 128 KB e 100 metriche per pubblicazione; i pacchetti sovradimensionati fanno cadere la connessione.

## Convenzioni sulle Metriche

OneUptime riconosce i seguenti nomi di metrica `iot_*`. Ogni datapoint dovrebbe portare l'etichetta `device.id` in modo che la lettura sia attribuita al dispositivo corretto. Devi inviare solo le metriche che hanno senso per il tuo dispositivo — quelle mancanti semplicemente non vengono rappresentate sui grafici.

| Nome della Metrica          | Significato                                                                     |
| --------------------------- | ------------------------------------------------------------------------------ |
| `iot_device_up`             | Disponibilità del dispositivo. `1` = attivo/raggiungibile, `0` = inattivo. Alimenta il monitor IoT Device |
| `iot_device_info`           | Segnale di sola identità. Porta `device.id` / kind / type / firmware così che un dispositivo appaia nell'inventario anche prima di riportare letture |
| `iot_battery_percent`       | Livello di carica della batteria, da `0` a `100` (%)                                            |
| `iot_signal_strength_dbm`   | Potenza del segnale wireless in dBm (per esempio RSSI Wi-Fi / LoRa / cellulare)      |
| `iot_temperature_celsius`   | Temperatura del dispositivo o del sensore in °C                                             |
| `iot_cpu_usage_ratio`       | Utilizzo della CPU come rapporto da `0` a `1` (OneUptime lo memorizza come percentuale)        |
| `iot_memory_usage_bytes`    | Memoria attualmente utilizzata, in bytes                                                |
| `iot_memory_size_bytes`     | Memoria totale disponibile sul dispositivo, in bytes                                 |
| `iot_uptime_seconds`        | Secondi trascorsi dall'ultimo avvio del dispositivo                                           |

## Verifica dell'Installazione

1. Conferma che il tuo dispositivo o gateway stia esportando senza errori (controlla i log dell'SDK/collector per fallimenti di esportazione e risposte HTTP `401`/`403`).
2. Nella dashboard di OneUptime, apri la sezione **IoT** — la tua flotta dovrebbe apparire come `iot/<fleet>` entro circa un minuto.
3. Apri la scheda **Devices** della flotta — ogni `device.id` che hai inviato dovrebbe essere elencato con i valori più recenti di batteria, segnale, temperatura, CPU, memoria e stato attivo/inattivo.
4. Apri **Metrics** all'interno della flotta per rappresentare su grafico una qualsiasi delle serie `iot_*` di cui sopra.

## Risoluzione dei Problemi

### La Flotta Non Appare

1. Verifica che `iot.fleet.name` sia impostato come attributo di **risorsa** (non come etichetta del datapoint) e che `service.name` sia `iot/<fleet>`.
2. Conferma che l'endpoint dell'exporter sia `https://oneuptime.com/otlp` (o il tuo `…/otlp` self-hosted) e che l'header `x-oneuptime-token` contenga un token valido.
3. Se usi MQTT, conferma che il topic segua esattamente `oneuptime/<fleet>/<device>/…` — è il segmento di flotta del topic a creare la flotta.

### Dispositivi Mancanti dall'Inventario

1. Assicurati che ogni datapoint porti un'etichetta `device.id` — i dispositivi sono indicizzati su di essa.
2. Invia `iot_device_info` (sola identità) per i dispositivi che non hanno ancora riportato letture, così da farli comunque comparire nell'inventario.
3. Controlla che i valori di `device.id` siano stabili tra un report e l'altro; un id che cambia crea righe di dispositivo duplicate.

### HTTP 401 / 403 dall'Exporter

Il token di acquisizione non è valido, è stato revocato o è mancante. Generane uno nuovo da _Project Settings → Telemetry Ingestion Keys_ e aggiorna l'header `x-oneuptime-token`.

### Le Metriche Non Vengono Rappresentate sui Grafici

1. Conferma di utilizzare esattamente i nomi di metrica `iot_*` della tabella [Convenzioni sulle Metriche](#convenzioni-sulle-metriche) — i nomi non riconosciuti vengono memorizzati come metriche generiche e non popoleranno i grafici IoT.
2. Ricorda che `iot_cpu_usage_ratio` è un rapporto da `0` a `1`; invia il rapporto grezzo e OneUptime lo rappresenta come percentuale.
3. Concedi fino a un minuto perché i primi datapoint emergano dopo che un dispositivo inizia a riportare.

## OneUptime Self-hosted

Se stai eseguendo OneUptime in self-hosting, punta l'endpoint alla tua istanza:

```bash
export OTEL_EXPORTER_OTLP_ENDPOINT=https://your-oneuptime-host.example.com/otlp
```

Oppure, in un collector:

```yaml
exporters:
  otlphttp:
    endpoint: https://your-oneuptime-host.example.com/otlp
    headers:
      "x-oneuptime-token": "YOUR_TELEMETRY_INGESTION_TOKEN"
```

Per MQTT, connettiti a `wss://your-oneuptime-host.example.com/mqtt`, oppure esponi la porta MQTT TCP grezza del servizio app (`MQTT_INGEST_PORT`, predefinita `1883`) se i tuoi dispositivi non sono in grado di parlare WebSocket. Imposta `MQTT_INGEST_ENABLED=false` sul servizio app per disattivare completamente i listener MQTT.

Se la tua istanza è solo HTTP, cambia lo schema in `http://` (e `ws://` per MQTT) e usa la porta appropriata.

## Passi successivi

- Configura un **IoT Device Monitor** per ricevere avvisi su condizioni di dispositivo offline, batteria scarica, segnale debole, temperatura elevata e CPU elevata — vedi [IoT Device Monitor](/docs/monitor/iot-device-monitor).
- Per host non containerizzati (VM Linux / macOS / Windows e bare metal), usa l'[Host OpenTelemetry Collector](/docs/telemetry/host-otel-collector).
- Per approfondire l'integrazione OTLP sottostante, consulta [Integrare OpenTelemetry con OneUptime](/docs/telemetry/open-telemetry).
