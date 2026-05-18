# Runbook-konfigurasjon & sikkerhet

## Hvordan Bash og JavaScript faktisk kjører

Bash- og JavaScript-trinn **kjøres aldri på OneUptime-Worker'en**. De sendes som jobber til en spesifikk [Runbook-agent](/docs/runbooks/agents) — en liten prosess du installerer på en vert i din egen infrastruktur.

Sendemodellen:

1. Runbook-trinnforfatteren velger en Runbook-agent fra nedtrekksmenyen når trinnet skrives.
2. Når trinnet kjører, setter Worker'en inn en rad i `RunbookAgentJob` med `targetAgentId` satt til den agentens ID og status `Pending`.
3. Den spesifikke agenten (og bare den agenten) claimer atomisk jobben, kjører skriptet lokalt — Bash via `bash -c <skript>`, JavaScript inne i en `isolated-vm`-sandkasse — og sender resultatet tilbake.
4. Worker'en gjenopptar runbook'et med resultatet.

Det finnes ikke lenger noe `RUNBOOK_BASH_ENABLED`-environment-flagg. Hvorvidt Bash- eller JavaScript-trinn fungerer i en distribusjon avhenger fullstendig av om det finnes minst én tilkoblet Runbook-agent i prosjektet.

## Output-grenser og timeouts

- Output per trinn: **50&nbsp;KB**. Større output kortes ned med en markør.
- Standard execution timeout per trinn: **30 sekunder** for JavaScript, Bash og HTTP. Konfigurerbar per trinn.
- Per-trinn **claim timeout** for Bash- og JavaScript-trinn: **2 minutter** — hvor lenge Worker'en venter på at den valgte agenten plukker opp jobben før den feiler.

## Rettigheter

Runbook-rettigheter ligger i rettighetsgruppen `Runbook`:

- `CreateRunbook`, `EditRunbook`, `DeleteRunbook`, `ReadRunbook` — styre runbook-maler.
- `CreateRunbookExecution`, `EditRunbookExecution`, `ReadRunbookExecution` — starte, krysse av og lese kjøringer.
- `CreateRunbookRule`, `EditRunbookRule`, `DeleteRunbookRule`, `ReadRunbookRule` — styre automatiske utløsningsregler.
- `CreateRunbookAgent`, `EditRunbookAgent`, `DeleteRunbookAgent`, `ReadRunbookAgent` — styre Runbook-agenter som kjører Bash- og JavaScript-trinn i din egen infrastruktur.
- `RunbookAdmin`, `RunbookMember`, `RunbookViewer` (roller) — tildel et team for å gi henholdsvis full kontroll, daglig bruk eller lesetilgang. `RunbookAdmin` samler alle de granulære rettighetene over.

## Kø & worker

Runbook-kjøringer går på BullMQ-køen `Runbook`. Worker-samtidighet er 25 — juster i distribusjonen din om du har mange samtidige kjøringer.

Når et manuelt trinn hukes av via API-et, settes kjøringen tilbake i køen for å fortsette til neste trinn. Det holder workeren varm til resten av runbook'et.

## Herding-merknader

- **JavaScript og Bash** kjøres på en Runbook-agent-vert du kontrollerer, ikke på OneUptime-Worker'en. JavaScript pakkes inn i en `isolated-vm`-sandkasse med den vanlige preambelen (kapper prototype-kjeder, fjerner `Function`/`eval`, fryser innebygde prototyper). Bash kjøres via `bash -c` med timeout-håndhevelse på agenten.
- **HTTP-trinn** bruker en ettergivende statusvalidator, slik at et 4xx- eller 5xx-svar registreres som feilet trinn i stedet for å kastes. Dermed gjenspeiler det fangede outputet hva motparten faktisk returnerte.
- **Agent-auth** skjer via ID + hemmelig nøkkel, satt på agent-containeren som env vars. På serversiden kommer agentens autoritative identitet fra DB-raden som er identifisert av den fremlagte ID-en/nøkkelen — klienter kan ikke utgi seg for å være en annen agent, selv med en kompromittert nøkkel.

## Databasetabeller

- `Runbook` — mal (navn, slug, beskrivelse, isEnabled, JSON for trinn).
- `RunbookExecution` — én rad per kjøring, med nullbare fremmednøkler `incidentId`, `alertId` og `scheduledMaintenanceId` og et JSON-array `stepExecutions` som tar snapshot av trinn og status per trinn.
- `RunbookRule` — automatiske utløsningsregler med diskriminator `triggerEntityType` (Incident, Alert, ScheduledMaintenance) og mange-til-mange-relasjon til runbookene som skal starte.
- `RunbookAgent` — én rad per installert agent: navn, hemmelig nøkkel, `lastAlive`, `connectionStatus`, vertsinfo.
- `RunbookAgentJob` — én rad per sendt Bash- eller JavaScript-trinn: `targetAgentId` (agenten trinnforfatteren valgte), trinntype, skript, status (`Pending` → `Claimed` → `Running` → `Succeeded`/`Failed`/`TimedOut`/`Cancelled`), claim-deadline, lease, output, exit-kode.

## Driftsråd

- **Pass på at agenten du velger på et trinn er sunn.** Trenger du redundans, kjør en andre agent og fordel trinn mellom dem, eller ha et backup-runbook som peker på den andre agenten.
- **Fang URL-er, ikke blobs.** Genererer et trinn mer enn et par KB, skriv til S3 eller logstacken din og returner URL-en.
- **Idempotens betyr noe.** Automatiserte trinn (HTTP, JavaScript, Bash) kan kjøre mer enn én gang om workeren restarter midt i et trinn eller om en agents lease utløper mens et skript fortsatt kjører; design dem slik at retry er trygt.
