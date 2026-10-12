# Brugerdefinerede probes

En brugerdefineret sonde er en lille agent, som du kører i dit eget netværk. Den tjekker de overvågninger, du føjer den til, for eksempel interne websteder, API'er og servere bag din firewall, og sender resultaterne til OneUptime. Den åbner kun udgående forbindelser over HTTPS, så intet i dit netværk behøver at tage imod forbindelser fra internettet.

:::cards
- [Sådan virker det](#sådan-virker-det): Hvad sonden gør, og hvordan OneUptime ved, at den kører.
- [Installér en sonde](#installér-en-sonde): Opret den i OneUptime, kør den med Docker, Docker Compose eller Kubernetes, og føj den til overvågninger.
- [Miljøvariabler](#miljøvariabler): Hver indstilling, sonden læser, med standardværdien.
- [Undersøg en afbrudt sonde](#undersøg-en-afbrudt-sonde): Find ud af, hvor sondens forespørgsler til OneUptime går i stå.
:::

## Sådan virker det

```mermaid title="Hvad en brugerdefineret sonde gør"
sequenceDiagram
    participant P as Brugerdefineret sonde
    participant O as OneUptime
    P->>O: Jeg kører<br/>(hvert minut)
    P->>O: Hvilke af mine overvågninger<br/>skal tjekkes nu?
    O-->>P: De overvågninger,<br/>der skal tjekkes
    Note over P: Tjekker hver enkelt<br/>i dit netværk
    P->>O: Send resultaterne
    Note over O: Opdaterer status, åbner<br/>hændelser eller alarmer
```

- **Sonden forbinder udad.** Hver forespørgsel går fra sonden til `ONEUPTIME_URL` over HTTPS. Intet udefra behøver at kunne nå sonden.
- **Den tjekker kun sine egne overvågninger.** Sonden spørger OneUptime om de overvågninger, den er føjet til, tjekker hver enkelt, når det er tid, og sender resultatet tilbage. OneUptime afgør ud fra resultaterne, om en overvågnings status ændres.
- **OneUptime holder øje med, at den kører.** Hver forespørgsel fra sonden tæller som et livstegn, og sonden sender mindst én i minuttet. Efter cirka tre minutter uden nogen viser sonden **Afbrudt**, og dens ejere får besked. Har en sonde ingen ejere, får projektets ejere besked.

## Før du begynder

- **Growth-planen, på OneUptime Cloud.** Den kræves for at oprette en sonde. En selvhostet installation har ingen plangrænser.
- **Tilladelse til at oprette sonder.** Projektejere, -administratorer og -medlemmer har den, og det har alle andre også, hvis deres rolle tillader at oprette sonder.
- **En maskine i det netværk, du vil overvåge.** Den skal have Docker, Docker Compose eller Kubernetes, en rute til de tjenester, sonden skal tjekke, og udgående HTTPS til `ONEUPTIME_URL`.

## Installér en sonde

:::steps
### Opret sonden

Åbn **Overvågninger → Indstillinger → Sonder**, og klik på **Opret Sonde**. Giv den et **Navn** og en **Beskrivelse**: begge er påkrævede. **Flere felter** rummer **Sondelogo**, **Aktivér overvågning automatisk på nye overvågninger**, som vælger denne sonde til hver ny overvågning, du opretter, og **Etiketter**.

### Kopiér dens ID og nøgle

Sonden skal bruge sit ID og sin nøgle for at forbinde. For at kopiere dem skal du åbne sondens menu i tabellen **Brugerdefinerede probes** og vælge **Vis ID og nøgle**. Alle, der kan se tabellen, kan kopiere en sondes ID; dens nøgle vises kun for projektejere og -administratorer, som ser **Vis ID og nøgle**, hvor de andre ser **Vis ID**.

Projektejere og -administratorer kan også klikke på sonden: kortet **Set up your Custom Probe** på dens side viser Docker-kommandoen med ID og nøgle allerede udfyldt.

### Kør sonden

Kør den på den valgte maskine med sondens ID og nøgle. Hvis du selv hoster OneUptime, så sæt `ONEUPTIME_URL` til din installations URL i stedet for `https://oneuptime.com`.

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

Start den derefter med `docker compose up -d`.
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

Anvend den derefter med `kubectl apply -f oneuptime-probe.yaml`.
:::

Med værtsnetværk (`--network host`, `network_mode: host`) bruger sonden værtens eget netværk, IPv6 inklusive. Læs [Overvåg IPv6-destinationer](#overvåg-ipv6-destinationer), før du kører den uden værtsnetværk.

### Tjek, at den forbinder

Inden for et minut eller to viser sondens **Status** i tabellen **Brugerdefinerede probes** **Forbundet**. Viser den stadig **Afbrudt**, står årsagen i sondens log: se [Undersøg en afbrudt sonde](#undersøg-en-afbrudt-sonde).

### Lad sonden tjekke en overvågning

En sonde tjekker kun de overvågninger, den er føjet til. En ny overvågning vælger sine sonder i trinnet **Sonder og interval** i **Opret monitor**. For en eksisterende overvågning skal du åbne den og gå til **Konfiguration → Sonder og interval**. Siden har tre kort:

- **Overvågningsinterval**: hvor ofte hver af overvågningens sonder tjekker den. Vælg et interval, og det gemmes med det samme. Syntetiske, Custom Code- og SSL-certifikatovervågninger tilbydes hvert 5. minut eller sjældnere; en overvågning, der allerede har et kortere interval eller en tidsplan sat via API'et, beholder den og viser den på listen.
- **Sonder**: klik på **Tilføj sonde**, og vælg din brugerdefinerede sonde. For at en sonde holder op med at tjekke denne overvågning skal du slå den fra med **Rediger** i rækkens menu eller slette rækken.
- **Sondeenighed**: hvor mange af overvågningens sonder der skal se det samme resultat, før dens status ændres, skrevet ind i sætningen "Skift denne overvågnings status, når ... sonder er enige". Lad feltet stå tomt for dem alle. Kun sonder, der er slået til og forbundet, er med, så et højere tal betyder også dem alle. Tallet gemmes, når du forlader feltet eller trykker på **Enter**.

Overvågninger, som sonder ikke tjekker (Manuel, Indgående anmodning, Indgående e-mail, Server, Netværksenhed og telemetriovervågningerne), har ingen side Sonder og interval.
:::

> [!TIP]
> En sonde, der skal tjekke private adresser som `http://10.0.0.5/health`, skal have `PROBE_ALLOW_PRIVATE_NETWORK_MONITORS=true`. Sonder afviser private adresser, indtil du tillader dem: se [Adgang til privat netværk](/docs/self-hosted/private-network-access).

## Forbind gennem en proxy

Hvis sonden skal gennem en proxy for at nå OneUptime eller de websteder, den tjekker, så giv den proxyens adresse:

| Variabel | Hvad den gør |
| --- | --- |
| `HTTPS_PROXY_URL` | Proxyen til HTTPS-adresser, herunder OneUptime selv og de fleste websteder. |
| `HTTP_PROXY_URL` | Proxyen til almindelige HTTP-adresser. |
| `NO_PROXY` | Værter, som sonden når direkte, adskilt af kommaer. |

Skriv en proxys adresse som `http://proxy.example.com:8080`, eller som `http://username:password@proxy.example.com:8080`, når den beder om brugernavn og adgangskode. De fleste proxyer håndterer begge slags adresser, så sæt begge variabler til den samme URL.

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

Hvad der går gennem proxyen:

- **Sondens egne forespørgsler til OneUptime.**
- **Overvågningers HTTP-tjek**: Website-, API-, External Status Page-, Custom Code-, SSL-certifikat-, syntetiske og domæneovervågninger. SSL-certifikat- og syntetiske overvågninger bruger `HTTPS_PROXY_URL`, eller `HTTP_PROXY_URL`, når kun den er sat.
- **Ikke de andre tjek.** Ping, Port, DNS, SNMP og de andre tjek, der ikke er HTTP, forbinder direkte.

En post i `NO_PROXY` er et værtsnavn (`api.internal`), et domæne med et punktum eller `*.` foran for hvert navn under det (`.internal.example.com`), hver af dem med en `:port`, eller `*` for alt. IP-intervaller læses ikke: angiv hver adresse. Navnene med små bogstaver `http_proxy`, `https_proxy` og `no_proxy` samt `HTTP_PROXY` og `HTTPS_PROXY` virker også.

## Overvåg IPv6-destinationer

En sonde kan kun overvåge en IPv6-destination, hvis dens eget netværk har IPv6:

- **Docker med `--network host`, eller Compose med `network_mode: host`** (opsætningerne ovenfor): sonden deler værtens netværk, så den har IPv6 præcis, når værten har det.
- **Et Docker-bridgenetværk** (det, du får uden værtsnetværk): ingen IPv6, medmindre IPv6 er slået til for netværket (se nedenfor).
- **Kubernetes**: pods har kun IPv6 i en dual-stack- eller ren IPv6-klynge.

For at tjekke det skal du pinge en offentlig IPv6-adresse inde fra sonden:

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

`1 received` betyder, at sonden kan nå IPv6-destinationer. Har sonden ingen brugbar IPv6, fejler `ping` med det samme, og fejlen siger hvorfor:

| Fejl | Hvad den betyder |
| --- | --- |
| `Network is unreachable` | Sondens netværk har ingen IPv6-rute: et Docker-bridgenetværk uden IPv6, en Kubernetes-klynge med kun IPv4 eller en vært uden IPv6-forbindelse. |
| `Cannot assign requested address` | IPv6 er slået fra i sondens netværksnavnerum. Tjek `net.ipv6.conf.all.disable_ipv6` og `net.ipv6.conf.lo.disable_ipv6`: `cat /proc/sys/net/ipv6/conf/all/disable_ipv6` inde i sonden udskriver `1`, når det er slået fra. Med værtsnetværk er det værtens indstillinger. |
| `Address family not supported by protocol` | Kernen blev startet med `ipv6.disable=1`, så maskinen har slet ingen IPv6. Fjern det fra kernens kommandolinje og genstart, eller kør sonden på en anden maskine. |

I alle tilfældene blev intet sendt til destinationen, så sonden kan ikke vide, om den er oppe. Tjekket fejler alligevel, men en Ping-overvågnings fejlårsag nævner sonden i stedet for at sige, at destinationen ikke svarede:

```text
This probe cannot send IPv6 traffic (ping6: connect: Cannot assign requested address), so 2001:db8::1 was never contacted. The probe has no usable IPv6 address or route; this says nothing about whether 2001:db8::1 is up. Monitor IPv6 destinations from a probe that has IPv6 connectivity.
```

Netværksstien, der registreres med fejlen, siger `Traceroute could not run: this probe cannot send IPv6 traffic (...)`. Ret sondens netværk, eller flyt overvågningen til en sonde, der har IPv6.

### IPv6 uden værtsnetværk

Hvis du ikke kan bruge værtsnetværk, så tilknyt sonden et Docker-netværk med IPv6 slået til. Værten selv skal stadig have IPv6.

```bash
docker network create --ipv6 oneuptime-probe-ipv6
docker run --name oneuptime-probe --network oneuptime-probe-ipv6 -e PROBE_KEY=<probe-key> -e PROBE_ID=<probe-id> -e ONEUPTIME_URL=https://oneuptime.com -d oneuptime/probe:release
```

Docker Engine 27 og nyere vælger et IPv6-undernet til netværket og maskerer sondens udgående IPv6 bag værtens adresse. Ældre versioner skal have et eksplicit IPv6-undernet (for eksempel `docker network create --ipv6 --subnet fd00:0:0:1::/64 oneuptime-probe-ipv6`) og `"ip6tables": true` med `"experimental": true` i `/etc/docker/daemon.json`. Med Docker Compose skal du fjerne `network_mode: host` og sætte `enable_ipv6: true` på sondens netværk.

## NetBIOS-navneopslag i discovery-scanninger

En [netværks-discovery-scanning](/docs/monitor/network-device-monitor) med **Slå Windows-navne op (NetBIOS)** slået til sender NetBIOS-navneforespørgsler (NBSTAT) fra sonden til hver vært uden SNMP-systemnavn. For scanninger, der bruger det, skal du tillade denne trafik:

- **Hvilke værter der spørges:** fundne værter, der hverken har et SNMP-systemnavn eller et reverse-DNS-navn (PTR), og kun på private adresser (`10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`) eller carrier-grade NAT-adresser (`100.64.0.0/10`). Offentlige adresser spørges aldrig, og en vært, hvis reverse-DNS-opslag fra sonden gav et navn, får aldrig en forespørgsel. En vært, hvis opslag fejlede, fik timeout eller blev sprunget over, da opslagenes tidsbudget slap op, kan stadig blive spurgt, selv om den har en PTR-post.
- **Udgående:** UDP fra én midlertidig (tilfældig, høj) kildeport på sonden til UDP-port 137 på de værter. Proxyindstillingerne ovenfor gælder ikke for den.
- **Indgående:** svarene, fra UDP-port 137 på hver vært tilbage til den midlertidige port. En stateful firewall tillader dem automatisk. Uden dem bliver værterne ved med at blive navngivet efter deres IP-adresse.

Opslaget kræver ingen ekstra container-capability og virker fra Kubernetes' pod-netværk. Det spørger højst 2.000 værter pr. scanning (`PROBE_DISCOVERY_NETBIOS_MAX_HOSTS` hæver det til 4.000), sender hver vært uden svar én forespørgsel mere, fordeler forespørgslerne med cirka 100 pr. sekund og stopper ved en tidsgrænse, der er afpasset efter det arbejde - cirka 54 sekunder for et fuldt opslag af 2.000 værter, og aldrig mere end to minutter. Globale sonder sender aldrig NetBIOS-forespørgsler, uanset hvad scanningen siger, så kør scanninger, der skal bruge NetBIOS-navne, fra en brugerdefineret sonde. Indstillingen er slået til for nye scanninger. NBSTAT-forespørgsler til mange værter kan udløse regler for indtrængningsdetektion, så slå den fra på scanninger af netværk, hvor det betyder noget, eller giv dit sikkerhedsteam besked først.

## Miljøvariabler

Sonden læser sine indstillinger fra sit miljø, når den starter: ændr en, og genstart så sonden. Et tal, som sonden ikke kan læse, eller som ligger uden for det interval, en variabel tillader, ignoreres, og standardværdien bruges; grænserne for pakkeopsamling trækkes i stedet ind i deres interval.

### Påkrævede

| Variabel | Hvad den er |
| --- | --- |
| `PROBE_KEY` | Sondens nøgle, fra **Vis ID og nøgle**. Uden den stopper sonden ved start. |
| `PROBE_ID` | Sondens ID, fra **Vis ID og nøgle**. Uden det stopper sonden ved start. |
| `ONEUPTIME_URL` | Hvor OneUptime er: `https://oneuptime.com` eller din egen installations URL. Uden den stopper sonden ved start. |

### Tjek af overvågninger

| Variabel | Standard | Hvad den gør |
| --- | --- | --- |
| `PROBE_MONITORING_WORKERS` | `1` | Hvor mange portioner af overvågninger sonden tjekker ad gangen. |
| `PROBE_MONITOR_FETCH_LIMIT` | `10` | Hvor mange overvågninger der er i en portion. |
| `PROBE_MONITOR_RETRY_LIMIT` | `3` | Nye forsøg efter det første forsøg på et mislykket tjek, brugt når et trin ikke angiver sit eget antal, altså op til 4 forsøg. `0` slår nye forsøg fra. |
| `PROBE_MONITOR_CHECK_TIMEOUT_IN_MS` | `900000` | Frist for at tjekke én overvågning, hvorefter tjekket opgives og prøves igen i næste cyklus. Standarden vokser, når tidsgrænsen for syntetiske scripts hæves, så et script aldrig afbrydes. |
| `PROBE_SYNTHETIC_MONITOR_SCRIPT_TIMEOUT_IN_MS` | `60000` | Tidsgrænse for syntetiske overvågningers scripts, i millisekunder. |
| `PROBE_SYNTHETIC_MONITOR_CHROMIUM_SANDBOX_ENABLED` | `false` | Sæt til `true` for at køre Chromium i syntetiske overvågninger inde i sin egen sandkasse. Slå den kun til, når sondens container kører med en seccomp-profil, der tillader sandkassen, som Playwrights: uden en kan Chromium ikke starte. Så længe den er slået fra, logger sonden en advarsel ved opstart. |
| `PROBE_CUSTOM_CODE_MONITOR_SCRIPT_TIMEOUT_IN_MS` | `60000` | Tidsgrænse for Custom Code-overvågningers scripts, i millisekunder. |
| `PROBE_ALLOW_PRIVATE_NETWORK_MONITORS` | `false` | Sæt til `true`, så Website-, API-, External Status Page- og Custom Code-overvågninger på denne sonde må nå private adresser. Se [Adgang til privat netværk](/docs/self-hosted/private-network-access). |
| `PROBE_NETWORK_DEVICE_POLL_CONCURRENCY` | `25` | Hvor mange netværksenheder sonden poller ad gangen. Hæv den for en sonde, der poller mange enheder. |

De grænser, en syntetisk overvågning kører inden for (hvor mange ad gangen, deres hukommelse og deres disk), står på siden [Syntetisk monitor](/docs/monitor/synthetic-monitor).

### Kommunikation med OneUptime

| Variabel | Standard | Hvad den gør |
| --- | --- | --- |
| `HTTP_PROXY_URL`, `HTTPS_PROXY_URL`, `NO_PROXY` | ingen | Proxyindstillingerne: se [Forbind gennem en proxy](#forbind-gennem-en-proxy). |
| `PROBE_API_REQUEST_TIMEOUT_IN_MS` | `45000` | Frist for hver forespørgsel, sonden sender til OneUptime. |
| `PROBE_API_SLOW_REQUEST_THRESHOLD_IN_MS` | `10000` | Log en advarsel for forespørgsler til OneUptime, der er langsommere end dette. |

### Netværks-discovery

| Variabel | Standard | Hvad den gør |
| --- | --- | --- |
| `PROBE_DISCOVERY_SCAN_TIMEOUT_IN_MS` | `5400000` (90 minutter) | Frist for én netværks-discovery-runde, hvorefter den opgives, og scanningen meldes som fejlet. |
| `PROBE_DISCOVERY_PROGRESS_INTERVAL_IN_MS` | `30000` | Hvor ofte en igangværende discovery-runde uploader de værter, den har fundet indtil nu, så en lang scanning viser fremskridt, og dens enheder kan importeres, før den er færdig. Mindst `5000`. |
| `PROBE_DISCOVERY_SCAN_CONCURRENCY` | `0` | Fast antal adresser, en discovery-runde afsøger ad gangen. Lad den være tom (eller `0`) for at afpasse den efter scanningens mål, hvilket er det, du vil, medmindre sondens container er usædvanlig lille eller usædvanlig stor. |
| `PROBE_DISCOVERY_REVERSE_DNS_BUDGET_IN_MS` | `0` | Tidsgrænse i millisekunder for at slå reverse-DNS-navne (PTR) op for de værter, en runde fandt. Se nedenfor. |
| `PROBE_DISCOVERY_NETBIOS_MAX_HOSTS` | `0` | Hvor mange værter én scannings NetBIOS-opslag må spørge. Se nedenfor. |
| `PROBE_DISCOVERY_MAX_CONCURRENT_SCANS` | `4` | Højeste antal uafhængige discovery-scanninger, der kører samtidig på denne sonde, fra 1 til 16. Se nedenfor. |

`PROBE_DISCOVERY_REVERSE_DNS_BUDGET_IN_MS`: lad den være tom (eller `0`) for at afpasse grænsen efter antallet af værter: 60 sekunder for op til cirka 860 værter, voksende til højst 10 minutter. Du kan sætte den fra 1000 til 1200000. Værter, som opslagene ikke når i tide, får intet reverse-DNS-navn (de vises med IP-adresse, medmindre SNMP eller NetBIOS navngiver dem), og scanningens statusbesked siger, hvor mange der blev misset. Et opslag, der får timeout eller fejler, prøves igen én gang, så længe grænsen rækker, idet hver af sondens navneservere spørges på skift. Hæv den for et stort netværk bag en langsom DNS-server.

`PROBE_DISCOVERY_NETBIOS_MAX_HOSTS`: for scanninger med NetBIOS-navne slået til spørger opslaget hver vært uden SNMP-systemnavn, værter uden reverse-DNS-navn først. Lad den være tom (eller `0`) for at beholde den indbyggede grænse på 2.000; du kan sætte den fra 1 til 4000. Værter over grænsen spørges ikke, og scanningens statusbesked siger hvor mange. Hæver du den, bliver opslaget også længere (tidsgrænsen afpasses efter den: cirka 104 sekunder ved 4.000 værter), og der kommer flere NBSTAT-datagrammer på netværket, som regler for indtrængningsdetektion holder øje med.

`PROBE_DISCOVERY_MAX_CONCURRENT_SCANS`: sonden ser efter endnu en ventende scanning hvert minut, så længe der er kapacitet, så en lang scanning ikke blokerer alle de andre. Når alle pladser er optaget, venter yderligere scanninger, til en plads bliver ledig. Hver scanning har sin egen værtssamtidighed, så ressourceforbruget vokser med begge indstillinger; sænk den ene af grænserne for små containere. Sæt den til 1 for at køre scanninger efter hinanden.

Opgradér OneUptime-serveren, før du opgraderer brugerdefinerede sonder til at bruge samtidig discovery. Serveren skal kunne udelukke scanninger, som sonden stadig kører, så redigering af en kørende scanning sikkert sætter dens nye konfiguration i kø. Når du forbinder en opdateret sonde til en ældre server, så sæt `PROBE_DISCOVERY_MAX_CONCURRENT_SCANS=1`, indtil serveren er opgraderet.

### Pakkeopsamling

| Variabel | Standard | Hvad den gør |
| --- | --- | --- |
| `PROBE_PACKET_CAPTURE_ENABLED` | fra | Sæt til `true`, så personer med tilladelsen kan starte pakkeopsamlinger på denne sonde fra dashboardet. Opsamlinger kræver også værtsnetværk og capability'en `NET_RAW`. Se [Pakkeopsamling](/docs/probe/packet-capture). |
| `PROBE_PACKET_CAPTURE_MAX_DURATION_IN_SECONDS` | `1800` | Den længste pakkeopsamling, denne sonde kører, fra 5 til 1800. |
| `PROBE_PACKET_CAPTURE_MAX_FILE_SIZE_IN_MB` | `25` | Den største opsamlingsfil, denne sonde laver, fra 1 til 25. |

### Hvad sonden lytter på

En sonde laver kun udgående forbindelser, medmindre du slår en lytter til eller beholder en, der er slået til som standard:

| Lytter | Indstilling | Standard | Læs mere |
| --- | --- | --- | --- |
| Indgående anmodninger og heartbeats | `PROBE_INGRESS_PORT` | Fra | [Indgående anmodning ingress](/docs/probe/incoming-request-ingress) |
| SNMP-traps | `PROBE_SNMP_TRAP_RECEIVER_ENABLED` | Til, UDP 162 | [Netværksenheds-monitor](/docs/monitor/network-device-monitor) |
| Syslog | `PROBE_SYSLOG_RECEIVER_ENABLED` | Fra, UDP 5140 | [Vejledninger pr. netværksleverandør](/docs/monitor/network-vendor-guides) |
| NetFlow, IPFIX og sFlow | `PROBE_NETFLOW_RECEIVER_ENABLED` | Til, UDP 2055, 4739 og 6343 | [Netværkstrafik](/docs/monitor/network-traffic) |
| Sundhedstjek | `PORT` | Til, TCP 3874 | `/status/live` og `/status/ready` |

I en container kan en port kun nås fra andre maskiner med værtsnetværk, eller når du publicerer den.

Syslog-modtageren videresender højst `PROBE_SYSLOG_RATE_LIMIT_PER_MINUTE` beskeder i minuttet, `600` som standard, kasserer resten og logger, hvor mange den kasserede.

`PROBE_NAME` og `PROBE_DESCRIPTION` læses kun af sonder, der selv registrerer sig med `REGISTER_PROBE_KEY`, som de sonder, en selvhostet installation kører for alle projekter. En brugerdefineret sonde henter sit navn og sin beskrivelse fra dashboardet.

## Fejlfinding

### Undersøg en afbrudt sonde

En sonde markeres `Disconnected`, når dens forespørgsler til OneUptime ikke længere lykkes. Sondens log siger, hvor hver mislykket forespørgsel gik i stå, så du sjældent behøver at gætte.

:::steps
#### Læs miljøblokken, der udskrives ved start

Hver sonde udskriver ved start én JSON-blok med den OneUptime-URL, den bruger, dens forespørgselsfrist, dens proxyindstillinger, de DNS-resolvere, den har arvet, Node- og OS-versionen, og om TLS-verifikationen er slået fra. Medtag denne blok, når du rapporterer et problem.

#### Find fejlrapporten

Hver mislykket forespørgsel til OneUptime logger en blok med `stalledAt` og `whatThisMeans`. `stalledAt` er den fase, forespørgslen aldrig kom forbi:

| `stalledAt` | Hvad det betyder |
| --- | --- |
| `SocketAssignment` | Intet forlod maskinen. Socket-puljen var fyldt op, eller en konfigureret proxy fik aldrig sin CONNECT-tunnel op. |
| `TcpConnect` | Maskinen sendte SYN og fik intet tilbage: en firewall eller et sikkerhedsudstyr smider pakker væk, eller værten kan ikke nås. |
| `TlsHandshake` | TCP forbandt, TLS blev aldrig færdig. Som regel en mellemboks, der inspicerer TLS. |
| `RequestSend` | Forbundet, men forespørgslen blev aldrig skrevet helt: den anden ende holdt op med at læse. |
| `WaitingForServerResponse` | Forespørgslen blev leveret, og serveren sendte intet tilbage. **Sondens netværk er i orden**: tjek OneUptime-serveren, dens load balancer og dens reverse proxy. |
| `ResponseBody` | Serveren begyndte at svare og gik i stå undervejs. |
| `Unknown` | Sonden kunne ikke se, hvor forespørgslen gik i stå. Forbindelsens selvtest nedenfor er det næste, du skal læse. |

Den samme blok rapporterer også `deadlineOverrunInMs`. Tog en frist på 45000ms meget længere end 45000ms i virkelig tid, var selve sondeprocessen blokeret: tjek `probeProcess.eventLoopMaxDriftInMs` i blokken, før du undersøger netværket.

#### Læs forbindelsens selvtest

Efter tre fejl i træk tester sonden den samme server ét lag ad gangen (DNS, så TCP, så TLS, så en rigtig HTTP-rundtur) og logger hvert trin med dets tid. Det første trin, der fejler, er dit svar. Når der er konfigureret en proxy, tester sonden strækningen til proxyen, for det er den eneste strækning, den faktisk laver. Testen kører højst én gang hvert femte minut.

#### Hold øje med langsomme forespørgsler, før de fejler

Forespørgsler, der lykkes, men tager længere end `PROBE_API_SLOW_REQUEST_THRESHOLD_IN_MS`, logges med deres tid. En sonde, der begynder at logge forespørgsler på 20 sekunder, er på vej til at overskride fristen på 45 sekunder.
:::

På OneUptime-serverens side logges også en sondeforespørgsel, der besvares langsomt, eller som sonden opgav, før der blev sendt et svar, med sondens id. Disse to logs tilsammen fortæller, hvilken side af forbindelsen fejlen ligger på.

### Andre problemer

:::details Sonden stopper lige efter start
Dens log nævner, hvad der mangler: `PROBE_KEY is not set`, `PROBE_INGEST_URL or ONEUPTIME_URL is not set` eller `PROBE_ID or REGISTER_PROBE_KEY should be set`. Er alle tre sat, men ID og nøgle passer ikke til nogen sonde, prøver sonden 10 gange med 30 sekunders mellemrum og stopper så med `Unable to register probe after 10 attempts`. Kopiér ID og nøgle igen med **Vis ID og nøgle**.
:::

:::details Sonden virkede, indtil nogen nulstillede dens nøgle
**Nulstil sondenøgle** på sondens side laver en ny nøgle, og den gamle holder straks op med at virke. Kopiér den nye nøgle med **Vis ID og nøgle**, sæt den som `PROBE_KEY`, og genstart sonden.
:::

:::details En overvågning siger, at den ikke kan nå en privat adresse
Sonder afviser private adresser, indtil du tillader dem. Sæt `PROBE_ALLOW_PRIVATE_NETWORK_MONITORS=true` på sonden, og genstart den: se [Adgang til privat netværk](/docs/self-hosted/private-network-access).
:::

Har du stadig problemer, så opret et issue på [GitHub](https://github.com/oneuptime/oneuptime) eller [kontakt support](https://oneuptime.com/support).

## Næste skridt

:::cards
- [Opret en monitor](/docs/monitor/create-monitor): Vælg, hvad der tjekkes, og hvilke sonder der tjekker det.
- [Indgående anmodning ingress](/docs/probe/incoming-request-ingress): Lad tjenester uden internetadgang sende heartbeats gennem sonden.
- [Pakkeopsamling](/docs/probe/packet-capture): Opsaml den trafik, sonden ser, fra dashboardet.
- [Adgang til privat netværk](/docs/self-hosted/private-network-access): Lad en sonde tjekke private adresser.
:::
