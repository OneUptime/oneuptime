# Feeds de calendario (turnos de guardia en Google Calendar, Outlook y Calendario de Apple)

Los feeds de calendario llevan tus turnos de guardia al calendario que ya consultas. OneUptime publica un enlace iCalendar (`.ics`) secreto por persona, por horario y por proyecto; Google Calendar, Outlook, Calendario de Apple, Thunderbird y cualquier otra aplicación capaz de suscribirse a un calendario por URL consultan ese enlace y muestran un evento por turno. No se instala nada ni se conecta ninguna cuenta: el enlace es toda la integración.

> **Note:** Un calendario suscrito sirve para **planificar**. Las aplicaciones de calendario releen los feeds a su propio ritmo — Google Calendar solo cada 8 a 24 horas —, así que un cambio hecho una hora antes de un turno te llega por los recordatorios, los avisos de reasignación y las notificaciones de guardia de OneUptime, no por el calendario.

## Qué obtienes

- Un evento por turno, titulado `On-call · <Schedule>` en tu feed personal y `<Name> · On-call · <Schedule>` en un feed compartido. La descripción indica quién está de guardia, el horario y su zona horaria, la capa, el turno en la zona del horario, en UTC y en la tuya, qué políticas de escalado te avisan a través de este horario y un enlace al horario en el panel.
- Se respetan las sustituciones. Cuando alguien te cubre, el evento pasa a esa persona (se añade `(covering for <Name>)`) y sigue siendo el mismo evento en tu aplicación, por lo que se actualiza en su sitio en vez de duplicarse. Una sustitución parcial divide el turno en eventos contiguos.
- Dos días de historial y 90 días hacia adelante por defecto. Puedes ampliarlo a 60 días atrás y 180 días adelante; un feed que superaría los 5.000 eventos se acorta y lo indica en la descripción del calendario.
- Los eventos se marcan como libres (`TRANSP:TRANSPARENT`), así que un feed suscrito nunca bloquea tu disponibilidad, y nada se marca como privado, de modo que un calendario de equipo compartido muestra los títulos a todos los que pueden verlo.
- Las horas se envían en UTC y las convierte tu aplicación; la descripción detalla la hora local en la zona del horario y en la tuya. Configura tu zona horaria en **Ajustes de usuario** > **Perfil** y la del horario en su pestaña **Ajustes**. Un horario sin zona horaria se calcula en la zona del servidor, igual que los avisos, y el evento lo indica.

Las asignaciones fijas — un usuario o equipo nombrado directamente en una regla de una política de escalado — no tienen inicio ni fin y no aparecen en ningún feed. En OneUptime Cloud, los feeds siguen el mismo plan que los horarios de guardia (Growth); un proyecto por debajo de ese plan recibe un calendario vacío en lugar de un error.

## Tres tipos de enlace

| Enlace               | Quién lo crea                                                                      | Qué contiene                                                                                            | Dónde                                                         |
| -------------------- | ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| **Feed personal**    | Cada usuario, uno por proyecto                                                     | Tus turnos en todos los horarios de ese proyecto, más los turnos en los que cubres a alguien (opcional) | **Ajustes de usuario** > **Feed de calendario**               |
| **Feed de horario**  | Quien pueda editar el horario; quien pueda leerlo puede copiar el enlace           | Los turnos de todos en un horario, con eventos opcionales de huecos de cobertura                        | La página del horario, tarjeta **Suscribirse a este horario** |
| **Feed de proyecto** | Quien pueda editar horarios de guardia; quien pueda leerlos puede copiar el enlace | Los turnos de todos en todos los horarios del proyecto, con eventos opcionales de huecos de cobertura   | **Guardia** > **Feeds de calendario**                         |

Los enlaces tienen este aspecto:

```
https://<tu host>/api/on-call-calendar/user/<token>/shifts.ics
https://<tu host>/api/on-call-calendar/schedule/<token>/schedule.ics
https://<tu host>/api/on-call-calendar/project/<token>/project.ics
```

El token de 43 caracteres de la ruta es la única credencial: no hay inicio de sesión, cookie ni clave de API. Trata cada uno de estos enlaces como una contraseña.

## Tu feed personal

1. Abre **Ajustes de usuario** > **Feed de calendario** en el proyecto cuyos turnos quieres. Los feeds personales son por proyecto: un segundo proyecto tiene un segundo enlace y un segundo calendario.
2. Haz clic en **Generar enlace de calendario**. La tarjeta **Suscríbete a tus turnos de guardia** muestra ahora el enlace `https://` y tres botones:
   - **Google Calendar** abre Google Calendar con el enlace rellenado.
   - **Apple / otras aplicaciones** abre la forma `webcals://` del enlace, que macOS, iOS y la mayoría de aplicaciones de escritorio pasan directamente a su diálogo de suscripción.
   - **Copiar enlace webcal** copia ese mismo enlace `webcal(s)://`, el que necesita el Outlook clásico para Windows.
3. Suscríbete en tu aplicación de calendario siguiendo los pasos por aplicación de más abajo.

Ajustes en la misma tarjeta:

- **Incluir turnos que cubro por otros** (activado por defecto) añade los turnos que una sustitución te da en horarios de los que no eres miembro.
- **Días de turnos pasados** (2 por defecto, 60 como máximo) y **Días hacia adelante** (90 por defecto, entre 7 y 180).

La línea de estado muestra cuándo se leyó el enlace por última vez, con qué aplicación, cuántas veces, y los cuatro últimos caracteres del token para distinguir enlaces. Si nada ha leído el enlace tras dos días, la página pregunta si el servidor es accesible desde Internet (ver Solución de problemas).

La página también lista tus **Próximos turnos** (los próximos 30 días), cada uno con un enlace **Buscar cobertura** que abre las sustituciones de usuario rellenadas para ese turno, y la tarjeta **Recordarme antes de los turnos** descrita más abajo.

Acciones:

- **Regenerar enlace** crea un token nuevo. Toda aplicación suscrita al enlace antiguo deja de actualizarse: durante 30 días el enlace antiguo sirve un calendario vacío para que esas aplicaciones borren su copia; después devuelve 404. Vuelve a suscribirte con el enlace nuevo.
- **Desactivar** conserva el enlace pero sirve un calendario vacío hasta que lo actives de nuevo.
- **Eliminar** quita el enlace. Las aplicaciones que aún lo consultan reciben 404 y siguen mostrando lo último que cargaron; desactiva primero si quieres que se vacíen.

El mismo enlace personal, filtrado a un horario con `?schedule=<id>`, se ofrece como **Solo mis turnos en este horario** en cada página de horario, y el banner de guardia y la página **Mis políticas de guardia** llevan un enlace **Añadir tus turnos a tu calendario** a la página anterior.

En la aplicación móvil: **Guardia** > **Añadir turnos a mi calendario** (también en **Ajustes** > **Feed de calendario**), con un enlace por proyecto. En iPhone, **Abrir en Calendario** abre la hoja de suscripción nativa. En Android no hay forma de suscribirse a una URL en el teléfono, así que la pantalla ofrece **Compartir enlace** y **Copiar enlace https** y te indica que añadas el enlace en un ordenador, tras lo cual se sincroniza al teléfono. La lista **Tus turnos** de la aplicación proviene de los mismos datos y tiene la misma acción **Buscar cobertura**.

## Suscribirse en tu aplicación de calendario

Usa el enlace `https://` salvo que la aplicación pida `webcal`; la sección sobre esquemas de más abajo explica la diferencia.

### Google Calendar (web)

1. En Google Calendar en la web, junto a **Otros calendarios** haz clic en **+** > **Desde URL**.
2. Pega el enlace `https://` y haz clic en **Añadir calendario**. El botón **Google Calendar** en OneUptime hace lo mismo con el enlace rellenado.

Google lee el feed **desde los servidores de Google**, aproximadamente cada 8 a 24 horas y a veces más. No hay botón de actualización para calendarios suscritos, y Google ignora las indicaciones de actualización del feed. El nombre y la zona horaria del calendario se leen **solo al suscribirse por primera vez**: renombrar un horario después no renombra el calendario en Google; elimínalo y vuelve a añadirlo si el nombre importa. Google descarta los recordatorios incluidos en archivos de calendario, así que define notificaciones por defecto para ese calendario en los ajustes de Google o, mejor, usa los recordatorios de OneUptime. Si Google indica que no pudo obtener la URL, comprueba que pegaste la forma `https://` y no `webcal://`, y añade `?nocache=1` para que vuelva a intentarlo (OneUptime ignora los parámetros de consulta desconocidos, el feed no cambia). La aplicación Google Calendar en Android e iOS no puede suscribirse por URL; añade el enlace en un ordenador y aparecerá en el teléfono.

### Outlook en la web y Outlook.com

1. Abre **Calendario** > **Agregar calendario** > **Suscribirse desde la web**.
2. Pega el enlace `https://`, ponle un nombre al calendario y haz clic en **Importar**.

Outlook lee **desde los servidores de Microsoft**: aproximadamente cada 3 horas en Outlook.com y cada 4 a 6 horas en cuentas profesionales o educativas, a veces más de un día. El intervalo es fijo y no hay actualización manual. Suscríbete aquí en lugar de en la aplicación de escritorio si quieres el calendario también en el teléfono y en Outlook en la web: las suscripciones creadas en el Outlook clásico para Windows se quedan en ese PC. El nuevo Outlook para Windows y Outlook para Mac usan el mismo diálogo **Agregar calendario** > **Suscribirse desde la web**.

### Outlook clásico para Windows

1. En OneUptime haz clic en **Copiar enlace webcal**.
2. En Outlook, abre **Archivo** > **Configuración de la cuenta** > **Configuración de la cuenta** > **Calendarios de Internet** > **Nuevo**, pega el enlace `webcals://` y haz clic en **Agregar**. Abrir un enlace `webcal` en un navegador también funciona en un PC con Outlook instalado; sin Outlook, Windows no tiene controlador `webcal`.

**No** abras el propio enlace `https://…/shifts.ics` en el Outlook clásico: importa una instantánea única que nunca se actualiza. Solo `webcal://` y `webcals://` crean una suscripción.

El feed se actualiza en cada **Enviar y recibir** (F9, o el intervalo de los grupos de envío y recepción). Los ajustes de la suscripción tienen una casilla **Límite de actualización**: marcada, Outlook no actualiza más rápido que el intervalo que sugiere el editor. OneUptime sugiere una hora (`X-PUBLISHED-TTL:PT1H`), así que el feed se actualiza aproximadamente cada hora. Los feeds sin esa indicación nunca se actualizan con la casilla marcada; los de OneUptime la llevan, así que puedes dejarla marcada. El Outlook clásico lee el feed **desde tu PC** y valida el certificado del servidor.

### Calendario de Apple en macOS

1. Haz clic en **Apple / otras aplicaciones** en OneUptime, o en Calendario elige **Archivo** > **Nueva suscripción a calendario** y pega el enlace.
2. En la hoja de suscripción configura **Actualización automática** — cada 5 minutos, 15 minutos, hora, día o semana (cada hora por defecto) — y elige **iCloud** en **Ubicación** para que el calendario aparezca también en tu iPhone y iPad y siga actualizándose con esa frecuencia.

macOS lee el feed **desde tu Mac**, así que funciona con una instalación en una red privada mientras el Mac pueda alcanzarla. Un certificado autofirmado o de una CA interna debe estar primero en el llavero de macOS como de confianza. **Eliminar alertas** está marcado por defecto en esa hoja; aquí no importa, porque el feed no lleva alarmas.

### iPhone y iPad

Las suscripciones creadas en el propio dispositivo se actualizan según **Ajustes** > **Calendario** > **Cuentas** > **Obtener datos** — **Automáticamente** por defecto, que sobre todo consulta mientras se carga con Wi-Fi. Para una actualización fiable, suscríbete en un Mac con **iCloud** como ubicación, o pon **Obtener datos** en un intervalo fijo. Para suscribirte en el dispositivo, toca **Abrir en Calendario** en la aplicación móvil de OneUptime, o ve a **Ajustes** > **Calendario** > **Cuentas** > **Añadir cuenta** > **Otra** > **Añadir calendario suscrito** y pega el enlace.

### Thunderbird

Elige **Archivo** > **Nuevo** > **Calendario** > **En la red** > **iCalendar (ICS)**, pega el enlace `https://` y elige un intervalo de actualización en las propiedades del calendario: 1, 5, 15, 30 o 60 minutos. Thunderbird lee **desde tu ordenador** y debe confiar en el certificado del servidor.

### Fastmail, Proton y otros servicios

Fastmail actualiza aproximadamente cada hora y **desactiva una suscripción tras cinco lecturas fallidas consecutivas**; si ocurre, vuelve a añadirla cuando el servidor esté sano. Proton Calendar actualiza cada 4 a 16 horas y rechaza feeds muy grandes; reduce **Días hacia adelante** si se queja. Confluence Team Calendars acepta el feed de horario; se respeta su límite de 28 caracteres para nombres de calendario.

### Android

Ni la aplicación Google Calendar ni Samsung Calendar pueden suscribirse a una URL. Añade el enlace `https://` a Google Calendar en un ordenador (**Otros calendarios** > **+** > **Desde URL**); el calendario se sincroniza después al teléfono con el resto de esa cuenta de Google. La aplicación móvil de OneUptime en Android ofrece **Compartir enlace** y **Copiar enlace https** precisamente para esto.

## Con qué frecuencia se actualizan los calendarios

| Aplicación de calendario               | Actualización típica                                                  | Lee desde               | Notas                                                                                               |
| -------------------------------------- | --------------------------------------------------------------------- | ----------------------- | --------------------------------------------------------------------------------------------------- |
| Google Calendar (Desde URL)            | 8–24 horas, a veces más                                               | Servidores de Google    | Sin actualización manual; ignora las indicaciones; nombre y zona horaria leídos solo al suscribirse |
| Outlook.com                            | Unas 3 horas                                                          | Servidores de Microsoft | Fijo; puede superar 24 horas                                                                        |
| Outlook en la web (trabajo, educación) | Unas 4–6 horas                                                        | Servidores de Microsoft | Fijo; sin control del usuario                                                                       |
| Outlook clásico para Windows           | En Enviar y recibir; cada hora aprox. con **Límite de actualización** | Tu PC                   | Necesita un enlace `webcal`; no se sincroniza al teléfono ni a la web                               |
| Calendario de Apple (macOS)            | De 5 minutos a semanal, cada hora por defecto                         | Tu Mac                  | Guarda en iCloud para llegar a iPhone y iPad                                                        |
| Calendario de Apple (solo iOS)         | Según **Obtener datos**, limitado por batería                         | Tu teléfono             | Suscríbete en un Mac para mayor fiabilidad                                                          |
| Thunderbird                            | 1–60 minutos                                                          | Tu ordenador            |                                                                                                     |
| Fastmail                               | Cada hora aprox.                                                      | Servidores de Fastmail  | Desactivado tras cinco lecturas fallidas                                                            |
| Proton Calendar                        | 4–16 horas                                                            | Servidores de Proton    | Rechaza feeds grandes                                                                               |

OneUptime en sí sirve datos frescos: una edición de una capa, una rotación, una sustitución o una vinculación de política invalida el feed de inmediato, y las respuestas se guardan en caché como máximo cinco minutos. La espera que ves es de la aplicación de calendario, no del servidor. OneUptime sugiere actualización horaria mediante `REFRESH-INTERVAL` y `X-PUBLISHED-TTL`; solo el Outlook clásico y Calendario de Apple hacen caso.

## https, webcal y webcals

Los tres apuntan al mismo feed. `webcal://` y `webcals://` son el enlace `http://` y `https://` con el esquema renombrado para que el sistema abra una aplicación de calendario en lugar de un navegador; `webcals` es la variante cifrada y es la que OneUptime ofrece cuando `HTTP_PROTOCOL` es `https`.

- Google Calendar, Outlook en la web, Thunderbird y Fastmail quieren la forma `https://`.
- Calendario de Apple y el Outlook clásico para Windows se suscriben desde un enlace `webcal(s)://`; en el Outlook clásico la forma `https://` es una importación única.
- `webcal://` sin la `s` no va cifrado y envía el token en claro en cada lectura. Si tu instalación aún funciona con `http` simple, el panel muestra una advertencia junto al enlace; pasa a `https` antes de compartir enlaces ampliamente.

## Recordatorios y avisos de reasignación

Las aplicaciones de calendario no entregan alarmas de los feeds suscritos — Google las descarta, Apple las elimina por defecto, Outlook las aplana —, así que OneUptime envía los suyos.

En **Ajustes de usuario** > **Feed de calendario**, la tarjeta **Recordarme antes de los turnos** te permite elegir antelaciones: **1 semana**, **1 día**, **1 hora**, **15 min** o un valor personalizado entre 15 minutos y 14 días, varias a la vez. Cada recordatorio se envía una vez por turno a través de los métodos de entrega elegidos para **Antes de que empiece mi turno de guardia** en **Ajustes de usuario** > **Ajustes de notificación** (pestaña Guardia; correo y push activados por defecto). El mensaje nombra el horario, las políticas por las que avisa y la hora de inicio en tu zona horaria.

- Un turno que cae dentro de una de tus antelaciones por una sustitución tardía — alguien te pasa un turno 20 minutos antes de que empiece — recibe de inmediato un único recordatorio de recuperación.
- Si un turno del que se te recordó se pasa a otra persona, recibes **Mi próximo turno de guardia se ha reasignado**, un tipo de evento independiente que puede silenciarse por separado.
- Los recordatorios nunca se envían después de que un turno haya empezado, ni para horarios no vinculados a ninguna política de escalado, porque esos no pueden avisar a nadie.

## Enlaces compartidos para un horario o un proyecto

Un enlace compartido pertenece al **proyecto**, no a quien lo copió, y muestra los nombres de las personas, nunca sus direcciones de correo.

**Feed de horario.** En la página de un horario, la tarjeta **Suscribirse a este horario** tiene dos mitades: **Solo mis turnos en este horario** (tu enlace personal con filtro de horario) y **Turnos de todos en este horario (enlace de equipo compartido)**. Quien tenga el permiso **Editar** sobre horarios puede **Publicar enlace compartido**, **Regenerarlo** o **Desactivarlo**; quien pueda leer el horario puede copiarlo. La tarjeta muestra cuándo se rotó el enlace por última vez.

**Feed de proyecto.** **Guardia** > **Feeds de calendario** contiene la tarjeta **Turnos de todos en este proyecto (enlace compartido)** — un enlace compartido que cubre todos los horarios del proyecto — con las mismas acciones de publicar, regenerar y desactivar, y un enlace a tu página de feed personal.

Ajustes en ambos:

- **Mostrar huecos de cobertura** (desactivado por defecto) añade un evento `No coverage · <Schedule>` allí donde una capa _debería_ cubrir pero nadie está de guardia: una capa vacía, una capa cuya fecha de inicio está en el futuro, capas desalineadas o cualquier hueco en un horario 24×7. Las horas fuera de oficina de un horario de horario laboral nunca se reportan. **Hueco mínimo a mostrar (minutos)** (60 por defecto) oculta huecos más cortos; se emiten como máximo 100 eventos de hueco, los más antiguos primero.
- **Regenerar cuando alguien abandone el proyecto** (desactivado por defecto) regenera el enlace automáticamente cuando alguien deja su último equipo en el proyecto, para que el calendario de un antiguo compañero deje de actualizarse. Todos los demás deben volver a suscribirse después, por eso es opcional.
- **Días de turnos pasados** y **Días hacia adelante**, como en el feed personal.

Pon el enlace de horario en un calendario de equipo compartido — Google, Outlook o Confluence — y una sola suscripción sirve a todo el equipo. Rótalo cuando se vaya alguien que lo tenía, o activa la rotación automática de arriba.

Cuando una persona deja su último equipo en un proyecto, OneUptime también la quita de las capas de horario y las reglas de escalado de ese proyecto, desactiva su feed personal del proyecto y elimina sus recordatorios allí.

## Los eventos en detalle

- Cada turno tiene una identidad estable formada por el horario y la hora de inicio del turno, de modo que el mismo turno es el mismo evento en tu feed personal, en el feed de horario y tras regenerar un enlace. Las aplicaciones lo actualizan en su sitio; un cambio incrementa el número de secuencia del evento.
- Una sustitución que cambia todo el turno conserva el evento y cambia la persona; una sustitución que cubre parte de un turno produce tres eventos contiguos, por ejemplo A 09:00–12:00, B 12:00–13:00, A 13:00–17:00.
- Cuando un horario está vinculado a dos o más políticas de escalado y una sustitución solo se aplica a una de ellas, las personas avisadas difieren según la política. El feed lo muestra en lugar de ocultarlo: el turno conserva su evento para la persona avisada por las otras políticas, con una nota que nombra la política que avisa a otra persona, y el sustituto recibe un evento extra titulado `On-call · <Schedule> · <Policy> (covering for <Name>)`.
- Los turnos pasados llevan en su descripción la línea «Past shifts reflect the current rotation, not who was actually paged».
- Un horario no vinculado a ninguna política de escalado se muestra igualmente, con una nota de que no avisará a nadie.

## Planificación, no auditoría

El feed muestra la rotación **tal como está configurada ahora**, incluso para días pasados: una sustitución introducida después reescribe el historial en el calendario. Para las horas realmente pasadas de guardia, revisiones de equidad y compensación, usa **Guardia** > **Informes** > **Tiempo de guardia por usuario**, que se escribe a partir de lo que el pager hizo realmente.

## Seguridad

- El token del enlace es la única credencial. Quien tenga el enlace ve los turnos — nombres, horarios, políticas — hasta que se regenere. No pegues enlaces en salas de chat ni tickets; cuando un equipo necesite un calendario, comparte el enlace de horario o de proyecto en lugar del personal.
- Los enlaces son por proyecto. Un enlace personal filtrado expone los turnos de un proyecto, no de todos los proyectos a los que perteneces.
- **Regenerar** pasa el token antiguo a un periodo de gracia de 30 días (calendario vacío, luego 404). **Desactivar** sirve un calendario vacío. Un enlace desconocido o caducado devuelve un 404 simple sin pistas. Los calendarios vacíos hacen que las aplicaciones suscritas borren su copia; un 404 hace que la conserven, por eso desactivar y regenerar sirven calendarios vacíos.
- Los tokens se guardan con hash; la copia mostrada en la página de ajustes está cifrada con `ENCRYPTION_SECRET`. Asigna a esa variable un secreto real en una instalación autoalojada: el servidor avisa al arrancar cuando no está definida o sigue siendo literalmente `secret`. Si la cambias después, la página ofrece **Regenerar enlace** porque la copia guardada ya no puede leerse; el feed sigue funcionando hasta que lo hagas.
- Las respuestas de los feeds se marcan `Cache-Control: private`, se excluyen de los buscadores (`X-Robots-Tag: noindex`) y se limitan en frecuencia por enlace y por dirección de cliente.
- El Nginx propio de OneUptime no escribe las peticiones de feed en su registro de acceso:

  ```
  location ~ ^/api/on-call-calendar/(user|schedule|project)/ {
      access_log off;
      ...
  }
  ```

  así un token nunca acaba en un archivo de registro junto a una dirección de cliente; la aplicación tampoco lo registra nunca. **Cualquier proxy, WAF o CDN que pongas delante de OneUptime sigue registrando la URI completa** salvo que lo configures para no hacerlo; compruébalo antes de desplegar los feeds.

## Configuración autoalojada

No hay nada que activar: los feeds funcionan en toda instalación. Cuatro variables de entorno los controlan, definidas en `config.env` para Docker Compose o bajo `onCallCalendarFeed` en los valores de Helm (ver la [referencia de configuración](https://github.com/OneUptime/oneuptime/blob/master/HelmChart/Public/oneuptime/docs/configuration.md#on-call-calendar-feeds) del chart):

| Variable                                                | Valor Helm                                       | Por defecto | Efecto                                                                                                                                                                      |
| ------------------------------------------------------- | ------------------------------------------------ | ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DISABLE_ON_CALL_CALENDAR_FEED`                         | `onCallCalendarFeed.disabled`                    | `false`     | Interruptor de emergencia. Toda URL de feed responde `503` con `Retry-After: 3600`; las aplicaciones suscritas conservan su copia y reintentan más tarde. No se borra nada. |
| `ON_CALL_CALENDAR_FEED_RATE_LIMIT_WINDOW_SECONDS`       | `onCallCalendarFeed.rateLimit.windowSeconds`     | `60`        | Duración de la ventana de limitación.                                                                                                                                       |
| `ON_CALL_CALENDAR_FEED_RATE_LIMIT_PER_TOKEN_PER_WINDOW` | `onCallCalendarFeed.rateLimit.perTokenPerWindow` | `60`        | Lecturas que un enlace puede hacer desde una dirección de cliente por ventana.                                                                                              |
| `ON_CALL_CALENDAR_FEED_RATE_LIMIT_PER_IP_PER_WINDOW`    | `onCallCalendarFeed.rateLimit.perIpPerWindow`    | `3000`      | Lecturas que una dirección de cliente puede hacer entre todos los enlaces por ventana: el techo para toda una oficina detrás de una sola dirección.                         |

También relevante:

- **`HOST` y `HTTP_PROTOCOL`** construyen los enlaces. Si `HOST` está vacío o es `localhost`, o `HTTP_PROTOCOL` es `http`, la página del feed muestra una advertencia y los enlaces no funcionarán desde fuera.
- **`TRUSTED_PROXY_HOPS`** decide qué dirección cuenta el límite por dirección. El valor por defecto `1` es correcto para las disposiciones estándar de Docker Compose y Helm; suma uno por cada proxy propio — CDN, WAF o balanceador — que añada a `X-Forwarded-For`; de lo contrario todos los clientes de calendario parecen la misma dirección y comparten un solo presupuesto. Ver [Trusted proxies](https://github.com/OneUptime/oneuptime/blob/master/HelmChart/Public/oneuptime/docs/configuration.md#trusted-proxies) en la documentación del chart.
- **Redis** sostiene las cachés y el limitador. Ambos se degradan con elegancia: sin Redis los feeds se siguen generando, solo más despacio, y el limitador deja pasar las peticiones.
- En el modo dividido del chart de Helm (`worker.enabled: true`) los feeds se generan en el nivel de API; dimensiona ese nivel para una ráfaga de clientes de calendario consultando a la hora en punto.
- La exención del registro de acceso de Nginx mostrada arriba forma parte del `Nginx/default.conf.template` distribuido; consérvala si personalizas la plantilla.

## Solución de problemas

**Nada ha leído el enlace, o «No se pudo obtener la URL».** Google Calendar, Outlook en la web, Fastmail y Proton leen **desde sus propios servidores**, así que el host de OneUptime debe ser accesible desde la Internet pública con un certificado en el que confíen. Una instalación en una red privada, tras una VPN o con una autoridad de certificación interna es inaccesible para ellos pegues lo que pegues. Calendario de Apple, Thunderbird y el Outlook clásico leen desde el dispositivo, así que funcionan allí donde el dispositivo pueda abrir el panel, tras confiar en el certificado en ese dispositivo si es autofirmado. La línea de estado de la página del feed te dice si algo ha leído ya el enlace; `curl -I` contra el enlace desde fuera de tu red es la comprobación más rápida. Permitir que OneUptime _alcance_ redes privadas — [Acceso a redes privadas](/docs/self-hosted/private-network-access) — es otro asunto y no ayuda aquí.

**El calendario está desactualizado.** Lee primero la tabla de actualización: en Google el retraso es normal. Para que Google vuelva a mirar, elimina y vuelve a añadir el calendario o añade `?nocache=1` al enlace (los parámetros desconocidos se ignoran, el feed es el mismo pero Google lo trata como nuevo). En el Outlook clásico pulsa F9 y revisa el ajuste **Límite de actualización**. En Calendario de Apple usa **Visualización** > **Actualizar calendarios**. Si importa un cambio del mismo día, confía en los recordatorios y avisos de reasignación de OneUptime antes que en el calendario.

**El calendario está vacío.** Un calendario vacío es intencionado. Significa que el enlace está desactivado, es un enlace antiguo dentro de su periodo de gracia de 30 días tras regenerar, el proyecto está por debajo del plan que incluye horarios de guardia, o ya no estás en ningún horario de ese proyecto. Abre el enlace en un navegador: la descripción del calendario (`X-WR-CALDESC`) indica el motivo.

**404.** El enlace es desconocido, se ha eliminado o su periodo de gracia ha terminado. Genera uno nuevo y vuelve a suscribirte.

**503.** O bien `DISABLE_ON_CALL_CALENDAR_FEED` está definido, o el servidor está ocupado: se generan como mucho unos pocos feeds a la vez, y un horario que tarda demasiado en calcularse se interrumpe. Cuando existe una copia anterior del feed, el servidor la sirve en su lugar con una cabecera `Warning: 110`, así que un 503 significa que no había nada a lo que recurrir. Los clientes conservan su última copia y reintentan tras el intervalo `Retry-After`. Fastmail desactiva una suscripción tras cinco fallos seguidos; vuelve a añadirla cuando el servidor esté sano. La métrica `oncall_calendar_render_duration_ms` muestra a los operadores qué feeds son lentos.

**429 o «demasiadas peticiones».** Muchos clientes tras una misma dirección — un NAT de oficina, una pasarela VPN — comparten el presupuesto por dirección. Sube `ON_CALL_CALENDAR_FEED_RATE_LIMIT_PER_IP_PER_WINDOW` y revisa `TRUSTED_PROXY_HOPS`: si es demasiado bajo, cada cliente se atribuye a tu propio proxy y todos comparten un solo presupuesto.

**Errores de certificado en Calendario de Apple, Thunderbird u Outlook.** Estas aplicaciones validan TLS en el dispositivo. Importa tu CA interna en el almacén de confianza del dispositivo — el llavero de macOS, el almacén de certificados de Windows, el gestor de certificados de Thunderbird — o usa un certificado de confianza pública. Los lectores del lado del servidor como Google y Microsoft no pueden hacerse confiar en una CA privada.

**Las horas son incorrectas.** Todas las horas del archivo están en UTC; la aplicación de calendario convierte a su propia zona. Si los turnos parecen desplazados un intervalo fijo, revisa la zona horaria del horario (pestaña **Ajustes**) y la tuya (**Ajustes de usuario** > **Perfil**). Un horario sin zona horaria se calcula en la zona del servidor y el evento lo indica.

**El feed dice que se ha acortado.** Más de 5.000 eventos cayeron dentro de la ventana. Reduce **Días hacia adelante**, o suscríbete a **Solo mis turnos en este horario** en lugar de a todo un proyecto.

**Google muestra un nombre de calendario antiguo.** Google lee el nombre solo al suscribirse por primera vez; elimina y vuelve a añadir el calendario.

**La página de ajustes dice que el enlace debe regenerarse.** `ENCRYPTION_SECRET` cambió desde que se creó el enlace, así que el servidor ya no puede mostrarlo. La suscripción existente sigue funcionando; regenerar te da un enlace que puedes copiar de nuevo y retira el antiguo tras 30 días.

**Falta un turno en mi feed.** Solo aparecen turnos de horario; las asignaciones directas de usuario o equipo en una regla de política son fijas y no tienen eventos. Un turno asumido por otra persona mediante una sustitución sale de tu feed porque ahora está en el suyo. Activa **Incluir turnos que cubro por otros** para ver los turnos obtenidos por sustituciones en horarios de los que no eres miembro.
