# Disparadores de flujo de trabajo

Un disparador es el primer bloque de un flujo de trabajo — decide cuándo se ejecuta. Todo flujo de trabajo tiene exactamente un disparador. Puedes elegir entre cuatro tipos.

## Manual

Ejecuta el flujo de trabajo cuando quieras: haz clic en **Ejecutar flujo de trabajo** en la página **Constructor**, rellena los campos del disparador y confirma con **Run Workflow Manually**. El disparador Manual acepta un payload JSON que el resto del flujo puede leer.

Va bien para: automatizaciones de un clic para las que quieres un botón, del tipo «rotar esta clave» o «enviar una alerta de prueba».

**Salida**: el JSON que pegaste, o un objeto vacío si no pegaste nada.

## Programación

Ejecuta el flujo de trabajo de forma repetida usando una expresión cron.

Va bien para: limpiezas nocturnas, sincronizaciones cada hora, informes semanales.

**Ajuste**: una expresión cron. Algunas habituales:

- `0 * * * *` — cada hora, en punto.
- `*/5 * * * *` — cada 5 minutos.
- `0 9 * * 1` — todos los lunes a las 9:00.

Si el sistema no está disponible durante un rato, la ejecución se recoge en cuanto se recupera — no tienes que preocuparte por los ciclos perdidos en caídas cortas.

## Webhook

OneUptime crea una URL única. Cualquier cosa que llame a esa URL arranca el flujo de trabajo. Las cabeceras, los parámetros de consulta y el cuerpo de la petición se pasan al flujo.

Va bien para: recibir datos en OneUptime desde otra herramienta — callbacks de CI/CD, alertas de otro sistema de monitorización, altas en tu CRM.

**Salida**:

- **Encabezados de la solicitud** — todas las cabeceras de la petición entrante.
- **Request Query Params** — la cadena de consulta ya analizada.
- **Cuerpo de la solicitud** — el cuerpo analizado (o el texto en bruto si no es JSON).

La URL acepta tanto `GET` como `POST`. Quien llama recibe un acuse rápido — el flujo de trabajo en sí se ejecuta en segundo plano.

Trata la URL como una contraseña. Cualquiera que la tenga puede arrancar tu flujo de trabajo.

## Disparadores de eventos de OneUptime

Casi todo en OneUptime — monitores, incidentes, alertas, mantenimientos programados, páginas de estado, políticas de guardia, equipos — puede disparar un flujo de trabajo. Cada cosa ofrece tres eventos:

- **On Create** — se dispara cuando se añade una nueva.
- **On Update** — se dispara cuando se modifica una.
- **On Delete** — se dispara cuando se elimina una.

Así es como construyes «cuando pase X en OneUptime, haz Y» sin tener que comprobar nada en un bucle.

El registro completo se pasa al siguiente bloque. Por ejemplo, el disparador **Incidente → On Create** pasa el incidente nuevo, así que el bloque siguiente puede leer su título, su descripción, su severidad y cualquier otro campo.

### Los eventos que más se usan

- **Incidente** — reacciona cuando se abre, se actualiza (se reconoce, se resuelve) o se elimina un incidente.
- **Alerta** — los mismos tres eventos para las alertas.
- **Monitor** — reacciona cuando se añade, se edita o se elimina un monitor.
- **Mantenimiento programado** — anuncia automáticamente una ventana de mantenimiento en cuanto se programa.
- **Página de estado Suscriptor** — da la bienvenida a quien se suscribe a una página de estado.
- **On-Call Duty Policy** — sincroniza los cambios de turno con otro sistema de guardias.

Busca por nombre en el panel **Add Trigger** para dar con el que quieres.

## ¿Qué disparador me conviene?

| Si quieres…                          | Elige               |
| ----------------------------------- | ------------------- |
| Pulsar un botón para ejecutar el flujo | **Manual**       |
| Ejecutarlo de forma repetida         | **Programación**    |
| Que otro sistema te envíe datos      | **Webhook**         |
| Reaccionar a algo dentro de OneUptime | **Evento de OneUptime** |

Un flujo de trabajo solo puede tener un disparador. Si necesitas dos formas de arrancar la misma automatización, construye la lógica compartida en un flujo de trabajo y llámalo desde dos flujos «envoltorio» ligeros con el componente **Execute Workflow**.

## Qué leer a continuación

- [Componentes de flujo de trabajo](/docs/workflows/components) — las acciones que añades después del disparador.
- [Variables de flujo de trabajo](/docs/workflows/variables) — leer la salida del disparador desde bloques posteriores.
- [Ejecuciones y registros de flujo de trabajo](/docs/workflows/runs-and-logs) — confirmar que tu disparador saltó.
