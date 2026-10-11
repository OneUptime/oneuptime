# Anpassade probes

En anpassad sond är en liten agent som du kör i ditt eget nätverk. Den kontrollerar de övervakare du lägger till den i, till exempel interna webbplatser, API:er och servrar bakom din brandvägg, och skickar resultaten till OneUptime. Den öppnar bara utgående anslutningar över HTTPS, så ingenting i ditt nätverk behöver ta emot anslutningar från internet.

:::cards
- [Så fungerar det](#så-fungerar-det): Vad sonden gör och hur OneUptime vet att den körs.
- [Installera en sond](#installera-en-sond): Skapa den i OneUptime, kör den med Docker, Docker Compose eller Kubernetes och lägg till den i övervakare.
- [Miljövariabler](#miljövariabler): Varje inställning som sonden läser, med standardvärdet.
- [Felsök en frånkopplad sond](#felsök-en-frånkopplad-sond): Hitta var sondens förfrågningar till OneUptime fastnar.
:::

## Så fungerar det

```mermaid title="Vad en anpassad sond gör"
sequenceDiagram
    participant P as Anpassad sond
    participant O as OneUptime
    P->>O: Jag körs<br/>(varje minut)
    P->>O: Vilka av mina övervakare<br/>ska kontrolleras nu?
    O-->>P: Övervakarna som<br/>ska kontrolleras
    Note over P: Kontrollerar var och en<br/>i ditt nätverk
    P->>O: Skicka resultaten
    Note over O: Uppdaterar status, öppnar<br/>incidenter eller larm
```

- **Sonden ansluter utåt.** Varje förfrågan går från sonden till `ONEUPTIME_URL` över HTTPS. Ingenting utifrån behöver nå sonden.
- **Den kontrollerar bara sina egna övervakare.** Sonden ber OneUptime om de övervakare den är tillagd i, kontrollerar var och en när det är dags och skickar tillbaka resultatet. OneUptime avgör utifrån resultaten om en övervakares status ändras.
- **OneUptime håller koll på att den körs.** Varje förfrågan från sonden räknas som ett livstecken, och sonden skickar minst en per minut. Efter ungefär tre minuter utan någon visar sonden **Frånkopplad**, och dess ägare får besked. Har en sond inga ägare får projektets ägare besked.

## Innan du börjar

- **Growth-planen, på OneUptime Cloud.** Den krävs för att skapa en sond. En självhostad installation har inga plangränser.
- **Behörighet att skapa sonder.** Projektägare, -administratörer och -medlemmar har den, och det har även alla vars roll tillåter att skapa sonder.
- **En maskin i nätverket du vill övervaka.** Den behöver Docker, Docker Compose eller Kubernetes, en väg till tjänsterna som sonden ska kontrollera och utgående HTTPS till `ONEUPTIME_URL`.

## Installera en sond

:::steps
### Skapa sonden

Öppna **Övervakare → Inställningar → Sonder** och klicka på **Skapa Sond**. Ge den ett **Namn** och en **Beskrivning**: båda är obligatoriska. **Fler fält** innehåller **Sondlogotyp**, **Aktivera övervakning automatiskt på nya övervakare**, som väljer den här sonden för varje ny övervakare du skapar, och **Etiketter**.

### Kopiera dess ID och nyckel

Sonden behöver sitt ID och sin nyckel för att ansluta. För att kopiera dem öppnar du sondens meny i tabellen **Anpassade probes** och väljer **Visa ID och nyckel**. Alla som ser tabellen kan kopiera en sonds ID; nyckeln visas bara för projektägare och -administratörer, som ser **Visa ID och nyckel** där de andra ser **Visa ID**.

Projektägare och -administratörer kan också klicka på sonden: kortet **Set up your Custom Probe** på dess sida visar Docker-kommandot med ID och nyckel redan ifyllda.

### Kör sonden

Kör den på maskinen du valde, med sondens ID och nyckel. Om du själv hostar OneUptime sätter du `ONEUPTIME_URL` till din installations URL i stället för `https://oneuptime.com`.

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

Starta den sedan med `docker compose up -d`.
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

Tillämpa den sedan med `kubectl apply -f oneuptime-probe.yaml`.
:::

Med värdnätverk (`--network host`, `network_mode: host`) använder sonden värdens eget nätverk, IPv6 inräknat. Läs [Övervaka IPv6-mål](#övervaka-ipv6-mål) innan du kör den utan värdnätverk.

### Kontrollera att den ansluter

Inom en minut eller två visar sondens **Status** i tabellen **Anpassade probes** **Ansluten**. Visar den fortfarande **Frånkopplad** står orsaken i sondens logg: se [Felsök en frånkopplad sond](#felsök-en-frånkopplad-sond).

### Låt sonden kontrollera en övervakare

En sond kontrollerar bara de övervakare den är tillagd i. En ny övervakare väljer sina sonder i steget **Sonder och intervall** i **Skapa monitor**. För en befintlig övervakare öppnar du den och går till **Konfiguration → Sonder och intervall**. Sidan har tre kort:

- **Övervakningsintervall**: hur ofta var och en av övervakarens sonder kontrollerar den. Välj ett intervall så sparas det direkt. Syntetiska, Custom Code- och SSL-certifikatövervakare erbjuds var 5:e minut eller mer sällan; en övervakare som redan har ett kortare intervall, eller ett schema som satts via API:et, behåller det och visar det i listan.
- **Sonder**: klicka på **Lägg till sond** och välj din anpassade sond. Om en sond ska sluta kontrollera den här övervakaren stänger du av den med **Redigera** i radens meny, eller tar bort raden.
- **Sondöverensstämmelse**: hur många av övervakarens sonder som måste se samma resultat innan dess status ändras, ifyllt i meningen "Ändra den här övervakarens status när ... sonder är överens". Lämna rutan tom för alla. Bara sonder som är påslagna och anslutna räknas, så ett högre tal betyder också alla. Talet sparas när du lämnar rutan eller trycker på **Enter**.

Övervakare som sonder inte kontrollerar (Manuell, Inkommande förfrågan, Inkommande e-post, Server, Nätverksenhet och telemetriövervakarna) har ingen sida Sonder och intervall.
:::

> [!TIP]
> En sond som ska kontrollera privata adresser, som `http://10.0.0.5/health`, behöver `PROBE_ALLOW_PRIVATE_NETWORK_MONITORS=true`. Sonder avvisar privata adresser tills du tillåter dem: se [Åtkomst till privat nätverk](/docs/self-hosted/private-network-access).

## Ansluta via en proxy

Om sonden måste gå via en proxy för att nå OneUptime eller webbplatserna den kontrollerar, ger du den proxyns adress:

| Variabel | Vad den gör |
| --- | --- |
| `HTTPS_PROXY_URL` | Proxyn för HTTPS-adresser, bland dem OneUptime självt och de flesta webbplatser. |
| `HTTP_PROXY_URL` | Proxyn för vanliga HTTP-adresser. |
| `NO_PROXY` | Värdar som sonden når direkt, åtskilda med kommatecken. |

Skriv en proxys adress som `http://proxy.example.com:8080`, eller som `http://username:password@proxy.example.com:8080` när den kräver användarnamn och lösenord. De flesta proxyer hanterar båda sorternas adresser, så sätt båda variablerna till samma URL.

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

Det här går via proxyn:

- **Sondens egna förfrågningar till OneUptime.**
- **Övervakarnas HTTP-kontroller**: Website-, API-, External Status Page-, Custom Code-, SSL-certifikat-, syntetiska och domänövervakare. SSL-certifikat- och syntetiska övervakare använder `HTTPS_PROXY_URL`, eller `HTTP_PROXY_URL` när bara den är satt.
- **Inte de andra kontrollerna.** Ping, Port, DNS, SNMP och de andra kontrollerna som inte är HTTP ansluter direkt.

En post i `NO_PROXY` är ett värdnamn (`api.internal`), en domän med punkt eller `*.` först för varje namn under den (`.internal.example.com`), vilken som helst av dem med en `:port`, eller `*` för allt. IP-intervall läses inte: ange varje adress. Namnen med små bokstäver `http_proxy`, `https_proxy` och `no_proxy`, samt `HTTP_PROXY` och `HTTPS_PROXY`, fungerar också.

## Övervaka IPv6-mål

En sond kan bara övervaka ett IPv6-mål om sondens eget nätverk har IPv6:

- **Docker med `--network host`, eller Compose med `network_mode: host`** (uppsättningarna ovan): sonden delar värdens nätverk, så den har IPv6 precis när värden har det.
- **Ett Docker-bridgenätverk** (det du får utan värdnätverk): ingen IPv6, om inte IPv6 är påslaget för det nätverket (se nedan).
- **Kubernetes**: poddar har bara IPv6 i ett dual-stack- eller rent IPv6-kluster.

För att kontrollera det pingar du en offentlig IPv6-adress inifrån sonden:

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

`1 received` betyder att sonden kan nå IPv6-mål. Har sonden ingen användbar IPv6 misslyckas `ping` direkt, och felet säger varför:

| Fel | Vad det betyder |
| --- | --- |
| `Network is unreachable` | Sondens nätverk har ingen IPv6-väg: ett Docker-bridgenätverk utan IPv6, ett Kubernetes-kluster med bara IPv4 eller en värd utan IPv6-anslutning. |
| `Cannot assign requested address` | IPv6 är avstängt i sondens nätverksnamnrymd. Kontrollera `net.ipv6.conf.all.disable_ipv6` och `net.ipv6.conf.lo.disable_ipv6`: `cat /proc/sys/net/ipv6/conf/all/disable_ipv6` inne i sonden skriver ut `1` när det är avstängt. Med värdnätverk är det värdens inställningar. |
| `Address family not supported by protocol` | Kärnan startades med `ipv6.disable=1`, så maskinen har ingen IPv6 alls. Ta bort det från kärnans kommandorad och starta om, eller kör sonden på en annan maskin. |

I alla fallen skickades ingenting till målet, så sonden kan inte veta om det är uppe. Kontrollen misslyckas ändå, men en Ping-övervakares felorsak nämner sonden i stället för att säga att målet inte svarade:

```text
This probe cannot send IPv6 traffic (ping6: connect: Cannot assign requested address), so 2001:db8::1 was never contacted. The probe has no usable IPv6 address or route; this says nothing about whether 2001:db8::1 is up. Monitor IPv6 destinations from a probe that has IPv6 connectivity.
```

Nätverksvägen som registreras med felet säger `Traceroute could not run: this probe cannot send IPv6 traffic (...)`. Laga sondens nätverk, eller flytta övervakaren till en sond som har IPv6.

### IPv6 utan värdnätverk

Om du inte kan använda värdnätverk kopplar du sonden till ett Docker-nätverk med IPv6 påslaget. Värden själv behöver fortfarande IPv6.

```bash
docker network create --ipv6 oneuptime-probe-ipv6
docker run --name oneuptime-probe --network oneuptime-probe-ipv6 -e PROBE_KEY=<probe-key> -e PROBE_ID=<probe-id> -e ONEUPTIME_URL=https://oneuptime.com -d oneuptime/probe:release
```

Docker Engine 27 och senare väljer ett IPv6-subnät för nätverket och maskerar sondens utgående IPv6 bakom värdens adress. Äldre versioner behöver ett uttryckligt IPv6-subnät (till exempel `docker network create --ipv6 --subnet fd00:0:0:1::/64 oneuptime-probe-ipv6`) och `"ip6tables": true` med `"experimental": true` i `/etc/docker/daemon.json`. Med Docker Compose tar du bort `network_mode: host` och sätter `enable_ipv6: true` på sondens nätverk.

## NetBIOS-namnuppslag i discovery-skanningar

En [nätverks-discovery-skanning](/docs/monitor/network-device-monitor) med **Slå upp Windows-namn (NetBIOS)** påslaget skickar NetBIOS-namnfrågor (NBSTAT) från sonden till varje värd utan SNMP-systemnamn. För skanningar som använder det tillåter du den här trafiken:

- **Vilka värdar som frågas:** upptäckta värdar som varken har ett SNMP-systemnamn eller ett omvänt DNS-namn (PTR), och bara på privata adresser (`10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`) eller carrier-grade NAT-adresser (`100.64.0.0/10`). Offentliga adresser frågas aldrig, och en värd vars omvända DNS-uppslag från sonden gav ett namn får aldrig någon fråga. En värd vars uppslag misslyckades, fick timeout eller hoppades över när uppslagens tidsbudget tog slut kan fortfarande frågas, även om den har en PTR-post.
- **Utgående:** UDP från en tillfällig (slumpmässig, hög) källport på sonden till UDP-port 137 på de värdarna. Proxyinställningarna ovan gäller inte för den.
- **Inkommande:** svaren, från UDP-port 137 på varje värd tillbaka till den tillfälliga porten. En tillståndsbaserad brandvägg tillåter dem automatiskt. Utan dem fortsätter värdarna att namnges efter sin IP-adress.

Uppslaget behöver ingen extra container-capability och fungerar från Kubernetes poddnätverk. Det frågar högst 2 000 värdar per skanning (`PROBE_DISCOVERY_NETBIOS_MAX_HOSTS` höjer det till 4 000), skickar ytterligare en fråga till varje värd som inte svarat, sprider frågorna till ungefär 100 per sekund och stannar vid en tidsgräns som är anpassad efter det arbetet - ungefär 54 sekunder för ett fullt uppslag av 2 000 värdar, och aldrig mer än två minuter. Globala sonder skickar aldrig NetBIOS-frågor, oavsett vad skanningen säger, så kör skanningar som behöver NetBIOS-namn från en anpassad sond. Alternativet är påslaget för nya skanningar. NBSTAT-frågor till många värdar kan utlösa regler för intrångsdetektering, så stäng av det för skanningar av nätverk där det spelar roll, eller meddela ditt säkerhetsteam först.

## Miljövariabler

Sonden läser sina inställningar från sin miljö när den startar: ändra en och starta sedan om sonden. Ett tal som sonden inte kan läsa, eller som ligger utanför det intervall en variabel tillåter, ignoreras och standardvärdet används; gränserna för paketinspelning flyttas i stället in i sitt intervall.

### Obligatoriska

| Variabel | Vad den är |
| --- | --- |
| `PROBE_KEY` | Sondens nyckel, från **Visa ID och nyckel**. Utan den stannar sonden vid start. |
| `PROBE_ID` | Sondens ID, från **Visa ID och nyckel**. Utan det stannar sonden vid start. |
| `ONEUPTIME_URL` | Var OneUptime finns: `https://oneuptime.com`, eller din egen installations URL. Utan den stannar sonden vid start. |

### Kontroll av övervakare

| Variabel | Standard | Vad den gör |
| --- | --- | --- |
| `PROBE_MONITORING_WORKERS` | `1` | Hur många omgångar övervakare sonden kontrollerar samtidigt. |
| `PROBE_MONITOR_FETCH_LIMIT` | `10` | Hur många övervakare en omgång innehåller. |
| `PROBE_MONITOR_RETRY_LIMIT` | `3` | Nya försök efter det första försöket på en misslyckad kontroll, som används när ett steg inte anger sitt eget antal, alltså upp till 4 försök. `0` stänger av nya försök. |
| `PROBE_MONITOR_CHECK_TIMEOUT_IN_MS` | `900000` | Tidsfrist för att kontrollera en övervakare, varefter kontrollen överges och görs om i nästa cykel. Standardvärdet växer när tidsgränsen för syntetiska skript höjs, så att ett skript aldrig avbryts. |
| `PROBE_SYNTHETIC_MONITOR_SCRIPT_TIMEOUT_IN_MS` | `60000` | Tidsgräns för syntetiska övervakares skript, i millisekunder. |
| `PROBE_SYNTHETIC_MONITOR_CHROMIUM_SANDBOX_ENABLED` | `false` | Sätt till `true` för att köra Chromium i syntetiska övervakare inuti sin egen sandlåda. Slå bara på den när sondens container körs med en seccomp-profil som tillåter sandlådan, till exempel Playwrights: utan en kan Chromium inte starta. Så länge den är avslagen loggar sonden en varning vid start. |
| `PROBE_CUSTOM_CODE_MONITOR_SCRIPT_TIMEOUT_IN_MS` | `60000` | Tidsgräns för Custom Code-övervakares skript, i millisekunder. |
| `PROBE_ALLOW_PRIVATE_NETWORK_MONITORS` | `false` | Sätt till `true` för att Website-, API-, External Status Page- och Custom Code-övervakare på den här sonden ska få nå privata adresser. Se [Åtkomst till privat nätverk](/docs/self-hosted/private-network-access). |
| `PROBE_NETWORK_DEVICE_POLL_CONCURRENCY` | `25` | Hur många nätverksenheter sonden pollar samtidigt. Höj den för en sond som pollar många enheter. |

Gränserna som en syntetisk övervakare körs inom (hur många samtidigt, deras minne och deras disk) finns på sidan [Syntetisk övervakning](/docs/monitor/synthetic-monitor).

### Kommunikation med OneUptime

| Variabel | Standard | Vad den gör |
| --- | --- | --- |
| `HTTP_PROXY_URL`, `HTTPS_PROXY_URL`, `NO_PROXY` | ingen | Proxyinställningarna: se [Ansluta via en proxy](#ansluta-via-en-proxy). |
| `PROBE_API_REQUEST_TIMEOUT_IN_MS` | `45000` | Tidsfrist för varje förfrågan som sonden skickar till OneUptime. |
| `PROBE_API_SLOW_REQUEST_THRESHOLD_IN_MS` | `10000` | Logga en varning för förfrågningar till OneUptime som är långsammare än så. |

### Nätverks-discovery

| Variabel | Standard | Vad den gör |
| --- | --- | --- |
| `PROBE_DISCOVERY_SCAN_TIMEOUT_IN_MS` | `5400000` (90 minuter) | Tidsfrist för en nätverks-discovery-omgång, varefter den överges och skanningen rapporteras som misslyckad. |
| `PROBE_DISCOVERY_PROGRESS_INTERVAL_IN_MS` | `30000` | Hur ofta en pågående discovery-omgång laddar upp värdarna den hittat hittills, så att en lång skanning visar framsteg och dess enheter kan importeras innan den är klar. Minst `5000`. |
| `PROBE_DISCOVERY_SCAN_CONCURRENCY` | `0` | Fast antal adresser som en discovery-omgång undersöker samtidigt. Lämna den tom (eller `0`) för att anpassa den efter skanningens mål, vilket är vad du vill om inte sondens container är ovanligt liten eller ovanligt stor. |
| `PROBE_DISCOVERY_REVERSE_DNS_BUDGET_IN_MS` | `0` | Tidsgräns i millisekunder för att slå upp omvända DNS-namn (PTR) för värdarna som en omgång hittade. Se nedan. |
| `PROBE_DISCOVERY_NETBIOS_MAX_HOSTS` | `0` | Hur många värdar en skannings NetBIOS-uppslag får fråga. Se nedan. |
| `PROBE_DISCOVERY_MAX_CONCURRENT_SCANS` | `4` | Största antal oberoende discovery-skanningar som körs samtidigt på den här sonden, från 1 till 16. Se nedan. |

`PROBE_DISCOVERY_REVERSE_DNS_BUDGET_IN_MS`: lämna den tom (eller `0`) för att anpassa gränsen efter antalet värdar: 60 sekunder för upp till ungefär 860 värdar, växande till högst 10 minuter. Du kan sätta den från 1000 till 1200000. Värdar som uppslagen inte hinner nå får inget omvänt DNS-namn (de visas med IP-adress om inte SNMP eller NetBIOS namnger dem), och skanningens statusmeddelande säger hur många som missades. Ett uppslag som får timeout eller misslyckas görs om en gång så länge gränsen räcker, och sondens namnservrar frågas i tur och ordning. Höj den för ett stort nätverk bakom en långsam DNS-server.

`PROBE_DISCOVERY_NETBIOS_MAX_HOSTS`: för skanningar med NetBIOS-namn påslagna frågar uppslaget varje värd utan SNMP-systemnamn, värdar utan omvänt DNS-namn först. Lämna den tom (eller `0`) för att behålla den inbyggda gränsen på 2 000; du kan sätta den från 1 till 4000. Värdar över gränsen frågas inte, och skanningens statusmeddelande säger hur många. Att höja den gör också uppslaget längre (tidsgränsen anpassas efter den: ungefär 104 sekunder vid 4 000 värdar) och lägger fler NBSTAT-datagram på nätverket, vilket regler för intrångsdetektering bevakar.

`PROBE_DISCOVERY_MAX_CONCURRENT_SCANS`: sonden letar efter ännu en väntande skanning varje minut så länge det finns kapacitet, så att en lång skanning inte blockerar alla andra. När alla platser är upptagna väntar fler skanningar tills en plats blir ledig. Varje skanning har sin egen värdsamtidighet, så resursanvändningen växer med båda inställningarna; sänk någon av gränserna för små containrar. Sätt den till 1 för att köra skanningar efter varandra.

Uppgradera OneUptime-servern innan du uppgraderar anpassade sonder för att använda samtidig discovery. Servern måste kunna utesluta skanningar som sonden fortfarande kör, så att redigering av en pågående skanning säkert köar dess nya konfiguration. När du ansluter en uppdaterad sond till en äldre server sätter du `PROBE_DISCOVERY_MAX_CONCURRENT_SCANS=1` tills servern är uppgraderad.

### Paketinspelning

| Variabel | Standard | Vad den gör |
| --- | --- | --- |
| `PROBE_PACKET_CAPTURE_ENABLED` | av | Sätt till `true` så att personer med behörigheten kan starta paketinspelningar på den här sonden från instrumentpanelen. Inspelningar kräver också värdnätverk och capabilityn `NET_RAW`. Se [Paketinspelning](/docs/probe/packet-capture). |
| `PROBE_PACKET_CAPTURE_MAX_DURATION_IN_SECONDS` | `1800` | Den längsta paketinspelning som den här sonden kör, från 5 till 1800. |
| `PROBE_PACKET_CAPTURE_MAX_FILE_SIZE_IN_MB` | `25` | Den största inspelningsfil som den här sonden skapar, från 1 till 25. |

### Vad sonden lyssnar på

En sond gör bara utgående anslutningar, om du inte slår på en lyssnare eller behåller en som är på som standard:

| Lyssnare | Inställning | Standard | Läs mer |
| --- | --- | --- | --- |
| Inkommande förfrågningar och heartbeats | `PROBE_INGRESS_PORT` | Av | [Ingress för inkommande förfrågningar](/docs/probe/incoming-request-ingress) |
| SNMP-traps | `PROBE_SNMP_TRAP_RECEIVER_ENABLED` | På, UDP 162 | [Nätverksenhets-övervakning](/docs/monitor/network-device-monitor) |
| Syslog | `PROBE_SYSLOG_RECEIVER_ENABLED` | Av, UDP 5140 | [Guider per nätverksleverantör](/docs/monitor/network-vendor-guides) |
| NetFlow, IPFIX och sFlow | `PROBE_NETFLOW_RECEIVER_ENABLED` | På, UDP 2055, 4739 och 6343 | [Nätverkstrafik](/docs/monitor/network-traffic) |
| Hälsokontroller | `PORT` | På, TCP 3874 | `/status/live` och `/status/ready` |

I en container kan en port bara nås från andra maskiner med värdnätverk eller när du publicerar den.

Syslog-mottagaren vidarebefordrar högst `PROBE_SYSLOG_RATE_LIMIT_PER_MINUTE` meddelanden per minut, `600` som standard, kastar resten och loggar hur många den kastade.

`PROBE_NAME` och `PROBE_DESCRIPTION` läses bara av sonder som registrerar sig själva med `REGISTER_PROBE_KEY`, som de sonder en självhostad installation kör för alla projekt. En anpassad sond hämtar sitt namn och sin beskrivning från instrumentpanelen.

## Felsökning

### Felsök en frånkopplad sond

En sond markeras `Disconnected` när dess förfrågningar till OneUptime slutar lyckas. Sondens logg säger var varje misslyckad förfrågan fastnade, så du behöver sällan gissa.

:::steps
#### Läs miljöblocket som skrivs ut vid start

Varje sond skriver vid start ut ett JSON-block med OneUptime-URL:en den använder, dess tidsfrist för förfrågningar, dess proxyinställningar, DNS-resolvrarna den har ärvt, Node- och OS-versionen, och om TLS-verifieringen har stängts av. Bifoga det blocket varje gång du rapporterar ett problem.

#### Hitta felrapporten

Varje misslyckad förfrågan till OneUptime loggar ett block med `stalledAt` och `whatThisMeans`. `stalledAt` är den fas som förfrågan aldrig kom förbi:

| `stalledAt` | Vad det betyder |
| --- | --- |
| `SocketAssignment` | Ingenting lämnade maskinen. Socket-poolen var full, eller så fick en konfigurerad proxy aldrig upp sin CONNECT-tunnel. |
| `TcpConnect` | Maskinen skickade SYN och fick ingenting tillbaka: en brandvägg eller säkerhetsutrustning kastar paket, eller så går värden inte att nå. |
| `TlsHandshake` | TCP anslöt, TLS blev aldrig klart. Oftast en mellanbox som inspekterar TLS. |
| `RequestSend` | Ansluten, men förfrågan skrevs aldrig färdigt: andra sidan slutade läsa. |
| `WaitingForServerResponse` | Förfrågan levererades och servern skickade ingenting tillbaka. **Sondens nätverk är i ordning**: kontrollera OneUptime-servern, dess lastbalanserare och dess omvända proxy. |
| `ResponseBody` | Servern började svara och fastnade halvvägs. |
| `Unknown` | Sonden kunde inte avgöra var förfrågan fastnade. Läs anslutningens självtest nedan härnäst. |

Samma block rapporterar också `deadlineOverrunInMs`. Tog en tidsfrist på 45000ms mycket längre än 45000ms i verklig tid var själva sondprocessen blockerad: kontrollera `probeProcess.eventLoopMaxDriftInMs` i blocket innan du undersöker nätverket.

#### Läs anslutningens självtest

Efter tre misslyckanden i rad testar sonden samma server ett lager i taget (DNS, sedan TCP, sedan TLS, sedan en riktig HTTP-rundresa) och loggar varje steg med dess tid. Det första steget som misslyckas är ditt svar. När en proxy är konfigurerad testar sonden sträckan till proxyn, eftersom det är den enda sträcka den faktiskt gör. Testet körs högst en gång var femte minut.

#### Håll koll på långsamma förfrågningar innan de misslyckas

Förfrågningar som lyckas men tar längre tid än `PROBE_API_SLOW_REQUEST_THRESHOLD_IN_MS` loggas med sin tid. En sond som börjar logga förfrågningar på 20 sekunder är på väg att passera tidsfristen på 45 sekunder.
:::

På OneUptime-serverns sida loggas också en sondförfrågan som besvaras långsamt, eller som sonden gav upp innan ett svar skickades, med sondens id. De två loggarna tillsammans berättar på vilken sida av anslutningen felet ligger.

### Andra problem

:::details Sonden stannar direkt efter start
Dess logg nämner vad som saknas: `PROBE_KEY is not set`, `PROBE_INGEST_URL or ONEUPTIME_URL is not set` eller `PROBE_ID or REGISTER_PROBE_KEY should be set`. När alla tre är satta men ID och nyckel inte matchar någon sond försöker sonden 10 gånger med 30 sekunders mellanrum och stannar sedan med `Unable to register probe after 10 attempts`. Kopiera ID och nyckel igen med **Visa ID och nyckel**.
:::

:::details Sonden fungerade tills någon återställde dess nyckel
**Återställ sondnyckel** på sondens sida skapar en ny nyckel, och den gamla slutar fungera direkt. Kopiera den nya nyckeln med **Visa ID och nyckel**, sätt den som `PROBE_KEY` och starta om sonden.
:::

:::details En övervakare säger att den inte når en privat adress
Sonder avvisar privata adresser tills du tillåter dem. Sätt `PROBE_ALLOW_PRIVATE_NETWORK_MONITORS=true` på sonden och starta om den: se [Åtkomst till privat nätverk](/docs/self-hosted/private-network-access).
:::

Har du fortfarande problem, skapa ett ärende på [GitHub](https://github.com/oneuptime/oneuptime) eller [kontakta supporten](https://oneuptime.com/support).

## Nästa steg

:::cards
- [Skapa en monitor](/docs/monitor/create-monitor): Välj vad som kontrolleras och vilka sonder som kontrollerar det.
- [Ingress för inkommande förfrågningar](/docs/probe/incoming-request-ingress): Låt tjänster utan internetåtkomst skicka heartbeats via sonden.
- [Paketinspelning](/docs/probe/packet-capture): Spela in trafiken som sonden ser, från instrumentpanelen.
- [Åtkomst till privat nätverk](/docs/self-hosted/private-network-access): Låt en sond kontrollera privata adresser.
:::
