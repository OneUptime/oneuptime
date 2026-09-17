# Widgets

Un widget es una casilla en un panel. Esta página lista cada widget que puedes añadir, qué muestra y cuándo recurrir a él.

Para saber cómo arrastrar widgets por el lienzo, consulta [Crear un Panel](/docs/dashboards/authoring).

## Gráficos y números

### Gráfico

Un gráfico de líneas, barras o áreas de una o más series de métricas durante el rango de tiempo del panel.

**Configuración**:

- Una o más consultas de métricas.
- Una fórmula opcional que combina dos consultas (por ejemplo, `errors / total * 100` para obtener una tasa de errores).
- Una opción "mostrar como tasa" para contadores acumulativos que crecen sin reiniciarse.
- Opciones de visualización: apilado o superpuesto, unidad del eje Y, posición de la leyenda, tipo de gráfico.

Úsalo cuando: las tendencias importan. Latencia a lo largo del tiempo, conteo de errores, profundidad de cola, cualquier cosa donde la forma de la línea cuenta la historia.

### Valor

Un solo número grande con umbrales coloreados opcionales.

**Configuración**:

- Una consulta de métrica que devuelve un número (último valor, promedio o máximo durante el rango de tiempo).
- Un umbral de **advertencia** opcional (amarillo cuando se supera).
- Un umbral **crítico** opcional (rojo cuando se supera).
- Formato y unidad de número.

Úsalo cuando: un solo número responde la pregunta. Tasa de errores actual, latencia P95 ahora mismo, conteo de incidentes abiertos.

### Indicador

Un indicador circular con un mínimo, un máximo, una banda de advertencia y una banda crítica.

**Configuración**: una consulta de métrica y los cuatro límites.

Úsalo cuando: el valor encaja dentro de un rango conocido. Porcentaje de CPU (0–100%), uso de disco, capacidad de cola.

### Tabla

Una tabla de resultados de métrica, una fila por grupo.

**Configuración**: una consulta de métrica (normalmente agrupada por una etiqueta como host o servicio), las columnas a mostrar y un límite de filas.

Úsalo cuando: quieres un desglose en lugar de una tendencia. Top 10 de hosts más ruidosos, conteo de errores por servicio, solicitudes por endpoint.

## Texto

Un bloque estático de Markdown.

**Configuración**: el cuerpo en Markdown. Encabezados, listas, enlaces, énfasis y bloques de código se renderizan.

Úsalo cuando: quieres un encabezado de sección, un párrafo de contexto, una lista de enlaces a runbooks o una banderola temporal durante un incidente.

## HTML

Tu propio HTML, CSS y JavaScript, renderizado como un widget.

**Configuración**: el cuerpo HTML, una hoja de estilos opcional, un script opcional y tres interruptores de permisos.

Úsalo cuando: necesitas algo que ningún widget integrado cubre: una insignia de terceros incrustada, una tabla extraída de una API interna, una leyenda personalizada, un conjunto de enlaces con estilo hacia tus propias herramientas.

### Qué puede y qué no puede hacer

El widget se renderiza en un marco con sandbox, en su propio origen aislado. Dentro de ese marco tu código puede hacer prácticamente cualquier cosa: construir el DOM, ejecutar temporizadores, hacer fetch a cualquier URL, dibujar en un canvas.

Lo que no puede hacer es alcanzar la página de OneUptime que lo rodea. No tiene acceso al DOM del panel, ni a las cookies, ni al almacenamiento local, ni a la sesión de la API, y no puede sacar la pestaña del navegador a otra página. Esto se cumple tanto si el panel es privado como si se comparte públicamente.

Dos consecuencias que conviene conocer antes de pegar algo dentro:

- Un `fetch` desde el widget es una solicitud de origen cruzado desde un origen opaco, así que el servidor al que llamas tiene que permitirla con CORS. No se admite llamar a la API de OneUptime desde aquí.
- El widget empieza siendo transparente. Establece un fondo en `body` en tu CSS si quieres que rellene la tarjeta.

### Usar variables del panel

Escribe `{{variableName}}` en cualquier lugar del HTML, CSS o JavaScript y se reemplaza por el valor actual de esa variable antes de que el widget se renderice. Elegir un valor nuevo vuelve a renderizar el widget. Un marcador de posición que nombra una variable que no existe se deja tal cual.

Los scripts reciben los mismos valores, más el rango de tiempo del panel, en `window.ONEUPTIME`:

```javascript
window.ONEUPTIME.variables.environment; // valor actual, o "" si no está definido
window.ONEUPTIME.startDate; // cadena ISO 8601, inicio del rango de tiempo del panel
window.ONEUPTIME.endDate; // cadena ISO 8601, fin del mismo
```

El widget se recarga cada vez que el panel se actualiza, así que un widget que obtiene sus propios datos sigue el ritmo del intervalo de actualización.

### Permisos

**Run JavaScript** (ejecutar JavaScript; activado de forma predeterminada) ejecuta tu script. Desactívalo para renderizar solo el marcado y los estilos: en ese caso el script se omite por completo del widget en lugar de solo bloquearse.

**Open links in a new tab** (abrir enlaces en una pestaña nueva; activado de forma predeterminada) permite que los enlaces y `window.open` abran una pestaña del navegador. Los enlaces siempre se abren en una pestaña nueva; el widget nunca puede navegar el panel en sí.

**Allow forms to submit** (permitir el envío de formularios; desactivado de forma predeterminada) permite que un `<form>` dentro del widget se envíe.

Cualquiera que pueda editar el panel decide qué ejecuta este widget, y todo el que ve el panel lo ejecuta: en un panel público, eso incluye a visitantes anónimos. Trata el acceso de edición a un panel que lleva un widget HTML igual que tratarías el acceso a cualquier otro código que publicas.

## Logs y trazas

### Gráfico de Logs

Un gráfico de series temporales del volumen de logs a lo largo del rango temporal del panel. Cada serie representa una severidad, así que los picos de error destacan sobre el tráfico normal.

**Configuración**:

- Visualización como gráfico de barras, líneas o áreas. Los gráficos de barras y áreas apilan las series de severidad.
- Filtros de severidad opcionales.
- Búsqueda de texto opcional en el cuerpo del log.
- Filtros exactos de atributos de OpenTelemetry mediante filas de clave/valor buscables. Los nombres de atributo y los valores conocidos se sugieren mientras escribes, y los valores personalizados siguen admitiéndose.
- Un título opcional.

Los controles de rango temporal y de refresco del panel vuelven a consultar el gráfico automáticamente. Las variables de atributos de telemetría del panel también se le aplican, incluidas las de selección múltiple.

El Gráfico de Logs requiere por ahora un panel autenticado. Los paneles públicos muestran el widget como no disponible en lugar de exponer de forma anónima los agregados de logs del proyecto.

Úsalo cuando: quieres detectar cambios en el volumen de logs o comparar errores, advertencias e informativos sin salir del panel.

### Flujo de Logs

Un seguimiento en vivo de líneas de logs que coinciden con un filtro.

**Configuración**: filtros de logs (servicio, severidad, atributos) y las columnas a mostrar.

Úsalo cuando: quieres ver qué está diciendo la aplicación ahora mismo, sin salir del panel.

### Lista de Trazas

Una lista de trazas recientes que coinciden con un filtro, con duración, estado y servicio.

**Configuración**: filtros de trazas (servicio, estado, atributos).

Úsalo cuando: quieres una lista de actividad reciente en lugar de un gráfico. Un patrón común es un gráfico de latencia en la parte superior con una lista de trazas lentas debajo.

## Listas en vivo

### Lista de Incidentes

Una lista en vivo de incidentes que coinciden con un filtro.

**Configuración**: filtros por estado, severidad, etiquetas, monitor o equipo.

Úsalo cuando: el panel responde "¿qué está roto ahora mismo?".

### Lista de Alertas

Una lista en vivo de alertas que coinciden con un filtro.

**Configuración**: filtros por estado, severidad, etiquetas.

Úsalo cuando: un panel de equipo sigue las alertas de sus servicios.

### Lista de Monitores

Una lista en vivo de monitores y su estado actual.

**Configuración**: filtros por tipo de monitor, etiquetas o estado actual.

Úsalo cuando: quieres una vista de flota: "¿están todos los sitios activos?".

## Objetivos de nivel de servicio

### SLO

Un objetivo de nivel de servicio, dibujado como un único número o como una línea a lo largo del tiempo.

**Configuración**: qué SLO, cuál de sus tres números (SLI, presupuesto de error restante o tasa de consumo), presentación como Tarjeta o Gráfico, y un título opcional.

- **Tarjeta** muestra el número actual y, cuando la hay, una segunda línea: el objetivo debajo del SLI, los minutos restantes debajo del presupuesto de error. Una etiqueta de estado colorea el conjunto.
- **Gráfico** dibuja el mismo número a lo largo del rango temporal del panel, con el objetivo marcado como una línea discontinua en la serie del SLI. El historial lo escribe el worker de evaluación cada pocos minutos, así que un SLO recién creado se dibuja vacío hasta que se evalúa por primera vez.

Úsalo cuando: el panel responde a "¿estamos cumpliendo lo que prometimos?" en lugar de "¿qué está pasando ahora mismo?".

El widget de SLO funciona en [paneles públicos](/docs/dashboards/sharing). Lo que se publica son las cifras principales del SLO: su nombre, objetivo, SLI actual, presupuesto de error restante, tasa de consumo y estado, sin importar cuál de ellas dibuje el widget. Su definición sigue siendo privada: los monitores que vigila, sus etiquetas, su descripción, su consulta y su programación de evaluación nunca se envían a un visitante público. Un widget de Tarjeta publica solo esas cifras actuales; un widget de Gráfico publica además el historial de la única serie que dibuja, y nada más.

## Listas de recursos de Kubernetes

Para proyectos con un [Kubernetes Agent](/docs/monitor/kubernetes-agent) instalado. Cada uno toma filtros opcionales para cluster, namespace y etiquetas.

- **Lista de Pods de Kubernetes** — pods con su fase, reinicios y nodo.
- **Lista de Nodos de Kubernetes** — nodos con sus condiciones y capacidad.
- **Lista de Namespaces de Kubernetes** — namespaces y conteos de cargas de trabajo.
- **Lista de Deployments de Kubernetes** — deployments con réplicas deseadas vs. listas.
- **Lista de StatefulSets de Kubernetes** — stateful sets con réplicas listas.
- **Lista de DaemonSets de Kubernetes** — daemon sets con deseadas vs. listas.
- **Lista de Jobs de Kubernetes** — jobs y su estado de finalización.
- **Lista de CronJobs de Kubernetes** — cron jobs con programación y última ejecución.

Úsalos cuando: quieres un solo panel que mezcle el estado de Kubernetes con la telemetría de esas cargas de trabajo.

## Listas de recursos de Docker

Para proyectos con monitorización de Docker configurada.

- **Lista de Hosts de Docker** — hosts ejecutando Docker, con conteos de contenedores.
- **Lista de Contenedores de Docker** — contenedores con estado, imagen, host, tiempo activo.
- **Lista de Imágenes de Docker** — imágenes y sus tamaños.
- **Lista de Redes de Docker** — redes de Docker y contenedores conectados.
- **Lista de Volúmenes de Docker** — volúmenes de Docker y su uso.

## Infraestructura

### Lista de Hosts

Hosts monitorizados por el monitor de servidor de OneUptime, con estado, CPU, memoria y tiempo activo.

**Configuración**: filtros por etiquetas o estado actual.

## Red

### Mapa de Red

Tus sitios de red dibujados en el mapa del mundo, cada uno fijado en su propia latitud y longitud y coloreado según el estado de monitor agregado sobre él. Los sitios próximos entre sí comparten un marcador con el recuento impreso dentro; un marcador que representa exactamente un sitio abre ese sitio al hacer clic.

El mapa se encuadra según los sitios que dibujó: un parque dentro de un solo país llena el encuadre con ese país, y uno repartido entre continentes se abre sobre el mundo. No hay controles de zoom ni de desplazamiento: una tarjeta de panel es una imagen, y la página Mapa de Red, dentro de Red, es donde recorres la jerarquía.

Sobre el mapa se imprime cuántos sitios están caídos, porque un punto rojo de dos píxeles entre doscientos verdes no es algo que nadie lea a distancia de panel. Debajo, una línea de cobertura dice lo que el mapa _no_ está mostrando: sitios sin coordenadas, y si se alcanzó el límite de filas.

**Configuración**: título, vista de mapa o de lista, máximo de sitios dibujados, si se imprimen los nombres de sitio, y filtros por tipo de sitio y por estado. Los nombres de sitio desaparecen automáticamente cuando el mapa se llena demasiado para poder leerlos; el tooltip sigue nombrando cada marcador.

Un sitio solo aparece si tiene coordenadas. Añade latitud y longitud en el sitio (o impórtalas desde CSV) para fijarlo.

## ¿Qué widget debo usar?

Algunas reglas rápidas:

- **¿Tendencia a lo largo del tiempo?** Gráfico.
- **¿Volumen de logs o picos de error a lo largo del tiempo?** Gráfico de Logs.
- **¿Un número que importa ahora mismo?** Valor (o Indicador si tiene un mínimo/máximo claro).
- **¿Desglose entre muchas cosas?** Tabla.
- **¿Qué está pasando en el sistema ahora mismo?** Flujo de Logs, Lista de Trazas, Lista de Incidentes.
- **¿El estado de un grupo específico de recursos?** El widget de lista correspondiente.
- **¿Estamos cumpliendo la fiabilidad que prometimos?** SLO.
- **¿Dónde está tu red en el mundo y qué está en rojo?** Mapa de Red.
- **¿Un encabezado, un párrafo o un enlace?** Texto.
- **¿Algo que no cubre nada de lo anterior?** HTML — pero solo después de comprobar que un widget integrado realmente no puede hacerlo.

La mayoría de los paneles mezclan varios: un gráfico en la parte superior, uno o dos valores al lado, un divisor de texto y una o dos listas debajo.

## Dónde seguir leyendo

- [Variables y Filtros](/docs/dashboards/variables) — hacer que los widgets sean reutilizables para muchos servicios o clientes.
- [Crear un Panel](/docs/dashboards/authoring) — la mecánica del lienzo.
- [Compartir y Paneles Públicos](/docs/dashboards/sharing) — compartir fuera de tu equipo.
