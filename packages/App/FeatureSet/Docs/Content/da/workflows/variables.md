# Variabler

Workflows handler om at flytte data — fra triggeren til den første blok, fra én blok til den næste, og fra fælles værdier ud dér, hvor du har brug for dem. Variabler er den måde, de data flytter sig på.

Der er to variabelniveauer, plus de komponent-output, der opstår undervejs i en kørsel.

## Globale variabler

Projektbrede værdier, du gemmer én gang og genbruger overalt. Tænk API-nøgler, URL'er, kanalnavne — alt det, du ikke gider kopiere ind i ti forskellige workflows.

Du finder dem under **Arbejdsgange → Globale variabler**. Hver af dem har:

- **Navn** — sådan henviser du til den. Mindst to tegn, ingen mellemrum, og kun bogstaver, tal, bindestreger og understreger. `UPPER_SNAKE_CASE` er en god vane, fordi det springer i øjnene i dine blokke.
- **Beskrivelse** — valgfri fritekst, der minder dig om, hvad den er til.
- **Hemmelighed** — når den er slået til, renses værdien ud af kørselslogs og trinspor.
- **Indhold** — selve værdien. Det er et langt tekstfelt, så værdier over flere linjer fungerer fint.

Brug en global variabel i et hvilket som helst workflow med:

```
{{global.variables.NAME}}
```

Har du for eksempel gemt din PagerDuty-nøgle som `PAGERDUTY_KEY`, kan enhver blok bruge den som `{{global.variables.PAGERDUTY_KEY}}` — editoren gemmer henvisningen, og workflowlogningen renser den opløste hemmelige værdi væk.

Variabler bliver oprettet og slettet, ikke redigeret. Der er ingen redigeringsknap i tabellen, så vil du ændre en værdi i brugerfladen, sletter du variablen og opretter den igen — eller opdaterer den over API'et, som er beskrevet sidst på denne side. Globale variabler og workflowvariabler er en funktion på Growth-planen.

## Lokale workflowvariabler

Variabler, der kun gælder ét workflow, og som du styrer under **Arbejdsgangsvariabler** i det workflows venstremenu. Henvis til dem med:

```
{{local.variables.NAME}}
```

## Komponent-output (data fra tidligere blokke)

Enhver trigger og komponent kan producere output under en eksekvering. Brug komponentværdi-vælgeren i editoren til at lave henvisningen frem for at skrive den selv — den indsætter præcis de id'er, runneren forventer.

Sådan henviser du til en tidligere bloks output:

```
{{local.components.COMPONENT_ID.returnValues.FIELD_ID}}
```

`COMPONENT_ID` er blokkens **Identifier** — det korte id, der står på blokken, ikke det navn, der vises på den. Nye blokke får et i stil med `api-get-1`, og du kan omdøbe det i blokkens **ID**-sektion. Omdøber du det, ødelægger du alle de henvisninger, der allerede peger på den, ganske som når du omdøber en variabel. `FIELD_ID` er id'et på den valgte returværdi.

Eksempler:

- Når en **API**-komponent med id'et `lookup-user` har kørt, er dens statuskode `{{local.components.lookup-user.returnValues.response-status}}` og dens body `{{local.components.lookup-user.returnValues.response-body}}`.
- Når en **Run Custom JavaScript**-komponent med id'et `transform` har kørt, er dens returnerede værdi `{{local.components.transform.returnValues.returnValue}}`.
- Triggere for en posttype — **On Create Incident** og dens søskende — returnerer præcis én værdi, `model`, som du så borer ned i. For en trigger med id'et `incident-on-create-1` er hændelsens titel `{{local.components.incident-on-create-1.returnValues.model.title}}`.

Lokale variabler findes kun under den igangværende kørsel. Hver ny kørsel starter på en frisk.

## Hvor variabler virker

Næsten alle tekstfelter tager imod variabler:

- URL'en på en API-blok.
- Beskedteksten på Slack, Teams, Discord, Telegram, Email.
- Emnet og brødteksten i en e-mail.
- Headere og body-felter (inde i strengværdier).
- Begge sider af en **If / Else**-blok (den ligger under kategorien Conditions).

I JSON-felter kan du bruge en variabel inde i en strengværdi, men ikke som nøgle. En henvisning, der udfylder en hel værdi alene, indsættes rå, så du kan lægge et helt objekt ind i et JSON-felt på den måde. Skal du bygge en struktur dynamisk, så brug en **Run Custom JavaScript**-blok til at bygge den, og send dens output videre til den næste blok.

**Run Custom JavaScript**-blokken får ikke variabler automatisk — der sprøjtes ikke noget ind i sandkassen. Sæt `{{global.variables.NAME}}` (eller en hvilken som helst komponenthenvisning) ind i blokkens JSON-felt **Arguments**; de værdier indsættes, før scriptet kører, og ankommer som `args`.

## Loop over arrays

Inde i et tekstfelt kan du løbe et array igennem med `{{#each path}}…{{/each}}`. Inde i blokken læser `{{property}}` fra det aktuelle element, `{{@index}}` er positionen talt fra 0, og `{{this}}` er selve elementet, når der er tale om et array af almindelige værdier. Navne inde i en `{{#each}}`-blok bliver trimmet, så løse mellemrum gør ingen skade der — modsat alle andre steder.

## Eksempler

### Byg en payload ud fra en webhook

Der kommer en webhook ind med en body som `{ "service": "checkout", "status": "failed" }`. Sådan laver du det om til en OneUptime-hændelse:

1. **Webhook**-trigger med id'et `ci-webhook`.
2. **If / Else**-blok: vælg webhookens Request Body-output, og brug dens `status`-egenskab, operator `==`, højre side `failed`.
3. Fra **Ja**-grenen en **Create One Incident**-blok med:
   - Titel: `CI build failed: {{local.components.ci-webhook.returnValues.request-body.service}}`
   - Beskrivelse: `See {{local.components.ci-webhook.returnValues.request-body.url}} for the logs.`

### Brug en hemmelighed i et API-kald

Et workflow, der kalder PagerDuty:

1. Gem `PAGERDUTY_KEY` som en hemmelig global variabel.
2. Sæt `Authorization`-headeren på **API**-blokken til `Token token={{global.variables.PAGERDUTY_KEY}}`.

Nøglen holder sig ude af både workflowet og loggene.

### Kæd to API-kald sammen

Det første kald giver dig et ID, som det næste skal bruge:

1. **API**-komponenten `lookup-order`: brug vælgeren til at sætte manual-triggerens JSON-e-mailfelt ind i `GET /orders?email=...`.
2. **API**-komponenten `cancel-order`: `POST /orders/{{local.components.lookup-order.returnValues.response-body.id}}/cancel`.

Fejler `lookup-order`, fyrer dens **Fejl**-output i stedet for **Succes**. Forbind det til en Email- eller Slack-blok, så fejl ikke går ubemærket hen.

## Opdatér en variabel fra et workflow

Et almindeligt mønster er at rotere en adgangsnøgle efter en tidsplan: hent et friskt token fra en tredjepart, og gem det så tilbage i variablen, så den næste kørsel samler det op. Det gør du med en **API**-blok, der kalder OneUptime-API'et.

`PUT /api/workflow-variable/<variable-id>` med en `ApiKey`-header og — det er den del, folk snubler over — de felter, du vil ændre, **pakket ind i et `data`-objekt**:

```json
{
  "data": {
    "content": "{{local.components.get-token.returnValues.response-body.access_token}}"
  }
}
```

En flad body uden `data`-indpakningen bliver afvist med en 400. Send kun de felter, du faktisk vil ændre; `name` og `description` kan blive ude af payloaden.

API-nøglen skal have **Edit Workflow Variables**. Der kræves ingen læserettighed — opdateringen læser ikke rækken tilbage.

To ting at holde øje med:

- **Omdøb ikke en variabel, du henviser til.** `name` er en del af `{{local.variables.NAME}}`. Ændrer du det, står alle eksisterende henvisninger uopløste, og en uopløst henvisning sendes videre som bogstavelig tekst — se fælden nedenfor.
- **En variabel kan skrives på denne måde, men aldrig læses tilbage.** `content` kan kun skrives, aldrig læses, over API'et — for enhver variabel, hemmelig eller ej. Det er dét, der gør en variabel til et sikkert sted at parkere et token, der roterer. Markerer du den som hemmelig, holdes værdien desuden ude af kørselslogs og trinspor.

## Fælder

- **Brug vælgerne.** De indsætter præcis de komponent-, returværdi- og variabel-id'er, runneren forventer, og holder henvisningerne uafhængige af de viste navne.
- **Der er forskel på store og små bogstaver i variabelnavne.** `{{global.variables.MyKey}}` og `{{global.variables.mykey}}` er to forskellige ting.
- **En henvisning, der ikke kan opløses, bliver stående, som den er — den bliver ikke tømt.** At henvise til noget, der ikke findes, er ikke en fejl, og du får heller ikke en tom streng: krølleparenteserne sendes lige igennem, så `{{local.components.api-get-1.returnValues.body}}` med et forkert stavet trin-id ender ordret i din Slack-besked, URL eller request body, og kørslen melder stadig **Executed**. Kørselsloggen har en advarselslinje, der navngiver enhver henvisning, som slap igennem.
- **Byggeren kan ikke tjekke variabelnavne.** Den markerer de komponenthenvisninger, den ikke kan matche — et ukendt trin-id, en ukendt returværdi, en misdannet rod — før du gemmer. Den kan ikke se, om en variabel findes, så en omdøbt variabel bliver først fanget af kørselsloggen.
- **Mellemrum inde i krølleparenteserne bliver ikke trimmet.** `{{ local.variables.NAME }}` er et andet opslag end `{{local.variables.NAME}}` og bliver aldrig opløst. Den eneste undtagelse er inde i en `{{#each}}`-blok, hvor navne bliver trimmet.

## Hvor du kan læse videre

- [Workflow-komponenter](/docs/workflows/components) — den fulde liste over det output, hver blok producerer.
- [Workflow-kørsler & logfiler](/docs/workflows/runs-and-logs) — se den faktiske værdi af hver variabel efter en kørsel.
- [Workflow-konfiguration & sikkerhed](/docs/workflows/configuration) — hvad der er sikkert at lægge i en global variabel.
