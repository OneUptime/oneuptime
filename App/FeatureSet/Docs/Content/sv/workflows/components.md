# Komponenter

Komponenter är åtgärdsnoderna du placerar efter en utlösare. Var och en gör ett jobb — gör en HTTP-förfrågan, skickar ett Slack-meddelande, förgrenar sig på ett villkor, kör en JavaScript-snutt — och exponerar en eller flera utgångsportar för nästa nod att koppla till.

Den här sidan är en katalog. För kopplingsregler och själva arbetsytan, se [Skapa ett arbetsflöde](/docs/workflows/authoring).

## API

Gör en utgående HTTP-förfrågan till valfri URL.

**Argument**:

- **Method** — `GET`, `POST`, `PUT`, `PATCH`, `DELETE`.
- **URL** — förfrågans URL. Interpoleras.
- **Request Headers** — JSON-objekt med rubriker.
- **Request Body** — JSON- eller text-body för `POST` / `PUT` / `PATCH`.

**Utgångsportar**:

- `success` — triggas när svarsstatus är 2xx. Returvärden: `response-status`, `response-headers`, `response-body`.
- `error` — triggas vid nätverksfel eller icke-2xx-svar. Returvärde: `error`-meddelande.

Använd den här för: vilket tredjeparts-REST-API som helst, dina egna admin-endpoints, lättviktsintegrationer som inte har en dedikerad komponent.

## Webhook (utgående)

En tunn omslagsklass runt API-komponenten för det vanliga "fire and forget"-fallet. Postar en JSON-body till en URL och exponerar ett enda `success` / `error`-par.

Föredra **API** om du behöver läsa svarets body nedströms; föredra **Webhook** om du bara vill notifiera ett annat system.

## Slack

Posta ett meddelande till en Slack-kanal med ditt projekts Slack-arbetsyteanslutning.

**Argument**:

- **Channel name** — kanalen att posta in i. Botten måste redan vara medlem i den kanalen.
- **Message text** — meddelandets innehåll. Interpoleras; stöder Slack mrkdwn.

Konfigurera arbetsyteanslutningen i **Project Settings → Workspace Connections → Slack** först. Se [Slack Workspace Connection](/docs/workspace-connections/slack).

## Microsoft Teams

Posta ett meddelande till en Microsoft Teams-kanal med ditt projekts Teams-anslutning.

**Argument**:

- **Team & channel** — destinationen.
- **Message text** — meddelandets innehåll.

Se [Microsoft Teams Workspace Connection](/docs/workspace-connections/microsoft-teams) för uppkopplingens konfiguration.

## Discord

Posta ett meddelande till en Discord-kanal via en inkommande webhook-URL som konfigureras på komponenten.

## Telegram

Skicka ett meddelande till en Telegram-chatt via en bot-token och chatt-ID som konfigureras på komponenten.

## E-post

Skicka ett e-postmeddelande genom OneUptimes SMTP-konfiguration.

**Argument**:

- **To** — mottagarens e-postadress.
- **Subject** — interpoleras.
- **Body** — Markdown eller HTML.

E-postmeddelandet skickas från projektets konfigurerade avsändaradress (se [SMTP](/docs/emails/smtp)).

## Custom Code

Kör en JavaScript-snutt med tillgång till arbetsflödets variabler och uppströmsnodens returvärden.

**Argument**:

- **Code** — JavaScript-kroppen. Den sista uttryckets värde (eller allt som returneras från `(async () => { ... })()`) blir komponentens returvärde.
- **Arguments** — valfria namngivna värden som skickas in som `args`.

**Utgångsportar**: `success` (returvärde), `error` (fångat undantag).

Använd den här för: transformera en payload mellan två system, göra en liten beräkning som inte förtjänar en egen komponent, anropa logik som bara finns i JS. Tyngre skriptning som måste köras inuti din egen infrastruktur hör hemma i ett [Runbook](/docs/runbooks/index)-Bash- eller JavaScript-steg.

## JSON

Konvertera mellan text och JSON.

- **JSON → Text** — serialisera ett JSON-objekt till en sträng (praktiskt för att pipa in i ett `body`-argument hos en utgående komponent som förväntar sig text).
- **Text → JSON** — parsa en sträng till ett JSON-objekt. Användbart när ett uppströms-API returnerade sin body som text men du behöver läsa ett fält.

## Villkor

Förgrena på en jämförelse. Konfigurera:

- **Left value** — vanligtvis en interpolerad referens som `{{Incident.title}}`.
- **Operator** — `==`, `!=`, `>`, `>=`, `<`, `<=`, `contains`, `starts with`, `ends with`.
- **Right value** — värdet att jämföra mot.

**Utgångsportar**: `yes` och `no`. Koppla resten av arbetsflödet från den gren som matchar din avsikt.

## Schedule (fördröjning)

Pausa ett arbetsflöde under en konfigurerad varaktighet innan det fortsätter. Användbart när du behöver ge ett externt system en stund att stabilisera sig innan du kontrollerar dess tillstånd.

## Log

Skriv en rad till arbetsflödets körningslogg. Ren felsökningshjälp; raden fångas på körningen och syns under **Logs**. Ingen extern sidoeffekt.

## Execute Workflow

Anropa ett annat arbetsflöde som ett delsteg. Det anropade arbetsflödet körs självständigt (fire-and-forget) — kontrollen återgår till anroparen så snart anropet har skickats.

Använd det här för att faktorisera ut delad logik från flera arbetsflöden: bygg ett "post-to-incident-channel"-arbetsflöde en gång och anropa det från varje annat arbetsflöde som behöver notifiera kanalen.

En rekursionsgräns förhindrar arbetsflöden från att anropa varandra i en oändlig loop. Se [Konfiguration & säkerhet](/docs/workflows/configuration).

## Modellkomponenter (CRUD på OneUptime-entiteter)

För varje OneUptime-entitet som stöder arbetsflöden (monitorer, incidenter, larm, statussidor, jour-policyer, etc.) exponerar paletten automatiskt följande komponenter — sökbara efter entitetsnamn:

- **Find One {Entity}** — hämta en enskild post via fråga.
- **Find {Entity}** — hämta en lista av poster via fråga (paginerad).
- **Create {Entity}** — infoga en ny post.
- **Update {Entity}** — uppdatera en post efter ID.
- **Delete {Entity}** — ta bort en post efter ID.
- **Count {Entity}** — räkna poster som matchar en fråga.

Det är så här ett arbetsflöde kan läsa och skriva OneUptime-tillstånd utan att lämna plattformen. Till exempel: en webhook från ditt CI-verktyg anropar **Create Incident** med byggets felmeddelande; eller ett schemalagt arbetsflöde kör **Find Incident** var femte minut och e-postar en sammanfattning.

## Välja rätt komponent

Några snabba tumregler:

- Om en dedikerad komponent finns för det du vill göra (Slack, E-post, en CRUD på en OneUptime-entitet), använd den — den ger dig snyggare felhantering och tydligare loggar än att rulla din egen.
- Om du behöver anropa ett externt HTTP-API som inte har en dedikerad komponent, använd **API**.
- Om du behöver *forma* data mellan två komponenter, använd **Custom Code** eller **JSON**.
- Om du behöver vidta olika åtgärder baserat på ett värde, använd **Villkor**.

## Var läsa vidare

- [Variabler](/docs/workflows/variables) — hur du matar data från en komponent till nästa.
- [Körningar & loggar](/docs/workflows/runs-and-logs) — hur du granskar vad varje komponent returnerade under en körning.
- [Konfiguration & säkerhet](/docs/workflows/configuration) — gränser, ägarskap och hemligheter.
