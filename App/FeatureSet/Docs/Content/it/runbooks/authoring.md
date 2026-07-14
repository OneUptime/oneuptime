# Scrivere un runbook

Crea un runbook in **Runbook → Crea Runbook**, poi aprilo e vai sulla scheda **Passi**.

## Anatomia di un passo

Ogni passo ha:

| Campo                          | Scopo                                                                                                                      |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------------- |
| **Titolo**                     | Etichetta breve mostrata nella UI checklist. Obbligatoria.                                                                 |
| **Descrizione**                | Contesto opzionale per chi risponde. Testo Markdown-safe.                                                                  |
| **Continua in caso di errore** | Se attivo, un passo fallito non interrompe l'esecuzione — il passo successivo parte comunque.                              |
| **Richiede approvazione**      | Se attivo, il runbook si mette in pausa dopo questo passo e aspetta che un utente approvi prima di eseguire il successivo. |
| **Config specifica del tipo**  | Script, URL, agente, ecc. — vedi sotto.                                                                                    |

I passi vengono eseguiti **in ordine**. Riordinali con le frecce su/giù nell'editor dei Passi.

## Tipi di passo

### Manuale

Una checkbox che chi risponde spunta. L'esecuzione del runbook si mette in pausa quando arriva a un passo Manuale e resta in `WaitingForManualStep` finché qualcuno non lo segna come completato (o lo salta).

Usalo per cose che solo un umano può verificare: "Confermato che il traffico è passato alla regione secondaria nel dashboard del load balancer."

### JavaScript

Uno snippet di JavaScript eseguito in un sandbox `isolated-vm`. Il sandbox vive su un [Agente Runbook](/docs/runbooks/agents) nella tua infrastruttura — non sul Worker OneUptime.

Configura due cose in un passo JavaScript:

- **Agente Runbook** — scegli dal dropdown l'agente che deve eseguire questo passo. Solo l'agente selezionato può reclamare il job.
- **Script** — il JavaScript da eseguire.

```js
const start = Date.now();
// ... la tua logica ...
return { durationMs: Date.now() - start };
```

Il valore restituito viene catturato sull'esecuzione del passo. L'output di `console.log` è catturato come righe di log. Timeout di esecuzione predefinito: 30 secondi. Claim timeout predefinito (quanto il Worker aspetta che l'agente prenda il job): 2 minuti.

### Richiesta HTTP

Effettua una chiamata HTTP in uscita. Configura metodo (GET/POST/PUT/PATCH/DELETE/HEAD), URL, header JSON opzionali e body opzionale. Status, header e body della risposta sono catturati (fino a 50KB complessivi).

Utile per: aprire un incidente PagerDuty, pubblicare su Slack, chiamare la tua API admin, ecc. I passi HTTP girano direttamente sul Worker OneUptime; non serve alcun agente.

### Bash

Uno script bash (`bash -c <script>`) eseguito su un [Agente Runbook](/docs/runbooks/agents) nella tua infrastruttura. Bash non viene mai eseguito sul Worker OneUptime.

Configura due cose in un passo Bash:

- **Agente Runbook** — scegli dal dropdown l'agente che deve eseguire questo passo. Solo l'agente selezionato può reclamare il job.
- **Script** — il bash da eseguire. L'output (stdout + stderr) è catturato fino a 50&nbsp;KB; il processo viene ucciso allo scadere del timeout.

Se l'agente selezionato è offline quando il runbook arriva a questo passo, il passo attende fino al **claim timeout** (default 2 minuti) e poi fallisce con `TimedOut`. Aggiungi un agente in **Runbook → Impostazioni → Agenti** prima di affidarti a un passo Bash.

### AI

Chiedi all'AI di analizzare, riassumere o decidere qualcosa durante l'esecuzione. Il prompt viene inviato al provider LLM del tuo progetto (**Impostazioni → Sentinel → LLM Providers**) e la risposta del modello diventa l'output del passo nella timeline dell'esecuzione. I passi AI girano direttamente sul Worker OneUptime; non serve alcun agente.

Configura in un passo AI:

- **Prompt** — cosa deve fare l'AI. Per esempio: "Esamina l'output dei passi precedenti e indica se è sicuro procedere con la remediation."
- **Includi il contesto dei passi precedenti** — se attivo, l'AI vede tutto ciò che riguarda i passi eseguiti prima di questo: titolo, tipo, stato, output e messaggi di errore.
- **Includi il contesto del trigger** — se attivo, l'AI vede cosa ha avviato l'esecuzione: l'incidente, l'allarme o la manutenzione programmata collegati (descrizione, gravità, stato corrente, monitor interessati, causa principale, timeline degli stati e note pubbliche), oppure chi ha eseguito il runbook manualmente.

Abbina un passo AI a **Richiede approvazione** per mettere un umano nel loop: l'AI analizza, chi risponde legge la sua risposta e approva, e solo allora parte il passo successivo (di remediation).

**Cosa l'AI non vede mai.** La risposta di un passo AI viene salvata come output del passo sull'esecuzione, e le esecuzioni sono leggibili da chiunque abbia il permesso di lettura sui runbook — un pubblico più ampio della ACL dell'incidente. Per questo il contesto del trigger esclude deliberatamente le **note interne private** e i **messaggi dei canali Slack/Teams**: restano dentro l'incidente, dove gli attuali generatori di postmortem e di note conservano il testo che ne derivano. L'output dei passi precedenti viene analizzato alla ricerca di segreti (token, chiavi, credenziali) e redatto prima di essere inviato al modello.

I passi AI sono conteggiati e fatturati come ogni altra funzionalità AI. Se non è configurato alcun provider LLM per il progetto, il passo fallisce con un errore chiaro (imposta **Continua in caso di errore** se il resto del runbook deve comunque girare).

## Salvare e modificare

Clicca **Salva passi** per persistere. Le esecuzioni in corso di versioni precedenti del runbook non vengono toccate — continuano a usare il loro snapshot.

## Più passi e gestione degli errori

Di default, un passo fallito ferma l'esecuzione e la marca come `Failed`. Se imposti **Continua in caso di errore** su un passo, l'errore viene registrato ma il passo successivo viene eseguito. Utile per pattern del tipo "prova queste tre cose, poi notifica".

## Un esempio concreto

Un runbook semplice per "DB primary irraggiungibile":

1. **JavaScript** — recupera l'host primary attuale dal tuo servizio di configurazione e loggalo.
2. **Manuale** — "Confermare che il lag di replica sulla secondaria sia sotto i 5 secondi."
3. **Richiesta HTTP** — POST all'API del tuo orchestratore di failover.
4. **Manuale** — "Verificare che le scritture stiano andando al nuovo primary."
5. **Richiesta HTTP** — POST a Slack con un messaggio "tutto a posto".

Chi risponde guarda un passo automatizzato partire, spunta uno manuale, guarda il successivo automatizzato partire e così via. L'output di ogni passo viene catturato per il postmortem.
