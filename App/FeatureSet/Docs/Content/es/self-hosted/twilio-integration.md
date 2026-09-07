# Integración de Twilio para SMS y llamadas de voz

OneUptime autoalojado utiliza su cuenta de Twilio para enviar alertas por SMS y llamadas de voz. Usted paga directamente a Twilio. Configure las credenciales en el panel de OneUptime: el envío de notificaciones lee la configuración guardada y el chart de Helm no incluye valores para credenciales de Twilio. Una migración antigua importaba `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN` y `TWILIO_PHONE_NUMBER`; cambiar esas variables no sirve para actualizar las credenciales de una instalación existente.

## 1. Prepare su cuenta de Twilio

1. Abra la [consola de Twilio](https://console.twilio.com/) y obtenga su **Account SID** y **Auth Token**.
2. Obtenga un número de teléfono de Twilio con las funciones de SMS y/o voz que necesite. Utilice el formato E.164, incluido el código de país, para los números de remitente y destinatario.
3. Compruebe el saldo de la cuenta, los permisos para los países de destino y los requisitos aplicables de registro de remitentes. Las cuentas de prueba tienen restricciones de destinatarios, geográficas y de otro tipo que pueden impedir el funcionamiento de alertas reales de OneUptime. Consulte la [documentación de Twilio sobre cuentas y pruebas](https://www.twilio.com/docs/usage/tutorials/how-to-use-your-free-trial-account) antes de probar. Utilice una cuenta de pago en producción.

## 2. Guarde las credenciales en OneUptime

Para un proyecto:

1. Vaya a **Configuración del proyecto > Notificaciones > Configuración de notificaciones**.
2. En **Configuración de Twilio**, seleccione **Crear configuración de Twilio**.
3. Introduzca un nombre, **Twilio Account SID**, **Twilio Auth Token** y **Número de teléfono principal de Twilio**. Opcionalmente, introduzca **Números de teléfono secundarios de Twilio** para otros países, separados por comas.
4. Active **Establecer como predeterminada del proyecto** para usar esta configuración en los SMS y llamadas a los miembros del proyecto, incluidas las notificaciones de guardia. Crear una configuración sin activar esta opción no la selecciona para dichas notificaciones.
5. Guarde. Solo una configuración puede ser la predeterminada del proyecto. Las páginas de estado utilizan la configuración asignada explícitamente a cada página.

Para establecer una configuración predeterminada para toda la instalación, un administrador puede abrir **Panel de administración > Configuración > Llamadas y SMS**, editar las credenciales y números de Twilio y guardar. Las notificaciones a los miembros usan esta configuración global cuando su proyecto no tiene una predeterminada. Mantenga el Auth Token confidencial.

## 3. Configure el acceso a la red

Un despliegue privado necesita acceso HTTPS saliente a Twilio para enviar solicitudes de SMS y llamadas. Twilio recomienda permitir HTTPS saliente a `*.twilio.com` porque sus direcciones de API son dinámicas; consulte las [direcciones IP de Twilio](https://help.twilio.com/articles/115015934048-All-About-Twilio-IP-Addresses). Aplíquelo al tráfico saliente de la aplicación OneUptime, incluidas las NetworkPolicies de Kubernetes y los cortafuegos externos.

El acceso entrante depende de la función:

| Función | ¿Necesita Twilio acceder a OneUptime? |
| --- | --- |
| Envío de SMS | No. Las actualizaciones del estado de entrega sí requieren un callback. |
| Llamada de voz de prueba sencilla | No. OneUptime proporciona las instrucciones de voz con la solicitud saliente a la API. |
| Pulsar 1 para reconocer una alerta de guardia | Sí. Twilio envía la entrada del teclado a OneUptime. |
| Políticas de llamadas entrantes | Sí. Twilio solicita instrucciones de llamada e informa de los resultados de marcación. |

Para los callbacks, siga la guía de [acceso a la red para Twilio y Microsoft Teams](/docs/self-hosted/integration-network-access) para publicar las rutas HTTPS necesarias mediante un ingress o proxy inverso, manteniendo privado el panel. Una VPN en el portátil de un administrador no proporciona conectividad a Twilio.

Establezca `HOST=oneuptime.example.com` y `HTTP_PROTOCOL=https` en `config.env` de Docker Compose, o `host: oneuptime.example.com` y `httpProtocol: https` en los valores de Helm, y aplique el cambio del despliegue. Sustituya el ejemplo por su dominio. Estos ajustes determinan las URL generadas; no crean registros DNS, certificados ni reglas de cortafuegos. OneUptime no dispone de un ajuste de nombre de host separado para los callbacks de Twilio.

Estas son las rutas externas a través de la pasarela Nginx de OneUptime; los parámetros de ejemplo varían según la notificación:

| Método | Ruta | Finalidad |
| --- | --- | --- |
| POST | `/notification/sms/status-callback/:smsLogId/:token` | Estado de entrega de SMS |
| POST | `/api/user-notification-log-timeline/call/gather-input/:itemId?token=...` | Reconocimiento mediante el teclado |
| POST | `/notification/incoming-call/voice` | Instrucciones opcionales para llamadas entrantes |
| POST | `/notification/incoming-call/dial-status/:callLogId/:callLogItemId` | Resultados opcionales del enrutamiento de llamadas entrantes |

OneUptime genera automáticamente las URL de SMS y de reconocimiento. No sustituya sus tokens por una URL de webhook estática. Para las llamadas entrantes, siga la guía de [políticas de llamadas entrantes](/docs/on-call/incoming-call-policy), que configura el webhook del número al asociar un número.

Twilio requiere [URL de webhook accesibles públicamente](https://www.twilio.com/docs/usage/webhooks/webhooks-overview). Utilice un certificado TLS de confianza pública y conserve el host, protocolo, ruta, parámetros de consulta, cuerpo y cabecera `X-Twilio-Signature` originales al pasar por los proxys. Los controladores de llamadas entrantes validan las firmas de Twilio; la entrega de SMS utiliza un token de URL por mensaje y el reconocimiento mediante el teclado utiliza un token de consulta firmado. No exponga tokens en registros o capturas de pantalla compartidos. Consulte la [seguridad de los webhooks de Twilio](https://www.twilio.com/docs/usage/webhooks/webhooks-security).

## 4. Pruebe la entrega y los callbacks por separado

1. Utilice **Enviar SMS de prueba** y **Enviar llamada de prueba** en la configuración de Twilio del proyecto. Confirme la recepción en el teléfono de destino.
2. Configure el contacto verificado del usuario para SMS/llamadas y sus reglas de notificación; después, active una alerta de guardia controlada. Pulse 1 y confirme el reconocimiento en OneUptime.
3. Compruebe el estado de entrega del SMS en OneUptime y en los registros de mensajes de Twilio. La aceptación de un envío no demuestra su entrega; [Twilio informa de los cambios de estado posteriores mediante callbacks](https://www.twilio.com/docs/messaging/guides/track-outbound-message-status).

Si el envío falla, compruebe las credenciales, funciones del número, restricciones de la cuenta y conectividad saliente. Si el mensaje o la llamada llega pero el estado o reconocimiento no se actualiza, examine la URL del callback y los registros del ingress público. La [guía de Twilio sobre errores de recuperación HTTP](https://www.twilio.com/docs/api/errors/11200) ayuda a diagnosticar callbacks inaccesibles, problemas TLS y errores HTTP. Una llamada de prueba satisfactoria por sí sola no verifica el acceso de los callbacks.
