import { SetupGuideTranslation } from "../../../Components/SetupGuide/SetupGuideTranslation";

/*
 * The StorageArray setup guide in Dutch (#8341): each piece of the English
 * guide's markdown (Pages/StorageArray/Utils/DocumentationMarkdown.ts) and its
 * Dutch. Code, field names and product names are as the English writes
 * them, and what the Dashboard draws is named as its Dutch words it.
 * Change it with the English, in the same pull request
 * (SetupGuideDocumentationInLocale).
 */
const TRANSLATION: SetupGuideTranslation = {
  "Docker Engine 20.10+ with the Docker Compose v2 plugin, on a machine that can reach the FlashArray's management address over HTTPS (TCP 443)":
    "Docker Engine 20.10 of nieuwer met de plugin Docker Compose v2, op een machine die het beheeradres van de FlashArray via HTTPS (TCP 443) kan bereiken",
  "An administrator account on the FlashArray, to create the agent's read-only user":
    "Een beheerdersaccount op de FlashArray, om de alleen-lezen-gebruiker van de agent aan te maken",
  "Create the token **without an expiry**, or the agent stops the day it expires.":
    "Maak het token **zonder vervaldatum** aan, anders stopt de agent op de dag dat het verloopt.",
  "SSH to the FlashArray as an administrator. The first command asks for the new user's password; the second prints its API token:":
    "Maak als beheerder via SSH verbinding met de FlashArray. De eerste opdracht vraagt om het wachtwoord van de nieuwe gebruiker; de tweede toont zijn API-token:",
  "1. Open **Settings → Users and Policies** (**Settings → Access** on older releases).":
    "1. Open **Settings → Users and Policies** (**Settings → Access** in oudere releases).",
  "2. From the ⋮ menu of the **Users** panel choose **Create User…**, name it `oneuptime` and give it the **readonly** role.":
    "2. Kies in het ⋮-menu van het paneel **Users** de optie **Create User…**, noem de gebruiker `oneuptime` en geef hem de rol **readonly**.",
  "3. From the new user's ⋮ menu choose **Create API Token…**, leave **Expires In** empty, and copy the token.":
    "3. Kies in het ⋮-menu van de nieuwe gebruiker **Create API Token…**, laat **Expires In** leeg en kopieer het token.",
  "A `purefa_info{...} 1` line means the array serves its metrics natively: carry on. A **404** means its Purity//FA is older (Pure documents the native endpoint for 6.7.0 and later; its exporter's deprecation notice says 6.6.11 and later) — pick **FlashArray, older Purity** at the top of this guide instead.":
    "Een regel `purefa_info{...} 1` betekent dat de array zijn metrieken native levert: ga verder. Een **404** betekent dat zijn Purity//FA ouder is (Pure documenteert het native endpoint voor 6.7.0 en nieuwer; de uitfaseringsmelding van zijn exporter noemt 6.6.11 en nieuwer): kies dan bovenaan deze handleiding **FlashArray, oudere Purity**.",
  "The first line downloads the script as `install.sh`, so you can read it before you run it.":
    "De eerste regel downloadt het script als `install.sh`, zodat je het kunt lezen voordat je het uitvoert.",
  "The command carries the platform you picked above. The script asks for:":
    "De opdracht bevat het platform dat je hierboven hebt gekozen. Het script vraagt om:",
  "- your **OneUptime URL** and **ingestion key**, both shown in step 1 (pick a key there to have them filled in here)":
    "- je **OneUptime-URL** en **ingestiesleutel**, die allebei in stap 1 staan (kies daar een sleutel om ze hier ingevuld te krijgen)",
  "- an **array name** — how the array appears in OneUptime. Give every array its own and keep it stable: a new name registers a new storage array":
    "- een **arraynaam**: hoe de array in OneUptime verschijnt. Geef elke array een eigen naam en houd hem stabiel: een nieuwe naam registreert een nieuwe opslagarray",
  "- the FlashArray's **management address** (host name or IP, no `https://`) and the read-only user's **API token**, which it reads without echoing":
    "- het **beheeradres** van de FlashArray (hostnaam of IP, zonder `https://`) en het **API-token** van de alleen-lezen-gebruiker, dat het inleest zonder het te tonen",
  "- whether to verify the array's certificate — answer **N** unless the array carries a certificate from a CA you trust (arrays ship a self-signed one)":
    "- of het certificaat van de array moet worden gecontroleerd: antwoord **N**, tenzij de array een certificaat heeft van een CA die je vertrouwt (arrays worden geleverd met een zelfondertekend certificaat)",
  "It installs to `/opt/oneuptime-storage-array-agent`, writes a `.env` file only you can read (it holds the API token) and starts the agent with Docker Compose.":
    "Het installeert in `/opt/oneuptime-storage-array-agent`, schrijft een `.env`-bestand dat alleen jij kunt lezen (het bevat het API-token) en start de agent met Docker Compose.",
  "Download the compose file and the three collector configs from this OneUptime into a new folder:":
    "Download het compose-bestand en de drie collectorconfiguraties van deze OneUptime naar een nieuwe map:",
  "Create a `.env` file next to them:": "Maak er een `.env`-bestand naast:",
  "- Replace `my-storage-array` with a name for this array, such as `fa-prod-01`. It is how the array appears in OneUptime, so keep it stable: a new name registers a new storage array.":
    "- Vervang `my-storage-array` door een naam voor deze array, zoals `fa-prod-01`. Onder die naam verschijnt de array in OneUptime, dus houd hem stabiel: een nieuwe naam registreert een nieuwe opslagarray.",
  "- Set `PURE_FA_ENDPOINT` to the FlashArray's management address — host name or IP, no `https://` — and `PURE_FA_API_TOKEN` to the read-only user's API token. Run `chmod 600 .env`: it holds the token.":
    "- Zet `PURE_FA_ENDPOINT` op het beheeradres van de FlashArray (hostnaam of IP, zonder `https://`) en `PURE_FA_API_TOKEN` op het API-token van de alleen-lezen-gebruiker. Voer `chmod 600 .env` uit: het bestand bevat het token.",
  "Start the agent:": "Start de agent:",
  "Pick an ingestion key in step 1 to fill in `<YOUR_API_KEY>`.":
    "Kies in stap 1 een ingestiesleutel om `<YOUR_API_KEY>` in te vullen.",
  "Look for `Everything is ready. Begin running and processing data.` in the logs. The array then appears automatically in the **Storage Arrays** section after its first scrape, usually within a minute or two.":
    "Zoek naar `Everything is ready. Begin running and processing data.` in de logboeken. De array verschijnt dan na zijn eerste uitlezing automatisch in het onderdeel **Opslagarrays**, meestal binnen een minuut of twee.",
  "The install script writes these to `/opt/oneuptime-storage-array-agent/.env`; a Docker Compose install reads them from the `.env` file next to `docker-compose.yml`. After changing one, apply it with `docker compose up -d` in the agent's folder.":
    "Het installatiescript schrijft deze naar `/opt/oneuptime-storage-array-agent/.env`; een installatie met Docker Compose leest ze uit het `.env`-bestand naast `docker-compose.yml`. Pas na een wijziging de waarde toe met `docker compose up -d` in de map van de agent.",
  "| Variable | Required | Description |":
    "| Variabele | Verplicht | Beschrijving |",
  "| `ONEUPTIME_URL` | Yes | Your OneUptime instance URL (e.g. `<YOUR_ONEUPTIME_URL>`) |":
    "| `ONEUPTIME_URL` | Ja | De URL van je OneUptime-instantie (bijv. `<YOUR_ONEUPTIME_URL>`) |",
  "| `ONEUPTIME_TELEMETRY_INGESTION_KEY` | Yes | Telemetry ingestion key — the one picked in step 1 |":
    "| `ONEUPTIME_TELEMETRY_INGESTION_KEY` | Ja | De telemetrie-ingestiesleutel, die je in stap 1 hebt gekozen |",
  "| `STORAGE_ARRAY_NAME` | Yes | The name this array registers under in OneUptime. Stamped on every metric as the `storage.array.name` resource attribute. Keep it stable — changing it registers a new storage array |":
    "| `STORAGE_ARRAY_NAME` | Ja | De naam waaronder deze array zich in OneUptime registreert. Op elke metriek gezet als het resourceattribuut `storage.array.name`. Houd hem stabiel: wijzigen registreert een nieuwe opslagarray |",
  "| `STORAGE_SYSTEM` | No | The platform, stamped as the `storage.system` resource attribute: `purestorage.flasharray` or `purestorage.flashblade` (default: `purestorage.flasharray`) |":
    "| `STORAGE_SYSTEM` | Nee | Het platform, gezet als het resourceattribuut `storage.system`: `purestorage.flasharray` of `purestorage.flashblade` (standaard: `purestorage.flasharray`) |",
  "| `STORAGE_ARRAY_COLLECTOR_CONFIG` | No | Which shipped config runs: `otel-collector-config.yaml` (FlashArray, native — the default), `otel-collector-config.flasharray-exporter.yaml` (older FlashArray) or `otel-collector-config.flashblade.yaml` (FlashBlade) |":
    "| `STORAGE_ARRAY_COLLECTOR_CONFIG` | Nee | Welke meegeleverde configuratie draait: `otel-collector-config.yaml` (FlashArray, native; de standaard), `otel-collector-config.flasharray-exporter.yaml` (oudere FlashArray) of `otel-collector-config.flashblade.yaml` (FlashBlade) |",
  "| `COMPOSE_PROFILES` | No | Starts the exporter the config needs: empty for the native FlashArray config, `flasharray-exporter` or `flashblade` for the others |":
    "| `COMPOSE_PROFILES` | Nee | Start de exporter die de configuratie nodig heeft: leeg voor de native FlashArray-configuratie, `flasharray-exporter` of `flashblade` voor de andere |",
  "| `PURE_FA_ENDPOINT` | FlashArray | The FlashArray's management address — host name or IP, no `https://` |":
    "| `PURE_FA_ENDPOINT` | FlashArray | Het beheeradres van de FlashArray: hostnaam of IP, zonder `https://` |",
  "| `PURE_FA_API_TOKEN` | FlashArray | API token of the FlashArray user with the readonly role |":
    "| `PURE_FA_API_TOKEN` | FlashArray | Het API-token van de FlashArray-gebruiker met de rol readonly |",
  "| `PURE_FB_ENDPOINT` | FlashBlade | The FlashBlade's management address — host name or IP, no `https://` |":
    "| `PURE_FB_ENDPOINT` | FlashBlade | Het beheeradres van de FlashBlade: hostnaam of IP, zonder `https://` |",
  "| `PURE_FB_API_TOKEN` | FlashBlade | API token of the FlashBlade user with the readonly role |":
    "| `PURE_FB_API_TOKEN` | FlashBlade | Het API-token van de FlashBlade-gebruiker met de rol readonly |",
  "| `STORAGE_ARRAY_INSECURE_SKIP_VERIFY` | No | `true` accepts the array's self-signed certificate on the native endpoint; `false` verifies it (default: `true`). Pure's exporters never verify the array's certificate, so it does not apply to them |":
    "| `STORAGE_ARRAY_INSECURE_SKIP_VERIFY` | Nee | `true` accepteert het zelfondertekende certificaat van de array op het native endpoint; `false` controleert het (standaard: `true`). De exporters van Pure controleren het certificaat van de array nooit, dus voor hen geldt dit niet |",
  "| `STORAGE_ARRAY_AGENT_CONTAINER_NAME` | No | The agent's container name (default: `oneuptime-storage-array-agent`). A second array's agent on the same machine needs one of its own: the install script names a new agent after its folder unless you set it, and keeps it when you run the script again |":
    "| `STORAGE_ARRAY_AGENT_CONTAINER_NAME` | Nee | De containernaam van de agent (standaard: `oneuptime-storage-array-agent`). De agent van een tweede array op dezelfde machine heeft een eigen naam nodig: het installatiescript noemt een nieuwe agent naar zijn map, tenzij je hem instelt, en behoudt hem wanneer je het script opnieuw draait |",
  "- The collector reads the FlashArray's own OpenMetrics endpoint over HTTPS with the token as a Bearer credential — no exporter runs.":
    "- De collector leest het eigen OpenMetrics-endpoint van de FlashArray via HTTPS, met het token als Bearer-referentie: er draait geen exporter.",
  "- **One scrape job per endpoint**, each read as often as it is worth: `/metrics/array` every 60 seconds; `/metrics/volumes`, `/metrics/hosts` and `/metrics/pods` every 2 minutes; `/metrics/directories` every 30 minutes — directory space is expensive for the array to compute.":
    "- **Eén uitleesjob per endpoint**, elk zo vaak gelezen als het waard is: `/metrics/array` elke 60 seconden; `/metrics/volumes`, `/metrics/hosts` en `/metrics/pods` elke 2 minuten; `/metrics/directories` elke 30 minuten, want de ruimte van mappen berekenen is duur voor de array.",
  "- **Every job labels its series `scrape_endpoint: <endpoint>`**, so OneUptime knows which objects a batch is the complete list of — that is how a deleted object leaves the inventory. Keep the labels as shipped.":
    "- **Elke job labelt zijn reeksen met `scrape_endpoint: <endpoint>`**, zodat OneUptime weet van welke objecten een batch de volledige lijst is: zo verdwijnt een verwijderd object uit de inventaris. Laat de labels zoals ze worden geleverd.",
  "- **Per-volume and per-host latency keeps three dimensions** (`usec_per_read_op`, `usec_per_write_op`, `usec_per_mirrored_write_op`); a `metric_relabel_configs` rule drops the QoS, queue, SAN and service-time breakdown, which multiplies the series count of a large array. The array-wide breakdown is kept.":
    "- **De latentie per volume en per host houdt drie dimensies** (`usec_per_read_op`, `usec_per_write_op`, `usec_per_mirrored_write_op`); een regel in `metric_relabel_configs` laat de uitsplitsing naar QoS, wachtrij, SAN en servicetijd vallen, die het aantal reeksen van een grote array vermenigvuldigt. De uitsplitsing voor de hele array blijft behouden.",
  "- **No `send_batch_max_size`.** OneUptime rebuilds the inventory from one whole scrape, so the `batch` processor never splits one.":
    "- **Geen `send_batch_max_size`.** OneUptime bouwt de inventaris opnieuw op uit één volledige uitlezing, dus de processor `batch` splitst er nooit een.",
  "This is the full `otel-collector-config.yaml` the agent runs; the `.env` file supplies the `${env:...}` values:":
    "Dit is de volledige `otel-collector-config.yaml` die de agent draait; het `.env`-bestand levert de waarden `${env:...}`:",
  "The agent ships metrics only until you turn on its syslog receivers. Arrays forward their alerts and audit events as syslog; the agent stamps `storage.array.name` on every line, so they land on this array's **Logs** page.":
    "De agent stuurt alleen metrieken totdat je zijn syslog-receivers inschakelt. Arrays sturen hun waarschuwingen en auditgebeurtenissen door als syslog; de agent zet `storage.array.name` op elke regel, zodat ze op de pagina **Logboeken** van deze array terechtkomen.",
  "1. In `otel-collector-config.yaml`, uncomment the `syslog/tcp` and `syslog/udp` receivers and the `logs` pipeline. Classic BSD syslog timestamps carry no time zone: set `location` to the array's time zone unless its clock runs on UTC.":
    "1. Haal in `otel-collector-config.yaml` het commentaar weg bij de receivers `syslog/tcp` en `syslog/udp` en de pipeline `logs`. Klassieke BSD-syslogtijdstempels bevatten geen tijdzone: zet `location` op de tijdzone van de array, tenzij zijn klok op UTC loopt.",
  "2. In `docker-compose.yml`, uncomment the `ports:` block that publishes `5514/tcp` and `5514/udp`, and open the port on the machine's firewall for the array's management network.":
    "2. Haal in `docker-compose.yml` het commentaar weg bij het blok `ports:` dat `5514/tcp` en `5514/udp` publiceert, en open de poort in de firewall van de machine voor het beheernetwerk van de array.",
  "3. Apply both:": "3. Pas beide toe:",
  "4. On the FlashArray, as an administrator, open **Settings → System → Syslog Servers**, add `udp://<agent-host>:5514` (or `tcp://<agent-host>:5514`) and send a test message.":
    "4. Open op de FlashArray als beheerder **Settings → System → Syslog Servers**, voeg `udp://<agent-host>:5514` (of `tcp://<agent-host>:5514`) toe en stuur een testbericht.",
  "Any resource attribute prefixed with `oneuptime.label.` becomes a project label on the array: `oneuptime.label.<dimension>=<value>` is the label `<dimension>:<value>`. Add them to the `resource` processor of the collector config you use, next to `storage.array.name`:":
    "Elk resourceattribuut met het voorvoegsel `oneuptime.label.` wordt een projectlabel op de array: `oneuptime.label.<dimension>=<value>` is het label `<dimension>:<value>`. Voeg ze toe aan de processor `resource` van de collectorconfiguratie die je gebruikt, naast `storage.array.name`:",
  "Then restart the collector so it reads the new config:":
    "Herstart daarna de collector zodat hij de nieuwe configuratie leest:",
  "The array shows up tagged `team:storage` and `env:production`. Labels are matched case-insensitively, so an existing `Production` label is reused; labels added in the OneUptime UI are never removed by the agent.":
    "De array verschijnt met de labels `team:storage` en `env:production`. Labels worden hoofdletterongevoelig vergeleken, dus een bestaand label `Production` wordt hergebruikt; labels die in de OneUptime-interface zijn toegevoegd, verwijdert de agent nooit.",
  "Every value is a gauge the FlashArray computes itself — latency per operation in microseconds, throughput per second. OneUptime's Storage Array pages, metric catalog and alert templates are built on:":
    "Elke waarde is een gauge die de FlashArray zelf berekent: latentie per bewerking in microseconden, doorvoer per seconde. De opslagarraypagina's, de metriekcatalogus en de waarschuwingssjablonen van OneUptime zijn gebaseerd op:",
  "| Endpoint | Data |": "| Endpoint | Gegevens |",
  "| **Array** (`/metrics/array`) | `purefa_info`, capacity and data reduction (`purefa_array_space_*`), performance, open alerts (`purefa_alerts_open`), hardware components, drives, controllers and network interfaces |":
    "| **Array** (`/metrics/array`) | `purefa_info`, capaciteit en gegevensreductie (`purefa_array_space_*`), prestaties, open waarschuwingen (`purefa_alerts_open`), hardwarecomponenten, schijven, controllers en netwerkinterfaces |",
  "| **Volumes** (`/metrics/volumes`) | Latency, IOPS, bandwidth, space and data reduction per volume |":
    "| **Volumes** (`/metrics/volumes`) | Latentie, IOPS, bandbreedte, ruimte en gegevensreductie per volume |",
  "| **Hosts** (`/metrics/hosts`) | Connectivity, connected volumes, latency, IOPS and space per host |":
    "| **Hosts** (`/metrics/hosts`) | Connectiviteit, verbonden volumes, latentie, IOPS en ruimte per host |",
  "| **Pods** (`/metrics/pods`) | ActiveCluster and ActiveDR replica link lag, mediator status, performance and space |":
    "| **Pods** (`/metrics/pods`) | Vertraging van de replicalinks van ActiveCluster en ActiveDR, status van de mediator, prestaties en ruimte |",
  "| **Directories** (`/metrics/directories`) | Space and performance of FlashArray file services' managed directories |":
    "| **Mappen** (`/metrics/directories`) | Ruimte en prestaties van de beheerde mappen van de bestandsservices van de FlashArray |",
  "One agent reads one array. To monitor several from the same machine, install each into its own folder with its own `.env` and its own container name — two containers cannot share one:":
    "Eén agent leest één array. Om er meerdere vanaf dezelfde machine te bewaken, installeer je elke agent in een eigen map met een eigen `.env` en een eigen containernaam, want twee containers kunnen geen naam delen:",
  "Without `STORAGE_ARRAY_AGENT_CONTAINER_NAME`, the script names the container after the folder. It keeps the name in that agent's `.env`, so running the script again to upgrade the agent keeps it, and an agent whose `container_name` you once edited in `docker-compose.yml` keeps that name. With Docker Compose, set `STORAGE_ARRAY_AGENT_CONTAINER_NAME` in each agent's `.env` instead.":
    "Zonder `STORAGE_ARRAY_AGENT_CONTAINER_NAME` noemt het script de container naar de map. Het bewaart de naam in de `.env` van die agent, dus als je het script opnieuw draait om de agent te upgraden, blijft de naam behouden, en een agent waarvan je de `container_name` ooit in `docker-compose.yml` hebt bewerkt, behoudt die naam. Stel met Docker Compose in plaats daarvan `STORAGE_ARRAY_AGENT_CONTAINER_NAME` in de `.env` van elke agent in.",
  "The agent ships a systemd unit that assumes the install script's folder, `/opt/oneuptime-storage-array-agent`. The install script does not download it, so fetch it:":
    "De agent levert een systemd-unit mee die uitgaat van de map van het installatiescript, `/opt/oneuptime-storage-array-agent`. Het installatiescript downloadt hem niet, dus haal hem zelf op:",
  "**Upgrade** — the collector image is pinned in `docker-compose.yml` and its configs are files beside it, so pulling alone does not move the agent forward. Re-run the install script. It reuses every value in your existing `.env` (nothing is prompted for again), downloads the latest `docker-compose.yml` and collector configs — a file you edited is kept next to the new one as `<file>.bak.<timestamp>` — and recreates the agent with them:":
    "**Upgraden**: de collectorimage staat vast in `docker-compose.yml` en zijn configuraties zijn bestanden ernaast, dus alleen ophalen brengt de agent niet verder. Draai het installatiescript opnieuw. Het hergebruikt elke waarde in je bestaande `.env` (er wordt niets opnieuw gevraagd), downloadt de nieuwste `docker-compose.yml` en collectorconfiguraties (een bestand dat je hebt bewerkt, blijft naast het nieuwe staan als `<file>.bak.<timestamp>`) en maakt de agent er opnieuw mee aan:",
  "An agent installed outside `/opt/oneuptime-storage-array-agent` (a second array's, say) needs its folder: `INSTALL_DIR=<folder> bash install.sh`.":
    "Een agent die buiten `/opt/oneuptime-storage-array-agent` is geïnstalleerd (die van een tweede array, bijvoorbeeld), heeft zijn map nodig: `INSTALL_DIR=<folder> bash install.sh`.",
  "Installed it with Docker Compose instead? In the agent's folder, download the compose file and the three collector configs again; your `.env` stays, and a change you made to any of them has to be made again:":
    "Toch met Docker Compose geïnstalleerd? Download in de map van de agent opnieuw het compose-bestand en de drie collectorconfiguraties; je `.env` blijft staan, en een wijziging die je in een ervan had gemaakt, moet je opnieuw maken:",
  "Then pull the images and recreate the agent, so the collector reads its new config:":
    "Haal daarna de images op en maak de agent opnieuw aan, zodat de collector zijn nieuwe configuratie leest:",
  "The config reports the collector version it pins as the array's **Agent Version**. When this OneUptime pins a newer one, a warning sign beside it opens these commands.":
    "De configuratie meldt de collectorversie die ze vastzet als de **Agentversie** van de array. Zet deze OneUptime een nieuwere vast, dan opent een waarschuwingsteken ernaast deze opdrachten.",
  "**Uninstall** the agent:": "**Verwijder** de agent:",
  "Then delete the read-only user and its API token on the array if you no longer need them.":
    "Verwijder daarna de alleen-lezen-gebruiker en zijn API-token op de array als je ze niet meer nodig hebt.",
  "`troubleshoot.sh` checks the whole chain — container runtime, the array endpoint exactly as the collector reaches it (the native endpoint or Pure's exporter, DNS, TLS, the API token), array-name stamping, collector self-metrics — and asks OneUptime directly whether it accepts your ingestion key. That last check matters most: OneUptime's OTLP endpoints refuse a bad key with `401` or `422`, which the collector logs as a single `Exporting failed` line per batch that is easy to miss, so the script asks `GET /otlp/v1/validate` for a direct 200/401 verdict.":
    "`troubleshoot.sh` controleert de hele keten (containerruntime, het array-endpoint precies zoals de collector het bereikt, dus het native endpoint of de exporter van Pure, met DNS, TLS en het API-token, het zetten van de arraynaam, de eigen metrieken van de collector) en vraagt OneUptime rechtstreeks of het je ingestiesleutel accepteert. Die laatste controle telt het zwaarst: de OTLP-endpoints van OneUptime weigeren een verkeerde sleutel met `401` of `422`, wat de collector per batch logt als één makkelijk te missen regel `Exporting failed`; daarom vraagt het script `GET /otlp/v1/validate` om een direct oordeel 200/401.",
  "It ends with a verdict naming the most likely cause.":
    "Het eindigt met een oordeel dat de waarschijnlijkste oorzaak noemt.",
  "1. Check the collector logs: `docker logs oneuptime-storage-array-agent`. `server returned HTTP status 401` means the array refused the API token, `404` means the FlashArray has no native endpoint, `x509` means TLS verification is on against the array's self-signed certificate, `no such host` or `connection refused` means a wrong `PURE_FA_ENDPOINT`, and an export `401` means a bad ingestion key.":
    "1. Controleer de logboeken van de collector: `docker logs oneuptime-storage-array-agent`. `server returned HTTP status 401` betekent dat de array het API-token heeft geweigerd, `404` dat de FlashArray geen native endpoint heeft, `x509` dat TLS-verificatie aanstaat tegenover het zelfondertekende certificaat van de array, `no such host` of `connection refused` een verkeerde `PURE_FA_ENDPOINT`, en een `401` bij het exporteren een verkeerde ingestiesleutel.",
  "2. Make sure `STORAGE_ARRAY_NAME` is set — discovery keys on the `storage.array.name` resource attribute, and the collector refuses to start without it.":
    "2. Zorg dat `STORAGE_ARRAY_NAME` is ingesteld: de detectie gaat uit van het resourceattribuut `storage.array.name`, en zonder dat weigert de collector te starten.",
  "3. Make sure `STORAGE_ARRAY_COLLECTOR_CONFIG` and `COMPOSE_PROFILES` name the same platform.":
    "3. Zorg dat `STORAGE_ARRAY_COLLECTOR_CONFIG` en `COMPOSE_PROFILES` hetzelfde platform noemen.",
  "Its Purity//FA has no native OpenMetrics endpoint. Set `STORAGE_ARRAY_COLLECTOR_CONFIG=otel-collector-config.flasharray-exporter.yaml` and `COMPOSE_PROFILES=flasharray-exporter` in `.env` and run `docker compose up -d` — or re-run `install.sh` with the older-Purity choice. After upgrading the array to Purity//FA 6.7 or later, switch back to the native config and drop the profile.":
    "Zijn Purity//FA heeft geen native OpenMetrics-endpoint. Zet `STORAGE_ARRAY_COLLECTOR_CONFIG=otel-collector-config.flasharray-exporter.yaml` en `COMPOSE_PROFILES=flasharray-exporter` in `.env` en voer `docker compose up -d` uit, of voer `install.sh` opnieuw uit met de keuze voor een oudere Purity. Schakel na het upgraden van de array naar Purity//FA 6.7 of nieuwer terug naar de native configuratie en laat het profiel weg.",
  "Check that you pasted the token, not the user's password; that the user still exists and holds the readonly role; and that the token has not expired. Create a new token (`pureadmin create --api-token oneuptime` on a FlashArray), put it in `.env` as `PURE_FA_API_TOKEN` and run `docker compose up -d`.":
    "Controleer of je het token hebt geplakt en niet het wachtwoord van de gebruiker, of de gebruiker nog bestaat en de rol readonly heeft, en of het token niet is verlopen. Maak een nieuw token (`pureadmin create --api-token oneuptime` op een FlashArray), zet het in `.env` als `PURE_FA_API_TOKEN` en voer `docker compose up -d` uit.",
  "Arrays present a self-signed certificate by default, which no Docker image trusts. Set `STORAGE_ARRAY_INSECURE_SKIP_VERIFY=true` (the pragmatic choice on a private management network), or install a certificate on the array from a CA the collector image trusts.":
    "Arrays tonen standaard een zelfondertekend certificaat, dat geen enkele Docker-image vertrouwt. Zet `STORAGE_ARRAY_INSECURE_SKIP_VERIFY=true` (de pragmatische keuze op een privé-beheernetwerk), of installeer op de array een certificaat van een CA die de collectorimage vertrouwt.",
  "`pure-fa-exporter` or `pure-fb-exporter` is not running: `COMPOSE_PROFILES` must match `STORAGE_ARRAY_COLLECTOR_CONFIG` — `flasharray-exporter` for the FlashArray exporter config, `flashblade` for the FlashBlade config. Fix `.env` and run `docker compose up -d`; `docker compose ps` then lists the exporter.":
    "`pure-fa-exporter` of `pure-fb-exporter` draait niet: `COMPOSE_PROFILES` moet passen bij `STORAGE_ARRAY_COLLECTOR_CONFIG`, dus `flasharray-exporter` voor de configuratie met de FlashArray-exporter en `flashblade` voor de FlashBlade-configuratie. Corrigeer `.env` en voer `docker compose up -d` uit; `docker compose ps` toont dan de exporter.",
  "1. Check that the agent is running: `docker ps --filter name=oneuptime-storage-array-agent`":
    "1. Controleer of de agent draait: `docker ps --filter name=oneuptime-storage-array-agent`",
  "2. Check the agent logs for errors: `docker logs oneuptime-storage-array-agent 2>&1 | grep -i error`":
    "2. Controleer de logboeken van de agent op fouten: `docker logs oneuptime-storage-array-agent 2>&1 | grep -i error`",
  "3. Verify your OneUptime URL and ingestion key are correct.":
    "3. Controleer of je OneUptime-URL en ingestiesleutel kloppen.",
  "4. Ensure the agent machine can reach the OneUptime instance over the network.":
    "4. Zorg dat de machine van de agent de OneUptime-instantie via het netwerk kan bereiken.",
  "The array's identity comes from `STORAGE_ARRAY_NAME`, stamped on every metric as `storage.array.name`. Fix it in `.env` and apply it with `docker compose up -d` in the agent's folder — note that a new name registers a new storage array.":
    "De identiteit van de array komt uit `STORAGE_ARRAY_NAME`, op elke metriek gezet als `storage.array.name`. Corrigeer hem in `.env` en pas hem toe met `docker compose up -d` in de map van de agent; let op: een nieuwe naam registreert een nieuwe opslagarray.",
  "It registers the array as **`array-1`** — the name this array already has in OneUptime.":
    "Het registreert de array als **`array-1`**, de naam die deze array al in OneUptime heeft.",
  "- This installs the agent for **`array-1`** — keep `STORAGE_ARRAY_NAME` exactly as it is, or the data registers as a new storage array.":
    "- Dit installeert de agent voor **`array-1`**: laat `STORAGE_ARRAY_NAME` precies zoals het is, anders worden de gegevens als een nieuwe opslagarray geregistreerd.",
  "The array's identity comes from `STORAGE_ARRAY_NAME`, stamped on every metric as `storage.array.name`. This array is **`array-1`**. Fix it in `.env` and apply it with `docker compose up -d` in the agent's folder — note that a new name registers a new storage array.":
    "De identiteit van de array komt uit `STORAGE_ARRAY_NAME`, op elke metriek gezet als `storage.array.name`. Deze array is **`array-1`**. Corrigeer hem in `.env` en pas hem toe met `docker compose up -d` in de map van de agent; let op: een nieuwe naam registreert een nieuwe opslagarray.",
  "The command already carries your OneUptime URL, ingestion key and the platform you picked above. The script asks for:":
    "De opdracht bevat al je OneUptime-URL, je ingestiesleutel en het platform dat je hierboven hebt gekozen. Het script vraagt om:",
  "Access from that machine to `quay.io`, where Docker pulls Pure's exporter image":
    "Toegang vanaf die machine tot `quay.io`, waar Docker de exporter-image van Pure ophaalt",
  "- `COMPOSE_PROFILES=flasharray-exporter` starts `pure-fa-exporter`, Pure's exporter, next to the collector; the two must match.":
    "- `COMPOSE_PROFILES=flasharray-exporter` start `pure-fa-exporter`, de exporter van Pure, naast de collector; die twee moeten bij elkaar passen.",
  "`docker compose ps` in the agent's folder also lists **`pure-fa-exporter`**, Pure's exporter, which the collector reads the FlashArray through.":
    "`docker compose ps` in de map van de agent toont ook **`pure-fa-exporter`**, de exporter van Pure, waarlangs de collector de FlashArray leest.",
  "- The collector reads the FlashArray through `pure-fa-exporter`, Pure's exporter, which logs in to the FlashArray's REST API with the token the collector sends on every scrape. The exporter's port stays on the compose network.":
    "- De collector leest de FlashArray via `pure-fa-exporter`, de exporter van Pure, die zich bij de REST-API van de FlashArray aanmeldt met het token dat de collector bij elke uitlezing meestuurt. De poort van de exporter blijft op het compose-netwerk.",
  "Docker Engine 20.10+ with the Docker Compose v2 plugin, on a machine that can reach the FlashBlade's management address over HTTPS (TCP 443)":
    "Docker Engine 20.10 of nieuwer met de plugin Docker Compose v2, op een machine die het beheeradres van de FlashBlade via HTTPS (TCP 443) kan bereiken",
  "An administrator account on the FlashBlade, to create the agent's read-only user":
    "Een beheerdersaccount op de FlashBlade, om de alleen-lezen-gebruiker van de agent aan te maken",
  "On the FlashBlade, as an administrator, create a user named `oneuptime` with the **readonly** role — in the FlashBlade GUI's user settings, or with `pureadmin` in the Purity//FB CLI — and create an **API token** for it. Create the token **without an expiry**, or the agent stops the day it expires.":
    "Maak op de FlashBlade als beheerder een gebruiker met de naam `oneuptime` en de rol **readonly** aan (in de gebruikersinstellingen van de FlashBlade-GUI of met `pureadmin` in de Purity//FB-CLI) en maak er een **API-token** voor aan. Maak het token **zonder vervaldatum** aan, anders stopt de agent op de dag dat het verloopt.",
  "FlashBlade API tokens start with `T-`. A Purity//FB release without local users takes a directory service (LDAP or Active Directory) account whose group maps to the readonly role instead.":
    "API-tokens van de FlashBlade beginnen met `T-`. Een Purity//FB-release zonder lokale gebruikers gebruikt in plaats daarvan een account van een directoryservice (LDAP of Active Directory) waarvan de groep aan de rol readonly is gekoppeld.",
  "- the FlashBlade's **management address** (host name or IP, no `https://`) and the read-only user's **API token**, which it reads without echoing":
    "- het **beheeradres** van de FlashBlade (hostnaam of IP, zonder `https://`) en het **API-token** van de alleen-lezen-gebruiker, dat het inleest zonder het te tonen",
  "- Set `PURE_FB_ENDPOINT` to the FlashBlade's management address — host name or IP, no `https://` — and `PURE_FB_API_TOKEN` to the read-only user's API token. Run `chmod 600 .env`: it holds the token.":
    "- Zet `PURE_FB_ENDPOINT` op het beheeradres van de FlashBlade (hostnaam of IP, zonder `https://`) en `PURE_FB_API_TOKEN` op het API-token van de alleen-lezen-gebruiker. Voer `chmod 600 .env` uit: het bestand bevat het token.",
  "`docker compose ps` in the agent's folder also lists **`pure-fb-exporter`**, Pure's exporter, which the collector reads the FlashBlade through.":
    "`docker compose ps` in de map van de agent toont ook **`pure-fb-exporter`**, de exporter van Pure, waarlangs de collector de FlashBlade leest.",
  "- The collector reads the FlashBlade through `pure-fb-exporter`, Pure's exporter, which logs in to the FlashBlade's REST API with the token the collector sends on every scrape. The exporter's port stays on the compose network.":
    "- De collector leest de FlashBlade via `pure-fb-exporter`, de exporter van Pure, die zich bij de REST-API van de FlashBlade aanmeldt met het token dat de collector bij elke uitlezing meestuurt. De poort van de exporter blijft op het compose-netwerk.",
  "- **One scrape job per endpoint**, each read as often as it is worth: `/metrics/array` every 60 seconds; `/metrics/filesystems` and `/metrics/objectstore` every 5 minutes — the FlashBlade REST API is not built to report every file system and bucket quickly.":
    "- **Eén uitleesjob per endpoint**, elk zo vaak gelezen als het waard is: `/metrics/array` elke 60 seconden; `/metrics/filesystems` en `/metrics/objectstore` elke 5 minuten, want de REST-API van de FlashBlade is er niet op gebouwd om elk bestandssysteem en elke bucket snel te rapporteren.",
  "4. On the FlashBlade, as an administrator, add a syslog server `udp://<agent-host>:5514` (or `tcp://`) in its syslog settings.":
    "4. Voeg op de FlashBlade als beheerder in zijn syslog-instellingen een syslogserver `udp://<agent-host>:5514` (of `tcp://`) toe.",
  "Every value is a gauge the FlashBlade computes itself — latency per operation in microseconds, throughput per second. OneUptime's Storage Array pages, metric catalog and alert templates are built on:":
    "Elke waarde is een gauge die de FlashBlade zelf berekent: latentie per bewerking in microseconden, doorvoer per seconde. De opslagarraypagina's, de metriekcatalogus en de waarschuwingssjablonen van OneUptime zijn gebaseerd op:",
  "| **Array** (`/metrics/array`) | `purefb_info`, capacity and data reduction (`purefb_array_space_*`), performance per protocol, open alerts (`purefb_alerts_open`), hardware health (`purefb_hardware_health`) |":
    "| **Array** (`/metrics/array`) | `purefb_info`, capaciteit en gegevensreductie (`purefb_array_space_*`), prestaties per protocol, open waarschuwingen (`purefb_alerts_open`), hardwaregezondheid (`purefb_hardware_health`) |",
  "| **File systems** (`/metrics/filesystems`) | Space, data reduction and performance per file system |":
    "| **Bestandssystemen** (`/metrics/filesystems`) | Ruimte, gegevensreductie en prestaties per bestandssysteem |",
  "| **Object store** (`/metrics/objectstore`) | Space, quota, object counts and performance per bucket |":
    "| **Objectopslag** (`/metrics/objectstore`) | Ruimte, quotum, aantal objecten en prestaties per bucket |",
};

export default TRANSLATION;
