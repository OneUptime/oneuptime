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

Igual que **Enviar prueba** junto a un canal en **Configuración del proyecto** > **Workspace** > **Slack**, necesita permiso para crear reglas de notificación: **Project Owner**, **Project Admin**, **Project Member**, **Settings Admin**, **Settings Member** o **Create Workspace Notification Rule** en un rol personalizado. A quien solo puede ver las reglas, como un **Viewer**, se le dice que no tiene permiso para enviar notificaciones de prueba. En OneUptime Cloud, probar una regla necesita el plan **Growth**, como añadir una.

## Acceso a la red para despliegues autoalojados

Para las conexiones salientes, las llamadas de retorno entrantes y los despliegues privados, consulte la sección de acceso a la red de la [Integración con Slack](/docs/self-hosted/slack-integration).
