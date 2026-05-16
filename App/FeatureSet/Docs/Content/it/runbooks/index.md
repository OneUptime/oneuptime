# Panoramica dei Runbook

I runbook sono procedure di risposta riutilizzabili — elenchi ordinati di passi manuali o automatizzati — che colleghi a incidenti, allarmi o eventi di manutenzione programmata. Trasformano i thread Slack improvvisati del tipo "e ora cosa facciamo?" in qualcosa che un collega può riprendere a freddo alle 3 di notte.

## A colpo d'occhio

- **Funzionalità di primo livello** nella dashboard OneUptime in **Analisi e automazione → Runbook**.
- **Quattro tipi di passo**: checklist manuale, JavaScript (sandbox) e Bash (entrambi girano su un [Agente Runbook](/docs/runbooks/agents) nella tua infrastruttura), richiesta HTTP.
- **Tre vie di attivazione**: regole che corrispondono a incidenti/allarmi/manutenzione programmata, oppure il pulsante manuale "Esegui runbook" su qualsiasi evento.
- **Semantica a snapshot**: all'avvio di un runbook i suoi passi vengono copiati nell'esecuzione. Modificare il modello in seguito non altera mai un'esecuzione in corso.
- **Audit trail completo**: stato, output, messaggio di errore e durata di ogni passo restano per sempre nell'esecuzione.

## Perché usare i runbook?

La risposta agli incidenti spesso fa la differenza tra un disservizio di un minuto e un'interruzione di ore. I runbook ti aiutano a:

- **Codificare la conoscenza implicita** — la risposta a "cosa fare quando la coda si accumula" sta in un posto dove il tuo team può trovarla.
- **Ridurre il tempo medio di ripristino (MTTR)** — i passi automatizzati partono in pochi secondi; quelli manuali tolgono la paralisi decisionale.
- **Tracciare le azioni di risposta** — ogni passo eseguito, ogni output, ogni clic di chi risponde è registrato nell'esecuzione.
- **Mettere in autonomia i junior** — possono eseguire un runbook con sicurezza invece di chiamare un senior alle 3 di notte.
- **Scrivere postmortem con dati, non con la memoria** — l'esecuzione catturata è un registro congelato di ciò che è realmente accaduto.

## Concetti chiave

Alcuni termini ricorrono nel resto della documentazione runbook. Chiariamoli subito:

| Termine | Significato |
| --- | --- |
| **Runbook** | Il modello. Una procedura riutilizzabile e con un nome, con elenco ordinato di passi e un flag `isEnabled`. |
| **Passo** | Un elemento di un runbook. Ha un tipo (Manuale / JavaScript / HTTP / Bash), un titolo, una descrizione e una configurazione specifica del tipo. |
| **Regola di runbook** | Un pattern che collega automaticamente uno o più runbook a incidenti, allarmi o manutenzioni programmate quando il loro titolo o descrizione corrisponde a una regex. |
| **Esecuzione** | Un'esecuzione di un runbook. Creata quando una regola scatta, quando qualcuno clicca "Esegui runbook" su un evento o "Esegui ora" sul runbook stesso. Contiene uno snapshot dei passi e lo stato/output di ciascun passo. |
| **Snapshot** | La copia congelata dei passi del runbook che vive in ogni esecuzione. Permette di modificare il modello successivamente senza riscrivere la storia. |

## Il ciclo di vita di un runbook

1. **Scrivere** — Crea un runbook, mescola passi Manuali, JavaScript, HTTP e Bash. Salva.
2. **(Opzionale) Aggiungere una regola** — Dalle impostazioni di Incidenti, Allarmi o Manutenzioni programmate, dici a OneUptime di avviare questo runbook ogni volta che il titolo o la descrizione di un evento corrisponde a una regex.
3. **Scatenare** — O la regola scatta automaticamente alla creazione di un evento corrispondente, o chi risponde clicca manualmente **Esegui runbook** sull'evento.
4. **Eseguire** — Viene creata una nuova esecuzione con uno snapshot dei passi. I passi automatizzati girano sul worker Runbook; l'esecuzione si mette in pausa a ogni passo manuale finché qualcuno non lo segna.
5. **Auditare** — L'esecuzione resta per sempre nella scheda **Runbook** dell'evento e nell'elenco delle esecuzioni del runbook. Output, errori e tempistiche per passo sono conservati per il postmortem.

## Quando usare ciascun tipo di passo

Una guida rapida. Il dettaglio è in [Scrivere un runbook](/docs/runbooks/authoring).

| Tipo | Quando usarlo… | Esempio |
| --- | --- | --- |
| **Manuale** | Un essere umano deve verificare qualcosa, decidere o compiere un'azione che OneUptime non può osservare. | "Confermare nel dashboard del load balancer che il traffico è passato alla regione secondaria." |
| **JavaScript** | Serve una piccola computazione contenuta — interrogare un servizio di configurazione, trasformare un payload, eseguire logica prima del passo successivo. Gira in sandbox su un [Agente Runbook](/docs/runbooks/agents) nella tua infrastruttura. | Calcolare il lag attuale del replica e decidere se proseguire. |
| **Richiesta HTTP** | Stai chiamando un'API esistente — il tuo endpoint admin, un provider cloud, PagerDuty, Slack. | `POST` al tuo orchestratore di failover. |
| **Bash** | Devi eseguire comandi shell sulla tua infrastruttura — riavviare un servizio, eseguire `kubectl`, lanciare uno script di deploy. Richiede un [Agente Runbook](/docs/runbooks/agents) installato nel tuo ambiente. | Riavviare un servizio, `kubectl rollout restart`, eseguire uno script di recupero. |

Puoi mescolare tutti e quattro in un unico runbook — la forza dei runbook sta nell'intrecciare verifica umana e automazione.

## Dove vivono i runbook nella dashboard

| Pagina | Cosa ci fai |
| --- | --- |
| **Analisi e automazione → Runbook** | Sfogliare, creare e modificare i modelli di runbook. |
| **Scheda Passi di un runbook** | Scrivere e riordinare l'elenco di passi. |
| **Scheda Esecuzioni di un runbook** | Vedere ogni esecuzione di questo runbook con filtri di stato. |
| **Pulsante "Esegui ora" di un runbook** | Avviare un'esecuzione ad hoc non legata ad alcun evento. |
| **Incidenti / Allarmi / Manutenzione programmata → Impostazioni → Regole di runbook** | Creare le regole di auto-trigger per ogni tipo di entità. |
| **Un incidente / allarme / evento di manutenzione → scheda Runbook** | Vedere le esecuzioni collegate a quell'evento e cliccare **Esegui runbook** per un'esecuzione manuale. |

## Casi d'uso comuni

Alcuni schemi per cui i team ricorrono ai runbook:

- **Failover di database** — Cattura lo stato attuale con JavaScript, chiedi al DBA on-call di confermare la salute del replica (Manuale), chiama l'API dell'orchestratore (HTTP), spunta "DNS aggiornato" (Manuale), pubblica "tutto OK" su Slack (HTTP).
- **Svuotamento cache** — Un singolo passo HTTP più un Manuale "conferma che la hit rate della cache si riprende sul dashboard".
- **Incidente con impatto cliente** — Manuale: "Pubblicare aggiornamento sulla status page." HTTP: "Avvisare il team CS in #customer-incidents." JavaScript: "Recuperare l'elenco degli account interessati dall'API interna."
- **Pre-flight manutenzione programmata** — JavaScript: snapshot delle metriche correnti. Manuale: "Confermare la finestra di cambio con gli stakeholder." HTTP: attivare la modalità manutenzione sul load balancer.
- **Igiene always-on** — Una regola con pattern di titolo vuoto che cattura lo stato del sistema su ogni incidente — preziosissimo per i postmortem.

## Esempio completo

Supponiamo che ogni incidente con "db-primary" nel titolo debba avviare automaticamente un runbook di failover DB in cinque passi.

**1. Crea il runbook.** In **Runbook → Crea runbook**, chiamalo "Failover DB primary" e aggiungi questi passi:

| # | Tipo | Titolo |
| --- | --- | --- |
| 1 | JavaScript | Cattura il lag del replica prima del failover |
| 2 | Manuale | Conferma salute del replica nel dashboard DBA |
| 3 | HTTP | `POST` all'orchestratore di failover |
| 4 | Manuale | Verifica che le scritture vadano al nuovo primary |
| 5 | HTTP | Pubblica "tutto OK" su Slack `#db-incidents` |

**2. Aggiungi una regola.** In **Incidenti → Impostazioni → Regole di runbook**, crea:

```
Pattern titolo:  ^db-primary
Runbook:         [Failover DB primary]
```

**3. Trigger.** Un allarme da monitor apre l'incidente `INC-4821 · db-primary connection timeout`. La regola corrisponde, viene creata un'esecuzione, e:

- Il passo 1 (JavaScript) parte immediatamente sul worker — il suo `return { lagMs: 412 }` viene catturato.
- Il passo 2 (Manuale) mette in pausa. L'on-call vede un'etichetta "In attesa di te" sulla pagina dell'incidente, controlla il dashboard e spunta il passo.
- Il passo 3 (HTTP) parte non appena il passo 2 è spuntato — il body della risposta `POST` viene catturato.
- Il passo 4 (Manuale) mette di nuovo in pausa.
- Il passo 5 (HTTP) parte e l'esecuzione finisce.

**4. Audit.** L'esecuzione resta nella scheda **Runbook** dell'incidente. L'output di ogni passo è a un clic. Quando la prossima settimana scrivi il postmortem, non devi chiedere "cosa ha restituito quello script?" — è lì.

## Come si incastrano i runbook con il resto di OneUptime

- I **monitor** aprono incidenti e allarmi; le **regole di runbook** trasformano quegli eventi in esecuzioni di runbook. Insieme formano un ciclo chiuso: rilevare → scatenare → rispondere → registrare.
- Le **connessioni del workspace** (Slack, Microsoft Teams) sono un bersaglio naturale per i passi HTTP — pubblicare aggiornamenti di stato, notificare canali.
- Le **status page** vengono spesso aggiornate come passo manuale in un runbook con impatto cliente.
- Le **pianificazioni on-call** decidono chi viene avvisato; i runbook decidono cosa fa quella persona una volta sveglia.

## Dove leggere ora

- [Scrivere un runbook](/docs/runbooks/authoring) — creazione di runbook, i quattro tipi di passo e cosa fa ciascuno.
- [Regole di runbook](/docs/runbooks/rules) — collegare automaticamente i runbook a incidenti, allarmi e manutenzioni programmate.
- [Eseguire un runbook](/docs/runbooks/running) — trigger manuali, vista di esecuzione e come i passi manuali si intrecciano con quelli automatizzati.
- [Agenti Runbook](/docs/runbooks/agents) — installare gli agenti che eseguono i passi Bash nella tua infrastruttura.
- [Configurazione e sicurezza](/docs/runbooks/configuration) — limiti di output, permessi, note di hardening.
