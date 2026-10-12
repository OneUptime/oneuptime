# Agente de Docker

El agente de Docker de OneUptime es un contenedor que ejecutas en un host de Docker. Lee las estadísticas y los archivos de log de cada contenedor del host y los envía a OneUptime, donde el host aparece con sus contenedores, métricas y logs. Un segundo contenedor, el agente de IA de Docker, permite a OneUptime AI investigar el host. Los [monitores de Docker](/docs/monitor/docker-monitor) alertan según lo que envía el agente.

:::cards
- [Instala el agente](#instala-el-agente): Dos contenedores, con `docker run` o Docker Compose.
- [Qué recopila el agente](#qué-recopila-el-agente): Métricas, logs y un inventario de cada contenedor.
- [Los logs de contenedores necesitan json-file](#los-logs-de-contenedores-necesitan-el-controlador-json-file): Comprueba y cambia el controlador de logs de un contenedor.
- [Solución de problemas](#solución-de-problemas): Bucles de reinicio, métricas que faltan, logs que faltan.
:::

## Cómo funciona

El agente es un OpenTelemetry Collector con la configuración de OneUptime integrada. A través del socket de Docker lee las estadísticas de cada contenedor cada 30 segundos y enumera cada contenedor, imagen, red y volumen cada 5 minutos. Sigue los archivos de log de los contenedores y lo envía todo a tu URL de OneUptime por OTLP, con la clave de ingesta que le das.

```mermaid title="Dos contenedores en tu host de Docker"
flowchart TB
    containers["Tus contenedores"] -->|"estadísticas, archivos de log,<br/>inventario"| agent["Agente de Docker"]
    agent -->|"OTLP por HTTPS"| oneuptime["OneUptime"]
    oneuptime -->|"investiga un incidente<br/>o una alerta"| ai["Agente de IA de Docker"]
    ai -->|"comandos docker<br/>de solo lectura"| containers
```

El host se registra con sus primeros datos, con el nombre que le das en `DOCKER_HOST_NAME`. El agente de IA es opcional: si lo omites, el colector funciona igual.

## Antes de empezar

- Docker Engine 20.10 o posterior, y acceso root en el host: el agente lee `/var/run/docker.sock`.
- Docker Compose v2 (el comando `docker compose`), si instalas con Docker Compose.
- Una clave de ingesta. Crea una en **Ajustes del proyecto → Telemetría y APM → Claves de ingesta** y copia su valor.
- HTTPS saliente desde el host hacia tu URL de OneUptime.
- Para los logs de contenedores, contenedores que usen el controlador de logs `json-file` de Docker, que es el predeterminado de Docker. Consulta [Los logs de contenedores necesitan el controlador json-file](#los-logs-de-contenedores-necesitan-el-controlador-json-file).

## Instala el agente

:::steps
### Inicia el agente

Reemplaza `YOUR_ONEUPTIME_URL` por tu URL de OneUptime, `YOUR_TELEMETRY_INGESTION_TOKEN` por la clave de ingesta y `my-docker-host` por un nombre para este host, como `prod-docker-01`. El nombre es como aparece el host en OneUptime, así que mantenlo estable: un nombre nuevo registra un host nuevo.

:::tabs
@tab Docker CLI
```bash
docker run -d \
  --name oneuptime-docker-agent \
  --user 0:0 \
  --restart unless-stopped \
  -v /var/run/docker.sock:/var/run/docker.sock:ro \
  -v /var/lib/docker/containers:/var/lib/docker/containers:ro \
  -e ONEUPTIME_URL="YOUR_ONEUPTIME_URL" \
  -e ONEUPTIME_SERVICE_TOKEN="YOUR_TELEMETRY_INGESTION_TOKEN" \
  -e DOCKER_HOST_NAME="my-docker-host" \
  oneuptime/docker-agent:release
```

Luego inicia el [agente de IA](#agente-de-ia) a su lado, con los mismos valores. **Las investigaciones con IA están activadas por defecto**: mientras OneUptime AI investiga un incidente o una alerta en este host, ejecuta comandos `docker` de solo lectura a través del agente de IA, y no cambia nada salvo que permitas correcciones. Para instalar sin investigaciones con IA, omite este comando.

```bash
docker run -d \
  --name oneuptime-docker-ai-agent \
  --user 0:0 \
  --restart unless-stopped \
  --read-only --tmpfs /tmp \
  -v /var/run/docker.sock:/var/run/docker.sock:ro \
  -e ONEUPTIME_URL="YOUR_ONEUPTIME_URL" \
  -e ONEUPTIME_SERVICE_TOKEN="YOUR_TELEMETRY_INGESTION_TOKEN" \
  -e ONEUPTIME_AI_AGENT_RESOURCE_TYPE=docker \
  -e DOCKER_HOST_NAME="my-docker-host" \
  oneuptime/resource-ai-agent:release
```
@tab Docker Compose
Guarda esto como `docker-compose.yml` en una carpeta del host. El segundo servicio es el [agente de IA](#agente-de-ia): omítelo para ejecutar el colector sin investigaciones con IA.

```yaml title="docker-compose.yml"
services:
  oneuptime-docker-agent:
    image: oneuptime/docker-agent:release
    container_name: oneuptime-docker-agent
    user: "0:0"
    restart: unless-stopped
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock:ro
      - /var/lib/docker/containers:/var/lib/docker/containers:ro
    environment:
      - ONEUPTIME_URL=YOUR_ONEUPTIME_URL
      - ONEUPTIME_SERVICE_TOKEN=YOUR_TELEMETRY_INGESTION_TOKEN
      - DOCKER_HOST_NAME=my-docker-host
    logging:
      driver: json-file
      options:
        max-size: "10m"
        max-file: "3"
  oneuptime-docker-ai-agent:
    image: oneuptime/resource-ai-agent:release
    container_name: oneuptime-docker-ai-agent
    user: "0:0"
    restart: unless-stopped
    read_only: true
    tmpfs:
      - /tmp
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock:ro
    environment:
      - ONEUPTIME_URL=YOUR_ONEUPTIME_URL
      - ONEUPTIME_SERVICE_TOKEN=YOUR_TELEMETRY_INGESTION_TOKEN
      - ONEUPTIME_AI_AGENT_RESOURCE_TYPE=docker
      - DOCKER_HOST_NAME=my-docker-host
```

Inícialo en esa carpeta:

```bash
docker compose up -d
```
:::

### Comprueba que el agente se está ejecutando

```bash
docker ps --filter name=oneuptime-docker-agent
docker logs -f oneuptime-docker-agent
```

Los logs deberían mostrar esta línea cuando el colector haya arrancado:

```text
Everything is ready. Begin running and processing data.
```

### Busca el host en OneUptime

Abre **Productos → Infraestructura → Docker → Todos los hosts**. El host aparece con su `DOCKER_HOST_NAME` en más o menos un minuto, con sus contenedores, métricas y logs. El agente de IA aparece como conectado en la página **Agente de IA** del host y al final de su **Vista general**.
:::

## Variables de entorno

| Variable | Obligatoria | Descripción |
| --- | --- | --- |
| `ONEUPTIME_URL` | Sí | Tu URL de OneUptime, como `https://oneuptime.com` o tu instancia autoalojada. Usa `http://` y su puerto si la instancia solo admite HTTP. |
| `ONEUPTIME_SERVICE_TOKEN` | Sí | La clave de ingesta de **Ajustes del proyecto → Telemetría y APM → Claves de ingesta**. |
| `DOCKER_HOST_NAME` | No | El nombre del host en OneUptime. Su valor predeterminado es `docker-host`, así que da a cada host el suyo. |
| `DOCKER_API_VERSION` | No | La versión de la API de Docker Engine que habla el agente. Su valor predeterminado es `1.44`. Bájala con un daemon más antiguo, o establécela en un valor vacío para negociarla con el daemon (consulta [Solución de problemas](#solución-de-problemas)). |

Para cambiar un valor, quita el agente y vuelve a ejecutar su comando (Docker CLI), o edita `docker-compose.yml` y ejecuta `docker compose up -d` (Docker Compose).

## Qué recopila el agente

| Datos | Qué es |
| --- | --- |
| Métricas de contenedores | CPU (uso, porcentaje, limitación), memoria (uso, límite, porcentaje), E/S de red y de bloques, tiempo de actividad, reinicios y número de procesos, por contenedor, cada 30 segundos. |
| Logs de contenedores | stdout y stderr de cada contenedor, de su archivo de log `json-file`. |
| Inventario | Cada contenedor en cualquier estado, y cada imagen, red y volumen, cada 5 minutos. |

Las métricas y los logs de cada contenedor se archivan en un servicio con el nombre del contenedor. Cada línea de log recibe una severidad a partir del nivel que menciona, como `[ERROR]`, `level=warn` o `{"level":"info"}`; una línea que no menciona ninguno toma la de su flujo: stderr es `ERROR`, stdout es `INFO`. Las líneas que empiezan con un espacio en blanco o un corchete de cierre se unen a la línea anterior, así que un stack trace llega como un solo registro. Los logs del propio agente se omiten.

[Monitor de Docker](/docs/monitor/docker-monitor#métricas-recopiladas) enumera cada métrica y lo que significa.

## Los logs de contenedores necesitan el controlador json-file

El agente sigue `/var/lib/docker/containers/*/*-json.log`, los archivos que escribe el controlador de logs `json-file` de Docker. Un contenedor que usa otro controlador no deja ningún archivo que leer: `local` escribe archivos binarios, y `journald`, `syslog`, `fluentd` y `gelf` envían los logs a otro sitio. Sus métricas siguen llegando; sus logs no.

Comprueba el controlador de logs de un contenedor y el predeterminado del daemon:

```bash
docker inspect <container> --format '{{.HostConfig.LogConfig.Type}}'
docker info --format '{{.LoggingDriver}}'
```

Cambia un servicio de Compose a `json-file`, con rotación:

```yaml
services:
  my-app:
    image: my-app:latest
    logging:
      driver: "json-file"
      options:
        max-size: "100m"
        max-file: "5"
```

O conviértelo en el predeterminado para cada contenedor creado a partir de entonces, en `/etc/docker/daemon.json`:

```json title="/etc/docker/daemon.json"
{
  "log-driver": "json-file",
  "log-opts": {
    "max-size": "100m",
    "max-file": "5"
  }
}
```

Luego reinicia Docker y vuelve a crear los contenedores. Un contenedor conserva el controlador de logs con el que se creó, así que reiniciarlo no basta.

## Actualizar el agente

Cuando el agente es más antiguo que tu OneUptime, aparece una señal de advertencia junto a **Versión del agente** en la **Vista general** del host. Selecciónala para ver estos comandos.

:::tabs
@tab Docker CLI
```bash
docker pull oneuptime/docker-agent:release
docker pull oneuptime/resource-ai-agent:release
docker rm -f oneuptime-docker-agent oneuptime-docker-ai-agent
```

Luego vuelve a ejecutar los dos comandos `docker run` de [Inicia el agente](#inicia-el-agente).
@tab Docker Compose
```bash
docker compose pull
docker compose up -d
```
:::

La etiqueta `release` siempre apunta a la versión más reciente. Para fijar una versión, usa `oneuptime/docker-agent:<version>`, como `oneuptime/docker-agent:10.0.31`. La misma imagen está en GitHub Container Registry como `ghcr.io/oneuptime/docker-agent:release`.

## Desinstalar el agente

:::tabs
@tab Docker CLI
```bash
docker rm -f oneuptime-docker-agent
docker rm -f oneuptime-docker-ai-agent
```
@tab Docker Compose
```bash
docker compose down
```
:::

El host se queda en OneUptime con los datos que envió. Si ya no lo necesitas, elimínalo con **Eliminar host** en su menú.

## Agente de IA

Los comandos y el archivo de Compose de arriba, el `install.sh` del agente de Docker y el `docker-compose.yml` de su [directorio DockerAgent](https://github.com/OneUptime/oneuptime/tree/master/agents/DockerAgent) ejecutan todos el **Agente de IA de Docker**: un segundo contenedor, `oneuptime-docker-ai-agent` (imagen `oneuptime/resource-ai-agent:release`), que ejecuta los comandos `docker` de solo lectura que pide OneUptime AI mientras investiga un incidente o una alerta en este host — `docker ps -a`, `docker logs --tail 200 web`, `docker container inspect web`, `docker stats --no-stream` — y, solo si lo permites, aplica correcciones como reiniciar un contenedor concreto. Lee los mismos `ONEUPTIME_URL`, `ONEUPTIME_SERVICE_TOKEN` y `DOCKER_HOST_NAME` que el colector, así que atiende exactamente a este host, y aparece en la página **Agente de IA** del host en OneUptime.

- **Las investigaciones con IA están activadas por defecto.** En cuanto el agente se conecta, OneUptime AI investiga con él los incidentes y alertas de este host, y la **Vista general** del host muestra el estado del agente. Para detenerlo, establece `ONEUPTIME_AI_INVESTIGATION=false` donde se ejecuta el agente (**Cambiar** en **Lo que puede hacer la IA**, en la página del agente de IA, muestra cómo), u omite el agente.
- Es de solo lectura salvo que lo inicies con `ONEUPTIME_AI_ALLOW_WRITES=true`; `ONEUPTIME_AI_WRITE_TARGETS` (por ejemplo `web-*,api-*`) limita qué contenedores puede tocar una corrección. Inícialo también con `ONEUPTIME_AI_FIXES` para indicar cómo se ejecutan las correcciones — `ask-for-approval` (una persona aprueba cada una), `automatic` o `bypass-approval` — y la página del agente de IA lo muestra en solo lectura ([Lo que puede hacer la IA, según el agente](/docs/ai/infrastructure-ai-agents#what-ai-may-do-set-by-the-agent)).
- Se ejecuta como root con el socket de Docker montado, porque el socket pertenece a root — y quien puede usar el socket es root en este host, con `:ro` o sin él. El límite es la política de comandos del agente: nunca ejecuta `exec`, `run`, `rm` ni `prune`, y nunca se cambia a sí mismo, al colector ni nada de `ONEUPTIME_AI_PROTECTED_TARGETS` (globs de nombres de contenedores). Los valores de entorno de la salida de `docker inspect` se enmascaran antes de que nada salga del host.
- `install.sh --no-ai-agent` lo omite; `docker rm -f oneuptime-docker-ai-agent` lo quita. Actualízalo como el colector: `docker pull oneuptime/resource-ai-agent:release`, quítalo y vuelve a iniciarlo.

Qué puede ejecutar, cómo funcionan las correcciones y cómo solucionar sus problemas: [Infrastructure AI Agents](/docs/ai/infrastructure-ai-agents#docker-and-podman-hosts).

## Solución de problemas

:::details El agente se reinicia con "client version is too new"
Los logs del agente muestran:

```text
Error: cannot start pipelines: failed to start "docker_stats" receiver:
Error response from daemon: client version 1.44 is too new.
Maximum supported API version is 1.41
```

Un daemon rechaza un cliente más nuevo que su propio máximo, así que el receiver nunca arranca y el colector termina con él. Averigua el máximo del daemon:

```bash
docker version --format '{{ .Server.APIVersion }}'
```

Luego añade `-e DOCKER_API_VERSION=1.41` (o el valor que obtuviste) a `docker run`, o establece `DOCKER_API_VERSION` en Compose. Los daemons más nuevos siguen atendiendo versiones antiguas de la API, así que el ajuste sigue siendo válido después de una actualización.

¿Prefieres no buscar el número? Establece `DOCKER_API_VERSION` en la cadena vacía. El agente negocia entonces la versión con el daemon (un `HEAD /_ping` y luego el máximo del propio daemon), lo que funciona tanto con daemons antiguos como nuevos:

```bash
docker run -d ... -e DOCKER_API_VERSION= ...
```
:::

:::details Permiso denegado en el socket de Docker
El agente debe ejecutarse como root para leer `/var/run/docker.sock`. Comprueba que `--user 0:0` está en tu comando `docker run`, o `user: "0:0"` en Compose.
:::

:::details El host aparece como desconectado
1. Comprueba que el agente se está ejecutando: `docker ps --filter name=oneuptime-docker-agent`
2. Busca errores en sus logs: `docker logs oneuptime-docker-agent 2>&1 | grep -i error`
3. Comprueba `ONEUPTIME_URL` y `ONEUPTIME_SERVICE_TOKEN`: la clave debe ser una clave de ingesta válida que no se haya desactivado.
4. Comprueba que el host puede llegar a tu URL de OneUptime por la red.
:::

:::details No aparecen métricas
1. Comprueba que el socket de Docker está montado en el agente. Su imagen no tiene shell, así que míralo desde un contenedor desechable que comparta sus montajes: `docker run --rm --volumes-from oneuptime-docker-agent alpine:3.19 ls -la /var/run/docker.sock`
2. Busca errores de exportación en sus logs: `docker logs oneuptime-docker-agent 2>&1 | tail -100`
3. Comprueba que la clave de ingesta es válida y no ha caducado.
:::

:::details Llegan métricas, pero no logs de contenedores
Lo más probable es que tus contenedores usen otro controlador de logs distinto de `json-file`. Comprueba qué archivos vigila el agente y qué controlador usa un contenedor:

```bash
docker logs oneuptime-docker-agent 2>&1 | grep -E "Started watching file|no files match"
docker inspect <container> --format '{{.HostConfig.LogConfig.Type}}'
```

Si el agente informa de `no files match the configured criteria`, cambia los contenedores a `json-file` y vuelve a crearlos, como muestra [Los logs de contenedores necesitan el controlador json-file](#los-logs-de-contenedores-necesitan-el-controlador-json-file).
:::

:::details Los logs están en otro host, o el host se llama docker-host
El nombre del host sale de `DOCKER_HOST_NAME`. Un agente iniciado sin él informa `docker-host`, así que todos los hosts configurados así parecen el mismo; si cambias el nombre más tarde, OneUptime registra un segundo host, que pasa a tener los datos nuevos. Establece `DOCKER_HOST_NAME` con un nombre propio en cada host y vuelve a crear el agente. Para comprobar el nombre que informa el agente:

```bash
docker inspect oneuptime-docker-agent --format '{{range .Config.Env}}{{println .}}{{end}}' | grep DOCKER_HOST_NAME
```
:::

## Próximos pasos

:::cards
- [Monitor de Docker](/docs/monitor/docker-monitor): Alerta sobre la CPU, la memoria y los reinicios de los contenedores.
- [Bases de datos](/docs/telemetry/databases): Los contenedores de bases de datos del host se detectan y reciben sus propias páginas.
- [Agente de Kubernetes](/docs/telemetry/kubernetes-agent): Supervisa un clúster de Kubernetes en su lugar.
- [Colector OpenTelemetry en el host](/docs/telemetry/host-otel-collector): Supervisa la propia máquina: CPU, discos, procesos y logs.
:::
