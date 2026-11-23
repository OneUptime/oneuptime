# Ajustes de notificaciones

Los ajustes de notificaciones deciden qué novedades te llegan sobre los registros que son tuyos, como un incidente, un monitor o una página de estado, y sobre tus propios turnos de guardia, y por qué canales. Nunca te avisan: avisar es tarea de tus reglas de guardia. Los configuras en **Ajustes de usuario → Ajustes de notificaciones**, con un interruptor por evento y canal.

:::cards
- [Cómo funcionan los ajustes](#cómo-funcionan-los-ajustes): Un interruptor por evento y canal, enviado a cada método verificado.
- [Cambia un ajuste](#cambia-un-ajuste): Tres clics, guardado al instante.
- [Qué está activado para un miembro nuevo](#qué-está-activado-para-un-miembro-nuevo): Los valores predeterminados, pestaña por pestaña.
- [Menos correos](#menos-correos): Agrupa las ráfagas, o deja fuera los rutinarios.
:::

## Cómo funcionan los ajustes

```mermaid title="Una novedad sobre un registro que es tuyo, y adónde va"
flowchart TB
    event["Una novedad, como una<br/>nota en tu incidente"] --> setting["Tu ajuste<br/>para ese evento"]
    setting -->|"correo activado"| emails["Cada dirección<br/>de correo verificada"]
    setting -->|"todo desactivado"| nothing["No se envía nada"]
```

- Cada fila es un evento, y cada columna un canal: Correo electrónico, SMS, Llamada, Push, WhatsApp, Telegram, Slack, Microsoft Teams, Mattermost y Webhook. Slack, Microsoft Teams y Mattermost solo son columnas cuando el proyecto los ha conectado. Un canal que aún no has configurado no es una columna: aparece en **Canales aún sin configurar**, encima de las pestañas, como un enlace para configurarlo.
- WhatsApp solo entrega mensajes aprobados por Meta, y OneUptime los tiene para las novedades de incidentes, alertas, episodios, monitores, sondas, agentes de IA, páginas de estado, eventos de mantenimiento y la mayoría de los turnos de guardia. Otras novedades, como el estado de un SLO, una llamada perdida, un caso de seguridad o que te hagan propietario de un servicio, no tienen interruptor de WhatsApp, y su tarjeta dice que WhatsApp no está disponible. Te llegan por tus otros canales.
- Un canal activado envía a cada método verificado que tengas en él en este proyecto, no solo a uno.
- Un canal activado sin un método verificado detrás no envía nada. Su columna muestra **Configurar** bajo su nombre, y sus interruptores solo se pueden desactivar. **Tu lista de configuración** también lo indica, en **Mantenerse informado**.
- Una novedad va a los propietarios del registro: las personas nombradas como propietarias y los miembros de sus equipos propietarios. Cuando un registro no tiene propietarios, va en cambio a los Propietarios del proyecto. A quien ya le haya llegado el aviso de guardia de un nuevo incidente, alerta o episodio no se le vuelve a notificar que se creó. Un evento sobre haber sido añadido como propietario solo va a la persona añadida. Si OneUptime se detiene mientras envía una novedad a los propietarios de un registro, las personas a las que aún no había llegado la reciben cuando OneUptime vuelve, unos minutos tarde, y nadie la recibe dos veces.
- Los casos de seguridad no tienen propietarios. Un caso nuevo va a todas las personas que pueden ver los casos del proyecto, a partir de la prioridad que elige cada una, y un caso asignado, a las personas a las que está asignado. Consulta [Casos de seguridad](/docs/telemetry/security-cases#notificaciones).
- Cada correo a los propietarios termina con un enlace "Manage notification preferences" que lleva de vuelta a esta página.

## Cambia un ajuste

:::steps
### Abre tus ajustes

Ve a **Ajustes de usuario → Ajustes de notificaciones**. Las pestañas son **Incidentes**, **Alertas**, **Monitoreo**, **Páginas de estado**, **Mantenimiento programado**, **Guardia** y **Seguridad**.

### Busca el evento

Cada pestaña contiene una o más tarjetas, como **Episodios de incidente** en la pestaña **Incidentes**. Cada fila es un evento, con una línea que dice cuándo se envía. Encima de las tarjetas, la pestaña indica de cuántos de sus eventos recibes avisos, y por qué canales.

### Haz clic en un canal

Haz clic en el interruptor de un canal para activarlo, y otra vez para desactivarlo. La primera fila de una tarjeta, **Todos los eventos**, activa o desactiva un canal para cada evento de la tarjeta. Cada cambio se guarda al instante, y la tarjeta muestra **Guardado**.
:::

## Qué está activado para un miembro nuevo

Cuando te unes a un proyecto, estos eventos empiezan activados, por correo. Todo lo demás empieza desactivado, y no envía nada hasta que activas un canal.

| Pestaña | Activados por correo | Desactivados hasta que los actives |
| --- | --- | --- |
| **Incidentes** | **Incidente creado**, **Estado del incidente cambiado**, **Recordatorio de incidente**, **SLA de incidente incumplido**, **Episodio de incidente creado**, **Estado del episodio de incidente cambiado**, **Incidente añadido al episodio de incidente** | **Nota de incidente publicada**, **Añadido como propietario del incidente**, **Asignado a un incidente**, **Nota de episodio de incidente publicada**, **Añadido como propietario del episodio de incidente** |
| **Alertas** | **Alerta creada**, **El estado de la alerta ha cambiado**, **Recordatorio de alerta**, **Episodio de alerta creado**, **El estado del episodio de alerta ha cambiado**, **Alerta añadida al episodio de alerta** | **Nota de alerta publicada**, **Añadido como propietario de la alerta**, **Nota del episodio de alerta publicada**, **Añadido como propietario del episodio de alerta** |
| **Monitoreo** | **El estado de la sonda cambió para tu monitor**, **El monitor no tiene sondas activas**, **El estado del SLO cambió**, **Añadido como propietario del SLO**, **Excepción asignada a mí**, **Estado de la sonda cambiado**, **Añadido como propietario de la sonda**, **Añadido como propietario de la tabla**, **Añadido como propietario de la canalización**, **Añadido como propietario de un servicio o de infraestructura**, **Añadido como propietario del panel**, **Añadido como propietario del flujo de trabajo**, **Añadido como propietario del runbook**, **Añadido como propietario del grupo de monitores**, **Añadido como propietario del Runner** | **Monitor creado**, **Estado del monitor cambiado**, **Añadido como propietario del monitor**, **El estado del agente de IA ha cambiado**, **Añadido como propietario del agente de IA** |
| **Páginas de estado** | **Mi nota pública aprobada o rechazada**, y también por push: **Nota pública pendiente de mi aprobación** | **Página de estado creada**, **Anuncio de página de estado publicado**, **Añadido como propietario de la página de estado** |
| **Mantenimiento programado** | **Recordatorio de mantenimiento** | **Evento de mantenimiento creado**, **Estado de mantenimiento cambiado**, **Nota de mantenimiento publicada**, **Añadido como propietario del mantenimiento** |
| **Guardia** | **Entras en la guardia**, **Eres el siguiente en la guardia**, **Sales de la guardia**, **Añadido a la política de guardia**, **Eliminado de la política de guardia**, **Llamada perdida**, **Añadido como propietario de la política de guardia**, **Añadido como propietario de la programación de guardia**, **Añadido como propietario de la política de llamadas entrantes**, y también por push: **Antes de que empiece mi turno de guardia**, **Mi próximo turno de guardia se reasigna** | Ninguno |
| **Seguridad** | **Añadido como propietario del almacén de datos**, y también por push: **Nuevo caso de seguridad** (casos de prioridad Alta y Crítica), **Caso de seguridad asignado a mí**, **Paso de playbook esperando mi aprobación**, **Objetivo de respuesta de un caso de seguridad**, **Tarea de un caso de seguridad asignada a mí**, **Paso de un caso de seguridad que dejó de sostenerse**, **OneUptime AI derivó un caso de seguridad a personas**, **Una cacería encontró eventos de seguridad** | Ninguno |

> [!IMPORTANT]
> **Estado del monitor cambiado** empieza desactivado. Para enterarte de cuándo un monitor que es tuyo cae o vuelve, actívalo en la pestaña **Monitoreo**.

**Añadido como propietario de un servicio o de infraestructura**, en la tarjeta **Servicios e infraestructura**, es un solo interruptor para cada servicio, aplicación RUM, base de datos, cola, host, clúster, recurso en la nube y otra pieza de infraestructura de la que te hagan propietario. El mensaje dice de cuál se trata.

**Añadido como propietario del grupo de monitores**, en la tarjeta **Monitores**, y **Añadido como propietario del Runner**, en la tarjeta **Paneles y automatización**, te avisan cuando alguien te añade como propietario de un grupo de monitores o de un Runner.

## Tus turnos

La pestaña **Guardia** trata de ti y de los registros de guardia que son tuyos:

- **Entras en la guardia**, **Eres el siguiente en la guardia** y **Sales de la guardia** siguen tus turnos en los calendarios de guardia en los que estás.
- **Añadido a la política de guardia** y **Eliminado de la política de guardia** te dicen cuándo una política de guardia empieza o deja de avisarte: cuando una de sus reglas de escalado te nombra o deja de nombrarte, cuando te unes al proyecto, y cuando te unes a un equipo que nombra una de sus reglas o lo dejas. Unirte o salir te lo dice una vez por política, con cada una de sus reglas que cambió, y salir te lo dice solo cuando nada más de esa política te avisa. No se envía nada antes de que te unas a un proyecto, ni cuando te quitan de uno.
- **Antes de que empiece mi turno de guardia** envía recordatorios en los momentos que eliges en **Ajustes de usuario → Perfil y calendario → Feed de calendario**, y **Mi próximo turno de guardia se reasigna** te dice cuándo otra persona cubre un turno del que recibiste un recordatorio. Consulta [Feeds de calendario](/docs/on-call/calendar-feeds#recordatorios-y-avisos-de-reasignación).
- **Llamada perdida**, en la tarjeta **Políticas de llamadas entrantes**, avisa a los propietarios de una política de llamadas entrantes de que una persona que llamó no contactó con nadie. Consulta [Política de llamadas entrantes](/docs/on-call/incoming-call-policy#llamadas-perdidas).
- **Añadido como propietario de la política de guardia**, **Añadido como propietario de la programación de guardia** y **Añadido como propietario de la política de llamadas entrantes** te avisan cuando te hacen propietario de uno de ellos, mediante una regla de propietarios o una persona en su página Propietarios.

## Casos de seguridad

La pestaña **Seguridad** trata de los casos de seguridad que puedes ver:

- **Nuevo caso de seguridad** tiene una prioridad debajo de su nombre: la prioridad mínima de los casos que te avisan. Es **Alta y superior** salvo que elijas **Solo Crítica**, **Media y superior**, **Baja y superior** o **Todos los casos**.
- **Caso de seguridad asignado a mí** sigue los casos asignados a ti y a los equipos de los que formas parte.
- **Paso de playbook esperando mi aprobación** te pide que apruebes o rechaces un paso de playbook en un caso en el que puedes aprobar.

Consulta [Casos de seguridad](/docs/telemetry/security-cases#notificaciones).

## Aprobación de notas públicas

La tarjeta **Aprobación de notas públicas**, en la pestaña **Páginas de estado**, trata de las notas públicas que esperan aprobación antes de publicarse, en un proyecto que la pide:

- **Nota pública pendiente de mi aprobación** te dice que una nota pública, o una edición de una, espera a un paso que apruebas, por tu nombre o a través de un equipo. No se te pregunta por una nota que enviaste, ni por un paso posterior a uno que aprobaste. Se te pregunta por cada paso una vez: cuando la nota llega a él, o cuando pasas a ser uno de sus aprobadores mientras la nota espera, porque cambiaron los pasos de aprobación o te uniste a un equipo que nombra un paso. Empieza activada por correo y por push, y **Resumen de correos** nunca la retiene: los clientes para quienes se escribe la nota la están esperando.
- **Mi nota pública aprobada o rechazada** te dice que una nota que enviaste para aprobación se aprobó y publicó, o se rechazó, con el motivo. Empieza activada por correo.

Consulta [Aprobación de notas públicas](/docs/incidents/notes-owners-and-feed#aprobación-de-notas-públicas).

## Menos correos

Estos interruptores deciden qué novedades te llegan, no cuántos correos suman. **Ajustes de usuario → Preferencias de correo** tiene dos tarjetas para eso, ambas solo para ti, en este proyecto:

- **Resumen de correos** agrupa una ráfaga de novedades en un solo correo: las primeras siguen llegando una a una, y el resto juntas unos minutos después.
- **Menos correos rutinarios** desactiva, con **Reducir los correos rutinarios**, los correos sobre notas, nuevos propietarios, nuevos monitores y páginas de estado, incorporaciones a episodios y cambios en políticas de guardia.

Consulta [Resumen de notificaciones](/docs/emails/notification-rollup).

## Solución de problemas

:::details Un interruptor está activado, pero no llega nada
Comprueba que tienes un método verificado en ese canal en **Ajustes de usuario → Métodos de notificación**. Para SMS, llamadas, WhatsApp y Telegram, el proyecto también debe tener el canal activado.
:::

:::details No hay interruptor de WhatsApp para una novedad
WhatsApp solo entrega mensajes aprobados por Meta, y OneUptime no tiene ninguno para esa novedad, así que su tarjeta dice que WhatsApp no está disponible. Elige otro canal para ella, como SMS o Push.
:::

:::details Soy propietario de un monitor, pero nunca me entero de cuándo cae
**Estado del monitor cambiado** empieza desactivado. Activa un canal para él, en la pestaña **Monitoreo**.
:::

:::details Sigo recibiendo correos después de desactivarlo todo
Los avisos siguen tus reglas de guardia, no estos interruptores, y los correos de inicio de sesión, seguridad y facturación no son novedades sobre registros. Cada proyecto tiene sus propios ajustes, así que revisa el proyecto del que vino el correo. Consulta [Cómo contactarme](/docs/notifications/on-call-rules).
:::

## Próximos pasos

:::cards
- [Métodos de notificación](/docs/notifications/notification-methods): Añade los métodos a los que envían tus ajustes.
- [Cómo contactarme](/docs/notifications/on-call-rules): Decide cómo te llega un aviso.
- [Resumen de notificaciones](/docs/emails/notification-rollup): Menos correos, más completos, durante una ráfaga.
- [Cómo te contacta OneUptime](/docs/notifications/index): Cómo encajan los métodos, las reglas y los ajustes.
:::
