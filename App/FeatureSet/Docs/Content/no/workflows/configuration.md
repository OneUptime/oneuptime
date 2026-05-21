# Konfigurasjon & sikkerhet

Denne siden dekker innstillingene og sikkerhetsgrensene det er verdt å kjenne til før du peker en arbeidsflyt mot ekte trafikk.

## Slå en arbeidsflyt på eller av

Hver arbeidsflyt har en **Aktivert**-bryter i **Innstillinger**. Når den er av, kjører ikke arbeidsflyten — webhook-kall, planlagte tidspunkter og OneUptime-hendelser ignoreres alle. Nye arbeidsflyter starter deaktivert.

Bruk denne bryteren som din "klar til å kjøre"-grind:

1. Bygg arbeidsflyten.
2. Klikk **Kjør manuelt** med en realistisk nyttelast.
3. Sjekk **Logger** — sørg for at hver blokk gikk dit du forventet.
4. Vri **Aktivert** på.

Å slå av en arbeidsflyt stopper ikke kjøringer som allerede er i gang; det stopper bare nye fra å starte.

## Eiere og etiketter

- **Eiere** — brukere og team listet som eiere får tilgang til arbeidsflyten og kan velge å motta varsler når den feiler. Sett dem under **Innstillinger → Eiere**.
- **Etiketter** — tagger for å gruppere arbeidsflyter. Arbeidsflytlisten lar deg filtrere etter etikett, noe som gjør et travelt prosjekt mye lettere å navigere. Nyttig når du har arbeidsflyter organisert etter team, integrasjon eller miljø.
- **Etikettregler** — under **Arbeidsflyter → Innstillinger → Etikettregler**, bruk etiketter automatisk på nye arbeidsflyter basert på navn- eller beskrivelsesmønstre.
- **Eierregler** — under **Arbeidsflyter → Innstillinger → Eierregler**, tildel eiere automatisk til nye arbeidsflyter.

## Hemmeligheter

Marker en global variabel som **hemmelig** hvis den inneholder noe sensitivt. Verdien krypteres, skjules i grensesnittet etter at du lagrer, og skjules i kjøringsloggene (vises som `[REDACTED]`).

Bruk hemmelige variabler for:

- API-nøkler for eksterne tjenester.
- Autentiseringstokens.
- Webhook-signeringsnøkler.
- Alt du ikke vil at noen med kun-lese-tilgang skal se.

Ikke lim en hemmelighet direkte inn i en blokk — verdier som `Authorization: Bearer eyJh...` ender opp synlige i arbeidsflyten og loggene. Bruk `{{variable.MY_SECRET}}` i stedet.

## Hvor lenge en kjøring kan ta

Hver kjøring har en maksimal lengde. Hvis en kjøring ikke er ferdig i tide, merkes den som **Tidsavbrudd** og blokken som er i gang avbrytes. Standarden er rommelig — lang nok for normale HTTP-kall og kjeder av blokker.

Individuelle blokker har sine egne tidsgrenser innenfor det — for eksempel gir en API-blokk opp en hengende utgående forespørsel god tid før hele kjøringen gjør det.

## Grense for å kalle andre arbeidsflyter

Komponenten **Kjør arbeidsflyt** lar én arbeidsflyt kalle en annen. For å forhindre utilsiktede løkker der arbeidsflyt A kaller B som kaller A igjen, er det en grense for hvor dyp kjeden kan gå. En kjøring som går forbi grensen ender med en tydelig feil.

Hvis du har et reelt behov for en lang kjede (som en jobb som behandler ett element per kjøring), er det vanligvis enklere å løkke inne i en enkelt arbeidsflyt ved å bruke **Egendefinert kode**.

## Webhook-sikkerhet

Webhook-triggere gir deg en unik URL. Alle som kjenner URL-en kan treffe den. For å beskytte mot utilsiktede eller uønskede kallere:

- Behandle URL-en som et passord. Ikke del den offentlig eller commit den til et offentlig repo.
- For sensitive arbeidsflyter, be det kallende systemet sende en delt token som en header (som `X-Webhook-Token`) og sjekk den med en **Betingelser**-blokk før du gjør noe viktig. Lagre det forventede tokenet som en hemmelig variabel.
- For svært sensitive arbeidsflyter, foretrekk en OneUptime-hendelsestrigger og et manuelt importsteg i stedet for en offentlig webhook.

## Utgående nettverkstilgang

API og andre HTTP-blokker gjør forespørslene sine fra OneUptime. Hvis du kjører selvvertet, sørg for at installasjonen din kan nå tjenestene du kaller. Hvis du bruker OneUptime Cloud, er våre utgående IP-områder listet i [IP-adresser](/docs/configuration/ip-addresses) slik at du kan tillate dem på den andre siden.

## Tillatelser

Arbeidsflyter respekterer prosjektets rollebaserte tilgangskontroll. De relevante tillatelsene:

- **Opprett / les / rediger / slett arbeidsflyt** — de grunnleggende tillatelsene på selve arbeidsflyten.
- **Kjør arbeidsflyt** — nødvendig for å klikke **Kjør manuelt** eller utløse en arbeidsflyt via API.
- **Les arbeidsflytlogg** — nødvendig for å vise kjøringer.
- **Les / opprett / rediger / slett arbeidsflyt-variabel** — kontroll over listen over globale variabler.

De fleste utviklere bør ha opprett/rediger/les på arbeidsflyter, men ikke på variabler. Reserver variabel-redigeringstilgang for personene som forvalter prosjektets hemmeligheter.

## Plan-grenser

OneUptime Cloud begrenser antall kjøringer per måned på mindre planer. Din nåværende grense vises under **Prosjektinnstillinger → Fakturering**. Når du når den, avvises nye triggere til neste faktureringsperiode. Selvvertede installasjoner har ikke denne grensen.

## Når arbeidsflyter ikke er riktig verktøy

Noen tilfeller der du bør gripe til noe annet:

- **Tung beregning eller store datasett** — arbeidsflyter er designet for lett lim-arbeid, ikke tallknusing. Kjør tungt arbeid på din egen infrastruktur og la en arbeidsflyt sparke det i gang.
- **Langvarige prosesser som strekker seg over timer** — én kjøring er ment å bli ferdig raskt. Hvis du må "gjøre A, vente to timer, gjøre B," bruk en ekstern planlegger som sender en webhook tilbake til OneUptime når det er på tide.
- **Trinn-for-trinn hendelsesrespons med mennesker i løkken** — det er det [Runbooks](/docs/runbooks/index) er for. Arbeidsflyter er for automatisering uten oppsyn.

## Hvor du leser videre

- [Oversikt over arbeidsflyter](/docs/workflows/index) — det store bildet.
- [Komponenter](/docs/workflows/components) — referanse blokk for blokk.
- [Runbooks](/docs/runbooks/index) — når du skal bruke en runbook i stedet.
