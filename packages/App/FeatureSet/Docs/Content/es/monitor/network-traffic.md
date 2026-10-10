# Tráfico de red (NetFlow, IPFIX y sFlow)

Los routers, firewalls y switches pueden describir el tráfico que pasa por ellos como **registros de flujo**: quién habló con quién, con qué protocolo y puertos, por qué interfaces y cuántos bytes. Apunta esa exportación a una sonda de OneUptime y las páginas de **Tráfico** muestran adónde va tu tráfico: las direcciones, conversaciones, aplicaciones e interfaces más activas, en cualquier intervalo de tiempo.

Hay una página de Tráfico en tres lugares:

- **Red** -> **Tráfico**: toda la red, los flujos de cada dispositivo en una sola página, y cada dirección que envía flujos sin ser todavía un dispositivo.
- La página de **Tráfico** de un sitio: los dispositivos de ese sitio.
- La pestaña **Tráfico** de un dispositivo: ese dispositivo, con sus interfaces. Las capturas de paquetes que se ejecutan en la sonda del dispositivo aparecen bajo los flujos, para cuando necesites los propios paquetes.

## Qué muestra la página de Tráfico

- Cuatro cifras para el intervalo: **Tráfico** (bytes), la tasa **Promedio** y **Pico**, y **Flujos** (cuántos registros de flujo enviaron los dispositivos).
- **Tráfico a lo largo del tiempo**, en bits por segundo. Arrastra sobre el gráfico para ampliar un tramo; haz doble clic en él, o usa **Restablecer zoom**, para volver.
- **Orígenes principales** y **Destinos principales**: las diez direcciones que más enviaron y más recibieron.
- **Aplicaciones principales**: el tráfico por protocolo y puerto de servicio, con el nombre del servicio que suele estar en ese puerto (HTTPS es el puerto TCP 443).
- **Interfaces principales** en la página de un dispositivo: lo que entró y salió por cada interfaz, con su nombre y velocidad del recorrido SNMP del dispositivo. **Dispositivos principales** en la página de un sitio y en la de la red.
- **Conversaciones principales**: los diez pares de direcciones más activos, dibujados como un diagrama de emisores a receptores, o como una lista.

Haz clic en cualquier fila - una dirección, una aplicación, una interfaz, un dispositivo, una banda del diagrama - y toda la página se limita a ese tráfico. Una etiqueta sobre la página dice a qué está limitada; haz clic en su x para ampliarla de nuevo. **Buscar una dirección IP** limita la página al tráfico hacia o desde una dirección. El intervalo de tiempo y los filtros se guardan en la dirección de la página, así que un enlace abre exactamente la misma vista.

## Cómo llegan los flujos

Cada sonda ejecuta un recolector de flujos. Escucha en tres puertos UDP, y cada puerto lee cada formato:

| Puerto   | Se usa normalmente para     |
| -------- | --------------------------- |
| UDP 2055 | NetFlow v5, NetFlow v9      |
| UDP 4739 | IPFIX                       |
| UDP 6343 | sFlow v5                    |

La sonda decodifica los registros, vuelve a multiplicar los conteos muestreados por la tasa de muestreo, suma los registros de una misma conversación cada pocos segundos y los envía a OneUptime. Cada registro se asocia a un dispositivo por la dirección desde la que su dispositivo lo envía - en sFlow, la dirección del agente en el datagrama:

1. un dispositivo que la sonda sondea cuyo nombre de host es esa dirección (o se resuelve en ella), o que la incluye en **Otras direcciones** en su página de **Ajustes**;
2. en tu propia sonda (personalizada), cualquier dispositivo del proyecto con esa dirección como nombre de host o entre sus otras direcciones;
3. si no, en tu propia sonda, los flujos se guardan para la página de Tráfico de la red, en **Emisores de flujos**, hasta que digas a qué dispositivo pertenecen. Una sonda global los descarta.

Los flujos se guardan 30 días, y una página muestra como máximo 31 días.

## Configuración

1. **Usa una sonda en la red del dispositivo.** Los flujos son datagramas UDP que envían tus dispositivos, así que necesitan una [sonda personalizada](/docs/probe/custom-probe) a la que puedan llegar. Una sonda global en internet público no los recibirá.
2. **Deja que los datagramas lleguen a la sonda.** Permite UDP 2055, 4739 y 6343 desde los dispositivos hasta la sonda. Una sonda en Docker iniciada con la red del host (`--network host`), como muestra la página de la sonda personalizada, los recibe tal cual; sin la red del host, publica los puertos con `-p 2055:2055/udp -p 4739:4739/udp -p 6343:6343/udp`.
3. **Activa la exportación de flujos en el dispositivo** y envíala a la dirección IP de la sonda. Los comandos para los dispositivos habituales están abajo. La pestaña **Tráfico** del dispositivo muestra los mismos pasos con los puertos de la sonda hasta que llega el primer flujo.
4. **Comprueba la dirección del dispositivo.** Los registros se asocian por la dirección desde la que envía el dispositivo. Si envía desde una loopback o una interfaz de gestión que no es su nombre de host, añade esa dirección a las **Otras direcciones** del dispositivo.

El recolector está activado de forma predeterminada. Sus ajustes son variables de entorno de la sonda:

| Variable                            | Qué hace                                                            | Predeterminado |
| ----------------------------------- | ------------------------------------------------------------------- | ------- |
| PROBE_NETFLOW_RECEIVER_ENABLED      | Ponla en `false` para desactivar el recolector de flujos            | true    |
| PROBE_NETFLOW_RECEIVER_PORT         | El puerto de NetFlow; `0` deja de escuchar en él                    | 2055    |
| PROBE_IPFIX_RECEIVER_PORT           | El puerto de IPFIX; `0` deja de escuchar en él                      | 4739    |
| PROBE_SFLOW_RECEIVER_PORT           | El puerto de sFlow; `0` deja de escuchar en él                      | 6343    |
| PROBE_NETFLOW_RATE_LIMIT_PER_MINUTE | Datagramas aceptados por minuto, entre todos los dispositivos y puertos | 6000    |

### Cisco IOS XE (Flexible NetFlow)

Exporta IPFIX a UDP 4739. Añade la última línea a cada interfaz cuyo tráfico quieras ver: medir el tráfico a medida que entra en cada interfaz cuenta cada conversación una sola vez.

```text
flow exporter ONEUPTIME
 destination <probe-address>
 source Loopback0
 transport udp 4739
 export-protocol ipfix
 template data timeout 60
 option interface-table
 option sampler-table
!
flow monitor ONEUPTIME
 exporter ONEUPTIME
 cache timeout active 60
 record netflow ipv4 original-input
!
interface GigabitEthernet0/0/0
 ip flow monitor ONEUPTIME input
```

### Cisco IOS (NetFlow v9)

Exporta NetFlow v9 a UDP 2055.

```text
ip flow-export version 9
ip flow-export destination <probe-address> 2055
ip flow-export source Loopback0
ip flow-export template timeout-rate 1
ip flow-cache timeout active 1
!
interface GigabitEthernet0/0
 ip flow ingress
```

### Arista EOS (sFlow)

Exporta sFlow a UDP 6343. sFlow muestrea un paquete de cada N (aquí 16384), y las páginas de Tráfico vuelven a multiplicar las muestras, así que las cifras son estimaciones.

```text
sflow sample 16384
sflow destination <probe-address> 6343
sflow source-interface Loopback0
sflow run
```

### Cisco Meraki MX y Z

Los appliances MX y las pasarelas de teletrabajo de la serie Z exportan NetFlow v9 desde el panel de Meraki:

1. Abre **Network-wide** > **General** y busca **Reporting**.
2. Pon **NetFlow traffic reporting** en **Enabled: send NetFlow traffic statistics**.
3. Introduce la dirección IP de la sonda como **NetFlow collector IP** y `2055` como **NetFlow collector port**, y guarda.

Un MX o un Z solo ve el tráfico que pasa por él. El tráfico que un switch mantiene dentro de una VLAN nunca le llega, así que no está en la exportación.

### Juniper (J-Flow en línea)

Exporta IPFIX a UDP 4739 desde routers MX; usa la FPC que lleva las interfaces que muestreas.

```text
set services flow-monitoring version-ipfix template ONEUPTIME ipv4-template
set services flow-monitoring version-ipfix template ONEUPTIME flow-active-timeout 60
set services flow-monitoring version-ipfix template ONEUPTIME template-refresh-rate seconds 60
set chassis fpc 0 sampling-instance ONEUPTIME
set forwarding-options sampling instance ONEUPTIME input rate 1
set forwarding-options sampling instance ONEUPTIME family inet output flow-server <probe-address> port 4739
set forwarding-options sampling instance ONEUPTIME family inet output flow-server <probe-address> version-ipfix template ONEUPTIME
set forwarding-options sampling instance ONEUPTIME family inet output inline-jflow source-address <device-address>
set interfaces ge-0/0/0 unit 0 family inet sampling input
```

### Fortinet FortiGate

Exporta NetFlow v9 a UDP 2055. En FortiOS 7.2 y posteriores, el recolector es una entrada bajo `config collectors` dentro de `config system netflow`.

```text
config system netflow
    set collector-ip <probe-address>
    set collector-port 2055
    set template-tx-timeout 60
end
config system interface
    edit "port1"
        set netflow-sampler both
    next
end
```

### Palo Alto Networks

1. En **Device** > **Server Profiles** > **NetFlow**, añade un perfil con la dirección IP de la sonda y el puerto `2055`, y pon el **Active Timeout** en 1 minuto.
2. En **Network** > **Interfaces**, abre cada interfaz cuyo tráfico quieras ver y elige el perfil como su **NetFlow Profile** en la pestaña **Advanced**.
3. Confirma los cambios (commit).

### MikroTik RouterOS 7

```text
/ip traffic-flow set enabled=yes interfaces=all active-flow-timeout=1m
/ip traffic-flow target add dst-address=<probe-address> port=2055 version=9
```

### pfSense y hosts Linux

En pfSense, instala el paquete **softflowd** y, en **Services** > **softflowd**, elige las interfaces, introduce la dirección IP de la sonda y el puerto `2055`, y elige NetFlow versión 9. En un host Linux, ejecuta softflowd en la interfaz cuyo tráfico quieras ver:

```bash
softflowd -i eth0 -n <probe-address>:2055 -v 9 -t maxlife=60
```

### Otros dispositivos

Envía NetFlow v5, NetFlow v9 o IPFIX a la dirección IP de la sonda en UDP 2055 (o 4739), o sFlow v5 en UDP 6343. Ajusta el tiempo de espera activo de los flujos del dispositivo a 60 segundos y, para NetFlow v9 e IPFIX, envía sus plantillas cada 60 segundos. Las [guías de fabricantes de red](/docs/monitor/network-vendor-guides) cubren Sophos y Extreme Networks.

## Direcciones que aún no son dispositivos

Los flujos pueden llegar antes de que el dispositivo que los envía se añada a OneUptime. En tu propia sonda se guardan, y la página de Tráfico de la red lista su dirección en **Emisores de flujos**, marcada como **Aún no es un dispositivo**:

- **Añadir como dispositivo** abre Añadir dispositivo con la dirección y la sonda ya rellenadas. Los flujos que ya llegaron se quedan en la página de la red; los nuevos van al dispositivo.
- **Es uno de mis dispositivos** añade la dirección a las **Otras direcciones** de un dispositivo: úsalo cuando un dispositivo que ya añadiste envía desde otra dirección, como una loopback. Sus flujos van a ese dispositivo a partir del minuto siguiente.

Varios dispositivos detrás de una misma dirección NAT comparten esa dirección, así que sus flujos van al único dispositivo que la tiene.

## Cómo leer las cifras

- **Muestreo.** Un dispositivo que muestrea - sFlow siempre lo hace, y NetFlow o IPFIX pueden hacerlo - informa un paquete de cada N. La sonda multiplica los conteos por N, así que la página muestra estimaciones, y lo dice bajo las cuatro cifras. Son precisas con mucho tráfico y aproximadas con pocos paquetes.
- **Contado dos veces.** El tráfico que pasa por dos dispositivos exportadores lo informan ambos. La página de un dispositivo lo cuenta una vez; la de un sitio o la de la red lo cuenta una vez por cada dispositivo que lo informó.
- **Aplicaciones.** Una aplicación es el protocolo y el puerto de servicio, con el nombre del servicio que suele estar en ese puerto. No es una inspección profunda de paquetes: HTTPS en el puerto 9443 aparece como puerto TCP 9443. Se omite el puerto efímero del cliente, así que mil conexiones de navegador a un servidor son una sola aplicación.
- **Pico** es la tasa del tramo más activo del gráfico, así que un intervalo más corto, con tramos más cortos, muestra un pico más marcado. **Promedio** son los bytes en todo el intervalo.
- **Tiempo.** Un flujo cuenta en el tramo en que empezó. Una descarga larga se informa como varios flujos, uno por cada minuto que dura; por eso el tiempo de espera activo de los dispositivos debería ser de 60 segundos.

## Qué no se incluye

- **Alertas sobre flujos.** Todavía no hay un monitor basado en flujos. Para alertar de un enlace saturado, usa las alertas de utilización de interfaz del [monitor de dispositivos de red](/docs/monitor/network-device-monitor), que leen SNMP.
- **Nombres de aplicaciones más allá del puerto.** No hay inspección profunda de paquetes, y no se leen los nombres de aplicaciones de Cisco NBAR.
- **La API del panel de Meraki.** Los análisis de tráfico de Meraki no se importan; los appliances MX y Z envían NetFlow a la sonda en su lugar.
- **Detección de anomalías** en el tráfico.
- **Nombres de interfaces desde los registros de flujo.** Los nombres y velocidades de las interfaces vienen del recorrido SNMP del dispositivo; un dispositivo que no se recorre muestra números de interfaz.

## Solución de problemas

Si la página de Tráfico sigue mostrando sus pasos de configuración:

- **¿Recibe algo la sonda?** La página de Tráfico de la red lista en **Emisores de flujos** cada dirección que envió flujos en la última hora. Si el dispositivo aparece ahí como **Aún no es un dispositivo**, envía desde una dirección que no es su nombre de host: añade esa dirección a sus **Otras direcciones**.
- **Firewalls y Docker.** Permite UDP 2055, 4739 y 6343 desde el dispositivo hasta la sonda, y publica los puertos si la sonda se ejecuta en Docker.
- **El registro de la sonda.** Una vez por minuto la sonda registra lo que no pudo leer: datagramas en un formato no compatible (NetFlow v1, v6, v7 u v8, o sFlow anterior a la versión 5), datagramas mal formados, datos a la espera de una plantilla y datagramas descartados por encima de `PROBE_NETFLOW_RATE_LIMIT_PER_MINUTE`.
- **Plantillas.** NetFlow v9 e IPFIX envían la estructura de sus registros como plantillas. La sonda guarda hasta 10 minutos los datos que llegan antes de su plantilla; configura el dispositivo para que envíe sus plantillas cada 60 segundos y la página se llene en menos de un minuto.
- **Una sonda global.** Un dispositivo sondeado por una sonda global no puede enviarle flujos desde una red privada. Ejecuta una sonda personalizada en la red del dispositivo y elígela en la configuración del dispositivo.
