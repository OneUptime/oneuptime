# Een runbook schrijven

Maak een runbook via **Runbooks → Runbook aanmaken**, open het daarna en ga naar het tabblad **Steps**.

## Anatomie van een stap

Elke stap heeft:

| Veld                            | Doel                                                                                                               |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| **Titel**                       | Kort label dat in de checklist-UI wordt getoond. Verplicht.                                                        |
| **Beschrijving**                | Optionele context voor de responder. Markdown-veilige tekst.                                                       |
| **Doorgaan bij fout**           | Indien aan stopt een falende stap de run niet — de volgende stap draait gewoon.                                    |
| **Goedkeuring vereist**         | Indien aan pauzeert het runbook na deze stap en wacht tot een gebruiker goedkeurt voordat de volgende stap draait. |
| **Typespecifieke configuratie** | Script, URL, agent, enz. — zie hieronder.                                                                          |

Stappen draaien **op volgorde**. Herorden ze met de pijltjes omhoog/omlaag in de Steps-editor.

## Staptypes

### Handmatig

Een vinkje dat de responder afvinkt. De runbook-uitvoering pauzeert wanneer hij een Handmatige stap bereikt en blijft in `WaitingForManualStep` totdat iemand hem als voltooid markeert (of overslaat).

Gebruik dit voor dingen die alleen een mens kan verifiëren: "Bevestigd dat het verkeer in het load-balancer-dashboard naar de secundaire regio is verplaatst."

### JavaScript

Een snippet JavaScript dat in een `isolated-vm`-sandbox draait. De sandbox leeft op een [Runbook-agent](/docs/runbooks/agents) in je eigen infrastructuur — niet op de OneUptime Worker.

Configureer twee dingen op een JavaScript-stap:

- **Runbook-agent** — kies uit de dropdown de agent die deze stap moet uitvoeren. Alleen de gekozen agent mag de job claimen.
- **Script** — het uit te voeren JavaScript.

```js
const start = Date.now();
// ... jouw logica ...
return { durationMs: Date.now() - start };
```

De teruggegeven waarde wordt vastgelegd op de stapuitvoering. `console.log`-output wordt vastgelegd als logregels. Standaard uitvoer-timeout: 30 seconden. Standaard claim-timeout (hoe lang de Worker wacht tot de agent de job oppakt): 2 minuten.

### HTTP-verzoek

Een uitgaande HTTP-aanroep doen. Configureer methode (GET/POST/PUT/PATCH/DELETE/HEAD), URL, optionele JSON-headers en optionele body. Responsstatus, -headers en -body worden vastgelegd (totaal beperkt tot 50KB).

Handig voor: een PagerDuty-incident triggeren, naar Slack posten, je eigen admin-API aanroepen, enz. HTTP-stappen draaien rechtstreeks op de OneUptime Worker; geen agent nodig.

### Bash

Een bash-script (`bash -c <script>`) dat draait op een [Runbook-agent](/docs/runbooks/agents) in je eigen infrastructuur. Bash draait nooit op de OneUptime Worker.

Configureer twee dingen op een Bash-stap:

- **Runbook-agent** — kies uit de dropdown de agent die deze stap moet uitvoeren. Alleen de gekozen agent mag de job claimen.
- **Script** — de uit te voeren bash. Output (stdout + stderr) wordt tot 50 KB vastgelegd; het proces wordt bij timeout afgebroken.

Als de gekozen agent offline is wanneer het runbook deze stap bereikt, wacht de stap tot de **claim-timeout** (standaard 2 minuten) en faalt dan met `TimedOut`. Voeg een agent toe via **Runbooks → Settings → Agents** voordat je op een Bash-stap leunt.

### AI

Vraag AI om midden in een run iets te analyseren, samen te vatten of te beslissen. De prompt wordt naar de LLM-provider van je project gestuurd (**Settings → Sentinel → LLM Providers**) en het antwoord van het model wordt de stapoutput op de uitvoeringstijdlijn. AI-stappen draaien op de OneUptime Worker; er is geen agent nodig.

Configureer op een AI-stap:

- **Prompt** — wat de AI moet doen. Bijvoorbeeld: "Beoordeel de output van de vorige stappen en geef aan of het veilig is om door te gaan met remediëren."
- **Context van vorige stappen meesturen** — indien aan ziet de AI alles over de stappen die vóór deze stap draaiden: titel, type, status, output en foutmeldingen.
- **Triggercontext meesturen** — indien aan ziet de AI wat de uitvoering startte: het gekoppelde incident, de alert of het geplande onderhoudsevent (de beschrijving, ernst, huidige status, getroffen monitors, hoofdoorzaak, statustijdlijn en publieke notities), of wie het runbook handmatig heeft gestart.

Combineer een AI-stap met **Goedkeuring vereist** om een mens in de lus te houden: de AI analyseert, een responder leest het antwoord en keurt goed, en pas dan draait de volgende (remediërende) stap.

**Wat de AI nooit ziet.** Het antwoord van een AI-stap wordt opgeslagen als stapoutput op de uitvoering, en uitvoeringen zijn leesbaar voor iedereen met leesrechten op runbooks — een breder publiek dan de ACL van het incident. Daarom sluit de triggercontext bewust **privé interne notities** en **Slack/Teams-kanaalberichten** uit: die blijven binnen het incident, waar de bestaande postmortem- en notitiegeneratoren hun afgeleide tekst bewaren. Stapoutput van eerdere stappen wordt gescand op geheimen (tokens, sleutels, credentials) en geredigeerd voordat deze naar het model wordt gestuurd.

AI-stappen worden gemeterd en gefactureerd zoals elke andere AI-functie. Als er geen LLM-provider is geconfigureerd voor het project, faalt de stap met een duidelijke foutmelding (zet **Doorgaan bij fout** aan als de rest van het runbook toch moet draaien).

## Opslaan en bewerken

Druk op **Stappen opslaan** om te persisteren. Lopende uitvoeringen van oudere versies van het runbook worden niet beïnvloed — ze blijven hun snapshot gebruiken.

## Meerdere stappen en foutafhandeling

Standaard stopt een falende stap de run en wordt de uitvoering gemarkeerd als `Failed`. Als je **Doorgaan bij fout** op een stap zet, wordt een fout vastgelegd maar draait de volgende stap. Dit is handig voor "probeer deze drie dingen, dan melden"-patronen.

## Een uitgewerkt voorbeeld

Een eenvoudig runbook voor "DB-primary onbereikbaar":

1. **JavaScript** — haal de huidige primary-host op uit je configservice en log hem.
2. **Handmatig** — "Bevestig dat de replicatie-lag in de secundaire onder 5 seconden ligt."
3. **HTTP-verzoek** — POST naar de API van je failover-orchestrator.
4. **Handmatig** — "Verifieer dat writes nu naar de nieuwe primary gaan."
5. **HTTP-verzoek** — POST naar Slack met een "all clear"-bericht.

De responder ziet een geautomatiseerde stap draaien, vinkt een handmatige af, ziet de volgende geautomatiseerde stap draaien, enzovoort. De output van elke stap wordt vastgelegd voor de post-mortem.
