# Visión general de los flujos de trabajo

Los flujos de trabajo te permiten automatizar tareas en OneUptime sin escribir código. Añade unos cuantos bloques a un lienzo, conéctalos entre sí, y tendrás una automatización que se ejecuta cada vez que ocurre algo: se abre un incidente, se dispara una programación, o otra herramienta envía datos a OneUptime.

Piensa en los flujos de trabajo como ayudantes de fondo para tu proyecto: reaccionan a eventos, hablan con otras herramientas y mantienen las cosas sincronizadas en silencio mientras tú te concentras en tu trabajo.

## Qué puedes hacer con los flujos de trabajo

- **Conectar OneUptime con tus otras herramientas** — envía incidentes a Slack, crea tickets de Jira, publica en un webhook de tu stack.
- **Reaccionar a lo que ocurre en OneUptime** — cuando se crea un incidente crítico, notifica al equipo de guardia y abre un ticket automáticamente.
- **Ejecutar tareas según una programación** — cada cinco minutos, cada noche, cada lunes por la mañana.
- **Recibir datos desde fuera** — deja que otros sistemas envíen datos a OneUptime a través de una URL única.
- **Reutilizar automatizaciones comunes** — constrúyela una vez, llámala desde cualquier otro flujo de trabajo.

## Cómo funciona un flujo de trabajo

Todo flujo de trabajo tiene tres partes:

1. **Un disparador** — lo que inicia el flujo de trabajo. Puede ser un botón manual, una programación, un webhook entrante o un evento en OneUptime (como un incidente nuevo).
2. **Uno o más componentes** — lo que hace el flujo de trabajo. Enviar un mensaje, hacer una llamada HTTP, ejecutar una comprobación rápida, ramificar según una condición.
3. **Conexiones entre ellos** — dibujas líneas de un bloque al siguiente para decidir el orden.

Todo esto se construye de forma visual en un lienzo. La mayoría de los flujos de trabajo no requieren código, aunque puedes añadir un fragmento de JavaScript cuando lo necesites.

## Términos clave

| Término                   | Qué significa                                                                               |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Flujo de trabajo**        | La automatización completa — un nombre, un lienzo y un interruptor para activarla o desactivarla.                 |
| **Disparador**         | El primer bloque. Decide cuándo se ejecuta el flujo de trabajo. Todo flujo de trabajo tiene exactamente un disparador. |
| **Componente**       | Un bloque de acción — envía un mensaje, hace una solicitud, comprueba una condición.                     |
| **Ejecución**             | Una ejecución del flujo de trabajo. Se guarda con marcas de tiempo y la salida de cada bloque.             |
| **Variable global** | Un valor (como una clave de API) que guardas una vez y reutilizas en cualquier flujo de trabajo.                          |

## Dónde encontrar los flujos de trabajo en OneUptime

Abre **Flujos de Trabajo** en la navegación izquierda. Esa sección contiene:

- **Flujos de Trabajo** — tu lista de flujos de trabajo. Crea uno nuevo o abre uno existente.
- **Variables Globales** — valores compartidos entre todos tus flujos de trabajo.
- **Ejecuciones y Registros** — historial de ejecuciones de todos los flujos de trabajo de tu proyecto.

Abre un flujo de trabajo concreto y su propio menú izquierdo contiene:

- **Vista General** — nombre, descripción, etiquetas y el interruptor **Habilitado**.
- **Constructor** — el lienzo donde diseñas el flujo de trabajo.
- **Variables de Flujo** — valores con alcance limitado a este flujo de trabajo.
- **Ejecuciones y Registros** — cada ejecución de este flujo de trabajo, con detalles.
- **Ajustes** — secreto del webhook, duplicar y exportar.

## Construyendo tu primer flujo de trabajo

1. **Crear** — elige un punto de partida, luego dale un nombre a tu flujo de trabajo.
2. **Elegir un disparador** — manual, programado, webhook, o un evento de OneUptime.
3. **Añadir componentes** — añade acciones al lienzo y conéctalas.
4. **Activarlo** — activa **Habilitado** desde la página **Vista General**. Un flujo de trabajo deshabilitado no puede ejecutarse en absoluto, ni siquiera manualmente.
5. **Probar** — haz clic en **Ejecutar flujo de trabajo** en el Constructor y observa el registro de ejecución.

## Un ejemplo rápido

Digamos que quieres publicar en Slack cada vez que se crea un incidente crítico:

1. Crea un flujo de trabajo llamado "Incidentes críticos a Slack."
2. Elige el disparador **On Create Incident**.
3. Añade un bloque **If / Else**. Configúralo para comprobar si el título del incidente contiene "Sev 1."
4. Desde la rama **Yes**, añade un bloque **Slack**. Elige el canal y escribe el mensaje.
5. Activa el flujo de trabajo.

La próxima vez que alguien abra un incidente con "Sev 1" en el título, Slack se enciende.

## Cómo encajan los flujos de trabajo con el resto de OneUptime

- **Los monitores** detectan el problema. **Los incidentes** lo registran. **Los flujos de trabajo** reaccionan a él.
- **Los runbooks** son guías paso a paso para personas. Los flujos de trabajo son automatización desatendida. Usa un runbook cuando un humano necesita tomar decisiones; usa un flujo de trabajo cuando los pasos son automáticos.
- **Las conexiones de espacio de trabajo** (Slack, Teams) son a donde los flujos de trabajo envían sus mensajes.

## Dónde leer a continuación

- [Crear un flujo de trabajo](/docs/workflows/authoring) — construyendo en el lienzo.
- [Disparadores de flujo de trabajo](/docs/workflows/triggers) — las distintas formas en que un flujo de trabajo puede iniciarse.
- [Componentes de flujo de trabajo](/docs/workflows/components) — los bloques que puedes añadir.
- [Variables de flujo de trabajo](/docs/workflows/variables) — usando valores entre bloques y flujos de trabajo.
- [Ejecuciones y registros de flujo de trabajo](/docs/workflows/runs-and-logs) — comprobando qué ocurrió.
- [Configuración y seguridad del flujo de trabajo](/docs/workflows/configuration) — ajustes que conviene conocer.
