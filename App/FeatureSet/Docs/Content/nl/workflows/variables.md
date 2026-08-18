# Variabelen

Workflows draaien om het verplaatsen van data — van de trigger naar het eerste blok, van het ene blok naar het volgende, en van gedeelde waarden naar overal waar je ze nodig hebt. Variabelen zijn hoe die data zich verplaatst.

Er zijn twee variabelenscopes, plus component-outputs die tijdens een run worden geproduceerd.

## Globale variabelen

Projectbrede waarden die je één keer opslaat en overal hergebruikt. Denk aan API-sleutels, URL's, kanaalnamen — alles wat je niet in tien verschillende workflows wilt kopiëren.

Vind ze onder **Workflows → Global Variables**. Elk heeft:

- **Name** — hoe je ernaar verwijst. Minstens twee tekens, geen spaties, en alleen letters, cijfers, koppeltekens en underscores. `UPPER_SNAKE_CASE` is een goede gewoonte omdat het opvalt in je blokken.
- **Description** — optioneel, vrije tekst om je te herinneren waarvoor hij dient.
- **Secret** — wanneer dit aanstaat, wordt de waarde uit run-logs en steptraces geschrapt.
- **Content** — de daadwerkelijke waarde. Het is een lang-tekstveld, dus meerregelige waarden werken ook.

Gebruik een globale variabele in elke workflow met:

```
{{global.variables.NAME}}
```

Bijvoorbeeld: als je je PagerDuty-sleutel hebt opgeslagen als `PAGERDUTY_KEY`, kan elk blok hem gebruiken als `{{global.variables.PAGERDUTY_KEY}}` — de editor bewaart de verwijzing, en workflowlogging schrapt de opgeloste geheime waarde.

Variabelen worden aangemaakt en verwijderd, niet bewerkt. Er is geen bewerkknop op de tabel, dus om een waarde in de UI te wijzigen verwijder je de variabele en maak je hem opnieuw aan — of je werkt hem bij via de API, wat aan het eind van deze pagina wordt behandeld. Global en Workflow Variables zijn een Growth-planfunctie.

## Lokale workflowvariabelen

Variabelen die tot één workflow zijn beperkt, beheerd onder **Workflow Variables** in het linkermenu van die workflow. Verwijs ernaar met:

```
{{local.variables.NAME}}
```

## Component-outputs (data uit eerdere blokken)

Elke trigger en elk component kan tijdens een uitvoering output produceren. Gebruik de component-value-picker in de editor om de verwijzing aan te maken in plaats van hem te typen — hij voegt precies de ids in die de runner verwacht.

Verwijs naar de output van een eerder blok zo:

```
{{local.components.COMPONENT_ID.returnValues.FIELD_ID}}
```

`COMPONENT_ID` is de **Identifier** van het blok — de korte id die op het blok wordt getoond, niet de naam die erop wordt weergegeven. Nieuwe blokken krijgen er een zoals `api-get-1`, en je kunt hem hernoemen in de **ID**-sectie van het blok. Hem hernoemen breekt elke verwijzing die er al naar wijst, op dezelfde manier als het hernoemen van een variabele. `FIELD_ID` is de geselecteerde return-value-id.

Voorbeelden:

- Nadat een **API**-component met ID `lookup-user` heeft gedraaid, is zijn statuscode `{{local.components.lookup-user.returnValues.response-status}}` en zijn body `{{local.components.lookup-user.returnValues.response-body}}`.
- Nadat een **Run Custom JavaScript**-component met ID `transform` heeft gedraaid, staat de geretourneerde waarde op `{{local.components.transform.returnValues.returnValue}}`.
- Triggers voor een recordtype — **On Create Incident** en soortgenoten — retourneren precies één waarde, `model`, en daar boor je in door. Voor een trigger met ID `incident-on-create-1` is de titel van het incident `{{local.components.incident-on-create-1.returnValues.model.title}}`.

Lokale variabelen bestaan alleen tijdens de huidige run. Elke nieuwe run begint opnieuw.

## Waar variabelen werken

Bijna elk tekstveld accepteert variabelen:

- De URL op een API-blok.
- De berichttekst op Slack, Teams, Discord, Telegram, Email.
- Het onderwerp en de body van een e-mail.
- Headers en body-velden (binnen string-waarden).
- Beide kanten van een **If / Else**-blok (vermeld onder de categorie Conditions).

In JSON-velden kun je een variabele gebruiken binnen een string-waarde, maar niet als sleutel. Een verwijzing die op zichzelf een volledige waarde vormt, wordt kaal gesubstitueerd, zodat je op die manier een heel object in een JSON-veld kunt zetten. Als je dynamisch een structuur moet opbouwen, gebruik dan een **Run Custom JavaScript**-blok om hem op te bouwen en geef de output door aan het volgende blok.

Het **Run Custom JavaScript**-blok krijgt niet automatisch variabelen — er wordt niets in de sandbox geïnjecteerd. Zet `{{global.variables.NAME}}` (of een andere componentverwijzing) in het **Arguments**-JSON-veld van het blok; die waarden worden gesubstitueerd voordat het script draait en komen aan als `args`.

## Itereren over arrays

Binnen een tekstveld kun je een array doorlopen met `{{#each path}}…{{/each}}`. Binnen het blok leest `{{property}}` uit het huidige element, is `{{@index}}` de 0-gebaseerde positie, en is `{{this}}` het element zelf voor arrays van eenvoudige waarden. Namen binnen een `{{#each}}`-blok worden getrimd, dus overtollige spaties zijn daar onschadelijk — anders dan overal elders.

## Voorbeelden

### Een payload opbouwen vanuit een webhook

Er komt een webhook binnen met een body als `{ "service": "checkout", "status": "failed" }`. Om dat om te zetten in een OneUptime-incident:

1. **Webhook**-trigger met de id `ci-webhook`.
2. **If / Else**-blok: selecteer de Request Body-output van de webhook en gebruik de eigenschap `status`, operator `==`, rechts `failed`.
3. Vanuit de **Yes**-tak een **Create One Incident**-blok met:
   - Title: `CI build failed: {{local.components.ci-webhook.returnValues.request-body.service}}`
   - Description: `See {{local.components.ci-webhook.returnValues.request-body.url}} for the logs.`

### Een geheim gebruiken in een API-aanroep

Een workflow die PagerDuty aanroept:

1. Sla `PAGERDUTY_KEY` op als geheime globale variabele.
2. Zet op het **API**-blok de `Authorization`-header op `Token token={{global.variables.PAGERDUTY_KEY}}`.

De sleutel blijft buiten de workflow en de logs.

### Twee API-aanroepen aan elkaar koppelen

De eerste aanroep geeft je een ID die de tweede nodig heeft:

1. **API**-component `lookup-order`: gebruik de picker om het JSON e-mailveld van de handmatige trigger in te voegen in `GET /orders?email=...`.
2. **API**-component `cancel-order`: `POST /orders/{{local.components.lookup-order.returnValues.response-body.id}}/cancel`.

Als `lookup-order` faalt, gaat zijn **Error**-output af in plaats van **Success**. Verbind die met een Email- of Slack-blok zodat fouten niet onopgemerkt blijven.

## Een variabele bijwerken vanuit een workflow

Een veelvoorkomend patroon is het rouleren van een credential op een schema: haal een nieuw token op bij een derde partij en sla het vervolgens terug op in de variabele, zodat de volgende run het oppikt. Doe dat met een **API**-blok dat de OneUptime-API aanroept.

`PUT /api/workflow-variable/<variable-id>` met een `ApiKey`-header, en — dit is het deel waar mensen over struikelen — de velden die je wilt wijzigen **verpakt in een `data`-object**:

```json
{
  "data": {
    "content": "{{local.components.get-token.returnValues.response-body.access_token}}"
  }
}
```

Een platte body zonder de `data`-wrapper wordt geweigerd met een 400. Stuur alleen de velden die je daadwerkelijk wilt wijzigen; `name` en `description` mogen buiten de payload blijven.

De API-sleutel heeft **Edit Workflow Variables** nodig. Er is geen leesrecht vereist — de update leest de rij niet terug.

Twee dingen om op te letten:

- **Hernoem geen variabele waarnaar je verwijst.** `name` maakt deel uit van `{{local.variables.NAME}}`. Hem wijzigen laat elke bestaande verwijzing onopgelost, en een onopgeloste verwijzing wordt doorgegeven als letterlijke tekst — zie de valkuil hieronder.
- **Een variabele kan zo worden geschreven, maar nooit teruggelezen.** `content` is write-only over de API voor elke variabele, geheim of niet. Dat maakt een variabele een veilige plek om een roterend token te parkeren. Hem als geheim markeren houdt de waarde daarnaast buiten run-logs en steptraces.

## Valkuilen

- **Gebruik de pickers.** Ze voegen precies de component-, return-value- en variabele-ids in die de runner verwacht, en houden verwijzingen onafhankelijk van weergavelabels.
- **Variabelenamen zijn hoofdlettergevoelig.** `{{global.variables.MyKey}}` en `{{global.variables.mykey}}` zijn verschillend.
- **Een verwijzing die niet oplost, blijft ongewijzigd staan, wordt niet leeggemaakt.** Verwijzen naar iets dat niet bestaat is geen fout, en het geeft je ook geen lege string: de accolades worden gewoon doorgegeven, dus `{{local.components.api-get-1.returnValues.body}}` met een verkeerd gespelde step-id belandt letterlijk in je Slack-bericht, URL of request body, en de run rapporteert nog steeds **Executed**. Het run-log bevat een waarschuwingsregel die elke verwijzing noemt die is doorgeglipt.
- **De builder kan variabelenamen niet controleren.** Hij markeert componentverwijzingen die hij niet kan matchen — een onbekende step-id, een onbekende return value, een misvormde root — voordat je opslaat. Hij kan niet zien of een variabele bestaat, dus een hernoemde variabele wordt alleen opgevangen door het run-log.
- **Spaties binnen de accolades worden niet getrimd.** `{{ local.variables.NAME }}` is een andere lookup dan `{{local.variables.NAME}}` en lost nooit op. De enige uitzondering is binnen een `{{#each}}`-blok, waar namen worden getrimd.

## Waar verder lezen

- [Componenten](/docs/workflows/components) — de volledige lijst met outputs die elk blok produceert.
- [Uitvoeringen en logboeken](/docs/workflows/runs-and-logs) — zie de daadwerkelijke waarde van elke variabele na een run.
- [Configuratie en veiligheid](/docs/workflows/configuration) — wat veilig is om in een globale variabele te zetten.
