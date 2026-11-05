# Zeer grote OpenStack-clouds

Wat een cloud van elke omvang kost voordat u iets installeert: hoe zwaar monitoring op het controlevlak leunt, hoeveel gegevens het verstuurt en wat OneUptime anders doet naarmate een cloud groeit. Vrijwel elke cloud zou hier niets van nodig moeten hebben: volgens de aantallen hieronder volstaan de standaardinstellingen van de [OpenStack-agent](/docs/telemetry/openstack) en een [sonde](/docs/telemetry/openstack-agentless) tot duizenden instanties zonder dat er iets wordt ingesteld.

:::cards
- [De belasting van uw controlevlak](#de-belasting-van-uw-controlevlak): Verzoeken per minuut per service, op elke omvang.
- [De gegevens die het verstuurt](#de-gegevens-die-het-verstuurt): Reeksen en gigabytes per dag, uit de aantallen van uw cloud.
- [Samenvattingsmodus](#samenvattingsmodus): Wat een cloud boven 5.000 instanties bewaart, en inlevert.
- [Een cloud delen tussen verzamelaars](#een-cloud-delen-tussen-verzamelaars): Eén agent per regio of per service.
- [Het databasepad](#het-databasepad): De grootste clouds uit hun databases lezen.
- [Waaraan de grootste omvang is getoetst](#waaraan-de-grootste-omvang-is-getoetst): Een uur bij 200.000 instanties, met de budgetten en wat is gemeten.
:::

## De belasting van uw controlevlak

### Via een sonde

Een sonde blijft binnen een vaste belasting, hoe groot de cloud ook is. Hij vraagt elke service één verzoek tegelijk, Placement vier, leest instanties op wat er tussen volledige leesacties veranderde, en leest boven een vast aantal wat één aanroep per ding is (het gebruik van een hypervisor, de agents van een router, de quota van een project) in beurten. Elke verzameling stuurt alles zoals het laatst gelezen was, zodat geen reeks een gat heeft: alleen hoe vers die delen zijn verschuift.

Verzoeken per minuut met de standaardinstellingen, zodra een verzameling is gestabiliseerd, op een cloud met OVN:

| Cloud | Keystone | Nova | Placement | Neutron | Cinder | Glance |
| --- | --- | --- | --- | --- | --- | --- |
| 10 hypervisors, 100 instanties, 20 projecten | 1,3 | 3,5 | 12,5 | 3,5 | 2,5 | 0,3 |
| 500 hypervisors, 20.000 instanties, 1.000 projecten | 1,3 | 4,2 | 253 | 7,5 | 8,5 | 0,3 |
| 5.000 hypervisors, 200.000 instanties, 10.000 projecten | 1,3 | 12,7 | 1.003 | 43,5 | 62,5 | 0,5 |

Deze zijn geteld, niet geschat: een test draait de echte verzamelaar tegen een mock-API van elke omvang, op een klok die hij zelf verzet, en houdt wat hij vroeg exact aan deze getallen, service voor service, overal waar iets anders aan de beurt komt. Een aantal verzoeken hangt niet af van de machine waarop het is geteld.

Wat elke omvang naast de hypervisors, instanties en projecten bevat, is aangenomen, en een echte cloud wijkt af: een volume voor elke tweede instantie, een snapshot en een back-up voor elk tiende volume, een netwerk, subnet, router en beveiligingsgroep per project, een floating IP voor elke tiende instantie, 40 flavors, twee Neutron-agents per hypervisor en een image per tien projecten, tussen 10 en 1.000. Een lijst kost een verzoek per duizend rijen, dus wat uw cloud echt bevat verschuift deze maar weinig. Wat ze het meest verschuift:

| Wat verandert | Wat het kost |
| --- | --- |
| De eerste verzameling nadat een sonde start | Eén aanroep voor de inventarissen van elke hypervisor en één voor zijn gebruik, hoeveel het er ook zijn |
| ML2/OVS in plaats van OVN | Eén aanroep per router om te vragen welke L3-agents hem bevatten, maximaal 2.000 per verzameling |
| Instanties die veranderen | Eén aanroep naar Nova per instantie die veranderde, om te lezen wat ermee gebeurde, maximaal 25 per verzameling |
| [Projectlimieten](/docs/telemetry/openstack-agentless#wat-het-uw-cloud-kost) aangezet | Vier aanroepen per project, maximaal 250 projecten per verzameling, dus een cloud van 10.000 doet er 80 minuten over om rond te komen |
| Minder vaak verzamelen | **Verzamelen elke** op de pagina **Instellingen** van de cloud. Twee keer zo lang is de helft van de aanroepen |
| Meer regio's | Alles behalve Keystone opnieuw, per regio |

Een verzameling heeft negen tiende van zijn interval, en maximaal tien minuten, en elke service wordt één verzoek tegelijk gelezen. Hoe snel de API's van een grote cloud antwoorden bepaalt dus hoe vaak hij kan worden verzameld: bij 200.000 instanties en de standaard twee minuten moet Nova elke pagina van zijn volledige leesactie in ongeveer een halve seconde beantwoorden, en Cinder zijn lijsten in ongeveer 0,8 seconde. Een service die niet klaar kan komen, wordt als down weergegeven totdat hij dat kan, en de kaart meldt **Het verzamelen duurde te lang**. Verhoog **Verzamelen elke**, wat ook de belasting verlaagt, of gebruik het [databasepad](#het-databasepad).

### Via de agent

De exporter van de agent meldt zich aan en leest bij elke scrape elke lijst geheel, en hij vraagt Placement per hypervisor drie dingen, één aanroep tegelijk. Verzoeken per minuut met de standaardinstellingen:

| Cloud | Keystone | Nova | Placement | Neutron | Cinder | Glance |
| --- | --- | --- | --- | --- | --- | --- |
| 10 hypervisors, 100 instanties, 20 projecten | 5,2 | 3 | 15,5 | 3,5 | 2 | 0,2 |
| 500 hypervisors, 20.000 instanties, 1.000 projecten | 5,2 | 13 | 751 | 7,5 | 7,5 | 0,2 |
| 5.000 hypervisors, 200.000 instanties, 10.000 projecten | 5,2 | 106 | 7.501 | 43,5 | 57 | 0,4 |

Deze zijn geteld uit de broncode van de exporter, en de exporter is niet op deze omvang uitgevoerd. Een scrape heeft 110 seconden, dus een Placement die in 20 ms antwoordt loopt bij ongeveer 1.800 hypervisors uit de tijd, en Nova bij een seconde per pagina bij ongeveer 110.000 instanties. Daarboven mislukt een scrape ervan hoe voorzichtig er ook om is gevraagd. Gebruik boven die omvang het [databasepad](#het-databasepad), of een sonde.

### Wanneer een API vertraagt

Een sonde let op waarin elke service gewoonlijk antwoordt, en houdt zich in wanneer een antwoord traag is of geweigerd wordt: [Wat het uw cloud kost](/docs/telemetry/openstack-agentless#wat-het-uw-cloud-kost) zegt hoeveel. Meerdere leesacties die tegelijk wachten komen om de beurt, zodat een pauze niet eindigt in een uitbarsting. Niets anders wordt opgehouden: elke service wordt afzonderlijk gevraagd.

De kaart **Gegevensverzameling** van de cloud meldt het zolang het duurt, service voor service: hoe traag het traagste antwoord was en hoe lang de sonde terugwachtte. De exporter van de agent kan dit niet. Een scrape loopt geheel, op zijn interval: verhoog `scrape_interval` en `scrape_timeout` voor die job om een service te ontzien.

## De gegevens die het verstuurt

De reeksen van een cloud volgen uit zijn aantallen. De calculator onder **OpenStack → Documentatie** in OneUptime rekent dit uit drie getallen uit. Om het zelf uit te rekenen, voor één regio:

| Reeks | Hoeveel |
| --- | --- |
| Compute | 10 per hypervisor, plus flavors en controleservices, plus 7 |
| Placement | 15 per hypervisor, plus 4. Een sonde voegt ongeveer 2 per flavor toe, voor [hoeveel van elke passen](/docs/telemetry/openstack#capaciteit) |
| Neutron | Agents, netwerken, routers en floating IP's, 3 per subnet, plus 11. Eén meer per router op ML2/OVS |
| Cinder | Services, snapshots en back-ups, 2 per opslagpool, plus 26 |
| Instanties en volumes, tenzij de samenvattingsmodus aanstaat | 4 per instantie, 2 per volume |
| De tellingen van de samenvattingsmodus, wanneer die aanstaat | Eén per status en één per project: ongeveer 6 plus projecten |
| Keystone, Glance | Projecten, domeinen en 9, en 2 per image plus 5. Een sonde voegt 3 toe voor elk van Heat en Magnum, of een cloud ze nu draait of niet |

De rijen van elke scrape zijn waarvoor u wordt gefactureerd: de eerste vijf regels komen elke 2 minuten binnen, 720 keer per dag, en de laatste elke 5 minuten, 288 keer. De prijs is die op uw factuur, [per GB voor hoe lang het wordt bewaard](/docs/telemetry/data-retention#wat-bewaring-kost). De factuur leest de echte omvang van elke rij, en dit rekent het uit met 1.024 bytes per rij, waar de facturering van OneUptime op terugvalt wanneer het geen omvang voor een rij heeft. Een rij met veel labels, zoals die van een instantie, kost meer dan dat, en een zonder labels kost minder.

| Cloud | Reeksen | GB per dag, elke reeks | GB per dag, in samenvattingsmodus | Een maand met 15 dagen bewaren, in samenvattingsmodus |
| --- | --- | --- | --- | --- |
| 10 hypervisors, 100 instanties, 20 projecten | 1.084 | 0,7 | Niet in samenvattingsmodus | $2,12 |
| 500 hypervisors, 20.000 instanties, 1.000 projecten | 123.856 | 84,5 | 16,6 | $49,71 |
| 5.000 hypervisors, 200.000 instanties, 10.000 projecten | 1.237.192 | 844,5 | 164,9 | $494,73 |

Deze gelden via de agent, met één instantie op duizend in een toestand die zijn reeksen bewaart. Een sonde boven de omvang van de samenvatting stuurt wat niet is veranderd eenmaal per cyclus in plaats van bij elke verzameling, wat neerkomt op ongeveer 13,2 GB per dag bij de tweede omvang en 116 GB bij de derde.

Het echte gebruik per instantie, uit libvirt of Ceilometer, komt hier bovenop: zie [wat het kost](/docs/telemetry/openstack#wat-het-kost).

## Samenvattingsmodus

Boven 5.000 instanties houdt een cloud tellingen en rijen bij in plaats van een reeks per instantie. Op die omvang zijn die reeksen het grootste deel van de rekening, met ongeveer 17 GB per dag tegen 4 GB voor al het andere, en ze zeggen wat de rijen en de tellingen al doen.

**Wat het bewaart:**

- Een rij voor elk onderdeel, op elke pagina en in elke lijst, actueel gehouden. Statuswijzigingen komen er zoals gewoonlijk in terecht.
- Elke reeks van hypervisors, workers, netwerken, routers, floating IP's, adrespools en opslagpools.
- `openstack_nova_instances_by_status` en `openstack_nova_instances_by_project`, in elke regio.
- De reeksen van elke instantie of elk volume in een toestand die een alert bewaakt: in `ERROR`, of vast in `BUILD`, `RESIZE`, `attaching` en dergelijke. Zo blijft elk [alertsjabloon](/docs/monitor/openstack-monitor#kant-en-klare-waarschuwingssjablonen) werken, en herstelt het zichzelf.

**Wat het inlevert:**

- De geschiedenis van de status van elke gestabiliseerde instantie en elk volume, en een grafiek of een monitor over die reeksen. `openstack_nova_server_status`, `openstack_cinder_volume_gb` en `openstack_cinder_volume_status` stoppen voor een onderdeel zodra het gestabiliseerd is. Een monitor die één instantie nodig heeft, moet zijn project kiezen, zie hieronder.
- `openstack_placement_resource_provider_allocations` en `openstack_nova_server_local_gb`, van wie ze ook zijn. Een sonde stopt helemaal met het vragen van allocaties aan Placement.

**Om de reeksen van een instantie toch te bewaren**, opent u de **Instellingen** van de cloud en dan **Echt gebruik per instantie**. **Alleen de projecten en aggregaten die ik kies** bewaart elke instantie en elk volume van die projecten, hoe groot de cloud ook is. **Elke instantie** zet de samenvattingsmodus uit voor de hele cloud. Een sonde weigert dat boven ongeveer 480 MiB aan metrics per verzameling, in plaats van dat in het geheugen te houden: gebruik de agent voor zo'n cloud.

**Via een sonde** is er nog een verschil. Boven de omvang van de samenvatting leest hij steeds alles en verstuurt hij alleen wat veranderde, wat iemand koos, wat een alert bewaakt en een deel van de rest. Elk onderdeel komt eenmaal per cyclus aan de beurt, zo gedimensioneerd dat de upload van een verzameling ongeveer 24 MiB blijft boven de reeksen die elke keer meegaan: 6 minuten bij 20.000 instanties, 44 bij 200.000. De kaart **Gegevensverzameling** meldt hoe lang de cyclus is. Daaruit volgen twee dingen:

- **De lijsten van een nieuwe cloud vullen zich tijdens zijn eerste cyclus.** De eerste verzameling weet wat de cloud bevat, en de kaart meldt dat meteen, maar de rijen komen een deel tegelijk binnen. Hetzelfde geldt voor een sonde die opnieuw is gestart, hoewel de rijen die hij achterliet intussen op de pagina's blijven staan. De kaart meldt wanneer ze er allemaal zijn.
- **Een onderdeel dat weg is, blijft iets langer vermeld.** Het verdwijnt binnen 15 minuten nadat niets het meer meldt, plus de cyclus, plus twee leesacties. Dus 15 minuten en een paar op de meeste clouds, en net over een uur bij 200.000 instanties. Een onderdeel dat er nog is, wordt nooit verwijderd. Een mislukte leesactie verwijdert niets, hoe lang hij ook duurt.

## Een cloud delen tussen verzamelaars

Eén agent leest een cloud, hoeveel regio's die ook heeft, en daarmee begint u het best. Wanneer één te veel is voor de machine waarop hij draait of voor de tijd van een scrape, geef dan elke agent een deel. Ze sturen allemaal naar dezelfde OneUptime-cloud onder dezelfde `OPENSTACK_CLOUD_NAME`. Twee regels voorkomen dat een grafiek en een factuur dubbel lezen:

- **Elk paar van een regio en een service hoort bij één agent.** Een rij is dezelfde rij, hoeveel agents hem ook melden, maar de reeksen van elke agent worden opgeslagen en gefactureerd.
- **Keystone hoort bij één agent.** Het is er één voor de hele cloud, welke regio het ook vraagt.

**Eén agent per regio** is wat de meeste clouds willen. Noem alleen de items van die regio in `clouds.yaml` en `OPENSTACK_EXPORTER_CLOUDS`. Alleen de eerste agent houdt Keystone. Een agent die `OPENSTACK_AGENT_SERVICES` instelt, leest alleen wat die noemt, dus voeg elke andere service toe die uw cloud draait, zoals `load-balancer`:

```bash
# On the agent for RegionOne, in .env
OPENSTACK_CLOUD_NAME=prod
OPENSTACK_EXPORTER_CLOUDS=[RegionOne]

# On the agent for RegionTwo
OPENSTACK_CLOUD_NAME=prod
OPENSTACK_EXPORTER_CLOUDS=[RegionTwo]
OPENSTACK_AGENT_SERVICES=compute|placement|network|volume|image
```

**Eén agent per service** is voor de grootste clouds, waar de lijsten van één service zijn wat een scrape niet kan afmaken. `OPENSTACK_AGENT_SERVICES` houdt de jobs die het noemt en laat de rest aan een andere agent:

```bash
# Nova and Placement, which take the most
OPENSTACK_AGENT_SERVICES=compute|placement

# And the rest: add any other service you run, such as load-balancer
OPENSTACK_AGENT_SERVICES=identity|network|volume|image
```

Stel `OPENSTACK_AGENT_MEMORY_LIMIT_MIB` in op een agent die een groot deel heeft: hij houdt een scrape in het geheugen op weg naar buiten, en de standaard is 512 MiB. Een rij wordt gegarandeerd door zijn eigen service in zijn eigen regio, dus een agent die stopt neemt niets mee van wat een andere agent leest. Noem waar een cloud op draait, de `OPENSTACK_RABBITMQ_TARGETS` en de [andere zoals die](/docs/telemetry/openstack#omgevingsvariabelen), op slechts één agent. Als die agent stopt terwijl de andere doorgaan, verdwijnen die machines na 15 minuten van de pagina's, en komen ze terug wanneer hij dat doet.

**Met sondes** heeft een cloud één sonde. Geef een regio een eigen sonde door hem te verbinden als een eigen cloud, met alleen die regio gekozen: niets wordt dubbel geteld, omdat elke alleen zijn eigen regio leest en elke Keystone voor zichzelf leest. Elk is dan een eigen cloud in OneUptime, met eigen pagina's en eigen alerts.

## Het databasepad

Boven **1.500 hypervisors of 100.000 instanties** kan de agent de databases van een cloud lezen in plaats van zijn API's, met [`openstack_database_exporter`](https://github.com/vexxhost/openstack_database_exporter). Op die omvang loopt een scrape van de API's uit de tijd, en leesacties die niet kunnen afmaken zijn belasting voor niets. Een databaseleesactie kost de API's niets. Het wordt alleen boven die omvang aangeboden, omdat de API's daaronder goed genoeg antwoorden en dit pad dingen inlevert.

**Wat het van u vraagt:**

- Een alleen-lezenaccount op de database van elke service: Nova, Nova API, Placement, Neutron, Cinder, Glance en Keystone. Een database die wordt weggelaten is een service die het met rust laat.
- Een route van de machine van de agent naar die databases, die op de meeste clouds ver van al het andere worden gehouden. Het is nog iets dat de records van elk project kan lezen.
- Eén exporter per regio, en per Nova-cell. Hij leest wat u hem aanwijst, en een tweede cell heeft een tweede exporter nodig.
- Schema's die uw release volgen. Hij leest de tabellen van elke service rechtstreeks, dus een upgrade van OpenStack kan veranderen wat hij kan lezen vóórdat een nieuwe versie van de exporter dat doet.

**Om het aan te zetten**, in `.env`:

```bash
COMPOSE_PROFILES=openstack-database-exporter,openstack-ai-agent
# Read from the databases, and from nowhere else: with the two together every series arrives twice.
OPENSTACK_EXPORTER_CLOUDS=[]
OPENSTACK_DATABASE_EXPORTER_TARGETS=[openstack-database-exporter:9180]
# What a hypervisor's full name adds to Nova's host name, so an instance finds its hypervisor.
OPENSTACK_DATABASE_EXPORTER_HOST_SUFFIX=.example.org
# oslo.db's form. Each is kept in .env, which only its owner can read.
NOVA_DATABASE_URL=mysql+pymysql://oneuptime:secret@db.example:3306/nova
NOVA_API_DATABASE_URL=mysql+pymysql://oneuptime:secret@db.example:3306/nova_api
PLACEMENT_DATABASE_URL=mysql+pymysql://oneuptime:secret@db.example:3306/placement
NEUTRON_DATABASE_URL=mysql+pymysql://oneuptime:secret@db.example:3306/neutron
CINDER_DATABASE_URL=mysql+pymysql://oneuptime:secret@db.example:3306/cinder
GLANCE_DATABASE_URL=mysql+pymysql://oneuptime:secret@db.example:3306/glance
KEYSTONE_DATABASE_URL=mysql+pymysql://oneuptime:secret@db.example:3306/keystone
# What a database cannot say, from the API: each is one small list a scrape.
OPENSTACK_WORKER_STATE_CLOUDS=[RegionOne]
```

**Wat het dekt.** Dezelfde reeksen onder dezelfde namen, dus elke pagina, monitor en elk alertsjabloon leest ze op dezelfde manier. Een test houdt ze aan die van de API-exporter, naam voor naam en label voor label.

**Wat niet:**

| Wat | Waarom, en wat er in plaats daarvan gebeurt |
| --- | --- |
| Of elke Nova-worker leeft | Zijn `openstack_nova_agent_state` leest 1 voor elke ingeschakelde service, dus een gestopte `nova-compute` zou als up worden gelezen. De agent laat die reeks vallen en leest hem uit de API van Nova, wat één kleine lijst is |
| Hoe vol elke opslagpool is | Elke backend meldt dat aan de scheduler van Cinder, en het staat niet in de database. De agent leest het uit de API van Cinder, wat er nog één is |
| De MTU van een netwerk | Wordt weergegeven als onbekend |
| `openstack_placement_resource_provider_allocations`, de generatie van een provider | Niets leest ze |
| Quota en limieten per project | Hij kan ze lezen, en bij 10.000 projecten zijn dat 790.000 datapunten per scrape, dus de agent laat ze weg. Verwijder die regel in `otel-collector-config.yaml` om ze te bewaren |
| Of een API antwoordt | `openstack_<service>_up` meldt of zijn database dat doet. Een gestopte API met een gezonde database wordt als up gelezen, dus bewaak de API's zelf met een [websitemonitor](/docs/monitor/website-monitor) |

**Hoe ver dit is bewezen.** De reeksen zijn gelezen uit de broncode van de exporter en zijn eigen tests op de tag die de agent vastzet, en elk komt overeen met wat OneUptime leest. Het is hier niet uitgevoerd tegen een echte database.

## Waaraan de grootste omvang is getoetst

De echte verzamelaar las 60 minuten lang elke twee minuten een mock-API van 5.000 hypervisors, 200.000 instanties en 10.000 projecten, op een echte klok. Wat hij verstuurde ging door de echte ingest en de echte schrijfacties naar een echte Postgres, met de leesacties van het Overzicht en de sweep van verouderde rijen elke 30 seconden ernaast, en 200 instanties die bij elke verzameling veranderden. Elk budget hieronder wordt gecontroleerd, en een run die er een mist, mislukt.

| Wat | Budget | Gemeten |
| --- | --- | --- |
| Verzoeken per minuut, zoals aan elke service gevraagd | Precies wat het schema van de verzamelaar zegt, service voor service | Exact. Keystone 1,3, Nova 25,1, Placement 1.166, Neutron 43,5, Cinder 62,4, Glance 0,5 |
| Verzamelingen overgeslagen omdat de vorige nog liep | Geen | 0 van 30 |
| Ingest-vertraging, vanaf het begin van een verzameling tot de laatste rij is geschreven | Onder 2 minuten | 37 s mediaan, 112 s in het slechtste geval |
| Een Overzicht dat opent, alle leesacties die het tegelijk doet | Onder 6 seconden | 0,6 s mediaan, 4,1 s in het slechtste geval, en 5.008 bytes aan wat aandacht nodig heeft |
| De langste tijd dat een schrijver op een lock op de inventaristabel wachtte | Onder 5 seconden | 0,0 s, in 2.739 controles eenmaal per seconde |
| Verwijderde onderdelen die er nog waren | Geen | 0 |

En wat het kostte, waarvoor geen budget is: 73 MiB aan metrics per verzameling vóór compressie, in maximaal 2 uploads, 14 s cpu van dit proces per verzameling voor lezen, versturen en schrijven samen, en maximaal 998 MiB JavaScript-heap. Een sonde die een cloud van deze omvang verzamelt, heeft dat geheugen nodig bovenop zijn ander werk.

Dit draaide op een Mac met 10 kernen, gedeeld met ander werk bij een gemiddelde belasting van ongeveer 33, en PostgreSQL 14 op dezelfde machine, dus de tijden zijn wat een drukke machine haalde in plaats van wat een server zou halen. Het is gemeten op 2026-11-05. De verzoeken van een uur omvatten de eerste verzameling, die Placement om de inventarissen van elke hypervisor vraagt, dus ze liggen iets boven [de tabel](#via-een-sonde) van een gestabiliseerde, en 200 instanties die bij elke verzameling veranderen is de rest van wat de leesacties van Nova daar zijn.

De marge is niet groot op zo'n drukke machine. Een eerder uur, bij een gemiddelde belasting van ongeveer 42 die tot 95 steeg, liep zo ver dat de laatste rij van één verzameling na 124 seconden landde, zodat de volgende verzameling werd overgeslagen, en elk ander budget hield stand.

**Wat dit buiten beschouwing laat.** De mock antwoordt direct, dus dit zegt niets over hoe snel uw API's zijn: [wat de tijd van een verzameling toelaat](#via-een-sonde) gaat daarover. Het laat de HTTP-server en wachtrij tussen een sonde en ingest buiten beschouwing, en ClickHouse, dus de leesactie van een grafiek of een monitor over de reeksen zit er niet in, alleen de schrijf- en leesacties van de inventaris. De rijen zijn gevormd als die van een echte DevStack en de aantallen zijn verzonnen. Geen cloud van deze omvang heeft ertegen gedraaid.

## Wat de pagina's lezen

De pagina's van een grote cloud lezen nauwelijks meer dan die van een kleine, omdat geen ervan de hele cloud leest.

| Pagina | Wat hij leest |
| --- | --- |
| **Overzicht** | Aantallen die op de server worden berekend, en de rijen die iemand nodig kunnen hebben. Boven 1.000 hosts of workers worden de rest alleen geteld, zodat wat het ophaalt onder een megabyte blijft, hoe groot de cloud ook is |
| **Services** | Hetzelfde: een kaart voor elke service, wat iemand het eerst nodig heeft, en hoeveel andere in orde zijn. Een zoekopdracht vraagt het aan de server, dus hij vindt elke host |
| Lijsten | Een pagina tegelijk, elk vanaf de laatste rij van de pagina ervoor. Een sprong naar een verre pagina gaat via een offset, wat op de laatste pagina van 200.000 rijen seconden kost in plaats van een milliseconde |
| **Topologie** | Boven 5.000 onderdelen: de structuur, wat is uitgevallen en wat dat meeneemt. Hij meldt wat hij wegliet |
| **Inventarisschrijfacties** | Maximaal 500 rijen per statement, en 5.000 per delete, elk een eigen transactie, zodat geen schrijver lang op een andere wacht. Een rij waarop niets is veranderd wordt tot 5 minuten niet herschreven, wat het write-ahead log meer dan twintigvoudig verkleint |

## Gebruik en uitgaven

De [pagina Uitgaven](/docs/telemetry/openstack#uitgaven) van een cloud leest de rijen van de inventaris in plaats van de reeksen van een instantie, dus hij werkt in de samenvattingsmodus hetzelfde, en zijn kosten groeien met projecten in plaats van instanties. Hij leest één rij van de cloud en één pagina projecten. [Zijn eigen sectie](/docs/telemetry/openstack#bij-elke-omvang) bevat de cijfers op elke omvang.

## Volgende stappen

:::cards
- [OpenStack-agent](/docs/telemetry/openstack): Installeer de agent.
- [OpenStack zonder agent](/docs/telemetry/openstack-agentless): Verzamel een cloud met een sonde.
- [OpenStack-monitor](/docs/monitor/openstack-monitor): Alert op wat binnenkomt.
:::
