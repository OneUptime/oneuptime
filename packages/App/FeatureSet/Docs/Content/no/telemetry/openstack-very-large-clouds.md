# Svært store OpenStack-skyer

Hva en sky av enhver størrelse koster før du installerer noe: hvor hardt overvåkingen belaster kontrollplanet, hvor mye data den sender, og hva OneUptime gjør annerledes etter hvert som en sky vokser. Nesten ingen sky trenger noe av dette: standardinnstillingene til [OpenStack-agenten](/docs/telemetry/openstack) og en [sonde](/docs/telemetry/openstack-agentless) holder opp til tusenvis av instanser uten at noe må settes.

:::cards
- [Lasten på kontrollplanet ditt](#lasten-på-kontrollplanet-ditt): Forespørsler per minutt per tjeneste, ved hver størrelse.
- [Dataene den sender](#dataene-den-sender): Serier og gigabyte per dag, fra skyens tall.
- [Sammendragsmodus](#sammendragsmodus): Hva en sky over 5 000 instanser beholder, og gir avkall på.
- [Dele en sky mellom innsamlere](#dele-en-sky-mellom-innsamlere): Én agent per region eller per tjeneste.
- [Databaseveien](#databaseveien): Å lese de største skyene fra databasene deres.
- [Hva den største størrelsen ble holdt til](#hva-den-største-størrelsen-ble-holdt-til): En time med 200 000 instanser, med budsjettene og det som ble målt.
:::

## Lasten på kontrollplanet ditt

### Gjennom en sonde

En sonde holder seg innenfor en oppgitt last uansett hvor stor skyen er. Den spør hver tjeneste om én forespørsel om gangen, Placement fire, leser instanser etter hva som er endret mellom fulle avlesninger, og over et oppgitt antall leser den det som er ett kall per ting (en hypervisors bruk, en ruters agenter, et prosjekts kvoter) i omganger. Hver innsamling sender alt som sist lest, så ingen serie får hull: det er bare hvor ferske disse delene er som flytter seg.

Forespørsler per minutt med standardinnstillingene, når en innsamling har stabilisert seg, på en sky med OVN:

| Sky | Keystone | Nova | Placement | Neutron | Cinder | Glance |
| --- | --- | --- | --- | --- | --- | --- |
| 10 hypervisorer, 100 instanser, 20 prosjekter | 1,3 | 3,5 | 12,5 | 3,5 | 2,5 | 0,3 |
| 500 hypervisorer, 20 000 instanser, 1 000 prosjekter | 1,3 | 4,2 | 253 | 7,5 | 8,5 | 0,3 |
| 5 000 hypervisorer, 200 000 instanser, 10 000 prosjekter | 1,3 | 12,7 | 1 003 | 43,5 | 62,5 | 0,5 |

Disse er telt, ikke anslått: en test kjører den virkelige innsamleren mot et mock-API av hver størrelse, på en klokke den flytter selv, og holder det den spurte om til disse tallene nøyaktig, tjeneste for tjeneste, uansett hvor noe annet forfaller. Et antall forespørsler avhenger ikke av maskinen det ble talt på.

Det hver størrelse holder i tillegg til hypervisorene, instansene og prosjektene sine, er antatt, og en virkelig sky avviker: et volum for hver andre instans, en snapshot og en sikkerhetskopi for hvert tiende volum, et nettverk, et subnett, en ruter og en sikkerhetsgruppe per prosjekt, en flytende IP for hver tiende instans, 40 flavors, to Neutron-agenter per hypervisor, og ett bilde per ti prosjekter, mellom 10 og 1 000. En liste koster en forespørsel per tusen rader, så det skyen din virkelig holder, flytter disse bare litt. Det som flytter dem mest:

| Hva som endres | Hva det koster |
| --- | --- |
| Den første innsamlingen etter at en sonde starter | Ett kall for hver hypervisors inventar og ett for bruken, uansett hvor mange det er |
| ML2/OVS i stedet for OVN | Ett kall per ruter for å spørre hvilke L3-agenter som har den, høyst 2 000 per innsamling |
| Instanser som endres | Ett kall per instans som er endret, til Nova, for å lese hva som skjedde med den, høyst 25 per innsamling |
| [Prosjektgrenser](/docs/telemetry/openstack-agentless#hva-det-koster-skyen-din) slått på | Fire kall per prosjekt, høyst 250 prosjekter per innsamling, så en sky på 10 000 bruker 80 minutter på en runde |
| Å samle inn sjeldnere | **Samle inn hvert** på skyens **Innstillinger**-side. Dobbelt så lenge er halvparten så mange kall |
| Flere regioner | Alt unntatt Keystone igjen, per region |

En innsamling har ni tideler av intervallet sitt, og høyst ti minutter, og hver tjeneste leses én forespørsel om gangen. Så hvor fort en stor skys API-er svarer, avgjør hvor ofte den kan samles inn: ved 200 000 instanser og standard to minutter må Nova svare på hver side av sin fulle avlesning på omtrent et halvt sekund, og Cinder på listene sine på omtrent 0,8 sekund. En tjeneste som ikke rekker å bli ferdig, vises som nede til den gjør det, og kortet sier **Innsamlingen tok for lang tid**. Øk **Samle inn hvert**, som også senker lasten, eller bruk [databaseveien](#databaseveien).

### Gjennom agenten

Agentens eksportør logger inn og leser hver liste hel ved hver skraping, og den spør Placement om tre ting per hypervisor, ett kall om gangen. Forespørsler per minutt med standardinnstillingene:

| Sky | Keystone | Nova | Placement | Neutron | Cinder | Glance |
| --- | --- | --- | --- | --- | --- | --- |
| 10 hypervisorer, 100 instanser, 20 prosjekter | 3,4 | 3 | 15,5 | 3,5 | 2 | 0,2 |
| 500 hypervisorer, 20 000 instanser, 1 000 prosjekter | 3,4 | 13 | 751 | 7,5 | 7,5 | 0,2 |
| 5 000 hypervisorer, 200 000 instanser, 10 000 prosjekter | 3,4 | 106 | 7 501 | 43,5 | 57 | 0,4 |

Disse er telt fra eksportørens kildekode, og eksportøren er ikke kjørt ved disse størrelsene. En skraping har 110 sekunder, så en Placement som svarer på 20 ms går tom for tid ved omtrent 1 800 hypervisorer, og Nova med et sekund per side ved omtrent 110 000 instanser. Over det feiler en skraping av dem uansett hvor forsiktig den ble bedt. Over disse størrelsene bruker du [databaseveien](#databaseveien), eller en sonde.

### Når et API blir tregt

En sonde følger med på hva hver tjeneste vanligvis svarer på, og når et svar tar tre ganger så lang tid og minst ett sekund, eller fem sekunder uansett hva som er vanlig, venter den like lenge som svaret tok før den spør den tjenesten igjen. Flere avlesninger som venter samtidig, tar tur, så en pause ender ikke i en byge. En tjeneste som fortsetter å svare `429` eller `503`, får være i fred i ett minutt, så to, så fire, opptil en halv time. Ingenting annet holdes opp: hver tjeneste spørres for seg.

Skyens **Datainnsamling**-kort sier fra om det mens det varer, tjeneste for tjeneste: hvor tregt det tregeste svaret var, og hvor lenge sonden holdt tilbake. Agentens eksportør kan ikke gjøre dette. En skraping kjører hel, ved sitt intervall: øk `scrape_interval` og `scrape_timeout` for den jobben for å skåne en tjeneste.

## Dataene den sender

En skys serier følger av tallene dens. Kalkulatoren på en skys **Dokumentasjon**-side i OneUptime regner dette ut fra tre tall. For å regne det ut selv, for én region:

| Serier | Hvor mange |
| --- | --- |
| Compute | 10 per hypervisor, pluss flavors og kontrolltjenester, pluss 7 |
| Placement | 15 per hypervisor, pluss 4. En sonde legger til omtrent 2 per flavor, for [hvor mange av hver som får plass](/docs/telemetry/openstack#kapasitet) |
| Neutron | Agenter, nettverk, rutere og flytende IP-er, 3 per subnett, pluss 11. Én til per ruter på ML2/OVS |
| Cinder | Tjenester, snapshots og sikkerhetskopier, 2 per lagringspool, pluss 26 |
| Instanser og volumer, med mindre sammendragsmodus er på | 4 per instans, 2 per volum |
| Sammendragsmodusens tall, når den er på | Én per status og én per prosjekt: omtrent 6 pluss prosjekter |
| Keystone, Glance | Prosjekter, domener og 9, og 2 per bilde pluss 5. En sonde legger til 3 for hver av Heat og Magnum, enten en sky kjører dem eller ikke |

Radene fra hver skraping er det du faktureres for: de første fem linjene kommer hvert 2. minutt, 720 ganger om dagen, og den siste hvert 5. minutt, 288 ganger. Prisen er den på fakturaen din, [per GB for hvor lenge det lagres](/docs/telemetry/openstack#hva-det-koster). Fakturaen leser den virkelige størrelsen på hver rad, og dette regner det ut med 1 024 byte per rad, det OneUptimes fakturering faller tilbake på når den ikke har noen størrelse for en rad. En rad med mange etiketter, som en instans', koster mer enn det, og en uten noen koster mindre.

| Sky | Serier | GB per dag, hver serie | GB per dag, i sammendragsmodus | En måned lagret 15 dager, i sammendragsmodus |
| --- | --- | --- | --- | --- |
| 10 hypervisorer, 100 instanser, 20 prosjekter | 1 075 | 0,7 | Ikke i sammendragsmodus | $2.12 |
| 500 hypervisorer, 20 000 instanser, 1 000 prosjekter | 123 847 | 84,5 | 16,6 | $49.71 |
| 5 000 hypervisorer, 200 000 instanser, 10 000 prosjekter | 1 237 183 | 844,5 | 164,9 | $494.73 |

Disse er gjennom agenten, med én instans av tusen i en tilstand som beholder seriene sine. En sonde over sammendragsstørrelsen sender det som ikke er endret én gang per syklus i stedet for ved hver innsamling, noe som blir omtrent 13,2 GB per dag ved den andre størrelsen og 116 GB ved den tredje.

Faktisk bruk per instans, fra libvirt eller Ceilometer, kommer på toppen av alt dette: se [hva det koster](/docs/telemetry/openstack#hva-det-koster).

## Sammendragsmodus

Over 5 000 instanser beholder en sky tall og rader i stedet for en serie per instans. Ved den størrelsen er disse seriene mesteparten av regningen, med omtrent 17 GB per dag mot 4 GB for alt annet, og de sier det radene og tallene allerede gjør.

**Hva den beholder:**

- En rad for hver del, på hver side og liste, holdt oppdatert. Statusendringer når den som vanlig.
- Hver serie for hypervisorer, arbeidere, nettverk, rutere, flytende IP-er, adressepooler og lagringspooler.
- `openstack_nova_instances_by_status` og `openstack_nova_instances_by_project`, i hver region.
- Seriene til enhver instans eller ethvert volum i en tilstand et varsel overvåker: i `ERROR`, eller fast i `BUILD`, `RESIZE`, `attaching` og lignende. Så hver [varselmal](/docs/monitor/openstack-monitor#ferdige-varselmaler) fortsetter å fungere, og fortsetter å komme seg av seg selv.

**Hva den gir avkall på:**

- Historikken for hver stabile instans' og hvert stabile volums status, og et diagram eller en overvåker over disse seriene. `openstack_nova_server_status`, `openstack_cinder_volume_gb` og `openstack_cinder_volume_status` stopper for en del når den er stabil. En overvåker som trenger én instans, bør velge prosjektet sitt, nedenfor.
- `openstack_placement_resource_provider_allocations` og `openstack_nova_server_local_gb`, uansett hvem de tilhører. En sonde slutter helt å spørre Placement om allokeringer.

**For å beholde en instans' serier likevel**, åpne skyens **Innstillinger**, og deretter **Faktisk bruk per instans**. **Bare prosjektene og aggregatene jeg velger** beholder hver instans og hvert volum i de prosjektene, uansett hvor stor skyen er. **Hver instans** slår sammendragsmodus av for hele skyen. En sonde nekter det over omtrent 480 MiB med målinger per innsamling, i stedet for å holde det i minnet: bruk agenten for en slik sky.

**Gjennom en sonde** er det en forskjell til. Over sammendragsstørrelsen leser den alt hver gang, og sender bare det som er endret, det noen valgte, det et varsel overvåker og en andel av resten. Hver del kommer rundt én gang per syklus, dimensjonert slik at en innsamlings opplasting holder seg på omtrent 24 MiB utover seriene som går hver gang: 6 minutter ved 20 000 instanser, 44 ved 200 000. **Datainnsamling**-kortet sier hvor lang syklusen er. To ting følger av det:

- **En ny skys lister fylles ut i løpet av første syklus.** Den første innsamlingen vet hva skyen holder, og kortet sier det med en gang, men radene kommer en andel om gangen. Det samme gjelder en sonde som har startet på nytt, selv om radene den la igjen, blir stående på sidene i mellomtiden. Kortet sier når alle vil ha kommet.
- **En del som er borte, blir stående på listen en liten stund til.** Den forsvinner innen 15 minutter etter at ingenting rapporterer den, pluss syklusen, pluss to avlesninger. Altså 15 minutter og noen få på de fleste skyer, og drøyt en time ved 200 000 instanser. En del som fortsatt er der, fjernes aldri. En mislykket avlesning fjerner ingenting, uansett hvor lenge den varer.

## Dele en sky mellom innsamlere

Én agent leser en sky uansett hvor mange regioner den har, og det er det du bør starte med. Når én er for mye for maskinen den kjører på eller for en skrapings tid, gi hver agent en andel. Hver av dem sender til den samme OneUptime-skyen under samme `OPENSTACK_CLOUD_NAME`. To regler hindrer at et diagram og en regning leser dobbelt:

- **Hvert par av en region og en tjeneste tilhører én agent.** En rad er den samme raden uansett hvor mange agenter som rapporterer den, men hver agents serier lagres og faktureres.
- **Keystone tilhører én agent.** Den er én for hele skyen, uansett hvilken region som spør den.

**Én agent per region** er det de fleste skyer vil ha. List bare den regionens oppføringer i `clouds.yaml` og `OPENSTACK_EXPORTER_CLOUDS`. Bare den første agenten beholder Keystone:

```bash
# On the agent for RegionOne, in .env
OPENSTACK_CLOUD_NAME=prod
OPENSTACK_EXPORTER_CLOUDS=[RegionOne]

# On the agent for RegionTwo
OPENSTACK_CLOUD_NAME=prod
OPENSTACK_EXPORTER_CLOUDS=[RegionTwo]
OPENSTACK_AGENT_SERVICES=compute|placement|network|volume|image
```

**Én agent per tjeneste** er for de største skyene, der én tjenestes lister er det en skraping ikke rekker å fullføre. `OPENSTACK_AGENT_SERVICES` beholder jobbene den navngir, og overlater resten til en annen agent:

```bash
# Nova and Placement, which take the most
OPENSTACK_AGENT_SERVICES=compute|placement

# And everything else
OPENSTACK_AGENT_SERVICES=identity|network|volume|image
```

Sett `OPENSTACK_AGENT_MEMORY_LIMIT_MIB` på en agent som holder en stor andel: den holder en skraping i minnet på vei ut, og standarden er 512 MiB. En rad garanteres av sin egen tjeneste i sin egen region, så en agent som stopper tar ingenting av det en annen agent leser. Navngi det en sky hviler på, `OPENSTACK_RABBITMQ_TARGETS` og [de andre av samme slag](/docs/telemetry/openstack#miljøvariabler), på bare én agent. Hvis den agenten stopper mens de andre fortsetter, forsvinner disse maskinene fra sidene etter 15 minutter, og kommer tilbake når den gjør det.

**Med sonder** har en sky én sonde. Gi en region en egen sonde ved å koble den til som en egen sky, med bare den regionen valgt: ingenting telles to ganger, fordi hver leser bare sin egen region, og hver leser Keystone for seg selv. Hver er da en egen sky i OneUptime, med egne sider og egne varsler.

## Databaseveien

Over **1 500 hypervisorer eller 100 000 instanser** kan agenten lese en skys databaser i stedet for API-ene, med [`openstack_database_exporter`](https://github.com/vexxhost/openstack_database_exporter). Ved den størrelsen går en skraping av API-ene tom for tid, og avlesninger som ikke rekker å fullføres, er last for ingenting. En databaseavlesning koster API-ene ingenting. Den tilbys bare over den størrelsen, fordi under den svarer API-ene bra nok og denne veien gir avkall på ting.

**Hva den krever av deg:**

- En skrivebeskyttet konto på hver tjenestes database: Nova, Nova API, Placement, Neutron, Cinder, Glance og Keystone. En database som utelates, er en tjeneste den lar være i fred.
- En rute fra agentens maskin til disse databasene, som på de fleste skyer holdes godt unna alt annet. Det er én ting til som kan lese hvert prosjekts poster.
- Én eksportør per region, og per Nova-celle. Den leser det du peker den mot, og en andre celle trenger en andre eksportør.
- At skjemaene følger utgaven din. Den leser hver tjenestes tabeller direkte, så en oppgradering av OpenStack kan endre hva den kan lese før en ny versjon av eksportøren gjør det.

**For å slå den på**, i `.env`:

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

**Hva den dekker.** De samme seriene under de samme navnene, så hver side, overvåker og varselmal leser dem på samme måte. En test holder dem til API-eksportørens, navn for navn og etikett for etikett.

**Hva den ikke dekker:**

| Hva | Hvorfor, og hva som skjer i stedet |
| --- | --- |
| Om hver Nova-arbeider er i live | Dens `openstack_nova_agent_state` viser 1 for enhver aktivert tjeneste, så en stoppet `nova-compute` ville vises som oppe. Agenten dropper den serien, og leser den fra Novas API, som er én liten liste |
| Hvor full hver lagringspool er | Hver backend rapporterer det til Cinders scheduler, og det er ikke i databasen. Agenten leser det fra Cinders API, som er ett kall til |
| Et nettverks MTU | Vises som ikke kjent |
| `openstack_placement_resource_provider_allocations`, en leverandørs generasjon | Ingenting leser dem |
| Kvoter og grenser per prosjekt | Den kan lese dem, og ved 10 000 prosjekter er det 790 000 datapunkter per skraping, så agenten utelater dem. Slett den regelen i `otel-collector-config.yaml` for å beholde dem |
| Om et API svarer | `openstack_<service>_up` sier om databasen gjør det. Et stoppet API med en frisk database vises som oppe, så overvåk selve API-ene med en [nettstedsovervåker](/docs/monitor/website-monitor) |

**Hvor langt dette er bevist.** Seriene ble lest fra eksportørens kildekode og dens egne tester ved taggen agenten fester, og hver stemmer med det OneUptime leser. Den er ikke kjørt her mot en ekte database.

## Hva den største størrelsen ble holdt til

Den virkelige innsamleren leste et mock-API med 5 000 hypervisorer, 200 000 instanser og 10 000 prosjekter hvert andre minutt i 60 minutter, på en virkelig klokke. Det den sendte, gikk gjennom den virkelige foldingen og de virkelige skrivingene inn i en virkelig Postgres, med Oversiktens avlesninger og opprydningen av utdaterte rader kjørende ved siden av hvert 30. sekund, og 200 instanser som endret seg ved hver innsamling. Hvert budsjett nedenfor er hevdet, og en kjøring som bommer på ett, feiler.

| Hva | Budsjett | Målt |
| --- | --- | --- |
| Forespørsler per minutt, slik de ble stilt til hver tjeneste | Nøyaktig det innsamlerens tidsplan sier, tjeneste for tjeneste | Nøyaktig. Keystone 1,3, Nova 25,1, Placement 1 166, Neutron 43,5, Cinder 62,4, Glance 0,5 |
| Innsamlinger hoppet over fordi den forrige fortsatt kjørte | Ingen | 0 av 30 |
| Inntaksforsinkelse, fra en innsamling starter til siste rad er skrevet | Under 2 minutter | 37 s i median, 112 s i verste fall |
| En Oversikt som åpnes, hver avlesning den gjør samtidig | Under 6 sekunder | 0,6 s i median, 4,1 s i verste fall, og 5 008 byte med det som trenger oppmerksomhet |
| Det lengste noen skriver ventet på en lås på inventartabellen | Under 5 sekunder | 0,0 s, i 2 739 kikk én gang i sekundet |
| Deler slettet som fortsatt var der | Ingen | 0 |

Og hva det tok, som ikke har noe budsjett: 73 MiB med målinger per innsamling før komprimering, i opptil 2 opplastinger, 14 s av denne prosessens CPU per innsamling for å lese, sende og skrive til sammen, og høyst 998 MiB JavaScript-heap. En sonde som samler inn en sky av denne størrelsen, trenger det minnet i tillegg til det andre arbeidet sitt.

Dette kjørte på en Mac med 10 kjerner, delt med annet arbeid ved et gjennomsnittlig lastnivå på omtrent 33, og PostgreSQL 14 på samme maskin, så tidene er hva en travel maskin klarte, ikke hva en server ville gjort. Det ble målt 2026-11-05. En times forespørsler inneholder den første innsamlingen, som spør Placement om hver hypervisors inventar, så de ligger litt over [tabellen](#gjennom-en-sonde) for en stabilisert en, og 200 instanser som endrer seg ved hver innsamling er resten av det Novas avlesninger der utgjør.

Marginen er ikke bred på en så travel maskin. En tidligere time, ved et gjennomsnittlig lastnivå på omtrent 42 som nådde 95, kjørte så langt som til at én innsamlings siste rad landet ved 124 sekunder, så den neste innsamlingen ble hoppet over, og alle andre budsjetter holdt.

**Hva dette utelater.** Mocken svarer med en gang, så dette sier ingenting om hvor raske API-ene dine er: [hva en innsamlings tid tillater](#gjennom-en-sonde) handler om det. Det utelater HTTP-serveren og køen mellom en sonde og inntaket, og ClickHouse, så et diagrams eller en overvåkers avlesning av seriene er ikke med her, bare inventarets skrivinger og avlesninger. Radene har samme form som en virkelig DevStacks, og tallene er funnet på. Ingen sky av denne størrelsen har kjørt mot det.

## Hva sidene leser

En stor skys sider leses like raskt som en liten skys, fordi ingen av dem leser hele skyen.

| Side | Hva den leser |
| --- | --- |
| **Oversikt** | Tall regnet ut på serveren, og radene som kan trenge noen. Over 1 000 verter eller arbeidere telles resten bare, så det den henter, holder seg under en megabyte uansett hvor stor skyen er |
| **Tjenester** | Det samme: et kort for hver tjeneste, det som trenger noen først, og hvor mange andre som er i orden. Et søk spør serveren, så det finner enhver vert |
| Lister | En side om gangen, hver fra siste rad på siden før. Et hopp til en fjern side går via offset, som på siste side av 200 000 rader tar sekunder i stedet for et millisekund |
| **Topologi** | Over 5 000 deler, strukturen, det som har feilet og det det tar med seg. Den sier hva den utelot |
| **Inventarskrivinger** | Høyst 500 rader per setning, og 5 000 per sletting, hver i sin egen transaksjon, så ingen skriver venter lenge på en annen. En rad ingenting er endret på, skrives ikke om på opptil 5 minutter, noe som kutter write-ahead-loggen mer enn tjuefold |

## Bruk og utgifter

En skys [Utgifter-side](/docs/telemetry/openstack#forbruk) leser inventarets rader i stedet for noen instans' serier, så den fungerer likt i sammendragsmodus, og kostnaden vokser med prosjekter i stedet for instanser. Den leser én rad av skyen og én side med prosjekter. [Dens egen del](/docs/telemetry/openstack#ved-hver-størrelse) har tallene ved hver størrelse.

## Neste steg

:::cards
- [OpenStack-agent](/docs/telemetry/openstack): Installer agenten.
- [OpenStack uten agent](/docs/telemetry/openstack-agentless): Samle inn en sky med en sonde.
- [OpenStack-overvåker](/docs/monitor/openstack-monitor): Varsle om det som kommer inn.
:::
