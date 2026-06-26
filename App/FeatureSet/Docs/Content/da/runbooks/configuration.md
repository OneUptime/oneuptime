# Runbook-konfiguration & sikkerhed

## Hvordan Bash og JavaScript faktisk kører

Bash- og JavaScript-trin **kører aldrig på OneUptime Worker'en**. De afsendes som jobs til en specifik [Runbook-agent](/docs/runbooks/agents) — en lille proces, du installerer på en host i din egen infrastruktur.

Afsendelsesmodellen:

1. Runbook-trinforfatteren vælger en Runbook-agent fra dropdownen, når trinet skrives.
2. Når trinnet kører, indsætter Worker'en en række i `RunbookAgentJob` med `targetAgentId` sat til den agents ID og status `Pending`.
3. Den specifikke agent (og kun den agent) claimer atomart jobbet, kører scriptet lokalt — Bash via `bash -c <script>`, JavaScript inde i en `isolated-vm`-sandkasse — og sender resultatet retur.
4. Worker'en fortsætter runbook'et med resultatet.

Der er ikke længere et `RUNBOOK_BASH_ENABLED`-environment-flag. Om Bash- eller JavaScript-trin virker i en deployment afhænger udelukkende af, om der er mindst én forbundet Runbook-agent i projektet.

## Output-lofter og timeouts

- Output per trin: **50&nbsp;KB**. Større output afkortes med en markør.
- Standard execution timeout per trin: **30 sekunder** for JavaScript, Bash og HTTP. Konfigurerbar per trin.
- Per-trin **claim timeout** for Bash- og JavaScript-trin: **2 minutter** — hvor længe Worker'en venter på, at den valgte agent samler jobbet op, før det fejler.

## Rettigheder

Runbook-rettigheder ligger i rettighedsgruppen `Runbook`:

- `CreateRunbook`, `EditRunbook`, `DeleteRunbook`, `ReadRunbook` — håndter runbook-skabeloner.
- `CreateRunbookExecution`, `EditRunbookExecution`, `ReadRunbookExecution` — start, tik af og læs kørsler.
- `CreateRunbookRule`, `EditRunbookRule`, `DeleteRunbookRule`, `ReadRunbookRule` — håndter automatiske udløsningsregler.
- `CreateRunbookAgent`, `EditRunbookAgent`, `DeleteRunbookAgent`, `ReadRunbookAgent` — håndter Runbook-agenter, der eksekverer Bash- og JavaScript-trin i din egen infrastruktur.
- `RunbookAdmin`, `RunbookMember`, `RunbookViewer` (roller) — tildel et team for at give henholdsvis fuld kontrol, daglig brug eller læseadgang. `RunbookAdmin` samler alle de granulære rettigheder ovenfor.

## Kø & worker

Runbook-kørsler kører på BullMQ-køen `Runbook`. Workerens concurrency er 25 — juster i din deployment, hvis du har mange samtidige kørsler.

Når et manuelt trin tikkes af via API'en, lægges kørslen igen i kø for at fortsætte fra næste trin. Det holder workeren varm til resten af runbook'et.

## Hærdningsnoter

- **JavaScript og Bash** kører på en Runbook-agent-host, du kontrollerer, ikke på OneUptime Worker'en. JavaScript pakkes ind i en `isolated-vm`-sandkasse med den sædvanlige prelude (kapper prototype-kæder, fjerner `Function`/`eval`, fryser indbyggede prototyper). Bash kører via `bash -c` med timeout-håndhævelse på agenten.
- **HTTP-trin** bruger en tilladende status-validator, så et 4xx- eller 5xx-svar registreres som et fejlet trin frem for at blive kastet som exception. Det gør, at det fangede output afspejler, hvad upstream faktisk returnerede.
- **Agent-auth** sker via ID + hemmelig nøgle, sat på agent-containeren som env vars. Serversidet kommer agentens autoritative identitet fra DB-rækken, hvis nøgle er det fremviste ID/nøgle — klienter kan ikke udgive sig for at være en anden agent, selv med en kompromitteret nøgle.

## Databasetabeller

- `Runbook` — skabelon (navn, slug, beskrivelse, isEnabled, trin JSON).
- `RunbookExecution` — én række per kørsel, med nullable `incidentId`-, `alertId`- og `scheduledMaintenanceId`-fremmednøgler og en JSON-array `stepExecutions`, der snapshotter trin og per-trin-tilstand.
- `RunbookRule` — automatiske udløsningsregler med en `triggerEntityType`-discriminator (Incident, Alert, ScheduledMaintenance) og en mange-til-mange-relation til de runbooks, der skal startes.
- `RunbookAgent` — én række per installeret agent: navn, hemmelig nøgle, `lastAlive`, `connectionStatus`, host-info.
- `RunbookAgentJob` — én række per afsendt Bash- eller JavaScript-trin: `targetAgentId` (den agent, trin-forfatteren valgte), trintype, script, status (`Pending` → `Claimed` → `Running` → `Succeeded`/`Failed`/`TimedOut`/`Cancelled`), claim-deadline, lease, output, exit-kode.

## Drifttips

- **Sørg for, at den agent, du vælger på et trin, er sund.** Har du brug for redundans, kør en anden agent og fordel trin mellem dem, eller hav et backup-runbook, der peger på den anden agent.
- **Fang URL'er, ikke blobs.** Genererer et trin mere end et par KB output, så skriv det til S3 eller din logging-stack og returnér URL'en.
- **Idempotens betyder noget.** Automatiserede trin (HTTP, JavaScript, Bash) kan køre mere end én gang, hvis workeren genstarter midt i et trin, eller hvis en agents lease udløber, mens et script stadig kører; designe dem så de er sikre at gentage.
