# Hacer zoom en un intervalo de tiempo

Arrastre sobre un gráfico para hacer zoom de la página en ese momento, y haga doble clic para volver. Esta página explica los gestos, cómo se comporta un zoom y qué gráficos hacen zoom de qué.

:::cards
- [Acercar y volver a alejar](#acercar-y-volver-a-alejar): Los dos gestos y el botón Restablecer zoom.
- [Cómo se comporta el zoom](#cómo-se-comporta-el-zoom): Zooms anidados, actualización automática, clics y arrastres.
- [Dónde funciona](#dónde-funciona): Las páginas y los gráficos cuyo intervalo cambia un arrastre.
- [Gráficos sin zoom](#gráficos-sin-zoom): Franjas, indicadores y minigráficos.
:::

## Acercar y volver a alejar

Cada gráfico de series temporales de OneUptime sirve también como selector de intervalo de tiempo. Cuando un gráfico muestra un pico que quiere examinar, no necesita abrir el selector ni escribir fechas:

:::steps
1. **Arrastre sobre el pico** en cualquier gráfico. El intervalo de tiempo de la página pasa a la ventana que trazó, exactamente como si la hubiera elegido en el selector de intervalo. Cada gráfico, y cada mosaico o tabla calculado a partir del intervalo de la página, vuelve a consultar para ella, así que lee un mismo momento en todos.
2. **Haga doble clic en cualquier gráfico** para volver. La página recupera el intervalo de tiempo que tenía antes de que empezara a hacer zoom.
:::

Los paneles que muestran el estado actual siguen en el momento presente, igual que cuando usted elige un intervalo: recuentos de inventario, estado de salud, principales consumidores de recursos, advertencias recientes, incidentes y alertas abiertos, y las listas en vivo de un panel.

Mientras hay un zoom activo, aparece un botón **Restablecer zoom** junto al selector de intervalo de tiempo de la página. Hace lo mismo que un doble clic y es la forma de volver con el teclado y en pantallas táctiles.

```mermaid title="Qué hacen un arrastre, un doble clic y el selector con el intervalo de la página"
stateDiagram-v2
    state "Intervalo del selector" as Picked
    state "Ventana ampliada" as Zoomed
    [*] --> Picked
    Picked --> Zoomed: arrastrar sobre un gráfico
    Zoomed --> Zoomed: arrastrar de nuevo
    Zoomed --> Picked: doble clic o Restablecer zoom
    Zoomed --> Picked: elegir un intervalo
```

## Cómo se comporta el zoom

- **Haga zoom tan a fondo como quiera; un solo restablecimiento sale del todo.** Tras pasar de «Última hora» a diez minutos y luego a uno, un solo doble clic (o **Restablecer zoom**) devuelve la hora completa en lugar de subir un nivel cada vez.
- **Cualquier gráfico puede restablecer cualquier zoom.** Arrastre en el gráfico de CPU y haga doble clic en el de memoria: lo que tiene zoom es la página, no el gráfico.
- **Elegir usted un intervalo empieza de nuevo.** Un preajuste o un intervalo personalizado en el selector es un nuevo punto de partida: el zoom termina y **Restablecer zoom** desaparece.
- **Una ventana ampliada es fija.** «Últimos 30 minutos» avanza con el reloj; un zoom es una ventana fija, así que deja de avanzar mientras la actualización automática está activa. Restablezca el zoom para que vuelva a avanzar.
- **Un zoom nunca pasa del momento actual.** El cubo más reciente de un gráfico suele estar aún llenándose; un arrastre que termina en él se corta en la hora actual.
- **Puede soltar el ratón fuera del gráfico**: el arrastre cuenta igual.
- **No necesita esperar a que carguen los gráficos para volver.** Justo después de un zoom, mientras los gráficos todavía obtienen la ventana que trazó, o cuando esa ventana resulta estar vacía, un doble clic en un gráfico restablece el zoom de inmediato.
- **Hacer doble clic en una página sin zoom no hace nada.**

### Clics y arrastres

- **En los gráficos de líneas, áreas y barras, un clic simple no es un zoom.** Eso abarca la mayoría de los gráficos: tarjetas de métricas y el explorador de métricas, resúmenes de recursos, SLO, monitores y todos los gráficos de un panel. Solo un arrastre a través de varios cubos hace zoom, así que hacer clic en un punto, una barra o una entrada de la leyenda sigue haciendo lo de siempre. Mientras hay un zoom activo, un clic en el área de trazado de un gráfico surte efecto un instante después, para distinguirlo del doble clic que restablece. La línea de tiempo de patrones de error en Insights de registros y el Occurrence Trend de una excepción también hacen zoom solo con un arrastre.
- **En los gráficos de volumen de los exploradores, un clic en una barra hace zoom en esa barra.** Los gráficos de volumen de los exploradores de registros, trazas, excepciones y eventos de seguridad, y los gráficos de análisis de registros y trazas, hacen zoom en las barras sobre las que arrastra, o en la barra en la que hace clic. Estos gráficos muestran **Haz clic o arrastra para ampliar**.

### Indicaciones en los gráficos

La mayoría de los gráficos con zoom indican el gesto encima del área de trazado, **Arrastra para hacer zoom** o **Haz clic o arrastra para ampliar**, y, mientras hay un zoom activo, añaden el recordatorio **haz doble clic para restablecer**. Las tarjetas de métricas, el explorador de métricas y los gráficos de volumen de los exploradores muestran siempre la indicación. En las tarjetas de gráficos de los resúmenes de recursos y de los SLO, y en algunos widgets de panel, solo aparece mientras señala la tarjeta o entra en ella con el tabulador.

## Dónde funciona

El zoom cambia el intervalo de toda la página en:

- los resúmenes de recursos y sus páginas de Insights: clústeres de Kubernetes, hosts de Docker, Podman y Docker Swarm, hosts y sus procesos, servicios y unidades de systemd, VMware, Proxmox, Ceph, matrices de almacenamiento, bases de datos, recursos en la nube y funciones serverless;
- servicios y aplicaciones RUM;
- las métricas y el tráfico de los dispositivos de red;
- las tarjetas de métricas, incluida la pestaña Métricas de un recurso y las métricas de un monitor;
- el explorador de métricas;
- los gráficos de historial de los SLO;
- Insights de registros, incluida la línea de tiempo «Cuándo ocurrió» de un patrón de error, cuyo panel tiene su propio **Restablecer zoom** porque cubre el selector de la página;
- los gráficos de volumen de registros, trazas, excepciones y eventos de seguridad, y los gráficos de análisis de registros y trazas, que cambian el intervalo del explorador al que pertenecen;
- los [paneles](/docs/dashboards/authoring), donde un arrastre cambia el intervalo de todo el panel.

Los gráficos con una ventana propia solo hacen zoom en esa ventana, así que nunca cambian nada más de la página. Eso incluye la vista previa de una métrica en el formulario de un monitor (el monitor sigue evaluando su propia ventana móvil), el Occurrence Trend de una excepción, un gráfico abierto en una ventana emergente o en el panel de investigación, y los gráficos de las respuestas del chat de IA. Hacer doble clic en uno de ellos, o en su botón **Restablecer zoom**, recupera su propia ventana.

La instantánea de telemetría de la página de un incidente, una alerta o un episodio también tiene una ventana propia. Un arrastre en su gráfico (el gráfico de métricas, o el gráfico de volumen de registros, trazas o excepciones cuando eso es lo que muestra la instantánea) hace zoom de toda la instantánea, así que sus pestañas Métricas, Registros, Trazas y Excepciones muestran el tramo que trazó. **Restablecer zoom** junto a la insignia de la instantánea, o un doble clic en ese gráfico, recupera la ventana de la instantánea.

## Gráficos sin zoom

Algunas visualizaciones no tienen un eje de tiempo sobre el que arrastrar, son demasiado pequeñas para ello o siempre muestran una ventana fija propia, así que no hacen zoom:

- las franjas de historial de disponibilidad (una barra por día), que no pueden mostrar nada más fino que un día;
- las barras de reparto y proporción, los indicadores y las barras de progreso;
- los gráficos de llamas, los mapas de servicios y los diagramas de flujo;
- los pequeños minigráficos de tendencia de las listas de métricas, donde un clic abre la métrica: ábrala para obtener un gráfico con zoom;
- los pequeños minigráficos con una ventana fija propia, como el tiempo de ida y vuelta de un dispositivo de red en la última hora: su enlace **Abrir métricas** lleva a gráficos con zoom.

## Próximos pasos

:::cards
- [Crear un panel](/docs/dashboards/authoring): El zoom funciona en todos los gráficos de un panel.
- [Sintaxis de búsqueda](/docs/telemetry/search-syntax): Filtrar los exploradores una vez encontrado el momento.
- [Monitor de métricas](/docs/monitor/metrics-monitor): Alertar sobre la métrica que estaba mirando.
:::
