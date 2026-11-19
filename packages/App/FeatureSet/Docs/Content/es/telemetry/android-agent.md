# Agente de Android

El agente de Android de OneUptime informa a OneUptime sobre un dispositivo Android que pertenece a tu organización, como un quiosco de pedidos, un terminal de punto de venta, un terminal portátil o un reproductor de cartelería digital: su memoria, su almacenamiento, su red, su batería y su temperatura, sus reinicios, las aplicaciones instaladas en él, y los fallos y registros de esas aplicaciones. Tu gestor de dispositivos lo instala y lo configura en toda la flota a la vez. Cada dispositivo se convierte en un host en **Hosts** y en un elemento en **Inventario**, junto a tus servidores y equipos Windows.

:::cards
- [Cuándo usarlo](#el-agente-o-la-instrumentación-de-la-aplicación): El agente ve el dispositivo; la instrumentación de la aplicación ve tu aplicación.
- [Desplegarlo con Esper](#desplegarlo-con-esper): Subir el APK, enviar sus ajustes, iniciarlo una vez.
- [Ajustes](#ajustes): Cada clave de su configuración gestionada.
- [Leer los registros de otras aplicaciones](#leer-los-registros-de-otras-aplicaciones): Conceder READ_LOGS una vez, con adb o con tu gestor de dispositivos.
:::

## Cómo funciona

El agente es una pequeña aplicación que se ejecuta como servicio en primer plano. Cada minuto lee el estado del dispositivo y lo envía a tu instancia de OneUptime por OTLP con una clave de ingesta de **Servidor**, junto con los reinicios, las aplicaciones instaladas y los registros del dispositivo. Se inicia solo cuando el dispositivo arranca, conserva en el dispositivo lo que recopila mientras la red está caída y lo envía en cuanto vuelve la red. Nunca mantiene despierto un dispositivo en reposo, y comprime lo que envía.

```mermaid title="De tu flota a OneUptime"
flowchart TB
    mdm["Tu MDM:<br/>Esper, Intune, SOTI"] -->|"lo instala y<br/>lo configura"| agent["Agente de Android<br/>en cada dispositivo"]
    agent -->|"OTLP con una<br/>clave de Servidor"| oneuptime["OneUptime"]
    oneuptime --> hosts["Hosts e Inventario"]
    oneuptime --> logs["Registros y Excepciones"]
```

## El agente o la instrumentación de la aplicación

| | [OpenTelemetry Android](/docs/rum/android-setup) en tu aplicación | El agente de Android |
| --- | --- | --- |
| Qué ve | Tu aplicación: sus fallos, ANR, pantallas, sesiones, solicitudes y flujos de trabajo | El dispositivo: memoria, almacenamiento, red, batería, reinicios, aplicaciones instaladas, y los fallos y ANR de todas las aplicaciones |
| Dónde aparece | **Monitoreo de usuarios reales**, **Trazas** y **Excepciones** | **Hosts**, **Inventario**, **Registros** y **Excepciones** |
| Cómo se instala | En el código de tu aplicación | Como aplicación, a través de tu gestor de dispositivos |

En los dispositivos que son tuyos, usa ambos y da al dispositivo el mismo nombre en los dos: en el ajuste `device_name` del agente y en el `host.name` que define tu aplicación. El dispositivo es entonces un único elemento en **Inventario**, que reúne la telemetría de la aplicación y la del dispositivo.

## Antes de empezar

- Dispositivos con Android 7.0 o posterior, administrados por un gestor de dispositivos compatible con las configuraciones gestionadas de Android: Esper, Microsoft Intune, Workspace ONE, SOTI y otros gestores de dispositivos de Android Enterprise. Para un solo dispositivo, basta con adb.
- Una clave de ingesta de **Servidor**, creada en **Ajustes del proyecto → Telemetría y APM → Claves de ingesta** con **Crear clave de ingesta**.
- El agente: `oneuptime-android-agent.apk`, adjunto a cada [versión de OneUptime](https://github.com/OneUptime/oneuptime/releases/latest).
- HTTPS saliente desde los dispositivos hacia tu URL de OneUptime. El agente rechaza cualquier URL que no empiece por `https://`, porque cada solicitud lleva la clave de ingesta.

## Desplegarlo con Esper

:::steps
### Subir el APK

En la consola de Esper, sube `oneuptime-android-agent.apk` a la **App Library** y añádelo al blueprint de los dispositivos que quieras monitorear.

### Enviar sus ajustes

En el blueprint, abre la **Managed Configuration** del agente y pega sus ajustes. Esper rellena los marcadores de posición en cada dispositivo, con Esper Agent 8.00.0764 o posterior:

```json title="Managed configuration"
{
  "oneuptime_url": "https://oneuptime.com",
  "oneuptime_token": "YOUR_TELEMETRY_INGESTION_TOKEN",
  "device_name": "${esper.deviceName}",
  "device_serial": "${esper.serialNumber}",
  "device_type": "kiosk",
  "labels": "region=emea"
}
```

Si alojas OneUptime tú mismo, pon tu propia URL en `oneuptime_url`. Después haz Converge en los dispositivos para que lean los nuevos ajustes.

### Iniciarlo una vez

Android no inicia al arrancar una aplicación recién instalada hasta que se ha abierto una vez. Activa **Launch on Start** para el agente en el blueprint, en modo Multi-App, o abre el agente una vez en cada dispositivo. A partir de entonces se inicia solo cada vez que el dispositivo arranca, y después de cada actualización.

### Encontrar los dispositivos en OneUptime

En menos de un minuto, cada dispositivo aparece en **Hosts**, con el nombre de su `device_name`, y en **Inventario**. La propia pantalla del agente en el dispositivo indica si está informando y, si no, qué se lo impide.
:::

Otros gestores de dispositivos funcionan igual: añade el APK como aplicación de línea de negocio o como aplicación interna, define las mismas claves en su configuración de aplicación y ábrela una vez en cada dispositivo.

## Ajustes

El agente lee estas claves de su configuración gestionada. Un dispositivo sin configuración gestionada se puede configurar en su lugar desde la propia pantalla del agente, con la URL, la clave de ingesta y el nombre del dispositivo. Una clave de ingesta introducida ahí se guarda cifrada con el Android Keystore.

| Clave | Qué define | Valor predeterminado |
| --- | --- | --- |
| `oneuptime_url` | Tu URL de OneUptime | `https://oneuptime.com` |
| `oneuptime_token` | Una clave de ingesta de **Servidor** | Ninguno: sin una clave, el agente no envía nada |
| `device_name` | El nombre del dispositivo en **Hosts** e **Inventario**, que es su identidad allí | Su modelo y el principio de su Android ID |
| `device_serial` | Su número de serie, que Android no da a las aplicaciones a partir de Android 10 | Ninguno |
| `device_type` | Qué es, como un quiosco, un terminal de punto de venta o un terminal portátil | `Android device` |
| `device_location` | Dónde está, como el número de una tienda | Ninguno |
| `labels` | Etiquetas para el host, como pares `name=value` separados por comas | Ninguno |
| `collection_interval_seconds` | Con qué frecuencia informa, de 30 a 600 segundos | `60` |
| `logcat_enabled` | Si envía lo que lee de Logcat | `true` |
| `logcat_min_level` | Las líneas de Logcat menos graves que envía en Android 12 y anteriores: `verbose`, `debug`, `info`, `warn`, `error` o `fatal` | `warn` |
| `installed_apps_enabled` | Si envía las aplicaciones instaladas | `true` |

Un marcador de posición que tu gestor de dispositivos no rellenó, como un `${esper.deviceName}` enviado tal cual, se ignora, y la pantalla del agente lo indica. Mantén el mismo `device_name` una vez que un dispositivo informa: un nombre nuevo es un host nuevo.

## Leer los registros de otras aplicaciones

Android solo permite que una aplicación lea los registros de otras aplicaciones con el permiso READ_LOGS, y solo adb puede concederlo: ni la propia aplicación ni una política de dispositivo. Concédelo una vez en cada dispositivo y seguirá concedido tras reinicios y actualizaciones:

```bash
adb shell pm grant com.oneuptime.androidagent android.permission.READ_LOGS
```

Con Esper, ejecuta ese comando mediante **Secure Remote ADB**: activa el acceso ADB para el dispositivo, conéctate con `espercli secureadb connect -d DEVICE_ID` y luego ejecuta el comando. Android reinicia el agente cuando se concede el permiso, y el agente empieza a leer de inmediato.

Lo que el agente lee a partir de entonces depende de la versión de Android:

- Android 13 y posteriores: los fallos y ANR de todas las aplicaciones. Android solo muestra las líneas de registro de otras aplicaciones a una aplicación que está en pantalla, después de que la persona frente al dispositivo lo permita, así que un agente que se ejecuta en segundo plano no puede leerlas.
- Android 12 y anteriores: los fallos y ANR de todas las aplicaciones, y las líneas de registro de todas las aplicaciones de nivel `logcat_min_level` o superior.

Sin READ_LOGS, el agente informa de todo lo demás, y su pantalla y los registros del dispositivo indican cómo concederlo.

## Qué informa el agente

| Qué | Dónde aparece en OneUptime |
| --- | --- |
| Memoria, almacenamiento, red y tiempo de actividad | La página del dispositivo en **Hosts**: las mismas métricas que envía el colector de un servidor, así que las plantillas de alerta de host funcionan |
| Carga de la batería y temperatura, y si el dispositivo está conectado a una fuente de alimentación externa | Las métricas `hw.battery.charge`, `hw.temperature` y `android.battery.plugged` |
| Estado térmico | Las métricas `android.thermal.status` y `android.thermal.headroom` |
| Reinicios | **Registros**, con `@event.name:device.boot`: cuánto tiempo llevaba encendido el dispositivo, si se apagó correctamente, cuánto tiempo estuvo apagado, y los bucles de reinicio |
| Aplicaciones instaladas | **Registros**, con `@event.name:android.package.inventory` una vez al día, y con cada instalación, actualización y desinstalación |
| Fallos y ANR de todas las aplicaciones | **Excepciones**, como no controlados, con el nombre de la aplicación |
| Marca, modelo, número de serie, versión del sistema operativo y firmware | El elemento del dispositivo en **Inventario** |

A partir de Android 8, Android oculta a las aplicaciones el uso de CPU del dispositivo, así que el agente solo informa del uso de CPU en Android 7 y en las compilaciones que lo permiten.

Las plantillas de alerta de host adecuadas para un dispositivo son Host Stopped Reporting, High Memory Utilization, High Filesystem Usage y Host Restarted. Un dispositivo que se reinicia una y otra vez registra una advertencia en cada arranque, con `android.boot.recent_count` igual al número de arranques de la última hora.

## Solución de problemas

:::details Un dispositivo no aparece en Hosts
Abre el agente en el dispositivo: su pantalla indica qué falta, como una clave de ingesta, una URL que no puede usar, o un envío que falló y por qué. En un dispositivo en el que el agente nunca se abrió después de instalarse, el agente no se ha iniciado: ábrelo una vez o activa **Launch on Start**.
:::

:::details El agente dice que OneUptime rechazó la clave de ingesta
Usa una clave de **Servidor** que esté activada y no haya caducado. Una clave de **Navegador** se rechaza desde un dispositivo.
:::

:::details No llegan registros de otras aplicaciones
Concede READ_LOGS, como explica [Leer los registros de otras aplicaciones](#leer-los-registros-de-otras-aplicaciones). En Android 13 y posteriores solo se leen los fallos y ANR de otras aplicaciones.
:::

:::details Dos dispositivos aparecen como un solo host
Tienen el mismo `device_name`. Usa un marcador de posición que cambie de un dispositivo a otro, como `${esper.deviceName}` o `${esper.serialNumber}`.
:::

## Próximos pasos

:::cards
- [Configuración para Android](/docs/rum/android-setup): Instrumentar tu propia aplicación con OpenTelemetry Android.
- [Hosts](/docs/telemetry/hosts): Las páginas, lecturas y alertas de un host.
- [Monitor de hosts](/docs/monitor/host-monitor): Recibir una alerta cuando un dispositivo deja de informar o se queda sin almacenamiento.
- [Excepciones](/docs/telemetry/exceptions): Clasificar los fallos y ANR que informan tus dispositivos.
:::
