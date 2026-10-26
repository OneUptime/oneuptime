# Een runbook uitvoeren

Elke run van een runbook is een **uitvoering**: een momentopname van de stappen van het runbook, op volgorde afgewerkt, met de status en uitvoer van elke stap vastgelegd. Deze pagina is voor wie reageert, uitvoeringen start en ze verder helpt: hoe een uitvoering start, wat de uitvoeringspagina toont en hoe u stappen voltooit, goedkeurt, overslaat en annuleert.

:::cards
- [Een uitvoering starten](#een-uitvoering-starten): Vanuit een incident, waarschuwing of evenement, of vanuit het runbook zelf.
- [De uitvoeringsweergave](#de-uitvoeringsweergave): Wat elke stap toont terwijl een uitvoering bezig is.
- [Stappen voltooien, goedkeuren en overslaan](#stappen-voltooien-goedkeuren-en-overslaan): Welke stap een beslissing aanneemt, en wanneer.
- [Problemen oplossen](#problemen-oplossen): Uitvoeringen die niet starten of niet eindigen.
:::

## Hoe een uitvoering verloopt

```mermaid title="De statussen van een runbook-uitvoering"
stateDiagram-v2
    state "Gepland" as Scheduled
    state "Actief" as Running
    state "Wacht op u" as WaitingForManualStep
    state "Voltooid" as Completed
    state "Mislukt" as Failed
    state "Geannuleerd" as Cancelled
    [*] --> Scheduled: uitvoering gestart
    Scheduled --> Running: een Worker<br/>pakt haar op
    Running --> WaitingForManualStep: Manual-stap<br/>of goedkeuring
    WaitingForManualStep --> Scheduled: voltooid,<br/>goedgekeurd of<br/>overgeslagen
    Running --> Completed: alle stappen klaar
    Running --> Failed: een stap mislukt
    Scheduled --> Cancelled: Uitvoering<br/>annuleren
    Running --> Cancelled: Uitvoering<br/>annuleren
    WaitingForManualStep --> Cancelled: Uitvoering<br/>annuleren
    Completed --> [*]
    Failed --> [*]
    Cancelled --> [*]
```

Een nieuwe uitvoering staat op **Gepland** tot een Worker haar oppakt en als **Actief** markeert. Ze pauzeert als **Wacht op u** bij een Manual-stap, of vóór een stap die goedkeuring nodig heeft, en gaat terug in de wachtrij zodra iemand handelt. Een uitvoering die op een persoon wacht, verloopt nooit. Ze eindigt als **Voltooid**, **Mislukt** of **Geannuleerd**.

## Een uitvoering starten

Een runbook-uitvoering ontstaat op vijf manieren:

1. **Automatisch via een regel**: een [runbook-regel](/docs/runbooks/rules) start haar wanneer een overeenkomend incident, overeenkomende waarschuwing of overeenkomend gepland onderhoudsevenement ontstaat. Ook een AI-regel kan er een starten; zie [AI SRE](/docs/ai/ai-sre).
2. **Handmatig vanuit een evenement**: klik op een incident, waarschuwing of gepland onderhoudsevenement op **Runbook uitvoeren**. De uitvoering hangt aan dat evenement.
3. **Handmatig vanaf de runbookpagina**: klik op de pagina **Overzicht** van een runbook op **Nu uitvoeren**. De uitvoering hangt aan geen enkel incident, geen waarschuwing en geen gepland onderhoudsevenement.
4. **Volgens een schema**: het schema van het runbook start haar op vaste tijden. Zie [Uitvoeren volgens een schema](/docs/runbooks/triggers#uitvoeren-volgens-een-schema).
5. **Vanuit een ander hulpmiddel**: een `POST` naar de webhook-URL van het runbook start haar, met de waarden die de aanroep verstuurt. Zie [De webhook aanroepen](/docs/runbooks/triggers#de-webhook-aanroepen).

Zo start u er een met de hand:

:::tabs
@tab Vanuit een evenement
1. Open het incident, de waarschuwing of het geplande onderhoudsevenement en ga naar de pagina **Runbooks** ervan.
2. Klik op **Runbook uitvoeren**. Het dialoogvenster **Een runbook uitvoeren** toont de runbooks van het project die zijn ingeschakeld.
3. Klik naast het runbook op **Uitvoeren**. De uitvoering verschijnt in de lijst van het evenement: klik op **Bekijken** om haar te openen.
@tab Vanuit het runbook
1. Open het runbook via **Runbooks**.
2. Klik op het **Overzicht** ervan op **Nu uitvoeren**.
3. De uitvoeringspagina opent.
:::

Een uitvoering starten vereist Project Owner, Project Admin, Project Member, Runbook Admin of Runbook Member, of de machtiging **Create Runbook Execution**. Runbook Viewer en Viewer zien **Nu uitvoeren** vergrendeld, met de reden. Zie [Machtigingen](/docs/runbooks/configuration#machtigingen).

## De uitvoeringsweergave

Open een uitvoering om de checklist te zien. Bovenaan de pagina staan de **Status** van de uitvoering, de **Voortgang** (voltooide stappen van het totaal), **Gestart** (wanneer ze begon) en **Geactiveerd door** (wat haar startte). Elke stap toont:

- **Statuslabel** — In behandeling, Actief, Wacht op u, Wacht op goedkeuring, Klaar, Overgeslagen, Mislukt of Geannuleerd.
- **Titel en beschrijving** — bij de start van de uitvoering uit het runbook gekopieerd.
- **Output** (inklapbaar) — stdout, returnwaarden, HTTP-antwoorden of het antwoord van de AI.
- **Foutmelding** als de stap mislukte.
- Op de stap waarop de uitvoering wacht: **Markeer als voltooid** (een Manual-stap) of **Goedkeuren en uitvoeren** (een stap met **Goedkeuring vereisen**, die nog niet gelopen heeft), en **Overslaan**.
- **Goedgekeurd door** op een stap die op goedkeuring heeft gewacht, zodra hij gelopen heeft.
- Terwijl de uitvoering pauzeert, **Overslaan** op latere geautomatiseerde stappen die geen goedkeuring vereisen.

Zolang de uitvoering bezig is, ververst de pagina zichzelf elke 30 seconden. Klik op **Vernieuwen** om de nieuwste stand meteen te zien.

## Stappen voltooien, goedkeuren en overslaan

Alleen de stap waarop de uitvoering wacht, kan als voltooid worden gemarkeerd, worden goedgekeurd of worden overgeslagen om de uitvoering te laten doorgaan. Een Manual-stap of een stap met **Goedkeuring vereisen** kan niet worden afgevinkt of overgeslagen voordat de uitvoering hem bereikt: zijn taak is de uitvoering te stoppen, dus hij neemt pas een beslissing aan wanneer de uitvoering er is. Een stap met **Goedkeuring vereisen** wacht voordat hij loopt, dus lees eerst wat de stappen ervoor hebben gevonden: **Goedkeuren en uitvoeren** voert hem uit, **Overslaan** houdt hem tegen, en hoe dan ook gaat de uitvoering verder. Een uitvoering die begon voordat goedkeuringen naar de stap verhuisden die ze bewaken, wacht in plaats daarvan na zo'n stap, zodra die gelopen heeft: **Goedkeuren en doorgaan** laat die uitvoering verdergaan.

Terwijl de uitvoering pauzeert, kunt u ook een latere geautomatiseerde stap overslaan die geen goedkeuring vereist, zodat die niet loopt wanneer de uitvoering verdergaat. De uitvoering blijft gepauzeerd op de stap die op u wacht. Overslaan kan niet terwijl er stappen lopen: wacht tot de uitvoering pauzeert, of annuleer haar. Elke stap legt vast wie hem voltooide of oversloeg.

| De stap | Voltooien of goedkeuren | Overslaan |
| --- | --- | --- |
| Die waarop de uitvoering wacht | Ja | Ja |
| Een latere geautomatiseerde stap, zonder **Goedkeuring vereisen** | Nee | Ja, terwijl de uitvoering pauzeert |
| Een latere Manual-stap, of een met **Goedkeuring vereisen** | Nee | Nee |
| Elke stap, terwijl er stappen lopen | Nee | Nee |

Voltooien, goedkeuren, overslaan en annuleren vereisen dezelfde rollen als een uitvoering starten, of de machtiging **Edit Runbook Execution**.

## Handmatige en geautomatiseerde stappen afwisselen

Het klassieke verloop:

| # | Stap | Wat er gebeurt |
| --- | --- | --- |
| 1 | Bash: systeemtoestand vastleggen | Loopt op zijn Runner zodra de uitvoering start. |
| 2 | Manual: "Informeer klanten via de banner op de statuspagina." | De uitvoering pauzeert tot iemand op **Markeer als voltooid** klikt. |
| 3 | HTTP request: de DBA oproepen via PagerDuty | Loopt op de Worker. |
| 4 | Manual: "Bevestig dat de secundaire database nu primair is." | De uitvoering pauzeert opnieuw. |
| 5 | HTTP request: het sein veilig naar een Slack-webhook posten | Loopt, en de uitvoering staat op **Voltooid**. |

De stappen 2 en 4 pauzeren de uitvoering tot iemand ze afvinkt. De stappen 1, 3 en 5 lopen automatisch. De hele run is één uitvoering, één tijdlijn en één bron van waarheid.

## Een uitvoering annuleren

Klik op de uitvoeringspagina op **Uitvoering annuleren**. De status wordt `Cancelled` en er start geen latere stap meer. Een stap die al loopt, wordt niet onderbroken, maar het resultaat ervan wordt niet vastgelegd: de stap blijft `Cancelled`. Taken die nog op een Runner wachten, worden geannuleerd; een Runner die al een script uitvoert, maakt het af, maar het resultaat wordt niet geaccepteerd.

## Uitvoerlimieten

De uitvoer per stap is beperkt tot **50 KB**, zodat een op hol geslagen script de database niet opblaast. Langere uitvoer wordt afgekapt met een markering. Hebt u grotere artefacten nodig, schrijf ze dan vanuit het script naar objectopslag of een logsysteem en zet de URL in de uitvoer.

## Een runbook opnieuw uitvoeren

Een uitvoering is een eenmalig, onveranderlijk record. Klik om het runbook opnieuw uit te voeren op **Opnieuw uitvoeren** bij een afgeronde uitvoering, of op **Nu uitvoeren** bij het runbook. Beide maken een nieuwe uitvoering met de huidige stappen van het runbook, aan geen enkel evenement gekoppeld. Gebruik **Runbook uitvoeren** op de pagina **Runbooks** van het incident om het opnieuw op een incident uit te voeren. De oorspronkelijke uitvoering blijft intact voor het audittrail.

## Eerdere uitvoeringen vinden

| Waar | Wat het toont |
| --- | --- |
| De **Logboeken → Uitvoeringen** van een runbook | Elke uitvoering van dat runbook, met filters op status en startdatum, en een kolom **Geactiveerd door**. |
| **Runbooks → Uitvoeringen** | Elke uitvoering van elk runbook in het project. |
| De pagina **Runbooks** van een incident, waarschuwing of evenement | De gekoppelde uitvoeringen. Het overzicht van het evenement toont ze ook, zodra er een is. |

## Problemen oplossen

:::details Run Now is vergrendeld
Uw rol leest runbooks maar voert ze niet uit: de knop zegt "Je hebt geen toestemming om in dit project runbook-uitvoeringen te starten." Vraag om Runbook Member, of om de machtiging **Create Runbook Execution**.
:::

:::details Een uitvoering starten mislukt met "Runbook is disabled" of "Runbook has no steps to run"
De schakelaar **Dit runbook uitvoeren** van het runbook staat uit, op de pagina **Instellingen** ervan, of het heeft geen opgeslagen stappen. Zet de schakelaar aan, of voeg stappen toe en klik op **Stappen opslaan**. Het **Overzicht** zegt welke, met **Runbook inschakelen** of **Stappen toevoegen**.
:::

:::details Een stap is mislukt omdat er een Runner ontbreekt
De melding luidt bijvoorbeeld "This Bash step has no Runner. Bash steps run on a Runner of your own, inside your network: global Runners run JavaScript steps only. Pick one of your Runners for the step, or make one the project's default Runner under Runbooks → Runners." De stap is opgeslagen zonder **Runner**, en het project heeft geen [standaard-Runner](/docs/runbooks/agents#de-standaard-runner-van-het-project). Een JavaScript-stap heeft alleen een eigen Runner nodig als geen [globale Runner](/docs/runbooks/agents#globale-runners) hem kan uitvoeren. Open de **Stappen** van het runbook, kies de Runner van de stap onder **Meer velden**, klik op **Stappen opslaan** en voer het runbook opnieuw uit.
:::

:::details Een stap is mislukt omdat hij variabelen noemt die hij niet kan gebruiken
De melding begint met "This step names variables it cannot use, so it was not run:" en zegt per variabele wat er mis is en waar u het oplost: er is geen variabele met die naam, het geheim heeft geen waarde, of de Runner van de stap mag het niet gebruiken. Maak de variabele aan of verbeter haar naam in de stap, of laat de Runner het geheim gebruiken, en voer het runbook dan opnieuw uit. Zie [Runbook-variabelen](/docs/runbooks/variables).
:::

:::details Een stap is mislukt omdat geen runbook-agent hem oppakte
De melding luidt "No runbook agent picked up this step before the wait window expired." De Runner van de stap pakte de taak niet op binnen zijn claim timeout. Controleer onder **Runbooks → Runbook-agenten** of de Runner **Verbonden** is en of **Voert Runbooks uit** aan staat. Zie [Runbook-agenten](/docs/runbooks/agents#problemen-oplossen). Een stap op een globale Runner meldt in plaats daarvan "No global Runner picked up this step before the wait window expired.": voer het runbook opnieuw uit, verhoog de claim timeout van de stap, of kies een van uw eigen Runners.
:::

:::details De uitvoering wacht al uren
Een uitvoering die op een persoon wacht, verloopt nooit. Open haar en handel op de stap met **Wacht op u** of **Wacht op goedkeuring**, of klik op **Uitvoering annuleren**.
:::

:::details Een stap meldt dat hij mogelijk deels is uitgevoerd
De OneUptime Worker die de stap uitvoerde, is herstart of reageerde niet meer, en de uitvoering werd als mislukt gemarkeerd in plaats van actief te blijven. Controleer het doelsysteem voordat u het runbook opnieuw uitvoert.
:::

## Volgende stappen

:::cards
- [Een runbook schrijven](/docs/runbooks/authoring): Manual-stappen en goedkeuringen toevoegen waar een persoon moet beslissen.
- [Runbook-regels](/docs/runbooks/rules): Uitvoeringen automatisch starten bij nieuwe incidenten.
- [Runbook-agenten](/docs/runbooks/agents): De Runners online houden die uw stappen nodig hebben.
:::
