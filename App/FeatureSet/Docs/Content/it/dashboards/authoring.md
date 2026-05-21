# Creazione di una dashboard

Per creare una dashboard, apri **Dashboards → Create Dashboard**, assegnale un nome e aprila. Il canvas si apre in modalita **Edit**, pronto perche tu inizi ad aggiungere widget.

## Il canvas

Una dashboard e una griglia. I widget si agganciano alla griglia — decidi tu dove sta ciascuno e quanto e grande. Puoi far crescere la pagina verso il basso man mano che aggiungi righe. Ogni widget mantiene le proprie proporzioni su schermi piu grandi o piu piccoli.

## Edit e View

L'interruttore nell'intestazione passa tra due modalita:

- **Edit** — la palette dei widget e aperta, puoi trascinare i widget, ridimensionarli e cliccarne uno qualsiasi per modificarne le impostazioni.
- **View** — la dashboard e in sola lettura, esattamente come la vedono i visitatori e gli altri membri del team. Usala per controllare il risultato prima di condividerla.

E la stessa dashboard in entrambe le modalita. Non c'e un passaggio separato di "pubblicazione" — ogni modifica e attiva nel momento in cui viene salvata.

## Aggiungere un widget

1. Clicca il pulsante **+** per aprire la palette dei widget.
2. Scegli il tipo di widget. Vedi [Widget](/docs/dashboards/widgets) per il catalogo.
3. Il widget appare sul canvas.
4. Clicca l'icona dell'ingranaggio sul widget per aprirne le impostazioni.
5. Scegli la fonte dei dati (una metrica, un filtro per un elenco, un paragrafo di testo, ecc.) e le eventuali opzioni di visualizzazione.
6. Trascina il widget per spostarlo. Trascina un angolo per ridimensionarlo.

## Da dove provengono i dati

La maggior parte dei widget legge da una di tre fonti:

- **Metriche** — scegli una metrica e un'aggregazione (media, max, conteggio, percentile). Aggiungi filtri. Scegli come raggruppare il risultato. E lo stesso query builder che vedi altrove in OneUptime.
- **Elenchi live** — incidenti, allarmi, monitor, pod Kubernetes, container Docker, host. Ogni widget elenco prende un filtro e mostra gli elementi corrispondenti, aggiornati in tempo reale.
- **Contenuto statico** — il widget **Text** accetta un blocco Markdown. Usalo per intestazioni, contesto, link ai runbook o note temporanee durante un incidente.

## Soglie e formattazione

I widget a valore singolo (**Value**, **Gauge**) ti permettono di impostare:

- Una **soglia warning** — il colore diventa giallo quando il valore la supera.
- Una **soglia critical** — il colore diventa rosso quando il valore la supera.

I grafici ti permettono di impostare l'unita dell'asse Y, scegliere dove va la legenda e scegliere se le serie si impilano l'una sull'altra o si sovrappongono. Le tabelle ti permettono di scegliere le colonne da mostrare e quante righe.

## Intervallo temporale e refresh

In cima alla dashboard, due controlli influenzano ogni widget di metrica:

- **Intervallo temporale** — un preset (ultima ora, 24 ore, 7 giorni, 30 giorni) o un intervallo personalizzato. Ogni grafico e numero usa questa finestra.
- **Refresh** — con quale frequenza i widget rieseguono la query. Off, 5s, 10s, 30s, 1m, 5m, 15m. Gli elenchi live si aggiornano da soli indipendentemente da questa impostazione.

I widget che non usano l'intervallo temporale (come un widget Text) ignorano entrambi i controlli.

## Salvataggio

Il canvas salva da solo mentre lavori. Un piccolo indicatore nell'intestazione ti dice quando l'ultima modifica e stata salvata. Se stai facendo un cambiamento importante, prima duplica la dashboard per avere una copia sicura.

## Suggerimenti per dashboard che invecchiano bene

- **Un argomento per dashboard.** Resisti alla tentazione di mettere "tutto cio che monitoriamo" su una sola pagina. Poche dashboard focalizzate battono una pagina gigantesca.
- **Metti in alto il widget piu importante.** Le persone scorrono dall'alto verso il basso — fa' che la prima cosa che vedono sia la risposta a "questo sistema sta bene?"
- **Etichetta le sezioni con widget Text.** Una breve intestazione ogni qualche riga ("Latenza," "Errori," "Capacita") rende la pagina leggibile da lontano.
- **Usa le variabili invece di duplicare.** Se stai per costruire la stessa dashboard per un secondo servizio, costruisci invece una dashboard con una variabile `service`. Vedi [Variabili e filtri](/docs/dashboards/variables).

## Letture successive

- [Widget](/docs/dashboards/widgets) — il catalogo.
- [Variabili e filtri](/docs/dashboards/variables) — variabili, filtri e intervallo temporale.
- [Condivisione e dashboard pubbliche](/docs/dashboards/sharing) — condividere fuori dal tuo team.
- [Configurazione e permessi](/docs/dashboards/configuration) — proprietari e controllo accessi.
