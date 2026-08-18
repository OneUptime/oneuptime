# Disparadores

Un disparador es el primer bloque de un flujo de trabajo — decide cuándo se ejecuta el flujo de trabajo. Todo flujo de trabajo tiene exactamente un disparador. Puedes elegir entre cuatro tipos.

## Manual

Ejecuta el flujo de trabajo a demanda haciendo clic en **Ejecutar flujo de trabajo** en la página **Constructor**, rellenando los campos del disparador y confirmando con **Run Workflow Manually**. El disparador Manual toma una carga JSON que el resto del flujo de trabajo puede leer.

Bueno para: automatizaciones de un clic para las que quieres un botón, como "rotar esta clave" o "enviar una alerta de prueba."

**Salida**: el JSON que pegaste, o un objeto vacío si no lo hiciste.

## Programación

Ejecuta el flujo de trabajo según una programación repetitiva usando una expresión cron.

Bueno para: limpieza nocturna, sincronización cada hora, informes semanales.

**Ajuste**: una expresión cron. Algunas comunes:

- `0 * * * *` — cada hora, en punto.
- `*/5 * * * *` — cada 5 minutos.
- `0 9 * * 1` — cada lunes a las 9:00 AM.

Si el sistema no está disponible brevemente, la ejecución se recupera en cuanto se restablece — no necesitas preocuparte por ciclos perdidos durante interrupciones cortas.

## Webhook

OneUptime crea una URL única. Cualquier cosa que llegue a esa URL inicia el flujo de trabajo. Se pasan las cabeceras, los parámetros de consulta y el cuerpo de la solicitud.

Bueno para: recibir datos en OneUptime desde otra herramienta — callbacks de CI/CD, alertas de otra herramienta de monitorización, registros en tu CRM.

**Salida**:

- **Request Headers** — todas las cabeceras de la solicitud entrante.
- **Request Query Params** — la cadena de consulta analizada.
- **Request Body** — el cuerpo analizado (o el texto sin procesar si no es JSON).

La URL acepta tanto `GET` como `POST`. Quien la llama recibe una confirmación rápida — el flujo de trabajo en sí se ejecuta en segundo plano.

Trata la URL como una contraseña. Cualquiera que la tenga puede iniciar tu flujo de trabajo.

## Disparadores de eventos de OneUptime

Casi todo en OneUptime — monitores, incidentes, alertas, mantenimiento programado, páginas de estado, políticas de guardia, equipos — puede disparar un flujo de trabajo. Cada uno ofrece tres eventos:

- **On Create** — se dispara cuando se añade uno nuevo.
- **On Update** — se dispara cuando se modifica uno.
- **On Delete** — se dispara cuando se elimina uno.

Así es como construyes "cuando ocurre X en OneUptime, haz Y" sin necesidad de comprobar cosas en un bucle.

El registro completo se pasa al siguiente bloque. Por ejemplo, el disparador **Incident → On Create** pasa el nuevo incidente, de modo que el siguiente bloque puede leer su título, descripción, severidad y cualquier otro campo.

### Eventos que más usan los equipos

- **Incident** — reacciona cuando se abre, se actualiza (se reconoce, se resuelve) o se elimina un incidente.
- **Alert** — los mismos tres para alertas.
- **Monitor** — reacciona cuando se añade, edita o elimina un monitor.
- **Scheduled Maintenance** — anuncia automáticamente una ventana de mantenimiento cuando se programa.
- **Status Page Subscriber** — da la bienvenida a quien se suscribe a una página de estado.
- **On-Call Duty Policy** — sincroniza cambios de programación con otro sistema de turnos.

Busca en el panel **Add Trigger** por nombre para encontrar el que quieres.

## ¿Qué disparador debo usar?

| Si quieres…                     | Elige                |
| ----------------------------------- | ------------------- |
| Hacer clic en un botón para ejecutar el flujo de trabajo  | **Manual**          |
| Ejecutar según una programación repetitiva         | **Programación**        |
| Que otro sistema envíe datos    | **Webhook**         |
| Reaccionar a algo dentro de OneUptime | **Evento de OneUptime** |

Un flujo de trabajo solo puede tener un disparador. Si necesitas dos formas de iniciar la misma automatización, construye la lógica compartida en un flujo de trabajo y llámalo desde dos flujos de trabajo "envoltorio" delgados usando el componente **Execute Workflow**.

## Dónde leer a continuación

- [Componentes de flujo de trabajo](/docs/workflows/components) — las acciones que añades después del disparador.
- [Variables de flujo de trabajo](/docs/workflows/variables) — leyendo la salida del disparador desde bloques posteriores.
- [Ejecuciones y registros de flujo de trabajo](/docs/workflows/runs-and-logs) — confirmando que tu disparador se activó.
