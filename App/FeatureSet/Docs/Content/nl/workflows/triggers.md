# Workflow-triggers

Een trigger is de startnode van een workflow. Hij heeft geen input-poort — hier begint de uitvoering. OneUptime ondersteunt vier families van triggers; elke workflow gebruikt er precies één.

## Handmatig

Voer een workflow op aanvraag uit door op **Run Manually** te klikken op de workflow-pagina. Je kunt een optionele JSON-payload plakken die de workflow kan lezen als `{{Manual.JSON}}`.

Gebruik dit wanneer je een knop wilt die een stukje automatisering in gang zet — een een-kliks "rotate the on-call key"- of "rebuild the search index"-workflow waarvoor je geen terugkerend schema of event nodig hebt.

**Argumenten**: geen.

**Returnwaarden**:

| Naam | Type | Beschrijving |
| --- | --- | --- |
| `JSON` | JSON | De JSON-payload die bij het uitvoeren is meegegeven, of een leeg object. |

## Schedule

Voer een workflow uit volgens een cron-schema. Configureer de cadans met een standaard cron-expressie.

Gebruik dit voor terugkerende taken: nachtelijke opschoning, uurlijkse synchronisatie, wekelijkse export.

**Argumenten**:

| Naam | Type | Beschrijving |
| --- | --- | --- |
| `Schedule at` | CronTab | Standaard 5-velds cron-expressie. Bijvoorbeeld: `0 * * * *` draait op het hele uur, `*/5 * * * *` elke vijf minuten. |

**Returnwaarden**:

| Naam | Type | Beschrijving |
| --- | --- | --- |
| `executedAt` | Date | Het geplande uitvoeringstijdstip. |

Geplande workflows draaien op de Workflow Worker in de regio van het project. Als de worker even niet beschikbaar is, wordt de run verstuurd zodra hij herstelt — je hoeft je niet in te dekken tegen gemiste ticks bij korte onderbrekingen.

## Webhook

Stel een unieke HTTPS-URL beschikbaar waar een extern systeem een `POST` naartoe doet. De headers, query-parameters en body van het verzoek worden als returnwaarden blootgesteld voor stroomafwaartse componenten om te lezen.

Gebruik dit om data *binnen* OneUptime te ontvangen vanuit een derde partij: CI/CD-callbacks, alerts van een ander monitoring-tool, klantregistraties in je CRM.

**Argumenten**: geen. De URL wordt automatisch toegewezen wanneer de workflow wordt opgeslagen en getoond op de trigger-node. Behandel hem als een geheim — iedereen met de URL kan de workflow triggeren.

**Returnwaarden**:

| Naam | Type | Beschrijving |
| --- | --- | --- |
| `Request Headers` | JSON | Alle headers van het inkomende HTTP-verzoek. |
| `Request Query Params` | JSON | Geparseerde query-string. |
| `Request Body` | JSON | Geparseerde request-body. Als de body geen geldig JSON is, arriveert hij als string onder de `raw`-sleutel. |

De webhook accepteert `GET` en `POST`. Het antwoord aan de caller is een `200 OK` met een JSON-bevestiging zodra de run in de wachtrij staat — de workflow zelf draait asynchroon, dus verwacht niet dat je het resultaat van stroomafwaartse componenten kunt lezen in de HTTP-respons.

## Model-event-triggers

Vrijwel elke OneUptime-entiteit — monitors, incidenten, alerts, geplande onderhoudsevents, statuspagina's, oproepdienstbeleid, teams, telemetry services en nog veel meer — stelt drie triggers beschikbaar:

- **On Create** — gaat af wanneer een nieuw record van dit type wordt aangemaakt.
- **On Update** — gaat af wanneer een bestaand record wordt gewijzigd. De trigger stelt zowel de oude als de nieuwe waarden beschikbaar.
- **On Delete** — gaat af wanneer een record wordt verwijderd.

Zo bouw je "wanneer X in OneUptime gebeurt, doe Y"-automatisering zonder polling.

Het model zelf wordt als returnwaarde blootgesteld met dezelfde veldnamen die je op de resource ziet. Bijvoorbeeld: de **Incident → On Create**-trigger retourneert het volledige `Incident`-object, zodat stroomafwaartse nodes `{{Incident.title}}`, `{{Incident.description}}`, `{{Incident.incidentSeverityId}}`, enz. kunnen lezen.

**Argumenten**: typisch geen voor create/delete. Update-triggers laten je soms de velden beperken waarop je wilt reageren, zodat je niet afgaat op cosmetische wijzigingen.

**Returnwaarden** (verschilt per model):

| Naam | Type | Beschrijving |
| --- | --- | --- |
| Modelvelden | (verschilt) | Elke kolom op de entiteit — naam, status, timestamps, foreign keys. |
| `previous` (alleen Update) | JSON | Het record zoals het was vóór de wijziging. |

### Veelvoorkomende modeltriggers

Een niet-uitputtende lijst van de model-events waar teams het vaakst naar grijpen:

- **Incident** — `On Create`, `On Update` (gebruik om te reageren op statusovergangen zoals Acknowledged of Resolved), `On Delete`.
- **Alert** — dezelfde drie events op het alert-model.
- **Monitor** — reageer wanneer een monitor wordt toegevoegd, bewerkt of verwijderd; combineer met voorwaarden om alleen op productiemonitors te reageren.
- **Scheduled Maintenance** — automatiseer stroomafwaartse aankondigingen wanneer een onderhoudsvenster wordt aangemaakt of de status verandert.
- **Status Page Subscriber** — start een welkomstflow wanneer iemand zich abonneert.
- **On-Call Duty Policy** — synchroniseer roosterwijzigingen met een externe rooster.

Als het model in de OneUptime API beschikbaar is, kan het vrijwel zeker een workflow triggeren — zoek in het trigger-palet op entiteitsnaam.

## De juiste trigger kiezen

| Als je… wilt | Gebruik |
| --- | --- |
| Een knop op een workflow bouwen die iemand aanklikt | **Manual** |
| Een job draaien om de N minuten/uren/dagen | **Schedule** |
| Een extern systeem data laten pushen naar OneUptime | **Webhook** |
| Reageren op iets dat *binnen* OneUptime gebeurt | **Model-event** |

Workflows kunnen maar één trigger hebben. Als je twee verschillende startsignalen wilt die het meeste van dezelfde logica delen, factoreer dan de gedeelde stappen uit in één workflow en roep die aan vanuit twee dunne "wrapper"-workflows met het **Execute Workflow**-component (zie [Componenten](/docs/workflows/components)).

## Waar verder lezen

- [Componenten](/docs/workflows/components) — de acties die je achter de trigger koppelt.
- [Variabelen](/docs/workflows/variables) — hoe je trigger-returnwaarden vanuit stroomafwaartse nodes leest.
- [Uitvoeringen en logboeken](/docs/workflows/runs-and-logs) — hoe je bevestigt dat je trigger afgaat.
