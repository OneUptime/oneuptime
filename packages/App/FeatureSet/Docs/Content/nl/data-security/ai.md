# OneUptime AI in Gegevensbeveiliging

OneUptime AI werkt met wat Gegevensbeveiliging heeft gevonden, zonder je gegevens te zien. Het krijgt namen, vormen, aantallen en configuratie, nooit een waarde van je gegevens, een gemaskeerd voorbeeld, een record of een verbindingsreeks. Elke functie draait op het eigen model van je project, ook een zelf gehost model, en elke pagina, controle, scan en integratie van Gegevensbeveiliging werkt met AI uitgeschakeld.

:::cards
- [Wat OneUptime AI ziet](#wat-oneuptime-ai-ziet): Wat elke functie verstuurt, en wat die nooit verstuurt.
- [Zie het zelf](#zie-het-zelf): De exacte invoer die een van je problemen zou versturen.
- [Je eigen model](#je-eigen-model): Elke functie op de provider van je project, Ollama, vLLM of een OpenAI-compatibel endpoint.
- [Hoe het wordt gemeten](#hoe-het-wordt-gemeten): Elke functie op vaste gevallen, voor elke release.
:::

## Wat OneUptime AI ziet

Geen enkele functie stuurt een model ooit:

- een waarde van je gegevens;
- een gemaskeerd voorbeeld, zoals `j***@e******.com`: een gemaskeerd e-mailadres draagt nog een domein, en een gemaskeerde kaart de laatste vier cijfers;
- een record van je telemetrie: een logregel, een span of een sessie;
- een verbindingsreeks, een sleutel of een ander geheim.

Gegevensbeveiliging leest je gegevens zelf, in de eigen scans, en bewaart er niets van. Wat het OneUptime AI stuurt, wordt op één plek opgebouwd, uit een lijst van wat verstuurd mag worden, en een test faalt zodra een functie een model iets anders stuurt.

| Functie | Wat die verstuurt | Draait vanzelf |
| --- | --- | --- |
| **Uitleggen met AI** | De titel, de ernst en het bewijs van het probleem, waarom de controle ervan ertoe doet en de oplossing voor de cloud van de opslag; de naam, het soort, de regio en de cloud-ID van de opslag, de gevoeligheid en de namen van de gegevenstypen; bij een probleem in de telemetrie, waar elk soort gegevens is gevonden: het attribuut, de logtekst of de prompt waarin het staat | Nee: een persoon vraagt erom, op de pagina van een probleem |
| **Analyse van nieuwe problemen** | De titel, de ernst en het bewijs van het probleem, waarom de controle ervan ertoe doet en de oplossing voor de cloud van de opslag; de naam, het soort, de regio en de cloud-ID van de opslag, de gevoeligheid en de namen van de gegevenstypen; bij een probleem in de telemetrie, waar elk soort gegevens is gevonden: het attribuut, de logtekst of de prompt waarin het staat | Ja: een nieuw kritiek of hoog probleem start haar, zolang **Aan nieuwe problemen werken** aan staat |
| **Oplossen met AI** | Wat Uitleggen met AI verstuurt, als verzoek aan de code-agent, die daarna de eigen code van de repository leest om de wijziging te maken | Nee: een persoon vraagt erom, in een repository die die persoon onder **Code** mag wijzigen |
| **Suggesties voor velden die geen detector heeft geplaatst** | Het soort opslag en de gegevenstypen die de AI mag noemen; de naam van elk veld, de namen van de velden ernaast en de vormen van de waarden, elke letter als `a` of `A` en elk cijfer als `9`; hoeveel waarden zijn gelezen en hoe lang ze zijn | Ja: de inhoudsscan van een opslag start ze |
| **AI vragen** | De opslagen, problemen en toegang die de persoon in Gegevensbeveiliging mag lezen; wat waar is gevonden, elk gegevenstype per locatie, met aantallen en betrouwbaarheid | Nee: een persoon stelt een vraag |

**Uitleggen met AI** en **AI vragen** lezen ook eerst de [AI-context](/docs/ai/ai-context) van je team, als die er is: de notities die je team voor OneUptime AI over je systemen heeft geschreven. **Analyse van nieuwe problemen** leest die ook.

### Tekst die je systemen schreven is gegevens

De naam van een opslag, de cloud-ID, de tags, het bewijs waarmee een cloud antwoordde en de sleutel van een attribuut komen uit je clouds en je code, dus iedereen die een bucket een naam kan geven of een resource kan taggen, schrijft mee aan wat OneUptime AI leest. OneUptime AI krijgt elke instructie in een eigen bericht, en die tekst in een tweede bericht, als gegevens:

- elke tekst wordt aan een lengte gehouden en op één regel gezet, en wat op een geheim, een e-mailadres of een IP-adres lijkt, wordt weggelaten;
- tekst die leest als instructies aan een AI, zoals 'ignore previous instructions', wordt gemarkeerd, en OneUptime AI krijgt te horen die nooit te volgen;
- een gestructureerd antwoord, zoals dat van de veldsuggesties, wordt strikt gelezen: het gevraagde object, of geen antwoord.

### Wat wordt bewaard

De rij van elke aanroep in **Projectinstellingen → AI → AI-logboeken** zegt welke functie welk model aanriep, met de tokens en de kosten. Die bewaart nooit wat is verstuurd of geantwoord: Projectleden en Kijkers lezen de AI-logboeken, en de records van Gegevensbeveiliging zijn voor de eigenaren en de beveiligingsrollen. Ook de eigen telemetrie van OneUptime legt nooit vast wat Uitleggen met AI of de veldsuggesties verstuurden, zelfs niet waar de beheerder van de server vastlegt wat andere AI-aanroepen versturen.

Als een aanroep mislukt, bewaren Uitleggen met AI en de veldsuggesties geen woord van de fout van de provider, die kan citeren wat is verstuurd. De code-agent achter Oplossen met AI en de chat van AI vragen bewaren de providerfout van een mislukte aanroep nog wel in de rij.

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

Een zelf gehost model draait ze allemaal: Ollama, vLLM of een OpenAI-compatibel endpoint dat je toevoegt onder **Projectinstellingen → AI → LLM-providers**. Op een afgeschermde server is de vLLM die met de Helm-chart wordt meegeleverd de eigen provider van de server, zodat niets de server verlaat.

### Met AI uit

Met **AI inschakelen** uit in **Projectinstellingen → AI → AI-functies** verstuurt OneUptime AI niets, en blijft Gegevensbeveiliging werken zoals voorheen: elke pagina, controle, scan en integratie. Er verschijnt geen AI-knop op een probleem, en na een scan wordt naar geen enkel veld gevraagd.

## Hoe het wordt gemeten

Elke AI-functie van Gegevensbeveiliging wordt gemeten op een vaste set verzonnen gevallen, opgebouwd zoals de functie de eigen invoer opbouwt en beoordeeld op wat een goed antwoord zegt: een uitleg die de oplossing noemt en niets herhaalt wat de naam van een opslag zei te zeggen, het juiste gegevenstype voor elk veld, een oplossing die verandert wat de controle nodig heeft en verder niets, en een antwoord uit wat AI vragen heeft gelezen. De gevallen draaien elke nacht tegen een vastgezet model, bij elke wijziging van een AI-prompt van Gegevensbeveiliging en voor elke release, die vereist dat elke functie de eigen drempel haalt.

Om je eigen model op dezelfde gevallen te meten, voer je de evaluatie uit vanuit een checkout van OneUptime, met de sleutel van je model, als het er een nodig heeft, in `AI_EVAL_LLM_API_KEY`:

```bash
npm run ai-data-security-eval -- --llm-type=Ollama --model=llama3.1:70b --base-url=http://localhost:11434
```

## Volgende stappen

:::cards
- [Integraties van Gegevensbeveiliging](/docs/data-security/integrations): Wat Uitleggen met AI en Oplossen met AI doen op een probleem.
- [LLM-providers](/docs/ai/llm-provider): Voeg je eigen model toe, ook een zelf gehost model.
- [Gevoelige gegevenstypen](/docs/data-security/data-types): Hoe de velden die geen detector kon plaatsen worden voorgesteld.
- [Controles en problemen van Gegevensbeveiliging](/docs/data-security/checks-and-issues): Wat elk probleem betekent, en hoe je het oplost.
:::
