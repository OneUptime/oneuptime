# Netwerkverkeer (NetFlow, IPFIX en sFlow)

Routers, firewalls en switches kunnen het verkeer dat erdoorheen gaat beschrijven als **flowrecords**: wie met wie sprak, via welk protocol en welke poorten, via welke interfaces en met hoeveel bytes. Richt die export op een OneUptime-probe en de **Verkeer**-pagina's laten zien waar je verkeer naartoe gaat: de drukste adressen, gesprekken, applicaties en interfaces, over elke periode.

Er is op drie plekken een Verkeer-pagina:

- **Netwerk** -> **Verkeer**: het hele netwerk, de flows van elk apparaat op één pagina, en elk adres dat flows verstuurt zonder al een apparaat te zijn.
- De **Verkeer**-pagina van een locatie: de apparaten op die locatie.
- Het **Verkeer**-tabblad van een apparaat: dat ene apparaat, met zijn interfaces. Pakketcaptures die op de probe van het apparaat draaien, staan onder de flows, voor als je de pakketten zelf nodig hebt.

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
- **De Meraki Dashboard API.** Meraki-verkeersanalyses worden niet geïmporteerd; MX- en Z-appliances sturen in plaats daarvan NetFlow naar de probe.
- **Anomaliedetectie** op verkeer.
- **Interfacenamen uit flowrecords.** Namen en snelheden van interfaces komen uit de SNMP-walk van het apparaat; een apparaat zonder walk toont interfacenummers.

## Problemen oplossen

Als de Verkeer-pagina nog steeds de installatiestappen toont:

- **Ontvangt de probe iets?** De Verkeer-pagina van het netwerk vermeldt onder **Afzenders van flows** elk adres dat het afgelopen uur flows stuurde. Staat het apparaat daar als **Nog geen apparaat**, dan verstuurt het vanaf een adres dat niet zijn hostnaam is: voeg dat adres toe aan zijn **Overige adressen**.
- **Firewalls en Docker.** Sta UDP 2055, 4739 en 6343 toe van het apparaat naar de probe, en publiceer de poorten als de probe in Docker draait.
- **Het logboek van de probe.** Eén keer per minuut logt de probe wat hij niet kon lezen: datagrammen in een niet-ondersteund formaat (NetFlow v1, v6, v7 of v8, of sFlow van vóór versie 5), misvormde datagrammen, data die op een template wacht, en datagrammen die boven `PROBE_NETFLOW_RATE_LIMIT_PER_MINUTE` zijn weggegooid.
- **Templates.** NetFlow v9 en IPFIX sturen de opbouw van hun records als templates. De probe houdt data die vóór het template binnenkomt tot 10 minuten vast; laat het apparaat zijn templates elke 60 seconden sturen, zodat de pagina binnen een minuut gevuld is.
- **Een globale probe.** Een apparaat dat door een globale probe wordt bevraagd, kan er vanuit een privénetwerk geen flows naartoe sturen. Draai een aangepaste probe in het netwerk van het apparaat en kies die in de instellingen van het apparaat.
