import { SetupGuideTranslation } from "../../../Components/SetupGuide/SetupGuideTranslation";

/*
 * The StorageArray setup guide in Spanish (#8341): each piece of the English
 * guide's markdown (Pages/StorageArray/Utils/DocumentationMarkdown.ts) and its
 * Spanish. Code, field names and product names are as the English writes
 * them, and what the Dashboard draws is named as its Spanish words it.
 * Change it with the English, in the same pull request
 * (SetupGuideDocumentationInLocale).
 */
const TRANSLATION: SetupGuideTranslation = {
  "Docker Engine 20.10+ with the Docker Compose v2 plugin, on a machine that can reach the FlashArray's management address over HTTPS (TCP 443)":
    "Docker Engine 20.10 o posterior con el plugin Docker Compose v2, en una máquina que pueda llegar a la dirección de gestión de la FlashArray por HTTPS (TCP 443)",
  "An administrator account on the FlashArray, to create the agent's read-only user":
    "Una cuenta de administrador en la FlashArray, para crear el usuario de solo lectura del agente",
  "Create the token **without an expiry**, or the agent stops the day it expires.":
    "Crea el token **sin caducidad**, o el agente se detendrá el día en que caduque.",
  "SSH to the FlashArray as an administrator. The first command asks for the new user's password; the second prints its API token:":
    "Conéctate por SSH a la FlashArray como administrador. El primer comando pide la contraseña del nuevo usuario; el segundo muestra su token de API:",
  "1. Open **Settings → Users and Policies** (**Settings → Access** on older releases).":
    "1. Abre **Settings → Users and Policies** (**Settings → Access** en versiones anteriores).",
  "2. From the ⋮ menu of the **Users** panel choose **Create User…**, name it `oneuptime` and give it the **readonly** role.":
    "2. En el menú ⋮ del panel **Users**, elige **Create User…**, ponle el nombre `oneuptime` y dale el rol **readonly**.",
  "3. From the new user's ⋮ menu choose **Create API Token…**, leave **Expires In** empty, and copy the token.":
    "3. En el menú ⋮ del nuevo usuario, elige **Create API Token…**, deja **Expires In** vacío y copia el token.",
  "A `purefa_info{...} 1` line means the array serves its metrics natively: carry on. A **404** means its Purity//FA is older (Pure documents the native endpoint for 6.7.0 and later; its exporter's deprecation notice says 6.6.11 and later) — pick **FlashArray, older Purity** at the top of this guide instead.":
    "Una línea `purefa_info{...} 1` significa que la cabina sirve sus métricas de forma nativa: continúa. Un **404** significa que su Purity//FA es anterior (Pure documenta el endpoint nativo para 6.7.0 y posteriores; el aviso de obsolescencia de su exportador dice 6.6.11 y posteriores): elige en su lugar **FlashArray, Purity anterior** en la parte superior de esta guía.",
  "The first line downloads the script as `install.sh`, so you can read it before you run it.":
    "La primera línea descarga el script como `install.sh`, para que puedas leerlo antes de ejecutarlo.",
  "The command carries the platform you picked above. The script asks for:":
    "El comando lleva la plataforma que elegiste arriba. El script pide:",
  "- your **OneUptime URL** and **ingestion key**, both shown in step 1 (pick a key there to have them filled in here)":
    "- tu **URL de OneUptime** y tu **clave de ingesta**, ambas mostradas en el paso 1 (elige ahí una clave para que se rellenen aquí)",
  "- an **array name** — how the array appears in OneUptime. Give every array its own and keep it stable: a new name registers a new storage array":
    "- un **nombre de cabina**: cómo aparece la cabina en OneUptime. Da a cada cabina el suyo y mantenlo estable: un nombre nuevo registra una cabina de almacenamiento nueva",
  "- the FlashArray's **management address** (host name or IP, no `https://`) and the read-only user's **API token**, which it reads without echoing":
    "- la **dirección de gestión** de la FlashArray (nombre de host o IP, sin `https://`) y el **token de API** del usuario de solo lectura, que lee sin mostrarlo",
  "- whether to verify the array's certificate — answer **N** unless the array carries a certificate from a CA you trust (arrays ship a self-signed one)":
    "- si se debe verificar el certificado de la cabina: responde **N** salvo que la cabina tenga un certificado de una CA en la que confíes (las cabinas vienen con uno autofirmado)",
  "It installs to `/opt/oneuptime-storage-array-agent`, writes a `.env` file only you can read (it holds the API token) and starts the agent with Docker Compose.":
    "Se instala en `/opt/oneuptime-storage-array-agent`, escribe un archivo `.env` que solo tú puedes leer (contiene el token de API) e inicia el agente con Docker Compose.",
  "Download the compose file and the collector configs from this OneUptime into a new folder:":
    "Descarga el archivo compose y las configuraciones del recolector desde este OneUptime en una carpeta nueva:",
  "Create a `.env` file next to them:": "Crea un archivo `.env` junto a ellos:",
  "- Replace `my-storage-array` with a name for this array, such as `fa-prod-01`. It is how the array appears in OneUptime, so keep it stable: a new name registers a new storage array.":
    "- Sustituye `my-storage-array` por un nombre para esta cabina, como `fa-prod-01`. Es como aparece la cabina en OneUptime, así que mantenlo estable: un nombre nuevo registra una cabina de almacenamiento nueva.",
  "- Set `PURE_FA_ENDPOINT` to the FlashArray's management address — host name or IP, no `https://` — and `PURE_FA_API_TOKEN` to the read-only user's API token. Run `chmod 600 .env`: it holds the token.":
    "- Establece `PURE_FA_ENDPOINT` en la dirección de gestión de la FlashArray (nombre de host o IP, sin `https://`) y `PURE_FA_API_TOKEN` en el token de API del usuario de solo lectura. Ejecuta `chmod 600 .env`: contiene el token.",
  "Start the agent:": "Inicia el agente:",
  "Pick an ingestion key in step 1 to fill in `<YOUR_API_KEY>`.":
    "Elige una clave de ingesta en el paso 1 para rellenar `<YOUR_API_KEY>`.",
  "Look for `Everything is ready. Begin running and processing data.` in the logs. The array then appears automatically in the **Storage Arrays** section after its first scrape, usually within a minute or two.":
    "Busca `Everything is ready. Begin running and processing data.` en los registros. Después la cabina aparece automáticamente en la sección **Cabinas de almacenamiento** tras su primera recopilación, normalmente en uno o dos minutos.",
  "The install script writes these to `/opt/oneuptime-storage-array-agent/.env`; a Docker Compose install reads them from the `.env` file next to `docker-compose.yml`. After changing one, apply it with `docker compose up -d` in the agent's folder.":
    "El script de instalación las escribe en `/opt/oneuptime-storage-array-agent/.env`; una instalación con Docker Compose las lee del archivo `.env` junto a `docker-compose.yml`. Después de cambiar una, aplícala con `docker compose up -d` en la carpeta del agente.",
  "| Variable | Required | Description |":
    "| Variable | Obligatoria | Descripción |",
  "| `ONEUPTIME_URL` | Yes | Your OneUptime instance URL (e.g. `<YOUR_ONEUPTIME_URL>`) |":
    "| `ONEUPTIME_URL` | Sí | La URL de tu instancia de OneUptime (p. ej., `<YOUR_ONEUPTIME_URL>`) |",
  "| `ONEUPTIME_TELEMETRY_INGESTION_KEY` | Yes | Telemetry ingestion key — the one picked in step 1 |":
    "| `ONEUPTIME_TELEMETRY_INGESTION_KEY` | Sí | La clave de ingesta de telemetría, la elegida en el paso 1 |",
  "| `STORAGE_ARRAY_NAME` | Yes | The name this array registers under in OneUptime. Stamped on every metric as the `storage.array.name` resource attribute. Keep it stable — changing it registers a new storage array |":
    "| `STORAGE_ARRAY_NAME` | Sí | El nombre con el que esta cabina se registra en OneUptime. Se estampa en cada métrica como el atributo de recurso `storage.array.name`. Mantenlo estable: cambiarlo registra una cabina de almacenamiento nueva |",
  "| `STORAGE_SYSTEM` | No | The platform, stamped as the `storage.system` resource attribute: `purestorage.flasharray` or `purestorage.flashblade` (default: `purestorage.flasharray`) |":
    "| `STORAGE_SYSTEM` | No | La plataforma, estampada como el atributo de recurso `storage.system`: `purestorage.flasharray` o `purestorage.flashblade` (predeterminado: `purestorage.flasharray`) |",
  "| `STORAGE_ARRAY_COLLECTOR_CONFIG` | No | Which shipped config runs: `otel-collector-config.yaml` (FlashArray, native — the default), `otel-collector-config.flasharray-exporter.yaml` (older FlashArray) or `otel-collector-config.flashblade.yaml` (FlashBlade) |":
    "| `STORAGE_ARRAY_COLLECTOR_CONFIG` | No | Qué configuración incluida se ejecuta: `otel-collector-config.yaml` (FlashArray, nativa; la predeterminada), `otel-collector-config.flasharray-exporter.yaml` (FlashArray anterior) o `otel-collector-config.flashblade.yaml` (FlashBlade) |",
  "| `COMPOSE_PROFILES` | No | Starts the exporter the config needs: empty for the native FlashArray config, `flasharray-exporter` or `flashblade` for the others |":
    "| `COMPOSE_PROFILES` | No | Inicia el exportador que necesita la configuración: vacío para la configuración nativa de FlashArray, `flasharray-exporter` o `flashblade` para las demás |",
  "| `PURE_FA_ENDPOINT` | FlashArray | The FlashArray's management address — host name or IP, no `https://` |":
    "| `PURE_FA_ENDPOINT` | FlashArray | La dirección de gestión de la FlashArray: nombre de host o IP, sin `https://` |",
  "| `PURE_FA_API_TOKEN` | FlashArray | API token of the FlashArray user with the readonly role |":
    "| `PURE_FA_API_TOKEN` | FlashArray | El token de API del usuario de FlashArray con el rol readonly |",
  "| `PURE_FB_ENDPOINT` | FlashBlade | The FlashBlade's management address — host name or IP, no `https://` |":
    "| `PURE_FB_ENDPOINT` | FlashBlade | La dirección de gestión de la FlashBlade: nombre de host o IP, sin `https://` |",
  "| `PURE_FB_API_TOKEN` | FlashBlade | API token of the FlashBlade user with the readonly role |":
    "| `PURE_FB_API_TOKEN` | FlashBlade | El token de API del usuario de FlashBlade con el rol readonly |",
  "| `STORAGE_ARRAY_INSECURE_SKIP_VERIFY` | No | `true` accepts the array's self-signed certificate on the native endpoint; `false` verifies it (default: `true`). Pure's exporters never verify the array's certificate, so it does not apply to them |":
    "| `STORAGE_ARRAY_INSECURE_SKIP_VERIFY` | No | `true` acepta el certificado autofirmado de la cabina en el endpoint nativo; `false` lo verifica (predeterminado: `true`). Los exportadores de Pure nunca verifican el certificado de la cabina, así que no se aplica a ellos |",
  "- The collector reads the FlashArray's own OpenMetrics endpoint over HTTPS with the token as a Bearer credential — no exporter runs.":
    "- El recolector lee el propio endpoint OpenMetrics de la FlashArray por HTTPS, con el token como credencial Bearer: no se ejecuta ningún exportador.",
  "- **One scrape job per endpoint**, each read as often as it is worth: `/metrics/array` every 60 seconds; `/metrics/volumes`, `/metrics/hosts` and `/metrics/pods` every 2 minutes; `/metrics/directories` every 30 minutes — directory space is expensive for the array to compute.":
    "- **Una tarea de recopilación por endpoint**, cada una leída tan a menudo como merece: `/metrics/array` cada 60 segundos; `/metrics/volumes`, `/metrics/hosts` y `/metrics/pods` cada 2 minutos; `/metrics/directories` cada 30 minutos, porque a la cabina le cuesta calcular el espacio de los directorios.",
  "- **Every job labels its series `scrape_endpoint: <endpoint>`**, so OneUptime knows which objects a batch is the complete list of — that is how a deleted object leaves the inventory. Keep the labels as shipped.":
    "- **Cada tarea etiqueta sus series con `scrape_endpoint: <endpoint>`**, para que OneUptime sepa de qué objetos un lote es la lista completa: así es como un objeto eliminado sale del inventario. Mantén las etiquetas tal como vienen.",
  "- **Per-volume and per-host latency keeps three dimensions** (`usec_per_read_op`, `usec_per_write_op`, `usec_per_mirrored_write_op`); a `metric_relabel_configs` rule drops the QoS, queue, SAN and service-time breakdown, which multiplies the series count of a large array. The array-wide breakdown is kept.":
    "- **La latencia por volumen y por host conserva tres dimensiones** (`usec_per_read_op`, `usec_per_write_op`, `usec_per_mirrored_write_op`); una regla de `metric_relabel_configs` descarta el desglose de QoS, cola, SAN y tiempo de servicio, que multiplica el número de series de una cabina grande. Se conserva el desglose de toda la cabina.",
  "- **No `send_batch_max_size`.** OneUptime rebuilds the inventory from one whole scrape, so the `batch` processor never splits one.":
    "- **Sin `send_batch_max_size`.** OneUptime reconstruye el inventario a partir de una recopilación completa, así que el procesador `batch` nunca divide una.",
  "This is the full `otel-collector-config.yaml` the agent runs; the `.env` file supplies the `${env:...}` values:":
    "Este es el `otel-collector-config.yaml` completo que ejecuta el agente; el archivo `.env` aporta los valores `${env:...}`:",
  "The agent ships metrics only until you turn on its syslog receivers. Arrays forward their alerts and audit events as syslog; the agent stamps `storage.array.name` on every line, so they land on this array's **Logs** page.":
    "El agente solo envía métricas hasta que activas sus receptores de syslog. Las cabinas reenvían sus alertas y eventos de auditoría como syslog; el agente estampa `storage.array.name` en cada línea, así que llegan a la página **Registros** de esta cabina.",
  "1. In `otel-collector-config.yaml`, uncomment the `syslog/tcp` and `syslog/udp` receivers and the `logs` pipeline. Classic BSD syslog timestamps carry no time zone: set `location` to the array's time zone unless its clock runs on UTC.":
    "1. En `otel-collector-config.yaml`, quita el comentario de los receptores `syslog/tcp` y `syslog/udp` y del pipeline `logs`. Las marcas de tiempo del syslog BSD clásico no llevan zona horaria: establece `location` en la zona horaria de la cabina, salvo que su reloj funcione en UTC.",
  "2. In `docker-compose.yml`, uncomment the `ports:` block that publishes `5514/tcp` and `5514/udp`, and open the port on the machine's firewall for the array's management network.":
    "2. En `docker-compose.yml`, quita el comentario del bloque `ports:` que publica `5514/tcp` y `5514/udp`, y abre el puerto en el firewall de la máquina para la red de gestión de la cabina.",
  "3. Apply both:": "3. Aplica ambos:",
  "4. On the FlashArray, as an administrator, open **Settings → System → Syslog Servers**, add `udp://<agent-host>:5514` (or `tcp://<agent-host>:5514`) and send a test message.":
    "4. En la FlashArray, como administrador, abre **Settings → System → Syslog Servers**, añade `udp://<agent-host>:5514` (o `tcp://<agent-host>:5514`) y envía un mensaje de prueba.",
  "Any resource attribute prefixed with `oneuptime.label.` becomes a project label on the array: `oneuptime.label.<dimension>=<value>` is the label `<dimension>:<value>`. Add them to the `resource` processor of the collector config you use, next to `storage.array.name`:":
    "Cualquier atributo de recurso con el prefijo `oneuptime.label.` se convierte en una etiqueta de proyecto en la cabina: `oneuptime.label.<dimension>=<value>` es la etiqueta `<dimension>:<value>`. Añádelos al procesador `resource` de la configuración del recolector que uses, junto a `storage.array.name`:",
  "Then restart the collector so it reads the new config:":
    "Después reinicia el recolector para que lea la nueva configuración:",
  "The array shows up tagged `team:storage` and `env:production`. Labels are matched case-insensitively, so an existing `Production` label is reused; labels added in the OneUptime UI are never removed by the agent.":
    "La cabina aparece con las etiquetas `team:storage` y `env:production`. Las etiquetas se comparan sin distinguir mayúsculas, así que se reutiliza una etiqueta `Production` existente; el agente nunca elimina las etiquetas añadidas en la interfaz de OneUptime.",
  "Every value is a gauge the FlashArray computes itself — latency per operation in microseconds, throughput per second. OneUptime's Storage Array pages, metric catalog and alert templates are built on:":
    "Cada valor es un medidor que la FlashArray calcula por sí misma: latencia por operación en microsegundos, rendimiento por segundo. Las páginas de cabinas de almacenamiento de OneUptime, su catálogo de métricas y sus plantillas de alertas se basan en:",
  "| Endpoint | Data |": "| Endpoint | Datos |",
  "| **Array** (`/metrics/array`) | `purefa_info`, capacity and data reduction (`purefa_array_space_*`), performance, open alerts (`purefa_alerts_open`), hardware components, drives, controllers and network interfaces |":
    "| **Cabina** (`/metrics/array`) | `purefa_info`, capacidad y reducción de datos (`purefa_array_space_*`), rendimiento, alertas abiertas (`purefa_alerts_open`), componentes de hardware, unidades, controladoras e interfaces de red |",
  "| **Volumes** (`/metrics/volumes`) | Latency, IOPS, bandwidth, space and data reduction per volume |":
    "| **Volúmenes** (`/metrics/volumes`) | Latencia, IOPS, ancho de banda, espacio y reducción de datos por volumen |",
  "| **Hosts** (`/metrics/hosts`) | Connectivity, connected volumes, latency, IOPS and space per host |":
    "| **Hosts** (`/metrics/hosts`) | Conectividad, volúmenes conectados, latencia, IOPS y espacio por host |",
  "| **Pods** (`/metrics/pods`) | ActiveCluster and ActiveDR replica link lag, mediator status, performance and space |":
    "| **Pods** (`/metrics/pods`) | Retraso del enlace de réplica de ActiveCluster y ActiveDR, estado del mediador, rendimiento y espacio |",
  "| **Directories** (`/metrics/directories`) | Space and performance of FlashArray file services' managed directories |":
    "| **Directorios** (`/metrics/directories`) | Espacio y rendimiento de los directorios gestionados de los servicios de archivos de FlashArray |",
  "One agent reads one array. To monitor several from the same machine, install each into its own folder with its own `.env`, and give each its own `container_name` in its `docker-compose.yml` (for example `oneuptime-storage-array-agent-fa02`) — two containers cannot share a name:":
    "Un agente lee una cabina. Para supervisar varias desde la misma máquina, instala cada uno en su propia carpeta con su propio `.env` y da a cada uno su propio `container_name` en su `docker-compose.yml` (por ejemplo, `oneuptime-storage-array-agent-fa02`), porque dos contenedores no pueden compartir nombre:",
  "The agent ships a systemd unit that assumes the install script's folder, `/opt/oneuptime-storage-array-agent`. The install script does not download it, so fetch it:":
    "El agente incluye una unidad de systemd que da por hecha la carpeta del script de instalación, `/opt/oneuptime-storage-array-agent`. El script de instalación no la descarga, así que descárgala tú:",
  "**Upgrade** — the collector image is pinned in `docker-compose.yml` and its configs are files beside it, so pulling alone does not move the agent forward. Re-run the install script. It reuses every value in your existing `.env` (nothing is prompted for again), downloads the latest `docker-compose.yml` and collector configs — a file you edited is kept next to the new one as `<file>.bak.<timestamp>` — and recreates the agent with them:":
    "**Actualizar**: la imagen del recolector está fijada en `docker-compose.yml` y sus configuraciones son archivos a su lado, así que descargar la imagen no basta para actualizar el agente. Vuelve a ejecutar el script de instalación. Reutiliza cada valor de tu `.env` existente (no se vuelve a preguntar nada), descarga los últimos `docker-compose.yml` y configuraciones del recolector (un archivo que editaste se conserva junto al nuevo como `<file>.bak.<timestamp>`) y vuelve a crear el agente con ellos:",
  "An agent installed outside `/opt/oneuptime-storage-array-agent` (a second array's, say) needs its folder: `INSTALL_DIR=<folder> bash install.sh`.":
    "Un agente instalado fuera de `/opt/oneuptime-storage-array-agent` (el de una segunda cabina, por ejemplo) necesita su carpeta: `INSTALL_DIR=<folder> bash install.sh`.",
  "Installed it with Docker Compose instead? In the agent's folder, download the compose file and the collector configs again; your `.env` stays, and a change you made to any of them has to be made again:":
    "¿Lo instalaste con Docker Compose? En la carpeta del agente, vuelve a descargar el archivo compose y las configuraciones del recolector; tu `.env` se conserva, y un cambio que hiciste en cualquiera de ellos hay que volver a hacerlo:",
  "Then pull the images and recreate the agent, so the collector reads its new config:":
    "Después descarga las imágenes y vuelve a crear el agente, para que el recolector lea su nueva configuración:",
  "The config reports the collector version it pins as the array's **Agent Version**. When this OneUptime pins a newer one, a warning sign beside it opens these commands.":
    "La configuración informa de la versión del recolector que fija como la **Versión del agente** de la cabina. Cuando este OneUptime fija una más nueva, una señal de advertencia a su lado abre estos comandos.",
  "**Uninstall** the agent:": "**Desinstala** el agente:",
  "Then delete the read-only user and its API token on the array if you no longer need them.":
    "Después elimina el usuario de solo lectura y su token de API en la cabina si ya no los necesitas.",
  "`troubleshoot.sh` checks the whole chain — container runtime, the array endpoint exactly as the collector reaches it (the native endpoint or Pure's exporter, DNS, TLS, the API token), array-name stamping, collector self-metrics — and asks OneUptime directly whether it accepts your ingestion key. That last check matters most: OneUptime's OTLP endpoints refuse a bad key with `401` or `422`, which the collector logs as a single `Exporting failed` line per batch that is easy to miss, so the script asks `GET /otlp/v1/validate` for a direct 200/401 verdict.":
    "`troubleshoot.sh` comprueba toda la cadena (el runtime de contenedores, el endpoint de la cabina exactamente como lo alcanza el recolector, ya sea el endpoint nativo o el exportador de Pure, con DNS, TLS y el token de API, el estampado del nombre de la cabina, las métricas propias del recolector) y pregunta directamente a OneUptime si acepta tu clave de ingesta. Esa última comprobación es la que más importa: los endpoints OTLP de OneUptime rechazan una clave incorrecta con `401` o `422`, lo que el recolector registra como una sola línea `Exporting failed` por lote, fácil de pasar por alto, así que el script consulta `GET /otlp/v1/validate` para obtener un veredicto directo 200/401.",
  "It ends with a verdict naming the most likely cause.":
    "Termina con un veredicto que nombra la causa más probable.",
  "1. Check the collector logs: `docker logs oneuptime-storage-array-agent`. `server returned HTTP status 401` means the array refused the API token, `404` means the FlashArray has no native endpoint, `x509` means TLS verification is on against the array's self-signed certificate, `no such host` or `connection refused` means a wrong `PURE_FA_ENDPOINT`, and an export `401` means a bad ingestion key.":
    "1. Revisa los registros del recolector: `docker logs oneuptime-storage-array-agent`. `server returned HTTP status 401` significa que la cabina rechazó el token de API; `404`, que la FlashArray no tiene endpoint nativo; `x509`, que la verificación TLS está activa frente al certificado autofirmado de la cabina; `no such host` o `connection refused`, un `PURE_FA_ENDPOINT` incorrecto, y un `401` al exportar, una clave de ingesta incorrecta.",
  "2. Make sure `STORAGE_ARRAY_NAME` is set — discovery keys on the `storage.array.name` resource attribute, and the collector refuses to start without it.":
    "2. Asegúrate de que `STORAGE_ARRAY_NAME` está definido: el descubrimiento se basa en el atributo de recurso `storage.array.name`, y el recolector se niega a arrancar sin él.",
  "3. Make sure `STORAGE_ARRAY_COLLECTOR_CONFIG` and `COMPOSE_PROFILES` name the same platform.":
    "3. Asegúrate de que `STORAGE_ARRAY_COLLECTOR_CONFIG` y `COMPOSE_PROFILES` nombran la misma plataforma.",
  "Its Purity//FA has no native OpenMetrics endpoint. Set `STORAGE_ARRAY_COLLECTOR_CONFIG=otel-collector-config.flasharray-exporter.yaml` and `COMPOSE_PROFILES=flasharray-exporter` in `.env` and run `docker compose up -d` — or re-run `install.sh` with the older-Purity choice. After upgrading the array to Purity//FA 6.7 or later, switch back to the native config and drop the profile.":
    "Su Purity//FA no tiene endpoint OpenMetrics nativo. Establece `STORAGE_ARRAY_COLLECTOR_CONFIG=otel-collector-config.flasharray-exporter.yaml` y `COMPOSE_PROFILES=flasharray-exporter` en `.env` y ejecuta `docker compose up -d`, o vuelve a ejecutar `install.sh` con la opción de Purity anterior. Después de actualizar la cabina a Purity//FA 6.7 o posterior, vuelve a la configuración nativa y quita el perfil.",
  "Check that you pasted the token, not the user's password; that the user still exists and holds the readonly role; and that the token has not expired. Create a new token (`pureadmin create --api-token oneuptime` on a FlashArray), put it in `.env` as `PURE_FA_API_TOKEN` and run `docker compose up -d`.":
    "Comprueba que pegaste el token y no la contraseña del usuario, que el usuario sigue existiendo y tiene el rol readonly, y que el token no ha caducado. Crea un token nuevo (`pureadmin create --api-token oneuptime` en una FlashArray), ponlo en `.env` como `PURE_FA_API_TOKEN` y ejecuta `docker compose up -d`.",
  "Arrays present a self-signed certificate by default, which no Docker image trusts. Set `STORAGE_ARRAY_INSECURE_SKIP_VERIFY=true` (the pragmatic choice on a private management network), or install a certificate on the array from a CA the collector image trusts.":
    "Las cabinas presentan por defecto un certificado autofirmado, en el que no confía ninguna imagen de Docker. Establece `STORAGE_ARRAY_INSECURE_SKIP_VERIFY=true` (la opción pragmática en una red de gestión privada) o instala en la cabina un certificado de una CA en la que confíe la imagen del recolector.",
  "`pure-fa-exporter` or `pure-fb-exporter` is not running: `COMPOSE_PROFILES` must match `STORAGE_ARRAY_COLLECTOR_CONFIG` — `flasharray-exporter` for the FlashArray exporter config, `flashblade` for the FlashBlade config. Fix `.env` and run `docker compose up -d`; `docker compose ps` then lists the exporter.":
    "`pure-fa-exporter` o `pure-fb-exporter` no se está ejecutando: `COMPOSE_PROFILES` debe coincidir con `STORAGE_ARRAY_COLLECTOR_CONFIG`, es decir, `flasharray-exporter` para la configuración del exportador de FlashArray y `flashblade` para la configuración de FlashBlade. Corrige `.env` y ejecuta `docker compose up -d`; después `docker compose ps` muestra el exportador.",
  "1. Check that the agent is running: `docker ps --filter name=oneuptime-storage-array-agent`":
    "1. Comprueba que el agente se está ejecutando: `docker ps --filter name=oneuptime-storage-array-agent`",
  "2. Check the agent logs for errors: `docker logs oneuptime-storage-array-agent 2>&1 | grep -i error`":
    "2. Busca errores en los registros del agente: `docker logs oneuptime-storage-array-agent 2>&1 | grep -i error`",
  "3. Verify your OneUptime URL and ingestion key are correct.":
    "3. Comprueba que tu URL de OneUptime y tu clave de ingesta son correctas.",
  "4. Ensure the agent machine can reach the OneUptime instance over the network.":
    "4. Asegúrate de que la máquina del agente puede llegar a la instancia de OneUptime por la red.",
  "The array's identity comes from `STORAGE_ARRAY_NAME`, stamped on every metric as `storage.array.name`. Fix it in `.env` and apply it with `docker compose up -d` in the agent's folder — note that a new name registers a new storage array.":
    "La identidad de la cabina viene de `STORAGE_ARRAY_NAME`, estampado en cada métrica como `storage.array.name`. Corrígelo en `.env` y aplícalo con `docker compose up -d` en la carpeta del agente; ten en cuenta que un nombre nuevo registra una cabina de almacenamiento nueva.",
  "It registers the array as **`array-1`** — the name this array already has in OneUptime.":
    "Registra la cabina como **`array-1`**, el nombre que esta cabina ya tiene en OneUptime.",
  "- This installs the agent for **`array-1`** — keep `STORAGE_ARRAY_NAME` exactly as it is, or the data registers as a new storage array.":
    "- Esto instala el agente para **`array-1`**: deja `STORAGE_ARRAY_NAME` exactamente como está, o los datos se registrarán como una cabina de almacenamiento nueva.",
  "The array's identity comes from `STORAGE_ARRAY_NAME`, stamped on every metric as `storage.array.name`. This array is **`array-1`**. Fix it in `.env` and apply it with `docker compose up -d` in the agent's folder — note that a new name registers a new storage array.":
    "La identidad de la cabina viene de `STORAGE_ARRAY_NAME`, estampado en cada métrica como `storage.array.name`. Esta cabina es **`array-1`**. Corrígelo en `.env` y aplícalo con `docker compose up -d` en la carpeta del agente; ten en cuenta que un nombre nuevo registra una cabina de almacenamiento nueva.",
  "The command already carries your OneUptime URL, ingestion key and the platform you picked above. The script asks for:":
    "El comando ya lleva tu URL de OneUptime, tu clave de ingesta y la plataforma que elegiste arriba. El script pide:",
  "Access from that machine to `quay.io`, where Docker pulls Pure's exporter image":
    "Acceso desde esa máquina a `quay.io`, de donde Docker descarga la imagen del exportador de Pure",
  "- `COMPOSE_PROFILES=flasharray-exporter` starts `pure-fa-exporter`, Pure's exporter, next to the collector; the two must match.":
    "- `COMPOSE_PROFILES=flasharray-exporter` inicia `pure-fa-exporter`, el exportador de Pure, junto al recolector; ambos deben coincidir.",
  "`docker compose ps` in the agent's folder also lists **`pure-fa-exporter`**, Pure's exporter, which the collector reads the FlashArray through.":
    "`docker compose ps` en la carpeta del agente también muestra **`pure-fa-exporter`**, el exportador de Pure, a través del cual el recolector lee la FlashArray.",
  "- The collector reads the FlashArray through `pure-fa-exporter`, Pure's exporter, which logs in to the FlashArray's REST API with the token the collector sends on every scrape. The exporter's port stays on the compose network.":
    "- El recolector lee la FlashArray a través de `pure-fa-exporter`, el exportador de Pure, que inicia sesión en la API REST de la FlashArray con el token que el recolector envía en cada recopilación. El puerto del exportador se queda en la red de compose.",
  "Docker Engine 20.10+ with the Docker Compose v2 plugin, on a machine that can reach the FlashBlade's management address over HTTPS (TCP 443)":
    "Docker Engine 20.10 o posterior con el plugin Docker Compose v2, en una máquina que pueda llegar a la dirección de gestión de la FlashBlade por HTTPS (TCP 443)",
  "An administrator account on the FlashBlade, to create the agent's read-only user":
    "Una cuenta de administrador en la FlashBlade, para crear el usuario de solo lectura del agente",
  "On the FlashBlade, as an administrator, create a user named `oneuptime` with the **readonly** role — in the FlashBlade GUI's user settings, or with `pureadmin` in the Purity//FB CLI — and create an **API token** for it. Create the token **without an expiry**, or the agent stops the day it expires.":
    "En la FlashBlade, como administrador, crea un usuario llamado `oneuptime` con el rol **readonly** (en los ajustes de usuarios de la interfaz gráfica de la FlashBlade o con `pureadmin` en la CLI de Purity//FB) y crea un **token de API** para él. Crea el token **sin caducidad**, o el agente se detendrá el día en que caduque.",
  "FlashBlade API tokens start with `T-`. A Purity//FB release without local users takes a directory service (LDAP or Active Directory) account whose group maps to the readonly role instead.":
    "Los tokens de API de FlashBlade empiezan por `T-`. Una versión de Purity//FB sin usuarios locales usa en su lugar una cuenta de un servicio de directorio (LDAP o Active Directory) cuyo grupo se asigna al rol readonly.",
  "- the FlashBlade's **management address** (host name or IP, no `https://`) and the read-only user's **API token**, which it reads without echoing":
    "- la **dirección de gestión** de la FlashBlade (nombre de host o IP, sin `https://`) y el **token de API** del usuario de solo lectura, que lee sin mostrarlo",
  "- Set `PURE_FB_ENDPOINT` to the FlashBlade's management address — host name or IP, no `https://` — and `PURE_FB_API_TOKEN` to the read-only user's API token. Run `chmod 600 .env`: it holds the token.":
    "- Establece `PURE_FB_ENDPOINT` en la dirección de gestión de la FlashBlade (nombre de host o IP, sin `https://`) y `PURE_FB_API_TOKEN` en el token de API del usuario de solo lectura. Ejecuta `chmod 600 .env`: contiene el token.",
  "`docker compose ps` in the agent's folder also lists **`pure-fb-exporter`**, Pure's exporter, which the collector reads the FlashBlade through.":
    "`docker compose ps` en la carpeta del agente también muestra **`pure-fb-exporter`**, el exportador de Pure, a través del cual el recolector lee la FlashBlade.",
  "- The collector reads the FlashBlade through `pure-fb-exporter`, Pure's exporter, which logs in to the FlashBlade's REST API with the token the collector sends on every scrape. The exporter's port stays on the compose network.":
    "- El recolector lee la FlashBlade a través de `pure-fb-exporter`, el exportador de Pure, que inicia sesión en la API REST de la FlashBlade con el token que el recolector envía en cada recopilación. El puerto del exportador se queda en la red de compose.",
  "- **One scrape job per endpoint**, each read as often as it is worth: `/metrics/array` every 60 seconds; `/metrics/filesystems` and `/metrics/objectstore` every 5 minutes — the FlashBlade REST API is not built to report every file system and bucket quickly.":
    "- **Una tarea de recopilación por endpoint**, cada una leída tan a menudo como merece: `/metrics/array` cada 60 segundos; `/metrics/filesystems` y `/metrics/objectstore` cada 5 minutos, porque la API REST de la FlashBlade no está hecha para informar rápido de cada sistema de archivos y cada bucket.",
  "4. On the FlashBlade, as an administrator, add a syslog server `udp://<agent-host>:5514` (or `tcp://`) in its syslog settings.":
    "4. En la FlashBlade, como administrador, añade un servidor syslog `udp://<agent-host>:5514` (o `tcp://`) en sus ajustes de syslog.",
  "Every value is a gauge the FlashBlade computes itself — latency per operation in microseconds, throughput per second. OneUptime's Storage Array pages, metric catalog and alert templates are built on:":
    "Cada valor es un medidor que la FlashBlade calcula por sí misma: latencia por operación en microsegundos, rendimiento por segundo. Las páginas de cabinas de almacenamiento de OneUptime, su catálogo de métricas y sus plantillas de alertas se basan en:",
  "| **Array** (`/metrics/array`) | `purefb_info`, capacity and data reduction (`purefb_array_space_*`), performance per protocol, open alerts (`purefb_alerts_open`), hardware health (`purefb_hardware_health`) |":
    "| **Cabina** (`/metrics/array`) | `purefb_info`, capacidad y reducción de datos (`purefb_array_space_*`), rendimiento por protocolo, alertas abiertas (`purefb_alerts_open`), estado del hardware (`purefb_hardware_health`) |",
  "| **File systems** (`/metrics/filesystems`) | Space, data reduction and performance per file system |":
    "| **Sistemas de archivos** (`/metrics/filesystems`) | Espacio, reducción de datos y rendimiento por sistema de archivos |",
  "| **Object store** (`/metrics/objectstore`) | Space, quota, object counts and performance per bucket |":
    "| **Almacén de objetos** (`/metrics/objectstore`) | Espacio, cuota, número de objetos y rendimiento por bucket |",
  "Docker Engine 20.10+ with the Docker Compose v2 plugin, on a machine that reaches every node of the cluster on UDP 161 (SNMP)":
    "Docker Engine 20.10 o posterior con el plugin Docker Compose v2, en una máquina que llegue a todos los nodos del clúster por UDP 161 (SNMP)",
  "An administrator account on the cluster, to turn on SNMP and set the agent's read-only community or SNMPv3 user":
    "Una cuenta de administrador en el clúster, para activar SNMP y configurar la comunidad de solo lectura o el usuario SNMPv3 del agente",
  "SSH to any node as an administrator: OneFS applies SNMP settings to the whole cluster. If the cluster already answers SNMP for another tool, give the agent the same community or user and skip this step. Otherwise, turn on SNMP v2c with a read-only community of your own, not OneFS's default `I$ilonpublic`:":
    "Conéctate por SSH a cualquier nodo como administrador: OneFS aplica la configuración de SNMP a todo el clúster. Si el clúster ya responde a SNMP para otra herramienta, dale al agente la misma comunidad o el mismo usuario y sáltate este paso. Si no, activa SNMP v2c con una comunidad de solo lectura propia, no la predeterminada de OneFS, `I$ilonpublic`:",
  "Or turn on SNMPv3, which authenticates and encrypts every poll. OneFS has one SNMPv3 read-only user, `general` until you rename it: give it passwords of at least eight characters, without spaces:":
    "O activa SNMPv3, que autentica y cifra cada consulta. OneFS tiene un único usuario SNMPv3 de solo lectura, `general` hasta que le cambies el nombre: dale contraseñas de al menos ocho caracteres, sin espacios:",
  "`isi snmp settings view` shows the settings, with the user's authentication and privacy protocols. Allow UDP 161 from the agent's machine to every node, and list the nodes' addresses with `isi network interfaces list`.":
    "`isi snmp settings view` muestra la configuración, con los protocolos de autenticación y de privacidad del usuario. Permite UDP 161 desde la máquina del agente hacia cada nodo y lista las direcciones de los nodos con `isi network interfaces list`.",
  "- **every node's address**, separated by commas: each node's own address, never the SmartConnect zone name, since a node answers only for its own drives, sensors and ports":
    "- las **direcciones de todos los nodos**, separadas por comas: la dirección propia de cada nodo, nunca el nombre de la zona SmartConnect, porque un nodo solo responde por sus propias unidades, sensores y puertos",
  "- the **SNMP version**, then the read-only **community**, or the SNMPv3 **user** and its two passwords, each read without echo":
    "- la **versión de SNMP**, luego la **comunidad** de solo lectura, o el **usuario** SNMPv3 y sus dos contraseñas, cada una leída sin mostrarla",
  "A user whose protocols are not SHA and AES needs `POWERSCALE_SNMP_AUTH_PROTOCOL` and `POWERSCALE_SNMP_PRIVACY_PROTOCOL` in front of `bash install.sh`, and a user without privacy `POWERSCALE_SNMP_SECURITY_LEVEL=auth_no_priv`.":
    "Un usuario cuyos protocolos no sean SHA y AES necesita `POWERSCALE_SNMP_AUTH_PROTOCOL` y `POWERSCALE_SNMP_PRIVACY_PROTOCOL` delante de `bash install.sh`, y un usuario sin privacidad, `POWERSCALE_SNMP_SECURITY_LEVEL=auth_no_priv`.",
  "It installs to `/opt/oneuptime-storage-array-agent`, writes a `.env` file only you can read (it holds the community or the SNMPv3 passwords), with one poll per node, and starts the agent with Docker Compose. When the cluster gains a node, add its address to `POWERSCALE_NODES` in that file and run `bash install.sh` again.":
    "Se instala en `/opt/oneuptime-storage-array-agent`, escribe un archivo `.env` que solo tú puedes leer (contiene la comunidad o las contraseñas SNMPv3), con una consulta por nodo, e inicia el agente con Docker Compose. Cuando el clúster sume un nodo, añade su dirección a `POWERSCALE_NODES` en ese archivo y vuelve a ejecutar `bash install.sh`.",
  "- Replace `my-storage-array` with a name for this cluster, such as `ps-prod`. It is how the cluster appears in OneUptime, so keep it stable: a new name registers a new storage array.":
    "- Sustituye `my-storage-array` por un nombre para este clúster, como `ps-prod`. Es como aparece el clúster en OneUptime, así que mantenlo estable: un nombre nuevo registra una cabina de almacenamiento nueva.",
  "- List every node in `POWERSCALE_NODES` and give each its own `POWERSCALE_NODE_<n>` and `snmp/node-<n>` in `POWERSCALE_SNMP_RECEIVERS`, up to 252, after `snmp/cluster` and `snmp/quotas`. An IPv6 address goes in brackets, such as `[fd00::11]`.":
    "- Enumera cada nodo en `POWERSCALE_NODES` y da a cada uno su propio `POWERSCALE_NODE_<n>` y su propio `snmp/node-<n>` en `POWERSCALE_SNMP_RECEIVERS`, hasta 252, después de `snmp/cluster` y `snmp/quotas`. Una dirección IPv6 va entre corchetes, como `[fd00::11]`.",
  "- For SNMPv3, set `POWERSCALE_SNMP_VERSION=v3`, `POWERSCALE_SNMP_USER`, `POWERSCALE_SNMP_AUTH_PASSWORD` and `POWERSCALE_SNMP_PRIVACY_PASSWORD` instead of the community. Run `chmod 600 .env`: it holds the community or the passwords.":
    "- Para SNMPv3, establece `POWERSCALE_SNMP_VERSION=v3`, `POWERSCALE_SNMP_USER`, `POWERSCALE_SNMP_AUTH_PASSWORD` y `POWERSCALE_SNMP_PRIVACY_PASSWORD` en lugar de la comunidad. Ejecuta `chmod 600 .env`: contiene la comunidad o las contraseñas.",
  "| `STORAGE_ARRAY_NAME` | Yes | The name this cluster registers under in OneUptime, stamped on every metric as `storage.array.name`. Keep it stable — changing it registers a new storage array |":
    "| `STORAGE_ARRAY_NAME` | Sí | El nombre con el que este clúster se registra en OneUptime, estampado en cada métrica como `storage.array.name`. Mantenlo estable: cambiarlo registra una cabina de almacenamiento nueva |",
  "| `STORAGE_SYSTEM` | Yes | `dell.powerscale` |":
    "| `STORAGE_SYSTEM` | Sí | `dell.powerscale` |",
  "| `STORAGE_ARRAY_COLLECTOR_CONFIG` | Yes | `otel-collector-config.powerscale.yaml` |":
    "| `STORAGE_ARRAY_COLLECTOR_CONFIG` | Sí | `otel-collector-config.powerscale.yaml` |",
  "| `POWERSCALE_NODES` | Yes | Every node's address, separated by commas. The install script writes the polls below from it |":
    "| `POWERSCALE_NODES` | Sí | Las direcciones de todos los nodos, separadas por comas. El script de instalación escribe a partir de ellas las consultas de abajo |",
  "| `POWERSCALE_ENDPOINT` | Yes | The node the cluster's own health, capacity and quotas are read through: the first in `POWERSCALE_NODES` |":
    "| `POWERSCALE_ENDPOINT` | Sí | El nodo a través del cual se leen la salud, la capacidad y las cuotas del propio clúster: el primero de `POWERSCALE_NODES` |",
  "| `POWERSCALE_SNMP_RECEIVERS` | Yes | The polls the collector runs: `snmp/cluster`, `snmp/quotas`, then `snmp/node-<n>` for each node |":
    "| `POWERSCALE_SNMP_RECEIVERS` | Sí | Las consultas que ejecuta el recolector: `snmp/cluster`, `snmp/quotas` y luego `snmp/node-<n>` para cada nodo |",
  "| `POWERSCALE_NODE_<n>` | Yes | Node `<n>`'s address, from 1 to 252 |":
    "| `POWERSCALE_NODE_<n>` | Sí | La dirección del nodo `<n>`, de 1 a 252 |",
  "| `POWERSCALE_SNMP_VERSION` | No | `v2c` (default) or `v3` |":
    "| `POWERSCALE_SNMP_VERSION` | No | `v2c` (predeterminado) o `v3` |",
  "| `POWERSCALE_SNMP_COMMUNITY` | SNMP v2c | The cluster's read-only community |":
    "| `POWERSCALE_SNMP_COMMUNITY` | SNMP v2c | La comunidad de solo lectura del clúster |",
  "| `POWERSCALE_SNMP_USER` | SNMPv3 | The cluster's SNMPv3 read-only user |":
    "| `POWERSCALE_SNMP_USER` | SNMPv3 | El usuario SNMPv3 de solo lectura del clúster |",
  "| `POWERSCALE_SNMP_SECURITY_LEVEL` | No | `auth_priv` (default), `auth_no_priv` or `no_auth_no_priv` |":
    "| `POWERSCALE_SNMP_SECURITY_LEVEL` | No | `auth_priv` (predeterminado), `auth_no_priv` o `no_auth_no_priv` |",
  "| `POWERSCALE_SNMP_AUTH_PROTOCOL` | No | `SHA` (default), `MD5`, `SHA224`, `SHA256`, `SHA384` or `SHA512` |":
    "| `POWERSCALE_SNMP_AUTH_PROTOCOL` | No | `SHA` (predeterminado), `MD5`, `SHA224`, `SHA256`, `SHA384` o `SHA512` |",
  "| `POWERSCALE_SNMP_AUTH_PASSWORD` | SNMPv3 | The SNMPv3 user's authentication password |":
    "| `POWERSCALE_SNMP_AUTH_PASSWORD` | SNMPv3 | La contraseña de autenticación del usuario SNMPv3 |",
  "| `POWERSCALE_SNMP_PRIVACY_PROTOCOL` | No | `AES` (default), `DES`, `AES192`, `AES256`, `AES192C` or `AES256C` |":
    "| `POWERSCALE_SNMP_PRIVACY_PROTOCOL` | No | `AES` (predeterminado), `DES`, `AES192`, `AES256`, `AES192C` o `AES256C` |",
  "| `POWERSCALE_SNMP_PRIVACY_PASSWORD` | SNMPv3 | The SNMPv3 user's privacy password |":
    "| `POWERSCALE_SNMP_PRIVACY_PASSWORD` | SNMPv3 | La contraseña de privacidad del usuario SNMPv3 |",
  "- **One collector, no exporter.** The collector's own SNMP receiver reads Dell's ISILON-MIB; nothing else runs beside it.":
    "- **Un recolector, ningún exportador.** El propio receptor SNMP del recolector lee la ISILON-MIB de Dell; no se ejecuta nada más a su lado.",
  "- **The cluster's objects once, through `POWERSCALE_ENDPOINT`:** its health, capacity, throughput and node counts every 60 seconds (`snmp/cluster`), and its SmartQuotas every 5 minutes (`snmp/quotas`).":
    "- **Los objetos del clúster una sola vez, a través de `POWERSCALE_ENDPOINT`:** su salud, capacidad, rendimiento y recuentos de nodos cada 60 segundos (`snmp/cluster`), y sus SmartQuotas cada 5 minutos (`snmp/quotas`).",
  "- **Each node's from the node:** its health, CPU, protocol performance, drives, sensors and ports every 60 seconds (`snmp/node-<n>`).":
    "- **Los de cada nodo, desde el propio nodo:** su salud, CPU, rendimiento de protocolos, unidades, sensores y puertos cada 60 segundos (`snmp/node-<n>`).",
  "- **Every poll labels its series `scrape_endpoint: <poll>`**, so OneUptime knows which objects a batch is the complete list of — that is how a deleted quota leaves the inventory. Keep the labels as shipped.":
    "- **Cada consulta etiqueta sus series con `scrape_endpoint: <poll>`**, para que OneUptime sepa de qué objetos un lote es la lista completa: así es como una cuota eliminada sale del inventario. Mantén las etiquetas tal como vienen.",
  "The full config, one SNMP receiver per node slot, is `otel-collector-config.powerscale.yaml` in the agent's folder:":
    "La configuración completa, con un receptor SNMP por cada hueco de nodo, es `otel-collector-config.powerscale.yaml` en la carpeta del agente:",
  "Then turn SNMP off on the cluster, or change the agent's community or SNMPv3 passwords, if nothing else polls it.":
    "Después desactiva SNMP en el clúster, o cambia la comunidad o las contraseñas SNMPv3 del agente, si nada más lo consulta.",
  "`troubleshoot.sh` checks the whole chain — the container runtime, the node addresses and the community or SNMPv3 user in `.env`, each node with `snmpget` when the machine has it, array-name stamping, collector self-metrics — and asks OneUptime directly whether it accepts your ingestion key.":
    "`troubleshoot.sh` comprueba toda la cadena (el runtime de contenedores, las direcciones de los nodos y la comunidad o el usuario SNMPv3 de `.env`, cada nodo con `snmpget` si la máquina lo tiene, el estampado del nombre de la cabina, las métricas propias del recolector) y pregunta directamente a OneUptime si acepta tu clave de ingesta.",
  "`Error scraping metrics` with `request timeout` in `docker logs oneuptime-storage-array-agent` names a node that does not answer SNMP from this machine: SNMP is off for the version the agent uses, the community or SNMPv3 user is not the cluster's, or UDP 161 is blocked on the way. A node that answers but is missing from the cluster's nodes is not in `POWERSCALE_NODES`: add it and run `bash install.sh` again.":
    "`Error scraping metrics` con `request timeout` en `docker logs oneuptime-storage-array-agent` señala un nodo que no responde a SNMP desde esta máquina: SNMP está desactivado para la versión que usa el agente, la comunidad o el usuario SNMPv3 no son los del clúster, o UDP 161 está bloqueado por el camino. Un nodo que responde pero falta entre los nodos del clúster no está en `POWERSCALE_NODES`: añádelo y vuelve a ejecutar `bash install.sh`.",
};

export default TRANSLATION;
