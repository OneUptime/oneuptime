# Variabelen

Workflows draaien om het verplaatsen van data — van de trigger naar het eerste blok, van het ene blok naar het volgende, en van gedeelde waarden naar overal waar je ze nodig hebt. Variabelen zijn hoe die data zich verplaatst.

Er zijn twee bereiken voor variabelen, plus de componentuitvoer die tijdens een run ontstaat.

## Globale variabelen

Projectbrede waarden die je één keer opslaat en overal hergebruikt. Denk aan API-sleutels, URL's, kanaalnamen — alles wat je niet in tien verschillende workflows wilt overtypen.

Je vindt ze onder **Workflows → Globale variabelen**. Elke variabele heeft:

- **Naam** — hoe je ernaar verwijst. Minstens twee tekens, geen spaties, en alleen letters, cijfers, koppeltekens en underscores. `UPPER_SNAKE_CASE` is een goede gewoonte, omdat het opvalt in je blokken.
- **Beschrijving** — optioneel, vrije tekst om jezelf eraan te herinneren waar hij voor is.
- **Geheim** — staat dit aan, dan wordt de waarde uit runlogboeken en stapsporen gewist.
- **Inhoud** — de waarde zelf. Het is een lang tekstveld, dus waarden over meerdere regels werken ook.

Gebruik een globale variabele in elke workflow met:

```
{{global.variables.NAME}}
```

Heb je bijvoorbeeld je PagerDuty-sleutel opgeslagen als `PAGERDUTY_KEY`, dan kan elk blok hem gebruiken als `{{global.variables.PAGERDUTY_KEY}}` — de editor bewaart de verwijzing, en de workflowlogging wist de opgeloste geheime waarde.

Variabelen worden aangemaakt en verwijderd, niet bewerkt. Er is geen bewerkknop in de tabel, dus wil je een waarde in de UI wijzigen, dan verwijder je de variabele en maak je hem opnieuw aan — of je werkt hem bij via de API, wat aan het eind van deze pagina aan bod komt. Globale variabelen en workflowvariabelen zijn een functie van het Growth-abonnement.

## Lokale workflowvariabelen

Variabelen die bij één workflow horen, beheerd onder **Workflow-variabelen** in het linkermenu van die workflow. Verwijs ernaar met:

```
{{local.variables.NAME}}
```

## Componentuitvoer (data uit eerdere blokken)

Elke trigger en elk component kan tijdens een uitvoering uitvoer opleveren. Gebruik de componentwaardekiezer in de editor om de verwijzing te maken in plaats van hem te typen — die zet precies de ids neer die de runner verwacht.

Verwijs zo naar de uitvoer van een eerder blok:

```
{{local.components.COMPONENT_ID.returnValues.FIELD_ID}}
```

`COMPONENT_ID` is de **Identifier** van het blok — de korte id die op het blok staat, niet de naam die erop wordt weergegeven. Nieuwe blokken krijgen er een als `api-get-1`, en je kunt hem hernoemen in de sectie **ID** van het blok. Hernoemen breekt elke verwijzing die er al naartoe wijst, net zoals bij het hernoemen van een variabele. `FIELD_ID` is de id van de gekozen retourwaarde.

Voorbeelden:

- Nadat een **API**-component met de ID `lookup-user` heeft gedraaid, is zijn statuscode `{{local.components.lookup-user.returnValues.response-status}}` en zijn body `{{local.components.lookup-user.returnValues.response-body}}`.
- Nadat een component **Run Custom JavaScript** met de ID `transform` heeft gedraaid, is de teruggegeven waarde `{{local.components.transform.returnValues.returnValue}}`.
- Triggers voor een recordtype — **On Create Incident** en soortgenoten — geven precies één waarde terug, `model`, waarin je verder graaft. Voor een trigger met de ID `incident-on-create-1` is de titel van het incident `{{local.components.incident-on-create-1.returnValues.model.title}}`.

Lokale variabelen bestaan alleen tijdens de huidige run. Elke nieuwe run begint schoon.

## Waar variabelen werken

Bijna elk tekstveld accepteert variabelen:

- De URL op een API-blok.
- De berichttekst op Slack, Teams, Discord, Telegram en E-mail.
- Het onderwerp en de body van een e-mail.
- Header- en bodyvelden (binnen stringwaarden).
- Beide zijden van een blok **If / Else** (te vinden onder de categorie Voorwaarden).

In JSON-velden kun je een variabele binnen een stringwaarde gebruiken, maar niet als sleutel. Een verwijzing die in haar eentje een hele waarde vult, wordt kaal ingevuld, dus zo laat je een compleet object in een JSON-veld vallen. Moet je een structuur dynamisch opbouwen, gebruik dan een blok **Run Custom JavaScript** om hem te bouwen en geef de uitvoer door aan het volgende blok.

Het blok **Run Custom JavaScript** krijgt variabelen niet automatisch — er wordt niets in de sandbox geïnjecteerd. Zet `{{global.variables.NAME}}` (of een willekeurige componentverwijzing) in het JSON-veld **Arguments** van het blok; die waarden worden vóór het script ingevuld en komen binnen als `args`.

## Over arrays itereren

Binnen een tekstveld kun je met `{{#each path}}…{{/each}}` over een array lopen. Binnen dat blok leest `{{property}}` uit het huidige element, is `{{@index}}` de positie vanaf 0, en is `{{this}}` het element zelf bij arrays van simpele waarden. Namen binnen een `{{#each}}`-blok worden getrimd, dus losse spaties zijn daar onschuldig — anders dan overal elders.

## Voorbeelden

### Een payload bouwen uit een webhook

Er komt een webhook binnen met een body als `{ "service": "checkout", "status": "failed" }`. Om daar een OneUptime-incident van te maken:

1. **Webhook**-trigger met de id `ci-webhook`.
2. Blok **If / Else**: kies de uitvoer Request Body van de webhook en gebruik zijn eigenschap `status`, operator `==`, rechts `failed`.
3. Vanaf de tak **Ja** een blok **Create One Incident** met:
   - Titel: `CI build failed: {{local.components.ci-webhook.returnValues.request-body.service}}`
   - Beschrijving: `See {{local.components.ci-webhook.returnValues.request-body.url}} for the logs.`

### Een geheim gebruiken in een API-aanroep

Een workflow die PagerDuty aanroept:

1. Sla `PAGERDUTY_KEY` op als geheime globale variabele.
2. Zet op het blok **API** de header `Authorization` op `Token token={{global.variables.PAGERDUTY_KEY}}`.

De sleutel blijft buiten de workflow en buiten de logboeken.

### Twee API-aanroepen aan elkaar knopen

De eerste aanroep geeft je een ID die de tweede nodig heeft:

1. **API**-component `lookup-order`: gebruik de kiezer om het e-mailveld uit de JSON van de Manual-trigger in te voegen in `GET /orders?email=...`.
2. **API**-component `cancel-order`: `POST /orders/{{local.components.lookup-order.returnValues.response-body.id}}/cancel`.

Mislukt `lookup-order`, dan gaat zijn uitgang **Fout** af in plaats van **Succes**. Verbind die met een E-mail- of Slack-blok, zodat mislukkingen niet onopgemerkt blijven.

## Een variabele bijwerken vanuit een workflow

Een veelgebruikt patroon is het roteren van een inloggegeven volgens een schema: haal een verse token op bij een derde partij en sla die terug in de variabele, zodat de volgende run hem oppikt. Dat doe je met een **API**-blok dat de OneUptime-API aanroept.

`PUT /api/workflow-variable/<variable-id>` met een `ApiKey`-header, en — dit is het stuk waar mensen over struikelen — de velden die je wilt wijzigen **verpakt in een `data`-object**:

```json
{
  "data": {
    "content": "{{local.components.get-token.returnValues.response-body.access_token}}"
  }
}
```

Een platte body zonder de `data`-verpakking wordt geweigerd met een 400. Stuur alleen de velden die je echt wilt wijzigen; `name` en `description` mogen buiten de payload blijven.

De API-sleutel heeft **Edit Workflow Variables** nodig. Leesrechten zijn niet vereist — de update leest de rij niet terug.

Twee dingen om op te letten:

- **Hernoem geen variabele waar je naar verwijst.** `name` is onderdeel van `{{local.variables.NAME}}`. Verander je hem, dan blijft elke bestaande verwijzing onopgelost, en een onopgeloste verwijzing wordt als letterlijke tekst doorgegeven — zie de valkuil hieronder.
- **Een variabele kun je zo wel schrijven, maar nooit teruglezen.** `content` is via de API alleen-schrijven, voor elke variabele, geheim of niet. Juist daarom is een variabele een veilige plek om een roterende token te parkeren. Markeer je hem als geheim, dan blijft de waarde bovendien uit runlogboeken en stapsporen.

## Valkuilen

- **Gebruik de kiezers.** Ze zetten precies de component-, retourwaarde- en variabele-ids neer die de runner verwacht, en houden verwijzingen los van weergavelabels.
- **Variabelenamen zijn hoofdlettergevoelig.** `{{global.variables.MyKey}}` en `{{global.variables.mykey}}` zijn verschillend.
- **Een verwijzing die niet oplost, blijft staan zoals hij is — hij wordt niet leeggemaakt.** Verwijzen naar iets dat niet bestaat is geen fout, en het levert je ook geen lege string op: de accolades gaan er onveranderd doorheen, dus `{{local.components.api-get-1.returnValues.body}}` met een verkeerd getypte stap-id belandt letterlijk in je Slack-bericht, URL of request body, en de run meldt alsnog **Executed**. Het runlogboek bevat een waarschuwingsregel met elke verwijzing die erdoorheen glipte.
- **De bouwer kan variabelenamen niet controleren.** Componentverwijzingen die hij niet kan thuisbrengen markeert hij nog vóór je opslaat — een onbekende stap-id, een onbekende retourwaarde, een misvormde wortel. Of een variabele bestaat, kan hij niet zien, dus een hernoemde variabele merk je alleen aan het runlogboek.
- **Spaties binnen de accolades worden niet getrimd.** `{{ local.variables.NAME }}` is een andere opzoeking dan `{{local.variables.NAME}}` en lost nooit op. De enige uitzondering is binnen een `{{#each}}`-blok, waar namen wél worden getrimd.

## Waar je verder kunt lezen

- [Workflow-componenten](/docs/workflows/components) — de volledige lijst met uitvoer die elk blok oplevert.
- [Workflow-uitvoeringen en logboeken](/docs/workflows/runs-and-logs) — de werkelijke waarde van elke variabele na een run.
- [Workflow-configuratie en veiligheid](/docs/workflows/configuration) — wat veilig is om in een globale variabele te zetten.
