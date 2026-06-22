# Enviar datos de perfilado continuo a OneUptime

## Información general

El perfilado continuo es el cuarto pilar de la observabilidad junto con los registros, las métricas y las trazas. Los perfiles capturan cómo tu aplicación consume tiempo de CPU, asigna memoria y usa recursos del sistema a nivel de función. OneUptime ingesta los datos de perfilado a través del Protocolo OpenTelemetry (OTLP) y los almacena junto con tus otras señales de telemetría para un análisis unificado.

Con los datos de perfilado en OneUptime, puedes identificar las funciones más costosas en CPU, detectar fugas de memoria, encontrar cuellos de botella de contención y correlacionar los problemas de rendimiento con trazas y spans específicos.

## Tipos de perfil compatibles

OneUptime admite los siguientes tipos de perfil:

| Tipo de perfil | Descripción                                 | Unidad       |
| -------------- | ------------------------------------------- | ------------ |
| cpu            | Tiempo de CPU dedicado a ejecutar código    | nanosegundos |
| wall           | Tiempo de pared (incluye espera/suspensión) | nanosegundos |
| alloc_objects  | Número de asignaciones de heap              | recuento     |
| alloc_space    | Bytes de memoria de heap asignados          | bytes        |
| goroutine      | Número de goroutines activas (Go)           | recuento     |
| contention     | Tiempo esperando en bloqueos/mutexes        | nanosegundos |

## Primeros pasos

### Paso 1: Crear un token de ingesta de telemetría

Después de registrarte en OneUptime y crear un proyecto, haz clic en "Más" en la barra de navegación y haz clic en "Configuración del proyecto".

En la página de Clave de ingesta de telemetría, haz clic en "Crear clave de ingesta" para crear un token.

![Crear servicio](/docs/static/images/TelemetryIngestionKeys.png)

Una vez que hayas creado un token, haz clic en "Ver" para verlo.

![Ver servicio](/docs/static/images/TelemetryIngestionKeyView.png)

### Paso 2: Configurar tu perfilador

OneUptime acepta datos de perfilado a través de gRPC y HTTP usando el protocolo de perfiles OTLP.

| Protocolo | Punto de conexión                                      |
| --------- | ------------------------------------------------------ |
| gRPC      | `your-oneuptime-host:4317` (puerto gRPC estándar OTLP) |
| HTTP      | `https://your-oneuptime-host/otlp/v1/profiles`         |

**Variables de entorno**

Establece las siguientes variables de entorno para apuntar tu perfilador a OneUptime:

```bash
export OTEL_EXPORTER_OTLP_HEADERS=x-oneuptime-token=YOUR_ONEUPTIME_SERVICE_TOKEN
export OTEL_EXPORTER_OTLP_ENDPOINT=https://oneuptime.com/otlp
export OTEL_SERVICE_NAME=my-service
```

**OneUptime auto-alojado**

Si te auto-alojas en OneUptime, reemplaza el punto de conexión con tu propio host (por ejemplo, `http(s)://YOUR-ONEUPTIME-HOST/otlp`). Para gRPC, conecta directamente al puerto 4317 en tu host de OneUptime.

## Guía de instrumentación

### Uso de Grafana Alloy (perfilado basado en eBPF)

Grafana Alloy (anteriormente Grafana Agent) puede recopilar perfiles de CPU de todos los procesos en un host Linux usando eBPF, sin necesidad de cambios en el código. Configúralo para exportar a través de OTLP a OneUptime.

Configuración de ejemplo de Alloy:

```hcl
pyroscope.ebpf "default" {
  forward_to = [pyroscope.write.oneuptime.receiver]
  targets    = discovery.process.all.targets
}

pyroscope.write "oneuptime" {
  endpoint {
    url = "https://oneuptime.com/pyroscope"
    headers = {
      "x-oneuptime-token" = "YOUR_ONEUPTIME_SERVICE_TOKEN",
    }
  }
}
```

### Uso de async-profiler (Java)

Para aplicaciones Java, usa [async-profiler](https://github.com/async-profiler/async-profiler) con el agente Java de OpenTelemetry para enviar datos de perfilado a través de OTLP.

```bash
# Inicia tu aplicación Java con el agente Java de OpenTelemetry
java -javaagent:opentelemetry-javaagent.jar \
  -Dotel.exporter.otlp.endpoint=https://oneuptime.com/otlp \
  -Dotel.exporter.otlp.headers=x-oneuptime-token=YOUR_ONEUPTIME_SERVICE_TOKEN \
  -Dotel.service.name=my-java-service \
  -jar my-app.jar
```

### Uso de Go pprof con exportación OTLP

Para aplicaciones Go, puedes usar el paquete estándar `net/http/pprof` junto con un exportador OTLP. Configura el perfilado continuo recopilando periódicamente datos pprof y enviándolos a OneUptime.

```go
import (
    "runtime/pprof"
    "bytes"
    "time"
)

// Recopila un perfil de CPU de 30 segundos y exporta periódicamente
func collectProfile() {
    var buf bytes.Buffer
    pprof.StartCPUProfile(&buf)
    time.Sleep(30 * time.Second)
    pprof.StopCPUProfile()
    // Convierte la salida pprof al formato OTLP y envía a OneUptime
}
```

Alternativamente, usa el Colector OpenTelemetry con un receptor de perfilado que sondea el punto de conexión `/debug/pprof` de tu aplicación Go y exporta a través de OTLP.

### Uso de py-spy (Python)

Para aplicaciones Python, [py-spy](https://github.com/benfred/py-spy) puede capturar perfiles de CPU sin cambios en el código. Usa el Colector OpenTelemetry para recibir y reenviar datos de perfil.

```bash
# Captura perfiles y envía a un colector OTLP local
py-spy record --format speedscope --pid $PID -o profile.json
```

Para el perfilado continuo, ejecuta py-spy junto a tu aplicación y configura el Colector OpenTelemetry para ingestar y reenviar los perfiles a OneUptime.

## Uso del Colector OpenTelemetry

Puedes usar el Colector OpenTelemetry como proxy para recibir perfiles de tus aplicaciones y reenviarlos a OneUptime.

```yaml
receivers:
  otlp:
    protocols:
      grpc:
        endpoint: 0.0.0.0:4317
      http:
        endpoint: 0.0.0.0:4318

exporters:
  otlphttp:
    endpoint: "https://oneuptime.com/otlp"
    encoding: json
    headers:
      "Content-Type": "application/json"
      "x-oneuptime-token": "YOUR_ONEUPTIME_SERVICE_TOKEN"

service:
  pipelines:
    profiles:
      receivers: [otlp]
      exporters: [otlphttp]
```

## Características

### Visualización de gráficos de llama

OneUptime renderiza los datos de perfil como gráficos de llama interactivos. Cada barra representa una función en la pila de llamadas y su ancho es proporcional al tiempo o los recursos consumidos. Puedes hacer clic en cualquier función para ampliar y ver sus llamadores y llamados.

### Lista de funciones

Ve una tabla ordenable de todas las funciones capturadas en un perfil, clasificadas por tiempo propio, tiempo total o recuento de asignaciones. Esto te ayuda a identificar rápidamente las funciones más costosas en tu aplicación.

### Correlación de trazas

Los perfiles en OneUptime pueden correlacionarse con las trazas distribuidas. Cuando un perfil incluye IDs de traza y span (a través de la tabla de vínculos OTLP), puedes navegar directamente desde un span de traza lento al perfil de CPU o memoria correspondiente para entender exactamente qué código se estaba ejecutando.

### Filtrado por tipo de perfil

Filtra los perfiles por tipo (cpu, wall, alloc_objects, alloc_space, goroutine, contention) para enfocarte en la dimensión de recursos específica que estás investigando.

## Retención de datos

La retención de datos de perfilado se configura por servicio de telemetría en la configuración de tu proyecto de OneUptime. El período de retención predeterminado es de 15 días. Los datos se eliminan automáticamente después de que expira el período de retención.

Para cambiar el período de retención de un servicio, navega a **Telemetría > Servicios > [Tu servicio] > Configuración** y actualiza el valor de retención de datos.

## ¿Necesitas ayuda?

Por favor, comunícate con support@oneuptime.com si necesitas ayuda para configurar el perfilado con OneUptime.
