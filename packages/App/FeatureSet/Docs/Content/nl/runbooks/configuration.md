# Runbook-configuratie & veiligheid

Dit is het naslagwerk voor beheerders en securityreviewers: waar elk soort stap loopt, aan welke limieten en time-outs een stap gebonden is, wie wat mag en hoe runbooks zijn beveiligd.

:::cards
- [Waar elk staptype loopt](#waar-elk-staptype-loopt): De Worker, een Runner of een persoon.
- [Uitvoerlimieten en time-outs](#uitvoerlimieten-en-time-outs): Elke limiet waaraan een stap gebonden is.
- [Machtigingen](#machtigingen): Gedetailleerde machtigingen, de drie runbook-rollen en welke runbooks een rol bereikt.
- [Beveiligingsnotities](#beveiligingsnotities): Sandboxing, netwerktoegang en authenticatie van Runners.
:::

## Waar elk staptype loopt

```mermaid title="Welke stappen waar lopen"
flowchart TB
    subgraph ou["OneUptime"]
        worker["Worker"]
        onworker["HTTP-verzoekstappen<br/>AI-stappen"]
    end
    subgraph yours["Uw infrastructuur"]
        runner["Runner"]
        onrunner["JavaScript- en<br/>Bash-stappen<br/>SSH- en kubectl-stappen"]
    end
    person["Een persoon"]
    worker --> onworker
    worker -->|"Manual-<br/>stappen en<br/>goedkeuringen"| person
    worker --->|"zet een taak<br/>in de wachtrij<br/>voor de Runner<br/>van de stap"| runner
    runner --> onrunner
```

| Staptype | Loopt op | Hoe |
| --- | --- | --- |
| Manual | Een persoon | De uitvoering wacht tot iemand de stap voltooit of overslaat. |
| JavaScript | Een Runner | In een `isolated-vm`-sandbox. |
| HTTP request | De OneUptime Worker | Een uitgaande HTTP-aanroep. |
| Bash | Een Runner | `bash -c <script>`. |
| SSH | Een Runner | Een SSH-verbinding die het script met bash op de machine uitvoert, aangemeld met een geheime [variabele](/docs/runbooks/variables). |
| kubectl | Een Runner | `bash -c <script>`, met `KUBECONFIG` dat naar het cluster wijst. |
| AI | De OneUptime Worker | Een aanroep van de LLM-provider van het project. |

## Hoe Runner-stappen worden verstuurd

JavaScript-, Bash-, SSH- en kubectl-stappen **lopen nooit op de OneUptime Worker**. Ze worden als taken verstuurd naar een bepaalde [runbook-agent](/docs/runbooks/agents): een klein proces dat u op een host in uw eigen infrastructuur installeert. Een stap die er geen kiest, gaat naar de [standaard-Runner van het project](/docs/runbooks/agents#de-standaard-runner-van-het-project), als het er een heeft; anders gaat een JavaScript-stap naar de [globale Runners](/docs/runbooks/agents#globale-runners) die OneUptime voor elk project draait.

Het verzendmodel:

1. Wie de runbook-stap schrijft, kiest bij het schrijven een Runner uit de vervolgkeuzelijst.
2. Wanneer de stap loopt, voegt de Worker een rij toe aan `RunnerJob` met `targetAgentId` gelijk aan het ID van die Runner, of aan dat van de standaard-Runner van het project voor een stap die er geen koos, en status `Pending`. Een JavaScript-stap die er geen koos, krijgt in een project zonder standaard-Runner dat globale Runners gebruikt in plaats daarvan `runsOnGlobalRunner`.
3. Precies die Runner (en alleen die) pakt de taak atomair op, voert hem lokaal uit — Bash en kubectl via `bash -c <script>`, JavaScript in een `isolated-vm`-sandbox, SSH via een verbinding met de machine, elk met de variabelen die het noemt ingevuld — en meldt het resultaat terug. Elke globale Runner mag een taak met `runsOnGlobalRunner` oppakken.
4. De Worker zet het runbook voort met het resultaat.

De omgevingsvlag `RUNBOOK_BASH_ENABLED` bestaat niet meer. Of deze stappen in een installatie werken, hangt er alleen van af of het project een verbonden Runner heeft met **Voert Runbooks uit** aan. Een JavaScript-stap werkt ook op een globale Runner.

## Uitvoerlimieten en time-outs

| Limiet | Waarde | Geldt voor |
| --- | --- | --- |
| Uitvoer per stap | **50 KB**. Langere uitvoer wordt afgekapt met een markering. | Elke geautomatiseerde stap |
| Execution timeout | Standaard **30 seconden** | JavaScript-, Bash-, SSH- en kubectl-stappen |
| Request timeout | Standaard **30 seconden** | HTTP-verzoekstappen |
| Claim timeout | Standaard **2 minuten**: hoe lang de Worker wacht tot de gekozen Runner de taak oppakt voordat hij die laat mislukken | JavaScript-, Bash-, SSH- en kubectl-stappen |
| Bereik van time-outs | **1 seconde tot 1 uur** | Elke time-out |
| Wachten op een persoon | Geen limiet | Manual-stappen en goedkeuringen |

Stel de time-outs per stap in onder **Meer velden** van de stap op de pagina **Stappen** van het runbook; laat een veld leeg om de standaard te houden. Een waarde buiten het bereik wordt bij het uitvoeren van de stap begrensd, zodat een verkeerd getypte configuratie de time-out niet kan uitschakelen en geen Worker-slot eindeloos kan bezetten.

## Machtigingen

Runbook-machtigingen staan in de machtigingsgroep `Runbook`:

- `CreateRunbook`, `EditRunbook`, `DeleteRunbook`, `ReadRunbook` — runbook-sjablonen beheren.
- `CreateRunbookExecution`, `EditRunbookExecution`, `DeleteRunbookExecution`, `ReadRunbookExecution` — uitvoeringen starten, afvinken, verwijderen en lezen.
- `CreateRunbookRule`, `EditRunbookRule`, `DeleteRunbookRule`, `ReadRunbookRule` — regels voor automatisch starten beheren.
- `CreateRunner`, `EditRunner`, `DeleteRunner`, `ReadRunner` — Runners beheren die stappen in uw eigen infrastructuur uitvoeren. (Vóór de hernoeming naar Runner heetten ze `*RunbookAgent`; bestaande toekenningen zijn gemigreerd, dus er hoeft niets opnieuw te worden toegewezen.)
- `RunbookAdmin`, `RunbookMember`, `RunbookViewer` (rollen) — `RunbookAdmin` bouwt runbooks, hun regels en de Runners waarop ze lopen, en voert ze uit. `RunbookMember` opent runbooks en hun uitvoeringen en voert ze uit — start een uitvoering, voltooit of slaat stappen over en annuleert haar — maar maakt, wijzigt en verwijdert geen runbook of Runner. `RunbookViewer` leest runbooks en hun uitvoeringen en voert niets uit. `RunbookAdmin` bundelt alle gedetailleerde machtigingen hierboven.

Een rol voert de runbooks uit die binnen zijn bereik vallen. Een toekenning van `RunbookMember`, `RunbookAdmin` of `ProjectMember` die tot bepaalde labels is beperkt, start en bevordert uitvoeringen van de runbooks met die labels, een toekenning beperkt tot **Owned** die van de runbooks die zijn team bezit, en de blokkering van een label door een team neemt die runbooks weg. `CreateRunbookExecution` en `EditRunbookExecution` gaan over uitvoeringen, die geen labels dragen, en bereiken dus elk runbook in het project. Het goedkeuren van een herstelvoorstel dat een runbook start, wordt op dezelfde manier gecontroleerd.

Het schema en de webhook van een runbook starten uitvoeringen zonder dat er iemand bij is, dus een van beide instellen vraagt toestemming om het runbook te bewerken en uit te voeren, en dat geldt ook voor het zien van de webhook-URL. Ze uitzetten vraagt alleen toestemming om het te bewerken. Zie [Runbook-triggers](/docs/runbooks/triggers#wie-triggers-mag-instellen).

Runbookvariabelen vallen buiten `RunbookAdmin`, dat ze alleen leest, om ze te kiezen in de stappen die het schrijft. Variabelen beheren vereist `ProjectOwner` of `ProjectAdmin`, of de machtigingen `CreateRunbookSecret`, `EditRunbookSecret`, `DeleteRunbookSecret` en `ReadRunbookSecret`: de machtigingen van de runbookgeheimen, die hun namen hielden toen geheimen variabelen werden. Zie [Runbook-variabelen](/docs/runbooks/variables).

Ook de eigenaars- en labelregels onder **Runbooks → Instellingen** vallen buiten `RunbookAdmin`. Ze beheren vereist `ProjectOwner` of `ProjectAdmin`, of de machtigingen `CreateRunbookOwnerRule` en `CreateRunbookLabelRule` met hun tegenhangers voor bewerken, verwijderen en lezen.

Hoe rollen en gedetailleerde machtigingen samengaan, leest u in [Gebruikers, teams en machtigingen](/docs/permissions/index).

## Wachtrij & worker

Runbook-uitvoeringen lopen op de BullMQ-wachtrij `Runbook`. Elk Worker-proces voert maximaal 25 uitvoeringen tegelijk uit; het aantal ligt vast in de code, niet in een omgevingsvariabele.

Wanneer een handmatige stap via de API wordt afgevinkt, wordt de uitvoering opnieuw in de wachtrij gezet om bij de volgende stap verder te gaan. Ze wacht als `Scheduled` tot een Worker haar weer oppakt, en een uitvoering in de wachtrij mislukt nooit door het wachten.

## Beveiligingsnotities

- **JavaScript, Bash, SSH en kubectl** lopen op een Runner-host die u beheert, niet op de OneUptime Worker. JavaScript loopt in een eigen `isolated-vm`-isolaat met 128 MB geheugen en zonder toegang tot het bestandssysteem of de processen van de Runner; het kan HTTP-verzoeken doen met `axios`, maar verzoeken naar privénetwerken en loopback- en link-local-adressen worden geweigerd. Bash loopt via `bash -c`, met een time-out die op de Runner wordt afgedwongen. Een JavaScript-stap die er geen kiest, loopt op de standaard-Runner van het project of, als er geen is ingesteld, op een globale Runner.
- **SSH-stappen** melden zich alleen aan wanneer de machine een van de hostsleutels laat zien die de stap opgeeft. Een stap die er geen opgeeft, accepteert elke sleutel, en de uitvoer noemt de sleutel die de machine liet zien, om in de stap op te geven.
- **HTTP-stappen** gebruiken een ruime statusvalidatie, zodat een 4xx- of 5xx-antwoord als mislukte stap wordt vastgelegd in plaats van een uitzondering te gooien, en de vastgelegde uitvoer weerspiegelt wat de andere kant echt teruggaf. Doorverwijzingen worden niet gevolgd. De Worker roept nooit loopback- of link-local-adressen aan, zoals een metadata-endpoint van een cloud; in OneUptime Cloud weigert hij ook privénetwerkadressen, en een zelf gehoste OneUptime weigert ze met `DATA_SOURCE_BLOCK_PRIVATE_ADDRESSES=true`.
- **AI-stappen** zien nooit privénotities van incidenten of berichten uit Slack en Microsoft Teams, en de uitvoer van eerdere stappen wordt doorzocht op geheimen, die worden afgeschermd voordat ze het model bereiken. Ingesloten afbeeldingen en lange gecodeerde gegevens blijven buiten de prompt. Zie [AI](/docs/runbooks/authoring#ai).
- **Globale Runners** voeren alleen JavaScript-stappen uit, elk in een sandbox die voor die stap wordt gemaakt en daarna weggegooid, die alleen openbare internetadressen bereikt, hooguit 5 minuten lang en met hooguit drie stappen van één project tegelijk. Ze krijgen alleen de geheime variabelen van het eigen project van de stap die voor globale Runners zijn ingeschakeld; de meegeleverde heeft een eigen sleutel en verder niets van de server. Zie [Globale Runners](/docs/runbooks/agents#globale-runners).
- **Runner-authenticatie** gebeurt met een ID en geheime sleutel, als omgevingsvariabelen op de Runner-container ingesteld. Aan de serverkant komt de geldende identiteit van de Runner uit de databaserij die hoort bij het getoonde ID en de sleutel: een client kan zich zelfs met een gelekte sleutel niet als een andere Runner voordoen.
- **Geheime variabelen** worden versleuteld opgeslagen, nooit door de API teruggegeven en alleen overhandigd aan de Runners die ze vermelden, wanneer die een stap oppakken die ze noemt. Een geheime variabele wordt ook overhandigd aan een globale Runner die een stap van het eigen project van de variabele oppakt, als de variabele globale Runners haar laat gebruiken. De Runner vervangt elk geheim dat een stap kreeg door `[REDACTED]` in wat de stap afdrukt, en OneUptime doet dat nog eens voordat het de uitvoer opslaat. Een HTTP-verzoekstap, die OneUptime zelf verstuurt, krijgt elk geheim van zijn eigen project dat hij noemt, en verbergt ze in het antwoord dat hij vastlegt.

## Databasetabellen

| Tabel | Wat erin staat |
| --- | --- |
| `Runbook` | Het sjabloon: naam, slug, beschrijving, `isEnabled`, labels en de stappen als JSON. |
| `RunbookExecution` | Eén rij per uitvoering, met de optionele vreemde sleutels `incidentId`, `alertId` en `scheduledMaintenanceId` en een JSON-array `stepExecutions` die de stappen en de toestand van elke stap vastlegt. |
| `RunbookRule` | Regels voor automatisch starten, met een onderscheidingsveld `triggerEntityType` (Incident, Alert, ScheduledMaintenance), een veel-op-veel-relatie met de te starten runbooks, en waarop ze matchen: een JSON-kolom `criteria` (de voorwaarden) plus veel-op-veel-koppelingen met monitoren, incidenternsten, waarschuwingsernsten, labels en monitorlabels, en patronen voor titel, beschrijving, monitornaam en monitorbeschrijving. |
| `Runner` | Eén rij per geïnstalleerde Runner: naam, geheime sleutel, `lastAlive`, `connectionStatus`, hostinformatie en mogelijkheden. Bij een globale Runner is `isGlobalRunner` ingesteld en hoort hij bij geen project; bij de standaard-Runner van het project is `isProjectDefault` ingesteld. |
| `RunnerJob` | Eén rij per stap die naar een Runner is verstuurd: `targetAgentId` (de Runner die de schrijver van de stap koos), staptype, script of payload, status (`Pending` → `Claimed` → `Running` → `Succeeded`, `Failed`, `TimedOut` of `Cancelled`), claimdeadline, lease, uitvoer en exitcode. `runsOnGlobalRunner` markeert een stap die elke globale Runner mag oppakken. |
| `RunbookVariable` | Runbookvariabelen: de globale van het project en de eigen van een runbook, die het noemen in `runbookId`; de waarde van een geheim versleuteld, en de Runners die een geheim mogen ontvangen. |

## Tips voor beheer

- **Zorg dat de Runner die u bij een stap kiest gezond is.** Hebt u redundantie nodig, draai dan een tweede Runner en verdeel de stappen over beide, of houd een reserve-runbook bij dat op de andere Runner is gericht.
- **Leg URL's vast, geen blobs.** Maakt een stap meer dan een paar KB uitvoer, schrijf die dan naar objectopslag of uw loggingstack en geef de URL terug.
- **Idempotentie telt.** Een HTTP-verzoek- of AI-stap loopt opnieuw als de Worker midden in de stap herstart en de uitvoering wordt hervat. Een stap op een Runner wordt per uitvoering hooguit één keer verstuurd, maar een script kan vóór een fout deels zijn gelopen, en misschien voert u het runbook opnieuw uit. Ontwerp stappen zo dat ze veilig opnieuw kunnen lopen.

## Volgende stappen

:::cards
- [Runbook-agenten](/docs/runbooks/agents): Runners installeren, beheren en problemen oplossen.
- [Runbook-variabelen](/docs/runbooks/variables): De waarden en geheimen die stappen gebruiken, en de Runners die ze ontvangen.
- [Gebruikers, teams en machtigingen](/docs/permissions/index): Hoe rollen, labels en teams bepalen wie wat uitvoert.
:::
