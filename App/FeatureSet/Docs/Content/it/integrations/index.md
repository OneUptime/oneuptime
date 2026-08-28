# Integrazioni

OneUptime si collega agli strumenti che il tuo team già utilizza — Zabbix, Jira, PagerDuty, Slack e molti altri — tramite i **[Workflow](/docs/workflows/index)**, il motore di automazione integrato. Non c'è nessun plugin separato da installare. Configuri un'integrazione su una tela drag-and-drop e si attiva ogni volta che succede qualcosa.

Questa pagina illustra i due pattern che ogni integrazione utilizza. Una volta compresi, puoi collegare OneUptime a quasi qualsiasi cosa, anche a strumenti che qui non hanno una pagina dedicata.

## I due pattern

Ogni integrazione sposta i dati in una delle due direzioni (e molte le usano entrambe).

### In entrata — un altro strumento invia dati a OneUptime

Usalo quando un sistema esterno deve _creare o aggiornare qualcosa in OneUptime_ — di solito aprire un incidente o un allarme quando rileva un problema.

1. Crea un workflow che inizia con un **[trigger Webhook](/docs/workflows/triggers#webhook)**. OneUptime ti fornisce un URL univoco.
2. Nell'altro strumento, configura un'azione webhook/notifica che fa una POST su quell'URL quando accade qualcosa.
3. Nel workflow, leggi il payload in arrivo e usa un componente **Create Incident** (o Create Alert) per registrarlo.

```text
Zabbix / Prometheus / Grafana / Datadog  ──►  OneUptime Webhook trigger  ──►  Create Incident
```

> **Suggerimento:** Per gli strumenti di alerting in particolare, un **[Monitor Richiesta In Entrata](/docs/monitor/incoming-request-monitor)** è di solito il percorso in entrata migliore. Ti fornisce un URL webhook senza costruire un workflow, apre un incidente per ogni allarme presente nel payload, inoltra l'escalation a una policy di reperibilità e risolve ogni incidente quando lo strumento segnala il ripristino. Ricorri a un workflow quando ti serve logica che OneUptime non offre nativamente. Vedi [Prometheus Alertmanager](/docs/integrations/prometheus-alertmanager) per un esempio completo.

### In uscita — OneUptime invia dati a un altro strumento

Usalo quando _qualcosa in OneUptime deve comparire in un altro strumento_ — aprire un ticket Jira, avvisare qualcuno in PagerDuty, pubblicare su Slack.

1. Crea un workflow che inizia con un **[trigger eventi OneUptime](/docs/workflows/triggers#oneuptime-event-triggers)** — ad esempio **Incidente → On Create**.
2. Aggiungi un **[componente API](/docs/workflows/components#api)** che chiama la REST API dell'altro strumento con i dettagli dell'incidente.
3. Salva le chiavi API come **[variabili globali](/docs/workflows/variables#global-variables)** segrete, in modo che non appaiano mai nel workflow o nei suoi log.

```text
OneUptime Incident → On Create  ──►  API component  ──►  Jira / PagerDuty / ServiceNow / GitHub
```

## Catalogo

| Strumento                                                             | Direzione             | Cosa fa                                                                             |
| --------------------------------------------------------------------- | --------------------- | ----------------------------------------------------------------------------------- |
| [Zabbix](/docs/integrations/zabbix)                                   | In entrata            | Trasforma i problemi di Zabbix in incidenti OneUptime (e li risolve al ripristino). |
| [Jira](/docs/integrations/jira)                                       | In uscita (+ entrata) | Apre un ticket Jira per ogni incidente; sincronizza lo stato.                       |
| [PagerDuty](/docs/integrations/pagerduty)                             | In uscita (+ entrata) | Attiva e risolve eventi PagerDuty dagli incidenti OneUptime.                        |
| [Opsgenie](/docs/integrations/opsgenie)                               | In uscita (+ entrata) | Crea e chiude allarmi Opsgenie.                                                     |
| [ServiceNow](/docs/integrations/servicenow)                           | In uscita (+ entrata) | Apre incidenti ServiceNow da OneUptime.                                             |
| [Microsoft Dynamics 365](/docs/integrations/microsoft-dynamics-365)   | In uscita (+ entrata) | Apre e risolve Case di Dynamics 365 dagli incidenti OneUptime.                      |
| [Prometheus Alertmanager](/docs/integrations/prometheus-alertmanager) | In entrata            | Converte le notifiche di Alertmanager in incidenti.                                 |
| [Grafana](/docs/integrations/grafana)                                 | In entrata            | Converte gli allarmi Grafana in incidenti.                                          |
| [Datadog](/docs/integrations/datadog)                                 | In entrata            | Converte gli allarmi dei monitor Datadog in incidenti.                              |
| [GitHub](/docs/integrations/github)                                   | In uscita             | Apre un ticket GitHub per un incidente.                                             |
| [GitLab](/docs/integrations/gitlab)                                   | In uscita             | Apre un ticket GitLab per un incidente.                                             |
| [Discord](/docs/integrations/discord)                                 | In uscita             | Pubblica gli aggiornamenti degli incidenti in un canale Discord.                    |
| [Telegram](/docs/integrations/telegram)                               | In uscita             | Invia gli aggiornamenti degli incidenti a una chat Telegram.                        |
| [Slack](/docs/workspace-connections/slack)                            | Entrambe              | Connessione workspace nativa — canali, allarmi e on-call.                           |
| [Microsoft Teams](/docs/workspace-connections/microsoft-teams)        | Entrambe              | Connessione workspace nativa.                                                       |

> **Slack e Microsoft Teams** dispongono di una connessione nativa più approfondita che va oltre i workflow — canali degli incidenti automatici, azioni bidirezionali e notifiche on-call. Per questi strumenti utilizza le connessioni workspace [Slack](/docs/workspace-connections/slack) e [Microsoft Teams](/docs/workspace-connections/microsoft-teams) anziché costruire un workflow.

## Gestione dei segreti

Non incollare mai una chiave API o un token direttamente in un blocco. Invece:

1. Vai su **Flussi di lavoro → Variabili globali**.
2. Crea una variabile — ad esempio `JIRA_AUTH` — e attiva **Segreto**.
3. Richiamala ovunque con `{{global.variables.JIRA_AUTH}}`.

Le variabili segrete sono nascoste nell'interfaccia dopo il salvataggio e vengono rimosse dai log delle esecuzioni. Vedi [Variabili](/docs/workflows/variables#global-variables).

## Guida rapida all'autenticazione

La maggior parte delle integrazioni in uscita richiede un header `Authorization` nel blocco API. Le forme più comuni:

| Schema                       | Valore dell'header                                 | Usato da                            |
| --------------------------- | -------------------------------------------------- | ----------------------------------- |
| Bearer token                | `Bearer {{global.variables.TOKEN}}`                | GitHub, molte API moderne           |
| Basic auth                  | `Basic {{global.variables.BASE64_USER_PASS}}`      | Jira Cloud, ServiceNow              |
| Header chiave API           | `GenieKey {{global.variables.OPSGENIE_KEY}}`       | Opsgenie                            |
| Token nel corpo             | campo `routing_key` nel corpo JSON                 | PagerDuty Events API                |
| Header token privato        | `PRIVATE-TOKEN: {{global.variables.GITLAB_TOKEN}}` | GitLab                              |
| OAuth 2.0 client credentials | `Bearer <token recuperato da un blocco API precedente>` | Microsoft Dynamics 365 (Dataverse)  |

Per la Basic auth, codifica in base64 `username:password` (o `email:api_token`) **una volta**, poi salva il risultato come segreto. Su macOS/Linux:

```bash
printf '%s' 'you@example.com:your_api_token' | base64
```

## Il tuo strumento non è nella lista?

Quasi tutti gli strumenti rientrano in uno dei due pattern sopra descritti:

- Se lo strumento può **inviare un webhook** quando accade qualcosa, usa il pattern **in entrata** — punta il suo webhook su un [Monitor Richiesta In Entrata](/docs/monitor/incoming-request-monitor) se è uno strumento di alerting, oppure su un trigger Webhook di OneUptime se ti serve logica personalizzata.
- Se lo strumento ha una **REST API**, usa il pattern **in uscita** — chiamala da un **componente API**.
- Se devi rimodellare i dati tra i due, aggiungi un blocco **[Custom Code](/docs/workflows/components#custom-code)**.

Questo copre la coda lunga — Zendesk, AWS CloudWatch (via SNS), New Relic, Splunk, StatusCake e così via. Il procedimento è lo stesso; cambiano solo l'URL e il payload.

## Dove leggere poi

- [Panoramica dei workflow](/docs/workflows/index) — come funziona il motore di automazione.
- [Trigger](/docs/workflows/triggers) — trigger Webhook e trigger eventi OneUptime nel dettaglio.
- [Componenti](/docs/workflows/components) — i componenti API, Webhook e dati.
- [Variabili](/docs/workflows/variables) — segreti e trasferimento di dati tra blocchi.
- [Monitor Richiesta In Entrata](/docs/monitor/incoming-request-monitor) — il percorso in entrata senza workflow per gli strumenti di alerting.
- [Zabbix](/docs/integrations/zabbix), [Jira](/docs/integrations/jira) e [Microsoft Dynamics 365](/docs/integrations/microsoft-dynamics-365) — esempi completi e guidati.
