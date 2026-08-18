# Utlösare

En utlösare är det första blocket i ett arbetsflöde — den avgör när arbetsflödet körs. Varje arbetsflöde har exakt en utlösare. Du väljer bland fyra sorter.

## Manual

Kör arbetsflödet på begäran genom att klicka på **Kör arbetsflöde** på sidan **Byggare**, fylla i utlösarens fält och bekräfta med **Run Workflow Manually**. Utlösaren Manual tar emot en JSON-payload som resten av arbetsflödet kan läsa.

Bra för: enknappsautomationer du vill ha en knapp till, som "rotera den här nyckeln" eller "skicka ett testlarm".

**Output**: den JSON du klistrade in, eller ett tomt objekt om du lät bli.

## Schedule

Kör arbetsflödet enligt ett återkommande schema med ett cron-uttryck.

Bra för: nattlig städning, synk varje timme, veckorapporter.

**Inställning**: ett cron-uttryck. Några vanliga:

- `0 * * * *` — varje timme, på hel timme.
- `*/5 * * * *` — var femte minut.
- `0 9 * * 1` — varje måndag klockan 09:00.

Om systemet är otillgängligt en kort stund plockas körningen upp så snart det är tillbaka — du behöver inte oroa dig för missade tick vid korta avbrott.

## Webhook

OneUptime skapar en unik URL. Allt som träffar den URL:en startar arbetsflödet. Förfrågans headers, frågeparametrar och body skickas in.

Bra för: att ta emot data i OneUptime från ett annat verktyg — CI/CD-återanrop, larm från annan övervakning, registreringar i ert CRM.

**Output**:

- **Begärandehuvuden** — alla headers från den inkommande förfrågan.
- **Request Query Params** — den tolkade frågesträngen.
- **Begärandekropp** — den tolkade bodyn (eller råtexten om den inte är JSON).

URL:en tar emot både `GET` och `POST`. Anroparen får en snabb bekräftelse — själva arbetsflödet körs i bakgrunden.

Behandla URL:en som ett lösenord. Vem som helst som har den kan starta ditt arbetsflöde.

## OneUptime-händelseutlösare

Nästan allt i OneUptime — monitorer, incidenter, larm, schemalagt underhåll, statussidor, jourpolicyer, team — kan utlösa ett arbetsflöde. Var och en erbjuder tre händelser:

- **On Create** — utlöses när en ny läggs till.
- **On Update** — utlöses när en ändras.
- **On Delete** — utlöses när en tas bort.

Så bygger du "när X händer i OneUptime, gör Y" utan att behöva kontrollera saker i en loop.

Hela posten skickas vidare till nästa block. Utlösaren **Incident → On Create** skickar till exempel med den nya incidenten, så nästa block kan läsa dess titel, beskrivning, allvarlighetsgrad och alla andra fält.

### Händelser som team använder mest

- **Incident** — reagera när en incident öppnas, uppdateras (bekräftas, löses) eller tas bort.
- **Larm** — samma tre för larm.
- **Övervakning** — reagera när en monitor läggs till, redigeras eller tas bort.
- **Schemalagt underhåll** — annonsera ett underhållsfönster automatiskt när det schemaläggs.
- **Statussida Prenumerant** — välkomna någon som prenumererar på en statussida.
- **On-Call Duty Policy** — synka schemaändringar till ett annat joursystem.

Sök på namn i panelen **Add Trigger** för att hitta den du vill ha.

## Vilken utlösare ska jag använda?

| Om du vill…                                  | Välj                   |
| -------------------------------------------- | ---------------------- |
| Klicka på en knapp för att köra arbetsflödet | **Manual**             |
| Köra enligt ett återkommande schema          | **Schedule**           |
| Låta ett annat system skicka in data         | **Webhook**            |
| Reagera på något inuti OneUptime             | **OneUptime-händelse** |

Ett arbetsflöde kan bara ha en utlösare. Behöver du två sätt att starta samma automation, bygg den gemensamma logiken i ett arbetsflöde och anropa det från två tunna "omslags"-arbetsflöden med komponenten **Execute Workflow**.

## Läs vidare

- [Arbetsflödeskomponenter](/docs/workflows/components) — åtgärderna du lägger till efter utlösaren.
- [Arbetsflödesvariabler](/docs/workflows/variables) — att läsa utlösarens output från senare block.
- [Arbetsflödeskörningar & loggar](/docs/workflows/runs-and-logs) — att bekräfta att din utlösare utlöstes.
