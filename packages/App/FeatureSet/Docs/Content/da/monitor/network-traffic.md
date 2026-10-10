# Netværkstrafik (NetFlow, IPFIX og sFlow)

Routere, firewalls og switches kan beskrive den trafik, der passerer gennem dem, som **flowposter**: hvem der talte med hvem, over hvilken protokol og hvilke porte, gennem hvilke grænseflader og med hvor mange bytes. Peg den eksport mod en OneUptime-sonde, og **Trafik**-siderne viser, hvor din trafik går hen: de travleste adresser, samtaler, applikationer og grænseflader over et hvilket som helst tidsrum.

Der er en Trafik-side tre steder:

- **Netværk** -> **Trafik**: hele netværket, alle enheders flows på én side og alle adresser, der sender flows uden endnu at være en enhed.
- En lokations **Trafik**-side: enhederne på den lokation.
- En enheds **Trafik**-fane: den ene enhed med dens grænseflader. Pakkeopsamlinger, der køres på enhedens sonde, står under flowene, til når du har brug for selve pakkerne.

## Hvad Trafik-siden viser

- Fire tal for tidsrummet: **Trafik** (bytes), **Gennemsnit**- og **Top**-raten samt **Flows** (hvor mange flowposter enhederne sendte).
- **Trafik over tid** i bit pr. sekund. Træk hen over grafen for at zoome ind på et stykke; dobbeltklik på den, eller brug **Nulstil zoom**, for at gå tilbage.
- **Topkilder** og **Topdestinationer**: de ti adresser, der sendte og modtog mest.
- **Topapplikationer**: trafik efter protokol og tjenesteport, navngivet efter den tjeneste, der normalt kører på porten (HTTPS er TCP-port 443).
- **Topgrænseflader** på en enheds side: hvad der kom ind og gik ud gennem hver grænseflade, med navn og hastighed fra enhedens SNMP-walk. **Topenheder** på en lokations side og på netværkets side.
- **Topsamtaler**: de ti travleste adressepar, tegnet som et diagram fra afsendere til modtagere eller som en liste.

Klik på en række - en adresse, en applikation, en grænseflade, en enhed, et bånd i diagrammet - og hele siden indsnævres til den trafik. En chip over siden fortæller, hvad den er indsnævret til; klik på dens x for at udvide siden igen. **Find en IP-adresse** indsnævrer siden til trafikken til eller fra én adresse. Tidsrummet og filtrene gemmes i sidens adresse, så et link åbner præcis den samme visning.

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

## Adresser, der endnu ikke er enheder

Flows kan ankomme, før den enhed, der sender dem, er tilføjet i OneUptime. På din egen sonde gemmes de, og netværkets Trafik-side viser deres adresse under **Afsendere af flows**, markeret som **Endnu ikke en enhed**:

- **Tilføj som enhed** åbner Tilføj enhed med adressen og sonden udfyldt. De flows, der allerede er kommet, bliver på netværkets side; nye går til enheden.
- **Det er en af mine enheder** føjer adressen til en enheds **Andre adresser**: brug det, når en enhed, du allerede har tilføjet, sender fra en anden adresse, f.eks. en loopback. Dens flows går til den enhed fra næste minut.

Flere enheder bag én NAT-adresse deler den adresse, så deres flows går til den ene enhed, der har den.

## Sådan læser du tallene

- **Sampling.** En enhed, der sampler - sFlow gør det altid, og NetFlow eller IPFIX kan - rapporterer én pakke ud af N. Sonden ganger tallene med N, så siden viser skøn og siger det under de fire tal. De er præcise for meget trafik og grove for få pakker.
- **Talt to gange.** Trafik, der passerer gennem to eksporterende enheder, rapporteres af begge. En enheds side tæller den én gang; en lokations eller netværkets side tæller den én gang pr. enhed, der rapporterede den.
- **Applikationer.** En applikation er protokollen og tjenesteporten, navngivet efter den tjeneste, der normalt kører på porten. Det er ikke dyb pakkeinspektion: HTTPS på port 8443 vises som TCP-port 8443. Klientens kortlivede port udelades, så tusind browserforbindelser til én server er én applikation.
- **Top** er raten for den travleste del af grafen, så et kortere tidsrum med kortere dele viser en skarpere top. **Gennemsnit** er bytes over hele tidsrummet.
- **Tid.** Et flow tæller i den del, det startede i. En lang download rapporteres som flere flows, ét for hvert minut den kører, og derfor bør enhedernes aktive timeout være 60 sekunder.

## Hvad der ikke er med

- **Alarmer på flows.** Der er endnu ingen flowbaseret monitor. For at få alarm om et travlt link skal du bruge alarmerne for grænsefladeudnyttelse i [netværksenhedsmonitoren](/docs/monitor/network-device-monitor), som læser SNMP.
- **Applikationsnavne ud over porten.** Der er ingen dyb pakkeinspektion, og Cisco NBAR-applikationsnavne læses ikke.
- **Meraki Dashboard API'et.** Meraki-trafikanalyser importeres ikke; MX- og Z-appliances sender i stedet NetFlow til sonden.
- **Registrering af anomalier** i trafikken.
- **Grænsefladenavne fra flowposter.** Grænsefladernes navne og hastigheder kommer fra enhedens SNMP-walk; en enhed uden walk viser grænsefladenumre.

## Fejlfinding

Hvis Trafik-siden stadig viser sine opsætningstrin:

- **Modtager sonden overhovedet noget?** Netværkets Trafik-side viser under **Afsendere af flows** alle adresser, der har sendt flows inden for den seneste time. Står enheden der som **Endnu ikke en enhed**, sender den fra en adresse, der ikke er dens værtsnavn: føj den adresse til dens **Andre adresser**.
- **Firewalls og Docker.** Tillad UDP 2055, 4739 og 6343 fra enheden til sonden, og publicer portene, hvis sonden kører i Docker.
- **Sondens log.** Én gang i minuttet logger sonden det, den ikke kunne læse: datagrammer i et format, der ikke understøttes (NetFlow v1, v6, v7 eller v8 eller sFlow før version 5), ugyldige datagrammer, data, der venter på en skabelon, og datagrammer, der blev kasseret over `PROBE_NETFLOW_RATE_LIMIT_PER_MINUTE`.
- **Skabeloner.** NetFlow v9 og IPFIX sender opbygningen af deres poster som skabeloner. Sonden holder data, der ankommer før skabelonen, i op til 10 minutter; indstil enheden til at sende sine skabeloner hvert 60. sekund, så siden fyldes inden for et minut.
- **En global sonde.** En enhed, der polles af en global sonde, kan ikke sende flows til den fra et privat netværk. Kør en brugerdefineret sonde på enhedens netværk, og vælg den i enhedens indstillinger.
