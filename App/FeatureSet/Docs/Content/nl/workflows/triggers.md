# Triggers

Een trigger is het eerste blok in een workflow — het bepaalt wanneer de workflow draait. Elke workflow heeft precies één trigger. Je kiest uit vier soorten.

## Manual

Voer de workflow op aanvraag uit door op **Run Manually** te klikken op de workflowpagina. Je kunt een JSON-payload plakken die de rest van de workflow kan lezen.

Goed voor: éénklik-automatiseringen waar je een knop voor wilt, zoals "rotate this key" of "send a test alert".

**Output**: de JSON die je hebt geplakt, of een leeg object als je niets hebt geplakt.

## Schedule

Voer de workflow uit op een herhalend schema met een cron-expressie.

Goed voor: nachtelijke opruiming, uurlijkse synchronisatie, wekelijkse rapporten.

**Setting**: een cron-expressie. Een paar veelgebruikte:

- `0 * * * *` — elk uur, op het hele uur.
- `*/5 * * * *` — elke 5 minuten.
- `0 9 * * 1` — elke maandag om 9:00.

Als het systeem kort niet beschikbaar is, wordt de run opgepakt zodra het herstelt — je hoeft je geen zorgen te maken over gemiste ticks bij korte onderbrekingen.

## Webhook

OneUptime maakt een unieke URL aan. Alles wat die URL aanroept, start de workflow. De headers, query-parameters en body van het verzoek worden meegegeven.

Goed voor: data naar OneUptime ontvangen vanuit een andere tool — CI/CD-callbacks, alerts van andere monitoring, signups in je CRM.

**Output**:

- **Request Headers** — alle headers van het inkomende verzoek.
- **Request Query Params** — de geparste query string.
- **Request Body** — de geparste body (of de ruwe tekst als het geen JSON is).

De URL accepteert zowel `GET` als `POST`. De aanroeper krijgt een snelle bevestiging — de workflow zelf draait op de achtergrond.

Behandel de URL als een wachtwoord. Iedereen die hem heeft kan je workflow starten.

## OneUptime event-triggers

Bijna alles in OneUptime — monitors, incidenten, alerts, scheduled maintenance, statuspagina's, oncall-policies, teams — kan een workflow triggeren. Elk biedt drie events:

- **On Create** — gaat af wanneer er een nieuwe wordt toegevoegd.
- **On Update** — gaat af wanneer er een wordt gewijzigd.
- **On Delete** — gaat af wanneer er een wordt verwijderd.

Zo bouw je "wanneer X gebeurt in OneUptime, doe Y" zonder dat je in een lus dingen hoeft te controleren.

De volledige record wordt aan het volgende blok doorgegeven. Bijvoorbeeld: de trigger **Incident → On Create** geeft het nieuwe incident door, zodat het volgende blok de titel, beschrijving, severity en elk ander veld kan lezen.

### Events die teams het meest gebruiken

- **Incident** — reageer wanneer een incident wordt geopend, gewijzigd (acknowledged, resolved) of verwijderd.
- **Alert** — dezelfde drie voor alerts.
- **Monitor** — reageer wanneer een monitor wordt toegevoegd, bewerkt of verwijderd.
- **Scheduled Maintenance** — kondig automatisch een onderhoudsvenster aan zodra het is gepland.
- **Status Page Subscriber** — verwelkom iemand die zich abonneert op een statuspagina.
- **On-Call Duty Policy** — synchroniseer wijzigingen in het rooster met een ander roostersysteem.

Zoek in het trigger-palet op naam om de gewenste te vinden.

## Welke trigger moet ik gebruiken?

| Als je wilt... | Kies |
| --- | --- |
| Op een knop drukken om de workflow te draaien | **Manual** |
| Op een herhalend schema draaien | **Schedule** |
| Een ander systeem data laten doorgeven | **Webhook** |
| Reageren op iets binnen OneUptime | **OneUptime event** |

Een workflow kan maar één trigger hebben. Als je dezelfde automatisering op twee manieren wilt starten, bouw dan de gedeelde logica in één workflow en roep die aan vanuit twee dunne "wrapper"-workflows met de **Execute Workflow**-component.

## Waar verder lezen

- [Componenten](/docs/workflows/components) — de acties die je na de trigger toevoegt.
- [Variabelen](/docs/workflows/variables) — output van de trigger lezen vanuit latere blokken.
- [Uitvoeringen en logboeken](/docs/workflows/runs-and-logs) — bevestigen dat je trigger is afgegaan.
