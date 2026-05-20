# Variabili e filtri

Una variabile trasforma una singola dashboard in un template. Definisci una variabile `service` e lo stesso grafico si renderizza per `checkout`, `payments` e `search` — scegli da un dropdown in cima invece di costruire tre dashboard quasi identiche.

Questa pagina copre i quattro tipi di variabile, come i loro valori vengono iniettati nelle query dei widget e i controlli globali di intervallo temporale e refresh che stanno accanto a loro.

## Tipi di variabile

Aggiungi le variabili in **Dashboard → Settings → Variables**. Ognuna ha un nome (referenziato come `{{name}}` nelle query dei widget), una label opzionale e un tipo.

### Custom List

Un drop-down statico. Fornisci una lista di valori separati da virgola; il visualizzatore ne sceglie uno.

Usalo quando: l'insieme di scelte è piccolo, fisso e significativo solo per il tuo team. `environment` con valori `prod, staging, dev`. `region` con valori `us-east-1, eu-west-1, ap-south-1`.

### Query

Le opzioni del drop-down vengono calcolate da una query ClickHouse al render time.

Usalo quando: le scelte sono dinamiche e vivono nella tua telemetria. "Ogni customer ID che ha effettuato l'accesso nelle ultime 24 ore" tramite `SELECT DISTINCT customer_id FROM ...`. La query gira sui dati del tuo progetto; tratta il risultato come input non attendibile, anche se sono i tuoi dati.

### Text Input

Un campo di testo libero. Qualunque cosa il visualizzatore digiti viene iniettata.

Usalo quando: vuoi che la dashboard si comporti come uno strumento di ricerca. Una dashboard "filtra per IP" o "filtra per request ID".

### Telemetry Attribute

Le opzioni sono i valori distinti di una chiave attributo OpenTelemetry su tutta la telemetria del progetto, nell'intervallo temporale della dashboard.

Configura la **chiave attributo** (es. `k8s.cluster.name`, `service.name`, `host.name`). Il widget recupera i valori distinti da log / metriche / trace e li offre come drop-down.

Usalo quando: le scelte sono esattamente le entità con cui hai già taggato la tua telemetria. Nome del cluster, nome del servizio, regione, customer ID, ambiente di deployment — qualsiasi cosa tu invii già come attributo di risorsa o di span OpenTelemetry.

È il tipo di variabile più comune per le dashboard orientate al servizio perché si auto-aggiorna: quando spedisci un nuovo servizio taggato `service.name = inventory`, quel valore compare nel dropdown senza che nessuno modifichi la dashboard.

## Multi-select

Ogni variabile può essere configurata come **multi-select**. Quando è attivo, il visualizzatore sceglie uno o più valori; la dashboard filtra a `value IN (...)` invece di `value = ...`.

Usa multi-select quando: vuoi guardare "checkout + payments insieme" senza lasciare la dashboard. Evitalo quando la matematica del grafico non si somma su valori multipli — es. fare la media delle medie.

## Valori di default

Ogni variabile accetta un default opzionale. La dashboard si renderizza con il default fino a quando il visualizzatore non cambia il dropdown. Per le dashboard pubbliche, il default è ciò su cui atterrano i visitatori.

## Come funziona l'interpolazione

Ovunque una query di widget accetti un filtro stringa — la clausola `WHERE` di una query metrica, il filtro di un widget di tipo lista, il match per attributo di uno stream di log — puoi referenziare `{{variable_name}}`.

Per esempio, la query metrica di un Chart potrebbe essere:

```
SELECT avg(latency_ms) FROM spans WHERE service.name = '{{service}}'
```

Quando `service` è impostato a `checkout`, la query gira con `service.name = 'checkout'`. Quando il visualizzatore passa a `payments`, la query viene rieseguita con `service.name = 'payments'`.

In particolare per le variabili **Telemetry Attribute**, OneUptime conosce la chiave attributo e inietta il filtro in ogni widget che menziona lo stesso attributo — non devi modificare a mano la query di ogni widget quando cambia la variabile. È questa la magia che fa funzionare le dashboard templatizzate per servizio direttamente fuori dalla scatola.

## Intervallo temporale

L'header della dashboard ha un selettore globale di **intervallo temporale**. Ogni widget metrico interroga rispetto a questa finestra. Scelte:

- **Preset** — Ultima 1 ora, 24 ore, 7 giorni, 30 giorni, 90 giorni (in base alla tua retention).
- **Intervallo personalizzato** — scegli i timestamp di inizio e fine.

L'intervallo temporale fa parte dell'URL della dashboard — condividere l'URL condivide la finestra. È comodo durante un incidente: pinna l'intervallo temporale a "10:00–10:30 UTC oggi" e condividi il link nel canale dell'incidente.

## Intervallo di refresh

Accanto all'intervallo temporale, scegli con quale frequenza i widget rieseguono la query:

- **Off** — i widget interrogano una volta al caricamento.
- **5s / 10s / 30s / 1m / 5m / 15m** — auto-refresh.

L'auto-refresh è comodo per uno schermo a parete e per una vista di incidente in corso. Per investigazioni ad hoc, lascialo off così la vista resta stabile mentre fai scroll.

## Mettere tutto insieme

Una dashboard templatizzata per servizio ha tipicamente:

1. Una variabile `service` di tipo **Telemetry Attribute** legata a `service.name`. Default: il tuo servizio più osservato. Multi-select: off (così i grafici mostrano sempre un servizio alla volta).
2. Una variabile `environment` di tipo **Custom List**. Default: `prod`.
3. Una variabile `cluster` di tipo **Telemetry Attribute** legata a `k8s.cluster.name`. Multi-select: on (così puoi fare rollup tra cluster).
4. I widget della dashboard referenziano queste variabili nei loro filtri.

Il risultato: una sola dashboard, copertura dell'intera flotta, qualche drop-down in cima.

## Cosa leggere dopo

- [Widget](/docs/dashboards/widgets) — come ogni widget consuma un filtro.
- [Condivisione e dashboard pubbliche](/docs/dashboards/sharing) — le variabili negli URL, inclusi i loro valori per i link condivisi.
- [Creare una dashboard](/docs/dashboards/authoring) — la meccanica del canvas.
