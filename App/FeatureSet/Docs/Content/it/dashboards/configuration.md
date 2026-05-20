# Configurazione e permessi

Questa pagina raccoglie le impostazioni e le manopole di controllo accessi che vale la pena conoscere quando hai una dashboard che vuoi davvero tenere in giro.

## Ownership

Gli **owner** di una dashboard sono gli utenti e i team a cui sono concessi permessi espliciti su di essa (separati dal ruolo a livello di progetto).

In **Dashboard → Owners**:

- Aggiungi un **user owner** per concedere a una persona specifica accesso extra a questa dashboard.
- Aggiungi un **team owner** per concedere lo stesso a ogni membro di un team.

Usa l'ownership quando il ruolo di lettura a livello di progetto è troppo ampio — es. una dashboard con dettagli sensibili a livello di cliente che dovrebbe essere visibile solo al team customer-success.

## Label

Le label sono tag many-to-many per organizzare le dashboard. Applicale in **Dashboard → Overview**.

Pattern comuni di label:

- **Per team**: `team:platform`, `team:checkout`, `team:growth`.
- **Per ambiente**: `env:prod`, `env:staging`.
- **Per scopo**: `purpose:oncall`, `purpose:exec`, `purpose:investigation`.

L'elenco delle **Dashboard** ti consente di filtrare per label, che è il modo più rapido per trovare una dashboard in un progetto che ne ha accumulate decine.

## Permessi

Le dashboard sono risorse di prima classe nel controllo accessi basato sui ruoli di OneUptime. I permessi rilevanti:

| Permesso | Consente |
| --- | --- |
| `CreateDashboard` | Creare nuove dashboard nel progetto. |
| `ReadDashboard` | Visualizzare le dashboard (in modalità privata). |
| `EditDashboard` | Modificare widget, variabili, impostazioni di una dashboard. |
| `DeleteDashboard` | Cancellare una dashboard. |

Ci sono permessi corrispondenti per le entità di supporto: gli owner della dashboard (utente / team) e i domini personalizzati hanno le proprie coppie create / read / edit / delete così puoi concedere "gestisci gli owner" senza concedere "modifica la dashboard stessa".

Assegna questi sui ruoli di progetto in **Project Settings → Teams & Roles**.

## Controllo accessi in modalità pubblica

L'accesso in modalità pubblica (vedi [Condivisione e dashboard pubbliche](/docs/dashboards/sharing)) è governato da tre livelli, nell'ordine:

1. Toggle **Public Dashboard** — se off, l'URL pubblico restituisce un 404.
2. **Master Password** — se impostata, i visitatori devono inserirla prima che la dashboard si renderizzi.
3. **IP Whitelist** (piano Scale) — se impostata, le richieste da IP non in lista ricevono un 403.

Una dashboard può avere qualsiasi combinazione. La configurazione più difensiva è "Public on, password impostata, allowlist IP attiva" — utile per portali partner dove vuoi tutti e tre.

## Retention

Le dashboard in sé non scadono. I dati che mostrano seguono la retention della telemetria del progetto — metriche, log e trace sono interrogabili per il tempo per cui il tuo piano li mantiene. Un widget puntato sugli "ultimi 90 giorni" su un piano con 30 giorni di retention renderizzerà qualunque cosa sia ancora nello store.

## Clonare una dashboard

Per duplicare una dashboard esistente, aprila e usa l'azione **Duplicate** dall'elenco delle dashboard. La copia include ogni widget, variabile e impostazione tranne la configurazione di modalità pubblica (che parte sempre off — decidi tu se riabilitarla sulla copia).

È il pattern giusto quando vuoi forkare un template ("la nostra dashboard on-call") in una versione specifica per servizio.

## Cancellare una dashboard

In **Dashboard → Delete**. È irreversibile — la configurazione del canvas e tutti i bindings di domini personalizzati vengono rimossi. I dati di telemetria non sono coinvolti (vivono negli store di metriche / log / trace, non sulla dashboard).

Se una dashboard è pubblicata pubblicamente con un dominio personalizzato, l'URL pubblico smette di risolvere nel momento in cui la cancelli. Stacca prima il dominio se devi ripuntarlo.

## Migrazione e backup

Per le installazioni in self-hosting: la configurazione completa della dashboard (widget, variabili, impostazioni) vive nella tabella `Dashboard` in Postgres. Un backup regolare del database è sufficiente — non esiste un formato di export separato per la dashboard.

Per OneUptime Cloud: i backup regolari sono gestiti per te. Se vuoi una copia locale della configurazione di una dashboard, usa l'[API OneUptime](/docs/api-reference/api-reference) per leggere il record `Dashboard`.

## Cosa leggere dopo

- [Condivisione e dashboard pubbliche](/docs/dashboards/sharing) — il lato pubblico del controllo accessi.
- [Variabili e filtri](/docs/dashboards/variables) — templatizzazione.
- [Widget](/docs/dashboards/widgets) — il catalogo dei widget.
- [Panoramica delle dashboard](/docs/dashboards/index) — la mappa concettuale.
