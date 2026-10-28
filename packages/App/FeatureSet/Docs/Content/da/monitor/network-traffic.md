# Netværkstrafik (NetFlow, IPFIX og sFlow)

Routere, firewalls og switches kan beskrive den trafik, der passerer gennem dem, som **flowposter**: hvem der talte med hvem, over hvilken protokol og hvilke porte, gennem hvilke grænseflader og med hvor mange bytes. Peg den eksport mod en OneUptime-sonde, og **Trafik**-siderne viser, hvor din trafik går hen: de travleste adresser, samtaler, applikationer og grænseflader over et hvilket som helst tidsrum.

Der er en Trafik-side tre steder:

- **Netværk** -> **Trafik**: hele netværket, alle enheders flows på én side og alle adresser, der sender flows uden endnu at være en enhed.
- En lokations **Trafik**-side: enhederne på den lokation.
- En enheds **Trafik**-fane: den ene enhed med dens grænseflader. Pakkeopsamlinger, der køres på enhedens sonde, står under flowene, til når du har brug for selve pakkerne.

Et Cisco Meraki-miljø kan også læses uden at eksportere noget: forbind Meraki-dashboardet, og Trafik-siderne viser appliancernes uplinks, applikationer og klienter, som Meraki rapporterer dem. Se [Cisco Meraki uden NetFlow](#cisco-meraki-uden-netflow).

## Hvad Trafik-siden viser

- Fire tal for tidsrummet: **Trafik** (bytes), **Gennemsnit**- og **Top**-raten samt **Flows** (hvor mange flowposter enhederne sendte).
- **Trafik over tid** i bit pr. sekund. Træk hen over grafen for at zoome ind på et stykke; dobbeltklik på den, eller brug **Nulstil zoom**, for at gå tilbage.
- **Topkilder** og **Topdestinationer**: de ti adresser, der sendte og modtog mest.
- **Topapplikationer**: trafik efter protokol og tjenesteport, navngivet efter den tjeneste, der normalt kører på porten (HTTPS er TCP-port 443).
- **Topgrænseflader** på en enheds side: hvad der kom ind og gik ud gennem hver grænseflade, med navn og hastighed fra enhedens SNMP-walk. **Topenheder** på en lokations side og på netværkets side.
- **Topsamtaler**: de ti travleste adressepar, tegnet som et diagram fra afsendere til modtagere eller som en liste.

Klik på en række - en adresse, en applikation, en grænseflade, en enhed, et bånd i diagrammet - og hele siden indsnævres til den trafik. En chip over siden fortæller, hvad den er indsnævret til; klik på dens x for at udvide siden igen. **Find et navn eller en IP-adresse** indsnævrer siden til trafikken til eller fra én adresse: skriv adressen eller en del af dens navn, og vælg den, hvis flere passer. Tidsrummet og filtrene gemmes i sidens adresse, så et link åbner præcis den samme visning.

En adresse, som OneUptime kender, vises med sit navn og adressen ved siden af. Se [Navne i stedet for adresser](#navne-i-stedet-for-adresser).

## Sådan kommer flows hertil

Hver sonde kører en flowopsamler. Den lytter på tre UDP-porte, og hver port læser alle formater:

| Port     | Bruges normalt til          |
| -------- | --------------------------- |
| UDP 2055 | NetFlow v5, NetFlow v9      |
| UDP 4739 | IPFIX                       |
| UDP 6343 | sFlow v5                    |

Sonden afkoder posterne, ganger samplede tal op igen med samplingraten, lægger posterne for én samtale sammen hvert par sekunder og sender dem til OneUptime. Hver post knyttes til en enhed efter den adresse, enheden sender den fra - for sFlow agentadressen i datagrammet:

1. en enhed, som sonden poller, hvis værtsnavn er den adresse (eller slås op til den), eller som har den under **Andre adresser** på sin **Indstillinger**-side;
2. på din egen (brugerdefinerede) sonde en hvilken som helst enhed i projektet med adressen som værtsnavn eller blandt sine andre adresser;
3. ellers gemmes flowene på din egen sonde til netværkets Trafik-side under **Afsendere af flows**, indtil du siger, hvilken enhed de hører til. En global sonde smider dem væk.

Flows gemmes i 30 dage, og en side viser højst 31 dage.

## Opsætning

1. **Brug en sonde på enhedens netværk.** Flows er UDP-datagrammer, som dine enheder sender, så de skal bruge en [brugerdefineret sonde](/docs/probe/custom-probe), de kan nå. En global sonde på det offentlige internet modtager dem ikke.
2. **Lad datagrammerne nå sonden.** Tillad UDP 2055, 4739 og 6343 fra enhederne til sonden. En sonde i Docker, der er startet med værtens netværk (`--network host`), som siden om den brugerdefinerede sonde viser, modtager dem, som den er; uden værtens netværk skal du publicere portene med `-p 2055:2055/udp -p 4739:4739/udp -p 6343:6343/udp`.
3. **Slå floweksport til på enheden**, og send den til sondens IP-adresse. Kommandoerne til almindelige enheder står nedenfor. Enhedens egen **Trafik**-fane viser de samme trin med sondens porte, indtil det første flow ankommer.
4. **Tjek enhedens adresse.** Poster knyttes efter den adresse, enheden sender fra. Hvis den sender fra en loopback eller en administrationsgrænseflade, der ikke er dens værtsnavn, så føj den adresse til enhedens **Andre adresser**.

Opsamleren er slået til som standard. Dens indstillinger er miljøvariabler på sonden:

| Variabel                            | Hvad den gør                                                        | Standard |
| ----------------------------------- | ------------------------------------------------------------------- | ------- |
| PROBE_NETFLOW_RECEIVER_ENABLED      | Sæt til `false` for at slå flowopsamleren fra                       | true    |
| PROBE_NETFLOW_RECEIVER_PORT         | NetFlow-porten; `0` stopper lytningen på den                        | 2055    |
| PROBE_IPFIX_RECEIVER_PORT           | IPFIX-porten; `0` stopper lytningen på den                          | 4739    |
| PROBE_SFLOW_RECEIVER_PORT           | sFlow-porten; `0` stopper lytningen på den                          | 6343    |
| PROBE_NETFLOW_RATE_LIMIT_PER_MINUTE | Accepterede datagrammer pr. minut på tværs af alle enheder og porte | 6000    |

De 6.000 datagrammer i minuttet deles af alle enheder, der eksporterer til sonden. Med hundredvis af enheder skal du hæve `PROBE_NETFLOW_RATE_LIMIT_PER_MINUTE` eller fordele enhederne på flere sonder: datagrammer over grænsen kasseres, og sondens log fortæller hvor mange (se [Fejlfinding](#fejlfinding)). Et Meraki-miljø behøver slet ingen eksport: se [Cisco Meraki uden NetFlow](#cisco-meraki-uden-netflow).

### Cisco IOS XE (Flexible NetFlow)

Eksporterer IPFIX til UDP 4739. Tilføj den sidste linje til hver grænseflade, hvis trafik du vil se: når trafikken måles, idet den kommer ind på hver grænseflade, tælles hver samtale én gang.

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

Eksporterer NetFlow v9 til UDP 2055.

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

Eksporterer sFlow til UDP 6343. sFlow sampler én pakke ud af N (her 16384), og Trafik-siderne ganger samplerne op igen, så tallene er skøn.

```text
sflow sample 16384
sflow destination <probe-address> 6343
sflow source-interface Loopback0
sflow run
```

### Cisco Meraki MX og Z

MX-appliances og hjemmearbejds-gateways i Z-serien eksporterer NetFlow v9 fra Meraki-dashboardet:

1. Åbn **Network-wide** > **General**, og find **Reporting**.
2. Sæt **NetFlow traffic reporting** til **Enabled: send NetFlow traffic statistics**.
3. Indtast sondens IP-adresse som **NetFlow collector IP** og `2055` som **NetFlow collector port**, og gem.

En MX eller Z ser kun den trafik, der passerer gennem den. Trafik, som en switch holder inden for et VLAN, når den aldrig, så den er ikke med i eksporten.

For at læse hver lokation uden at sætte hver MX op skal du i stedet forbinde Meraki-dashboardet: se [Cisco Meraki uden NetFlow](#cisco-meraki-uden-netflow). Den trafik har ingen samtaler, så de to supplerer hinanden godt.

### Juniper (inline J-Flow)

Eksporterer IPFIX til UDP 4739 fra MX-routere; brug den FPC, der bærer de grænseflader, du sampler.

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

Eksporterer NetFlow v9 til UDP 2055. På FortiOS 7.2 og senere er opsamleren en post under `config collectors` inde i `config system netflow`.

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

1. Under **Device** > **Server Profiles** > **NetFlow** tilføjer du en profil med sondens IP-adresse og port `2055`, og sætter **Active Timeout** til 1 minut.
2. Under **Network** > **Interfaces** åbner du hver grænseflade, hvis trafik du vil se, og vælger profilen som dens **NetFlow Profile** på fanen **Advanced**.
3. Udfør commit.

### MikroTik RouterOS 7

```text
/ip traffic-flow set enabled=yes interfaces=all active-flow-timeout=1m
/ip traffic-flow target add dst-address=<probe-address> port=2055 version=9
```

### pfSense og Linux-værter

På pfSense installerer du pakken **softflowd** og vælger under **Services** > **softflowd** grænsefladerne, indtaster sondens IP-adresse og port `2055` og vælger NetFlow version 9. På en Linux-vært kører du softflowd på den grænseflade, hvis trafik du vil se:

```bash
softflowd -i eth0 -n <probe-address>:2055 -v 9 -t maxlife=60
```

### Andre enheder

Send NetFlow v5, NetFlow v9 eller IPFIX til sondens IP-adresse på UDP 2055 (eller 4739), eller sFlow v5 på UDP 6343. Sæt enhedens aktive flow-timeout til 60 sekunder, og send for NetFlow v9 og IPFIX dens skabeloner hvert 60. sekund. [Vejledningerne til netværksproducenter](/docs/monitor/network-vendor-guides) dækker Sophos og Extreme Networks.

## Cisco Meraki uden NetFlow

Et Meraki-miljø har en anden vej ind, uden noget at sætte op på enhederne og uden en sonde imellem: OneUptime læser organisationens trafik fra Meraki-dashboardets API. Det passer til hundredvis eller tusindvis af lokationer, hvor det svære er at sætte NetFlow op på hver MX.

Vælg **Forbind Meraki** på **Netværk** -> **Trafik**:

1. **API-nøgle.** Opret en i Meraki-dashboardet under **Organization** > **API & Webhooks** > **API keys and access**. En skrivebeskyttet administrators nøgle er nok. OneUptime gemmer den krypteret, viser den aldrig igen og sender den ikke andre steder hen end til Meraki-dashboardets API i nøglens region. Hvis du logger ind på Meraki et andet sted end dashboard.meraki.com, skal du vælge **Dashboardregion** under **Flere felter**: dashboardet for Canada, Kina, Indien eller USA's FedRAMP-dashboard.
2. **Organisation.** Nøglen testes, så snart trinnet åbner: de organisationer, den kan læse, vises, og for den, du vælger, tæller dialogen de netværk og MX- og Z-appliances, en læsning vil dække, før noget gemmes.

Den første læsning starter inden for et minut og henter det seneste døgn. Derefter har Trafik-siderne en kontakt **Flows** | **Meraki** i deres overskrift: en side med flowposter åbner på dem som før, og en side med kun Meraki-trafik åbner på Meraki.

| På siden | Hvad Meraki rapporterer | Hvor ofte det læses |
| --- | --- | --- |
| De fire tal, diagrammet, **Topnetværk** og **Uplinks** | Uplinkforbruget for hver MX- og Z-appliance (wan1, wan2, cellular), for hele organisationen i ét kald | Hvert 5. minut som standard, op til hver time, i femminutters vinduer |
| **Topapplikationer** og **Topdestinationer** | Hvert netværks trafikanalyser | Hver anden time: Meraki summerer dem over to timer eller mere |
| **Topklienter** | Hvert netværks klienter og hvad de brugte | Hver anden time, sammen med applikationerne |

Et klik på et netværk begrænser siden til det og viser dets uplinks. En appliances trafik hører til dens enhed i OneUptime, når en enhed har appliancens serienummer eller MAC-adresse: så vises den også på Trafik-siderne for den enhed og dens lokation. Trafikken fra en appliance, der ikke er en enhed i OneUptime, vises på netværkets side.

Meraki giver hver organisation 10 API-forespørgsler i sekundet, som deles af alle applikationer, der læser den. OneUptime bruger højst 3 af dem, sænker farten, når Meraki beder om det, og stopper en læsning efter 900 forespørgsler eller 6 minutter; den næste fortsætter et minut senere. En organisation med 1.200 netværk får sine uplinks læst med ét kald pr. vindue og sine netværks applikationer og klienter over nogle få læsninger.

Forbindelserne står nederst på netværkets Trafik-side under **Meraki**, hver med hvordan det går, og hvad dens seneste læsning dækkede. Hver har én knap til det næste trin: **Læs nu** læser den med det samme, **Slå til** slår den til igen, når den er slået fra, og **Opdater API-nøgle** erstatter en nøgle, som Meraki afviste, og tester den nye nøgle, før den gemmes. Dens menu har **Rediger** (dens navn, hvor ofte uplinks læses, en ny nøgle), **Slå fra** og **Slet**. En læsning, der fejler, fortæller hvorfor, både dér og over trafikken: en afvist nøgle, en nøgle, der ikke kan læse organisationen, Meraki, der beder OneUptime om at sænke farten, eller netværk, hvis trafikanalyse er slået fra. Over trafikken fører **Gennemse** til forbindelsen. Kun projektejere og projektadministratorer kan forbinde Meraki og ændre eller læse en forbindelse.

Meraki-dashboardets API rapporterer totaler, aldrig hvem der talte med hvem, så Meraki-siden har ingen samtaler. For at se dem skal du også sende NetFlow fra MX-appliancerne ([Cisco Meraki MX og Z](#cisco-meraki-mx-og-z)): siden har så begge, kun en kontakt fra hinanden.

## Adresser, der endnu ikke er enheder

Flows kan ankomme, før den enhed, der sender dem, er tilføjet i OneUptime. På din egen sonde gemmes de, og netværkets Trafik-side viser deres adresse under **Afsendere af flows**, markeret som **Endnu ikke en enhed**:

- **Tilføj som enhed** åbner Tilføj enhed med adressen og sonden udfyldt. De flows, der allerede er kommet, bliver på netværkets side; nye går til enheden.
- **Det er en af mine enheder** føjer adressen til en enheds **Andre adresser**: brug det, når en enhed, du allerede har tilføjet, sender fra en anden adresse, f.eks. en loopback. Dens flows går til den enhed fra næste minut.

Flere enheder bag én NAT-adresse deler den adresse, så deres flows går til den ene enhed, der har den.

## Navne i stedet for adresser

Overalt hvor en Trafik-side viser en adresse - toplisterne, begge visninger af **Topsamtaler**, chipsene, **Find** - viser den først adressens navn, når OneUptime kender et, med adressen ved siden af: `mumbai-fs01` over `10.18.167.35`. En adresse, som intet navngiver, vises som sig selv. Under markøren vises et forkortet navn i sin helhed.

Et navn kommer fra den første af disse kilder, der navngiver adressen:

| Rækkefølge | Hvor navnet kommer fra | Hvad der navngiver adressen |
| ---------- | ---------------------- | --------------------------- |
| 1 | **Adressenavne** | Et navn, som nogen gav denne adresse under **Netværk** -> **Indstillinger** -> **Adressenavne** |
| 2 | Netværksenheder | En enhed, der polles på adressen, eller som har den under **Andre adresser** |
| 3 | Værter | En vært, hvis agent rapporterer adressen |
| 4 | Cloud-ressourcer | En cloud-ressource, som jeres cloud-konto angiver adressen for |
| 5 | Kubernetes | En node med adressen, derefter en pod (en pod på sin nodes eget netværk har nodens adresse) |
| 6 | DNS | Adressens reverse DNS-navn, slået op af den probe, der modtog flowene |

En post navngiver kun trafikken fra en tid, hvor den fandtes: en vært, der først blev set efter tidsrummet, eller en pod, der forsvandt før det, navngiver ikke trafikken i det tidsrum. Et navn, som nogen gav et undernet - `10.18.167.0/24` er »Kontoret i Mumbai« - vises ved siden af hver adresse i det, aldrig i stedet for adressens eget navn; hvor navngivne undernet overlapper, vises det smalleste.

### Én adresse

Klik på en adresse, eller find den, så indsnævres siden til den med et kort over tallene, der fortæller, hvem den er: navnet, hvor navnet kommer fra, adressen med en knap til at kopiere den og det navngivne undernet, den ligger i. Kortet har det næste skridt:

- **Åbn vært**, **Åbn enhed** eller **Åbn cloud-ressource**, når navnet er den posts. Ret navnet der.
- **Giv adressen et navn**, når intet navngiver den, eller kun DNS gør. Adressen er udfyldt; udvid den til et undernet, f.eks. `10.18.167.0/24`, for at navngive hele undernettet i stedet.
- **Omdøb**, når navnet er et adressenavn.

At give og ændre navne er for dem, der må tilføje og ændre netværksenheder. Alle, der må læse dem, ser navnene.

### Adressenavne

**Netværk** -> **Indstillinger** -> **Adressenavne** viser de navne, folk har givet adresser og undernet, som intet andet navngiver: en partners VPN-gateway, et SaaS-endpoint, gæste-wi-fi'et. **Opret Adressenavn** beder om navnet og om én IP-adresse (`10.0.0.5`, `2001:db8::5`) eller et undernet (`10.18.167.0/24`). Et undernet gemmes som sin første adresse og sin længde, så `10.18.167.35/24` gemmes som `10.18.167.0/24`. Hver adresse eller hvert undernet har ét navn.

### DNS-navne fra proben

DNS-navne slås op af den probe, der modtog flowene, med den resolver, dens vært bruger: inde i jeres netværk, hvor private adresser har navne. Proben beholder kun et navn, når navnets egne A- eller AAAA-poster peger tilbage på adressen, så en forældet eller forfalsket reverse-post navngiver intet, og et navn i probeværtens hosts-fil bruges, som det er. Den sender navnene med flowene, og de gemmes sammen med dem: et tidsrum viser de navne, dets adresser havde dengang.

Opslagene holder aldrig flowene tilbage. De travleste adresser slås op først, højst 300 i minuttet og otte ad gangen; et navn huskes i en time, en adresse uden navn i 30 minutter, og et opslag, der mislykkedes, prøves igen efter 5 minutter. Loopback-, link-local-, multicast- og broadcast-adresser slås aldrig op. De globale prober i en hostet OneUptime, som alle konti deler, slår kun offentlige adresser op; jeres egne prober, og proberne i jeres egen OneUptime-installation, slår også private adresser op.

| Variabel                            | Hvad den gør                                                        | Standard |
| ----------------------------------- | ------------------------------------------------------------------- | -------- |
| PROBE_FLOW_NAME_LOOKUP_ENABLED      | Sæt til `false` for at holde op med at slå flowenes adresser op i DNS | true |
| PROBE_FLOW_NAME_LOOKUPS_PER_MINUTE  | Adresser slået op pr. minut; `0` stopper opslagene                  | 300      |
| PROBE_FLOW_NAME_DNS_SERVERS         | DNS-servere, der spørges i stedet for værtens resolver, f.eks. `10.0.0.53, 10.0.0.54:5353` | ingen |

## Sådan læser du tallene

- **Sampling.** En enhed, der sampler - sFlow gør det altid, og NetFlow eller IPFIX kan - rapporterer én pakke ud af N. Sonden ganger tallene med N, så siden viser skøn og siger det under de fire tal. De er præcise for meget trafik og grove for få pakker.
- **Talt to gange.** Trafik, der passerer gennem to eksporterende enheder, rapporteres af begge. En enheds side tæller den én gang; en lokations eller netværkets side tæller den én gang pr. enhed, der rapporterede den.
- **Applikationer.** En applikation er protokollen og tjenesteporten, navngivet efter den tjeneste, der normalt kører på porten. Det er ikke dyb pakkeinspektion: HTTPS på port 9443 vises som TCP-port 9443. Klientens kortlivede port udelades, så tusind browserforbindelser til én server er én applikation.
- **Top** er raten for den travleste del af grafen, så et kortere tidsrum med kortere dele viser en skarpere top. **Gennemsnit** er bytes over hele tidsrummet.
- **Tid.** Et flow tæller i den del, det startede i. En lang download rapporteres som flere flows, ét for hvert minut den kører, og derfor bør enhedernes aktive timeout være 60 sekunder.

## Hvad der ikke er med

- **Alarmer på flows.** Der er endnu ingen flowbaseret monitor. For at få alarm om et travlt link skal du bruge alarmerne for grænsefladeudnyttelse i [netværksenhedsmonitoren](/docs/monitor/network-device-monitor), som læser SNMP.
- **Applikationsnavne ud over porten.** Der er ingen dyb pakkeinspektion, og Cisco NBAR-applikationsnavne læses ikke.
- **Samtaler fra Meraki-dashboardets API.** Den rapporterer totaler, ikke hvem der talte med hvem: send også NetFlow fra MX-appliancerne for at se samtaler.
- **Registrering af anomalier** i trafikken.
- **Grænsefladenavne fra flowposter.** Grænsefladernes navne og hastigheder kommer fra enhedens SNMP-walk; en enhed uden walk viser grænsefladenumre.

## Fejlfinding

Hvis Trafik-siden stadig viser sine opsætningstrin:

- **Modtager sonden overhovedet noget?** Netværkets Trafik-side viser under **Afsendere af flows** alle adresser, der har sendt flows inden for den seneste time. Står enheden der som **Endnu ikke en enhed**, sender den fra en adresse, der ikke er dens værtsnavn: føj den adresse til dens **Andre adresser**.
- **Firewalls og Docker.** Tillad UDP 2055, 4739 og 6343 fra enheden til sonden, og publicer portene, hvis sonden kører i Docker.
- **Sondens log.** Én gang i minuttet logger sonden det, den ikke kunne læse: datagrammer i et format, der ikke understøttes (NetFlow v1, v6, v7 eller v8 eller sFlow før version 5), ugyldige datagrammer, data, der venter på en skabelon, og datagrammer, der blev kasseret over `PROBE_NETFLOW_RATE_LIMIT_PER_MINUTE`.
- **Skabeloner.** NetFlow v9 og IPFIX sender opbygningen af deres poster som skabeloner. Sonden holder data, der ankommer før skabelonen, i op til 10 minutter; indstil enheden til at sende sine skabeloner hvert 60. sekund, så siden fyldes inden for et minut.
- **En global sonde.** En enhed, der polles af en global sonde, kan ikke sende flows til den fra et privat netværk. Kør en brugerdefineret sonde på enhedens netværk, og vælg den i enhedens indstillinger.

Hvis en adresse ikke viser noget navn:

- **Giv den et.** Klik på adressen og derefter på **Giv adressen et navn** på kortet over tallene.
- **Dens DNS-navne.** Navnets egen A- eller AAAA-post skal pege tilbage på adressen; en reverse-post alene er ikke nok. Et navn, der tilføjes i DNS, navngiver de flows, der kommer efter det.
- **Probens resolver.** Hvis probens vært ikke kan se jeres interne DNS, så sæt `PROBE_FLOW_NAME_DNS_SERVERS` til en DNS-server, der har jeres reverse-zoner.

Hvis en Meraki-forbindelse siger, at den ikke kan læse:

- **Nøglen afvises.** Kopiér den igen fra Meraki-dashboardet, og tjek **Dashboardregion**: en nøgle læser kun det dashboard, den blev oprettet i. Indsæt den nye nøgle med **Opdater API-nøgle** på forbindelsen.
- **Nøglen kan ikke læse organisationen.** Slå API-adgang til for organisationen under **Organization** > **API & Webhooks**, eller brug nøglen fra en af dens administratorer.
- **Ingen applikationer på nogle netværk.** Deres trafikanalyse er slået fra: slå den til under **Network-wide** > **General** > **Traffic analysis**.
- **Meraki bad OneUptime om at sænke farten.** Andre applikationer bruger organisationens API-budget. OneUptime læser langsommere og fortsætter.
- **Denne OneUptime kan ikke nå API'et.** Tillad HTTPS (port 443) fra OneUptimes servere til `api.meraki.com` eller din regions API-vært.
