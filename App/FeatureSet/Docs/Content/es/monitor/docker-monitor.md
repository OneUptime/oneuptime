# Monitor Docker

El monitoreo Docker te permite supervisar el estado y el rendimiento de tus hosts Docker y los contenedores que se ejecutan en ellos. OneUptime recopila métricas y registros de contenedores a través de un Colector OpenTelemetry preconfigurado (el **Agente Docker de OneUptime**) y los evalúa según tus criterios configurados.

## Información general

Los monitores Docker usan métricas y registros de tus hosts para proporcionar visibilidad sobre tus cargas de trabajo en contenedores. Esto te permite:

- Monitorear el estado del host Docker y de cada contenedor
- Rastrear el uso de CPU, memoria, red, E/S de bloques y recuentos de procesos en los contenedores
- Detectar reinicios de contenedores, fallos y limitación de CPU
- Transmitir registros de contenedores estructurados en formato nativo OpenTelemetry
- Alertar sobre alta CPU, alta memoria, bucles de reinicio y más

## Creación de un monitor Docker

1. Ve a **Monitores** en el panel de OneUptime
2. Haz clic en **Crear monitor**
3. Selecciona **Docker** como tipo de monitor
4. Selecciona el host Docker y el alcance de recursos a monitorear
5. Configura las consultas de métricas y la agregación
6. Configura los criterios de monitoreo según sea necesario

## Opciones de configuración

### Host Docker

Selecciona el host Docker a monitorear. Los hosts se registran automáticamente la primera vez que el Agente Docker de OneUptime envía telemetría desde ellos; no es necesario crearlos manualmente.

### Alcance de recursos

Elige el nivel en el que monitorear los recursos:

| Alcance    | Descripción                                                       |
| ---------- | ----------------------------------------------------------------- |
| Host       | Monitorea todo el host Docker, agregado en todos los contenedores |
| Contenedor | Monitorea un contenedor específico por nombre o imagen            |

### Consultas de métricas

Configura una o más consultas de métricas para evaluar. Cada consulta especifica:

- **Nombre de la métrica**: La métrica del contenedor a consultar
- **Agregación**: Cómo agregar los valores de la métrica (Promedio, Suma, Máximo, Mínimo)
- **Filtros**: Filtrado adicional basado en atributos (por ejemplo, por nombre del contenedor, imagen o host)
- **Agrupar por**: Opcionalmente agrupa por `resource.container.name` para que cada contenedor se evalúe de forma independiente

También puedes crear **fórmulas** que combinen múltiples consultas de métricas usando expresiones matemáticas.

### Ventana de tiempo deslizante

Selecciona la ventana de tiempo para la evaluación de métricas:

- Último 1 minuto
- Últimos 5 minutos
- Últimos 10 minutos
- Últimos 15 minutos
- Últimos 30 minutos
- Últimos 60 minutos

## Métricas recopiladas

El Agente Docker usa el receptor `docker_stats` de OpenTelemetry, que sondea la API del motor Docker a un intervalo configurable (predeterminado: cada 30 segundos).

### CPU

| Métrica                                           | Descripción                                         |
| ------------------------------------------------- | --------------------------------------------------- |
| `container.cpu.utilization`                       | Utilización de CPU como porcentaje del CPU del host |
| `container.cpu.usage.total`                       | Tiempo de CPU acumulado consumido por el contenedor |
| `container.cpu.throttling_data.throttled_time`    | Tiempo que el contenedor fue limitado por cgroups   |
| `container.cpu.throttling_data.throttled_periods` | Número de períodos de limitación                    |

### Memoria

| Métrica                        | Descripción                               |
| ------------------------------ | ----------------------------------------- |
| `container.memory.usage.total` | Uso de memoria actual en bytes            |
| `container.memory.usage.limit` | Límite de memoria en bytes                |
| `container.memory.percent`     | Uso de memoria como porcentaje del límite |

### Red

| Métrica                               | Descripción                 |
| ------------------------------------- | --------------------------- |
| `container.network.io.usage.rx_bytes` | Total de bytes recibidos    |
| `container.network.io.usage.tx_bytes` | Total de bytes transmitidos |

### E/S de bloques

| Métrica                                              | Descripción                              |
| ---------------------------------------------------- | ---------------------------------------- |
| `container.blockio.io_service_bytes_recursive.read`  | Bytes leídos de dispositivos de bloque   |
| `container.blockio.io_service_bytes_recursive.write` | Bytes escritos en dispositivos de bloque |

### Información del contenedor

| Métrica                | Descripción                                        |
| ---------------------- | -------------------------------------------------- |
| `container.uptime`     | Tiempo de actividad del contenedor en segundos     |
| `container.restarts`   | Número de veces que el contenedor se ha reiniciado |
| `container.pids.count` | Número de procesos dentro del contenedor           |

## Criterios de monitoreo

### Tipos de verificación disponibles

| Tipo de verificación | Descripción                                              |
| -------------------- | -------------------------------------------------------- |
| Valor de métrica     | El valor de la consulta de métrica o fórmula configurada |

### Tipos de agregación

| Agregación        | Descripción                                         |
| ----------------- | --------------------------------------------------- |
| Promedio          | Valor promedio durante la ventana de tiempo         |
| Suma              | Suma de todos los valores                           |
| Valor máximo      | Valor más alto en la ventana de tiempo              |
| Valor mínimo      | Valor más bajo en la ventana de tiempo              |
| Todos los valores | Todos los valores deben coincidir con los criterios |
| Cualquier valor   | Al menos un valor debe coincidir                    |

### Tipos de filtro

- **Mayor que**, **Menor que**, **Mayor o igual que**, **Menor o igual que**, **Igual a**, **Diferente de**

## Plantillas de alerta predefinidas

OneUptime proporciona plantillas para escenarios comunes de monitoreo Docker:

| Plantilla                        | Descripción                                         | Umbral | Agregación              |
| -------------------------------- | --------------------------------------------------- | ------ | ----------------------- |
| CPU alta del contenedor          | Utilización de CPU por contenedor                   | > 90%  | Máximo (por contenedor) |
| Memoria alta del contenedor      | Uso de memoria como porcentaje del límite           | > 85%  | Máximo (por contenedor) |
| Limitación de CPU alta           | Períodos de CPU limitados                           | > 0    | Máximo (por contenedor) |
| Bucle de reinicio del contenedor | Recuento de reinicios del contenedor                | > 3    | Suma                    |
| Contenedor caído                 | Tiempo de actividad del contenedor restablecido a 0 | = 0    | Mínimo                  |

> Nota: Las plantillas de CPU, memoria y limitación usan la agregación **Máximo** agrupada por `resource.container.name`. Esto evita que la señal de un solo contenedor sobrecargado se diluya al promediar con muchos contenedores inactivos en el mismo host.

## Registros recopilados

Además de las métricas, el Agente Docker rastrea el archivo `*-json.log` de cada contenedor a través del receptor filelog de OpenTelemetry y envía registros en el formato nativo de registros OTLP. Cada registro se enriquece con:

- `resource.host.name`: el identificador del host Docker
- `resource.container.id`: el ID completo del contenedor
- `resource.container.runtime`: siempre `docker`
- `attributes["log.iostream"]`: `stdout` o `stderr`
- `severityText` / `severityNumber`: derivado del flujo: `stderr` → `ERROR`, `stdout` → `INFO`
- `body`: la línea de registro sin procesar emitida por el proceso del contenedor
- `time`: la marca de tiempo del daemon Docker para la línea

Los registros aparecen en la pestaña **Registros** del host Docker y en la página de detalles de cada contenedor.

### Requisito del controlador de registro

**El Agente Docker solo ingesta registros de contenedores que usan el controlador de registro `json-file` de Docker.** Este es el predeterminado de Docker, pero puede anularse por contenedor o globalmente:

- El controlador **`local`** escribe fragmentos protobuf binarios en `/var/lib/docker/containers/<id>/local-logs/container.log`. El receptor filelog no puede analizar este formato.
- Los controladores **`journald`**, **`syslog`**, **`fluentd`**, **`gelf`**, **`awslogs`**, **`splunk`**, etc., envían registros a un destino remoto; no hay ningún archivo que rastrear.
- El controlador **`none`** descarta los registros por completo.

Si alguno de los anteriores está en uso, verás métricas en la página del host Docker, pero la pestaña **Registros** estará vacía (o solo contendrá los propios registros del Agente Docker).

**Comprueba el controlador de registro de un contenedor específico:**

```bash
docker inspect <container> --format '{{.HostConfig.LogConfig.Type}}'
```

**Comprueba el predeterminado del daemon:**

```bash
docker info --format '{{.LoggingDriver}}'
```

**Cambia un servicio Docker Compose a `json-file` con rotación adecuada:**

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

**Cambia el predeterminado del daemon** (se aplica a cada contenedor creado posteriormente) editando `/etc/docker/daemon.json`:

```json
{
  "log-driver": "json-file",
  "log-opts": {
    "max-size": "100m",
    "max-file": "5"
  }
}
```

Luego reinicia el daemon Docker y **recrea** los contenedores afectados. Docker vincula el controlador de registro en el momento de creación del contenedor, por lo que un contenedor existente mantiene su controlador antiguo hasta que se elimina y se vuelve a crear:

```bash
# Docker Compose
docker compose up -d --force-recreate <service>

# Docker simple
docker rm -f <container>
docker run ... <image>
```

## Requisitos de configuración

Para usar el monitoreo Docker, necesitas:

1. Instalar el Agente Docker de OneUptime en cada host Docker que desees monitorear
2. Pasar `ONEUPTIME_URL`, `ONEUPTIME_SERVICE_TOKEN` y `DOCKER_HOST_NAME` como variables de entorno
3. Asegurarte de que los contenedores que deseas observar usen el controlador de registro `json-file` (consulta más arriba)

El agente se publica como `oneuptime/docker-agent:release` en Docker Hub. Consulta la [guía de instalación del Agente Docker](https://github.com/OneUptime/oneuptime/tree/master/DockerAgent) para ver los ejemplos completos de `docker run` y `docker compose`.

## Solución de problemas

### Las métricas aparecen pero la pestaña de Registros está vacía

Es muy probable que tus contenedores no estén usando el controlador de registro `json-file`. Ejecuta los comandos de diagnóstico en la sección [Requisito del controlador de registro](#log-driver-requirement) y cambia los contenedores que necesiten sus registros enviados.

### El receptor filelog registra `no files match the configured criteria`

Esto significa que el glob de inclusión `/var/lib/docker/containers/*/*-json.log` no coincidió con ningún archivo cuando se inició el agente. Puede deberse a que:

1. Ningún contenedor en este host está usando `json-file`, o
2. El montaje vinculado `-v /var/lib/docker/containers:/var/lib/docker/containers:ro` falta o apunta a un directorio vacío, o
3. El agente se está ejecutando en Docker Desktop para macOS sin el directorio de contenedores de la VM Linux expuesto.

### Los registros llegan pero se agrupan bajo el nombre de host incorrecto

OneUptime registra automáticamente los hosts Docker por `resource.host.name`, que se toma de la variable de entorno `DOCKER_HOST_NAME`. Cambiar `DOCKER_HOST_NAME` después del primer lote de telemetría creará una segunda fila de host en lugar de renombrar la existente.

### Los incidentes no se activan para "CPU alta"

Asegúrate de que la agregación de la consulta de métricas sea **Máximo** (no Promedio) y que agrupe por `resource.container.name`. Un Promedio en todos los contenedores de un host ocupado se diluye por los contenedores inactivos y rara vez supera el umbral.
