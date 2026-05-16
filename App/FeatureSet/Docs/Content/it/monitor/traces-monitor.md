# Monitor Tracce

Il monitoraggio delle tracce consente di monitorare le tracce distribuite delle proprie applicazioni e attivare avvisi basati su pattern, conteggi e stati degli span. OneUptime valuta i dati di traccia dei propri servizi di telemetria in una finestra temporale.

## Panoramica

I monitor tracce ricercano e contano gli span corrispondenti a filtri specifici. Questo consente di:

- Ricevere avvisi su picchi di span in errore nei propri servizi
- Monitorare operazioni ed endpoint specifici
- Tracciare il volume e i pattern degli span
- Filtrare per stato dello span, nome e attributi personalizzati
- Rilevare problemi di prestazioni e affidabilità dai dati di traccia

## Creazione di un Monitor Tracce

1. Accedere a **Monitor** nel Dashboard di OneUptime
2. Fare clic su **Crea Monitor**
3. Selezionare **Tracce** come tipo di monitor
4. Selezionare i servizi di telemetria da monitorare
5. Configurare i filtri degli span e i criteri secondo necessità

## Opzioni di Configurazione

### Servizi di Telemetria

Selezionare uno o più servizi da cui monitorare le tracce. I servizi devono inviare tracce a OneUptime tramite OpenTelemetry.

### Filtri Span

| Filtro | Descrizione | Obbligatorio |
|--------|-------------|----------|
| Stati Span | Filtrare per codice di stato dello span (OK, ERROR, UNSET) | No |
| Nome Span | Ricerca testuale per nomi di span specifici (ad es. nomi di operazioni o endpoint) | No |
| Attributi | Coppie chiave-valore per filtrare su attributi personalizzati degli span | No |
| Finestra Temporale | Quanto indietro cercare negli span (in secondi, predefinito: 60) | No |

### Codici di Stato degli Span

- **OK** — L'operazione è stata completata con successo
- **ERROR** — L'operazione ha incontrato un errore
- **UNSET** — Lo stato non è stato impostato esplicitamente

## Criteri di Monitoraggio

### Tipi di Controllo Disponibili

| Tipo di Controllo | Descrizione |
|------------|-------------|
| Conteggio Span | Il numero di span che corrispondono ai filtri nella finestra temporale |

### Tipi di Filtro

- **Maggiore Di** — Il conteggio degli span supera una soglia
- **Minore Di** — Il conteggio degli span è inferiore a una soglia
- **Maggiore o Uguale a** — Il conteggio degli span è pari o superiore a una soglia
- **Minore o Uguale a** — Il conteggio degli span è pari o inferiore a una soglia
- **Uguale a** — Il conteggio degli span corrisponde esattamente
- **Diverso da** — Il conteggio degli span non corrisponde

### Criteri di Esempio

#### Avviso se più di 50 span in errore in 60 secondi

- **Stati Span**: ERROR
- **Finestra Temporale**: 60 secondi
- **Controlla Su**: Conteggio Span
- **Tipo Filtro**: Maggiore Di
- **Valore**: 50

#### Avviso sugli errori in un endpoint specifico

- **Nome Span**: `POST /api/checkout`
- **Stati Span**: ERROR
- **Finestra Temporale**: 120 secondi
- **Controlla Su**: Conteggio Span
- **Tipo Filtro**: Maggiore Di
- **Valore**: 0

## Requisiti di Configurazione

Il monitoraggio delle tracce richiede che le proprie applicazioni inviino tracce distribuite a OneUptime tramite OpenTelemetry. Vedere la documentazione [OpenTelemetry](/docs/telemetry/open-telemetry) per le istruzioni di configurazione.
