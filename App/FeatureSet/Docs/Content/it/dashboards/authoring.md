# Creare una dashboard

Crea una dashboard in **Dashboards → Create Dashboard**, dalle un nome e aprila. Il canvas si apre in modalità **Edit**, pronto per i widget.

## Il canvas

Una dashboard è una griglia. Il canvas predefinito è **12 unità di dashboard di larghezza** per **60 unità di altezza** — puoi far crescere l'altezza aggiungendo righe oltre il fondo. Ogni unità è un quadrato che si scala con il viewport: su un desktop è più largo che su un telefono, ma ogni widget mantiene le sue proporzioni.

I widget occupano un rettangolo di unità. Decidi sia la posizione (angolo in alto a sinistra, misurato in unità dall'angolo in alto a sinistra del canvas) sia la dimensione (larghezza e altezza in unità). Dimensioni minime impongono che un widget minuscolo sia comunque leggibile.

## Edit vs. View

Il toggle nell'header della pagina commuta tra le due modalità:

- **Edit** — la palette dei widget è aperta, i widget sono trascinabili e ridimensionabili, ogni widget ha un ingranaggio per le impostazioni. Usala mentre costruisci.
- **View** — la dashboard si renderizza in sola lettura, esattamente come la vede qualcuno con accesso solo visualizzazione (o un visitatore pubblico). Usala per controllare il risultato prima di condividere.

La stessa dashboard è mostrata in entrambe le modalità — non c'è un passo separato di "pubblicazione". Salvare una modifica ha effetto immediato per ogni visualizzatore.

## Aggiungere un widget

1. Apri la palette dei widget (il pulsante **+** in modalità Edit).
2. Scegli il tipo di widget. Vedi [Widget](/docs/dashboards/widgets) per il catalogo.
3. Il widget atterra sul canvas nella prossima posizione libera con una dimensione predefinita.
4. Clicca l'ingranaggio del widget per aprire il suo pannello impostazioni.
5. Configura la sorgente dati (query metrica, filtro per elenco, body di testo, ecc.) e qualsiasi opzione di visualizzazione (soglie, unità, assi, colonne).
6. Trascina il widget per posizionarlo. Trascina un angolo per ridimensionarlo.

Ripeti. La griglia snappa i widget ai confini di unità intere.

## Configurare le sorgenti dati

La maggior parte dei widget legge da uno di tre posti:

- **Metriche** — una query metrica basata su ClickHouse. Il widget costruisce una `metricQueryConfig` (una singola serie) o `metricQueryConfigs` (più serie sovrapposte o impilate). Un `transformAsRate` opzionale converte un contatore cumulativo OpenTelemetry in un tasso di variazione. Una `formula` opzionale ti permette di combinare due query (es. conteggio errori / conteggio totale).
- **Elenchi live di risorse** — incidenti, allarmi, monitor, risorse Kubernetes, risorse Docker, host. Ogni widget di tipo lista accetta un filtro (es. label, stato, namespace) e mostra in tempo reale le righe corrispondenti.
- **Contenuto statico** — il widget **Text** accetta un body Markdown. Usalo per intestazioni, divisori, link a runbook e annotazioni "cos'è questa dashboard?".

Per i widget metrici, la configurazione rispecchia il query builder inline che vedi altrove in OneUptime — scegli una metrica, scegli un'aggregazione, aggiungi filtri `WHERE`, scegli un raggruppamento temporale. La query viene eseguita sui dati di telemetria del tuo progetto.

## Soglie e formattazione

I widget che mostrano un singolo numero (**Value**, **Gauge**) accettano soglie opzionali:

- **Soglia di warning** — rendi il valore in giallo quando la supera.
- **Soglia critica** — rendi il valore in rosso quando la supera.

I grafici ti consentono di impostare l'unità dell'asse Y, la posizione della legenda e se impilare le serie. Le tabelle ti permettono di scegliere quali colonne mostrare e il limite di righe.

## Intervallo temporale e refresh

L'header della dashboard ha due controlli globali che influiscono su ogni widget metrico:

- **Intervallo temporale** — scegli un preset (Ultima 1 ora, 24 ore, 7 giorni, 30 giorni) o un intervallo personalizzato. Ogni widget metrico interroga rispetto a questa finestra.
- **Intervallo di refresh** — Off, 5s, 10s, 30s, 1m, 5m, 15m. Riesegue la query di ogni widget alla cadenza scelta. I widget di tipo lista che supportano nativamente i websocket si aggiornano in push indipendentemente dall'intervallo scelto.

Per i widget che ignorano l'intervallo temporale globale (es. un blocco di testo), il controllo è un no-op.

## Salvataggio

Il canvas si salva automaticamente mentre modifichi. Un piccolo indicatore nell'header ti dice quando l'ultima modifica è persistita. Non c'è "pubblicazione" — ogni modifica è live nel momento in cui viene salvata. Se stai per fare una modifica rischiosa, duplica prima la dashboard.

## Pattern che funzionano bene

- **Un argomento per dashboard.** Resisti alla tentazione di mettere "tutto ciò che monitoriamo" su una sola pagina. Tre dashboard etichettate `oncall-checkout`, `oncall-payments`, `oncall-search` invecchiano meglio di una mega-dashboard.
- **Ancora la cima della pagina con il widget più importante.** Le persone scansionano dall'alto — assicurati che la prima cosa che vedono sia la risposta a "questo sistema è sano?"
- **Usa widget Text per etichettare le sezioni.** Una breve intestazione ogni poche righe ("Latenza" / "Errori" / "Capacità") rende la dashboard scansionabile dall'altro lato della stanza.
- **Usa variabili invece di duplicare.** Se ti ritrovi a costruire la stessa dashboard due volte per due servizi, vuoi una variabile `service`. Vedi [Variabili e filtri](/docs/dashboards/variables).

## Cosa leggere dopo

- [Widget](/docs/dashboards/widgets) — il catalogo e la configurazione per ogni widget.
- [Variabili e filtri](/docs/dashboards/variables) — templatizzazione con variabili, filtri di attributi e intervallo temporale.
- [Condivisione e dashboard pubbliche](/docs/dashboards/sharing) — rendere una dashboard raggiungibile fuori dal team.
- [Configurazione e permessi](/docs/dashboards/configuration) — ownership e controllo accessi.
