# Variabelen

Workflows draaien om data verplaatsen — van de trigger naar het eerste blok, van het ene blok naar het volgende, en van gedeelde waarden naar elke plek waar je ze nodig hebt. Variabelen zijn hoe die data zich verplaatst.

Er zijn twee soorten, en ze delen dezelfde syntax.

## Globale variabelen

Projectbrede waarden die je één keer opslaat en overal hergebruikt. Denk aan API-sleutels, URL's, kanaalnamen — alles wat je niet wilt kopiëren naar tien verschillende workflows.

Vind ze onder **Workflows → Global Variables**. Elk heeft:

- **Name** — hoe je ernaar verwijst. Gebruik `UPPER_SNAKE_CASE` zodat het opvalt in je blokken.
- **Value** — de daadwerkelijke waarde. Waarden over meerdere regels werken ook.
- **Is Secret** — wanneer dit aanstaat, wordt de waarde na opslaan verborgen in de UI en in run-logs.

Gebruik een globale variabele in elke workflow met:

```
{{variable.NAME}}
```

Bijvoorbeeld: als je je PagerDuty-sleutel hebt opgeslagen als `PAGERDUTY_KEY`, kan elk blok hem gebruiken als `{{variable.PAGERDUTY_KEY}}` — de echte sleutel verschijnt nooit in de workflow of de logs.

## Lokale variabelen (data uit eerdere blokken)

Lokale variabelen zijn de output van blokken die al in deze uitvoering hebben gedraaid. Elke trigger en elk component produceert output die je kunt lezen.

Verwijs naar de output van een eerder blok zo:

```
{{BlockName.fieldName}}
```

`BlockName` is de naam van de trigger of component op het canvas (je kunt hem hernoemen naar iets kort en duidelijk). `fieldName` is wat dat blok produceert.

Voorbeelden:

- Nadat een **API**-blok met de naam `LookupUser` heeft gedraaid, kun je de statuscode lezen als `{{LookupUser.response-status}}` en de body als `{{LookupUser.response-body}}`.
- Nadat een **Incident → On Create**-trigger met de naam `Incident` heeft gedraaid, kun je `{{Incident.title}}`, `{{Incident.description}}` en elk ander veld op het incident lezen.
- Nadat een **Custom Code**-blok met de naam `Transform` heeft gedraaid, staat de geretourneerde waarde op `{{Transform.value}}`.

Lokale variabelen bestaan alleen tijdens de huidige run. Elke nieuwe run begint opnieuw.

## Waar variabelen werken

Bijna elk tekstveld accepteert variabelen:

- De URL op een API-blok.
- De berichttekst op Slack, Teams, Discord, Telegram, Email.
- Het onderwerp en de body van een e-mail.
- Headers en body-velden (binnen string-waarden).
- Beide kanten van een Conditions-blok.

Pure JSON-velden accepteren variabelen binnen string-waarden, maar je kunt geen variabele als sleutel gebruiken. Als je dynamisch een structuur moet bouwen, gebruik dan een **Custom Code**-blok om hem op te bouwen en geef de output door aan het volgende blok.

Het **Custom Code**-blok leest variabelen anders — globale variabelen komen binnen op `args.variables`, en jij bepaalt welke outputs van eerdere blokken je als argumenten meegeeft.

## Voorbeelden

### Een payload opbouwen vanuit een webhook

Er komt een webhook binnen met een body als `{ "service": "checkout", "status": "failed" }`. Om dat om te zetten in een OneUptime-incident:

1. **Webhook**-trigger met de naam `CIWebhook`.
2. **Conditions**-blok: links `{{CIWebhook.Request Body.status}}`, operator `==`, rechts `failed`.
3. Vanuit de **Yes**-tak een **Create Incident**-blok met:
   - Title: `CI build failed: {{CIWebhook.Request Body.service}}`
   - Description: `See {{CIWebhook.Request Body.url}} for the logs.`

### Een geheim gebruiken in een API-aanroep

Een workflow die PagerDuty aanroept:

1. Sla `PAGERDUTY_KEY` op als secret globale variabele.
2. Zet op het **API**-blok de `Authorization`-header op `Token token={{variable.PAGERDUTY_KEY}}`.

De sleutel blijft buiten de workflow en de logs.

### Twee API-aanroepen aan elkaar koppelen

De eerste aanroep geeft je een ID die de tweede nodig heeft:

1. **API**-blok `LookupOrder`: `GET /orders?email={{Manual.JSON.email}}`.
2. **API**-blok `CancelOrder`: `POST /orders/{{LookupOrder.response-body.id}}/cancel`.

Als `LookupOrder` faalt, gaat zijn **error**-output af in plaats van **success**. Verbind die met een Email- of Slack-blok zodat fouten niet onopgemerkt blijven.

## Valkuilen

- **Een blok hernoemen breekt verwijzingen.** Als je een blok hernoemt, werk dan elke plek bij waar het wordt gebruikt. In het run-log verschijnt een onopgeloste verwijzing als de letterlijke tekst `{{BlockName.field}}`.
- **Variabelenamen zijn hoofdlettergevoelig.** `{{variable.MyKey}}` en `{{variable.mykey}}` zijn verschillend.
- **Ontbrekende velden worden leeg.** Verwijzen naar een veld dat niet bestaat geeft je een lege string, geen fout. Handig — maar het kan bugs verbergen. Gebruik een **Conditions**-blok om belangrijke velden te controleren voordat je verder gaat.

## Waar verder lezen

- [Componenten](/docs/workflows/components) — de volledige lijst met outputs die elk blok produceert.
- [Uitvoeringen en logboeken](/docs/workflows/runs-and-logs) — zie de daadwerkelijke waarde van elke variabele na een run.
- [Configuratie en veiligheid](/docs/workflows/configuration) — wat veilig is om in een globale variabele te zetten.
