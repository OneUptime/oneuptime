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

## Logs y trazas

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

## ¿Qué widget debo usar?

Algunas reglas rápidas:

- **¿Tendencia a lo largo del tiempo?** Gráfico.
- **¿Un número que importa ahora mismo?** Valor (o Indicador si tiene un mínimo/máximo claro).
- **¿Desglose entre muchas cosas?** Tabla.
- **¿Qué está pasando en el sistema ahora mismo?** Flujo de Logs, Lista de Trazas, Lista de Incidentes.
- **¿El estado de un grupo específico de recursos?** El widget de lista correspondiente.
- **¿Un encabezado, un párrafo o un enlace?** Texto.

La mayoría de los paneles mezclan varios: un gráfico en la parte superior, uno o dos valores al lado, un divisor de texto y una o dos listas debajo.

## Dónde seguir leyendo

- [Variables y Filtros](/docs/dashboards/variables) — hacer que los widgets sean reutilizables para muchos servicios o clientes.
- [Crear un Panel](/docs/dashboards/authoring) — la mecánica del lienzo.
- [Compartir y Paneles Públicos](/docs/dashboards/sharing) — compartir fuera de tu equipo.
