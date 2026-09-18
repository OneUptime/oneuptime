# Variabler

Arbetsflöden handlar om att flytta data — från utlösaren till första blocket, från ett block till nästa och från delade värden in dit du behöver dem. Variabler är hur den datan flyttas.

Det finns två variabelomfång, plus komponenternas output som skapas under en körning.

## Globala variabler

Projektövergripande värden som du sparar en gång och återanvänder var som helst. Tänk API-nycklar, URL:er, kanalnamn — allt du inte vill kopiera in i tio olika arbetsflöden.

Du hittar dem under **Arbetsflöden → Globala variabler**. Var och en har:

- **Namn** — så du refererar till den. Minst två tecken, inga mellanslag, och bara bokstäver, siffror, bindestreck och understreck. `UPPER_SNAKE_CASE` är en bra vana eftersom det sticker ut i dina block.
- **Beskrivning** — valfri fritext som påminner dig om vad den är till för.
- **Hemlighet** — när den är på tvättas värdet bort ur körloggar och stegspårningar.
- **Innehåll** — själva värdet. Det är ett långtextfält, så flerradiga värden fungerar.

Använd en global variabel i vilket arbetsflöde som helst med:

```
{{global.variables.NAME}}
```

Om du till exempel sparade din PagerDuty-nyckel som `PAGERDUTY_KEY` kan vilket block som helst använda den som `{{global.variables.PAGERDUTY_KEY}}` — redigeraren sparar referensen, och arbetsflödesloggningen tvättar bort det upplösta hemliga värdet.

Variabler skapas och tas bort, de redigeras inte. Det finns ingen redigeringsknapp i tabellen, så för att ändra ett värde i gränssnittet tar du bort variabeln och skapar den igen — eller uppdaterar den via API:et, vilket beskrivs i slutet av den här sidan. Globala variabler och arbetsflödesvariabler är en funktion i Growth-planen.

## Lokala arbetsflödesvariabler

Variabler avgränsade till ett enda arbetsflöde, som du hanterar under **Arbetsflödesvariabler** i det arbetsflödets vänstermeny. Referera till dem med:

```
{{local.variables.NAME}}
```

## Komponentoutput (data från tidigare block)

Varje utlösare och komponent kan producera output under en exekvering. Använd komponentvärdeväljaren i redigeraren för att skapa referensen istället för att skriva den — den infogar exakt de id:n som körmotorn förväntar sig.

Referera till ett tidigare blocks output så här:

```
{{local.components.COMPONENT_ID.returnValues.FIELD_ID}}
```

`COMPONENT_ID` är blockets **Identifier** — det korta id:t som visas på blocket, inte namnet som står på det. Nya block får ett i stil med `api-get-1`, och du kan byta namn på det i blockets **ID**-sektion. Byter du namn slutar varje referens som redan pekar dit att fungera, precis som när du byter namn på en variabel. `FIELD_ID` är det valda returvärdets id.

Exempel:

- När en **API**-komponent med id:t `lookup-user` har körts är dess statuskod `{{local.components.lookup-user.returnValues.response-status}}` och dess body `{{local.components.lookup-user.returnValues.response-body}}`.
- När en **Run Custom JavaScript**-komponent med id:t `transform` har körts är dess returnerade värde `{{local.components.transform.returnValues.returnValue}}`.
- Utlösare för en posttyp — **On Create Incident** och dess syskon — returnerar exakt ett värde, `model`, som du borrar dig ner i. För en utlösare med id:t `incident-on-create-1` är incidentens titel `{{local.components.incident-on-create-1.returnValues.model.title}}`.

Lokala variabler finns bara under den pågående körningen. Varje ny körning börjar från noll.

## Var variabler fungerar

Nästan varje textfält tar emot variabler:

- URL:en på ett API-block.
- Meddelandetexten på Slack, Teams, Discord, Telegram, Email.
- Ämnet och brödtexten i ett e-postmeddelande.
- Header- och body-fält (inuti strängvärden).
- Båda sidorna av ett **If / Else**-block (listat under kategorin Conditions).

I JSON-fält kan du använda en variabel inuti ett strängvärde, men inte som nyckel. En referens som ensam upptar ett helt värde ersätts rakt av, så du kan släppa in ett helt objekt i ett JSON-fält på det sättet. Behöver du bygga en struktur dynamiskt, använd ett **Run Custom JavaScript**-block för att bygga den och skicka sedan dess output till nästa block.

Blocket **Run Custom JavaScript** får inte variabler automatiskt — ingenting injiceras i sandlådan. Lägg `{{global.variables.NAME}}` (eller vilken komponentreferens som helst) i blockets JSON-fält **Arguments**; de värdena ersätts innan skriptet körs och kommer in som `args`.

## Loopa över arrayer

Inuti ett textfält kan du iterera över en array med `{{#each path}}…{{/each}}`. Inuti blocket läser `{{property}}` från det aktuella elementet, `{{@index}}` är positionen räknat från 0, och `{{this}}` är elementet självt för arrayer med enkla värden. Namn inuti ett `{{#each}}`-block trimmas, så överflödiga mellanslag är harmlösa där — till skillnad från överallt annars.

## Exempel

### Bygga en payload från en webhook

En webhook kommer in med en body som `{ "service": "checkout", "status": "failed" }`. Så här gör du en OneUptime-incident av det:

1. **Webhook**-utlösare med id:t `ci-webhook`.
2. **If / Else**-block: välj webhookens Request Body-output och använd dess `status`-egenskap, operator `==`, höger sida `failed`.
3. Från grenen **Yes**, ett **Create One Incident**-block med:
   - Titel: `CI build failed: {{local.components.ci-webhook.returnValues.request-body.service}}`
   - Beskrivning: `See {{local.components.ci-webhook.returnValues.request-body.url}} for the logs.`

### Använda en hemlighet i ett API-anrop

Ett arbetsflöde som anropar PagerDuty:

1. Spara `PAGERDUTY_KEY` som en hemlig global variabel.
2. På **API**-blocket, sätt headern `Authorization` till `Token token={{global.variables.PAGERDUTY_KEY}}`.

Nyckeln hålls utanför både arbetsflödet och loggarna.

### Kedja ihop två API-anrop

Det första anropet ger dig ett ID som det andra behöver:

1. **API**-komponenten `lookup-order`: använd väljaren för att infoga den manuella utlösarens JSON-e-postfält i `GET /orders?email=...`.
2. **API**-komponenten `cancel-order`: `POST /orders/{{local.components.lookup-order.returnValues.response-body.id}}/cancel`.

Om `lookup-order` misslyckas utlöses dess **Error**-utgång istället för **Success**. Koppla den till ett Email- eller Slack-block så att fel inte passerar obemärkta.

## Uppdatera en variabel från ett arbetsflöde

Ett vanligt mönster är att rotera en autentiseringsuppgift enligt ett schema: hämta en färsk token från en tredje part och lagra den tillbaka i variabeln så att nästa körning plockar upp den. Det gör du med ett **API**-block som anropar OneUptimes API.

`PUT /api/workflow-variable/<variable-id>` med en `ApiKey`-header och — det är den här delen som ställer till det för folk — fälten du vill ändra **inneslutna i ett `data`-objekt**:

```json
{
  "data": {
    "content": "{{local.components.get-token.returnValues.response-body.access_token}}"
  }
}
```

En platt body utan `data`-omslaget avvisas med en 400. Skicka bara de fält du faktiskt vill ändra; `name` och `description` kan lämnas utanför payloaden.

API-nyckeln behöver **Edit Workflow Variables**. Ingen läsbehörighet krävs — uppdateringen läser inte tillbaka raden.

Två saker att se upp med:

- **Byt inte namn på en variabel du refererar till.** `name` är en del av `{{local.variables.NAME}}`. Ändrar du det lämnas varje befintlig referens olöst, och en olöst referens skickas vidare som ren text — se fallgropen nedan.
- **En variabel kan skrivas den här vägen men aldrig läsas tillbaka.** `content` är skrivskyddat åt andra hållet över API:et för varje variabel, hemlig eller inte. Det är det som gör en variabel till ett säkert ställe att parkera en roterande token. Att markera den som hemlig håller dessutom värdet borta från körloggar och stegspårningar.

## Fallgropar

- **Använd väljarna.** De infogar exakt de komponent-, returvärdes- och variabel-id:n som körmotorn förväntar sig, och håller referenserna oberoende av visningsetiketter.
- **Variabelnamn är skiftlägeskänsliga.** `{{global.variables.MyKey}}` och `{{global.variables.mykey}}` är olika.
- **En referens som inte löses upp lämnas som den är, den töms inte.** Att referera till något som inte finns är inte ett fel, och det ger dig inte heller en tom sträng: klammerparenteserna skickas rakt igenom, så `{{local.components.api-get-1.returnValues.body}}` med ett feltypat steg-id hamnar ordagrant i ditt Slack-meddelande, din URL eller din request body, och körningen rapporteras ändå som **Executed**. Körloggen innehåller en varningsrad som namnger varje referens som slank igenom.
- **Byggaren kan inte kontrollera variabelnamn.** Den flaggar komponentreferenser den inte kan matcha — ett okänt steg-id, ett okänt returvärde, en felformad rot — innan du sparar. Den kan inte avgöra om en variabel finns, så en omdöpt variabel fångas bara av körloggen.
- **Mellanslag inuti klammerparenteserna trimmas inte.** `{{ local.variables.NAME }}` är en annan uppslagning än `{{local.variables.NAME}}` och löses aldrig upp. Enda undantaget är inuti ett `{{#each}}`-block, där namn trimmas.

## Läs vidare

- [Arbetsflödeskomponenter](/docs/workflows/components) — hela listan över output varje block producerar.
- [Arbetsflödeskörningar & loggar](/docs/workflows/runs-and-logs) — se det faktiska värdet på varje variabel efter en körning.
- [Arbetsflödeskonfiguration & säkerhet](/docs/workflows/configuration) — vad som är säkert att lägga i en global variabel.
