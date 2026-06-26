# Komponenter

Komponenter är byggstenarna du lägger till efter utlösaren. Var och en gör en sak — skickar ett meddelande, anropar ett API, kontrollerar ett villkor — och kopplas till det som kommer härnäst.

Den här sidan är katalogen. För hur du drar, släpper och kopplar dem på arbetsytan, se [Skapa ett arbetsflöde](/docs/workflows/authoring).

## API

Gör en HTTP-förfrågan till valfri URL.

**Inställningar**:

- **Method** — `GET`, `POST`, `PUT`, `PATCH` eller `DELETE`.
- **URL** — adressen att anropa.
- **Headers** — eventuella headers att skicka.
- **Body** — förfrågans body för `POST` / `PUT` / `PATCH`.

**Utdata**:

- **Success** — utlöses när anropet fungerade (2xx-svar). Skickar vidare status, headers och body.
- **Error** — utlöses vid nätverksfel eller ett icke-2xx-svar. Skickar vidare felmeddelandet.

Använd den för: alla externa API:er, dina egna administrationsendpoints, eller integrationer som inte har sin egen komponent.

## Webhook (utgående)

En enklare version av API-komponenten för "skicka och glöm"-fall. Postar en JSON-body till en URL.

Använd **API** om du behöver läsa svaret. Använd **Webhook** om du bara vill skicka en notis och gå vidare.

## Slack

Posta ett meddelande till en Slack-kanal.

**Inställningar**:

- **Channel** — kanalnamnet. Boten måste redan vara med i den kanalen.
- **Message** — texten som ska skickas. Stöder Slack-formatering.

Koppla först Slack till ditt projekt under **Project Settings → Workspace Connections → Slack**. Se [Slack Workspace Connection](/docs/workspace-connections/slack).

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

**Utdata**: success (ditt returvärde) och error (eventuellt undantag).

Använd det för: omforma data mellan två system, göra en liten beräkning, eller något som inte förtjänar sitt eget block. För tyngre skriptning, använd en [Runbook](/docs/runbooks/index) istället.

## JSON

Konvertera mellan text och JSON.

- **JSON → Text** — gör om ett JSON-objekt till en sträng. Användbart när nästa block förväntar sig text.
- **Text → JSON** — tolka en sträng till ett JSON-objekt. Användbart när något kom som text och du behöver läsa ett fält.

## Conditions

Förgrena baserat på en jämförelse.

**Inställningar**:

- **Left value** — vanligtvis ett värde från ett tidigare block.
- **Operator** — `==`, `!=`, `>`, `>=`, `<`, `<=`, `contains`, `starts with`, `ends with`.
- **Right value** — vad det ska jämföras mot.

**Utdata**: **Yes** och **No**. Koppla nästa block till vilken gren du vill.

## Delay

Pausa arbetsflödet en bestämd tid innan det fortsätter. Användbart när du behöver ge ett annat system en stund att hinna ikapp.

## Log

Skriv en rad till körningsloggen. Ingen extern effekt — den dyker bara upp i arbetsflödets loggar så att du kan läsa den. Praktiskt för felsökning.

## Execute Workflow

Anropa ett annat arbetsflöde från detta. Det anropade arbetsflödet körs på egen hand — ditt arbetsflöde fortsätter utan att vänta på att det ska bli klart.

Använd det för att dela gemensam logik. Bygg ett "posta till incidentkanal"-arbetsflöde en gång, och anropa det sedan från vilket annat arbetsflöde som helst som behöver meddela kanalen.

Det finns en säkerhetsgräns så att arbetsflöden inte kan fortsätta anropa varandra i en loop. Se [Konfiguration & säkerhet](/docs/workflows/configuration).

## OneUptime-datakomponenter

För varje sorts post i OneUptime (monitorer, incidenter, larm, statussidor, jourpolicyer och många fler) har paletten dessa komponenter — sök på typens namn:

- **Find One** — hämta en post efter ID eller filter.
- **Find** — hämta en lista med poster.
- **Create** — lägg till en ny post.
- **Update** — ändra en post.
- **Delete** — ta bort en post.
- **Count** — räkna poster som matchar ett filter.

Det är så ett arbetsflöde kan läsa och ändra OneUptime-data. Till exempel: en webhook från ditt CI-verktyg kan använda **Create Incident** för att öppna en incident med felinformationen.

## Vilken komponent ska jag använda?

Några snabba regler:

- Om det finns ett dedikerat block för det du vill (Slack, E-post, en OneUptime-post), använd det — du får snyggare felhantering och tydligare loggar.
- För alla andra externa API:er, använd **API**.
- För att omforma data mellan block, använd **Custom Code** eller **JSON**.
- För att vidta olika åtgärder baserat på ett värde, använd **Conditions**.

## Läs vidare

- [Variabler](/docs/workflows/variables) — skicka data mellan block.
- [Körningar & loggar](/docs/workflows/runs-and-logs) — kontrollera vad varje block gjorde under en körning.
- [Konfiguration & säkerhet](/docs/workflows/configuration) — gränser, ägare och hemligheter.
