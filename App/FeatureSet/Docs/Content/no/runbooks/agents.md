# Runbook-agenter

En **Runbook-agent** er en liten selvhostet prosess som kjører Bash- *og* JavaScript-stegene i runbookene dine **inne i din egen infrastruktur**. OneUptime-Worker'en kjører aldri skriptene dine selv — den setter dem i kø, og en Runbook-agent du har installert i miljøet ditt henter dem, kjører dem og sender resultatet tilbake.

JavaScript kjører fortsatt i en `isolated-vm`-sandkasse; forskjellen er at den sandkassen lever på din agent-vert i stedet for hos oss.

Denne siden forklarer hvordan du installerer en agent, ruter Bash- og JavaScript-steg til den og drifter den til daglig.

## Hvorfor agenter finnes

Tidligere versjoner av OneUptime kjørte Bash- og JavaScript-steg på Worker'en. JavaScript var i sandkasse (`isolated-vm`), Bash var ikke. Begge ga problemer for alt utover et single-tenant selvhostet oppsett:

- **Tillitsgrense.** Den som kunne skrive et runbook, kunne kjøre kode på Worker'en, med tilgang til alle environment variables og hele filsystemet Worker'en hadde. JavaScript-sandkassen blokkerte det åpenbare, men kunne ikke hindre en bestemt bruker fra å undersøke hva som var tilgjengelig fra vårt nettverk.
- **Rekkevidde.** De fleste nyttige steg vil operere på *kundens* infrastruktur ("restart denne tjenesten", "kubectl på vårt cluster", "slå opp en post i vår interne DB") — ikke på OneUptimes.

Runbook-agenter snur dette på hodet. Bash- og JavaScript-steg kjører ikke hos oss. De kjører på en vert du kontrollerer, og du bestemmer hva den verten har lov til.

## Hvordan det fungerer

1. Du oppretter en Runbook-agent i OneUptime. OneUptime genererer en ID og en hemmelig nøkkel.
2. Du kjører agentcontaineren på en vert i infrastrukturen din med den ID-en/nøkkelen pluss OneUptime-URL-en din.
3. Agenten spør OneUptime hvert par sekund: "noe arbeid til meg?"
4. Når et Bash- eller JavaScript-steg kjører, setter Worker'en inn en jobrad merket med stegets **Agent Tag** og en stegtype (Bash eller JavaScript), og setter statusen til `Pending`.
5. Hvilken som helst sunn agent i samme prosjekt som bærer den taggen claimer jobben (atomisk — aldri to agenter på samme jobb), kjører den lokalt — `bash -c <skript>` for Bash, en `isolated-vm`-sandkasse for JavaScript — fanger resultatet og sender det tilbake.
6. Worker'en gjenopptar runbooket med resultatet.

Agenten trenger bare **utgående HTTPS** til OneUptime-instansen din. Den aksepterer ingen innkommende tilkoblinger.

## Installer en agent

### 1. Opprett agent-oppføringen

Gå til **Runbooks → Agents → Opprett ny**. Fyll ut:

| Felt | Notater |
| --- | --- |
| **Navn** | Et talende navn — typisk `hvor-den-kjører-og-hva-den-kan`, f.eks. `prod-eu-west-1`. |
| **Beskrivelse** | Valgfritt. En setning om hva denne verten kan nå. Ditt fremtidige jeg vil takke deg. |
| **Tags** | Komma-separerte. Bash- og JavaScript-steg sikter etter en tag; enhver agent i prosjektet med den taggen får kjøre dem. Vanlige mønstre: `prod`, `staging`, `eu-west-1`, `db-host`. |

### 2. Kopier installasjonskommandoen

Etter oppretting, klikk **Vis oppsettinstruksjoner** på agentens rad. Du ser en `docker run`-kommando forhåndsutfylt med ID-en og nøkkelen til denne agenten. **Lagre nøkkelen nå** — du kan resette den senere, men du kan ikke se den samme verdien igjen etter at modalen er lukket.

### 3. Kjør den på en vert i infrastrukturen din

Kjør Docker-kommandoen på en hvilken som helst vert i miljøet ditt som kan:

- nå OneUptime-instansen din over HTTPS, og
- gjøre det du vil Bash-stegene skal gjøre (f.eks. SSH til andre verter, `kubectl`, snakke med en database).

```bash
docker run --name oneuptime-runbook-agent --restart unless-stopped \
  -e RUNBOOK_AGENT_ID=<agent-id> \
  -e RUNBOOK_AGENT_KEY=<agent-key> \
  -e ONEUPTIME_URL=https://oneuptime.ditt-domene.no \
  -d oneuptime/runbook-agent:release
```

### 4. Verifiser at agenten er tilkoblet

Gå tilbake til **Runbooks → Agents**. Innen ca. 60 sekunder skal agentens rad bytte til `Connected` med et ferskt **Last seen**-tidsstempel. Hvis den blir værende `Disconnected`:

- Sjekk container-loggene (`docker logs oneuptime-runbook-agent`) for auth- eller nettverksfeil.
- Verifiser at verten når OneUptime-URL-en med `curl`.
- Verifiser at ID og nøkkel ble kopiert uten mellomrom.

## Tagger og ruting

Tagger er måten et Bash- eller JavaScript-steg finner en agent på. Noen mønstre:

- **Én tag per miljø.** Tagg prod-agenten `prod`, staging-agenten `staging`. Bash-steg som sikter på `prod` kjører bare på prod.
- **Én tag per region.** `eu-west-1`, `us-east-1`. Nyttig når et steg må kjøre nær ressursen det rører.
- **Flere agenter, samme tag.** Kjør to agenter begge tagget `prod`. Hvem som helst kan claime en jobb — gir høy tilgjengelighet og lar deg gjøre rullende omstarter uten å bryte runbooks.
- **Flere tagger per agent.** En agent i prod-EU-clusteret kan bære `prod`, `eu-west-1` og `kubernetes`. Bash-steg kan sikte på hvilken som helst av dem.

Bash- og JavaScript-steg **må** hver især spesifisere nøyaktig én agent-tag. Multi-tag-ruting (kjør på enhver agent som har `prod` AND `db`) står på roadmap'en, men er ikke i denne releasen.

## Pek et steg mot en agent

Legg til et Bash- eller JavaScript-steg i runbook'et ditt. Skjemaet spør om en **Agent Tag**:

- Skriv inn taggen som matcher agenten/agentene du vil ha det til å kjøre på.
- Skriv skriptet ditt i editoren under.

Når runbook'et kjører og når steget, køer Worker'en en jobb med den taggen og stegtypen. Hvis minst én sunn agent med den taggen er online, blir jobben claimet innen få sekunder og kjørt. Bash kjøres via `bash -c`; JavaScript kjører inne i en `isolated-vm`-sandkasse på agenten (intet filsystem, intet nettverk, ingen `Function`/`eval`).

## Driftsmerknader

### Timeouts

To timeouts gjelder for hvert Bash- eller JavaScript-steg:

| Timeout | Standard | Hva det styrer |
| --- | --- | --- |
| **Claim timeout** | 2 minutter | Hvor lenge Worker'en venter på at *en* agent claimer jobben. Hvis ingen tar den i tide, feiler steget med `TimedOut` og runbook'et fortsetter (eller stopper, avhengig av **Fortsett ved feil**). |
| **Execution timeout** | 30 sekunder | Hvor lenge agenten lar skriptet kjøre før den avslutter det. Konfigurerbar per steg. (Bash får `SIGKILL`; JavaScript-isolaten rives ned.) |

Worker'ens totale ventevindu er `claim timeout + execution timeout + et par sekunders margin`. Velg tall som passer steget.

### Lease og heartbeat

Når en agent claimer en jobb, får den en kort lease (30 sekunder som standard). Mens skriptet kjører, fornyer agenten lease'en hvert 10. sekund. Hvis agenten dør eller mister nettverk midt i skriptet, utløper lease'en og Worker'en markerer jobben som `TimedOut` i stedet for å vente i det uendelige.

Bash-barneprosesser avbrytes **ikke** automatisk når lease'en utløper (en JavaScript-isolate får også lov å kjøre ferdig hvis den noensinne gjør det) — men Worker'en slutter å vente, og agenten kan ikke sende inn et resultat når en annen claim har tatt over. Design skript til å være trygge å kjøre om igjen hvis exactly-once betyr noe for deg.

### Ingen agent online

Hvis ingen sunn agent med stegets tag er online på utførelsestidspunktet, blir jobben `Pending` til claim timeout går ut og feiler så med en klar melding ("no agent claimed the job"). Agents-siden er der du bekrefter dekning før du kjører et runbook for alvor.

### Output-tak

Kombinert stdout + stderr er begrenset til **50 KB** per steg. Større output kuttes med en markør. Trenger du hele loggen, skriv den til S3 eller log-systemet ditt fra selve skriptet og `echo` URL-en.

### Avbrytelse

Å avbryte en runbook-eksekvering (fra eksekveringsvisningen eller API-et) markerer øyeblikkelig alle dens `Pending`/`Claimed`/`Running` Bash-jobber som `Cancelled`. En agent som allerede er midt i skriptet, fullfører arbeidet, men resultatet blir ikke akseptert av serveren.

### Samtidighet

Hver agent kjører én jobb om gangen som standard. For å tillate flere, sett `RUNBOOK_AGENT_CONCURRENCY` på agent-containeren — men husk at agenten deler verten med alt annet som bor der.

## Environment variables

Agenten leser disse ved oppstart:

| Variabel | Påkrevd | Standard | Notater |
| --- | --- | --- | --- |
| `ONEUPTIME_URL` | ja | — | Base-URL for OneUptime-instansen din, f.eks. `https://oneuptime.ditt-domene.no`. |
| `RUNBOOK_AGENT_ID` | ja | — | UUID'en som vises i agentens oppsetts-modal. |
| `RUNBOOK_AGENT_KEY` | ja | — | Hemmeligheten som vises i agentens oppsetts-modal. |
| `RUNBOOK_AGENT_POLL_INTERVAL_MS` | nei | `5000` | Hvor ofte agenten spør etter nye jobber. |
| `RUNBOOK_AGENT_HEARTBEAT_INTERVAL_MS` | nei | `60000` | Hvor ofte agenten rapporterer at den lever. |
| `RUNBOOK_AGENT_JOB_HEARTBEAT_INTERVAL_MS` | nei | `10000` | Hvor ofte agenten fornyer lease'en til en kjørende jobb. |
| `RUNBOOK_AGENT_CONCURRENCY` | nei | `1` | Maks antall samtidige jobber på denne agenten. |

## Roter en agent-nøkkel

Hvis en nøkkel lekker, åpne agenten i OneUptime og resett nøkkelen. Den gamle slutter å virke umiddelbart. Oppdater agent-containeren med den nye nøkkelen og start den på nytt.

## Rettigheter

Håndtering av agenter ligger under den eksisterende Runbooks-rettighetsgruppen:

- `CreateRunbookAgent`, `EditRunbookAgent`, `DeleteRunbookAgent`, `ReadRunbookAgent` — administrer agent-oppføringer.
- `RunbookManager` (rolle) — bundler alle de ovennevnte.

Rettigheter til å *utløse* et runbook (og dermed sende Bash-steg) er fortsatt `CreateRunbookExecution` / `EditRunbookExecution`.

## Agent-API

For de nysgjerrige — agenten bruker disse endepunktene, montert under `/runbook-agent-ingest`. De autentiseres med agent-ID + nøkkel i JSON-body'en (eller `x-agent-id` / `x-agent-key`-headere).

| Endepunkt | Formål |
| --- | --- |
| `POST /heartbeat` | Liveness; oppdaterer `lastAlive`, `connectionStatus`, `hostInfo`, `agentVersion`. |
| `POST /claim-next-job` | Claimer atomisk den eldste `Pending`-jobben hvis tag matcher en av denne agentens tagger. Returnerer `{ job: null }` når det ikke er noe å gjøre. |
| `POST /job/:jobId/heartbeat` | Fornyer jobbens lease. Returnerer 404 så snart lease'en er utgått eller jobben er terminal. |
| `POST /job/:jobId/result` | Sender inn det endelige resultatet. Ignoreres hvis lease'en allerede har gått videre. |

Du skal ikke trenge å kalle disse for hånd — den medfølgende agenten gjør det. De er dokumentert her i tilfelle du vil bygge din egen agent fordi vår ikke passer dine begrensninger.
