# Mycket stora OpenStack-moln

Vad ett moln av vilken storlek som helst kostar innan du installerar något: hur hårt övervakningen belastar dess kontrollplan, hur mycket data den skickar och vad OneUptime gör annorlunda när ett moln växer. Nästan varje moln behöver inget av detta: standardvärdena för [OpenStack Agent](/docs/telemetry/openstack) och en [sond](/docs/telemetry/openstack-agentless) klarar tusentals instanser utan att något ställs in.

:::cards
- [Belastningen på ditt kontrollplan](#belastningen-på-ditt-kontrollplan): Begäranden per minut och tjänst, vid varje storlek.
- [Datan den skickar](#datan-den-skickar): Serier och gigabyte per dag, utifrån ditt molns antal.
- [Sammanfattningsläge](#sammanfattningsläge): Vad ett moln över 5 000 instanser behåller, och ger upp.
- [Dela ett moln mellan insamlare](#dela-ett-moln-mellan-insamlare): En agent per region eller per tjänst.
- [Databasvägen](#databasvägen): Läsa de största molnen från deras databaser.
- [Vad den största storleken hölls till](#vad-den-största-storleken-hölls-till): En timme vid 200 000 instanser, med dess budgetar och vad som mättes.
:::

## Belastningen på ditt kontrollplan

### Genom en sond

En sond håller sig inom en angiven belastning hur stort molnet än är. Den frågar varje tjänst en begäran i taget, Placement fyra, läser instanser efter vad som ändrats mellan fullständiga läsningar, och över ett angivet antal läser den det som är ett anrop per sak (en hypervisors användning, en routers agenter, ett projekts kvoter) i omgångar. Varje insamling skickar allt som senast läst, så ingen serie får ett glapp: bara hur färska de delarna är förändras.

Begäranden per minut med standardvärdena, när en insamling har stabiliserats, i ett moln med OVN:

| Moln | Keystone | Nova | Placement | Neutron | Cinder | Glance |
| --- | --- | --- | --- | --- | --- | --- |
| 10 hypervisorer, 100 instanser, 20 projekt | 1,3 | 3,5 | 12,5 | 3,5 | 2,5 | 0,3 |
| 500 hypervisorer, 20 000 instanser, 1 000 projekt | 1,3 | 4,2 | 253 | 7,5 | 8,5 | 0,3 |
| 5 000 hypervisorer, 200 000 instanser, 10 000 projekt | 1,3 | 12,7 | 1 003 | 43,5 | 62,5 | 0,5 |

Dessa är räknade, inte uppskattade: ett test kör den riktiga insamlaren mot ett mock-API av varje storlek, på en klocka som det flyttar själv, och håller det den frågade efter exakt till dessa tal, tjänst för tjänst, varhelst något annat förfaller. Ett antal begäranden beror inte på maskinen det räknades på.

Vad varje storlek rymmer utöver sina hypervisorer, instanser och projekt är antaget, och ett riktigt moln skiljer sig: en volym för varannan instans, en ögonblicksbild och en säkerhetskopia för var tionde volym, ett nätverk, ett subnät, en router och en säkerhetsgrupp per projekt, en flytande IP för var tionde instans, 40 flavors, två Neutron-agenter per hypervisor och en avbildning per tio projekt, mellan 10 och 1 000. En lista kostar en begäran per tusen rader, så vad ditt moln egentligen rymmer flyttar dessa bara lite. Det som flyttar dem mest:

| Vad som ändras | Vad det kostar |
| --- | --- |
| Den första insamlingen efter att en sond startat | Ett anrop för varje hypervisors inventarier och ett för dess användning, hur många de än är |
| ML2/OVS i stället för OVN | Ett anrop per router för att fråga vilka L3-agenter som håller den, högst 2 000 per insamling |
| Instanser som ändras | Ett anrop per instans som ändrats, till Nova, för att läsa vad som hänt den, högst 25 per insamling |
| [Projektgränser](/docs/telemetry/openstack-agentless#vad-det-kostar-ditt-moln) påslagna | Fyra anrop per projekt, högst 250 projekt per insamling, så ett moln med 10 000 tar 80 minuter att komma runt |
| Samla in mer sällan | **Samla in var** på molnets sida **Inställningar**. Dubbelt så lång tid ger hälften så många anrop |
| Fler regioner | Allt utom Keystone en gång till, per region |

En insamling har nio tiondelar av sitt intervall, och högst tio minuter, och varje tjänst läses en begäran i taget. Så hur snabbt ett stort molns API:er svarar avgör hur ofta det kan samlas in: vid 200 000 instanser och standardvärdet två minuter måste Nova svara på varje sida av sin fullständiga läsning på ungefär en halv sekund, och Cinder på sina listor på ungefär 0,8 sekund. En tjänst som inte hinner klart visas som nere tills den gör det, och kortet säger **Insamlingen tog för lång tid**. Höj **Samla in var**, vilket också sänker belastningen, eller använd [databasvägen](#databasvägen).

### Genom agenten

Agentens exporter loggar in och läser varje lista i sin helhet vid varje scrape, och den frågar Placement tre saker per hypervisor, ett anrop i taget. Begäranden per minut med standardvärdena:

| Moln | Keystone | Nova | Placement | Neutron | Cinder | Glance |
| --- | --- | --- | --- | --- | --- | --- |
| 10 hypervisorer, 100 instanser, 20 projekt | 3,4 | 3 | 15,5 | 3,5 | 2 | 0,2 |
| 500 hypervisorer, 20 000 instanser, 1 000 projekt | 3,4 | 13 | 751 | 7,5 | 7,5 | 0,2 |
| 5 000 hypervisorer, 200 000 instanser, 10 000 projekt | 3,4 | 106 | 7 501 | 43,5 | 57 | 0,4 |

Dessa är räknade ur exporterns källkod, och exportern har inte körts vid dessa storlekar. En scrape har 110 sekunder, så en Placement som svarar på 20 ms får slut på tid vid ungefär 1 800 hypervisorer, och Nova vid en sekund per sida vid ungefär 110 000 instanser. Bortom det misslyckas en scrape av dem hur försiktigt den än görs. Över de storlekarna, använd [databasvägen](#databasvägen), eller en sond.

### När ett API blir långsammare

En sond bevakar vad varje tjänst brukar svara på, och när ett svar tar tre gånger så lång tid och minst en sekund, eller fem sekunder oavsett vad som är brukligt, väntar den lika länge som svaret tog innan den frågar den tjänsten igen. Flera läsningar som väntar samtidigt turas om, så en paus slutar inte i en skur. En tjänst som fortsätter svara `429` eller `503` lämnas i fred en minut, sedan två, sedan fyra, upp till en halvtimme. Inget annat hålls upp: varje tjänst tillfrågas för sig.

Molnets kort **Datainsamling** anger detta medan det pågår, tjänst för tjänst: hur långsamt dess långsammaste svar var och hur länge sonden höll tillbaka. Agentens exporter kan inte göra detta. En scrape körs hel, med sitt intervall: höj `scrape_interval` och `scrape_timeout` för det jobbet för att vara skonsammare mot en tjänst.

## Datan den skickar

Ett molns serier följer av dess antal. Kalkylatorn på ett molns sida **Dokumentation** i OneUptime räknar ut detta från tre tal. För att räkna ut det själv, för en region:

| Serier | Hur många |
| --- | --- |
| Compute | 10 per hypervisor, plus flavors och kontrolltjänster, plus 7 |
| Placement | 15 per hypervisor, plus 4. En sond lägger till ungefär 2 per flavor, för [hur många av varje som ryms](/docs/telemetry/openstack#kapacitet) |
| Neutron | Agenter, nätverk, routrar och flytande IP:er, 3 per subnät, plus 11. En till per router på ML2/OVS |
| Cinder | Tjänster, ögonblicksbilder och säkerhetskopior, 2 per lagringspool, plus 26 |
| Instanser och volymer, om inte sammanfattningsläge är på | 4 per instans, 2 per volym |
| Sammanfattningslägets antal, när det är på | En per status och en per projekt: ungefär 6 plus projekt |
| Keystone, Glance | Projekt, domäner och 9, samt 2 per avbildning plus 5. En sond lägger till 3 för vardera Heat och Magnum, oavsett om ett moln kör dem |

Varje scrapes rader är vad du faktureras för: de första fem raderna kommer var 2:a minut, 720 gånger per dag, och den sista var 5:e minut, 288 gånger. Priset är det på din faktura, [per GB för hur länge det sparas](/docs/telemetry/openstack#vad-det-kostar). Fakturan läser varje rads verkliga storlek, och detta räknar ut det vid 1 024 byte per rad, det OneUptimes fakturering faller tillbaka på när den saknar storlek för en rad. En rad med många etiketter, som en instans, kostar mer än så, och en utan några kostar mindre.

| Moln | Serier | GB per dag, alla serier | GB per dag, i sammanfattningsläge | En månad sparad 15 dagar, i sammanfattningsläge |
| --- | --- | --- | --- | --- |
| 10 hypervisorer, 100 instanser, 20 projekt | 1 084 | 0,7 | Inte i sammanfattningsläge | $2,12 |
| 500 hypervisorer, 20 000 instanser, 1 000 projekt | 123 856 | 84,5 | 16,6 | $49,71 |
| 5 000 hypervisorer, 200 000 instanser, 10 000 projekt | 1,237,192 | 844.5 | 164.9 | $494.73 |

Dessa gäller genom agenten, med en instans av tusen i ett tillstånd som behåller sina serier. En sond över sammanfattningsstorleken skickar det som inte ändrats en gång per cykel i stället för vid varje insamling, vilket blir ungefär 13,2 GB per dag vid den andra storleken och 116 GB vid den tredje.

Verklig användning per instans, från libvirt eller Ceilometer, kommer utöver allt detta: se [vad det kostar](/docs/telemetry/openstack#vad-det-kostar).

## Sammanfattningsläge

Över 5 000 instanser behåller ett moln antal och rader, i stället för en serie per instans. Vid den storleken är de serierna det mesta av fakturan, med ungefär 17 GB per dag mot 4 GB för allt annat, och de säger det raderna och antalen redan gör.

**Vad det behåller:**

- En rad för varje del, på varje sida och i varje lista, hållen aktuell. Statusändringar når den som vanligt.
- Varje serie för hypervisorer, arbetare, nätverk, routrar, flytande IP:er, adresspooler och lagringspooler.
- `openstack_nova_instances_by_status` och `openstack_nova_instances_by_project`, i varje region.
- Serierna för varje instans eller volym i ett tillstånd som ett larm bevakar: i `ERROR`, eller fastnad i `BUILD`, `RESIZE`, `attaching` och liknande. Så varje [larmmall](/docs/monitor/openstack-monitor#färdiga-larmmallar) fortsätter fungera och fortsätter återhämta sig av sig själv.

**Vad det ger upp:**

- Historiken för varje stabil instans och volyms status, samt ett diagram eller en monitor över de serierna. `openstack_nova_server_status`, `openstack_cinder_volume_gb` och `openstack_cinder_volume_status` upphör för en del när den är stabil. En monitor som behöver en enskild instans bör välja dess projekt, nedan.
- `openstack_placement_resource_provider_allocations` och `openstack_nova_server_local_gb`, vems de än är. En sond slutar helt fråga Placement om allokeringar.

**För att ändå behålla en instans serier**, öppna molnets **Inställningar** och sedan **Verklig användning per instans**. **Bara de projekt och aggregat jag väljer** behåller varje instans och volym i de projekten, hur stort molnet än är. **Varje instans** stänger av sammanfattningsläget för hela molnet. En sond vägrar det över ungefär 480 MiB mätvärden per insamling, i stället för att hålla det i minnet: använd agenten för ett sådant moln.

**Genom en sond** finns en skillnad till. Över sammanfattningsstorleken läser den allt varje gång, och skickar bara det som ändrats, det någon valt, det ett larm bevakar och en andel av resten. Varje del kommer runt en gång per cykel, dimensionerad så att en insamlings uppladdning håller sig på ungefär 24 MiB utöver de serier som går varje gång: 6 minuter vid 20 000 instanser, 44 vid 200 000. Kortet **Datainsamling** anger hur lång cykeln är. Två saker följer av det:

- **Ett nytt molns listor fylls under dess första cykel.** Den första insamlingen vet vad molnet rymmer, och kortet säger det genast, men dess rader kommer fram en andel i taget. Detsamma gäller en sond som startat om, fast raderna den lämnade kvar står kvar på sidorna under tiden. Kortet anger när de alla har kommit fram.
- **En del som försvunnit står kvar i listan en stund till.** Den försvinner inom 15 minuter efter att ingenting rapporterar den, plus cykeln, plus två läsningar. Alltså 15 minuter och några till i de flesta moln, och drygt en timme vid 200 000 instanser. En del som fortfarande finns tas aldrig bort. En misslyckad läsning tar inte bort något, hur länge den än varar.

## Dela ett moln mellan insamlare

En agent läser ett moln hur många regioner det än har, och det är det att börja med. När en är för mycket för maskinen den körs på eller för en scrapes tid, ge varje agent en andel. Var och en av dem skickar till samma OneUptime-moln under samma `OPENSTACK_CLOUD_NAME`. Två regler hindrar ett diagram och en faktura från att räkna dubbelt:

- **Varje par av region och tjänst tillhör en agent.** En rad är samma rad hur många agenter som än rapporterar den, men varje agents serier lagras och faktureras.
- **Keystone tillhör en agent.** Det är ett för hela molnet, vilken region som än frågar det.

**En agent per region** är vad de flesta moln vill ha. Lista bara den regionens poster i `clouds.yaml` och `OPENSTACK_EXPORTER_CLOUDS`. Bara den första agenten behåller Keystone:

```bash
# On the agent for RegionOne, in .env
OPENSTACK_CLOUD_NAME=prod
OPENSTACK_EXPORTER_CLOUDS=[RegionOne]

# On the agent for RegionTwo
OPENSTACK_CLOUD_NAME=prod
OPENSTACK_EXPORTER_CLOUDS=[RegionTwo]
OPENSTACK_AGENT_SERVICES=compute|placement|network|volume|image
```

**En agent per tjänst** är för de största molnen, där en tjänsts listor är det en scrape inte hinner klart med. `OPENSTACK_AGENT_SERVICES` behåller de jobb den nämner och lämnar resten åt en annan agent:

```bash
# Nova and Placement, which take the most
OPENSTACK_AGENT_SERVICES=compute|placement

# And everything else
OPENSTACK_AGENT_SERVICES=identity|network|volume|image
```

Ange `OPENSTACK_AGENT_MEMORY_LIMIT_MIB` på en agent som håller en stor andel: den håller en scrape i minnet på väg ut, och standardvärdet är 512 MiB. En rad garanteras av sin egen tjänst i sin egen region, så en agent som stoppar tar inget av det en annan agent läser med sig. Ange det ett moln vilar på, `OPENSTACK_RABBITMQ_TARGETS` och [de andra av samma slag](/docs/telemetry/openstack#miljövariabler), på bara en agent. Om den agenten stoppar medan de andra fortsätter lämnar de maskinerna sidorna efter 15 minuter och kommer tillbaka när den gör det.

**Med sonder** har ett moln en sond. Ge en region en egen sond genom att ansluta den som ett eget moln, med bara den regionen vald: ingenting räknas två gånger, eftersom var och en bara läser sin egen region, och var och en läser Keystone för sig. Varje blir då ett eget moln i OneUptime, med egna sidor och egna larm.

## Databasvägen

Över **1 500 hypervisorer eller 100 000 instanser** kan agenten läsa ett molns databaser i stället för dess API:er, med [`openstack_database_exporter`](https://github.com/vexxhost/openstack_database_exporter). Vid den storleken får en scrape av API:erna slut på tid, och läsningar som inte kan bli klara är belastning i onödan. En databasläsning kostar API:erna ingenting. Den erbjuds bara över den storleken, eftersom API:erna under den svarar tillräckligt bra och den här vägen ger upp saker.

**Vad den kräver av dig:**

- Ett skrivskyddat konto på varje tjänsts databas: Nova, Nova API, Placement, Neutron, Cinder, Glance och Keystone. En utelämnad databas är en tjänst den lämnar i fred.
- En rutt från agentens maskin till de databaserna, som i de flesta moln hålls långt borta från allt annat. Det är en sak till som kan läsa varje projekts poster.
- En exporter per region, och per Nova-cell. Den läser det du pekar den mot, och en andra cell behöver en andra exporter.
- Dess scheman måste följa din version. Den läser varje tjänsts tabeller direkt, så en uppgradering av OpenStack kan ändra vad den kan läsa innan en ny version av exportern gör det.

**För att slå på den**, i `.env`:

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

**Vad den täcker.** Samma serier under samma namn, så varje sida, monitor och larmmall läser dem på samma sätt. Ett test håller dem mot API-exporterns, namn för namn och etikett för etikett.

**Vad den inte täcker:**

| Vad | Varför, och vad som sker i stället |
| --- | --- |
| Om varje Nova-arbetare lever | Dess `openstack_nova_agent_state` visar 1 för varje aktiverad tjänst, så en stoppad `nova-compute` skulle visas som uppe. Agenten släpper den serien och läser den från Novas API, vilket är en liten lista |
| Hur full varje lagringspool är | Varje backend rapporterar det till Cinders scheduler, och det finns inte i databasen. Agenten läser det från Cinders API, vilket är en till |
| Ett nätverks MTU | Visas som okänd |
| `openstack_placement_resource_provider_allocations`, en leverantörs generation | Ingenting läser dem |
| Kvoter och gränser per projekt | Den kan läsa dem, och vid 10 000 projekt är det 790 000 datapunkter per scrape, så agenten utelämnar dem. Ta bort den regeln i `otel-collector-config.yaml` för att behålla dem |
| Om ett API svarar | `openstack_<service>_up` säger om dess databas gör det. Ett stoppat API med frisk databas visas som uppe, så bevaka själva API:erna med en [webbplatsmonitor](/docs/monitor/website-monitor) |

**Hur långt detta är bevisat.** Serierna lästes ur exporterns källkod och dess egna tester vid den tagg agenten fäster, och var och en stämmer med det OneUptime läser. Den har inte körts här mot en riktig databas.

## Vad den största storleken hölls till

Den riktiga insamlaren läste ett mock-API med 5 000 hypervisorer, 200 000 instanser och 10 000 projekt varannan minut i 60 minuter, på en riktig klocka. Det den skickade gick genom den riktiga sammanfogningen och de riktiga skrivningarna in i en riktig Postgres, med Översiktens läsningar och svepet efter inaktuella rader körande bredvid dem var 30:e sekund, och 200 instanser som ändrades vid varje insamling. Varje budget nedan är verifierad, och en körning som missar en misslyckas.

| Vad | Budget | Uppmätt |
| --- | --- | --- |
| Begäranden per minut, så som varje tjänst tillfrågades | Exakt vad insamlarens schema anger, tjänst för tjänst | Exakt. Keystone 1,3, Nova 25,1, Placement 1 166, Neutron 43,5, Cinder 62,4, Glance 0,5 |
| Insamlingar som hoppades över eftersom den före fortfarande kördes | Inga | 0 av 30 |
| Intagsfördröjning, från att en insamling startar till att dess sista rad skrivits | Under 2 minuter | 37 s i median, 112 s som sämst |
| En Översikt som öppnas, varje läsning den gör samtidigt | Under 6 sekunder | 0,6 s i median, 4,1 s som sämst, och 5 008 byte av det som kräver uppmärksamhet |
| Längsta tid någon skrivare väntade på ett lås på inventarietabellen | Under 5 sekunder | 0,0 s, i 2 739 kontroller en gång i sekunden |
| Borttagna delar som fortfarande fanns | Inga | 0 |

Och vad det krävde, som inte har någon budget: 73 MiB mätvärden per insamling före komprimering, i upp till 2 uppladdningar, 14 s av den här processens CPU per insamling för att läsa, skicka och skriva tillsammans, och högst 998 MiB JavaScript-heap. En sond som samlar in ett moln av den här storleken behöver det minnet utöver sitt övriga arbete.

Detta kördes på en Mac med 10 kärnor, delad med annat arbete vid ett medelbelastningstal på ungefär 33, och PostgreSQL 14 på samma maskin, så tiderna är vad en upptagen maskin klarade snarare än vad en server skulle göra. Det mättes 2026-11-05. En timmes begäranden rymmer dess första insamling, som frågar Placement om varje hypervisors inventarier, så de ligger något över [tabellen](#genom-en-sond) för en stabil insamling, och 200 instanser som ändras vid varje insamling är resten av det Novas läsningar där består av.

Marginalen är inte stor på en så upptagen maskin. En tidigare timme, vid ett medelbelastningstal på ungefär 42 som nådde 95, gick så långt som till att en insamlings sista rad landade vid 124 sekunder, så nästa insamling hoppades över, och varje annan budget höll.

**Vad detta utelämnar.** Mocken svarar genast, så detta säger ingenting om hur snabba dina API:er är: [vad en insamlings tid tillåter](#genom-en-sond) handlar om det. Det utelämnar HTTP-servern och kön mellan en sond och intaget, samt ClickHouse, så ett diagrams eller en monitors läsning av serierna ingår inte här, bara inventariets skrivningar och läsningar. Raderna är formade som en riktig DevStacks och antalen är påhittade. Inget moln av den här storleken har körts mot det.

## Vad sidorna läser

Ett stort molns sidor läses lika snabbt som ett litet, eftersom ingen av dem läser hela molnet.

| Sida | Vad den läser |
| --- | --- |
| **Översikt** | Antal uträknade på servern, och de rader som kan behöva någon. Över 1 000 värdar eller arbetare räknas resten bara, så det den hämtar förblir under en megabyte hur stort molnet än är |
| **Tjänster** | Detsamma: ett kort för varje tjänst, det som behöver någon först, och hur många andra som mår bra. En sökning frågar servern, så den hittar vilken värd som helst |
| Listor | En sida i taget, var och en från sista raden på sidan före. Ett hopp till en avlägsen sida går med offset, vilket på sista sidan av 200 000 rader tar sekunder snarare än en millisekund |
| **Topologi** | Över 5 000 delar: strukturen, det som har fallerat och vad det drar med sig. Den anger vad den lämnade utanför |
| **Inventarieskrivningar** | Högst 500 rader per sats, och 5 000 per borttagning, var och en i sin egen transaktion, så ingen skrivare väntar länge på en annan. En rad som inget har ändrats på skrivs inte om på upp till 5 minuter, vilket skär ned write-ahead-loggen mer än tjugofalt |

## Användning och utgifter

Ett molns [sida Utgifter](/docs/telemetry/openstack#utgifter) läser inventariets rader snarare än någon instans serier, så den fungerar likadant i sammanfattningsläge, och dess kostnad växer med projekt snarare än instanser. Den läser en rad för molnet och en sida med projekt. [Dess egna avsnitt](/docs/telemetry/openstack#vid-varje-storlek) har talen vid varje storlek.

## Nästa steg

:::cards
- [OpenStack Agent](/docs/telemetry/openstack): Installera agenten.
- [OpenStack utan agent](/docs/telemetry/openstack-agentless): Samla in ett moln med en sond.
- [OpenStack-monitor](/docs/monitor/openstack-monitor): Larma om det som kommer in.
:::
