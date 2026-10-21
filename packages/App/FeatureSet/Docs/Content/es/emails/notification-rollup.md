# Resumen de notificaciones

Cuando algo sale realmente mal, rara vez sale mal una sola vez. Un enlace ascendente inestable tumba cuarenta monitores, se declaran, reconocen y resuelven cuarenta incidentes, y cada propietario recibe un correo por cada paso: doscientos mensajes en una sola bandeja de entrada, y nadie los lee ya.

OneUptime agrupa esas ráfagas en un solo correo automáticamente. Está activado para todos y no hay nada que configurar, pero si prefieres recibir cada notificación en su propio correo, puedes [desactivar el resumen para ti](#desactivar-el-resumen-para-ti), proyecto por proyecto.

:::cards
- [Cómo funciona](#cómo-funciona): Cuatro correos salen al momento; el resto llega junto.
- [Lo que nunca se resume](#lo-que-nunca-se-resume): Avisos de guardia, seguridad, facturación y correos a suscriptores.
- [Desactivar el resumen](#desactivar-el-resumen-para-ti): Recibir de nuevo cada notificación en su propio correo.
- [Menos correos rutinarios](#reducir-aún-más): Desactivar de una vez los correos informativos.
:::

## Cómo funciona

Cada correo de notificación de propietario que recibes cuenta contra un pequeño presupuesto, que se lleva por proyecto, por destinatario, por dirección de correo y por **categoría** de recurso: incidentes, alertas, monitores, mantenimientos programados, páginas de estado, sondas, SLO, etc.

```mermaid title="Cómo se entrega un correo de notificación de propietario"
flowchart TB
    N["Correo de notificación de propietario"] --> O{"¿Resumen activado<br/>para ti?"}
    O -->|"No"| S["Enviado al momento"]
    O -->|"Sí"| C{"¿Quinto o posterior en esta<br/>categoría en 30 minutos?"}
    C -->|"No"| S
    C -->|"Sí"| H["Retenido"]
    H -->|"Unos 5 minutos después"| R["Un correo de resumen<br/>para el proyecto"]
```

- Los **primeros cuatro** correos de una categoría dentro de cualquier ventana de treinta minutos se envían de inmediato, exactamente como siempre. Mismo asunto, misma plantilla, mismos enlaces.
- El **quinto y todos los siguientes** correos de esa ventana se retienen.
- Unos cinco minutos después, todo lo retenido para ti en ese proyecto, de todas las categorías, llega como **un solo** correo que enumera lo que pasó, con un enlace a cada recurso.

El resumen incluye las notificaciones a las que sigues suscrito cuando se envía. Si desactivas el correo de un evento mientras sus notificaciones están en cola, esas notificaciones quedan fuera del resumen. Volver a activar el correo más tarde no reenvía esas actualizaciones omitidas.

Por debajo del umbral, la función no hace nada. Un proyecto que genera tres correos de propietario al día sigue enviando esos tres correos por separado.

## Cómo es el correo de resumen

La línea de asunto te dice la magnitud _y el tipo_ de tormenta antes de abrirlo:

```text
[Acme Production] 112 notifications: 63 Monitors, 41 Incidents, 6 Alerts +2 more
```

Dentro, una tarjeta de resumen muestra el total, el periodo que cubre el resumen y el desglose por categoría. Debajo, las notificaciones se agrupan en una sección por categoría, la más urgente primero (incidentes, luego alertas y después los monitores y sondas que los detectaron), de modo que lo primero bajo el resumen es lo primero que vale la pena abrir.

Cada sección tiene una fila por recurso en lugar de una fila por evento:

- **Las filas muestran cómo terminó cada recurso.** Si un incidente se creó, luego se reconoció y luego se resolvió, es una sola fila en su estado más reciente, lo que hace que el resumen esté _más_ actualizado de lo que habrían estado tres correos separados.
- **Los recuentos cuadran.** Cada fila lleva la hora de su última actualización, y una fila que absorbió varias indica cuántas, así que las secciones y la tarjeta de resumen siempre suman el mismo total.
- **Se muestran la gravedad y el estado.** Las tarjetas de alertas e incidentes muestran la gravedad y el estado de su última notificación, incluidos los nombres personalizados. Las notificaciones antiguas en cola sin estos datos siguen apareciendo, sin las etiquetas que faltan.

Las horas se muestran en UTC, con la fecha además cuando un resumen abarca más de un día.

![Un correo de resumen con quince notificaciones](/docs/static/images/NotificationRollupEmail.png)

## Lo que nunca se resume

El resumen solo afecta a las notificaciones de propietarios y miembros, la familia de «algo de lo que eres responsable ha cambiado». No puede llegar a nada más, porque vive dentro de la única ruta de código que siguen esas notificaciones, y ninguna otra.

Nunca se retrasa ni se cuenta:

| Categoría | Ejemplos |
| ----------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Avisos de guardia | Cada aviso de una política de escalado y cada solicitud de reconocimiento |
| Horarios de guardia | «Estás de guardia ahora», «eres el siguiente de guardia», «tu turno empieza pronto», «tu turno se reasignó» |
| Seguridad de la cuenta | Restablecer la contraseña, verificar el correo, contraseña cambiada, código de respaldo de dos factores usado o regenerado |
| Avisos administrativos sobre tu cuenta | Un administrador cambió tus métodos de notificación o tus reglas de guardia |
| Facturación y saldo | Facturas, suscripción vencida, «no pudimos avisar a nadie porque la tarjeta fue rechazada» |
| Estado de la instancia | Advertencias de Postgres, Valkey y ClickHouse para los administradores de la instancia |
| Suscriptores de páginas de estado | Cada correo que tu página de estado envía a tus propios suscriptores |
| Incumplimientos de SLA | Se envían de inmediato aunque reutilicen el tipo de notificación de incidente creado |

Solo afecta al correo. SMS, llamadas, notificaciones push, WhatsApp, Telegram, Slack, Microsoft Teams y webhooks se entregan de inmediato, exactamente como antes, también para las notificaciones cuyo correo se retuvo.

## Límites

| Límite | Valor |
| --- | --- |
| Notificaciones en un correo de resumen | Como máximo **500**. Lo que supere ese número sigue en cola y sale en el siguiente resumen, como mucho cinco minutos después. |
| Filas dibujadas en un correo de resumen | Como máximo **100**. Las filas se agrupan por recurso, así que son 100 recursos distintos; por encima de eso, el correo indica los totales completos y enlaza al proyecto. |
| Correos de resumen a un destinatario desde un proyecto | Como máximo **12** por hora. |
| Retraso añadido a una notificación retenida | Unos seis minutos, en el peor caso. |

El límite por hora lo aplica la base de datos, no un temporizador, así que se mantiene incluso durante una tormenta que dure horas.

## Desactivar el resumen para ti

Hay quien quiere el agrupamiento. Otros archivan cada notificación en cuanto llega, o pasan el buzón a algo que lo hace, y un correo de resumen rompe eso. Por eso el resumen se puede desactivar, por persona y por proyecto.

:::steps
### Abrir Preferencias de correo

En el proyecto, ve a **Ajustes de usuario → Preferencias de correo**, la misma página a la que enlaza el pie de cada correo de resumen.

### Desactivar el resumen de correos

En la tarjeta **Resumen de correos**, desactiva el interruptor. Se guarda solo, y la tarjeta muestra entonces «Desactivado: cada notificación llega como un correo independiente, de inmediato.»
:::

Con el resumen desactivado, cada correo de notificación de propietario y de miembro de ese proyecto vuelve a enviarse por separado y de inmediato: mismo asunto, misma plantilla, mismos enlaces, sin umbral y sin espera de cinco minutos. Lo que ya estuviera en cola para ti al desactivarlo llega todavía como un último resumen unos minutos después; todo lo posterior llega uno a uno.

El interruptor es **solo tuyo y se limita a un proyecto**. Desactivarlo no cambia lo que reciben tus compañeros y no se aplica a otros proyectos, así que el ruidoso proyecto de producción puede seguir agrupando mientras el tranquilo proyecto interno lo envía todo por separado, o al revés. Está activado para todos hasta que cada uno lo desactive.

Lo que **no** cambia:

- **Qué notificaciones recibes.** Eso es el ajuste por tipo de evento y por canal en **Ajustes de usuario → Ajustes de notificaciones**, en la página de al lado. El resumen y este interruptor solo cambian en cuántos correos se reúnen esas notificaciones.
- **Los avisos de guardia y los correos de turno**, **los correos de seguridad de la cuenta**, **los correos de facturación**, las advertencias de estado de la instancia y los correos a suscriptores de páginas de estado. Nada de eso se resume nunca, así que desactivar el resumen no cambia nada en ellos; consulta [Lo que nunca se resume](#lo-que-nunca-se-resume).
- **Cualquier otro canal.** SMS, llamadas, push, WhatsApp, Telegram, Slack, Microsoft Teams y webhooks ya son inmediatos.

## Reducir aún más

El resumen agrupa las actualizaciones rutinarias; también puedes dejar de recibir la mayoría de ellas.

:::steps
### Abrir las preferencias desde un correo de resumen

Abre el enlace de preferencias del pie de un correo de resumen, o ve a **Ajustes de usuario → Preferencias de correo**.

### Seleccionar Reducir los correos rutinarios

En la tarjeta **Menos correos rutinarios**, selecciona **Reducir los correos rutinarios**. Cuando se guarda el cambio, la tarjeta indica **Correos de rutina desactivados.**
:::

Esto desactiva para ti, en el proyecto actual, estos correos informativos:

- Notas publicadas en incidentes, alertas, episodios y mantenimientos programados.
- Avisos de que te añadieron como propietario de un recurso.
- Nuevos monitores y páginas de estado.
- Incidentes o alertas añadidos a episodios existentes.
- Que te añadan a una política de guardia o te quiten de ella.

Conserva tus elecciones actuales para la creación de incidentes y alertas, los cambios de estado, los recordatorios, las asignaciones de incidentes, el estado de los monitores y los turnos de guardia, y no activa ningún correo que hubieras desactivado. Los avisos de guardia, los demás canales de entrega, los correos de cuenta, los de facturación y los correos a suscriptores de páginas de estado no se ven afectados.

Los cambios se guardan juntos. Revisa los interruptores por evento en **Ajustes de usuario → Ajustes de notificaciones** para volver a activar cualquier correo concreto. Estas preferencias también se aplican a las notificaciones que esperan un resumen; un correo ya enviado no se puede recuperar. El resumen de correos sigue siendo un ajuste aparte que controla el agrupamiento de los eventos que conservas.

## Solución de problemas

:::details Un correo de notificación llegó unos minutos tarde
Era el quinto correo o posterior de su categoría en treinta minutos, así que se retuvo y se envió en un resumen unos cinco minutos después. Busca un correo de resumen del mismo proyecto: la notificación es una fila en él. Los avisos de guardia y los demás canales no se retrasaron.
:::

:::details Desactivé el resumen y aun así recibí un correo de resumen
Las notificaciones que ya estaban en cola para ti cuando lo desactivaste llegan como un último resumen unos minutos después. Todo lo posterior llega correo a correo.
:::

:::details Falta en un correo de resumen una actualización que esperaba
Cada fila muestra un recurso en su estado más reciente, así que un incidente que se creó, se reconoció y se resolvió es una sola fila, con el número de actualizaciones que absorbió. Una notificación también queda fuera si desactivaste el correo de ese evento en **Ajustes de usuario → Ajustes de notificaciones** mientras estaba en cola.
:::

## Próximos pasos

:::cards
- [Configuración SMTP](/docs/emails/smtp): Enviar los correos de OneUptime a través de tu propio servidor de correo.
- [Reglas de escalado](/docs/on-call/escalation-rules): Cómo los avisos de guardia llegan a las personas, sin resumirse nunca.
:::
