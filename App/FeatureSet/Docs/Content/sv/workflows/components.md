# Komponenter

Komponenter är byggstenarna du lägger till efter utlösaren. Var och en gör en sak — skickar ett meddelande, anropar ett API, kontrollerar ett villkor — och kopplas till det som kommer härnäst.

Den här sidan är katalogen. För hur du lägger till och kopplar dem på arbetsytan, se [Skapa ett arbetsflöde](/docs/workflows/authoring).

## API

Gör en HTTP-förfrågan till valfri URL.

**Inställningar**:

- **Method** — `GET`, `POST`, `PUT`, `PATCH` eller `DELETE`.
- **URL** — adressen att anropa.
- **Headers** — eventuella headers att skicka.
- **Body** — förfrågans body för `POST` / `PUT` / `PATCH`.

**Outputs**:

- **Success** — utlöses när anropet fungerade (2xx-svar). Skickar vidare status, headers och body.
- **Error** — utlöses vid nätverksfel eller ett icke-2xx-svar. Skickar vidare felmeddelandet.

Använd den för: alla externa API:er, dina egna administrationsendpoints, eller integrationer som inte har sin egen komponent.

## AI

### Generate Text with AI

Generera ett textsvar från en prompt och valfri JSON-kontext. Komponenten använder projektets konfigurerade standard-LLM-leverantör, och faller tillbaka på installationens globala leverantör när en sådan finns tillgänglig. Leverantörens autentiseringsuppgifter och slutpunkter konfigureras centralt; de är inte arbetsflödesargument.

**Inställningar**:

- **System Instructions** — valfri vägledning för modellens roll, ton och begränsningar.
- **Prompt** — den obligatoriska uppgiften. Den kan innehålla arbetsflödesvariabler och utdata från tidigare komponenter.
- **Context** — valfri JSON som du medvetet inkluderar med förfrågan. Den läggs till efter en explicit slut-på-meddelande-förtroendemarkör och behandlas som opålitlig data genom resten av meddelandet.
- **Temperature** — variation från `0` till `1`. Standardvärdet är `0.2` för förutsägbar automatisering.
- **Maximum Output Tokens** — från `1` till `4096`. Standardvärdet är `1024`.

De sammanslagna System Instructions, Prompt och serialiserad Context är begränsade till 50 000 tecken. Leverantörsförfrågan har en maximal varaktighet på 60 sekunder och görs ett enda försök. Som mest tre arbetsflödes-AI-förfrågningar kan köras samtidigt per projekt.

**Outputs**:

- **Response** — den genererade texten.
- **Provider** och **Model** — konfigurationen som användes för anropet.
- **Total Tokens** och **Completion Tokens** — användning rapporterad av leverantören.
- **LLM Log ID** — den mätta AI-loggposten för anropet.
- **Error** — validerings-, åtkomst-, leverantörs-, budget-, faktura- eller timeout-felet, när det finns.

Koppla **Success** till komponenter som ska använda svaret. Koppla **Error** till en explicit fallback, varning eller loggväg. Komponenten gör en enda modellförfrågan utan verktygsdefinitioner eller leverantörsspecifika kapacitetsfält: den kan inte fråga OneUptime, anropa API:er eller ändra projektdata på egen hand. Förutom OneUptimes fasta komponentsäkerhetsinstruktioner skickas bara de System Instructions, Prompt och Context du konfigurerar till leverantören, efter att arbetsflödesvariabler i de fälten har lösts upp. Den konfigurerade leverantören/modellen förblir en förtroendegräns eftersom en modell kan ha inneboende leverantörshanterade kapaciteter.

Modellutdata är opålitlig text. Granska den innan du skickar kundvänd kommunikation, och använd inte fritextgenererad AI-text ensam för att godkänna destruktiva arbetsflödesåtgärder. Se [Konfiguration & säkerhet](/docs/workflows/configuration) för detaljer om leverantör, utgående trafik, loggning och kostnad.

## Webhook (utgående)

En enklare version av API-komponenten för "skicka och glöm"-fall. Postar en JSON-body till en URL.

Använd **API** om du behöver läsa svaret. Använd **Webhook** om du bara vill skicka en notis och gå vidare.

## Slack

Posta ett meddelande till en Slack-kanal.

**Inställningar**:

- **Channel** — kanalnamnet. Boten måste redan vara med i den kanalen.
- **Message** — texten som ska skickas. Stöder Slack-formatering.

Koppla först Slack till ditt projekt under **Project Settings → Workspace → Slack**. Se [Slack Workspace Connection](/docs/workspace-connections/slack).

## Microsoft Teams

Posta ett meddelande till en Microsoft Teams-kanal.

**Inställningar**:

- **Team and channel** — var meddelandet ska postas.
- **Message** — texten som ska skickas.

Se [Microsoft Teams Workspace Connection](/docs/workspace-connections/microsoft-teams) för konfiguration.

## Discord

Posta ett meddelande till en Discord-kanal via en inkommande webhook-URL.

## Telegram

Skicka ett meddelande till en Telegram-chatt med ett bot-token och chatt-ID.

## E-post

Skicka ett e-postmeddelande via OneUptime.

**Inställningar**:

- **To** — mottagarens e-postadress.
- **Subject** — ämnesraden.
- **Body** — meddelandet i Markdown eller HTML.

E-posten skickas från projektets konfigurerade avsändare — se [SMTP](/docs/emails/smtp).

## Custom Code

Kör en liten bit JavaScript när du behöver något som de andra blocken inte kan göra.

**Inställningar**:

- **Code** — din JavaScript. Det sista värdet (eller det du returnerar från en async-funktion) blir blockets utdata.
- **Arguments** — namngivna värden du kan skicka in.

**Outputs**: success (ditt returvärde) och error (eventuellt undantag).

Använd det för: omforma data mellan två system, göra en liten beräkning, eller något som inte förtjänar sitt eget block. För tyngre skriptning, använd en [Runbook](/docs/runbooks/index) istället.

## JSON

Konvertera mellan text och JSON.

- **JSON → Text** — gör om ett JSON-objekt till en sträng. Användbart när nästa block förväntar sig text.
- **Text → JSON** — tolka en sträng till ett JSON-objekt. Användbart när något kom som text och du behöver läsa ett fält.

## Conditions

Förgrena baserat på en jämförelse. I panelen **Add Component** kallas det här blocket **If / Else**, under kategorin Conditions.

**Inställningar**:

- **Left value** — vanligtvis ett värde från ett tidigare block.
- **Operator** — `==`, `!=`, `>`, `>=`, `<`, `<=`, `contains`, `starts with`, `ends with`.
- **Right value** — vad det ska jämföras mot.

**Outputs**: **Yes** och **No**. Koppla nästa block till vilken gren du vill.

## Delay

Pausa arbetsflödet en bestämd tid innan det fortsätter. Användbart när du behöver ge ett annat system en stund att hinna ikapp.

## Log

Skriv en rad till körningsloggen. Ingen extern effekt — den dyker bara upp i arbetsflödets loggar så att du kan läsa den. Praktiskt för felsökning.

## Execute Workflow

Anropa ett annat arbetsflöde från detta. Det anropade arbetsflödet körs på egen hand — ditt arbetsflöde fortsätter utan att vänta på att det ska bli klart.

Använd det för att dela gemensam logik. Bygg ett "posta till incidentkanal"-arbetsflöde en gång, och anropa det sedan från vilket annat arbetsflöde som helst som behöver meddela kanalen.

Det finns en säkerhetsgräns så att arbetsflöden inte kan fortsätta anropa varandra i en loop. Se [Konfiguration & säkerhet](/docs/workflows/configuration).

## OneUptime-datakomponenter

För varje sorts post i OneUptime (monitorer, incidenter, larm, statussidor, jourpolicyer och många fler) har panelen **Add Component** dessa komponenter — sök på typens namn. Varje titel genereras från posttypen, så för Monitor-uppsättningen blir det:

- **Find One Monitor** — läs en post som matchar frågan.
- **Find Many Monitors** — läs en lista med poster som matchar frågan.
- **Create One Monitor** — lägg till en post från ett JSON-objekt.
- **Create Many Monitors** — lägg till flera poster från en JSON-array.
- **Update One Monitor** — tillämpa skrivnyttolasten på en matchande post.
- **Update Many Monitors** — tillämpa skrivnyttolasten på matchande poster, upp till Limit.
- **Delete One Monitor** — ta bort en matchande post.
- **Delete Many Monitors** — ta bort matchande poster, upp till Limit.

Samma uppsättning ger dig tre utlösare — **On Create Monitor**, **On Update Monitor** och **On Delete Monitor**. Se [Triggers](/docs/workflows/triggers).

En typ erbjuder bara de komponenter dess modell tillåter. En skrivskyddad typ har bara de två Find-komponenterna och inget annat, så om du inte hittar **Delete One Monitor** i panelen tillåter den typen det inte.

Det är så här ett arbetsflöde kan läsa och ändra OneUptime-data. Till exempel: en webhook från ditt CI-verktyg kan använda **Create One Incident** för att öppna en incident med felinformationen.

## Arbeta med poster

Varje fält på en datakomponent är nyckelbaserat på postens egna **kolumn**-namn — samma namn som API:et använder, inte etiketterna på instrumentpanelsformuläret. ID-kolumnen är `_id`. Stavningen `id` accepteras som ett alias överallt där du kan skriva ett kolumnnamn, men `_id` är vad en post ger tillbaka, så det är vad du ska läsa på vägen ut:

```json
{ "_id": "00000000-0000-0000-0000-000000000000" }
```

**Query** avgör vilka poster komponenten agerar på. Nycklar är kolumner, värden är vad som ska matchas:

```json
{ "monitorType": "Website", "isEnabled": true }
```

En fråga är alltid avgränsad till projektet arbetsflödet körs i. Du kan inte nå ett annat projekts poster, och du behöver inte lägga till projektet i frågan själv.

**JSON Object** på Create One, **JSON Array** på Create Many, och **Data (JSON Object)** på Update-komponenterna bär fälten att skriva, nyckelbaserade på samma sätt:

```json
{ "name": "Checkout API", "monitorType": "Website" }
```

En nyckel som inte är en kolumn ignoreras istället för att avvisas — körningsloggen namnger de som släpptes, så kolla där när ett fält inte hamnar rätt. **Select Fields**, på Find-komponenterna och utlösarna, använder samma kolumnnycklar med `true`-värden: `{"_id": true, "name": true}`.

**Skip** och **Limit** är två sifferfält på Find Many, Update Many och Delete Many — `Skip: 0` med `Limit: 100` tar de första hundra matchningarna. Limit är som standard `10`, och på Update Many och Delete Many begränsar den hur många poster som faktiskt skrivs, inte bara hur många som kommer tillbaka. Så `Items Deleted: 10` betyder att tio poster raderades, inte att tio matchade. Höj Limit när du menar att ändra fler än tio.

**Success** och **Error** rapporterar om frågan kördes, inte vad den hittade. En fråga som inte matchar något returnerar `0` och lämnar ändå genom Success — det är inte ett misslyckande. För att förgrena baserat på om något matchade, läs det returnerade antalet i ett **If / Else**-block.

## Vilken komponent ska jag använda?

Några snabba regler:

- Om det finns ett dedikerat block för det du vill (Slack, E-post, en OneUptime-post), använd det — du får snyggare felhantering och tydligare loggar.
- För alla andra externa API:er, använd **API**.
- För att sammanfatta, klassificera eller utkasta text från explicit valda arbetsflödesdata, använd **Generate Text with AI**.
- För att omforma data mellan block, använd **Custom Code** eller **JSON**.
- För att vidta olika åtgärder baserat på ett värde, använd **Conditions**.

## Läs vidare

- [Variabler](/docs/workflows/variables) — skicka data mellan block.
- [Körningar & loggar](/docs/workflows/runs-and-logs) — kontrollera vad varje block gjorde under en körning.
- [Konfiguration & säkerhet](/docs/workflows/configuration) — gränser, ägare och hemligheter.
