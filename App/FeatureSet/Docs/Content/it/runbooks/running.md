# Eseguire un runbook

Ci sono tre modi per creare un'esecuzione di runbook:

1. **Automaticamente tramite una regola** — vedi [Regole di runbook](/docs/runbooks/rules).
2. **Manualmente dalla pagina del runbook** — clicca **Esegui ora** sulla panoramica di un runbook. Non legata ad alcun incidente, allarme o manutenzione.
3. **Manualmente dal feed di un'entità** — clicca **Esegui runbook** su un incidente, allarme o evento di manutenzione programmata. L'esecuzione è legata a quell'entità.

## La vista di esecuzione

Apri una qualsiasi esecuzione per vedere la sua UI a checklist. Ogni passo mostra:

- **Stato** — In attesa, In esecuzione, In attesa di te, Fatto, Saltato, Fallito.
- **Titolo e descrizione** — copiati dal runbook al momento dell'esecuzione.
- **Output** (richiudibile) — stdout, valori di ritorno, risposte HTTP.
- **Messaggio di errore** se il passo è fallito.
- Per i passi manuali in `WaitingForUser`: pulsanti **Segna come completato** e **Salta**.

Finché l'esecuzione non è in stato terminale, la pagina fa polling ogni 3 secondi, così vedrai i passi automatizzati completarsi quasi in tempo reale.

## Intrecciare passi manuali e automatizzati

Il flusso classico:

1. **Passo di script**: cattura lo stato del sistema, scrive su S3.
2. **Passo manuale**: "Avvisa i clienti tramite banner della status page." Chi risponde spunta.
3. **Passo HTTP**: avvisa il DBA via PagerDuty.
4. **Passo manuale**: "Conferma che il DB secondario è diventato primary." Chi risponde spunta.
5. **Passo di script**: invia il messaggio "tutto OK" su Slack.

I passi 2 e 4 mettono in pausa l'esecuzione fino alla spunta. I passi 1, 3, 5 partono in automatico. L'intera esecuzione è un'unica corsa, una timeline, una fonte di verità.

## Annullare un'esecuzione

Clicca **Annulla esecuzione** sulla pagina dell'esecuzione. Il passo corrente (se presente) termina; quelli successivi non partono. Lo stato diventa `Cancelled`.

## Conservazione dell'output

L'output per passo è limitato a **50 KB** per evitare che script impazziti gonfino il database. Se ti servono artefatti più grandi, scrivili dallo script su S3 o su un logger e salva l'URL nel valore di ritorno.

## Riesecuzione di un runbook

Un'esecuzione è un record una tantum e immutabile. Per rieseguire, clicca di nuovo **Esegui ora** — crea una nuova esecuzione con uno snapshot fresco dei passi attuali del runbook. L'esecuzione originale resta intatta per la traccia di audit.

## Trovare esecuzioni passate

Ogni runbook ha una scheda **Esecuzioni** che elenca tutte le sue corse, con filtri per stato, intervallo di date ed entità d'origine. Su un incidente, allarme o manutenzione, la scheda **Runbook** mostra le esecuzioni collegate a quell'entità.
