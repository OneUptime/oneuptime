# Netværksbegivenheder (syslog og SNMP-traps)

Routere, firewalls, switche og access points fortæller i deres syslog, hvad der sker med dem: et link gik ned, en tunnel faldt ud, en firewall skiftede over, nogen loggede ind. Hver leverandør formulerer det på sin egen måde. Peg deres syslog mod en OneUptime-sonde, så viser **Begivenheder**-siderne, hvad der skete, med de samme ord, uanset hvem der har lavet enheden, og advarer dig, når det sker igen.

Der er en Begivenheder-side to steder:

- **Netværk** -> **Begivenheder**: hele netværket, alle enheders begivenheder på én side, og alle adresser, der sender syslog uden at være en enhed endnu.
- En enheds **Begivenheder**-fane: hvad den ene enhed har rapporteret.

## Hvad Begivenheder-siden viser

- Tidsrummets begivenheder, de nyeste først. Hver række fortæller, hvad der skete, på hvilken enhed, med hvad - interfacet, tunnelen, gatewayen - og med enhedens egne ord.
- **Problemer**, **Genopretninger** og **Til orientering**, hver med antallet i tidsrummet. Klik på en af dem for kun at se dem.
- Vælgeren **Alle begivenheder** og, på netværkets side, vælgeren **All devices** indsnævrer listen yderligere. Tidsrummet og filtrene gemmes i sidens adresse, så et link åbner præcis den samme visning.
- Klik på en begivenhed for at åbne den: hvornår den skete, hvad den handler om, beskeden, som enheden sendte den, og alle attributter, OneUptime læste ud af den.
- **Opret advarsel** tilbyder de advarsler, de fleste netværk vil have, og **Opret advarsel for denne begivenhed** laver en for den begivenhed, du har åbnet. Se [Advarsler](#advarsler).

En begivenhed er en log. Alt på Begivenheder-siden kan også søges i, vises i diagrammer og bruges til advarsler fra **Protokoller**: en begivenhed er en log, hvis attribut `event.domain` er `network`, med det, der skete, i `event.name`.

## Hvad OneUptime læser

Syslog i RFC 3164- og RFC 5424-form og Common Event Format (CEF) læses fra ethvert produkt. Derudover ved OneUptime, hvad disse produkter skriver:

| Leverandør | Produkter | Begivenheder, det læser | Attributter |
| --- | --- | --- | --- |
| Cisco | IOS, IOS XE, NX-OS, ASA | Interfaces, Enheder, Høj tilgængelighed, VPN, Routing, Hardware, Switching, Login | `cisco.*` |
| Sophos | Sophos Firewall (SFOS, XG, XGS) | Interfaces, Enheder, Høj tilgængelighed, VPN, WAN, Login | `sophos.*` |
| Fortinet | FortiGate (FortiOS) | Interfaces, Enheder, Høj tilgængelighed, VPN, WAN, Hardware, Login | `fortigate.*` |
| Extreme Networks | ExtremeXOS, Switch Engine | Interfaces, Enheder, Høj tilgængelighed, Routing, Hardware, Switching, Login | `extreme.*` |
| Extreme Networks | Fabric Engine, VOSS | Interfaces, Routing | `extreme.*` |
| HPE Aruba Networking | AOS-CX | Interfaces, Hardware | `aruba.*` |
| HPE Aruba Networking | AOS-Switch (ArubaOS-Switch, ProCurve) | Interfaces | `aruba.*` |
| MikroTik | RouterOS | Interfaces, Enheder, Login | `mikrotik.*` |
| Cambium Networks | Enterprise Wi-Fi (cnPilot, XV, XE, XH) | Enheder, VPN, Wi-Fi | `cambium.*` |
| Ubiquiti | UniFi Network | Enheder, WAN, Switching, Login, Wi-Fi | `cef.*` |
| Alle | Linux-baserede enheder (kernel, hostapd, OpenSSH, Dropbear) | Interfaces, Login, Wi-Fi | - |

En besked i et af disse formater får sine egne felter gemt som attributter under præfikset i sidste kolonne, så `con_name="HQ-Branch1"` på en Sophos-firewall er attributten `sophos.con_name`. En CEF-besked fra et hvilket som helst andet produkt får sin header og sine udvidelsesfelter gemt under `cef.*`. En besked, som OneUptime ikke kan placere, gemmes stadig som en log med syslog-headeren læst; du kan selv navngive dens begivenheder, se [Dine egne begivenheder](#dine-egne-begivenheder).

Standard-SNMP-traps læses som de samme begivenheder: `linkDown` og `linkUp` bliver til **Interface nede** og **Interface oppe**, `coldStart` og `warmStart` bliver til **Enhed genstartet**.

## Begivenhederne

Hver besked, OneUptime genkender, gemmes med et af disse navne i `event.name`, uanset hvem der har lavet enheden:

| Begivenhed | `event.name` | Type | Handler om |
| --- | --- | --- | --- |
| Interface nede | `interface.down` | Problem | `network.interface.name` |
| Interface oppe | `interface.up` | Genopretning | `network.interface.name` |
| Port lukket ned af switchen | `interface.error_disabled` | Problem | `network.interface.name` |
| Enhed genstartet | `device.reboot` | Problem | - |
| Konfiguration ændret | `device.config_change` | Til orientering | `user.name` |
| Enhed offline | `device.offline` | Problem | - |
| Enhed online | `device.online` | Genopretning | - |
| Failover | `ha.failover` | Problem | `ha.role` |
| Tilstand for høj tilgængelighed ændret | `ha.state_change` | Til orientering | `ha.role` |
| Peer for høj tilgængelighed nede | `ha.peer_down` | Problem | `ha.peer` |
| Peer for høj tilgængelighed oppe | `ha.peer_up` | Genopretning | `ha.peer` |
| VPN-tunnel nede | `vpn.tunnel_down` | Problem | `vpn.tunnel.name` |
| VPN-tunnel oppe | `vpn.tunnel_up` | Genopretning | `vpn.tunnel.name` |
| Routing-nabo nede | `routing.neighbor_down` | Problem | `network.peer.address` |
| Routing-nabo oppe | `routing.neighbor_up` | Genopretning | `network.peer.address` |
| Gateway nede | `gateway.down` | Problem | `network.gateway.name` |
| Gateway oppe | `gateway.up` | Genopretning | `network.gateway.name` |
| WAN-failover | `wan.failover` | Problem | `network.gateway.name` |
| SD-WAN-link under sin SLA | `sdwan.sla_not_met` | Problem | `network.gateway.name` |
| SD-WAN-link tilbage inden for sin SLA | `sdwan.sla_met` | Genopretning | `network.gateway.name` |
| Blæser defekt | `hardware.fan_failed` | Problem | `hw.name` |
| Blæser virker igen | `hardware.fan_ok` | Genopretning | `hw.name` |
| Strømforsyning defekt | `hardware.power_supply_failed` | Problem | `hw.name` |
| Strømforsyning virker igen | `hardware.power_supply_ok` | Genopretning | `hw.name` |
| Temperatur for høj | `hardware.temperature_high` | Problem | - |
| Løkke registreret | `loop.detected` | Problem | `network.interface.name` |
| Ændring i spanning tree-topologien | `stp.topology_change` | Til orientering | - |
| PoE-fejl | `poe.fault` | Problem | `network.interface.name` |
| Login mislykkedes | `auth.login_failed` | Problem | `user.name` |
| Logget ind | `auth.login_success` | Til orientering | `user.name` |
| Wi-Fi-klient tilsluttet | `wireless.client_connected` | Til orientering | `client.mac` |
| Wi-Fi-klient frakoblet | `wireless.client_disconnected` | Til orientering | `client.mac` |

Den sidste kolonne er den attribut, der fortæller, hvad begivenheden handler om. Ikke alle produkter rapporterer alle begivenheder: en switch har ingen VPN-tunneler, og et produkts syslog siger kun så meget.

Hver begivenhed har også:

| Attribut | Hvad den indeholder |
| --- | --- |
| `event.domain` | `network`, på alle netværksbegivenheder |
| `event.kind` | `problem`, `recovery` eller `info` |
| `event.category` | `interface`, `device`, `ha`, `vpn`, `routing`, `wan`, `hardware`, `switching`, `security` eller `wireless`, på begivenhederne ovenfor |
| `event.device` | Hvilken enhed: dens navn i OneUptime, ellers det navn, den giver sig selv, ellers dens adresse |
| `event.message` | Hvad enheden sagde, med dens egne ord |
| `syslog.vendor`, `syslog.parser` | Hvis format beskeden blev læst som |

## Sådan kommer begivenheder hertil

Alle sonder lytter efter syslog på port 5140, over UDP og over TCP. Over TCP er en besked en linje, eller den har sin længde foran, som RFC 6587 beskriver. Sonden videresender det, den hører, til OneUptime med få sekunders mellemrum, og OneUptime knytter hver besked til en enhed efter den adresse, den kom fra:

1. en enhed, som sonden poller, hvis værtsnavn er den adresse (eller slås op til den), eller som har den under **Andre adresser** på sin **Indstillinger**-side;
2. på din egen (brugerdefinerede) sonde en hvilken som helst enhed i projektet med den adresse, eller med det værtsnavn, beskeden bærer, når præcis én enhed har det navn;
3. ellers gemmes beskeden på din egen sonde til netværkets Begivenheder-side under **Sender syslog, endnu ikke en enhed**, indtil du siger, hvilken enhed den hører til. En global sonde smider den væk.

En linje fra en ukendt adresse, som ikke har nogen syslog-prioritet og ikke er en begivenhed, regnes for støj og smides væk.

En controller taler for de enheder, den styrer: en UniFi-konsol rapporterer om sine access points og switche. Når en besked fra en enhed nævner en anden enhed ved dens MAC-adresse, dens serienummer, dens adresse eller det navn, dens controller giver den, går begivenheden til den enhed, og loggen gemmer navnet på den controller, der sendte den videre, i `syslog.relay.name`.

En log gemmes med det tidspunkt, sonden modtog den. En besked, der blev holdt tilbage - dens eget tidsstempel er i RFC 5424-form, som angiver tidszonen, og er mere end 5 minutter gammelt - beholder enhedens tid, op til 7 dage tilbage. Ethvert andet tidsstempel, der ligger mere end 5 minutter fra sondens ur, tros ikke: loggen gemmes med det tidspunkt, den blev modtaget, og enhedens tid gemmes i `syslog.deviceTime`.

Syslog, du sender til [syslog-endpointet](/docs/telemetry/syslog) over HTTPS, læses af de samme parsere. Der bliver en besked til en netværksbegivenhed, når den er i en netværksleverandørs eget format, eller når den nævner en af dine netværksenheder ved MAC-adresse, serienummer, adresse eller værtsnavn; en servers `sshd`-linjer forbliver almindelige logs.

## Opsætning

1. **Brug en sonde på enhedens netværk.** Syslog sendes af dine enheder, så de skal bruge en [brugerdefineret sonde](/docs/probe/custom-probe), de kan nå. En global sonde på det offentlige internet modtager det ikke.
2. **Lad syslog nå sonden.** Tillad port 5140, UDP eller TCP, fra enhederne til sonden. En sonde i Docker, der er startet med værtens netværk (`--network host`), som siden om den brugerdefinerede sonde viser, modtager det, som den er; uden værtens netværk skal du publicere porten med `-p 5140:5140/udp -p 5140:5140/tcp`. For en enhed, der kun kan sende til port 514, publicerer du porten som `-p 514:5140/udp`, eller du sætter `PROBE_SYSLOG_RECEIVER_PORT=514` på en sonde med værtens netværk.
3. **Sæt sonden som enhedens syslog-server.** Kommandoerne til almindelige enheder står nedenfor. **Begivenheder**-siden viser de samme trin, indtil den første besked ankommer, og bliver så af sig selv til listen.
4. **Tjek enhedens adresse.** Beskeder knyttes efter den adresse, enheden sender fra. Hvis den sender fra en loopback eller en administrationsgrænseflade, der ikke er dens værtsnavn, så føj den adresse til enhedens **Andre adresser**.

Syslog-modtageren er slået til som standard. Dens indstillinger er miljøvariabler på sonden:

| Variabel | Hvad den gør | Standard |
| --- | --- | --- |
| `PROBE_SYSLOG_RECEIVER_ENABLED` | Sæt til `false` for at slå syslog-modtageren fra | `true` |
| `PROBE_SYSLOG_RECEIVER_PORT` | Porten, til UDP og TCP | `5140` |
| `PROBE_SYSLOG_RATE_LIMIT_PER_MINUTE` | Videresendte beskeder pr. minut, på tværs af alle enheder | `600` |

Over grænsen videresender sonden stadig de beskeder, den læser som netværksbegivenheder, op til lige så mange igen, så en strøm af rutinelinjer ikke kan fortrænge den ene, der siger, at et link gik ned. En sonde, der er ældre end denne funktion, lytter kun, når den startes med `PROBE_SYSLOG_RECEIVER_ENABLED=true`, og kun over UDP: opdater den.

### Cisco IOS, IOS XE og NX-OS

```text
logging host <probe-address> transport udp port 5140
logging trap informational
service timestamps log datetime msec
```

Den anden linje sender informationsbeskeder og alt, der er mere alvorligt: linkændringer, genstarter og login er blandt dem. På NX-OS er linjen `logging server <probe-address> 6 port 5140 use-vrf management`.

### Sophos Firewall

1. Åbn **System services** > **Log settings** i firewallens webadministration, og vælg **Add** under **Syslog servers**.
2. Angiv sondens IP-adresse og port `5140`, og sæt alvorlighedsniveauet til **Information**. Begge de logformater, firewallen tilbyder, læses.
3. Tilbage på **Log settings** sætter du flueben ved den nye server for de logs, der skal sendes: som minimum systembegivenhederne, og **SD-WAN** for SLA-ændringer. Firewallens trafiklogs er mange, så udelad dem, medmindre du vil have dem.

### Fortinet FortiGate

```text
config log syslogd setting
    set status enable
    set server "<probe-address>"
    set port 5140
    set mode udp
    set format default
end
```

FortiGate sender det, dens logindstillinger vælger. Begivenhedslogs indeholder tunnelerne, linkene og failoverne; trafiklogs er mange, så udelad dem, medmindre du vil have dem.

### Extreme Networks

```text
configure syslog add <probe-address>:5140 vr VR-Default local7
enable log target syslog <probe-address>:5140 vr VR-Default local7
enable syslog
```

Skift `VR-Default` til den virtuelle router, sonden nås igennem.

### HPE Aruba

```text
logging <probe-address> udp 5140 severity info
```

På AOS-CX tilføjer du `vrf mgmt` til linjen, når sonden nås gennem administrationsporten. På AOS-Switch er linjen `logging <probe-address> udp 5140`.

### MikroTik RouterOS

```text
/system logging action set remote remote=<probe-address> remote-port=5140
/system logging add topics=info action=remote
/system logging add topics=warning action=remote
/system logging add topics=error action=remote
/system logging add topics=critical action=remote
```

Den første linje peger routerens indbyggede remote-handling mod sonden; de andre vælger, hvad den sender. Lad det eksterne logformat være, som det er.

### Ubiquiti UniFi

1. Åbn **Integration** > **System Logging / SIEM** i UniFi Network, og vælg **SIEM Server** som destination.
2. Angiv sondens IP-adresse og port `5140`, og vælg de logkategorier, der skal eksporteres.

Konsollen rapporterer om de access points og switche, den styrer. Begivenheder lander på hver enheds egen side, når enheden er i OneUptime med sin MAC-adresse, og ellers på konsollens.

### Cambium Networks

1. Åbn systemindstillingerne i cnMaestro eller i access pointets webgrænseflade, og find syslog-serverne.
2. Angiv sondens IP-adresse som syslog-server, med port `5140`, hvor formularen beder om en port, og sæt syslog-alvorligheden til **Info**.

Hvor der ikke er nogen port at indstille, sender access pointet til port 514: publicer sondens port der, som trin 2 under [Opsætning](#opsætning) viser.

### Andre enheder

Tilføj en ekstern syslog-server på enheden: sondens IP-adresse, port 5140, over UDP eller TCP, med informationsbeskeder og alt, der er mere alvorligt. En enhed, hvis format OneUptime ikke kender, får stadig sine beskeder gemt, og du kan selv navngive dens begivenheder.

## Advarsler

**Opret advarsel** på en Begivenheder-side viser de advarsler, de fleste netværk vil have. Hver af dem åbner **Opret monitor** udfyldt, hvor du kan ændre alt, før du gemmer:

| Advarsel | Giver besked, når | Én advarsel pr. | Lukker, når |
| --- | --- | --- | --- |
| En VPN-tunnel går ned | `vpn.tunnel_down` | enhed og tunnel | `vpn.tunnel_up` for den tunnel |
| En firewall eller switch skifter over | `ha.failover` | enhed | der går 5 minutter uden endnu en |
| Et WAN-link går ned | `gateway.down` | enhed og gateway | `gateway.up` for den gateway |
| En routing-nabo går ned | `routing.neighbor_down` | enhed og nabo | `routing.neighbor_up` for den nabo |
| En enhed genstarter | `device.reboot` | enhed | der går 5 minutter uden endnu en |
| Hardware svigter | en blæser, en strømforsyning eller temperaturen | enhed og komponent | den samme komponent rapporteres at virke igen |
| Et interface går ned | `interface.down` | enhed og interface | `interface.up` for det interface |
| Nogen bliver ved med at fejle ved login | mere end 10 `auth.login_failed` på 5 minutter | enhed | der går 5 minutter med 10 eller færre |

Hver af dem er en [log-monitor](/docs/monitor/logs-monitor), der tæller begivenheden over de seneste 5 minutter, med **Group by Attributes** sat, så hver tunnel, gateway eller hvert interface får sin egen advarsel, og med **Løst af attributter** sat til den begivenhed, der siger, at problemet er ovre. Sådan en advarsel forbliver åben, indtil den begivenhed ankommer for den samme enhed og den samme tunnel, uanset hvor længe det varer; se [Løst af en log](/docs/monitor/logs-monitor#løst-af-en-log). OneUptime læser ingen begivenhed, der siger, at en temperatur er normal igen, så en temperaturadvarsel forbliver åben, indtil du løser den.

Fra en enheds **Begivenheder**-fane overvåger monitorerne kun den enhed. For enhver anden begivenhed åbner du en på Begivenheder-siden og klikker på **Opret advarsel for denne begivenhed**. For at sende en advarsel et sted hen, eller for at tilkalde nogen, føjer du en vagtpolitik eller et workflow til monitoren som til enhver anden.

## Adresser, der ikke er enheder endnu

Syslog kan ankomme, før den enhed, der sender det, er føjet til OneUptime. På din egen sonde gemmes det, dets begivenheder står på netværkets Begivenheder-side med det navn, enheden giver sig selv, og adressen står under **Sender syslog, endnu ikke en enhed**:

- **Tilføj som enhed** åbner **Tilføj enhed** med adressen og sonden udfyldt. De beskeder, der allerede er ankommet, bliver på netværkets side; nye går til enheden.
- **Det er en af mine enheder** føjer adressen til en enheds **Andre adresser**: brug den, når en enhed, du allerede har tilføjet, sender fra en anden adresse, f.eks. en loopback. Dens beskeder går til den enhed fra det næste minut.

Flere enheder bag én NAT-adresse deler den adresse, så deres beskeder går til den ene enhed, der har den, medmindre en besked nævner sin egen enhed.

## Dine egne begivenheder

En enhed, hvis format OneUptime ikke kender, eller en begivenhed, det ikke læser, kræver en [logpipeline](/docs/telemetry/log-pipelines):

1. Opret en pipeline, hvis filter matcher enhedens logs, f.eks. `attributes.networkDevice.name = 'rack-ups'`.
2. Tilføj en **Grok Parser** eller en **Key=Value Parser** for at trække de felter, du skal bruge, ud af beskeden.
3. Tilføj en **Kategoriprocessor** med **Målattribut** `event.name` og en regel pr. begivenhed. Navngiv hver som begivenhederne ovenfor, med små bogstaver og punktummer eller understregninger: `ups.on_battery`.

En log fra en netværksenhed, der bærer sådan et navn, bliver til en netværksbegivenhed: den står på Begivenheder-siderne, og **Opret advarsel for denne begivenhed** virker på den. For at sige, hvad den handler om, tilføjer du en **Attribut-genkortlægning**, der kopierer dit felt til en af attributterne i begivenhedstabellen, f.eks. `hw.name`. Medmindre din pipeline sætter `event.kind` til `problem` eller `recovery`, står begivenheden under **Til orientering**. En regel, der er navngivet efter en indbygget begivenhed, f.eks. `interface.down`, giver den indbyggede begivenhed med dens type og dens advarsler.

En pipeline hører til sit projekt. For at bruge en i et andet projekt opretter du den der med de samme processorer.

## Hvad der ikke er med

- **Syslog over TLS** (RFC 5425). Sonden tager imod almindelig UDP og TCP; hold vejen mellem enhederne og sonden på et netværk, du stoler på.
- **Deling af parsere mellem projekter.** En pipeline kan endnu ikke eksporteres og importeres.
- **Begivenheder fra andre SNMP-traps end de fire standard-traps.** En leverandørs egne traps gemmes som logs, og advarsler på dem laves med kriteriet **SNMP Trap Received (Trap OID)** i [netværksenheds-monitoren](/docs/monitor/network-device-monitor).
- **Cambium cnMatrix-switche, Aruba mobility controllere og FortiGate i CEF-tilstand.** Deres beskeder gemmes og kan søges i; der læses endnu ingen begivenheder ud af dem.
- **En livevisning.** Begivenheder-siden viser det, der var ankommet, da den blev åbnet; brug dens opdateringsknap eller livevisningen i **Protokoller**.

## Fejlfinding

Hvis en Begivenheder-side stadig viser sine opsætningstrin:

- **Modtager sonden overhovedet noget?** Netværkets Begivenheder-side viser under **Sender syslog, endnu ikke en enhed** alle adresser, der har sendt syslog i tidsrummet. Står enheden der, sender den fra en adresse, der ikke er dens værtsnavn: føj den adresse til dens **Andre adresser**.
- **Firewalls og Docker.** Tillad port 5140 fra enheden til sonden, og publicer porten, hvis sonden kører i Docker. Mange enheder sender til port 514, medmindre de får andet at vide.
- **Sondens log.** Ved opstart logger sonden den port, den lytter på, eller at den ikke kunne åbne den. Når den smider beskeder væk over `PROBE_SYSLOG_RATE_LIMIT_PER_MINUTE`, logger den hvor mange, én gang i minuttet.
- **En global sonde.** En enhed, der polles af en global sonde, kan ikke sende syslog til den fra et privat netværk. Kør en brugerdefineret sonde på enhedens netværk, og vælg den i enhedens indstillinger.
- **Der kommer beskeder, men ingen begivenheder.** Siden siger det, og hver besked står på enhedens **Protokoller**-fane. Tjek, at enheden sender informationsbeskeder, ikke kun fejl, og at produktet er et af dem under [Hvad OneUptime læser](#hvad-oneuptime-læser); ellers navngiver du dens begivenheder i en logpipeline.
