# Aangepaste probes

Een aangepaste sonde is een kleine agent die u in uw eigen netwerk draait. Hij controleert de monitors waaraan u hem toevoegt, zoals interne websites, API's en servers achter uw firewall, en stuurt de resultaten naar OneUptime. Hij maakt alleen uitgaande verbindingen, via HTTPS, dus niets in uw netwerk hoeft verbindingen vanaf internet te accepteren.

:::cards
- [Hoe het werkt](#hoe-het-werkt): Wat de sonde doet, en hoe OneUptime weet dat hij draait.
- [Een sonde installeren](#een-sonde-installeren): Hem in OneUptime aanmaken, draaien met Docker, Docker Compose of Kubernetes en aan monitors toevoegen.
- [Omgevingsvariabelen](#omgevingsvariabelen): Elke instelling die de sonde leest, met de standaardwaarde.
- [Een verbroken sonde onderzoeken](#een-verbroken-sonde-onderzoeken): Vinden waar de verzoeken van de sonde aan OneUptime blijven steken.
:::

## Hoe het werkt

```mermaid title="Wat een aangepaste sonde doet"
sequenceDiagram
    participant P as Aangepaste sonde
    participant S as Uw diensten
    participant O as OneUptime
    P->>O: Ik draai (elke minuut)
    P->>O: Welke van mijn monitors zijn aan de beurt?
    O-->>P: De te controleren monitors
    P->>S: Elk ervan controleren
    P->>O: De resultaten sturen
    O->>O: Status bijwerken, incidenten of meldingen openen
```

- **De sonde maakt verbinding naar buiten.** Elk verzoek gaat van de sonde naar `ONEUPTIME_URL` via HTTPS. Niets hoeft de sonde van buiten uw netwerk te bereiken.
- **Hij controleert alleen zijn eigen monitors.** De sonde vraagt OneUptime om de monitors waaraan hij is toegevoegd, controleert elk ervan wanneer het aan de beurt is en stuurt het resultaat terug. OneUptime beslist aan de hand van de resultaten of de status van een monitor verandert.
- **OneUptime let erop dat hij draait.** Elk verzoek van de sonde telt als levensteken, en de sonde stuurt er minstens één per minuut. Na ongeveer drie minuten zonder verzoek toont de sonde **Verbinding verbroken**, en krijgen zijn eigenaren bericht. Heeft een sonde geen eigenaren, dan krijgen de eigenaren van het project bericht.

## Voordat u begint

- **Het Growth-abonnement, op OneUptime Cloud.** Een sonde aanmaken vereist het. Een zelf gehoste installatie heeft geen abonnementslimieten.
- **Toestemming om sondes aan te maken.** Projecteigenaren, -beheerders en -leden hebben die, en ook iedereen wiens rol het aanmaken van sondes toestaat.
- **Een machine in het netwerk dat u wilt bewaken.** Die heeft Docker, Docker Compose of Kubernetes nodig, een route naar de diensten die de sonde controleert, en uitgaand HTTPS naar `ONEUPTIME_URL`.

## Een sonde installeren

:::steps
### De sonde aanmaken

Open **Monitoren → Instellingen → Sondes** en klik op **Sonde aanmaken**. Geef hem een **Naam** en een **Beschrijving**: beide zijn verplicht. **Meer velden** bevat het **Sondelogo**, **Schakel monitoring automatisch in op nieuwe monitoren**, waarmee deze sonde wordt gekozen voor elke nieuwe monitor die u maakt, en **Labels**.

### De ID en sleutel kopiëren

De sonde heeft zijn ID en sleutel nodig om verbinding te maken. Om ze te kopiëren opent u het menu van de sonde in de tabel **Aangepaste probes** en kiest u **ID en sleutel tonen**. Iedereen die de tabel ziet, kan de ID van een sonde kopiëren; de sleutel wordt alleen getoond aan projecteigenaren en -beheerders, die **ID en sleutel tonen** zien waar de anderen **ID weergeven** zien.

Projecteigenaren en -beheerders kunnen ook op de sonde klikken: de kaart **Set up your Custom Probe** op de pagina ervan toont de Docker-opdracht met de ID en sleutel al ingevuld.

### De sonde starten

Start hem op de gekozen machine, met de ID en sleutel van de sonde. Host u OneUptime zelf, stel `ONEUPTIME_URL` dan in op de URL van uw installatie in plaats van `https://oneuptime.com`.

:::tabs
@tab Docker
```bash
docker run --name oneuptime-probe --network host \
  -e PROBE_KEY=<probe-key> \
  -e PROBE_ID=<probe-id> \
  -e ONEUPTIME_URL=https://oneuptime.com \
  -d oneuptime/probe:release
```
@tab Docker Compose
```yaml title="docker-compose.yml"
services:
  oneuptime-probe:
    image: oneuptime/probe:release
    container_name: oneuptime-probe
    environment:
      - PROBE_KEY=<probe-key>
      - PROBE_ID=<probe-id>
      - ONEUPTIME_URL=https://oneuptime.com
    network_mode: host
    restart: always
```

Start hem daarna met `docker compose up -d`.
@tab Kubernetes
```yaml title="oneuptime-probe.yaml"
apiVersion: apps/v1
kind: Deployment
metadata:
  name: oneuptime-probe
spec:
  selector:
    matchLabels:
      app: oneuptime-probe
  template:
    metadata:
      labels:
        app: oneuptime-probe
    spec:
      containers:
        - name: oneuptime-probe
          image: oneuptime/probe:release
          env:
            - name: PROBE_KEY
              value: "<probe-key>"
            - name: PROBE_ID
              value: "<probe-id>"
            - name: ONEUPTIME_URL
              value: "https://oneuptime.com"
```

Pas hem daarna toe met `kubectl apply -f oneuptime-probe.yaml`.
:::

Met hostnetwerk (`--network host`, `network_mode: host`) gebruikt de sonde het eigen netwerk van de host, IPv6 inbegrepen. Lees [IPv6-bestemmingen bewaken](#ipv6-bestemmingen-bewaken) voordat u hem zonder hostnetwerk start.

### Controleren of hij verbinding maakt

Binnen een minuut of twee toont de **Status** van de sonde in de tabel **Aangepaste probes** **Verbonden**. Toont hij nog steeds **Verbinding verbroken**, dan staat in het log van de sonde waarom: zie [Een verbroken sonde onderzoeken](#een-verbroken-sonde-onderzoeken).

### Een monitor door de sonde laten controleren

Een sonde controleert alleen de monitors waaraan hij is toegevoegd. Een nieuwe monitor kiest zijn sondes in de stap **Sondes en interval** van **Monitor maken**. Voor een bestaande monitor opent u hem en gaat u naar **Configuratie → Sondes en interval**. De pagina heeft drie kaarten:

- **Bewakingsinterval**: hoe vaak elk van de sondes van de monitor hem controleert. Kies een interval en het wordt meteen opgeslagen. Synthetische, Custom Code- en SSL-certificaatmonitors worden aangeboden met elke 5 minuten of langer; een monitor die al een korter interval heeft, of een via de API ingesteld schema, houdt dat en toont het in de lijst.
- **Sondes**: klik op **Sonde toevoegen** en kies uw aangepaste sonde. Wilt u dat een sonde deze monitor niet meer controleert, schakel hem dan uit met **Bewerken** in het menu van de rij, of verwijder de rij.
- **Sonde-overeenstemming**: hoeveel sondes van de monitor hetzelfde resultaat moeten zien voordat zijn status verandert, ingevuld in de zin "De status van deze monitor wijzigen wanneer ... sondes het eens zijn". Laat het vak leeg voor allemaal. Alleen ingeschakelde en verbonden sondes doen mee, dus een hoger getal betekent ook allemaal. Het getal wordt opgeslagen wanneer u het vak verlaat of op **Enter** drukt.

Monitors die sondes niet controleren (Handmatig, Inkomend verzoek, Inkomende e-mail, Server, Netwerkapparaat en de telemetriemonitors) hebben geen pagina Sondes en interval.
:::

> [!TIP]
> Een sonde die privéadressen moet controleren, zoals `http://10.0.0.5/health`, heeft `PROBE_ALLOW_PRIVATE_NETWORK_MONITORS=true` nodig. Sondes weigeren privéadressen totdat u ze toestaat: zie [Toegang tot privénetwerk](/docs/self-hosted/private-network-access).

## Verbinden via een proxy

Moet de sonde via een proxy om OneUptime of de gecontroleerde sites te bereiken, geef hem dan het adres van de proxy:

| Variabele | Wat hij doet |
| --- | --- |
| `HTTPS_PROXY_URL` | De proxy voor HTTPS-adressen, waaronder OneUptime zelf en de meeste sites. |
| `HTTP_PROXY_URL` | De proxy voor gewone HTTP-adressen. |
| `NO_PROXY` | Hosts die de sonde rechtstreeks bereikt, gescheiden door komma's. |

Schrijf het adres van een proxy als `http://proxy.example.com:8080`, of als `http://username:password@proxy.example.com:8080` wanneer hij om een gebruikersnaam en wachtwoord vraagt. De meeste proxy's bedienen beide soorten adressen, dus stel beide variabelen in op dezelfde URL.

:::tabs
@tab Docker
```bash
docker run --name oneuptime-probe --network host \
  -e PROBE_KEY=<probe-key> \
  -e PROBE_ID=<probe-id> \
  -e ONEUPTIME_URL=https://oneuptime.com \
  -e HTTP_PROXY_URL=http://proxy.example.com:8080 \
  -e HTTPS_PROXY_URL=http://proxy.example.com:8080 \
  -e NO_PROXY=localhost,.internal.example.com \
  -d oneuptime/probe:release
```
@tab Docker Compose
```yaml title="docker-compose.yml"
services:
  oneuptime-probe:
    image: oneuptime/probe:release
    container_name: oneuptime-probe
    environment:
      - PROBE_KEY=<probe-key>
      - PROBE_ID=<probe-id>
      - ONEUPTIME_URL=https://oneuptime.com
      - HTTP_PROXY_URL=http://proxy.example.com:8080
      - HTTPS_PROXY_URL=http://proxy.example.com:8080
      - NO_PROXY=localhost,.internal.example.com
    network_mode: host
    restart: always
```
@tab Kubernetes
```yaml title="oneuptime-probe.yaml"
apiVersion: apps/v1
kind: Deployment
metadata:
  name: oneuptime-probe
spec:
  selector:
    matchLabels:
      app: oneuptime-probe
  template:
    metadata:
      labels:
        app: oneuptime-probe
    spec:
      containers:
        - name: oneuptime-probe
          image: oneuptime/probe:release
          env:
            - name: PROBE_KEY
              value: "<probe-key>"
            - name: PROBE_ID
              value: "<probe-id>"
            - name: ONEUPTIME_URL
              value: "https://oneuptime.com"
            - name: HTTP_PROXY_URL
              value: "http://proxy.example.com:8080"
            - name: HTTPS_PROXY_URL
              value: "http://proxy.example.com:8080"
            - name: NO_PROXY
              value: "localhost,.internal.example.com"
```
:::

Wat via de proxy gaat:

- **De eigen verzoeken van de sonde aan OneUptime.**
- **De HTTP-controles van monitors**: Website-, API-, External Status Page-, Custom Code-, SSL-certificaat-, synthetische en domeinmonitors. SSL-certificaat- en synthetische monitors gebruiken `HTTPS_PROXY_URL`, of `HTTP_PROXY_URL` als alleen die is ingesteld.
- **Niet de andere controles.** Ping, Port, DNS, SNMP en de andere controles die geen HTTP zijn, maken rechtstreeks verbinding.

Een vermelding in `NO_PROXY` is een hostnaam (`api.internal`), een domein met een punt of `*.` ervoor voor elke naam eronder (`.internal.example.com`), elk van beide met een `:port`, of `*` voor alles. IP-bereiken worden niet gelezen: noem elk adres apart. De namen in kleine letters `http_proxy`, `https_proxy` en `no_proxy`, en ook `HTTP_PROXY` en `HTTPS_PROXY`, werken ook.

## IPv6-bestemmingen bewaken

Een sonde kan een IPv6-bestemming alleen bewaken als zijn eigen netwerk IPv6 heeft:

- **Docker met `--network host`, of Compose met `network_mode: host`** (de opstellingen hierboven): de sonde deelt het netwerk van de host en heeft dus precies IPv6 wanneer de host het heeft.
- **Een Docker-bridgenetwerk** (wat u krijgt zonder hostnetwerk): geen IPv6, tenzij IPv6 voor dat netwerk is ingeschakeld (zie hieronder).
- **Kubernetes**: pods hebben alleen IPv6 op een dual-stack- of IPv6-only-cluster.

Ping om het te controleren een openbaar IPv6-adres vanuit de sonde:

:::tabs
@tab Docker
```bash
docker exec oneuptime-probe ping -6 -c 1 2001:4860:4860::8888
```
@tab Kubernetes
```bash
kubectl exec deploy/oneuptime-probe -- ping -6 -c 1 2001:4860:4860::8888
```
:::

`1 received` betekent dat de sonde IPv6-bestemmingen kan bereiken. Heeft de sonde geen bruikbaar IPv6, dan mislukt `ping` meteen en zegt de fout waarom:

| Fout | Wat hij betekent |
| --- | --- |
| `Network is unreachable` | Het netwerk van de sonde heeft geen IPv6-route: een Docker-bridgenetwerk zonder IPv6, een IPv4-only-Kubernetes-cluster of een host zonder IPv6-connectiviteit. |
| `Cannot assign requested address` | IPv6 staat uit in de netwerknamespace van de sonde. Controleer `net.ipv6.conf.all.disable_ipv6` en `net.ipv6.conf.lo.disable_ipv6`: `cat /proc/sys/net/ipv6/conf/all/disable_ipv6` in de sonde geeft `1` als het uit staat. Met hostnetwerk zijn dit de instellingen van de host. |
| `Address family not supported by protocol` | De kernel is gestart met `ipv6.disable=1`, dus de machine heeft helemaal geen IPv6. Haal het uit de kernelopdrachtregel en start opnieuw op, of draai de sonde op een andere machine. |

In elk van deze gevallen is er niets naar de bestemming gestuurd, dus de sonde kan niet zeggen of die werkt. De controle mislukt toch, maar de foutreden van een Ping-monitor noemt de sonde in plaats van te zeggen dat de bestemming niet antwoordde:

```text
This probe cannot send IPv6 traffic (ping6: connect: Cannot assign requested address), so 2001:db8::1 was never contacted. The probe has no usable IPv6 address or route; this says nothing about whether 2001:db8::1 is up. Monitor IPv6 destinations from a probe that has IPv6 connectivity.
```

Het netwerkpad dat bij de fout is vastgelegd, zegt `Traceroute could not run: this probe cannot send IPv6 traffic (...)`. Herstel het netwerk van de sonde, of verplaats de monitor naar een sonde met IPv6.

### IPv6 zonder hostnetwerk

Kunt u geen hostnetwerk gebruiken, koppel de sonde dan aan een Docker-netwerk met IPv6 ingeschakeld. De host zelf heeft nog steeds IPv6 nodig.

```bash
docker network create --ipv6 oneuptime-probe-ipv6
docker run --name oneuptime-probe --network oneuptime-probe-ipv6 -e PROBE_KEY=<probe-key> -e PROBE_ID=<probe-id> -e ONEUPTIME_URL=https://oneuptime.com -d oneuptime/probe:release
```

Docker Engine 27 en nieuwer kiest een IPv6-subnet voor het netwerk en maskeert het uitgaande IPv6 van de sonde achter het adres van de host. Oudere versies hebben een expliciet IPv6-subnet nodig (bijvoorbeeld `docker network create --ipv6 --subnet fd00:0:0:1::/64 oneuptime-probe-ipv6`) en `"ip6tables": true` met `"experimental": true` in `/etc/docker/daemon.json`. Met Docker Compose verwijdert u `network_mode: host` en zet u `enable_ipv6: true` op het netwerk van de sonde.

## NetBIOS-naamopzoekingen in discoveryscans

Een [netwerk-discoveryscan](/docs/monitor/network-device-monitor) met **Windows-namen opzoeken (NetBIOS)** ingeschakeld stuurt vanaf de sonde NetBIOS-naamopzoekingen (NBSTAT) naar elke host zonder SNMP-systeemnaam. Sta voor scans die dit gebruiken dit verkeer toe:

- **Welke hosts worden bevraagd:** gevonden hosts die noch een SNMP-systeemnaam noch een reverse-DNS-naam (PTR) hebben, en alleen op privéadressen (`10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`) of carrier-grade-NAT-adressen (`100.64.0.0/10`). Openbare adressen worden nooit bevraagd, en een host waarvan de reverse-DNS-opzoeking vanaf de sonde een naam opleverde, krijgt nooit een opzoeking. Een host waarvan de opzoeking mislukte, verliep of werd overgeslagen toen het tijdsbudget van de opzoekingen op was, kan nog steeds worden bevraagd, ook als hij een PTR-record heeft.
- **Uitgaand:** UDP vanaf één tijdelijke (willekeurige, hoge) bronpoort op de sonde naar UDP-poort 137 op die hosts. De proxy-instellingen hierboven gelden er niet voor.
- **Inkomend:** de antwoorden, van UDP-poort 137 op elke host terug naar die tijdelijke poort. Een stateful firewall staat ze automatisch toe. Zonder ze blijven de hosts bij hun IP-adres genoemd.

De opzoeking heeft geen extra containercapability nodig en werkt vanuit het podnetwerk van Kubernetes. Ze bevraagt maximaal 2.000 hosts per scan (`PROBE_DISCOVERY_NETBIOS_MAX_HOSTS` verhoogt dat tot 4.000), stuurt elke host zonder antwoord nog één opzoeking, verdeelt de opzoekingen over ongeveer 100 per seconde en stopt bij een tijdslimiet die op dat werk is afgestemd - ongeveer 54 seconden voor een volledige opzoeking van 2.000 hosts, en nooit meer dan twee minuten. Globale sondes sturen nooit NetBIOS-opzoekingen, wat de scan ook zegt; draai scans die NetBIOS-namen nodig hebben dus vanaf een aangepaste sonde. De optie staat aan voor nieuwe scans. NBSTAT-opzoekingen naar veel hosts kunnen regels voor inbraakdetectie activeren; zet de optie dus uit bij scans van netwerken waar dat telt, of laat het uw beveiligingsteam vooraf weten.

## Omgevingsvariabelen

De sonde leest zijn instellingen bij het starten uit zijn omgeving: wijzig er een en start de sonde opnieuw. Een getal dat de sonde niet kan lezen, of dat buiten het bereik valt dat een variabele toestaat, wordt genegeerd en de standaardwaarde geldt; de limieten voor pakketcapture worden in plaats daarvan binnen hun bereik gebracht.

### Verplicht

| Variabele | Wat het is |
| --- | --- |
| `PROBE_KEY` | De sleutel van de sonde, uit **ID en sleutel tonen**. Zonder die stopt de sonde bij het starten. |
| `PROBE_ID` | De ID van de sonde, uit **ID en sleutel tonen**. Zonder die stopt de sonde bij het starten. |
| `ONEUPTIME_URL` | Waar OneUptime is: `https://oneuptime.com`, of de URL van uw eigen installatie. Zonder die stopt de sonde bij het starten. |

### Monitors controleren

| Variabele | Standaard | Wat hij doet |
| --- | --- | --- |
| `PROBE_MONITORING_WORKERS` | `1` | Hoeveel batches monitors de sonde tegelijk controleert. |
| `PROBE_MONITOR_FETCH_LIMIT` | `10` | Hoeveel monitors er in een batch zitten. |
| `PROBE_MONITOR_RETRY_LIMIT` | `3` | Herhalingen na de eerste poging van een mislukte monitorcontrole, gebruikt als een stap geen eigen aantal instelt, dus tot 4 pogingen. `0` zet herhalingen uit. |
| `PROBE_MONITOR_CHECK_TIMEOUT_IN_MS` | `900000` | Termijn voor het controleren van één monitor, waarna de controle wordt opgegeven en de volgende cyclus opnieuw wordt geprobeerd. De standaard groeit wanneer de time-out voor synthetische scripts wordt verhoogd, zodat een script nooit wordt afgebroken. |
| `PROBE_SYNTHETIC_MONITOR_SCRIPT_TIMEOUT_IN_MS` | `60000` | Time-out voor scripts van synthetische monitors, in milliseconden. |
| `PROBE_SYNTHETIC_MONITOR_CHROMIUM_SANDBOX_ENABLED` | `false` | Zet op `true` om Chromium in synthetische monitors in zijn eigen sandbox te laten draaien. Zet het alleen aan als de container van de sonde draait met een seccomp-profiel dat de sandbox toestaat, zoals dat van Playwright: zonder zo'n profiel kan Chromium niet starten. Zolang het uit staat, logt de sonde bij het opstarten een waarschuwing. |
| `PROBE_CUSTOM_CODE_MONITOR_SCRIPT_TIMEOUT_IN_MS` | `60000` | Time-out voor scripts van Custom Code-monitors, in milliseconden. |
| `PROBE_ALLOW_PRIVATE_NETWORK_MONITORS` | `false` | Zet op `true` zodat Website-, API-, External Status Page- en Custom Code-monitors op deze sonde privéadressen mogen bereiken. Zie [Toegang tot privénetwerk](/docs/self-hosted/private-network-access). |
| `PROBE_NETWORK_DEVICE_POLL_CONCURRENCY` | `25` | Hoeveel netwerkapparaten de sonde tegelijk bevraagt. Verhoog het voor een sonde die veel apparaten bevraagt. |

De limieten waarbinnen een synthetische monitor draait (hoeveel tegelijk, hun geheugen en hun schijf) staan op de pagina [Synthetische monitor](/docs/monitor/synthetic-monitor).

### Verbinding met OneUptime

| Variabele | Standaard | Wat hij doet |
| --- | --- | --- |
| `HTTP_PROXY_URL`, `HTTPS_PROXY_URL`, `NO_PROXY` | geen | De proxy-instellingen: zie [Verbinden via een proxy](#verbinden-via-een-proxy). |
| `PROBE_API_REQUEST_TIMEOUT_IN_MS` | `45000` | Termijn voor elk verzoek dat de sonde naar OneUptime stuurt. |
| `PROBE_API_SLOW_REQUEST_THRESHOLD_IN_MS` | `10000` | Een waarschuwing loggen voor verzoeken aan OneUptime die langzamer zijn dan dit. |

### Netwerk-discovery

| Variabele | Standaard | Wat hij doet |
| --- | --- | --- |
| `PROBE_DISCOVERY_SCAN_TIMEOUT_IN_MS` | `5400000` (90 minuten) | Termijn voor één netwerk-discoveryronde, waarna die wordt opgegeven en de scan als mislukt wordt gemeld. |
| `PROBE_DISCOVERY_PROGRESS_INTERVAL_IN_MS` | `30000` | Hoe vaak een lopende discoveryronde de tot dusver gevonden hosts uploadt, zodat een lange scan voortgang toont en zijn apparaten al vóór het einde kunnen worden geïmporteerd. Minimaal `5000`. |
| `PROBE_DISCOVERY_SCAN_CONCURRENCY` | `0` | Vast aantal adressen dat een discoveryronde tegelijk aftast. Laat hem leeg (of `0`) om het naar het doel van de scan te laten bepalen; dat wilt u, tenzij de container van de sonde ongewoon klein of ongewoon groot is. |
| `PROBE_DISCOVERY_REVERSE_DNS_BUDGET_IN_MS` | `0` | Tijdslimiet, in milliseconden, voor het opzoeken van reverse-DNS-namen (PTR) van de hosts die een ronde vond. Zie hieronder. |
| `PROBE_DISCOVERY_NETBIOS_MAX_HOSTS` | `0` | Hoeveel hosts de NetBIOS-opzoeking van één scan mag bevragen. Zie hieronder. |
| `PROBE_DISCOVERY_MAX_CONCURRENT_SCANS` | `4` | Maximumaantal onafhankelijke discoveryscans dat tegelijk op deze sonde draait, van 1 tot 16. Zie hieronder. |

`PROBE_DISCOVERY_REVERSE_DNS_BUDGET_IN_MS`: laat hem leeg (of `0`) om de limiet naar het aantal hosts te laten bepalen: 60 seconden voor tot ongeveer 860 hosts, oplopend tot hoogstens 10 minuten. U kunt hem instellen van 1000 tot 1200000. Hosts die de opzoekingen niet op tijd bereiken, krijgen geen reverse-DNS-naam (ze staan vermeld bij hun IP-adres, tenzij SNMP of NetBIOS ze een naam geeft), en het statusbericht van de scan zegt hoeveel er zijn gemist. Een opzoeking die verloopt of mislukt, wordt eenmaal herhaald zolang de limiet het toelaat, waarbij elke naamserver van de sonde om de beurt wordt gevraagd. Verhoog hem voor een groot netwerk achter een trage DNS-server.

`PROBE_DISCOVERY_NETBIOS_MAX_HOSTS`: bij scans met NetBIOS-namen ingeschakeld bevraagt de opzoeking elke host zonder SNMP-systeemnaam, hosts zonder reverse-DNS-naam eerst. Laat hem leeg (of `0`) om de ingebouwde grens van 2.000 te houden; u kunt hem instellen van 1 tot 4000. Hosts boven de grens worden niet bevraagd, en het statusbericht van de scan zegt hoeveel. Verhogen maakt de opzoeking ook langer (de tijdslimiet wordt erop afgestemd: ongeveer 104 seconden bij 4.000 hosts) en zet meer NBSTAT-datagrammen op het netwerk, waar regels voor inbraakdetectie op letten.

`PROBE_DISCOVERY_MAX_CONCURRENT_SCANS`: de sonde kijkt elke minuut of er nog een wachtende scan is zolang er capaciteit vrij is, zodat een lange scan niet alle andere blokkeert. Zijn alle plaatsen bezet, dan blijven extra scans wachten tot er een plaats vrijkomt. Elke scan heeft zijn eigen hostgelijktijdigheid, dus het verbruik van middelen groeit met beide instellingen; verlaag een van beide limieten voor kleine containers. Zet hem op 1 om scans na elkaar uit te voeren.

Werk de OneUptime-server bij voordat u aangepaste sondes bijwerkt om gelijktijdige discovery te gebruiken. De server moet scans kunnen uitsluiten die de sonde nog uitvoert, zodat het bewerken van een lopende scan de nieuwe configuratie veilig in de wachtrij zet. Verbindt u een bijgewerkte sonde met een oudere server, zet dan `PROBE_DISCOVERY_MAX_CONCURRENT_SCANS=1` totdat de server is bijgewerkt.

### Pakketcapture

| Variabele | Standaard | Wat hij doet |
| --- | --- | --- |
| `PROBE_PACKET_CAPTURE_ENABLED` | uit | Zet op `true` zodat mensen met de toestemming vanuit het dashboard pakketcaptures op deze sonde kunnen starten. Captures hebben ook hostnetwerk en de capability `NET_RAW` nodig. Zie [Pakketcapture](/docs/probe/packet-capture). |
| `PROBE_PACKET_CAPTURE_MAX_DURATION_IN_SECONDS` | `1800` | De langste pakketcapture die deze sonde uitvoert, van 5 tot 1800. |
| `PROBE_PACKET_CAPTURE_MAX_FILE_SIZE_IN_MB` | `25` | Het grootste capturebestand dat deze sonde maakt, van 1 tot 25. |

### Waarop de sonde luistert

Een sonde maakt alleen uitgaande verbindingen, tenzij u een listener inschakelt of er een behoudt die standaard aan staat:

| Listener | Instelling | Standaard | Meer lezen |
| --- | --- | --- | --- |
| Inkomende verzoeken en heartbeats | `PROBE_INGRESS_PORT` | Uit | [Ingress voor inkomende verzoeken](/docs/probe/incoming-request-ingress) |
| SNMP-traps | `PROBE_SNMP_TRAP_RECEIVER_ENABLED` | Aan, UDP 162 | [Netwerkapparaat-monitor](/docs/monitor/network-device-monitor) |
| Syslog | `PROBE_SYSLOG_RECEIVER_ENABLED` | Uit, UDP 5140 | [Handleidingen per netwerkleverancier](/docs/monitor/network-vendor-guides) |
| NetFlow, IPFIX en sFlow | `PROBE_NETFLOW_RECEIVER_ENABLED` | Aan, UDP 2055, 4739 en 6343 | [Netwerkverkeer](/docs/monitor/network-traffic) |
| Gezondheidscontroles | `PORT` | Aan, TCP 3874 | `/status/live` en `/status/ready` |

In een container is een poort vanaf andere machines alleen bereikbaar met hostnetwerk of wanneer u hem publiceert.

De syslog-ontvanger stuurt hoogstens `PROBE_SYSLOG_RATE_LIMIT_PER_MINUTE` berichten per minuut door, standaard `600`, laat de rest vallen en logt hoeveel hij heeft laten vallen.

`PROBE_NAME` en `PROBE_DESCRIPTION` worden alleen gelezen door sondes die zich zelf registreren met `REGISTER_PROBE_KEY`, zoals de sondes die een zelf gehoste installatie voor elk project draait. Een aangepaste sonde neemt zijn naam en beschrijving over uit het dashboard.

## Probleemoplossing

### Een verbroken sonde onderzoeken

Een sonde wordt gemarkeerd als `Disconnected` wanneer zijn verzoeken aan OneUptime niet meer slagen. Het log van de sonde zegt waar elk mislukt verzoek bleef steken, dus u hoeft zelden te gissen.

:::steps
#### Het omgevingsblok lezen dat bij het starten wordt afgedrukt

Elke sonde drukt bij het starten één JSON-blok af met de OneUptime-URL die hij gebruikt, zijn verzoektermijn, zijn proxy-instellingen, de geërfde DNS-resolvers, de versie van Node en het besturingssysteem, en of de TLS-controle is uitgeschakeld. Voeg dit blok bij elke probleemmelding.

#### Het foutrapport vinden

Elk mislukt verzoek aan OneUptime logt een blok met `stalledAt` en `whatThisMeans`. `stalledAt` is de fase waar het verzoek nooit voorbij kwam:

| `stalledAt` | Wat het betekent |
| --- | --- |
| `SocketAssignment` | Er heeft niets de machine verlaten. De socketpool was vol, of een ingestelde proxy heeft zijn CONNECT-tunnel nooit opgezet. |
| `TcpConnect` | De machine stuurde SYN en kreeg niets terug: een firewall of beveiligingsapparaat gooit pakketten weg, of de host is onbereikbaar. |
| `TlsHandshake` | TCP is verbonden, TLS kwam nooit rond. Meestal een tussenliggend apparaat dat TLS inspecteert. |
| `RequestSend` | Verbonden, maar het verzoek is nooit volledig geschreven: de andere kant stopte met lezen. |
| `WaitingForServerResponse` | Het verzoek is afgeleverd en de server stuurde niets terug. **Het netwerk van de sonde is in orde**: controleer de OneUptime-server, zijn load balancer en zijn reverse proxy. |
| `ResponseBody` | De server begon te antwoorden en bleef halverwege steken. |
| `Unknown` | De sonde kon niet vaststellen waar het verzoek bleef steken. Lees daarna de connectiviteitszelftest hieronder. |

Hetzelfde blok meldt ook `deadlineOverrunInMs`. Duurde een termijn van 45000ms veel langer dan 45000ms in werkelijke tijd, dan was het proces van de sonde zelf geblokkeerd: controleer `probeProcess.eventLoopMaxDriftInMs` in het blok voordat u het netwerk onderzoekt.

#### De connectiviteitszelftest lezen

Na drie mislukkingen op rij test de sonde dezelfde server laag voor laag (DNS, dan TCP, dan TLS, dan een echte HTTP-rondgang) en logt elke stap met de duur ervan. De eerste stap die mislukt, is uw antwoord. Is er een proxy ingesteld, dan test de sonde de verbinding naar de proxy, want dat is de enige verbinding die hij echt maakt. De test draait hooguit eens per vijf minuten.

#### Trage verzoeken opmerken voordat ze mislukken

Verzoeken die slagen maar langer duren dan `PROBE_API_SLOW_REQUEST_THRESHOLD_IN_MS`, worden gelogd met hun duur. Een sonde die verzoeken van 20 seconden begint te loggen, is op weg om de termijn van 45 seconden te overschrijden.
:::

Ook aan de serverkant van OneUptime wordt een sondeverzoek gelogd dat traag wordt beantwoord, of dat de sonde opgaf voordat er een antwoord werd gestuurd, met de id van de sonde. Die twee logs samen vertellen aan welke kant van de verbinding de fout zit.

### Andere problemen

:::details De sonde stopt meteen na het starten
Zijn log noemt wat er ontbreekt: `PROBE_KEY is not set`, `PROBE_INGEST_URL or ONEUPTIME_URL is not set` of `PROBE_ID or REGISTER_PROBE_KEY should be set`. Zijn alle drie ingesteld maar passen de ID en sleutel bij geen enkele sonde, dan probeert de sonde het 10 keer, met 30 seconden ertussen, en stopt dan met `Unable to register probe after 10 attempts`. Kopieer de ID en sleutel opnieuw met **ID en sleutel tonen**.
:::

:::details De sonde werkte totdat iemand zijn sleutel opnieuw instelde
**Sondesleutel opnieuw instellen**, op de pagina van de sonde, maakt een nieuwe sleutel en de oude werkt meteen niet meer. Kopieer de nieuwe sleutel met **ID en sleutel tonen**, stel hem in als `PROBE_KEY` en start de sonde opnieuw.
:::

:::details Een monitor meldt dat hij een privéadres niet kan bereiken
Sondes weigeren privéadressen totdat u ze toestaat. Zet `PROBE_ALLOW_PRIVATE_NETWORK_MONITORS=true` op de sonde en start hem opnieuw: zie [Toegang tot privénetwerk](/docs/self-hosted/private-network-access).
:::

Hebt u nog steeds problemen, maak dan een issue aan op [GitHub](https://github.com/oneuptime/oneuptime) of [neem contact op met support](https://oneuptime.com/support).

## Volgende stappen

:::cards
- [Een monitor maken](/docs/monitor/create-monitor): Kiezen wat er wordt gecontroleerd en welke sondes het controleren.
- [Ingress voor inkomende verzoeken](/docs/probe/incoming-request-ingress): Diensten zonder internettoegang heartbeats via de sonde laten sturen.
- [Pakketcapture](/docs/probe/packet-capture): Het verkeer dat de sonde ziet vanuit het dashboard vastleggen.
- [Toegang tot privénetwerk](/docs/self-hosted/private-network-access): Een sonde privéadressen laten controleren.
:::
