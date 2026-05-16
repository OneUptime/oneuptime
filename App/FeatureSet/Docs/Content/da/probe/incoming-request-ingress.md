# Indgående anmodnings-indgang

En brugerdefineret probe kan valgfrit køre en **indgående HTTP-lytter**, der accepterer `heartbeat`- og `incoming-request`-kald inde fra dit private netværk og videresender dem til OneUptime. Dette giver tjenester, der **ikke har udgående internetadgang**, mulighed for stadig at rapportere til en [Indgående Anmodningsmonitor](/docs/monitor/incoming-request-monitor) ved at sende anmodningen til en probe på det lokale netværk i stedet for direkte til `oneuptime.com`.

## Oversigt

Når `PROBE_INGRESS_PORT` er indstillet, binder proben en yderligere HTTP-lytter på den port. Lytteren accepterer de samme `secretkey`-URL-stier som de offentlige OneUptime-endpoints:

- `POST /heartbeat/:secretkey`
- `GET /heartbeat/:secretkey`
- `POST /incoming-request/:secretkey`
- `GET /incoming-request/:secretkey`

Proben proxyer derefter anmodningen til din OneUptime-instans og bevarer metoden, indholdet og anmodningsheaderne (minus hop-by-hop-headere som `Host`, `Connection`, `Content-Length` osv.). Proben vedhæfter automatisk en `OneUptime-Probe-Id`-header, så anmodningen tilskrives den videresendende probe.

Lytteren kører på en **dedikeret port**, adskilt fra probens interne status-/metrisk-endpoints, så du kan eksponere den til dit private netværk uden at eksponere noget andet.

## Hvornår skal du bruge dette

Brug indgangs-lytteren, når:

- Dine tjenester kører i et isoleret netværkssegment uden udgående HTTPS-adgang
- Du vil holde al overvågningstrafik inden for dit VPC/on-premises-netværk
- Du vil have et enkelt udgangspunkt – proben – der har adgang til OneUptime
- Du allerede har deployeret en [Brugerdefineret Probe](/docs/probe/custom-probe) og vil genbruge den til indgående hjerteslag

Hvis dine tjenester allerede kan nå `https://oneuptime.com` (eller din selvhostede URL) direkte, har du **ikke** brug for denne funktion – kald hjerteslag-URL'en direkte fra tjenesten.

## Aktivering af indgangs-lytteren

Sæt `PROBE_INGRESS_PORT` til den port, du vil binde lytteren til. Enhver værdi større end `0` aktiverer lytteren; at lade den stå uindstillet (eller `0`) deaktiverer den.

### Docker

```bash
docker run --name oneuptime-probe --network host \
  -e PROBE_KEY=<probe-key> \
  -e PROBE_ID=<probe-id> \
  -e ONEUPTIME_URL=https://oneuptime.com \
  -e PROBE_INGRESS_PORT=3875 \
  -d oneuptime/probe:release
```

Hvis du ikke bruger `--network host`, skal du eksplicit publicere indgangsporten:

```bash
docker run --name oneuptime-probe \
  -e PROBE_KEY=<probe-key> \
  -e PROBE_ID=<probe-id> \
  -e ONEUPTIME_URL=https://oneuptime.com \
  -e PROBE_INGRESS_PORT=3875 \
  -p 3875:3875 \
  -d oneuptime/probe:release
```

### Docker Compose

```yaml
version: "3"

services:
  oneuptime-probe:
    image: oneuptime/probe:release
    container_name: oneuptime-probe
    environment:
      - PROBE_KEY=<probe-key>
      - PROBE_ID=<probe-id>
      - ONEUPTIME_URL=https://oneuptime.com
      - PROBE_INGRESS_PORT=3875
    ports:
      - "3875:3875"
    restart: always
```

### Kubernetes

```yaml
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
            - name: PROBE_INGRESS_PORT
              value: "3875"
          ports:
            - name: ingress
              containerPort: 3875
---
apiVersion: v1
kind: Service
metadata:
  name: oneuptime-probe-ingress
spec:
  selector:
    app: oneuptime-probe
  ports:
    - name: ingress
      port: 3875
      targetPort: 3875
  type: ClusterIP
```

Interne tjenester kan derefter sende hjerteslag til `http://oneuptime-probe-ingress.<namespace>.svc.cluster.local:3875/heartbeat/<secret-key>`.

## Afsendelse af anmodninger til proben

Erstat den offentlige hjerteslag-URL:

```
https://oneuptime.com/heartbeat/<secret-key>
```

med probens indgangs-URL:

```
http://<probe-host>:<PROBE_INGRESS_PORT>/heartbeat/<secret-key>
```

Stien, metoden, indholdet og headerne er ellers identiske, så eventuel eksisterende klientkode kun behøver basis-URL'en ændret.

### Eksempler

```bash
# GET hjerteslag
curl http://probe.internal:3875/heartbeat/YOUR_SECRET_KEY

# POST hjerteslag med JSON-indhold
curl -X POST http://probe.internal:3875/heartbeat/YOUR_SECRET_KEY \
  -H "Content-Type: application/json" \
  -d '{"status": "healthy", "version": "1.2.3"}'

# Cron-job
*/5 * * * * curl -s http://probe.internal:3875/heartbeat/YOUR_SECRET_KEY > /dev/null
```

## Videresendelsesadfærd

- **Synkront svar, asynkron videresendelse.** Proben bekræfter den indgående anmodning øjeblikkeligt med en `200` og videresender til OneUptime i baggrunden. Din tjeneste behøver ikke vente på, at videresendelsen fuldføres.
- **Headere bevares.** Alle headere undtagen hop-by-hop-headere (`Host`, `Connection`, `Content-Length`, `Transfer-Encoding`, `Keep-Alive`, `Proxy-Authenticate`, `Proxy-Authorization`, `TE`, `Trailer`, `Upgrade`) sendes videre. Proben tilføjer en `OneUptime-Probe-Id`-header, der identificerer den.
- **Indhold bevares.** JSON-, URL-kodet og rå `application/octet-stream`-nyttelaster op til **50 MB** accepteres.
- **Genforsøg med backoff.** Hvis videresendelsen mislykkes, forsøger proben igen op til `PROBE_INGRESS_FORWARD_RETRY_LIMIT` gange med eksponentiel backoff (2 s, 4 s, 8 s, maks. 15 s).
- **Proxy-bevidst.** Hvis proben selv er konfigureret med `HTTP_PROXY_URL` / `HTTPS_PROXY_URL`, går videresendte anmodninger gennem proxyen.

## Miljøvariabler

| Variabel | Standard | Beskrivelse |
|---|---|---|
| `PROBE_INGRESS_PORT` | _uindstillet_ (deaktiveret) | Port, som den indgående lytter binder til. Enhver værdi `> 0` aktiverer indgang. |
| `PROBE_INGRESS_FORWARD_TIMEOUT_MS` | `10000` | Timeout (ms) for hvert videresendingsforsøg til OneUptime. Minimum `1000`. |
| `PROBE_INGRESS_FORWARD_RETRY_LIMIT` | `3` | Antal genforsøg, inden proben giver op på en videresendelse. Sæt til `0` for at deaktivere genforsøg. |

Standard probe-variabler (`PROBE_KEY`, `PROBE_ID`, `ONEUPTIME_URL`, proxyvariable) gælder alle – se [Brugerdefinerede prober](/docs/probe/custom-probe) for den fulde liste.

## Sikkerhedsovervejelser

- **Endpointet er uautentificeret af design** – den hemmelige nøgle i URL-stien *er* autentificeringen, ligesom det er på det offentlige `oneuptime.com`-endpoint. Behandl den hemmelige nøgle som et legitimationsoplysning.
- **Bind kun til en privat grænseflade.** Indgangs-lytteren bør ikke være tilgængelig fra det offentlige internet. Brug en netværkspolitik, firewallregel eller `ClusterIP`-service til at begrænse adgangen.
- **Brug HTTPS-terminering, hvis du kræver kryptering under overførslen.** Probens lytter taler alm. HTTP. Placer den bag en intern load balancer/ingress-controller, hvis du har brug for TLS på det indgående hop. Videresendelsesben fra probe → OneUptime bruger altid HTTPS (forudsat at `ONEUPTIME_URL` er `https://`).
- **Ressourcegrænser.** Lytteren accepterer anmodningsindhold op til 50 MB. Hvis du har brug for et strengere loft, skal du placere en reverse proxy foran.

## Fejlfinding

- **Probe logger `Probe ingress listener started on port <port>` ved start** – bekræfter, at lytteren er oppe. Hvis du ikke ser denne linje, er `PROBE_INGRESS_PORT` uindstillet, `0` eller ugyldig.
- **`Probe ingress: failed to forward to <url> after N attempts`** – proben kunne ikke nå OneUptime. Kontroller probens udgående forbindelsesmuligheder, proxyindstillinger og værdien af `ONEUPTIME_URL`.
- **`Probe ingress: probe ID not available, forwarding without it`** – proben har endnu ikke registreret sig. Videresendelsen lykkes stadig; hjerteslaget vil blot ikke blive tilskrevet en probe.
- **Hjerteslag vises i OneUptime, men ikke via proben** – bekræft, at din tjeneste rammer `http://<probe-host>:<port>/...` og ikke den offentlige URL. En fejlkonfigureret DNS eller `/etc/hosts`-post er den sædvanlige årsag.

## Relateret

- [Brugerdefinerede prober](/docs/probe/custom-probe)
- [Indgående Anmodningsmonitor](/docs/monitor/incoming-request-monitor)
