# Workflow-komponenter

Komponenter er de handlingsnoder, du placerer efter en trigger. Hver enkelt udfører ét job — laver et HTTP-kald, sender en Slack-besked, forgrener på en betingelse, kører en JavaScript-snippet — og eksponerer en eller flere output-porte, som den næste node kan forbinde til.

Denne side er et katalog. For koblingsregler og selve lærredet, se [Opret et workflow](/docs/workflows/authoring).

## API

Lav en udgående HTTP-anmodning til en hvilken som helst URL.

**Argumenter**:

- **Method** — `GET`, `POST`, `PUT`, `PATCH`, `DELETE`.
- **URL** — anmodnings-URL'en. Interpoleret.
- **Request Headers** — JSON-objekt med headers.
- **Request Body** — JSON- eller tekstbody til `POST` / `PUT` / `PATCH`.

**Output-porte**:

- `success` — udløses, når responsstatus er 2xx. Returværdier: `response-status`, `response-headers`, `response-body`.
- `error` — udløses ved en netværksfejl eller en ikke-2xx-respons. Returværdi: `error`-besked.

Brug denne til: ethvert tredjeparts-REST-API, dine egne admin-endpoints, lette integrationer, der ikke har en dedikeret komponent.

## Webhook (udgående)

En tynd wrapper omkring API-komponenten til det almindelige "fire and forget"-tilfælde. Sender en JSON-body til en URL og eksponerer ét enkelt `success` / `error`-par.

Foretræk **API**, hvis du har brug for at læse svar-bodyen nedstrøms; foretræk **Webhook**, hvis du blot vil notificere et andet system.

## Slack

Send en besked til en Slack-kanal ved hjælp af projektets Slack-workspace-forbindelse.

**Argumenter**:

- **Channel name** — kanalen, der skal postes i. Botten skal allerede være medlem af kanalen.
- **Message text** — bodyen. Interpoleret; understøtter Slack mrkdwn.

Konfigurér workspace-forbindelsen i **Project Settings → Workspace Connections → Slack** først. Se [Slack Workspace Connection](/docs/workspace-connections/slack).

## Microsoft Teams

Send en besked til en Microsoft Teams-kanal ved hjælp af projektets Teams-forbindelse.

**Argumenter**:

- **Team & channel** — destinationen.
- **Message text** — bodyen.

Se [Microsoft Teams Workspace Connection](/docs/workspace-connections/microsoft-teams) for opsætning af forbindelsen.

## Discord

Send en besked til en Discord-kanal via en indkommende webhook-URL, der konfigureres på komponenten.

## Telegram

Send en besked til en Telegram-chat via et bot-token og chat-ID konfigureret på komponenten.

## E-mail

Send en e-mail gennem OneUptimes SMTP-konfiguration.

**Argumenter**:

- **To** — modtagerens e-mailadresse.
- **Subject** — interpoleret.
- **Body** — Markdown eller HTML.

E-mailen sendes fra projektets konfigurerede afsenderadresse (se [SMTP](/docs/emails/smtp)).

## Custom Code

Kør en JavaScript-snippet med adgang til workflowets variabler og den opstrøms nodes returværdier.

**Argumenter**:

- **Code** — JavaScript-bodyen. Værdien af det sidste udtryk (eller hvad der returneres fra `(async () => { ... })()`) bliver komponentens returværdi.
- **Arguments** — valgfri navngivne værdier, der sendes ind som `args`.

**Output-porte**: `success` (returværdi), `error` (fanget exception).

Brug denne til: at transformere en payload mellem to systemer, lave en lille beregning, der ikke fortjener sin egen komponent, kalde JS-only-logik. Tungere scripting, der skal køre inde i din egen infrastruktur, hører hjemme i et Bash- eller JavaScript-trin i et [Runbook](/docs/runbooks/index).

## JSON

Konvertér mellem tekst og JSON.

- **JSON → Text** — serialisér et JSON-objekt til en streng (handy til at pipe ind i et `body`-argument på en udgående komponent, der forventer tekst).
- **Text → JSON** — parse en streng til et JSON-objekt. Nyttigt, når et opstrøms-API returnerede sin body som tekst, men du har brug for at læse et felt.

## Betingelser

Forgren på en sammenligning. Konfigurér:

- **Left value** — typisk en interpoleret reference som `{{Incident.title}}`.
- **Operator** — `==`, `!=`, `>`, `>=`, `<`, `<=`, `contains`, `starts with`, `ends with`.
- **Right value** — værdien at sammenligne mod.

**Output-porte**: `yes` og `no`. Træk resten af workflowet fra den gren, der matcher din hensigt.

## Tidsplan (forsinkelse)

Pause et workflow i en konfigureret varighed, før det fortsætter. Nyttigt, når du har brug for at give et eksternt system et øjeblik til at falde til ro, før du tjekker dets tilstand.

## Log

Skriv en linje til workflow-kørselsloggen. Ren debugging-hjælp; linjen opfanges på kørslen og er synlig under **Logs**. Ingen ekstern sideeffekt.

## Execute Workflow

Kald et andet workflow som et undertrin. Det kaldte workflow kører selvstændigt (fire-and-forget) — kontrol returnerer til kalderen, så snart kaldet er afsendt.

Brug dette til at folde fælles logik ud af flere workflows: byg ét "post-to-incident-channel"-workflow én gang, og kald det fra hvert andet workflow, der har brug for at notificere kanalen.

En rekursionsgrænse forhindrer workflows i at kalde hinanden i en uendelig løkke. Se [Workflow-konfiguration & sikkerhed](/docs/workflows/configuration).

## Model-komponenter (CRUD på OneUptime-entiteter)

For hver OneUptime-entitet, der understøtter workflows (monitorer, hændelser, alarmer, statussider, on-call-policies osv.), eksponerer paletten automatisk følgende komponenter — søgbare på entitetsnavnet:

- **Find One {Entity}** — hent en enkelt post via forespørgsel.
- **Find {Entity}** — hent en liste af poster via forespørgsel (paginerede).
- **Create {Entity}** — indsæt en ny post.
- **Update {Entity}** — opdatér én post ud fra ID.
- **Delete {Entity}** — slet én post ud fra ID.
- **Count {Entity}** — tæl poster, der matcher en forespørgsel.

Det er sådan, et workflow kan læse og skrive OneUptime-tilstand uden at forlade platformen. For eksempel: en webhook fra dit CI-værktøj kalder **Create Incident** med buildets fejlmeddelelse; eller et planlagt workflow kører **Find Incident** hvert femte minut og sender en sammenfatning på mail.

## Vælg den rigtige komponent

Et par tommelfingerregler:

- Hvis der findes en dedikeret komponent til det, du vil gøre (Slack, E-mail, en CRUD på en OneUptime-entitet), så brug den — den giver dig pænere fejlhåndtering og klarere logfiler end at rulle din egen.
- Hvis du skal kalde et eksternt HTTP-API uden en dedikeret komponent, så brug **API**.
- Hvis du skal *forme* data mellem to komponenter, så brug **Custom Code** eller **JSON**.
- Hvis du skal tage forskellige handlinger ud fra en værdi, så brug **Conditions**.

## Læs videre

- [Workflow-variabler](/docs/workflows/variables) — hvordan du fodrer data fra én komponent ind i den næste.
- [Workflow-kørsler & logfiler](/docs/workflows/runs-and-logs) — hvordan du inspicerer, hvad hver komponent returnerede under en kørsel.
- [Workflow-konfiguration & sikkerhed](/docs/workflows/configuration) — grænser, ejerskab og hemmeligheder.
