# Eseguire un runbook

Ci sono tre modi in cui viene creata un'esecuzione di runbook:

1. **Automaticamente tramite una regola** — vedi [Regole di runbook](/docs/runbooks/rules).
2. **Manualmente dalla pagina del runbook** — clicca **Esegui ora** sulla panoramica di un runbook. Non legata ad alcun incidente, allarme o manutenzione.
3. **Manualmente dal feed di un'entità** — clicca **Esegui runbook** su un incidente, allarme o evento di manutenzione programmata. L'esecuzione è legata a quell'entità.

## La vista di esecuzione

Apri una qualsiasi esecuzione per vederne la UI checklist. Ogni passo mostra:

- **Pillola di stato** — In attesa, In esecuzione, In attesa di te, Fatto, Saltato, Fallito.
- **Titolo e descrizione** — copiati dal runbook al momento dell'esecuzione.
- **Output** (collassabile) — stdout, valori di ritorno, risposte HTTP.
- **Messaggio di errore** se il passo è fallito.
- Per i passi manuali in `WaitingForUser`: pulsanti **Segna come completato** e **Salta**.

La pagina fa polling ogni 3 secondi finché l'esecuzione non è terminale, quindi vedrai i passi automatizzati completarsi quasi in tempo reale.

## Intrecciare passi manuali e automatizzati

Il flusso classico:

1. **Passo di script**: catturare lo stato del sistema, scrivere su S3.
2. **Passo manuale**: "Avvisare i clienti tramite il banner della status page." Chi risponde lo spunta.
3. **Passo HTTP**: chiamare il DBA via PagerDuty.
4. **Passo manuale**: "Confermare che la DB secondaria è ora la primary." Chi risponde lo spunta.
5. **Passo di script**: inviare il messaggio "tutto a posto" su Slack.

I passi 2 e 4 mettono in pausa l'esecuzione finché non sono spuntati. I passi 1, 3, 5 girano automaticamente. L'intera corsa è un'unica esecuzione, un'unica timeline, un'unica fonte di verità.

## Annullare un'esecuzione

Clicca **Annulla esecuzione** sulla pagina dell'esecuzione. Il passo corrente (se presente) termina; quelli successivi non partono. Lo stato diventa `Cancelled`.

## Retention dell'output

L'output per passo è limitato a **50KB** per evitare che script fuori controllo gonfino il database. Se ti servono artefatti più grandi, scrivili su S3 o su un logger dallo script e salva l'URL nel valore di ritorno.

## Rieseguire un runbook

Un'esecuzione è un record una tantum e immutabile. Per rieseguire, clicca di nuovo **Esegui ora** — crea una nuova esecuzione con uno snapshot fresco dei passi attuali del runbook. L'esecuzione originale resta intatta per la traccia di audit.

## Trovare esecuzioni passate

Ogni runbook ha una scheda **Esecuzioni** che elenca tutte le sue corse, con filtri per stato, intervallo di date ed entità sorgente. Da un incidente, allarme o evento di manutenzione programmata, la scheda **Runbook** mostra le esecuzioni legate a quell'entità.
