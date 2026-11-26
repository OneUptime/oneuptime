import { SetupGuideTranslation } from "../../../Components/SetupGuide/SetupGuideTranslation";

/*
 * The XcpNg setup guide in Dutch (#8341): each piece of the English
 * guide's markdown (Pages/XcpNg/Utils/DocumentationMarkdown.ts) and its
 * Dutch. Code, field names and product names are as the English writes
 * them, and what the Dashboard draws is named as its Dutch words it.
 * Change it with the English, in the same pull request
 * (SetupGuideDocumentationInLocale).
 */
const TRANSLATION: SetupGuideTranslation = {
  "Xen Orchestra 6.9 or later, connected to the pools you want to monitor. Its OpenMetrics plugin needs a Premium licence on an XOA; Xen Orchestra built from sources includes it":
    "Xen Orchestra 6.9 of nieuwer, verbonden met de pools die je wilt monitoren. De OpenMetrics-plug-in ervan vereist een Premium-licentie op een XOA; een Xen Orchestra die uit de broncode is gebouwd, bevat hem",
  "Docker Engine 20.10+ with the Docker Compose v2 plugin, on a machine that can reach Xen Orchestra over HTTPS":
    "Docker Engine 20.10 of nieuwer met de Docker Compose v2-plug-in, op een machine die Xen Orchestra via HTTPS kan bereiken",
  "A certificate on Xen Orchestra that names the address the agent connects to. The self-signed certificate Xen Orchestra makes for itself names none, so no current TLS client can check it — see **Xen Orchestra's certificate** under Advanced":
    "Een certificaat op Xen Orchestra dat het adres noemt waarmee de agent verbinding maakt. Het zelfondertekende certificaat dat Xen Orchestra voor zichzelf maakt, noemt er geen, dus geen enkele huidige TLS-client kan het controleren — zie **Certificaat van Xen Orchestra** onder Geavanceerd",
  "1. In Xen Orchestra, open *Settings → Plugins* and find **openmetrics**.":
    "1. Open in Xen Orchestra *Settings → Plugins* en zoek **openmetrics**.",
  "2. Turn it on. The first time it starts, it makes a secret and keeps it, and Xen Orchestra keeps it across restarts.":
    "2. Schakel hem in. De eerste keer dat hij start, maakt hij een geheim aan en bewaart het, en Xen Orchestra bewaart het over herstarts heen.",
  "3. Open the plugin's settings and copy its **Prometheus secret** — you give it to the agent in the next step. You can also type a secret of your own there and save it.":
    "3. Open de instellingen van de plug-in en kopieer zijn **Prometheus secret** — dat geef je in de volgende stap aan de agent. Je kunt daar ook een eigen geheim typen en opslaan.",
  "The plugin answers on Xen Orchestra's own address and certificate, at `/openmetrics/metrics`, and only to a request that carries its secret. It serves every pool Xen Orchestra is connected to, so one agent covers them all.":
    "De plug-in antwoordt op het eigen adres en met het eigen certificaat van Xen Orchestra, op `/openmetrics/metrics`, en alleen op een verzoek dat zijn geheim meestuurt. Hij levert elke pool waarmee Xen Orchestra verbonden is, dus één agent dekt ze allemaal.",
  "The script asks for your OneUptime URL and ingestion key, both shown in step 1 (pick a key there to have them filled in here), and then for:":
    "Het script vraagt om je OneUptime-URL en je ingestiesleutel, die allebei in stap 1 staan (kies daar een sleutel om ze hier ingevuld te krijgen), en daarna om:",
  "- **Xen Orchestra's address** — as you open it in a browser, e.g. `https://xo.example.com` or `https://10.0.0.5:8443`.":
    "- **Adres van Xen Orchestra** — zoals je het in een browser opent, bijv. `https://xo.example.com` of `https://10.0.0.5:8443`.",
  "- **The OpenMetrics plugin's secret** — from the previous step. It is not shown as you type it.":
    "- **Geheim van de OpenMetrics-plug-in** — uit de vorige stap. Het wordt niet getoond terwijl je het typt.",
  "- **What to call this Xen Orchestra** — the name each of its pools shows on its Settings. Press Enter to use its address.":
    "- **Hoe deze Xen Orchestra heet** — de naam die elk van zijn pools in zijn Instellingen toont. Druk op Enter om zijn adres te gebruiken.",
  "The script then reads Xen Orchestra's certificate. When this machine already trusts it, the agent trusts the same CA bundle. When it does not, the script shows the certificate's SHA-256 fingerprint: compare it with the one on Xen Orchestra's machine and answer **y** to trust that certificate and nothing else. It never turns the check off. It then asks the plugin for its metrics with the secret and says which pools Xen Orchestra reports, before it installs anything.":
    "Daarna leest het script het certificaat van Xen Orchestra. Vertrouwt deze machine het al, dan vertrouwt de agent dezelfde CA-bundel. Zo niet, dan toont het script de SHA-256-vingerafdruk van het certificaat: vergelijk die met die op de machine van Xen Orchestra en antwoord **y** om dat certificaat en niets anders te vertrouwen. Het zet de controle nooit uit. Vervolgens vraagt het de plug-in met het geheim om zijn metrieken en zegt het welke pools Xen Orchestra meldt, voordat het iets installeert.",
  "It installs to `/opt/oneuptime-xcp-ng-agent`, writes a `0600` `.env` file and starts the agent with Docker Compose. Running the script again reuses everything in that `.env` instead of asking again, so it is also how you upgrade.":
    "Het installeert naar `/opt/oneuptime-xcp-ng-agent`, schrijft een `.env`-bestand met `0600` en start de agent met Docker Compose. Het script opnieuw draaien hergebruikt alles in die `.env` in plaats van opnieuw te vragen, en zo upgrade je ook.",
  "`docker compose ps` lists `oneuptime-xcp-ng-agent`. In its logs, look for `Everything is ready. Begin running and processing data.` The agent reads Xen Orchestra every minute, and each pool it reports then appears in the **XCP-ng** section under the name Xen Orchestra gives it, with its hosts, VMs and storage.":
    "`docker compose ps` toont `oneuptime-xcp-ng-agent`. Zoek in zijn logboeken naar `Everything is ready. Begin running and processing data.` De agent leest Xen Orchestra elke minuut, en elke pool die hij meldt, verschijnt dan in het onderdeel **XCP-ng** onder de naam die Xen Orchestra hem geeft, met zijn hosts, VM's en opslag.",
  "The install script writes these to `/opt/oneuptime-xcp-ng-agent/.env`. After changing one, apply it with `docker compose up -d` in `/opt/oneuptime-xcp-ng-agent`.":
    "Het installatiescript schrijft deze naar `/opt/oneuptime-xcp-ng-agent/.env`. Pas na een wijziging de waarde toe met `docker compose up -d` in `/opt/oneuptime-xcp-ng-agent`.",
  "| Variable | Required | Description |":
    "| Variabele | Verplicht | Beschrijving |",
  "| `ONEUPTIME_URL` | Yes | Your OneUptime instance URL (e.g. `<YOUR_ONEUPTIME_URL>`) |":
    "| `ONEUPTIME_URL` | Ja | De URL van je OneUptime-instantie (bijv. `<YOUR_ONEUPTIME_URL>`) |",
  "| `ONEUPTIME_TELEMETRY_INGESTION_KEY` | Yes | Telemetry ingestion key — the one picked in step 1 |":
    "| `ONEUPTIME_TELEMETRY_INGESTION_KEY` | Ja | De telemetrie-ingestiesleutel, die je in stap 1 hebt gekozen |",
  "| `XO_ADDRESS` | Yes | Xen Orchestra's `host` or `host:port`, without a scheme |":
    "| `XO_ADDRESS` | Ja | De `host` of `host:port` van Xen Orchestra, zonder schema |",
  "| `XO_SCHEME` | No | `https` (default). `http` only in a lab: the secret then crosses the network in clear |":
    "| `XO_SCHEME` | Nee | `https` (standaard). `http` alleen in een lab: het geheim gaat dan onversleuteld over het netwerk |",
  "| `XO_OPENMETRICS_SECRET` | Yes | The OpenMetrics plugin's secret, sent as a Bearer token. Every `$` in it is written as `$$` |":
    "| `XO_OPENMETRICS_SECRET` | Ja | Het geheim van de OpenMetrics-plug-in, verstuurd als Bearer-token. Elke `$` erin wordt als `$$` geschreven |",
  "| `XO_NAME` | No | What to call this Xen Orchestra in OneUptime, shown on each of its pools' Settings (default: its address) |":
    "| `XO_NAME` | Nee | Hoe deze Xen Orchestra in OneUptime heet, getoond in de Instellingen van elk van zijn pools (standaard: zijn adres) |",
  "| `XO_TLS_SERVER_NAME` | No | The name Xen Orchestra's certificate is checked against, when `XO_ADDRESS` is an address the certificate does not list |":
    "| `XO_TLS_SERVER_NAME` | Nee | De naam waartegen het certificaat van Xen Orchestra wordt gecontroleerd, wanneer `XO_ADDRESS` een adres is dat het certificaat niet noemt |",
  "| `XO_URL` | Install script | Xen Orchestra's address as typed; the script derives `XO_SCHEME` and `XO_ADDRESS` from it |":
    "| `XO_URL` | Installatiescript | Het adres van Xen Orchestra zoals ingetypt; het script leidt er `XO_SCHEME` en `XO_ADDRESS` van af |",
  "| `XO_TLS_FINGERPRINT` | Install script | The SHA-256 fingerprint of Xen Orchestra's own certificate, when the agent trusts that certificate and nothing else |":
    "| `XO_TLS_FINGERPRINT` | Installatiescript | De SHA-256-vingerafdruk van het eigen certificaat van Xen Orchestra, wanneer de agent dat certificaat en niets anders vertrouwt |",
  "| `XO_CA_FILE` | Install script | A CA bundle that issued Xen Orchestra's certificate, which the script copies to `xo-ca.pem` |":
    "| `XO_CA_FILE` | Installatiescript | Een CA-bundel die het certificaat van Xen Orchestra heeft uitgegeven en die het script naar `xo-ca.pem` kopieert |",
  "The agent checks Xen Orchestra's certificate against `xo-ca.pem`, next to `docker-compose.yml`.":
    "De agent controleert het certificaat van Xen Orchestra tegen `xo-ca.pem`, naast `docker-compose.yml`.",
  "The agent checks Xen Orchestra's certificate on every read, against `xo-ca.pem` and nothing else. That file holds one of three things:":
    "De agent controleert het certificaat van Xen Orchestra bij elke leesbeurt, tegen `xo-ca.pem` en niets anders. Dat bestand bevat een van drie dingen:",
  "- **Xen Orchestra's own certificate**, pinned by its SHA-256 fingerprint (`XO_TLS_FINGERPRINT`): the agent trusts that certificate and no other.":
    "- **Het eigen certificaat van Xen Orchestra**, vastgepind via zijn SHA-256-vingerafdruk (`XO_TLS_FINGERPRINT`): de agent vertrouwt dat certificaat en geen ander.",
  "- **The CA that issued it** (`XO_CA_FILE`), for a certificate from a CA of your own.":
    "- **De CA die het heeft uitgegeven** (`XO_CA_FILE`), voor een certificaat van een eigen CA.",
  "- **This machine's CA bundle**, for a certificate this machine already trusts.":
    "- **De CA-bundel van deze machine**, voor een certificaat dat deze machine al vertrouwt.",
  "Either way, the certificate must name the address the agent connects to: the agent checks the names a certificate is issued to, as every current TLS client does, and not its subject. The self-signed certificate Xen Orchestra makes for itself names none, so the agent cannot trust it, pinned or not, and fails with `x509: certificate is not valid for any names`. Give Xen Orchestra a certificate that names its address — from your CA, or a self-signed one with a subject alternative name — as [Xen Orchestra's certificate](/docs/telemetry/xcp-ng#xen-orchestras-certificate) shows.":
    "Hoe dan ook moet het certificaat het adres noemen waarmee de agent verbinding maakt: de agent controleert de namen waarvoor een certificaat is uitgegeven, zoals elke huidige TLS-client doet, en niet het onderwerp ervan. Het zelfondertekende certificaat dat Xen Orchestra voor zichzelf maakt, noemt er geen, dus de agent kan het niet vertrouwen, vastgepind of niet, en faalt met `x509: certificate is not valid for any names`. Geef Xen Orchestra een certificaat dat zijn adres noemt — van je CA, of een zelfondertekend certificaat met een alternatieve onderwerpnaam (subject alternative name) —, zoals [Het certificaat van Xen Orchestra](/docs/telemetry/xcp-ng#xen-orchestras-certificate) laat zien.",
  "When the certificate names Xen Orchestra by another name than the address in `XO_ADDRESS`, set `XO_TLS_SERVER_NAME` to that name. When a pinned certificate is renewed, the agent stops reading Xen Orchestra until it trusts the new one. Run the install script again: it shows the new fingerprint and stops, changing nothing. Check that fingerprint on Xen Orchestra's machine, then run the script once more with it: `XO_TLS_FINGERPRINT=<new fingerprint> bash install.sh`.":
    "Noemt het certificaat Xen Orchestra bij een andere naam dan het adres in `XO_ADDRESS`, zet `XO_TLS_SERVER_NAME` dan op die naam. Wordt een vastgepind certificaat vernieuwd, dan stopt de agent met het lezen van Xen Orchestra tot hij het nieuwe vertrouwt. Draai het installatiescript opnieuw: het toont de nieuwe vingerafdruk en stopt, zonder iets te wijzigen. Controleer die vingerafdruk op de machine van Xen Orchestra en draai het script daarna nog een keer ermee: `XO_TLS_FINGERPRINT=<new fingerprint> bash install.sh`.",
  "Every minute the agent reads the plugin, which reads each host's XAPI round-robin databases at 60-second resolution. It keeps the `xcp_*` series, and moves each series' pool to the batch it sends, as `xcp_ng.pool.id` (the pool's UUID, which never changes) and `xcp_ng.pool.name`:":
    "Elke minuut leest de agent de plug-in, die via XAPI de round-robin-databases van elke host leest met een resolutie van 60 seconden. Hij houdt de reeksen `xcp_*` en verplaatst de pool van elke reeks naar de batch die hij verstuurt, als `xcp_ng.pool.id` (de UUID van de pool, die nooit verandert) en `xcp_ng.pool.name`:",
  "| Category | Series |": "| Categorie | Reeksen |",
  "| **Pool** | `xcp_pool_connected` — present while Xen Orchestra is connected to the pool |":
    "| **Pool** | `xcp_pool_connected` — aanwezig zolang Xen Orchestra met de pool verbonden is |",
  "| **Hosts** | `xcp_host_status` (power state and whether it is enabled), `xcp_host_uptime_seconds`, `xcp_host_cpu_average`, `xcp_host_load_average`, `xcp_host_memory_*`, `xcp_host_running_vcpus`, `xcp_host_network_*` per interface, `xcp_host_disk_*` per storage repository |":
    "| **Hosts** | `xcp_host_status` (energiestatus en of hij ingeschakeld is), `xcp_host_uptime_seconds`, `xcp_host_cpu_average`, `xcp_host_load_average`, `xcp_host_memory_*`, `xcp_host_running_vcpus`, `xcp_host_network_*` per interface, `xcp_host_disk_*` per opslagrepository |",
  "| **VMs** | `xcp_vm_status`, `xcp_vm_uptime_seconds`, `xcp_vm_cpu_usage`, `xcp_vm_runstate_*` (CPU contention), `xcp_vm_memory_*`, `xcp_vm_network_*` per interface, `xcp_vm_disk_*` per disk, `xcp_vm_power_consumption_watts` |":
    "| **VM's** | `xcp_vm_status`, `xcp_vm_uptime_seconds`, `xcp_vm_cpu_usage`, `xcp_vm_runstate_*` (CPU-concurrentie), `xcp_vm_memory_*`, `xcp_vm_network_*` per interface, `xcp_vm_disk_*` per schijf, `xcp_vm_power_consumption_watts` |",
  "| **Storage** | `xcp_sr_physical_size_bytes`, `xcp_sr_physical_usage_bytes`, `xcp_sr_virtual_size_bytes`, `xcp_vdi_virtual_size_bytes`, `xcp_vdi_physical_usage_bytes` |":
    "| **Opslag** | `xcp_sr_physical_size_bytes`, `xcp_sr_physical_usage_bytes`, `xcp_sr_virtual_size_bytes`, `xcp_vdi_virtual_size_bytes`, `xcp_vdi_physical_usage_bytes` |",
  "| **XOSTOR** | `xcp_xostor_*`, on pools that run XOSTOR |":
    "| **XOSTOR** | `xcp_xostor_*`, op pools die XOSTOR draaien |",
  'Control domains report as VMs with `is_control_domain="true"`; the pages hide them unless you ask for them.':
    "Controledomeinen melden zich als VM's met `is_control_domain=\"true\"`; de pagina's verbergen ze, tenzij je erom vraagt.",
  "Xen Orchestra types eight throughput series as counters, though each holds XAPI's per-second rate: `xcp_host_network_receive_bytes_total`, `xcp_host_network_transmit_bytes_total`, and the VM network, network error and disk read and write series. The agent turns them into gauges with their values untouched, so OneUptime stores them as the rates they are, in bytes or errors per second.":
    "Xen Orchestra typeert acht doorvoerreeksen als tellers, hoewel elk de snelheid per seconde van XAPI bevat: `xcp_host_network_receive_bytes_total`, `xcp_host_network_transmit_bytes_total`, en de reeksen voor netwerk, netwerkfouten en lezen en schrijven op schijf van de VM's. De agent maakt er gauges van met ongewijzigde waarden, zodat OneUptime ze opslaat als de snelheden die ze zijn, in bytes of fouten per seconde.",
  "OneUptime adds four 0/1 series for each pool, which the alert templates read: `xcp_ng.host.running`, `xcp_ng.host.enabled`, `xcp_ng.vm.running` and `xcp_ng.vm.stopped_after_running` (a VM halted or paused that ran in the last day). It also stamps every point with `xcp_ng.scope` (`pool`, `host`, `vm`, `sr`, `vdi` or `xostor`) and `xcp_ng.id` (that object's UUID), which monitors and dashboards filter on.":
    "OneUptime voegt voor elke pool vier 0/1-reeksen toe, die de waarschuwingssjablonen lezen: `xcp_ng.host.running`, `xcp_ng.host.enabled`, `xcp_ng.vm.running` en `xcp_ng.vm.stopped_after_running` (een gestopte of gepauzeerde VM die de afgelopen dag draaide). Ook voorziet het elk punt van `xcp_ng.scope` (`pool`, `host`, `vm`, `sr`, `vdi` of `xostor`) en `xcp_ng.id` (de UUID van dat object), waarop monitoren en dashboards filteren.",
  "Not kept: Xen Orchestra's own process series (`xo_*`), which belong to no pool, and a host's power read over IPMI, which the plugin sends without its pool. Each VM's estimated share of it is kept.":
    "Niet bewaard: de eigen procesreeksen van Xen Orchestra (`xo_*`), die bij geen enkele pool horen, en het via IPMI gelezen vermogen van een host, dat de plug-in zonder zijn pool verstuurt. Het geschatte aandeel van elke VM daarin wordt wel bewaard.",
  "One agent reads one Xen Orchestra and every pool it manages. For a second Xen Orchestra, install a second agent in a folder of its own, with its own `container_name` in its `docker-compose.yml`:":
    "Eén agent leest één Xen Orchestra en elke pool die die beheert. Installeer voor een tweede Xen Orchestra een tweede agent in een eigen map, met een eigen `container_name` in zijn `docker-compose.yml`:",
  "Don't let two Xen Orchestras that manage the same pool both be read: the pool is one pool in OneUptime, by its UUID, and would be reported twice.":
    "Laat geen twee Xen Orchestra's lezen die dezelfde pool beheren: de pool is in OneUptime één pool, via zijn UUID, en zou dubbel worden gemeld.",
  "Any resource attribute prefixed with `oneuptime.label.` becomes a project label on each pool the agent reads: `oneuptime.label.<dimension>=<value>` is the label `<dimension>:<value>`. Add them to the `resource` processor in `otel-collector-config.yaml`, next to `oneuptime.agent.version`:":
    "Elk resourceattribuut met het voorvoegsel `oneuptime.label.` wordt een projectlabel op elke pool die de agent leest: `oneuptime.label.<dimension>=<value>` is het label `<dimension>:<value>`. Voeg ze toe aan de processor `resource` in `otel-collector-config.yaml`, naast `oneuptime.agent.version`:",
  "Then restart the collector so it reads the new config:":
    "Herstart daarna de collector zodat hij de nieuwe configuratie leest:",
  "The pools show up tagged `team:platform` and `env:production`. Labels are matched case-insensitively, so an existing `Production` label is reused; labels added in the OneUptime UI are never removed by the agent. Running the install script again replaces an edited `otel-collector-config.yaml` and keeps yours next to it as `otel-collector-config.yaml.bak.<timestamp>`.":
    "De pools verschijnen met de labels `team:platform` en `env:production`. Labels worden hoofdletterongevoelig vergeleken, dus een bestaand label `Production` wordt hergebruikt; labels die in de OneUptime-interface zijn toegevoegd, verwijdert de agent nooit. Het installatiescript opnieuw draaien vervangt een bewerkte `otel-collector-config.yaml` en bewaart die van jou ernaast als `otel-collector-config.yaml.bak.<timestamp>`.",
  "**Upgrade** — the collector image is pinned in `docker-compose.yml` and its config is a file beside it, so pulling alone does not move the agent forward. Run the install script again. It reuses every value in your existing `.env` (nothing is asked again), checks Xen Orchestra's certificate the same way, downloads the latest `docker-compose.yml` and `otel-collector-config.yaml` — a file you edited is kept next to the new one as `<file>.bak.<timestamp>` — pulls the image and recreates the agent with it:":
    "**Upgraden** — de collectorimage staat vast in `docker-compose.yml` en zijn configuratie is een bestand ernaast, dus alleen ophalen brengt de agent niet verder. Draai het installatiescript opnieuw. Het hergebruikt elke waarde in je bestaande `.env` (er wordt niets opnieuw gevraagd), controleert het certificaat van Xen Orchestra op dezelfde manier, downloadt de nieuwste `docker-compose.yml` en `otel-collector-config.yaml` — een bestand dat je hebt bewerkt, blijft naast het nieuwe staan als `<file>.bak.<timestamp>` —, haalt de image op en maakt de agent er opnieuw mee aan:",
  "The config reports the collector version it pins as each pool's **Agent Version**. When this OneUptime pins a newer one, a warning sign beside it opens these commands.":
    "De configuratie meldt de collectorversie die ze vastzet als de **Agentversie** van elke pool. Zet deze OneUptime een nieuwere vast, dan opent een waarschuwingsteken ernaast deze opdrachten.",
  "**Uninstall** the agent:": "**Verwijder** de agent:",
  "Then turn off the OpenMetrics plugin in Xen Orchestra if nothing else reads it.":
    "Schakel daarna de OpenMetrics-plug-in in Xen Orchestra uit als niets anders hem leest.",
  "`troubleshoot.sh` checks the whole chain — the container, Xen Orchestra's certificate against `xo-ca.pem`, the plugin and its secret, the pools it reports — and asks OneUptime directly whether it accepts your ingestion key. That last check matters most: OneUptime's OTLP endpoints refuse a bad key with `401` or `422`, which the collector logs as a single `Exporting failed` line per batch that is easy to miss.":
    "`troubleshoot.sh` controleert de hele keten — de container, het certificaat van Xen Orchestra tegen `xo-ca.pem`, de plug-in en zijn geheim, de pools die hij meldt — en vraagt OneUptime rechtstreeks of hij je ingestiesleutel accepteert. Die laatste controle telt het zwaarst: de OTLP-endpoints van OneUptime weigeren een verkeerde sleutel met `401` of `422`, wat de collector logt als één `Exporting failed`-regel per batch die makkelijk over het hoofd wordt gezien.",
  "It ends with a verdict naming the most likely cause. It never prints the secret.":
    "Het eindigt met een oordeel dat de waarschijnlijkste oorzaak noemt. Het geheim drukt het nooit af.",
  "OneUptime marks a pool Disconnected when nothing has been read for it for 15 minutes.":
    "OneUptime markeert een pool als “Verbinding verbroken” wanneer er 15 minuten lang niets voor is gelezen.",
  "1. If every pool of this Xen Orchestra is Disconnected, check the agent (in `/opt/oneuptime-xcp-ng-agent`): `docker compose ps` and `docker compose logs oneuptime-xcp-ng-agent | grep -i error`.":
    "1. Staan alle pools van deze Xen Orchestra op “Verbinding verbroken”, controleer dan de agent (in `/opt/oneuptime-xcp-ng-agent`): `docker compose ps` en `docker compose logs oneuptime-xcp-ng-agent | grep -i error`.",
  "2. If only one is, Xen Orchestra stopped reporting it: under *Settings → Servers* in Xen Orchestra, the pool's server must be connected. The pool's hosts, VMs and storage stay as Xen Orchestra last reported them.":
    "2. Is het er maar één, dan is Xen Orchestra gestopt met het melden ervan: onder *Settings → Servers* in Xen Orchestra moet de server van de pool verbonden zijn. De hosts, VM's en opslag van de pool blijven zoals Xen Orchestra ze het laatst meldde.",
  "The collector logs `server returned HTTP status 401 Unauthorized`. Copy the secret again from *Settings → Plugins → openmetrics*, set `XO_OPENMETRICS_SECRET` to it in `.env` — between single quotes, every `$` written as `$$` — and apply it with `docker compose up -d` in `/opt/oneuptime-xcp-ng-agent`. Before 6.8, Xen Orchestra made a new secret each time it restarted.":
    "De collector logt `server returned HTTP status 401 Unauthorized`. Kopieer het geheim opnieuw uit *Settings → Plugins → openmetrics*, zet `XO_OPENMETRICS_SECRET` er in `.env` op — tussen enkele aanhalingstekens, elke `$` geschreven als `$$` — en pas het toe met `docker compose up -d` in `/opt/oneuptime-xcp-ng-agent`. Vóór 6.8 maakte Xen Orchestra bij elke herstart een nieuw geheim aan.",
  'Xen Orchestra answers, but its OpenMetrics plugin does not. Turn the plugin on under *Settings → Plugins → openmetrics* (an XOA needs a Premium licence for it), and check that Xen Orchestra is 6.9 or later. `/openmetrics/health` answers `{"status":"ok"}` without a secret while the plugin runs.':
    'Xen Orchestra antwoordt, maar zijn OpenMetrics-plug-in niet. Schakel de plug-in in onder *Settings → Plugins → openmetrics* (een XOA heeft er een Premium-licentie voor nodig), en controleer dat Xen Orchestra 6.9 of nieuwer is. `/openmetrics/health` antwoordt zonder geheim met `{"status":"ok"}` zolang de plug-in draait.',
  "- `x509: certificate is not valid for any names` — the certificate names no address, as Xen Orchestra's own self-signed one does. Give Xen Orchestra a certificate that names its address.":
    "- `x509: certificate is not valid for any names` — het certificaat noemt geen adres, zoals het eigen zelfondertekende certificaat van Xen Orchestra. Geef Xen Orchestra een certificaat dat zijn adres noemt.",
  "- `x509: certificate is valid for <names>, not <address>` — connect to one of those names, or set `XO_TLS_SERVER_NAME` to one.":
    "- `x509: certificate is valid for <names>, not <address>` — maak verbinding met een van die namen, of zet `XO_TLS_SERVER_NAME` op een ervan.",
  "- `x509: certificate signed by unknown authority` — `xo-ca.pem` does not hold this certificate or the CA that issued it. The certificate was renewed, or the file holds the wrong one: write it again, as **Xen Orchestra's certificate** under Advanced says.":
    "- `x509: certificate signed by unknown authority` — `xo-ca.pem` bevat dit certificaat niet, en ook niet de CA die het heeft uitgegeven. Het certificaat is vernieuwd, of het bestand bevat het verkeerde: schrijf het opnieuw, zoals **Certificaat van Xen Orchestra** onder Geavanceerd beschrijft.",
  "Xen Orchestra reports only the pools it is connected to, and the agent reads only that Xen Orchestra. Connect the pool's server under *Settings → Servers* in Xen Orchestra; the pool appears in OneUptime with the next read. A pool read by another Xen Orchestra needs an agent beside that one.":
    "Xen Orchestra meldt alleen de pools waarmee het verbonden is, en de agent leest alleen die Xen Orchestra. Verbind de server van de pool onder *Settings → Servers* in Xen Orchestra; de pool verschijnt bij de volgende leesbeurt in OneUptime. Een pool die een andere Xen Orchestra leest, heeft een eigen agent nodig, naast die andere Xen Orchestra.",
  "- **What to call this Xen Orchestra** — the command already names it **`xo-paris`**, as this pool's Settings show it.":
    "- **Hoe deze Xen Orchestra heet** — de opdracht noemt hem al **`xo-paris`**, zoals de Instellingen van deze pool hem tonen.",
  "The command already carries your OneUptime URL and ingestion key. The script asks for the rest:":
    "De opdracht bevat al je OneUptime-URL en ingestiesleutel. Naar de rest vraagt het script:",
  "Download `docker-compose.yml` and `otel-collector-config.yaml` from this OneUptime into a new folder:":
    "Download `docker-compose.yml` en `otel-collector-config.yaml` van deze OneUptime naar een nieuwe map:",
  "Create a `.env` file next to them — it holds the plugin's secret, so keep it private with `chmod 600 .env`:":
    "Maak ernaast een `.env`-bestand aan; het bevat het geheim van de plug-in, dus houd het privé met `chmod 600 .env`:",
  "- Set `XO_ADDRESS` to Xen Orchestra's `host` or `host:port`, without `https://`.":
    "- Zet `XO_ADDRESS` op de `host` of `host:port` van Xen Orchestra, zonder `https://`.",
  "- Put the plugin's secret between single quotes. If it holds a `$`, write each one as `$$`: the collector reads the value once more.":
    "- Zet het geheim van de plug-in tussen enkele aanhalingstekens. Bevat het een `$`, schrijf elke dan als `$$`: de collector leest de waarde nog een keer.",
  "- `XO_NAME` is what each pool's Settings call this Xen Orchestra.":
    "- `XO_NAME` is hoe de Instellingen van elke pool deze Xen Orchestra noemen.",
  "Then give the agent Xen Orchestra's certificate, as `xo-ca.pem` next to `docker-compose.yml` — the agent checks Xen Orchestra against this file and nothing else. To trust Xen Orchestra's own certificate, read it and check its fingerprint against the one on Xen Orchestra's machine:":
    "Geef de agent daarna het certificaat van Xen Orchestra, als `xo-ca.pem` naast `docker-compose.yml` — de agent controleert Xen Orchestra tegen dit bestand en niets anders. Om het eigen certificaat van Xen Orchestra te vertrouwen, lees je het en controleer je de vingerafdruk tegen die op de machine van Xen Orchestra:",
  "When a CA of your own issued it, copy that CA's certificate to `xo-ca.pem` instead; when a public CA did, copy this machine's CA bundle (`cp /etc/ssl/certs/ca-certificates.crt xo-ca.pem`).":
    "Heeft een eigen CA het uitgegeven, kopieer dan in plaats daarvan het certificaat van die CA naar `xo-ca.pem`; deed een publieke CA dat, kopieer dan de CA-bundel van deze machine (`cp /etc/ssl/certs/ca-certificates.crt xo-ca.pem`).",
  "Start the agent:": "Start de agent:",
  "Pick an ingestion key in step 1 to fill in `<YOUR_API_KEY>`.":
    "Kies in stap 1 een ingestiesleutel om `<YOUR_API_KEY>` in te vullen.",
  "The agent reads these from the `.env` file next to `docker-compose.yml`. After changing one, apply it with `docker compose up -d` in the folder with `docker-compose.yml`.":
    "De agent leest deze uit het `.env`-bestand naast `docker-compose.yml`. Pas na een wijziging de waarde toe met `docker compose up -d` in de map met `docker-compose.yml`.",
  "When the certificate names Xen Orchestra by another name than the address in `XO_ADDRESS`, set `XO_TLS_SERVER_NAME` to that name. When the certificate in `xo-ca.pem` is renewed, read it again as in step 3, then run `docker compose up -d --force-recreate`.":
    "Noemt het certificaat Xen Orchestra bij een andere naam dan het adres in `XO_ADDRESS`, zet `XO_TLS_SERVER_NAME` dan op die naam. Wordt het certificaat in `xo-ca.pem` vernieuwd, lees het dan opnieuw zoals in stap 3 en voer daarna `docker compose up -d --force-recreate` uit.",
  "Run these in the agent's folder, the one with `docker-compose.yml`.":
    "Voer deze uit in de map van de agent, die met `docker-compose.yml`.",
  "**Upgrade** — the collector image is pinned in `docker-compose.yml` and its config is a file beside it, so pulling alone does not move the agent forward. Download both files again; your `.env` and `xo-ca.pem` stay, and a change you made to either file has to be made again:":
    "**Upgraden** — de collectorimage staat vast in `docker-compose.yml` en zijn configuratie is een bestand ernaast, dus alleen ophalen brengt de agent niet verder. Download beide bestanden opnieuw; je `.env` en `xo-ca.pem` blijven, en een wijziging die je in een van de bestanden had gemaakt, moet je opnieuw maken:",
  "Then pull the image and recreate the agent, so the collector reads its new config:":
    "Haal daarna de image op en maak de agent opnieuw aan, zodat de collector zijn nieuwe configuratie leest:",
  "1. If every pool of this Xen Orchestra is Disconnected, check the agent (in the agent's folder): `docker compose ps` and `docker compose logs oneuptime-xcp-ng-agent | grep -i error`.":
    "1. Staan alle pools van deze Xen Orchestra op “Verbinding verbroken”, controleer dan de agent (in de map van de agent): `docker compose ps` en `docker compose logs oneuptime-xcp-ng-agent | grep -i error`.",
  "The collector logs `server returned HTTP status 401 Unauthorized`. Copy the secret again from *Settings → Plugins → openmetrics*, set `XO_OPENMETRICS_SECRET` to it in `.env` — between single quotes, every `$` written as `$$` — and apply it with `docker compose up -d` in the folder with `docker-compose.yml`. Before 6.8, Xen Orchestra made a new secret each time it restarted.":
    "De collector logt `server returned HTTP status 401 Unauthorized`. Kopieer het geheim opnieuw uit *Settings → Plugins → openmetrics*, zet `XO_OPENMETRICS_SECRET` er in `.env` op — tussen enkele aanhalingstekens, elke `$` geschreven als `$$` — en pas het toe met `docker compose up -d` in de map met `docker-compose.yml`. Vóór 6.8 maakte Xen Orchestra bij elke herstart een nieuw geheim aan.",
};

export default TRANSLATION;
