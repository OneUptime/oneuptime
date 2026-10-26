# Nettverkshendelser (syslog og SNMP-traps)

Rutere, brannmurer, svitsjer og aksesspunkter forteller i sysloggen sin hva som skjer med dem: en lenke gikk ned, en tunnel falt ut, en brannmur byttet over, noen logget på. Hver leverandør formulerer det på sin egen måte. Pek sysloggen deres mot en OneUptime-sonde, så viser **Hendelser**-sidene hva som skjedde, med de samme ordene uansett hvem som har laget enheten, og varsler deg når det skjer igjen.

Det finnes en Hendelser-side to steder:

- **Nettverk** -> **Hendelser**: hele nettverket, hendelsene fra alle enheter på én side, og alle adresser som sender syslog uten å være en enhet ennå.
- **Hendelser**-fanen til en enhet: det den ene enheten har rapportert.

## Hva Hendelser-siden viser

- Hendelsene i tidsrommet, de nyeste først. Hver rad sier hva som skjedde, på hvilken enhet, med hva - grensesnittet, tunnelen, gatewayen - og med enhetens egne ord.
- **Problemer**, **Gjenopprettinger** og **Til orientering**, hver med antallet i tidsrommet. Klikk på en av dem for å se bare dem.
- Velgeren **Alle hendelser** og, på nettverkets side, velgeren **All devices** snevrer listen inn ytterligere. Tidsrommet og filtrene lagres i adressen til siden, så en lenke åpner nøyaktig samme visning.
- Klikk på en hendelse for å åpne den: når den skjedde, hva den handler om, meldingen slik enheten sendte den, og alle attributter OneUptime leste ut av den.
- **Opprett varsel** tilbyr varslene de fleste nettverk vil ha, og **Opprett varsel for denne hendelsen** lager ett for hendelsen du har åpnet. Se [Varsler](#varsler).

En hendelse er en logg. Alt på Hendelser-siden kan også søkes i, vises i diagrammer og brukes til varsler fra **Logger**: en hendelse er en logg der attributtet `event.domain` er `network`, med det som skjedde i `event.name`.

## Hva OneUptime leser

Syslog i RFC 3164- og RFC 5424-form og Common Event Format (CEF) leses fra et hvilket som helst produkt. I tillegg vet OneUptime hva disse produktene skriver:

| Leverandør | Produkter | Hendelser det leser | Attributter |
| --- | --- | --- | --- |
| Cisco | IOS, IOS XE, NX-OS, ASA | Grensesnitt, Enheter, Høy tilgjengelighet, VPN, Ruting, Maskinvare, Svitsjing, Pålogginger | `cisco.*` |
| Sophos | Sophos Firewall (SFOS, XG, XGS) | Grensesnitt, Enheter, Høy tilgjengelighet, VPN, WAN, Pålogginger | `sophos.*` |
| Fortinet | FortiGate (FortiOS) | Grensesnitt, Enheter, Høy tilgjengelighet, VPN, WAN, Maskinvare, Pålogginger | `fortigate.*` |
| Extreme Networks | ExtremeXOS, Switch Engine | Grensesnitt, Enheter, Høy tilgjengelighet, Ruting, Maskinvare, Svitsjing, Pålogginger | `extreme.*` |
| Extreme Networks | Fabric Engine, VOSS | Grensesnitt, Ruting | `extreme.*` |
| HPE Aruba Networking | AOS-CX | Grensesnitt, Maskinvare | `aruba.*` |
| HPE Aruba Networking | AOS-Switch (ArubaOS-Switch, ProCurve) | Grensesnitt | `aruba.*` |
| MikroTik | RouterOS | Grensesnitt, Enheter, Pålogginger | `mikrotik.*` |
| Cambium Networks | Enterprise Wi-Fi (cnPilot, XV, XE, XH) | Enheter, VPN, Wi-Fi | `cambium.*` |
| Ubiquiti | UniFi Network | Enheter, WAN, Svitsjing, Pålogginger, Wi-Fi | `cef.*` |
| Alle | Linux-baserte enheter (kernel, hostapd, OpenSSH, Dropbear) | Grensesnitt, Pålogginger, Wi-Fi | - |

En melding i et av disse formatene får sine egne felt lagret som attributter under prefikset i siste kolonne, så `con_name="HQ-Branch1"` på en Sophos-brannmur er attributtet `sophos.con_name`. En CEF-melding fra et hvilket som helst annet produkt får headeren og utvidelsesfeltene sine lagret under `cef.*`. En melding OneUptime ikke kan plassere, lagres likevel som en logg, med syslog-headeren lest; du kan selv gi hendelsene dens navn, se [Dine egne hendelser](#dine-egne-hendelser).

Standard SNMP-traps leses som de samme hendelsene: `linkDown` og `linkUp` blir **Grensesnitt nede** og **Grensesnitt oppe**, `coldStart` og `warmStart` blir **Enhet startet på nytt**.

## Hendelsene

Hver melding OneUptime kjenner igjen, lagres med ett av disse navnene i `event.name`, uansett hvem som har laget enheten:

| Hendelse | `event.name` | Type | Handler om |
| --- | --- | --- | --- |
| Grensesnitt nede | `interface.down` | Problem | `network.interface.name` |
| Grensesnitt oppe | `interface.up` | Gjenoppretting | `network.interface.name` |
| Port slått av av svitsjen | `interface.error_disabled` | Problem | `network.interface.name` |
| Enhet startet på nytt | `device.reboot` | Problem | - |
| Konfigurasjon endret | `device.config_change` | Til orientering | `user.name` |
| Enhet frakoblet | `device.offline` | Problem | - |
| Enhet tilkoblet | `device.online` | Gjenoppretting | - |
| Failover | `ha.failover` | Problem | `ha.role` |
| Tilstand for høy tilgjengelighet endret | `ha.state_change` | Til orientering | `ha.role` |
| Peer for høy tilgjengelighet nede | `ha.peer_down` | Problem | `ha.peer` |
| Peer for høy tilgjengelighet oppe | `ha.peer_up` | Gjenoppretting | `ha.peer` |
| VPN-tunnel nede | `vpn.tunnel_down` | Problem | `vpn.tunnel.name` |
| VPN-tunnel oppe | `vpn.tunnel_up` | Gjenoppretting | `vpn.tunnel.name` |
| Rutingnabo nede | `routing.neighbor_down` | Problem | `network.peer.address` |
| Rutingnabo oppe | `routing.neighbor_up` | Gjenoppretting | `network.peer.address` |
| Gateway nede | `gateway.down` | Problem | `network.gateway.name` |
| Gateway oppe | `gateway.up` | Gjenoppretting | `network.gateway.name` |
| WAN-failover | `wan.failover` | Problem | `network.gateway.name` |
| SD-WAN-lenke under SLA-en | `sdwan.sla_not_met` | Problem | `network.gateway.name` |
| SD-WAN-lenke tilbake innenfor SLA-en | `sdwan.sla_met` | Gjenoppretting | `network.gateway.name` |
| Vifte defekt | `hardware.fan_failed` | Problem | `hw.name` |
| Vifte virker igjen | `hardware.fan_ok` | Gjenoppretting | `hw.name` |
| Strømforsyning defekt | `hardware.power_supply_failed` | Problem | `hw.name` |
| Strømforsyning virker igjen | `hardware.power_supply_ok` | Gjenoppretting | `hw.name` |
| Temperatur for høy | `hardware.temperature_high` | Problem | - |
| Sløyfe oppdaget | `loop.detected` | Problem | `network.interface.name` |
| Endring i spanning tree-topologien | `stp.topology_change` | Til orientering | - |
| PoE-feil | `poe.fault` | Problem | `network.interface.name` |
| Pålogging mislyktes | `auth.login_failed` | Problem | `user.name` |
| Logget på | `auth.login_success` | Til orientering | `user.name` |
| Wi-Fi-klient tilkoblet | `wireless.client_connected` | Til orientering | `client.mac` |
| Wi-Fi-klient frakoblet | `wireless.client_disconnected` | Til orientering | `client.mac` |

Den siste kolonnen er attributtet som sier hva hendelsen handler om. Ikke alle produkter rapporterer alle hendelser: en svitsj har ingen VPN-tunneler, og sysloggen til et produkt sier bare så mye.

Hver hendelse har også:

| Attributt | Hva det inneholder |
| --- | --- |
| `event.domain` | `network`, på alle nettverkshendelser |
| `event.kind` | `problem`, `recovery` eller `info` |
| `event.category` | `interface`, `device`, `ha`, `vpn`, `routing`, `wan`, `hardware`, `switching`, `security` eller `wireless`, på hendelsene ovenfor |
| `event.device` | Hvilken enhet: navnet i OneUptime, ellers navnet den gir seg selv, ellers adressen |
| `event.message` | Hva enheten sa, med sine egne ord |
| `syslog.vendor`, `syslog.parser` | Hvem sitt format meldingen ble lest som |

## Hvordan hendelser kommer hit

Alle sonder lytter etter syslog på port 5140, over UDP og over TCP. Over TCP er en melding en linje, eller den har lengden sin foran seg, slik RFC 6587 beskriver. Sonden videresender det den hører til OneUptime med noen sekunders mellomrom, og OneUptime knytter hver melding til en enhet etter adressen den kom fra:

1. en enhet sonden poller der vertsnavnet er den adressen (eller slås opp til den), eller som har den under **Andre adresser** på **Innstillinger**-siden sin;
2. på din egen (egendefinerte) sonde, en hvilken som helst enhet i prosjektet med den adressen, eller med vertsnavnet meldingen bærer når nøyaktig én enhet har det navnet;
3. ellers lagres meldingen på din egen sonde for nettverkets Hendelser-side, under **Sender syslog, ennå ikke en enhet**, til du sier hvilken enhet den hører til. En global sonde forkaster den.

En linje fra en ukjent adresse som ikke har noen syslog-prioritet og ikke er en hendelse, regnes som støy og forkastes.

En kontroller snakker for enhetene den administrerer: en UniFi-konsoll rapporterer om aksesspunktene og svitsjene sine. Når en melding fra en enhet nevner en annen enhet ved MAC-adressen, serienummeret, adressen eller navnet kontrolleren gir den, går hendelsen til den enheten, og loggen tar vare på navnet til kontrolleren som sendte den videre, i `syslog.relay.name`.

En logg lagres med tidspunktet sonden mottok den. En melding som ble holdt tilbake - dens eget tidsstempel er i RFC 5424-form, som oppgir tidssonen, og er mer enn 5 minutter gammelt - beholder enhetens tid, opptil 7 dager tilbake. Ethvert annet tidsstempel som ligger mer enn 5 minutter unna sondens klokke, blir ikke trodd: loggen lagres med tidspunktet den ble mottatt, og enhetens tid tas vare på i `syslog.deviceTime`.

Syslog du sender til [syslog-endepunktet](/docs/telemetry/syslog) over HTTPS, leses av de samme parserne. Der blir en melding en nettverkshendelse når den er i en nettverksleverandørs eget format, eller når den nevner en av nettverksenhetene dine ved MAC-adresse, serienummer, adresse eller vertsnavn; `sshd`-linjene til en server forblir vanlige logger.

## Oppsett

1. **Bruk en sonde på enhetens nettverk.** Syslog sendes av enhetene dine, så de trenger en [egendefinert sonde](/docs/probe/custom-probe) de kan nå. En global sonde på det offentlige internettet mottar det ikke.
2. **La syslog nå sonden.** Tillat port 5140, UDP eller TCP, fra enhetene til sonden. En sonde i Docker som er startet med vertsnettverket (`--network host`), slik siden om den egendefinerte sonden viser, mottar det som den er; uten vertsnettverket publiserer du porten med `-p 5140:5140/udp -p 5140:5140/tcp`. For en enhet som bare kan sende til port 514, publiserer du porten som `-p 514:5140/udp`, eller setter `PROBE_SYSLOG_RECEIVER_PORT=514` på en sonde med vertsnettverket.
3. **Sett sonden som enhetens syslog-server.** Kommandoene for vanlige enheter står nedenfor. **Hendelser**-siden viser de samme trinnene til den første meldingen kommer, og blir så til listen av seg selv.
4. **Sjekk adressen til enheten.** Meldinger knyttes etter adressen enheten sender fra. Hvis den sender fra en loopback eller et administrasjonsgrensesnitt som ikke er vertsnavnet, legger du den adressen til enhetens **Andre adresser**.

Syslog-mottakeren er slått på som standard. Innstillingene er miljøvariabler på sonden:

| Variabel | Hva den gjør | Standard |
| --- | --- | --- |
| `PROBE_SYSLOG_RECEIVER_ENABLED` | Sett til `false` for å slå av syslog-mottakeren | `true` |
| `PROBE_SYSLOG_RECEIVER_PORT` | Porten, for UDP og TCP | `5140` |
| `PROBE_SYSLOG_RATE_LIMIT_PER_MINUTE` | Videresendte meldinger per minutt, på tvers av alle enheter | `600` |

Over grensen videresender sonden fortsatt meldingene den leser som nettverkshendelser, opptil like mange til, slik at en flom av rutinelinjer ikke kan fortrenge den ene som sier at en lenke gikk ned. En sonde som er eldre enn denne funksjonen, lytter bare når den startes med `PROBE_SYSLOG_RECEIVER_ENABLED=true`, og bare over UDP: oppdater den.

### Cisco IOS, IOS XE og NX-OS

```text
logging host <probe-address> transport udp port 5140
logging trap informational
service timestamps log datetime msec
```

Den andre linjen sender informasjonsmeldinger og alt som er mer alvorlig: lenkeendringer, omstarter og pålogginger er blant dem. På NX-OS er linjen `logging server <probe-address> 6 port 5140 use-vrf management`.

### Sophos Firewall

1. Åpne **System services** > **Log settings** i brannmurens webadministrasjon, og velg **Add** under **Syslog servers**.
2. Skriv inn sondens IP-adresse og port `5140`, og sett alvorlighetsnivået til **Information**. Begge loggformatene brannmuren tilbyr, leses.
3. Tilbake på **Log settings** krysser du av den nye serveren for loggene som skal sendes: minst systemhendelsene, og **SD-WAN** for SLA-endringer. Brannmurens trafikklogger er mange, så utelat dem med mindre du vil ha dem.

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

FortiGate sender det logginnstillingene velger. Hendelseslogger inneholder tunnelene, lenkene og failoverne; trafikklogger er mange, så utelat dem med mindre du vil ha dem.

### Extreme Networks

```text
configure syslog add <probe-address>:5140 vr VR-Default local7
enable log target syslog <probe-address>:5140 vr VR-Default local7
enable syslog
```

Endre `VR-Default` til den virtuelle ruteren sonden nås gjennom.

### HPE Aruba

```text
logging <probe-address> udp 5140 severity info
```

På AOS-CX legger du til `vrf mgmt` på linjen når sonden nås gjennom administrasjonsporten. På AOS-Switch er linjen `logging <probe-address> udp 5140`.

### MikroTik RouterOS

```text
/system logging action set remote remote=<probe-address> remote-port=5140
/system logging add topics=info action=remote
/system logging add topics=warning action=remote
/system logging add topics=error action=remote
/system logging add topics=critical action=remote
```

Den første linjen peker ruterens innebygde remote-handling mot sonden; de andre velger hva den sender. La det eksterne loggformatet være som det er.

### Ubiquiti UniFi

1. Åpne **Integration** > **System Logging / SIEM** i UniFi Network, og velg **SIEM Server** som mål.
2. Skriv inn sondens IP-adresse og port `5140`, og velg loggkategoriene som skal eksporteres.

Konsollen rapporterer om aksesspunktene og svitsjene den administrerer. Hendelser havner på hver enhets egen side når enheten er i OneUptime med MAC-adressen sin, og ellers på konsollens.

### Cambium Networks

1. Åpne systeminnstillingene i cnMaestro eller i aksesspunktets webgrensesnitt, og finn syslog-serverne.
2. Skriv inn sondens IP-adresse som syslog-server, med port `5140` der skjemaet ber om en port, og sett syslog-alvorlighetsgraden til **Info**.

Der det ikke finnes noen port å stille inn, sender aksesspunktet til port 514: publiser sondens port der, slik trinn 2 under [Oppsett](#oppsett) viser.

### Andre enheter

Legg til en ekstern syslog-server på enheten: sondens IP-adresse, port 5140, over UDP eller TCP, med informasjonsmeldinger og alt som er mer alvorlig. En enhet med et format OneUptime ikke kjenner, får likevel meldingene sine lagret, og du kan selv gi hendelsene dens navn.

## Varsler

**Opprett varsel** på en Hendelser-side viser varslene de fleste nettverk vil ha. Hvert av dem åpner **Opprett monitor** ferdig utfylt, der du kan endre alt før du lagrer:

| Varsel | Sier fra når | Ett varsel per | Lukkes når |
| --- | --- | --- | --- |
| En VPN-tunnel går ned | `vpn.tunnel_down` | enhet og tunnel | `vpn.tunnel_up` for den tunnelen |
| En brannmur eller svitsj bytter over | `ha.failover` | enhet | det går 5 minutter uten en ny |
| En WAN-lenke går ned | `gateway.down` | enhet og gateway | `gateway.up` for den gatewayen |
| En rutingnabo går ned | `routing.neighbor_down` | enhet og nabo | `routing.neighbor_up` for den naboen |
| En enhet starter på nytt | `device.reboot` | enhet | det går 5 minutter uten en ny |
| Maskinvare svikter | en vifte, en strømforsyning eller temperaturen | enhet og komponent | den samme komponenten rapporteres å virke igjen |
| Et grensesnitt går ned | `interface.down` | enhet og grensesnitt | `interface.up` for det grensesnittet |
| Noen mislykkes stadig med å logge på | mer enn 10 `auth.login_failed` på 5 minutter | enhet | det går 5 minutter med 10 eller færre |

Hvert av dem er en [loggmonitor](/docs/monitor/logs-monitor) som teller hendelsen over de siste 5 minuttene, med **Group by Attributes** satt slik at hver tunnel, gateway eller hvert grensesnitt får sitt eget varsel, og med **Løst av attributter** satt til hendelsen som sier at problemet er over. Et slikt varsel forblir åpent til den hendelsen kommer for den samme enheten og den samme tunnelen, uansett hvor lang tid det tar; se [Løst av en logg](/docs/monitor/logs-monitor#løst-av-en-logg). OneUptime leser ingen hendelse som sier at en temperatur er normal igjen, så et temperaturvarsel forblir åpent til du løser det.

Fra **Hendelser**-fanen til en enhet overvåker monitorene bare den enheten. For enhver annen hendelse åpner du en på Hendelser-siden og klikker på **Opprett varsel for denne hendelsen**. For å sende et varsel et sted, eller for å tilkalle noen, legger du en vaktpolicy eller en arbeidsflyt til monitoren, som på enhver annen.

## Adresser som ikke er enheter ennå

Syslog kan komme før enheten som sender det, er lagt til i OneUptime. På din egen sonde tas det vare på, hendelsene står på nettverkets Hendelser-side med navnet enheten gir seg selv, og adressen står under **Sender syslog, ennå ikke en enhet**:

- **Legg til som enhet** åpner **Legg til enhet** med adressen og sonden fylt ut. Meldingene som allerede har kommet, blir på nettverkets side; nye går til enheten.
- **Det er en av enhetene mine** legger adressen til **Andre adresser** på en enhet: bruk den når en enhet du allerede har lagt til, sender fra en annen adresse, for eksempel en loopback. Meldingene går til den enheten fra neste minutt.

Flere enheter bak én NAT-adresse deler den adressen, så meldingene deres går til den ene enheten som har den, med mindre en melding nevner sin egen enhet.

## Dine egne hendelser

En enhet med et format OneUptime ikke kjenner, eller en hendelse det ikke leser, trenger en [loggpipeline](/docs/telemetry/log-pipelines):

1. Opprett en pipeline der filteret samsvarer med enhetens logger, for eksempel `attributes.networkDevice.name = 'rack-ups'`.
2. Legg til en **Grok Parser** eller en **Key=Value Parser** for å trekke feltene du trenger, ut av meldingen.
3. Legg til en **Kategoriprosessor** med **Målattributt** `event.name`, og én regel per hendelse. Gi hver et navn som hendelsene ovenfor, med små bokstaver og punktum eller understreker: `ups.on_battery`.

En logg fra en nettverksenhet som bærer et slikt navn, blir en nettverkshendelse: den står på Hendelser-sidene, og **Opprett varsel for denne hendelsen** virker på den. For å si hva den handler om, legger du til en **Attributt-ommapper** som kopierer feltet ditt til et av attributtene i hendelsestabellen, for eksempel `hw.name`. Med mindre pipelinen din setter `event.kind` til `problem` eller `recovery`, står hendelsen under **Til orientering**. En regel med navnet til en innebygd hendelse, for eksempel `interface.down`, gir den innebygde hendelsen, med typen og varslene dens.

En pipeline hører til prosjektet sitt. For å bruke en i et annet prosjekt oppretter du den der med de samme prosessorene.

## Hva som ikke er med

- **Syslog over TLS** (RFC 5425). Sonden tar imot vanlig UDP og TCP; hold veien mellom enhetene og sonden på et nettverk du stoler på.
- **Deling av parsere mellom prosjekter.** En pipeline kan ennå ikke eksporteres og importeres.
- **Hendelser fra andre SNMP-traps enn de fire standard-trapsene.** En leverandørs egne traps lagres som logger, og varsler på dem lages med kriteriet **SNMP Trap Received (Trap OID)** i [monitoren for nettverksenheter](/docs/monitor/network-device-monitor).
- **Cambium cnMatrix-svitsjer, Aruba mobility controllere og FortiGate i CEF-modus.** Meldingene deres lagres og er søkbare; ingen hendelser leses ut av dem ennå.
- **En direktevisning.** Hendelser-siden viser det som hadde kommet da den ble åpnet; bruk oppdateringsknappen, eller direktevisningen i **Logger**.

## Feilsøking

Hvis en Hendelser-side fortsatt viser oppsettstrinnene sine:

- **Mottar sonden noe i det hele tatt?** Nettverkets Hendelser-side viser under **Sender syslog, ennå ikke en enhet** alle adresser som har sendt syslog i tidsrommet. Står enheten der, sender den fra en adresse som ikke er vertsnavnet: legg den adressen til enhetens **Andre adresser**.
- **Brannmurer og Docker.** Tillat port 5140 fra enheten til sonden, og publiser porten hvis sonden kjører i Docker. Mange enheter sender til port 514 med mindre de får beskjed om noe annet.
- **Sondens logg.** Ved oppstart logger sonden porten den lytter på, eller at den ikke kunne åpne den. Når den forkaster meldinger over `PROBE_SYSLOG_RATE_LIMIT_PER_MINUTE`, logger den hvor mange, én gang i minuttet.
- **En global sonde.** En enhet som polles av en global sonde, kan ikke sende syslog til den fra et privat nettverk. Kjør en egendefinert sonde på enhetens nettverk, og velg den i enhetens innstillinger.
- **Meldinger kommer, men ingen hendelser.** Siden sier det, og hver melding står på enhetens **Logger**-fane. Sjekk at enheten sender informasjonsmeldinger, ikke bare feil, og at produktet er et av dem under [Hva OneUptime leser](#hva-oneuptime-leser); ellers gir du hendelsene dens navn i en loggpipeline.
