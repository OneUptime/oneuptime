# Komponenter

Komponenter er de byggeklodser, du tilføjer efter triggeren. Hver enkelt gør én ting — sender en besked, kalder et API, tjekker en betingelse — og forbinder sig til det, der kommer bagefter.

Denne side er kataloget. Hvordan du tilføjer og forbinder dem på lærredet, står i [Opret et workflow](/docs/workflows/authoring).

## API

Send en HTTP-anmodning til en hvilken som helst URL.

**Indstillinger**:

- **Method** — `GET`, `POST`, `PUT`, `PATCH` eller `DELETE`.
- **URL** — adressen, der skal kaldes.
- **Headers** — de headere, der skal sendes med.
- **Body** — anmodningens body ved `POST` / `PUT` / `PATCH`.

**Outputs**:

- **Succes** — fyrer, når kaldet lykkedes (2xx-svar). Sender status, headere og body videre.
- **Fejl** — fyrer ved en netværksfejl eller et svar uden for 2xx. Sender fejlmeddelelsen videre.

Brug den til: et hvilket som helst eksternt API, dine egne admin-endpoints, eller enhver integration, der ikke har sin egen komponent.

## AI

### Generate Text with AI

Generér ét tekstsvar ud fra en prompt og valgfri JSON-kontekst. Komponenten bruger projektets konfigurerede standard-LLM-udbyder og falder tilbage til installationens globale udbyder, hvis der er en. Udbyderens adgangsoplysninger og endpoints konfigureres centralt; de er ikke argumenter i workflowet.

**Indstillinger**:

- **System Instructions** — valgfri vejledning om modellens rolle, tone og begrænsninger.
- **Prompt** — den påkrævede opgave. Den kan indeholde workflowvariabler og output fra tidligere komponenter.
- **Context** — valgfri JSON, som du bevidst sender med i anmodningen. Den lægges efter en eksplicit tillidsmarkør for slutningen af beskeden og behandles som utroværdige data i resten af beskeden.
- **Temperature** — variation fra `0` til `1`. Standard er `0.2` for forudsigelig automatik.
- **Maximum Output Tokens** — fra `1` til `4096`. Standard er `1024`.

System Instructions, Prompt og den serialiserede Context er tilsammen begrænset til 50.000 tegn. Anmodningen til udbyderen har en maksimal varighed på 60 sekunder og forsøges én gang. Højst tre AI-anmodninger fra workflows kan køre samtidig pr. projekt.

**Outputs**:

- **Response** — den genererede tekst.
- **Udbyder** og **Model** — den konfiguration, kaldet brugte.
- **Total Tokens** og **Completion Tokens** — det forbrug, udbyderen rapporterer.
- **LLM Log ID** — den målte AI-logpost for kaldet.
- **Fejl** — validerings-, adgangs-, udbyder-, budget-, faktureringsfejlen eller timeout-fejlen, når der er en.

Forbind **Succes** til de komponenter, der skal bruge svaret. Forbind **Fejl** til en udtrykkelig reservevej, advarsel eller logvej. Komponenten laver én modelanmodning uden værktøjsdefinitioner eller udbyderspecifikke kapacitetsfelter: den kan ikke selv slå op i OneUptime, kalde API'er eller ændre projektets data. Ud over OneUptimes faste sikkerhedsinstruktioner for komponenten sendes kun de System Instructions, den Prompt og den Context, du selv har konfigureret, til udbyderen — efter at workflowvariabler i de felter er opløst. Den konfigurerede udbyder/model er stadig en tillidsgrænse, fordi en model kan have iboende, udbyderstyrede kapaciteter.

Modellens output er utroværdig tekst. Læs det igennem, før du sender kundevendt kommunikation, og brug ikke fritekst fra en AI alene til at godkende destruktive handlinger i et workflow. Se [Workflow-konfiguration & sikkerhed](/docs/workflows/configuration) for detaljer om udbyder, egress, logning og omkostninger.

## Webhook (udgående)

En enklere udgave af API-komponenten til "fyr og glem"-tilfælde. Sender en JSON-body til en URL.

Brug **API**, hvis du skal læse svaret. Brug **Webhook**, hvis du bare vil sende en besked af sted og komme videre.

## Slack

Slå en besked op i en Slack-kanal.

**Indstillinger**:

- **Kanal** — kanalnavnet. Botten skal allerede være i den kanal.
- **Besked** — teksten, der skal sendes. Understøtter Slack-formatering.

Forbind først Slack til dit projekt under **Projektindstillinger → Arbejdsområde → Slack**. Se [Slack Workspace-forbindelse](/docs/workspace-connections/slack).

## Microsoft Teams

Slå en besked op i en kanal i Microsoft Teams.

**Indstillinger**:

- **Team and channel** — hvor beskeden skal slås op.
- **Besked** — teksten, der skal sendes.

Se [Microsoft Teams Workspace-forbindelse](/docs/workspace-connections/microsoft-teams) for opsætning.

## Discord

Slå en besked op i en Discord-kanal via en indgående webhook-URL.

## Telegram

Send en besked til en Telegram-chat med et bot-token og et chat-ID.

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

- **Kode** — dit JavaScript. Den sidste værdi (eller det, du returnerer fra en async-funktion) bliver blokkens output.
- **Arguments** — navngivne værdier, du kan sende ind.

**Outputs**: succes (din returværdi) og fejl (enhver exception).

Brug den til: at forme data om mellem to systemer, lave en lille udregning, alt det der ikke fortjener sin egen blok. Til tungere scripting bruger du i stedet et [Runbook](/docs/runbooks/index).

## JSON

Konvertér mellem tekst og JSON.

- **JSON → Text** — lav et JSON-objekt om til en streng. Nyttigt, når den næste blok forventer tekst.
- **Text → JSON** — fortolk en streng til et JSON-objekt. Nyttigt, når noget er kommet ind som tekst, og du skal læse et felt i det.

## Conditions

Forgren efter en sammenligning. I panelet **Tilføj komponent** hedder blokken **If / Else** og ligger under kategorien Conditions.

**Indstillinger**:

- **Left value** — som regel en værdi fra en tidligere blok.
- **Operator** — `==`, `!=`, `>`, `>=`, `<`, `<=`, `contains`, `starts with`, `ends with`.
- **Right value** — det, der skal sammenlignes med.

**Outputs**: **Ja** og **Nej**. Forbind de næste blokke til den gren, du vil have.

## Delay

Sæt workflowet på pause et bestemt stykke tid, før det fortsætter. Nyttigt, når du skal give et andet system et øjeblik til at følge med.

## Log

Skriv en linje i kørselsloggen. Ingen effekt udadtil — den dukker bare op i workflowets logge, så du kan læse den. Praktisk til fejlfinding.

## Execute Workflow

Kald et andet workflow fra dette. Det kaldte workflow kører for sig selv — dit eget workflow fortsætter uden at vente på, at det bliver færdigt.

Brug det til at dele fælles logik. Byg et "slå op i hændelseskanalen"-workflow én gang, og kald det så fra alle de andre workflows, der skal give kanalen besked.

Der er en sikkerhedsgrænse, så workflows ikke kan blive ved med at kalde hinanden i ring. Se [Workflow-konfiguration & sikkerhed](/docs/workflows/configuration).

## OneUptime-datakomponenter

For hver slags post i OneUptime (monitorer, hændelser, advarsler, statussider, vagtpolitikker og mange flere) har panelet **Tilføj komponent** disse komponenter — søg efter typens navn. Hver titel dannes ud fra posttypen, så sættet for Monitor lyder:

- **Find One Monitor** — læs én post, der matcher forespørgslen.
- **Find Many Monitors** — læs en liste af poster, der matcher forespørgslen.
- **Create One Monitor** — tilføj én post ud fra et JSON-objekt.
- **Create Many Monitors** — tilføj flere poster ud fra et JSON-array.
- **Update One Monitor** — anvend skrive-payloaden på én matchende post.
- **Update Many Monitors** — anvend skrive-payloaden på matchende poster, op til Limit.
- **Delete One Monitor** — slet én matchende post.
- **Delete Many Monitors** — slet matchende poster, op til Limit.

Det samme sæt giver dig tre triggere — **On Create Monitor**, **On Update Monitor** og **On Delete Monitor**. Se [Workflow-triggere](/docs/workflows/triggers).

En type tilbyder kun de komponenter, dens model tillader. En skrivebeskyttet type har de to Find-komponenter og ikke andet, så kan du ikke finde **Delete One Monitor** i panelet, tillader den type det ikke.

Sådan kan et workflow læse og ændre data i OneUptime. For eksempel: en webhook fra dit CI-værktøj kan bruge **Create One Incident** til at åbne en hændelse med detaljerne om fejlen.

## At arbejde med poster

Hvert felt på en datakomponent bygger på postens egne **kolonnenavne** — de samme navne, som API'et bruger, ikke etiketterne på formularen i dashboardet. ID-kolonnen hedder `_id`. Stavemåden `id` accepteres som alias overalt, hvor du kan skrive et kolonnenavn, men `_id` er det, en post giver tilbage, så det er dét, du skal læse på vejen ud:

```json
{ "_id": "00000000-0000-0000-0000-000000000000" }
```

**Query** afgør, hvilke poster komponenten arbejder på. Nøglerne er kolonner, værdierne er det, der skal matches:

```json
{ "monitorType": "Website", "isEnabled": true }
```

En forespørgsel er altid afgrænset til det projekt, workflowet kører i. Du kan ikke nå et andet projekts poster, og du behøver ikke selv skrive projektet ind i forespørgslen.

**JSON Object** på Create One, **JSON Array** på Create Many og **Data (JSON Object)** på Update-komponenterne bærer de felter, der skal skrives, med de samme nøgler:

```json
{ "name": "Checkout API", "monitorType": "Website" }
```

En nøgle, der ikke er en kolonne, bliver ignoreret frem for afvist — kørselsloggen navngiver dem, den droppede, så kig der, når et felt ikke lander. **Select Fields**, som findes på Find-komponenterne og på triggerne, bruger de samme kolonnenøgler med værdien `true`: `{"_id": true, "name": true}`.

**Spring over** og **Limit** er to talfelter på Find Many, Update Many og Delete Many — `Skip: 0` med `Limit: 100` tager de første hundrede match. Limit er som standard `10`, og på Update Many og Delete Many begrænser den, hvor mange poster der faktisk bliver skrevet, ikke bare hvor mange der kommer retur. Så `Items Deleted: 10` betyder, at ti poster blev slettet, ikke at ti matchede. Sæt Limit op, når du har til hensigt at ændre mere end ti.

**Succes** og **Fejl** melder, om forespørgslen kørte, ikke hvad den fandt. En forespørgsel, der ikke matcher noget, returnerer `0` og går stadig ud gennem Succes — det er ikke en fejl. Vil du forgrene efter, om noget matchede, så læs det returnerede antal i en **If / Else**-blok.

## Hvilken komponent skal jeg bruge?

Et par hurtige regler:

- Findes der en dedikeret blok til det, du vil (Slack, Email, en OneUptime-post), så brug den — du får pænere fejlhåndtering og klarere logge.
- Til alle andre eksterne API'er bruger du **API**.
- Skal du opsummere, klassificere eller skrive udkast til tekst ud fra data, du bevidst har valgt fra workflowet, bruger du **Generate Text with AI**.
- Skal du forme data om mellem blokke, bruger du **Custom Code** eller **JSON**.
- Skal du gøre noget forskelligt afhængigt af en værdi, bruger du **Conditions**.

## Hvor du kan læse videre

- [Workflow-variabler](/docs/workflows/variables) — sådan sender du data mellem blokke.
- [Workflow-kørsler & logfiler](/docs/workflows/runs-and-logs) — sådan tjekker du, hvad hver blok gjorde i en kørsel.
- [Workflow-konfiguration & sikkerhed](/docs/workflows/configuration) — grænser, ejere og hemmeligheder.
