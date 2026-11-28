import { SetupGuideTranslation } from "../../../Components/SetupGuide/SetupGuideTranslation";

/*
 * The StorageArray setup guide in Norwegian (#8341): each piece of the English
 * guide's markdown (Pages/StorageArray/Utils/DocumentationMarkdown.ts) and its
 * Norwegian. Code, field names and product names are as the English writes
 * them, and what the Dashboard draws is named as its Norwegian words it.
 * Change it with the English, in the same pull request
 * (SetupGuideDocumentationInLocale).
 */
const TRANSLATION: SetupGuideTranslation = {
  "Docker Engine 20.10+ with the Docker Compose v2 plugin, on a machine that can reach the FlashArray's management address over HTTPS (TCP 443)":
    "Docker Engine 20.10 eller nyere med Docker Compose v2-tillegget, på en maskin som når administrasjonsadressen til FlashArray over HTTPS (TCP 443)",
  "An administrator account on the FlashArray, to create the agent's read-only user":
    "En administratorkonto på FlashArray, for å opprette agentens skrivebeskyttede bruker",
  "Create the token **without an expiry**, or the agent stops the day it expires.":
    "Opprett tokenet **uten utløpsdato**, ellers stopper agenten den dagen det utløper.",
  "SSH to the FlashArray as an administrator. The first command asks for the new user's password; the second prints its API token:":
    "Koble til FlashArray med SSH som administrator. Den første kommandoen spør etter passordet til den nye brukeren; den andre skriver ut API-tokenet til brukeren:",
  "1. Open **Settings → Users and Policies** (**Settings → Access** on older releases).":
    "1. Åpne **Settings → Users and Policies** (**Settings → Access** i eldre versjoner).",
  "2. From the ⋮ menu of the **Users** panel choose **Create User…**, name it `oneuptime` and give it the **readonly** role.":
    "2. Velg **Create User…** i ⋮-menyen i panelet **Users**, gi brukeren navnet `oneuptime`, og gi den rollen **readonly**.",
  "3. From the new user's ⋮ menu choose **Create API Token…**, leave **Expires In** empty, and copy the token.":
    "3. Velg **Create API Token…** i ⋮-menyen til den nye brukeren, la **Expires In** stå tomt, og kopier tokenet.",
  "A `purefa_info{...} 1` line means the array serves its metrics natively: carry on. A **404** means its Purity//FA is older (Pure documents the native endpoint for 6.7.0 and later; its exporter's deprecation notice says 6.6.11 and later) — pick **FlashArray, older Purity** at the top of this guide instead.":
    "En linje `purefa_info{...} 1` betyr at arrayet leverer målingene sine innebygd: fortsett. En **404** betyr at Purity//FA på arrayet er eldre (Pure dokumenterer det innebygde endepunktet for 6.7.0 og nyere; utfasingsmeldingen for eksportøren deres sier 6.6.11 og nyere): velg i stedet **FlashArray, eldre Purity** øverst i denne veiledningen.",
  "The first line downloads the script as `install.sh`, so you can read it before you run it.":
    "Den første linjen laster ned skriptet som `install.sh`, så du kan lese det før du kjører det.",
  "The command carries the platform you picked above. The script asks for:":
    "Kommandoen inneholder plattformen du valgte ovenfor. Skriptet spør etter:",
  "- your **OneUptime URL** and **ingestion key**, both shown in step 1 (pick a key there to have them filled in here)":
    "- **OneUptime-URL-en** og **inntaksnøkkelen** din, som begge vises i trinn 1 (velg en nøkkel der for å få dem fylt inn her)",
  "- an **array name** — how the array appears in OneUptime. Give every array its own and keep it stable: a new name registers a new storage array":
    "- et **arraynavn**: hvordan arrayet vises i OneUptime. Gi hvert array sitt eget, og hold det stabilt: et nytt navn registrerer et nytt lagringsarray",
  "- the FlashArray's **management address** (host name or IP, no `https://`) and the read-only user's **API token**, which it reads without echoing":
    "- **administrasjonsadressen** til FlashArray (vertsnavn eller IP, uten `https://`) og **API-tokenet** til den skrivebeskyttede brukeren, som det leser uten å vise det",
  "- whether to verify the array's certificate — answer **N** unless the array carries a certificate from a CA you trust (arrays ship a self-signed one)":
    "- om sertifikatet til arrayet skal verifiseres: svar **N**, med mindre arrayet har et sertifikat fra en CA du stoler på (arrayer leveres med et selvsignert)",
  "It installs to `/opt/oneuptime-storage-array-agent`, writes a `.env` file only you can read (it holds the API token) and starts the agent with Docker Compose.":
    "Det installerer i `/opt/oneuptime-storage-array-agent`, skriver en `.env`-fil som bare du kan lese (den inneholder API-tokenet), og starter agenten med Docker Compose.",
  "Download the compose file and the three collector configs from this OneUptime into a new folder:":
    "Last ned compose-filen og de tre innsamlerkonfigurasjonene fra denne OneUptime til en ny mappe:",
  "Create a `.env` file next to them:":
    "Opprett en `.env`-fil ved siden av dem:",
  "- Replace `my-storage-array` with a name for this array, such as `fa-prod-01`. It is how the array appears in OneUptime, so keep it stable: a new name registers a new storage array.":
    "- Erstatt `my-storage-array` med et navn på dette arrayet, for eksempel `fa-prod-01`. Det er slik arrayet vises i OneUptime, så hold det stabilt: et nytt navn registrerer et nytt lagringsarray.",
  "- Set `PURE_FA_ENDPOINT` to the FlashArray's management address — host name or IP, no `https://` — and `PURE_FA_API_TOKEN` to the read-only user's API token. Run `chmod 600 .env`: it holds the token.":
    "- Sett `PURE_FA_ENDPOINT` til administrasjonsadressen til FlashArray (vertsnavn eller IP, uten `https://`) og `PURE_FA_API_TOKEN` til API-tokenet til den skrivebeskyttede brukeren. Kjør `chmod 600 .env`: filen inneholder tokenet.",
  "Start the agent:": "Start agenten:",
  "Pick an ingestion key in step 1 to fill in `<YOUR_API_KEY>`.":
    "Velg en inntaksnøkkel i trinn 1 for å fylle inn `<YOUR_API_KEY>`.",
  "Look for `Everything is ready. Begin running and processing data.` in the logs. The array then appears automatically in the **Storage Arrays** section after its first scrape, usually within a minute or two.":
    "Se etter `Everything is ready. Begin running and processing data.` i loggene. Arrayet vises deretter automatisk i delen **Lagringsarrayer** etter den første skrapingen, vanligvis innen et par minutter.",
  "The install script writes these to `/opt/oneuptime-storage-array-agent/.env`; a Docker Compose install reads them from the `.env` file next to `docker-compose.yml`. After changing one, apply it with `docker compose up -d` in the agent's folder.":
    "Installasjonsskriptet skriver disse til `/opt/oneuptime-storage-array-agent/.env`; en installasjon med Docker Compose leser dem fra `.env`-filen ved siden av `docker-compose.yml`. Når du har endret en, tar du den i bruk med `docker compose up -d` i mappen til agenten.",
  "| Variable | Required | Description |":
    "| Variabel | Påkrevd | Beskrivelse |",
  "| `ONEUPTIME_URL` | Yes | Your OneUptime instance URL (e.g. `<YOUR_ONEUPTIME_URL>`) |":
    "| `ONEUPTIME_URL` | Ja | URL-en til OneUptime-instansen din (f.eks. `<YOUR_ONEUPTIME_URL>`) |",
  "| `ONEUPTIME_TELEMETRY_INGESTION_KEY` | Yes | Telemetry ingestion key — the one picked in step 1 |":
    "| `ONEUPTIME_TELEMETRY_INGESTION_KEY` | Ja | Telemetri-inntaksnøkkelen, den som ble valgt i trinn 1 |",
  "| `STORAGE_ARRAY_NAME` | Yes | The name this array registers under in OneUptime. Stamped on every metric as the `storage.array.name` resource attribute. Keep it stable — changing it registers a new storage array |":
    "| `STORAGE_ARRAY_NAME` | Ja | Navnet arrayet registreres under i OneUptime. Satt på hver måling som ressursattributtet `storage.array.name`. Hold det stabilt: endrer du det, registreres et nytt lagringsarray |",
  "| `STORAGE_SYSTEM` | No | The platform, stamped as the `storage.system` resource attribute: `purestorage.flasharray` or `purestorage.flashblade` (default: `purestorage.flasharray`) |":
    "| `STORAGE_SYSTEM` | Nei | Plattformen, satt som ressursattributtet `storage.system`: `purestorage.flasharray` eller `purestorage.flashblade` (standard: `purestorage.flasharray`) |",
  "| `STORAGE_ARRAY_COLLECTOR_CONFIG` | No | Which shipped config runs: `otel-collector-config.yaml` (FlashArray, native — the default), `otel-collector-config.flasharray-exporter.yaml` (older FlashArray) or `otel-collector-config.flashblade.yaml` (FlashBlade) |":
    "| `STORAGE_ARRAY_COLLECTOR_CONFIG` | Nei | Hvilken medfølgende konfigurasjon som kjører: `otel-collector-config.yaml` (FlashArray, innebygd; standarden), `otel-collector-config.flasharray-exporter.yaml` (eldre FlashArray) eller `otel-collector-config.flashblade.yaml` (FlashBlade) |",
  "| `COMPOSE_PROFILES` | No | Starts the exporter the config needs: empty for the native FlashArray config, `flasharray-exporter` or `flashblade` for the others |":
    "| `COMPOSE_PROFILES` | Nei | Starter eksportøren konfigurasjonen trenger: tom for den innebygde FlashArray-konfigurasjonen, `flasharray-exporter` eller `flashblade` for de andre |",
  "| `PURE_FA_ENDPOINT` | FlashArray | The FlashArray's management address — host name or IP, no `https://` |":
    "| `PURE_FA_ENDPOINT` | FlashArray | Administrasjonsadressen til FlashArray: vertsnavn eller IP, uten `https://` |",
  "| `PURE_FA_API_TOKEN` | FlashArray | API token of the FlashArray user with the readonly role |":
    "| `PURE_FA_API_TOKEN` | FlashArray | API-tokenet til FlashArray-brukeren med rollen readonly |",
  "| `PURE_FB_ENDPOINT` | FlashBlade | The FlashBlade's management address — host name or IP, no `https://` |":
    "| `PURE_FB_ENDPOINT` | FlashBlade | Administrasjonsadressen til FlashBlade: vertsnavn eller IP, uten `https://` |",
  "| `PURE_FB_API_TOKEN` | FlashBlade | API token of the FlashBlade user with the readonly role |":
    "| `PURE_FB_API_TOKEN` | FlashBlade | API-tokenet til FlashBlade-brukeren med rollen readonly |",
  "| `STORAGE_ARRAY_INSECURE_SKIP_VERIFY` | No | `true` accepts the array's self-signed certificate on the native endpoint; `false` verifies it (default: `true`). Pure's exporters never verify the array's certificate, so it does not apply to them |":
    "| `STORAGE_ARRAY_INSECURE_SKIP_VERIFY` | Nei | `true` godtar det selvsignerte sertifikatet til arrayet på det innebygde endepunktet; `false` verifiserer det (standard: `true`). Pures eksportører verifiserer aldri sertifikatet til arrayet, så den gjelder ikke for dem |",
  "| `STORAGE_ARRAY_AGENT_CONTAINER_NAME` | No | The agent's container name (default: `oneuptime-storage-array-agent`). A second array's agent on the same machine needs one of its own: the install script names a new agent after its folder unless you set it, and keeps it when you run the script again |":
    "| `STORAGE_ARRAY_AGENT_CONTAINER_NAME` | Nei | Containernavnet til agenten (standard: `oneuptime-storage-array-agent`). Agenten for et andre array på samme maskin trenger sitt eget: installasjonsskriptet navngir en ny agent etter mappen dens med mindre du angir det, og beholder det når du kjører skriptet på nytt |",
  "- The collector reads the FlashArray's own OpenMetrics endpoint over HTTPS with the token as a Bearer credential — no exporter runs.":
    "- Innsamleren leser FlashArrays eget OpenMetrics-endepunkt over HTTPS med tokenet som Bearer-legitimasjon: ingen eksportør kjører.",
  "- **One scrape job per endpoint**, each read as often as it is worth: `/metrics/array` every 60 seconds; `/metrics/volumes`, `/metrics/hosts` and `/metrics/pods` every 2 minutes; `/metrics/directories` every 30 minutes — directory space is expensive for the array to compute.":
    "- **Én skrapejobb per endepunkt**, hver lest så ofte som det er verdt: `/metrics/array` hvert 60. sekund; `/metrics/volumes`, `/metrics/hosts` og `/metrics/pods` hvert 2. minutt; `/metrics/directories` hvert 30. minutt, for plassen til kataloger er dyr for arrayet å beregne.",
  "- **Every job labels its series `scrape_endpoint: <endpoint>`**, so OneUptime knows which objects a batch is the complete list of — that is how a deleted object leaves the inventory. Keep the labels as shipped.":
    "- **Hver jobb setter etiketten `scrape_endpoint: <endpoint>` på seriene sine**, så OneUptime vet hvilke objekter en batch er den fullstendige listen over: slik forsvinner et slettet objekt fra inventaret. Behold etikettene slik de leveres.",
  "- **Per-volume and per-host latency keeps three dimensions** (`usec_per_read_op`, `usec_per_write_op`, `usec_per_mirrored_write_op`); a `metric_relabel_configs` rule drops the QoS, queue, SAN and service-time breakdown, which multiplies the series count of a large array. The array-wide breakdown is kept.":
    "- **Latens per volum og per vert beholder tre dimensjoner** (`usec_per_read_op`, `usec_per_write_op`, `usec_per_mirrored_write_op`); en regel i `metric_relabel_configs` dropper oppdelingen etter QoS, kø, SAN og tjenestetid, som mangedobler antallet serier for et stort array. Oppdelingen for hele arrayet beholdes.",
  "- **No `send_batch_max_size`.** OneUptime rebuilds the inventory from one whole scrape, so the `batch` processor never splits one.":
    "- **Ingen `send_batch_max_size`.** OneUptime bygger inventaret opp på nytt fra én hel skraping, så prosessoren `batch` deler aldri opp en.",
  "This is the full `otel-collector-config.yaml` the agent runs; the `.env` file supplies the `${env:...}` values:":
    "Dette er den fullstendige `otel-collector-config.yaml` som agenten kjører; `.env`-filen gir verdiene `${env:...}`:",
  "The agent ships metrics only until you turn on its syslog receivers. Arrays forward their alerts and audit events as syslog; the agent stamps `storage.array.name` on every line, so they land on this array's **Logs** page.":
    "Agenten sender bare målinger til du slår på syslog-mottakerne dens. Arrayer videresender varslene og revisjonshendelsene sine som syslog; agenten setter `storage.array.name` på hver linje, så de havner på siden **Logger** for dette arrayet.",
  "1. In `otel-collector-config.yaml`, uncomment the `syslog/tcp` and `syslog/udp` receivers and the `logs` pipeline. Classic BSD syslog timestamps carry no time zone: set `location` to the array's time zone unless its clock runs on UTC.":
    "1. Fjern kommenteringen av mottakerne `syslog/tcp` og `syslog/udp` og pipelinen `logs` i `otel-collector-config.yaml`. Klassiske BSD-syslog-tidsstempler har ingen tidssone: sett `location` til tidssonen til arrayet, med mindre klokken går i UTC.",
  "2. In `docker-compose.yml`, uncomment the `ports:` block that publishes `5514/tcp` and `5514/udp`, and open the port on the machine's firewall for the array's management network.":
    "2. Fjern kommenteringen av blokken `ports:` som publiserer `5514/tcp` og `5514/udp` i `docker-compose.yml`, og åpne porten i brannmuren på maskinen for administrasjonsnettverket til arrayet.",
  "3. Apply both:": "3. Ta i bruk begge:",
  "4. On the FlashArray, as an administrator, open **Settings → System → Syslog Servers**, add `udp://<agent-host>:5514` (or `tcp://<agent-host>:5514`) and send a test message.":
    "4. Åpne **Settings → System → Syslog Servers** på FlashArray som administrator, legg til `udp://<agent-host>:5514` (eller `tcp://<agent-host>:5514`), og send en testmelding.",
  "Any resource attribute prefixed with `oneuptime.label.` becomes a project label on the array: `oneuptime.label.<dimension>=<value>` is the label `<dimension>:<value>`. Add them to the `resource` processor of the collector config you use, next to `storage.array.name`:":
    "Alle ressursattributter med prefikset `oneuptime.label.` blir en prosjektetikett på arrayet: `oneuptime.label.<dimension>=<value>` er etiketten `<dimension>:<value>`. Legg dem til i prosessoren `resource` i innsamlerkonfigurasjonen du bruker, ved siden av `storage.array.name`:",
  "Then restart the collector so it reads the new config:":
    "Start deretter innsamleren på nytt, så den leser den nye konfigurasjonen:",
  "The array shows up tagged `team:storage` and `env:production`. Labels are matched case-insensitively, so an existing `Production` label is reused; labels added in the OneUptime UI are never removed by the agent.":
    "Arrayet vises med etikettene `team:storage` og `env:production`. Etiketter sammenlignes uten hensyn til store og små bokstaver, så en eksisterende etikett `Production` gjenbrukes; etiketter som er lagt til i OneUptime-grensesnittet, fjernes aldri av agenten.",
  "Every value is a gauge the FlashArray computes itself — latency per operation in microseconds, throughput per second. OneUptime's Storage Array pages, metric catalog and alert templates are built on:":
    "Hver verdi er en gauge som FlashArray beregner selv: latens per operasjon i mikrosekunder, gjennomstrømning per sekund. Lagringsarray-sidene, målingskatalogen og varselmalene i OneUptime bygger på:",
  "| Endpoint | Data |": "| Endepunkt | Data |",
  "| **Array** (`/metrics/array`) | `purefa_info`, capacity and data reduction (`purefa_array_space_*`), performance, open alerts (`purefa_alerts_open`), hardware components, drives, controllers and network interfaces |":
    "| **Array** (`/metrics/array`) | `purefa_info`, kapasitet og datareduksjon (`purefa_array_space_*`), ytelse, åpne varsler (`purefa_alerts_open`), maskinvarekomponenter, disker, kontrollere og nettverksgrensesnitt |",
  "| **Volumes** (`/metrics/volumes`) | Latency, IOPS, bandwidth, space and data reduction per volume |":
    "| **Volumer** (`/metrics/volumes`) | Latens, IOPS, båndbredde, plass og datareduksjon per volum |",
  "| **Hosts** (`/metrics/hosts`) | Connectivity, connected volumes, latency, IOPS and space per host |":
    "| **Verter** (`/metrics/hosts`) | Tilkobling, tilkoblede volumer, latens, IOPS og plass per vert |",
  "| **Pods** (`/metrics/pods`) | ActiveCluster and ActiveDR replica link lag, mediator status, performance and space |":
    "| **Pods** (`/metrics/pods`) | Forsinkelse på replikakoblingene til ActiveCluster og ActiveDR, mediatorstatus, ytelse og plass |",
  "| **Directories** (`/metrics/directories`) | Space and performance of FlashArray file services' managed directories |":
    "| **Kataloger** (`/metrics/directories`) | Plass og ytelse for de administrerte katalogene i filtjenestene til FlashArray |",
  "One agent reads one array. To monitor several from the same machine, install each into its own folder with its own `.env` and its own container name — two containers cannot share one:":
    "Én agent leser ett array. For å overvåke flere fra samme maskin installerer du hver i sin egen mappe med sin egen `.env` og sitt eget containernavn, for to containere kan ikke dele et navn:",
  "Without `STORAGE_ARRAY_AGENT_CONTAINER_NAME`, the script names the container after the folder. It keeps the name in that agent's `.env`, so running the script again to upgrade the agent keeps it, and an agent whose `container_name` you once edited in `docker-compose.yml` keeps that name. With Docker Compose, set `STORAGE_ARRAY_AGENT_CONTAINER_NAME` in each agent's `.env` instead.":
    "Uten `STORAGE_ARRAY_AGENT_CONTAINER_NAME` navngir skriptet containeren etter mappen. Det lagrer navnet i `.env` til den agenten, så når du kjører skriptet på nytt for å oppgradere agenten, beholdes navnet, og en agent der du en gang redigerte `container_name` i `docker-compose.yml`, beholder det navnet. Med Docker Compose setter du i stedet `STORAGE_ARRAY_AGENT_CONTAINER_NAME` i `.env` til hver agent.",
  "The agent ships a systemd unit that assumes the install script's folder, `/opt/oneuptime-storage-array-agent`. The install script does not download it, so fetch it:":
    "Agenten leveres med en systemd-enhet som forutsetter mappen til installasjonsskriptet, `/opt/oneuptime-storage-array-agent`. Installasjonsskriptet laster den ikke ned, så hent den selv:",
  "**Upgrade** — the collector image is pinned in `docker-compose.yml` and its configs are files beside it, so pulling alone does not move the agent forward. Re-run the install script. It reuses every value in your existing `.env` (nothing is prompted for again), downloads the latest `docker-compose.yml` and collector configs — a file you edited is kept next to the new one as `<file>.bak.<timestamp>` — and recreates the agent with them:":
    "**Oppgrader**: innsamlerimaget er låst i `docker-compose.yml`, og konfigurasjonene er filer ved siden av, så å hente imaget alene flytter ikke agenten videre. Kjør installasjonsskriptet på nytt. Det gjenbruker hver verdi i den eksisterende `.env` (ingenting spørres om igjen), laster ned de nyeste `docker-compose.yml` og innsamlerkonfigurasjonene (en fil du har redigert, beholdes ved siden av den nye som `<file>.bak.<timestamp>`) og gjenoppretter agenten med dem:",
  "An agent installed outside `/opt/oneuptime-storage-array-agent` (a second array's, say) needs its folder: `INSTALL_DIR=<folder> bash install.sh`.":
    "En agent som er installert utenfor `/opt/oneuptime-storage-array-agent` (for eksempel agenten for et andre array), trenger mappen sin: `INSTALL_DIR=<folder> bash install.sh`.",
  "Installed it with Docker Compose instead? In the agent's folder, download the compose file and the three collector configs again; your `.env` stays, and a change you made to any of them has to be made again:":
    "Installerte du den med Docker Compose i stedet? Last ned compose-filen og de tre innsamlerkonfigurasjonene på nytt i mappen til agenten; `.env` blir værende, og en endring du har gjort i noen av dem, må gjøres på nytt:",
  "Then pull the images and recreate the agent, so the collector reads its new config:":
    "Hent deretter imagene, og gjenopprett agenten, så innsamleren leser den nye konfigurasjonen:",
  "The config reports the collector version it pins as the array's **Agent Version**. When this OneUptime pins a newer one, a warning sign beside it opens these commands.":
    "Konfigurasjonen rapporterer innsamlerversjonen den låser, som arrayets **Agentversjon**. Når denne OneUptime låser en nyere, åpner et varseltegn ved siden av den disse kommandoene.",
  "**Uninstall** the agent:": "**Avinstaller** agenten:",
  "Then delete the read-only user and its API token on the array if you no longer need them.":
    "Slett deretter den skrivebeskyttede brukeren og API-tokenet dens på arrayet hvis du ikke lenger trenger dem.",
  "`troubleshoot.sh` checks the whole chain — container runtime, the array endpoint exactly as the collector reaches it (the native endpoint or Pure's exporter, DNS, TLS, the API token), array-name stamping, collector self-metrics — and asks OneUptime directly whether it accepts your ingestion key. That last check matters most: OneUptime's OTLP endpoints refuse a bad key with `401` or `422`, which the collector logs as a single `Exporting failed` line per batch that is easy to miss, so the script asks `GET /otlp/v1/validate` for a direct 200/401 verdict.":
    "`troubleshoot.sh` sjekker hele kjeden (containerkjøretid, endepunktet til arrayet nøyaktig slik innsamleren når det, altså det innebygde endepunktet eller Pures eksportør, med DNS, TLS og API-tokenet, påføringen av arraynavnet, innsamlerens egne målinger) og spør OneUptime direkte om den godtar inntaksnøkkelen din. Den siste sjekken betyr mest: OneUptimes OTLP-endepunkter avviser en feil nøkkel med `401` eller `422`, som innsamleren logger som én enkelt `Exporting failed`-linje per batch som er lett å overse, så skriptet spør `GET /otlp/v1/validate` om en direkte avgjørelse 200/401.",
  "It ends with a verdict naming the most likely cause.":
    "Det avslutter med en avgjørelse som nevner den mest sannsynlige årsaken.",
  "1. Check the collector logs: `docker logs oneuptime-storage-array-agent`. `server returned HTTP status 401` means the array refused the API token, `404` means the FlashArray has no native endpoint, `x509` means TLS verification is on against the array's self-signed certificate, `no such host` or `connection refused` means a wrong `PURE_FA_ENDPOINT`, and an export `401` means a bad ingestion key.":
    "1. Sjekk loggene til innsamleren: `docker logs oneuptime-storage-array-agent`. `server returned HTTP status 401` betyr at arrayet avviste API-tokenet, `404` at FlashArray ikke har et innebygd endepunkt, `x509` at TLS-verifisering er på mot det selvsignerte sertifikatet til arrayet, `no such host` eller `connection refused` en feil `PURE_FA_ENDPOINT`, og en `401` ved eksport en feil inntaksnøkkel.",
  "2. Make sure `STORAGE_ARRAY_NAME` is set — discovery keys on the `storage.array.name` resource attribute, and the collector refuses to start without it.":
    "2. Sørg for at `STORAGE_ARRAY_NAME` er satt: oppdagelsen bygger på ressursattributtet `storage.array.name`, og innsamleren nekter å starte uten det.",
  "3. Make sure `STORAGE_ARRAY_COLLECTOR_CONFIG` and `COMPOSE_PROFILES` name the same platform.":
    "3. Sørg for at `STORAGE_ARRAY_COLLECTOR_CONFIG` og `COMPOSE_PROFILES` angir samme plattform.",
  "Its Purity//FA has no native OpenMetrics endpoint. Set `STORAGE_ARRAY_COLLECTOR_CONFIG=otel-collector-config.flasharray-exporter.yaml` and `COMPOSE_PROFILES=flasharray-exporter` in `.env` and run `docker compose up -d` — or re-run `install.sh` with the older-Purity choice. After upgrading the array to Purity//FA 6.7 or later, switch back to the native config and drop the profile.":
    "Purity//FA på arrayet har ikke noe innebygd OpenMetrics-endepunkt. Sett `STORAGE_ARRAY_COLLECTOR_CONFIG=otel-collector-config.flasharray-exporter.yaml` og `COMPOSE_PROFILES=flasharray-exporter` i `.env`, og kjør `docker compose up -d`, eller kjør `install.sh` på nytt med valget for eldre Purity. Når arrayet er oppgradert til Purity//FA 6.7 eller nyere, bytter du tilbake til den innebygde konfigurasjonen og fjerner profilen.",
  "Check that you pasted the token, not the user's password; that the user still exists and holds the readonly role; and that the token has not expired. Create a new token (`pureadmin create --api-token oneuptime` on a FlashArray), put it in `.env` as `PURE_FA_API_TOKEN` and run `docker compose up -d`.":
    "Sjekk at du limte inn tokenet og ikke passordet til brukeren, at brukeren fortsatt finnes og har rollen readonly, og at tokenet ikke har utløpt. Opprett et nytt token (`pureadmin create --api-token oneuptime` på en FlashArray), legg det i `.env` som `PURE_FA_API_TOKEN`, og kjør `docker compose up -d`.",
  "Arrays present a self-signed certificate by default, which no Docker image trusts. Set `STORAGE_ARRAY_INSECURE_SKIP_VERIFY=true` (the pragmatic choice on a private management network), or install a certificate on the array from a CA the collector image trusts.":
    "Arrayer presenterer som standard et selvsignert sertifikat, som ingen Docker-image stoler på. Sett `STORAGE_ARRAY_INSECURE_SKIP_VERIFY=true` (det pragmatiske valget på et privat administrasjonsnettverk), eller installer et sertifikat på arrayet fra en CA som innsamlerimaget stoler på.",
  "`pure-fa-exporter` or `pure-fb-exporter` is not running: `COMPOSE_PROFILES` must match `STORAGE_ARRAY_COLLECTOR_CONFIG` — `flasharray-exporter` for the FlashArray exporter config, `flashblade` for the FlashBlade config. Fix `.env` and run `docker compose up -d`; `docker compose ps` then lists the exporter.":
    "`pure-fa-exporter` eller `pure-fb-exporter` kjører ikke: `COMPOSE_PROFILES` må passe til `STORAGE_ARRAY_COLLECTOR_CONFIG`, altså `flasharray-exporter` for konfigurasjonen med FlashArray-eksportøren og `flashblade` for FlashBlade-konfigurasjonen. Rett `.env`, og kjør `docker compose up -d`; `docker compose ps` viser deretter eksportøren.",
  "1. Check that the agent is running: `docker ps --filter name=oneuptime-storage-array-agent`":
    "1. Sjekk at agenten kjører: `docker ps --filter name=oneuptime-storage-array-agent`",
  "2. Check the agent logs for errors: `docker logs oneuptime-storage-array-agent 2>&1 | grep -i error`":
    "2. Sjekk agentens logger for feil: `docker logs oneuptime-storage-array-agent 2>&1 | grep -i error`",
  "3. Verify your OneUptime URL and ingestion key are correct.":
    "3. Bekreft at OneUptime-URL-en og inntaksnøkkelen din er riktige.",
  "4. Ensure the agent machine can reach the OneUptime instance over the network.":
    "4. Sørg for at agentens maskin når OneUptime-instansen over nettverket.",
  "The array's identity comes from `STORAGE_ARRAY_NAME`, stamped on every metric as `storage.array.name`. Fix it in `.env` and apply it with `docker compose up -d` in the agent's folder — note that a new name registers a new storage array.":
    "Identiteten til arrayet kommer fra `STORAGE_ARRAY_NAME`, satt på hver måling som `storage.array.name`. Rett den i `.env`, og ta den i bruk med `docker compose up -d` i mappen til agenten; merk at et nytt navn registrerer et nytt lagringsarray.",
  "It registers the array as **`array-1`** — the name this array already has in OneUptime.":
    "Det registrerer arrayet som **`array-1`**, navnet dette arrayet allerede har i OneUptime.",
  "- This installs the agent for **`array-1`** — keep `STORAGE_ARRAY_NAME` exactly as it is, or the data registers as a new storage array.":
    "- Dette installerer agenten for **`array-1`**: la `STORAGE_ARRAY_NAME` stå nøyaktig som det er, ellers registreres dataene som et nytt lagringsarray.",
  "The array's identity comes from `STORAGE_ARRAY_NAME`, stamped on every metric as `storage.array.name`. This array is **`array-1`**. Fix it in `.env` and apply it with `docker compose up -d` in the agent's folder — note that a new name registers a new storage array.":
    "Identiteten til arrayet kommer fra `STORAGE_ARRAY_NAME`, satt på hver måling som `storage.array.name`. Dette arrayet er **`array-1`**. Rett den i `.env`, og ta den i bruk med `docker compose up -d` i mappen til agenten; merk at et nytt navn registrerer et nytt lagringsarray.",
  "The command already carries your OneUptime URL, ingestion key and the platform you picked above. The script asks for:":
    "Kommandoen inneholder allerede OneUptime-URL-en, inntaksnøkkelen din og plattformen du valgte ovenfor. Skriptet spør etter:",
  "Access from that machine to `quay.io`, where Docker pulls Pure's exporter image":
    "Tilgang fra den maskinen til `quay.io`, der Docker henter eksportørimaget til Pure",
  "- `COMPOSE_PROFILES=flasharray-exporter` starts `pure-fa-exporter`, Pure's exporter, next to the collector; the two must match.":
    "- `COMPOSE_PROFILES=flasharray-exporter` starter `pure-fa-exporter`, Pures eksportør, ved siden av innsamleren; de to må passe sammen.",
  "`docker compose ps` in the agent's folder also lists **`pure-fa-exporter`**, Pure's exporter, which the collector reads the FlashArray through.":
    "`docker compose ps` i mappen til agenten viser også **`pure-fa-exporter`**, Pures eksportør, som innsamleren leser FlashArray gjennom.",
  "- The collector reads the FlashArray through `pure-fa-exporter`, Pure's exporter, which logs in to the FlashArray's REST API with the token the collector sends on every scrape. The exporter's port stays on the compose network.":
    "- Innsamleren leser FlashArray gjennom `pure-fa-exporter`, Pures eksportør, som logger på REST-API-et til FlashArray med tokenet innsamleren sender ved hver skraping. Porten til eksportøren blir værende på compose-nettverket.",
  "Docker Engine 20.10+ with the Docker Compose v2 plugin, on a machine that can reach the FlashBlade's management address over HTTPS (TCP 443)":
    "Docker Engine 20.10 eller nyere med Docker Compose v2-tillegget, på en maskin som når administrasjonsadressen til FlashBlade over HTTPS (TCP 443)",
  "An administrator account on the FlashBlade, to create the agent's read-only user":
    "En administratorkonto på FlashBlade, for å opprette agentens skrivebeskyttede bruker",
  "On the FlashBlade, as an administrator, create a user named `oneuptime` with the **readonly** role — in the FlashBlade GUI's user settings, or with `pureadmin` in the Purity//FB CLI — and create an **API token** for it. Create the token **without an expiry**, or the agent stops the day it expires.":
    "Opprett som administrator på FlashBlade en bruker med navnet `oneuptime` og rollen **readonly** (i brukerinnstillingene i FlashBlade-GUI-et eller med `pureadmin` i Purity//FB-CLI-en), og opprett et **API-token** for den. Opprett tokenet **uten utløpsdato**, ellers stopper agenten den dagen det utløper.",
  "FlashBlade API tokens start with `T-`. A Purity//FB release without local users takes a directory service (LDAP or Active Directory) account whose group maps to the readonly role instead.":
    "API-tokener for FlashBlade starter med `T-`. En Purity//FB-versjon uten lokale brukere bruker i stedet en konto fra en katalogtjeneste (LDAP eller Active Directory) der gruppen er knyttet til rollen readonly.",
  "- the FlashBlade's **management address** (host name or IP, no `https://`) and the read-only user's **API token**, which it reads without echoing":
    "- **administrasjonsadressen** til FlashBlade (vertsnavn eller IP, uten `https://`) og **API-tokenet** til den skrivebeskyttede brukeren, som det leser uten å vise det",
  "- Set `PURE_FB_ENDPOINT` to the FlashBlade's management address — host name or IP, no `https://` — and `PURE_FB_API_TOKEN` to the read-only user's API token. Run `chmod 600 .env`: it holds the token.":
    "- Sett `PURE_FB_ENDPOINT` til administrasjonsadressen til FlashBlade (vertsnavn eller IP, uten `https://`) og `PURE_FB_API_TOKEN` til API-tokenet til den skrivebeskyttede brukeren. Kjør `chmod 600 .env`: filen inneholder tokenet.",
  "`docker compose ps` in the agent's folder also lists **`pure-fb-exporter`**, Pure's exporter, which the collector reads the FlashBlade through.":
    "`docker compose ps` i mappen til agenten viser også **`pure-fb-exporter`**, Pures eksportør, som innsamleren leser FlashBlade gjennom.",
  "- The collector reads the FlashBlade through `pure-fb-exporter`, Pure's exporter, which logs in to the FlashBlade's REST API with the token the collector sends on every scrape. The exporter's port stays on the compose network.":
    "- Innsamleren leser FlashBlade gjennom `pure-fb-exporter`, Pures eksportør, som logger på REST-API-et til FlashBlade med tokenet innsamleren sender ved hver skraping. Porten til eksportøren blir værende på compose-nettverket.",
  "- **One scrape job per endpoint**, each read as often as it is worth: `/metrics/array` every 60 seconds; `/metrics/filesystems` and `/metrics/objectstore` every 5 minutes — the FlashBlade REST API is not built to report every file system and bucket quickly.":
    "- **Én skrapejobb per endepunkt**, hver lest så ofte som det er verdt: `/metrics/array` hvert 60. sekund; `/metrics/filesystems` og `/metrics/objectstore` hvert 5. minutt, for REST-API-et til FlashBlade er ikke laget for å rapportere hvert filsystem og hver bucket raskt.",
  "4. On the FlashBlade, as an administrator, add a syslog server `udp://<agent-host>:5514` (or `tcp://`) in its syslog settings.":
    "4. Legg som administrator på FlashBlade til en syslog-server `udp://<agent-host>:5514` (eller `tcp://`) i syslog-innstillingene.",
  "Every value is a gauge the FlashBlade computes itself — latency per operation in microseconds, throughput per second. OneUptime's Storage Array pages, metric catalog and alert templates are built on:":
    "Hver verdi er en gauge som FlashBlade beregner selv: latens per operasjon i mikrosekunder, gjennomstrømning per sekund. Lagringsarray-sidene, målingskatalogen og varselmalene i OneUptime bygger på:",
  "| **Array** (`/metrics/array`) | `purefb_info`, capacity and data reduction (`purefb_array_space_*`), performance per protocol, open alerts (`purefb_alerts_open`), hardware health (`purefb_hardware_health`) |":
    "| **Array** (`/metrics/array`) | `purefb_info`, kapasitet og datareduksjon (`purefb_array_space_*`), ytelse per protokoll, åpne varsler (`purefb_alerts_open`), maskinvaretilstand (`purefb_hardware_health`) |",
  "| **File systems** (`/metrics/filesystems`) | Space, data reduction and performance per file system |":
    "| **Filsystemer** (`/metrics/filesystems`) | Plass, datareduksjon og ytelse per filsystem |",
  "| **Object store** (`/metrics/objectstore`) | Space, quota, object counts and performance per bucket |":
    "| **Objektlager** (`/metrics/objectstore`) | Plass, kvote, antall objekter og ytelse per bucket |",
};

export default TRANSLATION;
