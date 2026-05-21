# Variabili e filtri

Una variabile trasforma una singola dashboard in un template. Aggiungi una variabile `service` alla tua dashboard e gli stessi grafici vengono ridisegnati per `checkout`, `payments` o `search` — chi guarda sceglie da un menu a tendina in cima invece che tu costruisca tre dashboard quasi identiche.

## Tipi di variabile

Aggiungi le variabili sotto **Dashboard → Settings → Variables**. Ogni variabile ha un nome (usato come `{{name}}` nei tuoi widget), un'etichetta opzionale e un tipo.

### Custom List

Un menu a tendina statico. Digiti tu stesso le opzioni.

Usalo quando: le scelte sono poche e fisse. `environment` con valori `prod, staging, dev`. `region` con valori `us-east-1, eu-west-1, ap-south-1`.

### Query

Le opzioni provengono da una query sui tuoi dati.

Usalo quando: le scelte cambiano nel tempo e vuoi che il menu a tendina si aggiorni. "Ogni ID cliente visto nelle ultime 24 ore." La query viene eseguita sui dati del tuo progetto e i risultati diventano il menu a tendina.

### Text Input

Un campo di testo libero. Cio che chi guarda digita viene utilizzato.

Usalo quando: vuoi che la dashboard funzioni come uno strumento di ricerca. Filtra per indirizzo IP, ID richiesta o qualsiasi altro valore libero.

### Telemetry Attribute

Le opzioni sono i valori distinti di un attributo nella tua telemetria sull'intervallo temporale della dashboard.

Configura la **chiave dell'attributo** (per esempio, `service.name`, `host.name`, `k8s.cluster.name`). Il menu a tendina si riempie con ogni valore distinto visto nei tuoi log, metriche e trace.

Usalo quando: le scelte corrispondono ai tag che gia invii con la tua telemetria. E il tipo piu comune perche si aggiorna automaticamente — quando rilasci un nuovo servizio taggato `service.name = inventory`, quel nome appare nel menu a tendina senza che tu modifichi la dashboard.

## Selezione multipla

Ogni variabile puo permettere selezioni multiple. Quando attiva, chi guarda puo selezionare uno o piu valori; la dashboard filtra in base a uno qualsiasi di essi.

Usa la selezione multipla quando: vuoi confrontare "checkout e payments insieme" senza uscire dalla dashboard. Evitala quando i calcoli non hanno senso sui valori selezionati (per esempio, fare la media delle medie).

## Valori predefiniti

Ogni variabile puo avere un valore predefinito. La dashboard viene renderizzata con il valore predefinito finche chi guarda non lo cambia. Per le dashboard pubbliche, il valore predefinito e cio che i visitatori vedono per primo.

## Come usare una variabile in un widget

Ovunque un widget accetti un filtro — il `WHERE` di una metrica, il filtro di un elenco, la corrispondenza di attributi di un log stream — puoi usare `{{variable_name}}`.

Per esempio, un grafico filtrato per servizio:

```
service.name = '{{service}}'
```

Quando il menu a tendina e impostato su `checkout`, il grafico filtra sul servizio checkout. Quando chi guarda passa a `payments`, il grafico viene ridisegnato per payments.

Per le variabili **Telemetry Attribute**, OneUptime sa a quale attributo si riferisce la variabile e applica il filtro a ogni widget che usa lo stesso attributo — non devi modificare ogni widget a mano.

## Intervallo temporale

L'intestazione della dashboard ha un intervallo temporale globale. Ogni widget di metrica esegue la query rispetto a questa finestra. Opzioni:

- **Preset** — ultima ora, 24 ore, 7 giorni, 30 giorni, 90 giorni (a seconda della tua retention dei dati).
- **Personalizzato** — scegli un'ora di inizio e di fine.

L'intervallo temporale fa parte dell'URL della dashboard — condividere l'URL condivide la finestra. Utile durante un incidente: blocca l'intervallo temporale su "10:00–10:30 UTC di oggi" e incolla il link nel canale dell'incidente.

## Intervallo di refresh

Accanto all'intervallo temporale, scegli con quale frequenza i widget rieseguono la query:

- **Off** — i widget eseguono la query una sola volta al caricamento della pagina.
- **5s / 10s / 30s / 1m / 5m / 15m** — auto-refresh.

L'auto-refresh va bene per uno schermo a muro o per una vista live durante un incidente. Lascialo disattivato quando stai indagando, cosi la vista resta ferma mentre la esamini.

## Mettendoli insieme

Una dashboard templatizzata per servizio ha tipicamente:

1. Una variabile `service` di tipo **Telemetry Attribute** per `service.name`. Default: il tuo servizio piu osservato. Selezione multipla disattivata (cosi i grafici mostrano sempre uno alla volta).
2. Una variabile `environment` di tipo **Custom List**. Default: `prod`.
3. Una variabile `cluster` di tipo **Telemetry Attribute** per `k8s.cluster.name`. Selezione multipla attivata (cosi puoi confrontare tra cluster).
4. Widget che fanno riferimento a queste variabili nei propri filtri.

Il risultato: una dashboard, ogni servizio coperto, tre menu a tendina in cima.

## Letture successive

- [Widget](/docs/dashboards/widgets) — come ciascun widget usa un filtro.
- [Condivisione e dashboard pubbliche](/docs/dashboards/sharing) — variabili e link condivisi.
- [Creazione di una dashboard](/docs/dashboards/authoring) — la meccanica del canvas.
