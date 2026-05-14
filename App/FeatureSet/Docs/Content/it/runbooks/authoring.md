# Scrivere un runbook

Crea un runbook da **Runbook → Crea runbook**, poi aprilo e vai alla scheda **Passi**.

## Anatomia di un passo

Ogni passo ha:

| Campo | Funzione |
| --- | --- |
| **Titolo** | Etichetta breve mostrata nella checklist. Obbligatorio. |
| **Descrizione** | Contesto facoltativo per chi risponde. Testo Markdown. |
| **Continua in caso di errore** | Se attivo, un passo fallito non blocca l'esecuzione — il successivo parte comunque. |
| **Configurazione specifica del tipo** | Script, URL, ecc. — vedi sotto. |

I passi vengono eseguiti **in ordine**. Riordinali con le frecce su/giù nell'editor dei passi.

## Tipi di passo

### Manuale

Una casella che chi risponde spunta. L'esecuzione si mette in pausa al raggiungimento di un passo manuale e resta in `WaitingForManualStep` finché qualcuno non lo segna come completato (o lo salta).

Usalo per ciò che solo un umano può verificare: "Il traffico è stato spostato sulla regione secondaria secondo la dashboard del load balancer — confermato."

### JavaScript

Uno snippet JavaScript eseguito in una sandbox `isolated-vm` (niente filesystem, niente rete se non porti tu un'API).

```js
const start = Date.now();
// ... la tua logica ...
return { durationMs: Date.now() - start };
```

Il valore restituito viene registrato nell'esecuzione del passo. L'output di `console.log` viene catturato come righe di log. Timeout predefinito: 30 secondi.

### Richiesta HTTP

Una chiamata HTTP in uscita. Configura il metodo (GET/POST/PUT/PATCH/DELETE/HEAD), URL, header JSON opzionali e body opzionale. Stato, header e body della risposta vengono registrati (limitati a 50 KB totali).

Utile per: aprire un incident PagerDuty, postare su Slack, chiamare la tua API admin, ecc.

### Bash

Uno script bash che gira su un [Agente Runbook](/docs/runbooks/agents) — un piccolo processo che installi su un host della tua infrastruttura. I passi Bash non vengono mai eseguiti sul Worker di OneUptime.

Configura due cose su un passo Bash:

- **Agent Tag** — il tag che identifica quale/i agente/i deve eseguire questo passo. Qualsiasi agente sano del progetto che porti quel tag rivendicherà ed eseguirà il job.
- **Script** — il bash da eseguire. L'output (stdout + stderr) viene catturato fino a 50 KB; il processo viene terminato al timeout.

Se nessun agente con il tag scelto è online quando il runbook raggiunge questo passo, il passo aspetta fino al **claim timeout** (predefinito 2 minuti) e poi fallisce. Aggiungi un agente in **Runbooks → Agents** prima di dipendere da un passo Bash.

## Salvare e modificare

Premi **Salva passi** per persistere. Le esecuzioni in corso di versioni precedenti del runbook non sono toccate — continuano con il loro snapshot.

## Passi multipli e gestione degli errori

Per impostazione predefinita un passo fallito ferma l'esecuzione e la marca `Failed`. Se imposti **Continua in caso di errore** su un passo, l'errore viene registrato ma il passo successivo parte comunque. Utile per schemi tipo "prova queste tre cose, poi notifica".

## Un esempio completo

Un runbook semplice per "DB primario irraggiungibile":

1. **JavaScript** — recupera l'host primario attuale dal servizio di configurazione e lo registra.
2. **Manuale** — "Lag di replica del secondario inferiore a 5 secondi — confermato."
3. **Richiesta HTTP** — POST all'API del tuo orchestratore di failover.
4. **Manuale** — "Le scritture vanno al nuovo primario — confermato."
5. **Richiesta HTTP** — POST su Slack con un messaggio "tutto a posto".

Chi risponde guarda partire un passo automatizzato, spunta uno manuale, guarda il successivo, e così via. L'output di ciascun passo viene conservato per il post-mortem.
