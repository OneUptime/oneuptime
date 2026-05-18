# Runbook-agenter

En **Runbook-agent** er en lille selv-hostet proces, der eksekverer Bash- *og* JavaScript-trinene i dine runbooks **inde i din egen infrastruktur**. OneUptime Worker'en kører aldrig dine scripts — den lægger dem i kø, og den Runbook-agent, som trin-forfatteren har valgt, claimer dem, kører dem og sender resultatet tilbage.

JavaScript kører stadig i en `isolated-vm`-sandkasse; forskellen er, at den sandkasse lever på din agent-host i stedet for hos os.

Denne side forklarer, hvordan du installerer en agent, ruter Bash- og JavaScript-trin til den og driver den i hverdagen.

## Hvorfor agenter findes

Tidligere versioner af OneUptime kørte Bash- og JavaScript-trin på Worker'en. JavaScript var i sandkasse (`isolated-vm`), Bash var ikke. Begge var problematiske for alt ud over en single-tenant self-hosted opsætning:

- **Tillidsgrænse.** Enhver, der kunne forfatte et runbook, kunne eksekvere kode på Worker'en, med adgang til alle environment variables og hele det filsystem, som Worker'en havde. JavaScript-sandkassen blokerede de oplagte ting, men kunne ikke forhindre en målrettet bruger i at undersøge, hvad der var nåeligt fra vores netværk.
- **Rækkevidde.** De fleste nyttige trin vil operere på *kundens* infrastruktur ("genstart denne tjeneste", "kubectl på vores cluster", "slå et record op i vores interne DB") — ikke på OneUptimes.

Runbook-agenter vender det om. Bash- og JavaScript-trin kører ikke hos os. De kører på en host, du kontrollerer, og du bestemmer, hvad den host må.

## Sådan fungerer det

1. Du opretter en Runbook-agent i OneUptime. OneUptime genererer et ID og en hemmelig nøgle.
2. Du kører agentens container på en host i din infrastruktur med det ID/nøgle plus din OneUptime-URL.
3. Agenten spørger OneUptime hver par sekunder: "noget arbejde til mig?"
4. Når du forfatter et Bash- eller JavaScript-trin, vælger du agenten fra en dropdown — trinnet er bundet til den specifikke agent.
5. Når trinnet kører, indsætter Worker'en en jobrække med `targetAgentId` sat til den agent. Kun den agent kan claime det.
6. Agenten kører scriptet lokalt — `bash -c <script>` for Bash, en `isolated-vm`-sandkasse for JavaScript — fanger resultatet og sender det retur. Worker'en fortsætter runbook'et med resultatet.

Agenten har kun brug for **udgående HTTPS** til din OneUptime-instans. Den accepterer ingen indgående forbindelser.

## Installer en agent

### 1. Opret agentens record

Gå til **Runbooks → Indstillinger → Agents** og opret en ny agent. Udfyld:

| Felt | Noter |
| --- | --- |
| **Navn** | Et sigende navn — typisk `hvor-den-kører-og-hvad-den-kan`, fx `prod-eu-west-1`. Det er det, der vises i dropdownen, når du forfatter et trin. |
| **Beskrivelse** | Valgfri. En sætning om hvad denne host kan nå. Dit fremtidige jeg vil takke dig. |

### 2. Kopier installationskommandoen

Klik efter oprettelse på **Vis opsætningsinstruktioner** på agentens række. Du ser en `docker run`-kommando præudfyldt med agentens ID og nøgle. **Gem nøglen nu** — du kan nulstille den senere, men du kan ikke se den samme værdi igen efter du lukker modalen.

### 3. Kør den på en host i din infrastruktur

Kør Docker-kommandoen på en hvilken som helst host i dit miljø, der kan:

- nå din OneUptime-instans over HTTPS, og
- gøre de ting, du vil have dine Bash/JavaScript-trin til at gøre (fx SSH til andre hosts, `kubectl`, snakke med en database).

```bash
docker run --name oneuptime-runbook-agent --restart unless-stopped \
  -e RUNBOOK_AGENT_ID=<agent-id> \
  -e RUNBOOK_AGENT_KEY=<agent-key> \
  -e ONEUPTIME_URL=https://oneuptime.dit-domæne.com \
  -d oneuptime/runbook-agent:release
```

### 4. Verificér at agenten er forbundet

Gå tilbage til **Runbooks → Indstillinger → Agents**. Inden for ca. 60 sekunder skal agentens række skifte til `Connected` med et frisk **Last seen**-tidsstempel. Hvis den bliver `Disconnected`:

- Tjek container-logs (`docker logs oneuptime-runbook-agent`) for auth- eller netværksfejl.
- Verificér at hosten kan nå OneUptime-URL'en med `curl`.
- Verificér at ID og nøgle blev kopieret uden whitespace.

## Peg et trin mod en agent

Tilføj et Bash- eller JavaScript-trin i dit runbook. Formularen har en **Runbook-agent**-dropdown, der lister hver agent i det aktuelle projekt (med en connected/disconnected-indikator):

- Vælg den agent, der skal køre dette trin.
- Skriv dit script i editoren nedenfor.

Når runbook'et kører og når trinnet, sætter Worker'en et job i kø rettet mod den agents ID. Kun den agent kan claime det. Bash udføres via `bash -c`; JavaScript kører inde i en `isolated-vm`-sandkasse på agenten (intet filsystem, intet netværk, ingen `Function`/`eval`).

Brug for mere end én agent? Opret dem, og peg så individuelle trin mod den, der passer. Vil du have redundans, kan du forfatte to runbooks (én per agent) eller fordele trin mellem agenter.

## Driftsnoter

### Timeouts

To timeouts gælder for hvert Bash- eller JavaScript-trin:

| Timeout | Standard | Hvad den styrer |
| --- | --- | --- |
| **Claim timeout** | 2 minutter | Hvor længe Worker'en venter på, at den valgte agent claimer jobbet. Hvis agenten ikke tager det i tide, fejler trinnet med `TimedOut`, og runbook'et fortsætter (eller stopper, afhængigt af **Fortsæt ved fejl**). |
| **Execution timeout** | 30 sekunder | Hvor længe agenten lader scriptet køre, før den afslutter det. Konfigurerbar per trin. (Bash får `SIGKILL`; JavaScript-isolaten rives ned.) |

Worker'ens samlede ventevindue er `claim timeout + execution timeout + et par sekunders margen`. Vælg tal, der passer til trinnet.

### Lease og heartbeat

Når en agent claimer et job, får den en kort lease (30 sekunder som standard). Mens scriptet kører, fornyer agenten lease'en hvert 10. sekund. Dør agenten eller mister netværk midt i scriptet, udløber lease'en, og Worker'en markerer jobbet som `TimedOut` i stedet for at vente i det uendelige.

Bash-child-processer aflyses **ikke** automatisk når lease'en udløber (en JavaScript-isolate får også lov at køre færdig, hvis den nogensinde gør det) — men Worker'en holder op med at vente, og agenten kan ikke længere sende et resultat, når et andet claim har taget over. Designe scripts så de er sikre at køre igen, hvis exactly-once betyder noget for dig.

### Ingen agent online

Hvis den valgte agent er offline på det øjeblik, hvor trinnet kører, bliver jobbet `Pending`, indtil claim timeout udløber, og fejler så med en klar besked ("no agent claimed the job"). Agents-siden er hvor du bekræfter dækning, før du kører et runbook for alvor.

### Output-loft

Kombineret stdout + stderr er begrænset til **50 KB** per trin. Større output afkortes med en markør. Har du brug for hele loggen, så skriv den til S3 eller dit log-system fra selve scriptet og `echo` URL'en.

### Annullering

Annullering af en runbook-eksekvering (fra eksekveringsvisningen eller API'en) markerer øjeblikkeligt alle dens `Pending`/`Claimed`/`Running` Bash- og JavaScript-jobs som `Cancelled`. En agent der allerede er midt i scriptet, færdiggør sit arbejde, men dens resultat accepteres ikke af serveren.

### Samtidighed

Hver agent kører ét job ad gangen som standard. For at tillade flere, sæt `RUNBOOK_AGENT_CONCURRENCY` på agent-containeren — men husk, at agenten deler host med alt andet der lever der.

## Environment variables

Agenten læser disse ved opstart:

| Variabel | Påkrævet | Standard | Noter |
| --- | --- | --- | --- |
| `ONEUPTIME_URL` | ja | — | Base-URL for din OneUptime-instans, fx `https://oneuptime.dit-domæne.com`. |
| `RUNBOOK_AGENT_ID` | ja | — | UUID'en vist i agentens setup-modal. |
| `RUNBOOK_AGENT_KEY` | ja | — | Hemmeligheden vist i agentens setup-modal. |
| `RUNBOOK_AGENT_POLL_INTERVAL_MS` | nej | `5000` | Hvor ofte agenten spørger efter nye jobs. |
| `RUNBOOK_AGENT_HEARTBEAT_INTERVAL_MS` | nej | `60000` | Hvor ofte agenten rapporterer at den lever. |
| `RUNBOOK_AGENT_JOB_HEARTBEAT_INTERVAL_MS` | nej | `10000` | Hvor ofte agenten fornyer lease'en på et kørende job. |
| `RUNBOOK_AGENT_CONCURRENCY` | nej | `1` | Maks. antal samtidige jobs på denne agent. |

## Roter en agent-nøgle

Hvis en nøgle lækker, åbn agenten i OneUptime og nulstil nøglen. Den gamle stopper med at virke med det samme. Opdater agent-containeren med den nye nøgle og genstart den.

## Rettigheder

Håndtering af agenter ligger under den eksisterende Runbooks-rettighedsgruppe:

- `CreateRunbookAgent`, `EditRunbookAgent`, `DeleteRunbookAgent`, `ReadRunbookAgent` — håndter agent-records.
- `RunbookAdmin`, `RunbookMember`, `RunbookViewer` (roller) — tildel et team for at give henholdsvis fuld kontrol, daglig brug eller læseadgang. `RunbookAdmin` samler alle de granulære rettigheder ovenfor.

Rettigheder til at *udløse* et runbook (og dermed afsende Bash- og JavaScript-trin) er stadig `CreateRunbookExecution` / `EditRunbookExecution`.

## Agent-API

For de nysgerrige — agenten bruger disse endpoints, monteret under `/runbook-agent-ingest`. De godkendes af agent-ID + nøgle i JSON-body'en (eller `x-agent-id` / `x-agent-key`-headere).

| Endpoint | Formål |
| --- | --- |
| `POST /heartbeat` | Liveness; opdaterer `lastAlive`, `connectionStatus`, `hostInfo`, `agentVersion`. |
| `POST /claim-next-job` | Claimer atomart det ældste `Pending`-job rettet mod denne agents ID. Returnerer `{ job: null }` når der intet er at lave. |
| `POST /job/:jobId/heartbeat` | Fornyer jobbets lease. Returnerer 404 så snart lease'en er udløbet eller jobbet er terminalt. |
| `POST /job/:jobId/result` | Indsender det endelige resultat. Ignoreres, hvis lease'en allerede er gået videre. |

Du burde ikke behøve at kalde dem manuelt — den medfølgende agent gør det. De er dokumenteret her, så du kan bygge din egen agent, hvis vores ikke passer dine begrænsninger.
