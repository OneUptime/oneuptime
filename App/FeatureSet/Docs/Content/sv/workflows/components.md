# Komponenter

Komponenter är byggstenarna du lägger till efter utlösaren. Var och en gör en sak — skickar ett meddelande, anropar ett API, kontrollerar ett villkor — och kopplas vidare till vad som än kommer härnäst.

Den här sidan är katalogen. För hur du lägger till och kopplar ihop dem på arbetsytan, se [Skapa ett arbetsflöde](/docs/workflows/authoring).

## API

Gör en HTTP-förfrågan till valfri URL.

**Inställningar**:

- **Method** — `GET`, `POST`, `PUT`, `PATCH` eller `DELETE`.
- **URL** — adressen som ska anropas.
- **Headers** — eventuella headers att skicka med.
- **Body** — förfrågans body för `POST` / `PUT` / `PATCH`.

**Outputs**:

- **Success** — utlöses när anropet fungerade (2xx-svar). Skickar vidare status, headers och body.
- **Error** — utlöses vid nätverksfel eller ett svar som inte är 2xx. Skickar vidare felmeddelandet.

Använd den här för: vilket externt API som helst, dina egna adminendpoints, eller varje integration som inte har en egen komponent.

## AI

### Generate Text with AI

Generera ett textsvar utifrån en prompt och valfri JSON-kontext. Komponenten använder projektets konfigurerade standard-LLM-leverantör och faller tillbaka på installationens globala leverantör när det finns en. Leverantörernas autentiseringsuppgifter och endpoints konfigureras centralt; de är inte argument i arbetsflödet.

**Inställningar**:

- **System Instructions** — valfri vägledning om modellens roll, ton och begränsningar.
- **Prompt** — själva uppgiften, som är obligatorisk. Den kan innehålla arbetsflödesvariabler och output från tidigare komponenter.
- **Context** — valfri JSON som du medvetet skickar med förfrågan. Den läggs till efter en uttrycklig markör i slutet av meddelandet och behandlas som opålitlig data genom resten av meddelandet.
- **Temperature** — variation från `0` till `1`. Standard är `0.2` för förutsägbar automation.
- **Maximum Output Tokens** — från `1` till `4096`. Standard är `1024`.

System Instructions, Prompt och serialiserad Context begränsas tillsammans till 50 000 tecken. Leverantörsförfrågan har en maximal varaktighet på 60 sekunder och görs ett försök. Högst tre workflow AI-förfrågningar kan köras samtidigt per projekt.

**Outputs**:

- **Response** — den genererade texten.
- **Provider** och **Model** — konfigurationen som användes för anropet.
- **Total Tokens** och **Completion Tokens** — användningen som leverantören rapporterar.
- **LLM Log ID** — den debiterade AI-loggposten för anropet.
- **Error** — felet kring validering, åtkomst, leverantör, budget, fakturering eller timeout, när det finns ett.

Koppla **Success** till komponenter som ska använda svaret. Koppla **Error** till en uttrycklig reservväg, ett larm eller en loggväg. Komponenten gör en modellförfrågan utan verktygsdefinitioner eller leverantörsspecifika kapacitetsfält: den kan inte fråga OneUptime, anropa API:er eller ändra projektdata på egen hand. Utöver OneUptimes fasta komponentsäkerhetsinstruktioner skickas bara de System Instructions, Prompt och Context du konfigurerar till leverantören, efter att arbetsflödesvariablerna i de fälten lösts upp. Den konfigurerade leverantören/modellen förblir en förtroendegräns eftersom en modell kan ha inbyggda leverantörsstyrda förmågor.

Modellens output är opålitlig text. Granska den innan du skickar kundvänd kommunikation, och använd inte fritt formulerad AI-text ensam för att auktorisera destruktiva arbetsflödesåtgärder. Se [Arbetsflödeskonfiguration & säkerhet](/docs/workflows/configuration) för detaljer om leverantör, utgående trafik, loggning och kostnad.

## Webhook (utgående)

En enklare variant av API-komponenten för "skicka och glöm"-fall. Postar en JSON-body till en URL.

Använd **API** om du behöver läsa svaret. Använd **Webhook** om du bara vill skicka en avisering och gå vidare.

## Slack

Posta ett meddelande i en Slack-kanal.

**Inställningar**:

- **Channel** — kanalens namn. Boten måste redan finnas i den kanalen.
- **Message** — texten som ska skickas. Stöder Slack-formatering.

Koppla först Slack till ditt projekt under **Projektinställningar → Arbetsyta → Slack**. Se [Slack-arbetsyteanslutning](/docs/workspace-connections/slack).

## Microsoft Teams

Posta ett meddelande i en Microsoft Teams-kanal.

**Inställningar**:

- **Team and channel** — var det ska postas.
- **Message** — texten som ska skickas.

Se [Microsoft Teams-arbetsyteanslutning](/docs/workspace-connections/microsoft-teams) för konfiguration.

## Discord

Posta ett meddelande i en Discord-kanal via en inkommande webhook-URL.

## Telegram

Skicka ett meddelande till en Telegram-chatt med hjälp av en bot-token och ett chatt-ID.

## Email

Skicka ett e-postmeddelande via OneUptime.

**Inställningar**:

- **To** — mottagarens e-postadress.
- **Subject** — ämnesraden.
- **Body** — meddelandet i Markdown eller HTML.

E-posten skickas från projektets konfigurerade avsändare — se [SMTP](/docs/emails/smtp).

## Custom Code

Kör en liten bit JavaScript när du behöver något de andra blocken inte klarar.

**Inställningar**:

- **Code** — din JavaScript. Det sista värdet (eller det du returnerar från en asynkron funktion) blir blockets output.
- **Arguments** — namngivna värden du kan skicka in.

**Outputs**: success (ditt returvärde) och error (eventuellt undantag).

Använd den här för: att forma om data mellan två system, göra en liten beräkning, allt som inte förtjänar ett eget block. För tyngre skriptning, använd ett [runbook](/docs/runbooks/index) istället.

## JSON

Konvertera mellan text och JSON.

- **JSON → Text** — gör en sträng av ett JSON-objekt. Användbart när nästa block förväntar sig text.
- **Text → JSON** — tolka en sträng till ett JSON-objekt. Användbart när något kom in som text och du behöver läsa ett fält.

## Conditions

Förgrena utifrån en jämförelse. I panelen **Lägg till komponent** heter det här blocket **If / Else**, under kategorin Conditions.

**Inställningar**:

- **Left value** — oftast ett värde från ett tidigare block.
- **Operator** — `==`, `!=`, `>`, `>=`, `<`, `<=`, `contains`, `starts with`, `ends with`.
- **Right value** — det du jämför mot.

**Outputs**: **Yes** och **No**. Koppla nästa block till den gren du vill ha.

## Delay

Pausa arbetsflödet en bestämd tid innan det fortsätter. Användbart när du behöver ge ett annat system ett ögonblick att hinna ikapp.

## Log

Skriv en rad till körloggen. Ingen extern effekt — den dyker bara upp i arbetsflödets loggar för dig att läsa. Praktiskt vid felsökning.

## Execute Workflow

Anropa ett annat arbetsflöde från det här. Det anropade arbetsflödet körs för sig själv — ditt arbetsflöde fortsätter utan att vänta på att det blir klart.

Använd det här för att dela gemensam logik. Bygg ett "posta till incidentkanalen"-arbetsflöde en gång, och anropa det sedan från vilket annat arbetsflöde som helst som behöver meddela kanalen.

Det finns en säkerhetsgräns så att arbetsflöden inte kan fortsätta anropa varandra i en loop. Se [Arbetsflödeskonfiguration & säkerhet](/docs/workflows/configuration).

## OneUptime-datakomponenter

För varje sorts post i OneUptime (monitorer, incidenter, larm, statussidor, jourpolicyer och många fler) har panelen **Lägg till komponent** de här komponenterna — sök på typens namn. Varje titel genereras utifrån posttypen, så uppsättningen för Monitor lyder:

- **Find One Monitor** — läs en post som matchar frågan.
- **Find Many Monitors** — läs en lista med poster som matchar frågan.
- **Create One Monitor** — lägg till en post utifrån ett JSON-objekt.
- **Create Many Monitors** — lägg till flera poster utifrån en JSON-array.
- **Update One Monitor** — tillämpa skrivpayloaden på en matchande post.
- **Update Many Monitors** — tillämpa skrivpayloaden på matchande poster, upp till Limit.
- **Delete One Monitor** — ta bort en matchande post.
- **Delete Many Monitors** — ta bort matchande poster, upp till Limit.

Samma uppsättning ger dig tre utlösare — **On Create Monitor**, **On Update Monitor** och **On Delete Monitor**. Se [Arbetsflödesutlösare](/docs/workflows/triggers).

En typ erbjuder bara de komponenter dess modell tillåter. En skrivskyddad typ har de två Find-komponenterna och inget mer, så hittar du inte **Delete One Monitor** i panelen tillåter den typen det inte.

Det är så här ett arbetsflöde kan läsa och ändra OneUptime-data. Till exempel: en webhook från ditt CI-verktyg kan använda **Create One Incident** för att öppna en incident med detaljerna om felet.

## Arbeta med poster

Varje fält på en datakomponent utgår från postens egna **kolumnnamn** — samma namn som API:et använder, inte etiketterna på formuläret i instrumentpanelen. ID-kolumnen heter `_id`. Stavningen `id` accepteras som alias överallt där du kan skriva ett kolumnnamn, men `_id` är vad en post ger tillbaka, så det är det du ska läsa på vägen ut:

```json
{ "_id": "00000000-0000-0000-0000-000000000000" }
```

**Query** avgör vilka poster komponenten agerar på. Nycklarna är kolumner, värdena är det som ska matchas:

```json
{ "monitorType": "Website", "isEnabled": true }
```

En fråga är alltid avgränsad till projektet arbetsflödet körs i. Du kan inte nå ett annat projekts poster, och du behöver inte lägga till projektet i frågan själv.

**JSON Object** på Create One, **JSON Array** på Create Many och **Data (JSON Object)** på Update-komponenterna bär fälten som ska skrivas, med samma sorts nycklar:

```json
{ "name": "Checkout API", "monitorType": "Website" }
```

En nyckel som inte är en kolumn ignoreras i stället för att avvisas — körloggen namnger dem den släppte, så kolla där när ett fält inte landar. **Select Fields**, på Find-komponenterna och utlösarna, använder samma kolumnnycklar med värdet `true`: `{"_id": true, "name": true}`.

**Skip** och **Limit** är två sifferfält på Find Many, Update Many och Delete Many — `Skip: 0` med `Limit: 100` tar de första hundra träffarna. Limit är `10` som standard, och på Update Many och Delete Many begränsar den hur många poster som faktiskt skrivs, inte bara hur många som kommer tillbaka. Så `Items Deleted: 10` betyder att tio poster togs bort, inte att tio matchade. Höj Limit när du menar att ändra fler än tio.

**Success** och **Error** rapporterar om frågan gick att köra, inte vad den hittade. En fråga som inte matchar något returnerar `0` och går ändå ut genom Success — det är inte ett misslyckande. För att förgrena på om något matchade, läs det returnerade antalet i ett **If / Else**-block.

## Vilken komponent ska jag använda?

Några snabba regler:

- Finns det ett dedikerat block för det du vill (Slack, Email, en OneUptime-post), använd det — du får snyggare felhantering och tydligare loggar.
- För andra externa API:er, använd **API**.
- För att sammanfatta, klassificera eller utkasta text från arbetsflödesdata du uttryckligen valt, använd **Generate Text with AI**.
- För att forma om data mellan block, använd **Custom Code** eller **JSON**.
- För att göra olika saker beroende på ett värde, använd **Conditions**.

## Läs vidare

- [Arbetsflödesvariabler](/docs/workflows/variables) — skicka data mellan block.
- [Arbetsflödeskörningar & loggar](/docs/workflows/runs-and-logs) — kontrollera vad varje block gjorde under en körning.
- [Arbetsflödeskonfiguration & säkerhet](/docs/workflows/configuration) — gränser, ägare och hemligheter.
