# Eventos de red (syslog y traps SNMP)

Los routers, firewalls, switches y puntos de acceso cuentan lo que les pasa en su syslog: un enlace se cayó, un túnel se cortó, un firewall conmutó por error, alguien inició sesión. Cada fabricante lo dice a su manera. Apunta su syslog a una sonda de OneUptime y las páginas de **Eventos** muestran lo que pasó con las mismas palabras, sea quien sea el fabricante del dispositivo, y te avisan cuando vuelve a pasar.

Hay una página de Eventos en dos lugares:

- **Red** -> **Eventos**: toda la red, los eventos de cada dispositivo en una sola página, y cada dirección que envía syslog sin ser todavía un dispositivo.
- La pestaña **Eventos** de un dispositivo: lo que ese dispositivo ha notificado.

## Qué muestra la página de Eventos

- Los eventos del intervalo de tiempo, del más reciente al más antiguo. Cada fila dice qué pasó, en qué dispositivo, a qué - la interfaz, el túnel, la puerta de enlace - y con las propias palabras del dispositivo.
- **Problemas**, **Recuperaciones** e **Informativos**, cada uno con cuántos hay en el intervalo de tiempo. Haz clic en uno para ver solo esos.
- El selector **Todos los eventos** y, en la página de la red, el selector **Todos los dispositivos** acotan aún más la lista. El intervalo de tiempo y los filtros se guardan en la dirección de la página, así que un enlace abre exactamente la misma vista.
- Haz clic en un evento para abrirlo: cuándo ocurrió, de qué trata, el mensaje tal como lo envió el dispositivo, y cada atributo que OneUptime leyó en él.
- **Crear alerta** ofrece las alertas que quiere la mayoría de las redes, y **Crear alerta para este evento** crea una para el evento que has abierto. Consulta [Alertas](#alertas).

Un evento es un registro. Todo lo que hay en la página de Eventos también se puede buscar, graficar y usar para alertar desde **Registros**: un evento es un registro cuyo atributo `event.domain` es `network`, con lo que pasó en `event.name`.

## Qué lee OneUptime

El syslog en formato RFC 3164 y RFC 5424 y el Common Event Format (CEF) se leen de cualquier producto. Además, OneUptime sabe lo que escriben estos productos:

| Fabricante | Productos | Eventos que lee | Atributos |
| --- | --- | --- | --- |
| Cisco | IOS, IOS XE, NX-OS, ASA | Interfaces, Dispositivos, Alta disponibilidad, VPN, Enrutamiento, Hardware, Conmutación, Inicios de sesión | `cisco.*` |
| Sophos | Sophos Firewall (SFOS, XG, XGS) | Interfaces, Dispositivos, Alta disponibilidad, VPN, WAN, Inicios de sesión | `sophos.*` |
| Fortinet | FortiGate (FortiOS) | Interfaces, Dispositivos, Alta disponibilidad, VPN, WAN, Hardware, Inicios de sesión | `fortigate.*` |
| Extreme Networks | ExtremeXOS, Switch Engine | Interfaces, Dispositivos, Alta disponibilidad, Enrutamiento, Hardware, Conmutación, Inicios de sesión | `extreme.*` |
| Extreme Networks | Fabric Engine, VOSS | Interfaces, Enrutamiento | `extreme.*` |
| HPE Aruba Networking | AOS-CX | Interfaces, Hardware | `aruba.*` |
| HPE Aruba Networking | AOS-Switch (ArubaOS-Switch, ProCurve) | Interfaces | `aruba.*` |
| MikroTik | RouterOS | Interfaces, Dispositivos, Inicios de sesión | `mikrotik.*` |
| Cambium Networks | Enterprise Wi-Fi (cnPilot, XV, XE, XH) | Dispositivos, VPN, Wi-Fi | `cambium.*` |
| Ubiquiti | UniFi Network | Dispositivos, WAN, Conmutación, Inicios de sesión, Wi-Fi | `cef.*` |
| Cualquiera | Dispositivos basados en Linux (kernel, hostapd, OpenSSH, Dropbear) | Interfaces, Inicios de sesión, Wi-Fi | - |

Un mensaje en uno de estos formatos guarda sus propios campos como atributos bajo el prefijo de la última columna, así que `con_name="HQ-Branch1"` en un firewall Sophos es el atributo `sophos.con_name`. Un mensaje CEF de cualquier otro producto guarda su cabecera y sus campos de extensión bajo `cef.*`. Un mensaje que OneUptime no sabe ubicar se guarda igualmente como registro, con su cabecera syslog leída; puedes nombrar tú mismo sus eventos, consulta [Tus propios eventos](#tus-propios-eventos).

Los traps SNMP estándar se leen como los mismos eventos: `linkDown` y `linkUp` se convierten en **Interfaz caída** e **Interfaz activa**, `coldStart` y `warmStart` en **Dispositivo reiniciado**.

## Los eventos

Cada mensaje que OneUptime reconoce se guarda con uno de estos nombres en `event.name`, sea quien sea el fabricante del dispositivo:

| Evento | `event.name` | Tipo | Trata de |
| --- | --- | --- | --- |
| Interfaz caída | `interface.down` | Problema | `network.interface.name` |
| Interfaz activa | `interface.up` | Recuperación | `network.interface.name` |
| Puerto apagado por el switch | `interface.error_disabled` | Problema | `network.interface.name` |
| Dispositivo reiniciado | `device.reboot` | Problema | - |
| Configuración cambiada | `device.config_change` | Informativos | `user.name` |
| Dispositivo fuera de línea | `device.offline` | Problema | - |
| Dispositivo en línea | `device.online` | Recuperación | - |
| Conmutación por error | `ha.failover` | Problema | `ha.role` |
| Estado de alta disponibilidad cambiado | `ha.state_change` | Informativos | `ha.role` |
| Par de alta disponibilidad caído | `ha.peer_down` | Problema | `ha.peer` |
| Par de alta disponibilidad activo | `ha.peer_up` | Recuperación | `ha.peer` |
| Túnel VPN caído | `vpn.tunnel_down` | Problema | `vpn.tunnel.name` |
| Túnel VPN activo | `vpn.tunnel_up` | Recuperación | `vpn.tunnel.name` |
| Vecino de enrutamiento caído | `routing.neighbor_down` | Problema | `network.peer.address` |
| Vecino de enrutamiento activo | `routing.neighbor_up` | Recuperación | `network.peer.address` |
| Puerta de enlace caída | `gateway.down` | Problema | `network.gateway.name` |
| Puerta de enlace activa | `gateway.up` | Recuperación | `network.gateway.name` |
| Conmutación por error de WAN | `wan.failover` | Problema | `network.gateway.name` |
| Enlace SD-WAN por debajo de su SLA | `sdwan.sla_not_met` | Problema | `network.gateway.name` |
| Enlace SD-WAN de nuevo dentro de su SLA | `sdwan.sla_met` | Recuperación | `network.gateway.name` |
| Ventilador averiado | `hardware.fan_failed` | Problema | `hw.name` |
| El ventilador vuelve a funcionar | `hardware.fan_ok` | Recuperación | `hw.name` |
| Fuente de alimentación averiada | `hardware.power_supply_failed` | Problema | `hw.name` |
| La fuente de alimentación vuelve a funcionar | `hardware.power_supply_ok` | Recuperación | `hw.name` |
| Temperatura demasiado alta | `hardware.temperature_high` | Problema | - |
| Bucle detectado | `loop.detected` | Problema | `network.interface.name` |
| Cambio en la topología de spanning tree | `stp.topology_change` | Informativos | - |
| Fallo de PoE | `poe.fault` | Problema | `network.interface.name` |
| Inicio de sesión fallido | `auth.login_failed` | Problema | `user.name` |
| Sesión iniciada | `auth.login_success` | Informativos | `user.name` |
| Cliente Wi-Fi conectado | `wireless.client_connected` | Informativos | `client.mac` |
| Cliente Wi-Fi desconectado | `wireless.client_disconnected` | Informativos | `client.mac` |

La última columna es el atributo que dice de qué trata el evento. No todos los productos notifican todos los eventos: un switch no tiene túneles VPN, y el syslog de un producto solo dice lo que dice.

Cada evento lleva además:

| Atributo | Qué contiene |
| --- | --- |
| `event.domain` | `network`, en todos los eventos de red |
| `event.kind` | `problem`, `recovery` o `info` |
| `event.category` | `interface`, `device`, `ha`, `vpn`, `routing`, `wan`, `hardware`, `switching`, `security` o `wireless`, en los eventos de arriba |
| `event.device` | Qué dispositivo: su nombre en OneUptime, si no el nombre que se da a sí mismo, si no su dirección |
| `event.message` | Lo que dijo el dispositivo, con sus propias palabras |
| `syslog.vendor`, `syslog.parser` | En el formato de quién se leyó el mensaje |

## Cómo llegan aquí los eventos

Cada sonda escucha syslog en el puerto 5140, por UDP y por TCP. Por TCP un mensaje es una línea, o va precedido de su longitud, como describe la RFC 6587. La sonda reenvía a OneUptime lo que oye cada pocos segundos, y OneUptime asocia cada mensaje a un dispositivo por la dirección de la que vino:

1. un dispositivo que la sonda sondea cuyo nombre de host es esa dirección (o se resuelve en ella), o que la incluye en **Otras direcciones** en su página de **Ajustes**;
2. en tu propia sonda (personalizada), cualquier dispositivo del proyecto con esa dirección, o con el nombre de host que lleva el mensaje cuando exactamente un dispositivo tiene ese nombre;
3. si no, en tu propia sonda, el mensaje se guarda para la página de Eventos de la red, en **Envía syslog y aún no es un dispositivo**, hasta que digas a qué dispositivo pertenece. Una sonda global lo descarta.

Una línea de una dirección desconocida que no tiene prioridad syslog y no es un evento se toma por ruido y se descarta.

Un controlador habla por los dispositivos que gestiona: una consola UniFi informa sobre sus puntos de acceso y switches. Cuando un mensaje de un dispositivo nombra a otro dispositivo por su dirección MAC, su número de serie, su dirección o el nombre que le da su controlador, el evento va a ese dispositivo, y el registro conserva en `syslog.relay.name` el nombre del controlador que lo transmitió.

Un registro se guarda con la hora en que la sonda lo recibió. Un mensaje que estuvo retenido - su propia marca de tiempo está en formato RFC 5424, que indica su zona horaria, y tiene más de 5 minutos - conserva la hora del dispositivo, hasta 7 días atrás. Cualquier otra marca de tiempo que se aleje más de 5 minutos del reloj de la sonda no se da por buena: el registro se guarda con la hora en que se recibió, y la hora del dispositivo se conserva en `syslog.deviceTime`.

El syslog que envías al [endpoint de syslog](/docs/telemetry/syslog) por HTTPS lo leen los mismos analizadores. Allí un mensaje se convierte en un evento de red cuando está en el formato propio de un fabricante de red, o cuando nombra uno de tus dispositivos de red por dirección MAC, número de serie, dirección o nombre de host; las líneas de `sshd` de un servidor siguen siendo simples registros.

## Configuración

1. **Usa una sonda en la red del dispositivo.** El syslog lo envían tus dispositivos, así que necesitan una [sonda personalizada](/docs/probe/custom-probe) a la que puedan llegar. Una sonda global en internet público no lo recibirá.
2. **Deja que el syslog llegue a la sonda.** Permite el puerto 5140, UDP o TCP, desde los dispositivos hasta la sonda. Una sonda en Docker iniciada con la red del host (`--network host`), como muestra la página de la sonda personalizada, lo recibe tal cual; sin la red del host, publica el puerto con `-p 5140:5140/udp -p 5140:5140/tcp`. Para un dispositivo que solo puede enviar al puerto 514, publícalo como `-p 514:5140/udp`, o define `PROBE_SYSLOG_RECEIVER_PORT=514` en una sonda con la red del host.
3. **Configura la sonda como servidor syslog del dispositivo.** Los comandos para los dispositivos habituales están abajo. La página de **Eventos** muestra los mismos pasos hasta que llega el primer mensaje, y entonces se convierte por sí sola en la lista.
4. **Comprueba la dirección del dispositivo.** Los mensajes se asocian por la dirección desde la que envía el dispositivo. Si envía desde una loopback o una interfaz de gestión que no es su nombre de host, añade esa dirección a las **Otras direcciones** del dispositivo.

El receptor de syslog está activado de forma predeterminada. Sus ajustes son variables de entorno de la sonda:

| Variable | Qué hace | Predeterminado |
| --- | --- | --- |
| `PROBE_SYSLOG_RECEIVER_ENABLED` | Ponla en `false` para desactivar el receptor de syslog | `true` |
| `PROBE_SYSLOG_RECEIVER_PORT` | El puerto, para UDP y TCP | `5140` |
| `PROBE_SYSLOG_RATE_LIMIT_PER_MINUTE` | Mensajes reenviados por minuto, entre todos los dispositivos | `600` |

Pasado el límite, la sonda sigue reenviando los mensajes que lee como eventos de red, hasta otros tantos, para que una avalancha de líneas rutinarias no desplace a la que dice que un enlace se cayó. Una sonda anterior a esta función solo escucha cuando se inicia con `PROBE_SYSLOG_RECEIVER_ENABLED=true`, y solo por UDP: actualízala.

### Cisco IOS, IOS XE y NX-OS

```text
logging host <probe-address> transport udp port 5140
logging trap informational
service timestamps log datetime msec
```

La segunda línea envía los mensajes informativos y todo lo más grave: los cambios de enlace, los reinicios y los inicios de sesión están entre ellos. En NX-OS la línea es `logging server <probe-address> 6 port 5140 use-vrf management`.

### Sophos Firewall

1. En la administración web del firewall, abre **System services** > **Log settings** y, en **Syslog servers**, elige **Add**.
2. Introduce la dirección IP de la sonda y el puerto `5140`, y pon el nivel de gravedad en **Information**. Se lee cualquiera de los dos formatos de registro que ofrece el firewall.
3. De vuelta en **Log settings**, marca el nuevo servidor para los registros que quieres enviar: al menos los eventos del sistema, y **SD-WAN** para los cambios de SLA. Los registros de tráfico del firewall son muchos, así que déjalos fuera salvo que los quieras.

### Fortinet FortiGate

```text
config log syslogd setting
    set status enable
    set server "<probe-address>"
    set port 5140
    set mode udp
    set format default
end
```

FortiGate envía lo que seleccionan sus ajustes de registro. Los registros de eventos contienen los túneles, los enlaces y las conmutaciones por error; los registros de tráfico son muchos, así que déjalos fuera salvo que los quieras.

### Extreme Networks

```text
configure syslog add <probe-address>:5140 vr VR-Default local7
enable log target syslog <probe-address>:5140 vr VR-Default local7
enable syslog
```

Cambia `VR-Default` por el router virtual a través del cual se llega a la sonda.

### HPE Aruba

```text
logging <probe-address> udp 5140 severity info
```

En AOS-CX, añade `vrf mgmt` a la línea cuando se llega a la sonda por el puerto de gestión. En AOS-Switch la línea es `logging <probe-address> udp 5140`.

### MikroTik RouterOS

```text
/system logging action set remote remote=<probe-address> remote-port=5140
/system logging add topics=info action=remote
/system logging add topics=warning action=remote
/system logging add topics=error action=remote
/system logging add topics=critical action=remote
```

La primera línea apunta la acción remota integrada del router a la sonda; las demás eligen qué envía. Deja el formato de registro remoto como está.

### Ubiquiti UniFi

1. En UniFi Network, abre **Integration** > **System Logging / SIEM** y selecciona **SIEM Server** como destino.
2. Introduce la dirección IP de la sonda y el puerto `5140`, y elige las categorías de registro que quieres exportar.

La consola informa sobre los puntos de acceso y los switches que gestiona. Los eventos llegan a la página de cada dispositivo cuando el dispositivo está en OneUptime con su dirección MAC, y a la de la consola en caso contrario.

### Cambium Networks

1. En cnMaestro o en la interfaz web del punto de acceso, abre los ajustes del sistema y busca los servidores syslog.
2. Introduce la dirección IP de la sonda como servidor syslog, con el puerto `5140` donde el formulario pida un puerto, y pon la gravedad de syslog en **Info**.

Donde no hay puerto que configurar, el punto de acceso envía al puerto 514: publica ahí el puerto de la sonda, como muestra el paso 2 de [Configuración](#configuración).

### Otros dispositivos

Añade un servidor syslog remoto en el dispositivo: la dirección IP de la sonda, puerto 5140, por UDP o TCP, enviando los mensajes informativos y todo lo más grave. Un dispositivo cuyo formato OneUptime no conoce guarda igualmente sus mensajes, y puedes nombrar tú mismo sus eventos.

## Alertas

**Crear alerta**, en una página de Eventos, lista las alertas que quiere la mayoría de las redes. Cada una abre **Crear monitor** ya rellenado, donde puedes cambiar cualquier cosa antes de guardarlo:

| Alerta | Te avisa cuando | Una alerta por | Se cierra cuando |
| --- | --- | --- | --- |
| Se cae un túnel VPN | `vpn.tunnel_down` | dispositivo y túnel | `vpn.tunnel_up` para ese túnel |
| Un firewall o un switch conmuta por error | `ha.failover` | dispositivo | pasan 5 minutos sin otro |
| Se cae un enlace WAN | `gateway.down` | dispositivo y puerta de enlace | `gateway.up` para esa puerta de enlace |
| Se cae un vecino de enrutamiento | `routing.neighbor_down` | dispositivo y vecino | `routing.neighbor_up` para ese vecino |
| Se reinicia un dispositivo | `device.reboot` | dispositivo | pasan 5 minutos sin otro |
| Falla el hardware | un ventilador, una fuente de alimentación o la temperatura | dispositivo y componente | se notifica que el mismo componente vuelve a funcionar |
| Se cae una interfaz | `interface.down` | dispositivo e interfaz | `interface.up` para esa interfaz |
| Alguien no deja de fallar al iniciar sesión | más de 10 `auth.login_failed` en 5 minutos | dispositivo | pasan 5 minutos con 10 o menos |

Cada una es un [monitor de registros](/docs/monitor/logs-monitor) que cuenta el evento durante los últimos 5 minutos, con **Group by Attributes** configurado para que cada túnel, puerta de enlace o interfaz tenga su propia alerta, y con **Resuelto por atributos** configurado con el evento que dice que el problema ha terminado. Una alerta así sigue abierta hasta que ese evento llega para el mismo dispositivo y el mismo túnel, tarde lo que tarde; consulta [Resuelto por un registro](/docs/monitor/logs-monitor#resuelto-por-un-registro). OneUptime no lee ningún evento que diga que una temperatura ha vuelto a la normalidad, así que una alerta de temperatura sigue abierta hasta que la resuelvas.

Desde la pestaña **Eventos** de un dispositivo, los monitores vigilan solo ese dispositivo. Para cualquier otro evento, abre uno en la página de Eventos y haz clic en **Crear alerta para este evento**. Para enviar una alerta a algún sitio, o para avisar a alguien de guardia, añade al monitor una política de guardia o un flujo de trabajo, como en cualquier otro.

## Direcciones que aún no son dispositivos

El syslog puede llegar antes de que el dispositivo que lo envía se añada a OneUptime. En tu propia sonda se guarda, sus eventos están en la página de Eventos de la red con el nombre que el dispositivo se da a sí mismo, y su dirección aparece en **Envía syslog y aún no es un dispositivo**:

- **Añadir como dispositivo** abre **Añadir dispositivo** con la dirección y la sonda ya rellenadas. Los mensajes que ya llegaron se quedan en la página de la red; los nuevos van al dispositivo.
- **Es uno de mis dispositivos** añade la dirección a las **Otras direcciones** de un dispositivo: úsalo cuando un dispositivo que ya añadiste envía desde otra dirección, como una loopback. Sus mensajes van a ese dispositivo a partir del minuto siguiente.

Varios dispositivos detrás de una misma dirección NAT comparten esa dirección, así que sus mensajes van al único dispositivo que la tiene, salvo que un mensaje nombre a su propio dispositivo.

## Tus propios eventos

Un dispositivo cuyo formato OneUptime no conoce, o un evento que no lee, necesita una [canalización de registros](/docs/telemetry/log-pipelines):

1. Crea una canalización cuyo filtro coincida con los registros del dispositivo, como `attributes.networkDevice.name = 'rack-ups'`.
2. Añade un **Analizador Grok** o un **Key=Value Parser** para extraer del mensaje los campos que necesitas.
3. Añade un **Procesador de categorías** con **Atributo de destino** `event.name`, y una regla por evento. Nombra cada una como los eventos de arriba, en minúsculas con puntos o guiones bajos: `ups.on_battery`.

Un registro de un dispositivo de red que lleva un nombre así se convierte en un evento de red: está en las páginas de Eventos, y **Crear alerta para este evento** funciona con él. Para decir de qué trata, añade un **Reasignador de atributos** que copie tu campo a uno de los atributos de la tabla de eventos, como `hw.name`. A menos que tu canalización ponga `event.kind` en `problem` o `recovery`, el evento se lista en **Informativos**. Una regla con el nombre de un evento integrado, como `interface.down`, produce el evento integrado, con su tipo y sus alertas.

Una canalización pertenece a su proyecto. Para usar una en otro proyecto, créala allí con los mismos procesadores.

## Qué no se incluye

- **Syslog sobre TLS** (RFC 5425). La sonda acepta UDP y TCP sin cifrar; mantén el camino entre los dispositivos y la sonda en una red de confianza.
- **Compartir analizadores entre proyectos.** Una canalización todavía no se puede exportar e importar.
- **Eventos de traps SNMP distintos de los cuatro estándar.** Los traps propios de un fabricante se guardan como registros, y se alerta sobre ellos con el criterio **SNMP Trap Received (Trap OID)** del [monitor de dispositivos de red](/docs/monitor/network-device-monitor).
- **Switches Cambium cnMatrix, controladores de movilidad Aruba y FortiGate en modo CEF.** Sus mensajes se guardan y se pueden buscar; todavía no se leen eventos de ellos.
- **Un seguimiento en vivo.** La página de Eventos muestra lo que había llegado cuando se abrió; usa su botón de actualizar, o el seguimiento en vivo de **Registros**.

## Solución de problemas

Si una página de Eventos sigue mostrando sus pasos de configuración:

- **¿Recibe algo la sonda?** La página de Eventos de la red lista en **Envía syslog y aún no es un dispositivo** cada dirección que envió syslog en el intervalo de tiempo. Si el dispositivo está ahí, envía desde una dirección que no es su nombre de host: añade esa dirección a sus **Otras direcciones**.
- **Firewalls y Docker.** Permite el puerto 5140 desde el dispositivo hasta la sonda, y publica el puerto si la sonda se ejecuta en Docker. Muchos dispositivos envían al puerto 514 si no se les dice otra cosa.
- **El registro de la sonda.** Al arrancar, la sonda anota en su registro el puerto en el que escucha, o que no pudo abrirlo. Cuando descarta mensajes por superar `PROBE_SYSLOG_RATE_LIMIT_PER_MINUTE`, anota cuántos, una vez por minuto.
- **Una sonda global.** Un dispositivo sondeado por una sonda global no puede enviarle syslog desde una red privada. Ejecuta una sonda personalizada en la red del dispositivo y elígela en la configuración del dispositivo.
- **Llegan mensajes, pero no eventos.** La página lo dice, y cada mensaje está en la pestaña **Registros** del dispositivo. Comprueba que el dispositivo envía los mensajes informativos, no solo los errores, y que el producto es uno de los de [Qué lee OneUptime](#qué-lee-oneuptime); si no, nombra sus eventos en una canalización de registros.
