# Crear un panel

Crea un panel en **Dashboards → Create Dashboard**, dale un nombre y ábrelo. El lienzo se abre en modo **Edit**, listo para widgets.

## El lienzo

Un panel es una cuadrícula. El lienzo por defecto es de **12 unidades de panel de ancho** por **60 unidades de alto** — puedes aumentar la altura añadiendo filas por debajo del fondo. Cada unidad es un cuadrado que se escala con el viewport: en un escritorio es más ancho que en un teléfono, pero cada widget mantiene sus proporciones.

Los widgets ocupan un rectángulo de unidades. Decides tanto la posición (esquina superior izquierda, medida en unidades desde la esquina superior izquierda del lienzo) como el tamaño (ancho y alto en unidades). Las dimensiones mínimas garantizan que un widget pequeño siga siendo legible.

## Edit vs. View

El conmutador del encabezado de la página alterna entre los dos modos:

- **Edit** — la paleta de widgets está abierta, los widgets son arrastrables y redimensionables, cada widget tiene un engranaje de ajustes. Úsalo mientras construyes.
- **View** — el panel se renderiza en solo lectura, exactamente como lo ve alguien con acceso de solo vista (o un visitante público). Úsalo para comprobar el resultado antes de compartir.

El mismo panel se muestra en ambos modos — no hay un paso separado de "publicar". Guardar una edición tiene efecto inmediato para todo espectador.

## Añadir un widget

1. Abre la paleta de widgets (el botón **+** en modo Edit).
2. Elige el tipo de widget. Consulta [Widgets del panel](/docs/dashboards/widgets) para el catálogo.
3. El widget aterriza en el lienzo en la siguiente posición libre con un tamaño por defecto.
4. Haz clic en el engranaje del widget para abrir su panel de configuración.
5. Configura la fuente de datos (consulta de métrica, filtro de lista, cuerpo de texto, etc.) y cualquier opción de visualización (umbrales, unidades, ejes, columnas).
6. Arrastra el widget para posicionarlo. Arrastra una esquina para redimensionarlo.

Repite. La cuadrícula ajusta los widgets a límites de unidad enteros.

## Configurar las fuentes de datos

La mayoría de los widgets leen desde uno de tres lugares:

- **Métricas** — una consulta de métrica respaldada por ClickHouse. El widget construye un `metricQueryConfig` (una sola serie) o `metricQueryConfigs` (varias series apiladas o superpuestas). `transformAsRate` opcional convierte un contador acumulativo de OpenTelemetry en una tasa de cambio. `formula` opcional te permite combinar dos consultas (por ejemplo, conteo de errores / conteo total).
- **Listas de recursos en vivo** — incidentes, alertas, monitores, recursos de Kubernetes, recursos de Docker, hosts. Cada widget de lista toma un filtro (por ejemplo, etiquetas, estado, namespace) y muestra las filas coincidentes en vivo.
- **Contenido estático** — el widget **Text** toma un cuerpo Markdown. Úsalo para encabezados, divisores, enlaces a runbooks y anotaciones del estilo "¿de qué va este panel?".

Para los widgets de métricas, la configuración refleja el constructor de consultas en línea que ves en otros lugares de OneUptime — elige una métrica, elige una agregación, añade filtros `WHERE`, elige una agrupación temporal. La consulta se ejecuta contra los datos de telemetría de tu proyecto.

## Umbrales y formato

Los widgets que muestran un único número (**Value**, **Gauge**) aceptan umbrales opcionales:

- **Umbral de advertencia** — renderiza el valor en amarillo cuando lo cruza.
- **Umbral crítico** — renderiza el valor en rojo cuando lo cruza.

Los gráficos te permiten establecer la unidad del eje Y, la posición de la leyenda y si apilar las series. Las tablas te permiten elegir qué columnas mostrar y el límite de filas.

## Rango de tiempo y refresco

El encabezado del panel lleva dos controles globales que afectan a cada widget de métrica:

- **Rango de tiempo** — elige un preset (Última hora, 24 horas, 7 días, 30 días) o un rango personalizado. Cada widget de métrica consulta contra esta ventana.
- **Intervalo de refresco** — Off, 5s, 10s, 30s, 1m, 5m, 15m. Vuelve a ejecutar la consulta de cada widget con la cadencia elegida. Los widgets de lista que soportan websockets de forma nativa se actualizan al recibir push independientemente del intervalo elegido.

Para los widgets que ignoran el rango de tiempo global (por ejemplo, un bloque de texto), el control no tiene efecto.

## Guardar

El lienzo se guarda automáticamente mientras editas. Un pequeño indicador en el encabezado te dice cuándo se ha persistido el último cambio. No hay "publicar" — cada edición está activa en el momento en que se guarda. Si estás haciendo un cambio arriesgado, duplica primero el panel.

## Patrones que funcionan bien

- **Un tema por panel.** Resiste la tentación de poner "todo lo que monitorizamos" en una página. Tres paneles etiquetados `oncall-checkout`, `oncall-payments`, `oncall-search` envejecen mejor que un panel mega.
- **Anclar el principio de la página con el widget más importante.** La gente escanea desde arriba — asegúrate de que lo primero que ven es la respuesta a "¿este sistema está sano?".
- **Usar widgets Text para etiquetar secciones.** Un encabezado corto cada pocas filas ("Latencia" / "Errores" / "Capacidad") hace que el panel sea legible desde el otro extremo de la sala.
- **Usar variables en lugar de duplicar.** Si te encuentras construyendo el mismo panel dos veces para dos servicios, quieres una variable `service`. Consulta [Variables y filtros del panel](/docs/dashboards/variables).

## Qué leer a continuación

- [Widgets del panel](/docs/dashboards/widgets) — el catálogo y la configuración por widget.
- [Variables y filtros del panel](/docs/dashboards/variables) — templating con variables, filtros de atributos y rango de tiempo.
- [Compartir y paneles públicos](/docs/dashboards/sharing) — hacer un panel accesible fuera del equipo.
- [Configuración y permisos del panel](/docs/dashboards/configuration) — propiedad y control de acceso.
