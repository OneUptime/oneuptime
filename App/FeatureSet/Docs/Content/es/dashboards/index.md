# Visión general de los paneles

Los paneles son la forma en que conviertes la telemetría que OneUptime ya está recopilando — métricas, logs, trazas, incidentes, monitores, recursos de Kubernetes y Docker — en una sola página que alguien puede mirar de un vistazo y entender la salud de un sistema.

Coloca un gráfico de latencia de peticiones junto a una lista de incidentes abiertos, junto a un indicador de utilización de CPU, junto a una frase de estado en lenguaje claro. Guarda. Comparte el enlace.

## De un vistazo

- **Función de primer nivel** en el panel de OneUptime, en **Dashboards**.
- **Lienzo basado en cuadrícula** — 12 unidades de ancho por 60 unidades de alto por defecto. Arrastra widgets, redimensiónalos, ajústalos a la cuadrícula.
- **Más de 20 tipos de widgets** — gráficos, valores únicos, indicadores, tablas, bloques de texto, transmisiones de logs, listas de trazas y listas en vivo de recursos para incidentes, alertas, monitores, Kubernetes (pods, nodos, deployments, …), Docker y hosts.
- **Variables y filtros** — convierte un único panel en una vista templada que se reutiliza para cada cluster, servicio, cliente o entorno.
- **Compartir públicamente** — activa un interruptor y el panel queda accesible en una URL pública, con protección opcional con contraseña y lista blanca de IP.
- **Dominios personalizados** — aloja un panel público en `status.your-domain.com` en lugar del de OneUptime.

## ¿Por qué usar paneles?

Los paneles se ganan su sitio cuando se cumple alguna de estas:

- **Necesitas una página de "¿está todo OK?"** para una rotación de guardia, un standup de equipo o un CEO que pasa por delante de la TV mural.
- **Necesitas correlacionar señales** — un pico de CPU en el mismo minuto que un aumento de latencia de traza y un incidente abierto es mucho más obvio en un solo panel que entre tres pestañas.
- **Estás investigando** — un panel libre que construyes durante una sesión de depuración es más rápido que ejecutar diez consultas a mano.
- **Estás publicando externamente** — un panel de rendimiento orientado al cliente, un resumen orientado al socio, un tablero público de salud para un servicio open-source.

## Conceptos clave

| Término | Significado |
| --- | --- |
| **Panel** | El lienzo. Una vista nombrada y reutilizable que contiene una lista de widgets, un control de rango de tiempo y un conjunto de variables. |
| **Widget** | Un componente en el lienzo — un gráfico, un valor, una tabla, un bloque de texto, una lista. Cada uno tiene un tipo y una configuración estilo JSON. |
| **Unidad de panel** | El cuadro de la cuadrícula. Los widgets se dimensionan en unidades de panel (por ejemplo, "4 de ancho × 6 de alto"). Las unidades se convierten a píxeles según el viewport. |
| **Variable** | Un valor nombrado que el espectador elige de un desplegable (o escribe) y que el panel inyecta en la consulta de cada widget. Cluster, servicio, cliente, entorno — cualquier cosa por la que quieras filtrar. |
| **Rango de tiempo** | La ventana de tiempo contra la que consulta cada widget. Elige un preset ("últimas 24 horas") o un rango personalizado. |
| **Intervalo de refresco** | Con qué frecuencia se vuelven a consultar los widgets en modo **View**. Off, 5s, 10s, 30s, 1m, 5m, 15m. |
| **Modo** | `Edit` (arrastrar, redimensionar, configurar) o `View` (solo lectura). Ambos comparten el mismo lienzo. |

## El catálogo de widgets

Un mapa no exhaustivo de lo que puedes poner en un panel:

| Categoría | Widgets |
| --- | --- |
| **Series temporales** | Chart |
| **Número único** | Value, Gauge |
| **Tabulares** | Table |
| **Anotación** | Text |
| **Logs y trazas** | LogStream, TraceList |
| **Listas operacionales** | IncidentList, AlertList, MonitorList |
| **Kubernetes** | KubernetesPodList, KubernetesNodeList, KubernetesNamespaceList, KubernetesDeploymentList, KubernetesStatefulSetList, KubernetesDaemonSetList, KubernetesJobList, KubernetesCronJobList |
| **Docker** | DockerHostList, DockerContainerList, DockerImageList, DockerNetworkList, DockerVolumeList |
| **Infraestructura** | HostList |

Para los argumentos de cada uno y cuándo recurrir a él, consulta [Widgets](/docs/dashboards/widgets).

## Dónde viven los paneles en el panel

| Página | Qué haces ahí |
| --- | --- |
| **Dashboards** | Navegar, crear, buscar y etiquetar paneles. |
| **Un panel → View** | El lienzo — modo Edit para autores, modo View para todos los demás. Alterna entre ellos en el encabezado. |
| **Un panel → Overview** | Descripción, propiedad, etiquetas. |
| **Un panel → Settings** | Compartir públicamente, contraseña maestra, lista blanca de IP, dominios personalizados, marca (título de página, descripción, logo, favicon). |
| **Un panel → Owners** | Usuarios y equipos con propiedad explícita. |
| **Un panel → Delete** | Eliminar el panel (irreversible). |

## El ciclo de vida de un panel

1. **Crear** — En **Dashboards → Create Dashboard**, ponle un nombre. El lienzo se abre vacío.
2. **Colocar widgets** — Desde la paleta de widgets, elige un tipo, configura su fuente (una consulta de métrica, un filtro de lista, un cuerpo de texto libre). Posiciona y redimensiona.
3. **(Opcional) Añadir variables** — Define un desplegable como `cluster` o `service` para que el mismo panel se renderice para cada valor.
4. **Establecer el rango de tiempo y el intervalo de refresco** — Los valores por defecto funcionan bien; ajústalos más tarde.
5. **(Opcional) Compartir públicamente** — En **Settings**, activa **Public Dashboard**. Añade una contraseña maestra si quieres una puerta, o restringe por IP.
6. **(Opcional) Dominio personalizado** — Añade un registro `dashboard.your-domain.com` y verifica el DNS, luego sirve el panel en tu propia URL.

## Un ejemplo trabajado

Objetivo: una página de guardia para el servicio checkout con latencia, tasa de error, incidentes abiertos y un tail reciente de logs.

1. Crea un panel "Checkout oncall".
2. Añade una variable `service` de tipo **Telemetry Attribute** ligada a la clave de atributo `service.name`. Valor por defecto `checkout`.
3. Añade un widget **Chart**: latencia P95 de tu métrica APM, filtrada por `service.name = {{service}}`. El rango de tiempo sigue al panel.
4. Junto a él, añade un widget **Value**: porcentaje de tasa de error con un umbral de advertencia al 1% y un umbral crítico al 5%.
5. Debajo, añade un widget **IncidentList** filtrado por etiquetas que incluyan `checkout`.
6. Debajo de eso, un widget **LogStream** filtrado por `service.name = {{service}}`.
7. Guarda. Cambia el desplegable de la variable a `payments` — todo el panel se vuelve a renderizar para el servicio payments. Misma plantilla, distinto filtro.

## Cómo encajan los paneles con el resto de OneUptime

- **Los monitores y la telemetría** alimentan los paneles con datos en bruto — cada métrica que has configurado, cada línea de log que has ingerido, cada span de traza es consultable en un widget.
- **Los incidentes y las alertas** aparecen en los widgets **IncidentList** y **AlertList** — los paneles son vistas de solo lectura sobre ellos; crea/edita esas entidades en otro sitio.
- **Las páginas de estado** son una herramienta de comunicación orientada al cliente ("¿está el sistema activo ahora mismo?"). Los paneles son una herramienta analítica ("¿cómo se está comportando el sistema en detalle?"). Son complementarias, no sustitutas.
- **Los flujos de trabajo** son el lado de escritura de OneUptime — los paneles son el lado de lectura.

## Qué leer a continuación

- [Crear un panel](/docs/dashboards/authoring) — usar el lienzo, la cuadrícula, modo edit vs view.
- [Widgets del panel](/docs/dashboards/widgets) — el catálogo y la configuración por widget.
- [Variables y filtros del panel](/docs/dashboards/variables) — templar un panel para que funcione con muchos servicios / clientes / clusters.
- [Compartir y paneles públicos](/docs/dashboards/sharing) — URLs públicas, contraseña maestra, lista blanca de IP, dominios personalizados.
- [Configuración y permisos del panel](/docs/dashboards/configuration) — propiedad, etiquetas, retención, control de acceso basado en roles.
