# Componenten

Componenten zijn de bouwblokken die je na de trigger toevoegt. Elk doet één ding — een bericht sturen, een API aanroepen, een voorwaarde controleren — en verbindt met wat erna komt.

Deze pagina is de catalogus. Hoe je ze op het canvas toevoegt en verbindt, lees je in [Een workflow maken](/docs/workflows/authoring).

## API

Doe een HTTP-verzoek naar een willekeurige URL.

**Instellingen**:

- **Method** — `GET`, `POST`, `PUT`, `PATCH` of `DELETE`.
- **URL** — het adres dat je aanroept.
- **Headers** — de headers die je meestuurt.
- **Body** — de body van het verzoek voor `POST` / `PUT` / `PATCH`.

**Outputs**:

- **Succes** — gaat af wanneer de aanroep lukte (2xx-antwoord). Geeft de status, headers en body door.
- **Fout** — gaat af bij een netwerkstoring of een antwoord dat geen 2xx is. Geeft de foutmelding door.

Gebruik dit voor: elke externe API, je eigen beheerendpoints, of elke integratie zonder eigen component.

## AI

### Generate Text with AI

Genereer één tekstantwoord uit een prompt en optionele JSON-context. Het component gebruikt de standaard-LLM-provider die voor het project is ingesteld, en valt terug op de globale provider van de installatie wanneer die er is. Providergegevens en -endpoints worden centraal geconfigureerd; het zijn geen workflowargumenten.

**Instellingen**:

- **System Instructions** — optionele sturing voor de rol, toon en beperkingen van het model.
- **Prompt** — de verplichte opdracht. Hij mag workflowvariabelen en uitvoer van eerdere componenten bevatten.
- **Context** — optionele JSON die je bewust met het verzoek meestuurt. Hij komt achter een expliciete vertrouwensmarkering aan het eind van het bericht en wordt in de rest van het bericht als niet-vertrouwde data behandeld.
- **Temperature** — variatie van `0` tot `1`. De standaard is `0.2`, voor voorspelbare automatisering.
- **Maximum Output Tokens** — van `1` tot `4096`. De standaard is `1024`.

De System Instructions, Prompt en geserialiseerde Context zijn samen beperkt tot 50.000 tekens. Het providerverzoek duurt maximaal 60 seconden en wordt één keer geprobeerd. Per project kunnen hoogstens drie AI-verzoeken uit workflows tegelijk lopen.

**Outputs**:

- **Response** — de gegenereerde tekst.
- **Provider** en **Model** — de configuratie die voor de aanroep is gebruikt.
- **Total Tokens** en **Completion Tokens** — het gebruik zoals de provider het meldt.
- **LLM Log ID** — het gemeten AI-logboekitem van de aanroep.
- **Fout** — de validatie-, toegangs-, provider-, budget-, facturerings- of time-outfout, als die er is.

Verbind **Succes** met componenten die het antwoord moeten gebruiken. Verbind **Fout** met een expliciete terugval, waarschuwing of logpad. Het component doet één modelaanroep zonder tooldefinities of providereigen capability-velden: het kan uit zichzelf OneUptime niet bevragen, geen API's aanroepen en geen projectdata wijzigen. Behalve de vaste componentveiligheidsinstructies van OneUptime gaan alleen de System Instructions, Prompt en Context die jij instelt naar de provider, nadat de workflowvariabelen in die velden zijn opgelost. De ingestelde provider en het ingestelde model blijven een vertrouwensgrens, omdat een model intrinsieke, door de provider beheerde capaciteiten kan hebben.

Modeluitvoer is niet-vertrouwde tekst. Beoordeel hem voordat je klantgerichte communicatie verstuurt, en gebruik vrije AI-tekst nooit als enige grond voor destructieve workflowacties. Zie [Workflow-configuratie en veiligheid](/docs/workflows/configuration) voor details over provider, uitgaand verkeer, logging en kosten.

## Webhook (uitgaand)

Een eenvoudiger versie van het API-component, voor gevallen van "afvuren en vergeten". Post een JSON-body naar een URL.

Gebruik **API** als je het antwoord moet lezen. Gebruik **Webhook** als je alleen een melding wilt sturen en verder wilt gaan.

## Slack

Plaats een bericht in een Slack-kanaal.

**Instellingen**:

- **Kanaal** — de naam van het kanaal. De bot moet al in dat kanaal zitten.
- **Bericht** — de tekst die je stuurt. Ondersteunt Slack-opmaak.

Verbind Slack eerst met je project onder **Projectinstellingen → Werkruimte → Slack**. Zie [Slack-werkruimteverbinding](/docs/workspace-connections/slack).

## Microsoft Teams

Plaats een bericht in een Microsoft Teams-kanaal.

**Instellingen**:

- **Team and channel** — waar je post.
- **Bericht** — de tekst die je stuurt.

Zie [Microsoft Teams-werkruimteverbinding](/docs/workspace-connections/microsoft-teams) voor het instellen.

## Discord

Plaats een bericht in een Discord-kanaal via een inkomende webhook-URL.

## Telegram

Stuur een bericht naar een Telegram-chat met een bottoken en een chat-ID.

## E-mail

Verstuur een e-mail via OneUptime.

**Instellingen**:

- **Aan** — het e-mailadres van de ontvanger.
- **Onderwerp** — de onderwerpregel.
- **Body** — het bericht in Markdown of HTML.

De e-mail vertrekt vanaf de afzender die voor je project is ingesteld — zie [SMTP](/docs/emails/smtp).

## Custom Code

Voer een klein stukje JavaScript uit wanneer je iets nodig hebt wat de andere blokken niet kunnen.

**Instellingen**:

- **Code** — jouw JavaScript. De laatste waarde (of wat je uit een async-functie teruggeeft) wordt de uitvoer van het blok.
- **Arguments** — benoemde waarden die je kunt meegeven.

**Outputs**: succes (je retourwaarde) en fout (een eventuele exceptie).

Gebruik dit voor: data omvormen tussen twee systemen, een kleine berekening doen, alles wat geen eigen blok verdient. Voor zwaarder scriptwerk gebruik je een [runbook](/docs/runbooks/index).

## JSON

Converteer tussen tekst en JSON.

- **JSON → Text** — maak van een JSON-object een string. Handig wanneer het volgende blok tekst verwacht.
- **Text → JSON** — parseer een string tot een JSON-object. Handig wanneer iets als tekst binnenkwam en je er een veld uit moet lezen.

## Voorwaarden

Vertak op basis van een vergelijking. In het paneel **Component toevoegen** heet dit blok **If / Else**, onder de categorie Voorwaarden.

**Instellingen**:

- **Left value** — meestal een waarde uit een eerder blok.
- **Operator** — `==`, `!=`, `>`, `>=`, `<`, `<=`, `contains`, `starts with`, `ends with`.
- **Right value** — waarmee je vergelijkt.

**Outputs**: **Ja** en **Nee**. Verbind de volgende blokken met de tak die je wilt.

## Delay

Pauzeer de workflow een ingestelde tijd voordat hij verdergaat. Handig wanneer je een ander systeem even wilt laten bijkomen.

## Log

Schrijf een regel naar het runlogboek. Geen extern effect — het verschijnt alleen in de logboeken van de workflow, zodat jij het kunt lezen. Prettig bij het debuggen.

## Execute Workflow

Roep vanuit deze workflow een andere workflow aan. Die aangeroepen workflow draait op eigen kracht — jouw workflow gaat verder zonder te wachten tot hij klaar is.

Gebruik dit om gemeenschappelijke logica te delen. Bouw één keer een workflow "post naar het incidentkanaal" en roep die aan vanuit elke andere workflow die het kanaal moet inlichten.

Er geldt een veiligheidslimiet, zodat workflows elkaar niet eindeloos in een lus kunnen blijven aanroepen. Zie [Workflow-configuratie en veiligheid](/docs/workflows/configuration).

## OneUptime-datacomponenten

Voor elk soort record in OneUptime (monitoren, incidenten, waarschuwingen, statuspagina's, piketbeleid en veel meer) biedt het paneel **Component toevoegen** deze componenten — zoek op de naam van het type. Elke titel wordt uit het recordtype opgebouwd, dus de set voor Monitor leest als:

- **Find One Monitor** — lees één record dat aan de query voldoet.
- **Find Many Monitors** — lees een lijst met records die aan de query voldoen.
- **Create One Monitor** — voeg één record toe vanuit een JSON-object.
- **Create Many Monitors** — voeg meerdere records toe vanuit een JSON-array.
- **Update One Monitor** — pas de schrijfpayload toe op één passend record.
- **Update Many Monitors** — pas de schrijfpayload toe op de passende records, tot aan Limit.
- **Delete One Monitor** — verwijder één passend record.
- **Delete Many Monitors** — verwijder de passende records, tot aan Limit.

Dezelfde set geeft je drie triggers — **On Create Monitor**, **On Update Monitor** en **On Delete Monitor**. Zie [Workflow-triggers](/docs/workflows/triggers).

Een type biedt alleen de componenten die zijn model toestaat. Een alleen-lezen type heeft de twee Find-componenten en verder niets, dus kun je **Delete One Monitor** niet vinden in het paneel, dan laat dat type het niet toe.

Zo kan een workflow OneUptime-data lezen en wijzigen. Bijvoorbeeld: een webhook uit je CI-tool kan met **Create One Incident** een incident openen met de details van de mislukking.

## Werken met records

Elk veld op een datacomponent werkt met de eigen **kolomnamen** van het record — dezelfde namen die de API gebruikt, niet de labels op het formulier in het dashboard. De ID-kolom is `_id`. De schrijfwijze `id` wordt overal geaccepteerd waar je een kolomnaam kunt typen, maar `_id` is wat een record teruggeeft, dus dat lees je aan de uitgaande kant:

```json
{ "_id": "00000000-0000-0000-0000-000000000000" }
```

**Query** bepaalt op welke records het component werkt. Sleutels zijn kolommen, waarden zijn waar je op matcht:

```json
{ "monitorType": "Website", "isEnabled": true }
```

Een query is altijd afgebakend tot het project waarin de workflow draait. Je komt niet bij records van een ander project, en je hoeft het project zelf niet aan de query toe te voegen.

**JSON Object** op Create One, **JSON Array** op Create Many en **Data (JSON Object)** op de Update-componenten bevatten de velden die je wegschrijft, op dezelfde manier gesleuteld:

```json
{ "name": "Checkout API", "monitorType": "Website" }
```

Een sleutel die geen kolom is, wordt genegeerd in plaats van geweigerd — het runlogboek noemt de sleutels die het liet vallen, dus kijk daar wanneer een veld niet aankomt. **Select Fields**, op de Find-componenten en de triggers, gebruikt dezelfde kolomsleutels met de waarde `true`: `{"_id": true, "name": true}`.

**Overslaan** en **Limit** zijn twee getalvelden op Find Many, Update Many en Delete Many — `Skip: 0` met `Limit: 100` pakt de eerste honderd treffers. Limit staat standaard op `10`, en op Update Many en Delete Many begrenst het hoeveel records er daadwerkelijk worden weggeschreven, niet alleen hoeveel er terugkomen. Dus `Items Deleted: 10` betekent dat er tien records zijn verwijderd, niet dat er tien matchten. Verhoog Limit wanneer je meer dan tien wilt wijzigen.

**Succes** en **Fout** melden of de query gedraaid heeft, niet wat hij vond. Een query die niets vindt, geeft `0` terug en vertrekt alsnog via Succes — dat is geen mislukking. Wil je vertakken op basis van of er iets is gevonden, lees dan de teruggegeven telling uit in een blok **If / Else**.

## Welk component moet ik gebruiken?

Een paar snelle vuistregels:

- Is er een eigen blok voor wat je wilt (Slack, E-mail, een OneUptime-record), gebruik dat dan — je krijgt nettere foutafhandeling en duidelijkere logboeken.
- Voor elke andere externe API gebruik je **API**.
- Wil je expliciet gekozen workflowdata samenvatten, classificeren of tot tekst opstellen, gebruik dan **Generate Text with AI**.
- Wil je data omvormen tussen blokken, gebruik dan **Custom Code** of **JSON**.
- Wil je verschillende acties op basis van een waarde, gebruik dan **Voorwaarden**.

## Waar je verder kunt lezen

- [Workflow-variabelen](/docs/workflows/variables) — data doorgeven tussen blokken.
- [Workflow-uitvoeringen en logboeken](/docs/workflows/runs-and-logs) — nagaan wat elk blok tijdens een run deed.
- [Workflow-configuratie en veiligheid](/docs/workflows/configuration) — limieten, eigenaren en geheimen.
