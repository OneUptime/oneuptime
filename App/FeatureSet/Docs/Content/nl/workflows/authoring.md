# Een workflow maken

Maak een workflow aan onder **Workflows → Create Workflow**, geef hem een naam en een optionele beschrijving en open vervolgens het **Builder**-tabblad om nodes op het canvas te plaatsen.

## Het canvas

De Builder is een zoom- en sleepbare graph. Je voegt nodes toe vanuit een componentenpalet, verbindt ze met edges en configureert de argumenten van elke node in een zijpaneel. Een opslag-indicator in de header laat zien of je laatste bewerking is opgeslagen.

Een workflow begint altijd met precies één **trigger**-node. Triggers hebben geen input-poort — daar begint de uitvoering. Alles stroomafwaarts is een **component**.

## Anatomie van een node

Elke node heeft:

| Veld | Doel |
| --- | --- |
| **Titel** | Het label dat op het canvas verschijnt. Standaard de componentnaam; overschrijf hem om complexe workflows beter leesbaar te maken. |
| **Argumenten** | De configuratie die de component nodig heeft om zijn werk te doen — een URL, een Slack-kanaal, een JavaScript-snippet, enz. Verplichte argumenten zijn gemarkeerd met een asterisk. |
| **Input-poorten** | Aansluitingen aan de linkerkant van de node waar inkomende edges landen. Componenten hebben één input-poort genaamd `in`; triggers hebben er geen. |
| **Output-poorten** | Aansluitingen aan de rechterkant waar uitgaande edges beginnen. Componenten definiëren poorten zoals `success`, `error`, `yes`, `no`. |
| **Returnwaarden** | Data die de node produceert — de payloads van zijn output-poorten. Stroomafwaartse nodes verwijzen ernaar als `{{NodeId.fieldName}}`. |

## Nodes verbinden

Sleep van een output-poort naar de input-poort van een stroomafwaartse node om een edge aan te maken. Een edge vanuit `success` draait die tak alleen wanneer de bovenliggende node geslaagd is; een edge vanuit `error` draait alleen wanneer hij faalde. Als je een poort niet verbindt, eindigt die tak gewoon.

Je kunt fan-out toepassen: één output-poort kan meerdere stroomafwaartse nodes voeden, en die draaien vanaf dat punt allemaal parallel.

## Argumenten configureren

Klik op een node om zijn zijpaneel te openen. Elk argument heeft een getypte editor:

- **Text / URL / Email / Number / Password** — een invoerveld op één regel.
- **JSON** — een JSON-editor met syntax-highlighting en een validatie-indicator.
- **JavaScript** — een code-editor voor snippets die door de **Custom Code**-component worden gebruikt.
- **Markdown / HTML** — rich-text-bodies voor e-mail- en berichtcomponenten.
- **CronTab** — een schedule-expressie (gebruikt door de Schedule-trigger).
- **Boolean** — een toggle.
- **Select / Query** — drop-downs voor velden met een vaste set waarden of een model-achtige query.

Elk tekstveld accepteert variabele-interpolatie — zie [Variabelen](/docs/workflows/variables) voor de regels.

## Een minimale eerste workflow

De snelste manier om een gevoel te krijgen voor het canvas:

1. Plaats een **Manual**-trigger.
2. Plaats een **Log**-component (onder **Utils**). Verbind de output-poort van de trigger met de input-poort van de Log-component.
3. Typ in het argument van de Log-component `Hello from {{Manual.JSON.name}}`.
4. Sla op en schakel de workflow in.
5. Klik op **Run Manually**, plak `{ "name": "Ada" }` als input en verstuur.
6. Open het **Logs**-tabblad. De nieuwste run laat de vastgelegde output van de Log-node zien: `Hello from Ada`.

Die heen-en-weer — slepen, koppelen, configureren, draaien, inspecteren — is het ritme van het schrijven van elke workflow.

## Opslaan, inschakelen en testen in productie

Workflows worden opgeslagen als een JSON-graph in de `Workflow.graph`-kolom. De Builder slaat op terwijl je werkt; de opslag-indicator in de header laat zien wanneer de laatste wijziging de server heeft bereikt. Er is geen aparte "publish"-stap.

Maar: een workflow vuurt zijn trigger alleen af wanneer **isEnabled** aanstaat. Nieuwe workflows worden uitgeschakeld geleverd. Behandel die vlag als je "klaar voor productie"-schakelaar — bouw, klik op **Run Manually** om een proefdraai te doen met een voorbeeldpayload, bekijk de **Logs** en zet pas dan Enable aan.

Als je een workflow wilt pauzeren zonder hem te verwijderen (bijvoorbeeld tijdens een niet-gerelateerd incident), zet je **isEnabled** uit in **Settings**. Bestaande lopende runs gaan door; er starten geen nieuwe.

## Herordenen en herorganiseren

- Sleep een node om hem opnieuw te positioneren. De positie wordt in de graph opgeslagen, zodat de volgende persoon die het canvas opent dezelfde layout ziet.
- Rechtsklik op een edge om hem te verwijderen; rechtsklik op een node voor verwijder- en dupliceer-opties.
- Voor brede workflows: leg ze van links naar rechts uit, zodat de uitvoeringsrichting overeenkomt met je leesrichting.

## Waar verder lezen

- [Triggers](/docs/workflows/triggers) — de vier trigger-families en wat elke als returnwaarden blootstelt.
- [Componenten](/docs/workflows/components) — de volledige catalogus en hun argumenten.
- [Variabelen](/docs/workflows/variables) — hoe je tussen nodes en vanuit globale variabelen naar data verwijst.
- [Uitvoeringen en logboeken](/docs/workflows/runs-and-logs) — hoe je een zich misdragende workflow debugt.
