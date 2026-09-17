# Variabler

Arbeidsflyter handler om å flytte data — fra triggeren til den første blokken, fra én blokk til den neste, og fra felles verdier inn dit du måtte trenge dem. Variabler er måten dataene flytter seg på.

Det finnes to variabelnivåer, i tillegg til komponentutdataene som oppstår underveis i en kjøring.

## Globale variabler

Prosjektomfattende verdier du lagrer én gang og gjenbruker overalt. Tenk API-nøkler, URL-er, kanalnavn — alt du slipper å kopiere inn i ti forskjellige arbeidsflyter.

Du finner dem under **Arbeidsflyter → Globale variabler**. Hver av dem har:

- **Navn** — slik du refererer til den. Minst to tegn, ingen mellomrom, og bare bokstaver, tall, bindestreker og understreker. `UPPER_SNAKE_CASE` er en god vane, fordi det skiller seg ut i blokkene dine.
- **Beskrivelse** — valgfri, fri tekst som minner deg om hva den er til.
- **Hemmelighet** — når den er på, vaskes verdien bort fra kjørelogger og trinnsporinger.
- **Innhold** — selve verdien. Det er et langtekstfelt, så flerlinjede verdier fungerer.

Bruk en global variabel i en hvilken som helst arbeidsflyt med:

```
{{global.variables.NAME}}
```

Har du for eksempel lagret PagerDuty-nøkkelen din som `PAGERDUTY_KEY`, kan enhver blokk bruke den som `{{global.variables.PAGERDUTY_KEY}}` — editoren lagrer referansen, og arbeidsflytloggingen vasker bort den oppløste hemmelige verdien.

Variabler opprettes og slettes, de redigeres ikke. Det finnes ingen redigeringsknapp i tabellen, så vil du endre en verdi i grensesnittet, sletter du variabelen og oppretter den på nytt — eller du oppdaterer den over API-et, som er dekket nederst på denne siden. Globale variabler og arbeidsflytvariabler er en funksjon i Growth-planen.

## Lokale arbeidsflytvariabler

Variabler som gjelder én arbeidsflyt, og som du håndterer under **Arbeidsflytvariabler** i venstremenyen til den arbeidsflyten. Referer til dem med:

```
{{local.variables.NAME}}
```

## Komponentutdata (data fra tidligere blokker)

Enhver trigger og komponent kan produsere utdata under en utførelse. Bruk komponentverdivelgeren i editoren til å lage referansen fremfor å skrive den selv — den setter inn nøyaktig de idene kjøreren forventer.

Slik refererer du til utdataene fra en tidligere blokk:

```
{{local.components.COMPONENT_ID.returnValues.FIELD_ID}}
```

`COMPONENT_ID` er blokkens **Identifier** — den korte iden som vises på blokken, ikke navnet som står på den. Nye blokker får en som `api-get-1`, og du kan gi den nytt navn i **ID**-seksjonen på blokken. Et navnebytte ødelegger hver referanse som allerede peker på den, på samme måte som når du gir en variabel nytt navn. `FIELD_ID` er iden til returverdien du har valgt.

Eksempler:

- Når en **API**-komponent med iden `lookup-user` har kjørt, er statuskoden `{{local.components.lookup-user.returnValues.response-status}}` og kroppen `{{local.components.lookup-user.returnValues.response-body}}`.
- Når en **Run Custom JavaScript**-komponent med iden `transform` har kjørt, er den returnerte verdien `{{local.components.transform.returnValues.returnValue}}`.
- Triggere for en posttype — **On Create Incident** og slektningene — returnerer nøyaktig én verdi, `model`, og du borer deg ned i den. For en trigger med iden `incident-on-create-1` er tittelen på hendelsen `{{local.components.incident-on-create-1.returnValues.model.title}}`.

Lokale variabler finnes bare under den pågående kjøringen. Hver nye kjøring starter på nytt.

## Hvor variabler virker

Nesten hvert tekstfelt tar imot variabler:

- URL-en på en API-blokk.
- Meldingsteksten på Slack, Teams, Discord, Telegram, E-post.
- Emnet og teksten i en e-post.
- Header- og kroppsfelt (inni strengverdier).
- Begge sider av en **If / Else**-blokk (som ligger under Betingelser-kategorien).

I JSON-felt kan du bruke en variabel inni en strengverdi, men ikke som nøkkel. En referanse som fyller en hel verdi alene, settes inn rått, så du kan slippe et helt objekt inn i et JSON-felt på den måten. Trenger du å bygge en struktur dynamisk, bruker du en **Run Custom JavaScript**-blokk til å bygge den, og sender utdataene videre til neste blokk.

**Run Custom JavaScript**-blokken får ikke variabler automatisk — ingenting injiseres inn i sandkassen. Legg `{{global.variables.NAME}}` (eller en hvilken som helst komponentreferanse) i blokkens **Arguments**-JSON-felt; de verdiene settes inn før skriptet kjører og kommer inn som `args`.

## Å gå gjennom lister

Inni et tekstfelt kan du iterere over et array med `{{#each path}}…{{/each}}`. Inne i blokken leser `{{property}}` fra gjeldende element, `{{@index}}` er posisjonen fra og med 0, og `{{this}}` er selve elementet når arrayet inneholder enkle verdier. Navn inni en `{{#each}}`-blokk trimmes, så løse mellomrom er ufarlige der — i motsetning til overalt ellers.

## Eksempler

### Å bygge en nyttelast fra en webhook

En webhook kommer inn med en kropp som `{ "service": "checkout", "status": "failed" }`. Slik gjør du det om til en OneUptime-hendelse:

1. **Webhook**-trigger med iden `ci-webhook`.
2. **If / Else**-blokk: velg webhookens Request Body-utdata og bruk `status`-egenskapen, operator `==`, høyre side `failed`.
3. Fra **Ja**-grenen, en **Create One Incident**-blokk med:
   - Title: `CI build failed: {{local.components.ci-webhook.returnValues.request-body.service}}`
   - Description: `See {{local.components.ci-webhook.returnValues.request-body.url}} for the logs.`

### Å bruke en hemmelighet i et API-kall

En arbeidsflyt som kaller PagerDuty:

1. Lagre `PAGERDUTY_KEY` som en hemmelig global variabel.
2. På **API**-blokken setter du `Authorization`-headeren til `Token token={{global.variables.PAGERDUTY_KEY}}`.

Nøkkelen holder seg utenfor både arbeidsflyten og loggene.

### Å lenke sammen to API-kall

Det første kallet gir deg en ID det andre trenger:

1. **API**-komponenten `lookup-order`: bruk velgeren til å sette inn e-postfeltet fra Manual-triggerens JSON i `GET /orders?email=...`.
2. **API**-komponenten `cancel-order`: `POST /orders/{{local.components.lookup-order.returnValues.response-body.id}}/cancel`.

Feiler `lookup-order`, fyrer **Feil**-utgangen i stedet for **Suksess**. Koble den til en e-post- eller Slack-blokk så feil ikke går upåaktet hen.

## Å oppdatere en variabel fra en arbeidsflyt

Et vanlig mønster er å rotere en legitimasjon etter en tidsplan: hent et ferskt token fra en tredjepart, og legg det tilbake i variabelen så neste kjøring plukker det opp. Det gjør du med en **API**-blokk som kaller OneUptime-API-et.

`PUT /api/workflow-variable/<variable-id>` med en `ApiKey`-header, og — dette er delen folk snubler i — feltene du vil endre **pakket inn i et `data`-objekt**:

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

- **Ikke gi en variabel du refererer til, nytt navn.** `name` er en del av `{{local.variables.NAME}}`. Endrer du det, står hver eneste eksisterende referanse uoppløst, og en uoppløst referanse sendes videre som ren tekst — se fellen nedenfor.
- **En variabel kan skrives på denne måten, men aldri leses tilbake.** `content` er skrivebeskyttet over API-et for hver eneste variabel, hemmelig eller ei. Det er nettopp derfor en variabel er et trygt sted å parkere et token som roteres. Merker du den som hemmelig, holdes verdien i tillegg utenfor kjørelogger og trinnsporinger.

## Feller

- **Bruk velgerne.** De setter inn nøyaktig de komponent-, returverdi- og variabelidene kjøreren forventer, og holder referansene uavhengige av visningsetiketter.
- **Variabelnavn skiller mellom store og små bokstaver.** `{{global.variables.MyKey}}` og `{{global.variables.mykey}}` er to forskjellige ting.
- **En referanse som ikke lar seg løse opp, blir stående som den er — den blankes ikke ut.** Å referere til noe som ikke finnes er ikke en feil, og du får heller ikke en tom streng: krøllparentesene sendes rett gjennom, så `{{local.components.api-get-1.returnValues.body}}` med en feilstavet trinn-id ender ordrett opp i Slack-meldingen, URL-en eller forespørselskroppen din, og kjøringen rapporterer likevel **Executed**. Kjøreloggen har en advarselslinje som navngir enhver referanse som slapp gjennom.
- **Byggeren kan ikke sjekke variabelnavn.** Den flagger komponentreferanser den ikke finner treff på — en ukjent trinn-id, en ukjent returverdi, en feilformet rot — før du lagrer. Den kan ikke vite om en variabel finnes, så en variabel som har byttet navn, fanges bare opp av kjøreloggen.
- **Mellomrom inni krøllparentesene trimmes ikke.** `{{ local.variables.NAME }}` er et annet oppslag enn `{{local.variables.NAME}}` og lar seg aldri løse opp. Det ene unntaket er inni en `{{#each}}`-blokk, der navn trimmes.

## Hvor du leser videre

- [Arbeidsflyt-komponenter](/docs/workflows/components) — hele listen over utdata hver blokk produserer.
- [Arbeidsflyt-kjøringer & logger](/docs/workflows/runs-and-logs) — se den faktiske verdien til hver variabel etter en kjøring.
- [Arbeidsflyt-konfigurasjon & sikkerhet](/docs/workflows/configuration) — hva som er trygt å legge i en global variabel.
