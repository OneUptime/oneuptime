# Nätverkstrafik (NetFlow, IPFIX och sFlow)

Routrar, brandväggar och switchar kan beskriva trafiken som passerar genom dem som **flödesposter**: vem som pratade med vem, över vilket protokoll och vilka portar, genom vilka gränssnitt och med hur många byte. Peka exporten mot en OneUptime-sond så visar **Trafik**-sidorna vart din trafik tar vägen: de mest aktiva adresserna, konversationerna, applikationerna och gränssnitten, över vilket tidsintervall som helst.

Det finns en Trafik-sida på tre ställen:

- **Nätverk** -> **Trafik**: hela nätverket, alla enheters flöden på en sida och varje adress som skickar flöden utan att ännu vara en enhet.
- En plats **Trafik**-sida: enheterna på den platsen.
- En enhets **Trafik**-flik: just den enheten, med dess gränssnitt. Paketinspelningar som körs på enhetens sond visas under flödena, för när du behöver själva paketen.

En Cisco Meraki-miljö kan också läsas utan att exportera något: anslut Meraki-dashboarden, så visar Trafik-sidorna appliancernas uplinks, applikationer och klienter så som Meraki rapporterar dem. Se [Cisco Meraki utan NetFlow](#cisco-meraki-utan-netflow).

## Vad Trafik-sidan visar

- Fyra tal för tidsintervallet: **Trafik** (byte), **Genomsnitt**- och **Topp**-takten samt **Flöden** (hur många flödesposter enheterna skickade).
- **Trafik över tid**, i bitar per sekund. Dra över diagrammet för att zooma in på en del; dubbelklicka på det, eller använd **Återställ zoom**, för att gå tillbaka.
- **Toppkällor** och **Toppmål**: de tio adresser som skickade och tog emot mest.
- **Toppapplikationer**: trafik efter protokoll och tjänsteport, namngiven efter tjänsten som brukar finnas på porten (HTTPS är TCP-port 443).
- **Toppgränssnitt** på en enhets sida: vad som kom in och gick ut genom varje gränssnitt, med namn och hastighet från enhetens SNMP-walk. **Toppenheter** på en plats sida och på nätverkets sida.
- **Toppkonversationer**: de tio mest aktiva adressparen, ritade som ett diagram från avsändare till mottagare, eller som en lista.

Klicka på en rad - en adress, en applikation, ett gränssnitt, en enhet, ett band i diagrammet - så smalnar hela sidan av till den trafiken. En bricka ovanför sidan visar vad den är avsmalnad till; klicka på dess x för att vidga sidan igen. **Sök ett namn eller en IP-adress** smalnar av sidan till trafiken till eller från en adress: skriv adressen, eller en del av dess namn, och välj den om flera passar. Tidsintervallet och filtren sparas i sidans adress, så en länk öppnar exakt samma vy.

En adress som OneUptime känner till visas med sitt namn, med adressen bredvid. Se [Namn i stället för adresser](#namn-i-stället-för-adresser).

## Så kommer flödena hit

Varje sond kör en flödesinsamlare. Den lyssnar på tre UDP-portar, och varje port läser alla format:

| Port     | Används vanligtvis för      |
| -------- | --------------------------- |
| UDP 2055 | NetFlow v5, NetFlow v9      |
| UDP 4739 | IPFIX                       |
| UDP 6343 | sFlow v5                    |

Sonden avkodar posterna, multiplicerar upp samplade värden igen med samplingsfrekvensen, summerar posterna för en konversation med några sekunders mellanrum och skickar dem till OneUptime. Varje post kopplas till en enhet utifrån adressen enheten skickar den från - för sFlow agentadressen i datagrammet:

1. en enhet som sonden pollar vars värdnamn är den adressen (eller slås upp till den), eller som har den under **Övriga adresser** på sin **Inställningar**-sida;
2. på din egen (anpassade) sond, vilken enhet som helst i projektet med adressen som värdnamn eller bland sina övriga adresser;
3. annars sparas flödena på din egen sond för nätverkets Trafik-sida, under **Avsändare av flöden**, tills du anger vilken enhet de hör till. En global sond kastar dem.

Flöden sparas i 30 dagar, och en sida visar högst 31 dagar.

## Konfiguration

1. **Använd en sond i enhetens nätverk.** Flöden är UDP-datagram som dina enheter skickar, så de behöver en [anpassad sond](/docs/probe/custom-probe) som de kan nå. En global sond på det publika internet tar inte emot dem.
2. **Låt datagrammen nå sonden.** Tillåt UDP 2055, 4739 och 6343 från enheterna till sonden. En sond i Docker som startats med värdens nätverk (`--network host`), som sidan om den anpassade sonden visar, tar emot dem som den är; utan värdens nätverk publicerar du portarna med `-p 2055:2055/udp -p 4739:4739/udp -p 6343:6343/udp`.
3. **Aktivera flödesexport på enheten** och skicka den till sondens IP-adress. Kommandona för vanliga enheter finns nedan. Enhetens egen **Trafik**-flik visar samma steg med sondens portar tills det första flödet kommer.
4. **Kontrollera enhetens adress.** Poster kopplas utifrån adressen enheten skickar från. Om den skickar från en loopback eller ett hanteringsgränssnitt som inte är dess värdnamn lägger du till den adressen bland enhetens **Övriga adresser**.

Insamlaren är aktiverad som standard. Dess inställningar är miljövariabler på sonden:

| Variabel                            | Vad den gör                                                         | Standard |
| ----------------------------------- | ------------------------------------------------------------------- | ------- |
| PROBE_NETFLOW_RECEIVER_ENABLED      | Sätt till `false` för att stänga av flödesinsamlaren                | true    |
| PROBE_NETFLOW_RECEIVER_PORT         | NetFlow-porten; `0` slutar lyssna på den                            | 2055    |
| PROBE_IPFIX_RECEIVER_PORT           | IPFIX-porten; `0` slutar lyssna på den                              | 4739    |
| PROBE_SFLOW_RECEIVER_PORT           | sFlow-porten; `0` slutar lyssna på den                              | 6343    |
| PROBE_NETFLOW_RATE_LIMIT_PER_MINUTE | Godkända datagram per minut, över alla enheter och portar           | 6000    |

De 6 000 datagrammen per minut delas av alla enheter som exporterar till sonden. Med hundratals enheter höjer du `PROBE_NETFLOW_RATE_LIMIT_PER_MINUTE` eller fördelar enheterna på flera sonder: datagram över gränsen kastas, och sondens logg säger hur många (se [Felsökning](#felsökning)). En Meraki-miljö behöver ingen export alls: se [Cisco Meraki utan NetFlow](#cisco-meraki-utan-netflow).

### Cisco IOS XE (Flexible NetFlow)

Exporterar IPFIX till UDP 4739. Lägg till den sista raden på varje gränssnitt vars trafik du vill se: när trafiken mäts när den kommer in på varje gränssnitt räknas varje konversation en gång.

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

Exporterar NetFlow v9 till UDP 2055.

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

Exporterar sFlow till UDP 6343. sFlow samplar ett paket av N (här 16384), och Trafik-sidorna multiplicerar upp proverna igen, så siffrorna är uppskattningar.

```text
sflow sample 16384
sflow destination <probe-address> 6343
sflow source-interface Loopback0
sflow run
```

### Cisco Meraki MX och Z

MX-appliances och distansarbets-gateways i Z-serien exporterar NetFlow v9 från Meraki-dashboarden:

1. Öppna **Network-wide** > **General** och hitta **Reporting**.
2. Ställ in **NetFlow traffic reporting** på **Enabled: send NetFlow traffic statistics**.
3. Ange sondens IP-adress som **NetFlow collector IP** och `2055` som **NetFlow collector port**, och spara.

En MX eller Z ser bara trafiken som passerar genom den. Trafik som en switch håller inom ett VLAN når den aldrig, så den finns inte i exporten.

För att läsa varje plats utan att konfigurera varje MX ansluter du i stället Meraki-dashboarden: se [Cisco Meraki utan NetFlow](#cisco-meraki-utan-netflow). Den trafiken har inga konversationer, så de två kompletterar varandra väl.

### Juniper (inline J-Flow)

Exporterar IPFIX till UDP 4739 från MX-routrar; använd den FPC som bär gränssnitten du samplar.

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

Exporterar NetFlow v9 till UDP 2055. I FortiOS 7.2 och senare är insamlaren en post under `config collectors` inuti `config system netflow`.

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

1. Under **Device** > **Server Profiles** > **NetFlow** lägger du till en profil med sondens IP-adress och port `2055`, och ställer in **Active Timeout** på 1 minut.
2. Under **Network** > **Gränssnitt** öppnar du varje gränssnitt vars trafik du vill se och väljer profilen som dess **NetFlow Profile** på fliken **Advanced**.
3. Gör en commit.

### MikroTik RouterOS 7

```text
/ip traffic-flow set enabled=yes interfaces=all active-flow-timeout=1m
/ip traffic-flow target add dst-address=<probe-address> port=2055 version=9
```

### pfSense och Linux-värdar

På pfSense installerar du paketet **softflowd** och väljer under **Services** > **softflowd** gränssnitten, anger sondens IP-adress och port `2055` och väljer NetFlow version 9. På en Linux-värd kör du softflowd på gränssnittet vars trafik du vill se:

```bash
softflowd -i eth0 -n <probe-address>:2055 -v 9 -t maxlife=60
```

### Andra enheter

Skicka NetFlow v5, NetFlow v9 eller IPFIX till sondens IP-adress på UDP 2055 (eller 4739), eller sFlow v5 på UDP 6343. Ställ in enhetens aktiva flödestimeout på 60 sekunder och skicka, för NetFlow v9 och IPFIX, dess mallar var 60:e sekund. [Guiderna för nätverksleverantörer](/docs/monitor/network-vendor-guides) täcker Sophos och Extreme Networks.

## Cisco Meraki utan NetFlow

En Meraki-miljö har en andra väg in, utan något att konfigurera på enheterna och utan en sond på vägen: OneUptime läser organisationens trafik från Meraki-dashboardens API. Det passar hundratals eller tusentals platser, där det svåra är att konfigurera NetFlow på varje MX.

Välj **Anslut Meraki** under **Nätverk** -> **Trafik**:

1. **API-nyckel.** Skapa en i Meraki-dashboarden under **Organization** > **API & Webhooks** > **API keys and access**. En skrivskyddad administratörs nyckel räcker. OneUptime lagrar den krypterad, visar den aldrig igen och skickar den inte till något annat än Meraki-dashboardens API i nyckelns region. Om du loggar in på Meraki någon annanstans än dashboard.meraki.com väljer du **Instrumentpanelens region** under **Fler fält**: dashboarden för Kanada, Kina, Indien eller USA:s FedRAMP-dashboard.
2. **Organisation.** Nyckeln testas när steget öppnas: organisationerna den kan läsa listas, och för den du väljer räknar dialogen nätverken och MX- och Z-appliancerna som en läsning täcker, innan något sparas.

Den första läsningen börjar inom en minut och hämtar det senaste dygnet. Därefter har Trafik-sidorna en växel **Flows** | **Meraki** i sitt sidhuvud: en sida med flödesposter öppnas på dem som förut, och en sida med bara Meraki-trafik öppnas på Meraki.

| På sidan | Vad Meraki rapporterar | Hur ofta det läses |
| --- | --- | --- |
| De fyra talen, diagrammet, **Toppnätverk** och **Upplänkar** | Uplinkanvändningen för varje MX- och Z-appliance (wan1, wan2, cellular), för hela organisationen i ett anrop | Var 5:e minut som standard, upp till varje timme, i femminutersfönster |
| **Toppapplikationer** och **Toppmål** | Varje nätverks trafikanalyser | Varannan timme: Meraki summerar dem över två timmar eller mer |
| **Toppklienter** | Varje nätverks klienter och vad de använde | Varannan timme, tillsammans med applikationerna |

Ett klick på ett nätverk begränsar sidan till det och listar dess uplinks. En appliances trafik hör till dess enhet i OneUptime när en enhet har appliancens serienummer eller MAC-adress: den visas då också på Trafik-sidorna för den enheten och dess plats. Trafiken från en appliance som inte är en enhet i OneUptime visas på nätverkets sida.

Varje läsning listar också organisationens enheter. En Meraki-enhet som är en nätverksenhet i OneUptime hämtar det som dess egen pollning lämnar tomt från dashboarden: dess serienummer, modell, firmware, MAC-adress och resten ([Tillgångsattribut för nätverksenheter](/docs/inventory/cmdb-sync#tillgångsattribut-för-nätverksenheter)). Anslutningens rad räknar dem, och enhetens kort **Inventarie** säger på en egen rad när Meraki lästes.

Meraki ger varje organisation 10 API-förfrågningar per sekund, delade av alla applikationer som läser den. OneUptime använder högst 3 av dem, saktar ner när Meraki ber om det och stoppar en läsning efter 900 förfrågningar eller 6 minuter; nästa fortsätter en minut senare. En organisation med 1 200 nätverk får sina uplinks lästa med ett anrop per fönster, och nätverkens applikationer och klienter över några läsningar.

Anslutningarna listas längst ned på nätverkets Trafik-sida under **Meraki**, var och en med hur den mår och vad dess senaste läsning täckte. Var och en har en knapp för nästa steg: **Läs nu** läser den direkt, **Slå på** slår på den igen när den är avstängd, och **Uppdatera API-nyckel** ersätter en nyckel som Meraki nekade och testar den nya nyckeln innan den sparas. Dess meny har **Redigera** (dess namn, hur ofta uplinks läses, en ny nyckel), **Stäng av** och **Ta bort**. En läsning som misslyckas säger varför, där och ovanför trafiken: en nekad nyckel, en nyckel som inte kan läsa organisationen, Meraki som ber OneUptime sakta ner, eller nätverk vars trafikanalys är avstängd. Ovanför trafiken leder **Granska** till anslutningen. Bara projektägare och projektadministratörer kan ansluta Meraki och ändra eller läsa en anslutning.

Meraki-dashboardens API rapporterar summor, aldrig vem som pratade med vem, så Meraki-sidan har inga konversationer. För att se dem skickar du också NetFlow från MX-appliancerna ([Cisco Meraki MX och Z](#cisco-meraki-mx-och-z)): sidan har då båda, en växel ifrån varandra.

## Adresser som ännu inte är enheter

Flöden kan komma innan enheten som skickar dem har lagts till i OneUptime. På din egen sond sparas de, och nätverkets Trafik-sida listar deras adress under **Avsändare av flöden**, märkt **Ännu inte en enhet**:

- **Lägg till som enhet** öppnar Lägg till enhet med adressen och sonden ifyllda. Flödena som redan har kommit stannar på nätverkets sida; nya går till enheten.
- **Det är en av mina enheter** lägger till adressen bland en enhets **Övriga adresser**: använd det när en enhet du redan har lagt till skickar från en annan adress, till exempel en loopback. Dess flöden går till den enheten från och med nästa minut.

Flera enheter bakom en NAT-adress delar den adressen, så deras flöden går till den enda enhet som har den.

## Namn i stället för adresser

Överallt där en Trafik-sida visar en adress - topplistorna, båda vyerna av **Toppkonversationer**, brickorna, **Sök** - visar den först adressens namn när OneUptime känner till ett, med adressen bredvid: `mumbai-fs01` ovanför `10.18.167.35`. En adress som inget namnger visas som sig själv. Under pekaren visas ett förkortat namn i sin helhet.

Ett namn kommer från den första av dessa källor som namnger adressen:

| Ordning | Var namnet kommer ifrån | Vad som namnger adressen |
| ------- | ----------------------- | ------------------------ |
| 1 | **Adressnamn** | Ett namn som någon gav den här adressen under **Nätverk** -> **Inställningar** -> **Adressnamn** |
| 2 | Nätverksenheter | En enhet som pollas på adressen, eller som har den under **Övriga adresser** |
| 3 | Värdar | En värd vars agent rapporterar adressen |
| 4 | Molnresurser | En molnresurs som ert molnkonto anger adressen för |
| 5 | Kubernetes | En nod med adressen, sedan en podd (en podd i sin nods eget nätverk har nodens adress) |
| 6 | DNS | Adressens omvända DNS-namn, uppslaget av proben som tog emot flödena |

En post namnger bara trafiken från en tid då den fanns: en värd som sågs först efter tidsintervallet, eller en podd som försvann före det, namnger inte trafiken i det intervallet. Ett namn som någon gav ett delnät - `10.18.167.0/24` är ”Kontoret i Mumbai” - visas bredvid varje adress i det, aldrig i stället för adressens eget namn; där namngivna delnät överlappar visas det smalaste.

### En adress

Klicka på en adress, eller sök fram den, så smalnar sidan av till den, med ett kort ovanför siffrorna som säger vem den är: namnet, var namnet kommer ifrån, adressen med en knapp för att kopiera den och det namngivna delnät den ligger i. Kortet har nästa steg:

- **Öppna värden**, **Öppna enheten** eller **Öppna molnresursen**, när namnet är den postens. Ändra namnet där.
- **Ge adressen ett namn**, när inget namnger den eller bara DNS. Adressen är redan ifylld; vidga den till ett delnät, till exempel `10.18.167.0/24`, för att namnge hela delnätet i stället.
- **Redigera i Inställningar**, när namnet är ett adressnamn. Det öppnar **Adressnamn**, där namnet ändras.

**Ge adressen ett namn** är för den som får lägga till nätverksenheter, och **Redigera i Inställningar** för den som får ändra dem. Alla som får läsa dem ser namnen.

### Adressnamn

**Nätverk** -> **Inställningar** -> **Adressnamn** visar de namn som personer har gett adresser och delnät som inget annat namnger: en partners VPN-gateway, en SaaS-slutpunkt, gäst-wifi:t. **Skapa Adressnamn** frågar efter namnet och efter en IP-adress (`10.0.0.5`, `2001:db8::5`) eller ett delnät (`10.18.167.0/24`). Ett delnät sparas som sin första adress och sin längd, så `10.18.167.35/24` sparas som `10.18.167.0/24`. Varje adress eller delnät har ett namn.

### DNS-namn från proben

DNS-namn slås upp av proben som tog emot flödena, med den resolver som dess värd använder: inne i ert nätverk, där privata adresser har namn. Proben behåller bara ett namn när namnets egna A- eller AAAA-poster pekar tillbaka på adressen, så en inaktuell eller förfalskad omvänd post namnger inget, och ett namn i hosts-filen på probens värd används som det är. Den skickar namnen med flödena, och de sparas med dem: ett tidsintervall visar de namn dess adresser hade då.

Uppslagen håller aldrig upp flödena. De mest trafikerade adresserna slås upp först, högst 300 i minuten och åtta åt gången; ett namn sparas i en timme, en adress utan namn i 30 minuter, och ett uppslag som misslyckades görs om efter 5 minuter. Loopback-, länklokala, multicast- och broadcast-adresser slås aldrig upp. De globala proberna i en driftad OneUptime, som alla konton delar, slår bara upp offentliga adresser; era egna prober, och proberna i er egen OneUptime-installation, slår även upp privata adresser.

| Variabel                            | Vad den gör                                                         | Standard |
| ----------------------------------- | ------------------------------------------------------------------- | -------- |
| PROBE_FLOW_NAME_LOOKUP_ENABLED      | Sätt till `false` för att sluta slå upp flödenas adresser i DNS     | true     |
| PROBE_FLOW_NAME_LOOKUPS_PER_MINUTE  | Adresser som slås upp per minut; `0` stoppar uppslagen              | 300      |
| PROBE_FLOW_NAME_DNS_SERVERS         | DNS-servrar att fråga i stället för värdens resolver, till exempel `10.0.0.53, 10.0.0.54:5353` | ingen |

## Så läser du siffrorna

- **Sampling.** En enhet som samplar - sFlow gör det alltid, och NetFlow eller IPFIX kan göra det - rapporterar ett paket av N. Sonden multiplicerar värdena med N, så sidan visar uppskattningar och säger det under de fyra talen. De är exakta för mycket trafik och ungefärliga för några få paket.
- **Räknat två gånger.** Trafik som passerar två exporterande enheter rapporteras av båda. En enhets sida räknar den en gång; en plats eller nätverkets sida räknar den en gång per enhet som rapporterade den.
- **Applikationer.** En applikation är protokollet och tjänsteporten, namngiven efter tjänsten som brukar finnas på porten. Det är inte djup paketinspektion: HTTPS på port 9443 visas som TCP-port 9443. Klientens kortlivade port utelämnas, så tusen webbläsaranslutningar till en server är en applikation.
- **Topp** är takten för den mest aktiva delen av diagrammet, så ett kortare tidsintervall med kortare delar visar en skarpare topp. **Genomsnitt** är byten över hela tidsintervallet.
- **Tid.** Ett flöde räknas i den del där det började. En lång nedladdning rapporteras som flera flöden, ett för varje minut den pågår, och därför bör enheternas aktiva timeout vara 60 sekunder.

## Vad som inte ingår

- **Larm på flöden.** Det finns ännu ingen flödesbaserad monitor. För att få larm om en hårt belastad länk använder du larmen för gränssnittsutnyttjande i [nätverksenhetsmonitorn](/docs/monitor/network-device-monitor), som läser SNMP.
- **Applikationsnamn utöver porten.** Det finns ingen djup paketinspektion, och Cisco NBAR-applikationsnamn läses inte.
- **Konversationer från Meraki-dashboardens API.** Det rapporterar summor, inte vem som pratade med vem: skicka också NetFlow från MX-appliancerna för att se konversationer.
- **Avvikelsedetektering** i trafiken.
- **Gränssnittsnamn från flödesposter.** Gränssnittens namn och hastigheter kommer från enhetens SNMP-walk; en enhet utan walk visar gränssnittsnummer.

## Felsökning

Om Trafik-sidan fortfarande visar sina konfigurationssteg:

- **Tar sonden emot något alls?** Nätverkets Trafik-sida listar under **Avsändare av flöden** varje adress som har skickat flöden den senaste timmen. Om enheten står där som **Ännu inte en enhet** skickar den från en adress som inte är dess värdnamn: lägg till den adressen bland dess **Övriga adresser**.
- **Brandväggar och Docker.** Tillåt UDP 2055, 4739 och 6343 från enheten till sonden, och publicera portarna om sonden körs i Docker.
- **Sondens logg.** En gång i minuten loggar sonden det den inte kunde läsa: datagram i ett format som inte stöds (NetFlow v1, v6, v7 eller v8, eller sFlow före version 5), felaktiga datagram, data som väntar på en mall och datagram som kastades över `PROBE_NETFLOW_RATE_LIMIT_PER_MINUTE`.
- **Mallar.** NetFlow v9 och IPFIX skickar uppbyggnaden av sina poster som mallar. Sonden håller kvar data som kommer före sin mall i upp till 10 minuter; ställ in enheten att skicka sina mallar var 60:e sekund så fylls sidan inom en minut.
- **En global sond.** En enhet som pollas av en global sond kan inte skicka flöden till den från ett privat nätverk. Kör en anpassad sond i enhetens nätverk och välj den i enhetens inställningar.

Om en adress inte visar något namn:

- **Ge den ett.** Klicka på adressen och sedan på **Ge adressen ett namn** på kortet ovanför siffrorna.
- **Dess DNS-namn.** Namnets egen A- eller AAAA-post måste peka tillbaka på adressen; en reverse-post räcker inte ensam. Ett namn som läggs till i DNS namnger de flöden som kommer efter det.
- **Probens resolver.** Om probens värd inte ser er interna DNS anger ni `PROBE_FLOW_NAME_DNS_SERVERS` till en DNS-server som har era reverse-zoner.

Om en Meraki-anslutning säger att den inte kan läsa:

- **Nyckeln nekas.** Kopiera den igen från Meraki-dashboarden och kontrollera **Instrumentpanelens region**: en nyckel läser bara dashboarden den skapades i. Klistra in den nya nyckeln med **Uppdatera API-nyckel** på anslutningen.
- **Nyckeln kan inte läsa organisationen.** Slå på API-åtkomst för organisationen under **Organization** > **API & Webhooks**, eller använd nyckeln från en av dess administratörer.
- **Inga applikationer på vissa nätverk.** Deras trafikanalys är avstängd: slå på den under **Network-wide** > **General** > **Traffic analysis**.
- **Meraki bad OneUptime att sakta ner.** Andra applikationer använder organisationens API-budget. OneUptime läser långsammare och fortsätter.
- **Denna OneUptime når inte API:et.** Tillåt HTTPS (port 443) från OneUptimes servrar till `api.meraki.com`, eller API-värden för din region.
