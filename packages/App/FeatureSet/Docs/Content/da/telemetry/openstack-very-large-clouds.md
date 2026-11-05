# Meget store OpenStack-clouds

Hvad en cloud af enhver størrelse koster, før du installerer noget: hvor hårdt monitorering belaster dens kontrolplan, hvor meget data den sender, og hvad OneUptime gør anderledes, når en cloud vokser. Næsten alle clouds har brug for intet af dette: standardindstillingerne for [OpenStack-agenten](/docs/telemetry/openstack) og en [sonde](/docs/telemetry/openstack-agentless) holder op til tusindvis af instanser, uden at noget skal sættes.

:::cards
- [Belastningen på dit kontrolplan](#belastningen-på-dit-kontrolplan): Forespørgsler i minuttet pr. tjeneste, ved hver størrelse.
- [De data, den sender](#de-data-den-sender): Serier og gigabyte om dagen, ud fra din clouds tal.
- [Oversigtstilstand](#oversigtstilstand): Hvad en cloud ud over 5.000 instanser beholder, og hvad den opgiver.
- [Deling af en cloud mellem indsamlere](#deling-af-en-cloud-mellem-indsamlere): Én agent pr. region eller pr. tjeneste.
- [Databasestien](#databasestien): At læse de største clouds fra deres databaser.
- [Hvad den største størrelse blev holdt op imod](#hvad-den-største-størrelse-blev-holdt-op-imod): En time ved 200.000 instanser, med dens budgetter og det, den målte.
:::

## Belastningen på dit kontrolplan

### Gennem en sonde

En sonde holder sig inden for en angivet belastning, uanset hvor stor clouden er. Den spørger hver tjeneste én forespørgsel ad gangen, Placement fire, læser instanser efter hvad der er ændret mellem fulde aflæsninger og læser ud over et angivet antal det, der er ét kald pr. ting (en hypervisors forbrug, en routers agenter, et projekts kvoter), på skift. Hver indsamling sender alt, som det sidst blev læst, så ingen serie har et hul: kun hvor friske disse dele er, flytter sig.

Forespørgsler i minuttet med standardindstillingerne, når en indsamling har indstillet sig, på en cloud med OVN:

| Cloud | Keystone | Nova | Placement | Neutron | Cinder | Glance |
| --- | --- | --- | --- | --- | --- | --- |
| 10 hypervisorer, 100 instanser, 20 projekter | 1,3 | 3,5 | 12,5 | 3,5 | 2,5 | 0,3 |
| 500 hypervisorer, 20.000 instanser, 1.000 projekter | 1,3 | 4,2 | 253 | 7,5 | 8,5 | 0,3 |
| 5.000 hypervisorer, 200.000 instanser, 10.000 projekter | 1,3 | 12,7 | 1.003 | 43,5 | 62,5 | 0,5 |

Disse er talt, ikke anslået: en test kører den rigtige indsamler mod et mock-API af hver størrelse, på et ur, den selv flytter, og holder det, den spurgte om, op mod disse tal præcist, tjeneste for tjeneste, hvor end noget andet forfalder. Et antal forespørgsler afhænger ikke af den maskine, det blev talt på.

Hvad hver størrelse rummer ud over sine hypervisorer, instanser og projekter er antaget, og en rigtig cloud afviger: en diskenhed for hver anden instans, et snapshot og en backup for hver tiende diskenhed, et netværk, subnet, en router og en sikkerhedsgruppe pr. projekt, en floating IP for hver tiende instans, 40 flavors, to Neutron-agenter pr. hypervisor og et image pr. ti projekter, mellem 10 og 1.000. En liste koster en forespørgsel pr. tusind rækker, så det, din cloud virkelig rummer, flytter disse kun lidt. Det, der flytter dem mest:

| Hvad der ændrer sig | Hvad det koster |
| --- | --- |
| Den første indsamling, efter en sonde starter | Ét kald for hver hypervisors inventar og ét for dens forbrug, uanset hvor mange der er |
| ML2/OVS frem for OVN | Ét kald pr. router for at spørge, hvilke L3-agenter der holder den, højst 2.000 pr. indsamling |
| Instanser, der ændrer sig | Ét kald pr. instans, der er ændret, til Nova, for at læse, hvad der skete med den, højst 25 pr. indsamling |
| [Projektgrænser](/docs/telemetry/openstack-agentless#hvad-det-koster-din-cloud) slået til | Fire kald pr. projekt, højst 250 projekter pr. indsamling, så en cloud på 10.000 bruger 80 minutter på at komme rundt |
| Indsamling sjældnere | **Indsaml hvert** på cloudens side **Indstillinger**. Dobbelt så lang tid er halvt så mange kald |
| Flere regioner | Alt andet end Keystone igen, pr. region |

En indsamling har ni tiendedele af sit interval og højst ti minutter, og hver tjeneste læses én forespørgsel ad gangen. Så hvor hurtigt en stor clouds API'er svarer, afgør, hvor ofte den kan indsamles: ved 200.000 instanser og de to minutter som standard skal Nova svare på hver side af sin fulde aflæsning på cirka et halvt sekund og Cinder på sine lister på cirka 0,8 sekund. En tjeneste, der ikke kan blive færdig, vises som nede, indtil den kan, og kortet siger **Indsamlingen tog for lang tid**. Hæv **Indsaml hvert**, hvilket også sænker belastningen, eller brug [databasestien](#databasestien).

### Gennem agenten

Agentens eksportør logger ind og læser hver liste hel ved hver scrape, og den spørger Placement om tre ting pr. hypervisor, ét kald ad gangen. Forespørgsler i minuttet med standardindstillingerne:

| Cloud | Keystone | Nova | Placement | Neutron | Cinder | Glance |
| --- | --- | --- | --- | --- | --- | --- |
| 10 hypervisorer, 100 instanser, 20 projekter | 3,4 | 3 | 15,5 | 3,5 | 2 | 0,2 |
| 500 hypervisorer, 20.000 instanser, 1.000 projekter | 3,4 | 13 | 751 | 7,5 | 7,5 | 0,2 |
| 5.000 hypervisorer, 200.000 instanser, 10.000 projekter | 3,4 | 106 | 7.501 | 43,5 | 57 | 0,4 |

Disse er talt ud fra eksportørens kildekode, og eksportøren er ikke kørt i disse størrelser. En scrape har 110 sekunder, så en Placement, der svarer på 20 ms, løber tør for tid ved cirka 1.800 hypervisorer og Nova ved et sekund pr. side ved cirka 110.000 instanser. Ud over det fejler en scrape af dem, uanset hvor skånsomt der blev spurgt. Ud over de størrelser skal du bruge [databasestien](#databasestien) eller en sonde.

### Når et API bliver langsomt

En sonde holder øje med, hvad hver tjeneste plejer at svare på, og når et svar tager tre gange så lang tid og mindst et sekund, eller fem sekunder uanset hvad der er normalt, venter den lige så længe, som svaret tog, før den spørger den tjeneste igen. Flere aflæsninger, der venter på én gang, tager tur, så en pause ikke ender i en byge. En tjeneste, der bliver ved med at svare `429` eller `503`, lades i fred i et minut, så to, så fire, op til en halv time. Intet andet holdes op: hver tjeneste spørges for sig.

Cloudens kort **Dataindsamling** siger det, mens det varer, tjeneste for tjeneste: hvor langsomt dens langsomste svar var, og hvor længe sonden holdt sig tilbage. Agentens eksportør kan ikke gøre dette. En scrape kører hel, med sit interval: hæv `scrape_interval` og `scrape_timeout` for det job for at skåne en tjeneste.

## De data, den sender

En clouds serier følger af dens tal. Beregneren på en clouds side **Dokumentation** i OneUptime regner dette ud ud fra tre tal. For selv at regne det ud, for én region:

| Serier | Hvor mange |
| --- | --- |
| Compute | 10 pr. hypervisor, plus flavors og kontroltjenester, plus 7 |
| Placement | 15 pr. hypervisor, plus 4. En sonde tilføjer cirka 2 pr. flavor, for [hvor mange af hver der kan være plads til](/docs/telemetry/openstack#kapacitet) |
| Neutron | Agenter, netværk, routere og floating IP'er, 3 pr. subnet, plus 11. Én mere pr. router på ML2/OVS |
| Cinder | Tjenester, snapshots og backups, 2 pr. lagerpulje, plus 26 |
| Instanser og diskenheder, medmindre oversigtstilstand er slået til | 4 pr. instans, 2 pr. diskenhed |
| Oversigtstilstandens tal, når den er slået til | Ét pr. status og ét pr. projekt: cirka 6 plus projekter |
| Keystone, Glance | Projekter, domæner og 9, og 2 pr. image plus 5. En sonde tilføjer 3 for hver af Heat og Magnum, uanset om en cloud kører dem |

Hver scrapes rækker er det, du faktureres for: de første fem linjer ankommer hvert 2. minut, 720 gange om dagen, og den sidste hvert 5. minut, 288 gange. Prisen er den på din regning, [pr. GB for hvor længe det opbevares](/docs/telemetry/openstack#hvad-det-koster). Regningen læser hver rækkes reelle størrelse, og dette regner det ud ved 1.024 byte pr. række, hvad OneUptimes fakturering falder tilbage på, når den ikke har en størrelse for en række. En række med mange labels, som en instans', koster mere end det, og en uden nogen koster mindre.

| Cloud | Serier | GB om dagen, hver serie | GB om dagen, i oversigtstilstand | En måned opbevaret 15 dage, i oversigtstilstand |
| --- | --- | --- | --- | --- |
| 10 hypervisorer, 100 instanser, 20 projekter | 1.075 | 0,7 | Ikke i oversigtstilstand | $2,12 |
| 500 hypervisorer, 20.000 instanser, 1.000 projekter | 123.847 | 84,5 | 16,6 | $49,71 |
| 5.000 hypervisorer, 200.000 instanser, 10.000 projekter | 1.237.183 | 844,5 | 164,9 | $494,73 |

Disse er gennem agenten, med én instans ud af tusind i en tilstand, der beholder sine serier. En sonde ud over oversigtsstørrelsen sender det, der ikke er ændret, én gang pr. cyklus frem for ved hver indsamling, hvilket løber op i cirka 13,2 GB om dagen ved den anden størrelse og 116 GB ved den tredje.

Reelt forbrug pr. instans, fra libvirt eller Ceilometer, kommer oven i alt dette: se [hvad det koster](/docs/telemetry/openstack#hvad-det-koster).

## Oversigtstilstand

Ud over 5.000 instanser beholder en cloud tal og rækker frem for en serie pr. instans. Ved den størrelse er de serier størstedelen af regningen, med cirka 17 GB om dagen mod 4 GB for alt andet, og de siger det, rækkerne og tallene allerede gør.

**Hvad den beholder:**

- En række for hver del, på hver side og liste, holdt aktuel. Statusændringer når den som sædvanligt.
- Hver serie for hypervisorer, workers, netværk, routere, floating IP'er, adressepuljer og lagerpuljer.
- `openstack_nova_instances_by_status` og `openstack_nova_instances_by_project`, i hver region.
- Serierne for enhver instans eller diskenhed i en tilstand, en advarsel overvåger: i `ERROR` eller fastlåst i `BUILD`, `RESIZE`, `attaching` og lignende. Så hver [advarselsskabelon](/docs/monitor/openstack-monitor#færdige-advarselsskabeloner) bliver ved med at virke og bliver ved med at komme sig af sig selv.

**Hvad den opgiver:**

- Historikken for hver afsluttet instans' og diskenheds status og et diagram eller en monitor over de serier. `openstack_nova_server_status`, `openstack_cinder_volume_gb` og `openstack_cinder_volume_status` stopper for en del, når den er afsluttet. En monitor, der skal bruge én instans, bør vælge dens projekt, nedenfor.
- `openstack_placement_resource_provider_allocations` og `openstack_nova_server_local_gb`, uanset hvem de tilhører. En sonde holder helt op med at spørge Placement om allokeringer.

**For alligevel at beholde en instans' serier** skal du åbne cloudens **Indstillinger** og derefter **Reelt forbrug pr. instans**. **Kun de projekter og aggregater, jeg vælger** beholder hver instans og diskenhed i de projekter, uanset hvor stor clouden er. **Hver instans** slår oversigtstilstand fra for hele clouden. En sonde afviser det ud over cirka 480 MiB metrikker pr. indsamling frem for at holde det i hukommelsen: brug agenten til en sådan cloud.

**Gennem en sonde** er der endnu en forskel. Ud over oversigtsstørrelsen læser den alt hver gang og sender kun det, der er ændret, det, nogen valgte, det, en advarsel overvåger, og en del af resten. Hver del kommer rundt én gang pr. cyklus, dimensioneret så en indsamlings upload holder sig på cirka 24 MiB ud over de serier, der går hver gang: 6 minutter ved 20.000 instanser, 44 ved 200.000. Kortet **Dataindsamling** siger, hvor lang cyklussen er. To ting følger af det:

- **En ny clouds lister fyldes over dens første cyklus.** Den første indsamling ved, hvad clouden rummer, og kortet siger det med det samme, men dens rækker ankommer en del ad gangen. Det samme gælder en sonde, der er genstartet, men de rækker, den efterlod, bliver stående på siderne i mellemtiden. Kortet siger, hvornår de alle vil være ankommet.
- **En del, der er væk, bliver stående på listen lidt længere.** Den forsvinder inden for 15 minutter efter, at intet rapporterer den, plus cyklussen, plus to aflæsninger. Altså 15 minutter og nogle få på de fleste clouds og lidt over en time ved 200.000 instanser. En del, der stadig er der, fjernes aldrig. En mislykket aflæsning fjerner intet, uanset hvor længe den varer.

## Deling af en cloud mellem indsamlere

Én agent læser en cloud, uanset hvor mange regioner den har, og det er det, du skal starte med. Når én er for meget for den maskine, den kører på, eller for en scrapes tid, så giv hver agent en andel. Hver af dem sender til den samme OneUptime-cloud under det samme `OPENSTACK_CLOUD_NAME`. To regler forhindrer, at et diagram og en regning læses dobbelt:

- **Hvert par af en region og en tjeneste tilhører én agent.** En række er den samme række, uanset hvor mange agenter der rapporterer den, men hver agents serier gemmes og faktureres.
- **Keystone tilhører én agent.** Den er én for hele clouden, uanset hvilken region der spørger.

**Én agent pr. region** er det, de fleste clouds vil have. Angiv kun den regions poster i `clouds.yaml` og `OPENSTACK_EXPORTER_CLOUDS`. Kun den første agent beholder Keystone:

```bash
# On the agent for RegionOne, in .env
OPENSTACK_CLOUD_NAME=prod
OPENSTACK_EXPORTER_CLOUDS=[RegionOne]

# On the agent for RegionTwo
OPENSTACK_CLOUD_NAME=prod
OPENSTACK_EXPORTER_CLOUDS=[RegionTwo]
OPENSTACK_AGENT_SERVICES=compute|placement|network|volume|image
```

**Én agent pr. tjeneste** er til de største clouds, hvor én tjenestes lister er det, en scrape ikke kan nå at afslutte. `OPENSTACK_AGENT_SERVICES` beholder de jobs, den navngiver, og overlader resten til en anden agent:

```bash
# Nova and Placement, which take the most
OPENSTACK_AGENT_SERVICES=compute|placement

# And everything else
OPENSTACK_AGENT_SERVICES=identity|network|volume|image
```

Sæt `OPENSTACK_AGENT_MEMORY_LIMIT_MIB` på en agent, der holder en stor andel: den holder en scrape i hukommelsen på vej ud, og standarden er 512 MiB. En række bekræftes af sin egen tjeneste i sin egen region, så en agent, der stopper, tager intet af det med, en anden agent læser. Angiv det, en cloud står på, `OPENSTACK_RABBITMQ_TARGETS` og [de andre som den](/docs/telemetry/openstack#miljøvariabler), på kun én agent. Hvis den agent stopper, mens de andre fortsætter, forsvinder de maskiner fra siderne efter 15 minutter og kommer tilbage, når den gør.

**Med sonder** har en cloud én sonde. Giv en region en sonde for sig ved at tilslutte den som en cloud for sig, med kun den region valgt: intet tælles to gange, fordi hver kun læser sin egen region, og hver læser Keystone for sig selv. Hver er så en cloud for sig i OneUptime, med sine egne sider og sine egne advarsler.

## Databasestien

Ud over **1.500 hypervisorer eller 100.000 instanser** kan agenten læse en clouds databaser frem for dens API'er med [`openstack_database_exporter`](https://github.com/vexxhost/openstack_database_exporter). Ved den størrelse løber en scrape af API'erne tør for tid, og aflæsninger, der ikke kan blive færdige, er belastning for ingenting. En databaseaflæsning koster API'erne intet. Den tilbydes kun ud over den størrelse, fordi API'erne under den svarer godt nok, og denne sti opgiver ting.

**Hvad den kræver af dig:**

- En skrivebeskyttet konto på hver tjenestes database: Nova, Nova API, Placement, Neutron, Cinder, Glance og Keystone. En udeladt database er en tjeneste, den lader være i fred.
- En rute fra agentens maskine til de databaser, som på de fleste clouds holdes langt væk fra alt andet. Det er endnu en ting, der kan læse hvert projekts poster.
- Én eksportør pr. region og pr. Nova-celle. Den læser det, du peger den på, og en anden celle kræver en anden eksportør.
- Dens skemaer skal følge din udgave. Den læser hver tjenestes tabeller direkte, så en opgradering af OpenStack kan ændre, hvad den kan læse, før en ny version af eksportøren gør.

**For at slå den til**, i `.env`:

```bash
COMPOSE_PROFILES=openstack-database-exporter
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

**Hvad den dækker.** De samme serier under de samme navne, så hver side, monitor og advarselsskabelon læser dem på samme måde. En test holder dem op mod API-eksportørens, navn for navn og label for label.

**Hvad den ikke dækker:**

| Hvad | Hvorfor, og hvad der sker i stedet |
| --- | --- |
| Om hver Nova-worker lever | Dens `openstack_nova_agent_state` læses som 1 for enhver aktiveret tjeneste, så en stoppet `nova-compute` ville læses som oppe. Agenten dropper den serie og læser den fra Novas API, hvilket er én lille liste |
| Hvor fuld hver lagerpulje er | Hver backend rapporterer det til Cinders scheduler, og det er ikke i databasen. Agenten læser det fra Cinders API, hvilket er én mere |
| Et netværks MTU | Læses som ikke kendt |
| `openstack_placement_resource_provider_allocations`, en udbyders generation | Intet læser dem |
| Kvoter og grænser pr. projekt | Den kan læse dem, og ved 10.000 projekter er det 790.000 datapunkter pr. scrape, så agenten udelader dem. Slet den regel i `otel-collector-config.yaml` for at beholde dem |
| Om et API svarer | `openstack_<service>_up` siger, om dets database gør. Et stoppet API med en sund database læses som oppe, så overvåg selve API'erne med en [websitemonitor](/docs/monitor/website-monitor) |

**Hvor meget der er bevist.** Serierne blev læst fra eksportørens kildekode og dens egne tests ved det tag, agenten fastlåser, og hver stemmer overens med det, OneUptime læser. Den er ikke kørt her mod en rigtig database.

## Hvad den største størrelse blev holdt op imod

Den rigtige indsamler læste et mock-API med 5.000 hypervisorer, 200.000 instanser og 10.000 projekter hvert andet minut i 60 minutter, på et rigtigt ur. Det, den sendte, gik gennem den rigtige fold og de rigtige skrivninger ind i en rigtig Postgres, mens Oversigtens aflæsninger og oprydningen af forældede rækker kørte ved siden af hvert 30. sekund, og 200 instanser ændrede sig ved hver indsamling. Hvert budget nedenfor er hævdet, og en kørsel, der overskrider ét, fejler.

| Hvad | Budget | Målt |
| --- | --- | --- |
| Forespørgsler i minuttet, som der blev spurgt hver tjeneste | Præcis det, indsamlerens tidsplan siger, tjeneste for tjeneste | Præcist. Keystone 1,3, Nova 25,1, Placement 1.166, Neutron 43,5, Cinder 62,4, Glance 0,5 |
| Indsamlinger sprunget over, fordi den før stadig kørte | Ingen | 0 af 30 |
| Indtagsforsinkelse, fra en indsamling starter til dens sidste række er skrevet | Under 2 minutter | 37 s i medianen, 112 s i værste fald |
| En Oversigt, der åbnes, alle aflæsninger den foretager på én gang | Under 6 sekunder | 0,6 s i medianen, 4,1 s i værste fald og 5.008 byte af det, der kræver opmærksomhed |
| Den længste tid, nogen skriver ventede på en lås på inventartabellen | Under 5 sekunder | 0,0 s, i 2.739 kig én gang i sekundet |
| Dele slettet, som stadig var der | Ingen | 0 |

Og hvad det krævede, hvilket der ikke er noget budget for: 73 MiB metrikker pr. indsamling før komprimering, i op til 2 uploads, 14 s af denne proces' CPU pr. indsamling til at læse, sende og skrive tilsammen og højst 998 MiB JavaScript-heap. En sonde, der indsamler en cloud af denne størrelse, har brug for den hukommelse oven i sit øvrige arbejde.

Dette kørte på en Mac med 10 kerner, delt med andet arbejde ved et belastningsgennemsnit på cirka 33, og PostgreSQL 14 på samme maskine, så tiderne er det, en optaget maskine klarede, frem for hvad en server ville. Det blev målt den 2026-11-05. En times forespørgsler rummer dens første indsamling, som spørger Placement om hver hypervisors inventar, så de ligger lidt over [tabellen](#gennem-en-sonde) for en indstillet, og 200 instanser, der ændrer sig ved hver indsamling, er resten af det, Novas aflæsninger er der.

Marginen er ikke bred på en så optaget maskine. En tidligere time, ved et belastningsgennemsnit på cirka 42, der nåede 95, kørte så langt som til, at én indsamlings sidste række landede ved 124 sekunder, så den næste indsamling blev sprunget over, og alle andre budgetter holdt.

**Hvad dette udelader.** Mock'en svarer med det samme, så dette siger intet om, hvor hurtige dine API'er er: [hvad en indsamlings tid tillader](#gennem-en-sonde) handler om det. Det udelader HTTP-serveren og køen mellem en sonde og indtag samt ClickHouse, så et diagrams eller en monitors aflæsning af serierne er ikke med her, kun inventarets skrivninger og aflæsninger. Rækkerne er formet som en rigtig DevStacks, og tallene er opdigtede. Ingen cloud af denne størrelse har kørt imod det.

## Hvad siderne læser

En stor clouds sider læses lige så hurtigt som en lille, fordi ingen af dem læser hele clouden.

| Side | Hvad den læser |
| --- | --- |
| **Oversigt** | Tal udregnet på serveren og de rækker, der kan have brug for nogen. Ud over 1.000 værter eller workers tælles resten kun, så det, den henter, forbliver under en megabyte, uanset hvor stor clouden er |
| **Tjenester** | Det samme: et kort for hver tjeneste, det der først har brug for nogen, og hvor mange andre der er i orden. En søgning spørger serveren, så den finder enhver vært |
| Lister | En side ad gangen, hver fra den foregående sides sidste række. Et hop til en fjern side går via offset, hvilket på den sidste side af 200.000 rækker tager sekunder frem for et millisekund |
| **Topologi** | Ud over 5.000 dele strukturen, hvad der er fejlet, og hvad det tager med sig. Den siger, hvad den udelod |
| **Inventarskrivninger** | Højst 500 rækker pr. sætning og 5.000 pr. sletning, hver sin transaktion, så ingen skriver venter længe på en anden. En række, intet er ændret på, omskrives ikke i op til 5 minutter, hvilket skærer write-ahead-loggen mere end tyve gange ned |

## Forbrug og udgifter

En clouds [side Forbrug](/docs/telemetry/openstack#forbrug) læser inventarets rækker frem for nogen instans' serier, så den virker på samme måde i oversigtstilstand, og dens pris vokser med projekter frem for instanser. Den læser én række af clouden og én side af projekter. [Dens eget afsnit](/docs/telemetry/openstack#ved-hver-størrelse) har tallene ved hver størrelse.

## Næste trin

:::cards
- [OpenStack-agent](/docs/telemetry/openstack): Installér agenten.
- [OpenStack uden agent](/docs/telemetry/openstack-agentless): Indsaml en cloud med en sonde.
- [OpenStack-monitor](/docs/monitor/openstack-monitor): Advar om det, der ankommer.
:::
