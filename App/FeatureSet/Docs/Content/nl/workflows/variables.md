# Workflow-variabelen

Een workflow is pas nuttig wanneer er data doorheen stroomt. Variabelen zijn hoe die data zich verplaatst — van de trigger naar de eerste component, van de output van de ene component naar de input van de volgende, en van geheimen op projectniveau naar overal waar ze worden aangeroepen.

OneUptime heeft twee soorten variabelen en één interpolatiesyntax die voor beide werkt.

## Globale variabelen

Projectbrede waarden die één keer worden gedefinieerd onder **Workflows → Global Variables**. Denk aan API-sleutels, basis-URL's, kanaalnamen, alles wat je niet hardcoded in tien workflows wilt zetten.

Een globale variabele heeft:

- **Naam** — de identifier waarmee je ernaar verwijst. Gebruik `UPPER_SNAKE_CASE` om hem in templates duidelijk te onderscheiden.
- **Waarde** — de stringwaarde. Meerregelige waarden worden ondersteund.
- **Is Secret** — wanneer aan, is de waarde write-only in de UI na opslaan en wordt hij geredigeerd uit runlogs.

Verwijs vanuit elke plek in elke workflow naar een globale variabele met:

```
{{variable.NAME}}
```

Als je bijvoorbeeld `PAGERDUTY_KEY` als geheime variabele hebt gedefinieerd, kan elke API-component die PagerDuty aanroept hem lezen als `{{variable.PAGERDUTY_KEY}}` zonder dat iemand de daadwerkelijke sleutel in de workflow-JSON ziet.

## Lokale variabelen

Lokale variabelen zijn de returnwaarden van nodes die al binnen deze uitvoering hebben gedraaid. Elke trigger en elke component publiceert er één — zie [Triggers](/docs/workflows/triggers) en [Componenten](/docs/workflows/components) voor de lijsten per node.

Verwijs naar een lokale variabele als:

```
{{NodeId.fieldName}}
```

De `NodeId` is de naam van de trigger of component op het canvas (je kunt hem hernoemen voor leesbaarheid — houd hem kort en `PascalCase`, zodat de verwijzingen schoon blijven). De `fieldName` is wat die node publiceert.

Voorbeelden:

- Nadat een **API**-component genaamd `LookupUser` met succes is teruggekeerd, kunnen stroomafwaartse nodes de statuscode lezen als `{{LookupUser.response-status}}` en de geparseerde body als `{{LookupUser.response-body}}`.
- Na een **Incident → On Create**-trigger genaamd `Incident` kun je `{{Incident.title}}`, `{{Incident.description}}`, `{{Incident.incidentSeverityId}}` en elke andere kolom op het incident lezen.
- Na een **Custom Code**-component genaamd `Transform` wordt de geretourneerde waarde blootgesteld als `{{Transform.value}}`.

Lokale variabelen gelden voor één run. De volgende run begint met een schone lei.

## Waar interpolatie werkt

Vrijwel elk tekstachtig argument ondersteunt interpolatie:

- URL-velden op de API-component
- Berichttekst op Slack / Teams / Discord / Telegram / E-mail
- Onderwerp en body op E-mail
- Headers en body-velden (gebruik hem binnen JSON-waarden)
- Linker- en rechteroperanden op Conditions

Pure JSON-argumenten accepteren interpolatie binnen stringwaarden; je kunt geen sleutel interpoleren. Als je een dynamische structuur moet opbouwen, gebruik **Custom Code** om de payload samen te stellen en pipe vervolgens de returnwaarde naar de volgende node.

De **Custom Code**-component leest variabelen anders — globale variabelen worden blootgesteld op `args.variables`, en returnwaarden van bovenliggende nodes worden doorgegeven als benoemde argumenten die je op de component configureert.

## Voorbeelden

### Een payload opbouwen uit een trigger

Een webhook ontvangt een resultaat van een CI-build. De body is JSON zoals `{ "service": "checkout", "status": "failed" }`. Om dat om te zetten in een OneUptime-incident:

1. **Webhook**-trigger genaamd `CIWebhook`.
2. **Conditions**-component: links `{{CIWebhook.Request Body.status}}`, operator `==`, rechts `failed`.
3. Vanuit de `yes`-poort, een **Create Incident**-component met:
   - Titel: `CI build failed: {{CIWebhook.Request Body.service}}`
   - Beschrijving: `See {{CIWebhook.Request Body.url}} for the build logs.`

### Een geheim gebruiken in een uitgaande API-aanroep

Een workflow die PagerDuty aanroept:

1. Definieer `PAGERDUTY_KEY` als geheime globale variabele.
2. Stel op de **API**-component de `Authorization`-header in op `Token token={{variable.PAGERDUTY_KEY}}`.

De sleutel verschijnt nooit in de workflow-JSON of in runlogs.

### Twee API-aanroepen aaneenrijgen

De eerste aanroep retourneert een ID die de tweede aanroep nodig heeft:

1. **API**-component `LookupOrder`: `GET /orders?email={{Manual.JSON.email}}`.
2. **API**-component `CancelOrder`: `POST /orders/{{LookupOrder.response-body.id}}/cancel`.

Als `LookupOrder` een niet-2xx-respons retourneert, gaat zijn `error`-poort af in plaats van `success` — koppel die tak aan een E-mail- of Slack-component, zodat fouten niet stilzwijgend voorbij gaan.

## Een paar valkuilen

- **Typefouten in nodenamen breken verwijzingen stilzwijgend.** Als je een node hernoemt nadat je `{{OldName.field}}` stroomafwaarts hebt gekoppeld, werk dan elke verwijzing bij. Kijk in het runlog — als je de letterlijke `{{OldName.field}}` ziet in het vastgelegde argument, dan is de lookup niet gelukt.
- **Geheimen zijn hoofdlettergevoelig.** `{{variable.MyKey}}` en `{{variable.mykey}}` zijn verschillende variabelen.
- **Ontbrekende velden zijn leeg.** Een verwijzing naar `{{Foo.nonexistent}}` produceert een lege string, geen fout. Handig, maar het kan bugs maskeren — gebruik een **Conditions**-node om aanwezigheid af te dwingen als het veld vereist is voor de volgende stap.

## Waar verder lezen

- [Componenten](/docs/workflows/components) — de volledige catalogus van returnwaarde-namen.
- [Uitvoeringen en logboeken](/docs/workflows/runs-and-logs) — inspecteer de letterlijke waarde van elk geïnterpoleerd argument na een run.
- [Configuratie en veiligheid](/docs/workflows/configuration) — wat veilig is om in een globale variabele te zetten.
