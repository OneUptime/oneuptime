# Runbook-konfiguration & säkerhet

## Utdatatak

- Utdata per steg: **50 KB**. Större utdata trunkeras med en markör.
- Standardtimeout per steg: **30 sekunder** för JavaScript, Bash och HTTP. Kan sättas per steg.
- **Claim timeout** för Bash-steg (standard): **2 minuter** — så länge väntar Worker'n på att en Runbook-agent ska ta jobbet innan det misslyckas.

## Rättigheter

Runbook-rättigheter ligger i rättighetsgruppen `Runbook`:

- `CreateRunbook`, `EditRunbook`, `DeleteRunbook`, `ReadRunbook` — hantera runbook-mallar.
- `CreateRunbookExecution`, `EditRunbookExecution`, `ReadRunbookExecution` — starta, kryssa i och läsa körningar.
- `CreateRunbookRule`, `EditRunbookRule`, `DeleteRunbookRule`, `ReadRunbookRule` — hantera automatiska utlösningsregler.
- `CreateRunbookAgent`, `EditRunbookAgent`, `DeleteRunbookAgent`, `ReadRunbookAgent` — hantera Runbook-agenter som kör Bash-steg i din egen infrastruktur.
- `RunbookManager` (roll) — samlar allt ovan; tilldela ett team för full runbook-kapacitet.

## Kö & worker

Runbook-körningar går på BullMQ-kön `Runbook`. Worker-samtidigheten är 25 — justera i din deployment om du har många samtidiga körningar.

När ett manuellt steg kryssas i via API:t läggs körningen tillbaka i kön för att fortsätta till nästa steg. Det håller workern varm för resten av runbooken.

## Härdningsnotering

- **JavaScript-steg** körs i `isolated-vm` med en sandlådehärdnings-preamble (kapar prototypkedjor, tar bort `Function` och `eval`, fryser inbyggda prototyper).
- **Bash-steg** körs aldrig på OneUptime-Worker'n. De skickas som jobb till en [Runbook-agent](/docs/runbooks/agents) som du har installerat i din egen infrastruktur. Worker'n köar jobbet med stegets **Agent Tag**, en agent claim:ar det atomiskt, kör `bash -c <skript>` lokalt och skickar tillbaka resultatet. Själva Worker-processen har ingen shell-åtkomst till din miljö.
- **HTTP-steg** använder en tillåtande statusvalidator, så ett 4xx- eller 5xx-svar registreras som ett misslyckat steg i stället för att kastas. Den fångade utdatan speglar därför vad motparten faktiskt returnerade.

## Databastabeller

- `Runbook` — mall (namn, slug, beskrivning, isEnabled, JSON för steg).
- `RunbookExecution` — en rad per körning, med nullbara främmandenycklar `incidentId`, `alertId` och `scheduledMaintenanceId` och en JSON-array `stepExecutions` som tar snapshot av steg och status per steg.
- `RunbookRule` — automatiska utlösningsregler med diskriminator `triggerEntityType` (Incident, Alert, ScheduledMaintenance) och en many-to-many-relation till de runbooks som ska starta.
- `RunbookAgent` — en rad per installerad agent: namn, taggar, hemlig nyckel, `lastAlive`, `connectionStatus`, värdinfo.
- `RunbookAgentJob` — en rad per skickat Bash-steg: erfordrad tag, skript, status (Pending → Claimed → Running → Succeeded/Failed/TimedOut/Cancelled), claim-deadline, lease, utdata, exit-kod.

## Driftstips

- **Kör minst en agent per tag du siktar mot**, helst två för hög tillgänglighet. Med två agenter med samma tag kan endera claim:a ett jobb — du kan göra rullande omstarter utan att bryta runbooks.
- **Fånga URL:er, inte blobs.** Genererar ett steg mer än ett par KB, skriv till S3 eller din log-stack och returnera URL:en.
- **Idempotens spelar roll.** Automatiserade steg (HTTP, JavaScript, Bash) kan köras mer än en gång om workern startas om mitt i ett steg eller om en agents lease löper ut medan ett skript fortfarande körs; konstruera dem så att retry är säkert.
