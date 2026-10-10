# Feeds de calendario

Los feeds de calendario llevan tus turnos de guardia al calendario que ya consultas. OneUptime publica un enlace iCalendar (`.ics`) secreto para cada persona, cada programación y cada proyecto; Google Calendar, Outlook, el Calendario de Apple, Thunderbird y cualquier otra aplicación que pueda suscribirse a un calendario por URL consultan ese enlace y muestran un evento por turno. No se instala nada ni se conecta ninguna cuenta: el enlace es toda la integración.

```mermaid title="Las aplicaciones de calendario consultan un enlace secreto; algunas desde sus propios servidores"
flowchart TB
    subgraph links["Enlaces .ics secretos"]
        direction LR
        personal["Feed personal"]
        schedule["Feed de programación"]
        project["Feed de proyecto"]
    end
    shifts["Programaciones, rotaciones<br/>y sustituciones"] --> links
    links -->|"leídos desde sus servidores"| serverApps["Google Calendar, Outlook en la web"]
    links -->|"leídos desde tu dispositivo"| deviceApps["Calendario de Apple, Thunderbird, Outlook clásico"]
```

> [!NOTE]
> Un calendario suscrito sirve para **planificar**. Las aplicaciones de calendario vuelven a leer los feeds a su propio ritmo —Google Calendar solo cada 8 a 24 horas—, así que un cambio hecho una hora antes de un turno te llega por los recordatorios, avisos de reasignación y avisos de guardia de OneUptime, no por el calendario.

## Qué obtienes

- Un evento por turno, titulado `On-call · <Schedule>` (con ` · <Policy>` añadido cuando la programación está vinculada a exactamente una política de escalado) en tu feed personal y `<Name> · On-call · <Schedule>` en un feed compartido. La descripción indica quién está de guardia, la programación y su zona horaria, la capa, el turno en la zona de la programación, en UTC y en tu zona, qué políticas de escalado te avisan a través de esta programación y un enlace a la programación en el panel.
- Se respetan las sustituciones. Cuando alguien te cubre, el evento pasa a esa persona (se añade `(covering for <Name>)`) y sigue siendo el mismo evento en tu aplicación de calendario, así que se actualiza en su sitio en lugar de duplicarse. Una sustitución parcial divide el turno en eventos contiguos.
- Dos días de historial y 90 días hacia adelante por defecto. Puedes ampliarlo a 60 días hacia atrás y 180 hacia adelante; un feed que superaría 5000 eventos se acorta y lo indica en la descripción de su calendario.
- Los eventos se marcan como disponibles (`TRANSP:TRANSPARENT`), así que un feed suscrito nunca bloquea tu disponibilidad, y nada se marca como privado, de modo que un calendario de equipo compartido muestra los títulos a todos los que pueden verlo.
- Las horas se envían en UTC y tu aplicación de calendario las convierte; la descripción detalla la hora local en la zona de la programación y en la tuya. Configura tu propia zona horaria como **Zona horaria** en tu **Perfil** (tu foto, arriba a la derecha del panel), y la de la programación en la tarjeta **Zona horaria de la programación** de su página **Capas**. Una programación sin zona horaria se calcula en la zona del servidor, igual que los avisos, y el evento lo indica.

Las asignaciones fijas —un usuario o un equipo nombrado directamente en una regla de una política de escalado— no tienen inicio ni fin y no aparecen en ningún feed. En OneUptime Cloud, los feeds siguen el mismo plan que las programaciones de guardia (Growth); un proyecto por debajo de ese plan recibe un calendario vacío en lugar de un error.

## Tres tipos de enlace

| Enlace | Quién lo crea | Qué contiene | Dónde |
| --- | --- | --- | --- |
| **Feed personal** | Cada usuario, uno por proyecto | Tus turnos en todas las programaciones de ese proyecto, más los turnos en los que cubres a alguien (opcional) | **Ajustes de usuario** > **Calendario** > **Feed de calendario** |
| **Feed de programación** | Quien pueda editar la programación; quien pueda leerla puede copiar el enlace | Los turnos de todos en una programación, con eventos opcionales de huecos de cobertura | La página de la programación, tarjeta **Suscribirse a esta programación** |
| **Feed de proyecto** | Quien pueda editar las programaciones de guardia; quien pueda leerlas puede copiar el enlace | Los turnos de todos en todas las programaciones del proyecto, con eventos opcionales de huecos de cobertura | **Guardia** > **Feeds de calendario** |

Los enlaces tienen este aspecto:

```text
https://<your host>/api/on-call-calendar/user/<token>/shifts.ics
https://<your host>/api/on-call-calendar/schedule/<token>/schedule.ics
https://<your host>/api/on-call-calendar/project/<token>/project.ics
```

> [!WARNING]
> El token de 43 caracteres de la ruta es la única credencial: no hay inicio de sesión, cookie ni clave de API. Trata cada uno de estos enlaces como una contraseña.

## Tu feed personal

Los feeds personales son por proyecto: un segundo proyecto tiene un segundo enlace y un segundo calendario.

:::steps
### Abre tu feed de calendario

Abre **Ajustes de usuario** > **Calendario** > **Feed de calendario** en el proyecto cuyos turnos quieres. **Calendario** es una sección del menú lateral que empieza plegada.

### Genera el enlace

Haz clic en **Generar enlace del calendario**. La tarjeta **Suscríbete a tus turnos de guardia** ofrece ahora un único flujo de suscripción:

- **Añadir a tu calendario**: **Google Calendar** abre Google Calendar, que pregunta si quieres añadir el calendario. **Calendario de Apple / Outlook** abre la forma `webcal://` del enlace en la aplicación con la que tu ordenador o teléfono se suscribe: el Calendario de Apple en un Mac, iPhone o iPad, Outlook en Windows.
- **O copia el enlace**: **Copiar enlace** copia el enlace `https://` para cualquier otra aplicación que pueda suscribirse a un calendario por URL. El enlace permanece oculto en la página hasta que haces clic para mostrarlo.

### Suscríbete al enlace

Sigue los pasos de tu aplicación en «Suscríbete en tu aplicación de calendario» más abajo. Tus turnos aparecen como eventos la próxima vez que la aplicación lea el enlace: consulta «Con qué frecuencia se actualizan los calendarios».
:::

### Configuración del feed

Haz clic en **Editar configuración** en la tarjeta **Configuración del feed de calendario** para cambiar lo que incluye el enlace:

| Ajuste | Qué hace |
| --- | --- |
| **Incluir los turnos que cubro por otros** | Activado por defecto. Añade los turnos que te da una sustitución en programaciones de las que no eres miembro por lo demás. |
| **Días de turnos pasados** | Hasta dónde llega el calendario hacia atrás (2 por defecto, 60 como máximo). |
| **Días hacia adelante** | Hasta dónde llega el calendario hacia adelante (90 por defecto, entre 7 y 180). |

La línea de estado muestra cuándo se leyó el enlace por última vez, con qué aplicación de calendario, cuántas veces, y los cuatro últimos caracteres del token para que puedas distinguir los enlaces. Si nada ha leído el enlace al cabo de dos días, la página pregunta si el servidor es accesible desde Internet (consulta Solución de problemas).

### Gestiona el enlace

| Acción | Qué ocurre |
| --- | --- |
| **Regenerar enlace** | Crea un token nuevo. Todas las aplicaciones suscritas al enlace antiguo dejan de actualizarse: durante 30 días el enlace antiguo sirve un calendario vacío para que esas aplicaciones vacíen su copia; después responde 404. Vuelve a suscribirte con el enlace nuevo. |
| **Desactivar** | Conserva el enlace, pero sirve un calendario vacío hasta que lo vuelvas a activar. |
| **Eliminar** | Elimina el enlace. Las aplicaciones que lo siguen consultando reciben 404 y siguen mostrando lo último que leyeron; desactívalo primero si quieres que se vacíen. |

### Próximos turnos y cobertura

La página también lista tus **Próximos turnos** (los 30 días siguientes) y la tarjeta **Recordarme antes de los turnos** descrita más abajo. Cada uno de tus turnos tiene un enlace **Buscar cobertura**: abre las sustituciones de usuario en el proyecto del turno con una sustitución nueva ya rellenada para ese turno, contigo como **¿Quién está ausente?** y las horas del turno como **Empieza** y **Finaliza** (desde ahora, si el turno ya empezó), así que solo falta **¿Quién cubre?**. La sustitución envía todos tus avisos de esas horas a quien te cubre, desde todas las políticas de guardia; un turno que solo existe dentro de una política se cubre en la página de sustituciones de usuario de esa política. Un turno en el que tú cubres a otra persona no tiene **Buscar cobertura**: las sustituciones no se encadenan, así que cubrir una cobertura no cambiaría nada.

El mismo enlace personal, filtrado a una programación con `?schedule=<id>`, se ofrece como **Solo mis turnos en esta programación** en la página de cada programación, y el banner de guardia y la página **Mis políticas de guardia** llevan un enlace **Añade tus turnos a tu calendario** a la página anterior.

### En la aplicación móvil

En la aplicación móvil: **On-Call** > **Add shifts to my calendar** (también en **Settings** > **Calendar feed**), con un enlace por proyecto. En el iPhone, **Open in Calendar** abre la hoja de suscripción nativa. En Android no hay forma de suscribirse a una URL en el teléfono, así que la pantalla ofrece **Share link** y **Copy https link** y te pide que añadas el enlace en un ordenador; después se sincroniza con el teléfono. La lista **Your shifts** de la aplicación sale de los mismos datos y tiene la misma acción **Get cover**.

## Suscríbete en tu aplicación de calendario

Usa **Google Calendar** o **Calendario de Apple / Outlook** en OneUptime cuando tu aplicación tenga un botón; cualquier otra aplicación usa el enlace `https://` que te da **Copiar enlace**. «Enlaces https y webcal», más abajo, explica las dos formas.

:::tabs
@tab Google Calendar
1. Haz clic en **Google Calendar** en OneUptime. Se abre Google Calendar y pregunta si quieres añadir el calendario; haz clic en **Añadir**.
2. O bien, en Google Calendar en la web, junto a **Otros calendarios**, haz clic en **+** > **Desde URL**, pega el enlace (**Copiar enlace** en OneUptime) y haz clic en **Añadir calendario**.

El botón **Google Calendar** abre la página de Google para añadir por URL, `https://calendar.google.com/calendar/r?cid=` seguido de la forma `webcal://` del enlace, codificada con porcentajes. Esa página solo acepta la forma `webcal://`: con la forma `https://`, Google responde «Unable to add calendar. Check the URL.». **Desde URL** acepta las dos formas.

Google lee el feed **desde los servidores de Google**, así que el servidor de OneUptime debe ser accesible desde Internet; OneUptime Cloud siempre lo es; para una instalación autoalojada, consulta Solución de problemas. La primera lectura suele llegar a los pocos minutos de suscribirte; después, Google actualiza aproximadamente cada 8 a 24 horas, a veces más. No hay botón de actualizar para los calendarios suscritos, y Google ignora las indicaciones de actualización del feed. La línea de estado de la página del feed dice **Última obtención … por Google Calendar** en cuanto Google ha leído el enlace.

El nombre y la zona horaria del calendario se leen **solo al suscribirse por primera vez**: renombrar una programación después no renombra el calendario en Google; quítalo y vuelve a añadirlo si el nombre importa. Google descarta los recordatorios incluidos en los archivos de calendario, así que configura notificaciones predeterminadas para ese calendario en los ajustes de Google o, mejor, usa los recordatorios de OneUptime. Google recuerda una dirección que no pudo leer: cuando hayas corregido lo que lo impedía, vuelve a añadir el enlace con `?nocache=1` al final (OneUptime ignora los parámetros de consulta desconocidos, así que el feed no cambia) o regenera el enlace. La aplicación de Google Calendar para Android e iOS no puede suscribirse por URL; añade el enlace en un ordenador y aparecerá en el teléfono.
@tab Outlook en la web
1. Abre **Calendario** > **Agregar calendario** > **Suscribirse desde la web**.
2. Pega el enlace `https://` (**Copiar enlace** en OneUptime), ponle un nombre al calendario y haz clic en **Importar**.

Funciona igual en Outlook.com, en Outlook en la web para cuentas de trabajo y educativas, en el nuevo Outlook para Windows y en Outlook para Mac. Outlook lee **desde los servidores de Microsoft**: aproximadamente cada 3 horas en Outlook.com y cada 4 a 6 horas en cuentas de trabajo y educativas, a veces más de un día. El intervalo es fijo y no hay actualización manual.

Suscríbete aquí en lugar de en la aplicación de escritorio si quieres el calendario también en tu teléfono y en Outlook en la web; las suscripciones creadas en Outlook clásico para Windows se quedan en ese PC.
@tab Outlook clásico para Windows
1. En un PC con Outlook instalado, haz clic en **Calendario de Apple / Outlook** en OneUptime. Windows pasa el enlace `webcal://` a Outlook, que pregunta si quieres añadir el calendario de Internet. Sin Outlook, Windows no tiene un manejador de `webcal`.
2. O bien, en Outlook, abre **Archivo** > **Configuración de la cuenta** > **Configuración de la cuenta** > **Calendarios de Internet** > **Nuevo**, pega el enlace (**Copiar enlace** en OneUptime) y haz clic en **Agregar**.

**No** abras el enlace `https://…/shifts.ics` directamente en Outlook clásico: importa una instantánea única que nunca se actualiza. Abrir el enlace `webcal://`, o añadir la dirección en **Calendarios de Internet**, crea una suscripción.

El feed se actualiza al **Enviar y recibir** (F9, o el intervalo de los grupos de envío y recepción). La configuración de la suscripción tiene una casilla **Límite de actualización**: marcada, Outlook no actualiza más rápido que el intervalo que sugiere el editor. OneUptime sugiere una hora (`X-PUBLISHED-TTL:PT1H`), así que el feed se actualiza más o menos cada hora. Los feeds sin esa indicación nunca se actualizan mientras la casilla está marcada; los de OneUptime la llevan, así que puedes dejarla marcada. Outlook clásico lee el feed **desde tu PC** y valida el certificado del servidor.
@tab Calendario de Apple (macOS)
1. Haz clic en **Calendario de Apple / Outlook** en OneUptime, o en Calendario elige **Archivo** > **Nueva suscripción a calendario** y pega el enlace.
2. En la hoja de suscripción, ajusta **Actualización automática** —cada 5 minutos, 15 minutos, hora, día o semana (cada hora por defecto)— y elige **iCloud** en **Ubicación** para que el calendario aparezca también en tu iPhone y iPad y siga actualizándose a ese ritmo.

macOS lee el feed **desde tu Mac**, así que funciona con una instalación en una red privada siempre que el Mac pueda alcanzarla. Un certificado autofirmado o de una CA interna debe marcarse primero como de confianza en el llavero de macOS. **Eliminar alertas** viene marcado por defecto en esa hoja; aquí no importa, porque el feed no lleva alarmas.
@tab iPhone y iPad
Para suscribirte en el dispositivo, toca **Open in Calendar** en la aplicación móvil de OneUptime, o ve a **Ajustes** > **Calendario** > **Cuentas** > **Añadir cuenta** > **Otra** > **Añadir calendario suscrito** y pega el enlace.

Las suscripciones creadas en el propio dispositivo se actualizan según **Ajustes** > **Calendario** > **Cuentas** > **Obtener datos**: **Automáticamente** por defecto, lo que sobre todo lee mientras se carga con wifi. Para una actualización fiable, suscríbete en un Mac con **iCloud** como ubicación, o configura **Obtener datos** con un intervalo fijo.
@tab Thunderbird
Elige **Archivo** > **Nuevo** > **Calendario** > **En la red** > **iCalendar (ICS)**, pega el enlace `https://` y elige un intervalo de actualización en las propiedades del calendario: 1, 5, 15, 30 o 60 minutos. Thunderbird lee **desde tu ordenador** y debe confiar en el certificado del servidor.
@tab Android
Ni la aplicación de Google Calendar ni Samsung Calendar pueden suscribirse a una URL. Añade el enlace `https://` a Google Calendar en un ordenador (**Otros calendarios** > **+** > **Desde URL**); después el calendario se sincroniza con el teléfono junto con todo lo demás de esa cuenta de Google. La aplicación móvil de OneUptime en Android ofrece **Share link** y **Copy https link** precisamente para esto.
@tab Otros servicios
Fastmail actualiza más o menos cada hora y **desactiva una suscripción tras cinco lecturas fallidas consecutivas**; si ocurre, vuelve a añadirla cuando el servidor esté bien. Proton Calendar actualiza cada 4 a 16 horas y rechaza los feeds muy grandes; reduce **Días hacia adelante** si se queja. Confluence Team Calendars acepta el feed de programación; se respeta su límite de 28 caracteres para los nombres de calendario.
:::

## Con qué frecuencia se actualizan los calendarios

| Aplicación de calendario | Actualización típica | Lee desde | Notas |
| --- | --- | --- | --- |
| Google Calendar (Desde URL) | 8–24 horas, a veces más | Los servidores de Google | Sin actualización manual; ignora las indicaciones; nombre y zona horaria leídos solo al suscribirse por primera vez |
| Outlook.com | Unas 3 horas | Los servidores de Microsoft | Fijo; puede superar las 24 horas |
| Outlook en la web (trabajo, educación) | Unas 4–6 horas | Los servidores de Microsoft | Fijo; sin control del usuario |
| Outlook clásico para Windows | Al enviar y recibir; más o menos cada hora con **Límite de actualización** | Tu PC | Suscripción mediante el enlace `webcal`; no se sincroniza con el teléfono ni con la web |
| Calendario de Apple (macOS) | De 5 minutos a semanal, cada hora por defecto | Tu Mac | Guárdalo en iCloud para llegar al iPhone y al iPad |
| Calendario de Apple (solo iOS) | Según **Obtener datos**, limitado por la batería | Tu teléfono | Suscríbete en un Mac para más fiabilidad |
| Thunderbird | 1–60 minutos | Tu ordenador | |
| Fastmail | Más o menos cada hora | Los servidores de Fastmail | Se desactiva tras cinco lecturas fallidas |
| Proton Calendar | 4–16 horas | Los servidores de Proton | Rechaza los feeds grandes |

OneUptime sirve datos actualizados: un cambio en una capa, una rotación, una sustitución o una vinculación de política invalida el feed al instante, y las respuestas se guardan en caché como mucho cinco minutos. La espera que ves es de la aplicación de calendario, no del servidor. OneUptime sugiere actualizar cada hora mediante `REFRESH-INTERVAL` y `X-PUBLISHED-TTL`; solo Outlook clásico hace caso de la indicación, y solo con **Límite de actualización** activado; el Calendario de Apple, Thunderbird y los demás actualizan con el intervalo que configures para cada calendario.

## Enlaces https y webcal

Los dos apuntan al mismo feed. `webcal://` es el enlace con su esquema renombrado, para que el sistema operativo abra una aplicación de calendario en lugar de un navegador; la aplicación lee luego el feed por `https://` cuando el servidor sirve https, como hacen el Calendario de Apple y Google Calendar.

- **Copiar enlace** da la forma `https://`. **Desde URL** de Google Calendar, Outlook en la web, Thunderbird y Fastmail la aceptan.
- **Calendario de Apple / Outlook** abre la forma `webcal://`: el Calendario de Apple y Outlook clásico para Windows se suscriben con ella. En Outlook clásico, abrir la forma `https://` en su lugar es una importación única.
- **Google Calendar** lleva la forma `webcal://` dentro del enlace de Google para añadir por URL, la única forma que acepta esa página.
- OneUptime ya no entrega `webcals://`: iOS no lo abre («la dirección no es válida») y Google tampoco lo acepta. Un calendario al que ya te suscribiste con un enlace `webcals://` sigue funcionando.
- Si tu instalación aún funciona con `http` simple, el feed se lee sin cifrar, token incluido, y el panel muestra una advertencia junto al enlace; cambia a `https` antes de compartir enlaces ampliamente.

Las URL de los feeds nunca redirigen. Responden `200` con cualquier esquema que llegue a OneUptime, porque la aplicación no puede saber qué esquema usó la aplicación de calendario cuando TLS termina antes —en OneUptime Cloud, o detrás de tu propio balanceador de carga o CDN—, y una redirección ahí apuntaría de vuelta a la misma URL. Redirige el `http` simple a `https` en el proxy que termina TLS, el único salto que lo sabe.

## Recordatorios y avisos de reasignación

Las aplicaciones de calendario no entregan las alarmas de los feeds suscritos —Google las descarta, Apple las elimina por defecto, Outlook las aplana—, así que OneUptime envía las suyas.

:::steps
1. Abre **Ajustes de usuario** > **Calendario** > **Feed de calendario**.
2. En la tarjeta **Recordarme antes de los turnos**, elige antelaciones: **1 semana**, **1 día**, **1 hora**, **15 min** o, con **Personalizado**, un valor propio de entre 15 minutos y 14 días. Puedes elegir varias a la vez.
3. Elige cómo te llegan los recordatorios en **Antes de que empiece mi turno de guardia**, en **Ajustes de usuario** > **Ajustes de notificaciones** (pestaña De guardia). El correo y el push están activados por defecto.
:::

Cada recordatorio se envía una vez por turno. El mensaje nombra la programación, las políticas a través de las que avisa y la hora de inicio en tu zona horaria.

- Un turno que cae dentro de una de tus antelaciones por una sustitución tardía —alguien te pasa un turno 20 minutos antes de que empiece— recibe un único recordatorio de recuperación de inmediato.
- Si un turno del que se te recordó pasa a otra persona, recibes **Mi próximo turno de guardia se reasigna**, un tipo de evento aparte para que puedas silenciarlo por separado.
- Los recordatorios nunca se envían después de que empiece un turno, ni para programaciones que no están vinculadas a ninguna política de escalado, porque esas no pueden avisar a nadie.
- En WhatsApp, un recordatorio llega con la plantilla de guardia aprobada previamente por Meta, que nombra la programación y la política de escalado y enlaza la programación, pero no incluye la hora de inicio, y que WhatsApp solo envía en inglés. Los avisos de reasignación no tienen plantilla de WhatsApp aprobada, así que te llegan por tus otros canales.

## Enlaces compartidos de una programación o un proyecto

Un enlace compartido pertenece al **proyecto**, no a quien lo copió, y muestra los nombres de las personas, nunca sus direcciones de correo. Pon el enlace de la programación en un calendario de equipo compartido —Google, Outlook o Confluence— y una sola suscripción sirve a todo el equipo.

### Feed de programación

En la página de una programación, la tarjeta **Suscribirse a esta programación** tiene dos mitades: **Solo mis turnos en esta programación** (tu enlace personal con un filtro de programación) y **Turnos de todos en esta programación (enlace de equipo compartido)**. Quien tenga el permiso **Editar** sobre las programaciones puede publicarlo con **Publicar enlace compartido**, renovarlo con **Regenerar enlace** o pararlo con **Desactivar**; quien pueda leer la programación puede copiarlo. La tarjeta muestra cuándo se renovó el enlace por última vez.

### Feed de proyecto

**Guardia** > **Feeds de calendario** contiene la tarjeta **Turnos de todos en este proyecto (enlace compartido)** —un único enlace compartido que cubre todas las programaciones del proyecto— con las mismas acciones de publicar, regenerar y desactivar, y un enlace a tu página de feed personal.

### Configuración de los enlaces compartidos

Haz clic en **Editar configuración** en la tarjeta **Configuración del enlace compartido**:

| Ajuste | Qué hace |
| --- | --- |
| **Mostrar huecos de cobertura** | Desactivado por defecto. Añade un evento `No coverage · <Schedule>` dondequiera que una capa _debería_ cubrir pero nadie está de guardia: una capa vacía, una capa cuya fecha de inicio está en el futuro, capas que no encajan o cualquier hueco en una programación 24×7. Las horas fuera del horario de una programación de horario laboral nunca se notifican, y se emiten como máximo 100 eventos de hueco, los más antiguos primero. |
| **Hueco mínimo a mostrar (minutos)** | 60 por defecto. Oculta los huecos más cortos. |
| **Regenerar cuando alguien abandone el proyecto** | Desactivado por defecto. Regenera el enlace automáticamente cuando alguien deja su último equipo en el proyecto, para que el calendario de un antiguo compañero deje de actualizarse. Todos los demás tienen que volver a suscribirse después, por eso hay que activarlo expresamente. |
| **Días de turnos pasados**, **Días hacia adelante** | Como en el feed personal. |

Renueva un enlace compartido cuando se vaya alguien que lo tenía, o activa la rotación automática de arriba.

Cuando una persona deja su último equipo en un proyecto, OneUptime también la quita de las capas de programación y de las reglas de escalado de ese proyecto, elimina las sustituciones activas y futuras del proyecto que la nombran (como persona sustituida o como sustituta), desactiva su feed personal del proyecto y elimina allí sus recordatorios. Un enlace personal muestra turnos solo mientras su propietario sea miembro del proyecto: se comprueba cada vez que se lee el enlace, así que quien se ha ido recibe un calendario vacío, y la lista de próximos turnos de la aplicación móvil solo cubre los proyectos de los que sigue siendo miembro.

## Los eventos en detalle

- Cada turno tiene una identidad estable formada por la programación y el inicio del turno, así que el mismo turno es el mismo evento en tu feed personal, en el feed de programación y después de regenerar un enlace. Las aplicaciones de calendario lo actualizan en su sitio; un cambio incrementa el número de secuencia del evento.
- Una sustitución que cambia el turno completo conserva el evento y cambia la persona; una sustitución de parte de un turno produce tres eventos contiguos, por ejemplo A 09:00–12:00, B 12:00–13:00, A 13:00–17:00.
- Cuando una programación está vinculada a dos o más políticas de escalado y una sustitución solo se aplica a una de ellas, las personas avisadas difieren según la política. El feed lo muestra en lugar de ocultarlo: el turno conserva su evento para la persona a la que avisan las otras políticas, con una nota que nombra la política que avisa a otra persona, y la persona sustituta recibe un evento adicional titulado `On-call · <Schedule> · <Policy> (covering for <Name>)`.
- Los turnos pasados llevan en su descripción la línea «Past shifts reflect the current rotation, not who was actually paged».
- Una programación que no está vinculada a ninguna política de escalado se muestra igualmente, con una nota de que no avisará a nadie.

## Planificar, no auditar

El feed muestra la rotación **tal como está configurada ahora**, también para los días pasados: una sustitución introducida después reescribe la historia en el calendario. Para las horas pasadas realmente de guardia, las revisiones de equidad y la compensación, usa **Guardia** > **Informes** > **Tiempo de guardia del usuario**, que se registra a partir de lo que hicieron realmente los avisos.

## Seguridad

- El token del enlace es la única credencial. Quien tenga el enlace ve los turnos —nombres, programaciones, políticas— hasta que se regenera. No pegues enlaces en salas de chat ni en tickets; cuando un equipo necesite un calendario, comparte el enlace de la programación o del proyecto en lugar del tuyo personal.
- Los enlaces son por proyecto. Un enlace personal filtrado expone los turnos de un proyecto, no los de todos los proyectos a los que perteneces.
- Regenerar un enlace pasa el token antiguo a un periodo de gracia de 30 días (calendario vacío y después 404). **Desactivar** sirve un calendario vacío. Un enlace desconocido o caducado responde con un simple 404 sin pistas. Los calendarios vacíos hacen que las aplicaciones suscritas vacíen su copia; un 404 hace que la conserven, por eso desactivar y regenerar sirven calendarios vacíos.
- Los tokens se guardan con hash; la copia que se muestra en la página de ajustes está cifrada con `ENCRYPTION_SECRET`. Configura esa variable con un secreto real en una instalación autoalojada: el servidor avisa al arrancar cuando no está definida o sigue siendo uno de los marcadores de posición que trae este repositorio (`secret`, o el `please-change-this-to-random-value` que define `config.example.env`). Si la cambias después, la página ofrece **Regenerar enlace** porque la copia guardada ya no se puede leer; el feed sigue funcionando hasta que lo hagas.
- Las respuestas de los feeds se marcan con `Cache-Control: private`, se excluyen de los buscadores (`X-Robots-Tag: noindex`) y tienen límite de frecuencia por enlace y por dirección de cliente.

El Nginx de OneUptime mantiene las peticiones de los feeds fuera de sus registros:

```nginx title="default.conf.template"
location ~ ^/api/on-call-calendar/(user|schedule|project)/ {
    access_log off;
    error_log /dev/null crit;
    proxy_max_temp_file_size 0;
    ...
}
```

Así, un token nunca acaba en un archivo de registro junto a la dirección de un cliente; la aplicación tampoco lo registra nunca. `access_log off` elimina la línea por petición, `error_log` elimina las líneas que Nginx escribe cuando falla una llamada a la aplicación —sin ello, se registra el token de cada cliente que consulta durante un reinicio— y `proxy_max_temp_file_size 0` evita que un feed grande pase por un archivo temporal.

> [!WARNING]
> **Cualquier proxy, WAF o CDN que pongas delante de OneUptime sigue registrando la URI completa, tanto en su registro de acceso como en el de errores,** salvo que lo configures para no hacerlo; compruébalo antes de desplegar los feeds.

## Configuración autoalojada

No hay que activar nada: los feeds funcionan en cualquier instalación. Cuatro variables de entorno los controlan, definidas en `config.env` para Docker Compose o en `onCallCalendarFeed` en los valores de Helm (consulta la [referencia de configuración](https://github.com/OneUptime/oneuptime/blob/master/HelmChart/Public/oneuptime/docs/configuration.md#on-call-calendar-feeds) del chart):

| Variable | Valor de Helm | Por defecto | Efecto |
| --- | --- | --- | --- |
| `DISABLE_ON_CALL_CALENDAR_FEED` | `onCallCalendarFeed.disabled` | `false` | Interruptor de emergencia. Cada URL de feed responde `503` con `Retry-After: 3600`; las aplicaciones suscritas conservan su copia y lo vuelven a intentar más tarde. No se elimina nada. |
| `ON_CALL_CALENDAR_FEED_RATE_LIMIT_WINDOW_SECONDS` | `onCallCalendarFeed.rateLimit.windowSeconds` | `60` | Duración de la ventana de límite de frecuencia. |
| `ON_CALL_CALENDAR_FEED_RATE_LIMIT_PER_TOKEN_PER_WINDOW` | `onCallCalendarFeed.rateLimit.perTokenPerWindow` | `60` | Lecturas que un enlace puede hacer desde una dirección de cliente por ventana. |
| `ON_CALL_CALENDAR_FEED_RATE_LIMIT_PER_IP_PER_WINDOW` | `onCallCalendarFeed.rateLimit.perIpPerWindow` | `3000` | Lecturas que una dirección de cliente puede hacer en todos los enlaces por ventana: el techo para toda una oficina detrás de una dirección. |

También importa:

- **`HOST` y `HTTP_PROTOCOL`** construyen los enlaces. Si `HOST` está vacío o es `localhost`, o `HTTP_PROTOCOL` es `http`, la página del feed muestra una advertencia y los enlaces no funcionarán desde fuera. Si `HOST` es una dirección privada —`10.x`, `172.16–31.x`, `192.168.x`, un nombre sin punto como el de un contenedor, o un nombre bajo `.internal`, `.local`, `.lan` y similares—, la página indica que Google Calendar y Outlook en la web no pueden alcanzar el enlace; las aplicaciones en un ordenador de la misma red sí pueden.
- **`TRUSTED_PROXY_HOPS`** decide qué dirección cuenta para el límite por dirección. El valor por defecto `1` es el correcto para los despliegues estándar de Docker Compose y Helm; suma uno por cada proxy propio —CDN, WAF o balanceador de carga— que añada a `X-Forwarded-For`; si no, todos los clientes de calendario parecen la misma dirección y comparten un solo presupuesto. Consulta [Trusted proxies](https://github.com/OneUptime/oneuptime/blob/master/HelmChart/Public/oneuptime/docs/configuration.md#trusted-proxies) en la documentación del chart.
- **Redis** respalda las cachés y el límite de frecuencia. Ambos se degradan con suavidad: sin Redis, los feeds se siguen generando, solo que más despacio, y el límite deja pasar las peticiones.
- En el modo dividido del chart de Helm (`worker.enabled: true`), los feeds se generan en el nivel de API, así que dimensiona ese nivel para una ráfaga de clientes de calendario que consultan a la hora en punto.
- La exención del registro de acceso de Nginx mostrada arriba forma parte del `packages/Nginx/default.conf.template` incluido; consérvala si personalizas la plantilla.

## Solución de problemas

:::details Google Calendar dice "Unable to add calendar. Check the URL."
Las versiones antiguas de OneUptime ponían la forma `https://` del enlace en el botón **Google Calendar**, y la página de Google para añadir por URL solo acepta la forma `webcal://`. Recarga la página del feed y vuelve a hacer clic en **Google Calendar**, o añade el enlace en **Otros calendarios** > **+** > **Desde URL**.
:::

:::details Google Calendar muestra el calendario pero ningún turno
Comprueba primero la línea de estado de la página del feed. **Última obtención … por Google Calendar** significa que Google leyó el enlace: abre el enlace en un navegador y mira lo que sirve; un calendario vacío indica su motivo en `X-WR-CALDESC` (consulta «El calendario está vacío» más abajo).

**Aún no obtenido** significa que Google no pudo leerlo: desde una máquina fuera de tu red, `curl -sI <link>` debe responder `200` con `Content-Type: text/calendar` de inmediato. Una redirección, una página de inicio de sesión, un cortafuegos o una comprobación antibots delante de OneUptime detiene al lector de Google; también lo hacía un bucle de redirecciones de versiones antiguas de OneUptime, en instalaciones con `PROVISION_SSL=true` cuyo TLS termina antes de Nginx. Cuando responda `200`, vuelve a añadir el enlace con `?nocache=1` al final para que Google lo lea de nuevo.
:::

:::details Nada ha leído el enlace, o «No se pudo obtener la URL»
Google Calendar, Outlook en la web, Fastmail y Proton leen **desde sus propios servidores**, así que el host de OneUptime debe ser accesible desde Internet con un certificado en el que confíen. Una instalación en una red privada, detrás de una VPN o con una autoridad de certificación interna les resulta inalcanzable, pegues lo que pegues.

El Calendario de Apple, Thunderbird y Outlook clásico leen desde el dispositivo, así que funcionan dondequiera que el dispositivo pueda abrir el panel, después de confiar en el certificado en ese dispositivo si es autofirmado. La línea de estado de la página del feed te dice si algo ha leído ya el enlace; `curl -I` contra el enlace desde fuera de tu red es la comprobación más rápida:

```bash
curl -I "https://<your host>/api/on-call-calendar/user/<token>/shifts.ics"
```

Permitir que OneUptime _llegue_ a redes privadas —[Acceso a redes privadas](/docs/self-hosted/private-network-access)— es otra cuestión y no ayuda aquí.
:::

:::details El calendario está desactualizado
Lee primero la tabla de actualización: en Google el retraso es normal. Para que Google vuelva a mirar, quita y vuelve a añadir el calendario o añade `?nocache=1` al enlace (los parámetros desconocidos se ignoran, así que el feed no cambia, pero Google lo trata como nuevo). En Outlook clásico, pulsa F9 y revisa el ajuste **Límite de actualización**. En el Calendario de Apple, usa **Visualización** > **Actualizar calendarios**. Si importa un cambio del mismo día, confía en los recordatorios y avisos de reasignación de OneUptime más que en el calendario.
:::

:::details El calendario está vacío
Un calendario vacío es intencionado. Significa que el enlace está desactivado, que es un enlace antiguo dentro de su periodo de gracia de 30 días tras regenerarlo, que el proyecto está por debajo del plan que incluye las programaciones de guardia o que ya no estás en ninguna programación de ese proyecto. Abre el enlace en un navegador: la descripción del calendario (`X-WR-CALDESC`) indica el motivo. Si dejaste el proyecto, el enlace sigue vacío: solo muestra turnos mientras eres miembro.
:::

:::details El enlace responde 404
El enlace es desconocido, se eliminó o terminó su periodo de gracia. Genera uno nuevo y vuelve a suscribirte.
:::

:::details El enlace responde 503
O bien `DISABLE_ON_CALL_CALENDAR_FEED` está definido, o el servidor está ocupado: como mucho se generan unos pocos feeds a la vez, y una programación que tarda mucho en calcularse se corta. Cuando existe una copia anterior del feed, el servidor sirve esa en su lugar, con una cabecera `Warning: 110`, así que un 503 significa que no había nada a lo que recurrir. Los clientes conservan su última copia y lo vuelven a intentar tras el intervalo `Retry-After`. Fastmail desactiva una suscripción tras cinco fallos seguidos; vuelve a añadirla cuando el servidor esté bien. La métrica `oncall_calendar_render_duration_ms` muestra a los operadores qué feeds son lentos.
:::

:::details 429 o «demasiadas peticiones»
Muchos clientes detrás de una misma dirección —un NAT de oficina, una pasarela VPN— comparten el presupuesto por dirección. Sube `ON_CALL_CALENDAR_FEED_RATE_LIMIT_PER_IP_PER_WINDOW` y revisa `TRUSTED_PROXY_HOPS`: si es demasiado bajo, cada cliente se atribuye a tu propio proxy y todos comparten un solo presupuesto.
:::

:::details Errores de certificado en el Calendario de Apple, Thunderbird u Outlook
Estas aplicaciones validan TLS en el dispositivo. Importa tu CA interna en el almacén de confianza del dispositivo —el llavero de macOS, el almacén de certificados de Windows, el gestor de certificados de Thunderbird— o usa un certificado de confianza pública. Los lectores del lado del servidor, como Google y Microsoft, no se pueden hacer confiar en una CA privada.
:::

:::details Las horas son incorrectas
Todas las horas del archivo están en UTC; la aplicación de calendario las convierte a su propia zona. Si los turnos parecen desplazados por un desfase fijo, revisa la zona horaria de la programación (**Zona horaria de la programación** en su página **Capas**) y la tuya (**Zona horaria** en tu **Perfil**). Una programación sin zona horaria se calcula en la zona del servidor y el evento lo indica.
:::

:::details El feed dice que se ha acortado
Más de 5000 eventos caían dentro de la ventana. Reduce **Días hacia adelante**, o suscríbete a **Solo mis turnos en esta programación** en lugar de a todo un proyecto.
:::

:::details Google muestra un nombre de calendario antiguo
Google lee el nombre solo al suscribirse por primera vez; quita el calendario y vuelve a añadirlo.
:::

:::details La página de ajustes dice que hay que regenerar el enlace
`ENCRYPTION_SECRET` cambió desde que se creó el enlace, así que el servidor ya no puede mostrarlo. La suscripción existente sigue funcionando; regenerarlo te da un enlace que puedes volver a copiar y retira el antiguo al cabo de 30 días.
:::

:::details Falta un turno en mi feed
Solo aparecen los turnos de las programaciones; las asignaciones directas de usuarios o equipos en una regla de política son fijas y no tienen eventos. Un turno que otra persona asumió mediante una sustitución sale de tu feed porque ahora está en el suyo. Activa **Incluir los turnos que cubro por otros** para ver los turnos que obtuviste mediante sustituciones en programaciones de las que no eres miembro.
:::

## Próximos pasos

:::cards
- [Programaciones de guardia](/docs/on-call/schedules): Configura las rotaciones que muestran tus feeds.
- [Línea de tiempo de guardias](/docs/on-call/schedule-timeline): Ve todas las programaciones lado a lado en el panel.
- [Reglas de escalado](/docs/on-call/escalation-rules): Vincula programaciones a políticas para que sus turnos avisen a personas.
:::
