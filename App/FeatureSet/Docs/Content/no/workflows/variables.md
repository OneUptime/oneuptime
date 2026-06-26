# Variabler

Arbeidsflyter handler om å flytte data — fra triggeren til den første blokken, fra én blokk til den neste, og fra delte verdier inn dit du trenger dem. Variabler er hvordan disse dataene beveger seg.

Det finnes to typer, og de deler samme syntaks.

## Globale variabler

Prosjektomfattende verdier du lagrer én gang og gjenbruker overalt. Tenk API-nøkler, URL-er, kanalnavn — alt du ikke vil kopiere inn i ti forskjellige arbeidsflyter.

Du finner dem under **Arbeidsflyter → Globale variabler**. Hver har:

- **Navn** — hvordan du refererer til den. Bruk `UPPER_SNAKE_CASE` slik at den skiller seg ut i blokkene dine.
- **Verdi** — selve verdien. Verdier med flere linjer fungerer også.
- **Er hemmelig** — når på, er verdien skjult i grensesnittet etter at du lagrer, og er skjult fra kjøringsloggene.

Bruk en global variabel i en hvilken som helst arbeidsflyt med:

```
{{variable.NAME}}
```

For eksempel, hvis du lagret PagerDuty-nøkkelen din som `PAGERDUTY_KEY`, kan en hvilken som helst blokk bruke den som `{{variable.PAGERDUTY_KEY}}` — selve nøkkelen vises aldri i arbeidsflyten eller loggene dens.

## Lokale variabler (data fra tidligere blokker)

Lokale variabler er utdata fra blokker som allerede har kjørt i denne eksekveringen. Hver trigger og hver komponent produserer noe utdata du kan lese.

Refererer til utdata fra en tidligere blokk slik:

```
{{BlockName.fieldName}}
```

`BlockName` er navnet på triggeren eller komponenten på lerretet (du kan gi den et nytt, kort og tydelig navn). `fieldName` er hva enn den blokken produserer.

Eksempler:

- Etter at en **API**-blokk kalt `LookupUser` kjører, kan du lese statuskoden som `{{LookupUser.response-status}}` og kroppen som `{{LookupUser.response-body}}`.
- Etter en **Hendelse → Ved opprettelse**-trigger kalt `Incident`, kan du lese `{{Incident.title}}`, `{{Incident.description}}` og ethvert annet felt på hendelsen.
- Etter en **Egendefinert kode**-blokk kalt `Transform`, finnes den returnerte verdien på `{{Transform.value}}`.

Lokale variabler eksisterer bare under den nåværende kjøringen. Hver nye kjøring starter på nytt.

## Hvor variabler fungerer

Nesten hvert tekstfelt aksepterer variabler:

- URL-en på en API-blokk.
- Meldingsteksten på Slack, Teams, Discord, Telegram, E-post.
- Emnet og kroppen til en e-post.
- Header- og body-felter (inne i strengverdier).
- Begge sider av en Betingelser-blokk.

Rene JSON-felter aksepterer variabler inne i strengverdier, men du kan ikke bruke en variabel som en nøkkel. Hvis du må bygge en struktur dynamisk, bruk en **Egendefinert kode**-blokk til å bygge den, og send så utdata til neste blokk.

**Egendefinert kode**-blokken leser variabler på en annen måte — globale variabler kommer inn på `args.variables`, og du bestemmer hvilke tidligere utdata du skal sende inn som argumenter.

## Eksempler

### Bygge en nyttelast fra en webhook

En webhook kommer inn med en kropp som `{ "service": "checkout", "status": "failed" }`. For å gjøre det om til en OneUptime-hendelse:

1. **Webhook**-trigger kalt `CIWebhook`.
2. **Betingelser**-blokk: venstre `{{CIWebhook.Request Body.status}}`, operator `==`, høyre `failed`.
3. Fra **Ja**-grenen, en **Opprett hendelse**-blokk med:
   - Tittel: `CI build failed: {{CIWebhook.Request Body.service}}`
   - Beskrivelse: `See {{CIWebhook.Request Body.url}} for the logs.`

### Bruke en hemmelighet i et API-kall

En arbeidsflyt som kaller PagerDuty:

1. Lagre `PAGERDUTY_KEY` som en hemmelig global variabel.
2. På **API**-blokken, sett `Authorization`-headeren til `Token token={{variable.PAGERDUTY_KEY}}`.

Nøkkelen holdes ute av arbeidsflyten og loggene.

### Kjede to API-kall

Det første kallet gir deg en ID det andre trenger:

1. **API**-blokk `LookupOrder`: `GET /orders?email={{Manual.JSON.email}}`.
2. **API**-blokk `CancelOrder`: `POST /orders/{{LookupOrder.response-body.id}}/cancel`.

Hvis `LookupOrder` feiler, utløses dens **feil**-utgang i stedet for **suksess**. Koble den til en E-post- eller Slack-blokk slik at feil ikke går ubemerket hen.

## Fallgruver

- **Å gi en blokk nytt navn bryter referansene.** Hvis du gir en blokk nytt navn, oppdater alle stedene den brukes. I kjøringsloggen vises en uløst referanse som den bokstavelige teksten `{{BlockName.field}}`.
- **Variabelnavn skiller mellom store og små bokstaver.** `{{variable.MyKey}}` og `{{variable.mykey}}` er forskjellige.
- **Manglende felter blir tomme.** Å referere til et felt som ikke finnes gir deg en tom streng, ikke en feil. Praktisk — men det kan skjule feil. Bruk en **Betingelser**-blokk for å sjekke viktige felter før du fortsetter.

## Hvor du leser videre

- [Komponenter](/docs/workflows/components) — den fullstendige listen over utdata hver blokk produserer.
- [Kjøringer & logger](/docs/workflows/runs-and-logs) — se den faktiske verdien av hver variabel etter en kjøring.
- [Konfigurasjon & sikkerhet](/docs/workflows/configuration) — hva som er trygt å sette i en global variabel.
