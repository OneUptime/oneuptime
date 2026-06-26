# Komponenter

Komponenter er byggeblokkene du legger til etter triggeren. Hver enkelt gjør én ting — sender en melding, kaller et API, sjekker en betingelse — og kobler til det som kommer etter.

Denne siden er katalogen. For hvordan du drar, slipper og kobler dem på lerretet, se [Lage en arbeidsflyt](/docs/workflows/authoring).

## API

Gjør en HTTP-forespørsel til en hvilken som helst URL.

**Innstillinger**:

- **Metode** — `GET`, `POST`, `PUT`, `PATCH` eller `DELETE`.
- **URL** — adressen som skal kalles.
- **Headere** — eventuelle headere som skal sendes.
- **Body** — forespørselskroppen for `POST` / `PUT` / `PATCH`.

**Utganger**:

- **Suksess** — utløses når kallet fungerte (2xx-respons). Sender videre status, headere og body.
- **Feil** — utløses ved nettverksfeil eller ikke-2xx-respons. Sender videre feilmeldingen.

Bruk dette til: ethvert eksternt API, dine egne admin-endepunkter eller enhver integrasjon som ikke har sin egen komponent.

## Webhook (utgående)

En enklere versjon av API-komponenten for "send-og-glem"-tilfeller. Poster en JSON-kropp til en URL.

Bruk **API** hvis du trenger å lese responsen. Bruk **Webhook** hvis du bare vil sende en varsling og gå videre.

## Slack

Post en melding til en Slack-kanal.

**Innstillinger**:

- **Kanal** — kanalnavnet. Boten må allerede være i den kanalen.
- **Melding** — teksten som skal sendes. Støtter Slack-formatering.

Koble Slack til prosjektet ditt først under **Prosjektinnstillinger → Arbeidsområdekoblinger → Slack**. Se [Slack arbeidsområdetilkobling](/docs/workspace-connections/slack).

## Microsoft Teams

Post en melding til en Microsoft Teams-kanal.

**Innstillinger**:

- **Team og kanal** — hvor det skal postes.
- **Melding** — teksten som skal sendes.

Se [Microsoft Teams arbeidsområdetilkobling](/docs/workspace-connections/microsoft-teams) for oppsett.

## Discord

Post en melding til en Discord-kanal via en innkommende webhook-URL.

## Telegram

Send en melding til en Telegram-chat ved å bruke en bot-token og chat-ID.

## E-post

Send en e-post via OneUptime.

**Innstillinger**:

- **Til** — mottakerens e-postadresse.
- **Emne** — emnelinjen.
- **Body** — meldingen i Markdown eller HTML.

E-posten sendes ut fra prosjektets konfigurerte avsender — se [SMTP](/docs/emails/smtp).

## Egendefinert kode

Kjør en liten bit JavaScript når du trenger noe de andre blokkene ikke kan.

**Innstillinger**:

- **Kode** — JavaScript-en din. Den siste verdien (eller det du returnerer fra en async-funksjon) blir blokkens utdata.
- **Argumenter** — navngitte verdier du kan sende inn.

**Utganger**: suksess (returverdien din) og feil (eventuelle unntak).

Bruk dette til: omforming av data mellom to systemer, en liten beregning, hva som helst som ikke fortjener sin egen blokk. For tyngre scripting, bruk en [Runbook](/docs/runbooks/index) i stedet.

## JSON

Konverter mellom tekst og JSON.

- **JSON → Tekst** — gjør et JSON-objekt om til en streng. Nyttig når neste blokk forventer tekst.
- **Tekst → JSON** — tolk en streng om til et JSON-objekt. Nyttig når noe kom inn som tekst og du må lese et felt.

## Betingelser

Forgren basert på en sammenligning.

**Innstillinger**:

- **Venstre verdi** — vanligvis en verdi fra en tidligere blokk.
- **Operator** — `==`, `!=`, `>`, `>=`, `<`, `<=`, `contains`, `starts with`, `ends with`.
- **Høyre verdi** — det du skal sammenligne med.

**Utganger**: **Ja** og **Nei**. Koble de neste blokkene til den grenen du vil.

## Forsinkelse

Stopp arbeidsflyten i en angitt tid før den fortsetter. Nyttig når du må gi et annet system et øyeblikk til å ta igjen.

## Log

Skriv en linje til kjøringsloggen. Ingen ekstern effekt — den dukker bare opp i arbeidsflytens logger så du kan lese den. Hendig for feilsøking.

## Kjør arbeidsflyt

Kall en annen arbeidsflyt fra denne. Den kalte arbeidsflyten kjører på egen hånd — arbeidsflyten din fortsetter uten å vente på at den skal bli ferdig.

Bruk dette for å dele felles logikk. Bygg en "post til hendelseskanal"-arbeidsflyt én gang, og kall den så fra enhver annen arbeidsflyt som må varsle kanalen.

Det er en sikkerhetsgrense slik at arbeidsflyter ikke kan fortsette å kalle hverandre i en løkke. Se [Konfigurasjon & sikkerhet](/docs/workflows/configuration).

## OneUptime datakomponenter

For hver type oppføring i OneUptime (monitorer, hendelser, varsler, statussider, vaktordningspolicyer og mange flere) har paletten disse komponentene — søk etter typens navn:

- **Finn én** — hent én oppføring etter ID eller filter.
- **Finn** — hent en liste over oppføringer.
- **Opprett** — legg til en ny oppføring.
- **Oppdater** — endre én oppføring.
- **Slett** — fjern én oppføring.
- **Tell** — tell oppføringer som matcher et filter.

Slik kan en arbeidsflyt lese og endre OneUptime-data. For eksempel: en webhook fra CI-verktøyet ditt kan bruke **Opprett hendelse** for å åpne en hendelse med feildetaljene.

## Hvilken komponent bør jeg bruke?

Noen raske regler:

- Hvis det finnes en dedikert blokk for det du vil (Slack, E-post, en OneUptime-oppføring), bruk den — du får hyggeligere feilhåndtering og klarere logger.
- For ethvert annet eksternt API, bruk **API**.
- For å omforme data mellom blokker, bruk **Egendefinert kode** eller **JSON**.
- For å ta forskjellige handlinger basert på en verdi, bruk **Betingelser**.

## Hvor du leser videre

- [Variabler](/docs/workflows/variables) — å sende data mellom blokker.
- [Kjøringer & logger](/docs/workflows/runs-and-logs) — å sjekke hva hver blokk gjorde på en kjøring.
- [Konfigurasjon & sikkerhet](/docs/workflows/configuration) — grenser, eiere og hemmeligheter.
