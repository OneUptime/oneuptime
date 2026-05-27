# Crear un Panel

Para crear un panel, abre **Paneles → Crear Panel**, dale un nombre y ábrelo. El lienzo se abre en modo **Edición**, listo para que empieces a añadir widgets.

## El lienzo

Un panel es una cuadrícula. Los widgets encajan en su lugar: tú decides dónde se sitúa cada uno y qué tamaño tiene. Puedes hacer crecer la página hacia abajo a medida que añades más filas. Cada widget mantiene sus proporciones en pantallas más grandes o más pequeñas.

## Edición y Vista

El interruptor en el encabezado alterna entre dos modos:

- **Edición** — la paleta de widgets está abierta, puedes arrastrar widgets, cambiar su tamaño y hacer clic en cualquier widget para cambiar su configuración.
- **Vista** — el panel es de solo lectura, exactamente como lo ven los visitantes y otros miembros del equipo. Usa esto para comprobar el resultado antes de compartir.

Es el mismo panel en ambos modos. No hay un paso separado de "publicar"; cada edición está en vivo en el momento en que se guarda.

## Añadir un widget

1. Haz clic en el botón **+** para abrir la paleta de widgets.
2. Elige el tipo de widget. Consulta [Widgets](/docs/dashboards/widgets) para el catálogo.
3. El widget aparece en el lienzo.
4. Haz clic en el icono de engranaje en el widget para abrir su configuración.
5. Elige la fuente de datos (una métrica, un filtro de lista, un párrafo de texto, etc.) y cualquier opción de visualización.
6. Arrastra el widget para moverlo. Arrastra una esquina para cambiar su tamaño.

## De dónde provienen los datos

La mayoría de los widgets leen desde uno de tres lugares:

- **Métricas** — elige una métrica y una agregación (promedio, máximo, conteo, percentil). Añade filtros. Elige cómo agrupar el resultado. Este es el mismo constructor de consultas que ves en otras partes de OneUptime.
- **Listas en vivo** — incidentes, alertas, monitores, pods de Kubernetes, contenedores de Docker, hosts. Cada widget de lista toma un filtro y muestra los elementos que coinciden, actualizados en vivo.
- **Contenido estático** — el widget **Texto** toma un bloque de Markdown. Úsalo para encabezados, contexto, enlaces a runbooks o notas temporales durante un incidente.

## Umbrales y formato

Los widgets de un solo valor (**Valor**, **Indicador**) te permiten configurar:

- Un **umbral de advertencia** — el color se vuelve amarillo cuando el valor lo supera.
- Un **umbral crítico** — el color se vuelve rojo cuando el valor lo supera.

Los gráficos te permiten configurar la unidad del eje Y, elegir dónde va la leyenda y decidir si las series se apilan unas sobre otras o se superponen. Las tablas te permiten elegir las columnas a mostrar y cuántas filas.

## Rango de tiempo y actualización

En la parte superior del panel, dos controles afectan a cada widget de métrica:

- **Rango de tiempo** — un preajuste (última hora, 24 horas, 7 días, 30 días) o un rango personalizado. Cada gráfico y número usa esta ventana.
- **Actualización** — con qué frecuencia los widgets vuelven a consultar. Apagado, 5s, 10s, 30s, 1m, 5m, 15m. Las listas en vivo se actualizan por su cuenta independientemente de este ajuste.

Los widgets que no usan el rango de tiempo (como un widget de Texto) ignoran ambos controles.

## Guardar

El lienzo se guarda por su cuenta mientras trabajas. Un pequeño indicador en el encabezado te dice cuándo se guardó el último cambio. Si vas a hacer un cambio grande, duplica primero el panel para tener una copia segura.

## Consejos para paneles que envejecen bien

- **Un tema por panel.** Resiste poner "todo lo que monitorizamos" en una sola página. Unos cuantos paneles enfocados superan a una página gigante.
- **Pon el widget más importante en la parte superior.** La gente escanea de arriba a abajo: haz que lo primero que vean sea la respuesta a "¿está sano este sistema?".
- **Etiqueta las secciones con widgets de Texto.** Un breve encabezado cada pocas filas ("Latencia", "Errores", "Capacidad") hace que la página sea legible desde el otro lado de la sala.
- **Usa variables en lugar de duplicar.** Si estás a punto de construir el mismo panel para un segundo servicio, en su lugar construye un panel con una variable `service`. Consulta [Variables y Filtros](/docs/dashboards/variables).

## Dónde seguir leyendo

- [Widgets](/docs/dashboards/widgets) — el catálogo.
- [Variables y Filtros](/docs/dashboards/variables) — variables, filtros y el rango de tiempo.
- [Compartir y Paneles Públicos](/docs/dashboards/sharing) — compartir fuera de tu equipo.
- [Configuración y Permisos](/docs/dashboards/configuration) — propietarios y control de acceso.
