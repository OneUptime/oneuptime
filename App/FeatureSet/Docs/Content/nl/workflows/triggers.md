# Workflow-triggers

Een trigger is het eerste blok in een workflow — het bepaalt wanneer de workflow draait. Elke workflow heeft precies één trigger. Je kiest uit vier soorten.

## Manual

Voer de workflow op aanvraag uit door op **Workflow uitvoeren** te klikken op de pagina **Bouwer**, de velden van de trigger in te vullen, en te bevestigen met **Run Workflow Manually**. De trigger Manual neemt een JSON-payload aan die de rest van de workflow kan lezen.

Goed voor: automatiseringen met één klik waar je een knop voor wilt, zoals "roteer deze sleutel" of "stuur een testwaarschuwing."

**Uitvoer**: de JSON die je hebt geplakt, of een leeg object als je dat niet deed.

## Schedule

Voer de workflow uit op een herhalend schema met een cron-expressie.

Goed voor: nachtelijke opschoning, uursynchronisatie, wekelijkse rapporten.

**Instelling**: een cron-expressie. Een paar veelgebruikte:

- `0 * * * *` — elk uur, op het hele uur.
- `*/5 * * * *` — elke 5 minuten.
- `0 9 * * 1` — elke maandag om 9:00 uur.

Als het systeem kort niet beschikbaar is, wordt de run opgepikt zodra het herstelt — je hoeft je geen zorgen te maken over gemiste ticks bij korte storingen.

## Webhook

OneUptime maakt een unieke URL aan. Alles wat die URL raakt, start de workflow. De headers, queryparameters en body van het verzoek worden meegegeven.

Goed voor: gegevens naar OneUptime laten binnenkomen vanuit een andere tool — CI/CD-callbacks, waarschuwingen van andere monitoring, aanmeldingen in je CRM.

**Uitvoer**:

- **Request Headers** — alle headers van het inkomende verzoek.
- **Request Query Params** — de geparste queryreeks.
- **Request Body** — de geparste body (of de ruwe tekst als het geen JSON is).

De URL accepteert zowel `GET` als `POST`. De aanroeper krijgt een snelle bevestiging — de workflow zelf draait op de achtergrond.

Behandel de URL als een wachtwoord. Iedereen die hem heeft kan je workflow starten.

## OneUptime-gebeurtenistriggers

Bijna alles in OneUptime — monitors, incidenten, waarschuwingen, geplande onderhoud, statuspagina's, piketbeleid, teams — kan een workflow triggeren. Elk biedt drie gebeurtenissen:

- **On Create** — treedt op wanneer er een nieuwe wordt toegevoegd.
- **On Update** — treedt op wanneer er een wordt gewijzigd.
- **On Delete** — treedt op wanneer er een wordt verwijderd.

Zo bouw je "wanneer X gebeurt in OneUptime, doe Y" zonder dingen in een lus te hoeven controleren.

Het volledige record wordt doorgegeven aan het volgende blok. De trigger **Incident → On Create** geeft bijvoorbeeld het nieuwe incident door, zodat het volgende blok de titel, beschrijving, ernst en elk ander veld kan lezen.

### Gebeurtenissen die teams het meest gebruiken

- **Incident** — reageer wanneer een incident wordt geopend, bijgewerkt (bevestigd, opgelost), of verwijderd.
- **Alert** — dezelfde drie voor waarschuwingen.
- **Monitor** — reageer wanneer een monitor wordt toegevoegd, bewerkt of verwijderd.
- **Scheduled Maintenance** — kondig een onderhoudsvenster automatisch aan zodra het wordt gepland.
- **Status Page Subscriber** — heet iemand welkom die zich abonneert op een statuspagina.
- **On-Call Duty Policy** — synchroniseer schemawijzigingen met een ander roosterssysteem.

Doorzoek het paneel **Add Trigger** op naam om de gewenste te vinden.

## Welke trigger moet ik gebruiken?

| Als je wilt…                                | Kies                |
| -------------------------------------------- | -------------------- |
| Op een knop klikken om de workflow te draaien | **Manual**          |
| Draaien op een herhalend schema              | **Schedule**         |
| Een ander systeem gegevens laten pushen      | **Webhook**          |
| Reageren op iets binnen OneUptime            | **OneUptime-gebeurtenis** |

Een workflow kan maar één trigger hebben. Als je twee manieren nodig hebt om dezelfde automatisering te starten, bouw dan de gedeelde logica in één workflow en roep die aan vanuit twee dunne "wrapper"-workflows met het component **Execute Workflow**.

## Waar je verder kunt lezen

- [Workflow-componenten](/docs/workflows/components) — de acties die je na de trigger toevoegt.
- [Workflow-variabelen](/docs/workflows/variables) — triggeruitvoer lezen vanuit latere blokken.
- [Workflow-uitvoeringen en logboeken](/docs/workflows/runs-and-logs) — bevestigen dat je trigger is afgegaan.
