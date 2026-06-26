# Runbook-configuratie & veiligheid

## Hoe Bash en JavaScript écht draaien

Bash- en JavaScript-stappen **draaien nooit op de OneUptime Worker**. Ze worden als jobs gedispatcht naar een specifieke [Runbook-agent](/docs/runbooks/agents) — een klein proces dat je installeert op een host binnen je eigen infrastructuur.

Het dispatch-model:

1. De auteur van de runbook-stap kiest bij het schrijven van de stap een Runbook-agent uit de dropdown.
2. Wanneer de stap draait, voegt de Worker een rij toe in `RunbookAgentJob` met `targetAgentId` gezet op de ID van die agent en status `Pending`.
3. Die specifieke agent (en alleen die agent) claimt de job atomair, voert het script lokaal uit — Bash via `bash -c <script>`, JavaScript in een `isolated-vm`-sandbox — en stuurt het resultaat terug.
4. De Worker hervat het runbook met het resultaat.

Er is geen `RUNBOOK_BASH_ENABLED`-environmentvlag meer. Of Bash- of JavaScript-stappen werken in een deployment hangt geheel af van of er ten minste één verbonden Runbook-agent in het project bestaat.

## Outputlimieten en timeouts

- Output per stap: **50&nbsp;KB**. Grotere output wordt afgekapt met een marker.
- Standaard uitvoer-timeout per stap: **30 seconden** voor JavaScript, Bash en HTTP. Per stap configureerbaar.
- **Claim-timeout** per stap voor Bash- en JavaScript-stappen: **2 minuten** — hoe lang de Worker wacht tot de gekozen agent de job oppakt voordat hij faalt.

## Rechten

Runbook-rechten leven in de `Runbook`-rechtengroep:

- `CreateRunbook`, `EditRunbook`, `DeleteRunbook`, `ReadRunbook` — runbook-templates beheren.
- `CreateRunbookExecution`, `EditRunbookExecution`, `ReadRunbookExecution` — uitvoeringen starten, afvinken en lezen.
- `CreateRunbookRule`, `EditRunbookRule`, `DeleteRunbookRule`, `ReadRunbookRule` — auto-trigger-regels beheren.
- `CreateRunbookAgent`, `EditRunbookAgent`, `DeleteRunbookAgent`, `ReadRunbookAgent` — Runbook-agents beheren die Bash- en JavaScript-stappen in je eigen infrastructuur uitvoeren.
- `RunbookAdmin`, `RunbookMember`, `RunbookViewer` (rollen) — toewijzen aan een team om volledige controle, dagelijks gebruik of alleen-lezen toegang te verlenen. `RunbookAdmin` bundelt alle bovenstaande granulaire rechten.

## Queue & worker

Runbook-uitvoeringen draaien op de `Runbook`-BullMQ-queue. De worker-concurrency staat op 25 — pas dit aan in je deployment als je veel gelijktijdige runs hebt.

Wanneer een handmatige stap via de API wordt afgevinkt, wordt de uitvoering opnieuw in de queue gezet om vanaf de volgende stap door te gaan. Dit houdt de worker warm voor de rest van het runbook.

## Hardening-notities

- **JavaScript en Bash** draaien op een Runbook-agent-host die jij beheert, niet op de OneUptime Worker. JavaScript zit verpakt in een `isolated-vm`-sandbox met de gebruikelijke prelude (kapt prototype-ketens af, verwijdert `Function`/`eval`, vriest ingebouwde prototypes in). Bash draait via `bash -c` met timeout-handhaving op de agent.
- **HTTP-stappen** gebruiken een permissieve status-validator, dus een 4xx- of 5xx-respons wordt vastgelegd als gefaalde stap in plaats van gegooid. Daardoor weerspiegelt de vastgelegde output wat de upstream daadwerkelijk teruggaf.
- **Agent-auth** verloopt via ID + secret-sleutel, ingesteld op de agent-container als environment variables. Server-side komt de gezaghebbende agent-identiteit uit de DB-rij die wordt opgezocht via de gepresenteerde ID/sleutel — clients kunnen zelfs met een gecompromitteerde sleutel geen andere agent imiteren.

## Database-tabellen

- `Runbook` — template (name, slug, description, isEnabled, steps JSON).
- `RunbookExecution` — één rij per run, met nullable `incidentId`-, `alertId`- en `scheduledMaintenanceId`-foreign keys en een JSON-`stepExecutions`-array die de stappen en per-stap-status snapshotten.
- `RunbookRule` — auto-trigger-regels met een `triggerEntityType`-discriminator (Incident, Alert, ScheduledMaintenance) en een many-to-many-relatie naar te starten runbooks.
- `RunbookAgent` — één rij per geïnstalleerde agent: naam, secret-sleutel, `lastAlive`, `connectionStatus`, host-info.
- `RunbookAgentJob` — één rij per gedispatchte Bash- of JavaScript-stap: `targetAgentId` (de agent die de stapauteur uitkoos), staptype, script, status (`Pending` → `Claimed` → `Running` → `Succeeded`/`Failed`/`TimedOut`/`Cancelled`), claim-deadline, lease, output, exit-code.

## Operationele tips

- **Zorg dat de agent die je op een stap kiest gezond is.** Heb je redundantie nodig, draai dan een tweede agent en verdeel je stappen over hen, of houd een back-up-runbook achter de hand dat op de andere agent richt.
- **Leg URLs vast, geen blobs.** Genereert een stap meer dan een paar KB output, schrijf die dan naar S3 of je logging-stack en geef de URL terug.
- **Idempotentie telt.** Geautomatiseerde stappen (HTTP, JavaScript, Bash) kunnen meer dan eens draaien als de worker midden in een stap herstart of als de lease van een agent verloopt terwijl een script nog draait; ontwerp ze zo dat ze veilig opnieuw kunnen worden gedraaid.
