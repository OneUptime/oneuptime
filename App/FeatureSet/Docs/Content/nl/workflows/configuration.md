# Workflow-configuratie en veiligheid

Deze pagina verzamelt de instellingen en veiligheidslimieten die je moet kennen voordat je een workflow op productieverkeer richt.

## In- / uitschakelen

Elke workflow heeft een **isEnabled**-vlag in **Settings**. Uitgeschakelde workflows vuren nooit af — model-events, webhooks en geplande runs worden genegeerd. Nieuwe workflows worden uitgeschakeld geleverd.

Behandel dit als je "klaar voor productie"-schakelaar:

1. Bouw de workflow.
2. Klik op **Run Manually** met een representatieve payload.
3. Controleer **Logs** — bevestig dat elke node de verwachte poort nam.
4. Zet **isEnabled** aan.

Een workflow uitschakelen heeft geen invloed op runs die al lopen; het voorkomt alleen dat er nieuwe worden gestart.

## Eigenaarschap en labels

- **Eigenaren** — gebruikers en teams die als eigenaar zijn vermeld krijgen permissiegebaseerde toegang en (optioneel) meldingen wanneer de workflow faalt. Configureer onder **Settings → Owners**.
- **Labels** — many-to-many-tags voor het organiseren van workflows. Filter de workflow-lijst op label. Handig wanneer een project tientallen workflows heeft, georganiseerd per team, integratie of omgeving.
- **Label rules** — onder **Workflows → Settings → Label Rules** kun je labels automatisch toepassen op nieuwe workflows op basis van regex-matches op naam of beschrijving.
- **Owner rules** — onder **Workflows → Settings → Owner Rules** kun je eigenaren automatisch toewijzen aan nieuwe workflows.

## Geheimen

Globale variabelen kunnen worden gemarkeerd als **secret**. De waarde wordt versleuteld opgeslagen, is write-only in de UI na opslaan en wordt geredigeerd uit runlogs (vervangen door `[REDACTED]`).

Gebruik geheime variabelen voor:

- API-sleutels voor uitgaande integraties.
- Bearer-tokens.
- Webhook-signing-sleutels.
- Elke waarde die een aanvaller met leestoegang tot een workflow niet zou mogen zien.

Plak geen geheim direct in een argument van een component — verwijzingen zoals `Authorization: Bearer eyJh...` verschijnen in de workflow-JSON en de runlogs in plain text. Verwijs in plaats daarvan naar `{{variable.MY_SECRET}}`.

## Run-timeout

Elke run heeft een maximale duur. Als een run niet binnen de timeout is afgerond, wordt hij gemarkeerd als `Timeout` en wordt een eventueel lopende component geannuleerd. De standaard is ruim (minuten, geen seconden) — bekijk de environment-configuratie van de worker voor de exacte waarde in jouw installatie.

De meeste componenten hebben hun eigen per-aanroep-timeouts binnen de run-timeout — bijvoorbeeld: de API-component geeft het op bij een hangend uitgaand verzoek lang vóórdat de hele run dat doet.

## Recursielimiet

Met de **Execute Workflow**-component kan de ene workflow de andere aanroepen. Om op hol geslagen lussen te voorkomen waarbij A B aanroept en B weer A, ad infinitum, houdt de worker de aanroepketen bij en stopt hij een keten die een vaste diepte overschrijdt (typisch een klein getal zoals 5). De afgebroken run wordt gemarkeerd als `Error` met een duidelijke melding over de recursielimiet.

Als je een legitieme behoefte hebt aan een lange keten (bijvoorbeeld een recursieve folder-walk die per run één niveau verwerkt), refactor het dan tot één enkele workflow die intern itereert via **Custom Code** — dat patroon valt niet onder de keten-limiet.

## Webhook-beveiliging

Webhook-triggers stellen een unieke HTTPS-URL beschikbaar. Iedereen die de URL leert kennen kan hem aanroepen. Om jezelf te beschermen tegen onbedoelde of kwaadwillende callers:

- Behandel de URL als een gedeeld geheim. Plak hem niet in een openbare chat en commit hem niet naar een openbare repo.
- Voor workflows met hoge waarde: vraag het aanroepende systeem om een gedeeld geheim mee te sturen als header (bijvoorbeeld `X-Webhook-Token`) en valideer dat in een **Conditions**-node voordat je iets destructiefs doet. Definieer het verwachte token als een geheime globale variabele.
- Voor workflows met zeer hoge waarde: geef de voorkeur aan een model-event-trigger en een handmatige importstap in plaats van een openbare webhook.

## Uitgaand netwerkverkeer

De API- en andere HTTP-achtige componenten versturen verzoeken vanaf het netwerk van de OneUptime Workflow Worker. Als je OneUptime zelf host, is het uitgaande netwerk van de worker jouw zorg — zorg ervoor dat het de externe API's die je aanroept kan bereiken. Als je OneUptime Cloud gebruikt, is ons IP-uitgangsbereik gepubliceerd in [IP Addresses](/docs/configuration/ip-addresses), zodat je aan de ontvangende kant kunt allowlisten.

## Machtigingen

Workflows zijn first-class resources die onder de projectbrede rolgebaseerde toegangscontrole vallen:

- `CreateWorkflow`, `ReadWorkflow`, `EditWorkflow`, `DeleteWorkflow` — de vier CRUD-machtigingen op workflow-templates.
- `RunWorkflow` — nodig om op **Run Manually** te klikken of om een workflow via de API te dispatchen.
- `ReadWorkflowLog` — nodig om de **Runs & Logs**-pagina te bekijken.
- `ReadWorkflowVariable`, `CreateWorkflowVariable`, `EditWorkflowVariable`, `DeleteWorkflowVariable` — controle over de lijst met globale variabelen.

De meeste engineers zouden create/edit/read op workflows moeten hebben, maar niet op variabelen. Reserveer variabele-bewerkingsrechten voor de mensen die de geheimen van je project beheren.

## Quota

OneUptime Cloud beperkt op kleinere abonnementen het aantal runs per maand per project. De limiet wordt getoond op **Project Settings → Billing**. Wanneer je hem bereikt, worden nieuwe triggers afgewezen (en met een reden "quota exceeded" vastgelegd op de betreffende workflow) tot de volgende factureringscyclus. Self-hosted-installaties vallen niet onder een quotum.

## Waar workflows *niet* goed in zijn

Een paar patronen waarvoor je beter naar een ander tool grijpt:

- **Langlopende berekeningen** — workflows zijn gericht op lijmwerk tussen systemen, niet op het verwerken van grote datasets. Draai zwaar werk in je eigen infrastructuur en gebruik een workflow om het op gang te brengen.
- **Stateful workflows die minuten/uren beslaan** — één run is bedoeld om snel af te ronden. Als je "doe A, wacht twee uur, doe B" nodig hebt, modelleer dan de wachttijd als een externe scheduler die terugpost naar een webhook-trigger.
- **Stap-voor-stap incidentrespons met menselijke ijkpunten** — daar zijn [Runbooks](/docs/runbooks/index) voor. Gebruik een workflow als er geen mens in de lus zit; gebruik een runbook als die er wel is.

## Waar verder lezen

- [Workflows – Overzicht](/docs/workflows/index) — de conceptuele kaart.
- [Componenten](/docs/workflows/components) — argumentdetails voor elke actie.
- [Runbooks](/docs/runbooks/index) — wanneer je in plaats daarvan een runbook gebruikt.
