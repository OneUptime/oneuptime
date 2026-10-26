# Runbook-agenten

Een **runbook-agent**, in het dashboard **Runner** genoemd, is een klein zelf gehost proces dat de JavaScript-, Bash-, SSH- en kubectl-stappen van uw runbooks **in uw eigen infrastructuur** uitvoert. De OneUptime Worker voert uw scripts nooit uit: hij zet ze in de wachtrij, en de Runner die de schrijver van de stap koos, pakt elk script op, voert het uit en meldt het resultaat terug. Deze pagina is voor wie Runners installeert en beheert. Een stap die geen Runner kiest, loopt op de [standaard-Runner van het project](#de-standaard-runner-van-het-project), als u er een hebt ingesteld; anders loopt een JavaScript-stap op een [globale Runner](#globale-runners), een van de Runners die OneUptime voor elk project draait.

:::cards
- [Een Runner installeren](#een-runner-installeren): Van het dashboard naar een verbonden container, in vijf stappen.
- [Een stap op een Runner richten](#een-stap-op-een-runner-richten): Een stap koppelen aan de Runner die hem moet uitvoeren.
- [De standaard-Runner van het project](#de-standaard-runner-van-het-project): De Runner waarop een stap of code-repository loopt die er geen kiest.
- [Globale Runners](#globale-runners): De Runners die OneUptime voor elk project draait, en wat ze uitvoeren.
- [Time-outs](#time-outs): Claim- en uitvoeringstime-outs, en hoe ze samenwerken.
- [Omgevingsvariabelen](#omgevingsvariabelen): Wat de container bij het starten leest.
:::

## Hoe het werkt

```mermaid title="Wat er over het netwerk gaat tussen een Runner en OneUptime"
flowchart TB
    subgraph cloud["OneUptime"]
        direction LR
        worker["Worker zet de stap in de wachtrij"]
        ingest["Runner-API"]
    end
    subgraph yours["Uw infrastructuur"]
        direction LR
        runner["Runner-container"]
        targets["Hosts, clusters, interne diensten"]
    end
    worker --> ingest
    runner -->|"Uitgaand HTTPS, Runner-ID en sleutel"| ingest
    ingest -->|"Opgepakte taak, met zijn geheimen"| runner
    runner -->|"Script, SSH of Kubernetes-API"| targets
```

1. U maakt een Runner in OneUptime. OneUptime genereert er een ID en een geheime sleutel voor.
2. U draait de Runner-container op een host in uw infrastructuur, met dat ID, die sleutel en uw OneUptime-URL.
3. De Runner vraagt OneUptime elke 5 seconden om werk en meldt elke 60 seconden dat hij leeft.
4. Wanneer u een JavaScript-, Bash-, SSH- of kubectl-stap schrijft, kiest u de Runner uit een vervolgkeuzelijst onder **Meer velden** van de stap. De stap is aan die Runner gekoppeld. Een stap die er geen kiest, loopt op de standaard-Runner van het project, als u er een hebt ingesteld, en anders loopt een JavaScript-stap op **Globale Runner**.
5. Wanneer de stap loopt, zet de Worker een taak in de wachtrij waarvan `targetAgentId` naar die Runner wijst. Alleen die Runner kan hem oppakken.
6. De Runner voert de job lokaal uit — `bash -c <script>` voor Bash en kubectl, een `isolated-vm`-sandbox voor JavaScript, een SSH-verbinding die het script met bash op de machine uitvoert —, legt het resultaat vast, verbergt daarin de geheimen van de stap en stuurt het terug. De Worker hervat het runbook met het resultaat.

De Runner heeft alleen **uitgaand HTTPS** naar uw OneUptime-instantie nodig. Hij accepteert geen inkomende verbindingen.

Een Runner bewaart alleen zijn ID en sleutel. Al het andere krijgt hij met de job die hij oppakt: een script met de [runbookvariabelen](/docs/runbooks/variables) die het noemt ingevuld, en de sleutel of het wachtwoord van een SSH-stap of de kubeconfig van een kubectl-stap. Een geheim krijgt hij alleen als dat geheim het hem toestaat. Daarom kan iedereen met de sleutel van een Runner als die Runner optreden: behandel de sleutel zoals de geheimen die hij mag gebruiken.

## Waarom scripts op een Runner lopen

Scripts op de OneUptime Worker uitvoeren gaf twee problemen:

- **Vertrouwensgrens.** Iedereen die een runbook kon schrijven, kon code op de Worker uitvoeren, met toegang tot alles wat de Worker kon bereiken.
- **Bereik.** De meeste nuttige stappen werken op _uw_ infrastructuur ("herstart deze dienst", "zoek een record op in onze interne database"), niet op die van OneUptime.

Met Runners lopen die stappen op een host die u beheert, en bepaalt u wat die host mag doen. HTTP-verzoek- en AI-stappen lopen nog steeds op de Worker, omdat ze niets uit uw netwerk nodig hebben.

## Globale Runners

Globale Runners zijn de Runners die OneUptime voor elk project draait. Een JavaScript-stap die geen eigen Runner kiest, loopt op een daarvan, tenzij het project een [standaard-Runner](#de-standaard-runner-van-het-project) heeft, zodat u hem kunt schrijven voordat u iets installeert. **Runbooks → Runbook-agenten** toont ze onder **Globale Runners**, boven uw eigen Runners, en de vervolgkeuzelijst **Runner** van een JavaScript-stap biedt **Globale Runner** als eerste aan, of direct na de standaard-Runner van het project. De vervolgkeuzelijst van een Bash-, SSH- of kubectl-stap toont hem als laatste, grijs, met **Voert alleen JavaScript-stappen uit.** Die stappen lopen op een eigen Runner, binnen uw netwerk, nooit op een Runner die alle projecten delen.

| | Globale Runner | Uw eigen Runner |
| --- | --- | --- |
| Stappen die hij uitvoert | JavaScript | JavaScript, Bash, SSH en kubectl |
| Wat een stap kan bereiken | Openbare internetadressen | Wat zijn host kan bereiken |
| Langste looptijd van een stap | 5 minuten | 1 uur |
| Geheime variabelen | Die u globale Runners laat gebruiken | Die hem vermelden |
| Bash-opdrachten van OneUptime AI | Nooit | Voor de AI-regels die hem kiezen |
| Codecorrecties van OneUptime AI | Ter review geopend zonder ze te bouwen of te testen | Gebouwd en getest voordat de pull request opent |

Een globale Runner voert de stappen van veel projecten uit, dus elke stap wordt gescheiden gehouden van alle andere:

- Elke stap loopt in een eigen `isolated-vm`-sandbox, gemaakt voor die stap en daarna weggegooid: geen bestanden, geen processen, geen omgevingsvariabelen en niets dat van de ene stap naar de volgende bewaard blijft.
- Zijn HTTP-verzoeken bereiken alleen openbare internetadressen, nooit een privé-, loopback- of link-local-adres of een cloudmetadata-endpoint, zodat een globale Runner nooit uw netwerk bereikt.
- Hij krijgt een geheime variabele alleen als haar schakelaar **Globale Runners mogen het gebruiken** aan staat, en alleen voor een stap van het eigen project van de variabele.
- Een project voert hooguit drie stappen tegelijk uit op globale Runners, zodat geen project ze voor zichzelf houdt.

Een globale Runner neemt ook de codecorrecties van OneUptime AI op zich, in elke coderepository die op **Globale Runner** werkt. Hij schrijft elke correctie en opent de pull request, maar voert geen enkele opdracht uit, ook niet de setup-, build- en testopdrachten van de repository, dus de pull request meldt dat de controle is overgeslagen. Hij bereikt alleen Git-servers op het internet, via HTTPS, behalve bij een zelf gehoste OneUptime, waar hij ook de private Git-servers mag bereiken die de server zelf mag bereiken.

Kies een van uw eigen Runners voor een stap die uw netwerk moet bereiken, of om de stap op hosts te houden die u beheert. Om elke stap op uw eigen Runners te houden, zet u **Globale Runners gebruiken** uit onderaan **Runbooks → Runbook-agenten**. Een JavaScript-stap die geen Runner kiest, loopt dan op de standaard-Runner van het project of mislukt, als er geen is ingesteld, met een melding, totdat hij een van uw Runners kiest; een stap die een van uw Runners kiest, houdt die in elk geval. Een code-repository die in zijn instellingen in Code geen Runner kiest, werkt ook op de standaard-Runner van het project of, als er geen is ingesteld, op een globale Runner, en heeft een van uw Runners nodig zolang de schakelaar uit staat; zie [Code](/docs/ai/ai-agent#de-runner-van-de-repository-kiezen).

### Waar globale Runners vandaan komen

Op OneUptime Cloud draait OneUptime ze. Een zelf gehoste installatie draait standaard een eigen exemplaar, zoals ze haar eigen globale probes draait: de service `global-runner` in Docker Compose en de deployment `globalRunner` in de Helm-chart. Die heeft een eigen sleutel, `GLOBAL_RUNNER_KEY`, en verder niets van de server.

Een hoofdbeheerder kan er meer toevoegen, om stappen en codecorrecties vanaf andere hosts uit te voeren: open in het beheerdashboard **Instellingen** en daarna **Globale Runners**, maak er een aan en voer de opdracht die zijn **ID en sleutel tonen** geeft uit op een host die het internet bereikt.

Om de meegeleverde uit te zetten, stelt u `GLOBAL_RUNNER_REPLICAS=0` in de `config.env` van Docker Compose in, of `globalRunner.enabled` op `false` in de Helm-chart. Zonder enige globale Runner toont **Runbooks → Runbook-agenten** alleen uw eigen Runners, en kiezen elke JavaScript-stap en elke coderepository een daarvan.

## Voordat u begint

- **Een host met Docker** in uw infrastructuur, die uw OneUptime-URL via HTTPS bereikt en de systemen waarop uw stappen werken.
- **Een rol die Runners maakt.** Project Owner, Project Admin, Project Member en Runbook Admin kunnen er een maken. Alleen een Project Owner, Project Admin of Runbook Admin ziet de sleutel van een Runner, die in de installatieopdracht staat.

## Een Runner installeren

### 1. Het agentrecord maken

Ga naar **Runbooks → Runbook-agenten** en maak een nieuwe agent. Klik op **Runner aanmaken** en vul de velden in, allemaal op één pagina:

| Veld | Waar | Opmerkingen |
| --- | --- | --- |
| **Naam** | Op de pagina | Een duidelijke naam, meestal waar hij draait en wat hij bereikt, zoals `prod-eu-west-1`. Dit kiest u wanneer u een stap schrijft. |
| **Beschrijving** | Op de pagina | Optioneel. Een zin over wat deze host bereikt. |
| **Voert Runbooks uit** | Onder **Meer velden** | Standaard aan. Laat deze Runner runbook-stappen oppakken. |
| **Labels** | Onder **Meer velden** | Optioneel. |

Een Runner neemt een wijziging van zijn mogelijkheden over bij zijn volgende heartbeat; opnieuw starten is niet nodig. AI is geen mogelijkheid. Een code-repository kiest in zijn instellingen in Code de Runner waarop AI erin werkt, en de pagina van de Runner toont de repositories die hem kiezen. Een AI-regel kiest de Runner waarop OneUptime AI zijn opdrachten uitvoert: pas door een Runner daar te kiezen mogen de opdrachten van OneUptime AI erop draaien.

### 2. De installatieopdracht kopiëren

Klik in de rij van de Runner op **Installatie-instructies weergeven**. Het dialoogvenster **Configuratie van runbook-agent** toont een `docker run`-opdracht met het ID en de sleutel van deze Runner al ingevuld. Dezelfde opdracht staat op de eigen pagina van de Runner, onder **Installatie-instructies**.

Alleen een Project Owner, Project Admin of Runbook Admin kan de sleutel lezen. Anderen zien "U hebt geen toestemming om de sleutel van deze runbook-agent te bekijken" in plaats van de opdracht.

### 3. Hem draaien op een host in uw infrastructuur

Voer de opdracht uit op een host in uw omgeving die:

- uw OneUptime-instantie via HTTPS bereikt, en
- kan doen wat uw stappen nodig hebben, zoals andere hosts via SSH bereiken, de API-server van een cluster aanroepen of met een database praten.

```bash
docker run --name oneuptime-runner --restart unless-stopped \
  -e ONEUPTIME_RUNNER_ID=<runner-id> \
  -e ONEUPTIME_RUNNER_KEY=<runner-key> \
  -e ONEUPTIME_URL=https://oneuptime.yourdomain.com \
  -d oneuptime/runner:release
```

### 4. Controleren dat de agent verbonden is

Ga terug naar **Runbooks → Runbook-agenten**. Binnen een minuut na het starten van de container moet de **Status** van de Runner **Verbonden** tonen, met een recente **Laatst gezien**. Op de eigen pagina van de Runner toont de kaart **Status van runbook-agent** zijn **Versie van runbook-agent** en **Host**. Blijft hij op **Nooit verbonden** of **Verbinding verbroken** staan, zie dan [Problemen oplossen](#problemen-oplossen).

### 5. De agent bijwerken

Draait een agent een oudere versie dan uw OneUptime, dan verschijnt op zijn pagina een waarschuwingsteken naast zijn **Versie van runbook-agent**. Kies het om te zien hoe u bijwerkt: haal de nieuwe image op en verwijder de container, en voer dan de installatieopdracht uit stap 2 opnieuw uit. Een agent die de Kubernetes-agentchart installeerde, wordt in plaats daarvan met de chart bijgewerkt.

```bash
docker pull oneuptime/runner:release
docker rm -f oneuptime-runner
```

## Een stap op een Runner richten

:::steps
### Een stap toevoegen die op een Runner loopt

Voeg in de **Stappen** van uw runbook een JavaScript-, Bash-, SSH- of kubectl-stap toe.

### De Runner kiezen

Open **Meer velden** van de stap: de vervolgkeuzelijst **Runner** toont elke Runner in het project, en of hij verbonden is, en de ingeklapte regel noemt de Runner waarop de stap loopt. Heeft het project er nog geen, dan zegt de stap dat en verwijst hij u naar **Runbooks › Runners**. De eerste keuze is waarop een stap loopt die geen Runner kiest: de [standaard-Runner van het project](#de-standaard-runner-van-het-project), gemarkeerd met **Projectstandaard**, of anders, voor een JavaScript-stap, **Globale Runner**.

### De stappen opslaan

Klik op **Stappen opslaan**. Wanneer een uitvoering de stap bereikt, zet de Worker een taak in de wachtrij voor het ID van die Runner, en alleen die Runner kan hem oppakken. Een stap op **Globale Runner** wacht op de globale Runner die vrij is.
:::

Bash wordt uitgevoerd met `bash -c`. JavaScript loopt in een `isolated-vm`-sandbox op de Runner, zonder toegang tot het bestandssysteem of processen; het kan openbare HTTP-API's aanroepen met `axios`, maar geen adressen in een privénetwerk. Een SSH- of kubectl-stap meldt zich aan met een geheime [runbookvariabele](/docs/runbooks/variables), die de Runner van de stap moet vermelden onder **Je Runners die het mogen gebruiken**.

Meer dan één Runner nodig? Maak ze en richt elke stap op de juiste. Voor redundantie draait u een tweede Runner en verdeelt u de stappen over beide, of houdt u een reserve-runbook bij waarvan de stappen op de andere Runner zijn gericht.

## De standaard-Runner van het project

Een project kan een van zijn eigen Runners zijn standaard maken, zoals het een Twilio-configuratie zijn standaard maakt. Elke runbookstap die geen Runner kiest, loopt dan daarop: Bash-, SSH- en kubectl-stappen, en JavaScript-stappen, die anders op een globale Runner zouden lopen. Hetzelfde geldt voor AI in elke code-repository die in zijn instellingen in Code geen Runner kiest.

Om een Runner de standaard te maken, gaat u naar **Runbooks → Runbook-agenten**, opent u het menu **⋯** in de rij van de Runner, klikt u op **Instellen als projectstandaard** en bevestigt u met **Projectstandaard maken**. Of open de Runner en zet op zijn kaart **Projectstandaard** de schakelaar **Als projectstandaard gebruiken** aan. De lijst markeert de standaard met **Projectstandaard**, naast zijn naam, en de vervolgkeuzelijst **Runner** van een stap doet dat ook, bij de eerste keuze. Een project heeft één standaard-Runner: een andere Runner de standaard maken vervangt hem. **Niet meer als projectstandaard gebruiken**, in hetzelfde menu, of de schakelaar op de pagina van de Runner, stopt het gebruik ervan.

Waar een stap loopt die geen Runner kiest:

| Het project | Een JavaScript-stap | Een Bash-, SSH- of kubectl-stap |
| --- | --- | --- |
| Heeft een standaard-Runner | De standaard-Runner | De standaard-Runner |
| Heeft er geen, en gebruikt globale Runners | Een globale Runner | Nergens: de stap mislukt met de melding dat hij geen Runner heeft |
| Heeft er geen, en gebruikt geen globale Runners | Nergens: de stap mislukt met een melding | Nergens: de stap mislukt met de melding dat hij geen Runner heeft |

Een stap die een Runner heeft gekozen, houdt die, wat de standaard ook is, en een JavaScript-stap kan nog steeds zelf **Globale Runner** kiezen. Een standaard instellen verandert geen opgeslagen stap.

De standaard is een van de eigen Runners van het project die runbookstappen uitvoert: geen globale Runner, niet de Runner in het cluster die de Kubernetes-agent heeft geïnstalleerd, en geen Runner waarbij **Voert Runbooks uit** uit staat. Zolang een Runner de standaard is, blijft zijn **Voert Runbooks uit** aan. Als de standaard niet verbonden is, zegt de vervolgkeuzelijst van een stap dat, en een stap erop wacht erop, zoals op elke Runner, tot zijn claim timeout verstrijkt.

Runbookstappen en code-repositories die geen Runner kiezen, gebruiken de standaard en verhuizen mee wanneer een andere Runner de standaard wordt. Een AI-regel kiest zijn eigen Runner, en een nieuwe regel begint op de standaard.

## Beheernotities

### Time-outs

Voor elke stap die op een Runner loopt, gelden twee time-outs:

| Time-out | Standaard | Wat het regelt |
| --- | --- | --- |
| **Time-out voor oppakken** | 2 minuten | Hoe lang de Worker wacht tot de gekozen Runner de taak oppakt. Pakt de Runner hem niet op tijd op, dan mislukt de stap door een time-out en gaat het runbook verder (of stopt het, afhankelijk van **Doorgaan bij fout**). |
| **Uitvoeringstime-out** | 30 seconden | Hoe lang de Runner de stap laat lopen voordat hij hem stopt. Bash krijgt `SIGKILL`; de sandbox van JavaScript wordt afgebroken. |

Beide zijn per stap in te stellen. Open **Runbooks › uw runbook › Stappen**, klap de stap uit en stel **Uitvoeringstime-out** en **Time-out voor oppakken** (in seconden) in onder **Meer velden**. Laat een veld leeg om de standaard te gebruiken. Elk accepteert 1 seconde tot 1 uur; waarden buiten dat bereik worden bij het uitvoeren van de stap begrensd.

Het totale wachtvenster van de Worker is `claim timeout + execution timeout + a few seconds`. Kies waarden die bij de stap passen.

Twee dingen om op te letten als u de claim timeout verlaagt:

- De Runner vraagt om werk in een pollingcyclus (`ONEUPTIME_RUNNER_POLL_INTERVAL_MS`, standaard 5 seconden). Een claim timeout korter dan één cyclus kan verlopen voordat een volkomen gezonde Runner de taak zelfs maar heeft gezien, en de stap mislukt dan met dezelfde melding als bij een offline Runner.
- Een Runner voert standaard één taak tegelijk uit (`ONEUPTIME_RUNNER_CONCURRENCY`). Terwijl een lange stap hem bezighoudt, wachten andere stappen die op dezelfde Runner zijn gericht hun eigen claim timeouts af. Verhoogt u een execution timeout tot minuten, verhoog dan ook de claim timeout van de stappen die die Runner delen, of geef ze een andere Runner.

### Lease en heartbeat

```mermaid title="Een taak tussen OneUptime en zijn Runner"
sequenceDiagram
    participant O as OneUptime
    participant R as Runner
    O->>O: Een taak voor deze Runner in de wachtrij zetten
    R->>O: De volgende taak oppakken
    O-->>R: De taak, met een lease van 30 seconden
    loop Elke 10 seconden zolang hij loopt
        R->>O: De lease verlengen
    end
    R->>O: Het resultaat melden
    O->>O: De uitvoer vastleggen en de uitvoering voortzetten
```

Wanneer een Runner een taak oppakt, krijgt hij een korte lease (standaard 30 seconden). Terwijl de stap loopt, verlengt de Runner de lease elke 10 seconden. Valt de Runner uit of verliest hij midden in een script zijn netwerk, dan verloopt de lease en markeert de Worker de taak als `TimedOut` in plaats van eeuwig te wachten.

Kindprocessen van Bash worden **niet** automatisch geannuleerd wanneer de lease verloopt (een JavaScript-sandbox mag ook afmaken, als hij ooit klaar is), maar de Worker wacht er niet meer op, en de Runner kan geen resultaat meer indienen zodra een andere claim het heeft overgenomen. Ontwerp scripts zo dat ze veilig opnieuw kunnen lopen als exact één keer uitvoeren voor u belangrijk is.

### Als de OneUptime Worker midden in een stap herstart

Een runbook-uitvoering loopt van begin tot eind op één Worker, dus een deploy of een crash kan haar onderbreken terwijl een stap bezig is. Wat daarna gebeurt, hangt ervan af of de uitvoering weer wordt opgepakt:

- **Ze wordt hervat.** De Worker die haar oppakt, vindt de taak die uw stap al had gemaakt en **koppelt zich er opnieuw aan**. Hij wacht op die taak in plaats van uw Runner een tweede kopie van het script te sturen. Was de Runner al klaar, dan wordt het vastgelegde resultaat ongewijzigd gebruikt. Een stap wordt per uitvoering hooguit één keer naar een Runner gestuurd.
- **Ze wordt niet hervat.** Wordt de uitvoering nooit meer opgepakt, dan markeert een opruimronde haar als `Failed` zodra ze het claim- en uitvoeringsvenster van haar huidige stap heeft overschreden, met een melding die die stap noemt. Een uitvoering blijft nooit in `Running` hangen.

Het enige wat dit u niet kan vertellen, is hoe ver een script kwam voordat de Worker verdween. Een stap die halverwege was, wordt als mislukt gemeld met een notitie dat hij mogelijk deels is uitgevoerd: controleer het doelsysteem voordat u het runbook opnieuw uitvoert.

### Geen agent online

Is de gekozen Runner offline wanneer de stap loopt, dan wacht de taak als `Pending` tot de claim timeout verstrijkt, en mislukt de stap vervolgens met "No runbook agent picked up this step before the wait window expired." Op de pagina **Runbook-agenten** controleert u de dekking voordat u een runbook in een echte situatie uitvoert. Een stap op een globale Runner mislukt in plaats daarvan met "No global Runner picked up this step before the wait window expired."

### Uitvoerlimiet

stdout en stderr samen zijn per stap beperkt tot **50 KB**. Langere uitvoer wordt afgekapt met een markering. Hebt u een volledig log nodig, schrijf het dan vanuit het script naar uw logopslag of objectopslag en geef de URL weer met `echo`.

### Annulering

Een runbook-uitvoering annuleren, vanaf de uitvoeringspagina of via de API, markeert meteen al haar taken in `Pending`, `Claimed` en `Running` als `Cancelled`. Een Runner die al midden in een script zit, maakt zijn werk af, maar de server accepteert het resultaat niet, en geen latere stap van het runbook wordt verstuurd.

### Gelijktijdigheid

Elke Runner voert standaard één taak tegelijk uit. Stel `ONEUPTIME_RUNNER_CONCURRENCY` in op de container om er meer toe te staan, maar bedenk dat de Runner de host deelt met al het andere dat er draait.

## Omgevingsvariabelen

De Runner leest deze variabelen bij het starten:

| Variabele | Verplicht | Standaard | Opmerkingen |
| --- | --- | --- | --- |
| `ONEUPTIME_URL` | ja | — | Basis-URL van uw OneUptime-instantie, zoals `https://oneuptime.yourdomain.com`. |
| `ONEUPTIME_RUNNER_ID` | ja | — | Het ID van de Runner, uit de installatieopdracht. |
| `ONEUPTIME_RUNNER_KEY` | ja | — | De geheime sleutel van de Runner, uit de installatieopdracht. |
| `ONEUPTIME_RUNNER_POLL_INTERVAL_MS` | nee | `5000` | Hoe vaak de Runner om nieuwe taken vraagt. Een waarde onder `1000` valt terug op de standaard. |
| `ONEUPTIME_RUNNER_HEARTBEAT_INTERVAL_MS` | nee | `60000` | Hoe vaak de Runner meldt dat hij leeft. Een waarde onder `5000` valt terug op de standaard. |
| `ONEUPTIME_RUNNER_JOB_HEARTBEAT_INTERVAL_MS` | nee | `10000` | Hoe vaak de Runner de lease van een lopende taak verlengt. Een waarde onder `1000` valt terug op de standaard. |
| `ONEUPTIME_RUNNER_CONCURRENCY` | nee | `1` | Maximaal aantal gelijktijdige taken op deze Runner. |
| `ONEUPTIME_RUNNER_ENABLE_RUNBOOKS` | nee | — | Zet op `false` zodat deze Runner geen runbook-stappen meer oppakt, wat het dashboard ook zegt. Kan de mogelijkheid alleen uitzetten. |
| `ONEUPTIME_RUNNER_ENABLE_CODE_FIXES` | nee | — | Zet op `false` zodat deze Runner geen AI-codecorrecties meer oppakt, ook niet voor een code-repository die hem kiest. |
| `ONEUPTIME_RUNNER_ENABLE_AI_COMMANDS` | nee | — | Zet op `false` zodat deze Runner geen AI-herstelopdrachten meer uitvoert, wat het dashboard ook zegt. |

## Een agentsleutel vervangen

Lekt een sleutel uit, stel hem dan opnieuw in. De oude sleutel werkt meteen niet meer.

:::steps
### De sleutel opnieuw instellen

Open de Runner via **Runbooks → Runbook-agenten**, klik op **Runbook-agentsleutel opnieuw instellen** en bevestig. De Runner maakt geen verbinding meer tot hij de nieuwe sleutel heeft.

### De container met de nieuwe sleutel draaien

Kopieer de nieuwe opdracht uit de **Installatie-instructies** van de Runner, verwijder de oude container en voer de nieuwe opdracht uit op dezelfde host:

```bash
docker rm -f oneuptime-runner
```

### Controleren dat hij opnieuw verbindt

Onder **Runbooks → Runbook-agenten** springt de **Status** van de Runner binnen een minuut terug naar **Verbonden**.
:::

## Machtigingen

Het beheer van agenten valt onder de bestaande machtigingsgroep Runbooks:

- `CreateRunner`, `EditRunner`, `DeleteRunner`, `ReadRunner` — agentrecords beheren.
- `RunbookAdmin`, `RunbookMember`, `RunbookViewer` (rollen) — `RunbookAdmin` bouwt runbooks, hun regels en de Runners waarop ze lopen, en voert ze uit. `RunbookMember` opent runbooks en hun uitvoeringen en voert ze uit — start een uitvoering, voltooit of slaat stappen over en annuleert haar — maar maakt, wijzigt en verwijdert geen runbook of Runner. `RunbookViewer` leest runbooks en hun uitvoeringen en voert niets uit. `RunbookAdmin` bundelt alle gedetailleerde machtigingen hierboven.
- Globale Runners horen bij geen enkel project: alleen een hoofdbeheerder voegt er een toe, wijzigt of verwijdert er een, in het beheerdashboard. Iedereen die de Runners van een project mag lezen, ziet ze, en **Globale Runners gebruiken** uitzetten vraagt de machtiging om het project te bewerken.

Een runbook starten (en zo zijn stappen naar Runners sturen) vereist een rol die runbooks uitvoert — `ProjectOwner`, `ProjectAdmin`, `ProjectMember`, `RunbookAdmin` of `RunbookMember` — of `CreateRunbookExecution`; een uitvoering voltooien, overslaan of annuleren accepteert ook `EditRunbookExecution`. Een rol voert alleen de runbooks uit die binnen zijn bereik vallen.

De sleutel van een Runner is alleen leesbaar voor Project Owners, Project Admins en Runbook Admins.

## API voor agenten

Voor wie het wil weten: de Runner gebruikt deze endpoints, gekoppeld onder `/runner-ingest`. Het pad van vóór de samenvoeging, `/runbook-agent-ingest`, wordt nog steeds bediend voor agenten die nog niet opnieuw zijn uitgerold, zodat een serverupgrade ze niet breekt. Ze worden geauthenticeerd met het ID en de sleutel van de Runner in de JSON-body (`agentId` en `agentKey`), of in de headers `x-agent-id` en `x-agent-key`.

| Endpoint | Doel |
| --- | --- |
| `POST /heartbeat` | Levensteken. Werkt de laatst-gezien-tijd, versie en hostinformatie van de Runner bij en geeft de mogelijkheden terug die het project hem gaf. |
| `POST /claim-next-job` | Atomair de oudste taak in `Pending` oppakken die op het ID van deze Runner is gericht. Geeft `{ job: null }` terug als er niets te doen is. Een globale Runner pakt in plaats daarvan de oudste stap op die op een willekeurige globale Runner wacht. |
| `POST /job/:jobId/heartbeat` | De lease van de taak vernieuwen. Geeft 404 terug zodra de lease is verlopen of de taak klaar is. |
| `POST /job/:jobId/result` | Het eindresultaat indienen. Wordt genegeerd als de lease al is doorgegaan. |
| `POST /disconnect` | Afmelden bij een nette afsluiting. |

U zou ze niet met de hand hoeven aan te roepen: de Runner-container doet dat. Ze staan hier zodat u uw eigen agent kunt bouwen als u een beperking hebt waar de onze niet in past.

## Problemen oplossen

:::details De Runner blijft op Nooit verbonden of Verbinding verbroken staan
- Controleer de containerlogs met `docker logs oneuptime-runner` op authenticatie- of netwerkfouten.
- Controleer dat de host uw OneUptime-URL bereikt, bijvoorbeeld met `curl`.
- Controleer dat het ID en de sleutel zonder spaties zijn gekopieerd, en dat `ONEUPTIME_URL` het adres is waarop u OneUptime opent.

**Nooit verbonden** betekent dat de Runner zich nooit heeft gemeld. **Verbinding verbroken** betekent dat hij dat wel deed, maar niet in de laatste 5 minuten.
:::

:::details Stappen mislukken met "No runbook agent picked up this step before the wait window expired."
De Runner van de stap pakte de taak niet op binnen zijn claim timeout. Controleer dat de Runner **Verbonden** is, dat **Voert Runbooks uit** voor hem aan staat en dat hij niet bezig is met een lange stap: hij voert één taak tegelijk uit, tenzij u `ONEUPTIME_RUNNER_CONCURRENCY` verhoogt. Een claim timeout korter dan het pollinginterval mislukt op dezelfde manier.
:::

:::details Stappen mislukken met "The runbook agent stopped responding while this step was running."
De Runner pakte de taak op en stopte toen met het verlengen van zijn lease: hij crashte, herstartte of verloor zijn netwerk. Controleer dat hij online is en controleer dan het doelsysteem voordat u het runbook opnieuw uitvoert.
:::

:::details De Runner logt "No capability is enabled"
Elke mogelijkheid staat uit voor deze Runner. Zet **Voert Runbooks uit** aan op de pagina van de Runner in OneUptime. Hij neemt de wijziging over bij zijn volgende heartbeat.
:::

:::details Een stap mislukt omdat zijn Runner een geheime variabele niet mag gebruiken
De stap noemt een geheime variabele die zijn Runner niet toestaat, dus de Runner kreeg haar niet en de stap werd niet uitgevoerd. De fout noemt het geheim en wat er moet veranderen. Voeg onder **Runbooks → Instellingen → Globale variabelen**, of onder **Instellingen → Variabelen** van het runbook, de Runner toe onder **Je Runners die het mogen gebruiken**, of zet **Globale Runners mogen het gebruiken** aan voor een stap op een globale Runner. Of kies een Runner die het geheim toestaat.
:::

:::details Een kubectl-stap mislukt omdat zijn Runner te oud is
De stap mislukte met "This kubectl step runs a script, and this Runner is too old to run one, so it was not run." Een Runner die ouder is dan kubectl-scripts, kan er geen uitvoeren. Een Kubernetes-stap die bij de upgrade in een kubectl-script is omgezet, draait er nog steeds op als de actie waarmee hij is geschreven, totdat zijn script of kubeconfig wordt gewijzigd. Werk de Runner bij, zoals [De agent bijwerken](#5-de-agent-bijwerken) laat zien, en voer het runbook dan opnieuw uit.
:::

## Volgende stappen

:::cards
- [Een runbook schrijven](/docs/runbooks/authoring): De stappen schrijven die op uw Runner lopen.
- [Runbook-variabelen](/docs/runbooks/variables): De waarden en geheimen die uw stappen gebruiken, en de Runners die ze krijgen.
- [Runbook-configuratie & veiligheid](/docs/runbooks/configuration): Limieten, machtigingen en beveiliging.
:::
