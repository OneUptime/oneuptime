import { SetupGuideTranslation } from "../../../Components/SetupGuide/SetupGuideTranslation";

/*
 * The Host setup guide in Spanish (#8341): each piece of the English
 * guide's markdown (Pages/Host/Utils/DocumentationMarkdown.ts) and its
 * Spanish. Code, field names and product names are as the English writes
 * them, and what the Dashboard draws is named as its Spanish words it.
 * Change it with the English, in the same pull request
 * (SetupGuideDocumentationInLocale).
 */
const TRANSLATION: SetupGuideTranslation = {
  "Docker installed on the host you want to monitor":
    "Docker instalado en el host que quieres monitorizar",
  "Network access from the host to your OneUptime instance":
    "Acceso de red desde el host a tu instancia de OneUptime",
  "Save this as `config.yaml` in the directory you will run `docker run` from — step 3 mounts it into the container.":
    "Guarda esto como `config.yaml` en el directorio desde el que ejecutarás `docker run`: el paso 3 lo monta en el contenedor.",
  "Pick an ingestion key in step 1 to fill in `<YOUR_API_KEY>`.":
    "Elige una clave de ingesta en el paso 1 para rellenar `<YOUR_API_KEY>`.",
  "`--network host`, `--pid host`, and the `/hostfs` bind mount let the `hostmetrics` and `process` scrapers read CPU, memory, disk, and per-process information from the host kernel rather than the container. Without these, you'd only see metrics for the collector container itself.":
    "`--network host`, `--pid host` y el montaje `/hostfs` permiten que los scrapers `hostmetrics` y `process` lean la información de CPU, memoria, disco y de cada proceso del kernel del host en lugar del contenedor. Sin ellos, solo verías métricas del propio contenedor del collector.",
  "Open the **Hosts** list in OneUptime — your host appears automatically once the first metric batch lands (usually within 30 seconds). Not there? Check the collector:":
    "Abre la lista **Hosts** en OneUptime: tu host aparece automáticamente en cuanto llega el primer lote de métricas (normalmente en menos de 30 segundos). ¿No está? Revisa el collector:",
  "**AI investigations are on by default** for every host: once the Host AI agent runs on it, OneUptime AI investigates incidents and alerts there with read-only commands such as `systemctl status`, `df -h`, `free -m` and `ps aux`, and changes nothing unless you allow fixes. It is a Linux container with its own installer, so add it on Linux hosts only; it needs Docker (the system engine, not rootless Docker) with the Compose plugin:":
    "**Las investigaciones de IA están activadas por defecto** para cada host: en cuanto el agente de IA del host se ejecuta en él, OneUptime AI investiga allí incidentes y alertas con comandos de solo lectura como `systemctl status`, `df -h`, `free -m` y `ps aux`, y no cambia nada salvo que permitas correcciones. Es un contenedor Linux con su propio instalador, así que añádelo solo en hosts Linux; necesita Docker (el motor del sistema, no Docker sin root) con el plugin Compose:",
  "The first line downloads the script as `install.sh`, so you can read it before you run it. It asks for your OneUptime URL, the ingestion key and the host's name — leave the name empty to use the hostname, which is what this collector reports. Once it connects, it shows as Connected on the host's **AI → AI agent** page and at the bottom of its **Overview**. What it may run, and how fixes work: [Infrastructure AI Agents](/docs/ai/infrastructure-ai-agents#hosts).":
    "La primera línea descarga el script como `install.sh`, para que puedas leerlo antes de ejecutarlo. Pide tu URL de OneUptime, la clave de ingesta y el nombre del host: deja el nombre vacío para usar el nombre de host, que es lo que informa este collector. Cuando se conecta, aparece como conectado en la página **IA → Agente de IA** del host y al final de su **Vista general**. Qué puede ejecutar y cómo funcionan las correcciones: [Agentes de IA de infraestructura](/docs/ai/infrastructure-ai-agents#hosts).",
  "The config already fills the machine's IP addresses, MAC addresses, architecture, machine id, OS description and OS version onto its **Inventory** item, which is what a CMDB export reads. Serial number, make, model and firmware (BIOS / UEFI) version are different: **no resource detector can produce them.** They come from the machine's firmware through DMI. Read them once at provisioning time and stamp them onto the resource — add this processor to the `config.yaml` you mounted into the container and name it in the metrics pipeline. Merge it into the sections your config already has — don't add a second `processors:` or `service:` key.":
    "La configuración ya rellena las direcciones IP, las direcciones MAC, la arquitectura, el ID de máquina, la descripción y la versión del sistema operativo en el elemento de la máquina en **Inventario**, que es lo que lee una exportación CMDB. El número de serie, el fabricante, el modelo y la versión del firmware (BIOS / UEFI) son distintos: **ningún detector de recursos puede obtenerlos.** Proceden del firmware de la máquina, a través de DMI. Léelos una vez al aprovisionar la máquina y fíjalos en el recurso: añade este procesador a la `config.yaml` que montaste en el contenedor y nómbralo en el pipeline de métricas. Intégralo en las secciones que tu configuración ya tiene: no añadas una segunda clave `processors:` o `service:`.",
  "Then recreate the container so it reads the edited file — remove it, and run the `docker run` command from step 3 again:":
    "Luego vuelve a crear el contenedor para que lea el archivo editado: elimínalo y ejecuta de nuevo el comando `docker run` del paso 3:",
  "The values are the machine's own, so they are written once by whatever provisions it. On Linux, read them as root (`bios_version` is readable by anyone):":
    "Los valores son propios de la máquina, así que los escribe una sola vez lo que la aprovisiona. En Linux, léelos como root (`bios_version` lo puede leer cualquiera):",
  "Within a few minutes the values show on the machine's **Inventory** item under **Details**. They are stamped, not detected, so run this again after a motherboard swap or a firmware update.":
    "En unos minutos los valores aparecen en el elemento de la máquina en **Inventario**, en **Detalles**. Están fijados, no detectados, así que vuelve a ejecutar esto tras cambiar la placa base o actualizar el firmware.",
  "`host.manufacturer`, `host.model.name`, `host.firmware.version` and `host.bios.version` are accepted as alternative spellings and stored under the `device.*` keys above (and `device.serial_number` under `host.serial_number`), so a config written either way ends up in one place.":
    "`host.manufacturer`, `host.model.name`, `host.firmware.version` y `host.bios.version` se aceptan como grafías alternativas y se guardan con las claves `device.*` de arriba (y `device.serial_number` como `host.serial_number`), así que una configuración escrita de una forma u otra acaba en el mismo sitio.",
  "> **Don't set `device.manufacturer` on a mobile app's resource and a host's from the same config.** On a resource that carries no `host.name` or `host.id`, `device.manufacturer` still marks the batch as mobile Real User Monitoring.":
    "> **No definas `device.manufacturer` en el recurso de una app móvil y en el de un host desde la misma configuración.** En un recurso sin `host.name` ni `host.id`, `device.manufacturer` sigue marcando el lote como Real User Monitoring móvil.",
  "Any resource attribute prefixed with `oneuptime.label.` is promoted to a project Label and attached to the host (and to the telemetry service emitted from this collector). Pattern: `oneuptime.label.<dimension>=<value>` becomes a label named `<dimension>:<value>`.":
    "Todo atributo de recurso con el prefijo `oneuptime.label.` pasa a ser una etiqueta del proyecto asociada al host (y al servicio de telemetría que emite este collector). Patrón: `oneuptime.label.<dimension>=<value>` se convierte en una etiqueta llamada `<dimension>:<value>`.",
  "Add a `resource` processor to the `config.yaml` you mounted into the container and reference it from the metrics pipeline. Merge it into the sections your config already has — don't add a second `processors:` or `service:` key.":
    "Añade un procesador `resource` a la `config.yaml` que montaste en el contenedor y haz referencia a él desde el pipeline de métricas. Intégralo en las secciones que tu configuración ya tiene: no añadas una segunda clave `processors:` o `service:`.",
  "The host shows up tagged `team:payments`, `env:production`, and `region:us-east-1`. Labels are matched case-insensitively, so an existing manually-created `Production` label is reused rather than duplicated. Labels added manually in the OneUptime UI are never removed by the collector.":
    "El host aparece etiquetado con `team:payments`, `env:production` y `region:us-east-1`. Las etiquetas se comparan sin distinguir mayúsculas, así que una etiqueta `Production` ya creada a mano se reutiliza en lugar de duplicarse. El collector nunca elimina las etiquetas añadidas a mano en la interfaz de OneUptime.",
  "Hosts are auto-discovered from the OTel `host.name` resource attribute, which the `resourcedetection` processor sets. OneUptime registers the host once a batch that carries `host.name` also carries any of:":
    "Los hosts se descubren automáticamente a partir del atributo de recurso OTel `host.name`, que define el procesador `resourcedetection`. OneUptime registra el host en cuanto un lote que lleva `host.name` lleva también cualquiera de estos:",
  "- `hostmetrics` receiver metrics (CPU, memory, disk, filesystem, network, load, processes), OR":
    "- métricas del receptor `hostmetrics` (CPU, memoria, disco, sistema de archivos, red, carga, procesos), O",
  "- `process` scraper metrics (per-process CPU/memory/threads), OR":
    "- métricas del scraper `process` (CPU/memoria/hilos por proceso), O",
  "- an `os.type` or `container.runtime` resource attribute, on metrics, logs or traces":
    "- un atributo de recurso `os.type` o `container.runtime`, en métricas, registros o trazas",
  "…and starts populating the Overview, Metrics, Processes, and Logs tabs. `host.id` or `host.arch` alone do not register a host, and telemetry that carries a Kubernetes identity (`k8s.cluster.name`, `k8s.node.name`, `k8s.pod.name`, …) is filed under its Kubernetes cluster instead.":
    "…y empieza a rellenar las pestañas Vista general, Métricas, Procesos y Registros. `host.id` o `host.arch` por sí solos no registran un host, y la telemetría que lleva una identidad de Kubernetes (`k8s.cluster.name`, `k8s.node.name`, `k8s.pod.name`, …) se archiva en su clúster de Kubernetes.",
  "**Running on OpenStack?** Use `detectors: [nova, system, env]`, so `host.id` is the instance's UUID and OneUptime links this host to its instance, and set `host.name` to `enabled: false` under `nova: resource_attributes:` so its name stays the one `system` reports.":
    "**¿Se ejecuta en OpenStack?** Usa `detectors: [nova, system, env]`, para que `host.id` sea el UUID de la instancia y OneUptime enlace este host con su instancia, y pon `host.name` en `enabled: false` en `nova: resource_attributes:` para que su nombre siga siendo el que informa `system`.",
  "The same resource attributes become the machine's **Inventory** item, which is what a CMDB export reads. `host.ip`, `host.mac`, `host.arch`, `host.id`, `os.type`, `os.description` and `os.version` all come from the `resourcedetection` processor; serial number, make, model and firmware version have no detector and are stamped on separately (see **Record the serial number, make, model and firmware version**).":
    "Los mismos atributos de recurso forman el elemento de la máquina en **Inventario**, que es lo que lee una exportación CMDB. `host.ip`, `host.mac`, `host.arch`, `host.id`, `os.type`, `os.description` y `os.version` vienen todos del procesador `resourcedetection`; el número de serie, el fabricante, el modelo y la versión del firmware no tienen detector y se fijan aparte (consulta **Registrar el número de serie, el fabricante, el modelo y la versión del firmware**).",
  "Once the host is reporting:": "Una vez que el host informa:",
  "- The **Metrics** tab visualizes `system.*` time-series.":
    "- La pestaña **Métricas** muestra las series temporales `system.*`.",
  "- The **Processes** tab lists processes ordered by CPU once the `process` scraper is enabled.":
    "- La pestaña **Procesos** lista los procesos ordenados por CPU en cuanto se activa el scraper `process`.",
  "- The **Logs** tab streams any logs whose resource attributes include `host.name`.":
    "- La pestaña **Registros** muestra en directo los registros cuyos atributos de recurso incluyen `host.name`.",
  "The config reports the collector release it is for (`oneuptime.agent.version`) as the host's **Agent Version**. When this OneUptime pins a newer release, a warning sign beside it opens these steps.":
    "La configuración informa de la versión del collector para la que está escrita (`oneuptime.agent.version`) como la **Versión del agente** del host. Cuando este OneUptime fija una versión más reciente, una señal de advertencia junto a ella abre estos pasos.",
  "1. Save the config from step 2 again, with the same ingestion key: it reports the new version. Copy across any change you made to yours.":
    "1. Guarda de nuevo la configuración del paso 2, con la misma clave de ingesta: informa de la nueva versión. Traslada cualquier cambio que hicieras en la tuya.",
  "2. In the folder that holds it, install the new release and restart the collector:":
    "2. En la carpeta que la contiene, instala la nueva versión y reinicia el collector:",
  "1. Read the collector's logs for export errors: `docker logs -f otel-collector`. An HTTP `401` means the key is missing, wrong or expired; `422` means it has been disabled (or is a browser key, which cannot send host telemetry). Pick a working key in step 1 and update `x-oneuptime-token` in the `config.yaml` you mounted into the container.":
    "1. Revisa los registros del collector en busca de errores de exportación: `docker logs -f otel-collector`. Un HTTP `401` significa que la clave falta, es incorrecta o ha caducado; `422`, que se ha desactivado (o que es una clave de navegador, que no puede enviar telemetría de hosts). Elige una clave que funcione en el paso 1 y actualiza `x-oneuptime-token` en la `config.yaml` que montaste en el contenedor.",
  "2. Check the host can reach OneUptime: `curl -v <YOUR_ONEUPTIME_URL>/otlp` from the same machine.":
    "2. Comprueba que el host llega a OneUptime: `curl -v <YOUR_ONEUPTIME_URL>/otlp` desde la misma máquina.",
  "3. Keep `resourcedetection` in the metrics pipeline — it sets `host.name`, which is how OneUptime recognises the host.":
    "3. Mantén `resourcedetection` en el pipeline de métricas: define `host.name`, que es como OneUptime reconoce el host.",
  "The collector is reading its own container's kernel view. Run it with `--network host`, `--pid host`, the `/:/hostfs` bind mount and the `HOST_*` variables exactly as step 3 shows — without them the `hostmetrics` and `process` scrapers only see the collector container itself.":
    "El collector está leyendo la vista del kernel de su propio contenedor. Ejecútalo con `--network host`, `--pid host`, el montaje `/:/hostfs` y las variables `HOST_*` exactamente como muestra el paso 3: sin ellos, los scrapers `hostmetrics` y `process` solo ven el propio contenedor del collector.",
  "A Debian or Ubuntu host (amd64 or arm64) with `sudo`":
    "Un host Debian o Ubuntu (amd64 o arm64) con `sudo`",
  "Save this as `config.yaml` in your current directory — step 3 installs it.":
    "Guarda esto como `config.yaml` en tu directorio actual: el paso 3 lo instala.",
  "> **Note for native installs:** Unlike Docker, the package install reads `/proc` and `/sys` directly — no `HOST_PROC` env vars or `/hostfs` mount required. The systemd unit shipped with the package runs as the unprivileged `otelcol-contrib` user; if you want the `process` scraper to see processes owned by other users, grant it `CAP_SYS_PTRACE` or run it as root.":
    "> **Nota para las instalaciones nativas:** a diferencia de Docker, la instalación por paquete lee `/proc` y `/sys` directamente, sin variables de entorno `HOST_PROC` ni montaje `/hostfs`. La unidad systemd que trae el paquete se ejecuta con el usuario sin privilegios `otelcol-contrib`; si quieres que el scraper `process` vea procesos de otros usuarios, concédele `CAP_SYS_PTRACE` o ejecútalo como root.",
  "`otelcol-contrib` has bundled the `systemd` receiver since **v0.142.0**; run **v0.143.0 or newer**, which is where its CPU metric settled on its current name and stopped probing non-service units. Turn it on by adding it to `/etc/otelcol-contrib/config.yaml` and the metrics pipeline. Merge it into the sections your config already has — don't add a second `processors:` or `service:` key.":
    "`otelcol-contrib` incluye el receptor `systemd` desde la **v0.142.0**; usa la **v0.143.0 o posterior**, que es donde su métrica de CPU tomó su nombre actual y dejó de sondear unidades que no son servicios. Actívalo añadiéndolo a `/etc/otelcol-contrib/config.yaml` y al pipeline de métricas. Intégralo en las secciones que tu configuración ya tiene: no añadas una segunda clave `processors:` o `service:`.",
  "Then restart the service:": "Luego reinicia el servicio:",
  "The receiver is **Linux-only** and **alpha**. It reads unit state over the system D-Bus using the same read-only calls as `systemctl list-units`, which systemd allows unprivileged, so the packaged service — which runs as the `otelcol-contrib` user — needs no extra rights. A containerised collector cannot reach the host's bus, so use a native install. Once metrics arrive, the host **Systemd Units** tab populates with every scraped unit and its current state (`active`, `failed`, `inactive`, ...).":
    "El receptor es **solo para Linux** y está en **alfa**. Lee el estado de las unidades por el D-Bus del sistema con las mismas llamadas de solo lectura que `systemctl list-units`, que systemd permite sin privilegios, así que el servicio del paquete, que se ejecuta con el usuario `otelcol-contrib`, no necesita permisos adicionales. Un collector en contenedor no llega al bus del host, así que usa una instalación nativa. En cuanto llegan métricas, la pestaña **Unidades de systemd** del host se llena con cada unidad recopilada y su estado actual (`active`, `failed`, `inactive`, ...).",
  "Each unit costs eight datapoints per scrape for the state set, plus two more if you leave the CPU metric on, so on a host with hundreds of units narrow `units:` or raise `collection_interval` rather than scraping everything.":
    "Cada unidad cuesta ocho puntos de datos por recopilación para el conjunto de estados, más dos si dejas activada la métrica de CPU, así que en un host con cientos de unidades acota `units:` o sube `collection_interval` en lugar de recopilarlo todo.",
  "**AI investigations are on by default** for every host: once the Host AI agent runs on it, OneUptime AI investigates incidents and alerts there with read-only commands such as `systemctl status`, `df -h`, `free -m` and `ps aux`, and changes nothing unless you allow fixes. It is a Linux container with its own installer; it needs Docker (the system engine, not rootless Docker) with the Compose plugin:":
    "**Las investigaciones de IA están activadas por defecto** para cada host: en cuanto el agente de IA del host se ejecuta en él, OneUptime AI investiga allí incidentes y alertas con comandos de solo lectura como `systemctl status`, `df -h`, `free -m` y `ps aux`, y no cambia nada salvo que permitas correcciones. Es un contenedor Linux con su propio instalador; necesita Docker (el motor del sistema, no Docker sin root) con el plugin Compose:",
  "The config already fills the machine's IP addresses, MAC addresses, architecture, machine id, OS description and OS version onto its **Inventory** item, which is what a CMDB export reads. Serial number, make, model and firmware (BIOS / UEFI) version are different: **no resource detector can produce them.** They come from the machine's firmware through DMI, and the packaged collector runs unprivileged, so it cannot read them itself. Read them once at provisioning time and stamp them onto the resource — add this processor to `/etc/otelcol-contrib/config.yaml` and name it in the metrics pipeline. Merge it into the sections your config already has — don't add a second `processors:` or `service:` key.":
    "La configuración ya rellena las direcciones IP, las direcciones MAC, la arquitectura, el ID de máquina, la descripción y la versión del sistema operativo en el elemento de la máquina en **Inventario**, que es lo que lee una exportación CMDB. El número de serie, el fabricante, el modelo y la versión del firmware (BIOS / UEFI) son distintos: **ningún detector de recursos puede obtenerlos.** Proceden del firmware de la máquina, a través de DMI, y el collector del paquete se ejecuta sin privilegios, así que no puede leerlos por sí mismo. Léelos una vez al aprovisionar la máquina y fíjalos en el recurso: añade este procesador a `/etc/otelcol-contrib/config.yaml` y nómbralo en el pipeline de métricas. Intégralo en las secciones que tu configuración ya tiene: no añadas una segunda clave `processors:` o `service:`.",
  "Add a `resource` processor to `/etc/otelcol-contrib/config.yaml` and reference it from the metrics pipeline. Merge it into the sections your config already has — don't add a second `processors:` or `service:` key.":
    "Añade un procesador `resource` a `/etc/otelcol-contrib/config.yaml` y haz referencia a él desde el pipeline de métricas. Intégralo en las secciones que tu configuración ya tiene: no añadas una segunda clave `processors:` o `service:`.",
  "- The **Systemd Units** tab lists unit state once the `systemd` receiver is enabled (see **Enable the Systemd Units tab**).":
    "- La pestaña **Unidades de systemd** lista el estado de las unidades en cuanto se activa el receptor `systemd` (consulta **Habilitar la pestaña Unidades de systemd**).",
  "1. Read the collector's logs for export errors: `sudo journalctl -u otelcol-contrib -f`. An HTTP `401` means the key is missing, wrong or expired; `422` means it has been disabled (or is a browser key, which cannot send host telemetry). Pick a working key in step 1 and update `x-oneuptime-token` in `/etc/otelcol-contrib/config.yaml`.":
    "1. Revisa los registros del collector en busca de errores de exportación: `sudo journalctl -u otelcol-contrib -f`. Un HTTP `401` significa que la clave falta, es incorrecta o ha caducado; `422`, que se ha desactivado (o que es una clave de navegador, que no puede enviar telemetría de hosts). Elige una clave que funcione en el paso 1 y actualiza `x-oneuptime-token` en `/etc/otelcol-contrib/config.yaml`.",
  "1. Keep `resourcedetection` in the same metrics pipeline as the `systemd` receiver — the receiver attaches only `systemd.unit.name` to each unit, so without `host.name` the samples never attach to the host.":
    "1. Mantén `resourcedetection` en el mismo pipeline de métricas que el receptor `systemd`: el receptor solo añade `systemd.unit.name` a cada unidad, así que sin `host.name` las muestras nunca se asocian al host.",
  "2. Run `otelcol-contrib` v0.143.0 or newer: older builds stop at startup with `'receivers' unknown type: \"systemd\"`, or name the CPU metric differently (see **Enable the Systemd Units tab**).":
    "2. Usa `otelcol-contrib` v0.143.0 o posterior: las compilaciones anteriores se detienen al arrancar con `'receivers' unknown type: \"systemd\"` o llaman de otra forma a la métrica de CPU (consulta **Habilitar la pestaña Unidades de systemd**).",
  "3. Check the collector can reach the system D-Bus: `/run/dbus/system_bus_socket` must exist, and `systemctl list-units` run as the collector's user is the quickest test. Root is not required.":
    "3. Comprueba que el collector llega al D-Bus del sistema: `/run/dbus/system_bus_socket` debe existir, y `systemctl list-units` ejecutado con el usuario del collector es la prueba más rápida. No hace falta root.",
  "A RHEL, CentOS, Fedora or Amazon Linux host (x86_64 or aarch64) with `sudo`":
    "Un host RHEL, CentOS, Fedora o Amazon Linux (x86_64 o aarch64) con `sudo`",
  "A Linux host (x86_64 or aarch64) that runs systemd, with `sudo`":
    "Un host Linux (x86_64 o aarch64) que use systemd, con `sudo`",
  "Drop a systemd unit at `/etc/systemd/system/otelcol-contrib.service`:":
    "Crea una unidad systemd en `/etc/systemd/system/otelcol-contrib.service`:",
  "Then enable and start it:": "Luego actívala e iníciala:",
  "Use this when packages aren't available — locked-down servers, or container base images you want to instrument from outside. No `HOST_PROC` env vars or `/hostfs` mount are needed: the collector reads kernel state directly, and `User=root` lets the `process` scraper see processes owned by other users (granting `CAP_SYS_PTRACE` instead works too).":
    "Usa esta opción cuando no haya paquetes disponibles: servidores bloqueados o imágenes base de contenedores que quieres instrumentar desde fuera. No hacen falta variables de entorno `HOST_PROC` ni el montaje `/hostfs`: el collector lee el estado del kernel directamente, y `User=root` permite que el scraper `process` vea procesos de otros usuarios (conceder `CAP_SYS_PTRACE` también funciona).",
  "The receiver is **Linux-only** and **alpha**. It reads unit state over the system D-Bus using the same read-only calls as `systemctl list-units`, which systemd allows unprivileged, so it needs no extra rights. A containerised collector cannot reach the host's bus, so use a native install. Once metrics arrive, the host **Systemd Units** tab populates with every scraped unit and its current state (`active`, `failed`, `inactive`, ...).":
    "El receptor es **solo para Linux** y está en **alfa**. Lee el estado de las unidades por el D-Bus del sistema con las mismas llamadas de solo lectura que `systemctl list-units`, que systemd permite sin privilegios, así que no necesita permisos adicionales. Un collector en contenedor no llega al bus del host, así que usa una instalación nativa. En cuanto llegan métricas, la pestaña **Unidades de systemd** del host se llena con cada unidad recopilada y su estado actual (`active`, `failed`, `inactive`, ...).",
  "The config already fills the machine's IP addresses, MAC addresses, architecture, machine id, OS description and OS version onto its **Inventory** item, which is what a CMDB export reads. Serial number, make, model and firmware (BIOS / UEFI) version are different: **no resource detector can produce them.** They come from the machine's firmware through DMI. Read them once at provisioning time and stamp them onto the resource — add this processor to `/opt/otelcol-contrib/config.yaml` and name it in the metrics pipeline. Merge it into the sections your config already has — don't add a second `processors:` or `service:` key.":
    "La configuración ya rellena las direcciones IP, las direcciones MAC, la arquitectura, el ID de máquina, la descripción y la versión del sistema operativo en el elemento de la máquina en **Inventario**, que es lo que lee una exportación CMDB. El número de serie, el fabricante, el modelo y la versión del firmware (BIOS / UEFI) son distintos: **ningún detector de recursos puede obtenerlos.** Proceden del firmware de la máquina, a través de DMI. Léelos una vez al aprovisionar la máquina y fíjalos en el recurso: añade este procesador a `/opt/otelcol-contrib/config.yaml` y nómbralo en el pipeline de métricas. Intégralo en las secciones que tu configuración ya tiene: no añadas una segunda clave `processors:` o `service:`.",
  "A Mac (Apple silicon or Intel) and an administrator account for `sudo`":
    "Un Mac (Apple silicon o Intel) y una cuenta de administrador para `sudo`",
  "Create `/Library/LaunchDaemons/com.oneuptime.otelcol-contrib.plist`:":
    "Crea `/Library/LaunchDaemons/com.oneuptime.otelcol-contrib.plist`:",
  "Load it:": "Cárgalo:",
  "> **Install the contrib build, as above.** The core `otelcol` build has no `resourcedetection` processor, so it refuses to start with this config.":
    "> **Instala la compilación contrib, como arriba.** La compilación core `otelcol` no tiene el procesador `resourcedetection`, así que se niega a arrancar con esta configuración.",
  "The config already fills the machine's IP addresses, MAC addresses, architecture, machine id, OS description and OS version onto its **Inventory** item, which is what a CMDB export reads. Serial number, make, model and firmware (BIOS / UEFI) version are different: **no resource detector can produce them.** They come from the machine's firmware. Read them once at provisioning time and stamp them onto the resource — add this processor to `/etc/otelcol-contrib/config.yaml` and name it in the metrics pipeline. Merge it into the sections your config already has — don't add a second `processors:` or `service:` key.":
    "La configuración ya rellena las direcciones IP, las direcciones MAC, la arquitectura, el ID de máquina, la descripción y la versión del sistema operativo en el elemento de la máquina en **Inventario**, que es lo que lee una exportación CMDB. El número de serie, el fabricante, el modelo y la versión del firmware (BIOS / UEFI) son distintos: **ningún detector de recursos puede obtenerlos.** Proceden del firmware de la máquina. Léelos una vez al aprovisionar la máquina y fíjalos en el recurso: añade este procesador a `/etc/otelcol-contrib/config.yaml` y nómbralo en el pipeline de métricas. Intégralo en las secciones que tu configuración ya tiene: no añadas una segunda clave `processors:` o `service:`.",
  "Then restart the collector:": "Luego reinicia el collector:",
  "The values are the machine's own, so they are written once by whatever provisions it. On a Mac, read them like this — the manufacturer is `Apple Inc.`:":
    "Los valores son propios de la máquina, así que los escribe una sola vez lo que la aprovisiona. En un Mac, léelos así (el fabricante es `Apple Inc.`):",
  "`hw.model` is the model *identifier* (`MacBookPro18,3`), not the marketing name. Put it in `device.model.name` anyway — `device.model.identifier` marks a batch as a mobile app.":
    "`hw.model` es el *identificador* del modelo (`MacBookPro18,3`), no el nombre comercial. Ponlo igualmente en `device.model.name`: `device.model.identifier` marca un lote como una app móvil.",
  "Windows 10 1803+ or Windows Server 2019+ (for the built-in `tar.exe`)":
    "Windows 10 1803+ o Windows Server 2019+ (por el `tar.exe` integrado)",
  "An elevated PowerShell prompt (Run as administrator)":
    "Un símbolo del sistema de PowerShell con privilegios elevados (Ejecutar como administrador)",
  "Save this as `config.yaml` in the folder you will run the PowerShell commands from — step 3 copies it into place.":
    "Guarda esto como `config.yaml` en la carpeta desde la que ejecutarás los comandos de PowerShell: el paso 3 lo copia a su sitio.",
  "On Windows, install the upstream **`otelcol-contrib`** collector — from **v0.155.0** it bundles the `windows_service` receiver that powers the host **Services** tab. Run from an elevated PowerShell prompt:":
    "En Windows, instala el collector original **`otelcol-contrib`**: desde la **v0.155.0** incluye el receptor `windows_service` que alimenta la pestaña **Servicios** del host. Ejecútalo desde un símbolo del sistema de PowerShell con privilegios elevados:",
  "> **Note:** The service runs as `LocalSystem` so it can read every Windows service. On Windows the `load` scraper only emulates a load average from the *Processor Queue Length* counter (it starts at 0); if it can't read the counter it is logged and skipped, so the rest of the `hostmetrics` config runs unchanged. The [Host OpenTelemetry Collector docs](/docs/telemetry/host-otel-collector) also cover the signed `.msi` installer.":
    "> **Nota:** el servicio se ejecuta como `LocalSystem` para poder leer todos los servicios de Windows. En Windows, el scraper `load` solo emula una carga media a partir del contador *Processor Queue Length* (empieza en 0); si no puede leer el contador, se registra y se omite, y el resto de la configuración `hostmetrics` se ejecuta sin cambios. La [documentación del OpenTelemetry Collector para hosts](/docs/telemetry/host-otel-collector) también cubre el instalador `.msi` firmado.",
  "Logs are written to the Windows Application event log; view them in **Event Viewer → Windows Logs → Application** (source `otelcol-contrib`).":
    "Los registros se escriben en el registro de eventos Aplicación de Windows; consúltalos en **Event Viewer → Windows Logs → Application** (origen `otelcol-contrib`).",
  "From **v0.155.0** `otelcol-contrib` includes the `windows_service` receiver — turn it on by adding it to `C:\\Program Files\\otelcol-contrib\\config.yaml` and the metrics pipeline. Merge it into the sections your config already has — don't add a second `processors:` or `service:` key.":
    "Desde la **v0.155.0**, `otelcol-contrib` incluye el receptor `windows_service`: actívalo añadiéndolo a `C:\\Program Files\\otelcol-contrib\\config.yaml` y al pipeline de métricas. Intégralo en las secciones que tu configuración ya tiene: no añadas una segunda clave `processors:` o `service:`.",
  "The receiver is **Windows-only** and **alpha**. Once metrics arrive, the host **Services** tab populates automatically with each service's running state and startup type.":
    "El receptor es **solo para Windows** y está en **alfa**. En cuanto llegan métricas, la pestaña **Servicios** del host se llena automáticamente con el estado de ejecución y el tipo de inicio de cada servicio.",
  "The config already fills the machine's IP addresses, MAC addresses, architecture, machine id, OS description and OS version onto its **Inventory** item, which is what a CMDB export reads. Serial number, make, model and firmware (BIOS / UEFI) version are different: **no resource detector can produce them.** They come from the machine's firmware through WMI.":
    "La configuración ya rellena las direcciones IP, las direcciones MAC, la arquitectura, el ID de máquina, la descripción y la versión del sistema operativo en el elemento de la máquina en **Inventario**, que es lo que lee una exportación CMDB. El número de serie, el fabricante, el modelo y la versión del firmware (BIOS / UEFI) son distintos: **ningún detector de recursos puede obtenerlos.** Proceden del firmware de la máquina, a través de WMI.",
  "Run this from an elevated PowerShell prompt on the machine — it queries WMI and prints the exact YAML for *this* machine:":
    "Ejecuta esto desde un símbolo del sistema de PowerShell con privilegios elevados en la máquina: consulta WMI e imprime el YAML exacto de *esta* máquina:",
  "It prints one processor entry, already indented. Add it inside the `processors:` block your `config.yaml` already has — alongside `resourcedetection:`, `resource:` and `batch:`, not as a second `processors:` key — then name it in the metrics pipeline:":
    "Imprime una entrada de procesador, ya sangrada. Añádela dentro del bloque `processors:` que ya tiene tu `config.yaml`, junto a `resourcedetection:`, `resource:` y `batch:`, no como una segunda clave `processors:`, y luego nómbrala en el pipeline de métricas:",
  "Use `Get-CimInstance`, not the deprecated `Get-WmiObject` — it is absent from PowerShell 7 and later. Values are emitted in single quotes with any embedded quote doubled, so a serial or model containing punctuation stays valid YAML. A field the firmware leaves empty prints as `''`; drop that attribute rather than shipping a blank one.":
    "Usa `Get-CimInstance`, no el obsoleto `Get-WmiObject`, que no existe en PowerShell 7 ni posteriores. Los valores se emiten entre comillas simples, con cada comilla interna duplicada, para que un número de serie o un modelo con signos de puntuación siga siendo YAML válido. Un campo que el firmware deja vacío se imprime como `''`; quita ese atributo en lugar de enviar uno en blanco.",
  "Within a few minutes the machine's **Inventory** item shows `host.serial_number`, `device.manufacturer`, `device.model.name` and `device.firmware.version` under **Details**, alongside the IP and MAC addresses and machine id the detector already supplies. Run this again after a motherboard swap or a BIOS update — the values are stamped, not detected, so they do not update themselves.":
    "En unos minutos, el elemento de la máquina en **Inventario** muestra en **Detalles** `host.serial_number`, `device.manufacturer`, `device.model.name` y `device.firmware.version`, junto a las direcciones IP y MAC y el ID de máquina que el detector ya aporta. Vuelve a ejecutar esto tras cambiar la placa base o actualizar la BIOS: los valores están fijados, no detectados, así que no se actualizan solos.",
  "- The **Services** tab lists each service's state once the `windows_service` receiver is enabled (see **Enable the Windows Services tab**).":
    "- La pestaña **Servicios** lista el estado de cada servicio en cuanto se activa el receptor `windows_service` (consulta **Habilitar la pestaña Servicios de Windows**).",
  "1. Read the collector's logs for export errors: **Event Viewer → Windows Logs → Application** (source `otelcol-contrib`). An HTTP `401` means the key is missing, wrong or expired; `422` means it has been disabled (or is a browser key, which cannot send host telemetry). Pick a working key in step 1 and update `x-oneuptime-token` in `C:\\Program Files\\otelcol-contrib\\config.yaml`.":
    "1. Revisa los registros del collector en busca de errores de exportación: **Event Viewer → Windows Logs → Application** (origen `otelcol-contrib`). Un HTTP `401` significa que la clave falta, es incorrecta o ha caducado; `422`, que se ha desactivado (o que es una clave de navegador, que no puede enviar telemetría de hosts). Elige una clave que funcione en el paso 1 y actualiza `x-oneuptime-token` en `C:\\Program Files\\otelcol-contrib\\config.yaml`.",
  "1. Run the collector in the foreground to see the real error instead of the generic `Error 1064`:":
    "1. Ejecuta el collector en primer plano para ver el error real en lugar del genérico `Error 1064`:",
  '2. `Error 2: The system cannot find the file specified` means the service points at a file that is not there — compare `BINARY_PATH_NAME` from `sc.exe qc "otelcol-contrib"` with the contents of `C:\\Program Files\\otelcol-contrib`. The archive must be the `otelcol-contrib_` one, which unpacks `otelcol-contrib.exe`.':
    '2. `Error 2: The system cannot find the file specified` significa que el servicio apunta a un archivo que no existe: compara `BINARY_PATH_NAME` de `sc.exe qc "otelcol-contrib"` con el contenido de `C:\\Program Files\\otelcol-contrib`. El archivo comprimido debe ser el `otelcol-contrib_`, que descomprime `otelcol-contrib.exe`.',
  "3. **Event Viewer → Windows Logs → Application** (source `otelcol-contrib`) records the startup error the service manager swallowed.":
    "3. **Event Viewer → Windows Logs → Application** (origen `otelcol-contrib`) registra el error de arranque que el administrador de servicios se tragó.",
  "If you set `include_services` but still see every service, the collector hasn't picked up the edit — restart the service (`Restart-Service otelcol-contrib`) and give the Services tab a few minutes to refresh its rolling window.":
    "Si defines `include_services` pero sigues viendo todos los servicios, el collector no ha aplicado el cambio: reinicia el servicio (`Restart-Service otelcol-contrib`) y dale a la pestaña Servicios unos minutos para actualizar su ventana móvil.",
  "Kubernetes nodes are monitored by the **OneUptime Kubernetes agent** rather than a host collector: each node appears under **Kubernetes** → your cluster → **Nodes**, next to its pods and workloads, not in the **Hosts** list. The steps below install the agent on a standard cluster; the install guide in the **Kubernetes** section has the steps for Amazon EKS, Google GKE, Azure AKS, GKE Autopilot and EKS Fargate.":
    "Los nodos de Kubernetes los supervisa el **agente de Kubernetes de OneUptime** en lugar de un collector de host: cada nodo aparece en **Kubernetes** → tu clúster → **Nodos**, junto a sus pods y workloads, no en la lista **Hosts**. Los pasos de abajo instalan el agente en un clúster estándar; la guía de instalación de la sección **Kubernetes** tiene los pasos para Amazon EKS, Google GKE, Azure AKS, GKE Autopilot y EKS Fargate.",
  "A Kubernetes cluster running v1.23 or later":
    "Un clúster de Kubernetes con v1.23 o posterior",
  "`kubectl` and `helm` (v3) installed on your machine":
    "`kubectl` y `helm` (v3) instalados en tu equipo",
  "Wrong cluster? Switch with `kubectl config use-context <context-name>`.":
    "¿Clúster equivocado? Cambia con `kubectl config use-context <context-name>`.",
  "Replace `my-cluster` with a name for this cluster, such as `prod-us-east-1`. It is how the cluster appears in OneUptime, so keep it stable: a new name registers a new cluster.":
    "Sustituye `my-cluster` por un nombre para este clúster, como `prod-us-east-1`. Es como aparece el clúster en OneUptime, así que mantenlo estable: un nombre nuevo registra un clúster nuevo.",
  "`--set aiAgent.enabled=true` turns **AI investigations** on, as the chart does by default: OneUptime AI investigates incidents and alerts on this cluster with read-only kubectl, through the Kubernetes AI agent.":
    "`--set aiAgent.enabled=true` activa las **investigaciones de IA**, como hace el chart por defecto: OneUptime AI investiga incidentes y alertas de este clúster con kubectl de solo lectura, a través del agente de IA de Kubernetes.",
  "You should see:": "Deberías ver:",
  "The collector and the Kubernetes AI agent, plus one `-logs` and one `-ebpf` pod on every node. Once they are `Running`, the cluster appears automatically in the **Kubernetes** section — usually within a minute or two.":
    "El recopilador y el agente de IA de Kubernetes, más un pod `-logs` y un pod `-ebpf` en cada nodo. Cuando estén en `Running`, el clúster aparece automáticamente en la sección **Kubernetes**, normalmente en uno o dos minutos.",
  "**Kubernetes AI agent (on by default, read-only).** The `kubernetes-agent-ai-agent` pod lets OneUptime AI investigate incidents and alerts on this cluster with read-only kubectl — `get`, `describe`, `logs`, `events`, `top` — using the same API key, and it can change nothing unless you give it write access later. Open the cluster and go to **AI → Agent** to see it. Don't want it? Install with `--set aiAgent.enabled=false` instead of `--set aiAgent.enabled=true`.":
    "**Agente de IA de Kubernetes (activado por defecto, solo lectura).** El pod `kubernetes-agent-ai-agent` permite a OneUptime AI investigar incidentes y alertas de este clúster con kubectl de solo lectura (`get`, `describe`, `logs`, `events`, `top`), con la misma clave de API, y no puede cambiar nada a menos que más adelante le des acceso de escritura. Abre el clúster y ve a **IA → Agente** para verlo. ¿No lo quieres? Instala con `--set aiAgent.enabled=false` en lugar de `--set aiAgent.enabled=true`.",
  "Namespace rules decide what the agent collects from each namespace. To collect pod logs and eBPF data only from `default`, `production` and `staging`:":
    "Las reglas de espacios de nombres deciden qué recoge el agente de cada espacio de nombres. Para recoger registros de pods y datos de eBPF solo de `default`, `production` y `staging`:",
  "To keep everything but stop the logs of noisy namespaces, exclude them from `podLogs` only:":
    "Para conservarlo todo pero detener los registros de los espacios de nombres ruidosos, exclúyelos solo de `podLogs`:",
  "- **Scopes:** `podLogs` (container stdout/stderr), `ebpfDiscovery` (eBPF traces and metrics), `metrics` (namespaced metrics) and `traces` (every span).":
    "- **Alcances:** `podLogs` (stdout/stderr de los contenedores), `ebpfDiscovery` (trazas y métricas de eBPF), `metrics` (métricas con espacio de nombres) y `traces` (todos los spans).",
  "- **Patterns** match the whole namespace name and accept `*`, as in `team-*`. An `exclude` rule always wins over an `include` rule.":
    "- Los **patrones** coinciden con el nombre completo del espacio de nombres y aceptan `*`, como en `team-*`. Una regla `exclude` siempre gana a una regla `include`.",
  "- **Setting the rules replaces the default one**, which excludes `kube-system` from `podLogs` and `ebpfDiscovery`. Keep it in your list, as in the second example, if you still want that.":
    "- **Definir las reglas sustituye la regla predeterminada**, que excluye `kube-system` de `podLogs` y `ebpfDiscovery`. Mantenla en tu lista, como en el segundo ejemplo, si todavía la quieres.",
  "- Node and cluster metrics have no namespace, so they are always kept.":
    "- Las métricas de nodo y de clúster no tienen espacio de nombres, así que siempre se conservan.",
  "- `--set-json` needs Helm 3.10 or later.":
    "- `--set-json` requiere Helm 3.10 o posterior.",
  "**Only send important lines.** Drop pod log lines below a severity before they leave the cluster:":
    "**Envía solo las líneas importantes.** Descarta las líneas de registro de pods por debajo de una gravedad antes de que salgan del clúster:",
  'Accepts `TRACE`, `DEBUG`, `INFO`, `WARN`, `ERROR` and `FATAL`: `WARN` keeps warnings, errors and fatal lines. The severity is read from the log line itself (`[ERROR]`, `level=warn`, `"level":"info"`). Kubernetes events are never dropped by this.':
    'Acepta `TRACE`, `DEBUG`, `INFO`, `WARN`, `ERROR` y `FATAL`: `WARN` conserva advertencias, errores y líneas fatales. La gravedad se lee de la propia línea de registro (`[ERROR]`, `level=warn`, `"level":"info"`). Esto nunca descarta los eventos de Kubernetes.',
  "**Turn pod logs off.** Metrics are not affected — the node collector keeps running for kubelet and cAdvisor metrics, it just stops reading pod logs:":
    "**Desactiva los registros de pods.** Las métricas no se ven afectadas: el recopilador de nodos sigue funcionando para las métricas de kubelet y cAdvisor; solo deja de leer los registros de pods:",
  "**Change how logs are read.** The preset picks this for you; an explicit `logs.mode` always wins over it:":
    "**Cambia cómo se leen los registros.** El preset lo elige por ti; un `logs.mode` explícito siempre tiene prioridad:",
  "- `logs.mode=daemonset` — reads `/var/log/pods` on every node through hostPath (lowest overhead; needs hostPath).":
    "- `logs.mode=daemonset`: lee `/var/log/pods` en cada nodo mediante hostPath (la menor sobrecarga; requiere hostPath).",
  "- `logs.mode=api` — a Deployment tails pod logs through the Kubernetes API (works on any cluster).":
    "- `logs.mode=api`: un Deployment sigue los registros de pods a través de la API de Kubernetes (funciona en cualquier clúster).",
  "- `logs.mode=disabled` — no pod logs.":
    "- `logs.mode=disabled`: sin registros de pods.",
  "That reads the API server, where it answers inside the cluster. etcd, the scheduler and the controller manager answer on the control-plane nodes, which the agent's pod cannot guess, so it reads them once you list each node's address:":
    "Eso lee el servidor de API, donde responde dentro del clúster. etcd, el planificador y el administrador de controladores responden en los nodos del plano de control, que el pod del agente no puede adivinar, así que los lee en cuanto indicas la dirección de cada nodo:",
  "- **The scheduler and the controller manager** serve HTTPS and accept the agent's token, but kubeadm binds them to `127.0.0.1`: give them a `--bind-address` the agent's pod can reach.":
    "- **El planificador y el administrador de controladores** sirven HTTPS y aceptan el token del agente, pero kubeadm los vincula a `127.0.0.1`: dales una `--bind-address` que el pod del agente pueda alcanzar.",
  "- **etcd** serves its metrics in plain HTTP on kubeadm's `--listen-metrics-urls` (port 2381, bound to `127.0.0.1` until you add the node's address), as above. Or scrape its HTTPS client port, 2379, with the client certificate it asks for: put `ca.crt`, `tls.crt` and `tls.key` in a Secret in `oneuptime-agent` and name it in `controlPlane.etcd.clientCertSecret`.":
    "- **etcd** sirve sus métricas en HTTP simple en las `--listen-metrics-urls` de kubeadm (puerto 2381, vinculado a `127.0.0.1` hasta que añadas la dirección del nodo), como arriba. O consulta su puerto de cliente HTTPS, 2379, con el certificado de cliente que pide: pon `ca.crt`, `tls.crt` y `tls.key` en un Secret en `oneuptime-agent` e indícalo en `controlPlane.etcd.clientCertSecret`.",
  "Only for self-managed clusters: managed services (EKS, GKE, AKS) do not expose their control plane metrics.":
    "Solo para clústeres autogestionados: los servicios gestionados (EKS, GKE, AKS) no exponen las métricas de su plano de control.",
  "Cost monitoring is on by default: the agent bundles the open-source OpenCost engine (plus the small Prometheus it needs), prices your nodes and volumes from your cloud provider's public list prices — no credentials required — and sends what each namespace and workload costs. The first data appears on the cluster's overview and Costs page after the first full hour.":
    "El monitoreo de costos está activado por defecto: el agente incluye el motor de código abierto OpenCost (más el pequeño Prometheus que necesita), pone precio a tus nodos y volúmenes según los precios públicos de lista de tu proveedor de nube, sin credenciales, y envía cuánto cuesta cada espacio de nombres y cada carga de trabajo. Los primeros datos aparecen en la vista general del clúster y en su página Costos después de la primera hora completa.",
  "On an agent installed before it was on by default, upgrade it:":
    "Si tu agente se instaló antes de que estuviera activado por defecto, actualízalo:",
  "- **Turn it off:** add `--set cost.enabled=false` to the same upgrade.":
    "- **Para desactivarlo:** añade `--set cost.enabled=false` a la misma actualización.",
  "- **Already running Kubecost or OpenCost?** The agent finds it and reads it instead of the bundled engine, and the cluster's overview says so: add `--set cost.engine.url=auto` to stop bundling a second one.":
    "- **¿Ya usas Kubecost u OpenCost?** El agente lo detecta y lo lee en lugar del motor incluido, y la vista general del clúster lo indica: añade `--set cost.engine.url=auto` para dejar de incluir un segundo motor.",
  "- **On-prem or bare metal?** Set a rate card with `--set cost.opencost.customPricing.enabled=true` (USD per resource-hour — see the chart's `values.yaml`).":
    "- **¿Local o bare metal?** Define una tarifa con `--set cost.opencost.customPricing.enabled=true` (USD por hora de recurso; consulta el `values.yaml` del chart).",
  "Full guide: [Kubernetes Cost Observability](/docs/telemetry/kubernetes-cost).":
    "Guía completa: [Observabilidad de costes de Kubernetes](/docs/telemetry/kubernetes-cost).",
  "The agent runs [OpenTelemetry eBPF Instrumentation (OBI)](https://opentelemetry.io/docs/zero-code/obi/) on every node. It captures HTTP/HTTPS, gRPC and SQL/Redis traffic from Go, .NET, Java, Node.js, Python, Ruby and Rust services — no SDK and no sidecar — and ships traces, request (RED) metrics and service-graph data through the collector.":
    "El agente ejecuta [OpenTelemetry eBPF Instrumentation (OBI)](https://opentelemetry.io/docs/zero-code/obi/) en cada nodo. Captura el tráfico HTTP/HTTPS, gRPC y SQL/Redis de servicios en Go, .NET, Java, Node.js, Python, Ruby y Rust, sin SDK ni sidecar, y envía trazas, métricas de peticiones (RED) y datos del grafo de servicios a través del recopilador.",
  "**Requirements:** Linux kernel **5.8+** with BTF (the default on Debian 11+, Ubuntu 20.10+, Fedora 34+, RHEL 9+). The eBPF pods run **privileged**, which they need to load eBPF programs.":
    "**Requisitos:** kernel de Linux **5.8+** con BTF (el predeterminado en Debian 11+, Ubuntu 20.10+, Fedora 34+, RHEL 9+). Los pods de eBPF se ejecutan **con privilegios**, que necesitan para cargar programas eBPF.",
  "**Turn it off** if your nodes run an older kernel, if privileged pods are not allowed, or if your services already send traces with OpenTelemetry SDKs and you don't want duplicates:":
    "**Desactívalo** si tus nodos usan un kernel más antiguo, si no se permiten pods con privilegios o si tus servicios ya envían trazas con SDK de OpenTelemetry y no quieres duplicados:",
  "**Choose the signals.** Each family is switched with `--set ebpf.features.<name>=false` (or `=true`):":
    "**Elige las señales.** Cada familia se activa o desactiva con `--set ebpf.features.<name>=false` (o `=true`):",
  "| `ebpf.features.*` | Default | What it adds |":
    "| `ebpf.features.*` | Predeterminado | Qué añade |",
  "| `httpMetrics` | on | HTTP/gRPC request rate, errors and latency per service |":
    "| `httpMetrics` | activado | Tasa de peticiones HTTP/gRPC, errores y latencia por servicio |",
  "| `spanMetrics` | on | Span call count and duration (`traces.span.metrics.*`) |":
    "| `spanMetrics` | activado | Número de llamadas y duración de los spans (`traces.span.metrics.*`) |",
  "| `serviceGraph` | on | Caller → callee edges; drives the service map |":
    "| `serviceGraph` | activado | Aristas de llamador → llamado; alimenta el mapa de servicios |",
  "| `networkMetrics` | on | Pod-to-pod TCP/UDP flow counters |":
    "| `networkMetrics` | activado | Contadores de flujos TCP/UDP de pod a pod |",
  "| `networkInterZoneMetrics` | off | Inter-zone network metrics (doubles their cardinality) |":
    "| `networkInterZoneMetrics` | desactivado | Métricas de red entre zonas (duplica su cardinalidad) |",
  "| `tcpStats` | on | Node-level TCP RTT, failed-connection and retransmit counters |":
    "| `tcpStats` | activado | RTT de TCP y contadores de conexiones fallidas y retransmisiones por nodo |",
  "**Cross-service trace propagation** — linking a request that crosses pod A → pod B into a single trace, on another node too — is **on by default**. It works by rewriting traffic that is already in flight (widening plaintext HTTP requests in the kernel, and appending a TCP option to TLS and raw TCP), and a mistake in that byte accounting desynchronizes the stream — the reported symptom is transfers through an L7 proxy such as nginx hanging once a response passes ~64KB. If you see that, or a service mesh starts failing pods, turn it off with `--set ebpf.contextPropagation=false`; an OpenTelemetry SDK propagates `traceparent` in userspace without any of that.":
    "La **propagación de trazas entre servicios** (enlazar en una sola traza una petición que cruza del pod A → pod B, también en otro nodo) está **activada por defecto**. Funciona reescribiendo tráfico que ya está en curso (ampliando las peticiones HTTP en texto plano en el kernel y añadiendo una opción TCP a TLS y a TCP sin procesar), y un error en esa contabilidad de bytes desincroniza el flujo: el síntoma notificado son transferencias a través de un proxy L7 como nginx que se cuelgan cuando una respuesta supera ~64KB. Si lo ves, o si una malla de servicios empieza a hacer fallar pods, desactívala con `--set ebpf.contextPropagation=false`; un SDK de OpenTelemetry propaga `traceparent` en el espacio de usuario sin nada de eso.",
  "Each `oneuptime.labels.<key>=<value>` becomes the label `<key>:<value>` on the cluster, and on the services and hosts it reports. Labels are matched case-insensitively, so an existing `Production` label is reused; labels added in the OneUptime UI are never removed by the agent.":
    "Cada `oneuptime.labels.<key>=<value>` se convierte en la etiqueta `<key>:<value>` del clúster y de los servicios y hosts que informa. Las etiquetas se comparan sin distinguir mayúsculas y minúsculas, así que se reutiliza una etiqueta `Production` existente; el agente nunca elimina las etiquetas añadidas en la interfaz de OneUptime.",
  "**Upgrade** to the latest chart. `--reset-then-reuse-values` (Helm 3.14+) keeps the values you set (preset, cluster name, filters) and takes everything else from the new chart; add any new `--set` flags on top of it:":
    "**Actualiza** al chart más reciente. `--reset-then-reuse-values` (Helm 3.14+) conserva los valores que definiste (preset, nombre del clúster, filtros) y toma todo lo demás del chart nuevo; añade encima los nuevos indicadores `--set`:",
  "On Helm 3.13 and earlier, upgrade with the values you set instead:":
    "En Helm 3.13 y anteriores, actualiza en su lugar con los valores que definiste:",
  "Don't use `--reuse-values`: it also keeps the defaults of the chart you upgrade from, so a newer chart's defaults (its eBPF image among them) never apply.":
    "No uses `--reuse-values`: también conserva los valores predeterminados del chart desde el que actualizas, así que los valores predeterminados de un chart más nuevo (entre ellos su imagen de eBPF) nunca se aplican.",
  "**Uninstall** the agent and its namespace:":
    "**Desinstala** el agente y su espacio de nombres:",
  "| Category | Data |": "| Categoría | Datos |",
  "| **Node metrics** | CPU, memory, filesystem and network usage |":
    "| **Métricas de nodos** | Uso de CPU, memoria, sistema de archivos y red |",
  "| **Pod and container metrics** | CPU, memory, network I/O and restarts |":
    "| **Métricas de pods y contenedores** | CPU, memoria, E/S de red y reinicios |",
  "| **Cluster metrics** | Node conditions, allocatable resources, pod and workload counts |":
    "| **Métricas del clúster** | Condiciones de los nodos, recursos asignables, recuento de pods y cargas de trabajo |",
  "| **Kubernetes events** | Warnings, errors and scheduling events |":
    "| **Eventos de Kubernetes** | Advertencias, errores y eventos de planificación |",
  "| **Pod logs** | stdout/stderr of every container, read from each node |":
    "| **Registros de pods** | stdout/stderr de cada contenedor, leídos en cada nodo |",
  "| **Application traces** *(eBPF)* | HTTP, gRPC and SQL/Redis spans from every pod — no SDK or code changes |":
    "| **Trazas de aplicaciones** *(eBPF)* | Spans HTTP, gRPC y SQL/Redis de cada pod, sin SDK ni cambios de código |",
  "| **Request metrics and service graph** *(eBPF)* | Request rate, errors and latency per service, and caller → callee edges for the service map |":
    "| **Métricas de peticiones y grafo de servicios** *(eBPF)* | Tasa de peticiones, errores y latencia por servicio, y aristas de llamador → llamado para el mapa de servicios |",
  "| **Network flows** *(eBPF)* | Pod-to-pod TCP/UDP byte and packet counters |":
    "| **Flujos de red** *(eBPF)* | Contadores de bytes y paquetes TCP/UDP de pod a pod |",
  "| **Workload costs** *(on by default)* | Spend per namespace, workload and pod, with idle capacity and efficiency, also as metrics to alert on |":
    "| **Costos de las cargas de trabajo** *(activados por defecto)* | Gasto por espacio de nombres, carga de trabajo y pod, con capacidad ociosa y eficiencia, también como métricas sobre las que alertar |",
  "Your cluster blocks `hostPath` volumes or privileged pods. That is normal on **GKE Autopilot** and **EKS Fargate** — pick that platform at the top of this guide and follow its steps. On **OpenShift** the install succeeds instead, but the agent's node pods never start: pick **Red Hat OpenShift**.":
    "Tu clúster bloquea los volúmenes `hostPath` o los pods con privilegios. Es normal en **GKE Autopilot** y **EKS Fargate**: elige esa plataforma al principio de esta guía y sigue sus pasos. En **OpenShift**, en cambio, la instalación funciona, pero los pods de nodo del agente nunca arrancan: elige **Red Hat OpenShift**.",
  "On any other cluster with a restrictive Pod Security policy, remove the failed release:":
    "En cualquier otro clúster con una política restrictiva de Pod Security, elimina la release fallida:",
  "Then run the install command again with `--set preset=gke-autopilot` added. That preset reads pod logs through the Kubernetes API instead of hostPath, applies a hardened security context, and leaves out the privileged eBPF and profiling pods.":
    "Luego vuelve a ejecutar el comando de instalación añadiendo `--set preset=gke-autopilot`. Ese preset lee los registros de pods a través de la API de Kubernetes en lugar de hostPath, aplica un contexto de seguridad reforzado y deja fuera los pods con privilegios de eBPF y de profiling.",
  "1. Check that the agent's pods are running: `kubectl get pods -n oneuptime-agent`":
    "1. Comprueba que los pods del agente se están ejecutando: `kubectl get pods -n oneuptime-agent`",
  "2. Check the collector's logs: `kubectl logs -n oneuptime-agent deployment/kubernetes-agent`":
    "2. Revisa los registros del recopilador: `kubectl logs -n oneuptime-agent deployment/kubernetes-agent`",
  "3. Verify the OneUptime URL and ingestion key in the install command are correct.":
    "3. Verifica que la URL de OneUptime y la clave de ingesta del comando de instalación son correctas.",
  "4. Make sure the cluster can reach your OneUptime instance over the network.":
    "4. Asegúrate de que el clúster puede llegar a tu instancia de OneUptime por la red.",
  "1. Check the AI agent's pod: `kubectl get pods -n oneuptime-agent -l component=ai-agent`":
    "1. Comprueba el pod del agente de IA: `kubectl get pods -n oneuptime-agent -l component=ai-agent`",
  "2. Check its logs: `kubectl logs -n oneuptime-agent -l component=ai-agent --tail=100`":
    "2. Revisa sus registros: `kubectl logs -n oneuptime-agent -l component=ai-agent --tail=100`",
  "3. No pod? Upgrade the chart (see **Upgrade or uninstall the agent** under Advanced) and add `--set aiAgent.enabled=true`.":
    "3. ¿No hay pod? Actualiza el chart (consulta **Actualizar o desinstalar el agente** en Avanzado) y añade `--set aiAgent.enabled=true`.",
  "1. Check that the cluster name matches: this guide installs **`my-cluster`**.":
    "1. Comprueba que el nombre del clúster coincide: esta guía instala **`my-cluster`**.",
  "2. Verify the agent's RBAC permissions: `kubectl get clusterrolebinding | grep kubernetes-agent`":
    "2. Verifica los permisos RBAC del agente: `kubectl get clusterrolebinding | grep kubernetes-agent`",
  "3. Look for export errors in the collector's logs: `kubectl logs -n oneuptime-agent deployment/kubernetes-agent`":
    "3. Busca errores de exportación en los registros del recopilador: `kubectl logs -n oneuptime-agent deployment/kubernetes-agent`",
  "- **Kernel too old or no BTF.** eBPF needs Linux 5.8+ with BTF — check with `uname -r` on a node. If you can't upgrade, turn eBPF off with `--set ebpf.enabled=false`.":
    "- **Kernel demasiado antiguo o sin BTF.** eBPF necesita Linux 5.8+ con BTF; compruébalo con `uname -r` en un nodo. Si no puedes actualizar, desactiva eBPF con `--set ebpf.enabled=false`.",
  "- **Privileged pods blocked.** Some locked-down clusters reject them. Turn eBPF off.":
    "- **Pods con privilegios bloqueados.** Algunos clústeres restringidos los rechazan. Desactiva eBPF.",
  "- **`debugfs` / `tracefs` not available on the host.** Turn off just the TCP stats family: `--set ebpf.features.tcpStats=false`.":
    "- **`debugfs` / `tracefs` no disponibles en el host.** Desactiva solo la familia de estadísticas TCP: `--set ebpf.features.tcpStats=false`.",
  "1. Check the eBPF pods are healthy: `kubectl get pods -n oneuptime-agent -l component=ebpf-instrument`":
    "1. Comprueba que los pods de eBPF están sanos: `kubectl get pods -n oneuptime-agent -l component=ebpf-instrument`",
  "2. Turn on OBI's debug output to confirm it sees traffic: `--set ebpf.printTraces=true --set ebpf.logLevel=debug`, then read `kubectl logs -n oneuptime-agent -l component=ebpf-instrument --tail=200`.":
    "2. Activa la salida de depuración de OBI para confirmar que ve tráfico: `--set ebpf.printTraces=true --set ebpf.logLevel=debug`, y luego lee `kubectl logs -n oneuptime-agent -l component=ebpf-instrument --tail=200`.",
  "3. If spans show up there but not in OneUptime, check the collector's logs for export errors: `kubectl logs -n oneuptime-agent deployment/kubernetes-agent`":
    "3. Si los spans aparecen ahí pero no en OneUptime, busca errores de exportación en los registros del recopilador: `kubectl logs -n oneuptime-agent deployment/kubernetes-agent`",
};

export default TRANSLATION;
