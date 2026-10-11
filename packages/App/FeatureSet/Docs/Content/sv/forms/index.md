# Formulär – översikt

Ett formulär är en sida som alla med länken kan fylla i, utan ett OneUptime-konto. Varje inlämning skapar något i ditt projekt: en **incident**, för felrapporter, eller en **planerad underhållshändelse**, för ändrings- och underhållsbegäranden. Du bygger formulärets frågor i en dra-och-släpp-redigerare, bestämmer hur svaren blir posten och delar länken med dem som ska använda den.

Använd ett formulär när de som märker ett problem, eller behöver en ändring, inte är de som hanterar dina incidenter och ditt underhåll: supportpersonal, kolleger på en annan avdelning, en butikschef, en kunds driftteam. De öppnar länken, svarar på dina frågor och trycker på **Skicka**. Ditt team får en vanlig incident eller händelse, med svaren i dess fält och en privat anteckning som visar vem som skickade den.

:::cards
- [Skapa ditt första formulär](#skapa-ditt-första-formulär): Från ett tomt formulär till en länk som du kan dela.
- [Bygga ett formulär](/docs/forms/building): Frågor, svarstyper, dolda frågor, mallar och varumärke.
- [Vad en inlämning skapar](/docs/forms/on-submit): Hur svaren och inställningarna blir en incident eller en underhållshändelse.
- [Delning & säkerhet](/docs/forms/sharing-and-security): Länken, IP-tillåtelselistan, hastighetsgränser och felsökning.
:::

## Så fungerar ett formulär

```mermaid title="Från ett ifyllt formulär till en incident eller en underhållshändelse"
flowchart TB
    submitter["Någon med länken,<br/>utan konto"] --> page["Formulärets sida"]
    page -->|Skicka| checks["Skydd och<br/>kontroll av svar"]
    checks --> submission["Inlämning, sparad<br/>med formuläret"]
    submission --> target{"Varje inlämning skapar"}
    target -->|Incident| incident["Incident, dold<br/>på statussidor"]
    target -->|Schemalagt underhåll| event["Underhållshändelse,<br/>dold om inget annat anges"]
    incident --> response["Jourpolicyer och<br/>regler körs"]
    incident --> note["Privat anteckning: vem som skickade,<br/>övriga svar"]
    event --> note
```

Varje begäran passerar först formulärets skydd: dess egen sida, hastighetsgränser, IP-tillåtelselistan och captcha. En inlämning vars svar stämmer sparas och skapar en post, ifylld från svaren, formulärets inställningar under **Vid inlämning** och, för en incident, dess incidentmall. Inget av det som den skapar når en statussida förrän ditt team bestämmer det.

## I korthet

- **En egen produkt**: **Formulär** finns i produktmenyn, på `/dashboard/{projectId}/forms`. Varje formulär har en egen länk, till exempel `https://oneuptime.com/accounts/form/<share-key>` på OneUptime Cloud.
- **Inget konto behövs**: alla med länken kan öppna formuläret och skicka det, utan att logga in.
- **En redigerare, inte en inställningssida**: lägg till egna frågor (korta svar, stycken, listrutor, datum, kryssrutor och mer), fälten för det som formuläret skapar (titel, beskrivning, allvarlighetsgrad, monitorer, etiketter, start och slut), dina anpassade fält och avsändarens namn och e-post. Dra dem i ordning, förhandsgranska formuläret och spara.
- **Du bestämmer var varje värde kommer ifrån**: sidan **Vid inlämning** visar varje fält i den nya incidenten eller händelsen bredvid dess källa: ett svar, ett standardvärde, en inställning som alltid gäller eller incidentmallen.
- **Dold tills någon publicerar den**: incidenter från ett formulär visas aldrig på statussidor eller skickas till prenumeranter när de deklareras; inte heller underhållshändelser, om inte formuläret säger det.
- **Skyddat i lager**: en brytare **Tar emot inlämningar**, en valfri **IP-tillåtelselista**, avvisning av begäranden från andra webbplatser, hastighetsgränser, instansens captcha och storleksgränser för varje svar.
- **Varje inlämning sparas**: sidan **Inlämningar** för varje formulär, och **Formulär → Inlämningar** för alla, listar svaren och länkar till det som varje inlämning skapade.
- **Ditt eget varumärke**: ladda upp en logotyp överst på formulärets sida och en favicon för webbläsarfliken, i avsnittet **Varumärke** på sidan **Bygg**. Fram till dess visar formuläret OneUptimes.
- **Mallar för vanliga fall**: spara namngivna uppsättningar av svar, till exempel **Programavbrott** eller **Planerat underhållsarbete**, så väljer folk en överst i formuläret för att fylla i det, eller öppnar mallens egen länk. Varje mall kan också göra en fråga obligatorisk, valfri eller dold för sitt fall. Ett formulär, och ett bokmärke, räcker för ett helt team.
- **Dolda frågor**: dölj en fråga som ingen borde behöva svara på, till exempel incidentens beskrivning, och låt varje mall svara på den i stället, eller ställa den, i de fall som behöver den.
- **Duplicera formulär**: starta ett formulär för ett annat team utifrån ett som fungerar, med dess frågor, mallar och inställningar.

## Vad ett formulär kan skapa

När du skapar ett formulär väljer du vad **Varje inlämning skapar**. Du kan ändra det senare på formulärets sida **Vid inlämning**.

| Varje inlämning skapar | Används för | Vad som händer |
| --- | --- | --- |
| **Incident** | Felrapporter | En incident deklareras direkt, så att dina jourpolicyer och regler körs och de som har jour får veta det. Den hålls borta från statussidor tills någon som hanterar den publicerar den. |
| **Schemalagt underhåll** | Ändrings- och underhållsbegäranden | En underhållshändelse schemaläggs för det tidsfönster som avsändaren ber om. Om inte formuläret säger något annat hålls den borta från sina statussidor och meddelar inga prenumeranter. |

Formulär börjar med de här två, och fler sorters poster kommer.

## Innan du börjar

- **En plan som omfattar formulär.** På OneUptime Cloud kräver formulär planen **Growth** eller högre. Se [Plan](#plan).
- **Behörighet att skapa formulär.** **Create Form** har projektägare och -administratörer, och de roller som du ger den till. Se [Behörigheter](#behörigheter).
- **För ett incidentformulär, en allvarlighetsgrad.** Varje incident behöver en: från en fråga, från formulärets inställningar eller från dess incidentmall. Utan den avvisas varje inlämning. Se [Vad en inlämning skapar](/docs/forms/on-submit#how-a-submission-becomes-an-incident).

## Skapa ditt första formulär

:::steps
### Skapa formuläret

Öppna **Formulär** från produktmenyn och klicka på **Skapa formulär**. Ge formuläret ett namn (rubriken på dess offentliga sida, unikt i projektet), välj vad **Varje inlämning skapar** och eventuellt en beskrivning i Markdown, som visas överst på den offentliga sidan.

### Bygg dess frågor

Formuläret öppnas på sin sida **Bygg** och frågar redan efter en titel, en beskrivning och vem som skickar (och, för ett underhållsformulär, när underhållet börjar och slutar). Lägg till, ta bort och ordna om frågor, och klicka sedan på **Spara ändringar**. Se [Bygga ett formulär](/docs/forms/building).

### Bestäm vad en inlämning skapar

Under **Vid inlämning** kontrollerar du hur en inlämning blir en incident eller händelse, och klickar på **Redigera inställningar** för att ge standardvärden: en allvarlighetsgrad, en incidentmall, monitorer och etiketter som alltid bifogas, ägare som ska få veta. Se [Vad en inlämning skapar](/docs/forms/on-submit).

### Lägg till mallar om folk rapporterar samma fall

Under **Mallar** sparar du en mall för varje fall som ofta rapporteras: formuläret listar dem ovanför sina frågor, fyller i sig själv från den valda och ställer frågorna som den mallen säger; en fråga som ett fall behöver kan vara obligatorisk i dess mall och dold i de andra. Se [Mallar](/docs/forms/building#templates).

### Dela länken

Under **Dela** kopierar du länken och skickar den till dem som ska använda formuläret. Se [Delning & säkerhet](/docs/forms/sharing-and-security).
:::

> [!IMPORTANT]
> Ett nytt formulär **Tar emot inlämningar** så snart det har skapats, men ingen kan nå det förrän du delar dess länk. Ställ in dess frågor och skydd först.

## Ett formulärs sidor

| Sida | Vad den innehåller |
| --- | --- |
| **Bygg** | Formulärets namn och beskrivning, dess **Varumärke** (logotyp och favicon, hopfällt) och redigeraren: dess frågor, frågepaletten och **Förhandsgranskning**. |
| **Mallar** | Namngivna uppsättningar av svar som man kan börja formuläret från, hur var och en ställer frågorna, den som formuläret öppnas med och varje malls egen länk. |
| **Vid inlämning** | Vad varje inlämning skapar och hur varje fält i den fylls i. **Redigera inställningar** ändrar standardvärdena och det som alltid gäller. |
| **Dela** | **Tar emot inlämningar**, **Delningslänk**, meddelandet efter inlämning och **IP-tillåtelselista**. |
| **Inlämningar** | Varje inlämning via formuläret, den senaste först, med dess svar och det som den skapade. |
| **Duplicera formulär** | Under **Avancerad**: en kopia av formuläret, namngiven åt dig, med dess frågor, mallar, inställningar under Vid inlämning, varumärke, tackmeddelande och IP-tillåtelselista, och en egen länk. Kopian är avstängd från början och öppnas i sin redigerare. |
| **Ta bort formulär** | Borttagning av formuläret, under **Avancerad**. Dess inlämningar tas bort med det; de incidenter och händelser som det skapade gör det inte. |

Avsnittet **Utvecklare** i formulärets meny innehåller dess sidor för Terraform, API och AI-assistenter, precis som för alla andra resurser.

## Formulär och incidentmallar

En mall och ett formulär besparar dig båda att skriva samma incident två gånger, men de tjänar olika personer:

| | Incidentmall | Formulär |
| --- | --- | --- |
| Vem använder det | Ditt team, inloggat i OneUptime | Alla med länken, utan konto |
| Var | **Skapa från mall** i listan med incidenter | En egen sida, på formulärets länk |
| Vad man kan ändra | Varje fält i incidenten, innan den deklareras | Bara svaren på de frågor som du har valt |
| Vad man ser | Dina monitorer, policyer, ägare och varje fält | Formulärets namn, beskrivning och frågor, och bara de alternativ som du erbjuder |
| Statussidor | Det som mallen och deklarationsformuläret säger | Dold tills någon som hanterar den publicerar incidenten |

De fungerar tillsammans. Ge ett incidentformulär en **Incident Mall** på dess sida **Vid inlämning**, så deklareras varje incident som det deklarerar från den mallen: bygg mallen för det som ditt team behöver på incidenten, och formuläret för det som du vill fråga avsändaren om.

## Inlämningar

Ett formulärs sida **Inlämningar** listar varje inlämning via det, den senaste först, med **Inskickad**, **Inlämnad av** (det namn och den e-post som avsändaren angav, eller **Anonym**) och **Skapad**, en länk till den incident eller händelse som den skapade. **Visa svar** visar varje svar som avsändaren gav det. **Formulär → Inlämningar** listar inlämningarna för alla formulär i projektet.

Inlämningar skrivs av formuläret, aldrig för hand, och kan inte redigeras. Om du tar bort en försvinner dess svar och avsändarens namn och e-post från listan; den incident eller händelse som den skapade finns kvar, och det gör även den privata anteckningen på den, som upprepar avsändarens uppgifter och svaren. När incidenten eller händelsen tas bort finns inlämningen kvar, och dess kolumn **Skapad** visar **Borttagen sedan dess**.

> [!WARNING]
> När du tar bort någons personuppgifter räcker det inte att ta bort inlämningen: redigera eller ta bort även den privata anteckningen på den incident eller händelse som den skapade.

## Behörigheter

Formulär låter personer utanför ditt team skapa incidenter och underhållshändelser i ditt projekt, så de hanteras av projektägare och -administratörer, och av de roller som du ger behörigheterna **Form**. De finns i gruppen **Form** i [Behörighetsreferens](/docs/permissions/reference):

| Behörighet | Vad den tillåter | Vem har den som standard |
| --- | --- | --- |
| **Create Form** | Skapa formulär och duplicera dem. | Project Owner, Project Admin |
| **Edit Form** | Ändra ett formulär: dess frågor, varumärke, mallar, inställningar under Vid inlämning, **Tar emot inlämningar**, dess länk och **IP-tillåtelselista**. | Project Owner, Project Admin |
| **Delete Form** | Ta bort ett formulär, och därmed dess inlämningar. | Project Owner, Project Admin |
| **Read Form** | Se formulär, deras frågor, inställningar och länkar. | De ovanstående, plus Project Member, Viewer och rollerna för incidenter och planerat underhåll |
| **Read Form Submission** | Se inlämningarna och deras svar. | Project Owner, Project Admin |
| **Delete Form Submission** | Ta bort inlämningar. | Project Owner, Project Admin |

Inlämningar innehåller det som främlingar har skrivit (namn, e-postadresser och svar som kanske aldrig når posten), så bara projektägare och -administratörer ser dem, om du inte ger **Read Form Submission**. Alla som kan läsa ett formulär kan se och dela dess länk. Att skicka ett formulär kräver ingen behörighet alls. Hur roller och detaljerade behörigheter samverkar kan du läsa i [Användare, team och behörigheter](/docs/permissions/index).

## Plan

På OneUptime Cloud kräver formulär planen **Growth** eller högre, och ett formulärs **IP-tillåtelselista** kräver **Scale**, oavsett om den anges när formuläret skapas eller redigeras senare. Länkarna för ett projekt under planen **Growth**, eller vars prenumeration är obetald, visar meddelandet om att formuläret inte är tillgängligt, och inget skapas.

## Formulär via API:t

Formulär är en vanlig API-resurs på `/api/form`, och deras inlämningar på `/api/form-submission`, som du kan läsa och ta bort men inte skapa eller redigera. [API-referensen](/reference) har de fullständiga formerna för begäranden och svar.

### Frågor och inställningar

Ett formulärs frågor är dess kolumn `fields`, en JSON-lista i den ordning som formuläret ställer dem, och dess inställningar under Vid inlämning är dess `targetSettings`:

```json
{
  "data": {
    "targetType": "Incident",
    "fields": [
      {
        "id": "what",
        "source": "TargetField",
        "targetField": "title",
        "label": "What is wrong?",
        "isRequired": true
      },
      {
        "id": "office",
        "source": "Question",
        "type": "Dropdown",
        "label": "Which office are you in?",
        "dropdownOptions": "Berlin\nLondon",
        "isRequired": false
      },
      {
        "id": "email",
        "source": "Submitter",
        "submitterField": "Email",
        "label": "Your Email",
        "isRequired": true
      }
    ],
    "targetSettings": {
      "incidentSeverityId": "<severity-id>",
      "labelIds": ["<label-id>"]
    }
  }
}
```

Varje fråga har ett eget `id` (bokstäver, siffror, `-` och `_`), en `source`, en `label` och eventuellt `helpText` och `isRequired`:

| `source` | Vad den frågar |
| --- | --- |
| `Question` | En av formulärets egna frågor, besvarad enligt `type`: `Text`, `LongText`, `Markdown`, `Number`, `Dropdown`, `MultiSelectDropdown`, `Boolean`, `Date` eller `DateTime`. En listruta listar sina `dropdownOptions`, en per rad. |
| `TargetField` | Ett fält i det som formuläret skapar, angivet med `targetField`: `title`, `description`, `incidentSeverityId`, `monitors`, `labels` och `impactStartedAt` för en incident; `title`, `description`, `startsAt`, `endsAt`, `monitors`, `statusPages` och `labels` för en underhållshändelse. Ett fält som besvaras genom att välja listar de poster som det erbjuder i `allowedOptionIds`. |
| `TargetCustomField` | Ett av incidentens eller händelsens anpassade fält, angivet med `customFieldId`. |
| `Submitter` | Avsändarens `Name` eller `Email`, angivet med `submitterField`. |

En fråga med `isHidden` satt till `true` visas inte på den offentliga sidan, är aldrig obligatorisk och besvaras bara från den mall som en inlämning anger, om inte den mallen ställer den. `isRequired` och `isHidden` är formulärets standard; varje mall kan ställa en fråga på sitt eget sätt.

### Mallar i API:t

Ett formulärs mallar är dess kolumn `templates`, en JSON-lista i den ordning som formuläret listar dem. Varje mall har ett eget `id` (bokstäver, siffror, `-` och `_`), ett `name` på upp till 100 tecken, unikt i formuläret, och `answers` per fråge-ID, var och ett som en inlämning skickar det: text, ett tal, `true` eller `false`, ett alternativs värde eller en lista med värden vid flerval. `isDefault` satt till `true` gör den till den mall som formuläret öppnas med; ett formulär har högst en, och upp till 50 mallar.

`fieldSettings`, också per fråge-ID, anger hur mallen ställer en fråga: `Required`, `Optional` eller `Hidden`. En fråga som den inte listar (eller listar som `null`) ställs som formuläret ställer den, och en underhållshändelses frågor `startsAt` och `endsAt` kan bara vara `Required`:

```json
{
  "data": {
    "templates": [
      {
        "id": "outage",
        "name": "Application Outage",
        "isDefault": true,
        "answers": {
          "what": "The application is down",
          "office": "Berlin"
        },
        "fieldSettings": {
          "office": "Required",
          "email": "Optional"
        }
      }
    ]
  }
}
```

Frågor, mallar och inställningar kontrolleras varje gång de sparas (från instrumentpanelen, API:t, Terraform eller ett arbetsflöde), och en lista som bryter mot en regel avvisas med ett meddelande som anger vad som är fel. `shareKey`, nyckeln i formulärets länk, anges av OneUptime när formuläret skapas, och att ändra den är vad **Återställ länk** gör.

### Varumärke i API:t

Ett formulärs varumärke är dess `logoFileId`, `logoAltText` och `faviconFileId`. Ladda först upp bilden med `POST /api/file` i formulärets projekt (med en API-nyckel för det projektet, eller inloggad som medlem i det med dess ID i headern `tenantid`), skicka dess `name`, dess `fileType`, till exempel `image/png`, och byten som base64 i `file`, och ange det `_id` som returneras. En uppladdning till ett projekt som du inte är medlem i avvisas med "You can upload files only to a project you are a member of." Varje uppladdning är privat: `isPublic` anges av OneUptime, oavsett vad begäran säger. Varje bild kontrolleras när formuläret sparas: den måste ha laddats upp i formulärets projekt, och en logotyp måste vara en PNG-, JPEG-, GIF-, WebP- eller SVG-bild på högst 512 KB, en favicon en av dem eller en ICO på högst 128 KB. Sätt ett ID till `null` för att gå tillbaka till OneUptimes. Se [Varumärke](/docs/forms/building#branding).

### Läsa inlämningar

Så här listar du ett formulärs inlämningar:

```bash
curl -X POST https://oneuptime.com/api/form-submission/get-list \
  -H "apikey: $ONEUPTIME_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "query": { "formId": "<form-id>" },
    "select": { "submitterName": true, "submitterEmail": true, "answers": true, "incidentId": true, "scheduledMaintenanceId": true, "createdAt": true },
    "limit": 50,
    "skip": 0
  }'
```

### Arbetsflöden

Formulär har de genererade arbetsflödeskomponenterna: **On Create Form**, **On Update Form** och så vidare. Använd **On Create Incident** eller **On Create Scheduled Maintenance** för att agera på det som ett formulär har skapat.

### Den offentliga sidans egna slutpunkter

Den offentliga sidan pratar med två vägar som inte kräver någon API-nyckel: `GET /api/form/public/<shareKey>`, som returnerar formulärets namn, beskrivning och frågor (och, när det har dem, dess logotyp, logotypens alternativtext och dess favicon, bilderna som base64, samt dess mallar med deras svar på de frågor som sidan ställer), och `POST /api/form/public/<shareKey>/submit`, som skickar formuläret och i `templateId` anger den mall som avsändaren började från. Det är sidans egna slutpunkter, inte ett API att bygga vidare på: varje anrop passerar formulärets skydd (se [Delning & säkerhet](/docs/forms/sharing-and-security)), och de ändras med sidan. Använd `POST /api/incident` med en API-nyckel för att skapa incidenter från din egen kod: se [Deklarera en incident](/docs/incidents/declaring-incidents).

## Vart dina incidentformulär tog vägen

Formulär ersätter **Incident Forms**, som fanns under **Incidenter → Inställningar → Formulär**. Varje incidentformulär flyttades över vid uppgraderingen, med samma länk och samma inlämningar:

- Dess frågor blev redigerarens: titeln, beskrivningen om den inte var dold, allvarlighetsgraden när avsändaren kunde välja den, varje anpassat fält som det frågade efter (i de anpassade fältens ordning), och **Your Name** och **Your Email**, obligatoriska om inte formuläret tillät anonyma rapporter.
- Dess allvarlighetsgrad och incidentmall blev dess standardvärden under **Vid inlämning**.
- Dess brytare **Aktiverad**, dess lyckat-meddelande och dess **IP-tillåtelselista** är oförändrade, och det är även dess länk: gamla länkar `/accounts/incident-form/<share-key>` öppnar formuläret på dess nya adress.
- Behörigheterna **Incident Form** blev behörigheterna **Form**, för varje team och varje API-nyckel som hade dem.

De gamla sidorna i instrumentpanelen omdirigerar till de nya.

## Nästa steg

:::cards
- [Bygga ett formulär](/docs/forms/building): Frågor, svarstyper, länkade fält, anpassade fält och förhandsgranskningen.
- [Vad en inlämning skapar](/docs/forms/on-submit): Hur svaren och inställningarna under Vid inlämning blir en incident eller en underhållshändelse.
- [Delning & säkerhet](/docs/forms/sharing-and-security): Länken, IP-tillåtelselistan, hastighetsgränser, captcha och felsökning.
- [Deklarera en incident](/docs/incidents/declaring-incidents): De andra sätten att deklarera incidenter.
:::
