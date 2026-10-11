# Sondas personalizadas

Una sonda personalizada es un pequeño agente que usted ejecuta dentro de su propia red. Comprueba los monitores a los que la añade, como sitios web internos, API y servidores detrás de su cortafuegos, y envía los resultados a OneUptime. Solo abre conexiones salientes, por HTTPS, así que nada en su red tiene que aceptar conexiones desde Internet.

:::cards
- [Cómo funciona](#cómo-funciona): Qué hace la sonda y cómo sabe OneUptime que está en marcha.
- [Instalar una sonda](#instalar-una-sonda): Crearla en OneUptime, ejecutarla con Docker, Docker Compose o Kubernetes y añadirla a monitores.
- [Variables de entorno](#variables-de-entorno): Cada ajuste que lee la sonda, con su valor predeterminado.
- [Diagnosticar una sonda desconectada](#diagnosticar-una-sonda-desconectada): Encontrar dónde se detienen las solicitudes de la sonda a OneUptime.
:::

## Cómo funciona

```mermaid title="Qué hace una sonda personalizada"
sequenceDiagram
    participant P as Sonda personalizada
    participant S as Sus servicios
    participant O as OneUptime
    P->>O: Estoy en marcha (cada minuto)
    P->>O: ¿Qué monitores míos tocan?
    O-->>P: Los monitores que comprobar
    P->>S: Comprobar cada uno
    P->>O: Enviar los resultados
    O->>O: Actualizar el estado, abrir incidentes o alertas
```

- **La sonda se conecta hacia fuera.** Cada solicitud va de la sonda a `ONEUPTIME_URL` por HTTPS. Nada tiene que llegar a la sonda desde fuera de su red.
- **Solo comprueba sus propios monitores.** La sonda pide a OneUptime los monitores a los que está añadida, comprueba cada uno cuando le toca y devuelve el resultado. OneUptime decide a partir de los resultados si cambia el estado de un monitor.
- **OneUptime vigila que esté en marcha.** Cada solicitud de la sonda cuenta como señal de vida, y la sonda envía al menos una por minuto. Tras unos tres minutos sin ninguna, la sonda muestra **Desconectado** y se avisa a sus propietarios. Una sonda sin propietarios avisa a los propietarios del proyecto.

## Antes de empezar

- **El plan Growth, en OneUptime Cloud.** Crear una sonda lo requiere. Una instalación autoalojada no tiene límites de plan.
- **Permiso para crear sondas.** Los propietarios y administradores del proyecto lo tienen, y también los miembros cuyo rol les permite crear sondas.
- **Una máquina en la red que quiere supervisar.** Necesita Docker, Docker Compose o Kubernetes, una ruta hasta los servicios que comprobará la sonda y HTTPS saliente hacia `ONEUPTIME_URL`.

## Instalar una sonda

:::steps
### Crear la sonda

Abra **Monitores → Ajustes → Sondas** y haga clic en **Crear Sonda**. Dele un **Nombre** y una **Descripción**: ambos son obligatorios. **Más campos** contiene el **Logotipo de la sonda**, **Habilitar el monitoreo automáticamente en los nuevos monitores**, que elige esta sonda para cada monitor nuevo que cree, y las **Etiquetas**.

### Copiar su ID y su clave

La sonda necesita su ID y su clave para conectarse. Para copiarlos, abra el menú de la sonda en la tabla **Sondas personalizadas** y elija **Mostrar ID y clave**. Cualquiera que vea la tabla puede copiar el ID de una sonda; su clave solo se muestra a los propietarios y administradores del proyecto, que ven **Mostrar ID y clave** donde los demás ven **Mostrar ID**.

Los propietarios y administradores del proyecto también pueden hacer clic en la sonda: la tarjeta **Configura tu sonda personalizada** de su página muestra el comando de Docker con su ID y su clave ya rellenados.

### Ejecutar la sonda

Ejecútela en la máquina elegida, con el ID y la clave de la sonda. Si aloja OneUptime usted mismo, establezca `ONEUPTIME_URL` en la URL de su instalación en lugar de `https://oneuptime.com`.

:::tabs
@tab Docker
```bash
docker run --name oneuptime-probe --network host \
  -e PROBE_KEY=<probe-key> \
  -e PROBE_ID=<probe-id> \
  -e ONEUPTIME_URL=https://oneuptime.com \
  -d oneuptime/probe:release
```
@tab Docker Compose
```yaml title="docker-compose.yml"
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

Luego iníciela con `docker compose up -d`.
@tab Kubernetes
```yaml title="oneuptime-probe.yaml"
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

Luego aplíquela con `kubectl apply -f oneuptime-probe.yaml`.
:::

La red del host (`--network host`, `network_mode: host`) permite a la sonda usar la propia red del host, IPv6 incluido. Lea [Supervisar destinos IPv6](#supervisar-destinos-ipv6) antes de ejecutarla sin la red del host.

### Comprobar que se conecta

En uno o dos minutos, el **Estado** de la sonda en la tabla **Sondas personalizadas** dice **Conectado**. Si sigue diciendo **Desconectado**, el registro de la sonda dice por qué: vea [Diagnosticar una sonda desconectada](#diagnosticar-una-sonda-desconectada).

### Comprobar un monitor desde la sonda

Una sonda solo comprueba los monitores a los que está añadida. Un monitor nuevo elige sus sondas en el paso **Sondas e intervalo** de **Crear monitor**. Para un monitor existente, ábralo y vaya a **Configuración → Sondas e intervalo**. La página tiene tres tarjetas:

- **Intervalo de monitoreo**: cada cuánto lo comprueba cada una de las sondas del monitor. Elija un intervalo y se guarda al instante. Los monitores sintéticos, Custom Code y de certificado SSL se ofrecen cada 5 minutos o más; uno que ya tiene un intervalo más corto, o una programación definida por la API, la conserva y la muestra en la lista.
- **Sondas**: haga clic en **Añadir sonda** y elija su sonda personalizada. Para que una sonda deje de comprobar este monitor, desactívela con **Editar** en el menú de la fila, o elimine la fila.
- **Acuerdo de sondas**: cuántas sondas del monitor deben ver el mismo resultado antes de que cambie su estado, escrito en la frase «Cambiar el estado de este monitor cuando ... sondas coincidan». Deje la casilla vacía para todas. Solo participan las sondas activadas y conectadas, así que un número mayor también significa todas. El número se guarda al salir de la casilla o al pulsar **Enter**.

Los monitores que las sondas no comprueban (Manual, Solicitud entrante, Correo entrante, Servidor, Dispositivo de red y los monitores de telemetría) no tienen página Sondas e intervalo.
:::

> [!TIP]
> Una sonda que deba comprobar direcciones privadas, como `http://10.0.0.5/health`, necesita `PROBE_ALLOW_PRIVATE_NETWORK_MONITORS=true`. Las sondas rechazan las direcciones privadas hasta que usted las permita: vea [Acceso a red privada](/docs/self-hosted/private-network-access).

## Conectarse a través de un proxy

Si la sonda tiene que pasar por un proxy para llegar a OneUptime o a los sitios que comprueba, dele la dirección del proxy:

| Variable | Qué hace |
| --- | --- |
| `HTTPS_PROXY_URL` | El proxy para direcciones HTTPS, entre ellas OneUptime y la mayoría de los sitios. |
| `HTTP_PROXY_URL` | El proxy para direcciones HTTP sin cifrar. |
| `NO_PROXY` | Hosts a los que la sonda llega directamente, separados por comas. |

Escriba la dirección de un proxy como `http://proxy.example.com:8080`, o `http://username:password@proxy.example.com:8080` cuando pida usuario y contraseña. La mayoría de los proxies atienden ambos tipos de dirección, así que establezca ambas variables en la misma URL.

:::tabs
@tab Docker
```bash
docker run --name oneuptime-probe --network host \
  -e PROBE_KEY=<probe-key> \
  -e PROBE_ID=<probe-id> \
  -e ONEUPTIME_URL=https://oneuptime.com \
  -e HTTP_PROXY_URL=http://proxy.example.com:8080 \
  -e HTTPS_PROXY_URL=http://proxy.example.com:8080 \
  -e NO_PROXY=localhost,.internal.example.com \
  -d oneuptime/probe:release
```
@tab Docker Compose
```yaml title="docker-compose.yml"
services:
  oneuptime-probe:
    image: oneuptime/probe:release
    container_name: oneuptime-probe
    environment:
      - PROBE_KEY=<probe-key>
      - PROBE_ID=<probe-id>
      - ONEUPTIME_URL=https://oneuptime.com
      - HTTP_PROXY_URL=http://proxy.example.com:8080
      - HTTPS_PROXY_URL=http://proxy.example.com:8080
      - NO_PROXY=localhost,.internal.example.com
    network_mode: host
    restart: always
```
@tab Kubernetes
```yaml title="oneuptime-probe.yaml"
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
            - name: HTTP_PROXY_URL
              value: "http://proxy.example.com:8080"
            - name: HTTPS_PROXY_URL
              value: "http://proxy.example.com:8080"
            - name: NO_PROXY
              value: "localhost,.internal.example.com"
```
:::

Lo que pasa por el proxy:

- **Las propias solicitudes de la sonda a OneUptime.**
- **Las comprobaciones HTTP de los monitores**: monitores Website, API, External Status Page, Custom Code, de certificado SSL, sintéticos y de dominio. Los monitores de certificado SSL y sintéticos usan `HTTPS_PROXY_URL`, o `HTTP_PROXY_URL` cuando solo esa está definida.
- **No las demás comprobaciones.** Ping, Port, DNS, SNMP y las demás comprobaciones que no son HTTP se conectan directamente.

Una entrada de `NO_PROXY` es un nombre de host (`api.internal`), un dominio con un punto inicial o `*.` para todos los nombres que cuelgan de él (`.internal.example.com`), cualquiera de ellos con un `:port`, o `*` para todo. Los rangos de IP no se leen: enumere cada dirección. Los nombres en minúsculas `http_proxy`, `https_proxy` y `no_proxy`, y también `HTTP_PROXY` y `HTTPS_PROXY`, funcionan igual.

## Supervisar destinos IPv6

Una sonda solo puede supervisar un destino IPv6 si su propia red tiene IPv6:

- **Docker con `--network host`, o Compose con `network_mode: host`** (las configuraciones de arriba): la sonda comparte la red del host, así que tiene IPv6 exactamente cuando el host lo tiene.
- **Una red bridge de Docker** (lo que obtiene sin la red del host): sin IPv6, salvo que IPv6 esté activado para esa red (vea más abajo).
- **Kubernetes**: los pods solo tienen IPv6 en un clúster de doble pila o solo IPv6.

Para comprobarlo, haga ping a una dirección IPv6 pública desde dentro de la sonda:

:::tabs
@tab Docker
```bash
docker exec oneuptime-probe ping -6 -c 1 2001:4860:4860::8888
```
@tab Kubernetes
```bash
kubectl exec deploy/oneuptime-probe -- ping -6 -c 1 2001:4860:4860::8888
```
:::

`1 received` significa que la sonda puede llegar a destinos IPv6. Si la sonda no tiene IPv6 utilizable, `ping` falla al instante y el error dice por qué:

| Error | Qué significa |
| --- | --- |
| `Network is unreachable` | La red de la sonda no tiene ruta IPv6: una red bridge de Docker sin IPv6, un clúster de Kubernetes solo IPv4, o un host sin conectividad IPv6. |
| `Cannot assign requested address` | IPv6 está desactivado en el espacio de nombres de red de la sonda. Compruebe `net.ipv6.conf.all.disable_ipv6` y `net.ipv6.conf.lo.disable_ipv6`: `cat /proc/sys/net/ipv6/conf/all/disable_ipv6` dentro de la sonda imprime `1` cuando está desactivado. Con la red del host, son los ajustes del host. |
| `Address family not supported by protocol` | El kernel arrancó con `ipv6.disable=1`, así que la máquina no tiene IPv6 en absoluto. Quítelo de la línea de comandos del kernel y reinicie, o ejecute la sonda en otra máquina. |

En cada caso no se envió nada al destino, así que la sonda no puede saber si está activo. La comprobación falla igualmente, pero el motivo del fallo de un monitor Ping nombra a la sonda en lugar de decir que el destino no respondió:

```text
This probe cannot send IPv6 traffic (ping6: connect: Cannot assign requested address), so 2001:db8::1 was never contacted. The probe has no usable IPv6 address or route; this says nothing about whether 2001:db8::1 is up. Monitor IPv6 destinations from a probe that has IPv6 connectivity.
```

La ruta de red registrada con el fallo dice `Traceroute could not run: this probe cannot send IPv6 traffic (...)`. Arregle la red de la sonda, o mueva el monitor a una sonda que tenga IPv6.

### IPv6 sin la red del host

Si no puede usar la red del host, conecte la sonda a una red de Docker con IPv6 activado. El propio host sigue necesitando IPv6.

```bash
docker network create --ipv6 oneuptime-probe-ipv6
docker run --name oneuptime-probe --network oneuptime-probe-ipv6 -e PROBE_KEY=<probe-key> -e PROBE_ID=<probe-id> -e ONEUPTIME_URL=https://oneuptime.com -d oneuptime/probe:release
```

Docker Engine 27 y posteriores eligen una subred IPv6 para la red y enmascaran el IPv6 saliente de la sonda tras la dirección del host. Las versiones anteriores necesitan una subred IPv6 explícita (por ejemplo `docker network create --ipv6 --subnet fd00:0:0:1::/64 oneuptime-probe-ipv6`) y `"ip6tables": true` con `"experimental": true` en `/etc/docker/daemon.json`. Con Docker Compose, quite `network_mode: host` y establezca `enable_ipv6: true` en la red de la sonda.

## Búsquedas de nombres NetBIOS en los escaneos de descubrimiento

Un [escaneo de descubrimiento de red](/docs/monitor/network-device-monitor) con **Buscar nombres de Windows (NetBIOS)** activado envía desde la sonda consultas de nombre NetBIOS (NBSTAT) a cada host que no tiene nombre de sistema SNMP. Para los escaneos que lo usan, permita este tráfico:

- **Qué hosts se consultan:** los hosts descubiertos que no tienen ni nombre de sistema SNMP ni nombre de DNS inverso (PTR), y solo en direcciones privadas (`10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`) o de NAT de nivel de operador (`100.64.0.0/10`). Las direcciones públicas nunca se consultan, y un host cuya búsqueda de DNS inverso desde la sonda devolvió un nombre nunca recibe una consulta. Un host cuya búsqueda falló, agotó el tiempo o se omitió al acabarse el presupuesto de tiempo de las búsquedas aún puede consultarse, aunque tenga un registro PTR.
- **Saliente:** UDP desde un puerto de origen efímero (aleatorio y alto) de la sonda hacia el puerto UDP 137 de esos hosts. Los ajustes de proxy de arriba no se le aplican.
- **Entrante:** las respuestas, desde el puerto UDP 137 de cada host hacia ese puerto efímero. Un cortafuegos con estado las permite automáticamente. Sin ellas, los hosts siguen nombrándose por su dirección IP.

La búsqueda no necesita ninguna capacidad adicional del contenedor y funciona desde la red de pods de Kubernetes. Consulta como máximo 2.000 hosts por escaneo (`PROBE_DISCOVERY_NETBIOS_MAX_HOSTS` lo eleva a 4.000), envía una consulta más a cada host que no responde, espacia las consultas a unas 100 por segundo y se detiene en un límite de tiempo calculado para ese trabajo - unos 54 segundos para una búsqueda completa de 2.000 hosts, y nunca más de dos minutos. Las sondas globales nunca envían consultas NetBIOS, diga lo que diga el escaneo, así que ejecute desde una sonda personalizada los escaneos que necesiten nombres NetBIOS. La opción está activada en los escaneos nuevos. Las consultas NBSTAT a muchos hosts pueden disparar reglas de detección de intrusiones, así que desactívela en los escaneos de redes donde eso importe, o avise antes a su equipo de seguridad.

## Variables de entorno

La sonda lee sus ajustes de su entorno al arrancar: cambie uno y reinicie la sonda. Un número que la sonda no puede leer, o uno fuera del rango que admite una variable, se ignora y se usa el valor predeterminado; los límites de captura de paquetes se ajustan a su rango en su lugar.

### Obligatorias

| Variable | Qué es |
| --- | --- |
| `PROBE_KEY` | La clave de la sonda, de **Mostrar ID y clave**. Sin ella, la sonda se detiene al arrancar. |
| `PROBE_ID` | El ID de la sonda, de **Mostrar ID y clave**. Sin él, la sonda se detiene al arrancar. |
| `ONEUPTIME_URL` | Dónde está OneUptime: `https://oneuptime.com`, o la URL de su propia instalación. Sin ella, la sonda se detiene al arrancar. |

### Comprobación de monitores

| Variable | Predeterminado | Qué hace |
| --- | --- | --- |
| `PROBE_MONITORING_WORKERS` | `1` | Cuántos lotes de monitores comprueba la sonda a la vez. |
| `PROBE_MONITOR_FETCH_LIMIT` | `10` | Cuántos monitores hay en un lote. |
| `PROBE_MONITOR_RETRY_LIMIT` | `3` | Reintentos tras el primer intento de una comprobación fallida, que se usan cuando un paso no fija su propio número, así que hasta 4 intentos. `0` desactiva los reintentos. |
| `PROBE_MONITOR_CHECK_TIMEOUT_IN_MS` | `900000` | Plazo para comprobar un monitor, tras el cual la comprobación se abandona y se reintenta en el siguiente ciclo. El valor predeterminado crece cuando se sube el tiempo límite de los scripts sintéticos, para que un script nunca se corte. |
| `PROBE_SYNTHETIC_MONITOR_SCRIPT_TIMEOUT_IN_MS` | `60000` | Tiempo límite de los scripts de los monitores sintéticos, en milisegundos. |
| `PROBE_CUSTOM_CODE_MONITOR_SCRIPT_TIMEOUT_IN_MS` | `60000` | Tiempo límite de los scripts de los monitores Custom Code, en milisegundos. |
| `PROBE_ALLOW_PRIVATE_NETWORK_MONITORS` | `false` | Establézcala en `true` para que los monitores Website, API, External Status Page y Custom Code de esta sonda puedan llegar a direcciones privadas. Vea [Acceso a red privada](/docs/self-hosted/private-network-access). |

Los límites dentro de los que se ejecuta un monitor sintético (cuántos a la vez, su memoria y su disco) están en la página [Monitor sintético](/docs/monitor/synthetic-monitor).

### Comunicación con OneUptime

| Variable | Predeterminado | Qué hace |
| --- | --- | --- |
| `HTTP_PROXY_URL`, `HTTPS_PROXY_URL`, `NO_PROXY` | ninguno | Los ajustes del proxy: vea [Conectarse a través de un proxy](#conectarse-a-través-de-un-proxy). |
| `PROBE_API_REQUEST_TIMEOUT_IN_MS` | `45000` | Plazo de cada solicitud que la sonda envía a OneUptime. |
| `PROBE_API_SLOW_REQUEST_THRESHOLD_IN_MS` | `10000` | Registrar una advertencia para las solicitudes a OneUptime más lentas que esto. |

### Descubrimiento de red

| Variable | Predeterminado | Qué hace |
| --- | --- | --- |
| `PROBE_DISCOVERY_SCAN_TIMEOUT_IN_MS` | `5400000` (90 minutos) | Plazo de un barrido de descubrimiento de red, tras el cual se abandona y el escaneo se informa como fallido. |
| `PROBE_DISCOVERY_PROGRESS_INTERVAL_IN_MS` | `30000` | Cada cuánto sube un barrido de descubrimiento en curso los hosts que lleva encontrados, para que un escaneo largo muestre su avance y sus dispositivos puedan importarse antes de que termine. Mínimo `5000`. |
| `PROBE_DISCOVERY_SCAN_CONCURRENCY` | `0` | Número fijo de direcciones que un barrido de descubrimiento sondea a la vez. Déjela sin definir (o en `0`) para calcularlo a partir del objetivo del escaneo, que es lo que quiere salvo que el contenedor de la sonda sea inusualmente pequeño o inusualmente grande. |
| `PROBE_DISCOVERY_REVERSE_DNS_BUDGET_IN_MS` | `0` | Límite de tiempo, en milisegundos, para buscar los nombres de DNS inverso (PTR) de los hosts que encontró un barrido. Vea más abajo. |
| `PROBE_DISCOVERY_NETBIOS_MAX_HOSTS` | `0` | Cuántos hosts puede consultar la búsqueda NetBIOS de un escaneo. Vea más abajo. |
| `PROBE_DISCOVERY_MAX_CONCURRENT_SCANS` | `4` | Máximo de escaneos de descubrimiento independientes en ejecución a la vez en esta sonda, de 1 a 16. Vea más abajo. |

`PROBE_DISCOVERY_REVERSE_DNS_BUDGET_IN_MS`: déjela sin definir (o en `0`) para calcular el límite a partir del número de hosts: 60 segundos hasta unos 860 hosts, creciendo hasta 10 minutos como máximo. Puede establecerla de 1000 a 1200000. Los hosts a los que las búsquedas no llegan a tiempo no obtienen nombre de DNS inverso (aparecen por su dirección IP salvo que SNMP o NetBIOS los nombre), y el mensaje de estado del escaneo dice cuántos se perdieron. Una búsqueda que agota el tiempo o falla se reintenta una vez mientras dure el límite, preguntando a cada uno de los servidores de nombres de la sonda por turno. Súbala para una red grande detrás de un servidor DNS lento.

`PROBE_DISCOVERY_NETBIOS_MAX_HOSTS`: en los escaneos con nombres NetBIOS activados, la búsqueda consulta cada host sin nombre de sistema SNMP, primero los que no tienen nombre de DNS inverso. Déjela sin definir (o en `0`) para mantener el tope integrado de 2.000; puede establecerla de 1 a 4000. Los hosts por encima del tope no se consultan, y el mensaje de estado del escaneo dice cuántos. Subirla también alarga la búsqueda (su límite de tiempo se calcula a partir de ella: unos 104 segundos con 4.000 hosts) y pone más datagramas NBSTAT en la red, que vigilan las reglas de detección de intrusiones.

`PROBE_DISCOVERY_MAX_CONCURRENT_SCANS`: la sonda busca otro escaneo pendiente cada minuto mientras tenga capacidad, para que un escaneo largo no bloquee a todos los demás. Cuando todos los huecos están ocupados, los escaneos adicionales quedan pendientes hasta que se libere uno. Cada escaneo tiene su propia concurrencia de hosts, así que el uso de recursos crece con ambos ajustes; baje cualquiera de los dos límites en contenedores pequeños. Establézcala en 1 para ejecutar los escaneos de uno en uno.

Actualice el servidor de OneUptime antes de actualizar las sondas personalizadas para usar el descubrimiento concurrente. El servidor debe poder excluir los escaneos que la sonda aún está ejecutando, para que editar un escaneo en curso ponga en cola su nueva configuración de forma segura. Al conectar una sonda actualizada a un servidor más antiguo, establezca `PROBE_DISCOVERY_MAX_CONCURRENT_SCANS=1` hasta que se actualice el servidor.

### Captura de paquetes

| Variable | Predeterminado | Qué hace |
| --- | --- | --- |
| `PROBE_PACKET_CAPTURE_ENABLED` | desactivada | Establézcala en `true` para que las personas con el permiso inicien capturas de paquetes en esta sonda desde el panel. Las capturas necesitan además la red del host y la capacidad `NET_RAW`. Vea [Captura de paquetes](/docs/probe/packet-capture). |
| `PROBE_PACKET_CAPTURE_MAX_DURATION_IN_SECONDS` | `1800` | La captura de paquetes más larga que ejecuta esta sonda, de 5 a 1800. |
| `PROBE_PACKET_CAPTURE_MAX_FILE_SIZE_IN_MB` | `25` | El archivo de captura más grande que crea esta sonda, de 1 a 25. |

### Dónde escucha la sonda

Una sonda solo abre conexiones salientes, salvo que active un escuchador o mantenga uno que viene activado por defecto:

| Escuchador | Ajuste | Predeterminado | Más información |
| --- | --- | --- | --- |
| Solicitudes entrantes y heartbeats | `PROBE_INGRESS_PORT` | Desactivado | [Ingress de solicitudes entrantes](/docs/probe/incoming-request-ingress) |
| Traps SNMP | `PROBE_SNMP_TRAP_RECEIVER_ENABLED` | Activado, UDP 162 | [Monitor de dispositivos de red](/docs/monitor/network-device-monitor) |
| Syslog | `PROBE_SYSLOG_RECEIVER_ENABLED` | Desactivado, UDP 5140 | [Guías por fabricante de red](/docs/monitor/network-vendor-guides) |
| NetFlow, IPFIX y sFlow | `PROBE_NETFLOW_RECEIVER_ENABLED` | Activado, UDP 2055, 4739 y 6343 | [Tráfico de red](/docs/monitor/network-traffic) |
| Comprobaciones de salud | `PORT` | Activado, TCP 3874 | `/status/live` y `/status/ready` |

Dentro de un contenedor, un puerto solo es accesible desde otras máquinas con la red del host o si lo publica.

`PROBE_NAME` y `PROBE_DESCRIPTION` solo los leen las sondas que se registran a sí mismas con `REGISTER_PROBE_KEY`, como las sondas que una instalación autoalojada ejecuta para todos los proyectos. Una sonda personalizada toma su nombre y su descripción del panel.

## Solución de problemas

### Diagnosticar una sonda desconectada

Una sonda se marca como `Disconnected` cuando sus solicitudes a OneUptime dejan de tener éxito. El registro de la sonda dice dónde se atascó cada solicitud fallida, así que rara vez tendrá que adivinar.

:::steps
#### Leer el bloque de entorno que se imprime al arrancar

Cada sonda imprime al arrancar un bloque JSON con la URL de OneUptime que usa, su plazo de solicitud, sus ajustes de proxy, los resolvedores DNS que heredó, la versión de Node y del sistema operativo, y si se ha desactivado la verificación TLS. Incluya este bloque siempre que informe de un problema.

#### Encontrar el informe de fallo

Cada solicitud fallida a OneUptime registra un bloque con `stalledAt` y `whatThisMeans`. `stalledAt` es la fase que la solicitud nunca superó:

| `stalledAt` | Qué significa |
| --- | --- |
| `SocketAssignment` | Nada salió de la máquina. El grupo de sockets estaba saturado, o un proxy configurado nunca completó su túnel CONNECT. |
| `TcpConnect` | La máquina envió SYN y no recibió nada: un cortafuegos o un dispositivo de seguridad descarta paquetes, o el host es inalcanzable. |
| `TlsHandshake` | TCP se conectó, TLS nunca terminó. Normalmente un equipo intermedio que inspecciona TLS. |
| `RequestSend` | Conectado, pero la solicitud nunca se escribió entera: el otro extremo dejó de leer. |
| `WaitingForServerResponse` | La solicitud se entregó y el servidor no devolvió nada. **La red de la sonda está bien**: revise el servidor de OneUptime, su balanceador de carga y su proxy inverso. |
| `ResponseBody` | El servidor empezó a responder y se detuvo a mitad. |

El mismo bloque también informa de `deadlineOverrunInMs`. Si un plazo de 45000ms tardó mucho más de 45000ms de tiempo real, el propio proceso de la sonda estaba bloqueado: revise `probeProcess.eventLoopMaxDriftInMs` en el bloque antes de investigar la red.

#### Leer la autoprueba de conectividad

Tras tres fallos consecutivos, la sonda prueba el mismo servidor capa por capa (DNS, luego TCP, luego TLS y luego una ida y vuelta HTTP real) y registra cada etapa con su duración. La primera etapa que falla es su respuesta. Cuando hay un proxy configurado, la sonda prueba el salto hasta el proxy, porque es el único salto que realmente hace. La prueba se ejecuta como mucho una vez cada cinco minutos.

#### Vigilar las solicitudes lentas antes de que fallen

Las solicitudes que tienen éxito pero tardan más de `PROBE_API_SLOW_REQUEST_THRESHOLD_IN_MS` se registran con su duración. Una sonda que empieza a registrar solicitudes de 20 segundos va camino de superar el plazo de 45 segundos.
:::

En el lado del servidor de OneUptime, una solicitud de sonda que se responde despacio, o que la sonda abandonó antes de que se enviara una respuesta, también se registra, con el id de la sonda. Esos dos registros juntos dicen en qué lado de la conexión está el fallo.

### Otros problemas

:::details La sonda se detiene justo después de arrancar
Su registro dice qué falta: `PROBE_KEY is not set`, `PROBE_INGEST_URL or ONEUPTIME_URL is not set` o `PROBE_ID or REGISTER_PROBE_KEY should be set`. Cuando las tres están definidas pero el ID y la clave no corresponden a ninguna sonda, la sonda lo intenta 10 veces, con 30 segundos entre intentos, y luego se detiene con `Unable to register probe after 10 attempts`. Vuelva a copiar el ID y la clave con **Mostrar ID y clave**.
:::

:::details La sonda funcionaba hasta que alguien restableció su clave
**Restablecer clave de sonda**, en la página de la sonda, crea una clave nueva y la anterior deja de funcionar al instante. Copie la clave nueva con **Mostrar ID y clave**, establézcala como `PROBE_KEY` y reinicie la sonda.
:::

:::details Un monitor dice que no puede llegar a una dirección privada
Las sondas rechazan las direcciones privadas hasta que usted las permita. Establezca `PROBE_ALLOW_PRIVATE_NETWORK_MONITORS=true` en la sonda y reiníciela: vea [Acceso a red privada](/docs/self-hosted/private-network-access).
:::

Si sigue teniendo problemas, abra una incidencia en [GitHub](https://github.com/oneuptime/oneuptime) o [contacte con soporte](https://oneuptime.com/support).

## Próximos pasos

:::cards
- [Crear un monitor](/docs/monitor/create-monitor): Elegir qué se comprueba y qué sondas lo comprueban.
- [Ingress de solicitudes entrantes](/docs/probe/incoming-request-ingress): Permitir que los servicios sin acceso a Internet envíen heartbeats a través de la sonda.
- [Captura de paquetes](/docs/probe/packet-capture): Capturar desde el panel el tráfico que ve la sonda.
- [Acceso a red privada](/docs/self-hosted/private-network-access): Permitir que una sonda compruebe direcciones privadas.
:::
