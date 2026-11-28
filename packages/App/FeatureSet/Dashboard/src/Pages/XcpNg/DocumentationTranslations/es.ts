import { SetupGuideTranslation } from "../../../Components/SetupGuide/SetupGuideTranslation";

/*
 * The XcpNg setup guide in Spanish (#8341): each piece of the English
 * guide's markdown (Pages/XcpNg/Utils/DocumentationMarkdown.ts) and its
 * Spanish. Code, field names and product names are as the English writes
 * them, and what the Dashboard draws is named as its Spanish words it.
 * Change it with the English, in the same pull request
 * (SetupGuideDocumentationInLocale).
 */
const TRANSLATION: SetupGuideTranslation = {
  "Xen Orchestra 6.9 or later, connected to the pools you want to monitor. Its OpenMetrics plugin needs a Premium licence on an XOA; Xen Orchestra built from sources includes it":
    "Xen Orchestra 6.9 o posterior, conectado a los pools que quieres supervisar. Su plugin OpenMetrics necesita una licencia Premium en una XOA; Xen Orchestra compilado desde las fuentes lo incluye",
  "Docker Engine 20.10+ with the Docker Compose v2 plugin, on a machine that can reach Xen Orchestra over HTTPS":
    "Docker Engine 20.10 o posterior con el plugin Docker Compose v2, en una máquina que pueda llegar a Xen Orchestra por HTTPS",
  "A certificate on Xen Orchestra that names the address the agent connects to. The self-signed certificate Xen Orchestra makes for itself names none, so no current TLS client can check it — see **Xen Orchestra's certificate** under Advanced":
    "Un certificado en Xen Orchestra que nombre la dirección a la que se conecta el agente. El certificado autofirmado que Xen Orchestra crea para sí mismo no nombra ninguna, así que ningún cliente TLS actual puede comprobarlo — consulta **Certificado de Xen Orchestra** en Avanzado",
  "1. In Xen Orchestra, open *Settings → Plugins* and find **openmetrics**.":
    "1. En Xen Orchestra, abre *Settings → Plugins* y busca **openmetrics**.",
  "2. Turn it on. The first time it starts, it makes a secret and keeps it, and Xen Orchestra keeps it across restarts.":
    "2. Actívalo. La primera vez que arranca, crea un secreto y lo conserva, y Xen Orchestra lo mantiene entre reinicios.",
  "3. Open the plugin's settings and copy its **Prometheus secret** — you give it to the agent in the next step. You can also type a secret of your own there and save it.":
    "3. Abre los ajustes del plugin y copia su **Prometheus secret**: se lo das al agente en el paso siguiente. También puedes escribir ahí un secreto propio y guardarlo.",
  "The plugin answers on Xen Orchestra's own address and certificate, at `/openmetrics/metrics`, and only to a request that carries its secret. It serves every pool Xen Orchestra is connected to, so one agent covers them all.":
    "El plugin responde en la dirección propia de Xen Orchestra y con su propio certificado, en `/openmetrics/metrics`, y solo a una petición que lleve su secreto. Sirve cada pool al que Xen Orchestra está conectado, así que un solo agente los cubre todos.",
  "The script asks for your OneUptime URL and ingestion key, both shown in step 1 (pick a key there to have them filled in here), and then for:":
    "El script pide tu URL de OneUptime y tu clave de ingesta, ambas mostradas en el paso 1 (elige ahí una clave para que se rellenen aquí), y después:",
  "- **Xen Orchestra's address** — as you open it in a browser, e.g. `https://xo.example.com` or `https://10.0.0.5:8443`.":
    "- **Dirección de Xen Orchestra**: tal como la abres en un navegador, p. ej., `https://xo.example.com` o `https://10.0.0.5:8443`.",
  "- **The OpenMetrics plugin's secret** — from the previous step. It is not shown as you type it.":
    "- **Secreto del plugin OpenMetrics**: el del paso anterior. No se muestra mientras lo escribes.",
  "- **What to call this Xen Orchestra** — the name each of its pools shows on its Settings. Press Enter to use its address.":
    "- **Cómo llamar a este Xen Orchestra**: el nombre que cada uno de sus pools muestra en sus Ajustes. Pulsa Intro para usar su dirección.",
  "The script then reads Xen Orchestra's certificate. When this machine already trusts it, the agent trusts the same CA bundle. When it does not, the script shows the certificate's SHA-256 fingerprint: compare it with the one on Xen Orchestra's machine and answer **y** to trust that certificate and nothing else. It never turns the check off. It then asks the plugin for its metrics with the secret and says which pools Xen Orchestra reports, before it installs anything.":
    "Después el script lee el certificado de Xen Orchestra. Si esta máquina ya confía en él, el agente confía en el mismo paquete de CA. Si no, el script muestra la huella SHA-256 del certificado: compárala con la de la máquina de Xen Orchestra y responde **y** para confiar en ese certificado y en nada más. Nunca desactiva la comprobación. Luego pide al plugin sus métricas con el secreto e indica qué pools informa Xen Orchestra, antes de instalar nada.",
  "It installs to `/opt/oneuptime-xcp-ng-agent`, writes a `0600` `.env` file and starts the agent with Docker Compose. Running the script again reuses everything in that `.env` instead of asking again, so it is also how you upgrade.":
    "Se instala en `/opt/oneuptime-xcp-ng-agent`, escribe un archivo `.env` con `0600` e inicia el agente con Docker Compose. Volver a ejecutar el script reutiliza todo lo que hay en ese `.env` en lugar de volver a preguntar, así que también es como se actualiza.",
  "`docker compose ps` lists `oneuptime-xcp-ng-agent`. In its logs, look for `Everything is ready. Begin running and processing data.` The agent reads Xen Orchestra every minute, and each pool it reports then appears in the **XCP-ng** section under the name Xen Orchestra gives it, with its hosts, VMs and storage.":
    "`docker compose ps` muestra `oneuptime-xcp-ng-agent`. En sus registros, busca `Everything is ready. Begin running and processing data.` El agente lee Xen Orchestra cada minuto, y cada pool que informa aparece entonces en la sección **XCP-ng** con el nombre que le da Xen Orchestra, con sus hosts, sus VM y su almacenamiento.",
  "The install script writes these to `/opt/oneuptime-xcp-ng-agent/.env`. After changing one, apply it with `docker compose up -d` in `/opt/oneuptime-xcp-ng-agent`.":
    "El script de instalación las escribe en `/opt/oneuptime-xcp-ng-agent/.env`. Después de cambiar una, aplícala con `docker compose up -d` en `/opt/oneuptime-xcp-ng-agent`.",
  "| Variable | Required | Description |":
    "| Variable | Obligatoria | Descripción |",
  "| `ONEUPTIME_URL` | Yes | Your OneUptime instance URL (e.g. `<YOUR_ONEUPTIME_URL>`) |":
    "| `ONEUPTIME_URL` | Sí | La URL de tu instancia de OneUptime (p. ej., `<YOUR_ONEUPTIME_URL>`) |",
  "| `ONEUPTIME_TELEMETRY_INGESTION_KEY` | Yes | Telemetry ingestion key — the one picked in step 1 |":
    "| `ONEUPTIME_TELEMETRY_INGESTION_KEY` | Sí | La clave de ingesta de telemetría, la elegida en el paso 1 |",
  "| `XO_ADDRESS` | Yes | Xen Orchestra's `host` or `host:port`, without a scheme |":
    "| `XO_ADDRESS` | Sí | El `host` o el `host:port` de Xen Orchestra, sin esquema |",
  "| `XO_SCHEME` | No | `https` (default). `http` only in a lab: the secret then crosses the network in clear |":
    "| `XO_SCHEME` | No | `https` (predeterminado). `http` solo en un laboratorio: el secreto cruza entonces la red sin cifrar |",
  "| `XO_OPENMETRICS_SECRET` | Yes | The OpenMetrics plugin's secret, sent as a Bearer token. Every `$` in it is written as `$$` |":
    "| `XO_OPENMETRICS_SECRET` | Sí | El secreto del plugin OpenMetrics, enviado como token Bearer. Cada `$` que contenga se escribe como `$$` |",
  "| `XO_NAME` | No | What to call this Xen Orchestra in OneUptime, shown on each of its pools' Settings (default: its address) |":
    "| `XO_NAME` | No | Cómo llamar a este Xen Orchestra en OneUptime, mostrado en los Ajustes de cada uno de sus pools (predeterminado: su dirección) |",
  "| `XO_TLS_SERVER_NAME` | No | The name Xen Orchestra's certificate is checked against, when `XO_ADDRESS` is an address the certificate does not list |":
    "| `XO_TLS_SERVER_NAME` | No | El nombre con el que se comprueba el certificado de Xen Orchestra, cuando `XO_ADDRESS` es una dirección que el certificado no incluye |",
  "| `XCP_NG_AGENT_CONTAINER_NAME` | No | The agent's container name (default: `oneuptime-xcp-ng-agent`). A second Xen Orchestra's agent on the same machine needs one of its own: the install script names a new agent after its folder unless you set it, and keeps it when you run the script again |":
    "| `XCP_NG_AGENT_CONTAINER_NAME` | No | El nombre del contenedor del agente (predeterminado: `oneuptime-xcp-ng-agent`). El agente de un segundo Xen Orchestra en la misma máquina necesita uno propio: el script de instalación nombra un agente nuevo según su carpeta, salvo que lo establezcas tú, y lo conserva cuando vuelves a ejecutar el script |",
  "| `XO_URL` | Install script | Xen Orchestra's address as typed; the script derives `XO_SCHEME` and `XO_ADDRESS` from it |":
    "| `XO_URL` | Script de instalación | La dirección de Xen Orchestra tal como se escribió; el script deduce de ella `XO_SCHEME` y `XO_ADDRESS` |",
  "| `XO_TLS_FINGERPRINT` | Install script | The SHA-256 fingerprint of Xen Orchestra's own certificate, when the agent trusts that certificate and nothing else |":
    "| `XO_TLS_FINGERPRINT` | Script de instalación | La huella SHA-256 del propio certificado de Xen Orchestra, cuando el agente confía en ese certificado y en nada más |",
  "| `XO_CA_FILE` | Install script | A CA bundle that issued Xen Orchestra's certificate, which the script copies to `xo-ca.pem` |":
    "| `XO_CA_FILE` | Script de instalación | Un paquete de CA que emitió el certificado de Xen Orchestra, que el script copia en `xo-ca.pem` |",
  "| `ONEUPTIME_AI_XO_READ_TOKEN` | No | A token of a Xen Orchestra user holding a copy of the built-in **Read only** role and nothing else: the XCP-ng AI agent runs when it is set, and reads with it |":
    "| `ONEUPTIME_AI_XO_READ_TOKEN` | No | Un token de un usuario de Xen Orchestra que tiene una copia del rol integrado **Read only** y nada más: el agente de IA de XCP-ng se ejecuta cuando está definido, y lee con él |",
  "| `ONEUPTIME_AI_XO_WRITE_TOKEN` | No | Only for fixes: a token of another user, whose role allows them. The AI agent changes nothing without it |":
    "| `ONEUPTIME_AI_XO_WRITE_TOKEN` | No | Solo para correcciones: un token de otro usuario, cuyo rol las permite. Sin él, el agente de IA no cambia nada |",
  "| `XCP_NG_POOL_ID` | No | The XAPI UUID of the pool the AI agent serves (default: the one pool its read token can see) |":
    "| `XCP_NG_POOL_ID` | No | El UUID de XAPI del pool al que sirve el agente de IA (predeterminado: el único pool que puede ver su token de lectura) |",
  "| `ONEUPTIME_AI_AGENT_RESOURCE_NAME` | No | Overrides `XCP_NG_POOL_ID` as the pool the AI agent registers as |":
    "| `ONEUPTIME_AI_AGENT_RESOURCE_NAME` | No | Sustituye a `XCP_NG_POOL_ID` como el pool con el que se registra el agente de IA |",
  "| `ONEUPTIME_AI_INVESTIGATION` | No | `true` or `false`: whether OneUptime AI may run the AI agent's read-only commands while it investigates (default: on) |":
    "| `ONEUPTIME_AI_INVESTIGATION` | No | `true` o `false`: si OneUptime AI puede ejecutar los comandos de solo lectura del agente de IA mientras investiga (predeterminado: activado) |",
  "| `ONEUPTIME_AI_FIXES` | No | `off`, `ask-for-approval`, `automatic` or `bypass-approval`: how OneUptime AI may apply a fix |":
    "| `ONEUPTIME_AI_FIXES` | No | `off`, `ask-for-approval`, `automatic` o `bypass-approval`: cómo puede aplicar OneUptime AI una corrección |",
  "| `ONEUPTIME_AI_ALLOW_WRITES` | No | `true` lets the AI agent apply fixes, with the token for changes. Anything else keeps it read-only |":
    "| `ONEUPTIME_AI_ALLOW_WRITES` | No | `true` permite al agente de IA aplicar correcciones, con el token para cambios. Cualquier otro valor lo mantiene en solo lectura |",
  "| `ONEUPTIME_AI_WRITE_TARGETS` | No | The `vm/<uuid>`, `host/<uuid>`, `pbd/<uuid>` or `schedule/<uuid>` a fix may touch, comma-separated (default: all) |":
    "| `ONEUPTIME_AI_WRITE_TARGETS` | No | Los `vm/<uuid>`, `host/<uuid>`, `pbd/<uuid>` o `schedule/<uuid>` que puede tocar una corrección, separados por comas (predeterminado: todos) |",
  "| `ONEUPTIME_AI_PROTECTED_TARGETS` | No | The same, for what OneUptime AI must never change: the VM the AI agent runs in, and Xen Orchestra's own |":
    "| `ONEUPTIME_AI_PROTECTED_TARGETS` | No | Lo mismo, para lo que OneUptime AI nunca debe cambiar: la VM en la que se ejecuta el agente de IA, y la de Xen Orchestra |",
  "| `LOG_LEVEL` | No | The AI agent's log level: `debug`, `info` (default), `warn` or `error` |":
    "| `LOG_LEVEL` | No | El nivel de registro del agente de IA: `debug`, `info` (predeterminado), `warn` o `error` |",
  "| `COMPOSE_PROFILES` | No | `xcp-ng-ai-agent` starts the AI agent; the install script writes it when the read token is set |":
    "| `COMPOSE_PROFILES` | No | `xcp-ng-ai-agent` arranca el agente de IA; el script de instalación lo escribe cuando el token de lectura está definido |",
  "The agent checks Xen Orchestra's certificate against `xo-ca.pem`, next to `docker-compose.yml`.":
    "El agente comprueba el certificado de Xen Orchestra con `xo-ca.pem`, junto a `docker-compose.yml`.",
  "The agent checks Xen Orchestra's certificate on every read, against `xo-ca.pem` and nothing else. That file holds one of three things:":
    "El agente comprueba el certificado de Xen Orchestra en cada lectura, con `xo-ca.pem` y nada más. Ese archivo contiene una de estas tres cosas:",
  "- **Xen Orchestra's own certificate**, pinned by its SHA-256 fingerprint (`XO_TLS_FINGERPRINT`): the agent trusts that certificate and no other.":
    "- **El propio certificado de Xen Orchestra**, fijado por su huella SHA-256 (`XO_TLS_FINGERPRINT`): el agente confía en ese certificado y en ningún otro.",
  "- **The CA that issued it** (`XO_CA_FILE`), for a certificate from a CA of your own.":
    "- **La CA que lo emitió** (`XO_CA_FILE`), para un certificado de una CA propia.",
  "- **This machine's CA bundle**, for a certificate this machine already trusts.":
    "- **El paquete de CA de esta máquina**, para un certificado en el que esta máquina ya confía.",
  "Either way, the certificate must name the address the agent connects to: the agent checks the names a certificate is issued to, as every current TLS client does, and not its subject. The self-signed certificate Xen Orchestra makes for itself names none, so the agent cannot trust it, pinned or not, and fails with `x509: certificate is not valid for any names`. Give Xen Orchestra a certificate that names its address — from your CA, or a self-signed one with a subject alternative name — as [Xen Orchestra's certificate](/docs/telemetry/xcp-ng#xen-orchestras-certificate) shows.":
    "En cualquier caso, el certificado debe nombrar la dirección a la que se conecta el agente: el agente comprueba los nombres para los que se emitió un certificado, como hace todo cliente TLS actual, y no su sujeto. El certificado autofirmado que Xen Orchestra crea para sí mismo no nombra ninguno, así que el agente no puede confiar en él, fijado o no, y falla con `x509: certificate is not valid for any names`. Dale a Xen Orchestra un certificado que nombre su dirección (de tu CA, o uno autofirmado con un nombre alternativo del sujeto, subject alternative name), como muestra [El certificado de Xen Orchestra](/docs/telemetry/xcp-ng#xen-orchestras-certificate).",
  "When the certificate names Xen Orchestra by another name than the address in `XO_ADDRESS`, set `XO_TLS_SERVER_NAME` to that name. When a pinned certificate is renewed, the agent stops reading Xen Orchestra until it trusts the new one. Run the install script again: it shows the new fingerprint and stops, changing nothing. Check that fingerprint on Xen Orchestra's machine, then run the script once more with it: `XO_TLS_FINGERPRINT=<new fingerprint> bash install.sh`.":
    "Cuando el certificado nombra a Xen Orchestra con otro nombre que la dirección de `XO_ADDRESS`, establece `XO_TLS_SERVER_NAME` en ese nombre. Cuando se renueva un certificado fijado, el agente deja de leer Xen Orchestra hasta que confía en el nuevo. Vuelve a ejecutar el script de instalación: muestra la huella nueva y se detiene, sin cambiar nada. Comprueba esa huella en la máquina de Xen Orchestra y ejecuta el script una vez más con ella: `XO_TLS_FINGERPRINT=<new fingerprint> bash install.sh`.",
  "Every minute the agent reads the plugin, which reads each host's XAPI round-robin databases at 60-second resolution. It keeps the `xcp_*` series, and moves each series' pool to the batch it sends, as `xcp_ng.pool.id` (the pool's UUID, which never changes) and `xcp_ng.pool.name`:":
    "Cada minuto el agente lee el plugin, que lee a través de XAPI las bases de datos round-robin de cada host con una resolución de 60 segundos. Conserva las series `xcp_*` y lleva el pool de cada serie al lote que envía, como `xcp_ng.pool.id` (el UUID del pool, que nunca cambia) y `xcp_ng.pool.name`:",
  "| Category | Series |": "| Categoría | Series |",
  "| **Pool** | `xcp_pool_connected` — present while Xen Orchestra is connected to the pool |":
    "| **Pool** | `xcp_pool_connected`: presente mientras Xen Orchestra está conectado al pool |",
  "| **Hosts** | `xcp_host_status` (power state and whether it is enabled), `xcp_host_uptime_seconds`, `xcp_host_cpu_average`, `xcp_host_load_average`, `xcp_host_memory_*`, `xcp_host_running_vcpus`, `xcp_host_network_*` per interface, `xcp_host_disk_*` per storage repository |":
    "| **Hosts** | `xcp_host_status` (estado de energía y si está habilitado), `xcp_host_uptime_seconds`, `xcp_host_cpu_average`, `xcp_host_load_average`, `xcp_host_memory_*`, `xcp_host_running_vcpus`, `xcp_host_network_*` por interfaz, `xcp_host_disk_*` por repositorio de almacenamiento |",
  "| **VMs** | `xcp_vm_status`, `xcp_vm_uptime_seconds`, `xcp_vm_cpu_usage`, `xcp_vm_runstate_*` (CPU contention), `xcp_vm_memory_*`, `xcp_vm_network_*` per interface, `xcp_vm_disk_*` per disk, `xcp_vm_power_consumption_watts` |":
    "| **VM** | `xcp_vm_status`, `xcp_vm_uptime_seconds`, `xcp_vm_cpu_usage`, `xcp_vm_runstate_*` (contención de CPU), `xcp_vm_memory_*`, `xcp_vm_network_*` por interfaz, `xcp_vm_disk_*` por disco, `xcp_vm_power_consumption_watts` |",
  "| **Storage** | `xcp_sr_physical_size_bytes`, `xcp_sr_physical_usage_bytes`, `xcp_sr_virtual_size_bytes`, `xcp_vdi_virtual_size_bytes`, `xcp_vdi_physical_usage_bytes` |":
    "| **Almacenamiento** | `xcp_sr_physical_size_bytes`, `xcp_sr_physical_usage_bytes`, `xcp_sr_virtual_size_bytes`, `xcp_vdi_virtual_size_bytes`, `xcp_vdi_physical_usage_bytes` |",
  "| **XOSTOR** | `xcp_xostor_*`, on pools that run XOSTOR |":
    "| **XOSTOR** | `xcp_xostor_*`, en los pools que ejecutan XOSTOR |",
  'Control domains report as VMs with `is_control_domain="true"`; the pages hide them unless you ask for them.':
    'Los dominios de control se presentan como VM con `is_control_domain="true"`; las páginas los ocultan salvo que los pidas.',
  "Xen Orchestra types eight throughput series as counters, though each holds XAPI's per-second rate: `xcp_host_network_receive_bytes_total`, `xcp_host_network_transmit_bytes_total`, and the VM network, network error and disk read and write series. The agent turns them into gauges with their values untouched, so OneUptime stores them as the rates they are, in bytes or errors per second.":
    "Xen Orchestra tipa ocho series de rendimiento como contadores, aunque cada una contiene la tasa por segundo de XAPI: `xcp_host_network_receive_bytes_total`, `xcp_host_network_transmit_bytes_total`, y las series de red, errores de red y lectura y escritura de disco de las VM. El agente las convierte en gauges sin tocar sus valores, así que OneUptime las guarda como las tasas que son, en bytes o errores por segundo.",
  "OneUptime adds four 0/1 series for each pool, which the alert templates read: `xcp_ng.host.running`, `xcp_ng.host.enabled`, `xcp_ng.vm.running` and `xcp_ng.vm.stopped_after_running` (a VM halted or paused that ran in the last day). It also stamps every point with `xcp_ng.scope` (`pool`, `host`, `vm`, `sr`, `vdi` or `xostor`) and `xcp_ng.id` (that object's UUID), which monitors and dashboards filter on.":
    "OneUptime añade cuatro series 0/1 por cada pool, que leen las plantillas de alerta: `xcp_ng.host.running`, `xcp_ng.host.enabled`, `xcp_ng.vm.running` y `xcp_ng.vm.stopped_after_running` (una VM detenida o en pausa que se ejecutó en el último día). También estampa en cada punto `xcp_ng.scope` (`pool`, `host`, `vm`, `sr`, `vdi` o `xostor`) y `xcp_ng.id` (el UUID de ese objeto), por los que filtran los monitores y los paneles.",
  "Not kept: Xen Orchestra's own process series (`xo_*`), which belong to no pool, and a host's power read over IPMI, which the plugin sends without its pool. Each VM's estimated share of it is kept.":
    "No se conservan: las propias series de proceso de Xen Orchestra (`xo_*`), que no pertenecen a ningún pool, y la potencia de un host leída por IPMI, que el plugin envía sin su pool. Sí se conserva la parte estimada de cada VM.",
  "One agent reads one Xen Orchestra and every pool it manages. For a second Xen Orchestra, install a second agent in a folder of its own, with a container name of its own — two containers cannot share one:":
    "Un agente lee un Xen Orchestra y cada pool que gestiona. Para un segundo Xen Orchestra, instala un segundo agente en una carpeta propia, con un nombre de contenedor propio, porque dos contenedores no pueden compartir nombre:",
  "Without `XCP_NG_AGENT_CONTAINER_NAME`, the script names the container after the folder. It keeps the name in that agent's `.env`, so running the script again to upgrade the agent keeps it, and an agent whose `container_name` you once edited in `docker-compose.yml` keeps that name. With Docker Compose, set `XCP_NG_AGENT_CONTAINER_NAME` in each agent's `.env` instead.":
    "Sin `XCP_NG_AGENT_CONTAINER_NAME`, el script nombra el contenedor según la carpeta. Guarda el nombre en el `.env` de ese agente, así que volver a ejecutar el script para actualizar el agente lo conserva, y un agente cuyo `container_name` editaste alguna vez en `docker-compose.yml` conserva ese nombre. Con Docker Compose, establece en su lugar `XCP_NG_AGENT_CONTAINER_NAME` en el `.env` de cada agente.",
  "Don't let two Xen Orchestras that manage the same pool both be read: the pool is one pool in OneUptime, by its UUID, and would be reported twice.":
    "No dejes que se lean dos Xen Orchestra que gestionan el mismo pool: el pool es un solo pool en OneUptime, por su UUID, y se informaría dos veces.",
  "Any resource attribute prefixed with `oneuptime.label.` becomes a project label on each pool the agent reads: `oneuptime.label.<dimension>=<value>` is the label `<dimension>:<value>`. Add them to the `resource` processor in `otel-collector-config.yaml`, next to `oneuptime.agent.version`:":
    "Cualquier atributo de recurso con el prefijo `oneuptime.label.` se convierte en una etiqueta de proyecto en cada pool que lee el agente: `oneuptime.label.<dimension>=<value>` es la etiqueta `<dimension>:<value>`. Añádelos al procesador `resource` en `otel-collector-config.yaml`, junto a `oneuptime.agent.version`:",
  "Then restart the collector so it reads the new config:":
    "Después reinicia el recolector para que lea la nueva configuración:",
  "The pools show up tagged `team:platform` and `env:production`. Labels are matched case-insensitively, so an existing `Production` label is reused; labels added in the OneUptime UI are never removed by the agent. Running the install script again replaces an edited `otel-collector-config.yaml` and keeps yours next to it as `otel-collector-config.yaml.bak.<timestamp>`.":
    "Los pools aparecen con las etiquetas `team:platform` y `env:production`. Las etiquetas se comparan sin distinguir mayúsculas, así que se reutiliza una etiqueta `Production` existente; el agente nunca elimina las etiquetas añadidas en la interfaz de OneUptime. Volver a ejecutar el script de instalación reemplaza un `otel-collector-config.yaml` editado y conserva el tuyo a su lado como `otel-collector-config.yaml.bak.<timestamp>`.",
  "**Upgrade** — the collector image is pinned in `docker-compose.yml` and its config is a file beside it, so pulling alone does not move the agent forward. Run the install script again. It reuses every value in your existing `.env` (nothing is asked again), checks Xen Orchestra's certificate the same way, downloads the latest `docker-compose.yml` and `otel-collector-config.yaml` — a file you edited is kept next to the new one as `<file>.bak.<timestamp>` — pulls the image and recreates the agent with it:":
    "**Actualizar**: la imagen del recolector está fijada en `docker-compose.yml` y su configuración es un archivo a su lado, así que descargar la imagen no basta para actualizar el agente. Vuelve a ejecutar el script de instalación. Reutiliza cada valor de tu `.env` existente (no se vuelve a preguntar nada), comprueba el certificado de Xen Orchestra de la misma forma, descarga los últimos `docker-compose.yml` y `otel-collector-config.yaml` (un archivo que editaste se conserva junto al nuevo como `<file>.bak.<timestamp>`), descarga la imagen y vuelve a crear el agente con ella:",
  "The config reports the collector version it pins as each pool's **Agent Version**. When this OneUptime pins a newer one, a warning sign beside it opens these commands.":
    "La configuración informa de la versión del recolector que fija como la **Versión del agente** de cada pool. Cuando este OneUptime fija una más reciente, una señal de advertencia junto a ella abre estos comandos.",
  "**Uninstall** the agent:": "**Desinstala** el agente:",
  "Then turn off the OpenMetrics plugin in Xen Orchestra if nothing else reads it.":
    "Después desactiva el plugin OpenMetrics en Xen Orchestra si nada más lo lee.",
  "`troubleshoot.sh` checks the whole chain — the container, Xen Orchestra's certificate against `xo-ca.pem`, the plugin and its secret, the pools it reports — and asks OneUptime directly whether it accepts your ingestion key. That last check matters most: OneUptime's OTLP endpoints refuse a bad key with `401` or `422`, which the collector logs as a single `Exporting failed` line per batch that is easy to miss.":
    "`troubleshoot.sh` comprueba toda la cadena —el contenedor, el certificado de Xen Orchestra con `xo-ca.pem`, el plugin y su secreto, los pools que informa— y pregunta directamente a OneUptime si acepta tu clave de ingesta. Esa última comprobación es la que más importa: los endpoints OTLP de OneUptime rechazan una clave incorrecta con `401` o `422`, que el recolector registra como una sola línea `Exporting failed` por lote, fácil de pasar por alto.",
  "It ends with a verdict naming the most likely cause. It never prints the secret.":
    "Termina con un veredicto que nombra la causa más probable. Nunca imprime el secreto.",
  "OneUptime marks a pool Disconnected when nothing has been read for it for 15 minutes.":
    "OneUptime marca un pool como Desconectado cuando no se ha leído nada de él durante 15 minutos.",
  "1. If every pool of this Xen Orchestra is Disconnected, check the agent (in `/opt/oneuptime-xcp-ng-agent`): `docker compose ps` and `docker compose logs oneuptime-xcp-ng-agent | grep -i error`.":
    "1. Si todos los pools de este Xen Orchestra están Desconectados, comprueba el agente (en `/opt/oneuptime-xcp-ng-agent`): `docker compose ps` y `docker compose logs oneuptime-xcp-ng-agent | grep -i error`.",
  "2. If only one is, Xen Orchestra stopped reporting it: under *Settings → Servers* in Xen Orchestra, the pool's server must be connected. The pool's hosts, VMs and storage stay as Xen Orchestra last reported them.":
    "2. Si solo lo está uno, Xen Orchestra dejó de informarlo: en *Settings → Servers* de Xen Orchestra, el servidor del pool debe estar conectado. Los hosts, las VM y el almacenamiento del pool se quedan como Xen Orchestra los informó por última vez.",
  "The collector logs `server returned HTTP status 401 Unauthorized`. Copy the secret again from *Settings → Plugins → openmetrics*, set `XO_OPENMETRICS_SECRET` to it in `.env` — between single quotes, every `$` written as `$$` — and apply it with `docker compose up -d` in `/opt/oneuptime-xcp-ng-agent`. Before 6.8, Xen Orchestra made a new secret each time it restarted.":
    "El recolector registra `server returned HTTP status 401 Unauthorized`. Copia de nuevo el secreto desde *Settings → Plugins → openmetrics*, establece `XO_OPENMETRICS_SECRET` con él en `.env` (entre comillas simples, cada `$` escrito como `$$`) y aplícalo con `docker compose up -d` en `/opt/oneuptime-xcp-ng-agent`. Antes de la 6.8, Xen Orchestra creaba un secreto nuevo cada vez que se reiniciaba.",
  'Xen Orchestra answers, but its OpenMetrics plugin does not. Turn the plugin on under *Settings → Plugins → openmetrics* (an XOA needs a Premium licence for it), and check that Xen Orchestra is 6.9 or later. `/openmetrics/health` answers `{"status":"ok"}` without a secret while the plugin runs.':
    'Xen Orchestra responde, pero su plugin OpenMetrics no. Activa el plugin en *Settings → Plugins → openmetrics* (una XOA necesita una licencia Premium para ello) y comprueba que Xen Orchestra sea la 6.9 o posterior. `/openmetrics/health` responde `{"status":"ok"}` sin secreto mientras el plugin se ejecuta.',
  "- `x509: certificate is not valid for any names` — the certificate names no address, as Xen Orchestra's own self-signed one does. Give Xen Orchestra a certificate that names its address.":
    "- `x509: certificate is not valid for any names`: el certificado no nombra ninguna dirección, como el propio certificado autofirmado de Xen Orchestra. Dale a Xen Orchestra un certificado que nombre su dirección.",
  "- `x509: certificate is valid for <names>, not <address>` — connect to one of those names, or set `XO_TLS_SERVER_NAME` to one.":
    "- `x509: certificate is valid for <names>, not <address>`: conéctate a uno de esos nombres, o establece `XO_TLS_SERVER_NAME` en uno de ellos.",
  "- `x509: certificate signed by unknown authority` — `xo-ca.pem` does not hold this certificate or the CA that issued it. The certificate was renewed, or the file holds the wrong one: write it again, as **Xen Orchestra's certificate** under Advanced says.":
    "- `x509: certificate signed by unknown authority`: `xo-ca.pem` no contiene este certificado ni la CA que lo emitió. El certificado se renovó, o el archivo contiene otro: vuelve a escribirlo, como explica **Certificado de Xen Orchestra** en Avanzado.",
  "Xen Orchestra reports only the pools it is connected to, and the agent reads only that Xen Orchestra. Connect the pool's server under *Settings → Servers* in Xen Orchestra; the pool appears in OneUptime with the next read. A pool read by another Xen Orchestra needs an agent beside that one.":
    "Xen Orchestra solo informa los pools a los que está conectado, y el agente solo lee ese Xen Orchestra. Conecta el servidor del pool en *Settings → Servers* de Xen Orchestra; el pool aparece en OneUptime con la siguiente lectura. Un pool que lee otro Xen Orchestra necesita su propio agente, junto a ese otro Xen Orchestra.",
  "- **What to call this Xen Orchestra** — the command already names it **`xo-paris`**, as this pool's Settings show it.":
    "- **Cómo llamar a este Xen Orchestra**: el comando ya lo nombra **`xo-paris`**, como lo muestran los Ajustes de este pool.",
  "The command already carries your OneUptime URL and ingestion key. The script asks for the rest:":
    "El comando ya lleva tu URL de OneUptime y tu clave de ingesta. El script pide el resto:",
  "Download `docker-compose.yml` and `otel-collector-config.yaml` from this OneUptime into a new folder:":
    "Descarga `docker-compose.yml` y `otel-collector-config.yaml` desde este OneUptime en una carpeta nueva:",
  "Create a `.env` file next to them — it holds the plugin's secret, so keep it private with `chmod 600 .env`:":
    "Crea un archivo `.env` junto a ellos; contiene el secreto del plugin, así que mantenlo privado con `chmod 600 .env`:",
  "- Set `XO_ADDRESS` to Xen Orchestra's `host` or `host:port`, without `https://`.":
    "- Establece `XO_ADDRESS` en el `host` o el `host:port` de Xen Orchestra, sin `https://`.",
  "- Put the plugin's secret between single quotes. If it holds a `$`, write each one as `$$`: the collector reads the value once more.":
    "- Pon el secreto del plugin entre comillas simples. Si contiene un `$`, escribe cada uno como `$$`: el recolector lee el valor una vez más.",
  "- `XO_NAME` is what each pool's Settings call this Xen Orchestra.":
    "- `XO_NAME` es como los Ajustes de cada pool llaman a este Xen Orchestra.",
  "Then give the agent Xen Orchestra's certificate, as `xo-ca.pem` next to `docker-compose.yml` — the agent checks Xen Orchestra against this file and nothing else. To trust Xen Orchestra's own certificate, read it and check its fingerprint against the one on Xen Orchestra's machine:":
    "Después dale al agente el certificado de Xen Orchestra, como `xo-ca.pem` junto a `docker-compose.yml`: el agente comprueba Xen Orchestra con este archivo y nada más. Para confiar en el propio certificado de Xen Orchestra, léelo y compara su huella con la de la máquina de Xen Orchestra:",
  "When a CA of your own issued it, copy that CA's certificate to `xo-ca.pem` instead; when a public CA did, copy this machine's CA bundle (`cp /etc/ssl/certs/ca-certificates.crt xo-ca.pem`).":
    "Si lo emitió una CA propia, copia en su lugar el certificado de esa CA en `xo-ca.pem`; si lo emitió una CA pública, copia el paquete de CA de esta máquina (`cp /etc/ssl/certs/ca-certificates.crt xo-ca.pem`).",
  "Start the agent:": "Inicia el agente:",
  "Pick an ingestion key in step 1 to fill in `<YOUR_API_KEY>`.":
    "Elige una clave de ingesta en el paso 1 para rellenar `<YOUR_API_KEY>`.",
  "The agent reads these from the `.env` file next to `docker-compose.yml`. After changing one, apply it with `docker compose up -d` in the folder with `docker-compose.yml`.":
    "El agente las lee del archivo `.env` junto a `docker-compose.yml`. Después de cambiar una, aplícala con `docker compose up -d` en la carpeta que contiene `docker-compose.yml`.",
  "When the certificate names Xen Orchestra by another name than the address in `XO_ADDRESS`, set `XO_TLS_SERVER_NAME` to that name. When the certificate in `xo-ca.pem` is renewed, read it again as in step 3, then run `docker compose up -d --force-recreate`.":
    "Cuando el certificado nombra a Xen Orchestra con otro nombre que la dirección de `XO_ADDRESS`, establece `XO_TLS_SERVER_NAME` en ese nombre. Cuando se renueva el certificado de `xo-ca.pem`, vuelve a leerlo como en el paso 3 y después ejecuta `docker compose up -d --force-recreate`.",
  "Run these in the agent's folder, the one with `docker-compose.yml`.":
    "Ejecútalos en la carpeta del agente, la que contiene `docker-compose.yml`.",
  "**Upgrade** — the collector image is pinned in `docker-compose.yml` and its config is a file beside it, so pulling alone does not move the agent forward. Download both files again; your `.env` and `xo-ca.pem` stay, and a change you made to either file has to be made again:":
    "**Actualizar**: la imagen del recolector está fijada en `docker-compose.yml` y su configuración es un archivo a su lado, así que descargar la imagen no basta para actualizar el agente. Vuelve a descargar los dos archivos; tu `.env` y `xo-ca.pem` se quedan, y cualquier cambio que hicieras en uno de los archivos hay que volver a hacerlo:",
  "Then pull the image and recreate the agent, so the collector reads its new config:":
    "Después descarga la imagen y vuelve a crear el agente, para que el recolector lea su nueva configuración:",
  "1. If every pool of this Xen Orchestra is Disconnected, check the agent (in the agent's folder): `docker compose ps` and `docker compose logs oneuptime-xcp-ng-agent | grep -i error`.":
    "1. Si todos los pools de este Xen Orchestra están Desconectados, comprueba el agente (en la carpeta del agente): `docker compose ps` y `docker compose logs oneuptime-xcp-ng-agent | grep -i error`.",
  "The collector logs `server returned HTTP status 401 Unauthorized`. Copy the secret again from *Settings → Plugins → openmetrics*, set `XO_OPENMETRICS_SECRET` to it in `.env` — between single quotes, every `$` written as `$$` — and apply it with `docker compose up -d` in the folder with `docker-compose.yml`. Before 6.8, Xen Orchestra made a new secret each time it restarted.":
    "El recolector registra `server returned HTTP status 401 Unauthorized`. Copia de nuevo el secreto desde *Settings → Plugins → openmetrics*, establece `XO_OPENMETRICS_SECRET` con él en `.env` (entre comillas simples, cada `$` escrito como `$$`) y aplícalo con `docker compose up -d` en la carpeta que contiene `docker-compose.yml`. Antes de la 6.8, Xen Orchestra creaba un secreto nuevo cada vez que se reiniciaba.",
};

export default TRANSLATION;
