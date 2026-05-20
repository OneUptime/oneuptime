# Workflows – Overzicht

Workflows zijn de visuele automatiseringsbouwer van OneUptime. Sleep een trigger op een canvas, koppel hem aan een keten van acties — HTTP-aanroepen, Slack-berichten, JavaScript-snippets, voorwaardelijke vertakkingen, database-lookups — en je hebt automatisering die afgaat zodra er een gebeurtenis in OneUptime (of in de buitenwereld) plaatsvindt.

Als runbooks checklists zijn voor mensen tijdens een incident, dan zijn workflows achtergrondtaken voor je project — ze draaien onbeheerd, ze reageren op dingen en ze plakken OneUptime aan de rest van je stack.

## In één oogopslag

- **Top-level feature** in het OneUptime-dashboard onder **Workflows**.
- **Drie triggerstijlen**: Handmatig, Schedule (cron), Webhook — plus een **model-event-trigger** die afgaat wanneer een willekeurige OneUptime-entiteit (incident, alert, monitor, statuspagina, enz.) wordt aangemaakt, bijgewerkt of verwijderd.
- **Visueel canvas**: sleep nodes uit een componentenpalet, verbind output-poorten met input-poorten.
- **Gemengde automatisering**: HTTP-verzoeken, Slack- / Discord- / Microsoft Teams- / Telegram-berichten, custom JavaScript, JSON-parsing, voorwaardelijke logica, e-mail, subworkflow-aanroepen en CRUD-bewerkingen op OneUptime-modellen.
- **Global Variables**: projectbrede geheimen en configuratie waarnaar je vanuit elke workflow kunt verwijzen zonder kopiëren-plakken.
- **Runs & Logs**: elke uitvoering wordt vastgelegd met status, timing en output per stap.

## Waarom workflows gebruiken?

De meeste teams pakken workflows wanneer ze willen:

- **OneUptime aan een ander systeem koppelen** — een incident naar PagerDuty posten, een alert spiegelen in Jira, een webhook in je stack pingen.
- **Reageren op OneUptime-events** — wanneer een `Sev 1`-incident wordt geopend, de dienstdoende manager pagen *én* een Linear-ticket aanmaken *én* een feature flag vergrendelen.
- **Terugkerende taken plannen** — elke vijf minuten een interne API bevragen en het resultaat in een extern systeem schrijven.
- **Data van buiten OneUptime ontvangen** — een webhook van een CI-systeem start een keten van OneUptime-updates.
- **Kleine stukjes lijmlogica hergebruiken** — de ene workflow roept de andere aan, zodat veelvoorkomende patronen op één plek leven.

## Kernbegrippen

| Term | Betekenis |
| --- | --- |
| **Workflow** | Het canvas. Een benoemde, herbruikbare graph van triggers en componenten met een `isEnabled`-vlag. |
| **Trigger** | De node die een workflow-uitvoering start. Handmatig, Schedule, Webhook of een model-event. Elke workflow heeft precies één trigger. |
| **Component** | Een node die werk verricht — een HTTP-aanroep, een Slack-bericht, een JavaScript-snippet, een voorwaarde, enz. |
| **Poort** | Een input- of output-aansluiting op een node. Componenten hebben output-poorten zoals `success` en `error`; je verbindt een poort met de input-poort van de volgende node. |
| **Run / Log** | Eén uitvoering van een workflow. Bevat het tijdstip, de status (Running, Success, Failed, Timeout) en de vastgelegde output van elke node die heeft gedraaid. |
| **Global Variable** | Een benoemde waarde (vaak een geheim of API-sleutel) die één keer op projectniveau wordt gedefinieerd en vanuit elke workflow wordt aangeroepen als `{{variable.NAME}}`. |
| **Local Variable** | Een waarde die alleen geldt binnen één workflow-uitvoering — meestal de returnwaarde van een eerdere node, aangeroepen als `{{ComponentId.portName}}`. |

## Waar workflows leven in het dashboard

| Pagina | Wat je daar doet |
| --- | --- |
| **Workflows** | Workflow-templates doorbladeren, aanmaken en zoeken. |
| **Het Builder-tabblad van een workflow** | Het drag-and-drop-canvas. Nodes toevoegen, poorten verbinden, argumenten configureren. |
| **Het Logs-tabblad van een workflow** | Elke run van deze workflow met filters voor status en tijdsbereik. Klik op een run om de output per node te zien. |
| **Het Settings-tabblad van een workflow** | Hernoemen, in-/uitschakelen, de beschrijving aanpassen, labels beheren, verwijderen. |
| **Workflows → Global Variables** | Projectbrede waarden definiëren waarnaar elke workflow kan verwijzen. Markeer een waarde als secret om die na opslaan te verbergen in de UI. |
| **Workflows → Runs & Logs** | Projectbrede uitvoeringsgeschiedenis voor alle workflows. |

## De levenscyclus van een workflow

1. **Schrijven** — Maak een workflow aan, zet een trigger op het canvas, sleep de componenten erin die je nodig hebt, verbind ze en configureer ze elk.
2. **Inschakelen** — Workflows worden uitgeschakeld geleverd. Zet de schakelaar om in Settings zodra je zeker weet dat de bedrading klopt.
3. **Triggeren** — Handmatig: klik op **Run Manually** met een optionele JSON-payload. Schedule: cron gaat af. Webhook: een extern systeem doet een `POST` naar de workflow-URL. Model-event: iemand (of een andere workflow) maakt een monitor, incident, alert, enz. aan, werkt die bij of verwijdert hem.
4. **Uitvoeren** — De Workflow Worker loopt de graph in volgorde af. Elke component leest zijn argumenten (letterlijke waarden of geïnterpoleerde variabelen), doet zijn werk, schrijft zijn returnwaarde en kiest een output-poort. De volgende node gaat af.
5. **Auditeren** — De run verschijnt in **Logs**. Status, totale duur, output per component en eventuele fouten blijven bewaard voor de duur van het project.

## Een uitgewerkt voorbeeld

Doel: wanneer er een incident wordt aangemaakt met `Sev 1` in de titel, post je een bericht in een Slack-kanaal en open je een ticket in je interne admin-tool.

**1. Maak een workflow** aan met de naam "Sev 1 fan-out."

**2. Plaats een trigger.** Kies de **Incident → On Create**-trigger uit het palet. De trigger stelt het nieuwe incident beschikbaar als returnwaarde.

**3. Plaats een Conditional-component.** Verbind de output-poort van de trigger met zijn input. Stel de voorwaarde in: `{{Incident.title}}` *contains* `Sev 1`.

**4. Vanuit de `yes`-poort van de Conditional, plaats een Slack-component.** Kanaal: `#incident-room`. Berichttekst: `Sev 1 declared: {{Incident.title}} — {{Incident.dashboardUrl}}`.

**5. Vanuit dezelfde `yes`-poort (parallel), plaats een API-component.** `POST` naar `https://admin.internal/incidents`. Body: een klein JSON-object opgebouwd uit het incident.

**6. Schakel de workflow in.** Open in een ander tabblad een incident met de titel "Sev 1 — checkout 500s". Binnen enkele seconden komt het Slack-bericht binnen en verschijnt er een nieuwe run onder **Logs** met de output van elke node vastgelegd.

## Hoe workflows samenwerken met de rest van OneUptime

- **Monitors** detecteren problemen; **incidenten/alerts** leggen ze vast; **workflows** reageren erop — berichten posten, tickets openen, automatisering starten.
- **Runbooks** zijn responsprocedures voor mensen (met optionele scriptstappen). Workflows zijn onbeheerde achtergrondautomatisering. Ze vullen elkaar aan — een runbook-stap kan via `POST` een webhook-trigger van een workflow afvuren.
- **Workspace-verbindingen** (Slack, Microsoft Teams) zijn de typische bestemmingen voor workflow-meldingen.
- **Dashboards** zijn alleen-lezen views; workflows zijn de schrijfkant — ze werken OneUptime-state bij, roepen externe API's aan en verplaatsen data.

## Waar verder lezen

- [Een workflow maken](/docs/workflows/authoring) — een workflow bouwen op het canvas, nodes configureren, poorten verbinden.
- [Triggers](/docs/workflows/triggers) — Handmatige, Schedule-, Webhook- en model-event-triggers in detail.
- [Componenten](/docs/workflows/components) — de catalogus van acties en hoe je ze elk configureert.
- [Variabelen](/docs/workflows/variables) — globale variabelen, lokale variabelen en hoe interpolatie werkt.
- [Uitvoeringen en logboeken](/docs/workflows/runs-and-logs) — uitvoeringsgeschiedenis lezen, fouten debuggen.
- [Configuratie en veiligheid](/docs/workflows/configuration) — in-/uitschakelen, eigenaarschap, labels, geheimen, recursielimieten.
