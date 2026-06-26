# Utlösare

En utlösare är det första blocket i ett arbetsflöde — det bestämmer när arbetsflödet körs. Varje arbetsflöde har exakt en utlösare. Du väljer mellan fyra olika sorter.

## Manuell

Kör arbetsflödet på begäran genom att klicka på **Run Manually** på arbetsflödets sida. Du kan klistra in en JSON-payload som resten av arbetsflödet kan läsa.

Bra för: enkla automatiseringar du vill ha en knapp för, som "rotera den här nyckeln" eller "skicka ett testlarm."

**Utdata**: den JSON du klistrade in, eller ett tomt objekt om du inte gjorde det.

## Schemalagd

Kör arbetsflödet på ett återkommande schema med ett cron-uttryck.

Bra för: nattlig städning, timvis synkronisering, veckorapporter.

**Inställning**: ett cron-uttryck. Några vanliga:

- `0 * * * *` — varje timme, på heltimmen.
- `*/5 * * * *` — var 5:e minut.
- `0 9 * * 1` — varje måndag kl 9:00.

Om systemet är kortvarigt otillgängligt plockas körningen upp så fort det är igång igen — du behöver inte oroa dig för missade tickar vid korta avbrott.

## Webhook

OneUptime skapar en unik URL. Allt som anropar den URL:en startar arbetsflödet. Headers, query-parametrar och body i förfrågan skickas vidare.

Bra för: att ta emot data till OneUptime från ett annat verktyg — CI/CD-callbacks, larm från annan övervakning, registreringar i ditt CRM.

**Utdata**:

- **Request Headers** — alla headers från den inkommande förfrågan.
- **Request Query Params** — den tolkade query-strängen.
- **Request Body** — den tolkade bodyn (eller råtexten om det inte är JSON).

URL:en accepterar både `GET` och `POST`. Anroparen får en snabb bekräftelse — själva arbetsflödet körs i bakgrunden.

Behandla URL:en som ett lösenord. Den som har den kan starta ditt arbetsflöde.

## OneUptime-händelseutlösare

Nästan allt i OneUptime — monitorer, incidenter, larm, schemalagt underhåll, statussidor, jourpolicyer, team — kan utlösa ett arbetsflöde. Var och en erbjuder tre händelser:

- **On Create** — utlöses när en ny läggs till.
- **On Update** — utlöses när en ändras.
- **On Delete** — utlöses när en raderas.

Det är så du bygger "när X händer i OneUptime, gör Y" utan att behöva polla saker i en loop.

Hela posten skickas vidare till nästa block. Till exempel skickar utlösaren **Incident → On Create** vidare den nya incidenten, så att nästa block kan läsa dess titel, beskrivning, allvarlighetsgrad och alla andra fält.

### Händelser som team använder mest

- **Incident** — reagera när en incident öppnas, uppdateras (bekräftas, löses) eller raderas.
- **Alert** — samma tre för larm.
- **Monitor** — reagera när en monitor läggs till, redigeras eller tas bort.
- **Scheduled Maintenance** — meddela ett underhållsfönster automatiskt när det schemaläggs.
- **Status Page Subscriber** — välkomna någon som prenumererar på en statussida.
- **On-Call Duty Policy** — synka schemaändringar till ett annat rostersystem.

Sök i utlösarpaletten på namn för att hitta den du vill ha.

## Vilken utlösare ska jag använda?

| Om du vill…                                  | Välj                   |
| -------------------------------------------- | ---------------------- |
| Klicka på en knapp för att köra arbetsflödet | **Manuell**            |
| Köra på ett återkommande schema              | **Schemalagd**         |
| Låta ett annat system skicka in data         | **Webhook**            |
| Reagera på något inuti OneUptime             | **OneUptime-händelse** |

Ett arbetsflöde kan bara ha en utlösare. Om du behöver två sätt att starta samma automation, bygg den delade logiken i ett arbetsflöde och anropa det från två tunna "wrapper"-arbetsflöden med komponenten **Execute Workflow**.

## Läs vidare

- [Komponenter](/docs/workflows/components) — åtgärderna du lägger till efter utlösaren.
- [Variabler](/docs/workflows/variables) — läsa utlösarens utdata från senare block.
- [Körningar & loggar](/docs/workflows/runs-and-logs) — bekräfta att din utlösare triggades.
