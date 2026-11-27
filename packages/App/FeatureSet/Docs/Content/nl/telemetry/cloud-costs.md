# Cloudkosten en besparingen

Een gekoppeld cloudaccount zegt ook wat het kost en hoe het minder zou kunnen kosten. OneUptime leest de kosten van elke dag uit de eigen facturering van je cloud en de aanbevelingen van de eigen aanbevelingsdienst van je cloud, toont ze onder **Cloud → Uitgaven → Kosten** en **Cloud → Uitgaven → Besparingen**, toont je Savings Plans, reserveringen en kortingen voor toegezegd gebruik onder **Cloud → Uitgaven → Toezeggingen**, en waarschuwt voordat een maand meer kost dan het budget onder **Cloud → Uitgaven → Budgetten**. Als je het toestaat, voert het ook de besparingen door die een eigenaar goedkeurt, stopt het niet-productieresources buiten werktijd en controleert het elke wijziging aan de hand van de rekening.

:::cards
- [Amazon Web Services](#amazon-web-services): Cost Explorer en Cost Optimization Hub, elk één keer aangezet.
- [Microsoft Azure](#microsoft-azure): Cost Management en Azure Advisor, met één rol extra.
- [Google Cloud](#google-cloud): Je factuurexport naar BigQuery, en de Recommender.
- [Gefactureerd, geamortiseerd en netto](#gefactureerd-geamortiseerd-en-netto): Elke kostenpost op drie manieren, zodat toezeggingen en tegoeden terechtkomen waar het geld naartoe ging.
- [Toezeggingen en verlengingen](#toezeggingen-en-verlengingen): Elke toezegging, waarschuwingen voordat er een eindigt of terwijl er een te weinig wordt gebruikt, en wat te verlengen of te kopen.
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

- **De kosten komen uit de eigen facturering van je cloud.** AWS Cost Explorer, Azure Cost Management en de factuurexport van Google Cloud naar BigQuery, in de valuta waarin het account wordt gefactureerd, elk bewaard als gefactureerd, geamortiseerd en netto: zie [Gefactureerd, geamortiseerd en netto](#gefactureerd-geamortiseerd-en-netto). Elk bedrag is dat van één dag, in UTC-dagen, zoals je cloud ze factureert.
- **Een cloud meldt de laatste dag of twee te laat.** Elke leesbeurt leest de laatste week opnieuw, en in de eerste dagen van een maand de hele vorige maand, zodat de kosten van een dag vast komen te staan terwijl je cloud die afrondt. De eerste leesbeurt van een koppeling gaat terug tot het begin van de voorvorige maand.
- **De prognose van de maand volgt het tempo van de laatste week.** Het is wat de maand tot nu toe heeft gekost, met elke resterende dag tegen het gemiddelde van de laatste zeven volledige dagen.
- **De besparingen komen uit de eigen aanbevelingsdienst van je cloud.** AWS Cost Optimization Hub, Azure Advisor en de Recommender van Google Cloud: een kleiner formaat, een resource die stilstaat, een toezegging die loont, elk met wat ze per maand zou besparen. Een aanbeveling die je in de console van je cloud uitvoert of afwijst, verdwijnt bij de volgende leesbeurt.

## Voordat je begint

- **Een gekoppeld account.** [Een cloudaccount koppelen](/docs/telemetry/cloud-accounts) met de huidige installatieopdracht: die laat de koppeling kosten en aanbevelingen lezen. Een eerder gemaakte koppeling leest geen van beide tot je haar opdracht opnieuw uitvoert.

## Amazon Web Services

De koppeling leest kosten met `ce:GetCostAndUsage`, haar toezeggingen met `ce:GetSavingsPlansCoverage`, `ce:GetSavingsPlansUtilization`, `ce:GetSavingsPlansUtilizationDetails`, `ce:GetReservationCoverage` en `ce:GetReservationUtilization`, de gekochte Savings Plans met `savingsplans:DescribeSavingsPlans`, en aanbevelingen met `cost-optimization-hub:ListRecommendations` en `cost-optimization-hub:GetRecommendation`. De instelopdracht kent de leesacties van Cost Explorer toe als drie families, `ce:GetCostAndUsage*`, `ce:GetSavingsPlans*` en `ce:GetReservation*`, allemaal leesacties, zodat de gebruiker van een toegangssleutel nog binnen de 2.048 tekens past die IAM zijn beleid toestaat. Cost Explorer en Cost Optimization Hub moeten eerst in het account worden aangezet:

:::steps
### Cost Explorer aanzetten

Open Cost Explorer één keer in de AWS-console Billing and Cost Management: AWS bereidt de kosten van het account binnen een dag voor. Koppel het beheeraccount van de organisatie om de kosten van elk lidaccount te lezen.

### Cost Optimization Hub inschakelen

Open Cost Optimization Hub in dezelfde console en schakel hem in, voor de organisatie vanuit het beheeraccount of alleen voor het account. De aanbevelingen komen binnen een dag.
:::

Cost Explorer rekent $0.01 per verzoek: een leesbeurt van de kosten doet er twee of een paar meer, een voor gefactureerd en geamortiseerd en een voor netto, en de toezeggingen worden met vier per dag gelezen voor hun dekking en gebruik, en met zes tot twaalf meer per dag voor die van elke toezegging zelf. De Savings Plans API en Cost Optimization Hub zijn gratis.

### Kosten per resource

Cost Explorer zegt ook wat elke resource kost, over de laatste 14 dagen, zodra gegevens op resourceniveau aan staan. Open in de console AWS Billing and Cost Management de voorkeuren van Cost Management en zet gegevens op resourceniveau aan met dagelijkse granulariteit, voor de organisatie vanuit haar beheeraccount. AWS bereidt ze binnen 48 uur voor.

Bewerk daarna de koppeling onder **Cloud → Koppelen** en zet onder **Meer velden** **Kosten per resource** aan. De koppeling leest ze één keer per dag met `ce:GetCostAndUsageWithResources`: de eerste keer de 14 dagen, daarna de laatste drie opnieuw, met elke keer een paar verzoeken. Wat ze leest, blijft bij de kosten van het account nadat Cost Explorer het vergeten is. Een eerder gemaakte koppeling moet haar instelopdracht opnieuw uitvoeren, die de actie toevoegt.

## Microsoft Azure

De app leest kosten met de rol **Cost Management Reader**, op hetzelfde bereik als **Monitoring Reader**: de installatieopdracht kent beide toe. De aanbevelingen van Azure Advisor worden gelezen met **Monitoring Reader**, dus er valt niets aan te zetten. Om een eerder gemaakte app de rol te geven, voer je uit:

```bash
az role assignment create --assignee <APP_ID> --role "Cost Management Reader" --scope /subscriptions/<SUBSCRIPTION_ID>
```

Cost Management antwoordt per abonnement, met de resource waarvoor elke kostenpost is, en lezen kost niets. Als het voor een abonnement niet kan antwoorden, zegt de pagina **Kosten** van het account waarom.

Cost Management beperkt hoe snel de kosten van een tenant worden gelezen, voor iedereen die ze leest even snel: elke query kost een queryverwerkingseenheid (QPU) per maand aan gegevens die hij leest, en een tenant heeft 12 QPU per 10 seconden, 60 per minuut en 600 per uur. OneUptime leest de abonnementen van een tenant na elkaar binnen twee derde van elk quotum, wacht zo lang als Cost Management vraagt wanneer het een query weigert, en gaat bij de volgende leesbeurt verder waar het stopte. Een abonnement dat nog niet is gelezen toont **In de wachtrij**, met wanneer het wordt gelezen; een abonnement met bedragen houdt die intussen. De geamortiseerde kosten worden bij elke leesbeurt gelezen en de werkelijke kosten één keer per dag, dus de eerste leesbeurt van een abonnement vraagt Cost Management twee keer en kost twee keer zoveel queryeenheden: de eerste bedragen van een grote tenant duren een paar leesbeurten langer.

De reserveringen en besparingsplannen van de tenant worden gelezen met **Reservations Reader** en **Savings plan Reader**, die Azure op het eigen bereik van de tenant geeft, waar alleen een globale beheerder met verhoogde toegang ze mag toekennen. De instelopdracht probeert het, en zegt het als dat niet mag. Om ze later toe te kennen, als globale beheerder met verhoogde toegang:

```bash
az role assignment create --assignee <APP_ID> --role "Reservations Reader" --scope /providers/Microsoft.Capacity
az role assignment create --assignee <APP_ID> --role "Savings plan Reader" --scope /providers/Microsoft.BillingBenefits
```

Zonder deze rollen worden kosten en aanbevelingen gelezen zoals voorheen, en **Cloud → Uitgaven → Toezeggingen** zegt welke rol je moet toekennen.

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

De gedetailleerde export noemt de resource waarvoor elke kostenpost is; de standaardexport noemt alleen de dienst en de regio. BigQuery factureert de query: de eerste 1 TiB per maand is gratis, daarna $6.25 per TiB, en een maand van een export is een paar megabyte tot een paar gigabyte. De aanbevelingen van de Recommender voor machinetypen en ongebruikte resources worden gelezen met **Compute Recommender Viewer**, die de installatieopdracht toekent, en kosten niets. De toezeggingen van Compute Engine worden uit Cloud Asset Inventory getoond met **Cloud Asset Viewer**, die de installatieopdracht al toekent: er hoeft niets meer bij.

## Gefactureerd, geamortiseerd en netto

Elke kostenpost wordt op drie manieren bewaard, en **Cloud → Uitgaven → Kosten**, de **Kosten** van een account, het overzicht van Cloud en budgetten tonen de manier die je kiest:

- **Gefactureerd** is elke kostenpost op de dag dat je cloud die factureerde, vóór tegoeden en terugbetalingen. Een vooraf betaald Savings Plan of een vooraf betaalde reservering is één grote kostenpost op de dag van aankoop, en het gebruik dat ze dekt lijkt de rest van de looptijd gratis.
- **Geamortiseerd** spreidt de kosten van elke toezegging over de dagen en resources die ze dekt, zodat het geld terechtkomt waar het werd uitgegeven. Nog steeds vóór tegoeden en terugbetalingen. Dit tonen de pagina's, tenzij je iets anders kiest.
- **Netto** is geamortiseerd, min tegoeden, terugbetalingen en kortingen: waar de factuur op uitkomt.

| | Gefactureerd | Geamortiseerd | Netto |
|---|---|---|---|
| AWS | De niet-gemengde kosten (unblended) van Cost Explorer | De geamortiseerde kosten van Cost Explorer | De netto geamortiseerde kosten van Cost Explorer, met tegoeden en terugbetalingen |
| Azure | De werkelijke kosten van Cost Management | De geamortiseerde kosten van Cost Management | De geamortiseerde kosten: Azure trekt tegoeden af bij het factureringsaccount, dat de koppeling van een abonnement niet leest |
| Google Cloud | De kosten van de export | De kosten min de tegoeden van de kortingen voor toegezegd gebruik en van abonnementen | De kosten min elk tegoed |

De schakelaar boven de bedragen wijzigt de basis op de pagina, en OneUptime onthoudt je keuze voor dit project in je browser. De eigen basis van het project, waarmee de pagina's openen en die budgetten bewaken, staat onder **Cloud → Instellingen → Kosteninstellingen**. Een budget kan een eigen basis bewaken: bewerk het en stel **Kostenbasis** in.

Kosten die zijn gelezen voordat de drie werden bewaard, tonen op elke basis hun gefactureerde bedrag. Elke koppeling leest haar kosten één keer opnieuw, zo ver terug als een eerste leesbeurt, zodat elke basis wordt aangevuld.

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

Een account zonder toezegging toont wat tegen on-demandtarieven draaide en wat een toezegging goedkoper zou betalen. De cijfers van elke soort zijn die van zijn cloud, en soorten worden nooit opgeteld: een reservering en een Savings Plan kunnen allebei de uitgaven van dezelfde machine als de hunne tellen. Elke toezegging afzonderlijk staat onder **Cloud → Uitgaven → Toezeggingen**: zie [Toezeggingen en verlengingen](#toezeggingen-en-verlengingen).

## Toezeggingen en verlengingen

**Cloud → Uitgaven → Toezeggingen** toont elk Savings Plan, elke reservering en elke korting voor toegezegd gebruik die je koppelingen kunnen lezen, zodat er geen ongemerkt eindigt:

- **Actieve toezeggingen**, erboven, telt de actieve en de toezeggingen die binnen 90 dagen eindigen, **Gebruik** hoeveel ervan de afgelopen 30 dagen werd gebruikt en wat ongebruikt bleef, en **Dekking** hoeveel van de uitgaven ze dekken.
- **Eindigen binnenkort** toont de toezeggingen die binnen 90 dagen eindigen en zich niet zelf verlengen, elk met het verlengingsplan: wat je moet kopen om de korting te houden (de toezegging per uur of de instances, naar het deel dat werd gebruikt), wat dat per maand kost en bespaart, wanneer het zich terugverdient, en hoeveel van de uitgaven nu en na het einde is gedekt. **Verlengen in de console** opent de pagina waarop je cloud haar verlengt.
- **Alle toezeggingen** is de hele lijst: wat elke toezegging is en dekt, haar account, wanneer ze eindigt, haar looptijd en betaaloptie, hoeveel ervan de afgelopen 30 dagen werd gebruikt, en het gebruik dat ze betaalde en wat dat bespaarde.
- **Aankoopplannen** zijn wat de aanbevelingsdienst van je cloud voorstelt om te kopen, elk met wat het per maand zou kosten en besparen, wanneer het zich zou terugverdienen, en hoe de dekking zou veranderen. **Kopen in console** opent de pagina om het te kopen.
- Daaronder de toezeggingen van elk account per soort, zoals de **Kosten** ervan ze tonen, en wanneer de toezeggingen waarschuwen, met **Waarschuwingen wijzigen**.

OneUptime plant alleen: het koopt, verlengt of retourneert nooit een toezegging. Je koopt in de console van je cloud.

| | Waar de toezeggingen vandaan komen | Wat er van elke bekend is |
|---|---|---|
| AWS | De Savings Plans en Reserved Instances van Cost Explorer, elk met eigen gebruik, en de Savings Plans API voor de gekochte plannen, ook die in de wachtrij om te starten | Het einde, de looptijd, de betaaloptie, de toezegging per uur of de instances, de kosten, en het gebruik in de afgelopen 30 en 7 dagen |
| Azure | De reserveringen en besparingsplannen van de tenant | Het einde, de looptijd, het factureringsplan, of ze zich zelf verlengt, en het gebruik in de afgelopen 30 en 7 dagen |
| Google Cloud | De toezeggingen van Compute Engine, uit Cloud Asset Inventory | Het einde, het plan, de resources en of ze zich zelf verlengt. Google Cloud zegt niet hoeveel van een toezegging wordt gebruikt |

Het beheeraccount van een organisatie toont op AWS die van elk account. Kortingen voor toegezegd gebruik op basis van uitgaven, die Google Cloud op het factureringsaccount bewaart in plaats van in een project, worden nog niet getoond.

### Toezeggingswaarschuwingen

Toezeggingen maken waarschuwingen, die via bereikbaarheidsbeleid worden opgeroepen zoals elke waarschuwing. Onder **Cloud → Instellingen → Kosteninstellingen** zegt **Toezeggingswaarschuwingen** wanneer:

- **Waarschuwen voor het einde van een toezegging**: om te beginnen 90, 30 en 7 dagen voor het einde. Eén waarschuwing op de dichtstbijzijnde van die dagen die de toezegging heeft bereikt, waarbij elke nadere de vorige overneemt. Een toezegging die zich zelf verlengt, of waarvan de verlenging in de wachtrij staat om bij het einde te starten, maakt er geen.
- **Waarschuwen bij gebruik onder**: om te beginnen 80%, over de laatste 7 dagen van een toezegging, zodra ze een week heeft gelopen. De waarschuwing wordt opgelost wanneer het gebruik terug is.
- **Waarschuwen bij dekking onder**: om te beginnen 60%, van de uitgaven die de toezeggingen van één soort van een account zouden kunnen dekken, nadat ze meer dekten. Ze wordt opgelost wanneer de dekking terug is. Leeg maakt dekking geen waarschuwing.

**Waarschuwen voor toezeggingen** zet ze allemaal uit, en **Ernst van waarschuwing**, **Bereikbaarheidsbeleid** en **Eigenaren** bepalen hoe ernstig ze zijn, wie wordt opgeroepen en van wie ze zijn. Elke waarschuwing zegt wat de toezegging dekt en wat ze betaalde, en wijst naar het verlengingsplan. Een waarschuwing wordt vanzelf opgelost wanneer de toezegging eindigt, zich verlengt of niet meer wordt getoond.

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

Maak onder **Cloud → Uitgaven → Budgetten** een budget: het **Maandbedrag**, het **Account** waarvoor het geldt, of geen voor alle accounts, en de **Kostenbasis** die het telt, of geen voor die van het project.

### Kiezen wanneer het waarschuwt

**Waarschuwen bij** neemt de delen van het budget waarbij gewaarschuwd wordt, in procenten: om te beginnen 80 en 100. **Waarschuwen bij dreigende overschrijding** waarschuwt ook, één keer per maand, als het tempo van de laatste week de maand boven het budget zou brengen. **Waarschuwen bij ongewone dagen** waarschuwt ook op de dag na een dag die veel meer kostte dan gewoonlijk: zie [Ongewone dagen](#ongewone-dagen). **Ernst van waarschuwing** en **Bereikbaarheidsbeleid** bepalen hoe ernstig de waarschuwingen zijn en wie er wordt opgeroepen.
:::

Een budget wordt gecontroleerd na elke leesbeurt van de kosten en elk uur. Zodra de uitgaven van de maand een drempel passeren, wordt er een waarschuwing voor gemaakt, voor de hoogste als een leesbeurt er meerdere tegelijk passeert, en een nieuwe maand lost de waarschuwingen van de vorige op. Een budget telt alleen de accounts die in zijn valuta worden gefactureerd, op zijn basis: een geamortiseerd budget gaat niet af door een vooraf gekochte toezegging, die een gefactureerd budget op de dag van aankoop telt.

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

## Rapporten en exports

### Kostenrapporten

**Cloud → Uitgaven → Rapporten** stuurt volgens een schema wat de clouds kosten, per e-mail en naar Slack- of Microsoft Teams-kanalen, zodat wie de cijfers nodig heeft ze krijgt zonder OneUptime te openen. Een rapport heeft:

- **Dekt**: alle accounts, één account, een kostengroep of een kostenweergave met al haar groepen.
- **Periode**: vorige week (maandag tot zondag), vorige maand of de maand tot nu toe. Elke periode wordt vergeleken met de periode ervoor: de week ervoor, de maand ervoor of vorige maand tot dezelfde dag.
- **Kostenbasis**: gefactureerd, geamortiseerd of netto. Leeg is het die van het project, waarmee Kosten opent. Het rapport zegt altijd op welke basis het staat.
- **Schema**: elke week of elke maand, op een dag en tijd in een tijdzone, volgens dezelfde regels als de samenvattingen in Slack en Microsoft Teams. Een nieuw wekelijks rapport gaat volgende maandag om 09:00 in uw tijdzone uit, een maandelijks op de 1e, en latere rapporten houden die dag en tijd het hele jaar.

De e-mail zegt wat de periode kostte tegenover de periode ervoor, de budgetten waarop ze telt (elke maand tot nu toe, op de eigen basis van het budget), de services die het sterkst stegen en daalden, de groepen van een kostenweergave en wat geen groep opneemt, de ongewone dagen, de grootste openstaande besparingen en hoeveel van de uitgaven toezeggingen dekken. De cijfers zijn als CSV bijgevoegd. **Kosten openen** opent **Kosten** op precies de dagen, de basis en de weergave van het rapport, zodat de cijfers van het rapport en die van de pagina dezelfde zijn. Accounts die in een andere valuta worden gefactureerd, blijven buiten de cijfers, en het rapport noemt ze.

Een Slack- of Microsoft Teams-kanaal krijgt een kort bericht: het totaal en de verandering, het budget, de eerste regels van de lijsten van het rapport en **Kosten openen**.

### Wie een rapport krijgt

- Mensen en teams van het project krijgen het per e-mail, via hun meldingsinstellingen, waar ieder cloudkostenrapporten kan uitzetten. Ieder krijgt de cijfers die hij mag lezen: wie alleen via labels toegang heeft, krijgt alleen zijn accounts, en wie de cloudkosten van het project niet meer mag lezen, wordt weggelaten.
- **E-mailadressen** buiten het project, zoals dat van uw accountant, en Slack- en Microsoft Teams-kanalen vereisen de machtiging Cloudbeheerder, of Projectbeheerder of Projecteigenaar, omdat OneUptime niet kan weten wie ze leest. Ze krijgen het rapport zoals de persoon die ze toevoegde het mag lezen, en krijgen het niet meer als die persoon de machtiging verliest. Een API-sleutel kan ze niet instellen.
- Wie de andere Cloud-records mag maken, vanaf Cloudlid, kan rapporten maken, wijzigen en verwijderen. Een Cloudkijker kan ze lezen.

Een rapport gaat naar hoogstens 200 mensen, 25 adressen en 10 kanalen van elk soort. **Laatste verzending** zegt wanneer het voor het laatst uitging, en wie het wegliet en waarom.

### Een deel voor elk team

Een rapport van een kostenweergave kan elke groep haar eigen deel sturen met **Het team van elke groep zijn deel sturen**. De leden van het team van elke groep, dat op de groep staat, krijgen de uitgaven van hun groep tegenover de periode ervoor, de services daarin die het sterkst stegen en daalden, en haar ongewone dagen. Een gedeelde groep heeft geen eigen deel: haar kosten zitten in de groepen waarover ze wordt verdeeld. De eigen mensen, teams en adressen van het rapport krijgen alle groepen. Wie in de teams van twee groepen zit, krijgt beide delen. Eén maandelijks rapport van een kostenweergave op deze manier is de showback van de maand.

### Voorbeeld en Stuur mij een kopie

**Voorbeeld** toont wat een rapport nu zegt, zoals u het mag lezen en zoals de e-mail het weergeeft, en wie de laatste verzending wegliet en waarom. **Stuur mij een kopie** mailt het u nu.

### CSV downloaden

**CSV downloaden** bewaart wat een kaart toont: **Waar het geld naartoe gaat** op **Kosten**, in elke uitsplitsing en tegenover de periode ervoor, de uitgaven per dag, de aanbevelingen van **Besparingen** en de pagina van een kostengroep. De bestandsnaam zegt wat erin staat, waarnaar het is uitgesplitst, de weergave en het account, de kostenbasis en de dagen, zoals `cloud-costs-by-service-amortized-2026-11-01-to-2026-11-30.csv`. Cijfers zijn gewone getallen, en een tekst die een spreadsheet als formule zou lezen, begint met een apostrof.

### FOCUS

**FOCUS exporteren** op **Kosten** downloadt alle kosten van de periode als een FOCUS 1.2-bestand, de FinOps Open Cost and Usage Specification in versie 1.2, die financiële tools lezen. Eén bestand bevat hoogstens 93 dagen, en elke valuta waarin de accounts worden gefactureerd, elke regel in die van zichzelf.

Het bestand heeft elke kolom die FOCUS 1.2 verplicht stelt, en de voorwaardelijke waarvoor OneUptime de gegevens heeft: `RegionId`, `RegionName`, `ResourceId`, `ResourceName`, `SubAccountId`, `SubAccountName` en `Tags`. Het heeft een regel voor elke kostenpost die OneUptime bijhoudt: een dag, een account, een service, een regio en, waar de cloud die noemt, een resource.

- `BilledCost` is wat de cloud factureerde, en `EffectiveCost` wat het kostte met toezeggingen verdeeld over wat ze dekken.
- Wat de cloud aftrok, zijn tegoeden, terugbetalingen en kortingen, is een eigen regel, met een `ChargeCategory` van `Credit`. De `EffectiveCost` van het bestand, opgeteld, is de nettokost.
- `ChargeCategory` is `Tax` voor de kosten die AWS onder zijn Tax-service factureert, en `Usage` voor de rest.
- `BillingAccountId` is het account waaruit de verbinding de factuur leest: het beheeraccount van een AWS-organisatie, een Google Cloud-factureringsaccount of het Azure-abonnement, omdat het Azure-factureringsaccount niet wordt gelezen. `SubAccountId` is het AWS-account, het Azure-abonnement of het Google Cloud-project.
- Datums zijn hele UTC-dagen, waarbij het einde van de kostenperiode en van de factureringsperiode niet is inbegrepen. De factureringsperiode is de kalendermaand.

Wat FOCUS 1.2 vraagt maar OneUptime niet leest, blijft leeg of wordt gelijkgesteld zoals de specificatie toestaat. `PricingQuantity` en `PricingUnit` zijn leeg, omdat de kosten worden gelezen per dag, service, regio en resource, niet per gebruikstype. `ListCost` en `ContractedCost` zijn gelijk aan `BilledCost`, zoals FOCUS vraagt als eenheidsprijzen niet bekend zijn. Een aankoop, zoals de vooruitbetaling van een reservering, is het gebruik van de service waarvoor ze is gekocht. Er zijn geen kolommen voor SKU's, toezeggingskortingen, capaciteitsreserveringen of facturen. FOCUS 1.3 en 1.4 voegen kolommen toe waar een lezer van 1.2 zonder kan.

### Vanuit de API en de CLI

De API geeft een uitsplitsing, niet alleen de regels van de kosten, zodat een financieel systeem de doorbelasting van de maand kan ophalen:

- `POST /api/cloud-cost/breakdown` met `by` (`service`, `region`, `account`, `resource`, `environment`, `app`, `tag` met een `tagKey`, of `group` met een `cloudCostViewId`), een `period` (`this-month`, `last-month`, `last-week`, `last-30-days`) of een `startDate` en een `endDate`, en eventueel `cloudAccountIds`, `currency`, `basis` en `compareWithPrevious`. Het antwoord is het totaal van de periode en elk aandeel, met de periode ervoor ernaast, of met `"format": "csv"` de CSV die **CSV downloaden** geeft.
- `POST /api/cloud-cost/export` met een `period`, of een `startDate` en een `endDate`, geeft het FOCUS-bestand.

Beide lezen zoals de sleutel de kosten mag lezen. Vanuit de [CLI](/docs/cli/command-reference):

```bash
oneuptime cloud-cost breakdown --by group --view <view-id> --period last-month
oneuptime cloud-cost export --period last-month --file focus.csv
```

### Op een dashboard

De widget **Cloudkosten** zet een totaal, een uitsplitsing of een trend van de uitgaven naast de services die ze maken. Zie [Dashboardwidgets](/docs/dashboards/widgets#kosten-van-de-cloud).

## Wat je in OneUptime ziet

- **Het overzicht van Cloud.** **Cloud → Overzicht** toont de uitgaven van de maand tegenover die van vorige maand op dezelfde dag, de duurste diensten en de grootste manieren om minder uit te geven, naast wat aandacht nodig heeft.
- **De uitgaven van elke dag.** **Cloud → Uitgaven → Kosten** tekent elk van de laatste 30 dagen en markeert de dagen die veel meer kostten dan gewoonlijk, toont die dagen en splitst een periode uit per dienst, regio, account, resource, omgeving van de app-platforms, app of tag, gefactureerd, geamortiseerd of netto. De accounts waarvan de kosten niet worden gelezen, staan eronder, elk met de reden.
- **Elke toezegging.** **Cloud → Uitgaven → Toezeggingen** toont elke toezegging met wanneer ze eindigt en hoeveel ervan wordt gebruikt, de binnenkort eindigende met wat te verlengen, en wat te kopen.
- **Rapporten.** **Cloud → Uitgaven → Rapporten** toont elk gepland rapport met wat het dekt, wanneer het de volgende keer uitgaat en hoe de laatste verzending ging.
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
De koppeling mag de Savings Plans en reserveringen van het account nog niet lezen. Voer haar instelopdracht opnieuw uit via **Cloud → Koppelen**: die voegt de acties toe waarmee ze worden gelezen. Op Azure kent een globale beheerder met verhoogde toegang **Reservations Reader** en **Savings plan Reader** toe: zie [Microsoft Azure](#microsoft-azure).
:::

:::details Geamortiseerd en netto tonen hetzelfde als gefactureerd
Kosten die zijn gelezen voordat de drie werden bewaard, tonen op elke basis hun gefactureerde bedrag tot de volgende leesbeurt van de kosten van de koppeling, die ze opnieuw leest zo ver terug als haar eerste. Op Azure is netto altijd de geamortiseerde kosten.
:::

:::details Een toezegging eindigt en er kwam geen waarschuwing
Een toezegging die zich zelf verlengt, of waarvan de verlenging in de wachtrij staat om bij het einde te starten, maakt er geen, en evenmin een in een project waarvan de toezeggingswaarschuwingen uit staan onder **Cloud → Instellingen → Kosteninstellingen**. Een waarschuwing heeft ook een ernst van waarschuwing in het project nodig.
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
Je cloud meldt de laatste dag of twee te laat, en gefactureerde en geamortiseerde bedragen zijn vóór tegoeden en terugbetalingen. De volgende leesbeurten halen het in. Vergelijk met de basis die de console van je cloud toont: AWS opent met niet-gemengde kosten, en dat is gefactureerd.
:::

## Volgende stappen

:::cards
- [Toewijzing van cloudkosten](/docs/telemetry/cloud-cost-allocation): Verdeel de uitgaven over teams, producten en kostenplaatsen.
- [Een cloudaccount koppelen](/docs/telemetry/cloud-accounts): Koppel een ander account, of voer de opdracht ervan opnieuw uit.
- [Cloud-resources](/docs/telemetry/cloud-resources): De metrieken van elke resource, uit een eigen collector.
- [Kubernetes-kostenobservability](/docs/telemetry/kubernetes-cost): Wat elke Kubernetes-workload kost.
:::
