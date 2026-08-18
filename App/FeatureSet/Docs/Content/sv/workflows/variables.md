# Variabler

Arbetsflöden handlar om att flytta data — från utlösaren till det första blocket, från ett block till nästa, och från delade värden in dit du än behöver dem. Variabler är hur den datan rör sig.

Det finns två variabelomfattningar, plus komponentutdata som produceras under en körning.

## Globala variabler

Projektomfattande värden som du sparar en gång och återanvänder överallt. Tänk API-nycklar, URL:er, kanalnamn — allt du inte vill kopiera in i tio olika arbetsflöden.

Du hittar dem under **Arbetsflöden → Globala variabler**. Var och en har:

- **Name** — hur du refererar till den. Minst två tecken, inga mellanslag, och bara bokstäver, siffror, bindestreck och understreck. `UPPER_SNAKE_CASE` är en bra vana eftersom det sticker ut i dina block.
- **Description** — valfri, fri text för att påminna dig om vad den är till för.
- **Secret** — när det är på rensas värdet bort ur körningsloggar och stegspårningar.
- **Content** — själva värdet. Det är ett långtextfält, så värden med flera rader fungerar.

Använd en global variabel i vilket arbetsflöde som helst med:

```
{{global.variables.NAME}}
```

Om du till exempel sparade din PagerDuty-nyckel som `PAGERDUTY_KEY` kan vilket block som helst använda den som `{{global.variables.PAGERDUTY_KEY}}` — redigeraren lagrar referensen, och arbetsflödesloggningen rensar bort det uppslagna hemliga värdet.

Variabler skapas och raderas, de redigeras inte. Det finns ingen redigera-knapp i tabellen, så för att ändra ett värde i gränssnittet raderar du variabeln och skapar den igen — eller uppdaterar den via API:et, vilket beskrivs i slutet av den här sidan. Globala variabler och arbetsflödesvariabler är en funktion i Growth-planen.

## Lokala arbetsflödesvariabler

Variabler som är avgränsade till ett arbetsflöde, hanteras under **Workflow Variables** i det arbetsflödets vänstermeny. Referera till dem med:

```
{{local.variables.NAME}}
```

## Komponentutdata (data från tidigare block)

Varje utlösare och komponent kan producera utdata under en exekvering. Använd komponentväljaren i redigeraren för att skapa referensen istället för att skriva den själv — den infogar exakt de id:n som runnern förväntar sig.

Referera till ett tidigare blocks utdata så här:

```
{{local.components.COMPONENT_ID.returnValues.FIELD_ID}}
```

`COMPONENT_ID` är blockets **Identifier** — det korta id:t som visas på blocket, inte namnet som visas på det. Nya block får ett i stil med `api-get-1`, och du kan byta namn på det i blockets **ID**-sektion. Att byta namn på det bryter varje referens som redan pekar på det, på samma sätt som att byta namn på en variabel gör. `FIELD_ID` är det valda returvärdes-id:t.

Exempel:

- Efter att en **API**-komponent med ID:t `lookup-user` körts är dess statuskod `{{local.components.lookup-user.returnValues.response-status}}` och dess body är `{{local.components.lookup-user.returnValues.response-body}}`.
- Efter en **Run Custom JavaScript**-komponent med ID:t `transform` finns dess returnerade värde på `{{local.components.transform.returnValues.returnValue}}`.
- Utlösare för en posttyp — **On Create Incident** och liknande — returnerar exakt ett värde, `model`, som du borrar in i. För en utlösare med ID:t `incident-on-create-1` är incidentens titel `{{local.components.incident-on-create-1.returnValues.model.title}}`.

Lokala variabler finns bara under den aktuella körningen. Varje ny körning börjar på nytt.

## Var variabler fungerar

Nästan varje textfält accepterar variabler:

- URL:en på ett API-block.
- Meddelandetexten på Slack, Teams, Discord, Telegram, E-post.
- Ämnet och innehållet i ett e-postmeddelande.
- Headers- och body-fält (inuti strängvärden).
- Båda sidorna av ett **If / Else**-block (listat under kategorin Villkor).

I JSON-fält kan du använda en variabel inuti ett strängvärde, men inte som en nyckel. En referens som utgör ett helt värde för sig själv ersätts obehandlad, så du kan lägga in ett helt objekt i ett JSON-fält på det sättet. Om du behöver bygga en struktur dynamiskt, använd ett **Run Custom JavaScript**-block för att bygga den, och skicka sedan dess utdata till nästa block.

**Run Custom JavaScript**-blocket får inte variabler automatiskt — inget injiceras i sandlådan. Lägg `{{global.variables.NAME}}` (eller vilken komponentreferens som helst) i blockets **Arguments**-JSON-fält; de värdena ersätts innan skriptet körs och kommer in som `args`.

## Loopa över arrayer

Inuti ett textfält kan du iterera en array med `{{#each path}}…{{/each}}`. Inuti blocket läser `{{property}}` från det aktuella elementet, `{{@index}}` är den nollindexerade positionen, och `{{this}}` är själva elementet för arrayer av enkla värden. Namn inuti ett `{{#each}}`-block trimmas, så oavsiktliga mellanslag är ofarliga där — till skillnad från överallt annars.

## Exempel

### Bygga en payload från en webhook

En webhook kommer in med en body som `{ "service": "checkout", "status": "failed" }`. För att förvandla det till en OneUptime-incident:

1. **Webhook**-utlösare med id:t `ci-webhook`.
2. **If / Else**-block: välj webhookens Request Body-utdata och använd dess `status`-egenskap, operator `==`, höger `failed`.
3. Från grenen **Yes**, ett **Create One Incident**-block med:
   - Title: `CI build failed: {{local.components.ci-webhook.returnValues.request-body.service}}`
   - Description: `See {{local.components.ci-webhook.returnValues.request-body.url}} for the logs.`

### Använda en hemlighet i ett API-anrop

Ett arbetsflöde som anropar PagerDuty:

1. Spara `PAGERDUTY_KEY` som en hemlig global variabel.
2. På **API**-blocket, ställ in `Authorization`-headern till `Token token={{global.variables.PAGERDUTY_KEY}}`.

Nyckeln stannar utanför arbetsflödet och loggarna.

### Kedja två API-anrop

Det första anropet ger dig ett ID som det andra behöver:

1. **API**-komponenten `lookup-order`: använd väljaren för att infoga den manuella utlösarens JSON-e-postfält i `GET /orders?email=...`.
2. **API**-komponenten `cancel-order`: `POST /orders/{{local.components.lookup-order.returnValues.response-body.id}}/cancel`.

Om `lookup-order` misslyckas utlöses dess **Error**-utdata istället för **Success**. Koppla det till ett e-post- eller Slack-block så att fel inte går obemärkta.

## Uppdatera en variabel från ett arbetsflöde

Ett vanligt mönster är att rotera ett autentiseringsuppgift enligt ett schema: hämta en färsk token från en tredje part, och lagra sedan tillbaka den i variabeln så att nästa körning tar upp den. Gör det med ett **API**-block som anropar OneUptime-API:et.

`PUT /api/workflow-variable/<variable-id>` med en `ApiKey`-header, och — det här är delen som brukar snubbla folk — fälten du vill ändra **inslagna i ett `data`-objekt**:

```json
{
  "data": {
    "content": "{{local.components.get-token.returnValues.response-body.access_token}}"
  }
}
```

En platt body utan `data`-omslaget avvisas med en 400. Skicka bara de fält du faktiskt vill ändra; `name` och `description` kan hållas utanför nyttolasten.

API-nyckeln behöver **Edit Workflow Variables**. Ingen läsbehörighet krävs — uppdateringen läser inte tillbaka raden.

Två saker att se upp för:

- **Byt inte namn på en variabel du refererar till.** `name` är en del av `{{local.variables.NAME}}`. Om du ändrar det lämnas varje befintlig referens olöst, och en olöst referens skickas vidare som bokstavlig text — se fallgropen nedan.
- **En variabel kan skrivas på det här sättet men aldrig läsas tillbaka.** `content` är skrivskyddat i motsatt riktning (write-only) via API:et för varje variabel, hemlig eller ej. Det är det som gör en variabel till en säker plats att parkera en roterande token. Att markera den som hemlig håller dessutom värdet borta från körningsloggar och stegspårningar.

## Fallgropar

- **Använd väljarna.** De infogar exakt de komponent-, returvärdes- och variabel-id:n som runnern förväntar sig, och håller referenser oberoende av visningsetiketter.
- **Variabelnamn är versalkänsliga.** `{{global.variables.MyKey}}` och `{{global.variables.mykey}}` är olika.
- **En referens som inte löses lämnas som den är, blir inte tom.** Att referera till något som inte finns är inte ett fel, och det ger dig inte en tom sträng heller: klamrarna skickas rakt igenom, så `{{local.components.api-get-1.returnValues.body}}` med ett felstavat steg-id hamnar ordagrant i ditt Slack-meddelande, URL eller request body, och körningen rapporterar ändå **Executed**. Körningsloggen bär en varningsrad som namnger varje referens som slank igenom.
- **Byggaren kan inte kontrollera variabelnamn.** Den flaggar komponentreferenser den inte kan matcha — ett okänt steg-id, ett okänt returvärde, en felformad rot — innan du sparar. Den kan inte avgöra om en variabel finns, så en omdöpt variabel fångas bara av körningsloggen.
- **Mellanslag inuti klamrarna trimmas inte.** `{{ local.variables.NAME }}` är en annan uppslagning än `{{local.variables.NAME}}` och löses aldrig. Det enda undantaget är inuti ett `{{#each}}`-block, där namn trimmas.

## Läs vidare

- [Komponenter](/docs/workflows/components) — den fullständiga listan över utdata som varje block producerar.
- [Körningar & loggar](/docs/workflows/runs-and-logs) — se det faktiska värdet av varje variabel efter en körning.
- [Konfiguration & säkerhet](/docs/workflows/configuration) — vad som är säkert att lägga i en global variabel.
