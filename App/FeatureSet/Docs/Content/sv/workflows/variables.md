# Variabler

Arbetsflöden handlar om att flytta data — från utlösaren till det första blocket, från ett block till nästa, och från delade värden in dit du än behöver dem. Variabler är hur den datan rör sig.

Det finns två sorter, och de delar samma syntax.

## Globala variabler

Projektomfattande värden som du sparar en gång och återanvänder överallt. Tänk API-nycklar, URL:er, kanalnamn — allt du inte vill kopiera in i tio olika arbetsflöden.

Du hittar dem under **Workflows → Global Variables**. Var och en har:

- **Name** — hur du refererar till den. Använd `UPPER_SNAKE_CASE` så att den sticker ut i dina block.
- **Value** — själva värdet. Värden över flera rader fungerar också.
- **Is Secret** — när det är på döljs värdet i gränssnittet efter att du sparat och döljs i körningsloggar.

Använd en global variabel i vilket arbetsflöde som helst med:

```
{{variable.NAME}}
```

Till exempel, om du sparade din PagerDuty-nyckel som `PAGERDUTY_KEY`, kan vilket block som helst använda den som `{{variable.PAGERDUTY_KEY}}` — den riktiga nyckeln syns aldrig i arbetsflödet eller dess loggar.

## Lokala variabler (data från tidigare block)

Lokala variabler är utdata från block som redan körts i denna exekvering. Varje utlösare och varje komponent producerar något utdata du kan läsa.

Referera till ett tidigare blocks utdata så här:

```
{{BlockName.fieldName}}
```

`BlockName` är namnet på utlösaren eller komponenten på arbetsytan (du kan byta namn till något kort och tydligt). `fieldName` är det som det blocket producerar.

Exempel:

- Efter att ett **API**-block med namnet `LookupUser` körts kan du läsa statuskoden som `{{LookupUser.response-status}}` och bodyn som `{{LookupUser.response-body}}`.
- Efter en **Incident → On Create**-utlösare med namnet `Incident` kan du läsa `{{Incident.title}}`, `{{Incident.description}}` och vilket annat fält som helst på incidenten.
- Efter ett **Custom Code**-block med namnet `Transform` finns det returnerade värdet på `{{Transform.value}}`.

Lokala variabler finns bara under den aktuella körningen. Varje ny körning börjar på nytt.

## Var variabler fungerar

Nästan varje textfält accepterar variabler:

- URL:en på ett API-block.
- Meddelandetexten på Slack, Teams, Discord, Telegram, E-post.
- Ämnet och bodyn i ett e-postmeddelande.
- Headers- och body-fält (inuti strängvärden).
- Båda sidorna av ett Conditions-block.

Rena JSON-fält accepterar variabler inuti strängvärden, men du kan inte använda en variabel som en nyckel. Om du behöver bygga en struktur dynamiskt, använd ett **Custom Code**-block för att bygga den, och skicka sedan dess utdata till nästa block.

**Custom Code**-blocket läser variabler på ett annat sätt — globala variabler kommer in på `args.variables`, och du bestämmer vilka tidigare utdata som ska skickas in som argument.

## Exempel

### Bygga en payload från en webhook

En webhook kommer in med en body som `{ "service": "checkout", "status": "failed" }`. För att förvandla det till en OneUptime-incident:

1. **Webhook**-utlösare med namnet `CIWebhook`.
2. **Conditions**-block: vänster `{{CIWebhook.Request Body.status}}`, operator `==`, höger `failed`.
3. Från grenen **Yes**, ett **Create Incident**-block med:
   - Titel: `CI build failed: {{CIWebhook.Request Body.service}}`
   - Beskrivning: `See {{CIWebhook.Request Body.url}} for the logs.`

### Använda en hemlighet i ett API-anrop

Ett arbetsflöde som anropar PagerDuty:

1. Spara `PAGERDUTY_KEY` som en hemlig global variabel.
2. På **API**-blocket, ställ in `Authorization`-headern till `Token token={{variable.PAGERDUTY_KEY}}`.

Nyckeln stannar utanför arbetsflödet och loggarna.

### Kedja två API-anrop

Det första anropet ger dig ett ID som det andra behöver:

1. **API**-block `LookupOrder`: `GET /orders?email={{Manual.JSON.email}}`.
2. **API**-block `CancelOrder`: `POST /orders/{{LookupOrder.response-body.id}}/cancel`.

Om `LookupOrder` misslyckas utlöses dess **error**-utdata istället för **success**. Koppla det till ett E-post- eller Slack-block så att fel inte går obemärkta.

## Saker att se upp för

- **Att byta namn på ett block bryter referenser.** Om du byter namn på ett block, uppdatera varje plats där det används. I körningsloggen visas en olöst referens som den bokstavliga texten `{{BlockName.field}}`.
- **Variabelnamn är versalkänsliga.** `{{variable.MyKey}}` och `{{variable.mykey}}` är olika.
- **Saknade fält blir tomma.** Att referera till ett fält som inte finns ger dig en tom sträng, inte ett fel. Bekvämt — men det kan dölja buggar. Använd ett **Conditions**-block för att kontrollera viktiga fält innan du fortsätter.

## Läs vidare

- [Komponenter](/docs/workflows/components) — den fullständiga listan över utdata som varje block producerar.
- [Körningar & loggar](/docs/workflows/runs-and-logs) — se det faktiska värdet av varje variabel efter en körning.
- [Konfiguration & säkerhet](/docs/workflows/configuration) — vad som är säkert att lägga i en global variabel.
