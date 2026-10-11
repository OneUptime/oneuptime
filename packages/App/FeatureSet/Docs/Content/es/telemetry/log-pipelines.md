# Canalizaciones de registros

Las canalizaciones de registros transforman los registros mientras OneUptime los ingiere, antes de guardarlos. Una canalización tiene un **filtro** que decide a qué registros se aplica y una lista ordenada de **procesadores** que modifican esos registros: extraer campos del mensaje, corregir la gravedad, renombrar un atributo o etiquetar el registro con una categoría.

Las canalizaciones están en **Registros → Ajustes → Canalizaciones**.

:::cards
- [Cómo se ejecuta una canalización](#cómo-se-ejecuta-una-canalización): Dónde se sitúan las canalizaciones en la ingesta y en qué orden se ejecutan.
- [Crear una canalización](#crear-una-canalización): Seleccionar algunos registros y añadirles procesadores.
- [Key=Value Parser](#keyvalue-parser): Convertir líneas de firewall y logfmt en atributos.
- [Ejemplo: firewall Sophos XGS](#ejemplo-firewall-sophos-xgs): Analizar el syslog de un firewall de principio a fin.
:::

## Cómo se ejecuta una canalización

Las canalizaciones se ejecutan sobre cada registro que OneUptime ingiere, ya sean registros de OpenTelemetry, syslog o Fluentd, después de los filtros de descarte y las reglas de depuración, y antes de guardar el registro:

```mermaid title="Dónde se ejecutan las canalizaciones mientras se ingiere un registro"
flowchart TB
    arrive["Llega el registro"] --> drop{"¿Coincide con un<br/>filtro de descarte?"}
    drop -->|"sí"| discarded["Descartado"]
    drop -->|"no"| scrub["Las reglas de depuración<br/>enmascaran datos"]
    scrub --> filter{"¿Coincide el filtro de la<br/>siguiente canalización?"}
    filter -->|"sí"| processors["Ejecutar sus procesadores en orden"]
    filter -->|"no"| more{"¿Más canalizaciones?"}
    processors --> more
    more -->|"sí"| filter
    more -->|"no"| stored["El registro se guarda"]
```

- **Las canalizaciones se ejecutan en orden**: el de la lista, que se cambia arrastrando las filas. Una canalización solo toca los registros con los que coincide su filtro, y se ejecuta toda canalización cuyo filtro coincida, no solo la primera.
- **Los procesadores también se ejecutan en orden**, y cada uno ve lo que produjo el anterior, así que un analizador tiene que ir antes que un procesador que lee los campos que él extrae. El filtro de una canalización posterior también ve lo que cambiaron las anteriores.
- **El procesamiento ocurre en la ingesta.** Cambiar una canalización afecta a los registros que llegan después, en aproximadamente un minuto; los registros ya guardados no se vuelven a procesar.
- **Un procesador nunca descarta ni vacía un registro.** Una línea que un analizador no puede leer pasa sin cambios. Para descartar registros, use **Registros → Ajustes → Filtros de descarte**.
- **Solo se ejecutan las canalizaciones y los procesadores habilitados.** Desactive uno en su página para pausarlo sin perder su configuración.

## Tipos de procesador

| Procesador | Qué hace |
| --- | --- |
| Analizador Grok | Extrae campos de una línea con forma fija (una línea de acceso de nginx) mediante un patrón con nombre. |
| Key=Value Parser | Divide una línea de pares `key=value` (Sophos XGS, Fortinet, logfmt) en atributos, en cualquier orden. |
| Reasignador de gravedad | Asigna un nivel en bruto como `warn`, leído de un atributo, a la gravedad estándar del registro. |
| Reasignador de atributos | Renombra o copia un atributo, por ejemplo `src_ip` a `source_ip`. |
| Procesador de categorías | Etiqueta un registro con un nombre de categoría cuando coincide con un filtro, por ejemplo «Payment Error». |

## Antes de empezar

- Registros que lleguen a OneUptime, por [OpenTelemetry](/docs/telemetry/open-telemetry), [syslog](/docs/telemetry/syslog), [Fluentd](/docs/telemetry/fluentd) o una sonda.
- Permiso para cambiar canalizaciones. Los propietarios y administradores del proyecto lo tienen; los demás necesitan los permisos **Create Log Pipeline** y **Create Log Pipeline Processor**.

## Crear una canalización

:::steps
### Crear la canalización

Vaya a **Registros → Ajustes → Canalizaciones** y haga clic en **Crear Canalización de registros**. Póngale un **Nombre**, como *Analizar registros del firewall*, y créela. Se abre la página de la canalización.

### Elegir a qué registros se aplica

En **Condiciones de filtro**, haga clic en **Editar** y añada condiciones sobre **Gravedad**, **Cuerpo del registro**, **ID del servicio** o un atributo personalizado. Únalas con **Todas las condiciones** o **Cualquier condición** y haga clic en **Guardar cambios**. Una canalización sin condiciones se aplica a todos los registros.

### Añadir procesadores

En **Procesadores**, haga clic en **Añadir procesador**, escriba un **Nombre del procesador**, elija un **Tipo de procesador** y rellene sus ajustes. Los analizadores Grok y Key=Value tienen un probador: pegue una línea de ejemplo para ver qué extraerían. Haga clic en **Crear procesador**.

### Ordenarlos

Arrastre los procesadores para cambiar el orden en que se ejecutan, y arrastre las canalizaciones de la lista **Canalizaciones** del mismo modo. Los registros nuevos se procesan en aproximadamente un minuto.
:::

### Condiciones de filtro

Cada condición compara un campo con un valor. Detrás del generador, el filtro es una consulta como `severityText = 'Error' AND body LIKE 'timeout'`, que muestra **Previsualizar consulta**.

| Operador | En la consulta | Notas |
| --- | --- | --- |
| es igual a | `=` | Exacto y distingue mayúsculas y minúsculas. |
| no es igual a | `!=` | Exacto y distingue mayúsculas y minúsculas. |
| contiene | `LIKE` | No distingue mayúsculas y minúsculas. `%` en el valor es un comodín. |
| es uno de | `IN` | Una lista de valores exactos separados por comas. |

Los valores de gravedad son `Fatal`, `Error`, `Warning`, `Information`, `Debug`, `Trace` y `Unspecified`, así que `severityText = 'Error'` coincide y `'ERROR'` nunca lo hará. Un atributo personalizado se escribe `attributes.<key>`, por ejemplo `attributes.networkDevice.name = 'hq-firewall'`.

## Key=Value Parser

Los firewalls y otros equipos de red registran cada evento como una línea de pares `key=value`. Qué campos tiene una línea, y en qué orden, depende del evento, así que ningún patrón grok único puede describirlos. El Key=Value Parser no lo necesita: recorre la línea y convierte cada par que encuentra en un atributo del registro, sea cual sea el orden. Una vez convertidos en atributos, puede buscarlos y filtrar por ellos, usarlos en un [monitor de registros](/docs/monitor/logs-monitor) y alertar una vez por túnel, interfaz o usuario con [Agrupar por](/docs/monitor/logs-monitor#alertas-por-grupo-group-by).

### Configuración

| Ajuste | Predeterminado | Descripción |
| --- | --- | --- |
| Campo de origen | `body` | El campo que analizar: `body` para el mensaje del registro, o un atributo como `attributes.raw_line`. |
| Prefijo de destino | ninguno | Un espacio de nombres para las claves extraídas. `sophos` guarda `con_name` como `sophos.con_name`. Se añade un separador salvo que el prefijo ya termine en `.`, `_`, `-` o `:`. |
| Pair Delimiter | cualquier espacio en blanco | Lo que separa un par del siguiente. Déjelo vacío para Sophos, Fortinet y logfmt; use `,`, `;` o `\|` para otros formatos. |
| Key-Value Delimiter | `=` | Lo que separa una clave de su valor, por ejemplo `:` para `status:up`. |
| Anular en caso de conflicto | desactivado | Si una clave puede sustituir un atributo que el registro ya tiene. Desactivado por defecto: las claves vienen de la propia línea, y de lo contrario una línea podría reescribir atributos fijados en la ingesta, como el dispositivo del que procede. |

Los dos delimitadores deben ser distintos, no pueden contenerse entre sí y no pueden contener comillas ni barras invertidas; cada uno tiene como máximo 8 caracteres. El formulario del procesador lo comprueba antes de guardar, y su probador, **Test With a Sample Line**, muestra exactamente los atributos que produciría una línea de ejemplo.

### Reglas de análisis

- **Los valores entre comillas** conservan sus espacios y delimitadores: `message="IPSec Connection HQ-Branch1 terminated"` es un solo valor. Funcionan las comillas dobles y las simples, y `\"` dentro de un valor es una comilla literal. Una comilla que nunca se cierra (una línea cortada por un límite de tamaño de syslog) llega hasta el final de la línea.
- **Los valores sin comillas** llegan hasta el siguiente delimitador de pares, así que `url=https://example.com/?a=b` conserva su `=`.
- **Los valores vacíos** (`key=` y `key=""`) se guardan como cadenas vacías.
- **Los valores son siempre texto.** `latency=11` se guarda como `"11"`, igual que una captura grok sin tipo.
- **Las claves** empiezan por una letra o un guion bajo y contienen letras, dígitos y `. _ - @`. El texto anterior al primer par, como una cabecera syslog RFC 3164, y las palabras sueltas sin delimitador se omiten. Una prioridad syslog pegada a la primera clave (`<30>device_name="SFW"`) se elimina y la clave se conserva.
- **Una clave repetida conserva su primer valor**; los posteriores se ignoran.
- **Límites:** una línea de más de 32 KiB no se analiza, se toman como máximo 100 pares de una línea, las claves de más de 256 caracteres se omiten y los valores de más de 4096 caracteres se truncan.

### Ejemplo: firewall Sophos XGS

Cuando un firewall Sophos XGS envía syslog a una [sonda](/docs/monitor/network-device-monitor), cada mensaje se guarda como registro del dispositivo de red, con el mensaje syslog como cuerpo. Para analizarlo:

:::steps
#### Crear una canalización para el firewall

Vaya a **Registros → Ajustes → Canalizaciones** y cree una canalización. Dele un filtro que coincida con los registros del firewall, por ejemplo el atributo personalizado `networkDevice.name` es igual a `hq-firewall` (`attributes.networkDevice.name = 'hq-firewall'`), o **Cuerpo del registro** contiene `log_component=` para abarcar todas las líneas de Sophos.

#### Añadir el analizador

Abra la canalización y haga clic en **Añadir procesador**. Elija **Key=Value Parser**, deje **Campo de origen** en `body` y ponga **Prefijo de destino** en `sophos` (opcional, pero mantiene juntos los campos del firewall).

#### Probarlo y guardarlo

Pegue una línea del firewall en **Test With a Sample Line** para comprobar el resultado y haga clic en **Crear procesador**.
:::

Un evento IPsec de Sophos:

```text
device_name="SFW" timestamp="2024-05-02T11:03:12+0200" device_model="XGS2100" device_serial_id="X1234" log_id="010101600001" log_type="Event" log_component="IPSec" log_subtype="System" severity="Information" con_name="HQ-Branch1" src_ip="10.171.4.117" dst_ip="10.171.4.118" status="Terminated" message="IPSec Connection HQ-Branch1 between 10.171.4.117 and 10.171.4.118 for Child HQ-Branch1 terminated."
```

se convierte en estos atributos (entre otros):

| Atributo | Valor |
| --- | --- |
| `sophos.log_component` | `IPSec` |
| `sophos.con_name` | `HQ-Branch1` |
| `sophos.status` | `Terminated` |
| `sophos.src_ip` | `10.171.4.117` |
| `sophos.message` | `IPSec Connection HQ-Branch1 between 10.171.4.117 and 10.171.4.118 for Child HQ-Branch1 terminated.` |

Una línea SLA de SD-WAN tiene otros campos en otro orden, y el mismo procesador la maneja:

```text
log_id=158825619025 log_type="SD-WAN" log_component="SLA" profile_name="Branch-Internet" gw_name="WAN2" latency=11 jitter=2 packet_loss=0 gw_status="up" sla_status="SLA met"
```

da `sophos.gw_name = WAN2`, `sophos.latency = 11`, `sophos.packet_loss = 0`, `sophos.gw_status = up` y `sophos.sla_status = SLA met`. Las versiones antiguas de SFOS registran un formato heredado (`device="SFW" date=2017-01-31 time=18:02:03 timezone="IST" ... connectionname="Tunnel A"`); se analiza igual, con el nombre del túnel en `connectionname` en lugar de `con_name`.

Para convertir esas líneas SLA en métricas de latencia, jitter y pérdida de paquetes por puerta de enlace, consulte el ejemplo de [Reglas de grabación de registros](/docs/telemetry/log-recording-rules).

### Ejemplo: Fortinet FortiGate

Los registros de FortiGate usan el mismo estilo:

```text
date=2024-01-01 time=10:00:00 devname="FG100" logid="0100032001" type="event" subtype="vpn" level="notice" action="tunnel-down" vpntunnel="HQ-to-Branch2" msg="IPsec tunnel down"
```

Con los ajustes predeterminados y un prefijo `fortigate`, esto da `fortigate.devname = FG100`, `fortigate.subtype = vpn`, `fortigate.action = tunnel-down`, `fortigate.vpntunnel = HQ-to-Branch2` y `fortigate.time = 10:00:00`: los dos puntos de una hora forman parte del valor, no son un delimitador.

### Alertar una vez por túnel

Con los campos analizados, un [monitor de registros](/docs/monitor/logs-monitor) puede contar los fallos y abrir una alerta distinta para cada túnel: filtre por `sophos.log_component` = `IPSec` con un cuerpo que contenga `terminated` y agrupe por `sophos.con_name`. Consulte [Alertas por grupo](/docs/monitor/logs-monitor#alertas-por-grupo-group-by).

## Analizador Grok

Extrae campos estructurados de una línea con forma fija. Un patrón grok es una expresión regular con referencias con nombre: `%{IPV4:client_ip}` significa «encontrar una dirección IPv4 y guardarla como `client_ip`». El patrón no tiene que abarcar toda la línea, y una línea que no coincide queda sin cambios.

| Ajuste | Predeterminado | Descripción |
| --- | --- | --- |
| **Campo de origen** | `body` | El campo que analizar, como en el Key=Value Parser. |
| **Prefijo de destino** | ninguno | Un espacio de nombres para los campos extraídos, añadido del mismo modo. |
| **Patrón Grok** | — | El patrón. El formulario lista los patrones con nombre disponibles. |

Una captura se guarda como texto salvo que le dé un tipo: `%{NUMBER:status:int}` la guarda como número. Los tipos son `int`, `long`, `float`, `double`, `boolean` y `string`. Compruebe un patrón con una línea de ejemplo en **Prueba tu patrón** antes de guardarlo.

| Cuerpo del registro | Patrón | Atributos añadidos |
| --- | --- | --- |
| `10.0.1.5 - GET /health 200` | `%{IPV4:client_ip} - %{WORD:method} %{NOTSPACE:path} %{NUMBER:status:int}` | client_ip, method, path, status |

Use el Key=Value Parser cuando la línea esté hecha de pares `key=value` cuyo orden cambia.

## Reasignador de gravedad

Lee un valor en bruto de un atributo y lo asigna a una gravedad estándar. Ponga en **Atributo de origen** el atributo que contiene el nivel (`level` por defecto) y añada **Asignaciones**: cada una une un valor que emite su aplicación, como `warn`, con una gravedad, como Warning. La coincidencia no distingue mayúsculas y minúsculas. Un valor sin asignación deja la gravedad del registro como estaba.

## Reasignador de atributos

Mueve el valor de un atributo (**Clave de origen**) a otro (**Clave de destino**), por ejemplo `src_ip` a `source_ip`.

| Ajuste | Predeterminado | Efecto |
| --- | --- | --- |
| **Conservar origen** | desactivado | Desactivado, renombra el atributo: la clave de origen se elimina. Activado, lo copia y conserva la clave de origen. |
| **Anular en caso de conflicto** | activado | Activado, sustituye el destino si ya existe. Desactivado, deja el destino como está y omite la reasignación. |

## Procesador de categorías

Evalúa una lista de reglas en orden y guarda en un atributo de destino el nombre de la primera regla cuyo filtro coincide, para que pueda buscar de una vez todos los registros «Payment Error». Ponga el **Atributo de destino** (`category` por defecto) y añada **Reglas de categoría**: un **Nombre de la categoría** y las condiciones en **Cuando coincidan los registros**. Gana la primera regla que coincide; un registro que no coincide con ninguna queda sin cambios.

## Próximos pasos

:::cards
- [Monitor de registros](/docs/monitor/logs-monitor): Alertar sobre los atributos que extraen sus canalizaciones.
- [Reglas de grabación de registros](/docs/telemetry/log-recording-rules): Convertir campos de registro analizados en métricas.
- [Syslog](/docs/telemetry/syslog): Enviar a OneUptime el syslog de firewalls y servidores.
- [Sintaxis de búsqueda](/docs/telemetry/search-syntax): Buscar por los nuevos atributos en el explorador de registros.
:::
