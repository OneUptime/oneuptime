# Componenten

Componenten zijn de bouwstenen die je na de trigger toevoegt. Elke component doet één ding — een bericht versturen, een API aanroepen, een voorwaarde controleren — en koppelt aan wat erna komt.

Deze pagina is de catalogus. Voor hoe je ze op het canvas toevoegt en verbindt, zie [Authoring a Workflow](/docs/workflows/authoring).

## API

Doe een HTTP-verzoek naar elke URL.

**Settings**:

- **Method** — `GET`, `POST`, `PUT`, `PATCH`, of `DELETE`.
- **URL** — het adres dat je wilt aanroepen.
- **Headers** — eventuele headers om mee te sturen.
- **Body** — de request body voor `POST` / `PUT` / `PATCH`.

**Outputs**:

- **Success** — gaat af wanneer de aanroep werkte (2xx-respons). Geeft de status, headers en body door.
- **Error** — gaat af bij een netwerkfout of een respons die geen 2xx is. Geeft het foutbericht door.

Gebruik dit voor: elke externe API, je eigen admin-endpoints, of elke integratie die geen eigen component heeft.

## AI

### Generate Text with AI

Genereer één tekstrespons vanuit een prompt en optionele JSON-context. De component gebruikt de geconfigureerde standaard-LLM-provider van het project, en valt terug op de globale provider van de installatie wanneer die beschikbaar is. Providercredentials en endpoints worden centraal geconfigureerd; het zijn geen workflowargumenten.

**Settings**:

- **System Instructions** — optionele richtlijnen voor de rol, toon en beperkingen van het model.
- **Prompt** — de verplichte taak. Kan workflowvariabelen en outputs van eerdere componenten bevatten.
- **Context** — optionele JSON die je bewust met het verzoek meestuurt. Deze wordt toegevoegd na een expliciete end-of-message-vertrouwensmarkering en door de rest van het bericht heen als niet-vertrouwde data behandeld.
- **Temperature** — variatie van `0` tot `1`. De standaard is `0.2` voor voorspelbare automatisering.
- **Maximum Output Tokens** — van `1` tot `4096`. De standaard is `1024`.

De gecombineerde System Instructions, Prompt en geserialiseerde Context zijn beperkt tot 50.000 tekens. Het providerverzoek heeft een maximale duur van 60 seconden en wordt één keer geprobeerd. Er kunnen per project maximaal drie workflow-AI-verzoeken gelijktijdig draaien.

**Outputs**:

- **Response** — de gegenereerde tekst.
- **Provider** en **Model** — de configuratie die voor de aanroep is gebruikt.
- **Total Tokens** en **Completion Tokens** — gebruik gerapporteerd door de provider.
- **LLM Log ID** — de gemeten AI-logvermelding voor de aanroep.
- **Error** — de validatie-, toegangs-, provider-, budget-, facturerings- of timeoutfout, indien aanwezig.

Verbind **Success** met componenten die de respons moeten gebruiken. Verbind **Error** met een expliciet fallback-, alert- of logpad. De component doet één modelverzoek zonder tooldefinities of providernatieve capability-velden: hij kan niet zelfstandig OneUptime bevragen, API's aanroepen of projectdata wijzigen. Naast de vaste component-safety-instructies van OneUptime worden alleen de System Instructions, Prompt en Context die je configureert naar de provider gestuurd, nadat workflowvariabelen in die velden zijn opgelost. De geconfigureerde provider/model blijft een vertrouwensgrens omdat een model intrinsieke, providerbeheerde capabilities kan hebben.

Model-output is niet-vertrouwde tekst. Beoordeel hem voordat je klantgerichte communicatie verstuurt, en gebruik vrije AI-tekst nooit alleen om destructieve workflowacties te autoriseren. Zie [Configuration & Safety](/docs/workflows/configuration) voor details over provider, uitgaand verkeer, logging en kosten.

## Webhook (outbound)

Een eenvoudigere versie van de API-component voor "fire and forget"-gevallen. Post een JSON-body naar een URL.

Gebruik **API** als je de respons moet lezen. Gebruik **Webhook** als je alleen een notificatie wilt versturen en verder wilt gaan.

## Slack

Post een bericht in een Slack-kanaal.

**Settings**:

- **Channel** — de kanaalnaam. De bot moet al lid zijn van dat kanaal.
- **Message** — de te versturen tekst. Ondersteunt Slack-opmaak.

Koppel Slack eerst aan je project onder **Project Settings → Workspace → Slack**. Zie [Slack Workspace Connection](/docs/workspace-connections/slack).

## Microsoft Teams

Post een bericht in een Microsoft Teams-kanaal.

**Settings**:

- **Team and channel** — waar je wilt posten.
- **Message** — de te versturen tekst.

Zie [Microsoft Teams Workspace Connection](/docs/workspace-connections/microsoft-teams) voor het opzetten.

## Discord

Post een bericht in een Discord-kanaal via een inkomende webhook-URL.

## Telegram

Verstuur een bericht naar een Telegram-chat met een bottoken en chat-ID.

## Email

Verstuur een e-mail via OneUptime.

**Settings**:

- **To** — het e-mailadres van de ontvanger.
- **Subject** — de onderwerpregel.
- **Body** — het bericht in Markdown of HTML.

De e-mail wordt verstuurd vanaf de geconfigureerde afzender van je project — zie [SMTP](/docs/emails/smtp).

## Custom Code

Voer een klein stukje JavaScript uit wanneer je iets nodig hebt wat de andere blokken niet kunnen.

**Settings**:

- **Code** — je JavaScript. De laatste waarde (of wat je vanuit een async functie retourneert) wordt de output van het blok.
- **Arguments** — benoemde waarden die je kunt meegeven.

**Outputs**: success (jouw returnwaarde) en error (een exception).

Gebruik dit voor: data hervormen tussen twee systemen, een kleine berekening, alles wat geen eigen blok verdient. Gebruik voor zwaardere scripting een [Runbook](/docs/runbooks/index).

## JSON

Converteer tussen tekst en JSON.

- **JSON → Text** — zet een JSON-object om in een string. Handig wanneer het volgende blok tekst verwacht.
- **Text → JSON** — parseer een string naar een JSON-object. Handig wanneer iets als tekst is binnengekomen en je een veld moet lezen.

## Conditions

Vertak op basis van een vergelijking. In het **Add Component**-paneel heet dit blok **If / Else**, onder de categorie Conditions.

**Settings**:

- **Left value** — meestal een waarde uit een eerder blok.
- **Operator** — `==`, `!=`, `>`, `>=`, `<`, `<=`, `contains`, `starts with`, `ends with`.
- **Right value** — waarmee je vergelijkt.

**Outputs**: **Yes** en **No**. Verbind de volgende blokken met de tak die je wilt.

## Delay

Pauzeer de workflow voor een bepaalde tijd voordat je verdergaat. Handig wanneer je een ander systeem even moet laten bijkomen.

## Log

Schrijf een regel naar het run-log. Geen extern effect — het verschijnt alleen in de logs van de workflow zodat jij het kunt lezen. Handig om te debuggen.

## Execute Workflow

Roep een andere workflow aan vanuit deze. De aangeroepen workflow draait op zichzelf — jouw workflow gaat verder zonder te wachten tot hij klaar is.

Gebruik dit om gemeenschappelijke logica te delen. Bouw één keer een "post to incident channel"-workflow en roep die aan vanuit elke andere workflow die het kanaal moet informeren.

Er is een veiligheidslimiet zodat workflows elkaar niet in een lus kunnen blijven aanroepen. Zie [Configuration & Safety](/docs/workflows/configuration).

## OneUptime-datacomponenten

Voor elk soort record in OneUptime (monitors, incidents, alerts, statuspagina's, on-call policies en nog veel meer) heeft het **Add Component**-paneel deze componenten — zoek op de naam van het type. Elke titel wordt gegenereerd op basis van het recordtype, dus de Monitor-set luidt:

- **Find One Monitor** — lees één record dat aan de query voldoet.
- **Find Many Monitors** — lees een lijst met records die aan de query voldoen.
- **Create One Monitor** — voeg één record toe vanuit een JSON-object.
- **Create Many Monitors** — voeg meerdere records toe vanuit een JSON-array.
- **Update One Monitor** — pas de writepayload toe op één matchend record.
- **Update Many Monitors** — pas de writepayload toe op matchende records, tot aan Limit.
- **Delete One Monitor** — verwijder één matchend record.
- **Delete Many Monitors** — verwijder matchende records, tot aan Limit.

Dezelfde set geeft je drie triggers — **On Create Monitor**, **On Update Monitor**, en **On Delete Monitor**. Zie [Triggers](/docs/workflows/triggers).

Een type biedt alleen de componenten die zijn model toestaat. Een read-only type heeft alleen de twee Find-componenten en verder niets, dus als je **Delete One Monitor** niet in het paneel kunt vinden, staat dat type dat niet toe.

Zo kan een workflow OneUptime-data lezen en wijzigen. Bijvoorbeeld: een webhook van je CI-tool kan **Create One Incident** gebruiken om een incident te openen met de faaldetails.

## Werken met records

Elk veld op een datacomponent is gekoppeld aan de eigen **column**-namen van het record — dezelfde namen die de API gebruikt, niet de labels op het dashboardformulier. De ID-kolom is `_id`. De spelling `id` wordt geaccepteerd als alias overal waar je een kolomnaam kunt typen, maar `_id` is wat een record teruggeeft, dus dat is wat je aan de uitgaande kant moet lezen:

```json
{ "_id": "00000000-0000-0000-0000-000000000000" }
```

**Query** bepaalt op welke records de component werkt. Sleutels zijn kolommen, waarden zijn wat er moet matchen:

```json
{ "monitorType": "Website", "isEnabled": true }
```

Een query is altijd beperkt tot het project waarin de workflow draait. Je kunt niet bij de records van een ander project, en je hoeft het project zelf niet aan de query toe te voegen.

**JSON Object** op Create One, **JSON Array** op Create Many, en **Data (JSON Object)** op de Update-componenten bevatten de te schrijven velden, op dezelfde manier gekoppeld:

```json
{ "name": "Checkout API", "monitorType": "Website" }
```

Een sleutel die geen kolom is, wordt genegeerd in plaats van geweigerd — het run-log noemt de sleutels die zijn weggevallen, dus kijk daar wanneer een veld niet aankomt. **Select Fields**, op de Find-componenten en de triggers, gebruikt dezelfde kolomsleutels met `true`-waarden: `{"_id": true, "name": true}`.

**Skip** en **Limit** zijn twee getalvelden op Find Many, Update Many en Delete Many — `Skip: 0` met `Limit: 100` neemt de eerste honderd matches. Limit staat standaard op `10`, en op Update Many en Delete Many begrenst het hoeveel records daadwerkelijk worden geschreven, niet alleen hoeveel er worden teruggegeven. Dus `Items Deleted: 10` betekent dat er tien records zijn verwijderd, niet dat er tien matchten. Verhoog Limit wanneer je meer dan tien wilt wijzigen.

**Success** en **Error** rapporteren of de query is uitgevoerd, niet wat hij vond. Een query die niets matcht, geeft `0` terug en gaat nog steeds via Success — dat is geen mislukking. Om te vertakken op basis van of er iets matchte, lees je het geretourneerde aantal in een **If / Else**-blok.

## Welke component moet ik gebruiken?

Een paar vuistregels:

- Als er een speciaal blok is voor wat je wilt (Slack, Email, een OneUptime-record), gebruik dat — je krijgt netter foutafhandeling en duidelijkere logs.
- Voor elke andere externe API gebruik je **API**.
- Om tekst samen te vatten, te classificeren of op te stellen vanuit expliciet geselecteerde workflowdata, gebruik je **Generate Text with AI**.
- Om data tussen blokken te hervormen, gebruik je **Custom Code** of **JSON**.
- Om verschillende acties te nemen op basis van een waarde, gebruik je **Conditions**.

## Waar verder lezen

- [Variabelen](/docs/workflows/variables) — data tussen blokken doorgeven.
- [Uitvoeringen en logboeken](/docs/workflows/runs-and-logs) — controleren wat elk blok bij een run heeft gedaan.
- [Configuratie en veiligheid](/docs/workflows/configuration) — limieten, eigenaren en geheimen.
