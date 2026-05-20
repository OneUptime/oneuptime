# Workflow-uitvoeringen en logboeken

Elke keer dat de trigger van een workflow afgaat, maakt OneUptime een **run** aan — een record van één uitvoering met timing, status en output per node. Runs zijn hoe je bevestigt dat een workflow werkte, hoe je een falende workflow debugt, en hoe je een postmortem schrijft wanneer een automatisering zich misdraagt.

## Waar je ze vindt

| Pagina | Reikwijdte |
| --- | --- |
| **Workflows → Runs & Logs** | Projectbreed. Elke run van elke workflow. Filter op workflow, status en tijdsbereik. |
| **Het Logs-tabblad van een workflow** | Alleen de runs van deze workflow. |
| **De detailpagina van een run** | Eén uitvoering, uitgeklapt met output per node en eventuele foutmeldingen. |

## Run-statussen

| Status | Betekenis |
| --- | --- |
| **Scheduled** | De trigger ging af en de run staat in de wachtrij, maar de worker heeft hem nog niet opgepakt. Meestal een fractie van een seconde. |
| **Running** | De worker loopt op dit moment de graph af. Langlopende componenten (trage HTTP-aanroepen, opzettelijke vertragingen) houden een run in deze status. |
| **Success** | Elke node die heeft gedraaid is foutloos afgerond. (Een workflow die opzettelijk een `error`-tak heeft genomen is alsnog `Success` in totaal — de workflow zelf is niet gefaald.) |
| **Error** | Een node faalde en er was geen `error`-poort aangesloten om dat af te vangen. De run stopte bij die node. |
| **Timeout** | De run overschreed de per-run-timeout. Zie [Configuratie en veiligheid](/docs/workflows/configuration). |

## Een run lezen

Klik op een run uit de lijst om de detailpagina te openen. Je ziet:

- **Header** — de trigger die afging, de begin- en eindtimestamp, totale duur, status.
- **Nodelijst** — elke node die in volgorde is uitgevoerd, elk met zijn vastgelegde argumenten, returnwaarde en gekozen output-poort.
- **Fouten** — als een node faalde, het foutbericht en (indien beschikbaar) de stack trace.

De vastgelegde argumenten tonen de *post-interpolatie*-waarden — d.w.z. de exacte strings die de node zag nadat variabelen waren opgelost. Dit is de bruikbaarste debug-weergave: als een Slack-bericht de letterlijke tekst `{{Incident.title}}` bevat, weet je dat de variabele-referentie niet is opgelost.

## Veelvoorkomende debug-patronen

### "Mijn workflow ging niet af."

1. Bevestig dat de workflow **ingeschakeld** is in **Settings**. Nieuwe workflows worden uitgeschakeld geleverd.
2. Voor een model-event-trigger: bevestig dat het event daadwerkelijk plaatsvond. Open de entiteit (het incident, alert, monitor) en bekijk de geschiedenis.
3. Voor een webhook-trigger: bevestig dat het externe systeem de juiste URL aanroept. Veel tools loggen uitgaande webhook-levering — kijk daar.
4. Voor een schedule-trigger: bevestig dat de cron-expressie evalueert naar het tijdstip dat je verwacht. Gebruik een cron-parser bij twijfel.

Als de trigger afging maar er geen run verschijnt, controleer dan het runquotum van het project onder **Project Settings → Billing**.

### "Hij draait, maar een stroomafwaartse node wordt nooit uitgevoerd."

Een node die niet draait is meestal een bedradingsprobleem. Open het canvas en controleer:

- Is de output-poort van de bovenliggende node daadwerkelijk verbonden met de input-poort van deze node?
- Heeft de bovenliggende node een andere poort genomen (bijvoorbeeld `error` in plaats van `success`, of `no` in plaats van `yes`)? Kijk in het rundetail om te zien welke poort hij koos.

### "Een variabele komt leeg aan."

Open het rundetail en bekijk de vastgelegde argumenten van de falende node. Als je de letterlijke tekst `{{NodeId.field}}` ziet, dan is de verwijzing niet opgelost — waarschijnlijk een typefout in `NodeId` of `field`. Als je een lege string ziet, dan draaide de bovenliggende node wel maar produceerde dat veld niet.

### "Hij werkt handmatig, maar niet vanuit de trigger."

Gebruik **Run Manually** met een JSON-payload die nabootst wat de echte trigger publiceert. Vergelijk vervolgens de vastgelegde argumenten in de handmatige run en de productie-run naast elkaar — het verschil zit meestal in één enkele veldnaam of type.

## Een workflow opnieuw uitvoeren

Er is geen "retry this run"-knop — by design voert OneUptime nooit een oude run opnieuw uit, omdat de uitgaande bijeffecten (Slack-berichten, API-aanroepen) niet noodzakelijk idempotent zijn. Als je het werk opnieuw wilt doen, repareer dan de workflow en laat de volgende echte trigger hem afvuren.

Voor handmatige workflows klik je gewoon op **Run Manually** met dezelfde payload.

## Log-retentie

Runs worden voor onbepaalde tijd op het project bewaard. Als je high-volume-ruisende workflows wilt opschonen (bijvoorbeeld een debug-workflow die elke minuut afgaat), schakel ze uit of verwijder ze — er is geen retentie-toggle per workflow.

## Waar verder lezen

- [Configuratie en veiligheid](/docs/workflows/configuration) — timeouts, recursielimieten, geheimredactie.
- [Variabelen](/docs/workflows/variables) — de syntax die geïnterpoleerde argumenten gebruiken.
- [Componenten](/docs/workflows/components) — de returnwaarde-velden die elke component publiceert.
