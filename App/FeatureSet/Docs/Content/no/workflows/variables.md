# Variabler

Arbeidsflyter handler om å flytte data — fra triggeren til den første blokken, fra én blokk til den neste, og fra delte verdier inn dit du trenger dem. Variabler er hvordan disse dataene beveger seg.

Det finnes to variabel-omfang, i tillegg til komponentutdata som produseres under en kjøring.

## Globale variabler

Prosjektomfattende verdier du lagrer én gang og gjenbruker overalt. Tenk API-nøkler, URL-er, kanalnavn — alt du ikke vil kopiere inn i ti forskjellige arbeidsflyter.

Du finner dem under **Arbeidsflyter → Globale variabler**. Hver har:

- **Navn** — hvordan du refererer til den. Minst to tegn, ingen mellomrom, og bare bokstaver, tall, bindestreker og understreker. `UPPER_SNAKE_CASE` er en god vane fordi det skiller seg ut i blokkene dine.
- **Beskrivelse** — valgfri fritekst for å minne deg på hva den er til.
- **Hemmelighet** — når på, fjernes verdien fra kjøringslogger og steg-spor.
- **Innhold** — selve verdien. Det er et langtekstfelt, så verdier med flere linjer fungerer.

Bruk en global variabel i en hvilken som helst arbeidsflyt med:

```
{{global.variables.NAME}}
```

For eksempel, hvis du lagret PagerDuty-nøkkelen din som `PAGERDUTY_KEY`, kan en hvilken som helst blokk bruke den som `{{global.variables.PAGERDUTY_KEY}}` — editoren lagrer referansen, og arbeidsflyt-loggingen fjerner den løste hemmelige verdien.

Variabler opprettes og slettes, ikke redigeres. Det finnes ingen rediger-knapp i tabellen, så for å endre en verdi i grensesnittet sletter du variabelen og oppretter den på nytt — eller oppdaterer den over API-et, som dekkes på slutten av denne siden. Globale variabler og arbeidsflytvariabler er en Growth-plan-funksjon.

## Lokale arbeidsflytvariabler

Variabler avgrenset til én arbeidsflyt, forvaltet under **Arbeidsflytvariabler** i den arbeidsflytens venstremeny. Referer til dem med:

```
{{local.variables.NAME}}
```

## Komponentutdata (data fra tidligere blokker)

Hver trigger og hver komponent kan produsere utdata under en kjøring. Bruk komponentverdi-velgeren i editoren for å opprette referansen i stedet for å skrive den selv — den setter inn de nøyaktige id-ene runneren forventer.

Referer til en tidligere blokks utdata slik:

```
{{local.components.COMPONENT_ID.returnValues.FIELD_ID}}
```

`COMPONENT_ID` er blokkens **Identifier** — den korte id-en som vises på blokken, ikke navnet som vises på den. Nye blokker får én som `api-get-1`, og du kan gi den nytt navn i blokkens **ID**-seksjon. Å gi den nytt navn ødelegger enhver referanse som allerede peker på den, på samme måte som å gi en variabel nytt navn gjør. `FIELD_ID` er den valgte returverdi-id-en.

Eksempler:

- Etter at en **API**-komponent med ID-en `lookup-user` kjører, er statuskoden dens `{{local.components.lookup-user.returnValues.response-status}}` og kroppen dens `{{local.components.lookup-user.returnValues.response-body}}`.
- Etter en **Run Custom JavaScript**-komponent med ID-en `transform`, er den returnerte verdien `{{local.components.transform.returnValues.returnValue}}`.
- Triggere for en posttype — **On Create Incident** og lignende — returnerer nøyaktig én verdi, `model`, og du graver deg ned i den. For en trigger med ID-en `incident-on-create-1`, er hendelsens tittel `{{local.components.incident-on-create-1.returnValues.model.title}}`.

Lokale variabler eksisterer bare under den gjeldende kjøringen. Hver ny kjøring starter på nytt.

## Hvor variabler fungerer

Nesten alle tekstfelt godtar variabler:

- URL-en på en API-blokk.
- Meldingsteksten på Slack, Teams, Discord, Telegram, Email.
- Emnet og kroppen til en e-post.
- Header- og body-felt (inne i strengverdier).
- Begge sider av en **If / Else**-blokk (oppført under Conditions-kategorien).

I JSON-felt kan du bruke en variabel inne i en strengverdi, men ikke som en nøkkel. En referanse som utgjør en hel verdi alene, blir erstattet nakent, slik at du kan slippe et helt objekt inn i et JSON-felt på den måten. Hvis du trenger å bygge en struktur dynamisk, bruk en **Run Custom JavaScript**-blokk til å bygge den, og send så utdataene videre til neste blokk.

**Run Custom JavaScript**-blokken får ikke variabler automatisk — ingenting injiseres i sandkassen. Legg `{{global.variables.NAME}}` (eller en hvilken som helst komponentreferanse) i blokkens **Arguments**-JSON-felt; de verdiene erstattes før skriptet kjører og kommer inn som `args`.

## Løkke over arrayer

Inne i et tekstfelt kan du iterere over en array med `{{#each path}}…{{/each}}`. Inne i blokken leser `{{property}}` fra det gjeldende elementet, `{{@index}}` er 0-basert posisjon, og `{{this}}` er selve elementet for arrayer med rene verdier. Navn inne i en `{{#each}}`-blokk trimmes, så uønskede mellomrom er ufarlige der — i motsetning til alle andre steder.

## Eksempler

### Bygge en nyttelast fra en webhook

En webhook kommer inn med en kropp som `{ "service": "checkout", "status": "failed" }`. For å gjøre dette om til en OneUptime-hendelse:

1. **Webhook**-trigger med id-en `ci-webhook`.
2. **If / Else**-blokk: velg webhookens Request Body-utdata og bruk `status`-egenskapen, operatoren `==`, høyre side `failed`.
3. Fra **Yes**-grenen, en **Create One Incident**-blokk med:
   - Title: `CI build failed: {{local.components.ci-webhook.returnValues.request-body.service}}`
   - Description: `See {{local.components.ci-webhook.returnValues.request-body.url}} for the logs.`

### Bruke en hemmelighet i et API-kall

En arbeidsflyt som kaller PagerDuty:

1. Lagre `PAGERDUTY_KEY` som en hemmelig global variabel.
2. På **API**-blokken, sett `Authorization`-headeren til `Token token={{global.variables.PAGERDUTY_KEY}}`.

Nøkkelen holdes utenfor arbeidsflyten og loggene.

### Kjede sammen to API-kall

Det første kallet gir deg en ID det andre trenger:

1. **API**-komponent `lookup-order`: bruk velgeren til å sette inn e-postfeltet fra den manuelle triggerens JSON i `GET /orders?email=...`.
2. **API**-komponent `cancel-order`: `POST /orders/{{local.components.lookup-order.returnValues.response-body.id}}/cancel`.

Hvis `lookup-order` feiler, utløses **Error**-utdataen dens i stedet for **Success**. Koble den til en Email- eller Slack-blokk slik at feil ikke går ubemerket hen.

## Oppdatere en variabel fra en arbeidsflyt

Et vanlig mønster er å rotere en legitimasjon på en tidsplan: hent et ferskt token fra en tredjepart, og lagre det så tilbake i variabelen slik at neste kjøring tar det i bruk. Gjør det med en **API**-blokk som kaller OneUptime-API-et.

`PUT /api/workflow-variable/<variable-id>` med en `ApiKey`-header, og — dette er delen som lurer folk — feltene du vil endre **pakket inn i et `data`-objekt**:

```json
{
  "data": {
    "content": "{{local.components.get-token.returnValues.response-body.access_token}}"
  }
}
```

En flat kropp uten `data`-innpakningen avvises med en 400. Send bare feltene du faktisk vil endre; `name` og `description` kan holdes utenfor nyttelasten.

API-nøkkelen trenger **Edit Workflow Variables**. Ingen leserettighet kreves — oppdateringen leser ikke raden tilbake.

To ting å passe på:

- **Ikke gi nytt navn til en variabel du refererer til.** `name` er en del av `{{local.variables.NAME}}`. Å endre det gjør at enhver eksisterende referanse forblir uløst, og en uløst referanse føres gjennom som bokstavelig tekst — se fallgruven under.
- **En variabel kan skrives på denne måten, men aldri leses tilbake.** `content` er kun skrivbart (write-only) over API-et for enhver variabel, hemmelig eller ikke. Det er det som gjør en variabel til et trygt sted å parkere et roterende token. Å merke den som hemmelig holder i tillegg verdien utenfor kjøringslogger og steg-spor.

## Fallgruver

- **Bruk velgerne.** De setter inn de nøyaktige komponent-, returverdi- og variabel-id-ene runneren forventer, og holder referanser uavhengige av visningsetiketter.
- **Variabelnavn skiller mellom store og små bokstaver.** `{{global.variables.MyKey}}` og `{{global.variables.mykey}}` er forskjellige.
- **En referanse som ikke løses opp, blir stående som den er, ikke tømt.** Å referere til noe som ikke finnes, er ikke en feil, og det gir deg heller ikke en tom streng: klammeparentesene føres rett gjennom, så `{{local.components.api-get-1.returnValues.body}}` med en feilstavet steg-id ender opp i Slack-meldingen din, URL-en eller forespørselskroppen ordrett, og kjøringen rapporterer likevel **Executed**. Kjøringsloggen inneholder en advarselslinje som navngir enhver referanse som glapp gjennom.
- **Byggeverktøyet kan ikke sjekke variabelnavn.** Det flagger komponentreferanser det ikke kan matche — en ukjent steg-id, en ukjent returverdi, en ugyldig rot — før du lagrer. Det kan ikke avgjøre om en variabel finnes, så en variabel som har fått nytt navn, fanges bare opp av kjøringsloggen.
- **Mellomrom inne i klammeparentesene trimmes ikke.** `{{ local.variables.NAME }}` er et annet oppslag enn `{{local.variables.NAME}}` og løses aldri opp. Det ene unntaket er inne i en `{{#each}}`-blokk, hvor navn trimmes.

## Hvor du leser videre

- [Komponenter](/docs/workflows/components) — den fullstendige listen over utdata hver blokk produserer.
- [Kjøringer og logger](/docs/workflows/runs-and-logs) — se den faktiske verdien av hver variabel etter en kjøring.
- [Konfigurasjon & sikkerhet](/docs/workflows/configuration) — hva som er trygt å legge i en global variabel.
