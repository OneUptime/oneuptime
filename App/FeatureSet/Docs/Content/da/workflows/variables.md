# Variabler

Workflows handler om at flytte data — fra triggeren til den første blok, fra én blok til den næste, og fra delte værdier ind, hvor end du har brug for dem. Variabler er den måde, data flytter sig på.

Der findes to variabel-scopes, plus komponent-output produceret under en kørsel.

## Globale variabler

Projektomspændende værdier, du gemmer én gang og genbruger overalt. Tænk API-nøgler, URL'er, kanalnavne — alt, du ikke vil kopiere ind i ti forskellige workflows.

Find dem under **Arbejdsgange → Globale variabler**. Hver har:

- **Name** — hvordan du refererer til den. Mindst to tegn, ingen mellemrum, og kun bogstaver, tal, bindestreger og understregninger. `UPPER_SNAKE_CASE` er en god vane, fordi det skiller sig ud i dine blokke.
- **Description** — valgfri, fri tekst til at minde dig om, hvad den er til.
- **Secret** — når slået til, renses værdien ud af kørselslogfiler og trin-sporinger.
- **Content** — selve værdien. Det er et langt tekstfelt, så flerlinjede værdier virker.

Brug en global variabel i ethvert workflow med:

```
{{global.variables.NAME}}
```

Hvis du for eksempel gemte din PagerDuty-nøgle som `PAGERDUTY_KEY`, kan enhver blok bruge den som `{{global.variables.PAGERDUTY_KEY}}` — editoren gemmer referencen, og workflow-logningen renser den opløste hemmelige værdi.

Variabler oprettes og slettes, de redigeres ikke. Der er ingen redigér-knap på tabellen, så for at ændre en værdi i UI'et sletter du variablen og opretter den igen — eller opdaterer den over API'et, som dækkes sidst på denne side. Globale og workflow-variabler er en Growth-plan-funktion.

## Lokale workflow-variabler

Variabler afgrænset til ét workflow, administreret under **Workflow Variables** i det workflows venstre menu. Referér dem med:

```
{{local.variables.NAME}}
```

## Komponent-output (data fra tidligere blokke)

Enhver trigger og komponent kan producere output under en eksekvering. Brug komponent-værdivælgeren i editoren til at oprette referencen i stedet for at skrive den — den indsætter præcis de id'er, runneren forventer.

Referér en tidligere bloks output sådan her:

```
{{local.components.COMPONENT_ID.returnValues.FIELD_ID}}
```

`COMPONENT_ID` er blokkens **Identifier** — det korte id, der vises på blokken, ikke navnet, der vises på den. Nye blokke får et som `api-get-1`, og du kan omdøbe det i blokkens **ID**-afsnit. Omdøber du det, ødelægges enhver reference, der allerede peger på det, på samme måde som når en variabel omdøbes. `FIELD_ID` er det valgte return-value id.

Eksempler:

- Efter en **API**-komponent, hvis ID er `lookup-user`, kører, er dens statuskode `{{local.components.lookup-user.returnValues.response-status}}`, og dens body er `{{local.components.lookup-user.returnValues.response-body}}`.
- Efter en **Run Custom JavaScript**-komponent, hvis ID er `transform`, ligger den returnerede værdi på `{{local.components.transform.returnValues.returnValue}}`.
- Triggere for en post-type — **On Create Incident** og lignende — returnerer præcis én værdi, `model`, og du borer ind i den. For en trigger, hvis ID er `incident-on-create-1`, er hændelsens titel `{{local.components.incident-on-create-1.returnValues.model.title}}`.

Lokale variabler eksisterer kun under den aktuelle kørsel. Hver ny kørsel starter på en frisk tavle.

## Hvor variabler virker

Næsten hvert tekstfelt accepterer variabler:

- URL'en på en API-blok.
- Beskedteksten på Slack, Teams, Discord, Telegram, Email.
- Emnet og body'en på en e-mail.
- Headers- og body-felter (inde i strengværdier).
- Begge sider af en **If / Else**-blok (angivet under kategorien Conditions).

I JSON-felter kan du bruge en variabel inde i en strengværdi, men ikke som en nøgle. En reference, der udgør en hel værdi alene, erstattes ubearbejdet, så du kan lægge et helt objekt ind i et JSON-felt på den måde. Hvis du har brug for at bygge en struktur dynamisk, så brug en **Run Custom JavaScript**-blok til at bygge den, og send så dens output videre til den næste blok.

**Run Custom JavaScript**-blokken får ikke variabler automatisk — der bliver ikke indsprøjtet noget i sandboxen. Læg `{{global.variables.NAME}}` (eller enhver komponent-reference) i blokkens **Arguments**-JSON-felt; de værdier erstattes, før scriptet kører, og ankommer som `args`.

## Loop over arrays

Inde i et tekstfelt kan du iterere et array med `{{#each path}}…{{/each}}`. Inde i blokken læser `{{property}}` fra det aktuelle element, `{{@index}}` er den 0-indekserede position, og `{{this}}` er selve elementet for arrays af rene værdier. Navne inde i en `{{#each}}`-blok trimmes, så tilfældige mellemrum er harmløse der — i modsætning til alle andre steder.

## Eksempler

### Byg en payload fra en webhook

En webhook ankommer med en body som `{ "service": "checkout", "status": "failed" }`. For at omdanne det til en OneUptime-hændelse:

1. **Webhook**-trigger med id'et `ci-webhook`.
2. **If / Else**-blok: vælg webhookens Request Body-output, og brug dens `status`-egenskab, operator `==`, højre `failed`.
3. Fra **Yes**-grenen en **Create One Incident**-blok med:
   - Titel: `CI build failed: {{local.components.ci-webhook.returnValues.request-body.service}}`
   - Beskrivelse: `See {{local.components.ci-webhook.returnValues.request-body.url}} for the logs.`

### Brug en hemmelighed i et API-kald

Et workflow, der kalder PagerDuty:

1. Gem `PAGERDUTY_KEY` som en hemmelig global variabel.
2. På **API**-blokken sættes `Authorization`-headeren til `Token token={{global.variables.PAGERDUTY_KEY}}`.

Nøglen holder sig uden for workflowet og logfilerne.

### Kæd to API-kald

Det første kald giver dig et ID, det andet har brug for:

1. **API**-komponenten `lookup-order`: brug vælgeren til at indsætte den manuelle triggers JSON-e-mailfelt i `GET /orders?email=...`.
2. **API**-komponenten `cancel-order`: `POST /orders/{{local.components.lookup-order.returnValues.response-body.id}}/cancel`.

Fejler `lookup-order`, udløses dens **Error**-output i stedet for **Success**. Forbind det til en Email- eller Slack-blok, så fejl ikke går ubemærket hen.

## Opdatér en variabel fra et workflow

Et almindeligt mønster er at rotere et credential på en tidsplan: hent et frisk token fra en tredjepart, og gem det så tilbage i variablen, så den næste kørsel bruger det. Gør det med en **API**-blok, der kalder OneUptime API'et.

`PUT /api/workflow-variable/<variable-id>` med en `ApiKey`-header, og — det er den del, folk snubler over — felterne, du vil ændre, **pakket ind i et `data`-objekt**:

```json
{
  "data": {
    "content": "{{local.components.get-token.returnValues.response-body.access_token}}"
  }
}
```

En flad body uden `data`-indpakningen afvises med en 400. Send kun de felter, du faktisk vil ændre; `name` og `description` kan blive ude af payloaden.

API-nøglen skal have **Edit Workflow Variables**. Ingen læse-tilladelse er nødvendig — opdateringen læser ikke rækken tilbage.

To ting at holde øje med:

- **Omdøb ikke en variabel, du refererer til.** `name` er en del af `{{local.variables.NAME}}`. Ændrer du det, efterlader du enhver eksisterende reference uopløst, og en uopløst reference sendes videre som bogstavelig tekst — se fælden nedenfor.
- **En variabel kan skrives på denne måde, men aldrig læses tilbage.** `content` er skrive-kun over API'et for enhver variabel, hemmelig eller ej. Det er det, der gør en variabel til et sikkert sted at parkere et roterende token. Markering af den som hemmelig holder desuden værdien ude af kørselslogfiler og trin-sporinger.

## Fælder

- **Brug vælgerne.** De indsætter præcis de komponent-, return-value- og variabel-id'er, runneren forventer, og holder referencer uafhængige af de viste labels.
- **Variabelnavne er case-sensitive.** `{{global.variables.MyKey}}` og `{{global.variables.mykey}}` er forskellige.
- **En reference, der ikke løses op, forbliver, som den er — den bliver ikke tom.** At referere til noget, der ikke findes, er ikke en fejl, og det giver dig heller ikke en tom streng: krøllede parenteser sendes lige igennem, så `{{local.components.api-get-1.returnValues.body}}` med et fejlstavet trin-id ender ordret i din Slack-besked, URL eller request body, og kørslen rapporterer stadig **Executed**. Kørselsloggen bærer en advarselslinje, der navngiver enhver reference, der smuttede igennem.
- **Builderen kan ikke tjekke variabelnavne.** Den markerer komponent-referencer, den ikke kan matche — et ukendt trin-id, en ukendt return-value, en misdannet rod — før du gemmer. Den kan ikke se, om en variabel findes, så en omdøbt variabel opdages kun via kørselsloggen.
- **Mellemrum inde i de krøllede parenteser trimmes ikke.** `{{ local.variables.NAME }}` er et andet opslag end `{{local.variables.NAME}}` og løses aldrig op. Den ene undtagelse er inde i en `{{#each}}`-blok, hvor navne trimmes.

## Læs videre

- [Workflow-komponenter](/docs/workflows/components) — den fulde liste over output, hver blok producerer.
- [Workflow-kørsler & logfiler](/docs/workflows/runs-and-logs) — se den faktiske værdi af hver variabel efter en kørsel.
- [Workflow-konfiguration & sikkerhed](/docs/workflows/configuration) — hvad der er sikkert at lægge i en global variabel.
