# Uitvoeringen en logboeken

Elke keer dat een workflow draait, slaat OneUptime een record op van wat er is gebeurd — wanneer hij draaide, of het werkte en wat elk blok deed. Dat record heet een **run**. Runs zijn hoe je bevestigt dat een workflow werkte, een falende workflow debugt en terugkijkt op vroegere activiteit.

## Waar je ze vindt

| Pagina                       | Wat je ziet                                                                                          |
| ----------------------------- | ------------------------------------------------------------------------------------------------------- |
| **Workflows → Runs & Logs**   | Elke run van elke workflow in het project. Filter op workflownaam, status en tijd.                    |
| **Workflow → Runs & Logs**    | Alleen de runs van deze ene workflow. Deze heeft een **Run ID**-filter in plaats van een workflowfilter. |
| **Eén run**                   | Geopend met de knop **View Logs** op een runrij — de runrijen zelf zijn niet klikbaar.                |

## Run-statussen

| Status                              | Wat het betekent                                                                                                                                                             |
| ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Scheduled**                        | De trigger is afgegaan en de run staat in de wachtrij voor een runner. Meestal een fractie van een seconde. Een run die na 5 minuten nog **Scheduled** is, is gefaald — niemand heeft hem opgepakt. |
| **Running**                          | De workflow is bezig. Langlopende blokken houden een run in deze staat.                                                                                                      |
| **Waiting**                          | De run staat geparkeerd op een **Sleep**-blok en hervat vanzelf. Hij houdt geen worker vast terwijl hij wacht.                                                                |
| **Executed**                         | De run heeft het einde bereikt zonder te falen. (Dit is de successtatus — de pil toont **Executed**, niet "Success".)                                                        |
| **Error**                            | De run is gestopt omdat een blok een fout gaf. Ook gebruikt wanneer een gequeuede run nooit wordt opgepakt, wanneer het hervatten van een slapende run verloren gaat, wanneer een schedule-expressie niet kan worden herleid, of wanneer de workflow midden in de run wordt uitgeschakeld. |
| **Timeout**                          | De run duurde langer dan toegestaan. Zie [Configuration & Safety](/docs/workflows/configuration).                                                                            |
| **Execution Exceeded Current Plan**  | Het project heeft zijn workflowruns voor de laatste 30 dagen opgebruikt, of het abonnement is onbetaald. De run wordt geregistreerd maar niet uitgevoerd. Alleen OneUptime Cloud. |

Een blok dat afhandelt via zijn **Error**-output — bijvoorbeeld een API-blok bij een 4xx — laat de run niet falen. De foutentak draait en de run eindigt nog steeds als **Executed**. De stap zelf wordt nog steeds rood getekend zodat je hem kunt vinden.

## Een run lezen

Klik op **View Logs** bij een run om hem te openen. De **Workflow Run**-weergave heeft twee tabbladen.

**Steps** — één rij per blok dat draaide, in volgorde. Elke rij toont de titel van het blok, zijn component-id, hoe lang het duurde, en de output waarlangs het vertrok (`→ success`, `→ error`, `→ yes`). Klap een rij uit voor twee detailblokken:

- **Received** — de instellingen die het blok kreeg, nadat alle variabelen zijn opgelost.
- **Returned** — wat het produceerde.

Gefaalde stappen zijn rood en beginnen uitgeklapt, met het foutbericht afgedrukt boven **Received**.

**Full Log** — het ruwe, regel-voor-regel-log dat de runner afdrukte, inclusief alles wat de blokken zelf loggen. Gebruik dit wanneer de Steps-weergave de fout niet verklaart.

Twee dingen zijn goed om te weten. De component-id die onder elke steptitel wordt afgedrukt, is precies de string om te plakken in een `{{local.components.<id>.returnValues.…}}`-verwijzing, wat dit de snelste manier maakt om een verwijzing kloppend te krijgen. En een run bewaart alleen zijn laatste 100 stappen — een lange of herhaaldelijk hervatte run toont een amberkleurige melding waar de eerdere stappen zijn weggevallen.

De getoonde waarden zijn wat het blok zag nadat variabelen zijn ingevuld, met twee uitzonderingen: geheimen en velden die het blok als gevoelig markeert, worden geredigeerd, en zeer lange waarden worden ingekort met "… (truncated)".

Een run starten vanuit de **Builder** opent dezelfde weergave, al terwijl deze de run volgt, zodat je kunt kijken hoe het gebeurt in plaats van er later naar op zoek te gaan.

## Veelvoorkomende debugging

### "Mijn workflow draaide niet."

1. Zorg dat de workflow **Enabled** is op zijn **Overview**-pagina. Nieuwe workflows starten uitgeschakeld, en een uitgeschakelde workflow wijst elke run af — inclusief handmatige.

2. Voor een OneUptime event-trigger: controleer dat het event ook echt is gebeurd. Open het record en check de geschiedenis.
3. Voor een webhook-trigger: controleer dat het andere systeem naar de juiste URL stuurt. De meeste tools loggen wanneer ze een webhook versturen — kijk daar.
4. Voor een schedule-trigger: controleer dat de cron-expressie overeenkomt met de tijd die je verwacht.

Als de run *wel* verschijnt met de status **Execution Exceeded Current Plan**, heeft het project al zijn workflowruns voor de laatste 30 dagen opgebruikt, of is het abonnement onbetaald. Het log van de run noemt het aantal en de limiet van je abonnement. Dit geldt alleen voor OneUptime Cloud.

### "Een later blok heeft nooit gedraaid."

Een blok dat niet draait is meestal een bedradingsprobleem. Open de **Builder** en controleer:

- Is de output van het eerdere blok verbonden met de input van dit blok?
- Heeft het eerdere blok een andere output genomen dan je verwachtte — **Error** in plaats van **Success**, of **No** in plaats van **Yes**? Het tabblad Steps toont welke er is genomen.

### "Een variabele kwam leeg door."

Open de run en kijk naar het **Received**-blok van de falende stap.

- Als je de letterlijke tekst `{{local.components.…}}` ziet, is de verwijzing niet opgelost. Meestal is dat een typefout in de component-id of de return-value-id — bedenk dat het gaat om de **Identifier** van het blok, niet de naam die erop wordt weergegeven. Controleer ook de spelling van `local.components` zelf: `{{local.componets.api-get-1.returnValues.response-body}}` wordt als letterlijke tekst verstuurd en de run rapporteert nog steeds **Executed**.
- Als je een lege string ziet, heeft het eerdere blok wel gedraaid maar dat veld niet geproduceerd.

Het tabblad **Full Log** bevat een waarschuwingsregel die elke verwijzing noemt die niet is opgelost, wat meestal de snelste manier is om hem te vinden.

### "Het werkt handmatig, maar niet vanuit de trigger."

Open de **Builder**, klik op **Run Workflow**, en vul de velden van de trigger met waarden die lijken op wat de echte trigger verstuurt. Vergelijk dan de **Received**-waarden van die run naast die van de echte run. Het verschil zit meestal in één veldnaam of type.

## Een workflow opnieuw uitvoeren

Er is geen "retry this run"-knop. We voeren oude uitvoeringen niet automatisch opnieuw uit omdat de neveneffecten — Slack-berichten, API-aanroepen, tickets — misschien niet veilig te herhalen zijn. Om het werk over te doen, fix je de workflow en laat je de volgende echte trigger hem afgaan, of open je de **Builder** en klik je op **Run Workflow** met dezelfde waarden.

## Hoe lang worden runs bewaard?

Op OneUptime Cloud worden runs **30 dagen** bewaard en daarna verwijderd — daarom omschrijven beide runlijsten zichzelf als betrekking hebbend op de laatste 30 dagen. Self-hosted installaties bewaren runs totdat je ze verwijdert; als een workflow heel vaak draait en je geschiedenis vervuilt, schakel hem dan uit of verwijder hem om de ruis te stoppen.

Runs die zijn geregistreerd voordat steptracing werd toegevoegd, hebben geen **Steps**-inhoud en tonen alleen hun **Full Log**.

## Waar verder lezen

- [Configuratie en veiligheid](/docs/workflows/configuration) — timeouts, recursielimieten, verborgen geheimen.
- [Variabelen](/docs/workflows/variables) — de variabelesyntax die je in je blokken gebruikt.
- [Componenten](/docs/workflows/components) — wat elk blok produceert.
