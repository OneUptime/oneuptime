# Prodotti di dati

Le persone che usano i dati - analisti, il reparto finanza, i dirigenti, gli agenti IA - pensano in termini di ciò che usano: «le tabelle della dashboard dei ricavi», non i database. Un **prodotto di dati** dà un nome a quelle tabelle, con il suo proprietario, i suoi consumatori e il suo SLA di freschezza, e dice a chiunque ne dipenda se i dati di oggi sono arrivati.

## Creare un prodotto di dati

In **Osservabilità dei dati > Prodotti di dati**, crea un prodotto di dati: dagli un nome, scegli le sue tabelle e assegnagli uno SLA con uno di questi criteri o con entrambi:

- **Aggiornato entro un'ora del giorno (UTC):** i dati di ogni giorno arrivano quel giorno stesso, entro quell'ora. Da quell'ora in poi, ogni tabella deve essere cambiata in giornata; fino ad allora vale il caricamento di ieri. Un caricamento che arriva sempre con mezz'ora di ritardo è in ritardo per quella mezz'ora ogni giorno.
- **Un'età massima:** nessuna tabella può avere un'ultima modifica più vecchia di questo valore.

Ogni cinque minuti le tabelle di ogni prodotto vengono verificate rispetto al suo SLA. Il prodotto è **Late** quando lo è una qualsiasi delle sue tabelle, e i suoi dati risalgono all'ultima modifica più vecchia tra loro. Scrive `oneuptime.data.product.late_tables` e `oneuptime.data.product.data_age`, così puoi rappresentare in un grafico la freschezza di tutti i prodotti fianco a fianco.

## Sulle pagine di stato

Salvando un prodotto si crea anche un **monitor** per esso, a tuo nome e con le tue autorizzazioni. Il monitor è Degradato mentre una tabella è in ritardo, e apre un incidente e un avviso al livello di gravità più basso del tuo progetto, che si risolvono da soli. Aggiungilo come risorsa a una pagina di stato, privata o pubblica: i consumatori che si iscrivono vengono informati quando il prodotto è in ritardo e quando torna aggiornato. Vedi [Risorse della pagina di stato](/docs/status-pages/resources-and-groups).

## Come SLO

Salvando un prodotto si crea anche uno **SLO** sul suo monitor: la quota di tempo in cui i dati sono puntuali, rispetto all'obiettivo del prodotto su 30 giorni, con gli avvisi di burn rate rapido e lento con cui parte ogni SLO. Vedi [SLO](/docs/slo/introduction). Eliminando il prodotto si eliminano anche il suo monitor e il suo SLO.

## Il badge «data as of»

Ogni prodotto ha un **badge** che dice a quando risalgono i suoi dati, verde finché sono puntuali e ambra con «late» quando non lo sono. Incorporalo in una dashboard BI, in una pagina wiki o in un README dalla **Panoramica** del prodotto:

```markdown
![Data as of](https://oneuptime.com/api/data-observability/data-products/<data product ID>/badge?token=<badge token>)
```

Il suo link non richiede l'accesso, quindi trattalo come un link condiviso. **Reimposta link del badge** ne crea uno nuovo e ritira quello vecchio.

## Passaggi successivi

:::cards
- [Salute delle tabelle](/docs/data-observability/table-health): Come viene appresa la freschezza di ogni tabella.
- [OneUptime AI e l'API](/docs/data-observability/ai-and-api): Lascia che gli agenti IA verifichino le tabelle di un prodotto prima di usarle.
:::
