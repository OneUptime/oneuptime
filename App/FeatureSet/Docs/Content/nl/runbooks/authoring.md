# Een runbook schrijven

Maak een runbook via **Runbooks → Runbook aanmaken**, open het daarna en ga naar het tabblad **Stappen**.

## Anatomie van een stap

Elke stap heeft:

| Veld | Doel |
| --- | --- |
| **Titel** | Korte aanduiding in de checklist-UI. Verplicht. |
| **Beschrijving** | Optionele context voor de responder. Markdown-tekst. |
| **Doorgaan bij fout** | Indien aan, stopt een mislukte stap de run niet — de volgende stap draait toch. |
| **Typespecifieke configuratie** | Script, URL, enz. — zie hieronder. |

Stappen draaien **op volgorde**. Herorden ze met de op/neer-pijltjes in de stappeneditor.

## Staptypen

### Handmatig

Een vakje dat de responder afvinkt. De uitvoering pauzeert bij een handmatige stap en blijft in `WaitingForManualStep` totdat iemand hem afvinkt (of overslaat).

Gebruik dit voor wat alleen een mens kan verifiëren: "Verkeer is volgens het load balancer-dashboard naar de secundaire regio gegaan — bevestigd."

### JavaScript

Een stukje JavaScript dat draait in een `isolated-vm`-sandbox (geen filesystem, geen netwerk tenzij je zelf een API meebrengt) — maar de sandbox leeft op een [Runbook-agent](/docs/runbooks/agents) in je eigen infrastructuur, niet op de OneUptime Worker. Stel een **Agent Tag** in op de stap die wijst naar de agent(s) die hem moeten uitvoeren. Is er geen agent met die tag online, dan wacht de stap tot de **claim timeout** (standaard 2 minuten) en faalt vervolgens.

```js
const start = Date.now();
// ... jouw logica ...
return { durationMs: Date.now() - start };
```

De geretourneerde waarde wordt vastgelegd op de stap. `console.log`-uitvoer wordt als logregels bewaard. Standaard timeout: 30 seconden.

### HTTP-verzoek

Een uitgaande HTTP-aanroep. Stel methode (GET/POST/PUT/PATCH/DELETE/HEAD), URL, optionele JSON-headers en optionele body in. Statuscode, headers en body van de respons worden vastgelegd (samen maximaal 50 KB).

Handig voor: een PagerDuty-incident openen, in Slack plaatsen, je eigen admin-API aanroepen, enz.

### Bash

Een bash-script dat draait op een [Runbook-agent](/docs/runbooks/agents) — een klein proces dat je installeert op een host in je eigen infrastructuur. Bash-stappen worden nooit uitgevoerd op de OneUptime Worker.

Configureer twee dingen op een Bash-stap:

- **Agent Tag** — de tag die aangeeft welke agent(s) deze stap moet(en) uitvoeren. Elke gezonde agent in het project met die tag claimt en draait de job.
- **Script** — het bash dat moet draaien. Uitvoer (stdout + stderr) wordt tot 50 KB vastgelegd; het proces wordt bij een timeout gestopt.

Is er geen agent met de gekozen tag online wanneer het runbook deze stap bereikt, dan wacht de stap tot de **claim timeout** (standaard 2 minuten) en faalt dan. Voeg een agent toe via **Runbooks → Agents** voordat je op een Bash-stap leunt.

## Opslaan en bewerken

Druk op **Stappen opslaan** om vast te leggen. Lopende uitvoeringen van oudere versies van het runbook zijn niet beïnvloed — die blijven hun snapshot gebruiken.

## Meerdere stappen en foutafhandeling

Standaard stopt een mislukte stap de run en wordt de uitvoering `Failed`. Zet je **Doorgaan bij fout** aan op een stap, dan wordt de fout geregistreerd maar draait de volgende stap toch. Handig voor patronen als "probeer deze drie dingen, dan informeren".

## Een uitgewerkt voorbeeld

Een eenvoudig runbook voor "Primaire DB onbereikbaar":

1. **JavaScript** — huidige primaire host ophalen bij de config-service en loggen.
2. **Handmatig** — "Replicatievertraging op de secundaire onder 5 seconden — bevestigd."
3. **HTTP-verzoek** — POST naar de API van je failover-orchestrator.
4. **Handmatig** — "Schrijfacties gaan naar de nieuwe primary — bevestigd."
5. **HTTP-verzoek** — POST naar Slack met "alles weer veilig".

De responder ziet een geautomatiseerde stap draaien, vinkt een handmatige af, ziet de volgende geautomatiseerde, enzovoort. De uitvoer van elke stap wordt bewaard voor de postmortem.
