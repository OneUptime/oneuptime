# Disparadores

Un disparador es el primer bloque de un workflow: decide cuándo se ejecuta. Cada workflow tiene exactamente un disparador. Puedes elegir entre cuatro tipos.

## Manual

Ejecuta el workflow a petición haciendo clic en **Ejecutar Manualmente** en la página del workflow. Puedes pegar una carga útil JSON que el resto del workflow puede leer.

Útil para: automatizaciones de un clic para las que quieres un botón, como "rotar esta clave" o "enviar una alerta de prueba".

**Salida**: el JSON que pegaste, o un objeto vacío si no pegaste nada.

## Programación

Ejecuta el workflow en una programación recurrente mediante una expresión cron.

Útil para: limpiezas nocturnas, sincronización horaria, informes semanales.

**Ajuste**: una expresión cron. Algunas comunes:

- `0 * * * *` — cada hora, en punto.
- `*/5 * * * *` — cada 5 minutos.
- `0 9 * * 1` — cada lunes a las 9:00 AM.

Si el sistema no está disponible brevemente, la ejecución se retoma en cuanto se recupera; no necesitas preocuparte por ciclos perdidos durante cortes breves.

## Webhook

OneUptime crea una URL única. Cualquier cosa que llegue a esa URL inicia el workflow. Las cabeceras, los parámetros de consulta y el cuerpo de la solicitud se pasan al workflow.

Útil para: recibir datos en OneUptime desde otra herramienta — callbacks de CI/CD, alertas de otros sistemas de monitorización, registros en tu CRM.

**Salida**:

- **Request Headers** — todas las cabeceras de la solicitud entrante.
- **Request Query Params** — la cadena de consulta analizada.
- **Request Body** — el cuerpo analizado (o el texto sin procesar si no es JSON).

La URL acepta tanto `GET` como `POST`. El emisor recibe una confirmación rápida; el workflow en sí se ejecuta en segundo plano.

Trata la URL como una contraseña. Cualquiera que la tenga puede iniciar tu workflow.

## Disparadores de eventos de OneUptime

Casi cualquier cosa en OneUptime —monitores, incidentes, alertas, mantenimiento programado, páginas de estado, políticas de guardia, equipos— puede disparar un workflow. Cada uno ofrece tres eventos:

- **Al Crear** — se activa cuando se añade uno nuevo.
- **Al Actualizar** — se activa cuando se modifica uno.
- **Al Eliminar** — se activa cuando se elimina uno.

Así es como construyes "cuando X sucede en OneUptime, haz Y" sin necesidad de comprobar cosas en un bucle.

El registro completo se pasa al siguiente bloque. Por ejemplo, el disparador **Incidente → Al Crear** pasa el nuevo incidente, para que el siguiente bloque pueda leer su título, descripción, gravedad y cualquier otro campo.

### Eventos que los equipos usan más

- **Incidente** — reacciona cuando se abre, actualiza (reconoce, resuelve) o elimina un incidente.
- **Alerta** — los mismos tres para alertas.
- **Monitor** — reacciona cuando se añade, edita o elimina un monitor.
- **Mantenimiento Programado** — anuncia automáticamente una ventana de mantenimiento cuando se programa.
- **Suscriptor de Página de Estado** — da la bienvenida a alguien que se suscribe a una página de estado.
- **Política de Guardia** — sincroniza los cambios de horario a otro sistema de rotación.

Busca por nombre en la paleta de disparadores para encontrar el que quieres.

## ¿Qué disparador debo usar?

| Si quieres…                                      | Elige                   |
| ------------------------------------------------ | ----------------------- |
| Hacer clic en un botón para ejecutar el workflow | **Manual**              |
| Ejecutar en una programación recurrente          | **Programación**        |
| Que otro sistema envíe datos                     | **Webhook**             |
| Reaccionar a algo dentro de OneUptime            | **Evento de OneUptime** |

Un workflow solo puede tener un disparador. Si necesitas dos formas de iniciar la misma automatización, construye la lógica compartida en un workflow y llámalo desde dos workflows "envoltorio" delgados usando el componente **Ejecutar Workflow**.

## Dónde seguir leyendo

- [Componentes](/docs/workflows/components) — las acciones que añades después del disparador.
- [Variables](/docs/workflows/variables) — leer la salida del disparador desde bloques posteriores.
- [Ejecuciones y Registros](/docs/workflows/runs-and-logs) — confirmar que tu disparador se activó.
