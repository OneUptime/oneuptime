# Panoramica delle dashboard

Le dashboard trasformano i dati che OneUptime sta gia raccogliendo — metriche, log, trace, incidenti, monitor, risorse Kubernetes, host — in una singola pagina su cui qualcuno puo dare un'occhiata e capire cosa sta succedendo.

Posiziona un grafico della latenza delle richieste accanto a un elenco di incidenti aperti, accanto a un indicatore della CPU, accanto a un paragrafo di contesto. Salva. Condividi il link.

## A cosa servono le dashboard

- **Una pagina "va tutto bene?"** — per l'on-call, per uno standup di team o per un monitor a muro.
- **Cogliere connessioni** — un picco di CPU contemporaneamente a un aumento della latenza e a un incidente aperto e molto piu facile da vedere su una sola pagina che su tre schede diverse.
- **Indagare** — quando stai facendo debug, una dashboard che costruisci al volo batte il lancio di dieci query una alla volta.
- **Condividere all'esterno** — una pagina di performance per i clienti, una status page per partner, una dashboard pubblica per un progetto open-source.

## Cosa puoi mettere su una dashboard

- **Grafici** per i trend nel tempo — latenza, errori, throughput.
- **Tile a valore singolo e indicatori** — tasso di errore corrente, CPU, incidenti aperti.
- **Tabelle** per i dettagli — top 10 degli host piu rumorosi, conteggio errori per servizio.
- **Blocchi di testo** per intestazioni, contesto e link ai runbook.
- **Elenchi live** di incidenti, allarmi, monitor, log, trace, risorse Kubernetes, risorse Docker e host.

Vedi [Widget](/docs/dashboards/widgets) per l'elenco completo e cosa mostra ciascuno.

## Termini chiave

| Termine | Cosa significa |
| --- | --- |
| **Dashboard** | L'intera pagina — un nome, una griglia di widget, controlli per l'intervallo temporale e un elenco di variabili. |
| **Widget** | Un tassello sulla pagina — un grafico, un numero, un elenco, un paragrafo. |
| **Variabile** | Un menu a tendina in cima che filtra tutti i widget contemporaneamente (cluster, servizio, cliente, ambiente). |
| **Intervallo temporale** | La finestra temporale che ogni grafico e numero utilizza. Impostala una volta in cima alla pagina. |
| **Refresh** | Con quale frequenza i widget rieseguono la query sui dati. Off, ogni pochi secondi, ogni pochi minuti. |
| **Modalita** | **Edit** (trascina i widget) o **View** (sola lettura, come la vedono i visitatori). |

## Dove trovare le dashboard

Apri **Dashboards** nel menu di navigazione a sinistra.

| Pagina | Cosa ci fai |
| --- | --- |
| **Dashboards** | Il tuo elenco di dashboard. Crea una nuova dashboard, cerca o filtra per etichetta. |
| **Dashboard → View** | Il canvas. Cambia tra **Edit** e **View** nell'intestazione. |
| **Dashboard → Overview** | Descrizione, proprietari ed etichette. |
| **Dashboard → Settings** | Condivisione pubblica, password, allowlist IP, dominio personalizzato, branding. |
| **Dashboard → Owners** | Utenti e team con accesso esplicito. |
| **Dashboard → Delete** | Rimuovi la dashboard. |

## Costruire una dashboard

1. **Crea** — scegli un nome. Il canvas si apre vuoto.
2. **Aggiungi widget** — scegli un tipo di widget, configurane i dati, trascinalo dove vuoi.
3. **(Opzionale) Aggiungi variabili** — per esempio, un menu a tendina `service` cosi la stessa dashboard funziona per ogni servizio.
4. **Imposta l'intervallo temporale** — i valori predefiniti vanno bene; affina in seguito.
5. **(Opzionale) Condividi pubblicamente** — sposta l'interruttore in Settings, aggiungi una password o un'allowlist IP se necessario.
6. **(Opzionale) Dominio personalizzato** — ospita la dashboard su `status.your-domain.com`.

## Un esempio rapido

Obiettivo: una pagina on-call per il servizio checkout con latenza, tasso di errore, incidenti aperti e una coda live dei log.

1. Crea una dashboard chiamata "Checkout on-call."
2. Aggiungi una variabile `service`. Impostala su `checkout` come predefinito.
3. Aggiungi un widget **Chart** con la latenza P95, filtrato dalla variabile `service`.
4. Accanto, aggiungi un widget **Value** per il tasso di errore, con warning all'1% e critical al 5%.
5. Sotto, aggiungi un widget **Incident List** per gli incidenti taggati `checkout`.
6. Sotto ancora, un widget **Log Stream** che mostra i log dello stesso servizio.
7. Salva. Cambia il menu a tendina su `payments` — la stessa dashboard ora mostra il servizio payments.

## Come si integrano le dashboard con il resto di OneUptime

- **Monitor e telemetria** sono le fonti dei dati. Ogni metrica, log e trace che raccogli e interrogabile su un widget.
- **Incidenti e allarmi** appaiono nei widget **Incident List** e **Alert List**. Le dashboard sono in sola lettura per questi — creali e aggiornali altrove.
- Le **status page** sono comunicazione rivolta ai clienti ("il sistema e su?"). Le dashboard servono a guardare come si sta comportando il sistema nel dettaglio. Le due cose lavorano insieme, non si sostituiscono a vicenda.
- I **workflow** sono il modo in cui OneUptime agisce. Le dashboard sono il modo in cui leggi cio che sta accadendo.

## Letture successive

- [Creazione di una dashboard](/docs/dashboards/authoring) — usare il canvas, modificare i widget.
- [Widget](/docs/dashboards/widgets) — l'elenco completo dei widget.
- [Variabili e filtri](/docs/dashboards/variables) — far funzionare una dashboard per molti servizi o clienti.
- [Condivisione e dashboard pubbliche](/docs/dashboards/sharing) — URL pubblici, password, allowlist IP, domini personalizzati.
- [Configurazione e permessi](/docs/dashboards/configuration) — proprietari, etichette, controllo accessi.
