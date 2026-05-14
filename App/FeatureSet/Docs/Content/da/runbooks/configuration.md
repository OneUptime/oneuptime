# Runbook-konfiguration & sikkerhed

## Output-grænser

- Output per trin: **50 KB**. Større output afkortes med en markør.
- Standard timeout per trin: **30 sekunder** for JavaScript, Bash og HTTP. Kan indstilles per trin.
- **Claim timeout** for Bash-trin (standard): **2 minutter** — så længe venter Workeren på, at en Runbook-agent tager jobbet, før det fejler.

## Rettigheder

Runbook-rettigheder ligger i rettighedsgruppen `Runbook`:

- `CreateRunbook`, `EditRunbook`, `DeleteRunbook`, `ReadRunbook` — styre runbook-skabeloner.
- `CreateRunbookExecution`, `EditRunbookExecution`, `ReadRunbookExecution` — starte, tikke af og læse kørsler.
- `CreateRunbookRule`, `EditRunbookRule`, `DeleteRunbookRule`, `ReadRunbookRule` — styre automatiske udløsningsregler.
- `CreateRunbookAgent`, `EditRunbookAgent`, `DeleteRunbookAgent`, `ReadRunbookAgent` — styre Runbook-agenter, der udfører Bash-trin i din egen infrastruktur.
- `RunbookManager` (rolle) — samler alle ovenstående; tildel til et team for at give fuld runbook-kapacitet.

## Kø & worker

Runbook-kørsler kører på BullMQ-køen `Runbook`. Worker-samtidighed er 25 — juster i dit deploy, hvis du har mange samtidige kørsler.

Når et manuelt trin tikkes af via API'en, sættes kørslen tilbage i køen for at fortsætte til næste trin. Det holder workeren varm til resten af runbook'et.

## Hærdningsnoter

- **JavaScript-trin** kører i `isolated-vm` med en sandkasse-hærdnings-præambel (afbryder prototype-kæder, fjerner `Function` og `eval`, fryser indbyggede prototypes).
- **Bash-trin** kører aldrig på OneUptime-Worker'en. De sendes som jobs til en [Runbook-agent](/docs/runbooks/agents), som du har installeret i din egen infrastruktur. Worker'en lægger jobbet i kø med trinets **Agent Tag**, en agent claimer det atomart, kører `bash -c <script>` lokalt og sender resultatet tilbage. Selve Worker-processen har ikke shell-adgang til dit miljø.
- **HTTP-trin** bruger en eftergivende statusvalidator, så et 4xx- eller 5xx-svar registreres som fejlet trin i stedet for at blive kastet. Dermed afspejler det fangede output, hvad modparten faktisk returnerede.

## Databasetabeller

- `Runbook` — skabelon (navn, slug, beskrivelse, isEnabled, JSON for trin).
- `RunbookExecution` — én række per kørsel, med null-bare fremmednøgler `incidentId`, `alertId` og `scheduledMaintenanceId` og et JSON-array `stepExecutions`, der tager snapshot af trin og status per trin.
- `RunbookRule` — automatiske udløsningsregler med diskriminator `triggerEntityType` (Incident, Alert, ScheduledMaintenance) og mange-til-mange-relation til runbooks, der skal starte.
- `RunbookAgent` — én række per installeret agent: navn, tags, hemmelig nøgle, `lastAlive`, `connectionStatus`, host-info.
- `RunbookAgentJob` — én række per afsendt Bash-trin: påkrævet tag, script, status (Pending → Claimed → Running → Succeeded/Failed/TimedOut/Cancelled), claim-deadline, lease, output, exit-kode.

## Driftsråd

- **Kør mindst én agent per tag, du retter mod**, helst to for høj tilgængelighed. Med to agenter med samme tag kan begge claime et job — du kan lave rullende genstarter uden at bryde runbooks.
- **Fang URL'er, ikke blobs.** Genererer et trin mere end et par KB, skriv det til S3 eller din logstack og returnér URL'en.
- **Idempotens betyder noget.** Automatiserede trin (HTTP, JavaScript, Bash) kan køre mere end én gang, hvis workeren genstarter midt i et trin, eller hvis en agents lease udløber, mens et script stadig kører; design dem så et retry er sikkert.
