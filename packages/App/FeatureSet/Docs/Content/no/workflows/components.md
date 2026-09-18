# Komponenter

Komponenter er byggeklossene du legger til etter triggeren. Hver av dem gjør én ting — sender en melding, kaller et API, sjekker en betingelse — og kobles videre til det som kommer etterpå.

Denne siden er katalogen. Vil du vite hvordan du legger dem til og kobler dem sammen på lerretet, se [Opprette en arbeidsflyt](/docs/workflows/authoring).

## API

Send en HTTP-forespørsel til en hvilken som helst URL.

**Innstillinger**:

- **Method** — `GET`, `POST`, `PUT`, `PATCH` eller `DELETE`.
- **URL** — adressen som skal kalles.
- **Headers** — eventuelle headere som skal sendes med.
- **Body** — forespørselskroppen for `POST` / `PUT` / `PATCH`.

**Outputs**:

- **Suksess** — fyrer når kallet gikk bra (2xx-svar). Sender videre status, headere og kropp.
- **Feil** — fyrer ved en nettverksfeil eller et svar som ikke er 2xx. Sender videre feilmeldingen.

Bruk denne til: eksterne API-er, dine egne administrasjonsendepunkter, eller enhver integrasjon som ikke har sin egen komponent.

## AI

### Generate Text with AI

Generer ett tekstsvar ut fra en ledetekst og valgfri JSON-kontekst. Komponenten bruker LLM-leverandøren prosjektet har satt som standard, og faller tilbake på installasjonens globale leverandør når det finnes en. Legitimasjon og endepunkter for leverandøren konfigureres sentralt; de er ikke argumenter i arbeidsflyten.

**Innstillinger**:

- **System Instructions** — valgfri veiledning om modellens rolle, tone og begrensninger.
- **Prompt** — den obligatoriske oppgaven. Den kan inneholde arbeidsflytvariabler og utdata fra tidligere komponenter.
- **Context** — valgfri JSON som du bevisst tar med i forespørselen. Den legges til etter en eksplisitt tillitsmarkør for slutten av meldingen, og behandles som upålitelige data i resten av meldingen.
- **Temperature** — variasjon fra `0` til `1`. Standard er `0.2` for forutsigbar automatikk.
- **Maximum Output Tokens** — fra `1` til `4096`. Standard er `1024`.

System Instructions, Prompt og serialisert Context er til sammen begrenset til 50 000 tegn. Forespørselen til leverandøren har en maksimal varighet på 60 sekunder og forsøkes én gang. Maksimalt tre AI-forespørsler fra arbeidsflyter kan kjøre samtidig per prosjekt.

**Outputs**:

- **Response** — den genererte teksten.
- **Provider** og **Model** — konfigurasjonen som ble brukt for kallet.
- **Total Tokens** og **Completion Tokens** — forbruket leverandøren rapporterer.
- **LLM Log ID** — den målte AI-loggoppføringen for kallet.
- **Feil** — validerings-, tilgangs-, leverandør-, budsjett-, fakturerings- eller tidsavbruddsfeilen, når den finnes.

Koble **Suksess** til komponentene som skal bruke svaret. Koble **Feil** til en uttrykkelig reserveløsning, et varsel eller en loggvei. Komponenten gjør ett modellkall uten verktøydefinisjoner eller leverandørspesifikke funksjonsfelt: den kan ikke spørre OneUptime, kalle API-er eller endre prosjektdata på egen hånd. Utover OneUptimes faste sikkerhetsinstruksjoner for komponenten er det bare System Instructions, Prompt og Context du selv har satt opp som sendes til leverandøren, etter at arbeidsflytvariablene i de feltene er løst opp. Den konfigurerte leverandøren og modellen er fortsatt en tillitsgrense, fordi en modell kan ha iboende, leverandørstyrte evner.

Modellens utdata er upålitelig tekst. Se gjennom den før du sender kundevendt kommunikasjon, og ikke bruk fri AI-tekst alene til å autorisere destruktive handlinger i arbeidsflyten. Se [Konfigurasjon & sikkerhet](/docs/workflows/configuration) for detaljer om leverandør, utgående trafikk, logging og kostnad.

## Webhook (utgående)

En enklere utgave av API-komponenten for «send og glem»-tilfeller. Poster en JSON-kropp til en URL.

Bruk **API** hvis du trenger å lese svaret. Bruk **Webhook** hvis du bare vil sende et varsel og gå videre.

## Slack

Post en melding i en Slack-kanal.

**Innstillinger**:

- **Kanal** — navnet på kanalen. Boten må allerede være i den kanalen.
- **Melding** — teksten som skal sendes. Støtter Slack-formatering.

Koble Slack til prosjektet ditt først, under **Prosjektinnstillinger → Arbeidsområde → Slack**. Se [Slack Workspace Connection](/docs/workspace-connections/slack).

## Microsoft Teams

Post en melding i en Microsoft Teams-kanal.

**Innstillinger**:

- **Team and channel** — hvor det skal postes.
- **Melding** — teksten som skal sendes.

Se [Microsoft Teams Workspace Connection](/docs/workspace-connections/microsoft-teams) for oppsett.

## Discord

Post en melding i en Discord-kanal via en innkommende webhook-URL.

## Telegram

Send en melding til en Telegram-chat med et bot-token og en chat-ID.

## Email

Send en e-post gjennom OneUptime.

**Innstillinger**:

- **Til** — mottakerens e-postadresse.
- **Emne** — emnelinjen.
- **Body** — meldingen i Markdown eller HTML.

E-posten sendes fra avsenderen prosjektet ditt er satt opp med — se [SMTP](/docs/emails/smtp).

## Custom Code

Kjør en liten bit JavaScript når du trenger noe de andre blokkene ikke får til.

**Innstillinger**:

- **Kode** — din JavaScript. Den siste verdien (eller det du returnerer fra en async-funksjon) blir blokkens utdata.
- **Arguments** — navngitte verdier du kan sende inn.

**Outputs**: suksess (returverdien din) og feil (eventuelle unntak).

Bruk denne til: å omforme data mellom to systemer, gjøre en liten beregning, eller noe annet som ikke fortjener sin egen blokk. Trenger du tyngre skripting, bruker du en [Runbook](/docs/runbooks/index) i stedet.

## JSON

Konverter mellom tekst og JSON.

- **JSON → Text** — gjør et JSON-objekt om til en streng. Nyttig når neste blokk forventer tekst.
- **Text → JSON** — tolk en streng til et JSON-objekt. Nyttig når noe kom inn som tekst og du trenger å lese et felt.

## Conditions

Forgrening basert på en sammenligning. I **Legg til komponent**-panelet heter denne blokken **If / Else**, under Betingelser-kategorien.

**Innstillinger**:

- **Left value** — som regel en verdi fra en tidligere blokk.
- **Operator** — `==`, `!=`, `>`, `>=`, `<`, `<=`, `contains`, `starts with`, `ends with`.
- **Right value** — det du sammenligner mot.

**Outputs**: **Ja** og **Nei**. Koble de neste blokkene til den grenen du vil bruke.

## Delay

Sett arbeidsflyten på pause en bestemt tid før den fortsetter. Nyttig når du må gi et annet system et øyeblikk til å henge med.

## Log

Skriv en linje i kjøreloggen. Ingen ekstern effekt — den dukker bare opp i loggene til arbeidsflyten så du kan lese den. Praktisk til feilsøking.

## Execute Workflow

Kall en annen arbeidsflyt fra denne. Den kalte arbeidsflyten kjører for seg selv — din arbeidsflyt fortsetter uten å vente på at den blir ferdig.

Bruk dette til å dele felles logikk. Bygg en «post i hendelseskanalen»-arbeidsflyt én gang, og kall den fra enhver annen arbeidsflyt som trenger å varsle kanalen.

Det finnes en sikkerhetsgrense så arbeidsflyter ikke kan kalle hverandre i det uendelige. Se [Konfigurasjon & sikkerhet](/docs/workflows/configuration).

## OneUptime-datakomponenter

For hver posttype i OneUptime (monitorer, hendelser, varsler, statussider, vaktpolicyer og mange flere) har **Legg til komponent**-panelet disse komponentene — søk etter navnet på typen. Hver tittel genereres ut fra posttypen, så Monitor-settet ser slik ut:

- **Find One Monitor** — les én post som matcher spørringen.
- **Find Many Monitors** — les en liste med poster som matcher spørringen.
- **Create One Monitor** — legg til én post fra et JSON-objekt.
- **Create Many Monitors** — legg til flere poster fra et JSON-array.
- **Update One Monitor** — skriv nyttelasten til én matchende post.
- **Update Many Monitors** — skriv nyttelasten til matchende poster, opptil Limit.
- **Delete One Monitor** — slett én matchende post.
- **Delete Many Monitors** — slett matchende poster, opptil Limit.

Det samme settet gir deg tre triggere — **On Create Monitor**, **On Update Monitor** og **On Delete Monitor**. Se [Arbeidsflyt-triggere](/docs/workflows/triggers).

En type tilbyr bare de komponentene modellen dens tillater. En skrivebeskyttet type har de to Find-komponentene og ingenting mer, så finner du ikke **Delete One Monitor** i panelet, tillater ikke den typen det.

Det er slik en arbeidsflyt kan lese og endre data i OneUptime. For eksempel: en webhook fra CI-verktøyet ditt kan bruke **Create One Incident** til å åpne en hendelse med detaljene om feilen.

## Å arbeide med poster

Hvert felt på en datakomponent følger postens egne **kolonnenavn** — de samme navnene API-et bruker, ikke etikettene på skjemaet i dashbordet. ID-kolonnen heter `_id`. Skrivemåten `id` godtas som alias overalt der du kan skrive et kolonnenavn, men `_id` er det en post gir tilbake, så det er det du leser på vei ut:

```json
{ "_id": "00000000-0000-0000-0000-000000000000" }
```

**Query** avgjør hvilke poster komponenten virker på. Nøklene er kolonner, verdiene er det du vil matche:

```json
{ "monitorType": "Website", "isEnabled": true }
```

En spørring er alltid avgrenset til prosjektet arbeidsflyten kjører i. Du når ikke postene til et annet prosjekt, og du trenger ikke legge prosjektet inn i spørringen selv.

**JSON Object** på Create One, **JSON Array** på Create Many og **Data (JSON Object)** på Update-komponentene bærer feltene som skal skrives, med de samme nøklene:

```json
{ "name": "Checkout API", "monitorType": "Website" }
```

En nøkkel som ikke er en kolonne, blir ignorert i stedet for avvist — kjøreloggen navngir dem den forkastet, så sjekk der når et felt ikke lander. **Select Fields**, på Find-komponentene og triggerne, bruker de samme kolonnenøklene med verdien `true`: `{"_id": true, "name": true}`.

**Hopp over** og **Limit** er to tallfelt på Find Many, Update Many og Delete Many — `Skip: 0` med `Limit: 100` tar de hundre første treffene. Limit er `10` som standard, og på Update Many og Delete Many begrenser den hvor mange poster som faktisk skrives, ikke bare hvor mange som kommer tilbake. Så `Items Deleted: 10` betyr at ti poster ble slettet, ikke at ti matchet. Sett Limit høyere når du mener å endre mer enn ti.

**Suksess** og **Feil** forteller om spørringen kjørte, ikke hva den fant. En spørring som ikke matcher noe, returnerer `0` og går likevel ut via Suksess — det er ingen feil. Vil du forgrene på om noe matchet, leser du det returnerte antallet i en **If / Else**-blokk.

## Hvilken komponent bør jeg bruke?

Noen kjappe regler:

- Finnes det en egen blokk for det du vil (Slack, E-post, en OneUptime-post), bruker du den — du får penere feilhåndtering og klarere logger.
- For alle andre eksterne API-er bruker du **API**.
- Skal du oppsummere, klassifisere eller utforme tekst ut fra data du bevisst har valgt ut i arbeidsflyten, bruker du **Generate Text with AI**.
- Skal du omforme data mellom blokker, bruker du **Custom Code** eller **JSON**.
- Skal du gjøre forskjellige ting ut fra en verdi, bruker du **Conditions**.

## Hvor du leser videre

- [Arbeidsflyt-variabler](/docs/workflows/variables) — å sende data mellom blokker.
- [Arbeidsflyt-kjøringer & logger](/docs/workflows/runs-and-logs) — å sjekke hva hver blokk gjorde i en kjøring.
- [Arbeidsflyt-konfigurasjon & sikkerhet](/docs/workflows/configuration) — grenser, eiere og hemmeligheter.
