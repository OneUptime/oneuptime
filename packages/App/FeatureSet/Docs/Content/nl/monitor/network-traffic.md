# Netwerkverkeer (NetFlow, IPFIX en sFlow)

Routers, firewalls en switches kunnen het verkeer dat erdoorheen gaat beschrijven als **flowrecords**: wie met wie sprak, via welk protocol en welke poorten, via welke interfaces en met hoeveel bytes. Richt die export op een OneUptime-probe en de **Verkeer**-pagina's laten zien waar je verkeer naartoe gaat: de drukste adressen, gesprekken, applicaties en interfaces, over elke periode.

Er is op drie plekken een Verkeer-pagina:

- **Netwerk** -> **Verkeer**: het hele netwerk, de flows van elk apparaat op één pagina, en elk adres dat flows verstuurt zonder al een apparaat te zijn.
- De **Verkeer**-pagina van een locatie: de apparaten op die locatie.
- Het **Verkeer**-tabblad van een apparaat: dat ene apparaat, met zijn interfaces. Pakketcaptures die op de probe van het apparaat draaien, staan onder de flows, voor als je de pakketten zelf nodig hebt.

Een Cisco Meraki-omgeving is ook te lezen zonder iets te exporteren: koppel het Meraki-dashboard, en de Verkeer-pagina's tonen de uplinks, applicaties en clients van de appliances zoals Meraki ze rapporteert. Zie [Cisco Meraki zonder NetFlow](#cisco-meraki-zonder-netflow).

## Wat de Verkeer-pagina laat zien

- Vier getallen voor de periode: **Verkeer** (bytes), de **Gemiddelde** en de **Piek**-snelheid, en **Flows** (hoeveel flowrecords de apparaten stuurden).
- **Verkeer in de tijd**, in bits per seconde. Sleep over de grafiek om in te zoomen op een stuk; dubbelklik erop, of gebruik **Zoom resetten**, om terug te gaan.
- **Topbronnen** en **Topbestemmingen**: de tien adressen die het meest verstuurden en ontvingen.
- **Topapplicaties**: het verkeer per protocol en servicepoort, genoemd naar de dienst die meestal op die poort draait (HTTPS is TCP-poort 443).
- **Topinterfaces** op de pagina van een apparaat: wat er via elke interface binnenkwam en uitging, met de naam en snelheid uit de SNMP-walk van het apparaat. **Topapparaten** op de pagina van een locatie en op die van het netwerk.
- **Topgesprekken**: de tien drukste adresparen, getekend als diagram van afzenders naar ontvangers, of als lijst.

Klik op een rij - een adres, een applicatie, een interface, een apparaat, een band van het diagram - en de hele pagina beperkt zich tot dat verkeer. Een chip boven de pagina zegt waartoe ze beperkt is; klik op het kruisje om haar weer te verbreden. **Een IP-adres zoeken** beperkt de pagina tot het verkeer naar of van één adres. De periode en de filters staan in het adres van de pagina, dus een link opent precies dezelfde weergave.

## Hoe de flows hier komen

Elke probe draait een flowcollector. Die luistert op drie UDP-poorten, en elke poort leest elk formaat:

| Poort    | Meestal gebruikt voor       |
| -------- | --------------------------- |
| UDP 2055 | NetFlow v5, NetFlow v9      |
| UDP 4739 | IPFIX                       |
| UDP 6343 | sFlow v5                    |

De probe decodeert de records, vermenigvuldigt gesamplede aantallen terug met de samplingfactor, telt de records van één gesprek om de paar seconden op en stuurt ze naar OneUptime. Elk record wordt aan een apparaat gekoppeld op basis van het adres waarvandaan het apparaat het stuurt - bij sFlow het agentadres in het datagram:

1. een apparaat dat de probe bevraagt en waarvan de hostnaam dat adres is (of ernaar resolvet), of dat het vermeldt onder **Overige adressen** op zijn **Instellingen**-pagina;
2. op je eigen (aangepaste) probe, elk apparaat in het project met dat adres als hostnaam of onder zijn overige adressen;
3. anders worden de flows op je eigen probe bewaard voor de Verkeer-pagina van het netwerk, onder **Afzenders van flows**, tot je zegt bij welk apparaat ze horen. Een globale probe gooit ze weg.

Flows worden 30 dagen bewaard, en één pagina toont hooguit 31 dagen.

## Instellen

1. **Gebruik een probe in het netwerk van het apparaat.** Flows zijn UDP-datagrammen die je apparaten versturen, dus ze hebben een [aangepaste probe](/docs/probe/custom-probe) nodig die ze kunnen bereiken. Een globale probe op het openbare internet ontvangt ze niet.
2. **Laat de datagrammen de probe bereiken.** Sta UDP 2055, 4739 en 6343 toe van de apparaten naar de probe. Een probe in Docker die met hostnetwerk (`--network host`) is gestart, zoals de pagina over de aangepaste probe laat zien, ontvangt ze zoals hij is; zonder hostnetwerk publiceer je de poorten met `-p 2055:2055/udp -p 4739:4739/udp -p 6343:6343/udp`.
3. **Schakel flowexport in op het apparaat** en stuur die naar het IP-adres van de probe. De commando's voor gangbare apparaten staan hieronder. Het eigen **Verkeer**-tabblad van het apparaat toont dezelfde stappen met de poorten van de probe tot de eerste flow binnenkomt.
4. **Controleer het adres van het apparaat.** Records worden gekoppeld op basis van het adres waarvandaan het apparaat verstuurt. Verstuurt het vanaf een loopback of een beheerinterface die niet zijn hostnaam is, voeg dat adres dan toe aan de **Overige adressen** van het apparaat.

De collector staat standaard aan. De instellingen zijn omgevingsvariabelen van de probe:

| Variabele                           | Wat ze doet                                                         | Standaard |
| ----------------------------------- | ------------------------------------------------------------------- | ------- |
| PROBE_NETFLOW_RECEIVER_ENABLED      | Zet op `false` om de flowcollector uit te schakelen                 | true    |
| PROBE_NETFLOW_RECEIVER_PORT         | De NetFlow-poort; `0` stopt met luisteren erop                      | 2055    |
| PROBE_IPFIX_RECEIVER_PORT           | De IPFIX-poort; `0` stopt met luisteren erop                        | 4739    |
| PROBE_SFLOW_RECEIVER_PORT           | De sFlow-poort; `0` stopt met luisteren erop                        | 6343    |
| PROBE_NETFLOW_RATE_LIMIT_PER_MINUTE | Geaccepteerde datagrammen per minuut, over alle apparaten en poorten | 6000    |

Die 6.000 datagrammen per minuut worden gedeeld door alle apparaten die naar de probe exporteren. Met honderden apparaten verhoog je `PROBE_NETFLOW_RATE_LIMIT_PER_MINUTE` of verdeel je de apparaten over meerdere probes: datagrammen boven de limiet worden weggegooid, en het logboek van de probe zegt hoeveel (zie [Problemen oplossen](#problemen-oplossen)). Een Meraki-omgeving heeft helemaal geen export nodig: zie [Cisco Meraki zonder NetFlow](#cisco-meraki-zonder-netflow).

### Cisco IOS XE (Flexible NetFlow)

Exporteert IPFIX naar UDP 4739. Voeg de laatste regel toe aan elke interface waarvan je het verkeer wilt zien: door het verkeer te meten terwijl het op elke interface binnenkomt, telt elk gesprek één keer.

```text
flow exporter ONEUPTIME
 destination <probe-address>
 source Loopback0
 transport udp 4739
 export-protocol ipfix
 template data timeout 60
 option interface-table
 option sampler-table
!
flow monitor ONEUPTIME
 exporter ONEUPTIME
 cache timeout active 60
 record netflow ipv4 original-input
!
interface GigabitEthernet0/0/0
 ip flow monitor ONEUPTIME input
```

### Cisco IOS (NetFlow v9)

Exporteert NetFlow v9 naar UDP 2055.

```text
ip flow-export version 9
ip flow-export destination <probe-address> 2055
ip flow-export source Loopback0
ip flow-export template timeout-rate 1
ip flow-cache timeout active 1
!
interface GigabitEthernet0/0
 ip flow ingress
```

### Arista EOS (sFlow)

Exporteert sFlow naar UDP 6343. sFlow samplet één pakket op de N (hier 16384), en de Verkeer-pagina's vermenigvuldigen de samples terug, dus de getallen zijn schattingen.

```text
sflow sample 16384
sflow destination <probe-address> 6343
sflow source-interface Loopback0
sflow run
```

### Cisco Meraki MX en Z

MX-appliances en teleworker-gateways uit de Z-serie exporteren NetFlow v9 vanuit het Meraki-dashboard:

1. Open **Network-wide** > **General** en zoek **Reporting**.
2. Zet **NetFlow traffic reporting** op **Enabled: send NetFlow traffic statistics**.
3. Voer het IP-adres van de probe in als **NetFlow collector IP** en `2055` als **NetFlow collector port**, en sla op.

Een MX of Z ziet alleen het verkeer dat erdoorheen gaat. Verkeer dat een switch binnen een VLAN houdt, bereikt hem nooit, dus dat staat niet in de export.

Om elke locatie te lezen zonder elke MX in te stellen, koppel je in plaats daarvan het Meraki-dashboard: zie [Cisco Meraki zonder NetFlow](#cisco-meraki-zonder-netflow). Dat verkeer heeft geen gesprekken, dus de twee vullen elkaar goed aan.

### Juniper (inline J-Flow)

Exporteert IPFIX naar UDP 4739 vanaf MX-routers; gebruik de FPC die de interfaces draagt die je samplet.

```text
set services flow-monitoring version-ipfix template ONEUPTIME ipv4-template
set services flow-monitoring version-ipfix template ONEUPTIME flow-active-timeout 60
set services flow-monitoring version-ipfix template ONEUPTIME template-refresh-rate seconds 60
set chassis fpc 0 sampling-instance ONEUPTIME
set forwarding-options sampling instance ONEUPTIME input rate 1
set forwarding-options sampling instance ONEUPTIME family inet output flow-server <probe-address> port 4739
set forwarding-options sampling instance ONEUPTIME family inet output flow-server <probe-address> version-ipfix template ONEUPTIME
set forwarding-options sampling instance ONEUPTIME family inet output inline-jflow source-address <device-address>
set interfaces ge-0/0/0 unit 0 family inet sampling input
```

### Fortinet FortiGate

Exporteert NetFlow v9 naar UDP 2055. Vanaf FortiOS 7.2 is de collector een item onder `config collectors` binnen `config system netflow`.

```text
config system netflow
    set collector-ip <probe-address>
    set collector-port 2055
    set template-tx-timeout 60
end
config system interface
    edit "port1"
        set netflow-sampler both
    next
end
```

### Palo Alto Networks

1. Voeg onder **Device** > **Server Profiles** > **NetFlow** een profiel toe met het IP-adres van de probe en poort `2055`, en zet de **Active Timeout** op 1 minuut.
2. Open onder **Network** > **Interfaces** elke interface waarvan je het verkeer wilt zien en kies het profiel als **NetFlow Profile** op het tabblad **Advanced**.
3. Voer een commit uit.

### MikroTik RouterOS 7

```text
/ip traffic-flow set enabled=yes interfaces=all active-flow-timeout=1m
/ip traffic-flow target add dst-address=<probe-address> port=2055 version=9
```

### pfSense en Linux-hosts

Installeer op pfSense het pakket **softflowd** en kies onder **Services** > **softflowd** de interfaces, voer het IP-adres van de probe en poort `2055` in, en kies NetFlow-versie 9. Draai op een Linux-host softflowd op de interface waarvan je het verkeer wilt zien:

```bash
softflowd -i eth0 -n <probe-address>:2055 -v 9 -t maxlife=60
```

### Andere apparaten

Stuur NetFlow v5, NetFlow v9 of IPFIX naar het IP-adres van de probe op UDP 2055 (of 4739), of sFlow v5 op UDP 6343. Zet de actieve flowtime-out van het apparaat op 60 seconden en stuur voor NetFlow v9 en IPFIX de templates elke 60 seconden. De [netwerkleveranciershandleidingen](/docs/monitor/network-vendor-guides) behandelen Sophos en Extreme Networks.

## Cisco Meraki zonder NetFlow

Een Meraki-omgeving heeft een tweede ingang, zonder iets op de apparaten in te stellen en zonder probe ertussen: OneUptime leest het verkeer van de organisatie via de Meraki-dashboard-API. Dat past bij honderden of duizenden locaties, waar NetFlow op elke MX instellen het lastige deel is.

Kies op **Netwerk** -> **Verkeer** voor **Meraki koppelen**:

1. **API-sleutel.** Maak er een in het Meraki-dashboard onder **Organization** > **API & Webhooks** > **API keys and access**. De sleutel van een beheerder met alleen-lezentoegang is genoeg. OneUptime bewaart hem versleuteld, toont hem nooit meer en stuurt hem nergens anders heen dan naar de Meraki-dashboard-API van de regio van de sleutel. Meld je je ergens anders dan op dashboard.meraki.com aan bij Meraki, kies dan de **Dashboardregio** onder **Meer velden**: het dashboard voor Canada, China, India of het FedRAMP-dashboard van de Verenigde Staten.
2. **Organisatie.** De sleutel wordt getest zodra de stap opent: de organisaties die hij kan lezen worden vermeld, en voor de organisatie die je kiest telt het venster de netwerken en de MX- en Z-appliances die een leesbeurt dekt, voordat er iets wordt opgeslagen.

De eerste leesbeurt begint binnen een minuut en haalt de laatste dag op. Vanaf dan hebben de Verkeer-pagina's een schakelaar **Flows** | **Meraki** in hun kop: een pagina met flowrecords opent daarop, zoals voorheen, en een pagina met alleen Meraki-verkeer opent op Meraki.

| Op de pagina | Wat Meraki rapporteert | Hoe vaak het wordt gelezen |
| --- | --- | --- |
| De vier getallen, de grafiek, **Topnetwerken** en **Uplinks** | Het uplinkgebruik van elke MX- en Z-appliance (wan1, wan2, cellular), voor de hele organisatie in één aanroep | Standaard elke 5 minuten, tot elk uur, in vensters van vijf minuten |
| **Topapplicaties** en **Topbestemmingen** | De verkeersanalyses van elk netwerk | Elke twee uur: Meraki telt ze op over twee uur of meer |
| **Topclients** | De clients van elk netwerk en wat ze gebruikten | Elke twee uur, samen met de applicaties |

Een klik op een netwerk beperkt de pagina tot dat netwerk en toont de uplinks ervan. Het verkeer van een appliance hoort bij zijn apparaat in OneUptime als een apparaat het serienummer of MAC-adres van de appliance heeft: het verschijnt dan ook op de Verkeer-pagina's van dat apparaat en zijn locatie. Het verkeer van een appliance die in OneUptime geen apparaat is, verschijnt op de pagina van het netwerk.

Meraki geeft elke organisatie 10 API-verzoeken per seconde, gedeeld door alle applicaties die haar lezen. OneUptime gebruikt er hoogstens 3, gaat langzamer als Meraki daarom vraagt en stopt een leesbeurt na 900 verzoeken of 6 minuten; de volgende gaat een minuut later verder. Bij een organisatie met 1.200 netwerken worden de uplinks gelezen met één aanroep per venster, en de applicaties en clients van de netwerken verspreid over een paar leesbeurten.

De koppelingen staan onderaan de Verkeer-pagina van het netwerk, onder **Meraki**, elk met hoe het ermee gaat en wat de laatste leesbeurt dekte. Elke koppeling heeft één knop voor de volgende stap: **Nu lezen** leest hem direct, **Inschakelen** zet hem weer aan als hij uit staat, en **API-sleutel bijwerken** vervangt een sleutel die Meraki weigerde en test de nieuwe sleutel voordat die wordt opgeslagen. Het menu heeft **Bewerken** (de naam, hoe vaak de uplinks worden gelezen, een nieuwe sleutel), **Uitzetten** en **Verwijderen**. Een mislukte leesbeurt zegt waarom, daar en boven het verkeer: een geweigerde sleutel, een sleutel die de organisatie niet kan lezen, Meraki dat OneUptime vraagt langzamer te gaan, of netwerken waarvan de verkeersanalyse uit staat. Boven het verkeer leidt **Bekijken** naar de koppeling. Alleen projecteigenaren en projectbeheerders kunnen Meraki koppelen en een koppeling wijzigen of lezen.

De Meraki-dashboard-API rapporteert totalen, nooit wie met wie sprak, dus de Meraki-kant heeft geen gesprekken. Om ze te zien stuur je ook NetFlow vanaf de MX-appliances ([Cisco Meraki MX en Z](#cisco-meraki-mx-en-z)): de pagina heeft dan allebei, één schakelaar van elkaar.

## Adressen die nog geen apparaten zijn

Flows kunnen binnenkomen voordat het apparaat dat ze verstuurt aan OneUptime is toegevoegd. Op je eigen probe worden ze bewaard, en de Verkeer-pagina van het netwerk vermeldt hun adres onder **Afzenders van flows**, gemarkeerd als **Nog geen apparaat**:

- **Toevoegen als apparaat** opent Apparaat toevoegen met het adres en de probe al ingevuld. De flows die al binnen zijn, blijven op de pagina van het netwerk; nieuwe gaan naar het apparaat.
- **Het is een van mijn apparaten** voegt het adres toe aan de **Overige adressen** van een apparaat: gebruik dit als een apparaat dat je al hebt toegevoegd vanaf een ander adres verstuurt, zoals een loopback. De flows ervan gaan vanaf de volgende minuut naar dat apparaat.

Meerdere apparaten achter één NAT-adres delen dat adres, dus hun flows gaan naar het ene apparaat dat het heeft.

## De getallen lezen

- **Sampling.** Een apparaat dat samplet - sFlow doet dat altijd, NetFlow of IPFIX kunnen het - meldt één pakket op de N. De probe vermenigvuldigt de aantallen met N, dus de pagina toont schattingen en zegt dat onder de vier getallen. Ze zijn nauwkeurig bij veel verkeer en grof bij een paar pakketten.
- **Dubbel geteld.** Verkeer dat door twee exporterende apparaten gaat, wordt door beide gemeld. De pagina van een apparaat telt het één keer; de pagina van een locatie of van het netwerk telt het één keer per apparaat dat het meldde.
- **Applicaties.** Een applicatie is het protocol en de servicepoort, genoemd naar de dienst die meestal op die poort draait. Het is geen deep packet inspection: HTTPS op poort 9443 verschijnt als TCP-poort 9443. De kortstondige poort van de client wordt weggelaten, dus duizend browserverbindingen naar één server zijn één applicatie.
- **Piek** is de snelheid van het drukste deel van de grafiek, dus een kortere periode, met kortere delen, toont een scherpere piek. **Gemiddelde** zijn de bytes over de hele periode.
- **Tijd.** Een flow telt in het deel waarin hij begon. Een lange download wordt gemeld als meerdere flows, één voor elke minuut dat hij loopt; daarom hoort de actieve time-out van de apparaten 60 seconden te zijn.

## Wat er niet bij zit

- **Waarschuwingen op flows.** Er is nog geen monitor op basis van flows. Gebruik voor een drukke verbinding de waarschuwingen voor interfacebenutting van de [netwerkapparaatmonitor](/docs/monitor/network-device-monitor), die SNMP lezen.
- **Applicatienamen voorbij de poort.** Er is geen deep packet inspection, en Cisco NBAR-applicatienamen worden niet gelezen.
- **Gesprekken uit de Meraki-dashboard-API.** Die rapporteert totalen, niet wie met wie sprak: stuur ook NetFlow vanaf de MX-appliances om gesprekken te zien.
- **Anomaliedetectie** op verkeer.
- **Interfacenamen uit flowrecords.** Namen en snelheden van interfaces komen uit de SNMP-walk van het apparaat; een apparaat zonder walk toont interfacenummers.

## Problemen oplossen

Als de Verkeer-pagina nog steeds de installatiestappen toont:

- **Ontvangt de probe iets?** De Verkeer-pagina van het netwerk vermeldt onder **Afzenders van flows** elk adres dat het afgelopen uur flows stuurde. Staat het apparaat daar als **Nog geen apparaat**, dan verstuurt het vanaf een adres dat niet zijn hostnaam is: voeg dat adres toe aan zijn **Overige adressen**.
- **Firewalls en Docker.** Sta UDP 2055, 4739 en 6343 toe van het apparaat naar de probe, en publiceer de poorten als de probe in Docker draait.
- **Het logboek van de probe.** Eén keer per minuut logt de probe wat hij niet kon lezen: datagrammen in een niet-ondersteund formaat (NetFlow v1, v6, v7 of v8, of sFlow van vóór versie 5), misvormde datagrammen, data die op een template wacht, en datagrammen die boven `PROBE_NETFLOW_RATE_LIMIT_PER_MINUTE` zijn weggegooid.
- **Templates.** NetFlow v9 en IPFIX sturen de opbouw van hun records als templates. De probe houdt data die vóór het template binnenkomt tot 10 minuten vast; laat het apparaat zijn templates elke 60 seconden sturen, zodat de pagina binnen een minuut gevuld is.
- **Een globale probe.** Een apparaat dat door een globale probe wordt bevraagd, kan er vanuit een privénetwerk geen flows naartoe sturen. Draai een aangepaste probe in het netwerk van het apparaat en kies die in de instellingen van het apparaat.

Als een Meraki-koppeling zegt dat ze niet kan lezen:

- **De sleutel wordt geweigerd.** Kopieer hem opnieuw uit het Meraki-dashboard en controleer de **Dashboardregio**: een sleutel leest alleen het dashboard waarin hij is gemaakt. Plak de nieuwe sleutel met **API-sleutel bijwerken** bij de koppeling.
- **De sleutel kan de organisatie niet lezen.** Zet API-toegang voor de organisatie aan onder **Organization** > **API & Webhooks**, of gebruik de sleutel van een van haar beheerders.
- **Geen applicaties op sommige netwerken.** Hun verkeersanalyse staat uit: zet die aan onder **Network-wide** > **General** > **Traffic analysis**.
- **Meraki vroeg OneUptime langzamer te gaan.** Andere applicaties gebruiken het API-budget van de organisatie. OneUptime leest langzamer en gaat door.
- **Deze OneUptime bereikt de API niet.** Sta HTTPS (poort 443) toe van de servers van OneUptime naar `api.meraki.com`, of de API-host van je regio.
