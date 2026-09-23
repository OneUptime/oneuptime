# Monitor delle Eccezioni

Il monitoraggio delle eccezioni ti consente di monitorare le eccezioni e gli errori delle applicazioni, attivando avvisi quando il numero di eccezioni supera le soglie configurate. OneUptime valuta i dati delle eccezioni dai tuoi servizi di telemetria in una finestra temporale.

## Panoramica

I monitor delle eccezioni contano e filtrano le eccezioni che corrispondono a criteri specifici. Questo ti consente di:

- Avvisare in caso di picchi di eccezioni nelle tue applicazioni
- Monitorare tipi specifici di eccezioni
- Limitare gli avvisi a un ambiente di deployment come `production`
- Cercare eccezioni per messaggio di errore
- Tracciare separatamente le eccezioni risolte e attive
- Rilevare problemi di stabilità dell'applicazione dai pattern di errore

## Creazione di un Monitor delle Eccezioni

1. Vai su **Monitor** nella Dashboard di OneUptime
2. Clicca su **Crea monitor**
3. Seleziona **Eccezioni** come tipo di monitor
4. Seleziona i servizi di telemetria da monitorare
5. Configura i filtri e i criteri delle eccezioni secondo necessità

## Opzioni di Configurazione

### Servizi di Telemetria

Seleziona uno o più servizi da cui monitorare le eccezioni. I servizi devono inviare dati delle eccezioni a OneUptime tramite OpenTelemetry.

### Filtri delle Eccezioni

| Filtro             | Descrizione                                                                     | Obbligatorio |
| ------------------ | ------------------------------------------------------------------------------- | ------------ |
| Tipi di Eccezione  | Filtra per nomi del tipo di eccezione (es. `NullPointerException`, `TypeError`) | No           |
| Ambienti           | Filtra per ambiente di deployment (es. `production`, `staging`)                 | No           |
| Messaggio          | Ricerca testuale nei messaggi delle eccezioni                                   | No           |
| Includi Risolte    | Includi le eccezioni contrassegnate come risolte (predefinito: false)           | No           |
| Includi Archiviate | Includi le eccezioni archiviate (predefinito: false)                            | No           |
| Finestra Temporale | Quanto indietro cercare le eccezioni (in secondi, predefinito: 60)              | No           |

### Ambienti

Gli ambienti provengono dall'attributo di risorsa OpenTelemetry `deployment.environment` di ciascuna eccezione, lo stesso valore che l'explorer delle eccezioni filtra con `env:production`. Inserisci un ambiente, o più ambienti separati da virgole; un'eccezione viene conteggiata quando il suo ambiente corrisponde a uno qualsiasi di essi.

La corrispondenza è esatta e fa distinzione tra maiuscole e minuscole: `production` non corrisponde a `Production` né a `prod`. Le eccezioni senza ambiente non vengono conteggiate quando questo filtro è impostato. Lascialo vuoto per conteggiare le eccezioni di tutti gli ambienti, comprese quelle senza ambiente.

Il filtro per ambiente viene combinato con tutti gli altri filtri, quindi un monitor limitato a un servizio di telemetria e a `production` conteggia solo le eccezioni di produzione di quel servizio.

Quando crei il monitor tramite l'API, imposta `environments` nell'`exceptionMonitor` del passaggio su un elenco di nomi di ambiente:

```json
{
  "exceptionMonitor": {
    "telemetryServiceIds": [],
    "environments": ["production"],
    "exceptionTypes": [],
    "message": "",
    "includeResolved": false,
    "includeArchived": false,
    "lastXSecondsOfExceptions": 300
  }
}
```

## Criteri di Monitoraggio

### Tipi di Controllo Disponibili

| Tipo di Controllo | Descrizione                                                                   |
| ----------------- | ----------------------------------------------------------------------------- |
| Exception Count   | Il numero di eccezioni corrispondenti ai tuoi filtri nella finestra temporale |

### Tipi di Filtro

- **Greater Than** — Il conteggio delle eccezioni supera una soglia
- **Less Than** — Il conteggio delle eccezioni è al di sotto di una soglia
- **Greater Than or Equal To** — Il conteggio delle eccezioni è uguale o superiore a una soglia
- **Less Than or Equal To** — Il conteggio delle eccezioni è uguale o inferiore a una soglia
- **Equal To** — Il conteggio delle eccezioni corrisponde esattamente
- **Not Equal To** — Il conteggio delle eccezioni non corrisponde

### Esempi di Criteri

#### Avvisa se più di 10 eccezioni in 60 secondi

- **Finestra temporale**: 60 secondi
- **Controlla Su**: Exception Count
- **Tipo di filtro**: Greater Than
- **Valore**: 10

#### Avvisa su qualsiasi NullPointerException

- **Tipi di eccezione**: `NullPointerException`
- **Finestra temporale**: 60 secondi
- **Controlla Su**: Exception Count
- **Tipo di filtro**: Greater Than
- **Valore**: 0

#### Avvisa solo sulle eccezioni di produzione

- **Ambienti**: `production`
- **Finestra temporale**: 300 secondi
- **Controlla Su**: Exception Count
- **Tipo di filtro**: Greater Than
- **Valore**: 5

#### Monitora le eccezioni contenenti un messaggio specifico

- **Messaggio**: `out of memory`
- **Finestra temporale**: 300 secondi
- **Controlla Su**: Exception Count
- **Tipo di filtro**: Greater Than
- **Valore**: 0

## Requisiti di Configurazione

Il monitoraggio delle eccezioni richiede che le tue applicazioni inviino dati delle eccezioni a OneUptime tramite OpenTelemetry. Consulta la documentazione di [OpenTelemetry](/docs/telemetry/open-telemetry) per le istruzioni di configurazione.
