# Komponenter

Komponenter er byggeklossene du legger til etter triggeren. Hver av dem gjør én ting — sender en melding, kaller et API, sjekker en betingelse — og kobles til det som kommer etter.

Denne siden er katalogen. For hvordan du legger dem til og kobler dem sammen på lerretet, se [Opprette en arbeidsflyt](/docs/workflows/authoring).

## API

Utfør en HTTP-forespørsel til en hvilken som helst URL.

**Innstillinger**:

- **Method** — `GET`, `POST`, `PUT`, `PATCH` eller `DELETE`.
- **URL** — adressen som skal kalles.
- **Headers** — eventuelle headere som skal sendes.
- **Body** — forespørselskroppen for `POST` / `PUT` / `PATCH`.

**Utdata**:

- **Success** — utløses når kallet fungerte (2xx-respons). Sender med statusen, headerne og kroppen.
- **Error** — utløses ved en nettverksfeil eller en respons som ikke er 2xx. Sender med feilmeldingen.

Bruk dette for: et hvilket som helst eksternt API, dine egne administrasjonsendepunkter, eller en hvilken som helst integrasjon som ikke har sin egen komponent.

## AI

### Generate Text with AI

Generer ett tekstsvar fra en prompt og valgfri JSON-kontekst. Komponenten bruker prosjektets konfigurerte standard-LLM-leverandør, og faller tilbake til installasjonens globale leverandør når en slik er tilgjengelig. Leverandørens legitimasjon og endepunkter konfigureres sentralt; de er ikke arbeidsflyt-argumenter.

**Innstillinger**:

- **System Instructions** — valgfri veiledning for modellens rolle, tone og begrensninger.
- **Prompt** — den obligatoriske oppgaven. Den kan inneholde arbeidsflytvariabler og utdata fra tidligere komponenter.
- **Context** — valgfri JSON som du bevisst inkluderer med forespørselen. Den legges til etter en eksplisitt tillitsmarkør for slutten av meldingen, og behandles som upålitelige data gjennom resten av meldingen.
- **Temperature** — variasjon fra `0` til `1`. Standarden er `0.2` for forutsigbar automatisering.
- **Maximum Output Tokens** — fra `1` til `4096`. Standarden er `1024`.

Kombinasjonen av System Instructions, Prompt og serialisert Context er begrenset til 50 000 tegn. Leverandørforespørselen har en maksimal varighet på 60 sekunder og forsøkes én gang. Maksimalt tre arbeidsflyt-AI-forespørsler kan kjøre samtidig per prosjekt.

**Utdata**:

- **Response** — den genererte teksten.
- **Provider** og **Model** — konfigurasjonen som ble brukt for kallet.
- **Total Tokens** og **Completion Tokens** — bruk rapportert av leverandøren.
- **LLM Log ID** — den målte AI-loggoppføringen for kallet.
- **Error** — validerings-, tilgangs-, leverandør-, budsjett-, fakturerings- eller tidsavbruddsfeilen, når den finnes.

Koble **Success** til komponenter som skal bruke svaret. Koble **Error** til en eksplisitt reserveløsning, et varsel eller en loggbane. Komponenten gjør én modellforespørsel uten verktøydefinisjoner eller leverandørspesifikke evnefelt: den kan ikke spørre OneUptime, kalle API-er eller endre prosjektdata på egen hånd. Bortsett fra OneUptimes faste sikkerhetsinstruksjoner for komponenten, er det bare System Instructions, Prompt og Context du konfigurerer som sendes til leverandøren, etter at arbeidsflytvariabler i disse feltene er løst opp. Den konfigurerte leverandøren/modellen forblir en tillitsgrense fordi en modell kan ha iboende, leverandørstyrte evner.

Modellutdata er upålitelig tekst. Se gjennom den før du sender kundevendt kommunikasjon, og ikke bruk fritekst fra AI alene til å autorisere destruktive arbeidsflythandlinger. Se [Konfigurasjon & sikkerhet](/docs/workflows/configuration) for detaljer om leverandør, utgående trafikk, logging og kostnad.

## Webhook (utgående)

En enklere versjon av API-komponenten for «send og glem»-tilfeller. Poster en JSON-kropp til en URL.

Bruk **API** hvis du trenger å lese svaret. Bruk **Webhook** hvis du bare vil sende et varsel og gå videre.

## Slack

Post en melding til en Slack-kanal.

**Innstillinger**:

- **Channel** — kanalnavnet. Boten må allerede være i den kanalen.
- **Message** — teksten som skal sendes. Støtter Slack-formatering.

Koble Slack til prosjektet ditt først under **Project Settings → Workspace → Slack**. Se [Slack Workspace Connection](/docs/workspace-connections/slack).

## Microsoft Teams

Post en melding til en Microsoft Teams-kanal.

**Innstillinger**:

- **Team and channel** — hvor det skal postes.
- **Message** — teksten som skal sendes.

Se [Microsoft Teams Workspace Connection](/docs/workspace-connections/microsoft-teams) for oppsett.

## Discord

Post en melding til en Discord-kanal gjennom en innkommende webhook-URL.

## Telegram

Send en melding til en Telegram-chat med en bot-token og chat-ID.

## Email

Send en e-post gjennom OneUptime.

**Innstillinger**:

- **To** — mottakerens e-postadresse.
- **Subject** — emnelinjen.
- **Body** — meldingen i Markdown eller HTML.

E-posten sendes ut fra prosjektets konfigurerte avsender — se [SMTP](/docs/emails/smtp).

## Custom Code

Kjør et lite stykke JavaScript når du trenger noe de andre blokkene ikke kan gjøre.

**Innstillinger**:

- **Code** — din JavaScript. Den siste verdien (eller det du returnerer fra en async-funksjon) blir blokkens utdata.
- **Arguments** — navngitte verdier du kan sende inn.

**Utdata**: success (returverdien din) og error (ethvert unntak).

Bruk dette for: å omforme data mellom to systemer, gjøre en liten beregning, eller noe annet som ikke fortjener sin egen blokk. For tyngre skripting, bruk en [Runbook](/docs/runbooks/index) i stedet.

## JSON

Konverter mellom tekst og JSON.

- **JSON → Text** — gjør et JSON-objekt om til en streng. Nyttig når neste blokk forventer tekst.
- **Text → JSON** — tolk en streng som et JSON-objekt. Nyttig når noe kom inn som tekst og du trenger å lese et felt.

## Conditions

Forgren basert på en sammenligning. I **Add Component**-panelet kalles denne blokken **If / Else**, under Conditions-kategorien.

**Innstillinger**:

- **Left value** — vanligvis en verdi fra en tidligere blokk.
- **Operator** — `==`, `!=`, `>`, `>=`, `<`, `<=`, `contains`, `starts with`, `ends with`.
- **Right value** — hva det skal sammenlignes mot.

**Utdata**: **Yes** og **No**. Koble neste blokker til den grenen du ønsker.

## Delay

Sett arbeidsflyten på pause i en fastsatt tid før den fortsetter. Nyttig når du trenger å gi et annet system litt tid til å ta igjen.

## Log

Skriv en linje til kjøringsloggen. Ingen ekstern effekt — den vises bare i arbeidsflytens logger for at du skal kunne lese den. Praktisk til feilsøking.

## Execute Workflow

Kall en annen arbeidsflyt fra denne. Den kalte arbeidsflyten kjører på egen hånd — din arbeidsflyt fortsetter uten å vente på at den skal bli ferdig.

Bruk dette til å dele felles logikk. Bygg en «post til hendelseskanal»-arbeidsflyt én gang, og kall den så fra enhver annen arbeidsflyt som trenger å varsle kanalen.

Det finnes en sikkerhetsgrense slik at arbeidsflyter ikke kan fortsette å kalle hverandre i en løkke. Se [Konfigurasjon & sikkerhet](/docs/workflows/configuration).

## OneUptime-datakomponenter

For hver type post i OneUptime (overvåkinger, hendelser, varsler, statussider, vaktpolicyer og mange flere), har **Add Component**-panelet disse komponentene — søk etter typens navn. Hver tittel genereres fra posttypen, så Monitor-settet leser:

- **Find One Monitor** — les én post som matcher spørringen.
- **Find Many Monitors** — les en liste over poster som matcher spørringen.
- **Create One Monitor** — legg til én post fra et JSON-objekt.
- **Create Many Monitors** — legg til flere poster fra en JSON-array.
- **Update One Monitor** — bruk skrivenyttelasten på én matchende post.
- **Update Many Monitors** — bruk skrivenyttelasten på matchende poster, opptil Limit.
- **Delete One Monitor** — slett én matchende post.
- **Delete Many Monitors** — slett matchende poster, opptil Limit.

Det samme settet gir deg tre triggere — **On Create Monitor**, **On Update Monitor** og **On Delete Monitor**. Se [Triggers](/docs/workflows/triggers).

En type tilbyr bare komponentene modellen dens tillater. En skrivebeskyttet type har bare de to Find-komponentene og ingenting annet, så hvis du ikke finner **Delete One Monitor** i panelet, tillater ikke den typen det.

Dette er hvordan en arbeidsflyt kan lese og endre OneUptime-data. For eksempel: en webhook fra CI-verktøyet ditt kan bruke **Create One Incident** til å åpne en hendelse med feildetaljene.

## Arbeide med poster

Hvert felt på en datakomponent er nøkkelbasert på postens egne **kolonne**-navn — de samme navnene som API-et bruker, ikke etikettene på dashboard-skjemaet. ID-kolonnen er `_id`. Stavemåten `id` godtas som et alias overalt hvor du kan skrive et kolonnenavn, men `_id` er hva en post gir tilbake, så det er det du skal lese på vei ut:

```json
{ "_id": "00000000-0000-0000-0000-000000000000" }
```

**Query** avgjør hvilke poster komponenten handler på. Nøkler er kolonner, verdier er hva som skal matches:

```json
{ "monitorType": "Website", "isEnabled": true }
```

En spørring er alltid avgrenset til prosjektet arbeidsflyten kjører i. Du kan ikke nå et annet prosjekts poster, og du trenger ikke legge prosjektet til i spørringen selv.

**JSON Object** på Create One, **JSON Array** på Create Many, og **Data (JSON Object)** på Update-komponentene inneholder feltene som skal skrives, nøkkelbasert på samme måte:

```json
{ "name": "Checkout API", "monitorType": "Website" }
```

En nøkkel som ikke er en kolonne, ignoreres i stedet for å avvises — kjøringsloggen navngir de som ble droppet, så sjekk der når et felt ikke lander. **Select Fields**, på Find-komponentene og triggerne, bruker de samme kolonnenøklene med `true`-verdier: `{"_id": true, "name": true}`.

**Skip** og **Limit** er to talfelt på Find Many, Update Many og Delete Many — `Skip: 0` med `Limit: 100` tar de første hundre treffene. Limit er som standard `10`, og på Update Many og Delete Many setter det taket for hvor mange poster som faktisk skrives, ikke bare hvor mange som kommer tilbake. Så `Items Deleted: 10` betyr at ti poster ble slettet, ikke at ti matchet. Øk Limit når du mener å endre mer enn ti.

**Success** og **Error** rapporterer om spørringen kjørte, ikke hva den fant. En spørring som ikke matcher noe, returnerer `0` og går likevel gjennom Success — det er ikke en feil. For å forgrene basert på om noe matchet, les den returnerte tellingen i en **If / Else**-blokk.

## Hvilken komponent bør jeg bruke?

Noen få tommelfingerregler:

- Hvis det finnes en dedikert blokk for det du vil gjøre (Slack, Email, en OneUptime-post), bruk den — du får bedre feilhåndtering og tydeligere logger.
- For ethvert annet eksternt API, bruk **API**.
- For å oppsummere, klassifisere eller utkaste tekst fra eksplisitt utvalgt arbeidsflytdata, bruk **Generate Text with AI**.
- For å omforme data mellom blokker, bruk **Custom Code** eller **JSON**.
- For å utføre forskjellige handlinger basert på en verdi, bruk **Conditions**.

## Hvor du leser videre

- [Variabler](/docs/workflows/variables) — sende data mellom blokker.
- [Kjøringer og logger](/docs/workflows/runs-and-logs) — sjekke hva hver blokk gjorde på en kjøring.
- [Konfigurasjon & sikkerhet](/docs/workflows/configuration) — grenser, eiere og hemmeligheter.
