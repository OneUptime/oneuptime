## Configuración de sondas personalizadas

Puedes configurar sondas personalizadas dentro de tu red para monitorear recursos en tu red privada o recursos que están detrás de tu firewall.

Para comenzar, necesitas crear una sonda personalizada en tu Panel de OneUptime, en Monitores > Ajustes > Sondas. Una vez que hayas creado la sonda personalizada en tu panel de OneUptime, deberías tener el `PROBE_ID` y la `PROBE_KEY`.

### Implementar la sonda

#### Docker

Para ejecutar una sonda, asegúrate de tener Docker instalado. Puedes ejecutar la sonda personalizada con:

```
docker run --name oneuptime-probe --network host -e PROBE_KEY=<probe-key> -e PROBE_ID=<probe-id> -e ONEUPTIME_URL=https://oneuptime.com -d oneuptime/probe:release
```

Si te auto-alojas en OneUptime, puedes cambiar `ONEUPTIME_URL` a tu instancia personalizada auto-alojada.

##### Configuración de proxy

Si tu sonda necesita pasar por un servidor proxy para llegar a OneUptime o monitorear recursos externos, puedes configurar los ajustes de proxy usando estas variables de entorno:

```
# Para proxy HTTP
docker run --name oneuptime-probe --network host \
  -e PROBE_KEY=<probe-key> \
  -e PROBE_ID=<probe-id> \
  -e ONEUPTIME_URL=https://oneuptime.com \
  -e HTTP_PROXY_URL=http://proxy.example.com:8080 \
  -e NO_PROXY=localhost,.internal.example.com \
  -d oneuptime/probe:release

# Para proxy HTTPS
docker run --name oneuptime-probe --network host \
  -e PROBE_KEY=<probe-key> \
  -e PROBE_ID=<probe-id> \
  -e ONEUPTIME_URL=https://oneuptime.com \
  -e HTTPS_PROXY_URL=http://proxy.example.com:8080 \
  -e NO_PROXY=localhost,.internal.example.com \
  -d oneuptime/probe:release

# Con autenticación de proxy
docker run --name oneuptime-probe --network host \
  -e PROBE_KEY=<probe-key> \
  -e PROBE_ID=<probe-id> \
  -e ONEUPTIME_URL=https://oneuptime.com \
  -e HTTP_PROXY_URL=http://username:password@proxy.example.com:8080 \
  -e HTTPS_PROXY_URL=http://username:password@proxy.example.com:8080 \
  -e NO_PROXY=localhost,.internal.example.com \
  -d oneuptime/probe:release
```

#### Docker Compose

También puedes ejecutar la sonda usando docker-compose. Crea un archivo `docker-compose.yml` con el siguiente contenido:

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
    network_mode: host
    restart: always
```

##### Con configuración de proxy

Si necesitas usar un servidor proxy, puedes agregar variables de entorno de proxy:

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
      # Configuración de proxy (opcional)
      - HTTP_PROXY_URL=http://proxy.example.com:8080
      - HTTPS_PROXY_URL=http://proxy.example.com:8080
      - NO_PROXY=localhost,.internal.example.com
      # Para proxy con autenticación:
      # - HTTP_PROXY_URL=http://username:password@proxy.example.com:8080
      # - HTTPS_PROXY_URL=http://username:password@proxy.example.com:8080
      # - NO_PROXY=localhost,.internal.example.com
    network_mode: host
    restart: always
```

Luego ejecuta el siguiente comando:

```
docker compose up -d
```

Si te auto-alojas en OneUptime, puedes cambiar `ONEUPTIME_URL` a tu instancia personalizada auto-alojada.

#### Kubernetes

También puedes ejecutar la sonda usando Kubernetes. Crea un archivo `oneuptime-probe.yaml` con el siguiente contenido:

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
```

##### Con configuración de proxy

Si necesitas usar un servidor proxy, puedes agregar variables de entorno de proxy:

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
            # Configuración de proxy (opcional)
            - name: HTTP_PROXY_URL
              value: "http://proxy.example.com:8080"
            - name: HTTPS_PROXY_URL
              value: "http://proxy.example.com:8080"
            - name: NO_PROXY
              value: "localhost,.internal.example.com"
            # Para proxy con autenticación, usa:
            # - name: HTTP_PROXY_URL
            #   value: "http://username:password@proxy.example.com:8080"
            # - name: HTTPS_PROXY_URL
            #   value: "http://username:password@proxy.example.com:8080"
            # - name: NO_PROXY
            #   value: "localhost,.internal.example.com"
```

Luego ejecuta el siguiente comando:

```bash
kubectl apply -f oneuptime-probe.yaml
```

Si te auto-alojas en OneUptime, puedes cambiar `ONEUPTIME_URL` a tu instancia personalizada auto-alojada.

### Variables de entorno

La sonda admite las siguientes variables de entorno:

#### Variables requeridas

- `PROBE_KEY`: La clave de la sonda de tu panel de OneUptime
- `PROBE_ID`: El ID de la sonda de tu panel de OneUptime
- `ONEUPTIME_URL`: La URL de tu instancia de OneUptime (predeterminado: https://oneuptime.com)

#### Variables opcionales

- `HTTP_PROXY_URL`: URL del servidor proxy HTTP para solicitudes HTTP
- `HTTPS_PROXY_URL`: URL del servidor proxy HTTP para solicitudes HTTPS
- `NO_PROXY`: Hosts o dominios separados por comas que deben omitir el proxy
- `PROBE_NAME`: Nombre personalizado para la sonda
- `PROBE_DESCRIPTION`: Descripción para la sonda
- `PROBE_MONITORING_WORKERS`: Número de workers de monitoreo (predeterminado: 1)
- `PROBE_MONITOR_FETCH_LIMIT`: Número de monitores a obtener a la vez (predeterminado: 10)
- `PROBE_MONITOR_RETRY_LIMIT`: Número de reintentos para monitores fallidos (predeterminado: 3)
- `PROBE_SYNTHETIC_MONITOR_SCRIPT_TIMEOUT_IN_MS`: Tiempo de espera para scripts de monitores sintéticos en milisegundos (predeterminado: 60000)
- `PROBE_CUSTOM_CODE_MONITOR_SCRIPT_TIMEOUT_IN_MS`: Tiempo de espera para scripts de monitores de código personalizado en milisegundos (predeterminado: 60000)
- `PROBE_API_REQUEST_TIMEOUT_IN_MS`: Plazo límite para cada solicitud que la sonda envía a OneUptime (predeterminado: 45000)
- `PROBE_API_SLOW_REQUEST_THRESHOLD_IN_MS`: Registra una advertencia para las solicitudes a OneUptime más lentas que este valor (predeterminado: 10000)
- `PROBE_MONITOR_CHECK_TIMEOUT_IN_MS`: Tiempo límite para comprobar un monitor, tras el cual la comprobación se abandona y se reintenta en el siguiente ciclo (predeterminado: 900000)

#### Configuración de proxy

La sonda admite servidores proxy HTTP y HTTPS. Cuando se configura, la sonda enrutará todo el tráfico de monitoreo a través de los servidores proxy especificados. También puedes proporcionar una lista `NO_PROXY` separada por comas para omitir el proxy para hosts o redes internos.

**Formato de URL del proxy:**

```
http://[username:password@]proxy.server.com:port
```

**Ejemplos:**

- Proxy básico: `http://proxy.example.com:8080`
- Con autenticación: `http://username:password@proxy.example.com:8080`

**Características admitidas:**

- Soporte de proxy HTTP y HTTPS
- Autenticación de proxy (nombre de usuario/contraseña)
- Retroceso automático entre proxies HTTP y HTTPS
- Omisión selectiva del proxy usando `NO_PROXY`
- Funciona con todos los tipos de monitor (Sitio web, API, SSL, Sintético, etc.)

**Nota:** Se admiten tanto las variables de entorno estándar (`HTTP_PROXY_URL`, `HTTPS_PROXY_URL`, `NO_PROXY`) como las variantes en minúsculas (`http_proxy`, `https_proxy`, `no_proxy`) por compatibilidad.

### Verificar

Si la sonda se está ejecutando correctamente, debería aparecer como `Connected` en tu panel de OneUptime. Si no aparece como conectada, necesitas revisar los registros del contenedor. Si aún tienes problemas, por favor crea un problema en [GitHub](https://github.com/oneuptime/oneuptime) o [contacta con soporte](https://oneuptime.com/support).

### Diagnosticar una sonda desconectada

Una sonda se marca como `Disconnected` cuando sus solicitudes a OneUptime dejan de completarse correctamente. El registro de la sonda indica en qué punto se quedó atascada cada solicitud fallida, así que rara vez tendrás que adivinar.

**1. Lee el bloque de entorno que se imprime al arrancar.** Cada sonda imprime un bloque JSON al iniciarse con la URL de OneUptime que está usando, su plazo límite de solicitud, su configuración de proxy, los resolutores DNS que heredó, la versión de Node y del sistema operativo, y si se ha deshabilitado la verificación TLS. Incluye este bloque siempre que informes de un problema.

**2. Localiza el informe de fallo.** Cada solicitud fallida a OneUptime registra un bloque que contiene `stalledAt` y `whatThisMeans`. `stalledAt` es la fase que la solicitud nunca llegó a superar:

| `stalledAt` | Qué significa |
| --- | --- |
| `SocketAssignment` | Nada salió de la máquina. El grupo de sockets estaba saturado, o un proxy configurado nunca completó su túnel CONNECT. |
| `TcpConnect` | La máquina envió el SYN y no recibió nada de vuelta: un firewall o un dispositivo de seguridad está descartando los paquetes, o el host es inalcanzable. |
| `TlsHandshake` | TCP se conectó, pero TLS nunca terminó. Normalmente se trata de un middlebox que inspecciona TLS. |
| `RequestSend` | Hubo conexión, pero la solicitud nunca se escribió por completo: el extremo remoto dejó de leer. |
| `WaitingForServerResponse` | La solicitud se entregó y el servidor no devolvió nada. **La red de la sonda está bien**: revisa el servidor de OneUptime, su balanceador de carga y su proxy inverso. |
| `ResponseBody` | El servidor empezó a responder y se detuvo a mitad de camino. |

El mismo bloque también informa de `deadlineOverrunInMs`. Si un plazo límite de 45000 ms tardó mucho más de 45000 ms de tiempo real, el proceso de la sonda estaba bloqueado: revisa `probeProcess.eventLoopMaxDriftInMs` en el bloque antes de investigar la red.

**3. Lee la autocomprobación de conectividad.** Después de tres fallos consecutivos, la sonda prueba el mismo servidor capa por capa (primero DNS, luego TCP, luego TLS y finalmente un viaje de ida y vuelta HTTP real) y registra cada etapa con sus tiempos. La primera etapa que falla es tu respuesta. Cuando hay un proxy configurado, la sonda prueba el salto hasta el proxy, porque ese es el único salto que realmente realiza.

**4. Vigila las solicitudes lentas antes de que se conviertan en fallos.** Las solicitudes que tienen éxito pero tardan más que `PROBE_API_SLOW_REQUEST_THRESHOLD_IN_MS` se registran con su tiempo transcurrido. Una sonda que empieza a registrar solicitudes de 20 segundos va camino de superar el plazo límite de 45 segundos.

En el lado del servidor de OneUptime, una solicitud de una sonda que se responde con lentitud (o que la sonda abandonó antes de que se enviara una respuesta) también se registra allí, con el ID de la sonda. Esos dos registros juntos te indican qué lado de la conexión es el que falla.
