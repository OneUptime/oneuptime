# Runbook-konfiguration & säkerhet

## Hur Bash och JavaScript faktiskt körs

Bash- och JavaScript-steg **körs aldrig på OneUptime-Worker'n**. De dispatch:as som jobb till en specifik [Runbook-agent](/docs/runbooks/agents) — en liten process som du installerar på en värd i din egen infrastruktur.

Dispatch-modellen:

1. Författaren av runbook-steget väljer en Runbook-agent från dropdownen när hen skriver steget.
2. När steget körs lägger Worker'n in en rad i `RunbookAgentJob` med `targetAgentId` satt till den agentens ID och status `Pending`.
3. Den specifika agenten (och bara den agenten) claim:ar jobbet atomiskt, kör skriptet lokalt — Bash via `bash -c <skript>`, JavaScript i en `isolated-vm`-sandlåda — och skickar tillbaka resultatet.
4. Worker'n återupptar runbooket med resultatet.

Det finns ingen `RUNBOOK_BASH_ENABLED`-environmentflagga längre. Huruvida Bash- eller JavaScript-steg fungerar i en deployment beror enbart på om det finns minst en ansluten Runbook-agent i projektet.

## Utdatatak och timeouts

- Utdata per steg: **50&nbsp;KB**. Större utdata trunkeras med en markör.
- Standard körnings-timeout per steg: **30 sekunder** för JavaScript, Bash och HTTP. Konfigurerbart per steg.
- **Claim-timeout** per steg för Bash- och JavaScript-steg: **2 minuter** — hur länge Worker'n väntar på att den valda agenten plockar upp jobbet innan den misslyckas.

## Behörigheter

Runbook-behörigheter lever i `Runbook`-behörighetsgruppen:

- `CreateRunbook`, `EditRunbook`, `DeleteRunbook`, `ReadRunbook` — hantera runbook-mallar.
- `CreateRunbookExecution`, `EditRunbookExecution`, `ReadRunbookExecution` — starta, bocka av och läsa körningar.
- `CreateRunbookRule`, `EditRunbookRule`, `DeleteRunbookRule`, `ReadRunbookRule` — hantera auto-triggerregler.
- `CreateRunbookAgent`, `EditRunbookAgent`, `DeleteRunbookAgent`, `ReadRunbookAgent` — hantera Runbook-agenter som kör Bash- och JavaScript-steg i din egen infrastruktur.
- `RunbookAdmin`, `RunbookMember`, `RunbookViewer` (roller) — tilldela ett team för att ge full kontroll, daglig användning eller skrivskyddad åtkomst. `RunbookAdmin` paketerar alla granulära behörigheter ovan.

## Kö & worker

Runbook-körningar körs på `Runbook`-BullMQ-kön. Worker-samtidigheten är 25 — justera i din deployment om du har många samtidiga körningar.

När ett manuellt steg bockas av via API:t läggs körningen i kön igen för att fortsätta från nästa steg. Det håller workern varm för resten av runbooket.

## Härdningsnoteringar

- **JavaScript och Bash** körs på en Runbook-agent-värd som du kontrollerar, inte på OneUptime-Worker'n. JavaScript är inlindat i en `isolated-vm`-sandlåda med den vanliga preluden (kapar prototypkedjor, tar bort `Function`/`eval`, fryser inbyggda prototyper). Bash körs via `bash -c` med timeout-tillämpning på agenten.
- **HTTP-steg** använder en tillåtande statusvalidator, så ett 4xx- eller 5xx-svar registreras som ett misslyckat steg snarare än kastas. Detta gör att den fångade utdatan speglar vad uppströms faktiskt returnerade.
- **Agent-auth** sker via ID + hemlig nyckel, satta på agent-containern som environment variables. Server-sidan kommer den auktoritativa agent-identiteten från DB-raden som slås upp via det presenterade ID/nyckel — klienter kan inte impersonera en annan agent ens med en komprometterad nyckel.

## Databastabeller

- `Runbook` — mall (name, slug, description, isEnabled, steps JSON).
- `RunbookExecution` — en rad per körning, med nullable `incidentId`-, `alertId`- och `scheduledMaintenanceId`-foreign keys och en JSON `stepExecutions`-array som snapshot:ar stegen och per-steg-tillstånd.
- `RunbookRule` — auto-triggerregler med en `triggerEntityType`-diskriminator (Incident, Alert, ScheduledMaintenance) och en many-to-many-relation till runbooks som ska startas.
- `RunbookAgent` — en rad per installerad agent: namn, hemlig nyckel, `lastAlive`, `connectionStatus`, host-info.
- `RunbookAgentJob` — en rad per dispatch:at Bash- eller JavaScript-steg: `targetAgentId` (agenten som stegförfattaren valde), stegtyp, skript, status (`Pending` → `Claimed` → `Running` → `Succeeded`/`Failed`/`TimedOut`/`Cancelled`), claim-deadline, lease, utdata, exit-kod.

## Driftstips

- **Se till att agenten du väljer på ett steg är frisk.** Behöver du redundans, kör en andra agent och dela dina steg mellan dem, eller behåll ett reserv-runbook som riktar mot den andra agenten.
- **Fånga URL:er, inte blobbar.** Om ett steg genererar mer än några KB utdata, skriv den till S3 eller din loggstack och returnera URL:en.
- **Idempotens räknas.** Automatiserade steg (HTTP, JavaScript, Bash) kan köras mer än en gång om workern startar om mitt i ett steg eller om en agents lease löper ut medan ett skript fortfarande körs; designa dem så att de är säkra att köra igen.
