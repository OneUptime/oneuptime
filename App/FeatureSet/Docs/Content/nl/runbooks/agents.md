# Runbook-agents

Een **Runbook-agent** is een klein, zelf-gehost proces dat de Bash- *en* JavaScript-stappen van je runbooks **binnen je eigen infrastructuur** uitvoert. De OneUptime Worker voert je scripts nooit zelf uit — hij zet ze in de wachtrij, en de Runbook-agent die de stapauteur heeft uitgekozen, haalt ze op, voert ze uit en stuurt het resultaat terug.

JavaScript draait nog steeds in een `isolated-vm`-sandbox; het verschil is dat die sandbox op jouw agent-host leeft in plaats van op de onze.

Deze pagina legt uit hoe je een agent installeert, Bash- en JavaScript-stappen ernaartoe richt, en hem dagelijks bedient.

## Waarom agents bestaan

Eerdere OneUptime-versies draaiden Bash- en JavaScript-stappen op de Worker. JavaScript zat in een sandbox (`isolated-vm`), Bash niet. Beide gaven problemen voor alles buiten een single-tenant self-hosted setup:

- **Vertrouwensgrens.** Wie een runbook kon opstellen, kon code uitvoeren op de Worker, met toegang tot alle environment variables en het filesystem dat de Worker had. De JavaScript-sandbox blokkeerde voor de hand liggende dingen, maar kon een vastberaden gebruiker niet beletten om te onderzoeken wat vanuit ons netwerk bereikbaar was.
- **Bereik.** De meeste nuttige stappen willen op de infrastructuur van de *klant* opereren ("herstart deze service", "kubectl op ons cluster", "een record opzoeken in onze interne DB") — niet op die van OneUptime.

Runbook-agents draaien dat om. Bash- en JavaScript-stappen draaien niet bij ons. Ze draaien op een host die jij beheert, en jij bepaalt wat die host mag.

## Hoe het werkt

1. Je maakt een Runbook-agent aan in OneUptime. OneUptime genereert een ID en een geheime sleutel.
2. Je start de agent-container op een host binnen je infrastructuur met die ID/sleutel plus je OneUptime-URL.
3. De agent vraagt OneUptime elke paar seconden: "werk voor mij?"
4. Wanneer je een Bash- of JavaScript-stap schrijft, kies je de agent uit een dropdown — de stap is aan precies die agent gebonden.
5. Zodra de stap draait, voegt de Worker een job-rij toe met `targetAgentId` gezet op die agent. Alleen die agent kan hem claimen.
6. De agent voert het script lokaal uit — `bash -c <script>` voor Bash, een `isolated-vm`-sandbox voor JavaScript — vangt het resultaat op en stuurt het terug. De Worker hervat het runbook met het resultaat.

De agent heeft alleen **uitgaande HTTPS** naar je OneUptime-instantie nodig. Hij accepteert geen inkomende verbindingen.

## Een agent installeren

### 1. Het agent-record aanmaken

Ga naar **Runbooks → Settings → Agents** en maak een nieuwe agent aan. Vul in:

| Veld | Opmerkingen |
| --- | --- |
| **Naam** | Een sprekende naam — meestal `waar-hij-draait-en-wat-hij-kan`, bv. `prod-eu-west-1`. Dit is wat in het dropdown verschijnt wanneer je een stap schrijft. |
| **Beschrijving** | Optioneel. Een zin over wat deze host kan bereiken. Je toekomstige zelf zal je dankbaar zijn. |

### 2. Het installatiecommando kopiëren

Klik na het aanmaken van de agent op **Installatie-instructies tonen** in zijn rij. Je ziet een `docker run`-commando met de ID en sleutel van deze agent al vooringevuld. **Bewaar de sleutel nu** — je kunt hem later resetten, maar dezelfde sleutelwaarde kun je na het sluiten van de modal niet opnieuw bekijken.

### 3. Hem draaien op een host binnen je infrastructuur

Voer het Docker-commando uit op elke host in je omgeving die:

- je OneUptime-instantie via HTTPS kan bereiken, en
- de dingen kan doen die je Bash-/JavaScript-stappen moeten doen (bv. SSH naar andere hosts, `kubectl`, met een database praten).

```bash
docker run --name oneuptime-runbook-agent --restart unless-stopped \
  -e RUNBOOK_AGENT_ID=<agent-id> \
  -e RUNBOOK_AGENT_KEY=<agent-key> \
  -e ONEUPTIME_URL=https://oneuptime.yourdomain.com \
  -d oneuptime/runbook-agent:release
```

### 4. Verifiëren dat de agent verbonden is

Ga terug naar **Runbooks → Settings → Agents**. Binnen ~60 seconden moet de rij van de agent omschakelen naar `Connected` met een verse **Last seen**-tijdstempel. Als hij op `Disconnected` blijft:

- Controleer de container-logs (`docker logs oneuptime-runbook-agent`) op auth-fouten of netwerkproblemen.
- Verifieer dat de host je OneUptime-URL met `curl` kan bereiken.
- Verifieer dat de ID en sleutel zonder whitespace gekopieerd zijn.

## Een stap op een agent richten

Voeg in je runbook een Bash- of JavaScript-stap toe. Het formulier heeft een **Runbook-agent**-dropdown die elke agent in het huidige project oplijst (met een connected/disconnected-indicator):

- Kies de agent die deze stap moet uitvoeren.
- Schrijf je script in de editor eronder.

Wanneer het runbook draait en de stap bereikt, zet de Worker een job in de wachtrij gericht op de ID van die agent. Alleen die agent kan hem claimen. Bash wordt uitgevoerd via `bash -c`; JavaScript draait in een `isolated-vm`-sandbox op de agent (geen filesystem, geen netwerk, geen `Function`/`eval`).

Meer dan één agent nodig? Maak ze aan, en richt individuele stappen op de agent die past. Wil je redundantie, dan kun je twee runbooks schrijven (één per agent) of stappen over agents verdelen.

## Operationele notities

### Timeouts

Twee timeouts gelden voor elke Bash- of JavaScript-stap:

| Timeout | Standaard | Wat het regelt |
| --- | --- | --- |
| **Claim-timeout** | 2 minuten | Hoe lang de Worker wacht tot de gekozen agent de job claimt. Pakt de agent hem niet op tijd op, dan faalt de stap met `TimedOut` en gaat het runbook verder (of stopt, afhankelijk van **Doorgaan bij fout**). |
| **Uitvoer-timeout** | 30 seconden | Hoe lang de agent het script laat draaien voordat hij het beëindigt. Per stap configureerbaar. (Bash krijgt `SIGKILL`; het JavaScript-isolate wordt afgebroken.) |

Het totale wachtvenster van de Worker is `claim-timeout + uitvoer-timeout + een paar seconden`. Kies waarden die bij de stap passen.

### Lease en heartbeat

Wanneer een agent een job claimt, krijgt hij een korte lease (standaard 30 seconden). Terwijl het script draait, vernieuwt de agent de lease elke 10 seconden. Sterft de agent of verliest hij het netwerk midden in het script, dan loopt de lease af en markeert de Worker de job als `TimedOut` in plaats van eeuwig te wachten.

Bash-child-processen worden **niet** automatisch afgebroken wanneer de lease afloopt (een JavaScript-isolate mag ook gewoon afmaken, als het ooit afloopt) — maar de Worker stopt met wachten, en de agent kan geen resultaat meer indienen zodra een andere claim het heeft overgenomen. Ontwerp scripts zo dat ze veilig opnieuw kunnen draaien als exact-één belangrijk is.

### Geen agent online

Als de gekozen agent offline is op het moment dat de stap draait, blijft de job `Pending` tot de claim-timeout verstreken is en faalt dan met een duidelijke "geen agent heeft de job geclaimd"-melding. Op de agents-pagina bevestig je dekking voordat je een runbook serieus draait.

### Outputlimiet

Gecombineerde stdout + stderr is beperkt tot **50&nbsp;KB** per stap. Grotere output wordt afgekapt met een marker. Heb je een volledig log nodig, schrijf het dan in het script naar S3 of je log-store en `echo` de URL.

### Annuleren

Een runbook-uitvoering annuleren (vanuit de uitvoeringsweergave of de API) markeert al zijn Bash- en JavaScript-jobs in `Pending`/`Claimed`/`Running` onmiddellijk als `Cancelled`. Een agent die al midden in een script zit, maakt zijn werk af, maar zijn resultaat wordt niet meer door de server geaccepteerd.

### Concurrency

Elke agent voert standaard één job tegelijk uit. Wil je meer toestaan, zet dan `RUNBOOK_AGENT_CONCURRENCY` op de agent-container — maar onthoud dat de agent de host deelt met wat er verder ook leeft.

## Environment variables

De agent leest deze bij het opstarten:

| Variabele | Verplicht | Standaard | Opmerkingen |
| --- | --- | --- | --- |
| `ONEUPTIME_URL` | ja | — | Basis-URL van je OneUptime-instantie, bv. `https://oneuptime.yourdomain.com`. |
| `RUNBOOK_AGENT_ID` | ja | — | De UUID die in de installatiemodal van de agent wordt getoond. |
| `RUNBOOK_AGENT_KEY` | ja | — | Het secret dat in de installatiemodal van de agent wordt getoond. |
| `RUNBOOK_AGENT_POLL_INTERVAL_MS` | nee | `5000` | Hoe vaak de agent polls voor nieuwe jobs. |
| `RUNBOOK_AGENT_HEARTBEAT_INTERVAL_MS` | nee | `60000` | Hoe vaak de agent zijn levensteken rapporteert. |
| `RUNBOOK_AGENT_JOB_HEARTBEAT_INTERVAL_MS` | nee | `10000` | Hoe vaak de agent de lease van een draaiende job vernieuwt. |
| `RUNBOOK_AGENT_CONCURRENCY` | nee | `1` | Maximaal aantal gelijktijdige jobs op deze agent. |

## Een agent-sleutel roteren

Als een sleutel lekt, open de agent in OneUptime en reset zijn sleutel. De oude sleutel stopt onmiddellijk met werken. Update de agent-container met de nieuwe sleutel en herstart hem.

## Rechten

Het beheren van agents valt onder de bestaande Runbooks-rechtengroep:

- `CreateRunbookAgent`, `EditRunbookAgent`, `DeleteRunbookAgent`, `ReadRunbookAgent` — agent-records beheren.
- `RunbookAdmin`, `RunbookMember`, `RunbookViewer` (rollen) — toewijzen aan een team om volledige controle, dagelijks gebruik of alleen-lezen toegang te verlenen. `RunbookAdmin` bundelt alle bovenstaande granulaire rechten.

Rechten om een runbook te *triggeren* (en dus Bash- en JavaScript-stappen te laten verspreiden) zijn nog steeds `CreateRunbookExecution` / `EditRunbookExecution`.

## Agent-side API

Voor de nieuwsgierigen — de agent gebruikt deze endpoints, gemount onder `/runbook-agent-ingest`. Ze worden geauthenticeerd via de ID + sleutel van de agent in de JSON-body (of de headers `x-agent-id` / `x-agent-key`).

| Endpoint | Doel |
| --- | --- |
| `POST /heartbeat` | Levensteken; werkt `lastAlive`, `connectionStatus`, `hostInfo`, `agentVersion` bij. |
| `POST /claim-next-job` | Atomair de oudste `Pending`-job claimen die op de ID van deze agent gericht is. Geeft `{ job: null }` terug als er niets te doen is. |
| `POST /job/:jobId/heartbeat` | De lease van de job verversen. Geeft 404 zodra de lease verlopen is of de job terminal is. |
| `POST /job/:jobId/result` | De eindstand indienen. Genegeerd als de lease al verder is. |

Je zou deze niet met de hand hoeven aanroepen — de meegeleverde agent doet dat. Ze zijn hier gedocumenteerd zodat je je eigen agent kunt bouwen als je een beperking hebt waar de onze niet bij past.
