# Variables y filtros del panel

Una variable convierte un único panel en una plantilla. Define una variable `service` y el mismo gráfico se vuelve a renderizar para `checkout`, `payments` y `search` — eliges de un desplegable en la parte superior en lugar de construir tres paneles casi idénticos.

Esta página cubre los cuatro tipos de variables, cómo se inyectan sus valores en las consultas de los widgets y los controles globales de rango de tiempo y refresco que se sitúan junto a ellas.

## Tipos de variables

Añade variables en **Dashboard → Settings → Variables**. Cada una tiene un nombre (referenciado como `{{name}}` en las consultas de los widgets), una etiqueta opcional y un tipo.

### Custom List

Un desplegable estático. Tú proporcionas una lista de valores separada por comas; el espectador elige uno.

Úsala cuando: el conjunto de opciones es pequeño, fijo y solo significativo para tu equipo. `environment` con valores `prod, staging, dev`. `region` con valores `us-east-1, eu-west-1, ap-south-1`.

### Query

Las opciones del desplegable se calculan mediante una consulta de ClickHouse en tiempo de renderizado.

Úsala cuando: las opciones son dinámicas y viven en tu telemetría. "Cada customer ID que ha iniciado sesión en las últimas 24 horas" vía `SELECT DISTINCT customer_id FROM ...`. La consulta se ejecuta contra los datos de tu proyecto; trata el resultado como entrada no confiable aunque sean tus propios datos.

### Text Input

Un campo de texto libre. Lo que el espectador teclea se inyecta.

Úsala cuando: quieres que el panel actúe como una herramienta de búsqueda. Un panel del estilo "filtrar por IP" o "filtrar por request ID".

### Telemetry Attribute

Las opciones son los distintos valores de una clave de atributo OpenTelemetry presentes en la telemetría de tu proyecto, sobre el rango de tiempo del panel.

Configura la **attribute key** (por ejemplo, `k8s.cluster.name`, `service.name`, `host.name`). El widget obtiene los valores distintos de logs / métricas / trazas y los ofrece como desplegable.

Úsala cuando: las opciones son exactamente las entidades con las que ya has etiquetado tu telemetría. Nombre de cluster, nombre de servicio, región, customer ID, entorno de deployment — cualquier cosa que ya envíes como atributo de recurso o de span de OpenTelemetry.

Es el tipo de variable más común para paneles orientados a servicios porque se auto-actualiza: cuando despliegas un nuevo servicio etiquetado `service.name = inventory`, ese valor aparece en el desplegable sin que nadie tenga que editar el panel.

## Multi-selección

Cada variable puede configurarse como **multi-select**. Cuando está activa, el espectador elige uno o más valores; el panel filtra a `value IN (...)` en lugar de `value = ...`.

Usa multi-select cuando: quieres mirar "checkout + payments juntos" sin salir del panel. Evítalo cuando las matemáticas del gráfico no sumen entre los valores seleccionados — por ejemplo, promediar promedios.

## Valores por defecto

Cada variable acepta un valor por defecto opcional. El panel se renderiza con el valor por defecto hasta que el espectador cambia el desplegable. Para los paneles públicos, el valor por defecto es donde aterrizan los visitantes.

## Cómo funciona la interpolación

En cualquier lugar donde la consulta de un widget acepte un filtro de cadena — la cláusula `WHERE` de una consulta de métrica, el filtro de un widget de lista, una coincidencia de atributo de un stream de logs — puedes referenciar `{{variable_name}}`.

Por ejemplo, la consulta de métrica de un Chart podría ser:

```
SELECT avg(latency_ms) FROM spans WHERE service.name = '{{service}}'
```

Cuando `service` está establecido a `checkout`, la consulta se ejecuta con `service.name = 'checkout'`. Cuando el espectador cambia a `payments`, la consulta se vuelve a ejecutar con `service.name = 'payments'`.

Específicamente para las variables **Telemetry Attribute**, OneUptime conoce la clave del atributo e inyecta el filtro en cada widget que mencione el mismo atributo — no tienes que editar a mano la consulta de cada widget cuando cambia la variable. Esta es la magia que hace que los paneles templados por servicio funcionen de inmediato.

## Rango de tiempo

El encabezado del panel tiene un selector global de **rango de tiempo**. Cada widget de métrica consulta contra esta ventana. Opciones:

- **Presets** — Última hora, 24 horas, 7 días, 30 días, 90 días (dependiendo de tu retención).
- **Rango personalizado** — elige las marcas de tiempo de inicio y fin.

El rango de tiempo es parte de la URL del panel — compartir la URL comparte la ventana. Esto es cómodo durante un incidente: fija el rango de tiempo a "10:00–10:30 UTC hoy" y comparte el enlace en el canal del incidente.

## Intervalo de refresco

Junto al rango de tiempo, elige con qué frecuencia se vuelven a consultar los widgets:

- **Off** — los widgets consultan una vez al cargar.
- **5s / 10s / 30s / 1m / 5m / 15m** — auto-refresco.

El auto-refresco es cómodo para una pantalla montada en pared y una vista de incidente actual. Para una investigación ad-hoc, déjalo desactivado para que la vista permanezca estable mientras te desplazas.

## Juntándolo todo

Un panel templado por servicio típicamente tiene:

1. Una variable `service` de tipo **Telemetry Attribute** ligada a `service.name`. Valor por defecto: tu servicio más vigilado. Multi-select: off (para que los gráficos siempre muestren un servicio a la vez).
2. Una variable `environment` de tipo **Custom List**. Valor por defecto: `prod`.
3. Una variable `cluster` de tipo **Telemetry Attribute** ligada a `k8s.cluster.name`. Multi-select: on (para que puedas hacer roll-up entre clusters).
4. Los widgets del panel referencian estas variables en sus filtros.

El resultado: un panel, la cobertura de toda la flota, unos pocos desplegables en la parte superior.

## Qué leer a continuación

- [Widgets del panel](/docs/dashboards/widgets) — cómo cada widget consume un filtro.
- [Compartir y paneles públicos](/docs/dashboards/sharing) — variables en URLs, incluyendo sus valores para enlaces compartidos.
- [Crear un panel](/docs/dashboards/authoring) — la mecánica del lienzo.
