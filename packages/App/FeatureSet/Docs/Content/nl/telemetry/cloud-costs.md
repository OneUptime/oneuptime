# Cloudkosten en besparingen

Een gekoppeld cloudaccount zegt ook wat het kost en hoe het minder zou kunnen kosten. OneUptime leest de kosten van elke dag uit de eigen facturering van je cloud en de aanbevelingen van de eigen aanbevelingsdienst van je cloud, toont ze onder **Cloud → Uitgaven → Kosten** en **Cloud → Uitgaven → Besparingen**, en waarschuwt voordat een maand meer kost dan het budget onder **Cloud → Uitgaven → Budgetten**. Als je het toestaat, voert het ook de besparingen door die een eigenaar goedkeurt, stopt het niet-productieresources buiten werktijd en controleert het elke wijziging aan de hand van de rekening.

:::cards
- [Amazon Web Services](#amazon-web-services): Cost Explorer en Cost Optimization Hub, elk één keer aangezet.
- [Microsoft Azure](#microsoft-azure): Cost Management en Azure Advisor, met één rol extra.
- [Google Cloud](#google-cloud): Je factuurexport naar BigQuery, en de Recommender.
- [Besparingen doorvoeren](#besparingen-doorvoeren): Pas een besparing toe met goedkeuring van de eigenaar, en maak haar ongedaan.
- [Buiten-kantoortijdschema's](#buiten-kantoortijdschemas): Stop niet-productieresources 's nachts en in het weekend.
- [AI-regels voor besparingen](#ai-regels-voor-besparingen): Voorstellen voor eigenaren, of wijzigingen binnen een limiet.
- [Budgetten](#budgetten): Een waarschuwing zodra de uitgaven van een maand een deel van het budget passeren.
- [Verplichte tags](#verplichte-tags): Hoeveel van je uitgaven de tags draagt die je verplicht stelt, en nieuwe resources zonder die tags.
:::

## Hoe het werkt

```mermaid title="Van de facturering van je cloud naar de pagina's van Cloud"
flowchart TB
    bill["Facturering van je cloud,<br/>twee keer per dag gelezen"] --> costs["Kosten"]
    rec["Cloudaanbevelingen,<br/>één keer per dag gelezen"] --> savings["Besparingen"]
    costs --> budgets["Budgetten die waarschuwen"]
    costs --> overview["Overzicht van Cloud"]
    savings --> overview
```

- **De kosten komen uit de eigen facturering van je cloud.** AWS Cost Explorer, Azure Cost Management en de factuurexport van Google Cloud naar BigQuery, vóór tegoeden en terugbetalingen, in de valuta waarin het account wordt gefactureerd. Elk bedrag is dat van één dag, in UTC-dagen, zoals je cloud ze factureert.
- **Een cloud meldt de laatste dag of twee te laat.** Elke leesbeurt leest de laatste week opnieuw, en in de eerste dagen van een maand de hele vorige maand, zodat de kosten van een dag vast komen te staan terwijl je cloud die afrondt. De eerste leesbeurt van een koppeling gaat terug tot het begin van de voorvorige maand.
- **De prognose van de maand volgt het tempo van de laatste week.** Het is wat de maand tot nu toe heeft gekost, met elke resterende dag tegen het gemiddelde van de laatste zeven volledige dagen.
- **De besparingen komen uit de eigen aanbevelingsdienst van je cloud.** AWS Cost Optimization Hub, Azure Advisor en de Recommender van Google Cloud: een kleiner formaat, een resource die stilstaat, een toezegging die loont, elk met wat ze per maand zou besparen. Een aanbeveling die je in de console van je cloud uitvoert of afwijst, verdwijnt bij de volgende leesbeurt.

## Voordat je begint

- **Een gekoppeld account.** [Een cloudaccount koppelen](/docs/telemetry/cloud-accounts) met de huidige installatieopdracht: die laat de koppeling kosten en aanbevelingen lezen. Een eerder gemaakte koppeling leest geen van beide tot je haar opdracht opnieuw uitvoert.

## Amazon Web Services

De koppeling leest kosten met `ce:GetCostAndUsage`, haar toezeggingen met `ce:GetSavingsPlansCoverage`, `ce:GetSavingsPlansUtilization`, `ce:GetReservationCoverage` en `ce:GetReservationUtilization`, en aanbevelingen met `cost-optimization-hub:ListRecommendations`. Cost Explorer en Cost Optimization Hub moeten eerst in het account worden aangezet:

:::steps
### Cost Explorer aanzetten

Open Cost Explorer één keer in de AWS-console Billing and Cost Management: AWS bereidt de kosten van het account binnen een dag voor. Koppel het beheeraccount van de organisatie om de kosten van elk lidaccount te lezen.

### Cost Optimization Hub inschakelen

Open Cost Optimization Hub in dezelfde console en schakel hem in, voor de organisatie vanuit het beheeraccount of alleen voor het account. De aanbevelingen komen binnen een dag.
:::

Cost Explorer rekent $0.01 per verzoek: een leesbeurt van de kosten doet er een paar, en de toezeggingen worden met vier per dag gelezen. Cost Optimization Hub is gratis.

### Kosten per resource

Cost Explorer zegt ook wat elke resource kost, over de laatste 14 dagen, zodra gegevens op resourceniveau aan staan. Open in de console AWS Billing and Cost Management de voorkeuren van Cost Management en zet gegevens op resourceniveau aan met dagelijkse granulariteit, voor de organisatie vanuit haar beheeraccount. AWS bereidt ze binnen 48 uur voor.

Bewerk daarna de koppeling onder **Cloud → Koppelen** en zet onder **Meer velden** **Kosten per resource** aan. De koppeling leest ze één keer per dag met `ce:GetCostAndUsageWithResources`: de eerste keer de 14 dagen, daarna de laatste drie opnieuw, met elke keer een paar verzoeken. Wat ze leest, blijft bij de kosten van het account nadat Cost Explorer het vergeten is. Een eerder gemaakte koppeling moet haar instelopdracht opnieuw uitvoeren, die de actie toevoegt.

## Microsoft Azure

De app leest kosten met de rol **Cost Management Reader**, op hetzelfde bereik als **Monitoring Reader**: de installatieopdracht kent beide toe. De aanbevelingen van Azure Advisor worden gelezen met **Monitoring Reader**, dus er valt niets aan te zetten. Om een eerder gemaakte app de rol te geven, voer je uit:

```bash
az role assignment create --assignee <APP_ID> --role "Cost Management Reader" --scope /subscriptions/<SUBSCRIPTION_ID>
```

Cost Management antwoordt per abonnement, met de resource waarvoor elke kostenpost is, en lezen kost niets. Als het voor een abonnement niet kan antwoorden, zegt de pagina **Kosten** van het account waarom.

Cost Management beperkt hoe snel de kosten van een tenant worden gelezen, voor iedereen die ze leest even snel: elke query kost een queryverwerkingseenheid (QPU) per maand aan gegevens die hij leest, en een tenant heeft 12 QPU per 10 seconden, 60 per minuut en 600 per uur. OneUptime leest de abonnementen van een tenant na elkaar binnen twee derde van elk quotum, wacht zo lang als Cost Management vraagt wanneer het een query weigert, en gaat bij de volgende leesbeurt verder waar het stopte. Een abonnement dat nog niet is gelezen toont **In de wachtrij**, met wanneer het wordt gelezen; een abonnement met bedragen houdt die intussen.

## Google Cloud

Google Cloud heeft geen API voor de kosten van een project: OneUptime leest ze uit de export van je factureringsaccount naar BigQuery.

:::steps
### Je facturering naar BigQuery exporteren

Open in de Google Cloud-console Billing, daarna Billing export, en zet de export van de gedetailleerde gebruikskosten naar een BigQuery-dataset aan. Google schrijft die een paar uur achter, vanaf de dag dat je haar aanzet.

### Het serviceaccount haar laten lezen

Geef het serviceaccount van de koppeling **BigQuery Data Viewer** op de dataset van de export. De installatieopdracht gaf het al **BigQuery Job User**, om de query in zijn eigen project uit te voeren.

### De tabel van de export opgeven

Bewerk de koppeling onder **Cloud → Koppelen** en zet onder **Meer velden** de **Tabel van de factuurexport** op de volledige naam van de tabel: `<PROJECT_ID>.<DATASET>.gcp_billing_export_resource_v1_<BILLING_ACCOUNT_ID>`.
:::

De gedetailleerde export noemt de resource waarvoor elke kostenpost is; de standaardexport noemt alleen de dienst en de regio. BigQuery factureert de query: de eerste 1 TiB per maand is gratis, daarna $6.25 per TiB, en een maand van een export is een paar megabyte tot een paar gigabyte. De aanbevelingen van de Recommender voor machinetypen en ongebruikte resources worden gelezen met **Compute Recommender Viewer**, die de installatieopdracht toekent, en kosten niets.

## Manieren om minder uit te geven

**Cloud → Uitgaven → Besparingen** toont elke aanbeveling, de grootste besparing eerst: wat er moet gebeuren, bij welke resource, wat er zou veranderen en wat ze per maand bespaart. De strook erboven telt ze op, in totaal en per soort: een kleiner formaat, een resource die stilstaat, een toezegging. Een aanbeveling linkt naar de pagina van haar resource als OneUptime de resource heeft, en een die OneUptime kan doorvoeren heeft **Toepassen**: zie [Besparingen doorvoeren](#besparingen-doorvoeren).

### Groottebepaling op basis van de eigen metingen van OneUptime

Een resource waar geen aanbevelingsdienst iets over zegt, omdat die niet is ingeschakeld, het type niet dekt of de resource te nieuw vindt, krijgt van OneUptime een grootte op basis van de CPU- en geheugenmetingen die de verbinding de afgelopen 14 dagen deed. OneUptime bepaalt de grootte van EC2-instances, RDS-databases en ElastiCache-clusters op AWS, virtuele machines, flexibele PostgreSQL- en MySQL-servers en App Service-plannen op Azure, en Compute Engine-VM's en Cloud SQL-instances op Google Cloud:

- **Overgeprovisioneerd** als het formaat half zo groot, of een kwart, nog ruimte zou hebben: op het kleinere formaat zou het 95e percentiel van de CPU hoogstens 60% zijn, de hoogste CPU-meting hoogstens 100% en de geheugenpiek hoogstens 70%, als het geheugen wordt gelezen.
- **Ondergeprovisioneerd** als het 95e percentiel van de CPU 85% of meer is, of de geheugenpiek 90% of meer: het formaat twee keer zo groot.

Een resource krijgt een grootte zodra er 6 dagen aan metingen zijn. De pagina toont de **Groottebepaling** naast wat de resource kost, en een overgeprovisioneerde staat onder **Cloud → Uitgaven → Besparingen**, met OneUptime als bron. Wat een wijziging bespaart, is haar deel van wat de resource de afgelopen 30 dagen kostte, dus het is bekend zodra je cloud de resource op naam factureert: de gedetailleerde export van Azure en Google Cloud doet dat, en AWS ook zodra Kosten per resource aan staat. Burstable formaten, zoals t3, de B-serie en e2-micro, krijgen nooit een grootte.

Je cloud leest het geheugen van een VM alleen met een eigen agent in de VM: de CloudWatch-agent op een EC2-instance, de Ops Agent op een Compute Engine-VM, en geen enkele voor een Azure-VM, die het vrije geheugen meldt in plaats van het gebruikte. Een VM waarop [de hostcollector van OneUptime](/docs/telemetry/hosts) draait, krijgt in plaats daarvan een grootte op basis van het geheugen dat de hostcollector leest:

- **De VM en de host zijn één machine** wanneer de provider, het account, de regio en het instance-ID allemaal overeenkomen: het EC2-instance-ID, het numerieke ID van een Compute Engine-VM of de `vmId` van een Azure-VM. Een hostnaam alleen levert nooit een match op, en een VM die twee hosts claimen, zoals een gekloonde machine, wordt aan geen van beide gekoppeld. De pagina van de VM noemt haar host, en de pagina van de host noemt zijn VM, elk met een link naar de ander.
- **Geheugen is het gebruikte geheugen van de host, zonder cache en buffers**, het cijfer dat de pagina van de host in een grafiek toont, over dezelfde 14 dagen. Een drukke bestandscache leest nooit als een volle machine. Ook de host heeft 6 dagen aan metingen nodig.
- **Waar beide het geheugen lezen**, zoals bij een Compute Engine-VM met de Ops Agent en de hostcollector, telt degene met de meeste metingen. De CPU is altijd de meting van je cloud.

De **Groottebepaling** van de VM zegt waar haar geheugen vandaan kwam, net als haar regel onder **Cloud → Uitgaven → Besparingen**. Een VM die alleen op haar CPU een grootte krijgt, zegt dat, met een link om de hostcollector te installeren. De hostcollector stempelt de identiteit van zijn cloud met de stap `resourcedetection/cloud` die [de configuratie van de handleiding voor hosts](/docs/telemetry/host-otel-collector) bevat. Een host met de standaardconfiguratie van OneUptime krijgt de stap met de volgende release van OneUptime, en een host met een eigen configuratie moet hem toevoegen. Kubernetes-nodes worden overgelaten aan [Kubernetes-kostenobservability](/docs/telemetry/kubernetes-cost), die de requests bepaalt van wat erop draait.

### Toezeggingen

**Cloud → Uitgaven → Besparingen** en de pagina **Kosten** van een account tonen hoeveel van de uitgaven van de afgelopen 30 dagen de toezeggingen van elk account hebben betaald, en hoeveel ervan is gebruikt, een regel per soort:

- AWS: Savings Plans en Reserved Instances, uit Cost Explorer. Het beheeraccount van een organisatie leest ze voor elk account van de organisatie.
- Azure: besparingsplannen en reserveringen, uit Cost Management, in afgeschreven kosten.
- Google Cloud: kortingen voor toegezegd gebruik, uit je factuurexport. De export zegt niet hoeveel van een toezegging ongebruikt bleef, dus hoeveel ervan wordt gebruikt, wordt niet getoond.

Een account zonder toezegging toont wat tegen on-demandtarieven draaide en wat een toezegging goedkoper zou betalen. De cijfers van elke soort zijn die van zijn cloud, en soorten worden nooit opgeteld: een reservering en een Savings Plan kunnen allebei de uitgaven van dezelfde machine als de hunne tellen.

## Besparingen doorvoeren

OneUptime voert een besparing door via de cloudverbinding van het account zodra de instelling **Besparingsacties** dat toestaat: [Besparingsacties](/docs/telemetry/cloud-accounts#besparingsacties) zegt wat elke keuze verleent. Het voert alleen wijzigingen van één stap door: het stopt een ongebruikte instantie of database, zet een gp2-volume om naar gp3, verwijdert een niet-gekoppelde schijf, een oude momentopname of een ongebruikt image, geeft een ongebruikt adres vrij en wijzigt, als je het toestaat, het formaat van een instantie of database naar het aanbevolen formaat. Het koopt nooit een toezegging: **Kopen in console** opent daarvoor de pagina van je cloud.

:::steps
### Kies Toepassen

Kies onder **Cloud → Uitgaven → Besparingen** bij een besparing **Toepassen**. Het dialoogvenster zegt wat er verandert, wat het per maand bespaart, hoe het ongedaan wordt gemaakt of dat dat niet kan, en wie het goedkeurt.

### Een eigenaar keurt haar goed

Een persoon die als eigenaar van de resource is aangewezen, of een lid van een team dat haar bezit, die haar ook mag bewerken, keurt de wijziging goed. Een resource zonder eigenaar wordt goedgekeurd door een Projecteigenaar of Projectbeheerder. Als je haar zelf mag goedkeuren, voert **Toepassen** haar meteen door, als jou. Anders wacht ze onder **Wacht op goedkeuring** tot een eigenaar **Goedkeuren** kiest, of **Verbergen** met een reden.

### OneUptime voert haar door

De wijziging wordt via de verbinding doorgevoerd en staat in de tijdlijnen van de resource en het account, met wie haar heeft goedgekeurd. Van een verwijderde schijf wordt eerst een laatste momentopname gemaakt, tenzij je **Eerst een laatste momentopname maken** uitzet.
:::

Elke wijziging zegt hoe ze ongedaan wordt gemaakt: **Ongedaan maken** onder **Doorgevoerde wijzigingen** start een gestopte instantie weer, zet een volume of formaat terug, of maakt een verwijderde schijf opnieuw uit haar laatste momentopname. Wat definitief verwijdert, zoals een momentopname, een image of een vrijgegeven adres, kan niet ongedaan worden gemaakt, en het dialoogvenster zegt dat voordat je het toepast. Waar het project met **Twee goedkeuringen vereisen voor riskantere oplossingen** twee goedkeuringen vraagt, heeft een wijziging die niet ongedaan kan worden gemaakt twee mensen nodig.

Een resource waarvan de tags zeggen dat ze als code wordt beheerd, bijvoorbeeld door Terraform of CloudFormation, wordt in plaats daarvan in haar code gewijzigd: het dialoogvenster biedt **Pull request openen** naar de repository die haar declareert, zodat de volgende apply de besparing niet terugdraait.

### Bewezen door de rekening

**Deze maand bespaard** telt alleen wat de rekening van je cloud laat zien. Zodra drie dagen na een wijziging op de rekening vaststaan, worden de kosten per dag van de resource vergeleken met de week voor de wijziging: ze is **Zichtbaar in de rekening** als de kosten met minstens een kwart van wat beloofd was zijn gedaald, **Niet zichtbaar in de rekening** als dat niet zo is, en **Niet meetbaar** als je cloud de resource niet op naam factureert. **Rekening wordt gecontroleerd** telt de wijzigingen die nog op die dagen wachten.

## Buiten-kantoortijdschema's

Onder **Cloud → Uitgaven → Schema's** stopt een schema niet-productie-instanties en -databases buiten werktijd, en start ze weer:

:::steps
### Kies de resources

Noem de cloudtag die ze kiest, bijvoorbeeld `Schedule` = `office-hours`, in één account of in alle.

### Zeg wanneer ze draaien

Kies de werkdagen, de tijd waarop ze starten en de tijd waarop ze stoppen, in 24-uursnotatie, en de tijdzone.
:::

Als de werktijd eindigt, stopt een schema via de verbinding van zijn account elke draaiende resource die zijn tag kiest en waarvan bekend is dat ze geen productie is, en als de werktijd begint, start het alleen weer wat het zelf heeft gestopt: een resource die iemand met de hand heeft gestopt, blijft gestopt. **Resources bekijken** toont wat een schema nu kiest en waarom het er sommige laat draaien. Het stopt EC2-instanties en RDS-databases op AWS, virtuele machines op Azure en Compute Engine-instanties op Google Cloud. AWS start een database die zeven dagen gestopt is uit zichzelf weer.

Een schema stopt nooit productie, en nooit een resource waarvan niets de omgeving zegt. Van een resource is bekend dat ze geen productie is als:

- een van haar tags dat zegt, onder een sleutel zoals `environment`, `env`, `stage`, `tier` of `deployment.environment`, met een woord zoals `dev`, `test`, `qa`, `staging` of `sandbox`;
- haar account als **Niet-productie** is gemarkeerd onder **Omgeving** in de **Instellingen** van het account;
- of een van haar labels dat zegt, bijvoorbeeld `Staging` of `env: dev`.

Productie wint: een tag die `prod`, `production` of `live` zegt, of een account dat als **Productie** is gemarkeerd, houdt een resource draaiend, wat de rest ook zegt. De naam van een resource wordt daarvoor nooit gelezen. Zet je een schema uit, dan stopt het niets meer en start het wat het heeft gestopt zodra de werktijd begint; verwijder je het, dan wordt wat het heeft gestopt meteen gestart.

## AI-regels voor besparingen

Met **AI inschakelen** aan stelt OneUptime AI na elke lezing van de besparingen van het account elke besparing die het kan doorvoeren voor aan de eigenaren van de resource, en zij keuren haar goed of wijzen haar af onder **Wacht op goedkeuring**. Onder **Cloud → Instellingen → AI-regels voor besparingen** zegt een regel wat OneUptime AI doet met de besparingen waarop ze past, naar het soort wijziging, de omgeving van de resource en de cloud: **Uit**, **Aan de eigenaar voorstellen** of **Zonder te vragen handelen**, tot een maandlimiet. Zonder regel wordt elke besparing voorgesteld en geen enkele doorgevoerd; met regels alleen waarop een regel past, en tussen passende regels wint de voorzichtigste.

Een regel handelt alleen zonder te vragen bij een resource waarvan bekend is dat ze geen productie is, alleen voor een wijziging die ongedaan kan worden gemaakt, alleen tot de kleinste limiet van de passende regels, en hoogstens 10 keer per uur in een project: al het andere wordt voorgesteld. Een wijziging die zonder te vragen is doorgevoerd, staat in de tijdlijnen met de regel die haar doorvoerde, en de eigenaren kunnen haar ongedaan maken. Een afgewezen of ongedaan gemaakte besparing wordt 30 dagen niet opnieuw voorgesteld.

## Budgetten

:::steps
### Een budget maken

Maak onder **Cloud → Uitgaven → Budgetten** een budget: het **Maandbedrag** en het **Account** waarvoor het geldt, of geen voor alle accounts.

### Kiezen wanneer het waarschuwt

**Waarschuwen bij** neemt de delen van het budget waarbij gewaarschuwd wordt, in procenten: om te beginnen 80 en 100. **Waarschuwen bij dreigende overschrijding** waarschuwt ook, één keer per maand, als het tempo van de laatste week de maand boven het budget zou brengen. **Waarschuwen bij ongewone dagen** waarschuwt ook op de dag na een dag die veel meer kostte dan gewoonlijk: zie [Ongewone dagen](#ongewone-dagen). **Ernst van waarschuwing** en **Bereikbaarheidsbeleid** bepalen hoe ernstig de waarschuwingen zijn en wie er wordt opgeroepen.
:::

Een budget wordt gecontroleerd na elke leesbeurt van de kosten en elk uur. Zodra de uitgaven van de maand een drempel passeren, wordt er een waarschuwing voor gemaakt, voor de hoogste als een leesbeurt er meerdere tegelijk passeert, en een nieuwe maand lost de waarschuwingen van de vorige op. Een budget telt alleen de accounts die in zijn valuta worden gefactureerd.

AI-agents kunnen budgetten maken en wijzigen via de [MCP-server](/docs/ai/mcp-server), en scripts met het commando `oneuptime cloud-budget` van de CLI: zie [Bewerkingen op bronnen](/docs/cli/resource-operations).

### Ongewone dagen

Na elke leesbeurt wordt elk van de laatste 14 volle dagen van een account vergeleken met de 14 dagen ervoor. Een dag is ongewoon als een service het dubbele van zijn gewone dag of meer kostte, of het hele account anderhalf keer zijn gewone dag of meer. In beide gevallen moet het minstens 10 meer zijn dan gewoonlijk, in de valuta van het account, en minstens 5% van de gewone dag van het account, zodat een paar cent nooit als piek telt. De gewone waarde van een dag is de mediaan van de 14 dagen ervoor, dus één piek verschuift die weinig, en een account wordt pas beoordeeld als het een week aan kosten heeft.

**Cloud → Uitgaven → Kosten** markeert de ongewone dagen in de dagelijkse uitgaven, boven hun balken, en toont ze eronder. Over alle accounts opent elke markering de **Kosten** van haar account. Een budget dat het account meetelt, maakt één waarschuwing voor elk account en elke dag, de dag erna, en noemt elke service die hoog uitkwam. Een piek die dagen aanhoudt, wordt gemeld op de dag dat hij begon, en een dag van meer dan een week geleden wordt niet gemeld. Een budget dat is gemaakt voordat deze waarschuwingen bestonden, maakt ze pas als u het bewerkt en ze aanzet.

## Waar het geld naartoe gaat

**Cloud → Uitgaven → Kosten** splitst de uitgaven van een periode uit per dienst, regio, account of resource, en op nog drie manieren:

- Per omgeving van de app-platforms: de platformdienst van elke omgeving in haar account en regio, zoals Amazon ECS of Cloud Run, en de resources van een Elastic Beanstalk-omgeving via de tag die AWS ze geeft.
- Per app: wat een platform een app op naam in rekening brengt, zoals een Cloud Run-service of een Container App. Amazon ECS rekent zijn taken af en App Service zijn plannen, dus de kosten van hun apps blijven bij hun omgeving.
- Per tag: elke waarde van de tag die je kiest. Een kostenpost houdt de tags die hij had toen hij werd gelezen: de labels van een factuurexport van Google Cloud, anders de tags van de resource waaraan hij wordt toegerekend, wat bij AWS Kosten per resource vraagt.

Onder de lijst zegt de kaart waar de rest op uitkwam: wat in geen enkele omgeving zit, wat aan een omgeving als geheel wordt gefactureerd, of wat de tag niet heeft. Kosten die zijn gelezen voordat tags werden bewaard, worden één keer opnieuw gelezen, zo ver terug als een eerste leesbeurt, zodat hun tags worden aangevuld.

## Verplichte tags

Uitgaven zijn maar zo goed toegewezen als de tags die ze dragen. Geef onder **Cloud → Uitgaven → Tags** aan welke tags elke resource moet dragen, zoals `team`, `env` en `cost-center`, en zie hoeveel van je uitgaven en resources ze dragen, welke resources niet, en wie elke nieuwe zonder die tags heeft aangemaakt.

:::steps
### Een tag verplicht stellen

Kies **Een tag verplicht maken** en vul de **Tagsleutel** in. Zet onder **Toegestane waarden** de waarden die hij mag hebben, gescheiden door komma's, of laat het leeg om elke waarde toe te staan. Kies een **Account** om de tag alleen in dat account verplicht te stellen. Een **Beschrijving**, onder **Meer velden**, zegt in de e-mails waarvoor de tag dient.

### De dekking lezen

De pagina opent met hoeveel van de uitgaven van de afgelopen 30 dagen en van je resources alle verplichte tags dragen. Daaronder staan de resources die een tag missen, de duurste eerst, dan elke tag apart, het verloop over de afgelopen 12 weken en elk account.

### Taggen wat ontbreekt

Elke resource die een tag mist, toont de waarde die OneUptime voorstelt en de opdracht die hem in je cloud zet. Een resource die in code is gedeclareerd, zegt welke code hem declareert: voeg de tag daar toe, anders haalt de volgende deploy hem weer weg.
:::

- **Sleutels komen overeen ongeacht hoofdletters.** `Team`, `team` en `TEAM` zijn één sleutel, en een resource draagt de tag wanneer een willekeurige schrijfwijze ervan een toegestane waarde heeft. Ook waarden komen overeen ongeacht hoofdletters, en een lege waarde is geen waarde.
- **Een toegestane waarde kan een patroon zijn.** `*` staat voor willekeurige tekens en `?` voor één teken, dus `prod-*` past op `prod-eu` en `prod-us`. Patronen zijn geen reguliere expressies.
- **Eigen tags van een account.** Een tag die in één account verplicht is, vervangt daar de tag van het project met dezelfde sleutel, en een account kan een eigen sleutel verplicht stellen. De **Tags** van een account tonen beide.
- **Er verandert niets in je cloud.** OneUptime stopt of tagt nooit een resource om een ontbrekende tag. Het licht mensen in en stelt de waarde voor.

### Dekking

- **Uitgaven met tags** is het aandeel van de kosten van de afgelopen 30 dagen dat alle verplichte tags draagt, volgens de tags waarmee elke kostenpost is gelezen. Het wordt berekend telkens als je de pagina opent, dus een tag die je vandaag verplicht stelt, wordt ook over de afgelopen 30 dagen gemeten. AWS-kosten dragen pas tags zodra [Kosten per resource](#kosten-per-resource) aan staat: tot dan zeggen de uitgaven van een AWS-account **Niet gemeten** in plaats van 0%.
- **Resources met tags** is het aandeel van de resources die je verbindingen tonen dat alle verplichte tags draagt, zoals ze nu getagd zijn.
- **Dekking in de tijd** toont elk van de afgelopen 12 weken: uitgaven uit de kosten, en resources uit de telling die OneUptime elke dag maakt.

### Nieuwe resources

Een resource die je verbinding toont na de eerste volledige lijst van zijn account, is nieuw. De verbinding maakt elke 30 minuten een lijst, dus een nieuwe resource wordt gevonden binnen het uur waarin hij is aangemaakt. Over een resource die een verplichte tag mist, wordt één keer ingelicht:

- **Wie wordt ingelicht.** De persoon die hem heeft aangemaakt, wanneer het wijzigingslogboek van het account een lid van je project bij zijn e-mailadres noemt, en de eigenaren van de resource, volgens eigenaarsregels en teams. Kan geen van hen worden ingelicht, dan worden de Projecteigenaren het. Ieder moet je cloudresources kunnen lezen.
- **Hoe vaak.** Eén e-mail per uur somt voor elke persoon alles op wat nieuw is. Onder **Meer instellingen** stuurt **Eén e-mail per resource** elke resource apart, en **Waarschuwing geven** geeft daarnaast voor elk account een waarschuwing, met de ernst en het bereikbaarheidsbeleid onder **Waar waarschuwingen heen gaan**.
- **Wanneer hij getagd wordt.** Een resource die getagd is voordat de e-mail verstuurd wordt, staat er niet in, en de lijst **Nieuwe resources** markeert elke resource als **Getagd** zodra hij de tags draagt.

### Voorgestelde waarden

OneUptime stelt alleen een waarde voor als de tag die waarde toestaat:

- **Een sleutel als team**, zoals `team`, `owner` of `squad`: het team dat eigenaar is van de resource.
- **Een sleutel als omgeving**, zoals `env`, `environment` of `stage`: de App Platforms-omgeving van een app die als de resource draait, of voor een VM de deploymentomgeving die haar host meldt.
- **Elke sleutel**: de waarde die de meeste resources ernaast dragen, in dezelfde CloudFormation-stack, dezelfde Azure-resourcegroep of met dezelfde naam voor hun nummer, zoals `web-1` en `web-2`. Minstens twee moeten het eens zijn.
- **Een tag die één waarde toestaat**: die waarde.

De opdracht zet de tag in één stap, vanuit de eigen shell van je cloud: `aws resourcegroupstaggingapi tag-resources` op AWS, `az tag update --operation Merge` op Azure, en `gcloud ... add-labels` of `--update-labels` voor Compute Engine-VM's en -schijven, Cloud Storage-buckets en Cloud SQL-instances op Google Cloud.

## Wat je in OneUptime ziet

- **Het overzicht van Cloud.** **Cloud → Overzicht** toont de uitgaven van de maand tegenover die van vorige maand op dezelfde dag, de duurste diensten en de grootste manieren om minder uit te geven, naast wat aandacht nodig heeft.
- **De uitgaven van elke dag.** **Cloud → Uitgaven → Kosten** tekent elk van de laatste 30 dagen en markeert de dagen die veel meer kostten dan gewoonlijk, toont die dagen en splitst een periode uit per dienst, regio, account, resource, omgeving van de app-platforms, app of tag. De accounts waarvan de kosten niet worden gelezen, staan eronder, elk met de reden.
- **De kosten van een account.** De pagina **Kosten** van een account toont hetzelfde voor alleen dat account, met de toezeggingen en de manieren om minder uit te geven.
- **Verplichte tags.** **Cloud → Uitgaven → Tags** toont hoeveel van de uitgaven en van de resources je verplichte tags dragen, en de **Tags** van een account tonen hetzelfde voor alleen dat account.
- **De kosten van een resource.** De pagina van een resource toont wat die deze maand en in de laatste 30 dagen heeft gekost als de cloud haar op naam factureert, met de manieren om minder uit te geven en haar groottebepaling.
- **Wat er is bespaard.** **Cloud → Uitgaven → Besparingen** opent met wat de doorgevoerde wijzigingen deze maand volgens de rekening hebben bespaard, de wijzigingen die op goedkeuring wachten en de doorgevoerde, en de uren dat schema's resources hebben gestopt.

## Problemen oplossen

:::details Een account toont Toestemming nodig
De koppeling mag de kosten van het account nog niet lezen. Voer haar installatieopdracht opnieuw uit vanuit **Cloud → Koppelen**: die voegt toe wat het lezen van kosten nodig heeft. Geef op Google Cloud het serviceaccount ook **BigQuery Data Viewer** op de dataset van de export.
:::

:::details Een account toont Niet ingesteld
De cloud heeft nog geen kosten te geven. Zet op AWS Cost Explorer aan; geef op Google Cloud de tabel van de export op onder **Tabel van de factuurexport**. De eerste bedragen komen met de volgende leesbeurt, binnen 12 uur.
:::

:::details Een account toont In de wachtrij
De kosten wachten op hun beurt: Azure Cost Management beperkt hoe snel de kosten van een tenant worden gelezen. Het account toont wanneer ze worden gelezen, bij de eerste leesbeurt van de koppeling vanaf dan, en er hoeft niets te gebeuren. Een account dat al bedragen heeft, houdt die intussen.
:::

:::details Kosten per resource toont Niet ingesteld
Gegevens op resourceniveau staan niet aan voor het account. Zet ze aan met dagelijkse granulariteit in de voorkeuren van Cost Management in de console AWS Billing and Cost Management, voor de leden van een organisatie vanuit haar beheeraccount. AWS bereidt ze binnen 48 uur voor, en de leesbeurt van de volgende dag neemt ze mee.
:::

:::details De toezeggingen tonen Toestemming nodig
De koppeling mag de Savings Plans en reserveringen van het account nog niet lezen. Voer haar instelopdracht opnieuw uit via **Cloud → Koppelen**: die voegt de vier acties toe waarmee ze worden gelezen.
:::

:::details De bedragen laten een account weg
De bedragen staan in de valuta waarin de meeste van je accounts worden gefactureerd. Een account dat in een andere wordt gefactureerd, staat eronder met zijn valuta, en een budget telt alleen de accounts die in de eigen valuta worden gefactureerd.
:::

:::details Een besparing heeft geen Toepassen
OneUptime voert alleen wijzigingen van één stap door: een toezegging, of een aanbeveling die meer dan één ding wijzigt, voer je door in de console van je cloud. Toepassen opent een dialoogvenster dat zegt waarom het hier niet kan als de verbinding van het account het niet toestaat: zet de **Besparingsacties** ervan aan en voer het installatiecommando opnieuw uit.
:::

:::details Een schema laat een resource draaien
**Resources bekijken** zegt waarom: ze is productie, niets zegt dat ze geen productie is, of de verbinding van haar account staat geen besparingsacties toe. Tag haar, bijvoorbeeld `environment` = `dev`, of markeer haar account als **Niet-productie**.
:::

:::details Deze maand is lager dan in de console van je cloud
Je cloud meldt de laatste dag of twee te laat, en de bedragen zijn vóór tegoeden en terugbetalingen. De volgende leesbeurten halen het in.
:::

## Volgende stappen

:::cards
- [Toewijzing van cloudkosten](/docs/telemetry/cloud-cost-allocation): Verdeel de uitgaven over teams, producten en kostenplaatsen.
- [Een cloudaccount koppelen](/docs/telemetry/cloud-accounts): Koppel een ander account, of voer de opdracht ervan opnieuw uit.
- [Cloud-resources](/docs/telemetry/cloud-resources): De metrieken van elke resource, uit een eigen collector.
- [Kubernetes-kostenobservability](/docs/telemetry/kubernetes-cost): Wat elke Kubernetes-workload kost.
:::
