# Visión general del inventario

El inventario es una sola lista de todo lo que OneUptime sabe de tu infraestructura: servicios, hosts, objetos de Kubernetes, máquinas virtuales, dispositivos de red, recursos en la nube, dispositivos IoT, funciones serverless y las cosas que no envían ninguna telemetría. Casi todo se rellena solo a partir de lo que OneUptime ya vigila. Tú añades lo que vigilar no puede decirle: para qué sirve algo, de quién es, cuándo vence su garantía. El [Glosario](/docs/introduction/glossary#lo-que-vigilas) explica qué es cada tipo de registro que contiene.

:::cards
- [Cómo llegan los elementos al inventario](#cómo-llegan-los-elementos-al-inventario): Descubiertos, replicados o añadidos por ti.
- [Orientarse](#orientarse): Las páginas del inventario y las páginas propias de cada elemento.
- [Importar dispositivos desde Esper](#importar-dispositivos-desde-esper): Todos los dispositivos Android y Apple que inscribe tu tenant de Esper, siempre al día.
- [Importar dispositivos desde Microsoft Intune](#importar-dispositivos-desde-microsoft-intune): Todos los PC con Windows, Mac, iPhone, iPad y dispositivos Android que gestiona Intune, siempre al día.
- [Importar dispositivos desde Workspace ONE UEM](#importar-dispositivos-desde-workspace-one-uem): Todos los teléfonos, tabletas y ordenadores que gestiona Workspace ONE, siempre al día.
- [Importar dispositivos desde SOTI MobiControl](#importar-dispositivos-desde-soti-mobicontrol): Todos los dispositivos robustos, teléfonos, tabletas y ordenadores que gestiona MobiControl, siempre al día.
- [Añadir algo a mano](#añadir-algo-a-mano): Una API de terceros, una base de datos externa o un appliance.
- [Archivar en lugar de eliminar](#archivar-en-lugar-de-eliminar): La forma de ordenar la lista que perdura.
:::

## Cómo llegan los elementos al inventario

OneUptime ya vigila tu infraestructura para monitorizarla, así que el catálogo se construye a partir de lo que observa y no de lo que alguien recordó escribir. Cada elemento tiene un origen, y el origen decide de quién es el elemento: si puedes editarlo y si puede desaparecer por sí solo.

```mermaid title="Tres caminos hacia una sola lista"
flowchart TB
    T["Tu<br/>telemetría"] -->|"Descubierto"| I["Inventario: un elemento<br/>por cosa, con una<br/>clave de identidad estable"]
    R["Los sondeos<br/>de OneUptime"] -->|"Replicado cada<br/>15 minutos"| I
    Y["Cosas sin<br/>telemetría"] -->|"Añadido por ti"| I
    I --> L["Todos los elementos,<br/>el mapa de topología<br/>y las páginas"]
    I --> X["Campos personalizados,<br/>la exportación CSV<br/>y la API"]
```

| Origen | En la API | De dónde viene | Cuánto tiempo se queda |
| --- | --- | --- | --- |
| **Descubierto** | `discovered` | Atributos de recurso de OpenTelemetry, leídos al llegar la telemetría: un servicio, host, objeto de Kubernetes o máquina virtual que envía telemetría. | Se vuelve a registrar con cada lote. Se elimina cuando lleva más tiempo en silencio que la ventana de su tipo (ver más abajo). |
| **Replicado** | `inventory` | Un registro que mantiene un sondeo de OneUptime: dispositivos de red, recursos en la nube, dispositivos IoT, funciones serverless, aplicaciones RUM, hosts Docker, hosts Podman y los dispositivos que importa una conexión con un gestor de dispositivos. Se copia cada 15 minutos; un dispositivo gestionado, cada vez que se lee su conexión. | Mientras exista su registro. Elimina el registro y el elemento se va con él. |
| **Añadido por ti** | `manual` | Añadido por ti, para algo que OneUptime no puede ver: una API de terceros, una base de datos gestionada por un proveedor, un appliance en un rack. | Hasta que lo elimines. Nada lo hace caducar. |

Un elemento descubierto o replicado no se puede renombrar ni cambiar de tipo: su origen sobrescribiría el cambio en su siguiente pasada. La página **Ajustes** del elemento indica dónde hacer en su lugar un cambio duradero. Lo que siempre puedes añadir a cualquier elemento, sea cual sea su origen, son valores de campos personalizados: consulta [Campos personalizados del inventario](/docs/inventory/custom-fields).

### Cuánto tiempo se queda un elemento silencioso

Un elemento descubierto tiene latido. Cada vez que llega telemetría para él, su hora de última vez visto avanza, y la columna **Estado** de la lista indica lo reciente que es. Lo mismo ocurre con un dispositivo gestionado: cada vez que contacta con su gestor de dispositivos. Los demás elementos replicados y los que añadiste no tienen latido, así que su estado se queda en blanco en lugar de alarmar.

| Estado | Qué significa |
| --- | --- |
| **En vivo** | Visto en los últimos 30 minutos. |
| **Recientes** | Visto durante el último día. |
| **Obsoleto** | Sin ver desde hace más de un día. La página **Sin actividad** los muestra. |

Cada tres horas, OneUptime elimina los elementos descubiertos que llevan más tiempo en silencio que la ventana de su tipo, también los archivados, y sus valores de campos personalizados se van con ellos. Los elementos replicados y los que añadiste nunca se eliminan de esta forma.

| Tipo de elemento | Se elimina tras este tiempo sin telemetría |
| --- | --- |
| Pods, despliegues, invitados de Proxmox, instancias de OpenStack y máquinas virtuales de VMware | 1 día |
| Nodos y espacios de nombres de Kubernetes, nodos de Proxmox, hipervisores de OpenStack, hosts, clústeres y almacenes de datos de VMware, y las bases de datos y servicios remotos a los que llaman tus trazas | 7 días |
| Servicios, hosts, clústeres de Kubernetes, Proxmox y Ceph, nubes OpenStack, cabinas de almacenamiento, vCenters y clústeres de Docker Swarm | 30 días |

Una relación que OneUptime descubrió se elimina cuando no se ha vuelto a ver durante 30 días.

## Orientarse

Abre **Productos → Recursos → Inventario**. Su menú lateral tiene estas páginas. **Por origen**, **Ajustes**, **Ayuda** y **Avanzado** empiezan plegados: haz clic en el título de una sección para abrirla.

| Página | Qué encontrarás |
| --- | --- |
| **Vista general** | Cuántos elementos tienes, qué son, cuántos se han quedado sin actividad y qué se añadió más recientemente. |
| **Todos los elementos** | Todos los elementos. Busca por nombre, descripción o clave de identidad, filtra la lista por tipo, origen, estado o campo personalizado, y añade un elemento a mano. |
| **Dispositivos gestionados** | Tus conexiones con gestores de dispositivos (Esper, Microsoft Intune, Workspace ONE UEM y SOTI MobiControl), y todos los dispositivos que importan, con su estado, grupo, modelo y sistema operativo. |
| **Mapa de topología** | Cómo se conectan los elementos: los servicios, a qué llaman y los hosts, pods y dispositivos en los que se ejecutan. |
| **Sin actividad** | Los elementos de los que no se sabe nada desde hace más de un día: elementos descubiertos que no enviaron telemetría y dispositivos que dejaron de contactar con su gestor de dispositivos. |
| **Por origen** | Los elementos de un origen: **Descubierto**, **Replicado** o **Añadido por ti**. |
| **Ajustes → Campos personalizados** | Los campos que tu proyecto mantiene en cada elemento. |
| **Ayuda → Documentación** | Una guía breve del inventario, con los tipos de elemento que reconoce. |
| **Avanzado → Archivado** | Los elementos que archivaste. Desarchívalos desde aquí. |

Abre un elemento y su propio menú lateral tiene su **Vista general** (su tipo, origen y estado, y cada atributo observado en él), sus **Conexiones** y sus **Campos personalizados**; sus **Registros**, **Trazas**, **Métricas**, **Perfiles** y **Excepciones**; y sus **Incidentes**, **Alertas** y **Mantenimiento programado**. En **Avanzado** están sus **Ajustes**, sus **Registros de auditoría** y **Eliminar elemento**. Las páginas de telemetría muestran lo que envió el propio elemento. Los incidentes, alertas y eventos de mantenimiento son los del servicio, host o clúster de Kubernetes que representa el elemento; en cualquier otro elemento, esas páginas indican qué recurso consultar en su lugar.

### Detalles del activo

Un host o un dispositivo de red tiene una tarjeta **Detalles del activo** que describe ambos de la misma manera: nombre de host, dirección IP, dirección MAC, número de serie, fabricante, modelo, versión de firmware, sistema operativo, versión del sistema operativo, tipo de dispositivo y ubicación. La tarjeta de un dispositivo Android también tiene su nivel de parche de seguridad, del Agente de Android o de su gestor de dispositivos. También dice si el parche está **Desactualizado**, como la columna **Nivel del parche de seguridad**, y cuántos días de antigüedad tiene. Un dato que nada ha informado aparece como **Desconocido**, y la tarjeta explica por qué ocurre y cómo se completan los desconocidos: un dispositivo que no los informa por SNMP, un dispositivo que aún no se ha leído, o un dispositivo Meraki cuyo panel los tiene.

- Los datos de un host vienen de los atributos de recurso de su telemetría: sus direcciones IP y MAC, su arquitectura y su sistema operativo de serie, y su número de serie, marca, modelo y firmware una vez que los estampas.
- Los datos de un dispositivo de red vienen de su sondeo SNMP, su rol y su sitio. Lo que su sondeo no ha leído viene del descubrimiento: el último escaneo de su dirección, la tabla ARP de un router o la consulta DNS de su sonda. Un dispositivo sin ENTITY-MIB, como un Meraki MX, obtiene igualmente su marca, modelo y sistema operativo de su descripción del sistema, y su dirección MAC de sus propios puertos. Su dirección IP nunca se muestra como su nombre de host.
- Un dispositivo Meraki también toma del panel de Meraki lo que su sondeo deja vacío, entre ello su número de serie, modelo y firmware, cuando una [conexión de Meraki](/docs/monitor/network-traffic#cisco-meraki-sin-netflow) lee su organización.

**Todos los elementos** encuentra los dispositivos Android sobre los que hay que actuar. Su filtro **Nivel del parche de seguridad** muestra como **Desactualizado** los dispositivos cuyo nivel de parche de seguridad tiene más de 90 días, la misma regla que aplica la alerta Security Patch Out of Date del [monitor de host](/docs/monitor/host-monitor). Su filtro **Permisos del agente** muestra los dispositivos en los que al [Agente de Android](/docs/telemetry/android-agent) aún le faltan READ_LOGS, READ_DROPBOX_DATA o el acceso a datos de uso. Cada uno tiene una columna con el mismo nombre, oculta hasta que la activas, y la exportación CSV la incluye. A su lado, la columna **ID en el gestor de dispositivos** tiene el ID con el que el gestor de dispositivos conoce un dispositivo, como el ID de Esper que recibe `espercli secureadb connect --device`.

La tarjeta indica de dónde vino cada dato y cuándo. La fuente que comparten la mayoría de los datos, como el recolector de un host, el propio sondeo SNMP de un dispositivo de red o el escaneo de descubrimiento que lo leyó, se nombra una sola vez, debajo de los datos. Cualquier otra fuente, como la tabla ARP de un router o un valor guardado en el dispositivo, se nombra bajo su dato. Un valor guardado en un dispositivo de red nunca se sustituye por lo que lee el descubrimiento, y cuando los dos difieren, la tarjeta muestra ambos.

La tarjeta de un dispositivo de red tiene un botón **Actualizar** para quien puede editar dispositivos de red. Vuelve a leer el dispositivo ahora: su sonda lo consulta en menos de un minuto y su conexión de Meraki vuelve a leer la organización. La tarjeta indica cuándo ha llegado la nueva lectura, o que la sonda no pudo alcanzar el dispositivo, y el elemento se copia del dispositivo en cuanto llega la lectura.

Los mismos datos son columnas de la lista **Todos los elementos**, ocultas hasta que las activas, y entran en su exportación CSV. [Exportar a una CMDB](/docs/inventory/cmdb-sync#detalles-del-activo) enumera sus claves.

### Conexiones

La página **Conexiones** de un elemento enumera sus vecinos en ambas direcciones, agrupados en **Llamadas**, **Llamado por**, **Se ejecuta en** y **Relacionado**. Cada grupo muestra su total (un grupo con más de 100 000 conexiones muestra «100 000+»), y **Mostrar más** recorre el resto, así que un clúster, un espacio de nombres o un nodo muy concurrido muestra todas sus conexiones y no solo las primeras. La página no se limita a un intervalo de tiempo: incluye las relaciones añadidas a mano mediante la API y los vecinos archivados. Un vecino que ya no está en el inventario se muestra por su clave.

## Importar dispositivos desde Esper

Conecta un tenant de Esper y todos los dispositivos que inscribe estarán en el inventario: sus dispositivos Android, incluidos aquellos cuya aplicación nunca se inició, y sus iPhone, iPad y Apple TV. Cada dispositivo es un host, con lo que solo Esper sabe de él: su grupo, su sistema operativo y su compilación, su número de serie y su IMEI, su batería y su almacenamiento, y, en un dispositivo Android, su nivel de parche de seguridad y sus aplicaciones instaladas. Esper no envía nada por sí solo, así que OneUptime lo lee de forma programada: los dispositivos cada 15 minutos y las aplicaciones de cada dispositivo Android cada 6 horas.

:::steps
### Crear una clave de API en Esper

En la consola de Esper, crea una clave en API Key Management. OneUptime solo lee, así que basta con la clave de un usuario cuyo rol de Esper pueda leer dispositivos, grupos y aplicaciones. Una clave deja de funcionar en cuanto se reemplaza o en cuanto se elimina su usuario.

### Conectar el tenant

Ve a **Productos → Recursos → Inventario**, luego a **Dispositivos gestionados**, haz clic en **Conectar un gestor de dispositivos** y elige **Esper**. Introduce el **Tenant**, el nombre que va antes de `.esper.cloud` en la dirección de tu consola de Esper (`acme` para `acme.esper.cloud`), y la **Clave de API**. **Más campos** contiene el nombre de la conexión y la frecuencia con la que se lee.

### Comprobar la primera lectura

**Conectar** prueba la clave antes de guardar nada: indica cuántos dispositivos importará una lectura, o qué falla y cómo arreglarlo. La primera lectura empieza en menos de un minuto, y la fila de la conexión indica cómo fue.
:::

| Lo que informa Esper | Dónde aparece |
| --- | --- |
| Modelo, fabricante, número de serie, sistema operativo y su versión, compilación y direcciones IP y MAC | La tarjeta **Detalles del activo** del dispositivo y las columnas de **Todos los elementos** |
| Estado, último contacto, grupo, nivel de parche de seguridad, IMEI, batería, almacenamiento y agente de Esper | La tarjeta **Esper** del dispositivo y la lista **Dispositivos** de **Dispositivos gestionados** |
| Las aplicaciones y sus versiones | La lista **Aplicaciones instaladas** del dispositivo |
| Su ID de dispositivo en Esper | La columna **ID en el gestor de dispositivos** de **Todos los elementos** |

### Un dispositivo, no dos

Una aplicación o el Agente de Android que envía telemetría desde un dispositivo se une al dispositivo que importa Esper en un solo elemento cuando nombra el dispositivo igual que Esper. Define estos atributos de recurso a partir de la configuración gestionada que Esper rellena en cada dispositivo:

| Atributo de recurso | Valor de la configuración gestionada | Qué es |
| --- | --- | --- |
| `host.name` | `${esper.deviceName}` | El nombre del dispositivo en Esper, como `ESP-ID-AAAAW`. Obligatorio. |
| `host.serial_number` | `${esper.serialNumber}` | El número de serie del dispositivo. Opcional. |

OneUptime encuentra el elemento de un dispositivo por su nombre en Esper y luego por su número de serie, y solo crea uno cuando ninguno coincide. El Agente de Android define ambos a partir de sus ajustes `device_name` y `device_serial`, y [Configuración para Android](/docs/rum/android-setup#importar-la-flota-desde-esper) muestra la configuración gestionada de una aplicación.

### Cuando un dispositivo se queda sin actividad o sale de Esper

Un dispositivo Android que no ha contactado con Esper en 30 minutos está **Sin conexión** e indica cuánto hace de su último contacto; un iPhone, un iPad o un Apple TV, que contacta con Esper cuando el servicio push de Apple lo despierta, a menudo con horas de diferencia, está **Sin conexión** tras un día. El **Estado** de su elemento sigue su último contacto, o su telemetría cuando es más reciente, así que un dispositivo sin actividad durante un día aparece en la página **Sin actividad**.

Un dispositivo eliminado de Esper se marca como **Eliminado**, y su elemento se archiva: sale de la lista y espera en **Avanzado → Archivado**. Un dispositivo que vuelve a Esper vuelve a la lista. 30 días después de su salida, el dispositivo se elimina, y también su elemento, salvo que se le haya añadido algo, por telemetría o a mano.

### Recibir una alerta cuando un dispositivo deja de comunicarse

En **Dispositivos gestionados**, haz clic en **Configurar alertas** en la fila de la conexión y crea **Esper Android Device Stopped Checking In** y **Esper Apple Device Stopped Checking In**. El primero abre una alerta por cada dispositivo Android que lleva más de una hora sin contactar con Esper, y el segundo por cada dispositivo Apple que lleva más de un día, cada una con el nombre del dispositivo y resuelta en cuanto el dispositivo vuelve a contactar.

Cada lectura de la conexión registra hace cuántos minutos contactó cada dispositivo por última vez, como la métrica `oneuptime.managed_device.check_in.age`, y el monitor comprueba la lectura más reciente de cada dispositivo cada 5 minutos. Un dispositivo que también ejecuta el Agente de Android queda a cargo de **Host Stopped Reporting**, así que nunca alerta dos veces, y un dispositivo eliminado de Esper resuelve su alerta. Una lectura que falla no registra nada de los dispositivos, así que ninguna de sus alertas se abre ni se resuelve hasta que una lectura vuelva a funcionar. Para una flota que se apaga por la noche, sube el umbral del monitor.

Crea también **Esper Security Patch Out of Date**, y cada dispositivo Android cuyo nivel de parche de seguridad, según Esper, tenga más de 90 días abre una alerta propia, que se resuelve cuando el dispositivo se actualiza. Cada lectura registra cuántos días de antigüedad tiene el nivel de parche de cada dispositivo Android, como la métrica `oneuptime.managed_device.security_patch.age`. Un dispositivo que ejecuta el Agente de Android queda a cargo del **Security Patch Out of Date** de su host, así que nunca alerta dos veces.

Crea también **Esper Low Battery** y **Esper Storage Nearly Full**: cada dispositivo cuya batería, según la última lectura de Esper, esté por debajo del 20 % abre una alerta propia, igual que cada dispositivo cuyo almacenamiento esté lleno en más del 90 %, y cada una se resuelve cuando el dispositivo se carga o vuelve a tener espacio. Cada lectura registra ambos, como las métricas `oneuptime.managed_device.battery.level` y `oneuptime.managed_device.storage.used`. Un dispositivo que ejecuta el Agente de Android queda a cargo de **Low Battery** y **Storage Nearly Full** de su host, que alertan en los mismos niveles, así que nunca alerta dos veces.

Las alertas de un dispositivo también están en su elemento: su tarjeta **Esper** enumera los incidentes y las alertas abiertos sobre él, cada uno con un enlace a su página, y las páginas **Alertas** e **Incidentes** de un dispositivo del que no informa el Agente de Android enumeran todos los que los monitores de su conexión generaron sobre él.

### Recibir una alerta cuando la conexión deja de leerse

Crea **Esper Connection Stopped Reading**, y la conexión abre una alerta propia en cuanto ninguna lectura suya ha funcionado durante tanto tiempo como su fila espera antes de que su **Estado** diga **Obsoleto**: tres de sus intervalos de lectura y diez minutos más, y nunca menos de media hora, es decir, 55 minutos con el intervalo predeterminado de 15. Su primer paso de depuración enumera las últimas lecturas de la conexión, cada una con el error con el que falló, y la primera lectura que funciona la resuelve. Cada lectura, y cada lectura que le toca a la conexión, registra cuántos minutos han pasado desde que una funcionó, como la métrica `oneuptime.managed_device.connection.read.age`. El monitor espera tanto como indica el intervalo de lectura de la conexión al crearlo. Desactivar la conexión resuelve la alerta que tenía abierta, porque nada está atrasado en una conexión desactivada, y las alertas de sus dispositivos siguen como están hasta que vuelva a leer. Eliminar la conexión resuelve lo que tenían abierto los monitores que solo la leen a ella y desactiva su monitorización.

## Importar dispositivos desde Microsoft Intune

Conecta un tenant de Microsoft Intune y todos los dispositivos que gestiona Intune estarán en el inventario: sus PC con Windows, Mac, iPhone, iPad, dispositivos Android y equipos Linux. Cada dispositivo es un host, con lo que Intune sabe de él: su categoría, su sistema operativo y su versión, su número de serie y su IMEI, su cumplimiento, su propiedad y su inscripción, su almacenamiento y las aplicaciones que Intune detectó en él. Intune no envía nada por sí solo, así que OneUptime lo lee de forma programada: los dispositivos cada 15 minutos y las aplicaciones de cada dispositivo cada 6 horas.

:::steps
### Registra una aplicación en Microsoft Entra

En el centro de administración de Microsoft Entra, abre `App registrations` y haz clic en `New registration`. Ponle un nombre, deja `Accounts in this organizational directory only` y regístrala. Su página `Overview` muestra los dos ID que pide OneUptime: el `Application (client) ID` y el `Directory (tenant) ID`.

### Permítele leer los dispositivos de Intune

En `API permissions`, haz clic en `Add a permission`, luego en `Microsoft Graph`, luego en `Application permissions`, y añade `DeviceManagementManagedDevices.Read.All`. Después haz clic en `Grant admin consent`, algo que solo puede hacer un administrador del tenant. Ese único permiso es todo lo que necesita OneUptime: lista los dispositivos y las aplicaciones que Intune detectó en ellos, y no puede cambiar nada.

### Crea un secreto de cliente

En `Certificates & secrets`, haz clic en `New client secret` y copia su `Value`, no su `Secret ID`: Microsoft muestra el valor una sola vez. Un secreto deja de funcionar cuando caduca, así que antes de que lo haga, crea uno nuevo e introdúcelo al editar la conexión.

### Conecta el tenant de Intune

Ve a **Productos → Recursos → Inventario**, luego a **Dispositivos gestionados**, haz clic en **Conectar un gestor de dispositivos** y elige **Microsoft Intune**. Introduce el **ID del tenant**, el **ID de la aplicación (cliente)** y el **Secreto de cliente**. Si el tenant está en una nube del gobierno de EE. UU., elígela como **Nube** en **Más campos**. **Conectar** prueba el registro de aplicación antes de guardar nada: indica cuántos dispositivos importará una lectura, o qué está mal y cómo arreglarlo.
:::

Un dispositivo contacta con Intune más o menos cada ocho horas, y su último contacto es la última vez que lo hizo: un dispositivo que lleva un día sin hacerlo está **Sin conexión**. Sus aplicaciones son las que Intune detectó en él, que Microsoft Graph solo lista en su versión beta: en un dispositivo personal, las aplicaciones que gestiona Intune. Los grupos de Intune son grupos de Microsoft Entra, que este permiso no lee, así que el grupo de un dispositivo es su categoría de dispositivo. No se lee nada sobre el usuario de un dispositivo.

Intune nombra un dispositivo como lo llamó su propietario, así que dos dispositivos pueden compartir nombre: todos los iPhone que nadie renombró se llaman `iPhone`. Un nombre que comparten dos dispositivos de una conexión no es de ninguno de los dos en el inventario: cada uno se nombra por su número de serie, y recupera su nombre en cuanto ningún otro dispositivo lo tiene.

Para recibir una alerta cuando un dispositivo deja de contactar, haz clic en **Configurar alertas** en la fila de la conexión y crea **Intune Device Stopped Checking In**. Abre una alerta por cada dispositivo que lleva más de un día sin contactar con Intune, con el nombre del dispositivo. Un portátil apagado durante un fin de semana se ve igual, así que sube el umbral del monitor si un día es muy poco para los tuyos. **Intune Security Patch Out of Date** alerta por cada dispositivo Android cuyo nivel de parche de seguridad tenga más de 90 días, como la plantilla de Esper. **Intune Low Battery**, **Intune Storage Nearly Full** e **Intune Connection Stopped Reading** alertan como las plantillas de Esper. Intune solo conoce la batería de un iPhone o un iPad, tal como estaba la última vez que contactó, así que **Intune Low Battery** alerta sobre ellos.

## Importar dispositivos desde Workspace ONE UEM

Conecta un servidor de Workspace ONE UEM y todos los dispositivos que gestiona estarán en el inventario: sus iPhone, iPad, Mac, PC con Windows, dispositivos Android y equipos Linux. Cada dispositivo es un host, con lo que Workspace ONE sabe de él: su grupo organizativo, su sistema operativo y su versión, su modelo, su número de serie y su IMEI, su cumplimiento, su inscripción y su propiedad, su batería, su almacenamiento y su memoria, y sus aplicaciones. Workspace ONE no envía nada por sí solo, así que OneUptime lo lee de forma programada: los dispositivos cada 15 minutos y las aplicaciones de cada dispositivo cada 6 horas.

:::steps
### Crea un rol de solo lectura

En la consola de Workspace ONE UEM, ve a `Accounts`, luego a `Administrators`, luego a `Roles`, y haz clic en `Add Role`. En `API`, luego en `REST`, selecciona `Read` para `Devices` y para `Apps`, y nada más. Ese rol es todo lo que necesita OneUptime: lista los dispositivos y sus aplicaciones, y no puede cambiar nada.

### Crea un cliente OAuth

Ve a `Groups & Settings`, luego a `Configurations`, luego a `OAuth Client Management`, y haz clic en `Add`. Elige el grupo organizativo cuyos dispositivos lee OneUptime y dale al cliente el rol que creaste. Copia su `Client ID` y su `Client Secret`: Workspace ONE muestra el secreto una sola vez.

### Conecta el servidor

Ve a **Productos → Recursos → Inventario**, luego a **Dispositivos gestionados**, haz clic en **Conectar un gestor de dispositivos** y elige **Workspace ONE UEM**. Introduce la **URL de la API REST**, que muestra `Groups & Settings`, `All Settings`, `System`, `Advanced`, `API`, `REST API`, como `https://as1234.awmdm.com`. Deja **Cliente OAuth** en **Iniciar sesión con**, introduce el **ID de cliente** y el **Secreto de cliente**, y elige la **Región** del servicio de tokens de tu centro de datos. **Conectar** prueba el cliente antes de guardar nada: indica cuántos dispositivos importará una lectura, o qué está mal y cómo arreglarlo.
:::

Un servidor local de Workspace ONE no tiene servicio de tokens: elige **Cuenta de administrador** en **Iniciar sesión con**, e introduce el **Nombre de usuario** y la **Contraseña** de un administrador con el rol de solo lectura y la **Clave de API REST** de la misma configuración de REST API, donde debe estar permitida la autenticación básica. OneUptime Cloud solo lee servidores en internet público, así que un servidor en una red privada lo lee un OneUptime autoalojado.

Un dispositivo informa a Workspace ONE según su propio calendario, un iPhone con horas de diferencia, así que un dispositivo que lleva un día sin hacerlo está **Sin conexión**. Un dispositivo que ya no está inscrito se deja fuera. Un dispositivo se nombra por el nombre que informa, no por su nombre descriptivo, que Workspace ONE forma con el nombre de su usuario, y no se lee nada sobre el usuario de un dispositivo. Cada solicitud cuenta para la cuota diaria de API del tenant, así que una lectura lee las aplicaciones de 25 dispositivos como máximo, y la siguiente lectura las de los siguientes.

Una aplicación o el Agente de Android que envía telemetría desde un dispositivo se une a él en un solo elemento por el número de serie del dispositivo: define el ajuste `device_serial` del Agente de Android con el valor de búsqueda `{DeviceSerialNumber}` en su configuración gestionada.

Para recibir una alerta cuando un dispositivo deja de contactar, haz clic en **Configurar alertas** en la fila de la conexión y crea **Workspace ONE Device Stopped Checking In**. Abre una alerta por cada dispositivo que lleva más de un día sin informar a Workspace ONE, con el nombre del dispositivo. **Workspace ONE Security Patch Out of Date** alerta por cada dispositivo Android cuyo nivel de parche de seguridad tenga más de 90 días, como la plantilla de Esper. **Workspace ONE Low Battery**, **Workspace ONE Storage Nearly Full** y **Workspace ONE Connection Stopped Reading** alertan como las plantillas de Esper. Un dispositivo que según Workspace ONE está conectado a la corriente, en su cargador o su base, queda fuera de **Workspace ONE Low Battery**, y una alerta que tuviera abierta se resuelve.

## Importar dispositivos desde SOTI MobiControl

Conecta un servidor de SOTI MobiControl, en la nube de SOTI o local, y todos los dispositivos que gestiona estarán en el inventario: sus dispositivos Android robustos, teléfonos, tabletas y escáneres, sus iPhone, iPad y Mac, y sus ordenadores Windows y Linux. Cada dispositivo es un host, con lo que MobiControl sabe de él: su grupo de dispositivos, su sistema operativo y su versión, su modelo, su número de serie y su IMEI, su cumplimiento, su agente, su batería, su almacenamiento y su memoria, y sus aplicaciones instaladas. MobiControl no envía nada por sí solo, así que OneUptime lo lee de forma programada: los dispositivos cada 15 minutos y las aplicaciones de cada dispositivo cada 6 horas.

:::steps
### Crea un usuario de MobiControl de solo lectura

En la consola web de MobiControl, añade un usuario propio de MobiControl, no un usuario de SOTI Identity. Permite `Web Console Access` y `View Installed Applications` en sus permisos generales y nada más, y dale `View Groups` en los grupos de dispositivos que lee OneUptime. Ese usuario es todo lo que necesita OneUptime: puede ver los dispositivos y sus aplicaciones, y no puede cambiar nada.

### Crea un cliente de API

En la consola web, ve a `Global Settings`, luego a `Services`, luego a `API Client`, y añade uno. Copia su `Client ID` y su `Client Secret`: MobiControl muestra el secreto una sola vez. En un servidor anterior a MobiControl 2024.0, créalo en el propio servidor con `MCAdmin.exe APIClientAdd -n:OneUptime`.

### Conecta el servidor de MobiControl

Ve a **Productos → Recursos → Inventario**, luego a **Dispositivos gestionados**, haz clic en **Conectar un gestor de dispositivos** y elige **SOTI MobiControl**. Introduce el **Servidor**, la dirección de tu consola web sin `/MobiControl`, como `https://acme.mobicontrolcloud.com`, el **ID de cliente** y el **Secreto de cliente** del cliente de API, y luego el **Nombre de usuario** y la **Contraseña** del usuario. **Conectar** prueba el inicio de sesión antes de guardar nada: indica cuántos dispositivos importará una lectura, o qué está mal y cómo arreglarlo.
:::

Un agente de MobiControl mantiene una conexión permanente con su servidor, así que un dispositivo cuyo agente está conectado está en línea, y uno cuyo agente lleva 30 minutos sin conectarse está **Sin conexión**. Un iPhone, un iPad o un Mac contacta a través del servicio push de Apple, con horas de diferencia, y está **Sin conexión** tras un día. Un dispositivo que un administrador deshabilitó está **Deshabilitado**, y uno cuya inscripción se está anulando se deja fuera. OneUptime Cloud solo lee servidores en internet público, así que un servidor en una red privada lo lee un OneUptime autoalojado. No se lee nada sobre el usuario de un dispositivo.

Una aplicación o el Agente de Android que envía telemetría desde un dispositivo se une a él en un solo elemento por el número de serie del dispositivo: define el ajuste `device_serial` del Agente de Android con la macro `%SERIALNUM%` en su configuración gestionada.

Para recibir una alerta cuando un dispositivo deja de contactar, haz clic en **Configurar alertas** en la fila de la conexión y crea **SOTI Device Stopped Checking In** y **SOTI Apple Device Stopped Checking In**. El primero abre una alerta por cada dispositivo Android, Windows o Linux cuyo agente lleva más de una hora sin conectarse, y el segundo por cada dispositivo Apple que lleva más de un día sin contactar, cada una con el nombre del dispositivo. **SOTI Security Patch Out of Date** alerta por cada dispositivo Android cuyo nivel de parche de seguridad tenga más de 90 días, como la plantilla de Esper. **SOTI Low Battery**, **SOTI Storage Nearly Full** y **SOTI Connection Stopped Reading** alertan como las plantillas de Esper. Un dispositivo Android que según MobiControl se está cargando queda fuera de **SOTI Low Battery**, y una alerta que tuviera abierta se resuelve.

## Añadir algo a mano

Añade un elemento para algo que OneUptime nunca verá por sí mismo, de modo que una dependencia termine en algo real y esa cosa pueda llevar tus campos personalizados.

:::steps
### Abrir Todos los elementos

Ve a **Productos → Recursos → Inventario** y luego a **Todos los elementos**.

### Añadir el elemento

Haz clic en **Añadir Elemento**. Elige su **Tipo**, dale un **Nombre** y, si quieres, una **Descripción**. El nombre y el tipo juntos son la identidad del elemento, así que dos elementos del mismo tipo no pueden compartir nombre.

### Rellenar sus campos personalizados

Abre el nuevo elemento. Su origen indica **Añadido por ti**, y su página **Campos personalizados** acepta los valores que sigue tu proyecto.
:::

Puedes añadir tres tipos a mano:

- `external.service` (**Servicio externo**): una API de terceros o una dependencia de software como servicio.
- `external.database` (**Base de datos externa**): una base de datos que no es un servidor que OneUptime pueda modelar. Un servidor de base de datos, autoalojado o gestionado, de PostgreSQL a Snowflake, va en su lugar en **Bases de datos → Crear Base de datos** ([Bases de datos](/docs/telemetry/databases)): ese registro se une a las trazas, los contenedores y las métricas del motor que nombran la misma dirección, algo que un elemento del inventario nunca hace, y añadir el mismo servidor de las dos formas deja dos registros sin relación.
- `appliance` (**Appliance**): hardware o software sin agente.

La restricción evita duplicados. Un elemento hecho a mano de un tipo que OneUptime puede observar, como un host, se identificaría por el nombre que escribiste, mientras que el elemento descubierto de la misma máquina se identifica por los atributos que informa. Los dos nunca se unirían, así que el mismo host aparecería dos veces en tu lista para siempre.

## Archivar en lugar de eliminar

Archivar saca un elemento de la lista mientras conserva su identidad, su historial y sus valores de campos personalizados. Dice: ya he visto esto y no lo quiero en mi lista. Un elemento archivado sigue recogiendo telemetría.

| Origen | Archivar | Eliminar |
| --- | --- | --- |
| **Descubierto** | Sigue archivado. | Vuelve con el siguiente lote de su telemetría. |
| **Replicado** | Sigue archivado. | Vuelve con la siguiente copia. Elimina en su lugar el registro original. |
| **Añadido por ti** | Sigue archivado. | Desaparece para siempre. |

Para archivar elementos, selecciónalos en **Todos los elementos** y archívalos de una vez, o abre un elemento y usa la tarjeta **Archivar** de su página **Ajustes**. Los elementos archivados están en **Inventario → Avanzado → Archivado**, donde puedes seleccionarlos y desarchivarlos.

> [!NOTE]
> Cuando un dispositivo replicado se quita de su registro de origen, OneUptime también elimina su elemento, salvo que el elemento lleve valores de campos personalizados que introdujiste. Esos valores son la única copia y no se puede deshacer, así que el elemento se archiva en lugar de eliminarse. Lo encontrarás en **Avanzado → Archivado** con todo lo que escribiste intacto.

## Relaciones y topología

OneUptime enlaza los elementos con relaciones dirigidas a medida que las observa. **Inventario → Mapa de topología** las dibuja, y la página **Conexiones** de un elemento enumera las suyas. Consulta [Topología](/docs/telemetry/topology).

| Relación | Por ejemplo |
| --- | --- |
| `runs-on` | Un pod se ejecuta en un nodo; una máquina virtual se ejecuta en su host. |
| `member-of` | Un pod, nodo o espacio de nombres es miembro de un clúster. |
| `hosted-on` | Un servicio está alojado en un host. |
| `part-of` | Un pod forma parte de su despliegue. |
| `depends-on` | Un servicio llama a otro, según los spans que pasan de uno a otro. |

## Próximos pasos

:::cards
- [Campos personalizados del inventario](/docs/inventory/custom-fields): Registrar números de serie, fechas de garantía, propietarios y estado del ciclo de vida.
- [Exportar a una CMDB](/docs/inventory/cmdb-sync): Llevar el catálogo a tu propio sistema de registro.
- [Bases de datos](/docs/telemetry/databases): Monitorizar los servidores de bases de datos que usan tus servicios.
:::
