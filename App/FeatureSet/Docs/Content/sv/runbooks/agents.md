# Runbook-agenter

En **Runbook-agent** är en liten självhostad process som kör Bash- *och* JavaScript-stegen i dina runbooks **inuti din egen infrastruktur**. OneUptime-Worker'n kör aldrig dina skript själv — den köar dem, och en Runbook-agent som du installerat i din miljö hämtar dem, kör dem och skickar tillbaka resultatet.

JavaScript körs fortfarande i en `isolated-vm`-sandlåda; skillnaden är att den sandlådan lever på din agent-värd istället för på vår.

Den här sidan förklarar hur du installerar en agent, dirigerar Bash- och JavaScript-steg till den och driver den i vardagen.

## Varför agenter finns

Tidigare OneUptime-versioner körde Bash- och JavaScript-steg på Worker'n. JavaScript var i sandlåda (`isolated-vm`), Bash var inte. Båda gav problem för allt utöver en single-tenant självhostad installation:

- **Förtroendegräns.** Den som kunde författa ett runbook kunde köra kod på Worker'n, med åtkomst till alla environment variables och hela filsystemet som Worker'n hade. JavaScript-sandlådan blockerade det uppenbara, men kunde inte hindra en målmedveten användare från att sondera vad som var nåbart från vårt nätverk.
- **Räckvidd.** De flesta användbara steg vill operera på *kundens* infrastruktur ("starta om den här tjänsten", "kubectl på vårt cluster", "slå upp en post i vår interna DB") — inte på OneUptimes.

Runbook-agenter vänder på det här. Bash- och JavaScript-steg körs inte hos oss. De körs på en värd du kontrollerar, och du bestämmer vad den värden får göra.

## Hur det fungerar

1. Du skapar en Runbook-agent i OneUptime. OneUptime genererar ett ID och en hemlig nyckel.
2. Du kör agentens container på en värd i din infrastruktur med det ID/nyckel plus din OneUptime-URL.
3. Agenten frågar OneUptime varje par sekunder: "något jobb åt mig?"
4. När ett Bash- eller JavaScript-steg körs lägger Worker'n in en jobbrad märkt med stegets **Agent Tag** och en stegtyp (Bash eller JavaScript), och sätter status till `Pending`.
5. Vilken som helst frisk agent i samma projekt som bär den taggen claim:ar jobbet (atomiskt — aldrig två agenter på samma jobb), kör det lokalt — `bash -c <skript>` för Bash, en `isolated-vm`-sandlåda för JavaScript — fångar resultatet och skickar tillbaka det.
6. Worker'n återupptar runbooket med resultatet.

Agenten behöver bara **utgående HTTPS** till din OneUptime-instans. Den accepterar inga inkommande anslutningar.

## Installera en agent

### 1. Skapa agentposten

Gå till **Runbooks → Agents → Skapa ny**. Fyll i:

| Fält | Anteckningar |
| --- | --- |
| **Namn** | Ett talande namn — vanligtvis `var-den-körs-och-vad-den-kan`, t.ex. `prod-eu-west-1`. |
| **Beskrivning** | Valfritt. En mening om vad denna värd kan nå. Ditt framtida jag tackar dig. |
| **Tags** | Komma-separerade. Bash- och JavaScript-steg siktar på en tag; varje agent i projektet med den taggen får köra dem. Vanliga mönster: `prod`, `staging`, `eu-west-1`, `db-host`. |

### 2. Kopiera installationskommandot

Efter att du skapat agenten, klicka **Visa installationsinstruktioner** på dess rad. Du ser ett `docker run`-kommando förifyllt med agentens ID och nyckel. **Spara nyckeln nu** — du kan återställa den senare, men du kan inte se samma värde igen efter att modalen stängts.

### 3. Kör den på en värd i din infrastruktur

Kör Docker-kommandot på vilken värd som helst i din miljö som kan:

- nå din OneUptime-instans över HTTPS, och
- göra det du vill att dina Bash-steg ska göra (t.ex. SSH till andra värdar, `kubectl`, prata med en databas).

```bash
docker run --name oneuptime-runbook-agent --restart unless-stopped \
  -e RUNBOOK_AGENT_ID=<agent-id> \
  -e RUNBOOK_AGENT_KEY=<agent-key> \
  -e ONEUPTIME_URL=https://oneuptime.din-domän.se \
  -d oneuptime/runbook-agent:release
```

### 4. Verifiera att agenten är ansluten

Gå tillbaka till **Runbooks → Agents**. Inom ca 60 sekunder bör agentens rad byta till `Connected` med en fräsch **Last seen**-tidsstämpel. Om den förblir `Disconnected`:

- Kolla container-loggarna (`docker logs oneuptime-runbook-agent`) efter auth- eller nätverksfel.
- Verifiera att värden når OneUptime-URL:en med `curl`.
- Verifiera att ID och nyckel kopierades utan mellanslag.

## Taggar och routing

Taggar är hur ett Bash- eller JavaScript-steg hittar en agent. Några mönster:

- **En tag per miljö.** Tagga prod-agenten `prod`, staging-agenten `staging`. Bash-steg som siktar på `prod` körs bara på prod.
- **En tag per region.** `eu-west-1`, `us-east-1`. Användbart när ett steg måste köras nära resursen det rör vid.
- **Flera agenter, samma tag.** Kör två agenter båda taggade `prod`. Vilken som helst kan claim:a ett jobb — ger hög tillgänglighet och låter dig göra rullande omstarter utan att bryta runbooks.
- **Flera taggar per agent.** En agent i ditt prod-EU-cluster kan bära `prod`, `eu-west-1` och `kubernetes`. Bash-steg kan sikta på vilken som helst av dem.

Bash- och JavaScript-steg **måste** vardera ange exakt en agent-tag. Multi-tag-routing (kör på vilken agent som helst med `prod` AND `db`) är på roadmap:en, men inte i den här releasen.

## Peka ett steg mot en agent

Lägg till ett Bash- eller JavaScript-steg i ditt runbook. Formuläret frågar efter en **Agent Tag**:

- Skriv in taggen som matchar agenten/agenterna du vill köra på.
- Skriv ditt skript i editorn nedanför.

När runbooket körs och når steget köar Worker'n ett jobb med den taggen och stegtypen. Om minst en frisk agent med den taggen är online claim:as jobbet inom några sekunder och körs. Bash körs via `bash -c`; JavaScript körs inuti en `isolated-vm`-sandlåda på agenten (inget filsystem, inget nätverk, ingen `Function`/`eval`).

## Driftsanteckningar

### Timeouts

Två timeouts gäller för varje Bash- eller JavaScript-steg:

| Timeout | Standard | Vad det styr |
| --- | --- | --- |
| **Claim timeout** | 2 minuter | Hur länge Worker'n väntar på att *någon* agent ska claim:a jobbet. Om ingen tar det i tid misslyckas steget med `TimedOut` och runbooket fortsätter (eller stannar, beroende på **Fortsätt vid fel**). |
| **Execution timeout** | 30 sekunder | Hur länge agenten låter skriptet köra innan den avslutar det. Konfigurerbar per steg. (Bash får `SIGKILL`; JavaScript-isolaten rivs ner.) |

Worker'ns totala väntefönster är `claim timeout + execution timeout + några sekunders marginal`. Välj tal som passar steget.

### Lease och heartbeat

När en agent claim:ar ett jobb får den en kort lease (30 sekunder som standard). Medan skriptet körs förnyar agenten leasen var 10:e sekund. Dör agenten eller tappar nätverk mitt i skriptet löper leasen ut och Worker'n markerar jobbet som `TimedOut` istället för att vänta i evighet.

Bash-barnprocesser avbryts **inte** automatiskt när leasen löper ut (en JavaScript-isolate får också köra färdigt om den någonsin gör det) — men Worker'n slutar vänta, och agenten kan inte längre skicka ett resultat när en annan claim har tagit över. Designa skript så att de är säkra att köra om ifall exactly-once spelar någon roll för dig.

### Ingen agent online

Om ingen frisk agent med stegets tag är online vid körningsögonblicket blir jobbet `Pending` tills claim timeout går ut och misslyckas sedan med ett tydligt meddelande ("no agent claimed the job"). Agents-sidan är där du bekräftar täckning innan du kör ett runbook på allvar.

### Outputtak

Kombinerad stdout + stderr är begränsad till **50 KB** per steg. Större output trunkeras med en markör. Behöver du hela loggen, skriv den till S3 eller ditt log-system från själva skriptet och `echo`:a URL:en.

### Avbrytning

Att avbryta en runbook-körning (från körningsvyn eller API:et) markerar omedelbart alla dess `Pending`/`Claimed`/`Running` Bash-jobb som `Cancelled`. En agent som redan är mitt i skriptet avslutar sitt arbete, men resultatet accepteras inte av servern.

### Samtidighet

Varje agent kör ett jobb i taget som standard. För att tillåta fler, sätt `RUNBOOK_AGENT_CONCURRENCY` på agent-containern — men kom ihåg att agenten delar värd med allt annat som lever där.

## Environment variables

Agenten läser dessa vid uppstart:

| Variabel | Obligatorisk | Standard | Anteckningar |
| --- | --- | --- | --- |
| `ONEUPTIME_URL` | ja | — | Bas-URL för din OneUptime-instans, t.ex. `https://oneuptime.din-domän.se`. |
| `RUNBOOK_AGENT_ID` | ja | — | UUID:n som visas i agentens setup-modal. |
| `RUNBOOK_AGENT_KEY` | ja | — | Hemligheten som visas i agentens setup-modal. |
| `RUNBOOK_AGENT_POLL_INTERVAL_MS` | nej | `5000` | Hur ofta agenten frågar efter nya jobb. |
| `RUNBOOK_AGENT_HEARTBEAT_INTERVAL_MS` | nej | `60000` | Hur ofta agenten rapporterar att den lever. |
| `RUNBOOK_AGENT_JOB_HEARTBEAT_INTERVAL_MS` | nej | `10000` | Hur ofta agenten förnyar leasen för ett körande jobb. |
| `RUNBOOK_AGENT_CONCURRENCY` | nej | `1` | Max antal samtidiga jobb på denna agent. |

## Rotera en agent-nyckel

Om en nyckel läcker, öppna agenten i OneUptime och återställ dess nyckel. Den gamla slutar fungera omedelbart. Uppdatera agent-containern med den nya nyckeln och starta om den.

## Behörigheter

Hantering av agenter ligger under den befintliga Runbooks-behörighetsgruppen:

- `CreateRunbookAgent`, `EditRunbookAgent`, `DeleteRunbookAgent`, `ReadRunbookAgent` — hantera agent-poster.
- `RunbookManager` (roll) — buntar ihop alla ovanstående.

Behörigheter för att *trigga* ett runbook (och därmed skicka Bash-steg) är fortfarande `CreateRunbookExecution` / `EditRunbookExecution`.

## Agent-API

För de nyfikna — agenten använder dessa endpoints, monterade under `/runbook-agent-ingest`. De autentiseras med agent-ID + nyckel i JSON-body:n (eller `x-agent-id` / `x-agent-key`-headers).

| Endpoint | Syfte |
| --- | --- |
| `POST /heartbeat` | Liveness; uppdaterar `lastAlive`, `connectionStatus`, `hostInfo`, `agentVersion`. |
| `POST /claim-next-job` | Claim:ar atomiskt det äldsta `Pending`-jobbet vars tag matchar en av denna agents taggar. Returnerar `{ job: null }` när det inte finns något att göra. |
| `POST /job/:jobId/heartbeat` | Förnyar jobbets lease. Returnerar 404 så snart leasen har löpt ut eller jobbet är terminalt. |
| `POST /job/:jobId/result` | Skickar in det slutliga resultatet. Ignoreras om leasen redan har gått vidare. |

Du ska inte behöva anropa dessa för hand — den medföljande agenten gör det. De är dokumenterade här ifall du vill bygga din egen agent eftersom vår inte passar dina begränsningar.
