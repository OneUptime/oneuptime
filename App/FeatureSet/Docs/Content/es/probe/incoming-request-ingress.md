# Ingreso de solicitudes entrantes

Una sonda personalizada puede opcionalmente ejecutar un **receptor HTTP de entrada** que acepta llamadas de `heartbeat` y `incoming-request` desde el interior de tu red privada y las reenvía a OneUptime. Esto permite que los servicios que **no tienen acceso saliente a internet** puedan reportar a un [Monitor de solicitudes entrantes](/docs/monitor/incoming-request-monitor) enviando la solicitud a una sonda en la red local en lugar de hacerlo directamente a `oneuptime.com`.

## Información general

Cuando se establece `PROBE_INGRESS_PORT`, la sonda vincula un receptor HTTP adicional en ese puerto. El receptor acepta las mismas rutas de URL de `secretkey` que los puntos de conexión públicos de OneUptime:

- `POST /heartbeat/:secretkey`
- `GET /heartbeat/:secretkey`
- `POST /incoming-request/:secretkey`
- `GET /incoming-request/:secretkey`

La sonda luego redirige la solicitud a tu instancia de OneUptime, preservando el método, el cuerpo y los encabezados de la solicitud (excepto los encabezados de salto a salto como `Host`, `Connection`, `Content-Length`, etc.). La sonda adjunta automáticamente un encabezado `OneUptime-Probe-Id` para que la solicitud se atribuya a la sonda de reenvío.

El receptor se ejecuta en un **puerto dedicado**, separado de los puntos de conexión internos de estado/métricas de la sonda, por lo que puedes exponerlo a tu red privada sin exponer nada más.

## Cuándo usar esto

Usa el receptor de ingreso cuando:

- Tus servicios se ejecutan en un segmento de red aislado sin acceso HTTPS saliente
- Necesitas mantener todo el tráfico de monitoreo dentro de tu VPC/red on-premise
- Quieres un único punto de salida (la sonda) que tenga permitido llegar a OneUptime
- Ya implementaste una [Sonda personalizada](/docs/probe/custom-probe) y quieres reutilizarla para latidos entrantes

Si tus servicios ya pueden llegar a `https://oneuptime.com` (o tu URL auto-alojada) directamente, **no** necesitas esta función; llama directamente a la URL de latido desde el servicio.

## Habilitar el receptor de ingreso

Establece `PROBE_INGRESS_PORT` en el puerto en el que deseas que el receptor se vincule. Cualquier valor mayor que `0` habilita el receptor; dejarlo sin establecer (o en `0`) lo deshabilita.

### Docker

```bash
docker run --name oneuptime-probe --network host \
  -e PROBE_KEY=<probe-key> \
  -e PROBE_ID=<probe-id> \
  -e ONEUPTIME_URL=https://oneuptime.com \
  -e PROBE_INGRESS_PORT=3875 \
  -d oneuptime/probe:release
```

Si no estás usando `--network host`, publica el puerto de ingreso explícitamente:

```bash
docker run --name oneuptime-probe \
  -e PROBE_KEY=<probe-key> \
  -e PROBE_ID=<probe-id> \
  -e ONEUPTIME_URL=https://oneuptime.com \
  -e PROBE_INGRESS_PORT=3875 \
  -p 3875:3875 \
  -d oneuptime/probe:release
```

### Docker Compose

```yaml
version: "3"

services:
  oneuptime-probe:
    image: oneuptime/probe:release
    container_name: oneuptime-probe
    environment:
      - PROBE_KEY=<probe-key>
      - PROBE_ID=<probe-id>
      - ONEUPTIME_URL=https://oneuptime.com
      - PROBE_INGRESS_PORT=3875
    ports:
      - "3875:3875"
    restart: always
```

### Kubernetes

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: oneuptime-probe
spec:
  selector:
    matchLabels:
      app: oneuptime-probe
  template:
    metadata:
      labels:
        app: oneuptime-probe
    spec:
      containers:
        - name: oneuptime-probe
          image: oneuptime/probe:release
          env:
            - name: PROBE_KEY
              value: "<probe-key>"
            - name: PROBE_ID
              value: "<probe-id>"
            - name: ONEUPTIME_URL
              value: "https://oneuptime.com"
            - name: PROBE_INGRESS_PORT
              value: "3875"
          ports:
            - name: ingress
              containerPort: 3875
---
apiVersion: v1
kind: Service
metadata:
  name: oneuptime-probe-ingress
spec:
  selector:
    app: oneuptime-probe
  ports:
    - name: ingress
      port: 3875
      targetPort: 3875
  type: ClusterIP
```

Los servicios internos pueden entonces enviar latidos a `http://oneuptime-probe-ingress.<namespace>.svc.cluster.local:3875/heartbeat/<secret-key>`.

## Envío de solicitudes a la sonda

Reemplaza la URL de latido pública:

```
https://oneuptime.com/heartbeat/<secret-key>
```

con la URL de ingreso de la sonda:

```
http://<probe-host>:<PROBE_INGRESS_PORT>/heartbeat/<secret-key>
```

La ruta, el método, el cuerpo y los encabezados son por lo demás idénticos, por lo que cualquier código de cliente existente solo necesita cambiar la URL base.

### Ejemplos

```bash
# Latido GET
curl http://probe.internal:3875/heartbeat/YOUR_SECRET_KEY

# Latido POST con cuerpo JSON
curl -X POST http://probe.internal:3875/heartbeat/YOUR_SECRET_KEY \
  -H "Content-Type: application/json" \
  -d '{"status": "healthy", "version": "1.2.3"}'

# Trabajo cron
*/5 * * * * curl -s http://probe.internal:3875/heartbeat/YOUR_SECRET_KEY > /dev/null
```

## Comportamiento de reenvío

- **Respuesta síncrona, reenvío asíncrono.** La sonda reconoce la solicitud entrante inmediatamente con un `200` y reenvía a OneUptime en segundo plano. Tu servicio no tiene que esperar a que se complete el reenvío.
- **Los encabezados se preservan.** Todos los encabezados excepto los de salto a salto (`Host`, `Connection`, `Content-Length`, `Transfer-Encoding`, `Keep-Alive`, `Proxy-Authenticate`, `Proxy-Authorization`, `TE`, `Trailer`, `Upgrade`) se transmiten. La sonda agrega un encabezado `OneUptime-Probe-Id` que la identifica.
- **El cuerpo se preserva.** Se aceptan cargas útiles JSON, con codificación URL y `application/octet-stream` sin procesar de hasta **50 MB**.
- **Reintentos con retroceso.** Si el reenvío falla, la sonda reintenta hasta `PROBE_INGRESS_FORWARD_RETRY_LIMIT` veces con retroceso exponencial (2s, 4s, 8s, con un máximo de 15s).
- **Compatible con proxy.** Si la sonda misma está configurada con `HTTP_PROXY_URL` / `HTTPS_PROXY_URL`, las solicitudes reenviadas irán a través del proxy.

## Variables de entorno

| Variable | Predeterminado | Descripción |
|---|---|---|
| `PROBE_INGRESS_PORT` | _sin establecer_ (deshabilitado) | Puerto al que se vincula el receptor de entrada. Cualquier valor `> 0` habilita el ingreso. |
| `PROBE_INGRESS_FORWARD_TIMEOUT_MS` | `10000` | Tiempo de espera (ms) para cada intento de reenvío a OneUptime. Mínimo `1000`. |
| `PROBE_INGRESS_FORWARD_RETRY_LIMIT` | `3` | Número de reintentos antes de que la sonda abandone un reenvío. Establece en `0` para deshabilitar los reintentos. |

Las variables estándar de la sonda (`PROBE_KEY`, `PROBE_ID`, `ONEUPTIME_URL`, variables de proxy) se aplican todas; consulta [Sondas personalizadas](/docs/probe/custom-probe) para ver la lista completa.

## Consideraciones de seguridad

- **El punto de conexión no tiene autenticación por diseño**: la clave secreta en la ruta de la URL *es* la autenticación, igual que en el punto de conexión público de `oneuptime.com`. Trata la clave secreta como una credencial.
- **Vincula solo a una interfaz privada.** El receptor de ingreso no debe ser accesible desde internet público. Usa una política de red, una regla de firewall o un servicio `ClusterIP` para restringir el acceso.
- **Usa la terminación HTTPS si necesitas cifrado en tránsito.** El receptor de la sonda usa HTTP simple. Ponlo detrás de un balanceador de carga interno/controlador de ingreso si necesitas TLS en el salto de entrada. El tramo de reenvío de la sonda → OneUptime siempre usa HTTPS (asumiendo que `ONEUPTIME_URL` es `https://`).
- **Límites de recursos.** El receptor acepta cuerpos de solicitud de hasta 50 MB. Si necesitas un límite más estricto, coloca un proxy inverso al frente.

## Solución de problemas

- **La sonda registra `Probe ingress listener started on port <port>` al iniciar**: confirma que el receptor está activo. Si no ves esta línea, `PROBE_INGRESS_PORT` no está establecido, es `0` o no es válido.
- **`Probe ingress: failed to forward to <url> after N attempts`**: la sonda no pudo llegar a OneUptime. Comprueba la conectividad saliente de la sonda, los ajustes del proxy y el valor de `ONEUPTIME_URL`.
- **`Probe ingress: probe ID not available, forwarding without it`**: la sonda aún no se ha registrado. El reenvío sigue teniendo éxito; el latido simplemente no se atribuirá a una sonda.
- **El latido aparece en OneUptime pero no a través de la sonda**: confirma que tu servicio está llegando a `http://<probe-host>:<port>/...` y no a la URL pública. Una entrada de DNS o `/etc/hosts` mal configurada es la causa habitual.

## Relacionado

- [Sondas personalizadas](/docs/probe/custom-probe)
- [Monitor de solicitudes entrantes](/docs/monitor/incoming-request-monitor)
