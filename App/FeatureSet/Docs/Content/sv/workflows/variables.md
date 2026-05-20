# Variabler

Ett arbetsflöde är bara användbart när data flödar genom det. Variabler är hur den datan rör sig — från utlösaren in i den första komponenten, från en komponents utdata in i nästa komponents indata, och från projektnivåhemligheter in i var de än refereras.

OneUptime har två sorters variabler och en interpolationssyntax som fungerar för båda.

## Globala variabler

Projektomfattande värden som definieras en gång under **Workflows → Global Variables**. Tänk API-nycklar, bas-URL:er, kanalnamn, vad som helst du inte vill hårdkoda in i tio arbetsflöden.

En global variabel har:

- **Name** — identifieraren du refererar till den med. Använd `UPPER_SNAKE_CASE` för att göra det uppenbart i mallar.
- **Value** — strängvärdet. Flerradiga värden stöds.
- **Is Secret** — när på är värdet skrivskyddat i användargränssnittet efter att det sparats och redigeras bort från körningsloggar.

Referera till en global variabel från var som helst i vilket arbetsflöde som helst med:

```
{{variable.NAME}}
```

Till exempel, om du definierade `PAGERDUTY_KEY` som en hemlig variabel, kan varje API-komponent som anropar PagerDuty läsa den som `{{variable.PAGERDUTY_KEY}}` utan att någon ser den faktiska nyckeln i arbetsflödets JSON.

## Lokala variabler

Lokala variabler är returvärdena från noder som redan körts i den här exekveringen. Varje utlösare och varje komponent publicerar en — se [Utlösare](/docs/workflows/triggers) och [Komponenter](/docs/workflows/components) för listorna per nod.

Referera till en lokal variabel som:

```
{{NodeId.fieldName}}
```

`NodeId` är utlösarens eller komponentens namn på arbetsytan (du kan byta namn på den för läsbarhet — håll den kort och i `PascalCase` så att referenserna förblir rena). `fieldName` är vad den noden än publicerar.

Exempel:

- Efter att en **API**-komponent som heter `LookupUser` returnerar framgångsrikt kan nedströmsnoder läsa dess statuskod som `{{LookupUser.response-status}}` och den parsade bodyn som `{{LookupUser.response-body}}`.
- Efter en **Incident → On Create**-utlösare som heter `Incident` kan du läsa `{{Incident.title}}`, `{{Incident.description}}`, `{{Incident.incidentSeverityId}}` och vilken som helst annan kolumn på incidenten.
- Efter en **Custom Code**-komponent som heter `Transform` exponeras det returnerade värdet som `{{Transform.value}}`.

Lokala variabler är begränsade till en enskild körning. Nästa körning börjar med ett tomt blad.

## Var interpolation fungerar

Nästan varje text-stilsargument stöder interpolation:

- URL-fält på API-komponenten
- Meddelandetext på Slack / Teams / Discord / Telegram / E-post
- Ämne och body på e-post
- Header- och body-fält (använd det inuti JSON-värden)
- Vänster och höger operand på Villkor

Rena JSON-argument accepterar interpolation inuti strängvärden; du kan inte interpolera en nyckel. Om du behöver bygga en dynamisk struktur, använd **Custom Code** för att sätta ihop payloaden och pipa sedan dess returvärde in i nästa nod.

**Custom Code**-komponenten läser variabler annorlunda — globala variabler exponeras på `args.variables`, och uppströms-returvärden skickas in som namngivna argument du konfigurerar på komponenten.

## Exempel

### Bygg en payload från en utlösare

En webhook tar emot ett CI-byggresultat. Bodyn är JSON som `{ "service": "checkout", "status": "failed" }`. För att förvandla det till en OneUptime-incident:

1. **Webhook**-utlösare som heter `CIWebhook`.
2. **Conditions**-komponent: vänster `{{CIWebhook.Request Body.status}}`, operator `==`, höger `failed`.
3. Från `yes`-porten, en **Create Incident**-komponent med:
   - Titel: `CI build failed: {{CIWebhook.Request Body.service}}`
   - Beskrivning: `See {{CIWebhook.Request Body.url}} for the build logs.`

### Använd en hemlighet i ett utgående API-anrop

Ett arbetsflöde som anropar PagerDuty:

1. Definiera `PAGERDUTY_KEY` som en hemlig global variabel.
2. På **API**-komponenten, sätt `Authorization`-headern till `Token token={{variable.PAGERDUTY_KEY}}`.

Nyckeln dyker aldrig upp i arbetsflödets JSON eller i körningsloggar.

### Kedja två API-anrop

Det första anropet returnerar ett ID som det andra anropet behöver:

1. **API**-komponent `LookupOrder`: `GET /orders?email={{Manual.JSON.email}}`.
2. **API**-komponent `CancelOrder`: `POST /orders/{{LookupOrder.response-body.id}}/cancel`.

Om `LookupOrder` returnerar ett icke-2xx-svar, triggas dess `error`-port istället för `success` — koppla den grenen till en e-post- eller Slack-komponent så att misslyckanden inte är tysta.

## Några fallgropar

- **Stavfel i nodnamn bryter referenser tyst.** Om du byter namn på en nod efter att du kopplat `{{OldName.field}}` nedströms, uppdatera varje referens. Titta på körningsloggen — om du ser den bokstavliga `{{OldName.field}}` i det fångade argumentet löstes inte uppslagningen.
- **Hemligheter är skiftlägeskänsliga.** `{{variable.MyKey}}` och `{{variable.mykey}}` är olika variabler.
- **Saknade fält är tomma.** Att referera till `{{Foo.nonexistent}}` producerar en tom sträng, inte ett fel. Användbart, men det kan dölja buggar — använd en **Conditions**-nod för att hävda närvaro om fältet krävs för nästa steg.

## Var läsa vidare

- [Komponenter](/docs/workflows/components) — den fullständiga katalogen av returvärdesnamn.
- [Körningar & loggar](/docs/workflows/runs-and-logs) — granska det bokstavliga värdet av varje interpolerat argument efter en körning.
- [Konfiguration & säkerhet](/docs/workflows/configuration) — vad som är säkert att lägga i en global variabel.
