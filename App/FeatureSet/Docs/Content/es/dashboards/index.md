# Resumen de Paneles

Los paneles convierten los datos que OneUptime ya está recopilando —métricas, logs, trazas, incidentes, monitores, recursos de Kubernetes, hosts— en una sola página que alguien puede mirar de un vistazo y entender qué está ocurriendo.

Coloca un gráfico de latencia de solicitudes junto a una lista de incidentes abiertos, junto a un indicador de CPU, junto a un párrafo de contexto. Guárdalo. Comparte el enlace.

## Para qué son útiles los paneles

- **Una página de "¿está todo bien?"** — para guardias, una reunión de equipo o una pantalla en la pared.
- **Detectar conexiones** — un pico de CPU al mismo tiempo que un aumento de latencia y un incidente abierto es mucho más fácil de ver en una sola página que en tres pestañas.
- **Investigar** — cuando estás depurando, un panel que construyes sobre la marcha supera ejecutar diez consultas una a una.
- **Compartir externamente** — una página de rendimiento de cara al cliente, una página de estado para socios, un panel público para un proyecto de código abierto.

## Qué puedes poner en un panel

- **Gráficos** para tendencias a lo largo del tiempo: latencia, errores, throughput.
- **Casillas de valor único e indicadores** — tasa de errores actual, CPU, incidentes abiertos.
- **Tablas** para desgloses: top 10 de hosts más ruidosos, conteo de errores por servicio.
- **Bloques de texto** para encabezados, contexto y enlaces a runbooks.
- **Listas en vivo** de incidentes, alertas, monitores, logs, trazas, recursos de Kubernetes, recursos de Docker y hosts.

Consulta [Widgets](/docs/dashboards/widgets) para ver la lista completa y qué muestra cada uno.

## Términos clave

| Término             | Qué significa                                                                                                      |
| ------------------- | ------------------------------------------------------------------------------------------------------------------ |
| **Panel**           | La página completa: un nombre, una cuadrícula de widgets, controles de rango de tiempo y una lista de variables.   |
| **Widget**          | Una casilla en la página: un gráfico, un número, una lista, un párrafo.                                            |
| **Variable**        | Un menú desplegable en la parte superior que filtra cada widget a la vez (cluster, servicio, cliente, entorno).    |
| **Rango de tiempo** | La ventana de tiempo que usan todos los gráficos y números. Configúrala una vez en la parte superior de la página. |
| **Actualización**   | Con qué frecuencia los widgets vuelven a consultar los datos. Apagado, cada pocos segundos, cada pocos minutos.    |
| **Modo**            | **Edición** (arrastrar widgets) o **Vista** (solo lectura, la forma en que lo ven los visitantes).                 |

## Dónde encontrar los paneles

Abre **Paneles** en la navegación lateral.

| Página                    | Qué haces allí                                                                             |
| ------------------------- | ------------------------------------------------------------------------------------------ |
| **Paneles**               | Tu lista de paneles. Crea uno nuevo, busca o filtra por etiqueta.                          |
| **Panel → Vista**         | El lienzo. Alterna entre **Edición** y **Vista** en el encabezado.                         |
| **Panel → Resumen**       | Descripción, propietarios y etiquetas.                                                     |
| **Panel → Configuración** | Compartir públicamente, contraseña, lista de IPs permitidas, dominio personalizado, marca. |
| **Panel → Propietarios**  | Usuarios y equipos con acceso explícito.                                                   |
| **Panel → Eliminar**      | Eliminar el panel.                                                                         |

## Construir un panel

1. **Crear** — elige un nombre. El lienzo se abre vacío.
2. **Añadir widgets** — elige un tipo de widget, configura sus datos y arrástralo donde quieras.
3. **(Opcional) Añadir variables** — por ejemplo, un menú desplegable `service` para que el mismo panel funcione para cada servicio.
4. **Establecer el rango de tiempo** — los valores predeterminados están bien; ajústalos después.
5. **(Opcional) Compartir públicamente** — activa el interruptor en Configuración, añade una contraseña o lista de IPs permitidas si es necesario.
6. **(Opcional) Dominio personalizado** — aloja el panel en `status.tu-dominio.com`.

## Un ejemplo rápido

Objetivo: una página de guardia para el servicio de checkout con latencia, tasa de errores, incidentes abiertos y un seguimiento de logs en vivo.

1. Crea un panel llamado "Checkout de guardia".
2. Añade una variable `service`. Establece el valor predeterminado en `checkout`.
3. Añade un widget de **Gráfico** con latencia P95, filtrado por la variable `service`.
4. Junto a él, añade un widget de **Valor** para la tasa de errores, con advertencia al 1% y crítico al 5%.
5. Debajo, añade un widget de **Lista de Incidentes** para incidentes etiquetados como `checkout`.
6. Debajo de eso, un widget de **Flujo de Logs** mostrando logs del mismo servicio.
7. Guarda. Cambia el menú desplegable a `payments`: el mismo panel ahora muestra el servicio de pagos.

## Cómo encajan los paneles con el resto de OneUptime

- Los **monitores y la telemetría** son las fuentes de datos. Cada métrica, log y traza que recopilas se puede consultar en un widget.
- Los **incidentes y alertas** aparecen en los widgets **Lista de Incidentes** y **Lista de Alertas**. Los paneles son solo de lectura para estos; créalos y actualízalos en otra parte.
- Las **páginas de estado** son comunicación de cara al cliente ("¿está el sistema activo?"). Los paneles son para ver con detalle cómo se comporta el sistema. Ambos trabajan juntos, no se reemplazan.
- Los **workflows** son cómo OneUptime actúa. Los paneles son cómo lees lo que ocurre.

## Dónde seguir leyendo

- [Crear un Panel](/docs/dashboards/authoring) — usar el lienzo, editar widgets.
- [Widgets](/docs/dashboards/widgets) — la lista completa de widgets.
- [Variables y Filtros](/docs/dashboards/variables) — hacer que un panel funcione para muchos servicios o clientes.
- [Compartir y Paneles Públicos](/docs/dashboards/sharing) — URLs públicas, contraseñas, lista de IPs permitidas, dominios personalizados.
- [Configuración y Permisos](/docs/dashboards/configuration) — propietarios, etiquetas, control de acceso.
