# Runbook-agenter

En **Runbook-agent** är en liten självhostad process som kör Bash- *och* JavaScript-stegen i dina runbooks **inuti din egen infrastruktur**. OneUptime-Worker'n kör aldrig dina skript själv — den köar dem, och den Runbook-agent som stegförfattaren valde hämtar dem, kör dem och skickar tillbaka resultatet.

JavaScript körs fortfarande i en `isolated-vm`-sandlåda; skillnaden är att den sandlådan lever på din agent-värd istället för på vår.

Den här sidan förklarar hur du installerar en agent, riktar Bash- och JavaScript-steg mot den och driver den i vardagen.

## Varför agenter finns

Tidigare OneUptime-versioner körde Bash- och JavaScript-steg på Worker'n. JavaScript var i sandlåda (`isolated-vm`), Bash var inte. Båda gav problem för allt utöver en single-tenant självhostad installation:

- **Förtroendegräns.** Den som kunde författa ett runbook kunde köra kod på Worker'n, med åtkomst till alla environment variables och hela filsystemet som Worker'n hade. JavaScript-sandlådan blockerade det uppenbara, men kunde inte hindra en målmedveten användare från att sondera vad som var nåbart från vårt nätverk.
- **Räckvidd.** De flesta användbara steg vill operera på *kundens* infrastruktur ("starta om den här tjänsten", "kubectl på vårt cluster", "slå upp en post i vår interna DB") — inte på OneUptimes.

Runbook-agenter vänder på det här. Bash- och JavaScript-steg körs inte hos oss. De körs på en värd du kontrollerar, och du bestämmer vad den värden får göra.

## Hur det fungerar

1. Du skapar en Runbook-agent i OneUptime. OneUptime genererar ett ID och en hemlig nyckel.
2. Du kör agentens container på en värd i din infrastruktur med det ID/nyckel plus din OneUptime-URL.
3. Agenten frågar OneUptime varje par sekunder: "något jobb åt mig?"
4. När du författar ett Bash- eller JavaScript-steg väljer du agenten från en dropdown — steget är bundet till just den agenten.
5. När steget körs lägger Worker'n in en jobbrad med `targetAgentId` satt till den agenten. Bara den agenten kan claim:a det.
6. Agenten kör skriptet lokalt — `bash -c <skript>` för Bash, en `isolated-vm`-sandlåda för JavaScript — fångar resultatet och skickar tillbaka det. Worker'n återupptar runbooket med resultatet.

Agenten behöver bara **utgående HTTPS** till din OneUptime-instans. Den accepterar inga inkommande anslutningar.

## Installera en agent

### 1. Skapa agentposten

Gå till **Runbooks → Settings → Agents** och skapa en ny agent. Fyll i:

| Fält | Anteckningar |
| --- | --- |
| **Namn** | Ett talande namn — vanligtvis `var-den-körs-och-vad-den-kan`, t.ex. `prod-eu-west-1`. Det här är vad som visas i dropdownen när du författar ett steg. |
| **Beskrivning** | Valfritt. En mening om vad denna värd kan nå. Ditt framtida jag tackar dig. |

### 2. Kopiera installationskommandot

Klicka efter att du skapat agenten på **Visa installationsinstruktioner** på dess rad. Du ser ett `docker run`-kommando med den här agentens ID och nyckel redan ifyllda. **Spara nyckeln nu** — du kan återställa den senare, men du kan inte se samma nyckelvärde igen efter att modalen stängts.

### 3. Kör den på en värd i din infrastruktur

Kör Docker-kommandot på vilken värd som helst i din miljö som kan:

- nå din OneUptime-instans över HTTPS, och
- göra det du vill att dina Bash-/JavaScript-steg ska göra (t.ex. SSH till andra värdar, `kubectl`, prata med en databas).

```bash
docker run --name oneuptime-runbook-agent --restart unless-stopped \
  -e RUNBOOK_AGENT_ID=<agent-id> \
  -e RUNBOOK_AGENT_KEY=<agent-key> \
  -e ONEUPTIME_URL=https://oneuptime.yourdomain.com \
  -d oneuptime/runbook-agent:release
```

### 4. Verifiera att agenten är ansluten

Gå tillbaka till **Runbooks → Settings → Agents**. Inom ~60 sekunder bör agentens rad växla till `Connected` med en färsk **Last seen**-tidsstämpel. Om den förblir `Disconnected`:

- Kontrollera container-loggarna (`docker logs oneuptime-runbook-agent`) för auth-fel eller nätverksproblem.
- Verifiera att värden når din OneUptime-URL med `curl`.
- Verifiera att ID och nyckel kopierats utan blanksteg.

## Rikta ett steg mot en agent

I ditt runbook, lägg till ett Bash- eller JavaScript-steg. Formuläret har en **Runbook-agent**-dropdown som listar varje agent i det aktuella projektet (med en connected/disconnected-indikator):

- Välj agenten som ska köra detta steg.
- Skriv ditt skript i editorn nedanför.

När runbooket körs och når steget köar Worker'n ett jobb riktat mot den agentens ID. Bara den agenten kan claim:a det. Bash körs via `bash -c`; JavaScript körs i en `isolated-vm`-sandlåda på agenten (inget filsystem, inget nätverk, inget `Function`/`eval`).

Behöver du mer än en agent? Skapa dem, och rikta sedan enskilda steg mot den som passar. Vill du ha redundans kan du författa två runbooks (ett per agent) eller dela upp steg över agenter.

## Driftsanteckningar

### Timeouts

Två timeouts gäller varje Bash- eller JavaScript-steg:

| Timeout | Standard | Vad det styr |
| --- | --- | --- |
| **Claim-timeout** | 2 minuter | Hur länge Worker'n väntar på att den valda agenten claim:ar jobbet. Om agenten inte plockar upp det i tid misslyckas steget med `TimedOut` och runbooket går vidare (eller stannar, beroende på **Fortsätt vid fel**). |
| **Körnings-timeout** | 30 sekunder | Hur länge agenten låter skriptet köra innan den avslutar det. Konfigurerbart per steg. (Bash får `SIGKILL`; JavaScript-isolatet rivs ner.) |

Worker'ns totala väntefönster är `claim-timeout + körnings-timeout + några sekunder`. Välj tal som matchar steget.

### Lease och heartbeat

När en agent claim:ar ett jobb får den en kort lease (30 sekunder som standard). Medan skriptet körs förnyar agenten leasen var tionde sekund. Om agenten dör eller tappar nätverket mitt i skriptet löper leasen ut och Worker'n markerar jobbet som `TimedOut` istället för att vänta för evigt.

Bash-barnprocesser avbryts **inte** automatiskt när leasen löper ut (ett JavaScript-isolat lämnas också att avsluta om det någonsin gör det) — men Worker'n slutar vänta på dem, och agenten kan inte längre skicka in ett resultat när en annan claim har tagit över. Designa skript så att de är säkra att köra om ifall exakt-en-gång är viktigt för dig.

### Ingen agent online

Om den valda agenten är offline i ögonblicket då steget körs ligger jobbet `Pending` tills claim-timeouten löpt ut, och misslyckas sedan med ett tydligt "ingen agent claim:ade jobbet"-meddelande. Agents-sidan är där du bekräftar täckning innan du kör ett runbook på riktigt.

### Utdatatak

Sammanlagd stdout + stderr är begränsad till **50&nbsp;KB** per steg. Större utdata trunkeras med en markör. Behöver du en fullständig logg, skriv den till S3 eller din loggbutik inne i skriptet och `echo`a URL:en.

### Avbrytande

Att avbryta en runbook-körning (från körningsvyn eller API:t) markerar omedelbart alla dess `Pending`/`Claimed`/`Running` Bash- och JavaScript-jobb som `Cancelled`. En agent som redan är mitt i skriptet avslutar sitt arbete, men dess resultat accepteras inte av servern.

### Samtidighet

Varje agent kör ett jobb i taget som standard. För att tillåta fler, sätt `RUNBOOK_AGENT_CONCURRENCY` på agent-containern — men kom ihåg att agenten delar värden med vad som än bor där.

## Environment variables

Agenten läser dessa vid uppstart:

| Variabel | Krävs | Standard | Anteckningar |
| --- | --- | --- | --- |
| `ONEUPTIME_URL` | ja | — | Bas-URL för din OneUptime-instans, t.ex. `https://oneuptime.yourdomain.com`. |
| `RUNBOOK_AGENT_ID` | ja | — | UUID:t som visas i agentens installationsmodal. |
| `RUNBOOK_AGENT_KEY` | ja | — | Hemligheten som visas i agentens installationsmodal. |
| `RUNBOOK_AGENT_POLL_INTERVAL_MS` | nej | `5000` | Hur ofta agenten frågar efter nya jobb. |
| `RUNBOOK_AGENT_HEARTBEAT_INTERVAL_MS` | nej | `60000` | Hur ofta agenten rapporterar livstecken. |
| `RUNBOOK_AGENT_JOB_HEARTBEAT_INTERVAL_MS` | nej | `10000` | Hur ofta agenten förnyar leasen på ett pågående jobb. |
| `RUNBOOK_AGENT_CONCURRENCY` | nej | `1` | Maximalt antal samtidiga jobb på denna agent. |

## Rotera en agent-nyckel

Om en nyckel läcker, öppna agenten i OneUptime och återställ dess nyckel. Den gamla nyckeln slutar fungera omedelbart. Uppdatera agent-containern med den nya nyckeln och starta om den.

## Behörigheter

Hanteringen av agenter ligger under den befintliga Runbooks-behörighetsgruppen:

- `CreateRunbookAgent`, `EditRunbookAgent`, `DeleteRunbookAgent`, `ReadRunbookAgent` — hantera agent-poster.
- `RunbookAdmin`, `RunbookMember`, `RunbookViewer` (roller) — tilldela ett team för att ge full kontroll, daglig användning eller skrivskyddad åtkomst. `RunbookAdmin` paketerar alla granulära behörigheter ovan.

Behörigheter att *trigga* ett runbook (och därmed få Bash- och JavaScript-steg att dispatch:as) är fortfarande `CreateRunbookExecution` / `EditRunbookExecution`.

## Agent-API

För de nyfikna — agenten använder dessa endpoints, monterade under `/runbook-agent-ingest`. De autentiseras med agentens ID + nyckel i JSON-bodyn (eller `x-agent-id` / `x-agent-key`-headers).

| Endpoint | Syfte |
| --- | --- |
| `POST /heartbeat` | Livstecken; uppdaterar `lastAlive`, `connectionStatus`, `hostInfo`, `agentVersion`. |
| `POST /claim-next-job` | Claim:a atomiskt det äldsta `Pending`-jobbet riktat mot denna agents ID. Returnerar `{ job: null }` när det inte finns något att göra. |
| `POST /job/:jobId/heartbeat` | Förnya jobbets lease. Returnerar 404 när leasen löpt ut eller jobbet är terminalt. |
| `POST /job/:jobId/result` | Skicka in det slutgiltiga utfallet. Ignoreras om leasen redan gått vidare. |

Du ska inte behöva anropa dessa för hand — den medföljande agenten gör det. De är dokumenterade här så att du kan bygga din egen agent om du har en begränsning som vår inte passar in i.
