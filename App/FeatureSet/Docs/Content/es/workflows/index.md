# Resumen de Workflows

Los workflows te permiten automatizar tareas en OneUptime sin escribir código. Arrastra y suelta algunos bloques en un lienzo, conéctalos entre sí y tendrás una automatización que se ejecuta cuando ocurre algo: se abre un incidente, se dispara una programación o alguna otra herramienta envía datos a OneUptime.

Piensa en los workflows como ayudantes en segundo plano para tu proyecto: reaccionan a eventos, se comunican con otras herramientas y mantienen todo sincronizado en silencio mientras tú te concentras en tu trabajo.

## Qué puedes hacer con los workflows

- **Conectar OneUptime con tus otras herramientas** — enviar incidentes a Slack, crear tickets en Jira, publicar en un webhook dentro de tu stack.
- **Reaccionar a lo que ocurre en OneUptime** — cuando se crea un incidente crítico, notificar al equipo de guardia y abrir un ticket automáticamente.
- **Ejecutar tareas según una programación** — cada cinco minutos, cada noche, cada lunes por la mañana.
- **Recibir datos desde el exterior** — permitir que otros sistemas envíen datos a OneUptime mediante una URL única.
- **Reutilizar automatizaciones comunes** — constrúyela una vez y llámala desde cualquier otro workflow.

## Cómo funciona un workflow

Cada workflow tiene tres partes:

1. **Un disparador** — qué inicia el workflow. Puede ser un botón manual, una programación, un webhook entrante o un evento de OneUptime (como un nuevo incidente).
2. **Uno o más componentes** — lo que hace el workflow. Enviar un mensaje, hacer una llamada HTTP, realizar una comprobación rápida, ramificar según una condición.
3. **Conexiones entre ellos** — trazas líneas de un bloque al siguiente para decidir el orden.

Construyes todo esto visualmente en un lienzo. La mayoría de los workflows no requieren programación, aunque puedes incluir un fragmento de JavaScript cuando lo necesites.

## Términos clave

| Término             | Qué significa                                                                                          |
| ------------------- | ------------------------------------------------------------------------------------------------------ |
| **Workflow**        | La automatización completa: un nombre, un lienzo y un interruptor para activarla o desactivarla.       |
| **Disparador**      | El primer bloque. Decide cuándo se ejecuta el workflow. Cada workflow tiene exactamente un disparador. |
| **Componente**      | Un bloque de acción: envía un mensaje, realiza una solicitud, comprueba una condición.                 |
| **Ejecución**       | Una ejecución del workflow. Se guarda con marcas de tiempo y la salida de cada bloque.                 |
| **Variable global** | Un valor (como una clave de API) que guardas una vez y reutilizas en cualquier workflow.               |

## Dónde encontrar los workflows en OneUptime

Abre **Workflows** en la navegación lateral. Desde allí:

- **Workflows** — tu lista de workflows. Crea uno nuevo o abre uno existente.
- **Pestaña Constructor** — el lienzo donde diseñas el workflow.
- **Pestaña Registros** — cada ejecución de este workflow, con detalles.
- **Pestaña Configuración** — nombre, descripción, propietarios, etiquetas, activar/desactivar.
- **Variables Globales** — valores compartidos entre todos tus workflows.
- **Ejecuciones y Registros** — historial de ejecuciones de todos los workflows de tu proyecto.

## Crear tu primer workflow

1. **Crear** — dale un nombre a tu workflow y una breve descripción.
2. **Elegir un disparador** — manual, programado, webhook o un evento de OneUptime.
3. **Añadir componentes** — arrastra acciones al lienzo y conéctalas.
4. **Probar** — haz clic en **Ejecutar Manualmente** y observa lo que ocurre en los registros.
5. **Activarlo** — cambia el interruptor **Activado** en Configuración cuando estés listo.

## Un ejemplo rápido

Supongamos que quieres publicar en Slack cada vez que se crea un incidente crítico:

1. Crea un workflow llamado "Incidentes críticos a Slack".
2. Elige el disparador **Incidente → Al Crear**.
3. Añade un bloque **Condiciones**. Configúralo para comprobar si el título del incidente contiene "Sev 1".
4. Desde la rama **Sí**, añade un bloque **Slack**. Elige el canal y escribe el mensaje.
5. Activa el workflow.

La próxima vez que alguien abra un incidente con "Sev 1" en el título, Slack se iluminará.

## Cómo encajan los workflows con el resto de OneUptime

- Los **monitores** detectan el problema. Los **incidentes** lo registran. Los **workflows** reaccionan a él.
- Los **runbooks** son guías paso a paso para personas. Los workflows son automatización desatendida. Usa un runbook cuando un humano necesite tomar decisiones; usa un workflow cuando los pasos son automáticos.
- Las **conexiones de espacio de trabajo** (Slack, Teams) son donde los workflows envían sus mensajes.

## Dónde seguir leyendo

- [Crear un Workflow](/docs/workflows/authoring) — construcción en el lienzo.
- [Disparadores](/docs/workflows/triggers) — las distintas maneras en que un workflow puede iniciarse.
- [Componentes](/docs/workflows/components) — los bloques de construcción que puedes añadir.
- [Variables](/docs/workflows/variables) — uso de valores entre bloques y workflows.
- [Ejecuciones y Registros](/docs/workflows/runs-and-logs) — comprobar lo que ocurrió.
- [Configuración y Seguridad](/docs/workflows/configuration) — ajustes que conviene conocer.
