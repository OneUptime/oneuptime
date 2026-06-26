# Variabler

Workflows handler om at flytte data — fra triggeren til den første blok, fra én blok til den næste, og fra delte værdier ind, hvor end du har brug for dem. Variabler er den måde, data flytter sig på.

Der findes to slags, og de deler samme syntaks.

## Globale variabler

Projektomspændende værdier, du gemmer én gang og genbruger overalt. Tænk API-nøgler, URL'er, kanalnavne — alt, du ikke vil kopiere ind i ti forskellige workflows.

Find dem under **Workflows → Global Variables**. Hver har:

- **Name** — hvordan du refererer til den. Brug `UPPER_SNAKE_CASE`, så den skiller sig ud i dine blokke.
- **Value** — selve værdien. Flere linjer virker også.
- **Is Secret** — når slået til, skjules værdien i UI'et efter du gemmer, og er skjult fra kørselslogfiler.

Brug en global variabel i ethvert workflow med:

```
{{variable.NAME}}
```

For eksempel, hvis du gemte din PagerDuty-nøgle som `PAGERDUTY_KEY`, kan enhver blok bruge den som `{{variable.PAGERDUTY_KEY}}` — den rigtige nøgle dukker aldrig op i workflowet eller dets logfiler.

## Lokale variabler (data fra tidligere blokke)

Lokale variabler er outputtet fra blokke, der allerede er kørt i denne afvikling. Hver trigger og hver komponent producerer noget output, du kan læse.

Referér en tidligere bloks output sådan her:

```
{{BlockName.fieldName}}
```

`BlockName` er triggerens eller komponentens navn på lærredet (du kan omdøbe det til noget kort og klart). `fieldName` er det, den blok producerer.

Eksempler:

- Efter en **API**-blok ved navn `LookupUser` kører, kan du læse statuskoden som `{{LookupUser.response-status}}` og body som `{{LookupUser.response-body}}`.
- Efter en **Incident → On Create**-trigger ved navn `Incident` kan du læse `{{Incident.title}}`, `{{Incident.description}}` og ethvert andet felt på hændelsen.
- Efter en **Custom Code**-blok ved navn `Transform` ligger den returnerede værdi på `{{Transform.value}}`.

Lokale variabler eksisterer kun under den aktuelle kørsel. Hver ny kørsel starter på en frisk tavle.

## Hvor variabler virker

Næsten hvert tekstfelt accepterer variabler:

- URL'en på en API-blok.
- Beskedteksten på Slack, Teams, Discord, Telegram, Email.
- Emnet og body'en på en e-mail.
- Headers- og body-felter (inde i strengværdier).
- Begge sider af en Conditions-blok.

Rene JSON-felter accepterer variabler inde i strengværdier, men du kan ikke bruge en variabel som en nøgle. Hvis du har brug for at bygge en struktur dynamisk, så brug en **Custom Code**-blok til at bygge den, og send dens output videre til den næste blok.

**Custom Code**-blokken læser variabler anderledes — globale variabler kommer ind på `args.variables`, og du beslutter, hvilke tidligere outputs der skal sendes ind som argumenter.

## Eksempler

### Byg en payload fra en webhook

En webhook ankommer med en body som `{ "service": "checkout", "status": "failed" }`. For at omdanne det til en OneUptime-hændelse:

1. **Webhook**-trigger ved navn `CIWebhook`.
2. **Conditions**-blok: venstre `{{CIWebhook.Request Body.status}}`, operator `==`, højre `failed`.
3. Fra **Yes**-grenen en **Create Incident**-blok med:
   - Titel: `CI build failed: {{CIWebhook.Request Body.service}}`
   - Beskrivelse: `See {{CIWebhook.Request Body.url}} for the logs.`

### Brug en hemmelighed i et API-kald

Et workflow, der kalder PagerDuty:

1. Gem `PAGERDUTY_KEY` som en hemmelig global variabel.
2. På **API**-blokken sættes `Authorization`-headeren til `Token token={{variable.PAGERDUTY_KEY}}`.

Nøglen holder sig uden for workflowet og logfilerne.

### Kæd to API-kald

Det første kald giver dig et ID, det andet har brug for:

1. **API**-blok `LookupOrder`: `GET /orders?email={{Manual.JSON.email}}`.
2. **API**-blok `CancelOrder`: `POST /orders/{{LookupOrder.response-body.id}}/cancel`.

Hvis `LookupOrder` fejler, udløses dens **error**-output i stedet for **success**. Forbind det til en Email- eller Slack-blok, så fejl ikke går ubemærket hen.

## Fælder

- **Omdøbning af en blok ødelægger referencer.** Hvis du omdøber en blok, så opdatér hvert sted, den bruges. I kørselsloggen dukker en uløst reference op som den bogstavelige tekst `{{BlockName.field}}`.
- **Variabelnavne er case-sensitive.** `{{variable.MyKey}}` og `{{variable.mykey}}` er forskellige.
- **Manglende felter bliver til tomme.** At referere et felt, der ikke findes, giver dig en tom streng, ikke en fejl. Praktisk — men det kan skjule bugs. Brug en **Conditions**-blok til at tjekke vigtige felter, før du fortsætter.

## Læs videre

- [Komponenter](/docs/workflows/components) — den fulde liste over outputs, hver blok producerer.
- [Kørsler & logfiler](/docs/workflows/runs-and-logs) — se den faktiske værdi af hver variabel efter en kørsel.
- [Konfiguration & sikkerhed](/docs/workflows/configuration) — hvad der er sikkert at lægge i en global variabel.
