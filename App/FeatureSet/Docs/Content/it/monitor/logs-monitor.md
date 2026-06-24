# Monitor Log

Il monitoraggio dei log consente di monitorare i log dell'applicazione e attivare avvisi basati su pattern, conteggi e livelli di severità. OneUptime valuta i log dei propri servizi di telemetria e li confronta con i criteri configurati.

## Panoramica

I monitor log ricercano e contano i log corrispondenti a filtri specifici in una finestra temporale. Questo consente di:

- Ricevere avvisi su picchi di log di errore
- Monitorare pattern o messaggi di log specifici
- Tracciare il volume di log per livello di severità
- Filtrare i log per servizio, attributi e contenuto
- Rilevare problemi dell'applicazione dai pattern di log

## Creazione di un Monitor Log

1. Accedere a **Monitor** nel Dashboard di OneUptime
2. Fare clic su **Crea Monitor**
3. Selezionare **Log** come tipo di monitor
4. Selezionare i servizi di telemetria da monitorare
5. Configurare i filtri di log e i criteri secondo necessità

## Opzioni di Configurazione

### Servizi di Telemetria

Selezionare uno o più servizi da cui monitorare i log. I servizi devono inviare log a OneUptime tramite OpenTelemetry.

### Filtri Log

| Filtro              | Descrizione                                                           | Obbligatorio |
| ------------------- | --------------------------------------------------------------------- | ------------ |
| Livelli di Severità | Filtrare per severità del log (ERROR, WARN, INFO, DEBUG, ecc.)        | No           |
| Corpo               | Ricerca testuale nel corpo del messaggio di log                       | No           |
| Attributi           | Coppie chiave-valore per filtrare su attributi personalizzati del log | No           |
| Finestra Temporale  | Quanto indietro cercare nei log (in secondi, predefinito: 60)         | No           |

### Livelli di Severità

Filtrare i log per uno o più livelli di severità:

- **FATAL** / **EMERGENCY** / **CRITICAL**
- **ERROR**
- **WARN** / **WARNING**
- **INFO** / **INFORMATIONAL**
- **DEBUG**
- **TRACE**
- **UNSPECIFIED**

## Criteri di Monitoraggio

### Tipi di Controllo Disponibili

| Tipo di Controllo | Descrizione                                                           |
| ----------------- | --------------------------------------------------------------------- |
| Conteggio Log     | Il numero di log che corrispondono ai filtri nella finestra temporale |

### Tipi di Filtro

- **Maggiore Di** — Il conteggio dei log supera una soglia
- **Minore Di** — Il conteggio dei log è inferiore a una soglia
- **Maggiore o Uguale a** — Il conteggio dei log è pari o superiore a una soglia
- **Minore o Uguale a** — Il conteggio dei log è pari o inferiore a una soglia
- **Uguale a** — Il conteggio dei log corrisponde esattamente
- **Diverso da** — Il conteggio dei log non corrisponde

### Criteri di Esempio

#### Avviso se più di 100 log di errore in 60 secondi

- **Livelli di Severità**: ERROR
- **Finestra Temporale**: 60 secondi
- **Controlla Su**: Conteggio Log
- **Tipo Filtro**: Maggiore Di
- **Valore**: 100

#### Avviso se compaiono log fatali

- **Livelli di Severità**: FATAL
- **Finestra Temporale**: 60 secondi
- **Controlla Su**: Conteggio Log
- **Tipo Filtro**: Maggiore Di
- **Valore**: 0

#### Monitorare i log contenenti un messaggio di errore specifico

- **Corpo**: `database connection timeout`
- **Finestra Temporale**: 300 secondi
- **Controlla Su**: Conteggio Log
- **Tipo Filtro**: Maggiore Di
- **Valore**: 5

## Requisiti di Configurazione

Il monitoraggio dei log richiede che le proprie applicazioni inviino i log a OneUptime tramite OpenTelemetry. Vedere la documentazione [OpenTelemetry](/docs/telemetry/open-telemetry) per le istruzioni di configurazione.
