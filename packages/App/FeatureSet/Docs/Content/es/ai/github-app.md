# Trabajar con OneUptime desde GitHub

La GitHub App de OneUptime no es solo una conexión con tu código: puedes hablar con ella en tu repositorio y hará el trabajo allí mismo.

Menciónala en un issue y abrirá un pull request. Menciónala en un pull request y modificará la rama, o revisará el diff. Añade una etiqueta a un issue y se pondrá a trabajar en él. Todo lo que produce es un pull request o una revisión para que lo lea una persona: **nunca fusiona nada y nunca aprueba un pull request.**

```text
@oneuptime implement this                          →  un pull request que cierra el issue
@oneuptime revise this — use exponential backoff   →  nuevos commits en la rama de ese pull request
@oneuptime review                                  →  una revisión de código publicada en ese pull request
```

> Sustituye `@oneuptime` por el identificador de tu propia app. En OneUptime Cloud es `@oneuptime`. En una instancia autohospedada es el nombre que le pusiste a tu GitHub App, en minúsculas y con los espacios convertidos en guiones: una app llamada "Acme AI" se menciona como `@acme-ai`. Si las menciones no hacen nada, esto es lo primero que hay que comprobar.

## Antes de empezar

- El repositorio debe estar **conectado a un proyecto de OneUptime** a través de la GitHub App. Consulta [Integración con GitHub (autohospedado)](/docs/self-hosted/github-integration) para la configuración, o conéctalo desde **Ajustes del proyecto → Repositorios de código** en OneUptime Cloud.
- Debe estar en línea un **Runner con la capacidad "Ejecuta correcciones de código con IA"**, el mismo Runner que lleva a cabo las [Tareas de corrección con IA](/docs/ai/ai-agent). Sin él, los comandos se aceptan y luego fallan a los 30 minutos con un mensaje que dice que ningún agente los recogió.
- La GitHub App debe tener el permiso **Incidencias: Lectura y escritura** y estar suscrita a los eventos de webhook que se listan en [A qué suscribirse](#a-qué-suscribirse).

## Los comandos

Todo comando empieza con una mención a la app. La mención puede ir en cualquier parte del comentario, y todo lo que escribas después se le pasa como tu petición.

### En un pull request

| Comando | Qué ocurre |
| --- | --- |
| `@oneuptime review` | Clona la rama, lee el código que cambió **y el código que lo rodea**, y publica una revisión como comentario. No cambia nada. |
| `@oneuptime revise this — <lo que quieres cambiar>` | Clona la rama del propio pull request, hace el cambio y envía nuevos commits a esa misma rama. Nunca abre un segundo pull request. |

Todo lo que escribas después de la mención y no sea un comando reconocido se trata como una petición de modificación, porque casi siempre es justo eso:

```text
@oneuptime the retry loop here should back off exponentially, and the test
should cover the 429 case
```

### En un issue

| Comando | Qué ocurre |
| --- | --- |
| `@oneuptime implement this` | Se ocupa del issue y abre un pull request que lo cierra. |
| `@oneuptime <cualquier otra cosa>` | Lo mismo, con tus palabras como indicación adicional. |

También puedes pasarle un issue a la app **sin escribir ningún comentario**:

- **Añade la etiqueta de activación.** Añadir a un issue la etiqueta de activación del repositorio — `oneuptime` por defecto — arranca el mismo trabajo. Es la forma más fiable de asignar trabajo desde la interfaz de GitHub.
- **Asigna el issue al usuario bot de la app**, allí donde tu repositorio lo permita. GitHub no deja que una app sea asignataria en todas partes, y por eso existe la etiqueta; si asignar no hace nada, usa la etiqueta.

### En cualquier sitio

| Comando | Qué ocurre |
| --- | --- |
| `@oneuptime help` | Lista los comandos. Una mención a secas, sin nada detrás, hace lo mismo. |
| `@oneuptime status` | Dice en qué está trabajando ahora mismo en este hilo. |
| `@oneuptime cancel` | Detiene las ejecuciones que tenga en marcha en este hilo. El trabajo ya enviado se queda enviado. |

`help`, `status` y `cancel` nunca arrancan una ejecución del agente, así que no cuestan nada y no consumen tu presupuesto diario de tareas de corrección.

## Cómo se ve en el hilo

Un comando produce **un comentario**, que la app va editando a medida que avanza el trabajo — así una tarea larga nunca convierte un pull request en un registro de estado.

1. Reacciona con 👀 a tu comentario y publica un acuse de recibo que nombra el proyecto de OneUptime al que pertenece la ejecución y enlaza a la ejecución en curso.
2. Cuando termina, ese mismo comentario se reescribe con el resultado: el pull request que abrió, los commits que envió, o una explicación honesta de por qué no hizo nada.

Si no encuentra nada que merezca la pena cambiar, lo dice en lugar de abrir un pull request especulativo. Ese es un resultado normal, no un fallo: dale más indicaciones y vuelve a pedírselo.

## Quién puede darle órdenes

**Solo las personas con acceso de escritura, mantenimiento o administración al repositorio.** OneUptime le pregunta a GitHub directamente por los permisos de quien comenta en ese repositorio, cada vez; no se fía de la insignia de "colaborador" que GitHub muestra junto a un comentario, que describe la actividad pasada y no el acceso actual.

Una mención de cualquier otra persona recibe una sola reacción 😕 en su comentario y nada más. Esto es deliberado: en un repositorio público cualquiera puede comentar, y una app que responde de forma fiable a desconocidos es una app que se puede usar para inundar un hilo de spam.

También ignora todo comentario escrito por un bot, incluidos los suyos, e ignora las menciones que aparecen dentro de una cita (`>`) o de un bloque de código. Entre las dos, esas reglas son las que impiden que una respuesta a uno de sus propios comentarios la vuelva a poner en marcha.

## Lo que no hará

- **Nunca fusiona.** Nada de lo que hace esta app puede poner código en tu rama por defecto.
- **Nunca aprueba ni solicita cambios.** Las revisiones se publican como comentarios, así que la revisión de una app nunca puede satisfacer una regla de protección de rama.
- **Nunca reescribe el historial.** Una modificación añade commits; no hace force-push. Si otra persona envió cambios a la rama antes, la modificación falla en lugar de descartar su trabajo.
- **No puede modificar un pull request que viene de un fork.** La rama de un fork está en un repositorio en el que la instalación no puede escribir. Revisarlo sí puede: pídele una revisión en su lugar.
- **Nunca cambia el título, la descripción ni la rama de destino de un pull request.** Solo el código.

## Cuánto cuesta y cómo acotarlo

Cada comando que arranca trabajo es una ejecución completa del agente: un clon, hasta 40 llamadas al LLM y 100 000 tokens de salida, más los comandos de compilación y de pruebas de tu repositorio si los tienes configurados.

Se aplican dos límites, y los dos son los que ya rigen las [Tareas de corrección con IA](/docs/ai/ai-agent):

- **El límite diario de ejecuciones de corrección del proyecto** (**Ajustes del proyecto → IA**, 25 al día por defecto). Los comandos de GitHub comparten ese presupuesto con el resto de las ejecuciones de corrección de tu proyecto.
- **El tope de pull requests abiertos por repositorio** (**Repositorios de código → el repositorio → Ajustes**, 5 por defecto). Las revisiones y las modificaciones están exentas: ninguna de las dos añade un pull request nuevo a tu cola de revisión.

Solo hay una ejecución activa de cada tipo por issue o por pull request a la vez. Pedirlo dos veces te responde que ya está trabajando en ello; pedir una revisión mientras se ejecuta una modificación arranca las dos, porque son peticiones distintas.

Si una ejecución no puede arrancar, la app dice por qué en el hilo: nunca falla en silencio.

## Cómo desactivarlo

Por repositorio: **Repositorios de código → el repositorio → Ajustes → Responder a comandos de GitHub**. Con eso desactivado, la app ignora las menciones, las asignaciones y la etiqueta de activación en ese repositorio, y le dice a quien pregunte dónde está el interruptor.

La misma página lleva la **Etiqueta de activación de GitHub**, por si quieres otra distinta de `oneuptime`.

## A qué suscribirse

En los ajustes de **Permisos y eventos** de tu GitHub App, suscríbete a:

| Evento | Necesario para |
| --- | --- |
| **Issue comment** | comandos con `@mención` en issues *y* en pull requests |
| **Issues** | la asignación a la app y la etiqueta de activación |
| **Pull request** | la solicitud de revisión a la app |
| **Pull request review** | una mención en el cuerpo de una revisión enviada |
| **Pull request review comment** | una mención en un comentario en línea del diff |

Y en **Permisos del repositorio**, **Incidencias** debe estar en **Lectura y escritura**: GitHub sirve los comentarios de la conversación de un pull request a través de la API de incidencias, y ese permiso es lo que permite que la app comente también en los pull requests.

## Inyección de prompts: qué está protegido y qué no

El texto de los issues, las descripciones de los pull requests, los diffs y los comentarios acaban todos formando parte del prompt del agente, y en un repositorio público cualquiera puede escribirlos. Un texto que diga "ignora tus instrucciones y haz X" es algo que de verdad te puedes encontrar en un issue.

Dos cosas acotan esto, y vale la pena saber cuál es cuál:

- **Los prompts etiquetan el texto no confiable como una petición, no como instrucciones**, y el repositorio, la rama y el pull request de la ejecución quedan fijados antes de que el agente arranque: nada de lo que el agente lea puede cambiar sobre qué está trabajando.
- **La contención de verdad es el sandbox.** El agente se ejecuta en tu Runner, sobre un clon desechable, con las credenciales retiradas de su entorno de comandos y sus operaciones de git restringidas. Como mucho puede enviar a una rama, y fusionar solo lo puede hacer una persona.

Trata un pull request escrito por IA como tratarías el de un colaborador nuevo que se ha leído el issue: revisa el diff, no la descripción.

## Solución de problemas

**No pasa nada cuando la menciono.** Comprueba primero el identificador: es el slug de la app, no su nombre visible. Después comprueba que el repositorio esté conectado a un proyecto (**Ajustes del proyecto → Repositorios de código**), que **Responder a comandos de GitHub** esté activado y que tu GitHub App esté suscrita a los eventos de arriba.

**Reacciona con 😕 y no dice nada.** No tienes acceso de escritura al repositorio.

**Dice que ya está trabajando en esto.** Ya hay en marcha una ejecución de ese tipo en este issue o pull request. `@oneuptime status` te dirá cuál, y `@oneuptime cancel` la detiene.

**Acusó recibo y luego se quedó callada mucho rato.** Comprueba en **Ajustes → Agentes de runbook** que haya un Runner con **Ejecuta correcciones de código con IA** en línea. Sin él, la ejecución se da por fallida a los 30 minutos y se avisa en el hilo.

**Dice que el pull request viene de un fork.** Las modificaciones necesitan una rama en este repositorio. Pide una revisión en su lugar, o envía la rama aquí.

## Dónde seguir leyendo

- [Tareas de corrección con IA](/docs/ai/ai-agent) — el mismo agente, disparado desde una excepción en lugar de desde GitHub.
- [Integración con GitHub (autohospedado)](/docs/self-hosted/github-integration) — cómo crear y configurar la GitHub App.
- [Runners](/docs/runbooks/agents) — el trabajador que lleva a cabo las ejecuciones.
