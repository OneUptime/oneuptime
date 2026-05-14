# Runbook-konfigurasjon & sikkerhet

## Output-grenser

- Output per trinn: **50 KB**. Større output kortes ned med en markør.
- Standard timeout per trinn: **30 sekunder** for JavaScript, Bash og HTTP. Kan settes per trinn.
- **Claim timeout** for Bash- og JavaScript-trinn (standard): **2 minutter** — så lenge venter Worker'en på at en Runbook-agent tar jobben før den feiler.

## Rettigheter

Runbook-rettigheter ligger i rettighetsgruppen `Runbook`:

- `CreateRunbook`, `EditRunbook`, `DeleteRunbook`, `ReadRunbook` — styre runbook-maler.
- `CreateRunbookExecution`, `EditRunbookExecution`, `ReadRunbookExecution` — starte, krysse av og lese kjøringer.
- `CreateRunbookRule`, `EditRunbookRule`, `DeleteRunbookRule`, `ReadRunbookRule` — styre automatiske utløsningsregler.
- `CreateRunbookAgent`, `EditRunbookAgent`, `DeleteRunbookAgent`, `ReadRunbookAgent` — styre Runbook-agenter som kjører Bash-trinn i din egen infrastruktur.
- `RunbookManager` (rolle) — samler alt det over; tildel til et team for å gi full runbook-kapasitet.

## Kø & worker

Runbook-kjøringer går på BullMQ-køen `Runbook`. Worker-samtidighet er 25 — juster i distribusjonen din om du har mange samtidige kjøringer.

Når et manuelt trinn hukes av via API-et, settes kjøringen tilbake i køen for å fortsette til neste trinn. Det holder workeren varm til resten av runbook'et.

## Herding-merknader

- **Bash- og JavaScript-trinn** kjører aldri på OneUptime-Worker'en. De sendes som jobber til en [Runbook-agent](/docs/runbooks/agents) som du har installert i din egen infrastruktur. Worker'en legger jobben i kø med trinnets **Agent Tag** og trintype, en agent claimer den atomisk, kjører den lokalt — Bash via `bash -c <skript>`, JavaScript inne i en `isolated-vm`-sandkasse med den vanlige preambelen (kapper prototype-kjeder, fjerner `Function` og `eval`, fryser innebygde prototypes) — og sender resultatet tilbake. Selve Worker-prosessen kjører ikke kundescript.
- **HTTP-trinn** bruker en ettergivende statusvalidator, slik at et 4xx- eller 5xx-svar registreres som feilet trinn i stedet for å kastes. Dermed gjenspeiler det fangede outputet hva motparten faktisk returnerte.

## Databasetabeller

- `Runbook` — mal (navn, slug, beskrivelse, isEnabled, JSON for trinn).
- `RunbookExecution` — én rad per kjøring, med nullbare fremmednøkler `incidentId`, `alertId` og `scheduledMaintenanceId` og et JSON-array `stepExecutions` som tar snapshot av trinn og status per trinn.
- `RunbookRule` — automatiske utløsningsregler med diskriminator `triggerEntityType` (Incident, Alert, ScheduledMaintenance) og mange-til-mange-relasjon til runbookene som skal starte.
- `RunbookAgent` — én rad per installert agent: navn, tagger, hemmelig nøkkel, `lastAlive`, `connectionStatus`, vertsinfo.
- `RunbookAgentJob` — én rad per sendt Bash- eller JavaScript-trinn: påkrevd tag, trintype, skript, status (Pending → Claimed → Running → Succeeded/Failed/TimedOut/Cancelled), claim-deadline, lease, output, exit-kode.

## Driftsråd

- **Kjør minst én agent per tag du sikter mot**, helst to for høy tilgjengelighet. Med to agenter med samme tag kan begge claime en jobb — du kan gjøre rullende omstarter uten å bryte runbooks.
- **Fang URL-er, ikke blobs.** Genererer et trinn mer enn et par KB, skriv til S3 eller logstacken din og returner URL-en.
- **Idempotens betyr noe.** Automatiserte trinn (HTTP, JavaScript, Bash) kan kjøre mer enn én gang om workeren restarter midt i et trinn eller om en agents lease utløper mens et skript fortsatt kjører; design dem slik at retry er trygt.
