# Reglas de grabación de registros

Una **Log Recording Rule** convierte registros en una métrica. Cada minuto toma los registros que coinciden con su filtro y escribe un número por minuto en el almacén de métricas: cuántos registros coincidieron, o la suma, el promedio, el mínimo, el máximo o un percentil de un atributo numérico de esos registros. Divida el resultado por hasta cinco atributos de registro y obtendrá una serie por valor: una por puerta de enlace, por host, por cliente.

:::cards
- [Cómo funciona una regla](#cómo-funciona-una-regla): Cubos, tiempos, recuperación y huecos.
- [Crear una regla](#crear-una-regla): Los campos del editor de reglas.
- [Ejemplo: latencia de puertas de enlace SD-WAN](#ejemplo-latencia-de-puertas-de-enlace-sd-wan-desde-un-firewall-sophos): Del syslog de un firewall a una alerta por puerta de enlace.
- [Permisos](#permisos): Quién puede crear, cambiar y leer reglas.
:::

## Descripción general

El resultado es una métrica normal. Represéntela en el **Explorador de métricas** y en paneles, y alerte sobre ella con un monitor de **Métricas**, incluida la alerta por serie con **Agrupar por**.

Use una regla de grabación de registros cuando el número que le interesa solo existe en sus registros: los resúmenes SLA de un firewall, un trabajo por lotes que registra cuánto tardó, los tamaños de respuesta de un registro de acceso, o simplemente cuántos registros de error escribe un servicio cada minuto.

Las reglas de grabación de registros están en **Registros → Ajustes → Reglas de grabación**. Sus equivalentes para métricas y spans están en **Métricas → Ajustes → Reglas de grabación** y **Trazas → Ajustes → Reglas de grabación**.

## Cómo funciona una regla

```mermaid title="Qué hace cada minuto una regla de grabación de registros"
flowchart TB
    logs["Registros que coinciden con la regla"] --> bucket["Cubo de un minuto,<br/>por marca de tiempo del registro"]
    bucket --> groups["Un grupo por valor de agrupación"]
    groups --> agg["Contar, o agregar un atributo numérico"]
    agg --> points["Un punto de métrica por serie"]
    points --> explorer["Explorador de métricas y paneles"]
    points --> monitor["Monitores de métricas"]
```

- **Un punto por minuto y por serie.** Los registros se agrupan en cubos de 1 minuto por su marca de tiempo. Cada cubo produce un punto por cada combinación distinta de los valores de los atributos de agrupación.
- **Se calcula 30 segundos después de que termine el minuto.** La breve espera permite que los registros que llegan algo tarde caigan aún en su minuto. Un registro que llega más tarde no se cuenta.
- **Sin huecos ni doble recuento.** Cada regla recuerda el último minuto que escribió (se muestra como **Computed Until** en la lista de reglas). Tras un reinicio del worker u otra caída, recupera los minutos perdidos, hasta 60 minutos atrás, y nunca escribe dos veces el mismo minuto.
- **Un recuento sin agrupación nunca tiene huecos.** Un minuto sin registros coincidentes se escribe como `0`. Cualquier otra regla no escribe nada en un minuto sin nada que agregar, así que los gráficos y los monitores ven ausencia de datos en lugar de un cero inventado.
- **Se escribe como cualquier otra métrica derivada.** Los puntos son datos de tipo Gauge con el **Nombre de la métrica de salida** de la regla, llevan los atributos de agrupación y `oneuptime.derived.log_rule_id` (el ID de la regla), y siguen la misma retención que los puntos de las reglas de grabación de métricas y trazas: 15 días.

Cambiar la definición de una regla se aplica desde el siguiente minuto que escribe; los puntos ya escritos no se reescriben. Desactivar una regla la detiene; al reactivarla, recupera los minutos que perdió mientras estaba desactivada, hasta los mismos 60 minutos.

## Crear una regla

:::steps
### Abrir las reglas de grabación

Vaya a **Registros → Ajustes → Reglas de grabación** y elija **Crear Log Recording Rule**.

### Poner nombre a la regla

Escriba un **Nombre**. El **Nombre de la métrica de salida** de debajo se forma a partir del nombre mientras escribe; elija **Editar** a su lado para escribir el suyo.

### Elegir los registros y qué calcular

En **Which Logs**, acote la regla con servicios de telemetría, gravedades, texto del cuerpo y filtros de atributo. Elija una **Agregación** y, para todo lo que no sea un recuento, el **Numeric Attribute** que agregar.

### Dividir el resultado y guardar

Si quiere, añada atributos en **Agrupar por** y una **Unidad**. Revise la línea de la parte inferior del editor y guarde. En pocos minutos, la lista de reglas muestra una hora en **Computed Until**.
:::

| Campo | Qué hace |
| --- | --- |
| Nombre | Lo que calcula la regla, por ejemplo *SD-WAN gateway latency*. |
| Nombre de la métrica de salida | La métrica que escribe la regla. Se forma a partir del nombre (*SD-WAN gateway latency* escribe `sd_wan_gateway_latency`), salvo que elija **Editar** y escriba el suyo. Debe ser único entre las reglas de grabación del proyecto. |
| Which Logs | Filtros opcionales, todos combinados con AND: servicios de telemetría, gravedades, texto que contiene el cuerpo y filtros de atributo (un atributo igual a un valor). |
| Agregación | `Count of logs`, o una agregación de un atributo numérico (vea más abajo). |
| Numeric Attribute | Para toda agregación salvo el recuento: el atributo cuyos valores se agregan, por ejemplo `latency`. |
| Agrupar por | Opcional: hasta 5 claves de atributo. Una serie por cada combinación distinta de sus valores. |
| Unidad | Opcional: la unidad de la métrica de salida, por ejemplo `ms`. Se muestra allí donde se representa la métrica. |
| Descripción | En **Más campos**: para qué sirve la regla. |
| Habilitado | En **Más campos**: activado por defecto. Solo se calculan las reglas habilitadas. |

La línea de la parte inferior del editor dice qué escribirá la regla, por ejemplo `avg(latency) by gw_name, profile_name`.

Una regla puede filtrar por un máximo de 10 atributos y 100 servicios de telemetría.

### Agregaciones

| Agregación | El punto de cada minuto |
| --- | --- |
| Count of logs | Cuántos registros coincidieron con el filtro. |
| Promedio | El promedio de los valores del atributo numérico. |
| Suma | Los valores del atributo sumados. |
| Mínimo | El valor más pequeño. |
| Máximo | El valor más grande. |
| p50 (median) | La mediana. |
| p75 | El percentil 75. |
| p90 | El percentil 90. |
| p95 | El percentil 95. |
| p99 | El percentil 99. |

### Atributos numéricos

El valor del atributo numérico debe ser un número simple. Puede llegar como número (`latency=11` analizado como número) o como texto (`"11"`, `"11.5"`, `"1e3"`). Un registro cuyo valor falta o no es un número (`"11ms"`, `"n/a"`, una cadena vacía) se **omite**. Nunca se cuenta como `0`, así que un registro mal formado no puede bajar un promedio.

### Claves de atributo

Las claves de los filtros de atributo coinciden sin importar mayúsculas y minúsculas, como los filtros del explorador de registros. El atributo numérico y las claves de agrupación deben escribirse exactamente como los llevan sus registros, incluido cualquier prefijo que añada una canalización de registros. Los campos de clave sugieren las claves que llevan los registros de su proyecto, así que elija de la lista en lugar de escribir una clave a mano.

Las claves pueden contener letras, dígitos y `. _ : / -`.

### Agrupación y el límite de series

Cada clave de agrupación multiplica el número de series que escribe una regla, así que agrupe por atributos que identifiquen algo que quiere ver o vigilar por separado (una puerta de enlace, un host, un cliente), no por atributos distintos en cada registro, como un ID de petición o la dirección IP de un cliente.

Una regla escribe como máximo 1000 series por minuto. Por encima de eso, se conservan las series con más registros coincidentes y el resto de ese minuto se descarta. Un registro que no lleva alguno de los atributos de agrupación cuenta igualmente; su serie se escribe sin ese atributo.

## Ejemplo: latencia de puertas de enlace SD-WAN desde un firewall Sophos

Un firewall Sophos XGS con el registro de SD-WAN activado envía cada pocos minutos un resumen SLA por perfil de SD-WAN y por puerta de enlace:

```text
log_type="SD-WAN" log_component="SLA" profile_name="Branch-Internet" gw_name="WAN2" latency=11 jitter=2 packet_loss=0 gw_status="up" sla_status="SLA met"
```

Este ejemplo convierte esos resúmenes en una métrica de latencia por puerta de enlace y alerta cuando la latencia de una puerta de enlace sigue alta.

```mermaid title="Del syslog de un firewall a una alerta por puerta de enlace"
flowchart TB
    firewall["Firewall Sophos"] -->|"syslog"| logs["Registros"]
    logs --> pipeline["La canalización de registros analiza pares key=value"]
    pipeline --> rule["Regla de grabación: latencia media por puerta de enlace"]
    rule --> metric["sdwan.gateway.latency.ms"]
    metric --> monitor["Monitor de métricas, una alerta por puerta de enlace"]
```

:::steps
### Hacer llegar los registros, con sus campos como atributos

1. Envíe el syslog del firewall a OneUptime: consulte [Syslog](/docs/telemetry/syslog).
2. En **Registros → Ajustes → Canalizaciones**, añada una canalización con un procesador que divida los pares `key=value` del cuerpo en atributos del registro, para que cada resumen lleve `log_type`, `log_component`, `profile_name`, `gw_name`, `latency`, `jitter` y `packet_loss` como atributos. El [Key=Value Parser](/docs/telemetry/log-pipelines#keyvalue-parser) lo hace.
3. Abra el explorador de **Registros** y compruebe los nombres de los atributos en un registro SLA. Si su canalización añade un prefijo, use los nombres con prefijo de abajo.

### Crear la regla de grabación

En **Registros → Ajustes → Reglas de grabación**, cree una regla:

- **Nombre:** SD-WAN gateway latency
- **Nombre de la métrica de salida:** elija **Editar** y escriba `sdwan.gateway.latency.ms`
- **Which Logs:** filtros de atributo `log_type` = `SD-WAN` y `log_component` = `SLA`
- **Agregación:** Promedio, **Numeric Attribute:** `latency`
- **Agrupar por:** `gw_name` y `profile_name`
- **Unidad:** `ms`

Por la API, MCP o Terraform, la **definición** de la misma regla es:

```json
{
  "filter": {
    "attributeFilters": [
      { "key": "log_type", "value": "SD-WAN" },
      { "key": "log_component", "value": "SLA" }
    ]
  },
  "aggregationType": "Avg",
  "valueAttribute": "latency",
  "groupByAttributes": ["gw_name", "profile_name"],
  "unit": "ms"
}
```

Repita con `jitter` (`sdwan.gateway.jitter.ms`, unidad `ms`) y `packet_loss` (`sdwan.gateway.packet_loss.percent`, unidad `%`) para las otras dos mediciones SLA. Una regla **Count of logs** filtrada por `gw_status` = `down` y agrupada por `gw_name` cuenta los avisos de puerta de enlace caída por puerta de enlace.

En pocos minutos la lista de reglas muestra una hora en **Computed Until**, y `sdwan.gateway.latency.ms` aparece en el explorador de métricas: elíjala, agrupe por `gw_name` y tendrá una línea de latencia por puerta de enlace.

### Alertar cuando la latencia de una puerta de enlace sigue alta

Cree un monitor de **Métricas** (consulte [Monitor de métricas](/docs/monitor/metrics-monitor)):

1. **Consulta de métrica:** `sdwan.gateway.latency.ms`, agregación **Promedio**, **Agrupar por** `gw_name` y `profile_name`.
2. **Ventana de tiempo móvil:** Últimos 15 minutos. El firewall informa cada pocos minutos, así que la ventana contiene varios puntos por puerta de enlace.
3. **Estrategia de agregación:** **All Values**: todos los puntos de la ventana deben superar el umbral, para que un único resumen lento no avise a nadie. Use **Promedio** en su lugar para alertar sobre un promedio alto.
4. **Criterios:** Metric value **Greater Than** `150` abre una alerta.
5. Si quiere, use los valores de agrupación en el título de la alerta, por ejemplo `SD-WAN latency high on {{gw_name}} ({{profile_name}})`.

Con la agrupación definida, cada puerta de enlace es su propia serie: si WAN2 se vuelve lenta, se abre una alerta solo para WAN2, y se resuelve sola cuando WAN2 se recupera. Consulte [Alertas por serie](/docs/monitor/metrics-monitor).
:::

## Conviene saber

- **Las marcas de tiempo vienen de los registros.** Un registro cae en el minuto de su propia marca de tiempo. Un dispositivo cuyo reloj va desfasado más de un poco deja sus registros en el minuto equivocado, o totalmente fuera de la ventana.
- **Sin cálculo retroactivo.** Una regla nueva empieza por el minuto anterior a su primera ejecución; los registros más antiguos no se calculan.
- **Eliminar una regla** la detiene. Los puntos que ya escribió permanecen hasta que caducan.
- **Las reglas de grabación ven todos los registros del proyecto.** Quien pueda leer la métrica de salida ve números calculados a partir de cada registro que coincide con el filtro de la regla, así que crear y editar reglas de grabación de registros está limitado a los propietarios y administradores del proyecto y a los permisos **Create / Edit Log Recording Rule**.

## Permisos

| Permiso | Permite |
| --- | --- |
| Create Log Recording Rule | Crear reglas. |
| Edit Log Recording Rule | Cambiar reglas y desactivarlas. |
| Delete Log Recording Rule | Eliminar reglas. |
| Read Log Recording Rule | Ver las reglas y lo que calculan. |

Los propietarios y administradores del proyecto pueden hacer todo esto. Los miembros del proyecto, los lectores y los roles de telemetría pueden leer las reglas.

## Próximos pasos

:::cards
- [Monitor de métricas](/docs/monitor/metrics-monitor): Alertar sobre las métricas que escriben sus reglas.
- [Canalizaciones de registros](/docs/telemetry/log-pipelines): Extraer los atributos que agrega una regla.
- [Syslog](/docs/telemetry/syslog): Enviar a OneUptime los registros de firewalls y servidores.
:::
