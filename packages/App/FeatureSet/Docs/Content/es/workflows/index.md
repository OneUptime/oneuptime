# Visión general de los flujos de trabajo

Los flujos de trabajo te permiten automatizar tareas en OneUptime sin escribir código. Pon unos cuantos bloques en un lienzo, conéctalos entre sí y ya tienes una automatización que se ejecuta cada vez que pasa algo — se abre un incidente, salta una programación u otra herramienta envía datos a OneUptime.

Piensa en los flujos de trabajo como ayudantes en segundo plano para tu proyecto: reaccionan a los eventos, hablan con otras herramientas y mantienen todo sincronizado sin hacer ruido mientras tú te concentras en lo tuyo.

## Qué puedes hacer con los flujos de trabajo

- **Conectar OneUptime con tus otras herramientas** — enviar incidentes a Slack, crear tickets de Jira, llamar a un webhook de tu propio stack.
- **Reaccionar a lo que pasa en OneUptime** — cuando se crea un incidente crítico, avisar al equipo de guardia y abrir un ticket automáticamente.
- **Ejecutar tareas de forma programada** — cada cinco minutos, cada noche, cada lunes por la mañana.
- **Recibir datos desde fuera** — dejar que otros sistemas envíen datos a OneUptime a través de una URL única.
- **Reutilizar automatizaciones comunes** — constrúyelo una vez y llámalo desde cualquier otro flujo de trabajo.

## Cómo funciona un flujo de trabajo

Todo flujo de trabajo tiene tres partes:

1. **Un disparador** — lo que arranca el flujo de trabajo. Puede ser un botón manual, una programación, un webhook entrante o un evento de OneUptime (como un incidente nuevo).
2. **Uno o varios componentes** — lo que hace el flujo de trabajo. Enviar un mensaje, hacer una llamada HTTP, ejecutar una comprobación rápida, ramificar según una condición.
3. **Las conexiones entre ellos** — dibujas líneas de un bloque al siguiente para decidir el orden.

Todo esto lo construyes visualmente en un lienzo. La mayoría de los flujos de trabajo no requieren programar, aunque puedes añadir un fragmento de JavaScript cuando lo necesites.

## Términos clave

| Término             | Qué significa                                                                               |
| ------------------- | ------------------------------------------------------------------------------------------- |
| **Flujo de trabajo** | La automatización completa — un nombre, un lienzo y un interruptor para encenderla o apagarla. |
| **Disparador**      | El primer bloque. Decide cuándo se ejecuta el flujo de trabajo. Todo flujo tiene exactamente un disparador. |
| **Componente**      | Un bloque de acción — envía un mensaje, hace una petición, comprueba una condición.         |
| **Ejecución**       | Una ejecución del flujo de trabajo. Se guarda con marcas de tiempo y la salida de cada bloque. |
| **Variable global** | Un valor (como una clave de API) que guardas una vez y reutilizas en cualquier flujo.        |

## Dónde encontrar los flujos de trabajo en OneUptime

Abre **Flujos de Trabajo** en la navegación izquierda. Esa sección contiene:

- **Flujos de Trabajo** — tu lista de flujos de trabajo. Crea uno nuevo o abre uno existente.
- **Variables Globales** — valores compartidos por todos tus flujos de trabajo.
- **Ejecuciones y Registros** — el historial de ejecución de todos los flujos de trabajo de tu proyecto.

Abre un flujo de trabajo concreto y su propio menú izquierdo contiene:

- **Vista General** — nombre, descripción, etiquetas y el interruptor **Habilitado**.
- **Constructor** — el lienzo donde diseñas el flujo de trabajo.
- **Variables de Flujo** — valores que solo existen para este flujo de trabajo.
- **Ejecuciones y Registros** — cada ejecución de este flujo de trabajo, con sus detalles.
- **Ajustes** — el secreto del webhook, duplicar y exportar.

## Construir tu primer flujo de trabajo

1. **Crea** — elige un punto de partida y ponle nombre a tu flujo de trabajo.
2. **Elige un disparador** — manual, programado, webhook o un evento de OneUptime.
3. **Añade componentes** — pon acciones en el lienzo y conéctalas.
4. **Enciéndelo** — activa **Habilitado** desde la página **Vista General**. Un flujo de trabajo deshabilitado no puede ejecutarse de ninguna manera, ni siquiera a mano.
5. **Pruébalo** — haz clic en **Ejecutar flujo de trabajo** en el Constructor y observa el registro de la ejecución.

## Un ejemplo rápido

Supón que quieres publicar en Slack cada vez que se crea un incidente crítico:

1. Crea un flujo de trabajo llamado «Incidentes críticos a Slack».
2. Elige el disparador **On Create Incident**.
3. Añade un bloque **If / Else**. Configúralo para comprobar si el título del incidente contiene «Sev 1».
4. Desde la rama **Sí**, añade un bloque **Slack**. Elige el canal y escribe el mensaje.
5. Enciende el flujo de trabajo.

La próxima vez que alguien abra un incidente con «Sev 1» en el título, Slack se ilumina.

## Cómo encajan los flujos de trabajo con el resto de OneUptime

- Los **monitores** detectan el problema. Los **incidentes** lo registran. Los **flujos de trabajo** reaccionan a él.
- Los **runbooks** son guías paso a paso para personas. Los flujos de trabajo son automatización desatendida. Usa un runbook cuando alguien tenga que tomar decisiones; usa un flujo de trabajo cuando los pasos son automáticos.
- Las **conexiones del espacio de trabajo** (Slack, Teams) son adonde los flujos de trabajo envían sus mensajes.

## Qué leer a continuación

- [Crear un flujo de trabajo](/docs/workflows/authoring) — construir sobre el lienzo.
- [Disparadores de flujo de trabajo](/docs/workflows/triggers) — las distintas formas de arrancar un flujo de trabajo.
- [Componentes de flujo de trabajo](/docs/workflows/components) — los bloques que puedes añadir.
- [Variables de flujo de trabajo](/docs/workflows/variables) — usar valores entre bloques y entre flujos.
- [Ejecuciones y registros de flujo de trabajo](/docs/workflows/runs-and-logs) — comprobar qué pasó.
- [Configuración y seguridad del flujo de trabajo](/docs/workflows/configuration) — ajustes que conviene conocer.
