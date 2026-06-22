# Configurazione e permessi

Questa pagina raccoglie le impostazioni e i controlli di accesso che vale la pena conoscere quando hai una dashboard che vuoi tenere in giro.

## Proprietari

I **proprietari** di una dashboard sono utenti e team a cui hai dato accesso esplicito (in aggiunta al loro ruolo a livello di progetto).

Sotto **Dashboard → Owners**:

- Aggiungi un **proprietario utente** per dare a una persona un accesso extra a questa dashboard.
- Aggiungi un **proprietario team** per dare lo stesso a ogni membro di un team.

Usa i proprietari quando il ruolo di lettura a livello di progetto e troppo ampio — per esempio, una dashboard con dettagli a livello di cliente che dovrebbe essere visibile solo al team customer success.

## Etichette

Le etichette sono tag per organizzare le dashboard. Applicale sotto **Dashboard → Overview**.

Pattern comuni:

- **Per team**: `team:platform`, `team:checkout`, `team:growth`.
- **Per ambiente**: `env:prod`, `env:staging`.
- **Per scopo**: `purpose:oncall`, `purpose:exec`, `purpose:investigation`.

L'elenco **Dashboards** ti permette di filtrare per etichetta, che e il modo piu veloce per trovare una dashboard in un progetto che ne ha accumulate molte.

## Permessi

Le dashboard funzionano con il controllo accessi basato sui ruoli del tuo progetto. I permessi rilevanti:

| Permesso             | Cosa consente                                    |
| -------------------- | ------------------------------------------------ |
| **Create Dashboard** | Creare nuove dashboard.                          |
| **Read Dashboard**   | Visualizzare le dashboard (in modalita privata). |
| **Edit Dashboard**   | Modificare widget, variabili e impostazioni.     |
| **Delete Dashboard** | Eliminare una dashboard.                         |

Esistono permessi corrispondenti per i proprietari della dashboard e i domini personalizzati, cosi puoi concedere "gestire i proprietari" senza concedere "modificare la dashboard."

Assegnali sui ruoli del progetto sotto **Project Settings → Teams & Roles**.

## Accesso per dashboard pubbliche

Quando rendi una dashboard pubblica (vedi [Condivisione e dashboard pubbliche](/docs/dashboards/sharing)), tre impostazioni controllano chi puo vederla:

1. Interruttore **Public Dashboard** — se disattivato, l'URL pubblico restituisce un 404.
2. **Master Password** — se impostata, i visitatori inseriscono una password prima che la dashboard appaia.
3. **IP Whitelist** (piano Scale) — se impostata, le richieste da altri IP vengono rifiutate.

Puoi combinare uno qualsiasi di questi. La combinazione piu restrittiva e "Pubblico attivo, password impostata, allowlist IP attiva" — utile per portali partner dove vuoi tutti e tre i livelli.

## Retention dei dati

Le dashboard in se non scadono. I dati che mostrano seguono le impostazioni di retention del tuo progetto — metriche, log e trace sono interrogabili finche il tuo piano li conserva. Un widget puntato a "gli ultimi 90 giorni" su un piano che ne conserva 30 mostrera qualsiasi cosa sia ancora memorizzata.

## Duplicare una dashboard

Per copiare una dashboard esistente, apri l'elenco delle dashboard e seleziona **Duplicate**. La copia include ogni widget, variabile e impostazione tranne la condivisione pubblica — quella parte sempre disattivata cosi puoi decidere se riattivarla.

E la mossa giusta quando vuoi forkare un template (come "la nostra dashboard on-call") in una copia specifica per un servizio.

## Eliminare una dashboard

Sotto **Dashboard → Delete**. Non puo essere annullato — il layout della dashboard e qualsiasi dominio personalizzato associato vengono rimossi. I tuoi dati di telemetria non sono influenzati.

Se la dashboard e pubblica su un dominio personalizzato, l'URL smette di risolvere non appena la elimini. Sposta prima il dominio su una dashboard diversa se vuoi mantenere l'URL funzionante.

## Backup

Se utilizzi un'installazione self-hosted di OneUptime, un backup regolare del database e sufficiente — la configurazione della dashboard e memorizzata insieme al resto del tuo progetto.

Su OneUptime Cloud, i backup sono gestiti per te. Se vuoi una tua copia, puoi leggere la dashboard tramite l'[API di OneUptime](/docs/api-reference/api-reference).

## Letture successive

- [Condivisione e dashboard pubbliche](/docs/dashboards/sharing) — controlli per la modalita pubblica.
- [Variabili e filtri](/docs/dashboards/variables) — templating.
- [Widget](/docs/dashboards/widgets) — il catalogo dei widget.
- [Panoramica delle dashboard](/docs/dashboards/index) — il quadro generale.
