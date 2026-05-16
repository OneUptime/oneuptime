# Runbook-configuratie & veiligheid

## Uitvoerlimieten

- Uitvoer per stap: **50 KB**. Grotere uitvoer wordt afgebroken met een marker.
- Timeout per stap (standaard): **30 seconden** voor JavaScript, Bash en HTTP. Per stap instelbaar.
- **Claim timeout** voor Bash- en JavaScript-stappen (standaard): **2 minuten** — zo lang wacht de Worker tot een Runbook-agent de job oppakt voordat hij faalt.

## Rechten

Runbook-rechten leven in de rechtengroep `Runbook`:

- `CreateRunbook`, `EditRunbook`, `DeleteRunbook`, `ReadRunbook` — runbook-sjablonen beheren.
- `CreateRunbookExecution`, `EditRunbookExecution`, `ReadRunbookExecution` — uitvoeringen starten, aftikken en lezen.
- `CreateRunbookRule`, `EditRunbookRule`, `DeleteRunbookRule`, `ReadRunbookRule` — auto-triggerregels beheren.
- `CreateRunbookAgent`, `EditRunbookAgent`, `DeleteRunbookAgent`, `ReadRunbookAgent` — Runbook-agents beheren die Bash-stappen in je eigen infrastructuur uitvoeren.
- `RunbookAdmin` (rol) — bundelt al het bovenstaande; ken deze toe aan een team om volledige runbook-capabilities te geven.

## Queue & worker

Runbook-uitvoeringen draaien op de BullMQ-queue `Runbook`. De worker-concurrency staat op 25 — pas dit in jouw deploy aan als je veel gelijktijdige runs hebt.

Wanneer een handmatige stap via de API wordt afgevinkt, gaat de uitvoering opnieuw in de queue om bij de volgende stap door te gaan. Zo blijft de worker warm voor de rest van het runbook.

## Hardening-notities

- **Bash- en JavaScript-stappen** draaien nooit op de OneUptime Worker. Ze worden als jobs gestuurd naar een [Runbook-agent](/docs/runbooks/agents) die jij in je eigen infrastructuur hebt geïnstalleerd. De Worker zet de job in de queue met de **Agent Tag** en het staptype, een agent claimt deze atomair, voert deze lokaal uit — Bash via `bash -c <script>`, JavaScript binnen een `isolated-vm`-sandbox met de gebruikelijke preambule (verbreekt prototype-ketens, verwijdert `Function` en `eval`, bevriest ingebouwde prototypes) — en stuurt het resultaat terug. Het Worker-proces zelf voert geen klantscripts uit.
- **HTTP-stappen** gebruiken een tolerante statusvalidator, zodat een 4xx- of 5xx-respons als mislukte stap wordt geregistreerd in plaats van te worden gegooid. Hierdoor weerspiegelt de vastgelegde uitvoer wat de tegenpartij echt teruggaf.

## Databasetabellen

- `Runbook` — sjabloon (naam, slug, beschrijving, isEnabled, JSON van stappen).
- `RunbookExecution` — één rij per run, met nullbare foreign keys `incidentId`, `alertId` en `scheduledMaintenanceId` en een JSON-array `stepExecutions` die stappen en status per stap vastlegt.
- `RunbookRule` — auto-triggerregels met de discriminator `triggerEntityType` (Incident, Alert, ScheduledMaintenance) en een many-to-many-relatie naar de te starten runbooks.
- `RunbookAgent` — één rij per geïnstalleerde agent: naam, tags, geheime sleutel, `lastAlive`, `connectionStatus`, host-info.
- `RunbookAgentJob` — één rij per verstuurde Bash- of JavaScript-stap: vereiste tag, staptype, script, status (Pending → Claimed → Running → Succeeded/Failed/TimedOut/Cancelled), claim deadline, lease, uitvoer, exit code.

## Operationele tips

- **Draai minstens één agent per tag die je gebruikt**, bij voorkeur twee voor hoge beschikbaarheid. Met twee agents met dezelfde tag kan iedereen een job claimen — je kunt rolling restarts doen zonder runbooks te breken.
- **Bewaar URL's, geen blobs.** Genereert een stap meer dan een paar KB, schrijf het naar S3 of je log-stack en geef de URL terug.
- **Idempotentie telt.** Geautomatiseerde stappen (HTTP, JavaScript, Bash) kunnen meerdere keren draaien als de worker midden in een stap herstart of als de lease van een agent verloopt terwijl een script nog draait; ontwerp ze zodat een retry veilig is.
