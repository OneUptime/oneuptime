# Komponenter

Komponenter er de byggesten, du tilføjer efter triggeren. Hver enkelt gør én ting — send en besked, kald et API, tjek en betingelse — og forbinder til det, der kommer bagefter.

Denne side er kataloget. For hvordan du tilføjer og forbinder dem på lærredet, se [Opbygning af et workflow](/docs/workflows/authoring).

## API

Foretag en HTTP-anmodning til en hvilken som helst URL.

**Settings**:

- **Method** — `GET`, `POST`, `PUT`, `PATCH` eller `DELETE`.
- **URL** — adressen, der skal kaldes.
- **Headers** — eventuelle headers, der skal sendes.
- **Body** — anmodningens body til `POST` / `PUT` / `PATCH`.

**Outputs**:

- **Success** — udløses, når kaldet lykkedes (2xx-svar). Sender status, headers og body videre.
- **Error** — udløses ved en netværksfejl eller et ikke-2xx-svar. Sender fejlbeskeden videre.

Brug denne til: ethvert eksternt API, dine egne admin-endpoints, eller enhver integration, som ikke har sin egen komponent.

## AI

### Generate Text with AI

Generér ét tekstsvar ud fra en prompt og valgfri JSON-kontekst. Komponenten bruger projektets konfigurerede standard-LLM-udbyder, med fallback til installationens globale udbyder, når en er tilgængelig. Udbyder-credentials og -endpoints konfigureres centralt; de er ikke workflow-argumenter.

**Settings**:

- **System Instructions** — valgfri vejledning til modellens rolle, tone og begrænsninger.
- **Prompt** — den påkrævede opgave. Den kan inkludere workflow-variabler og output fra tidligere komponenter.
- **Context** — valgfri JSON, som du bevidst inkluderer i anmodningen. Den tilføjes efter en eksplicit end-of-message-tillidsmarkør og behandles som utroværdige data resten af beskeden igennem.
- **Temperature** — variation fra `0` til `1`. Standarden er `0.2` for forudsigelig automatisering.
- **Maximum Output Tokens** — fra `1` til `4096`. Standarden er `1024`.

De kombinerede System Instructions, Prompt og serialiserede Context er begrænset til 50.000 tegn. Udbyderanmodningen har en maksimal varighed på 60 sekunder og forsøges kun én gang. Højst tre workflow-AI-anmodninger kan køre samtidig pr. projekt.

**Outputs**:

- **Response** — den genererede tekst.
- **Provider** og **Model** — konfigurationen brugt til kaldet.
- **Total Tokens** og **Completion Tokens** — forbrug rapporteret af udbyderen.
- **LLM Log ID** — den målte AI-logpost for kaldet.
- **Error** — validerings-, adgangs-, udbyder-, budget-, fakturerings- eller timeout-fejlen, når den findes.

Forbind **Success** til komponenter, der skal bruge svaret. Forbind **Error** til en eksplicit fallback, alarm eller log-sti. Komponenten foretager én modelanmodning uden værktøjsdefinitioner eller udbyder-native capability-felter: den kan ikke forespørge OneUptime, kalde API'er eller ændre projektdata på egen hånd. Ud over OneUptimes faste komponent-sikkerhedsinstruktioner sendes kun de System Instructions, Prompt og Context, du konfigurerer, til udbyderen, efter workflow-variabler i de felter er opløst. Den konfigurerede udbyder/model forbliver en tillidsgrænse, fordi en model kan have iboende udbyder-styrede capabilities.

Modeloutput er utroværdig tekst. Gennemgå det, før du sender kundevendt kommunikation, og brug ikke fritekst-AI-tekst alene til at autorisere destruktive workflow-handlinger. Se [Workflow-konfiguration & sikkerhed](/docs/workflows/configuration) for detaljer om udbyder, egress, logning og omkostninger.

## Webhook (udgående)

En enklere version af API-komponenten til "fire and forget"-tilfælde. Poster en JSON-body til en URL.

Brug **API**, hvis du har brug for at læse svaret. Brug **Webhook**, hvis du bare vil sende en notifikation og gå videre.

## Slack

Post en besked til en Slack-kanal.

**Settings**:

- **Channel** — kanalens navn. Bot'en skal allerede være i den kanal.
- **Message** — den tekst, der skal sendes. Understøtter Slack-formatering.

Forbind først Slack til dit projekt under **Project Settings → Workspace → Slack**. Se [Slack Workspace-forbindelse](/docs/workspace-connections/slack).

## Microsoft Teams

Post en besked til en Microsoft Teams-kanal.

**Settings**:

- **Team and channel** — hvor der skal postes.
- **Message** — den tekst, der skal sendes.

Se [Microsoft Teams Workspace-forbindelse](/docs/workspace-connections/microsoft-teams) for opsætning.

## Discord

Post en besked til en Discord-kanal via en indkommende webhook-URL.

## Telegram

Send en besked til en Telegram-chat ved hjælp af et bot-token og et chat-ID.

## Email

Send en e-mail gennem OneUptime.

**Settings**:

- **To** — modtagerens e-mailadresse.
- **Subject** — emnelinjen.
- **Body** — beskeden i Markdown eller HTML.

E-mailen sendes fra dit projekts konfigurerede afsender — se [SMTP](/docs/emails/smtp).

## Custom Code

Kør et lille stykke JavaScript, når du har brug for noget, de andre blokke ikke kan.

**Settings**:

- **Code** — din JavaScript. Den sidste værdi (eller det, du returnerer fra en async-funktion) bliver blokkens output.
- **Arguments** — navngivne værdier, du kan sende ind.

**Outputs**: success (din returværdi) og error (enhver undtagelse).

Brug denne til: at omforme data mellem to systemer, lave en lille beregning, eller noget der ikke fortjener sin egen blok. Til tungere scripting kan du i stedet bruge en [Runbook](/docs/runbooks/index).

## JSON

Konvertér mellem tekst og JSON.

- **JSON → Text** — gør et JSON-objekt til en streng. Nyttigt, når den næste blok forventer tekst.
- **Text → JSON** — parse en streng til et JSON-objekt. Nyttigt, når noget kom som tekst, og du skal læse et felt.

## Conditions

Forgren ud fra en sammenligning. I panelet **Add Component** hedder denne blok **If / Else**, under kategorien Conditions.

**Settings**:

- **Left value** — typisk en værdi fra en tidligere blok.
- **Operator** — `==`, `!=`, `>`, `>=`, `<`, `<=`, `contains`, `starts with`, `ends with`.
- **Right value** — det, der skal sammenlignes med.

**Outputs**: **Yes** og **No**. Forbind de næste blokke til den gren, du vil have.

## Delay

Sæt workflowet på pause i et bestemt stykke tid, før det fortsætter. Nyttigt, når du har brug for at give et andet system et øjeblik til at indhente det.

## Log

Skriv en linje til kørselsloggen. Ingen ekstern effekt — den dukker bare op i workflowets logfiler, så du kan læse den. Praktisk til debugging.

## Execute Workflow

Kald et andet workflow fra dette. Det kaldte workflow kører for sig selv — dit workflow fortsætter uden at vente på, at det afsluttes.

Brug dette til at dele fælles logik. Byg ét "post til hændelseskanal"-workflow, og kald det så fra ethvert andet workflow, der har brug for at notificere kanalen.

Der er en sikkerhedsgrænse, så workflows ikke kan blive ved med at kalde hinanden i en løkke. Se [Workflow-konfiguration & sikkerhed](/docs/workflows/configuration).

## OneUptime-datakomponenter

For hver slags post i OneUptime (monitors, incidents, alerts, status pages, on-call-politikker og mange flere) har panelet **Add Component** disse komponenter — søg på typens navn. Hver titel genereres ud fra posttypen, så sættet for Monitor ser sådan ud:

- **Find One Monitor** — læs én post, der matcher forespørgslen.
- **Find Many Monitors** — læs en liste af poster, der matcher forespørgslen.
- **Create One Monitor** — tilføj én post ud fra et JSON-objekt.
- **Create Many Monitors** — tilføj flere poster ud fra et JSON-array.
- **Update One Monitor** — anvend write-payloaden på én matchende post.
- **Update Many Monitors** — anvend write-payloaden på matchende poster, op til Limit.
- **Delete One Monitor** — slet én matchende post.
- **Delete Many Monitors** — slet matchende poster, op til Limit.

Det samme sæt giver dig tre triggere — **On Create Monitor**, **On Update Monitor** og **On Delete Monitor**. Se [Triggere](/docs/workflows/triggers).

En type tilbyder kun de komponenter, dens model tillader. En skrivebeskyttet type har kun de to Find-komponenter og intet andet, så hvis du ikke kan finde **Delete One Monitor** i panelet, tillader den type det ikke.

Sådan kan et workflow læse og ændre OneUptime-data. For eksempel: en webhook fra dit CI-værktøj kan bruge **Create One Incident** til at åbne en hændelse med fejldetaljerne.

## At arbejde med poster

Hvert felt på en datakomponent er nøglet på postens egne **kolonne**-navne — de samme navne, API'et bruger, ikke de labels, der vises på dashboard-formularen. ID-kolonnen er `_id`. Stavemåden `id` accepteres som et alias alle steder, du kan skrive et kolonnenavn, men `_id` er, hvad en post giver tilbage, så det er det, du skal læse på vej ud:

```json
{ "_id": "00000000-0000-0000-0000-000000000000" }
```

**Query** afgør, hvilke poster komponenten handler på. Nøgler er kolonner, værdier er det, der skal matches:

```json
{ "monitorType": "Website", "isEnabled": true }
```

En forespørgsel er altid afgrænset til det projekt, workflowet kører i. Du kan ikke nå et andet projekts poster, og du behøver ikke selv tilføje projektet til forespørgslen.

**JSON Object** på Create One, **JSON Array** på Create Many, og **Data (JSON Object)** på Update-komponenterne bærer de felter, der skal skrives, nøglet på samme måde:

```json
{ "name": "Checkout API", "monitorType": "Website" }
```

En nøgle, der ikke er en kolonne, ignoreres i stedet for at blive afvist — kørselsloggen navngiver dem, den droppede, så tjek der, når et felt ikke lander. **Select Fields**, på Find-komponenterne og triggerne, bruger de samme kolonnenøgler med `true`-værdier: `{"_id": true, "name": true}`.

**Skip** og **Limit** er to talfelter på Find Many, Update Many og Delete Many — `Skip: 0` med `Limit: 100` tager de første hundrede matches. Limit er som standard `10`, og på Update Many og Delete Many begrænser den, hvor mange poster der rent faktisk skrives, ikke bare hvor mange der kommer tilbage. Så `Items Deleted: 10` betyder, at ti poster blev slettet, ikke at ti matchede. Sæt Limit op, når du mener at ændre mere end ti.

**Success** og **Error** rapporterer, om forespørgslen kørte, ikke hvad den fandt. En forespørgsel, der ikke matcher noget, returnerer `0` og går stadig ud gennem Success — det er ikke en fejl. For at forgrene på, om noget matchede, læs den returnerede count i en **If / Else**-blok.

## Hvilken komponent skal jeg bruge?

Et par hurtige regler:

- Hvis der findes en dedikeret blok til det, du vil have (Slack, Email, en OneUptime-post), så brug den — du får pænere fejlhåndtering og klarere logfiler.
- Til ethvert andet eksternt API, brug **API**.
- For at opsummere, klassificere eller udkaste tekst ud fra eksplicit udvalgt workflow-data, brug **Generate Text with AI**.
- For at omforme data mellem blokke, brug **Custom Code** eller **JSON**.
- For at tage forskellige handlinger baseret på en værdi, brug **Conditions**.

## Læs videre

- [Workflow-variabler](/docs/workflows/variables) — at sende data mellem blokke.
- [Workflow-kørsler & logfiler](/docs/workflows/runs-and-logs) — tjek hvad hver blok gjorde i en kørsel.
- [Workflow-konfiguration & sikkerhed](/docs/workflows/configuration) — grænser, ejere og hemmeligheder.
