# Integración de Slack

Conecte su proyecto OneUptime autohospedado con Slack para enviar notificaciones y usar acciones de incidentes, comandos y eventos de mensajes.

## Configuración

1. Configure el hostname y HTTPS de OneUptime como se indica abajo. Copie el manifiesto generado en **Settings > Slack Integration**, también disponible en `https://your-oneuptime-domain.com/api/slack/app-manifest`.
2. [Cree una aplicación de Slack](https://api.slack.com/apps) en su espacio de trabajo usando el manifiesto de su propio despliegue, para que las URL coincidan con su hostname.
3. Copie **Client ID**, **Client Secret** y **Signing Secret** desde **Basic Information** a `config.env` para Docker Compose:

   ```dotenv
   SLACK_APP_CLIENT_ID=YOUR_SLACK_APP_CLIENT_ID
   SLACK_APP_CLIENT_SECRET=YOUR_SLACK_APP_CLIENT_SECRET
   SLACK_APP_SIGNING_SECRET=YOUR_SLACK_APP_SIGNING_SECRET
   ```

   Para Helm, configure estos valores:

   ```yaml
   slackApp:
     clientId: "YOUR_SLACK_APP_CLIENT_ID"
     clientSecret: "YOUR_SLACK_APP_CLIENT_SECRET"
     signingSecret: "YOUR_SLACK_APP_SIGNING_SECRET"
   ```

4. Aplique la configuración y espere a que OneUptime se reinicie. Si la verificación de la URL Events falló antes de configurar el secreto de firma, vuelva a intentarlo.
5. Regrese a **Settings > Slack Integration**, seleccione **Connect to Slack** y autorice la aplicación. Conecte también su cuenta personal de Slack en OneUptime para acciones que requieran identidad de usuario.

## Acceso de red para despliegues autohospedados

### Dirección del tráfico y endpoints

| Tráfico | Acceso necesario |
| --- | --- |
| OneUptime → Slack | DNS y HTTPS saliente por TCP 443 a `slack.com` para Web API e intercambio OAuth; a `hooks.slack.com` para respuestas a comandos y notificaciones mediante webhooks entrantes cuando se utilicen |
| Slack → OneUptime | HTTPS público por TCP 443 a las cuatro rutas POST indicadas para la integración completa |
| Navegador del usuario → OneUptime | Panel y redirecciones OAuth a `/api/slack/auth/:projectId/:userId` y `/api/slack/auth/:projectId/:userId/user`; pueden permanecer accesibles mediante la VPN del usuario |

Estos dominios describen la integración OneUptime, no una lista exhaustiva para clientes o funciones de Slack. Slack aloja sus webhooks *entrantes*: OneUptime envía solicitudes hacia ellos; no son endpoints entrantes de su servidor. Consulte la [guía de webhooks entrantes](https://docs.slack.dev/messaging/sending-messages-using-incoming-webhooks/).

Reenvíe estos callbacks del proveedor a la aplicación OneUptime a través de su ingress:

| Método y ruta | Finalidad |
| --- | --- |
| `POST /api/slack/events` | Verificación de Events API, reacciones, menciones y mensajes |
| `POST /api/slack/interactive` | Botones, accesos directos, formularios modales, `/incident` y `/maintenance` |
| `POST /api/slack/options-load` | Solicitudes de opciones de menús interactivos |
| `POST /api/slack/command` | Comando `/oneuptime` |

OAuth usa una [redirección del navegador seguida de un intercambio de tokens en el servidor](https://docs.slack.dev/authentication/installing-with-oauth/). El manifiesto registra `/api/slack/auth` como prefijo; OneUptime añade las rutas de proyecto y usuario durante la autorización. El acceso del navegador no permite por sí solo entregar eventos o acciones desde Slack.

### Despliegues privados y seguridad de callbacks

Use DNS público y una pasarela con certificado HTTPS de confianza pública, cadena completa y ruta privada al ingress de OneUptime. Permita TCP 443 entrante y publique únicamente los callbacks POST del proveedor indicados arriba. Un `ClusterIP` privado, DNS interno o VPN de empleado no proporciona acceso al proveedor. DNS dividido permite mantener el panel y las rutas OAuth del navegador privados bajo el mismo hostname.

Configure `HOST=oneuptime.example.com` y `HTTP_PROTOCOL=https` en `config.env`, o `host: oneuptime.example.com` y `httpProtocol: https` en Helm. Aplique los cambios y espere al reinicio. Estos valores generan URL; no aprovisionan DNS, TLS ni reglas de cortafuegos. Regenere y actualice el manifiesto de Slack si cambia el hostname.

Conserve método, ruta, parámetros, cuerpo original, `Content-Type`, `X-Slack-Signature` y `X-Slack-Request-Timestamp`. Preserve el host público y HTTPS mediante cabeceras de proxy confiables. Exima los callbacks de SSO del navegador, CAPTCHA y páginas de inicio de sesión del proxy, manteniendo las comprobaciones de firma y marca de tiempo de OneUptime. Sincronice el reloj del servidor. Comprobar la IP de origen no sustituye la [verificación de firmas de Slack](https://docs.slack.dev/authentication/verifying-requests-from-slack/).

### Verificar el acceso y conocer las limitaciones

Verifique Events Request URL en **Event Subscriptions**: Slack envía un [desafío POST y comprueba TLS](https://docs.slack.dev/apis/events-api/using-http-request-urls/). Envíe una notificación de prueba, ejecute un comando slash, pulse un botón de incidente y genere un evento suscrito. Revise los registros de la pasarela y OneUptime sin registrar secretos. Slack requiere confirmaciones rápidas, incluidas [respuestas en tres segundos para interacciones](https://docs.slack.dev/interactivity/handling-user-interaction/). Un GET del navegador o un mensaje saliente correcto no verifica los callbacks POST.

Si se prohíben todas las conexiones entrantes, una aplicación ya autorizada puede enviar mensajes por HTTPS saliente, pero no funcionan eventos, botones, accesos directos ni comandos. El manifiesto de OneUptime utiliza callbacks HTTP y desactiva Socket Mode; activar ese modo de Slack no es una alternativa compatible. La [configuración de acceso a redes privadas](/docs/self-hosted/private-network-access) controla solicitudes salientes hacia destinos privados y no publica callbacks.
