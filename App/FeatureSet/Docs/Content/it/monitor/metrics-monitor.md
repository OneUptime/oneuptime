# Monitor Metriche

Il monitoraggio delle metriche consente di monitorare metriche personalizzate dell'applicazione e dell'infrastruttura raccolte tramite OpenTelemetry. OneUptime valuta i valori delle metriche in una finestra temporale e attiva avvisi in base ai criteri configurati.

## Panoramica

I monitor metriche interrogano e valutano metriche numeriche dai servizi di telemetria. Questo consente di:

- Monitorare metriche personalizzate dell'applicazione (frequenze di richiesta, profondità della coda, frequenze di errore, ecc.)
- Tracciare metriche infrastrutturali (CPU, memoria, disco, rete)
- Creare query metriche complesse con filtri e aggregazioni
- Combinare più metriche usando formule matematiche
- Impostare avvisi basati su soglie metriche

## Creazione di un Monitor Metriche

1. Accedere a **Monitor** nel Dashboard di OneUptime
2. Fare clic su **Crea Monitor**
3. Selezionare **Metriche** come tipo di monitor
4. Configurare le query metriche e le formule opzionali
5. Selezionare la strategia di aggregazione
6. Configurare i criteri di monitoraggio secondo necessità

## Opzioni di Configurazione

### Query Metriche

Definire una o più query metriche. Ogni query include:

| Campo | Descrizione | Obbligatorio |
|-------|-------------|----------|
| Nome Metrica | Il nome della metrica da interrogare | Sì |
| Tipo di Aggregazione | Come aggregare i valori grezzi della metrica (sum, avg, min, max, count) | Sì |
| Attributi | Filtri chiave-valore per restringere i dati della metrica | No |
| Aggrega Per | Dimensioni per cui raggruppare la metrica | No |

A ciascuna query viene assegnato un alias (ad es. `a`, `b`, `c`) da usare nelle formule.

### Formule

Combinare più query metriche usando espressioni matematiche. Ad esempio:

- `a / b * 100` — Calcolare una percentuale da due query
- `a + b` — Sommare due metriche
- `a - b` — Differenza tra metriche

### Finestra Temporale Mobile

Selezionare la finestra temporale per la valutazione delle metriche:

- Ultimi 1 Minuto
- Ultimi 5 Minuti
- Ultimi 10 Minuti
- Ultimi 15 Minuti
- Ultimi 30 Minuti
- Ultimi 60 Minuti

### Strategia di Aggregazione

Scegliere come aggregare i valori delle metriche per la valutazione:

| Strategia | Descrizione |
|----------|-------------|
| Media | Valore medio nella finestra temporale |
| Somma | Somma di tutti i valori |
| Valore Massimo | Valore più alto nella finestra temporale |
| Valore Minimo | Valore più basso nella finestra temporale |
| Tutti i Valori | Tutti i valori devono soddisfare il criterio |
| Qualsiasi Valore | Almeno un valore deve soddisfare il criterio |

## Criteri di Monitoraggio

### Tipi di Controllo Disponibili

| Tipo di Controllo | Descrizione |
|------------|-------------|
| Valore Metrica | Il valore aggregato della query metrica o formula configurata |

### Tipi di Filtro

- **Maggiore Di** — Il valore della metrica supera una soglia
- **Minore Di** — Il valore della metrica è inferiore a una soglia
- **Maggiore o Uguale a** — Il valore della metrica è pari o superiore a una soglia
- **Minore o Uguale a** — Il valore della metrica è pari o inferiore a una soglia
- **Uguale a** — Il valore della metrica corrisponde esattamente
- **Diverso da** — Il valore della metrica non corrisponde

### Criteri di Esempio

#### Avviso se la frequenza di errore supera il 5%

- **Query a**: `http_requests_total` filtrata per `status=5xx`
- **Query b**: `http_requests_total`
- **Formula**: `a / b * 100`
- **Controlla Su**: Valore Metrica
- **Tipo Filtro**: Maggiore Di
- **Valore**: 5

#### Avviso se la profondità della coda di richieste è elevata

- **Query**: `request_queue_size`, aggregazione: Valore Massimo
- **Controlla Su**: Valore Metrica
- **Tipo Filtro**: Maggiore Di
- **Valore**: 1000

## Requisiti di Configurazione

Il monitoraggio delle metriche richiede che le proprie applicazioni o infrastrutture inviino metriche a OneUptime tramite OpenTelemetry. Vedere la documentazione [OpenTelemetry](/docs/telemetry/open-telemetry) per le istruzioni di configurazione.
