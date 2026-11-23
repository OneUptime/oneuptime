# OneUptime AI in Gegevensbeveiliging

OneUptime AI werkt met wat Gegevensbeveiliging heeft gevonden, zonder je gegevens te zien. Het krijgt namen, vormen, aantallen en configuratie, nooit een waarde van je gegevens, een gemaskeerd voorbeeld, een record of een verbindingsreeks. Elke functie draait op het eigen model van je project, ook een zelf gehost model, en elke pagina, controle, scan en integratie van Gegevensbeveiliging werkt met AI uitgeschakeld.

:::cards
- [Uit zichzelf](#uit-zichzelf): Wat het met elk nieuw probleem doet, wat op je wacht, en de AI-regels.
- [Wat OneUptime AI ziet](#wat-oneuptime-ai-ziet): Wat elke functie verstuurt, en wat die nooit verstuurt.
- [Zie het zelf](#zie-het-zelf): De exacte invoer die een van je problemen zou versturen.
- [Je eigen model](#je-eigen-model): Elke functie op de provider van je project, Ollama, vLLM of een OpenAI-compatibel endpoint.
- [Hoe het wordt gemeten](#hoe-het-wordt-gemeten): Elke functie op vaste gevallen, voor elke release.
:::

## Uit zichzelf

Met **Aan nieuwe problemen werken** ingeschakeld onder **Gegevensbeveiliging → AI**, zoals bij nieuwe projecten, werkt OneUptime AI uit zichzelf aan elk nieuw kritiek of hoog probleem. Het schrijft de analyse van elk zo'n probleem, en van elk probleem dat opnieuw opengaat, zoals **Probleem analyseren** dat doet en op basis van wat dat verstuurt, voordat iemand het opent, en schrijft haar alleen opnieuw als veranderd is waarop ze berust. Voor een telemetrieprobleem verbergt het zelf een geheim in nieuwe telemetrie, waar de regel is bewezen op de records waarin het geheim werd gezien en niets leest wat hij verbergt, en stelt het de opschoonregels voor de rest voor (zie [Zelf ingedamd](/docs/data-security/telemetry#zelf-ingedamd)). Een voorstel wacht op die pagina onder **Wacht op u**, de riskantste eerst, met wat er verandert, waarom, hoe het wordt bewezen en hoe je het ongedaan maakt. **Goedkeuren** voert de wijziging uit met je eigen machtigingen: een opschoonregel vereist de machtiging om opschoonregels voor logs, opschoonregels voor traces of pipelineregels voor metrieken te maken. **Voorstel negeren** zegt nee, met een reden die op de tijdlijn van het probleem komt. De eigen controle van het probleem beslist of een wijziging heeft gewerkt: de opslag wordt opnieuw gecontroleerd, en het probleem wordt opgelost zodra er geen gegevens ervan over zijn.

OneUptime AI stelt ook eigenaren voor voor opslagen die er geen hebben, op basis van wat er al naar ze wijst: de cloudtags van de opslag, de services die de opslag gebruiken en hun eigenaren, de code-eigenaren van het bestand dat de opslag declareert, wie de opslag volgens het wijzigingslogboek van de cloud heeft gewijzigd en wie de opslag aan OneUptime heeft toegevoegd. Het noemt alleen teams en personen van je eigen project, zegt hoe zeker het is en zegt waar het bewijs elkaar tegenspreekt. Het voorstel voor een gevoelige opslag komt met het probleem **Niemand is eigenaar van deze gevoelige opslag**, en andere nieuwe opslagen krijgen het hunne eens per dag en wanneer een cloudkoppeling voor het eerst wordt gelezen. Rusten de eigenaren van drie of meer opslagen op dezelfde tag of hetzelfde begin van hun naam, dan stelt het ook de eigenaarsregel voor die de volgende zulke opslag van een eigenaar voorziet, en zegt het met hoeveel opslagen de regel overeen zou komen. Deze voorstellen wachten onder **Eigenaren om te beoordelen**, op deze pagina en op **Gegevensopslagen**: **Goedkeuren** voegt de eigenaren toe met je eigen machtigingen, en ze krijgen bericht zoals elke eigenaar; **Wijzigen en goedkeuren** kiest eerst andere eigenaren; **Ongedaan maken** neemt precies de toegevoegde eigenaren terug, en de regel met hen. Een eigenaar toevoegen verandert wie er bericht krijgt, dus dat wacht altijd op jou, wat een AI-regel ook zegt.

Standaard vraagt OneUptime AI vóór elke wijziging, behalve een die alleen gegevens verbergt, ongedaan kan worden gemaakt en bewezen veilig is, en het verwijdert nooit gegevens en roept nooit iemand op zonder te vragen. Een wijziging die het zonder te vragen heeft gedaan, staat onder **Gedaan door AI**, met **Ongedaan maken**. **Waarom AI niet heeft gehandeld** toont de problemen die het heeft bekeken en met rust heeft gelaten, en waarom. Elk voorstel, elke goedkeuring, elke keer negeren en elke keer ongedaan maken staat op de **Tijdlijn** van het probleem en van de opslag. Met de schakelaar uit werkt gegevensbeveiliging zoals altijd, en werken **Probleem analyseren** en **Oplossen met AI** nog steeds als u erop drukt; met AI uit voor het project werkt geen van beide.

Op de pagina van een probleem toont de kaart **OneUptime AI** boven **Zo lost u het op** de analyse en wat er voor dat probleem is voorgesteld, met dezelfde knoppen. Het **Overzicht** van gegevensbeveiliging zegt hoeveel lekken OneUptime AI deze week heeft ingedamd en hoeveel voorstellen op je wachten. **Notities voor OneUptime AI** telt week voor week wat de wijzigingen opleverden: zie [Hoe goed OneUptime AI het doet](/docs/ai/ai-sre#hoe-goed-oneuptime-ai-het-doet).

### AI-regels

Onder **AI-regels** op **Gegevensbeveiliging → AI** zegt een regel aan welke problemen OneUptime AI werkt - op hun controle of controlegroep, ernst, en de gevoeligheid, soort, provider, omgeving, labels, gegevenscategorieën en service van de opslag - en, voor elk soort werk, **Analyseren**, **Indammen**, **Herstel** en **Beoordelen**, of het **Uit** staat, op **Voorstellen** (het stelt voor en wacht op jou) of op **Automatisch**. Als meerdere regels bij een probleem passen, draait een soort werk als een van hen het aanzet, en **Voorstellen** gaat voor **Automatisch**. Elk voorstel zegt welke regel erover besliste. **Indammen** op **Automatisch** laat ook een bewezen opschoonregel voor persoonsgegevens zelf draaien, niet alleen die van een geheim; een regel waarvan niet bewezen is dat hij veilig is, wacht altijd op jou, wat een regel ook zegt. Zonder regel gelden de standaarden van het project: kritieke en hoge problemen analyseren, en al het andere voorstellen.

AI-regels horen bij het hele project, net als die voor incidenten en waarschuwingen: Projecteigenaren en Projectbeheerders wijzigen ze, net als iedereen die de rechten voor AI-regels heeft gekregen. De beveiligingsrollen zien wat OneUptime AI heeft voorgesteld en gedaan, maar niet de regels.

## Wat OneUptime AI ziet

Geen enkele functie stuurt een model ooit:

- een waarde van je gegevens;
- een gemaskeerd voorbeeld, zoals `j***@e******.com`: een gemaskeerd e-mailadres draagt nog een domein, en een gemaskeerde kaart de laatste vier cijfers;
- een record van je telemetrie: een logregel, een span of een sessie;
- een verbindingsreeks, een sleutel of een ander geheim.

Gegevensbeveiliging leest je gegevens zelf, in de eigen scans, en bewaart er niets van. Wat het OneUptime AI stuurt, wordt op één plek opgebouwd, uit een lijst van wat verstuurd mag worden, en een test faalt zodra een functie een model iets anders stuurt.

| Functie | Wat die verstuurt | Draait vanzelf |
| --- | --- | --- |
| **Analyse op verzoek** | De titel, ernst en het bewijs van het probleem, waarom de controle ertoe doet en de stappen die het oplossen; de naam, het soort, de regio, de tags en de configuratie van de opslag, de gevoeligheid, de namen van de gegevenstypen en ongeveer hoeveel records ze bevat; wie de opslag kan bereiken: de identiteit, het niveau en de manier van toekennen van elke toekenning, en ongeveer wanneer die het laatst is gebruikt, en de diensten die haar gebruiken; kopieën van de gegevens in andere opslag, de beveiligingszaken, de reactieactie die het probleem oplost, en de repository en de bestanden die haar declareren; hoeveel eigenaren de opslag heeft, nooit wie dat zijn; bij een telemetrieprobleem waar elk soort gegevens is gevonden: het attribuut, de logtekst of de prompt waarin het staat | Nee: een persoon vraagt het, op de pagina van een probleem, of met Uitleggen met AI via de API of de MCP-server |
| **Analyse van nieuwe problemen** | De titel, ernst en het bewijs van het probleem, waarom de controle ertoe doet en de stappen die het oplossen; de naam, het soort, de regio, de tags en de configuratie van de opslag, de gevoeligheid, de namen van de gegevenstypen en ongeveer hoeveel records ze bevat; wie de opslag kan bereiken: de identiteit, het niveau en de manier van toekennen van elke toekenning, en ongeveer wanneer die het laatst is gebruikt, en de diensten die haar gebruiken; kopieën van de gegevens in andere opslag, de beveiligingszaken, de reactieactie die het probleem oplost, en de repository en de bestanden die haar declareren; hoeveel eigenaren de opslag heeft, nooit wie dat zijn; bij een telemetrieprobleem waar elk soort gegevens is gevonden: het attribuut, de logtekst of de prompt waarin het staat | Ja: een nieuw of heropend probleem met ernst Kritiek of Hoog start haar, zolang **Aan nieuwe problemen werken** aan staat |
| **Oplossen met AI** | Het probleem zoals de controle het zag, de naam, het soort, de regio en de cloud-ID van de opslag, en bij een telemetrieprobleem waar de gegevens zijn gevonden, als verzoek aan de codeeragent, die dan de eigen code van de repository leest om de wijziging te maken | Nee: een persoon vraagt het, in een repository die die persoon in **Code** mag wijzigen |
| **Suggesties voor velden die geen detector heeft geplaatst** | Het soort opslag en de gegevenstypen die de AI mag noemen; de naam van elk veld, de namen van de velden ernaast en de vormen van de waarden, elke letter als `a` of `A` en elk cijfer als `9`; hoeveel waarden zijn gelezen en hoe lang ze zijn | Ja: de inhoudsscan van een opslag start ze |
| **AI vragen** | De opslagen, problemen en toegang die de persoon in Gegevensbeveiliging mag lezen; wat waar is gevonden, elk gegevenstype per locatie, met aantallen en betrouwbaarheid | Nee: een persoon stelt een vraag |
| **Eigenaren voor gegevensopslagen** | De naam, het soort, de provider, de omgeving en de gevoeligheid van de opslag, en de namen van de gegevenstypen; wat naar een eigenaar wijst: de cloudtags, de services die de opslag gebruiken, de code-eigenaren van het bestand dat de opslag declareert en de wijzigingen die eraan zijn gedaan; de teams die het bewijs noemt, bij naam, en de personen die het noemt, alleen als genummerde kandidaten, nooit bij hun naam of e-mailadres | Ja: een opslag zonder eigenaren start het, eens per dag voor nieuwe opslagen en wanneer een cloudkoppeling voor het eerst wordt gelezen, zolang **Aan nieuwe problemen werken** aan staat |
| **Namen voor problemen met één oorzaak** | Wat de gegevensopslag van de groep deelt: de module, stack of tag die ze maakte, de identiteit die ze aanmaakte, of hun naampatroon; de controle waarvoor ze zakken, hoeveel problemen de groep bevat, de soort gegevensopslag en de code die ze declareert. Nooit de naam van welke opslag in de groep dan ook | Ja: een groep problemen die één fout veroorzaakte, start het wanneer die ontstaat of verandert wat de opslag ervan deelt, zolang **Aan nieuwe problemen werken** aan staat |
| **Oorzaak oplossen** | De controle waarvoor de problemen van de groep zakken, wat hun gegevensopslag deelt en de module of bestanden die ze declareren, als verzoek aan de codeeragent; elke gegevensopslag die de pull request oplost: naam, soort, regio en cloud-ID, en het probleem ervan; de codeeragent leest daarna de eigen code van de repository om de wijziging te maken | Nee: een persoon vraagt het, vanuit een groep onder **Problemen** of door het voorstel van OneUptime AI goed te keuren, in een repository die hij in **Code** mag wijzigen; of de stap **Fix the code with AI** van een beveiligingsplaybook. Een regel waarvan **Herstel** **Zonder te vragen** is, opent hem zelf |
| **Opschoonregels voor wat Opschonen niet kan afdekken** | Het gegevenstype van elke bevinding, de categorie ervan en of het wordt gevonden aan de waarden of aan de naam van een veld; waar het staat, het attribuut of de logtekst, en de namen van de attributen ernaast; de vormen van de waarden, zoals `AA-9999` voor de waarde `AB-1234`, en hoeveel waarden er zijn gelezen | Ja: een telemetrieprobleem dat OneUptime AI indamt start het, voor de gegevens die geen regel van Opschonen kan verbergen, terwijl **Aan nieuwe problemen werken** aanstaat |
| **Gevoelige gegevens in pull requests** | Wat de regels in de diff van de pull request vonden: het bestand en de regel, de geschreven naam, het soort gegevens dat die noemt en de controle waarvoor die zou zakken; de diff van die bestanden en de titel van de pull request, zonder wat op een geheim, een e-mailadres of een IP-adres lijkt; nooit wat productie bevat: waar je telemetrie de gegevens bevatte, de naam van een opslag of wat een opslag bevat, en ook geen voorbeeld van wat er gevonden is, zelfs geen gemaskeerd | Ja: de [productiebeoordeling](/docs/ai/ai-agent#productiebeoordeling-van-pull-requests) van een pull request start het, wanneer de regels ervan gevoelige gegevens in de wijziging vinden |

**Uitleggen met AI** en **AI vragen** lezen ook eerst de [AI-context](/docs/ai/ai-context) van je team, als die er is: de notities die je team voor OneUptime AI over je systemen heeft geschreven. **Analyse van nieuwe problemen** leest die ook.

### Tekst die je systemen schreven is gegevens

De naam van een opslag, de cloud-ID, de tags, het bewijs waarmee een cloud antwoordde en de sleutel van een attribuut komen uit je clouds en je code, dus iedereen die een bucket een naam kan geven of een resource kan taggen, schrijft mee aan wat OneUptime AI leest. OneUptime AI krijgt elke instructie in een eigen bericht, en die tekst in een tweede bericht, als gegevens:

- elke tekst wordt aan een lengte gehouden en op één regel gezet, en wat op een geheim, een e-mailadres of een IP-adres lijkt, wordt weggelaten;
- tekst die leest als instructies aan een AI, zoals 'ignore previous instructions', wordt gemarkeerd, en OneUptime AI krijgt te horen die nooit te volgen;
- een gestructureerd antwoord, zoals dat van de veldsuggesties, wordt strikt gelezen: het gevraagde object, of geen antwoord.

### Wat wordt bewaard

De rij van elke aanroep in **Projectinstellingen → AI → AI-logboeken** zegt welke functie welk model aanriep, met de tokens en de kosten. Die bewaart nooit wat is verstuurd of geantwoord: Projectleden en Kijkers lezen de AI-logboeken, en de records van Gegevensbeveiliging zijn voor de eigenaren en de beveiligingsrollen. Ook de eigen telemetrie van OneUptime legt nooit vast wat Uitleggen met AI of de veldsuggesties verstuurden, zelfs niet waar de beheerder van de server vastlegt wat andere AI-aanroepen versturen. De analyse zelf wordt bij het probleem bewaard, voor iedereen die het probleem mag lezen, en een regel die berust op iets wat een lezer niet mag lezen, wordt voor die lezer verborgen.

Als een aanroep mislukt, bewaren Uitleggen met AI en de veldsuggesties geen woord van de fout van de provider, die kan citeren wat is verstuurd. De code-agent achter Oplossen met AI en Oorzaak oplossen, en de chat van AI vragen, bewaren de providerfout van een mislukte aanroep nog wel in de rij.

De eigenaarsvoorstellen bewaren hetzelfde als Uitleggen met AI: de rijen van hun aanroepen noemen de functie, het model, de tokens en de kosten, nooit wat er is verstuurd of geantwoord, en geen woord van de fout van een mislukte aanroep. Dat doen ook de opschoonregels die OneUptime AI schrijft, en elke regel die het schreef, wordt uitgevoerd op de records waarin de gegevens werden gezien voordat hij wordt voorgesteld of aangemaakt. Dat geldt ook voor het lezen van de gevoelige gegevens van een pull request, waarvan de punten op de productiebeoordeling worden bewaard, in Code en in de opmerking.

## Zie het zelf

**Gegevensbeveiliging → Instellingen → OneUptime AI** toont dit allemaal voor je project:

- **Wat OneUptime AI ziet**: elke functie, wat die verstuurt en nooit verstuurt, wat die start, het model waarop die draait en wat ervan wordt bewaard. Het model wordt genoemd aan wie de LLM-providers van het project mag lezen.
- **Een voorbeeld tonen**: de exacte invoer die **Uitleggen met AI** zou versturen voor je riskantste openstaande probleem, zoals die het zou versturen, met wat **Oplossen met AI** zou vragen. De AI-context van je project, die als eerste komt, wordt getoond met de lengte. Het toont alleen een probleem dat je mag lezen.

**Projectinstellingen → AI → LLM-providers** linkt ernaar, voor wie het model kiest.

## Je eigen model

Elke AI-functie van Gegevensbeveiliging draait op het model dat je project koos:

- **Uitleggen met AI** en de veldsuggesties draaien op de provider die een AI-regel voor het werk kiest, anders op de standaard-LLM-provider van je project, anders op die van de server zelf.
- De code-agent van **Oplossen met AI** draait op de provider die een AI-regel kiest, anders op een van de eigen providers van je project, anders op die van de server zelf.
- **AI vragen** draait op de provider die in de chat is gekozen, anders op de standaard van je project.
- Het lezen van de gevoelige gegevens van een pull request draait op de provider die de repository voor zijn productiebeoordelingen kiest, anders op de standaard-LLM-provider van je project, anders op die van de server zelf.

Een zelf gehost model draait ze allemaal: Ollama, vLLM of een OpenAI-compatibel endpoint dat je toevoegt onder **Projectinstellingen → AI → LLM-providers**. Op een afgeschermde server is de vLLM die met de Helm-chart wordt meegeleverd de eigen provider van de server, zodat niets de server verlaat.

### Met AI uit

Met **AI inschakelen** uit in **Projectinstellingen → AI → AI-functies** verstuurt OneUptime AI niets, en blijft Gegevensbeveiliging werken zoals voorheen: elke pagina, controle, scan en integratie. Er verschijnt geen AI-knop op een probleem, en na een scan wordt naar geen enkel veld gevraagd.

## Hoe het wordt gemeten

Elke AI-functie van Gegevensbeveiliging wordt gemeten op een vaste set verzonnen gevallen, opgebouwd zoals de functie de eigen invoer opbouwt en beoordeeld op wat een goed antwoord zegt: een uitleg die de oplossing noemt en niets herhaalt wat de naam van een opslag zei te zeggen, het juiste gegevenstype voor elk veld, een oplossing die verandert wat de controle nodig heeft en verder niets, en een antwoord uit wat AI vragen heeft gelezen. De gevallen draaien elke nacht tegen een vastgezet model, bij elke wijziging van een AI-prompt van Gegevensbeveiliging en voor elke release, die vereist dat elke functie de eigen drempel haalt.

De eigenaarsvoorstellen worden beoordeeld op het noemen van de eigenaar waar het bewijs naar wijst, op niemand kiezen als het naar niemand wijst, en op onzeker zijn waar het bewijs elkaar tegenspreekt. De opschoonregels worden uitgevoerd op verzonnen waarden van elke plek, die het model nooit ziet, en beoordeeld op het verbergen van elke waarde die de gegevens bevat en geen van de andere, en op het schrijven van geen regel voor een plek waarvoor geen regel juist is. Het lezen van pull requests wordt beoordeeld op het houden van elk punt dat een lek is, het weglaten van wat er geen is, en een oplossing die zegt wat er moet veranderen.

Om je eigen model op dezelfde gevallen te meten, voer je de evaluatie uit vanuit een checkout van OneUptime, met de sleutel van je model, als het er een nodig heeft, in `AI_EVAL_LLM_API_KEY`:

```bash
npm run ai-data-security-eval -- --llm-type=Ollama --model=llama3.1:70b --base-url=http://localhost:11434
```

In uw project telt **Oordelen bevestigd** onder **Projectinstellingen → AI → AI-resultaten** hoe vaak wat mensen besloten over een probleem dat OneUptime AI analyseerde, liep zoals het oordeel zei: opgelost of geaccepteerd als het **Echt** zei, geaccepteerd of gemarkeerd als bewust openbaar als het **Waarschijnlijk bewust** zei, en gemarkeerd als geen probleem als het **Waarschijnlijk een onjuiste vondst** zei.

## Volgende stappen

:::cards
- [Integraties van Gegevensbeveiliging](/docs/data-security/integrations): Wat Uitleggen met AI en Oplossen met AI doen op een probleem.
- [LLM-providers](/docs/ai/llm-provider): Voeg je eigen model toe, ook een zelf gehost model.
- [Gevoelige gegevenstypen](/docs/data-security/data-types): Hoe de velden die geen detector kon plaatsen worden voorgesteld.
- [Controles en problemen van Gegevensbeveiliging](/docs/data-security/checks-and-issues): Wat elk probleem betekent, en hoe je het oplost.
:::
