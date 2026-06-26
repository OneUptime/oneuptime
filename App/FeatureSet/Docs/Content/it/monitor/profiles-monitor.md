# Monitor Profili

Il monitoraggio dei profili consente di monitorare i dati di profiling continuo delle proprie applicazioni e attivare avvisi basati su conteggi e pattern di profilo. OneUptime valuta i dati di profilo dei propri servizi di telemetria in una finestra temporale.

## Panoramica

I monitor profili contano e filtrano i dati di profiling corrispondenti a criteri specifici. Questo consente di:

- Monitorare i dati di profiling continuo delle proprie applicazioni
- Filtrare i profili per tipo (CPU, memoria, goroutine, ecc.)
- Tracciare il volume e i pattern dei profili
- Ricevere avvisi su anomalie di profiling
- Filtrare per attributi personalizzati del profilo

## Creazione di un Monitor Profili

1. Accedere a **Monitor** nel Dashboard di OneUptime
2. Fare clic su **Crea Monitor**
3. Selezionare **Profili** come tipo di monitor
4. Selezionare i servizi di telemetria da monitorare
5. Configurare i filtri dei profili e i criteri secondo necessità

## Opzioni di Configurazione

### Servizi di Telemetria

Selezionare uno o più servizi da cui monitorare i profili. I servizi devono inviare dati di profiling continuo a OneUptime tramite OpenTelemetry.

### Filtri Profilo

| Filtro             | Descrizione                                                               | Obbligatorio |
| ------------------ | ------------------------------------------------------------------------- | ------------ |
| Tipi di Profilo    | Filtrare per nomi di tipo di profilo (ad es. CPU, memory, goroutines)     | No           |
| Attributi          | Coppie chiave-valore per filtrare su attributi personalizzati del profilo | No           |
| Finestra Temporale | Quanto indietro cercare nei profili (in secondi, predefinito: 60)         | No           |

## Criteri di Monitoraggio

### Tipi di Controllo Disponibili

| Tipo di Controllo | Descrizione                                                               |
| ----------------- | ------------------------------------------------------------------------- |
| Conteggio Profilo | Il numero di profili che corrispondono ai filtri nella finestra temporale |

### Tipi di Filtro

- **Maggiore Di** — Il conteggio dei profili supera una soglia
- **Minore Di** — Il conteggio dei profili è inferiore a una soglia
- **Maggiore o Uguale a** — Il conteggio dei profili è pari o superiore a una soglia
- **Minore o Uguale a** — Il conteggio dei profili è pari o inferiore a una soglia
- **Uguale a** — Il conteggio dei profili corrisponde esattamente
- **Diverso da** — Il conteggio dei profili non corrisponde

### Criteri di Esempio

#### Avviso se nessun profilo ricevuto in 5 minuti

- **Finestra Temporale**: 300 secondi
- **Controlla Su**: Conteggio Profilo
- **Tipo Filtro**: Uguale a
- **Valore**: 0

## Requisiti di Configurazione

Il monitoraggio dei profili richiede che le proprie applicazioni inviino dati di profiling continuo a OneUptime tramite OpenTelemetry. Vedere la documentazione [OpenTelemetry](/docs/telemetry/open-telemetry) per le istruzioni di configurazione.
