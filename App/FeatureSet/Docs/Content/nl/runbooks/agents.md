# Runbook-agents

Een **Runbook-agent** is een klein, zelf-gehost proces dat de Bash-stappen van je runbooks **binnen je eigen infrastructuur** uitvoert. De OneUptime Worker voert je shell-commando's nooit zelf uit — hij zet ze in de wachtrij, en een Runbook-agent die je in je omgeving hebt geïnstalleerd haalt ze op, voert ze uit en stuurt het resultaat terug.

Deze pagina legt uit hoe je een agent installeert, Bash-stappen ernaar route, en hem dagelijks bedient.

## Waarom agents bestaan

Eerdere OneUptime-versies draaiden Bash-stappen direct op de Worker. Dat werkte voor single-tenant self-hosted setups waar de operators sowieso shell op de machine hadden, maar geeft voor iedereen anders twee problemen:

- **Vertrouwensgrens.** Wie een runbook mag opstellen, kan shell uitvoeren op de Worker, met toegang tot alle environment variables en het filesystem dat de Worker heeft.
- **Bereik.** De meeste nuttige Bash-stappen willen op de infrastructuur van de *klant* opereren ("herstart deze service", "kubectl op ons cluster") — niet op die van OneUptime.

Runbook-agents draaien dat om. Bash-stappen draaien niet bij ons. Ze draaien op een host die jij beheert, en jij bepaalt wat die host mag.

## Hoe het werkt

1. Je maakt een Runbook-agent aan in OneUptime. OneUptime genereert een ID en een geheime sleutel.
2. Je start de agent-container op een host binnen je infrastructuur met die ID/sleutel en je OneUptime-URL.
3. De agent vraagt OneUptime elke paar seconden: "werk voor mij?"
4. Zodra een Bash-stap draait, voegt de Worker een job-rij toe gemarkeerd met de **Agent Tag** van de stap en zet de status op `Pending`.
5. Een willekeurige gezonde agent in hetzelfde project die deze tag draagt claimt de job (atomair — nooit voeren twee agents dezelfde job uit), draait `bash -c <jouw script>` lokaal, vangt stdout/stderr/exit-code op en stuurt het resultaat terug.
6. De Worker hervat het runbook met het resultaat.

De agent heeft alleen **uitgaande HTTPS** naar je OneUptime-instantie nodig. Hij accepteert geen inkomende verbindingen.

## Een agent installeren

### 1. Het agent-record aanmaken

Ga naar **Runbooks → Agents → Nieuwe maken**. Vul in:

| Veld | Opmerkingen |
| --- | --- |
| **Naam** | Een sprekende naam — meestal `waar-hij-draait-en-wat-hij-kan`, bv. `prod-eu-west-1`. |
| **Beschrijving** | Optioneel. Een zin over wat deze host kan bereiken. Je toekomstige zelf zal dankbaar zijn. |
| **Tags** | Komma-gescheiden. Bash-stappen mikken op een tag; elke agent in het project met die tag mag ze uitvoeren. Gebruikelijke patronen: `prod`, `staging`, `eu-west-1`, `db-host`. |

### 2. Het installatiecommando kopiëren

Na het aanmaken, klik **Setup-instructies tonen** op de rij van de agent. Je ziet een `docker run`-commando vooringevuld met de ID en sleutel van deze agent. **Bewaar de sleutel nu** — je kunt hem later resetten, maar je kunt dezelfde waarde niet opnieuw zien nadat je het modal sluit.

### 3. Op een host in je infrastructuur uitvoeren

Voer het Docker-commando uit op elke host in je omgeving die:

- je OneUptime-instantie over HTTPS kan bereiken, en
- de dingen kan doen die je Bash-stappen willen doen (bv. SSH naar andere hosts, `kubectl`, database-toegang).

```bash
docker run --name oneuptime-runbook-agent --restart unless-stopped \
  -e RUNBOOK_AGENT_ID=<agent-id> \
  -e RUNBOOK_AGENT_KEY=<agent-key> \
  -e ONEUPTIME_URL=https://oneuptime.jouw-domein.com \
  -d oneuptime/runbook-agent:release
```

### 4. Controleren dat de agent verbonden is

Ga terug naar **Runbooks → Agents**. Binnen ongeveer 60 seconden moet de rij van de agent op `Connected` springen met een verse **Last seen**-tijdstempel. Blijft hij `Disconnected`:

- Check de container-logs (`docker logs oneuptime-runbook-agent`) op auth- of netwerkfouten.
- Controleer dat de host de OneUptime-URL bereikt met `curl`.
- Controleer dat ID en sleutel zonder spaties zijn gekopieerd.

## Tagging en routing

Tags zijn hoe een Bash-stap een agent vindt. Een paar patronen:

- **Eén tag per omgeving.** Geef de prod-agent `prod`, de staging-agent `staging`. Bash-stappen met `prod` draaien alleen op prod.
- **Eén tag per regio.** `eu-west-1`, `us-east-1`. Handig wanneer een stap dicht bij de resource moet draaien die hij aanraakt.
- **Meerdere agents, dezelfde tag.** Draai twee agents beide met `prod`. Elk kan een job claimen — geeft high availability en laat je rolling restarts doen zonder runbooks te breken.
- **Meerdere tags per agent.** Een agent in je prod-EU-cluster kan `prod`, `eu-west-1` en `kubernetes` dragen. Bash-stappen kunnen op elk daarvan mikken.

Een Bash-stap **moet** exact één agent-tag opgeven. Multi-tag routing (draai op elke agent met `prod` AND `db`) staat op de roadmap, niet in deze release.

## Een Bash-stap naar een agent wijzen

Voeg in je runbook een Bash-stap toe. Het formulier vraagt om een **Agent Tag**:

- Vul de tag in die hoort bij de agent(s) waar je het wilt laten draaien.
- Schrijf je script in de editor eronder.

Wanneer het runbook draait en deze stap bereikt, zet de Worker een job in de wachtrij met die tag. Als er minstens één gezonde agent met die tag online is, wordt de job binnen enkele seconden geclaimd en uitgevoerd.

## Operationele opmerkingen

### Timeouts

Op elke Bash-stap zijn twee timeouts van toepassing:

| Timeout | Standaard | Wat het regelt |
| --- | --- | --- |
| **Claim timeout** | 2 minuten | Hoe lang de Worker wacht tot *een* agent de job claimt. Als niemand het op tijd oppakt, faalt de stap met `TimedOut` en gaat het runbook verder (of stopt, afhankelijk van **Doorgaan bij falen**). |
| **Execution timeout** | 30 seconden | Hoe lang de agent het script laat draaien voordat hij `SIGKILL` stuurt. Per stap instelbaar. |

Het totale wachtvenster van de Worker is `claim timeout + execution timeout + een paar seconden marge`. Kies waarden passend bij de stap.

### Lease en heartbeat

Wanneer een agent een job claimt, krijgt hij een korte lease (standaard 30 seconden). Terwijl het script draait, vernieuwt de agent de lease elke 10 seconden. Sterft de agent of verliest hij het netwerk midden in het script, dan verloopt de lease en markeert de Worker de job als `TimedOut` in plaats van eeuwig te wachten.

Het kindproces van het script wordt **niet** automatisch gestopt wanneer de lease verloopt — maar de Worker stopt met wachten, en de agent kan geen resultaat meer indienen zodra een andere claim de boel heeft overgenomen. Ontwerp scripts veilig om opnieuw te draaien als exactly-once je iets uitmaakt.

### Geen agent online

Is er op het uitvoermoment geen gezonde agent met de tag van de stap online, dan blijft de job `Pending` tot de claim timeout verstrijkt en faalt dan met een duidelijke melding ("no agent claimed the job"). De Agents-pagina is waar je bevestigt dat je dekking hebt voor je een runbook serieus draait.

### Output-plafond

Gecombineerde stdout + stderr zijn per stap geplafonneerd op **50 KB**. Grotere output wordt afgekapt met een marker. Heb je een volledige log nodig, schrijf hem dan vanuit het script naar S3 of je log store en `echo` de URL.

### Annuleren

Een runbook-uitvoering annuleren (via de uitvoeringsweergave of de API) markeert direct alle bijbehorende `Pending`/`Claimed`/`Running` Bash-jobs als `Cancelled`. Een agent die al midden in het script zit, maakt zijn werk af, maar zijn resultaat wordt door de server niet meer geaccepteerd.

### Concurrency

Elke agent draait standaard één job tegelijk. Wil je meer, zet dan `RUNBOOK_AGENT_CONCURRENCY` op de agent-container — maar onthoud dat de agent de host deelt met alles wat daar verder draait.

## Environment variables

De agent leest deze bij opstart:

| Variabele | Vereist | Standaard | Opmerkingen |
| --- | --- | --- | --- |
| `ONEUPTIME_URL` | ja | — | Basis-URL van je OneUptime-instantie, bv. `https://oneuptime.jouw-domein.com`. |
| `RUNBOOK_AGENT_ID` | ja | — | De UUID uit het setup-modal van de agent. |
| `RUNBOOK_AGENT_KEY` | ja | — | Het geheim uit het setup-modal van de agent. |
| `RUNBOOK_AGENT_POLL_INTERVAL_MS` | nee | `5000` | Hoe vaak de agent naar nieuwe jobs vraagt. |
| `RUNBOOK_AGENT_HEARTBEAT_INTERVAL_MS` | nee | `60000` | Hoe vaak de agent meldt dat hij leeft. |
| `RUNBOOK_AGENT_JOB_HEARTBEAT_INTERVAL_MS` | nee | `10000` | Hoe vaak de agent de lease van een lopende job vernieuwt. |
| `RUNBOOK_AGENT_CONCURRENCY` | nee | `1` | Maximaal aantal gelijktijdige jobs op deze agent. |

## Een agent-sleutel roteren

Lekt een sleutel, open dan de agent in OneUptime en reset zijn sleutel. De oude werkt onmiddellijk niet meer. Werk de agent-container bij met de nieuwe sleutel en herstart hem.

## Permissies

Beheer van agents valt onder de bestaande Runbooks-permissiegroep:

- `CreateRunbookAgent`, `EditRunbookAgent`, `DeleteRunbookAgent`, `ReadRunbookAgent` — agent-records beheren.
- `RunbookManager` (rol) — bundelt alle bovenstaande.

Permissies om een runbook te *starten* (en dus Bash-stappen te dispatchen) blijven `CreateRunbookExecution` / `EditRunbookExecution`.

## Agent-API

Voor de nieuwsgierigen — de agent gebruikt deze endpoints, gemount onder `/runbook-agent-ingest`. Ze worden geauthenticeerd door agent-ID + sleutel in de JSON-body (of `x-agent-id` / `x-agent-key`-headers).

| Endpoint | Doel |
| --- | --- |
| `POST /heartbeat` | Liveness; werkt `lastAlive`, `connectionStatus`, `hostInfo`, `agentVersion` bij. |
| `POST /claim-next-job` | Claimt atomair de oudste `Pending`-job waarvan de tag overeenkomt met een van de tags van deze agent. Geeft `{ job: null }` als er niets te doen is. |
| `POST /job/:jobId/heartbeat` | Vernieuwt de lease van de job. Geeft 404 zodra de lease verlopen is of de job terminaal is. |
| `POST /job/:jobId/result` | Dient de eindstand in. Genegeerd als de lease al naar een ander is verschoven. |

Je hoeft deze niet handmatig aan te roepen — de meegeleverde agent doet dat. Ze staan hier gedocumenteerd zodat je je eigen agent kunt bouwen als de onze niet bij jouw constraints past.
