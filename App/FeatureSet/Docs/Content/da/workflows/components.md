# Komponenter

Komponenter er de byggesten, du tilføjer efter triggeren. Hver enkelt gør én ting — send en besked, kald et API, tjek en betingelse — og forbinder til det, der kommer bagefter.

Denne side er kataloget. For hvordan du trækker, slipper og forbinder dem på lærredet, se [Opbygning af et workflow](/docs/workflows/authoring).

## API

Foretag en HTTP-anmodning til en hvilken som helst URL.

**Indstillinger**:

- **Method** — `GET`, `POST`, `PUT`, `PATCH` eller `DELETE`.
- **URL** — adressen, der skal kaldes.
- **Headers** — eventuelle headers, der skal sendes.
- **Body** — anmodningens body til `POST` / `PUT` / `PATCH`.

**Outputs**:

- **Succes** — udløses, når kaldet lykkedes (2xx-svar). Sender status, headers og body videre.
- **Fejl** — udløses ved en netværksfejl eller et ikke-2xx-svar. Sender fejlbeskeden videre.

Brug denne til: ethvert eksternt API, dine egne admin-endpoints eller enhver integration, som ikke har sin egen komponent.

## Webhook (udgående)

En enklere version af API-komponenten til "fire and forget"-tilfælde. Poster en JSON-body til en URL.

Brug **API**, hvis du har brug for at læse svaret. Brug **Webhook**, hvis du bare vil sende en notifikation og gå videre.

## Slack

Post en besked til en Slack-kanal.

**Indstillinger**:

- **Kanal** — kanalens navn. Bot'en skal allerede være i den kanal.
- **Besked** — den tekst, der skal sendes. Understøtter Slack-formatering.

Forbind først Slack til dit projekt under **Projektindstillinger → Arbejdsområde → Slack**. Se [Slack Workspace-forbindelse](/docs/workspace-connections/slack).

## Microsoft Teams

Post en besked til en Microsoft Teams-kanal.

**Indstillinger**:

- **Team and channel** — hvor der skal postes.
- **Besked** — den tekst, der skal sendes.

Se [Microsoft Teams Workspace-forbindelse](/docs/workspace-connections/microsoft-teams) for opsætning.

## Discord

Post en besked til en Discord-kanal via en indkommende webhook-URL.

## Telegram

Send en besked til en Telegram-chat ved hjælp af et bot-token og chat-ID.

## Email

Send en e-mail gennem OneUptime.

**Indstillinger**:

- **Til** — modtagerens e-mailadresse.
- **Emne** — emnelinjen.
- **Body** — beskeden i Markdown eller HTML.

E-mailen sendes fra dit projekts konfigurerede afsender — se [SMTP](/docs/emails/smtp).

## Custom Code

Kør et lille stykke JavaScript, når du har brug for noget, de andre blokke ikke kan.

**Indstillinger**:

- **Kode** — din JavaScript. Den sidste værdi (eller det, du returnerer fra en async-funktion) bliver blokkens output.
- **Arguments** — navngivne værdier, du kan sende ind.

**Outputs**: success (din returværdi) og error (enhver undtagelse).

Brug denne til: at omforme data mellem to systemer, lave en lille beregning, eller noget der ikke fortjener sin egen blok. Til tungere scripting kan du i stedet bruge en [Runbook](/docs/runbooks/index).

## JSON

Konvertér mellem tekst og JSON.

- **JSON → Text** — gør et JSON-objekt til en streng. Nyttigt, når den næste blok forventer tekst.
- **Text → JSON** — parse en streng til et JSON-objekt. Nyttigt, når noget kom som tekst, og du skal læse et felt.

## Conditions

Forgren ud fra en sammenligning.

**Indstillinger**:

- **Left value** — typisk en værdi fra en tidligere blok.
- **Operator** — `==`, `!=`, `>`, `>=`, `<`, `<=`, `contains`, `starts with`, `ends with`.
- **Right value** — det, der skal sammenlignes med.

**Outputs**: **Ja** og **Nej**. Forbind de næste blokke til den gren, du vil have.

## Delay

Sæt workflowet på pause i et bestemt stykke tid, før det fortsætter. Nyttigt, når du har brug for at give et andet system et øjeblik til at indhente det.

## Log

Skriv en linje til kørselsloggen. Ingen ekstern effekt — den dukker bare op i workflowets logfiler, så du kan læse den. Praktisk til debugging.

## Execute Workflow

Kald et andet workflow fra dette. Det kaldte workflow kører for sig selv — dit workflow fortsætter uden at vente på, at det afsluttes.

Brug dette til at dele almindelig logik. Byg ét "post til hændelseskanal"-workflow, og kald det så fra ethvert andet workflow, der har brug for at notificere kanalen.

Der er en sikkerhedsgrænse, så workflows ikke kan blive ved med at kalde hinanden i en løkke. Se [Konfiguration & sikkerhed](/docs/workflows/configuration).

## OneUptime data-komponenter

For hver slags post i OneUptime (monitorer, hændelser, alarmer, statussider, vagtpolitikker og mange flere) har paletten disse komponenter — søg på typens navn. Titlerne dannes ud fra typens navn, så sættet for Monitor ser sådan ud:

- **Find One Monitor** — hent én post, der matcher filteret.
- **Find Many Monitors** — hent en liste af poster, der matcher filteret.
- **Create One Monitor** — tilføj én post ud fra et JSON-objekt.
- **Create Many Monitors** — tilføj flere poster ud fra et JSON-array.
- **Update One Monitor** — ændr én post, der matcher filteret.
- **Update Many Monitors** — ændr de poster, der matcher filteret, op til Limit.
- **Delete One Monitor** — fjern én post, der matcher filteret.
- **Delete Many Monitors** — fjern de poster, der matcher filteret, op til Limit.

Sådan kan et workflow læse og ændre OneUptime-data. For eksempel: en webhook fra dit CI-værktøj kan bruge **Create One Incident** til at åbne en hændelse med fejldetaljerne.

## Hvilken komponent skal jeg bruge?

Et par hurtige regler:

- Hvis der findes en dedikeret blok til det, du vil have (Slack, Email, en OneUptime-post), så brug den — du får pænere fejlhåndtering og klarere logfiler.
- Til ethvert andet eksternt API: brug **API**.
- Til at omforme data mellem blokke: brug **Custom Code** eller **JSON**.
- Til at tage forskellige handlinger baseret på en værdi: brug **Betingelser**.

## Læs videre

- [Variabler](/docs/workflows/variables) — at sende data mellem blokke.
- [Kørsler & logfiler](/docs/workflows/runs-and-logs) — tjek hvad hver blok gjorde i en kørsel.
- [Konfiguration & sikkerhed](/docs/workflows/configuration) — grænser, ejere og hemmeligheder.
