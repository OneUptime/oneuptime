# Nätverkshändelser (syslog och SNMP-traps)

Routrar, brandväggar, switchar och accesspunkter berättar i sin syslog vad som händer med dem: en länk gick ner, en tunnel bröts, en brandvägg växlade över, någon loggade in. Varje leverantör formulerar det på sitt eget sätt. Rikta deras syslog mot en OneUptime-sond så visar **Händelser**-sidorna vad som hände med samma ord, oavsett vem som har tillverkat enheten, och varnar dig när det händer igen.

Det finns en Händelser-sida på två ställen:

- **Nätverk** -> **Händelser**: hela nätverket, alla enheters händelser på en sida, och varje adress som skickar syslog utan att vara en enhet ännu.
- En enhets **Händelser**-flik: vad just den enheten har rapporterat.

## Vad Händelser-sidan visar

- Tidsintervallets händelser, de nyaste först. Varje rad säger vad som hände, på vilken enhet, med vad - gränssnittet, tunneln, gatewayen - och med enhetens egna ord.
- **Problem**, **Återställningar** och **Informativa**, var och en med antalet i tidsintervallet. Klicka på en av dem för att bara se dem.
- Väljaren **Alla händelser** och, på nätverkets sida, väljaren **All devices** smalnar av listan ytterligare. Tidsintervallet och filtren sparas i sidans adress, så en länk öppnar exakt samma vy.
- Klicka på en händelse för att öppna den: när den hände, vad den handlar om, meddelandet så som enheten skickade det, och varje attribut som OneUptime läste ur det.
- **Skapa larm** erbjuder de larm som de flesta nätverk vill ha, och **Skapa larm för den här händelsen** skapar en för händelsen du har öppnat. Se [Larm](#larm).

En händelse är en logg. Allt på Händelser-sidan kan också sökas i, visas i diagram och användas för larm från **Loggar**: en händelse är en logg vars attribut `event.domain` är `network`, med det som hände i `event.name`.

## Vad OneUptime läser

Syslog i RFC 3164- och RFC 5424-form och Common Event Format (CEF) läses från vilken produkt som helst. Därutöver vet OneUptime vad de här produkterna skriver:

| Leverantör | Produkter | Händelser som läses | Attribut |
| --- | --- | --- | --- |
| Cisco | IOS, IOS XE, NX-OS, ASA | Gränssnitt, Enheter, Hög tillgänglighet, VPN, Routning, Hårdvara, Switchning, Inloggningar | `cisco.*` |
| Sophos | Sophos Firewall (SFOS, XG, XGS) | Gränssnitt, Enheter, Hög tillgänglighet, VPN, WAN, Inloggningar | `sophos.*` |
| Fortinet | FortiGate (FortiOS) | Gränssnitt, Enheter, Hög tillgänglighet, VPN, WAN, Hårdvara, Inloggningar | `fortigate.*` |
| Extreme Networks | ExtremeXOS, Switch Engine | Gränssnitt, Enheter, Hög tillgänglighet, Routning, Hårdvara, Switchning, Inloggningar | `extreme.*` |
| Extreme Networks | Fabric Engine, VOSS | Gränssnitt, Routning | `extreme.*` |
| HPE Aruba Networking | AOS-CX | Gränssnitt, Hårdvara | `aruba.*` |
| HPE Aruba Networking | AOS-Switch (ArubaOS-Switch, ProCurve) | Gränssnitt | `aruba.*` |
| MikroTik | RouterOS | Gränssnitt, Enheter, Inloggningar | `mikrotik.*` |
| Cambium Networks | Enterprise Wi-Fi (cnPilot, XV, XE, XH) | Enheter, VPN, Wi-Fi | `cambium.*` |
| Ubiquiti | UniFi Network | Enheter, WAN, Switchning, Inloggningar, Wi-Fi | `cef.*` |
| Alla | Linux-baserade enheter (kernel, hostapd, OpenSSH, Dropbear) | Gränssnitt, Inloggningar, Wi-Fi | - |

Ett meddelande i något av de här formaten får sina egna fält sparade som attribut under prefixet i sista kolumnen, så `con_name="HQ-Branch1"` på en Sophos-brandvägg är attributet `sophos.con_name`. Ett CEF-meddelande från vilken annan produkt som helst får sin header och sina tilläggsfält sparade under `cef.*`. Ett meddelande som OneUptime inte kan placera sparas ändå som en logg, med syslog-headern läst; du kan själv namnge dess händelser, se [Dina egna händelser](#dina-egna-händelser).

Standard-SNMP-traps läses som samma händelser: `linkDown` och `linkUp` blir **Gränssnitt nere** och **Gränssnitt uppe**, `coldStart` och `warmStart` blir **Enhet omstartad**.

## Händelserna

Varje meddelande som OneUptime känner igen sparas med ett av de här namnen i `event.name`, oavsett vem som har tillverkat enheten:

| Händelse | `event.name` | Typ | Handlar om |
| --- | --- | --- | --- |
| Gränssnitt nere | `interface.down` | Problem | `network.interface.name` |
| Gränssnitt uppe | `interface.up` | Återställning | `network.interface.name` |
| Port avstängd av switchen | `interface.error_disabled` | Problem | `network.interface.name` |
| Enhet omstartad | `device.reboot` | Problem | - |
| Konfiguration ändrad | `device.config_change` | Informativa | `user.name` |
| Enhet offline | `device.offline` | Problem | - |
| Enhet online | `device.online` | Återställning | - |
| Failover | `ha.failover` | Problem | `ha.role` |
| Tillstånd för hög tillgänglighet ändrat | `ha.state_change` | Informativa | `ha.role` |
| Peer för hög tillgänglighet nere | `ha.peer_down` | Problem | `ha.peer` |
| Peer för hög tillgänglighet uppe | `ha.peer_up` | Återställning | `ha.peer` |
| VPN-tunnel nere | `vpn.tunnel_down` | Problem | `vpn.tunnel.name` |
| VPN-tunnel uppe | `vpn.tunnel_up` | Återställning | `vpn.tunnel.name` |
| Routninggranne nere | `routing.neighbor_down` | Problem | `network.peer.address` |
| Routninggranne uppe | `routing.neighbor_up` | Återställning | `network.peer.address` |
| Gateway nere | `gateway.down` | Problem | `network.gateway.name` |
| Gateway uppe | `gateway.up` | Återställning | `network.gateway.name` |
| WAN-failover | `wan.failover` | Problem | `network.gateway.name` |
| SD-WAN-länk under sitt SLA | `sdwan.sla_not_met` | Problem | `network.gateway.name` |
| SD-WAN-länk åter inom sitt SLA | `sdwan.sla_met` | Återställning | `network.gateway.name` |
| Fläkt trasig | `hardware.fan_failed` | Problem | `hw.name` |
| Fläkt fungerar igen | `hardware.fan_ok` | Återställning | `hw.name` |
| Nätaggregat trasigt | `hardware.power_supply_failed` | Problem | `hw.name` |
| Nätaggregat fungerar igen | `hardware.power_supply_ok` | Återställning | `hw.name` |
| Temperatur för hög | `hardware.temperature_high` | Problem | - |
| Slinga upptäckt | `loop.detected` | Problem | `network.interface.name` |
| Ändring i spanning tree-topologin | `stp.topology_change` | Informativa | - |
| PoE-fel | `poe.fault` | Problem | `network.interface.name` |
| Inloggning misslyckades | `auth.login_failed` | Problem | `user.name` |
| Inloggad | `auth.login_success` | Informativa | `user.name` |
| Wi-Fi-klient ansluten | `wireless.client_connected` | Informativa | `client.mac` |
| Wi-Fi-klient frånkopplad | `wireless.client_disconnected` | Informativa | `client.mac` |

Den sista kolumnen är attributet som säger vad händelsen handlar om. Alla produkter rapporterar inte alla händelser: en switch har inga VPN-tunnlar, och en produkts syslog säger bara så mycket.

Varje händelse har också:

| Attribut | Vad det innehåller |
| --- | --- |
| `event.domain` | `network`, på varje nätverkshändelse |
| `event.kind` | `problem`, `recovery` eller `info` |
| `event.category` | `interface`, `device`, `ha`, `vpn`, `routing`, `wan`, `hardware`, `switching`, `security` eller `wireless`, på händelserna ovan |
| `event.device` | Vilken enhet: dess namn i OneUptime, annars namnet den ger sig själv, annars dess adress |
| `event.message` | Vad enheten sa, med sina egna ord |
| `syslog.vendor`, `syslog.parser` | Vems format meddelandet lästes som |

## Hur händelser kommer hit

Varje sond lyssnar efter syslog på port 5140, över UDP och över TCP. Över TCP är ett meddelande en rad, eller föregås av sin längd, så som RFC 6587 beskriver. Sonden vidarebefordrar det den hör till OneUptime med några sekunders mellanrum, och OneUptime kopplar varje meddelande till en enhet utifrån adressen det kom från:

1. en enhet som sonden pollar vars värdnamn är den adressen (eller slås upp till den), eller som har den under **Övriga adresser** på sin **Inställningar**-sida;
2. på din egen (anpassade) sond, vilken enhet som helst i projektet med den adressen, eller med värdnamnet som meddelandet bär när exakt en enhet har det namnet;
3. annars sparas meddelandet på din egen sond för nätverkets Händelser-sida, under **Skickar syslog, ännu inte en enhet**, tills du anger vilken enhet det hör till. En global sond kastar det.

En rad från en okänd adress som saknar syslog-prioritet och inte är en händelse räknas som brus och kastas.

En controller talar för enheterna den hanterar: en UniFi-konsol rapporterar om sina accesspunkter och switchar. När ett meddelande från en enhet nämner en annan enhet med dess MAC-adress, serienummer, adress eller namnet som dess controller ger den, går händelsen till den enheten, och loggen sparar namnet på controllern som skickade det vidare i `syslog.relay.name`.

En logg sparas med tidpunkten då sonden tog emot den. Ett meddelande som har hållits kvar - dess egen tidsstämpel är i RFC 5424-form, som anger tidszonen, och är äldre än 5 minuter - behåller enhetens tid, upp till 7 dagar bakåt. Alla andra tidsstämplar som ligger mer än 5 minuter från sondens klocka blir inte trodda: loggen sparas med tidpunkten då den togs emot, och enhetens tid sparas i `syslog.deviceTime`.

Syslog som du skickar till [syslog-endpointen](/docs/telemetry/syslog) över HTTPS läses av samma parsrar. Där blir ett meddelande en nätverkshändelse när det är i en nätverksleverantörs eget format, eller när det nämner en av dina nätverksenheter med MAC-adress, serienummer, adress eller värdnamn; en servers `sshd`-rader förblir vanliga loggar.

## Konfiguration

1. **Använd en sond i enhetens nätverk.** Syslog skickas av dina enheter, så de behöver en [anpassad sond](/docs/probe/custom-probe) som de kan nå. En global sond på det publika internet tar inte emot det.
2. **Låt syslog nå sonden.** Tillåt port 5140, UDP eller TCP, från enheterna till sonden. En sond i Docker som startats med värdens nätverk (`--network host`), som sidan om den anpassade sonden visar, tar emot det som den är; utan värdens nätverk publicerar du porten med `-p 5140:5140/udp -p 5140:5140/tcp`. För en enhet som bara kan skicka till port 514 publicerar du porten som `-p 514:5140/udp`, eller sätter `PROBE_SYSLOG_RECEIVER_PORT=514` på en sond med värdens nätverk.
3. **Ställ in sonden som enhetens syslog-server.** Kommandona för vanliga enheter finns nedan. **Händelser**-sidan visar samma steg tills det första meddelandet kommer, och blir sedan av sig själv listan.
4. **Kontrollera enhetens adress.** Meddelanden kopplas utifrån adressen enheten skickar från. Om den skickar från en loopback eller ett hanteringsgränssnitt som inte är dess värdnamn lägger du till den adressen bland enhetens **Övriga adresser**.

Syslog-mottagaren är aktiverad som standard. Dess inställningar är miljövariabler på sonden:

| Variabel | Vad den gör | Standard |
| --- | --- | --- |
| `PROBE_SYSLOG_RECEIVER_ENABLED` | Sätt till `false` för att stänga av syslog-mottagaren | `true` |
| `PROBE_SYSLOG_RECEIVER_PORT` | Porten, för UDP och TCP | `5140` |
| `PROBE_SYSLOG_RATE_LIMIT_PER_MINUTE` | Vidarebefordrade meddelanden per minut, över alla enheter | `600` |

Över gränsen vidarebefordrar sonden fortfarande de meddelanden den läser som nätverkshändelser, upp till lika många till, så att en flod av rutinrader inte kan tränga undan den som säger att en länk gick ner. En sond som är äldre än den här funktionen lyssnar bara när den startas med `PROBE_SYSLOG_RECEIVER_ENABLED=true`, och bara över UDP: uppdatera den.

### Cisco IOS, IOS XE och NX-OS

```text
logging host <probe-address> transport udp port 5140
logging trap informational
service timestamps log datetime msec
```

Den andra raden skickar informationsmeddelanden och allt som är allvarligare: länkändringar, omstarter och inloggningar hör dit. På NX-OS är raden `logging server <probe-address> 6 port 5140 use-vrf management`.

### Sophos Firewall

1. Öppna **System services** > **Log settings** i brandväggens webbadministration och välj **Add** under **Syslog servers**.
2. Ange sondens IP-adress och port `5140`, och sätt allvarlighetsnivån till **Information**. Båda loggformaten som brandväggen erbjuder läses.
3. Tillbaka på **Log settings** bockar du för den nya servern för de loggar som ska skickas: åtminstone systemhändelserna, och **SD-WAN** för SLA-ändringar. Brandväggens trafikloggar är många, så utelämna dem om du inte vill ha dem.

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

FortiGate skickar det som dess logginställningar väljer. Händelseloggar innehåller tunnlarna, länkarna och failover-växlingarna; trafikloggar är många, så utelämna dem om du inte vill ha dem.

### Extreme Networks

```text
configure syslog add <probe-address>:5140 vr VR-Default local7
enable log target syslog <probe-address>:5140 vr VR-Default local7
enable syslog
```

Ändra `VR-Default` till den virtuella router som sonden nås genom.

### HPE Aruba

```text
logging <probe-address> udp 5140 severity info
```

På AOS-CX lägger du till `vrf mgmt` på raden när sonden nås genom hanteringsporten. På AOS-Switch är raden `logging <probe-address> udp 5140`.

### MikroTik RouterOS

```text
/system logging action set remote remote=<probe-address> remote-port=5140
/system logging add topics=info action=remote
/system logging add topics=warning action=remote
/system logging add topics=error action=remote
/system logging add topics=critical action=remote
```

Den första raden riktar routerns inbyggda remote-åtgärd mot sonden; de andra väljer vad den skickar. Låt det externa loggformatet vara som det är.

### Ubiquiti UniFi

1. Öppna **Integration** > **System Logging / SIEM** i UniFi Network och välj **SIEM Server** som mål.
2. Ange sondens IP-adress och port `5140`, och välj de loggkategorier som ska exporteras.

Konsolen rapporterar om accesspunkterna och switcharna den hanterar. Händelser hamnar på varje enhets egen sida när enheten finns i OneUptime med sin MAC-adress, och annars på konsolens.

### Cambium Networks

1. Öppna systeminställningarna i cnMaestro eller i accesspunktens webbgränssnitt och leta upp syslog-servrarna.
2. Ange sondens IP-adress som syslog-server, med port `5140` där formuläret frågar efter en port, och sätt syslog-allvarlighetsgraden till **Info**.

Där det inte finns någon port att ställa in skickar accesspunkten till port 514: publicera sondens port där, som steg 2 under [Konfiguration](#konfiguration) visar.

### Andra enheter

Lägg till en extern syslog-server på enheten: sondens IP-adress, port 5140, över UDP eller TCP, med informationsmeddelanden och allt som är allvarligare. En enhet vars format OneUptime inte känner till får ändå sina meddelanden sparade, och du kan själv namnge dess händelser.

## Larm

**Skapa larm** på en Händelser-sida listar de larm som de flesta nätverk vill ha. Var och en öppnar **Skapa monitor** ifyllt, där du kan ändra vad som helst innan du sparar:

| Larm | Säger till när | Ett larm per | Stängs när |
| --- | --- | --- | --- |
| En VPN-tunnel går ner | `vpn.tunnel_down` | enhet och tunnel | `vpn.tunnel_up` för den tunneln |
| En brandvägg eller switch växlar över | `ha.failover` | enhet | 5 minuter går utan en till |
| En WAN-länk går ner | `gateway.down` | enhet och gateway | `gateway.up` för den gatewayen |
| En routninggranne går ner | `routing.neighbor_down` | enhet och granne | `routing.neighbor_up` för den grannen |
| En enhet startar om | `device.reboot` | enhet | 5 minuter går utan en till |
| Hårdvara slutar fungera | en fläkt, ett nätaggregat eller temperaturen | enhet och komponent | samma komponent rapporteras fungera igen |
| Ett gränssnitt går ner | `interface.down` | enhet och gränssnitt | `interface.up` för det gränssnittet |
| Någon misslyckas gång på gång med att logga in | fler än 10 `auth.login_failed` på 5 minuter | enhet | 5 minuter går med 10 eller färre |

Var och en är en [loggmonitor](/docs/monitor/logs-monitor) som räknar händelsen över de senaste 5 minuterna, med **Group by Attributes** inställt så att varje tunnel, gateway eller gränssnitt får sitt eget larm, och med **Löst av attribut** inställt på händelsen som säger att problemet är över. Ett sådant larm förblir öppen tills den händelsen kommer för samma enhet och samma tunnel, hur lång tid det än tar; se [Löst av en logg](/docs/monitor/logs-monitor#löst-av-en-logg). OneUptime läser ingen händelse som säger att en temperatur är normal igen, så en temperaturlarm förblir öppen tills du löser den.

Från en enhets **Händelser**-flik bevakar monitorerna bara den enheten. För vilken annan händelse som helst öppnar du en på Händelser-sidan och klickar på **Skapa larm för den här händelsen**. För att skicka ett larm någonstans, eller för att larma någon i jour, lägger du till en jourpolicy eller ett arbetsflöde på monitorn, som på vilken annan som helst.

## Adresser som inte är enheter ännu

Syslog kan komma innan enheten som skickar det har lagts till i OneUptime. På din egen sond sparas det, dess händelser finns på nätverkets Händelser-sida med namnet enheten ger sig själv, och adressen listas under **Skickar syslog, ännu inte en enhet**:

- **Lägg till som enhet** öppnar **Lägg till enhet** med adressen och sonden ifyllda. Meddelandena som redan har kommit stannar på nätverkets sida; nya går till enheten.
- **Det är en av mina enheter** lägger till adressen bland en enhets **Övriga adresser**: använd den när en enhet du redan har lagt till skickar från en annan adress, till exempel en loopback. Dess meddelanden går till den enheten från och med nästa minut.

Flera enheter bakom en och samma NAT-adress delar den adressen, så deras meddelanden går till den enda enhet som har den, om inte ett meddelande nämner sin egen enhet.

## Dina egna händelser

En enhet vars format OneUptime inte känner till, eller en händelse som det inte läser, kräver en [loggpipeline](/docs/telemetry/log-pipelines):

1. Skapa en pipeline vars filter matchar enhetens loggar, till exempel `attributes.networkDevice.name = 'rack-ups'`.
2. Lägg till en **Grok Parser** eller en **Key=Value Parser** för att plocka ut de fält du behöver ur meddelandet.
3. Lägg till en **Kategoriprocessor** med **Målattribut** `event.name`, och en regel per händelse. Namnge var och en som händelserna ovan, med små bokstäver och punkter eller understreck: `ups.on_battery`.

En logg från en nätverksenhet som bär ett sådant namn blir en nätverkshändelse: den finns på Händelser-sidorna, och **Skapa larm för den här händelsen** fungerar på den. För att säga vad den handlar om lägger du till en **Attributremappare** som kopierar ditt fält till ett av attributen i händelsetabellen, till exempel `hw.name`. Om inte din pipeline sätter `event.kind` till `problem` eller `recovery` listas händelsen under **Informativa**. En regel som är namngiven efter en inbyggd händelse, till exempel `interface.down`, ger den inbyggda händelsen, med dess typ och dess larm.

En pipeline tillhör sitt projekt. För att använda en i ett annat projekt skapar du den där med samma processorer.

## Vad som inte ingår

- **Syslog över TLS** (RFC 5425). Sonden tar emot vanlig UDP och TCP; håll vägen mellan enheterna och sonden på ett nätverk du litar på.
- **Dela parsrar mellan projekt.** En pipeline kan ännu inte exporteras och importeras.
- **Händelser från andra SNMP-traps än de fyra standardtrapsen.** En leverantörs egna traps sparas som loggar, och larm på dem skapas med kriteriet **SNMP Trap Received (Trap OID)** i [nätverksenhetsmonitorn](/docs/monitor/network-device-monitor).
- **Cambium cnMatrix-switchar, Aruba mobility controllers och FortiGate i CEF-läge.** Deras meddelanden sparas och är sökbara; inga händelser läses ur dem ännu.
- **En livevy.** Händelser-sidan visar det som hade kommit när den öppnades; använd dess uppdateringsknapp, eller livevyn i **Loggar**.

## Felsökning

Om en Händelser-sida fortfarande visar sina konfigurationssteg:

- **Tar sonden emot något alls?** Nätverkets Händelser-sida listar under **Skickar syslog, ännu inte en enhet** varje adress som har skickat syslog i tidsintervallet. Om enheten står där skickar den från en adress som inte är dess värdnamn: lägg till den adressen bland dess **Övriga adresser**.
- **Brandväggar och Docker.** Tillåt port 5140 från enheten till sonden, och publicera porten om sonden körs i Docker. Många enheter skickar till port 514 om de inte får veta något annat.
- **Sondens logg.** Vid start loggar sonden porten den lyssnar på, eller att den inte kunde öppna den. När den kastar meddelanden över `PROBE_SYSLOG_RATE_LIMIT_PER_MINUTE` loggar den hur många, en gång i minuten.
- **En global sond.** En enhet som pollas av en global sond kan inte skicka syslog till den från ett privat nätverk. Kör en anpassad sond i enhetens nätverk och välj den i enhetens inställningar.
- **Meddelanden kommer, men inga händelser.** Sidan säger det, och varje meddelande finns på enhetens **Loggar**-flik. Kontrollera att enheten skickar informationsmeddelanden, inte bara fel, och att produkten är en av dem under [Vad OneUptime läser](#vad-oneuptime-läser); annars namnger du dess händelser i en loggpipeline.
