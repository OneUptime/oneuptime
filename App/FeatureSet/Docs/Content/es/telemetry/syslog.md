# Enviar datos Syslog a OneUptime

## Información general

El servicio de Ingesta OpenTelemetry ahora acepta cargas útiles nativas de Syslog. Puedes reenviar mensajes desde cualquier fuente compatible con RFC3164 o RFC5424 directamente a OneUptime a través de HTTPS. OneUptime analiza la prioridad syslog, la instalación, la gravedad, los datos estructurados y el cuerpo del mensaje antes de almacenar todo como registros buscables.

## Prerrequisitos

- **Token de ingesta de telemetría**: crea uno desde *Configuración del proyecto → Claves de ingesta de telemetría* y copia el valor de `x-oneuptime-token`.
- **Reenviador Syslog**: cualquier herramienta capaz de enviar solicitudes HTTP POST (por ejemplo, `curl`, `rsyslog` a través de `omhttp`, o `syslog-ng` con el complemento de destino HTTP).
- **Nombre del servicio (opcional)**: establece el encabezado `x-oneuptime-service-name` para agrupar los registros entrantes en un servicio de telemetría específico. Cuando se omite, OneUptime recurre al `APP-NAME` de syslog, al nombre de host o a `Syslog`.

## Punto de conexión

```
POST https://oneuptime.com/syslog/v1/logs
```

- Reemplaza `oneuptime.com` con tu host si te auto-alojas en OneUptime.
- Incluye siempre el encabezado `x-oneuptime-token` en la solicitud.

## Cuerpo de la solicitud

Envía cadenas Syslog delimitadas por saltos de línea o una carga útil JSON con un arreglo de `messages`. Se admiten los formatos RFC3164 (BSD) y RFC5424.

```json
{
  "messages": [
    "<34>1 2025-03-02T14:48:05.003Z web-01 nginx 7421 ID47 [env@32473 host=\"web-01\"] 502 on /api/login",
    "<13>Feb  5 17:32:18 db-01 postgres[2419]: connection received from 10.0.0.12"
  ]
}
```

### Tipos de contenido admitidos

- `application/json`: recomendado.
- `text/plain`: mensajes separados por saltos de línea.
- `application/octet-stream`: cargas útiles sin procesar. También se acepta la compresión Gzip (`Content-Encoding: gzip`).

## Prueba rápida con curl

```bash
curl \
  -X POST https://oneuptime.com/syslog/v1/logs \
  -H "Content-Type: application/json" \
  -H "x-oneuptime-token: YOUR_TELEMETRY_KEY" \
  -H "x-oneuptime-service-name: production-web" \
  -d '{
    "messages": [
      "<34>1 2025-03-02T14:48:05.003Z web-01 nginx 7421 ID47 [env@32473 host=\"web-01\"] 502 on /api/login"
    ]
  }'
```

## Reenvío desde rsyslog

1. Instala el módulo de salida HTTP:
   ```bash
   sudo apt-get install rsyslog-omhttp
   ```
2. Agrega el destino a `/etc/rsyslog.d/oneuptime.conf`:
   ```
   module(load="omhttp")

   template(name="OneUptimeJson" type="list") {
     constant(value="{\"messages\":[\"")
     property(name="rawmsg")
     constant(value="\"]}")
   }

   action(
     type="omhttp"
     server="oneuptime.com"
     serverport="443"
     usehttps="on"
     endpoint="/syslog/v1/logs"
     header="Content-Type: application/json"
     header="x-oneuptime-token: YOUR_TELEMETRY_KEY"
     header="x-oneuptime-service-name: rsyslog-demo"
     template="OneUptimeJson"
   )
   ```
3. Reinicia rsyslog:
   ```bash
   sudo systemctl restart rsyslog
   ```

## Casos de uso comunes que ya estamos viendo

### 1. Dispositivos de red y seguridad

La mayoría de los equipos de red aún exponen cambios de configuración, accesos a listas de control de acceso y detecciones de amenazas exclusivamente a través de syslog. Apunta tu relevo existente (Palo Alto, Fortinet, Cisco ASA, Juniper, pfSense y más) directamente a OneUptime, o mantén un relevo interno y reenvía a través de HTTPS:

```bash
# Fragmento de rsyslog que agrupa mensajes en JSON y los publica en OneUptime
module(load="omhttp")

template(name="OneUptimeJSON" type="list") {
  constant(value="{\"messages\":[\"")
  property(name="rawmsg")
  constant(value="\"]}")
}

action(
  type="omhttp"
  server="oneuptime.com"
  serverport="443"
  usehttps="on"
  endpoint="/syslog/v1/logs"
  header="Content-Type: application/json"
  header="x-oneuptime-token: <TOKEN>"
  header="x-oneuptime-service-name: perimeter-firewall"
  template="OneUptimeJSON"
)
```

### 2. Servidores Linux y trabajos cron

Muchos trabajos cron y demonios heredados aún registran exclusivamente a través del servicio del kernel/syslog. Reenviar `/var/log/syslog` o entradas de journald mantiene las huellas operativas en un solo lugar. Los hosts con systemd pueden depender del puente journald → syslog:

```bash
# /etc/rsyslog.d/oneuptime.conf
module(load="imjournal" StateFile="imjournal.state")
module(load="omhttp")

action(
  type="omhttp"
  server="oneuptime.com"
  serverport="443"
  usehttps="on"
  endpoint="/syslog/v1/logs"
  header="Content-Type: application/json"
  header="x-oneuptime-token: <TOKEN>"
  header="x-oneuptime-service-name: linux-fleet"
  template="OneUptimeJSON"
)
```

Dado que mapeamos los códigos de gravedad, puedes alertar sobre `syslog.severity.name = "error"` o segmentar por `syslog.hostname` para aislar rápidamente las máquinas ruidosas.

### 3. Controladores de ingreso de Kubernetes y nodos de borde

Si ya ejecutas Fluent Bit o Fluentd, mantenlos para los registros de contenedores y agrega un sink syslog ligero para los hosts o dispositivos en el borde. La entrada `syslog` de Fluent Bit se combina con la salida HTTP:

```ini
[INPUT]
    Name              syslog
    Mode              tcp
    Listen            0.0.0.0
    Port              5140

[OUTPUT]
    Name              http
    Match             *
    Host              oneuptime.com
    Port              443
    URI               /syslog/v1/logs
    Format            json
    json_date_key     time
    Header            Content-Type application/json
    Header            x-oneuptime-token <TOKEN>
    Header            x-oneuptime-service-name edge-ingress
    tls               On
```

Esta configuración te permite ingestar syslog desde trabajadores de metal desnudo o balanceadores de carga de hardware sin crear otra pila de registro.

### 4. Archivos de cumplimiento sin la espera

¿Necesitas retener registros de firewall para PCI o SOX? Envíalos directamente a OneUptime, aplica una política de retención larga al servicio de telemetría y exporta al almacenamiento en frío desde un solo lugar. No más exportaciones desde múltiples relevos syslog.

## Atributos analizados

OneUptime agrega automáticamente los siguientes atributos a cada entrada de registro:

- `syslog.priority`, `syslog.facility.code`, `syslog.facility.name`
- `syslog.severity.code`, `syslog.severity.name`
- `syslog.hostname`, `syslog.appName`, `syslog.processId`, `syslog.messageId`
- `syslog.structured.*` (datos estructurados RFC5424 aplanados)
- `syslog.raw` (mensaje original para trazabilidad)

Estos atributos se vuelven buscables dentro del explorador Telemetría → Registros.

## Solución de problemas

- **HTTP 401 o resultados vacíos**: verifica que el encabezado `x-oneuptime-token` pertenezca al proyecto que recibe los registros.
- **No aparecen registros**: confirma que el cuerpo de la solicitud realmente contiene líneas syslog. Los cuerpos vacíos se rechazan con HTTP 400.
- **Nombre de servicio inesperado**: establece `x-oneuptime-service-name` para anular la lógica de detección predeterminada.
- **Ráfagas grandes**: se admite el agrupamiento de hasta 1,000 líneas por solicitud. Las ráfagas más grandes se ponen en cola y se procesan de forma asíncrona.
