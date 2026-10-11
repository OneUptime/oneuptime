# Egendefinerte probes

En egendefinert sonde er en liten agent som du kjører i ditt eget nettverk. Den sjekker overvåkerne du legger den til, for eksempel interne nettsteder, API-er og servere bak brannmuren din, og sender resultatene til OneUptime. Den åpner bare utgående tilkoblinger over HTTPS, så ingenting i nettverket ditt trenger å ta imot tilkoblinger fra internett.

:::cards
- [Slik fungerer det](#slik-fungerer-det): Hva sonden gjør, og hvordan OneUptime vet at den kjører.
- [Installer en sonde](#installer-en-sonde): Opprett den i OneUptime, kjør den med Docker, Docker Compose eller Kubernetes, og legg den til overvåkere.
- [Miljøvariabler](#miljøvariabler): Hver innstilling sonden leser, med standardverdien.
- [Undersøk en frakoblet sonde](#undersøk-en-frakoblet-sonde): Finn ut hvor sondens forespørsler til OneUptime stopper opp.
:::

## Slik fungerer det

```mermaid title="Hva en egendefinert sonde gjør"
sequenceDiagram
    participant P as Egendefinert sonde
    participant S as Tjenestene dine
    participant O as OneUptime
    P->>O: Jeg kjører (hvert minutt)
    P->>O: Hvilke av overvåkerne mine skal sjekkes nå?
    O-->>P: Overvåkerne som skal sjekkes
    P->>S: Sjekk hver av dem
    P->>O: Send resultatene
    O->>O: Oppdater status, åpne hendelser eller varsler
```

- **Sonden kobler seg utover.** Hver forespørsel går fra sonden til `ONEUPTIME_URL` over HTTPS. Ingenting utenfra trenger å nå sonden.
- **Den sjekker bare sine egne overvåkere.** Sonden spør OneUptime om overvåkerne den er lagt til, sjekker hver av dem når det er tid, og sender resultatet tilbake. OneUptime avgjør ut fra resultatene om statusen til en overvåker endres.
- **OneUptime passer på at den kjører.** Hver forespørsel fra sonden teller som et livstegn, og sonden sender minst én i minuttet. Etter omtrent tre minutter uten noen viser sonden **Frakoblet**, og eierne dens får beskjed. Har en sonde ingen eiere, får prosjektets eiere beskjed.

## Før du begynner

- **Growth-planen, på OneUptime Cloud.** Den kreves for å opprette en sonde. En selvhostet installasjon har ingen plangrenser.
- **Tillatelse til å opprette sonder.** Prosjekteiere og -administratorer har den, og det har også medlemmer der rollen tillater å opprette sonder.
- **En maskin i nettverket du vil overvåke.** Den trenger Docker, Docker Compose eller Kubernetes, en rute til tjenestene sonden skal sjekke, og utgående HTTPS til `ONEUPTIME_URL`.

## Installer en sonde

:::steps
### Opprett sonden

Åpne **Overvåkere → Innstillinger → Sonder** og klikk på **Opprett Sonde**. Gi den et **Navn** og en **Beskrivelse**: begge er påkrevd. **Flere felt** inneholder **Sondelogo**, **Aktiver overvåking automatisk på nye overvåkere**, som velger denne sonden for hver ny overvåker du oppretter, og **Etiketter**.

### Kopier ID-en og nøkkelen

Sonden trenger ID-en og nøkkelen sin for å koble til. For å kopiere dem åpner du sondens meny i tabellen **Egendefinerte probes** og velger **Vis ID og nøkkel**. Alle som ser tabellen kan kopiere ID-en til en sonde; nøkkelen vises bare for prosjekteiere og -administratorer, som ser **Vis ID og nøkkel** der de andre ser **Vis ID**.

Prosjekteiere og -administratorer kan også klikke på sonden: kortet **Set up your Custom Probe** på siden dens viser Docker-kommandoen med ID og nøkkel allerede fylt inn.

### Kjør sonden

Kjør den på maskinen du valgte, med sondens ID og nøkkel. Hvis du hoster OneUptime selv, setter du `ONEUPTIME_URL` til URL-en til installasjonen din i stedet for `https://oneuptime.com`.

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

Start den deretter med `docker compose up -d`.
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

Bruk den deretter med `kubectl apply -f oneuptime-probe.yaml`.
:::

Med vertsnettverk (`--network host`, `network_mode: host`) bruker sonden vertens eget nettverk, IPv6 inkludert. Les [Overvåk IPv6-mål](#overvåk-ipv6-mål) før du kjører den uten vertsnettverk.

### Sjekk at den kobler til

I løpet av et minutt eller to viser sondens **Status** i tabellen **Egendefinerte probes** **Tilkoblet**. Viser den fortsatt **Frakoblet**, står årsaken i sondens logg: se [Undersøk en frakoblet sonde](#undersøk-en-frakoblet-sonde).

### La sonden sjekke en overvåker

En sonde sjekker bare overvåkerne den er lagt til. En ny overvåker velger sondene sine i trinnet **Sonder og intervall** i **Opprett monitor**. For en overvåker som finnes fra før, åpner du den og går til **Konfigurasjon → Sonder og intervall**. Siden har tre kort:

- **Overvåkingsintervall**: hvor ofte hver av overvåkerens sonder sjekker den. Velg et intervall, så lagres det med en gang. Syntetiske, Custom Code- og SSL-sertifikatovervåkere tilbys hvert 5. minutt eller sjeldnere; en overvåker som allerede har et kortere intervall, eller en tidsplan satt via API-et, beholder den og viser den i listen.
- **Sonder**: klikk på **Legg til sonde** og velg den egendefinerte sonden din. For at en sonde skal slutte å sjekke denne overvåkeren, slår du den av med **Rediger** i radens meny, eller sletter raden.
- **Sondeenighet**: hvor mange av overvåkerens sonder som må se det samme resultatet før statusen endres, skrevet inn i setningen «Endre statusen til denne overvåkeren når ... sonder er enige». La feltet stå tomt for alle. Bare sonder som er slått på og tilkoblet er med, så et høyere tall betyr også alle. Tallet lagres når du forlater feltet eller trykker **Enter**.

Overvåkere som sonder ikke sjekker (Manuell, Innkommende forespørsel, Innkommende e-post, Server, Nettverksenhet og telemetriovervåkerne), har ingen side Sonder og intervall.
:::

> [!TIP]
> En sonde som skal sjekke private adresser, som `http://10.0.0.5/health`, trenger `PROBE_ALLOW_PRIVATE_NETWORK_MONITORS=true`. Sonder avviser private adresser til du tillater dem: se [Tilgang til privat nettverk](/docs/self-hosted/private-network-access).

## Koble til gjennom en proxy

Hvis sonden må gå gjennom en proxy for å nå OneUptime eller nettstedene den sjekker, gir du den adressen til proxyen:

| Variabel | Hva den gjør |
| --- | --- |
| `HTTPS_PROXY_URL` | Proxyen for HTTPS-adresser, blant dem OneUptime selv og de fleste nettsteder. |
| `HTTP_PROXY_URL` | Proxyen for vanlige HTTP-adresser. |
| `NO_PROXY` | Verter sonden når direkte, skilt med komma. |

Skriv adressen til en proxy som `http://proxy.example.com:8080`, eller som `http://username:password@proxy.example.com:8080` når den ber om brukernavn og passord. De fleste proxyer håndterer begge typer adresser, så sett begge variablene til samme URL.

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

Hva som går gjennom proxyen:

- **Sondens egne forespørsler til OneUptime.**
- **Overvåkernes HTTP-sjekker**: Website-, API-, External Status Page-, Custom Code-, SSL-sertifikat-, syntetiske og domeneovervåkere. SSL-sertifikat- og syntetiske overvåkere bruker `HTTPS_PROXY_URL`, eller `HTTP_PROXY_URL` når bare den er satt.
- **Ikke de andre sjekkene.** Ping, Port, DNS, SNMP og de andre sjekkene som ikke er HTTP, kobler til direkte.

En oppføring i `NO_PROXY` er et vertsnavn (`api.internal`), et domene med punktum eller `*.` foran for hvert navn under det (`.internal.example.com`), hver av dem med en `:port`, eller `*` for alt. IP-områder leses ikke: før opp hver adresse. Navnene med små bokstaver `http_proxy`, `https_proxy` og `no_proxy`, og også `HTTP_PROXY` og `HTTPS_PROXY`, fungerer også.

## Overvåk IPv6-mål

En sonde kan bare overvåke et IPv6-mål hvis sondens eget nettverk har IPv6:

- **Docker med `--network host`, eller Compose med `network_mode: host`** (oppsettene over): sonden deler vertens nettverk, så den har IPv6 akkurat når verten har det.
- **Et Docker-bridgenettverk** (det du får uten vertsnettverk): ingen IPv6, med mindre IPv6 er slått på for det nettverket (se nedenfor).
- **Kubernetes**: pods har bare IPv6 i en dual-stack- eller ren IPv6-klynge.

For å sjekke det pinger du en offentlig IPv6-adresse fra innsiden av sonden:

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

`1 received` betyr at sonden kan nå IPv6-mål. Har sonden ingen brukbar IPv6, feiler `ping` med en gang, og feilen sier hvorfor:

| Feil | Hva den betyr |
| --- | --- |
| `Network is unreachable` | Sondens nettverk har ingen IPv6-rute: et Docker-bridgenettverk uten IPv6, en Kubernetes-klynge med bare IPv4, eller en vert uten IPv6-tilkobling. |
| `Cannot assign requested address` | IPv6 er slått av i sondens nettverksnavnerom. Sjekk `net.ipv6.conf.all.disable_ipv6` og `net.ipv6.conf.lo.disable_ipv6`: `cat /proc/sys/net/ipv6/conf/all/disable_ipv6` inne i sonden skriver `1` når det er slått av. Med vertsnettverk er dette vertens innstillinger. |
| `Address family not supported by protocol` | Kjernen ble startet med `ipv6.disable=1`, så maskinen har ikke IPv6 i det hele tatt. Fjern det fra kjernens kommandolinje og start på nytt, eller kjør sonden på en annen maskin. |

I alle tilfellene ble ingenting sendt til målet, så sonden kan ikke vite om det er oppe. Sjekken feiler likevel, men feilårsaken til en Ping-overvåker nevner sonden i stedet for å si at målet ikke svarte:

```text
This probe cannot send IPv6 traffic (ping6: connect: Cannot assign requested address), so 2001:db8::1 was never contacted. The probe has no usable IPv6 address or route; this says nothing about whether 2001:db8::1 is up. Monitor IPv6 destinations from a probe that has IPv6 connectivity.
```

Nettverksbanen som registreres med feilen, sier `Traceroute could not run: this probe cannot send IPv6 traffic (...)`. Rett opp sondens nettverk, eller flytt overvåkeren til en sonde som har IPv6.

### IPv6 uten vertsnettverk

Hvis du ikke kan bruke vertsnettverk, kobler du sonden til et Docker-nettverk med IPv6 slått på. Verten selv trenger fortsatt IPv6.

```bash
docker network create --ipv6 oneuptime-probe-ipv6
docker run --name oneuptime-probe --network oneuptime-probe-ipv6 -e PROBE_KEY=<probe-key> -e PROBE_ID=<probe-id> -e ONEUPTIME_URL=https://oneuptime.com -d oneuptime/probe:release
```

Docker Engine 27 og nyere velger et IPv6-subnett for nettverket og maskerer sondens utgående IPv6 bak vertens adresse. Eldre versjoner trenger et eksplisitt IPv6-subnett (for eksempel `docker network create --ipv6 --subnet fd00:0:0:1::/64 oneuptime-probe-ipv6`) og `"ip6tables": true` med `"experimental": true` i `/etc/docker/daemon.json`. Med Docker Compose fjerner du `network_mode: host` og setter `enable_ipv6: true` på sondens nettverk.

## NetBIOS-navneoppslag i discovery-skanninger

En [nettverks-discovery-skanning](/docs/monitor/network-device-monitor) med **Slå opp Windows-navn (NetBIOS)** slått på sender NetBIOS-navneforespørsler (NBSTAT) fra sonden til hver vert uten SNMP-systemnavn. For skanninger som bruker det, tillater du denne trafikken:

- **Hvilke verter som spørres:** oppdagede verter som verken har et SNMP-systemnavn eller et omvendt DNS-navn (PTR), og bare på private adresser (`10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`) eller carrier-grade NAT-adresser (`100.64.0.0/10`). Offentlige adresser spørres aldri, og en vert der det omvendte DNS-oppslaget fra sonden ga et navn, får aldri en forespørsel. En vert der oppslaget feilet, fikk tidsavbrudd eller ble hoppet over da tidsbudsjettet for oppslagene var brukt opp, kan likevel bli spurt, selv om den har en PTR-post.
- **Utgående:** UDP fra én midlertidig (tilfeldig, høy) kildeport på sonden til UDP-port 137 på disse vertene. Proxyinnstillingene over gjelder ikke for den.
- **Innkommende:** svarene, fra UDP-port 137 på hver vert tilbake til den midlertidige porten. En tilstandsbasert brannmur tillater dem automatisk. Uten dem blir vertene fortsatt navngitt etter IP-adressen.

Oppslaget trenger ingen ekstra container-capability og fungerer fra Kubernetes' pod-nettverk. Det spør høyst 2 000 verter per skanning (`PROBE_DISCOVERY_NETBIOS_MAX_HOSTS` hever det til 4 000), sender hver vert uten svar én forespørsel til, fordeler forespørslene med omtrent 100 per sekund og stopper ved en tidsgrense tilpasset det arbeidet - omtrent 54 sekunder for et fullt oppslag av 2 000 verter, og aldri mer enn to minutter. Globale sonder sender aldri NetBIOS-forespørsler, uansett hva skanningen sier, så kjør skanninger som trenger NetBIOS-navn, fra en egendefinert sonde. Innstillingen er slått på for nye skanninger. NBSTAT-forespørsler til mange verter kan utløse regler for inntrengningsdeteksjon, så slå den av for skanninger av nettverk der det betyr noe, eller gi sikkerhetsteamet ditt beskjed først.

## Miljøvariabler

Sonden leser innstillingene sine fra miljøet når den starter: endre en, og start sonden på nytt. Et tall sonden ikke kan lese, eller et som ligger utenfor området en variabel tillater, ignoreres, og standardverdien brukes; grensene for pakkeopptak trekkes i stedet inn i området sitt.

### Påkrevde

| Variabel | Hva den er |
| --- | --- |
| `PROBE_KEY` | Sondens nøkkel, fra **Vis ID og nøkkel**. Uten den stopper sonden ved oppstart. |
| `PROBE_ID` | Sondens ID, fra **Vis ID og nøkkel**. Uten den stopper sonden ved oppstart. |
| `ONEUPTIME_URL` | Hvor OneUptime er: `https://oneuptime.com`, eller URL-en til din egen installasjon. Uten den stopper sonden ved oppstart. |

### Sjekk av overvåkere

| Variabel | Standard | Hva den gjør |
| --- | --- | --- |
| `PROBE_MONITORING_WORKERS` | `1` | Hvor mange bunker med overvåkere sonden sjekker samtidig. |
| `PROBE_MONITOR_FETCH_LIMIT` | `10` | Hvor mange overvåkere det er i en bunke. |
| `PROBE_MONITOR_RETRY_LIMIT` | `3` | Nye forsøk etter det første forsøket på en mislykket sjekk, brukt når et trinn ikke angir sitt eget antall, altså opptil 4 forsøk. `0` slår av nye forsøk. |
| `PROBE_MONITOR_CHECK_TIMEOUT_IN_MS` | `900000` | Frist for å sjekke én overvåker, deretter oppgis sjekken og prøves igjen i neste syklus. Standarden øker når tidsgrensen for syntetiske skript heves, så et skript aldri blir avbrutt. |
| `PROBE_SYNTHETIC_MONITOR_SCRIPT_TIMEOUT_IN_MS` | `60000` | Tidsgrense for skriptene til syntetiske overvåkere, i millisekunder. |
| `PROBE_SYNTHETIC_MONITOR_CHROMIUM_SANDBOX_ENABLED` | `false` | Sett til `true` for å kjøre Chromium i syntetiske overvåkere inne i sin egen sandkasse. Slå den bare på når sondens container kjører med en seccomp-profil som tillater sandkassen, som Playwrights: uten en kan ikke Chromium starte. Så lenge den er av, logger sonden en advarsel ved oppstart. |
| `PROBE_CUSTOM_CODE_MONITOR_SCRIPT_TIMEOUT_IN_MS` | `60000` | Tidsgrense for skriptene til Custom Code-overvåkere, i millisekunder. |
| `PROBE_ALLOW_PRIVATE_NETWORK_MONITORS` | `false` | Sett til `true` for at Website-, API-, External Status Page- og Custom Code-overvåkere på denne sonden skal kunne nå private adresser. Se [Tilgang til privat nettverk](/docs/self-hosted/private-network-access). |
| `PROBE_NETWORK_DEVICE_POLL_CONCURRENCY` | `25` | Hvor mange nettverksenheter sonden poller samtidig. Øk den for en sonde som poller mange enheter. |

Grensene en syntetisk overvåker kjører innenfor (hvor mange samtidig, minnet og disken deres), står på siden [Syntetisk overvåking](/docs/monitor/synthetic-monitor).

### Kommunikasjon med OneUptime

| Variabel | Standard | Hva den gjør |
| --- | --- | --- |
| `HTTP_PROXY_URL`, `HTTPS_PROXY_URL`, `NO_PROXY` | ingen | Proxyinnstillingene: se [Koble til gjennom en proxy](#koble-til-gjennom-en-proxy). |
| `PROBE_API_REQUEST_TIMEOUT_IN_MS` | `45000` | Frist for hver forespørsel sonden sender til OneUptime. |
| `PROBE_API_SLOW_REQUEST_THRESHOLD_IN_MS` | `10000` | Logg en advarsel for forespørsler til OneUptime som er tregere enn dette. |

### Nettverks-discovery

| Variabel | Standard | Hva den gjør |
| --- | --- | --- |
| `PROBE_DISCOVERY_SCAN_TIMEOUT_IN_MS` | `5400000` (90 minutter) | Frist for én nettverks-discovery-runde, deretter oppgis den, og skanningen meldes som feilet. |
| `PROBE_DISCOVERY_PROGRESS_INTERVAL_IN_MS` | `30000` | Hvor ofte en pågående discovery-runde laster opp vertene den har funnet så langt, så en lang skanning viser fremdrift, og enhetene kan importeres før den er ferdig. Minst `5000`. |
| `PROBE_DISCOVERY_SCAN_CONCURRENCY` | `0` | Fast antall adresser en discovery-runde sjekker samtidig. La den være tom (eller `0`) for å tilpasse den til skanningens mål, som er det du vil, med mindre sondens container er uvanlig liten eller uvanlig stor. |
| `PROBE_DISCOVERY_REVERSE_DNS_BUDGET_IN_MS` | `0` | Tidsgrense i millisekunder for å slå opp omvendte DNS-navn (PTR) for vertene en runde fant. Se nedenfor. |
| `PROBE_DISCOVERY_NETBIOS_MAX_HOSTS` | `0` | Hvor mange verter én skannings NetBIOS-oppslag kan spørre. Se nedenfor. |
| `PROBE_DISCOVERY_MAX_CONCURRENT_SCANS` | `4` | Høyeste antall uavhengige discovery-skanninger som kjører samtidig på denne sonden, fra 1 til 16. Se nedenfor. |

`PROBE_DISCOVERY_REVERSE_DNS_BUDGET_IN_MS`: la den være tom (eller `0`) for å tilpasse grensen til antall verter: 60 sekunder for opptil omtrent 860 verter, økende til høyst 10 minutter. Du kan sette den fra 1000 til 1200000. Verter som oppslagene ikke når i tide, får ikke noe omvendt DNS-navn (de vises med IP-adresse med mindre SNMP eller NetBIOS gir dem navn), og statusmeldingen til skanningen sier hvor mange som ble utelatt. Et oppslag som får tidsavbrudd eller feiler, prøves på nytt én gang så lenge grensen holder, og hver av sondens navneservere spørres etter tur. Hev den for et stort nettverk bak en treg DNS-server.

`PROBE_DISCOVERY_NETBIOS_MAX_HOSTS`: for skanninger med NetBIOS-navn slått på spør oppslaget hver vert uten SNMP-systemnavn, verter uten omvendt DNS-navn først. La den være tom (eller `0`) for å beholde den innebygde grensen på 2 000; du kan sette den fra 1 til 4000. Verter over grensen spørres ikke, og statusmeldingen til skanningen sier hvor mange. Å heve den gjør også oppslaget lengre (tidsgrensen tilpasses den: omtrent 104 sekunder ved 4 000 verter) og legger flere NBSTAT-datagrammer på nettverket, som regler for inntrengningsdeteksjon følger med på.

`PROBE_DISCOVERY_MAX_CONCURRENT_SCANS`: sonden ser etter enda en ventende skanning hvert minutt så lenge det er kapasitet, så en lang skanning ikke blokkerer alle de andre. Når alle plassene er opptatt, venter flere skanninger til en plass blir ledig. Hver skanning har sin egen vertssamtidighet, så ressursbruken vokser med begge innstillingene; senk en av grensene for små containere. Sett den til 1 for å kjøre skanninger etter hverandre.

Oppgrader OneUptime-serveren før du oppgraderer egendefinerte sonder til å bruke samtidig discovery. Serveren må kunne utelate skanninger som sonden fortsatt kjører, slik at redigering av en pågående skanning trygt setter den nye konfigurasjonen i kø. Når du kobler en oppdatert sonde til en eldre server, setter du `PROBE_DISCOVERY_MAX_CONCURRENT_SCANS=1` til serveren er oppgradert.

### Pakkeopptak

| Variabel | Standard | Hva den gjør |
| --- | --- | --- |
| `PROBE_PACKET_CAPTURE_ENABLED` | av | Sett til `true` for at personer med tillatelsen kan starte pakkeopptak på denne sonden fra dashbordet. Opptak trenger også vertsnettverk og capabilityen `NET_RAW`. Se [Pakkeopptak](/docs/probe/packet-capture). |
| `PROBE_PACKET_CAPTURE_MAX_DURATION_IN_SECONDS` | `1800` | Det lengste pakkeopptaket denne sonden kjører, fra 5 til 1800. |
| `PROBE_PACKET_CAPTURE_MAX_FILE_SIZE_IN_MB` | `25` | Den største opptaksfilen denne sonden lager, fra 1 til 25. |

### Hva sonden lytter på

En sonde lager bare utgående tilkoblinger, med mindre du slår på en lytter eller beholder en som er på som standard:

| Lytter | Innstilling | Standard | Les mer |
| --- | --- | --- | --- |
| Innkommende forespørsler og heartbeats | `PROBE_INGRESS_PORT` | Av | [Inngangsport for innkommende forespørsler](/docs/probe/incoming-request-ingress) |
| SNMP-traps | `PROBE_SNMP_TRAP_RECEIVER_ENABLED` | På, UDP 162 | [Nettverksenhets-overvåking](/docs/monitor/network-device-monitor) |
| Syslog | `PROBE_SYSLOG_RECEIVER_ENABLED` | Av, UDP 5140 | [Guider per nettverksleverandør](/docs/monitor/network-vendor-guides) |
| NetFlow, IPFIX og sFlow | `PROBE_NETFLOW_RECEIVER_ENABLED` | På, UDP 2055, 4739 og 6343 | [Nettverkstrafikk](/docs/monitor/network-traffic) |
| Helsesjekker | `PORT` | På, TCP 3874 | `/status/live` og `/status/ready` |

I en container kan en port bare nås fra andre maskiner med vertsnettverk eller når du publiserer den.

Syslog-mottakeren videresender høyst `PROBE_SYSLOG_RATE_LIMIT_PER_MINUTE` meldinger i minuttet, `600` som standard, forkaster resten og logger hvor mange den forkastet.

`PROBE_NAME` og `PROBE_DESCRIPTION` leses bare av sonder som registrerer seg selv med `REGISTER_PROBE_KEY`, som sondene en selvhostet installasjon kjører for alle prosjekter. En egendefinert sonde henter navnet og beskrivelsen sin fra dashbordet.

## Feilsøking

### Undersøk en frakoblet sonde

En sonde markeres `Disconnected` når forespørslene den sender til OneUptime, slutter å lykkes. Sondens logg sier hvor hver mislykket forespørsel stoppet opp, så du sjelden må gjette.

:::steps
#### Les miljøblokken som skrives ut ved oppstart

Hver sonde skriver ved oppstart ut én JSON-blokk med OneUptime-URL-en den bruker, forespørselsfristen, proxyinnstillingene, DNS-resolverne den har arvet, Node- og OS-versjonen, og om TLS-verifiseringen er slått av. Ta med denne blokken når du rapporterer et problem.

#### Finn feilrapporten

Hver mislykket forespørsel til OneUptime logger en blokk med `stalledAt` og `whatThisMeans`. `stalledAt` er fasen forespørselen aldri kom forbi:

| `stalledAt` | Hva det betyr |
| --- | --- |
| `SocketAssignment` | Ingenting forlot maskinen. Socket-utvalget var fullt, eller en konfigurert proxy fikk aldri opp CONNECT-tunnelen sin. |
| `TcpConnect` | Maskinen sendte SYN og fikk ingenting tilbake: en brannmur eller et sikkerhetsapparat kaster pakker, eller verten kan ikke nås. |
| `TlsHandshake` | TCP koblet til, TLS ble aldri ferdig. Som regel en mellomboks som inspiserer TLS. |
| `RequestSend` | Tilkoblet, men forespørselen ble aldri skrevet helt: den andre siden sluttet å lese. |
| `WaitingForServerResponse` | Forespørselen ble levert, og serveren sendte ingenting tilbake. **Sondens nettverk er i orden**: sjekk OneUptime-serveren, lastbalansereren og reverse proxyen. |
| `ResponseBody` | Serveren begynte å svare og stoppet opp underveis. |

Den samme blokken rapporterer også `deadlineOverrunInMs`. Tok en frist på 45000ms mye lenger enn 45000ms i virkelig tid, var selve sondeprosessen blokkert: sjekk `probeProcess.eventLoopMaxDriftInMs` i blokken før du undersøker nettverket.

#### Les tilkoblingens selvtest

Etter tre feil på rad tester sonden den samme serveren ett lag om gangen (DNS, så TCP, så TLS, så en ekte HTTP-rundtur) og logger hvert trinn med tiden det tok. Det første trinnet som feiler, er svaret ditt. Når en proxy er konfigurert, tester sonden strekningen til proxyen, for det er den eneste strekningen den faktisk gjør. Testen kjører høyst én gang hvert femte minutt.

#### Følg med på trege forespørsler før de feiler

Forespørsler som lykkes, men tar lengre tid enn `PROBE_API_SLOW_REQUEST_THRESHOLD_IN_MS`, logges med tiden de brukte. En sonde som begynner å logge forespørsler på 20 sekunder, er på vei til å passere fristen på 45 sekunder.
:::

På OneUptime-serverens side logges også en sondeforespørsel som besvares tregt, eller som sonden ga opp før et svar ble sendt, med sondens id. Disse to loggene til sammen forteller hvilken side av tilkoblingen feilen ligger på.

### Andre problemer

:::details Sonden stopper rett etter at den starter
Loggen dens nevner hva som mangler: `PROBE_KEY is not set`, `PROBE_INGEST_URL or ONEUPTIME_URL is not set` eller `PROBE_ID or REGISTER_PROBE_KEY should be set`. Er alle tre satt, men ID og nøkkel passer ikke til noen sonde, prøver sonden 10 ganger med 30 sekunders mellomrom og stopper så med `Unable to register probe after 10 attempts`. Kopier ID og nøkkel på nytt med **Vis ID og nøkkel**.
:::

:::details Sonden fungerte til noen tilbakestilte nøkkelen
**Tilbakestill sondenøkkel** på sondens side lager en ny nøkkel, og den gamle slutter straks å virke. Kopier den nye nøkkelen med **Vis ID og nøkkel**, sett den som `PROBE_KEY` og start sonden på nytt.
:::

:::details En overvåker sier at den ikke når en privat adresse
Sonder avviser private adresser til du tillater dem. Sett `PROBE_ALLOW_PRIVATE_NETWORK_MONITORS=true` på sonden og start den på nytt: se [Tilgang til privat nettverk](/docs/self-hosted/private-network-access).
:::

Har du fortsatt problemer, oppretter du en sak på [GitHub](https://github.com/oneuptime/oneuptime) eller [kontakter kundestøtte](https://oneuptime.com/support).

## Neste steg

:::cards
- [Opprett en monitor](/docs/monitor/create-monitor): Velg hva som skal sjekkes, og hvilke sonder som sjekker det.
- [Inngangsport for innkommende forespørsler](/docs/probe/incoming-request-ingress): La tjenester uten internettilgang sende heartbeats gjennom sonden.
- [Pakkeopptak](/docs/probe/packet-capture): Ta opp trafikken sonden ser, fra dashbordet.
- [Tilgang til privat nettverk](/docs/self-hosted/private-network-access): La en sonde sjekke private adresser.
:::
