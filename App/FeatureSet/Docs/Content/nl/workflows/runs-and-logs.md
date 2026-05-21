# Uitvoeringen en logboeken

Elke keer dat een workflow draait, slaat OneUptime een record op van wat er is gebeurd — wanneer hij draaide, of het werkte en wat elk blok deed. Dat record heet een **run**. Runs zijn hoe je bevestigt dat een workflow werkte, een falende workflow debugt en terugkijkt op vroegere activiteit.

## Waar je ze vindt

| Pagina | Wat je ziet |
| --- | --- |
| **Workflows → Runs & Logs** | Elke run van elke workflow in het project. Filter op workflow, status en tijd. |
| **Workflow → Logs-tabblad** | Alleen de runs van deze ene workflow. |
| **Eén run** | Eén uitvoering, met de output van elk blok. |

## Run-statussen

| Status | Wat het betekent |
| --- | --- |
| **Scheduled** | De trigger is afgegaan en de run staat op het punt te starten. Duurt meestal maar een fractie van een seconde. |
| **Running** | De workflow is bezig. Langdurige blokken houden een run in deze staat. |
| **Success** | Elk blok dat draaide is zonder fouten afgerond. (Bewust de **error**-tak nemen telt nog steeds als success — de workflow zelf is niet gefaald.) |
| **Error** | Een blok is gefaald en er was geen **error**-pad verbonden om dat af te handelen. De run is daar gestopt. |
| **Timeout** | De run duurde langer dan toegestaan. Zie [Configuratie en veiligheid](/docs/workflows/configuration). |

## Een run lezen

Klik op een run om de details te openen. Je ziet:

- **Header** — de trigger, start- en eindtijd, totale duur en status.
- **Bloklijst** — elk blok dat is gedraaid, in volgorde. Elk laat zien welke waarden het kreeg, zijn output en welk pad het nam.
- **Errors** — als een blok is gefaald, het foutbericht en (indien beschikbaar) meer details.

De waarden die je ziet zijn precies wat het blok zag — nadat alle variabelen zijn ingevuld. Dit is de allernuttigste debug-view: als een Slack-bericht de letterlijke tekst `{{Incident.title}}` toont in plaats van de echte titel, dan weet je dat de variabele niet is opgelost.

## Veelvoorkomende debugging

### "Mijn workflow draaide niet."

1. Zorg dat de workflow **ingeschakeld** is in Settings. Nieuwe workflows starten uitgeschakeld.
2. Voor een OneUptime event-trigger: controleer dat het event ook echt is gebeurd. Open het record en check de geschiedenis.
3. Voor een webhook-trigger: controleer dat het andere systeem naar de juiste URL stuurt. De meeste tools loggen wanneer ze een webhook versturen — kijk daar.
4. Voor een schedule-trigger: controleer dat de cron-expressie overeenkomt met de tijd die je verwacht.

Als de trigger is afgegaan maar er geen run verschijnt, controleer dan je run-quotum onder **Project Settings → Billing**.

### "Een later blok heeft nooit gedraaid."

Een blok dat niet draait is meestal een bedradingsprobleem. Open het canvas en controleer:

- Is de output van het eerdere blok verbonden met de input van dit blok?
- Heeft het eerdere blok een andere output genomen dan je verwachtte (bijvoorbeeld **error** in plaats van **success**, of **No** in plaats van **Yes**)? Het run-detail laat zien welk pad is genomen.

### "Een variabele kwam leeg door."

Open de run en kijk naar de waarden op het falende blok.

- Als je de letterlijke tekst `{{BlockName.field}}` ziet, is de verwijzing niet opgelost — waarschijnlijk een typefout in de bloknaam of veldnaam.
- Als je een lege string ziet, heeft het eerdere blok wel gedraaid maar produceerde dat veld niet.

### "Het werkt handmatig, maar niet vanuit de trigger."

Gebruik **Run Manually** met een JSON-payload die lijkt op wat de echte trigger verstuurt. Vergelijk vervolgens de waarden in de handmatige run met de echte run naast elkaar. Het verschil zit meestal in één veldnaam of type.

## Een workflow opnieuw uitvoeren

Er is geen "retry this run"-knop. We voeren oude runs niet automatisch opnieuw uit omdat de neveneffecten (Slack-berichten, API-aanroepen, tickets) niet altijd veilig te herhalen zijn. Om het werk over te doen, fix je de workflow en laat je de volgende echte trigger hem afgaan.

Voor handmatige workflows klik je gewoon op **Run Manually** met dezelfde payload.

## Hoe lang worden runs bewaard?

Runs worden voor onbepaalde tijd bewaard voor het project. Als een workflow heel vaak draait en je geschiedenis vervuilt (zoals een debug-workflow die elke minuut afgaat), schakel hem dan uit of verwijder hem om de ruis te stoppen.

## Waar verder lezen

- [Configuratie en veiligheid](/docs/workflows/configuration) — timeouts, recursielimieten, verborgen geheimen.
- [Variabelen](/docs/workflows/variables) — de variabelesyntax die je in je blokken gebruikt.
- [Componenten](/docs/workflows/components) — wat elk blok produceert.
