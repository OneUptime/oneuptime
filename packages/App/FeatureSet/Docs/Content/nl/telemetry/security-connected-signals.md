# Verbonden signalen

Een beveiligingszaak zegt over welke gebruikers, hosts en adressen ze gaat. Verbonden signalen zegt welke daarvan OneUptime al kent - uw hosts, containerhosts, Kubernetes-clusters, netwerkapparaten, cloud-resources, serverless functies, services, de monitoren die ze controleren, en leden - en wat er op elk ervan gebeurde rond de zaak: de logboeken, traces en metrieken, de incidenten en waarschuwingen die erop openstaan, de monitoren die het bewaken en wat er is veranderd. Het doorzoekt ook uw logboeken en traces zelf naar ze: het adres van een aanvaller in het toegangslogboek van een webserver, een gelekt e-mailadres in de fout van een applicatie. Andersom zegt de pagina van een host, een cluster, een cloud-resource, een service, een monitor of een lid wat Security Events erover heeft gevonden.

:::cards
- [Waar u het ziet](#waar-u-het-ziet): De pagina van een zaak, het tabblad van een gebeurtenis, de pagina van een entiteit en de pagina's van wat ze noemen.
- [Hoe een waarde wordt gekoppeld](#hoe-een-waarde-wordt-gekoppeld): Wat telt als hetzelfde record, en wat alleen mogelijk.
- [Wat elk record toont](#wat-elk-record-toont): De signalen rond de zaak, en wat erop openstaat.
- [In uw logboeken en traces](#in-uw-logboeken-en-traces): Waar een adres, een domein of een e-mailadres dat het noemt in uw logregels en spans voorkomt.
- [Wie wat ziet](#wie-wat-ziet): Elk record wordt gelezen met de eigen rol van de lezer.
:::

## Hoe het werkt

```mermaid title="Van een zaak naar wat ze noemt"
flowchart TB
    case["Een zaak, gebeurtenis<br/>of entiteit"] --> values["De gebruikers, hosts<br/>en adressen ervan"]
    values -->|"Exact of<br/>mogelijk"| records["Uw hosts, clusters,<br/>services en leden"]
    records --> signals["Hun logboeken,<br/>traces, metrieken en<br/>wat openstaat"]
    records --> cards["Een kaart Beveiliging<br/>op hun pagina's"]
```

OneUptime zoekt elke waarde op tussen de records van het project, zegt hoe zeker elke overeenkomst is en toont wat er rond de zaak op elk record gebeurde.

## Voordat u begint

- Binnenkomende beveiligingsgebeurtenissen, en hosts, Kubernetes-clusters, cloud-resources, services, monitoren of leden in het project die ze kunnen noemen. Zie [Aan de slag met beveiliging](/docs/telemetry/security-getting-started).
- Een rol die beveiligingsgebeurtenissen mag lezen, en de soorten records die u wilt zien.

## Waar u het ziet

- **Verbonden signalen**, een pagina van elke beveiligingszaak: open een zaak onder **Producten → Beveiligingsgebeurtenissen → Beveiligingszaken → Open zaken** en daarna **Verbonden signalen** na **Entiteiten** in het menu ervan.
- **Verbonden**, een tabblad van elke beveiligingsgebeurtenis: open een gebeurtenis onder **Producten → Beveiligingsgebeurtenissen → Gebeurtenissen**. Het toont wat de gebeurtenis noemt, in het uur eromheen.
- De pagina van een entiteit, onder **Producten → Beveiligingsgebeurtenissen → Entiteitrisico**: waar OneUptime de gebruiker, de host of het adres kent, rond de laatste beveiligingsgebeurtenis.
- Een kaart **Beveiliging** op de pagina van elke host, Docker-host, Podman-host, Kubernetes-cluster, elk netwerkapparaat, elke cloud-resource, elke serverless functie, elke service, elke monitor, elk lid en elk inventarisitem: de open beveiligingszaken die het noemen, hoeveel beveiligingsgebeurtenissen en bevindingen het in de afgelopen 7 dagen noemden, de ernstigste daarvan en het risico. **Openen in Security Events** opent het daar. De kaart van een monitor gaat over de hosts en adressen die hij controleert.
- Een kaart **Beveiliging** op de pagina van een incident, wanneer een beveiligingszaak het incident heeft gemeld (**Gemeld vanuit**) of open zaken een host of cluster noemen die het raakt (**Open zaken die noemen wat het raakt**).

## Hoe een waarde wordt gekoppeld

Elke gebruiker, host en elk adres dat een zaak of een gebeurtenis noemt, wordt opgezocht tussen de records van het project:

| Wat de zaak of gebeurtenis noemt | Gekoppeld aan | Hoe zeker |
| --- | --- | --- |
| Een host- of domeinnaam die gelijk is aan de naam die een host, een containerhost, een cluster of een netwerkapparaat meldt, of een naam waarop een cloud-resource antwoordt | Dat record | Exact |
| Dezelfde naam, gegeven zonder te zeggen dat het een host is | Dat record | Mogelijk |
| Een korte of volledige vorm van de naam van een record, zoals `web-1` en `web-1.acme.internal` | Dat record | Mogelijk |
| Een openbaar IP-adres dat maar één host of netwerkapparaat heeft, of waarop maar één cloud-resource antwoordt | Dat record | Exact |
| Een privé-IP-adres, of een dat meer dan één record heeft | Elk record dat het heeft | Mogelijk |
| De eigen ID van een cloud-resource: een AWS-ARN, een Azure-resource-ID of een Google Cloud-resourcenaam | Die cloud-resource | Exact |
| Een host, een openbaar IP-adres of de host van een URL die een monitor controleert | Die monitor | Exact |
| Een privé-IP-adres dat een monitor controleert | Die monitor | Mogelijk |
| Het e-mailadres van een lid | Dat lid | Exact |
| Het record waaronder een logregel is verzonden, voor de gebeurtenissen gelezen uit uw logboeken | Die host, dat cluster, die cloud-resource, die serverless functie of die service | Exact |
| Een kale gebruikersnaam, een bestandshash of een proces | Niets: geen record wordt erop geïndexeerd | - |

- Een mogelijke overeenkomst toont **Mogelijke overeenkomst** naast de naam en zegt waarom. Ze wordt nooit meegeteld op de pagina van het record, en een incident dat de zaak meldt, wordt er nooit aan gekoppeld.
- Wat is gezocht en geen record van het project is, staat onder **Geen overeenkomend record**. Een waarde staat daar nooit als een soort record dat ze zou kunnen zijn niet kon worden gelezen.
- Voor een zaak worden hoogstens 10 records getoond, de exacte eerst.

## Wat elk record toont

- De signalen, elk geopend op het record en de periode van de zaak: **Logboeken**, **Traces** en **Metrieken**, de **Uitzonderingen** van een service, de **Kubernetes-gebeurtenissen** van een cluster, de **Topologie** van het record en het item in **Inventaris** als de inventaris er een heeft.
- De incidenten en waarschuwingen die er nu openstaan, en de monitoren die het bewaken, elk met een eigen pagina. Een monitor toont zijn status naast zijn naam, en zijn **Logboeken** zijn wat hij bij elke controle zag.
- De bereikbaarheidsschema's van een lid, met **Nu in dienst** naast de schema's waarvoor het lid nu dienst heeft, en de teams waarin het zit.
- Wat er in de periode is veranderd: de deploys van een service, de rollouts van een cluster en de oplossingen van een host.

| Waar | Periode |
| --- | --- |
| Een zaak | Van 30 minuten voor de eerste detectie tot 30 minuten na de laatste, hoogstens de laatste 24 uur ervan |
| Een gebeurtenis | 30 minuten ervoor en erna |
| De pagina van een entiteit | 30 minuten voor en na de laatste beveiligingsgebeurtenis |
| De kaart **Beveiliging** van een record | De afgelopen 7 dagen |

## In uw logboeken en traces

Onder de records doorzoekt Verbonden signalen uw logboeken en traces, over hetzelfde venster, naar de waarden die het noemt en die maar één ding kunnen betekenen: een IP-adres (behalve `127.0.0.1` en de andere die elke machine heeft), een volledige host- of domeinnaam, een e-mailadres, een URL, de ID van een cloud-resource en een bestandshash. Naar een kale hostnaam, de kale naam van een gebruiker en een proces wordt nooit gezocht: een logregel kan ze om elke reden bevatten. Er wordt naar hoogstens 10 waarden gezocht.

| Waar | Het noemt een waarde als |
| --- | --- |
| Het bericht van een logregel | Het bevat de hele waarde, ongeacht hoofdletters: `10.0.0.1` in `from 10.0.0.1:52144`, nooit in `10.0.0.12` of `110.0.0.1` |
| Een attribuut van een logregel of een span | De waarde is precies de waarde: zoals geschreven, in kleine letters of hoofdletters, of een IPv6-adres in de korte vorm |

- Elke gevonden waarde toont hoeveel logregels en spans haar noemen, waar ze erin stond - **In het bericht** of een attribuut met zijn sleutel -, die elk **Logboeken** of **Traces** openen op die regels of spans en het venster, en de records die ze stuurden, de meeste eerst.
- Een resource-attribuut, zoals `resource.host.name`, zegt alleen welk record een regel stuurde, en wordt nooit geteld.
- De waarden waarnaar is gezocht en die geen van beide noemt, staan onder **Niet in uw logboeken of traces**.
- Er wordt gezocht met uw eigen rol: logboeken of traces die uw rol niet kan lezen, worden genoemd en niet doorzocht; die welke zojuist niet konden worden doorzocht, zeggen dat, met **Opnieuw proberen**. Een zoekopdracht die langer dan 15 seconden duurt, wordt gestopt en zegt dat.

## Wie wat ziet

- Verbonden signalen en de kaart **Beveiliging** van een record vereisen een rol die beveiligingsgebeurtenissen mag lezen: Security Admin, Security Member, Security Viewer, Project Owner of Project Admin. Niemand anders ziet op enige pagina beveiligingsgegevens. Zie [Rollen](/docs/permissions/reference#rollen).
- De kaart **Beveiliging** van een incident vereist een rol die beveiligingszaken mag lezen.
- Elk record wordt gelezen met uw eigen rol, en wat erop staat ook: een rol die geen bereikbaarheidsschema's mag lezen, ziet die van een lid niet. Een soort record dat uw rol niet mag lezen, wordt weggelaten en de pagina zegt dat; een soort dat zojuist niet kon worden gelezen, zegt dat ook, met **Opnieuw proberen**.
- De pagina van een record toont de kaart **Beveiliging** alleen in een project dat Security Events gebruikt: een project dat in de afgelopen 7 dagen een beveiligingsgebeurtenis heeft ontvangen.

## Incidenten die een zaak meldt

**Incident melden** op een zaak, of de stap van een playbook die er een meldt, koppelt het incident aan de hosts, Docker- en Podman-hosts, Kubernetes-clusters, cloud-resources en services waarmee de zaak exact verbonden is. Het incident verschijnt op hun pagina's, de regels van hun eigenaren gelden ervoor, en de feed ervan noemt de zaak en waaraan het is gekoppeld. Een mogelijke overeenkomst wordt nooit gekoppeld, en een monitor ook niet: een incident op een monitor kan zijn status veranderen en op zijn statuspagina's verschijnen.

## OneUptime AI

De triage van een zaak door OneUptime AI leest de verbonden signalen ervan: wat openstaat en wat er is veranderd op de hosts, services, monitoren en leden die de zaak noemt, de bereikbaarheidsschema's en teams van een lid, en waar de waarden ervan in uw logboeken en traces voorkomen. Het onderzoek van een incident leest de beveiligingszaak die het meldde en de open zaken die noemen wat het raakt. Zie [OneUptime AI in beveiliging](/docs/telemetry/security-ai).

## Problemen oplossen

:::details Een host die de zaak noemt, staat er niet bij
Controleer of de zaak de host noemt zoals de host zichzelf noemt, of een openbaar adres noemt dat alleen die host heeft. Een korte naam, zoals `web-1` voor `web-1.acme.internal`, staat erbij als mogelijke overeenkomst, en een kale gebruikersnaam, een bestandshash of een proces wordt helemaal niet opgezocht. Een URL wordt alleen opgezocht onder de monitoren die de host ervan controleren.
:::

:::details Een adres dat de zaak noemt, staat niet in de logboeken en traces
Alleen het venster van de zaak wordt doorzocht, en alleen de logboeken en traces die uw rol kan lezen. Een bericht noemt een adres alleen als geheel: `10.0.0.12` is een ander adres, al vindt de berichtzoekopdracht van de Logboeken-verkenner het ook. Een attribuut noemt het alleen als de waarde precies het adres is, en een resource-attribuut nooit.
:::

:::details De juiste host staat erbij als mogelijke overeenkomst
Een mogelijke overeenkomst wordt nooit meegeteld of gekoppeld, zodat een naam die twee machines delen u nooit iets over de verkeerde vertelt. Laat uw logboeken en detecties de host noemen met de naam die hij meldt.
:::

:::details De pagina van een host heeft geen kaart Beveiliging
De kaart wordt getoond aan een rol die beveiligingsgebeurtenissen mag lezen, in een project dat in de afgelopen 7 dagen een beveiligingsgebeurtenis heeft ontvangen. Een host die in die tijd door niets is genoemd, toont één regel die dat zegt.
:::

:::details De pagina van een monitor heeft geen kaart Beveiliging
De kaart verschijnt voor een monitor die een host, een adres of een URL controleert: een website-, API-, ping-, poort-, SSL-certificaat-, DNS- of domeinmonitor. Een heartbeat, een script of een monitor van uw telemetrie controleert geen host en heeft er dus geen.
:::

:::details De pagina zegt dat uw rol een soort record niet kan zien
Elk record wordt gelezen met uw eigen rol. Vraag een Project Owner of Project Admin om een rol die dat soort record mag lezen.
:::

## Volgende stappen

:::cards
- [Beveiligingszaken en playbooks](/docs/telemetry/security-cases): Een zaak behandelen en er een incident uit melden.
- [Beveiligingsgebeurtenissen (SIEM)](/docs/telemetry/security-events): De gebeurtenissen achter een zaak en de logboeken waaruit ze worden gelezen.
- [Entiteitrisico (risicogebaseerde meldingen)](/docs/telemetry/security-entity-risk): De pagina van een entiteit, het risico ervan en waar OneUptime haar kent.
- [OneUptime AI in beveiliging](/docs/telemetry/security-ai): Hoe een triage leest wat een zaak noemt.
:::
