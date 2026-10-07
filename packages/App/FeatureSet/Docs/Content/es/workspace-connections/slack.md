# Conectar OneUptime a Slack

### Pasos para conectar OneUptime a Slack

1. **Crea una cuenta en OneUptime**

   - Visita [OneUptime.com](https://oneuptime.com) y crea una cuenta.
   - Una vez creada la cuenta, crea un nuevo proyecto.

2. **Conecta Slack al proyecto de OneUptime**

   - Navega a **Ajustes del proyecto** > **Slack** dentro de tu proyecto de OneUptime.
   - Sigue las instrucciones para conectar tu cuenta de Slack con el proyecto de OneUptime.

3. **Configura las notificaciones de incidentes**

   - Después de conectar tu cuenta de Slack, ve a **Página de incidentes** > **Slack**.
   - Agrega reglas para enviar notificaciones de incidentes a Slack. Por ejemplo, puedes crear una regla que cree un nuevo canal de Slack e invite a los propietarios del incidente cuando se crea un incidente.

4. **Configura las notificaciones de alertas y mantenimiento programado**
   - Se pueden aplicar reglas similares a las Alertas y el Mantenimiento programado navegando a sus páginas respectivas y configurando las reglas deseadas.

## Probar una regla

**Probar regla** en la fila de una regla publica un mensaje de prueba de esa regla en los canales que nombra, para que veas que llega. Si la regla crea un canal para cada evento, la prueba también crea uno e invita a las personas de la regla.

Igual que **Enviar prueba** junto a un canal en **Configuración del proyecto** > **Workspace** > **Slack**, necesita permiso para crear reglas de notificación: **Project Owner**, **Project Admin**, **Project Member**, **Settings Admin**, **Settings Member** o **Create Workspace Notification Rule** y **Read Workspace Notification Rule** en un rol personalizado. Para quien solo puede ver las reglas, como un **Viewer**, **Probar regla** aparece bloqueado y su información emergente dice lo que hace falta; la API rechaza su prueba con "You do not have permission to send test notifications in this project." En OneUptime Cloud, probar una regla necesita el plan **Growth**, como añadir una.

En OneUptime Cloud, **Enviar prueba** junto a un canal también necesita el plan **Growth**, porque publicar en un canal es lo que hacen las reglas y los resúmenes. **Enviar prueba ahora** en un resumen necesita permiso para crear resúmenes (**Create Workspace Notification Summary** y **Read Workspace Notification Summary** en un rol personalizado) y, en OneUptime Cloud, el plan **Growth**; para cualquier otra persona aparece bloqueado y su información emergente dice lo que hace falta. Un cliente MCP conectado con acceso de solo lectura no puede enviar ninguna prueba.

## Resúmenes

La pestaña **Resumen** de **Incidentes** > **Workspace** > **Slack** (y la de **Alertas**) publica un resumen periódico en los canales que indiques: cuántos incidentes o alertas hubo, con qué rapidez se reconocieron y resolvieron, y una lista con enlaces. Un resumen nuevo se envía cada semana y cubre los últimos 7 días. Deja vacío **Enviar el primer informe a las** y el primero se envía a las 09:00 al comienzo de la próxima semana, día o mes; el formulario indica cuándo.

Un resumen sigue el reloj de su **Zona horaria**, que al principio es la tuya. Allí mantiene su hora todo el año: uno configurado para las 09:00 en Berlín se sigue enviando a las 09:00, hora de Berlín, después del cambio de hora, y las fechas de su mensaje también son las de Berlín. A través de la API, envía `timezone` como nombre de zona horaria IANA, por ejemplo `Europe/Berlin`. Un resumen creado sin ella toma la zona horaria del perfil de quien lo crea, o UTC cuando lo crea una clave de API.

## Acceso a la red para despliegues autoalojados

Para las conexiones salientes, las llamadas de retorno entrantes y los despliegues privados, consulte la sección de acceso a la red de la [Integración con Slack](/docs/self-hosted/slack-integration).
