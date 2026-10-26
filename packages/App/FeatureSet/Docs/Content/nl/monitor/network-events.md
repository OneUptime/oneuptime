# Netwerkgebeurtenissen (syslog en SNMP-traps)

Routers, firewalls, switches en accesspoints zeggen in hun syslog wat er met ze gebeurt: een link viel uit, een tunnel viel weg, een firewall schakelde over, iemand meldde zich aan. Elke leverancier verwoordt het op zijn eigen manier. Richt hun syslog op een OneUptime-probe en de **Gebeurtenissen**-pagina's tonen in dezelfde woorden wat er gebeurde, wie het apparaat ook gemaakt heeft, en waarschuwen je als het weer gebeurt.

Er is op twee plekken een Gebeurtenissen-pagina:

- **Netwerk** -> **Gebeurtenissen**: het hele netwerk, de gebeurtenissen van elk apparaat op één pagina, en elk adres dat syslog stuurt zonder al een apparaat te zijn.
- Het tabblad **Gebeurtenissen** van een apparaat: wat dat ene apparaat gemeld heeft.

## Wat de Gebeurtenissen-pagina toont

- De gebeurtenissen van de periode, de nieuwste eerst. Elke rij zegt wat er gebeurde, op welk apparaat, waarmee - de interface, de tunnel, de gateway - en in de eigen woorden van het apparaat.
- **Problemen**, **Herstelmeldingen** en **Informatief**, elk met het aantal in de periode. Klik op één ervan om alleen die te zien.
- De kiezer **Alle gebeurtenissen** en, op de pagina van het netwerk, de kiezer **All devices** beperken de lijst verder. De periode en de filters staan in het adres van de pagina, dus een link opent precies dezelfde weergave.
- Klik op een gebeurtenis om haar te openen: wanneer ze gebeurde, waar ze over gaat, het bericht zoals het apparaat het stuurde, en elk attribuut dat OneUptime eruit las.
- **Waarschuwing maken** biedt de waarschuwingen die de meeste netwerken willen, en **Waarschuwing maken voor deze gebeurtenis** maakt er een voor de gebeurtenis die je opende. Zie [Waarschuwingen](#waarschuwingen).

Een gebeurtenis is een log. Alles op de Gebeurtenissen-pagina kun je ook doorzoeken, in grafieken zetten en voor waarschuwingen gebruiken vanuit **Logboeken**: een gebeurtenis is een log waarvan het attribuut `event.domain` gelijk is aan `network`, met wat er gebeurde in `event.name`.

## Wat OneUptime leest

Syslog in de vorm van RFC 3164 en RFC 5424 en het Common Event Format (CEF) worden van elk product gelezen. Daarbovenop weet OneUptime wat deze producten schrijven:

| Leverancier | Producten | Gebeurtenissen die het leest | Attributen |
| --- | --- | --- | --- |
| Cisco | IOS, IOS XE, NX-OS, ASA | Interfaces, Apparaten, Hoge beschikbaarheid, VPN, Routering, Hardware, Switching, Aanmeldingen | `cisco.*` |
| Sophos | Sophos Firewall (SFOS, XG, XGS) | Interfaces, Apparaten, Hoge beschikbaarheid, VPN, WAN, Aanmeldingen | `sophos.*` |
| Fortinet | FortiGate (FortiOS) | Interfaces, Apparaten, Hoge beschikbaarheid, VPN, WAN, Hardware, Aanmeldingen | `fortigate.*` |
| Extreme Networks | ExtremeXOS, Switch Engine | Interfaces, Apparaten, Hoge beschikbaarheid, Routering, Hardware, Switching, Aanmeldingen | `extreme.*` |
| Extreme Networks | Fabric Engine, VOSS | Interfaces, Routering | `extreme.*` |
| HPE Aruba Networking | AOS-CX | Interfaces, Hardware | `aruba.*` |
| HPE Aruba Networking | AOS-Switch (ArubaOS-Switch, ProCurve) | Interfaces | `aruba.*` |
| MikroTik | RouterOS | Interfaces, Apparaten, Aanmeldingen | `mikrotik.*` |
| Cambium Networks | Enterprise Wi-Fi (cnPilot, XV, XE, XH) | Apparaten, VPN, Wifi | `cambium.*` |
| Ubiquiti | UniFi Network | Apparaten, WAN, Switching, Aanmeldingen, Wifi | `cef.*` |
| Elke | Apparaten op basis van Linux (kernel, hostapd, OpenSSH, Dropbear) | Interfaces, Aanmeldingen, Wifi | - |

Van een bericht in een van deze formaten worden de eigen velden opgeslagen als attributen onder het voorvoegsel uit de laatste kolom, dus `con_name="HQ-Branch1"` op een Sophos-firewall is het attribuut `sophos.con_name`. Van een CEF-bericht van elk ander product worden de header en de extensievelden opgeslagen onder `cef.*`. Een bericht dat OneUptime niet kan plaatsen wordt toch als log opgeslagen, met de syslog-header gelezen; je kunt de gebeurtenissen ervan zelf een naam geven, zie [Je eigen gebeurtenissen](#je-eigen-gebeurtenissen).

De standaard SNMP-traps worden als dezelfde gebeurtenissen gelezen: `linkDown` en `linkUp` worden **Interface uitgevallen** en **Interface actief**, `coldStart` en `warmStart` worden **Apparaat opnieuw opgestart**.

## De gebeurtenissen

Elk bericht dat OneUptime herkent wordt opgeslagen met een van deze namen in `event.name`, wie het apparaat ook gemaakt heeft:

| Gebeurtenis | `event.name` | Soort | Gaat over |
| --- | --- | --- | --- |
| Interface uitgevallen | `interface.down` | Probleem | `network.interface.name` |
| Interface actief | `interface.up` | Herstel | `network.interface.name` |
| Poort uitgeschakeld door de switch | `interface.error_disabled` | Probleem | `network.interface.name` |
| Apparaat opnieuw opgestart | `device.reboot` | Probleem | - |
| Configuratie gewijzigd | `device.config_change` | Informatief | `user.name` |
| Apparaat offline | `device.offline` | Probleem | - |
| Apparaat online | `device.online` | Herstel | - |
| Failover | `ha.failover` | Probleem | `ha.role` |
| Status van hoge beschikbaarheid gewijzigd | `ha.state_change` | Informatief | `ha.role` |
| Peer voor hoge beschikbaarheid uitgevallen | `ha.peer_down` | Probleem | `ha.peer` |
| Peer voor hoge beschikbaarheid beschikbaar | `ha.peer_up` | Herstel | `ha.peer` |
| VPN-tunnel uitgevallen | `vpn.tunnel_down` | Probleem | `vpn.tunnel.name` |
| VPN-tunnel actief | `vpn.tunnel_up` | Herstel | `vpn.tunnel.name` |
| Routeringsbuur uitgevallen | `routing.neighbor_down` | Probleem | `network.peer.address` |
| Routeringsbuur beschikbaar | `routing.neighbor_up` | Herstel | `network.peer.address` |
| Gateway uitgevallen | `gateway.down` | Probleem | `network.gateway.name` |
| Gateway beschikbaar | `gateway.up` | Herstel | `network.gateway.name` |
| WAN-failover | `wan.failover` | Probleem | `network.gateway.name` |
| SD-WAN-link onder zijn SLA | `sdwan.sla_not_met` | Probleem | `network.gateway.name` |
| SD-WAN-link weer binnen zijn SLA | `sdwan.sla_met` | Herstel | `network.gateway.name` |
| Ventilator defect | `hardware.fan_failed` | Probleem | `hw.name` |
| Ventilator werkt weer | `hardware.fan_ok` | Herstel | `hw.name` |
| Voeding defect | `hardware.power_supply_failed` | Probleem | `hw.name` |
| Voeding werkt weer | `hardware.power_supply_ok` | Herstel | `hw.name` |
| Temperatuur te hoog | `hardware.temperature_high` | Probleem | - |
| Lus gedetecteerd | `loop.detected` | Probleem | `network.interface.name` |
| Wijziging in de spanning-tree-topologie | `stp.topology_change` | Informatief | - |
| PoE-storing | `poe.fault` | Probleem | `network.interface.name` |
| Aanmelding mislukt | `auth.login_failed` | Probleem | `user.name` |
| Aangemeld | `auth.login_success` | Informatief | `user.name` |
| Wifi-client verbonden | `wireless.client_connected` | Informatief | `client.mac` |
| Wifi-client verbroken | `wireless.client_disconnected` | Informatief | `client.mac` |

De laatste kolom is het attribuut dat zegt waar de gebeurtenis over gaat. Niet elk product meldt elke gebeurtenis: een switch heeft geen VPN-tunnels, en de syslog van een product zegt maar zoveel.

Elke gebeurtenis draagt ook:

| Attribuut | Wat erin staat |
| --- | --- |
| `event.domain` | `network`, op elke netwerkgebeurtenis |
| `event.kind` | `problem`, `recovery` of `info` |
| `event.category` | `interface`, `device`, `ha`, `vpn`, `routing`, `wan`, `hardware`, `switching`, `security` of `wireless`, op de gebeurtenissen hierboven |
| `event.device` | Welk apparaat: zijn naam in OneUptime, anders de naam die het zichzelf geeft, anders zijn adres |
| `event.message` | Wat het apparaat zei, in zijn eigen woorden |
| `syslog.vendor`, `syslog.parser` | Als wiens formaat het bericht gelezen is |

## Hoe gebeurtenissen hier komen

Elke probe luistert naar syslog op poort 5140, via UDP en via TCP. Via TCP is een bericht een regel, of wordt het voorafgegaan door zijn lengte, zoals RFC 6587 beschrijft. De probe stuurt om de paar seconden door naar OneUptime wat hij hoort, en OneUptime koppelt elk bericht aan een apparaat op basis van het adres waar het vandaan kwam:

1. een apparaat dat de probe bevraagt en waarvan de hostnaam dat adres is (of ernaar resolvet), of dat het vermeldt onder **Overige adressen** op zijn **Instellingen**-pagina;
2. op je eigen (aangepaste) probe, elk apparaat in het project met dat adres, of met de hostnaam die het bericht draagt als precies één apparaat die naam heeft;
3. anders wordt het bericht op je eigen probe bewaard voor de Gebeurtenissen-pagina van het netwerk, onder **Stuurt syslog, nog geen apparaat**, tot je zegt bij welk apparaat het hoort. Een globale probe gooit het weg.

Een regel van een onbekend adres die geen syslog-prioriteit heeft en geen gebeurtenis is, wordt voor ruis gehouden en weggegooid.

Een controller spreekt voor de apparaten die hij beheert: een UniFi-console meldt over zijn accesspoints en switches. Als een bericht van een apparaat een ander apparaat noemt met zijn MAC-adres, zijn serienummer, zijn adres of de naam die zijn controller het geeft, gaat de gebeurtenis naar dat apparaat, en de log bewaart de naam van de controller die het bericht doorgaf in `syslog.relay.name`.

Een log wordt opgeslagen op het tijdstip waarop de probe hem ontving. Een bericht dat werd vastgehouden - zijn eigen tijdstempel staat in de vorm van RFC 5424, die de tijdzone noemt, en is ouder dan 5 minuten - houdt de tijd van het apparaat, tot 7 dagen terug. Elk ander tijdstempel dat meer dan 5 minuten van de klok van de probe afwijkt, wordt niet geloofd: de log wordt opgeslagen op het tijdstip van ontvangst, en de tijd van het apparaat wordt bewaard in `syslog.deviceTime`.

Syslog die je via HTTPS naar [het syslog-endpoint](/docs/telemetry/syslog) stuurt, wordt door dezelfde parsers gelezen. Daar wordt een bericht een netwerkgebeurtenis als het in het eigen formaat van een netwerkleverancier staat, of als het een van je netwerkapparaten noemt met MAC-adres, serienummer, adres of hostnaam; de `sshd`-regels van een server blijven gewone logs.

## Instellen

1. **Gebruik een probe in het netwerk van het apparaat.** Syslog wordt door je apparaten verstuurd, dus ze hebben een [aangepaste probe](/docs/probe/custom-probe) nodig die ze kunnen bereiken. Een globale probe op het openbare internet ontvangt die niet.
2. **Laat syslog de probe bereiken.** Sta poort 5140, UDP of TCP, toe van de apparaten naar de probe. Een probe in Docker die met hostnetwerk (`--network host`) is gestart, zoals de pagina over de aangepaste probe laat zien, ontvangt syslog zoals hij is; zonder hostnetwerk publiceer je de poort met `-p 5140:5140/udp -p 5140:5140/tcp`. Voor een apparaat dat alleen naar poort 514 kan sturen, publiceer je de poort als `-p 514:5140/udp`, of stel je `PROBE_SYSLOG_RECEIVER_PORT=514` in op een probe met hostnetwerk.
3. **Stel de probe in als syslog-server van het apparaat.** De commando's voor gangbare apparaten staan hieronder. De **Gebeurtenissen**-pagina toont dezelfde stappen tot het eerste bericht binnenkomt, en wordt dan vanzelf de lijst.
4. **Controleer het adres van het apparaat.** Berichten worden gekoppeld op basis van het adres waarvandaan het apparaat verstuurt. Verstuurt het vanaf een loopback of een beheerinterface die niet zijn hostnaam is, voeg dat adres dan toe aan de **Overige adressen** van het apparaat.

De syslog-ontvanger staat standaard aan. De instellingen zijn omgevingsvariabelen van de probe:

| Variabele | Wat ze doet | Standaard |
| --- | --- | --- |
| `PROBE_SYSLOG_RECEIVER_ENABLED` | Zet op `false` om de syslog-ontvanger uit te zetten | `true` |
| `PROBE_SYSLOG_RECEIVER_PORT` | De poort, voor UDP en TCP | `5140` |
| `PROBE_SYSLOG_RATE_LIMIT_PER_MINUTE` | Doorgestuurde berichten per minuut, over alle apparaten samen | `600` |

Voorbij de limiet stuurt de probe nog steeds de berichten door die hij als netwerkgebeurtenis leest, tot nog eens zoveel, zodat een vloed van routineregels niet die ene kan verdringen die zegt dat een link uitviel. Een probe die ouder is dan deze functie luistert alleen als hij met `PROBE_SYSLOG_RECEIVER_ENABLED=true` wordt gestart, en alleen via UDP: werk hem bij.

### Cisco IOS, IOS XE en NX-OS

```text
logging host <probe-address> transport udp port 5140
logging trap informational
service timestamps log datetime msec
```

De tweede regel stuurt informatieve berichten en alles wat ernstiger is: linkwijzigingen, herstarts en aanmeldingen horen daarbij. Op NX-OS is de regel `logging server <probe-address> 6 port 5140 use-vrf management`.

### Sophos Firewall

1. Open in de webbeheerinterface van de firewall **System services** > **Log settings** en kies onder **Syslog servers** voor **Add**.
2. Vul het IP-adres van de probe en poort `5140` in, en zet het ernstniveau op **Information**. Beide logformaten die de firewall aanbiedt worden gelezen.
3. Terug op **Log settings** vink je de nieuwe server aan voor de logs die je wilt versturen: minstens de systeemgebeurtenissen, en **SD-WAN** voor SLA-wijzigingen. Verkeerslogs van de firewall zijn talrijk, dus laat ze weg tenzij je ze wilt.

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

FortiGate stuurt wat zijn loginstellingen selecteren. Gebeurtenislogs bevatten de tunnels, links en failovers; verkeerslogs zijn talrijk, dus laat ze weg tenzij je ze wilt.

### Extreme Networks

```text
configure syslog add <probe-address>:5140 vr VR-Default local7
enable log target syslog <probe-address>:5140 vr VR-Default local7
enable syslog
```

Verander `VR-Default` in de virtuele router waarlangs de probe bereikt wordt.

### HPE Aruba

```text
logging <probe-address> udp 5140 severity info
```

Voeg op AOS-CX `vrf mgmt` aan de regel toe als de probe via de beheerpoort bereikt wordt. Op AOS-Switch is de regel `logging <probe-address> udp 5140`.

### MikroTik RouterOS

```text
/system logging action set remote remote=<probe-address> remote-port=5140
/system logging add topics=info action=remote
/system logging add topics=warning action=remote
/system logging add topics=error action=remote
/system logging add topics=critical action=remote
```

De eerste regel richt de ingebouwde remote-actie van de router op de probe; de andere kiezen wat hij stuurt. Laat het remote-logformaat zoals het is.

### Ubiquiti UniFi

1. Open in UniFi Network **Integration** > **System Logging / SIEM** en selecteer **SIEM Server** als bestemming.
2. Vul het IP-adres van de probe en poort `5140` in, en kies de logcategorieën om te exporteren.

De console meldt over de accesspoints en switches die hij beheert. Gebeurtenissen komen op de eigen pagina van elk apparaat terecht als het apparaat met zijn MAC-adres in OneUptime staat, en anders op die van de console.

### Cambium Networks

1. Open in cnMaestro of in de webinterface van het accesspoint de systeeminstellingen en zoek de syslog-servers.
2. Vul het IP-adres van de probe in als syslog-server, met poort `5140` waar het formulier om een poort vraagt, en zet de syslog-ernst op **Info**.

Waar geen poort in te stellen is, stuurt het accesspoint naar poort 514: publiceer de poort van de probe daar, zoals stap 2 van [Instellen](#instellen) laat zien.

### Andere apparaten

Voeg op het apparaat een externe syslog-server toe: het IP-adres van de probe, poort 5140, via UDP of TCP, met informatieve berichten en alles wat ernstiger is. Van een apparaat waarvan OneUptime het formaat niet kent worden de berichten toch opgeslagen, en je kunt de gebeurtenissen ervan zelf een naam geven.

## Waarschuwingen

**Waarschuwing maken** op een Gebeurtenissen-pagina somt de waarschuwingen op die de meeste netwerken willen. Elke opent **Monitor maken** ingevuld, waar je alles kunt wijzigen voordat je opslaat:

| Waarschuwing | Meldt je wanneer | Eén waarschuwing per | Sluit wanneer |
| --- | --- | --- | --- |
| Een VPN-tunnel valt uit | `vpn.tunnel_down` | apparaat en tunnel | `vpn.tunnel_up` voor die tunnel |
| Een firewall of switch schakelt over | `ha.failover` | apparaat | 5 minuten voorbijgaan zonder een volgende |
| Een WAN-link valt uit | `gateway.down` | apparaat en gateway | `gateway.up` voor die gateway |
| Een routeringsbuur valt uit | `routing.neighbor_down` | apparaat en buur | `routing.neighbor_up` voor die buur |
| Een apparaat start opnieuw op | `device.reboot` | apparaat | 5 minuten voorbijgaan zonder een volgende |
| Hardware valt uit | een ventilator, een voeding of de temperatuur | apparaat en onderdeel | hetzelfde onderdeel weer als werkend gemeld wordt |
| Een interface valt uit | `interface.down` | apparaat en interface | `interface.up` voor die interface |
| Iemand blijft falen bij het aanmelden | meer dan 10 `auth.login_failed` in 5 minuten | apparaat | 5 minuten voorbijgaan met 10 of minder |

Elk is een [logs-monitor](/docs/monitor/logs-monitor) die de gebeurtenis over de laatste 5 minuten telt, met **Group by Attributes** zo ingesteld dat elke tunnel, gateway of interface een eigen waarschuwing krijgt, en met **Opgelost door attributen** ingesteld op de gebeurtenis die zegt dat het probleem voorbij is. Zo'n waarschuwing blijft open tot die gebeurtenis binnenkomt voor hetzelfde apparaat en dezelfde tunnel, hoe lang dat ook duurt; zie [Opgelost door een log](/docs/monitor/logs-monitor#opgelost-door-een-log). OneUptime leest geen gebeurtenis die zegt dat een temperatuur weer normaal is, dus een temperatuurwaarschuwing blijft open tot je haar oplost.

Vanaf het tabblad **Gebeurtenissen** van een apparaat bewaken de monitors alleen dat apparaat. Voor elke andere gebeurtenis open je er een op de Gebeurtenissen-pagina en klik je op **Waarschuwing maken voor deze gebeurtenis**. Om een waarschuwing ergens heen te sturen, of om iemand op te roepen, voeg je een bereikbaarheidsbeleid of een workflow aan de monitor toe, zoals bij elke andere.

## Adressen die nog geen apparaat zijn

Syslog kan binnenkomen voordat het apparaat dat het stuurt aan OneUptime is toegevoegd. Op je eigen probe wordt het bewaard, de gebeurtenissen ervan staan op de Gebeurtenissen-pagina van het netwerk met de naam die het apparaat zichzelf geeft, en het adres staat onder **Stuurt syslog, nog geen apparaat**:

- **Toevoegen als apparaat** opent **Apparaat toevoegen** met het adres en de probe al ingevuld. De berichten die al binnenkwamen blijven op de pagina van het netwerk; nieuwe gaan naar het apparaat.
- **Het is een van mijn apparaten** voegt het adres toe aan de **Overige adressen** van een apparaat: gebruik dit als een apparaat dat je al toevoegde vanaf een ander adres verstuurt, zoals een loopback. Zijn berichten gaan vanaf de volgende minuut naar dat apparaat.

Meerdere apparaten achter één NAT-adres delen dat adres, dus hun berichten gaan naar het ene apparaat dat het heeft, tenzij een bericht zijn eigen apparaat noemt.

## Je eigen gebeurtenissen

Voor een apparaat waarvan OneUptime het formaat niet kent, of een gebeurtenis die het niet leest, is een [logboekpipeline](/docs/telemetry/log-pipelines) nodig:

1. Maak een pipeline waarvan het filter overeenkomt met de logs van het apparaat, zoals `attributes.networkDevice.name = 'rack-ups'`.
2. Voeg een **Grok Parser** of een **Key=Value Parser** toe om de velden die je nodig hebt uit het bericht te halen.
3. Voeg een **Categorieverwerker** toe met **Doelattribuut** `event.name`, en een regel per gebeurtenis. Geef elke een naam zoals de gebeurtenissen hierboven, in kleine letters met punten of underscores: `ups.on_battery`.

Een log van een netwerkapparaat die zo'n naam draagt wordt een netwerkgebeurtenis: ze staat op de Gebeurtenissen-pagina's, en **Waarschuwing maken voor deze gebeurtenis** werkt erop. Om te zeggen waar ze over gaat, voeg je een **Attribuut-hertoewijzer** toe die je veld kopieert naar een van de attributen uit de gebeurtenissentabel, zoals `hw.name`. Tenzij je pipeline `event.kind` op `problem` of `recovery` zet, staat de gebeurtenis onder **Informatief**. Een regel die naar een ingebouwde gebeurtenis is genoemd, zoals `interface.down`, levert de ingebouwde gebeurtenis op, met haar soort en haar waarschuwingen.

Een pipeline hoort bij zijn project. Om er een in een ander project te gebruiken, maak je hem daar aan met dezelfde processors.

## Wat er niet bij zit

- **Syslog over TLS** (RFC 5425). De probe neemt gewone UDP en TCP aan; houd het pad tussen de apparaten en de probe op een netwerk dat je vertrouwt.
- **Parsers delen tussen projecten.** Een pipeline kan nog niet geëxporteerd en geïmporteerd worden.
- **Gebeurtenissen uit andere SNMP-traps dan de vier standaardtraps.** De eigen traps van een leverancier worden als logs opgeslagen, en waarschuwingen daarop maak je met het criterium **SNMP Trap Received (Trap OID)** van de [netwerkapparaat-monitor](/docs/monitor/network-device-monitor).
- **Cambium cnMatrix-switches, Aruba mobility controllers en FortiGate in CEF-modus.** Hun berichten worden opgeslagen en zijn doorzoekbaar; er worden nog geen gebeurtenissen uit gelezen.
- **Een live weergave.** De Gebeurtenissen-pagina toont wat er binnen was toen ze geopend werd; gebruik haar vernieuwknop, of de live weergave van **Logboeken**.

## Problemen oplossen

Als een Gebeurtenissen-pagina nog steeds de installatiestappen toont:

- **Ontvangt de probe iets?** De Gebeurtenissen-pagina van het netwerk vermeldt onder **Stuurt syslog, nog geen apparaat** elk adres dat in de periode syslog stuurde. Staat het apparaat daar, dan verstuurt het vanaf een adres dat niet zijn hostnaam is: voeg dat adres toe aan zijn **Overige adressen**.
- **Firewalls en Docker.** Sta poort 5140 toe van het apparaat naar de probe, en publiceer de poort als de probe in Docker draait. Veel apparaten sturen naar poort 514 tenzij je iets anders opgeeft.
- **De log van de probe.** Bij het opstarten logt de probe op welke poort hij luistert, of dat hij die niet kon openen. Als hij berichten weggooit boven `PROBE_SYSLOG_RATE_LIMIT_PER_MINUTE`, logt hij één keer per minuut hoeveel.
- **Een globale probe.** Een apparaat dat door een globale probe wordt bevraagd, kan er vanuit een privénetwerk geen syslog naartoe sturen. Draai een aangepaste probe in het netwerk van het apparaat en kies die in de instellingen van het apparaat.
- **Er komen berichten binnen, maar geen gebeurtenissen.** De pagina zegt dat, en elk bericht staat op het tabblad **Logboeken** van het apparaat. Controleer of het apparaat informatieve berichten stuurt, niet alleen fouten, en of het product een van de producten onder [Wat OneUptime leest](#wat-oneuptime-leest) is; geef anders zijn gebeurtenissen een naam in een logboekpipeline.
