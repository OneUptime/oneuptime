# Uitvoeringen en logboeken

Telkens wanneer een workflow draait, bewaart OneUptime een verslag van wat er gebeurde — wanneer hij liep, of het lukte, en wat elk blok deed. Dat verslag heet een **run**. Runs zijn hoe je bevestigt dat een workflow werkte, hoe je er een debugt die dat niet deed, en hoe je terugkijkt op eerdere activiteit.

## Waar je ze vindt

| Pagina                              | Wat je ziet                                                                                        |
| ----------------------------------- | ---------------------------------------------------------------------------------------------------- |
| **Workflows → Runs & logboeken**    | Elke run van elke workflow in het project. Filter op workflownaam, status en tijd.                  |
| **Workflow → Runs & logboeken**     | Alleen de runs van deze ene workflow. Hier zit een filter **Uitvoerings-ID** in plaats van een workflowfilter. |
| **Eén enkele run**                  | Open je met de knop **Logboeken bekijken** op een runrij — de rijen zelf zijn niet klikbaar.        |

## Runstatussen

| Status                             | Wat het betekent                                                                                                                                          |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Gepland**                        | De trigger is afgegaan en de run staat in de wachtrij voor een runner. Meestal een fractie van een seconde. Staat een run na 5 minuten nog steeds gepland, dan is hij mislukt — niemand heeft hem opgepakt. |
| **Actief**                         | De workflow is bezig. Langlopende blokken houden een run in deze stand.                                                                                   |
| **Wachten**                        | De run staat geparkeerd op een **Sleep**-blok en hervat vanzelf. Ondertussen bezet hij geen worker.                                                        |
| **Executed**                       | De run haalde het einde zonder te falen. (Dit is de succestoestand — de pil leest **Executed**, niet "Success".)                                           |
| **Fout**                           | De run stopte omdat een blok een fout gaf. Wordt ook gebruikt wanneer een run in de wachtrij nooit wordt opgepakt, wanneer het hervatten van een slapende run verloren gaat, wanneer een schedule-expressie niet op te lossen is, of wanneer de workflow halverwege wordt uitgeschakeld. |
| **Timeout**                        | De run duurde langer dan toegestaan. Zie [Workflow-configuratie en veiligheid](/docs/workflows/configuration).                                             |
| **Execution Exceeded Current Plan** | Het project heeft zijn workflow-uitvoeringen van de afgelopen 30 dagen opgebruikt, of het abonnement is niet betaald. De run wordt vastgelegd maar niet uitgevoerd. Alleen op OneUptime Cloud. |

Een blok dat naar zijn uitgang **Fout** afbuigt — een API-blok bij een 4xx, bijvoorbeeld — laat de run niet mislukken. De foutentak draait en de run eindigt gewoon op **Executed**. De stap zelf wordt nog altijd rood getekend, zodat je hem kunt terugvinden.

## Een run lezen

Klik op **Logboeken bekijken** bij een run om hem te openen. De weergave **Workflow Run** heeft twee tabbladen.

**Stappen** — één rij per blok dat draaide, op volgorde. Elke rij toont de titel van het blok, zijn component-id, hoe lang het duurde, en via welke uitgang het vertrok (`→ success`, `→ error`, `→ yes`). Klap een rij uit voor twee blokken met details:

- **Received** — de instellingen die het blok meekreeg, nadat alle variabelen waren opgelost.
- **Returned** — wat het opleverde.

Mislukte stappen zijn rood en staan meteen uitgeklapt, met de foutmelding boven **Received**.

**Full Log** — het ruwe, regel-voor-regel logboek dat de runner afdrukte, inclusief alles wat de blokken zelf hebben gelogd. Gebruik het wanneer de weergave Stappen de mislukking niet verklaart.

Twee details die het waard zijn om te weten. De component-id onder elke staptitel is precies de tekst die je in een verwijzing `{{local.components.<id>.returnValues.…}}` plakt, wat dit de snelste manier maakt om een verwijzing goed te krijgen. En een run bewaart alleen zijn laatste 100 stappen — bij een lange of vaak hervatte run staat er een amberkleurige notitie op de plek waar de eerdere zijn weggevallen.

De getoonde waarden zijn wat het blok zag nadat de variabelen waren ingevuld, met twee uitzonderingen: geheimen en velden die het blok als gevoelig markeert worden onleesbaar gemaakt, en heel lange waarden worden afgekapt met "… (truncated)".

Start je een run vanuit de **Bouwer**, dan opent precies deze weergave al meelopend met de run, zodat je het kunt zien gebeuren in plaats van het achteraf op te moeten zoeken.

## Veelvoorkomend debugwerk

### "Mijn workflow draaide niet."

1. Controleer of de workflow **Ingeschakeld** is op zijn pagina **Overzicht**. Nieuwe workflows beginnen uitgeschakeld, en een uitgeschakelde workflow weigert elke run — ook een handmatige.
2. Bij een OneUptime-gebeurtenistrigger: ga na of de gebeurtenis daadwerkelijk plaatsvond. Open het record en bekijk zijn geschiedenis.
3. Bij een webhook-trigger: ga na of het andere systeem naar de juiste URL stuurt. De meeste tools loggen wanneer ze een webhook versturen — kijk daar.
4. Bij een schedule-trigger: ga na of de cron-expressie klopt met het tijdstip dat je verwacht.

Verschijnt de run *wel*, met de status **Execution Exceeded Current Plan**, dan heeft het project al zijn workflow-uitvoeringen van de afgelopen 30 dagen gebruikt, of het abonnement is niet betaald. Het logboek van de run noemt het aantal en de limiet van je abonnement. Dit geldt alleen voor OneUptime Cloud.

### "Een later blok draaide nooit."

Een blok dat niet draait, is meestal een bedradingsprobleem. Open de **Bouwer** en controleer:

- Is de uitgang van het vorige blok verbonden met de ingang van dit blok?
- Nam het vorige blok een andere uitgang dan je dacht — **Fout** in plaats van **Succes**, of **Nee** in plaats van **Ja**? Het tabblad Stappen laat zien welke het werd.

### "Een variabele kwam leeg binnen."

Open de run en kijk naar het blok **Received** van de stap die misging.

- Zie je daar letterlijk de tekst `{{local.components.…}}`, dan is de verwijzing niet opgelost. Meestal is dat een typefout in de component-id of in de id van de retourwaarde — onthoud dat het om de **Identifier** van het blok gaat, niet om de naam die erop staat. Controleer ook de spelling van `local.components` zelf: `{{local.componets.api-get-1.returnValues.response-body}}` gaat als letterlijke tekst mee en de run meldt alsnog **Executed**.
- Zie je een lege string, dan draaide het vorige blok wel, maar leverde het dat veld niet op.

Het tabblad **Full Log** bevat een waarschuwingsregel met elke verwijzing die niet oploste, en dat is meestal de snelste manier om hem te vinden.

### "Met de hand werkt het, vanaf de trigger niet."

Open de **Bouwer**, klik op **Workflow uitvoeren** en vul de velden van de trigger met waarden die lijken op wat de echte trigger stuurt. Vergelijk daarna de waarden bij **Received** van die run naast die van de echte run. Het verschil zit meestal in één veldnaam of één type.

## Een workflow opnieuw draaien

Er is geen knop "probeer deze run opnieuw". We draaien oude uitvoeringen niet automatisch over, omdat de neveneffecten — Slack-berichten, API-aanroepen, tickets — niet altijd veilig te herhalen zijn. Wil je het werk overdoen, herstel dan de workflow en laat de eerstvolgende echte trigger hem afvuren, of open de **Bouwer** en klik op **Workflow uitvoeren** met dezelfde waarden.

## Hoe lang worden runs bewaard?

Op OneUptime Cloud worden runs **30 dagen** bewaard en daarna verwijderd — daarom beschrijven beide runlijsten zichzelf als de afgelopen 30 dagen. Zelf gehoste installaties bewaren runs tot jij ze verwijdert; draait een workflow heel vaak en loopt je geschiedenis erdoor vol, zet hem dan uit of verwijder hem om de ruis niet verder te laten groeien.

Runs die zijn vastgelegd voordat het volgen van stappen bestond, hebben geen inhoud bij **Stappen** en tonen alleen hun **Full Log**.

## Waar je verder kunt lezen

- [Workflow-configuratie en veiligheid](/docs/workflows/configuration) — time-outs, recursielimieten, verborgen geheimen.
- [Workflow-variabelen](/docs/workflows/variables) — de variabelesyntaxis die je in je blokken gebruikt.
- [Workflow-componenten](/docs/workflows/components) — wat elk blok oplevert.
