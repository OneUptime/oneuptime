# Visión general de los flujos de trabajo

Los flujos de trabajo son el constructor visual de automatización de OneUptime. Arrastra un disparador a un lienzo, conéctalo a una cadena de acciones — llamadas HTTP, mensajes de Slack, fragmentos de JavaScript, ramas condicionales, búsquedas en base de datos — y tendrás una automatización que se ejecuta cada vez que se dispara un evento en OneUptime (o en el mundo exterior).

Si los runbooks son listas de verificación para humanos durante un incidente, los flujos de trabajo son tareas en segundo plano para tu proyecto — se ejecutan sin supervisión, reaccionan a eventos y unen OneUptime con el resto de tu stack.

## De un vistazo

- **Función de primer nivel** en el panel de OneUptime, en **Workflows**.
- **Tres estilos de disparador**: Manual, Programado (cron), Webhook — además de un **disparador de evento de modelo** que se activa cuando cualquier entidad de OneUptime (incidente, alerta, monitor, página de estado, etc.) se crea, actualiza o elimina.
- **Lienzo visual**: arrastra nodos desde una paleta de componentes, conecta los puertos de salida a los puertos de entrada.
- **Automatización mixta**: peticiones HTTP, mensajes de Slack / Discord / Microsoft Teams / Telegram, JavaScript personalizado, parsing de JSON, condicionales, correo electrónico, llamadas a subflujos y operaciones CRUD sobre los modelos de OneUptime.
- **Variables globales**: secretos y configuración a nivel de proyecto que puedes referenciar desde cualquier flujo de trabajo sin copiar y pegar.
- **Ejecuciones y registros**: cada ejecución queda registrada con estado, tiempos y salida por paso.

## ¿Por qué usar flujos de trabajo?

La mayoría de los equipos recurren a los flujos de trabajo cuando quieren:

- **Conectar OneUptime con otro sistema** — publicar un incidente en PagerDuty, replicar una alerta en Jira, llamar a un webhook de tu stack.
- **Reaccionar a eventos de OneUptime** — cuando se abre un incidente `Sev 1`, alertar al responsable de guardia *y* crear un ticket en Linear *y* bloquear un feature flag.
- **Programar tareas recurrentes** — cada cinco minutos, consultar una API interna y escribir el resultado en un sistema externo.
- **Recibir datos desde fuera de OneUptime** — un webhook desde un sistema de CI dispara una cadena de actualizaciones en OneUptime.
- **Reutilizar pequeños bloques de lógica de pegamento** — un flujo de trabajo llama a otro, de modo que los patrones comunes viven en un solo sitio.

## Conceptos clave

| Término | Significado |
| --- | --- |
| **Flujo de trabajo** | El lienzo. Un grafo nombrado y reutilizable de disparadores y componentes, con un flag `isEnabled`. |
| **Disparador** | El nodo que inicia una ejecución del flujo. Manual, Programado, Webhook o un evento de modelo. Cada flujo de trabajo tiene exactamente un disparador. |
| **Componente** | Un nodo que realiza trabajo — una llamada HTTP, un mensaje de Slack, un fragmento de JavaScript, una condición, etc. |
| **Puerto** | Un conector de entrada o salida en un nodo. Los componentes tienen puertos de salida como `success` y `error`; conectas un puerto al puerto de entrada del siguiente nodo. |
| **Ejecución / Registro** | Una corrida de un flujo de trabajo. Contiene la marca de tiempo, el estado (Running, Success, Failed, Timeout) y la salida capturada de cada nodo que se ejecutó. |
| **Variable global** | Un valor nombrado (a menudo un secreto o una clave de API) definido una vez a nivel de proyecto y referenciado desde cualquier flujo de trabajo como `{{variable.NAME}}`. |
| **Variable local** | Un valor con alcance a una sola ejecución del flujo — típicamente el valor de retorno de un nodo anterior, referenciado como `{{ComponentId.portName}}`. |

## Dónde viven los flujos de trabajo en el panel

| Página | Qué haces ahí |
| --- | --- |
| **Workflows** | Navegar, crear y buscar plantillas de flujos de trabajo. |
| **Pestaña Builder de un flujo de trabajo** | El lienzo de arrastrar y soltar. Añade nodos, conecta puertos, configura argumentos. |
| **Pestaña Logs de un flujo de trabajo** | Cada ejecución de este flujo con filtros por estado y rango de tiempo. Haz clic en una ejecución para ver la salida por nodo. |
| **Pestaña Settings de un flujo de trabajo** | Renombrar, habilitar/deshabilitar, cambiar la descripción, gestionar etiquetas, eliminar. |
| **Workflows → Global Variables** | Definir valores a nivel de proyecto referenciados desde cualquier flujo. Marca un valor como secreto para ocultarlo de la interfaz tras guardar. |
| **Workflows → Runs & Logs** | Historial de ejecución a nivel de proyecto, abarcando todos los flujos. |

## El ciclo de vida de un flujo de trabajo

1. **Redactar** — Crea un flujo de trabajo, coloca un disparador en el lienzo, arrastra los componentes que necesitas, conéctalos y configura cada uno.
2. **Habilitar** — Los flujos de trabajo se envían deshabilitados. Activa el interruptor en Settings cuando estés seguro de que el cableado es correcto.
3. **Disparar** — Manual: pulsa **Run Manually** con un payload JSON opcional. Programado: el cron se activa. Webhook: un sistema externo hace `POST` a la URL del flujo. Evento de modelo: alguien (u otro flujo) crea/actualiza/elimina un monitor, incidente, alerta, etc.
4. **Ejecutar** — El Workflow Worker recorre el grafo en orden. Cada componente lee sus argumentos (valores literales o variables interpoladas), hace su trabajo, escribe su valor de retorno y elige un puerto de salida. El siguiente nodo se dispara.
5. **Auditar** — La ejecución aparece en **Logs**. Estado, duración total, salida por componente y cualquier error quedan guardados durante la vida del proyecto.

## Un ejemplo trabajado

Objetivo: cuando se crea un incidente con `Sev 1` en el título, publicar en un canal de Slack y abrir un ticket en tu herramienta admin interna.

**1. Crea un flujo de trabajo** llamado "Sev 1 fan-out".

**2. Coloca un disparador.** Elige el disparador **Incident → On Create** de la paleta. El disparador expone el nuevo incidente como valor de retorno.

**3. Coloca un componente Conditional.** Conecta el puerto de salida del disparador a su entrada. Define la condición: `{{Incident.title}}` *contains* `Sev 1`.

**4. Desde el puerto `yes` del Conditional, coloca un componente Slack.** Canal: `#incident-room`. Cuerpo del mensaje: `Sev 1 declared: {{Incident.title}} — {{Incident.dashboardUrl}}`.

**5. Desde el mismo puerto `yes` (en paralelo), coloca un componente API.** `POST` a `https://admin.internal/incidents`. Cuerpo: un pequeño objeto JSON construido a partir del incidente.

**6. Habilita el flujo de trabajo.** Abre un incidente titulado "Sev 1 — checkout 500s" en otra pestaña. En unos segundos llega el mensaje a Slack y aparece una nueva ejecución en **Logs** con la salida de cada nodo capturada.

## Cómo encajan los flujos de trabajo con el resto de OneUptime

- **Los monitores** detectan problemas; **los incidentes/alertas** los registran; **los flujos de trabajo** reaccionan a ellos — publican mensajes, abren tickets, lanzan automatización.
- **Los runbooks** son procedimientos de respuesta para humanos (con pasos de script opcionales). Los flujos de trabajo son automatización en segundo plano sin supervisión. Son complementarios — un paso de runbook podría hacer `POST` a un disparador webhook de un flujo de trabajo.
- **Las conexiones de espacio de trabajo** (Slack, Microsoft Teams) son los destinos típicos de las notificaciones de un flujo de trabajo.
- **Los paneles** son vistas de solo lectura; los flujos de trabajo son el lado de escritura — actualizan el estado de OneUptime, llaman a APIs externas y mueven datos.

## Qué leer a continuación

- [Crear un flujo de trabajo](/docs/workflows/authoring) — construir un flujo de trabajo en el lienzo, configurar nodos, cablear puertos.
- [Disparadores](/docs/workflows/triggers) — disparadores Manual, Programado, Webhook y de evento de modelo en detalle.
- [Componentes](/docs/workflows/components) — el catálogo de acciones y cómo configurar cada una.
- [Variables](/docs/workflows/variables) — variables globales, variables locales y cómo funciona la interpolación.
- [Ejecuciones y registros](/docs/workflows/runs-and-logs) — leer el historial de ejecución, depurar fallos.
- [Configuración y seguridad](/docs/workflows/configuration) — habilitar/deshabilitar, propiedad, etiquetas, secretos, límites de recursión.
