# Agente de cabinas de almacenamiento

El agente de Cabina de almacenamiento de OneUptime supervisa cabinas de almacenamiento: capacidad y reducción de datos, latencia, IOPS y ancho de banda, volúmenes, hosts, pods y replicación, estado del hardware, sistemas de archivos y buckets, y en NetApp ONTAP sus agregados, SVM, LUN y relaciones de SnapMirror. Es un OpenTelemetry Collector estándar que recopila los endpoints OpenMetrics de la cabina con el token de API de un usuario de solo lectura (o, en ONTAP, el exportador Harvest de la propia NetApp, que se ejecuta a su lado), marca cada métrica con la identidad de tu cabina y la envía a OneUptime. Los [monitores de cabinas de almacenamiento](/docs/monitor/storage-array-monitor) alertan sobre lo que llega.

:::cards
- [Instalar el agente](#instala-el-agente): Un usuario de solo lectura y luego el script de instalación o Docker Compose.
- [Dell PowerScale](#dell-powerscale): SNMP en el clúster, cada nodo consultado, y lo que muestran sus páginas.
- [Qué recopila el agente](#qué-recopila-el-agente): Cada endpoint y las páginas que se construyen a partir de él.
- [Supervisar varias cabinas](#supervisar-varias-cabinas): Un agente por cabina, en una sola máquina.
- [Dell PowerMax](#dell-powermax): Sin agente: una sonda lee cada cabina detrás de Unisphere.
- [Solución de problemas](#solución-de-problemas): Un script de diagnóstico y los problemas habituales.
:::

## Cómo funciona

Storage Arrays es un producto que funciona igual para cada fabricante. Es compatible con:

| Cabina | `storage.system` | Cómo la lee el agente | Configuración del colector |
| --- | --- | --- | --- |
| **Pure Storage FlashArray**, Purity//FA 6.7 y posteriores | `purestorage.flasharray` | El propio endpoint OpenMetrics de la cabina (`https://<array>/metrics/...?namespace=purefa`): no se ejecuta nada junto al colector | `otel-collector-config.yaml` (la predeterminada) |
| **Pure Storage FlashArray**, Purity//FA anterior | `purestorage.flasharray` | El exportador OpenMetrics de FlashArray de Pure, que el mismo archivo de Compose ejecuta como el servicio `pure-fa-exporter` | `otel-collector-config.flasharray-exporter.yaml` |
| **Pure Storage FlashBlade** | `purestorage.flashblade` | El exportador OpenMetrics de FlashBlade de Pure, que el mismo archivo de Compose ejecuta como el servicio `pure-fb-exporter` | `otel-collector-config.flashblade.yaml` |
| **Dell PowerStore** | `dell.powerstore` | El PowerStore Metrics Exporter de Dell, que el mismo archivo Compose construye y ejecuta como el servicio `powerstore-exporter`; las alertas del clúster llegan por syslog a su servicio `powerstore-syslog` | `otel-collector-config.powerstore.yaml` |
| **NetApp ONTAP** 9.12.1 y posteriores (AFF, FAS, ASA, ONTAP Select, Cloud Volumes ONTAP), y **Amazon FSx for NetApp ONTAP** | `netapp.ontap` | [NetApp Harvest](https://github.com/NetApp/harvest) 26.11, que el mismo archivo de Compose ejecuta como el servicio `netapp-harvest`: inicia sesión en la API REST del clúster con un usuario de solo lectura y su contraseña | `otel-collector-config.netapp-ontap.yaml` |
| **Dell PowerScale** (Isilon), OneFS 8.0 y posteriores | `dell.powerscale` | Cada nodo por SNMP (la ISILON-MIB de Dell), con el propio receptor SNMP del colector: no se ejecuta nada junto al colector | `otel-collector-config.powerscale.yaml` |

ONTAP no tiene un endpoint de métricas propio, así que el agente ejecuta junto al colector el exportador de código abierto de NetApp, Harvest. Harvest lee la API REST del clúster y sirve lo que ha leído en la red de Compose, con cada serie llamada `netapp_<object>_<counter>`; el colector lo recopila y lo reenvía. Harvest nunca escribe en el clúster, y su informe de AutoSupport a NetApp está desactivado.

**Dell PowerMax** (`dell.powermax`) no necesita agente: una sonda de OneUptime lee, con una cuenta de solo lectura, cada cabina que gestiona un Unisphere for PowerMax. Consulta [Dell PowerMax](#dell-powermax).

Pure Storage pasó a llamarse **Everpure** en febrero de 2026. FlashArray, FlashBlade y Purity conservaron sus nombres, y también las métricas `purefa_*` y `purefb_*`, así que todo lo de esta página se aplica a las cabinas vendidas con cualquiera de los dos nombres.

Un clúster **Dell PowerScale** se lee de otra manera: el agente consulta cada uno de sus nodos por SNMP, con una comunidad de solo lectura o un usuario SNMPv3 y sin token de API. [Dell PowerScale](#dell-powerscale) lo recorre desde la activación de SNMP hasta lo que muestran sus páginas; los pasos de instalación de abajo son los de Pure Storage.

```mermaid title="De la cabina a OneUptime"
flowchart TB
    collector["Colector"] -->|"FlashArray,<br/>Purity//FA 6.7+"| array["La cabina,<br/>puerto 443"]
    collector -->|"FlashArray anterior,<br/>FlashBlade"| exporter["Exportador de Pure"]
    exporter -->|"Token de API"| array
    collector -->|"ONTAP"| harvest["NetApp Harvest"]
    harvest -->|"usuario de solo lectura,<br/>API REST"| cluster["El clúster,<br/>puerto 443"]
    collector -->|"OTLP"| oneuptime["OneUptime"]
    collector -->|"PowerStore"| dell["Dell's exporter"]
    dell -->|"user and password"| array
    array -->|"syslog, port 5514"| syslog["Syslog collector"]
    syslog -->|"OTLP"| oneuptime
```

Un agente supervisa una cabina: ejecuta un agente por cabina (consulta [Supervisar varias cabinas](#supervisar-varias-cabinas)). La cabina se registra con sus primeros datos, con el nombre que el agente marca en cada métrica como `storage.array.name`.

## Antes de empezar

- Docker Engine 20.10 o posterior con el plugin Docker Compose v2, en una máquina que llegue a la interfaz de administración de la cabina por HTTPS (TCP 443).
- Una cuenta de administrador en la cabina, para crear un usuario con el rol integrado **readonly** y un token de API para él. En ONTAP, un administrador del clúster (en Amazon FSx for NetApp ONTAP, `fsxadmin`), para crear un usuario REST de solo lectura con contraseña.
- Para un Dell PowerStore, una máquina x86-64 (Dell solo compila su exportador para x86-64) y un usuario de PowerStore para el agente: consulte [Dell PowerStore](#dell-powerstore).
- Una clave de ingesta. Crea una en **Ajustes del proyecto → Telemetría y APM → Claves de ingesta** y copia su valor.

### Dónde ejecutar el agente

El agente habla con la interfaz de administración de la cabina por HTTPS, así que puede ejecutarse en cualquier máquina con Docker y una ruta a la red de administración por TCP 443: un host de monitorización o una pequeña VM de administración. Prefiere una máquina cuyo propio almacenamiento no esté en la cabina que vigila: si la cabina cae, tu monitorización no debería caer con ella. El receptor de syslog opcional también necesita que la cabina llegue al agente en el puerto de syslog (consulta [Enviar el syslog de la cabina](#opcional-enviar-el-syslog-de-la-cabina)).

## Instala el agente

:::steps
### Crear el usuario de solo lectura y el token de API

El agente solo lee. Dale un usuario propio con el rol integrado **readonly**, nunca un administrador, y un token de API para ese usuario. Crea el token **sin fecha de caducidad**, o el agente se detendrá el día en que caduque el token.

:::tabs
@tab Purity CLI
Conéctate por SSH a la FlashArray como administrador. El primer comando pide la contraseña del nuevo usuario; el segundo imprime su token de API, un UUID:

```bash
pureadmin create --role readonly oneuptime
pureadmin create --api-token oneuptime
```
@tab FlashArray GUI
1. Abre _Settings → Users and Policies_ (_Settings → Access_ en versiones anteriores).
2. En el menú ⋮ del panel **Users**, elige **Create User…**, llama al usuario `oneuptime` y dale el rol readonly.
3. En el menú ⋮ del nuevo usuario, elige **Create API Token…**, deja **Expires In** vacío y copia el token.
@tab FlashBlade
Crea de la misma forma un usuario con el rol **readonly** y un token de API para él: en la configuración de usuarios de la GUI de FlashBlade o con `pureadmin` en la CLI de Purity//FB. En una versión sin usuarios locales, usa una cuenta de un servicio de directorio (LDAP o Active Directory) cuyo grupo se asigne al rol readonly. Los tokens de API de FlashBlade empiezan por `T-`.
@tab ONTAP CLI
Conéctate por SSH a la dirección de administración del clúster como administrador. El primer comando crea un rol REST que puede leer todas las API y nada más; el segundo crea un usuario HTTP que lo tiene y pide su contraseña:

```bash
security login rest-role create -role oneuptime-readonly -api /api -access readonly
security login create -user-or-group-name oneuptime -application http -authentication-method password -role oneuptime-readonly
```

El agente inicia sesión con este usuario y su contraseña. No interviene ningún token de API.
@tab ONTAP System Manager
1. Abre _Cluster → Settings → Users and Roles_.
2. En **Roles**, elige **Add**, llama al rol `oneuptime-readonly`, introduce `/api` como **REST API path** y elige el acceso **Read-Only**.
3. En **Users**, elige **Add**, llama al usuario `oneuptime`, dale el nuevo rol, añade el método de inicio de sesión **HTTP** con **Password** y establece la contraseña.
@tab Amazon FSx for NetApp ONTAP
Conéctate por SSH al endpoint de administración del sistema de archivos (su nombre DNS o su IP, de la consola de FSx) como `fsxadmin` y crea el usuario con el rol de solo lectura predefinido de FSx. El comando pide su contraseña:

```bash
security login create -user-or-group-name oneuptime -application http -authentication-method password -role fsxadmin-readonly
```

AWS gestiona el hardware del sistema de archivos, así que FSx no responde a nadie sobre discos, bandejas ni sensores: la página **Hardware** de la cabina muestra sus nodos y puertos e indica el motivo.
:::

### Comprobar si la FlashArray sirve sus propias métricas

Pure documenta el endpoint OpenMetrics nativo para **Purity//FA 6.7.0 y posteriores** (el aviso de obsolescencia del exportador de FlashArray de Pure dice 6.6.11 y posteriores). La forma más rápida de saberlo es preguntar a la cabina, desde la máquina en la que se ejecutará el agente:

```bash
curl -k 'https://<array>/metrics/array?namespace=purefa' --header 'Authorization: Bearer <api-token>' | grep purefa_info
```

Una línea `purefa_info{...} 1` significa que la cabina sirve sus métricas de forma nativa: usa la configuración predeterminada. Un `404` significa que no: usa la configuración con exportador, que ejecuta el exportador de Pure junto al colector. Pure ha dejado obsoleto ese exportador, así que pásate a la configuración nativa cuando se actualice la cabina. Una FlashBlade siempre pasa por el exportador de FlashBlade de Pure, y un clúster ONTAP por NetApp Harvest, así que en esos casos omite este paso.

### Instala e inicia el agente

Cada instancia de OneUptime sirve el script de instalación y los archivos del agente de su propia versión: los comandos de abajo los descargan de `https://oneuptime.com`, así que en una instancia autoalojada sustituye esa dirección por tu URL. El script de instalación se guarda primero como `install.sh`, para que puedas leerlo antes de ejecutarlo.

:::tabs
@tab install.sh
Descarga el script de instalación y ejecútalo en la máquina que alojará el agente:

```bash
curl -fsSL https://oneuptime.com/install/storage-array-agent -o install.sh
bash install.sh
```

El script pregunta qué cabina es (una FlashArray que sirve métricas nativas, una FlashArray con un Purity//FA anterior, una FlashBlade o un clúster NetApp ONTAP) y luego pide tu URL de OneUptime, la clave de ingesta, un nombre para la cabina, la dirección de administración de la cabina y el token de API del usuario de solo lectura, o en ONTAP el nombre y la contraseña del usuario de solo lectura (leídos sin mostrarse). Se instala en `/opt/oneuptime-storage-array-agent`, descarga el archivo de Compose, todas las configuraciones del colector y los cuatro archivos de Harvest, escribe un archivo con `0600` llamado `.env` con la configuración y el perfil de Compose correspondientes e inicia el agente con Docker Compose. Entrecomilla cada valor para Docker Compose tal como lo escribiste. Volver a ejecutarlo reutiliza todo lo que hay en un `.env` existente en lugar de volver a preguntar, y conserva un archivo que hayas editado como `<file>.bak.<timestamp>` antes de sustituirlo.
@tab Docker Compose
Descarga `docker-compose.yml` y los tres archivos `otel-collector-config*.yaml` de tu OneUptime en una carpeta nueva:

```bash
curl -fsSLO https://oneuptime.com/install/storage-array-agent/docker-compose.yml
curl -fsSLO https://oneuptime.com/install/storage-array-agent/otel-collector-config.yaml
curl -fsSLO https://oneuptime.com/install/storage-array-agent/otel-collector-config.flasharray-exporter.yaml
curl -fsSLO https://oneuptime.com/install/storage-array-agent/otel-collector-config.flashblade.yaml
```

Crea un archivo `.env` junto a ellos. Contiene el token de API, así que mantenlo privado con `chmod 600 .env`. Para una FlashArray que sirve métricas nativas:

```bash title=".env"
ONEUPTIME_URL=YOUR_ONEUPTIME_URL
ONEUPTIME_TELEMETRY_INGESTION_KEY=YOUR_TELEMETRY_INGESTION_TOKEN
STORAGE_ARRAY_NAME=my-storage-array
STORAGE_SYSTEM=purestorage.flasharray
STORAGE_ARRAY_COLLECTOR_CONFIG=otel-collector-config.yaml
COMPOSE_PROFILES=
PURE_FA_ENDPOINT=fa-prod-01.example.com
PURE_FA_API_TOKEN=YOUR_READ_ONLY_API_TOKEN
PURE_FB_ENDPOINT=
PURE_FB_API_TOKEN=
POWERSCALE_ENDPOINT=
POWERSCALE_SNMP_COMMUNITY=
STORAGE_ARRAY_INSECURE_SKIP_VERIFY=true
POWERSTORE_ENDPOINT=
POWERSTORE_PASSWORD=
POWERSTORE_USERNAME=
POWERSTORE_BULK_METRICS=
POWERSTORE_API_VERSION=
POWERSTORE_REQUEST_LIMIT=
POWERSTORE_SYSLOG_PORT=
```

Para un Dell PowerStore, descargue también `otel-collector-config.powerstore.yaml`, `powerstore-exporter.Dockerfile` y `powerstore-syslog.yaml`, establezca `STORAGE_SYSTEM=dell.powerstore`, `STORAGE_ARRAY_COLLECTOR_CONFIG=otel-collector-config.powerstore.yaml` y `COMPOSE_PROFILES=powerstore`, y rellene `POWERSTORE_ENDPOINT`, `POWERSTORE_USERNAME` y `POWERSTORE_PASSWORD`, la contraseña entre comillas simples.

Para una FlashArray con un Purity//FA anterior, establece `STORAGE_ARRAY_COLLECTOR_CONFIG=otel-collector-config.flasharray-exporter.yaml` y `COMPOSE_PROFILES=flasharray-exporter`. Para una FlashBlade, establece `STORAGE_SYSTEM=purestorage.flashblade`, `STORAGE_ARRAY_COLLECTOR_CONFIG=otel-collector-config.flashblade.yaml` y `COMPOSE_PROFILES=flashblade`, y rellena `PURE_FB_ENDPOINT` y `PURE_FB_API_TOKEN` en lugar del par `PURE_FA_*`.

Para un clúster NetApp ONTAP o Amazon FSx for NetApp ONTAP, descarga también la configuración de ONTAP y los cuatro archivos de Harvest:

```bash
curl -fsSLO https://oneuptime.com/install/storage-array-agent/otel-collector-config.netapp-ontap.yaml
curl -fsSLO https://oneuptime.com/install/storage-array-agent/netapp-harvest.yml
curl -fsSLO https://oneuptime.com/install/storage-array-agent/netapp-harvest-rest.yaml
curl -fsSLO https://oneuptime.com/install/storage-array-agent/netapp-harvest-keyperf.yaml
curl -fsSLO https://oneuptime.com/install/storage-array-agent/netapp-harvest-restperf.yaml
```

y usa este `.env`. Mantén la contraseña entre comillas simples, como aquí: así Docker Compose la lee exactamente tal como está escrita, contenga lo que contenga. Una contraseña que contiene una `'` va entre comillas dobles, con `\"`, `\\` y `$$` para una `"`, una `\` y un `$`:

```bash title=".env"
ONEUPTIME_URL=YOUR_ONEUPTIME_URL
ONEUPTIME_TELEMETRY_INGESTION_KEY=YOUR_TELEMETRY_INGESTION_TOKEN
STORAGE_ARRAY_NAME=ontap-prod-01
STORAGE_SYSTEM=netapp.ontap
STORAGE_ARRAY_COLLECTOR_CONFIG=otel-collector-config.netapp-ontap.yaml
COMPOSE_PROFILES=netapp-ontap
NETAPP_ONTAP_ENDPOINT=ontap-prod-01.example.com
NETAPP_ONTAP_USERNAME=oneuptime
NETAPP_ONTAP_PASSWORD='YOUR_READ_ONLY_USER_PASSWORD'
STORAGE_ARRAY_INSECURE_SKIP_VERIFY=true
```

Inicia el agente:

```bash
docker compose up -d
```
:::

### Comprueba que el agente se está ejecutando

```bash
docker compose ps
docker logs -f oneuptime-storage-array-agent
```

`docker compose ps` muestra el colector (`oneuptime-storage-array-agent`) y, con una configuración con exportador, el exportador (`pure-fa-exporter`, `pure-fb-exporter` o `netapp-harvest`). Los logs del colector deberían mostrar esta línea una vez iniciado:

```text
Everything is ready. Begin running and processing data.
```

### Encontrar la cabina en OneUptime

Abre **Productos → Infraestructura → Cabinas de almacenamiento → Todas las cabinas de almacenamiento**. Tras la primera recopilación (un minuto aproximadamente), la cabina está ahí con su capacidad, rendimiento, alertas abiertas y hardware. Los volúmenes, hosts y pods llegan en menos de 2 minutos, los sistemas de archivos y buckets de una FlashBlade en menos de 5, y los directorios de FlashArray en menos de 30. Un clúster ONTAP aparece en cuanto Harvest lo ha leído, y todo su inventario en unos 3 minutos, el intervalo con el que Harvest consulta su configuración. La página **Topología** de la cabina dibuja sus hosts, volúmenes, sistemas de archivos y hardware en un solo mapa: consulte [Topología](/docs/telemetry/topology#abrir-el-mapa-propio-de-un-recurso).
:::

## Dell PowerStore

El agente lee un clúster PowerStore a través del PowerStore Metrics Exporter de Dell, versión `powerstore-metrics-exporter_v1.0.3`. Dell lo publica como binario, no como imagen, así que el servicio `powerstore-exporter` construye en su primer arranque la imagen que documenta Dell a partir de `powerstore-exporter.Dockerfile`, comprobando el SHA-256 del binario; esa construcción necesita `quay.io` y `github.com` una vez.

El exportador de Dell inicia sesión con un nombre de usuario y una contraseña, ya que PowerStore no tiene tokens de API. En PowerStore Manager, añada en _Settings → Users_ un usuario local solo para el agente, con el rol **Storage Operator**: el exportador lee el rendimiento del archivo de métricas masivas de cinco minutos de PowerStore, que activa él mismo y que exigen PowerStoreOS 4.1 y posteriores, y el README de Dell dice que el rol Operator no puede activarlo. En un PowerStoreOS más antiguo, basta el rol de solo lectura **Operator** con `POWERSTORE_BULK_METRICS=false`. Solo el exportador lee la contraseña, desde `.env`.

El exportador de Dell no lee alertas, así que el clúster envía las suyas: el servicio `powerstore-syslog` recibe su syslog remoto en el puerto 5514, por TCP y UDP, y archiva cada línea en la página **Registros** de la cabina con el registro de PowerStore en atributos (`powerstore.alert.id`, `powerstore.alert.state`, `powerstore.event.code`) y una gravedad tomada de los códigos de evento de Dell (`powerstore.alert.severity`). En PowerStore Manager, abra _Settings → Security → Remote Logging_, añada esta máquina en el puerto 5514 y abra el puerto en su cortafuegos. El syslog sobre TLS en el puerto 6514 se describe en `powerstore-syslog.yaml`.

El exportador de Dell no informa de hosts ni de sesiones de replicación, así que esta versión no los tiene.

## Variables de entorno

El script de instalación las escribe en `/opt/oneuptime-storage-array-agent/.env`; una instalación con Docker Compose las lee del `.env` que está junto a `docker-compose.yml`. Después de cambiar una, ejecuta `docker compose up -d` en esa carpeta.

| Variable | Obligatoria | Descripción |
| --- | --- | --- |
| `ONEUPTIME_URL` | Sí | Tu URL de OneUptime, como `https://oneuptime.com` o tu instancia autoalojada. Usa `http://` y su puerto si la instancia solo admite HTTP. |
| `ONEUPTIME_TELEMETRY_INGESTION_KEY` | Sí | La clave de ingesta de **Ajustes del proyecto → Telemetría y APM → Claves de ingesta**. |
| `STORAGE_ARRAY_NAME` | Sí | El nombre con el que la cabina se registra en OneUptime, marcado en cada métrica como el atributo de recurso `storage.array.name`. Mantenlo estable: cambiarlo más tarde registra una segunda cabina. El colector se niega a iniciarse sin él. |
| `STORAGE_SYSTEM` | No | La plataforma, marcada como el atributo de recurso `storage.system`: `purestorage.flasharray`, `purestorage.flashblade` o `netapp.ontap`. Su valor predeterminado es `purestorage.flasharray`. |
| `STORAGE_ARRAY_COLLECTOR_CONFIG` | No | Qué configuración incluida del colector se ejecuta: `otel-collector-config.yaml` (FlashArray, nativa: la predeterminada), `otel-collector-config.flasharray-exporter.yaml` (FlashArray anterior), `otel-collector-config.flashblade.yaml` (FlashBlade) o `otel-collector-config.netapp-ontap.yaml` (ONTAP). |
| `COMPOSE_PROFILES` | No | Inicia el exportador que recopila la configuración elegida: vacío para la configuración nativa de FlashArray, `flasharray-exporter`, `flashblade` o `netapp-ontap` para las demás. |
| `PURE_FA_ENDPOINT` | FlashArray | La dirección de administración de la FlashArray: un nombre de host o una IP, sin `https://`. |
| `PURE_FA_API_TOKEN` | FlashArray | El token de API del usuario de FlashArray con el rol readonly. |
| `PURE_FB_ENDPOINT` | FlashBlade | La dirección de administración de la FlashBlade: un nombre de host o una IP, sin `https://`. |
| `PURE_FB_API_TOKEN` | FlashBlade | El token de API del usuario de FlashBlade con el rol readonly. |
| `POWERSTORE_ENDPOINT` | PowerStore | La dirección de gestión del clúster PowerStore: un nombre de host o una IP, sin `https://`. |
| `POWERSTORE_USERNAME` | PowerStore | El usuario de PowerStore con el que inicia sesión el exportador de Dell. |
| `POWERSTORE_PASSWORD` | PowerStore | La contraseña de ese usuario. Solo el exportador la lee. |
| `POWERSTORE_BULK_METRICS` | No | `true` lee el rendimiento del archivo de métricas masivas de PowerStore; `false` lee cada objeto uno por uno. Por defecto, `true`. |
| `POWERSTORE_API_VERSION` | No | `v3` para PowerStoreOS 3.6 y posteriores, o `v1`. Por defecto, `v3`. |
| `POWERSTORE_REQUEST_LIMIT` | No | Cuántas solicitudes envía el exportador al clúster a la vez. Por defecto, `16`. |
| `POWERSTORE_SYSLOG_PORT` | No | El puerto en el que esta máquina recibe el syslog del clúster, por TCP y UDP. Por defecto, `5514`. |
| `NETAPP_ONTAP_ENDPOINT` | ONTAP | La dirección de administración del clúster (en FSx, el endpoint de administración del sistema de archivos): un nombre de host o una IP, sin `https://`. |
| `NETAPP_ONTAP_USERNAME` | ONTAP | El usuario REST de solo lectura, como `oneuptime`. |
| `NETAPP_ONTAP_PASSWORD` | ONTAP | Su contraseña. Solo Harvest la lee, exactamente tal como está escrita. |
| `POWERSCALE_NODES` | PowerScale | Las direcciones de todos los nodos, separadas por comas, nunca el nombre de la zona SmartConnect. El script de instalación escribe a partir de ellas las consultas de abajo. |
| `POWERSCALE_ENDPOINT` | PowerScale | El nodo a través del cual se leen la salud, la capacidad y las cuotas del propio clúster: el primero de `POWERSCALE_NODES`. |
| `POWERSCALE_SNMP_RECEIVERS` | PowerScale | Las consultas que ejecuta el colector: `snmp/cluster`, `snmp/quotas` y luego `snmp/node-1` y siguientes, una por nodo. |
| `POWERSCALE_NODE_<n>` | PowerScale | La dirección del nodo `<n>`, de `1` a `252`. Una dirección IPv6 va entre corchetes, como `[fd00::11]`. |
| `POWERSCALE_SNMP_VERSION` | No | `v2c` o `v3`. Su valor predeterminado es `v2c`. |
| `POWERSCALE_SNMP_COMMUNITY` | SNMP v2c | La comunidad de solo lectura del clúster. |
| `POWERSCALE_SNMP_USER` | SNMPv3 | El usuario SNMPv3 de solo lectura del clúster. |
| `POWERSCALE_SNMP_SECURITY_LEVEL` | No | `auth_priv`, `auth_no_priv` o `no_auth_no_priv`. Su valor predeterminado es `auth_priv`. |
| `POWERSCALE_SNMP_AUTH_PROTOCOL` | No | `MD5`, `SHA`, `SHA224`, `SHA256`, `SHA384` o `SHA512`, tal como lo muestra `isi snmp settings view`. Su valor predeterminado es `SHA`. |
| `POWERSCALE_SNMP_AUTH_PASSWORD` | SNMPv3 | La contraseña de autenticación del usuario SNMPv3. |
| `POWERSCALE_SNMP_PRIVACY_PROTOCOL` | No | `DES`, `AES`, `AES192`, `AES256`, `AES192C` o `AES256C`. Su valor predeterminado es `AES`. |
| `POWERSCALE_SNMP_PRIVACY_PASSWORD` | SNMPv3 | La contraseña de privacidad del usuario SNMPv3, en el nivel `auth_priv`. |
| `STORAGE_ARRAY_INSECURE_SKIP_VERIFY` | No | `true` acepta el certificado autofirmado de la cabina en el endpoint nativo y en Harvest; `false` lo verifica. Su valor predeterminado es `true`. Los exportadores de Pure nunca verifican el certificado de la cabina, así que no se aplica a ellos. |

## Cómo recopila el agente

- **Un job de recopilación por endpoint, cada uno leído con la frecuencia que merece.** FlashArray: `/metrics/array` cada 60 segundos; `/metrics/volumes`, `/metrics/hosts` y `/metrics/pods` cada 2 minutos; `/metrics/directories` cada 30 minutos, que es lo que recomienda la propia Pure, ya que a la cabina le cuesta calcular el espacio de los directorios. FlashBlade: `/metrics/array` cada 60 segundos; `/metrics/filesystems` y `/metrics/objectstore` cada 5 minutos, de nuevo siguiendo el consejo de Pure de leer los endpoints de sistemas de archivos y del almacén de objetos con menos frecuencia que la cabina.
- **Cada job etiqueta sus series con `scrape_endpoint: <endpoint>`.** Cada endpoint también exporta `purefa_info` o `purefb_info`, así que OneUptime sabe de qué familias un lote es la lista completa: así es como un volumen, host, pod, sistema de archivos o bucket eliminado sale del inventario en lugar de quedarse. Mantén las etiquetas tal como vienen.
- **La latencia por volumen y por host conserva tres dimensiones.** Cada volumen y cada host exporta su latencia en hasta dieciséis `dimension`s. Una regla `metric_relabel_configs` conserva `usec_per_read_op`, `usec_per_write_op` y `usec_per_mirrored_write_op` y descarta el desglose por límite de tasa de QoS, cola, SAN y tiempo de servicio, que multiplica las series de una cabina grande. El desglose de toda la cabina en `purefa_array_performance_latency_usec` se conserva. Elimina la regla para conservar también el desglose por volumen.
- **El token de API es un token Bearer.** La configuración nativa lo envía a la propia cabina; las configuraciones con exportador lo envían al exportador solo por la red de Compose, y los puertos de los exportadores nunca se publican.
- **Un PowerStore cada 5 minutos.** El exportador de Dell sirve cada parte del clúster en `/metrics/<cluster>/<part>`: la configuración lee `cluster` cada 60 segundos, su latido, y `appliance`, `capacity`, `hardware`, `port`, `volume`, `volumeGroup`, `nas` y `file` cada 5 minutos, porque PowerStore los calcula en muestras de cinco minutos.
- **Sin `send_batch_max_size`.** OneUptime reconstruye el inventario a partir de una recopilación entera por solicitud, así que el procesador `batch` incluido nunca reparte una recopilación entre varias exportaciones. Mantén los ajustes de batch tal como vienen.
- **ONTAP: Harvest consulta el clúster y el colector recopila de Harvest.** Harvest lee la configuración y el estado del clúster cada 3 minutos, su rendimiento cada minuto (latencias en microsegundos por operación, operaciones y bytes por segundo) y sus eventos EMS cada 3 minutos, y sirve lo más reciente de todo en `netapp-harvest:12990`, que el colector recopila cada 60 segundos con la etiqueta `scrape_endpoint: harvest`. Los tres archivos `netapp-harvest-*.yaml` limitan Harvest a lo que lee OneUptime. Las propias series `netapp_metadata_*` de Harvest indican qué objetos ha listado completos, así que un volumen eliminado sale del inventario, mientras que un objeto que Harvest no pudo leer conserva su último recuento. El colector descarta las mediciones que Harvest hace de sí mismo y las series de rendimiento por disco, y convierte la programación de cada relación de SnapMirror en `netapp_snapmirror_schedule_seconds` (una programación horaria es 3600), con la que SnapMirror Behind Schedule compara el retraso.

## Qué recopila el agente

Las convenciones semánticas de Pure son comunes al endpoint nativo de FlashArray y a ambos exportadores; las de ONTAP son las de Harvest, descritas después de la tabla. Cada valor es un gauge que calcula la propia cabina (latencias en microsegundos por operación, rendimiento por segundo), así que no hay que calcular tasas, y los objetos se nombran mediante **etiquetas de punto de datos**: `name` para volúmenes, pods, directorios, sistemas de archivos y buckets, `host` para hosts, `component_name` para el hardware de FlashArray. El agente añade los atributos de recurso `storage.array.name` y `storage.system`, así que OneUptime archiva todo bajo tu cabina:

| Endpoint | Familias de métricas | Lo que OneUptime construye con ellas |
| --- | --- | --- |
| FlashArray `/metrics/array` | `purefa_info`, `purefa_alerts_open`, `purefa_array_space_*`, `purefa_array_performance_*`, `purefa_hw_component_status`, `purefa_hw_component_temperature_celsius`, `purefa_hw_controller_info`, `purefa_drive_capacity_bytes`, `purefa_network_interface_*` | El nombre, la versión de Purity y el ID de sistema de la cabina; capacidad, espacio usado y reducción de datos; número de alertas abiertas; el estado de la cabina; la página **Hardware** (componentes, discos, controladoras, interfaces de red) |
| FlashArray `/metrics/volumes` | `purefa_volume_performance_*`, `purefa_volume_space_*`, `purefa_volume_qos_*` | La página **Volúmenes**: tamaño aprovisionado y físico, reducción de datos, latencia de lectura y escritura, IOPS y ancho de banda por volumen |
| FlashArray `/metrics/hosts` | `purefa_host_connectivity_info`, `purefa_host_connections_info`, `purefa_host_performance_*`, `purefa_host_space_*` | La página **Hosts**: conectividad (rutas redundantes o no), volúmenes conectados, latencia, IOPS y ancho de banda por host |
| FlashArray `/metrics/pods` | `purefa_pod_performance_*`, `purefa_pod_space_*`, `purefa_pod_replica_links_*`, `purefa_pod_mediator_status` | La página **Replicación**: pods de ActiveCluster y ActiveDR, estado y retraso de los enlaces de réplica |
| FlashArray `/metrics/directories` | `purefa_directory_performance_*`, `purefa_directory_space_*` | La página **Directorios** (FlashArray File Services) |
| FlashBlade `/metrics/array` | `purefb_info`, `purefb_alerts_open`, `purefb_array_space_*`, `purefb_array_performance_*`, `purefb_hardware_health` | El nombre, la versión de Purity y el ID de sistema de la FlashBlade; capacidad y reducción de datos; número de alertas abiertas; el estado de la cabina; la página **Hardware** |
| FlashBlade `/metrics/filesystems` | `purefb_file_systems_space_*`, `purefb_file_systems_performance_*` | La página **Sistemas de archivos**: espacio aprovisionado y usado, reducción de datos, latencia, IOPS y ancho de banda por sistema de archivos |
| FlashBlade `/metrics/objectstore` | `purefb_buckets_space_*`, `purefb_buckets_quota_space_bytes`, `purefb_buckets_object_count`, `purefb_buckets_performance_*`, `purefb_object_store_accounts_*` | La página **Buckets**: espacio, cuota, número de objetos y rendimiento por bucket, agrupados por cuenta |
| PowerStore `cluster`, `appliance`, `capacity` | `powerstore_cluster`, `powerstore_metro_*`, `powerstore_appliance`, `powerstore_perf_*`, `powerstore_cap_*` | El nombre y el estado del clúster; la página **Appliances**: capacidad, reducción de datos, latencia, IOPS y ancho de banda de cada appliance |
| PowerStore `hardware`, `port` | `powerstore_hardware_*`, `powerstore_wear_metrics_by_drive`, `powerstore_fc_port_*`, `powerstore_eth_port_*`, `powerstore_metricFcPort_*`, `powerstore_metricEthPort_*` | La página **Hardware**: nodos, ventiladores, fuentes de alimentación, baterías, unidades y puertos front-end, cada uno con su appliance |
| PowerStore `volume`, `volumeGroup`, `nas`, `file` | `powerstore_volume_*`, `powerstore_metricVolume_*`, `powerstore_volumegroup_*`, `powerstore_metricVg_*`, `powerstore_nas_server_operational_status`, `powerstore_metricNas_*`, `powerstore_filesystem_*`, `powerstore_metricFilesystem_*` | Las páginas **Volúmenes**, **Grupos de volúmenes**, **Servidores NAS** y **Sistemas de archivos** |
| ONTAP, a través de Harvest | `netapp_cluster_*`, `netapp_node_*`, `netapp_aggr_*`, `netapp_svm_*`, `netapp_volume_*`, `netapp_lun_*`, `netapp_snapmirror_*` | El nombre, la versión y el UUID del clúster; su capacidad (la suma de la de sus agregados de datos) y su reducción de datos; la página **Volúmenes**; las páginas **Agregados**, **SVM**, **LUN** y **SnapMirror**, con una página por objeto |
| Hardware de ONTAP, a través de Harvest | `netapp_disk_*`, `netapp_shelf_*`, `netapp_environment_sensor_*`, `netapp_net_port_*`, `netapp_nic_*`, `netapp_fcp_*` | La página **Hardware**: nodos, discos, bandejas, sus fuentes de alimentación, ventiladores, módulos y sensores, los sensores de los nodos, y los puertos Ethernet y Fibre Channel |
| Problemas abiertos y eventos de ONTAP | `netapp_health_*`, `netapp_ems_events` | El número de alertas abiertas y la tarjeta **Alertas activas** (discos rotos, fallos de bandejas, toma de control de HA, puertos caídos, alertas de salud del sistema), y las plantillas de EMS |
| PowerScale `snmp/cluster` | `powerscale_cluster_*`, `powerscale_ifs_*` | El nombre, la versión de OneFS, la salud y los recuentos de nodos del clúster; la capacidad de `/ifs`; el rendimiento, la red y la CPU de todo el clúster |
| PowerScale `snmp/quotas` | `powerscale_quota_*` | La página **Cuotas**: el uso de cada cuota, sus límites y lo cerca que está de ellos |
| PowerScale `snmp/node-<n>` | `powerscale_node_*`, `powerscale_protocol_*`, `powerscale_drive_*`, `powerscale_fan_*`, `powerscale_temperature_*`, `powerscale_power_sensor_*`, `powerscale_interface_*`, `powerscale_chassis_*` | La página **Nodos**: la salud, la CPU y el rendimiento de cada nodo, también por protocolo; la página **Hardware**: sus discos, sensores y puertos |

En ONTAP todas las series son de Harvest: un objeto se nombra por sus etiquetas (`volume` dentro de su `svm`, `aggr`, `lun`, `node`, `disk`, `shelf`, `destination_location` para una relación de SnapMirror), un estado es un `netapp_*_new_status` de 1 o 0 o una serie `netapp_*_labels` cuyas etiquetas lo indican, y cada problema abierto es una serie `netapp_health_*_alerts` que existe mientras dura.

La columna **Salud** de **Todas las cabinas de almacenamiento** lee las alertas y el hardware de la propia cabina en sus datos más recientes: **Crítico** mientras informa de una alerta crítica abierta, o de un componente de hardware, disco o controladora en estado crítico, averiado, ausente o no saludable; **Advertencia** mientras informa de una alerta de advertencia abierta, o de un componente degradado o desconocido; **OK** en caso contrario; y **Desconocido** mientras el agente está desconectado. La **Vista general** de la cabina juzga más, como dice la sección siguiente. En los criterios de un monitor, los atributos de la cabina llevan un prefijo `resource.` (`resource.storage.array.name`, `resource.storage.system`), mientras que las etiquetas de punto de datos van sin prefijo (`name`, `host`, `dimension`, `space`).

La salud de un PowerStore es la de su hardware, ya que sus alertas llegan como registros. El agente calcula por sí mismo `powerstore_cap_physical_used_percent` y `powerstore_filesystem_logical_used_percent`, y lee el estado de un nodo como 1 mientras está Healthy.

## Lo que muestran las páginas de la cabina

La **Vista general** de la cabina indica su salud, **En buen estado**, **Degradado** o **Con problemas**, según lo que necesita atención, y lo enumera en **Requiere atención**, lo más urgente primero, cada elemento a un paso de donde mirar:

- **La propia cabina.** Una alerta abierta que la cabina generó con severidad crítica es crítica, y una con severidad de advertencia necesita un vistazo. Por encima del 80 % de su capacidad utilizable necesita un vistazo, y por encima del 90 % es crítica, donde se disparan las alertas Capacity Above 80% y Capacity Above 90%. Un FlashArray cuya latencia media de lectura o escritura supera 5 ms, o un FlashBlade cuyas lecturas tardan más de 10 ms, necesita un vistazo.
- **Hardware.** Un componente, disco, controladora o interfaz de red que la cabina informa como crítico, averiado, ausente o no saludable es crítico: su redundancia ha desaparecido hasta que se sustituya la pieza. Uno que informa como degradado, desconocido, no reconocido o no listo necesita un vistazo. Las piezas no instaladas, apagadas o sin usar nunca se enumeran.
- **Hosts.** Un host que ya no llega a la cabina por ambas controladoras necesita un vistazo, con el motivo: por una sola controladora, por rutas desiguales o sin ninguna ruta.
- **Pods.** Un pod cuyo enlace de réplica la cabina informa como no saludable es crítico, y uno con más de un minuto de retraso necesita un vistazo.
- **Sistemas de archivos.** Un sistema de archivos de FlashBlade al que le queda menos del 10 % de su tamaño aprovisionado necesita un vistazo.
- **Los objetos propios de un clúster ONTAP.** Un volumen, un agregado o una LUN que ONTAP informa sin conexión, un disco roto, un componente de bandeja con error, un sensor de nodo que ha rebasado su umbral crítico y un puerto caído son críticos; una SVM detenida, un nodo con un ventilador o una fuente de alimentación averiados y un sensor que ha rebasado su umbral de advertencia necesitan un vistazo, con las propias palabras de ONTAP para el motivo. Una relación de SnapMirror que ONTAP informa con problemas es crítica, y una cuyo retraso supera una vez y media el intervalo de su programación necesita un vistazo.

Las listas **Hosts**, **Replicación** y **Sistemas de archivos** indican el estado de cada parte con las mismas reglas, con el motivo debajo, y también las listas **Volúmenes**, **Agregados**, **SVM**, **LUN** y **SnapMirror** de un clúster ONTAP, en las que cada fila abre una página propia: su estado, lo que necesita atención, lo que está abierto en ella, las alertas del clúster que la vigilan, lo que ONTAP informa sobre ella y sus gráficos. Las páginas de cada plataforma hablan con sus propias palabras: un volumen de ONTAP indica su SVM, su agregado y lo lleno que está, y su página muestra en gráficos las series de ONTAP. En Amazon FSx for NetApp ONTAP, la página **Hardware** muestra los nodos y los puertos e indica por qué no hay discos ni bandejas. La página de un host y la de un sistema de archivos dicen qué necesita atención y qué alertas de la cabina lo vigilan, con un paso para activar el resto, y la página de cada parte, también la de un volumen y la de un bucket, dice qué está abierto en ella. Mientras el agente está desconectado, la salud muestra **Salud desconocida**: el último informe de la cabina ya no es la verdad. Cada umbral de arriba es aquel en el que se dispara su plantilla de alerta, como enumera el [monitor de cabinas de almacenamiento](/docs/monitor/storage-array-monitor).

En un PowerStore, las pestañas **Appliances**, **Grupos de volúmenes** y **Servidores NAS** listan las partes que solo tiene un PowerStore, y la página **Hardware** nombra el appliance de cada parte, porque cada appliance nombra sus partes de la misma manera.

## Opcional — Enviar el syslog de la cabina

El recolector syslog de un PowerStore funciona tal como se entrega (consulte [Dell PowerStore](#dell-powerstore)): esta sección es para las cabinas de Pure.

Por defecto el agente solo envía métricas, así que la página **Registros** de la cabina queda vacía. Las cabinas reenvían sus alertas y eventos de auditoría como syslog, y cada configuración incluida del colector tiene un par de receptores `syslog` comentados (TCP y UDP en el puerto 5514, RFC 3164), conectados a un pipeline `logs` comentado que marca `storage.array.name` para que los logs lleguen a tu cabina.

:::steps
### Activar los receptores

Descomenta los dos receptores `syslog/*` y el pipeline `logs` en la configuración del colector que uses. Las marcas de tiempo de RFC 3164 no llevan zona horaria: establece `location` en la zona horaria de la cabina, salvo que su reloj vaya en UTC.

### Abrir el puerto

Descomenta el bloque `ports:` en `docker-compose.yml` para que la máquina publique `5514/tcp` y `5514/udp`, y luego ejecuta `docker compose up -d`. Abre el puerto en el cortafuegos de la máquina para la red de administración de la cabina.

### Apuntar la cabina al agente

Hazlo como administrador, no como el usuario de monitorización de solo lectura. En una FlashArray, abre _Settings → System → Syslog Servers_, añade `udp://<agent-host>:5514` (o `tcp://<agent-host>:5514`) y envía un mensaje de prueba. En una FlashBlade, añade un servidor de syslog con la misma URI en su configuración de syslog. Ambas cabinas aceptan la forma `PROTOCOL://HOST:PORT`, también a través de sus API REST (`syslog-servers`).
:::

Un receptor de syslog escucha en un solo transporte, por eso TCP y UDP son dos receptores: deja uno comentado si solo necesitas el otro. La imagen estándar del colector lee el syslog tal cual: no hace falta ninguna imagen personalizada.

## Etiquetar la cabina con etiquetas del proyecto

Un atributo de recurso que empieza por `oneuptime.label.` se convierte en una etiqueta del proyecto en la cabina de almacenamiento: `oneuptime.label.<dimension>=<value>` es la etiqueta `<dimension>:<value>`. Añade los atributos al procesador `resource` de la configuración del colector que uses, junto a `storage.array.name`:

```yaml
processors:
  resource:
    attributes:
      # ...existing attributes...
      - key: oneuptime.label.team
        value: storage
        action: upsert
      - key: oneuptime.label.env
        value: production
        action: upsert
```

El colector lee su configuración solo al iniciarse: ejecuta `docker compose restart oneuptime-storage-array-agent`. La cabina muestra entonces las etiquetas `team:storage` y `env:production`. Las etiquetas se comparan sin distinguir mayúsculas de minúsculas, así que una etiqueta `Production` existente se reutiliza en lugar de duplicarse, y el agente nunca quita una etiqueta que alguien añadió en OneUptime.

## Supervisar varias cabinas

Un agente lee una cabina. Para supervisar varias desde la misma máquina, instala cada una en su propia carpeta con su propio `.env`, como `INSTALL_DIR=/opt/oneuptime-storage-array-agent-fa02 bash install.sh`, y dale a cada una su propio `container_name` en su `docker-compose.yml` (como `oneuptime-storage-array-agent-fa02`): dos contenedores no pueden compartir nombre. Pasa la carpeta al script de diagnóstico con `-d`.

Un segundo agente de PowerStore también necesita su propio puerto syslog: establezca `POWERSTORE_SYSLOG_PORT`, por ejemplo `5515`, en su `.env`.

## Ejecutar como servicio de systemd

Para iniciar el agente con la máquina y reiniciarlo cuando falle, instala su unidad de systemd. Supone que el agente está en `/opt/oneuptime-storage-array-agent`, donde lo pone el script de instalación:

```bash
sudo curl -fsSL https://oneuptime.com/install/storage-array-agent/systemd/oneuptime-storage-array-agent.service -o /etc/systemd/system/oneuptime-storage-array-agent.service
sudo systemctl daemon-reload
sudo systemctl enable --now oneuptime-storage-array-agent
```

## Actualizar el agente

El agente informa como su **Versión del agente** de la versión del colector que fijan sus archivos. Cuando es más antigua que la versión que fija esta versión de OneUptime, aparece una señal de advertencia a su lado en la página **Vista general** de la cabina. Selecciónala para ver estos comandos. Un agente instalado antes de que sus archivos informaran una versión no muestra ninguna hasta que se actualiza de esta forma.

La imagen del colector está fijada en `docker-compose.yml` y sus configuraciones son archivos junto a él, así que descargar las imágenes no basta para que el agente avance. Vuelve a ejecutar `install.sh`: reutiliza todos los valores de tu `.env` existente (no se vuelve a preguntar nada), renueva `docker-compose.yml`, todas las configuraciones del colector y los archivos de Harvest (un archivo que editaste se conserva como `<file>.bak.<timestamp>`) y vuelve a crear el agente para que el colector lea su nueva configuración. Un agente instalado fuera de `/opt/oneuptime-storage-array-agent` necesita su carpeta: `INSTALL_DIR=<folder> bash install.sh`.

```bash
curl -fsSL https://oneuptime.com/install/storage-array-agent -o install.sh
bash install.sh
```

¿Lo instalaste con Docker Compose? En la carpeta del agente, vuelve a descargar el archivo de Compose y las configuraciones del colector (en ONTAP, también la configuración de ONTAP y los cuatro archivos de Harvest, y vuelve a hacer cualquier cambio que les hicieras), luego descarga las imágenes y vuelve a crear el agente:

```bash
curl -fsSLO https://oneuptime.com/install/storage-array-agent/docker-compose.yml
curl -fsSLO https://oneuptime.com/install/storage-array-agent/otel-collector-config.yaml
curl -fsSLO https://oneuptime.com/install/storage-array-agent/otel-collector-config.flasharray-exporter.yaml
curl -fsSLO https://oneuptime.com/install/storage-array-agent/otel-collector-config.flashblade.yaml
curl -fsSLO https://oneuptime.com/install/storage-array-agent/otel-collector-config.powerscale.yaml
docker compose pull
docker compose up -d --force-recreate
```

Un agente de PowerStore también vuelve a descargar `otel-collector-config.powerstore.yaml`, `powerstore-exporter.Dockerfile` y `powerstore-syslog.yaml`; `docker compose up` vuelve a construir la imagen del exportador cuando una nueva versión mueve su etiqueta.

## Desinstalar el agente

```bash
cd /opt/oneuptime-storage-array-agent
docker compose down
```

Después elimina el usuario de solo lectura y su token de API en la cabina si ya no los necesitas. En ONTAP, ejecuta `security login delete -user-or-group-name oneuptime -application http -authentication-method password` y después `security login rest-role delete -role oneuptime-readonly -api /api`.

En un PowerStore, ejecute `docker compose --profile powerstore down`, para que también se detengan el exportador y el recolector syslog.

## Dell PowerMax

Un Dell PowerMax no necesita agente. Una sonda de OneUptime inicia sesión en la REST API de Unisphere for PowerMax con una cuenta de solo lectura cada 5 minutos y lee cada cabina que gestiona ese Unisphere. Cada cabina aparece en **Cabinas de almacenamiento** con su Symmetrix ID, como `000220200269`, y puedes cambiarle el nombre. La contraseña se guarda cifrada, nunca se vuelve a mostrar y solo se envía a la sonda que elijas.

- **Unisphere for PowerMax 10.1 o posterior**, que gestione cabinas con PowerMaxOS 10 o 5978. A partir de Unisphere 10.3, una cuenta de solo lectura también ve los puertos y los grupos SRDF.
- **Una sonda que llegue a Unisphere por TCP 8443**, normalmente una [sonda personalizada](/docs/probe/custom-probe) en la red de Unisphere. En OneUptime Cloud, una sonda compartida nunca recibe una contraseña de almacenamiento, así que elige una propia de tu proyecto.
- **Un usuario de Unisphere con el rol Monitor** en cada cabina que deba leer, y el rol **PerfMonitor** para el rendimiento. No necesita nada más: OneUptime nunca modifica la cabina.

:::steps
### Crear el usuario de solo lectura

En Unisphere for PowerMax, en **Settings → Users and Groups**, crea un usuario local o elige un usuario de directorio. Autorízalo con el rol **Monitor** en cada cabina, y con **PerfMonitor** para el rendimiento.

### Comprobar que Unisphere recopila el rendimiento

En **Settings → Performance → System Registrations**, comprueba que la recopilación **Diagnostic** está activada para cada cabina: sin ella, OneUptime muestra el inventario y las alertas de la cabina, pero no grafica ningún rendimiento. Para ver un grupo de almacenamiento cada 5 segundos, regístralo también ahí para **Real Time**, hasta 100 por cabina.

### Conectar Unisphere

Ve a **Productos → Infraestructura → Cabinas de almacenamiento → Conexiones** y haz clic en **Conectar Unisphere**. Introduce la dirección en la que abres Unisphere, como `https://unisphere.example.com:8443`, el nombre de usuario y la contraseña, y elige la sonda.

### Probar la conexión

**Probar conexión** hace que la sonda inicie sesión y lea lo que la cuenta puede ver: cada cabina, sus grupos de almacenamiento y volúmenes, y si Unisphere recopila su rendimiento. De forma predeterminada, Unisphere firma su propio certificado: la prueba lo muestra, y **Confiar en este certificado** pone su huella SHA-256 en el formulario. Compara primero la huella con la del propio Unisphere, por ejemplo con `openssl s_client -connect unisphere.example.com:8443` desde la máquina de la sonda.

### Ponerle nombre y conectar

Ponle un nombre a la conexión, o conserva el nombre de host, y haz clic en **Conectar**. Su página muestra la primera recopilación en pocos minutos y cada cabina que encontró, cada una enlazada a su página en **Cabinas de almacenamiento**.
:::

La sonda lee los endpoints REST documentados de Unisphere: el clásico `/univmax/restapi` para las cabinas, la capacidad, la salud, las alertas y los pools, y el de consultas masivas `/univmax/rest/v1` para los grupos de almacenamiento, volúmenes, directores, puertos, grupos SRDF y el rendimiento. Cada llamada es una lectura. Envía lo que lee como estas series, con los milisegundos de Unisphere como microsegundos y sus MB por segundo como bytes por segundo:

| Series | Qué contienen |
| --- | --- |
| `powermax_array_*` | La cabina: su modelo y microcódigo, la capacidad utilizable, usada y suscrita, la reducción de datos, las puntuaciones de salud, si Unisphere recopila su rendimiento, y sus cifras de 5 minutos de tiempos de respuesta, IOPS, rendimiento, caché y ocupación |
| `powermax_alert_open` | Una serie por cada alerta que Unisphere tiene abierta para la cabina, de gravedad Minor o superior, hasta que alguien la reconoce o la borra |
| `powermax_storage_group_*` | Cada grupo de almacenamiento: su capacidad y volúmenes, sus tiempos de respuesta, IOPS y rendimiento de 5 minutos, y sus cifras de 5 segundos cuando está registrado para tiempo real |
| `powermax_volume_*` | Cada volumen de un grupo de almacenamiento: su capacidad, y sus cifras cuando su grupo de almacenamiento está registrado para tiempo real |
| `powermax_srp_*` | Cada pool de recursos de almacenamiento: su capacidad y su tiempo de respuesta |
| `powermax_director_*` | Cada director: su rol, su estado y sus cifras de ocupación, y `powermax_director_offline` mientras no está en línea |
| `powermax_port_*` | Cada puerto: su protocolo, velocidad, niveles de luz y cifras de ocupación, y `powermax_port_offline` mientras un puerto del que alguien depende está caído |
| `powermax_srdf_group_*` | Cada grupo SRDF: su cabina remota y sus modos, su retraso y su rendimiento, y `powermax_srdf_group_not_healthy` mientras está suspendido o sin conexión |

- **Cada 5 minutos**, o cada 10 para no sobrecargar un Unisphere ocupado (**Más campos** en el formulario de la conexión): Unisphere calcula el rendimiento cada 5 minutos.
- **Solo las cabinas que gestiona el propio Unisphere.** Las cabinas remotas que ve a través de SRDF aparecen en la página de la conexión, y las lee el Unisphere de su propio sitio: conecta también ese.
- **Hasta 5,000 grupos de almacenamiento y 10,000 volúmenes por cabina**, y 200 alertas nuevas por recopilación (el resto llega en las siguientes). Si una lista se queda corta, la página de la conexión lo indica.
- **Unisphere 10.1 y 10.2** no muestran puertos ni grupos SRDF a una cuenta de solo lectura: la sonda lee los directores uno por uno, toma los grupos SRDF de los grupos de almacenamiento y lo indica.

## Dell PowerScale

El agente lee un clúster Dell PowerScale (Isilon) por SNMP, a partir de la ISILON-MIB de Dell, con el propio receptor SNMP del colector: sin token de API, y no se ejecuta nada junto al colector. Un clúster es una cabina de almacenamiento, y sus nodos, cuotas, discos, sensores y puertos son su inventario.

- **Cada nodo se consulta en su propia dirección.** Un nodo solo responde a SNMP por sus propios discos, sensores y puertos, así que el agente consulta cada nodo por su dirección en la red a la que llega el agente, nunca por el nombre de la zona SmartConnect, que pasa cada consulta al nodo que elija. Un clúster tiene hasta 252 nodos.
- **Los objetos del propio clúster se leen una sola vez, a través del primer nodo:** su salud, capacidad, rendimiento, CPU y recuentos de nodos cada 60 segundos (`snmp/cluster`), y sus SmartQuotas cada 5 minutos (`snmp/quotas`). La salud, la CPU, el rendimiento de los protocolos (NFS, SMB, S3, HDFS y los demás), los discos, los sensores y los puertos de cada nodo se leen desde el propio nodo cada 60 segundos (`snmp/node-<n>`).
- **Las lecturas que OneFS da como texto o en otras unidades** (lecturas de sensores, CPU en décimas de porcentaje, rendimiento en bits) las convierte el colector en números antes de enviarlas, así que cada gráfico y cada plantilla lee un gauge simple.

### Activa SNMP en el clúster

Conéctate por SSH a cualquier nodo como administrador: OneFS aplica la configuración de SNMP a todo el clúster. Si el clúster ya responde a SNMP para otra herramienta, dale al agente la misma comunidad de solo lectura o el mismo usuario SNMPv3 y sáltate este paso. Si no, activa el servicio SNMP y SNMP v2c con una comunidad de solo lectura propia, no la predeterminada de OneFS, `I$ilonpublic`:

```bash
isi snmp settings modify --service yes
isi snmp settings modify --snmp-v1-v2c-access yes -c '<read-only-community>'
```

O activa SNMPv3, que autentica y cifra cada consulta. OneFS tiene un único usuario SNMPv3 de solo lectura, `general` hasta que le cambies el nombre: dale contraseñas de al menos ocho caracteres, sin espacios:

```bash
isi snmp settings modify --service yes
isi snmp settings modify --snmp-v3-access yes -u '<read-only-user>' --snmp-v3-password '<authentication-password>' --snmp-v3-priv-password '<privacy-password>'
```

`isi snmp settings view` muestra la configuración, con los protocolos de autenticación y de privacidad del usuario. Permite UDP 161 desde la máquina del agente hacia cada nodo y lista las direcciones de los nodos con `isi network interfaces list`.

### Instala el agente en un clúster PowerScale

Ejecuta el script de instalación con la configuración de PowerScale:

```bash
curl -fsSL https://oneuptime.com/install/storage-array-agent -o install.sh
STORAGE_ARRAY_COLLECTOR_CONFIG=otel-collector-config.powerscale.yaml bash install.sh
```

El script pide tu URL de OneUptime, la clave de ingesta y un nombre para el clúster, luego las direcciones de todos los nodos, separadas por comas, y la versión de SNMP, y después la comunidad de solo lectura, o el usuario SNMPv3 y sus dos contraseñas, cada una leída sin mostrarse. Un usuario cuyos protocolos no sean SHA y AES necesita `POWERSCALE_SNMP_AUTH_PROTOCOL` y `POWERSCALE_SNMP_PRIVACY_PROTOCOL` delante de `bash install.sh`, y un usuario sin privacidad, `POWERSCALE_SNMP_SECURITY_LEVEL=auth_no_priv`. El script escribe una consulta por nodo en `.env`:

```bash title=".env"
STORAGE_SYSTEM=dell.powerscale
STORAGE_ARRAY_COLLECTOR_CONFIG=otel-collector-config.powerscale.yaml
POWERSCALE_ENDPOINT='10.20.0.11'
POWERSCALE_SNMP_COMMUNITY='YOUR_READ_ONLY_COMMUNITY'
POWERSCALE_SNMP_VERSION='v2c'
POWERSCALE_NODES='10.20.0.11,10.20.0.12,10.20.0.13'
POWERSCALE_SNMP_RECEIVERS='[snmp/cluster, snmp/quotas, snmp/node-1, snmp/node-2, snmp/node-3]'
POWERSCALE_NODE_1='10.20.0.11'
POWERSCALE_NODE_2='10.20.0.12'
POWERSCALE_NODE_3='10.20.0.13'
```

Cuando el clúster sume un nodo, añade su dirección a `POWERSCALE_NODES` en `.env` y vuelve a ejecutar `install.sh`: escribe la consulta del nodo y vuelve a crear el agente. Con Docker Compose, descarga `docker-compose.yml` y `otel-collector-config.powerscale.yaml`, y pon estas líneas en el `.env` del inicio rápido en lugar de sus líneas `STORAGE_SYSTEM`, `STORAGE_ARRAY_COLLECTOR_CONFIG` y `POWERSCALE_*`. `troubleshoot.sh` pregunta a cada nodo el nombre del clúster con `snmpget` cuando la máquina lo tiene.

### Lo que muestran las páginas de un PowerScale

La **Vista general** del clúster toma su salud de la que informa OneFS, cuenta sus nodos y cuotas, y dibuja la latencia y la carga de cada protocolo, el rendimiento, los nodos más ocupados y la capacidad usada. **Nodos** lista cada nodo con su salud, modelo, versión de OneFS, CPU y rendimiento; **Cuotas** lista cada cuota con cuánto de su límite usa, de mayor a menor; **Hardware** lista los discos de cada nodo, sus ventiladores y sus sensores de temperatura y de alimentación con sus lecturas, y sus puertos. La capacidad es la de `/ifs`, y el espacio que OneFS reserva para repuestos en caliente virtuales cuenta como usado: no está disponible para escrituras.

### Lo que el agente todavía no lee

- **Los eventos de OneFS y sus pools de almacenamiento.** SNMP no transporta ninguno de los dos: vienen de la API de OneFS, que leerá una sonda de OneUptime ([#11249](https://github.com/OneUptime/oneuptime/issues/11249)). Hasta entonces, envía los eventos como traps SNMP a una [sonda personalizada](/docs/probe/custom-probe) y añádele los nodos del clúster como [dispositivos de red](/docs/monitor/network-device-monitor): los traps llegan por UDP 162, y los criterios **Trap SNMP recibido (OID del trap)** alertan sobre ellos. Para traps SNMPv3, da a los dispositivos de red el usuario SNMPv3 del clúster ([Traps e informs SNMPv3](/docs/monitor/network-device-monitor#traps-e-informs-snmpv3)). En el clúster, crea el canal y envíale una alerta:

```bash
isi event channels create oneuptime snmp --host <probe-address> --community '<trap-community>' --use-snmp-trap true
isi event alerts modify <alert> --channel oneuptime
```

- **Reducción de datos**, que OneFS solo informa a través de su API, llega con la misma sonda.

## Solución de problemas

:::details Ejecuta primero el script de diagnóstico
El agente incluye un script, [`troubleshoot.sh`](https://oneuptime.com/install/storage-array-agent/troubleshoot.sh), que comprueba toda la cadena: el runtime de contenedores; el endpoint de la cabina exactamente como lo alcanza el colector (el endpoint nativo o el exportador de Pure: DNS, TLS, si una FlashArray tiene siquiera el endpoint nativo y si la cabina acepta el token de API, que el script pasa a curl por stdin); el nombre de la cabina marcado en cada métrica; la forma del token; las propias métricas del colector; y si OneUptime acepta la clave de ingesta. Esa última comprobación es la que más importa. OneUptime rechaza una clave incorrecta con `401` (`422` para una clave desactivada o una clave de navegador), y el colector trata ambas como permanentes: descarta el lote y registra un error `Exporting failed`, fácil de pasar por alto mientras el contenedor sigue sano. El script pide `GET <url>/otlp/v1/validate` desde dentro de la red del agente para obtener un `200` (válida) o un `401` (no válida) directos, y en servidores más antiguos recurre a `POST /fluentd/v1/logs`.

```bash
curl -fsSL https://oneuptime.com/install/storage-array-agent/troubleshoot.sh -o troubleshoot.sh
bash troubleshoot.sh    # add -d <dir> if you installed outside /opt/oneuptime-storage-array-agent
```

Termina con un veredicto que nombra la causa más probable.
:::

:::details No aparece ninguna cabina en OneUptime
1. Lee los logs del colector: `docker logs oneuptime-storage-array-agent`. `server returned HTTP status 401` significa que la cabina rechazó el token de API, `404` que la FlashArray no tiene endpoint nativo, `x509` que la verificación TLS está activada frente al certificado autofirmado de la cabina, `no such host` o `connection refused` que `PURE_FA_ENDPOINT` o `PURE_FB_ENDPOINT` es incorrecto, y un `401` al exportar que la clave de ingesta es incorrecta.
2. Pregunta a la cabina desde la red del agente. La imagen del colector no tiene shell ni curl, así que pregunta desde un contenedor en su red: `docker run --rm --network container:oneuptime-storage-array-agent curlimages/curl -sk -H 'Authorization: Bearer <api-token>' 'https://<array>/metrics/array?namespace=purefa'` debería imprimir líneas `purefa_*`.
3. Comprueba que `STORAGE_ARRAY_NAME` está definido: la cabina se encuentra por su atributo de recurso `storage.array.name`, y el colector se niega a iniciarse sin él.
:::

:::details La cabina aparece como desconectada
Una cabina pasa a desconectada cuando OneUptime no ha recibido nada de ella durante 15 minutos; OneUptime lo comprueba cada 5 minutos, y el tiempo en que él mismo no recibía datos no cuenta. Comprueba que el colector se está ejecutando (`docker compose ps`), que sus logs no muestran errores de recopilación ni de exportación, y que la máquina sigue llegando a la cabina y a tu URL de OneUptime. La cabina vuelve a estar conectada con sus siguientes datos.
:::

:::details La FlashArray responde 404
Su Purity//FA no tiene endpoint OpenMetrics nativo. Vuelve a ejecutar `install.sh` y elige la opción de Purity anterior, o establece `STORAGE_ARRAY_COLLECTOR_CONFIG=otel-collector-config.flasharray-exporter.yaml` y `COMPOSE_PROFILES=flasharray-exporter` en `.env` y ejecuta `docker compose up -d`. Después de actualizar la cabina a Purity//FA 6.7 o posterior, vuelve a la configuración nativa y quita el perfil.
:::

:::details La cabina rechaza el token de API
Comprueba que pegaste el token de API y no la contraseña del usuario, que el usuario sigue existiendo y tiene el rol readonly, y que el token no ha caducado. Crea un token nuevo (`pureadmin create --api-token oneuptime` en una FlashArray), ponlo en `.env` y ejecuta `docker compose up -d`. A través de los exportadores de Pure, un token rechazado aparece en el log del colector como un HTTP `400` del exportador, cuyo cuerpo dice `failed to login`.
:::

:::details Errores de x509 o TLS
Las cabinas presentan por defecto un certificado autofirmado, en el que no confía ninguna imagen de Docker. O bien establece `STORAGE_ARRAY_INSECURE_SKIP_VERIFY=true` (la opción práctica en una red de administración privada), o bien instala en la cabina un certificado de una CA en la que confíe la imagen del colector.
:::

:::details pure-fa-exporter, pure-fb-exporter o netapp-harvest no se resuelve
El exportador no se está ejecutando: `COMPOSE_PROFILES` debe coincidir con `STORAGE_ARRAY_COLLECTOR_CONFIG` (`flasharray-exporter` para la configuración con el exportador de FlashArray, `flashblade` para la configuración de FlashBlade, `netapp-ontap` para la configuración de ONTAP). Corrige `.env` y ejecuta `docker compose up -d`; `docker compose ps` mostrará entonces el exportador.
:::

:::details ONTAP: Harvest no puede iniciar sesión, o falta un objeto
Lee el log de Harvest: `docker compose logs netapp-harvest`. Un `401` o `Unauthorized` significa que el clúster rechazó el usuario o su contraseña: comprueba que el usuario tiene el método de inicio de sesión **http** y el rol REST de solo lectura (`security login show -user-or-group-name oneuptime`), corrige `.env` y ejecuta `docker compose up -d`. Un `403` o `not authorized` en un objeto significa que el rol no llega a esa API; el rol de arriba llega a todo `/api`. En Amazon FSx for NetApp ONTAP, FSx responde así sobre los discos, las bandejas y los sensores a quien pregunte: es lo esperado, y la página **Hardware** lo indica. `connection refused` o `no such host` significa un `NETAPP_ONTAP_ENDPOINT` incorrecto: es la dirección de administración del clúster (en FSx, el endpoint de administración), no la de un nodo ni la de una SVM. El script de diagnóstico también comprueba todo esto.
:::

:::details Un PowerStore no envía nada
Lea el registro del exportador con `docker compose logs powerstore-exporter`: un `401` significa un nombre de usuario o una contraseña incorrectos, y un `403` en `latest_five_min_metrics` significa que el rol del usuario no puede activar el archivo de métricas masivas (dele **Storage Operator**, o establezca `POWERSTORE_BULK_METRICS=false` en un PowerStoreOS anterior a 4.1). El exportador necesita un minuto tras arrancar antes de responder. Sin alertas en la página **Registros**: revise los ajustes _Remote Logging_ del clúster, el cortafuegos en el puerto 5514 y `docker compose logs powerstore-syslog`.
:::

:::details Un clúster o un nodo PowerScale no envía nada
`Error scraping metrics` con `request timeout` en el log del colector señala un nodo que no responde a SNMP desde la máquina del agente: SNMP está desactivado para la versión que usa el agente, la comunidad o el usuario SNMPv3 no son los del clúster, o UDP 161 está bloqueado. `bash troubleshoot.sh` consulta cada nodo con `snmpget`. Un nodo que responde pero falta en **Nodos** no está en `POWERSCALE_NODES`: añádelo y vuelve a ejecutar `install.sh`.
:::

:::details Los volúmenes o hosts eliminados siguen en el inventario
OneUptime quita un objeto cuando una recopilación completa de su endpoint ya no lo contiene, lo que reconoce por la etiqueta `scrape_endpoint`. Si sustituiste la configuración incluida del colector por la tuya, conserva las etiquetas `scrape_endpoint` en sus jobs de recopilación; si no, los objetos solo salen del inventario cuando quedan obsoletos.
:::

:::details Las métricas llegan a la cabina equivocada
OneUptime registra una cabina de almacenamiento por su `storage.array.name`, que el agente toma de `STORAGE_ARRAY_NAME`. Cambiarlo después de los primeros datos crea una segunda cabina en lugar de renombrar la primera.
:::

:::details Enviar métricas sin el agente
El agente es una única configuración estándar del colector, así que los colectores que ya ejecutas pueden hacer el mismo trabajo: copia los jobs de recopilación y el procesador `resource` de la configuración incluida a la tuya. El atributo de recurso `storage.array.name` es lo que registra la cabina en OneUptime, y las eliminaciones de `service.name` / `service.instance.id` evitan que los datos se archiven bajo un servicio: conserva ambas cosas y conserva las etiquetas `scrape_endpoint`.
:::

:::details La prueba de conexión dice que el certificado de Unisphere no es de confianza
Unisphere for PowerMax firma su propio certificado a menos que alguien haya instalado uno de una autoridad de certificación. Compara la huella que muestra la prueba con la del propio Unisphere, luego haz clic en **Confiar en este certificado** y vuelve a probar. Cuando se renueva el certificado de Unisphere, la recopilación se detiene con **El certificado del servidor cambió** hasta que confíes en el nuevo: antes no se le envía nada.
:::

:::details La prueba de conexión dice que la cuenta no puede leer las cabinas
Unisphere responde `403` a una cuenta sin rol en la cabina. Autoriza al usuario con el rol **Monitor** en cada cabina en **Settings → Users and Groups**, y con **PerfMonitor** para el rendimiento. Una cabina en la que la cuenta no tiene rol aparece en la página de la conexión con el motivo, y las demás se leen.
:::

:::details Un PowerMax no muestra tiempos de respuesta ni IOPS
Unisphere no recopila el rendimiento de la cabina, o a la cuenta le falta **PerfMonitor**: la página de la conexión dice cuál de las dos cosas ocurre. Activa la recopilación **Diagnostic** en **Settings → Performance → System Registrations**. Las cifras de un volumen, y las de un grupo de almacenamiento cada 5 segundos, necesitan que el grupo de almacenamiento esté registrado también ahí para **Real Time**.
:::

## Próximos pasos

:::cards
- [Monitor de cabinas de almacenamiento](/docs/monitor/storage-array-monitor): Alerta sobre alertas, capacidad, latencia, hardware, rutas de host, replicación y sistemas de archivos.
- [Agente de VMware](/docs/telemetry/vmware): ¿Ejecutas VMware en la cabina? Consulta también sus datastores y VM.
- [Colector OpenTelemetry en el host](/docs/telemetry/host-otel-collector): La vista del sistema operativo de las máquinas que usan la cabina.
:::
