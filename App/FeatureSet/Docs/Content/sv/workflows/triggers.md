# Utlösare

En utlösare är startnoden i ett arbetsflöde. Den har ingen ingångsport — exekveringen börjar här. OneUptime stöder fyra familjer av utlösare; varje arbetsflöde använder exakt en.

## Manuell

Kör ett arbetsflöde på begäran genom att klicka på **Run Manually** på arbetsflödessidan. Du kan klistra in en valfri JSON-payload som arbetsflödet kan läsa som `{{Manual.JSON}}`.

Använd den här när du vill ha en knapp som triggar en bit automation — ett enklicks "rotera jour-nyckeln" eller "bygg om sökindexet" som inte behöver ett återkommande schema eller en händelse för att triggas.

**Argument**: inga.

**Returvärden**:

| Namn | Typ | Beskrivning |
| --- | --- | --- |
| `JSON` | JSON | JSON-payloaden som tillhandahölls vid körningstillfället, eller ett tomt objekt. |

## Schemalagd

Kör ett arbetsflöde enligt ett cron-schema. Konfigurera intervallet med ett standardiserat cron-uttryck.

Använd det här för återkommande jobb: nattlig städning, timvis synk, veckovis export.

**Argument**:

| Namn | Typ | Beskrivning |
| --- | --- | --- |
| `Schedule at` | CronTab | Standard 5-fälts cron-uttryck. Till exempel kör `0 * * * *` vid varje hels timme, `*/5 * * * *` varje femte minut. |

**Returvärden**:

| Namn | Typ | Beskrivning |
| --- | --- | --- |
| `executedAt` | Date | Den schemalagda körningstiden. |

Schemalagda arbetsflöden körs på Workflow Worker i projektets region. Om workern är kortvarigt otillgänglig skickas körningen iväg när den återhämtar sig — du behöver inte skydda dig mot missade ticks vid korta avbrott.

## Webhook

Exponera en unik HTTPS-URL som ett externt system gör en `POST` till. Förfrågans rubriker, query-parametrar och body exponeras som returvärden för nedströmskomponenter att läsa.

Använd det här för att ta emot data *in* i OneUptime från ett tredjepartssystem: CI/CD-callbacks, larm från ett annat övervakningsverktyg, kundregistreringar i ditt CRM.

**Argument**: inga. URL:en allokeras automatiskt när arbetsflödet sparas och visas på utlösarnoden. Behandla den som en hemlighet — vem som helst med URL:en kan trigga arbetsflödet.

**Returvärden**:

| Namn | Typ | Beskrivning |
| --- | --- | --- |
| `Request Headers` | JSON | Alla rubriker från den inkommande HTTP-förfrågan. |
| `Request Query Params` | JSON | Parsad query-sträng. |
| `Request Body` | JSON | Parsad request body. Om bodyn inte är giltig JSON anländer den som en sträng under `raw`-nyckeln. |

Webhook accepterar `GET` och `POST`. Svaret till anroparen är ett `200 OK` med en JSON-bekräftelse så snart körningen är ställd i kö — själva arbetsflödet körs asynkront, så förvänta dig inte att läsa resultatet av nedströmskomponenter i HTTP-svaret.

## Modellhändelse-utlösare

Nästan varje OneUptime-entitet — monitorer, incidenter, larm, planerade underhållshändelser, statussidor, jour-policyer, team, telemetritjänster och många fler — exponerar tre utlösare:

- **On Create** — triggas när en ny post av denna typ skapas.
- **On Update** — triggas när en befintlig post ändras. Utlösaren exponerar både de gamla och nya värdena.
- **On Delete** — triggas när en post tas bort.

Det är så här du bygger "när X händer i OneUptime, gör Y"-automation utan polling.

Själva modellen exponeras som ett returvärde med samma fältnamn som du ser på resursen. Till exempel returnerar **Incident → On Create**-utlösaren det fullständiga `Incident`-objektet så att nedströmsnoder kan läsa `{{Incident.title}}`, `{{Incident.description}}`, `{{Incident.incidentSeverityId}}`, etc.

**Argument**: vanligtvis inga för create/delete. Update-utlösare kan låta dig begränsa vilka fält du vill reagera på, så att du inte triggas på kosmetiska ändringar.

**Returvärden** (varierar per modell):

| Namn | Typ | Beskrivning |
| --- | --- | --- |
| Modellfält | (varierar) | Varje kolumn på entiteten — namn, status, tidsstämplar, främmande nycklar. |
| `previous` (endast Update) | JSON | Posten som den var före ändringen. |

### Vanliga modellutlösare

En icke uttömmande lista över modellhändelser som team griper efter oftast:

- **Incident** — `On Create`, `On Update` (använd för att reagera på tillståndsändringar som Acknowledged eller Resolved), `On Delete`.
- **Alert** — samma tre händelser på larmmodellen.
- **Monitor** — reagera när en monitor läggs till, redigeras eller tas bort; kombinera med villkor för att agera endast på produktionsmonitorer.
- **Scheduled Maintenance** — automatisera nedströmsannonsering när ett underhållsfönster skapas eller dess tillstånd ändras.
- **Status Page Subscriber** — trigga ett välkomstflöde när någon prenumererar.
- **On-Call Duty Policy** — synka schemaändringar till en extern bemanningslista.

Om modellen exponeras i OneUptime-API:t kan den nästan säkert trigga ett arbetsflöde — sök i utlösarpaletten efter entitetsnamn.

## Välja rätt utlösare

| Om du vill… | Använd |
| --- | --- |
| Bygga en knapp på ett arbetsflöde som någon klickar på | **Manual** |
| Köra ett jobb varje N minuter/timmar/dagar | **Schedule** |
| Låta ett externt system pusha data in i OneUptime | **Webhook** |
| Reagera på något som händer *inuti* OneUptime | **Modellhändelse** |

Arbetsflöden kan bara ha en utlösare. Om du behöver två olika startsignaler för att dela merparten av samma logik, faktorisera ut de delade stegen i ett arbetsflöde och anropa det från två tunna "wrapper"-arbetsflöden med komponenten **Execute Workflow** (se [Komponenter](/docs/workflows/components)).

## Var läsa vidare

- [Komponenter](/docs/workflows/components) — åtgärderna du kopplar in efter utlösaren.
- [Variabler](/docs/workflows/variables) — hur du läser utlösarens returvärden från nedströmsnoder.
- [Körningar & loggar](/docs/workflows/runs-and-logs) — hur du bekräftar att din utlösare triggas.
