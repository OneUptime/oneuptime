# Cloudkosten en besparingen

Een gekoppeld cloudaccount zegt ook wat het kost en hoe het minder zou kunnen kosten. OneUptime leest de kosten van elke dag uit de eigen facturering van je cloud en de aanbevelingen van de eigen aanbevelingsdienst van je cloud, toont ze onder **Cloud → Uitgaven → Kosten** en **Cloud → Uitgaven → Besparingen**, en waarschuwt voordat een maand meer kost dan het budget onder **Cloud → Uitgaven → Budgetten**.

:::cards
- [Amazon Web Services](#amazon-web-services): Cost Explorer en Cost Optimization Hub, elk één keer aangezet.
- [Microsoft Azure](#microsoft-azure): Cost Management en Azure Advisor, met één rol extra.
- [Google Cloud](#google-cloud): Je factuurexport naar BigQuery, en de Recommender.
- [Budgetten](#budgetten): Een waarschuwing zodra de uitgaven van een maand een deel van het budget passeren.
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

De koppeling leest kosten met `ce:GetCostAndUsage` en aanbevelingen met `cost-optimization-hub:ListRecommendations`. Voor elk moet eerst iets in het account worden aangezet:

:::steps
### Cost Explorer aanzetten

Open Cost Explorer één keer in de AWS-console Billing and Cost Management: AWS bereidt de kosten van het account binnen een dag voor. Koppel het beheeraccount van de organisatie om de kosten van elk lidaccount te lezen.

### Cost Optimization Hub inschakelen

Open Cost Optimization Hub in dezelfde console en schakel hem in, voor de organisatie vanuit het beheeraccount of alleen voor het account. De aanbevelingen komen binnen een dag.
:::

Cost Explorer rekent $0.01 per verzoek, en een leesbeurt van de kosten doet er een paar. Cost Optimization Hub is gratis.

## Microsoft Azure

De app leest kosten met de rol **Cost Management Reader**, op hetzelfde bereik als **Monitoring Reader**: de installatieopdracht kent beide toe. De aanbevelingen van Azure Advisor worden gelezen met **Monitoring Reader**, dus er valt niets aan te zetten. Om een eerder gemaakte app de rol te geven, voer je uit:

```bash
az role assignment create --assignee <APP_ID> --role "Cost Management Reader" --scope /subscriptions/<SUBSCRIPTION_ID>
```

Cost Management antwoordt per abonnement, met de resource waarvoor elke kostenpost is, en lezen kost niets. Als het voor een abonnement niet kan antwoorden, zegt de pagina **Kosten** van het account waarom.

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

**Cloud → Uitgaven → Besparingen** toont elke aanbeveling, de grootste besparing eerst: wat er moet gebeuren, bij welke resource, wat er zou veranderen en wat ze per maand bespaart. De strook erboven telt ze op, in totaal en per soort: een kleiner formaat, een resource die stilstaat, een toezegging. Een aanbeveling linkt naar de pagina van haar resource als OneUptime de resource heeft.

### Groottebepaling op basis van de eigen metingen van OneUptime

Een resource waar geen aanbevelingsdienst iets over zegt, omdat die niet is ingeschakeld, het type niet dekt of de resource te nieuw vindt, krijgt van OneUptime een grootte op basis van de CPU- en geheugenmetingen die de verbinding de afgelopen 14 dagen deed. OneUptime bepaalt de grootte van EC2-instances, RDS-databases en ElastiCache-clusters op AWS, virtuele machines, flexibele PostgreSQL- en MySQL-servers en App Service-plannen op Azure, en Compute Engine-VM's en Cloud SQL-instances op Google Cloud:

- **Overgeprovisioneerd** als het formaat half zo groot, of een kwart, nog ruimte zou hebben: op het kleinere formaat zou het 95e percentiel van de CPU hoogstens 60% zijn, de hoogste CPU-meting hoogstens 100% en de geheugenpiek hoogstens 70%, als het geheugen wordt gelezen.
- **Ondergeprovisioneerd** als het 95e percentiel van de CPU 85% of meer is, of de geheugenpiek 90% of meer: het formaat twee keer zo groot.

Een resource krijgt een grootte zodra er 6 dagen aan metingen zijn. De pagina toont de **Groottebepaling** naast wat de resource kost, en een overgeprovisioneerde staat onder **Cloud → Uitgaven → Besparingen**, met OneUptime als bron. Wat een wijziging bespaart, is haar deel van wat de resource de afgelopen 30 dagen kostte, dus het is bekend zodra je cloud de resource op naam factureert: de gedetailleerde export van Azure en Google Cloud doet dat, AWS Cost Explorer niet. Een EC2-instance meldt haar geheugen alleen met de CloudWatch-agent, en een Compute Engine-VM alleen met de Ops Agent: zonder die agent krijgt ze een grootte op basis van alleen de CPU. Burstable formaten, zoals t3, de B-serie en e2-micro, krijgen nooit een grootte.

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

**Cloud → Uitgaven → Kosten** toont de ongewone dagen onder de dagelijkse uitgaven. Een budget dat het account meetelt, maakt één waarschuwing voor elk account en elke dag, de dag erna, en noemt elke service die hoog uitkwam. Een piek die dagen aanhoudt, wordt gemeld op de dag dat hij begon, en een dag van meer dan een week geleden wordt niet gemeld.

## Wat je in OneUptime ziet

- **Het overzicht van Cloud.** **Cloud → Overzicht** toont de uitgaven van de maand tegenover die van vorige maand op dezelfde dag, de duurste diensten en de grootste manieren om minder uit te geven, naast wat aandacht nodig heeft.
- **De uitgaven van elke dag.** **Cloud → Uitgaven → Kosten** tekent elk van de laatste 30 dagen, toont de dagen die veel meer kostten dan gewoonlijk en splitst een periode uit per dienst, regio, account of resource. De accounts waarvan de kosten niet worden gelezen, staan eronder, elk met de reden.
- **De kosten van een account.** De pagina **Kosten** van een account toont hetzelfde voor alleen dat account, met de manieren om minder uit te geven.
- **De kosten van een resource.** De pagina van een resource toont wat die deze maand en in de laatste 30 dagen heeft gekost als de cloud haar op naam factureert, met de manieren om minder uit te geven en haar groottebepaling.

## Problemen oplossen

:::details Een account toont Toestemming nodig
De koppeling mag de kosten van het account nog niet lezen. Voer haar installatieopdracht opnieuw uit vanuit **Cloud → Koppelen**: die voegt toe wat het lezen van kosten nodig heeft. Geef op Google Cloud het serviceaccount ook **BigQuery Data Viewer** op de dataset van de export.
:::

:::details Een account toont Niet ingesteld
De cloud heeft nog geen kosten te geven. Zet op AWS Cost Explorer aan; geef op Google Cloud de tabel van de export op onder **Tabel van de factuurexport**. De eerste bedragen komen met de volgende leesbeurt, binnen 12 uur.
:::

:::details De bedragen laten een account weg
De bedragen staan in de valuta waarin de meeste van je accounts worden gefactureerd. Een account dat in een andere wordt gefactureerd, staat eronder met zijn valuta, en een budget telt alleen de accounts die in de eigen valuta worden gefactureerd.
:::

:::details Deze maand is lager dan in de console van je cloud
Je cloud meldt de laatste dag of twee te laat, en de bedragen zijn vóór tegoeden en terugbetalingen. De volgende leesbeurten halen het in.
:::

## Volgende stappen

:::cards
- [Een cloudaccount koppelen](/docs/telemetry/cloud-accounts): Koppel een ander account, of voer de opdracht ervan opnieuw uit.
- [Cloud-resources](/docs/telemetry/cloud-resources): De metrieken van elke resource, uit een eigen collector.
- [Kubernetes-kostenobservability](/docs/telemetry/kubernetes-cost): Wat elke Kubernetes-workload kost.
:::
