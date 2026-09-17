# Workflow-triggers

Een trigger is het eerste blok in een workflow — hij bepaalt wanneer de workflow draait. Elke workflow heeft precies één trigger. Je kiest uit vier soorten.

## Manual

Voer de workflow op afroep uit: klik op **Workflow uitvoeren** op de pagina **Bouwer**, vul de velden van de trigger in en bevestig met **Run Workflow Manually**. De trigger Manual neemt een JSON-payload aan die de rest van de workflow kan lezen.

Goed voor: automatiseringen met één klik waar je een knop voor wilt, zoals "roteer deze sleutel" of "stuur een testwaarschuwing".

**Uitvoer**: de JSON die je erin hebt geplakt, of een leeg object als je niets hebt geplakt.

## Schedule

Voer de workflow uit volgens een terugkerend schema, met een cron-expressie.

Goed voor: nachtelijk opruimen, elk uur synchroniseren, wekelijkse rapporten.

**Instelling**: een cron-expressie. Een paar veelgebruikte:

- `0 * * * *` — elk uur, op het hele uur.
- `*/5 * * * *` — elke 5 minuten.
- `0 9 * * 1` — elke maandag om 9:00 uur.

Is het systeem even niet beschikbaar, dan wordt de uitvoering opgepakt zodra het weer draait — over gemiste ticks bij korte storingen hoef je je geen zorgen te maken.

## Webhook

OneUptime maakt een unieke URL aan. Alles wat die URL aanroept, start de workflow. De headers, queryparameters en body van het verzoek worden meegegeven.

Goed voor: gegevens vanuit een andere tool binnenhalen in OneUptime — CI/CD-callbacks, waarschuwingen uit andere monitoring, aanmeldingen in je CRM.

**Uitvoer**:

- **Request Headers** — alle headers uit het inkomende verzoek.
- **Request Query Params** — de geparste querystring.
- **Request Body** — de geparste body (of de ruwe tekst als het geen JSON is).

De URL accepteert zowel `GET` als `POST`. De aanroeper krijgt meteen een korte bevestiging — de workflow zelf draait op de achtergrond.

Behandel de URL als een wachtwoord. Iedereen die hem heeft, kan je workflow starten.

## OneUptime-gebeurtenistriggers

Bijna alles in OneUptime — monitoren, incidenten, waarschuwingen, gepland onderhoud, statuspagina's, piketbeleid, teams — kan een workflow triggeren. Elk daarvan biedt drie gebeurtenissen:

- **On Create** — gaat af wanneer er een nieuwe wordt toegevoegd.
- **On Update** — gaat af wanneer er een wordt gewijzigd.
- **On Delete** — gaat af wanneer er een wordt verwijderd.

Zo bouw je "wanneer X gebeurt in OneUptime, doe Y" zonder in een lus te hoeven blijven controleren.

Het volledige record gaat door naar het volgende blok. De trigger **Incident → On Create** geeft bijvoorbeeld het nieuwe incident door, zodat het volgende blok de titel, beschrijving, ernst en elk ander veld kan uitlezen.

### Gebeurtenissen die teams het meest gebruiken

- **Incident** — reageer wanneer een incident wordt geopend, bijgewerkt (bevestigd, opgelost) of verwijderd.
- **Alert** — dezelfde drie, maar dan voor waarschuwingen.
- **Monitor** — reageer wanneer een monitor wordt toegevoegd, bewerkt of verwijderd.
- **Scheduled Maintenance** — kondig een onderhoudsvenster automatisch aan zodra het is ingepland.
- **Status Page Subscriber** — verwelkom iemand die zich op een statuspagina abonneert.
- **On-Call Duty Policy** — synchroniseer roosterwijzigingen met een ander roostersysteem.

Zoek in het paneel **Add Trigger** op naam om de juiste te vinden.

## Welke trigger moet ik gebruiken?

| Als je wilt…                                  | Kies                      |
| --------------------------------------------- | ------------------------- |
| Op een knop klikken om de workflow uit te voeren | **Manual**             |
| Draaien volgens een terugkerend schema        | **Schedule**              |
| Een ander systeem gegevens laten insturen     | **Webhook**               |
| Reageren op iets binnen OneUptime             | **OneUptime-gebeurtenis** |

Een workflow kan maar één trigger hebben. Heb je twee manieren nodig om dezelfde automatisering te starten, bouw de gedeelde logica dan in één workflow en roep die aan vanuit twee dunne "wrapper"-workflows met het component **Execute Workflow**.

## Waar je verder kunt lezen

- [Workflow-componenten](/docs/workflows/components) — de acties die je na de trigger toevoegt.
- [Workflow-variabelen](/docs/workflows/variables) — triggeruitvoer lezen vanuit latere blokken.
- [Workflow-uitvoeringen en logboeken](/docs/workflows/runs-and-logs) — bevestigen dat je trigger is afgegaan.
