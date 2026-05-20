# Komponenter

Komponenter er handlingsnodene du plasserer etter en trigger. Hver gjør én jobb — gjør en HTTP-forespørsel, sender en Slack-melding, forgrener på en betingelse, kjører en JavaScript-snutt — og eksponerer én eller flere utgangsporter som neste node kan koble til.

Denne siden er en katalog. For koblingsregler og selve lerretet, se [Opprette en arbeidsflyt](/docs/workflows/authoring).

## API

Gjør en utgående HTTP-forespørsel til en hvilken som helst URL.

**Argumenter**:

- **Method** — `GET`, `POST`, `PUT`, `PATCH`, `DELETE`.
- **URL** — forespørsels-URL. Interpoleres.
- **Request Headers** — JSON-objekt med headere.
- **Request Body** — JSON eller tekst-body for `POST` / `PUT` / `PATCH`.

**Utgangsporter**:

- `success` — trigges når responsstatus er 2xx. Returverdier: `response-status`, `response-headers`, `response-body`.
- `error` — trigges ved nettverksfeil eller ikke-2xx-respons. Returverdi: `error`-melding.

Bruk denne til: enhver tredjeparts REST API, dine egne admin-endepunkter, lette integrasjoner som ikke har en dedikert komponent.

## Webhook (utgående)

En tynn innpakning rundt API-komponenten for det vanlige "fyr av og glem"-tilfellet. Poster en JSON-body til en URL og eksponerer et enkelt `success` / `error`-par.

Foretrekk **API** hvis du må lese responsens body nedstrøms; foretrekk **Webhook** hvis du bare vil varsle et annet system.

## Slack

Post en melding til en Slack-kanal via prosjektets Slack-workspace-tilkobling.

**Argumenter**:

- **Channel name** — kanalen som meldingen skal postes til. Boten må allerede være medlem av den kanalen.
- **Message text** — selve meldingen. Interpoleres; støtter Slack mrkdwn.

Sett opp workspace-tilkoblingen i **Project Settings → Workspace Connections → Slack** først. Se [Slack workspace-tilkobling](/docs/workspace-connections/slack).

## Microsoft Teams

Post en melding til en Microsoft Teams-kanal via prosjektets Teams-tilkobling.

**Argumenter**:

- **Team & channel** — destinasjonen.
- **Message text** — meldingen.

Se [Microsoft Teams workspace-tilkobling](/docs/workspace-connections/microsoft-teams) for oppsett av tilkoblingen.

## Discord

Post en melding til en Discord-kanal via en innkommende webhook-URL konfigurert på komponenten.

## Telegram

Send en melding til en Telegram-chat via en bot-token og chat-ID konfigurert på komponenten.

## Email

Send en e-post gjennom OneUptimes SMTP-konfigurasjon.

**Argumenter**:

- **To** — mottakerens e-postadresse.
- **Subject** — interpoleres.
- **Body** — Markdown eller HTML.

E-posten sendes fra prosjektets konfigurerte avsenderadresse (se [SMTP](/docs/emails/smtp)).

## Custom Code

Kjør en JavaScript-snutt med tilgang til arbeidsflytens variabler og oppstrømsnodens returverdier.

**Argumenter**:

- **Code** — JavaScript-koden. Verdien av det siste uttrykket (eller det som returneres fra `(async () => { ... })()`) blir komponentens returverdi.
- **Arguments** — valgfrie navngitte verdier sendt inn som `args`.

**Utgangsporter**: `success` (returverdi), `error` (fanget unntak).

Bruk denne til: transformere en payload mellom to systemer, gjøre en liten beregning som ikke fortjener sin egen komponent, kalle JS-spesifikk logikk. Tyngre skripting som må kjøre inne i din egen infrastruktur hører hjemme i et [Runbook](/docs/runbooks/index) Bash- eller JavaScript-trinn.

## JSON

Konverter mellom tekst og JSON.

- **JSON → Text** — serialiser et JSON-objekt til en streng (nyttig for å mate inn i et `body`-argument på en utgående komponent som forventer tekst).
- **Text → JSON** — parser en streng til et JSON-objekt. Nyttig når en oppstrøms-API returnerte body som tekst, men du må lese et felt.

## Conditions

Forgren på en sammenligning. Konfigurer:

- **Left value** — typisk en interpolert referanse som `{{Incident.title}}`.
- **Operator** — `==`, `!=`, `>`, `>=`, `<`, `<=`, `contains`, `starts with`, `ends with`.
- **Right value** — verdien å sammenligne mot.

**Utgangsporter**: `yes` og `no`. Koble resten av arbeidsflyten på den grenen som matcher intensjonen din.

## Schedule (forsinkelse)

Pause en arbeidsflyt i en konfigurert varighet før den fortsetter. Nyttig når du må gi et eksternt system et øyeblikk på å sette seg før du sjekker tilstanden.

## Log

Skriv en linje til arbeidsflyt-kjøringsloggen. Rent feilsøkingshjelpemiddel; linjen fanges på kjøringen og er synlig under **Logger**. Ingen ekstern sideeffekt.

## Execute Workflow

Kall en annen arbeidsflyt som et undertrinn. Den kalte arbeidsflyten kjører uavhengig (fyr av og glem) — kontrollen returneres til kalleren så snart kallet er sendt.

Bruk denne for å faktorere delt logikk ut av flere arbeidsflyter: bygg en "post-til-incident-kanal"-arbeidsflyt én gang og kall den fra alle andre arbeidsflyter som må varsle kanalen.

En rekursjonsgrense forhindrer at arbeidsflyter kaller hverandre i en uendelig løkke. Se [Konfigurasjon & sikkerhet](/docs/workflows/configuration).

## Modellkomponenter (CRUD på OneUptime-entiteter)

For hver OneUptime-entitet som støtter arbeidsflyter (monitorer, hendelser, varsler, statussider, on-call-retningslinjer osv.) eksponerer paletten automatisk følgende komponenter — søkbare etter entitetens navn:

- **Find One {Entity}** — hent en enkelt post via spørring.
- **Find {Entity}** — hent en liste over poster via spørring (paginert).
- **Create {Entity}** — sett inn en ny post.
- **Update {Entity}** — oppdater én post via ID.
- **Delete {Entity}** — slett én post via ID.
- **Count {Entity}** — tell poster som matcher en spørring.

Slik kan en arbeidsflyt lese og skrive OneUptime-tilstand uten å forlate plattformen. For eksempel: en webhook fra CI-verktøyet ditt kaller **Create Incident** med build-ens feilmelding; eller en planlagt arbeidsflyt kjører **Find Incident** hvert femte minutt og e-poster et sammendrag.

## Velge riktig komponent

Noen raske tommelfingerregler:

- Hvis en dedikert komponent finnes for det du vil gjøre (Slack, Email, en CRUD på en OneUptime-entitet), bruk den — den gir deg penere feilhåndtering og tydeligere logger enn å rulle din egen.
- Hvis du må kalle en ekstern HTTP API som ikke har en dedikert komponent, bruk **API**.
- Hvis du må *forme* data mellom to komponenter, bruk **Custom Code** eller **JSON**.
- Hvis du må ta ulike handlinger basert på en verdi, bruk **Conditions**.

## Les videre

- [Variabler](/docs/workflows/variables) — hvordan mate data fra én komponent til neste.
- [Kjøringer & logger](/docs/workflows/runs-and-logs) — hvordan inspisere hva hver komponent returnerte under en kjøring.
- [Konfigurasjon & sikkerhet](/docs/workflows/configuration) — grenser, eierskap og hemmeligheter.
