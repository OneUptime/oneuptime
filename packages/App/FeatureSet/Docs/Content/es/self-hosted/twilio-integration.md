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

Un despliegue privado necesita acceso HTTPS saliente a Twilio para enviar solicitudes de SMS y llamadas. Twilio recomienda permitir HTTPS saliente a `*.twilio.com` porque sus direcciones de API son dinámicas; consulte las [direcciones IP de Twilio](https://help.twilio.com/articles/115015934048-All-About-Twilio-IP-Addresses). Aplíquelo al tráfico saliente de la aplicación OneUptime, incluidas las NetworkPolicies de Kubernetes y los cortafuegos externos. Permita la resolución DNS y HTTPS (TCP 443) saliente desde la aplicación OneUptime.

El acceso entrante depende de la función:

| Función | ¿Necesita Twilio acceder a OneUptime? |
| --- | --- |
| Envío de SMS | No. Las actualizaciones del estado de entrega sí requieren un callback. |
| Llamada de voz de prueba sencilla | No. OneUptime proporciona las instrucciones de voz con la solicitud saliente a la API. |
| Pulsar 1 para reconocer una alerta de guardia | Sí. Twilio envía la entrada del teclado a OneUptime. |
| Políticas de llamadas entrantes | Sí. Twilio solicita instrucciones de llamada e informa de los resultados de marcación. |

Estas son las rutas externas a través de la pasarela Nginx de OneUptime; los parámetros de ejemplo varían según la notificación:

| Método | Ruta | Finalidad |
| --- | --- | --- |
| POST | `/notification/sms/status-callback/:smsLogId/:token` | Estado de entrega de SMS |
| POST | `/api/user-notification-log-timeline/call/gather-input/:itemId?token=...` | Reconocimiento mediante el teclado |
| POST | `/notification/incoming-call/voice` | Instrucciones opcionales para llamadas entrantes |
| POST | `/notification/incoming-call/dial-status/:callLogId/:callLogItemId` | Resultados opcionales del enrutamiento de llamadas entrantes |

OneUptime genera automáticamente las URL de SMS y de reconocimiento. No sustituya sus tokens por una URL de webhook estática. Para las llamadas entrantes, siga la guía de [políticas de llamadas entrantes](/docs/on-call/incoming-call-policy), que configura el webhook del número al asociar un número.

Twilio requiere [URL de webhook accesibles públicamente](https://www.twilio.com/docs/usage/webhooks/webhooks-overview). Utilice un certificado TLS de confianza pública y conserve el host, protocolo, ruta, parámetros de consulta, cuerpo y cabecera `X-Twilio-Signature` originales al pasar por los proxys. Los controladores de llamadas entrantes validan las firmas de Twilio; la entrega de SMS utiliza un token de URL por mensaje y el reconocimiento mediante el teclado utiliza un token de consulta firmado. No exponga tokens en registros o capturas de pantalla compartidos. Consulte la [seguridad de los webhooks de Twilio](https://www.twilio.com/docs/usage/webhooks/webhooks-security).

### Producción: publique una pasarela hacia el despliegue privado

1. **Elija un nombre de host**, por ejemplo `oneuptime.example.com`. Publique registros DNS públicos que apunten a una pasarela accesible desde Internet. Los proveedores no pueden acceder a direcciones IP privadas ni a nombres DNS exclusivamente internos. Con DNS dividido, los empleados pueden resolver el mismo nombre de host hacia el ingress privado y seguir usando el panel a través de la VPN. El ingress privado también debe ofrecer HTTPS con un certificado válido para ese nombre de host.

2. **Conecte la pasarela a OneUptime.** Sitúela en una DMZ con una ruta al ingress privado, o utilice una pasarela pública conectada mediante su propia VPN de sitio a sitio o enlace privado. Permita el tráfico de la pasarela al ingress en el puerto del servicio de destino. Para Kubernetes/Portainer, un servicio privado `ClusterIP` por sí solo no basta: la pasarela necesita un ingress/controlador u otro destino accesible. Mantenga privadas las bases de datos y los demás servicios internos.

3. **Termine HTTPS en el puerto 443** con un certificado de confianza pública y una cadena intermedia completa. Permita TCP entrante al puerto 443 de la pasarela. Instalar un certificado o cambiar DNS por sí solo no crea la ruta al destino privado.

4. Publique solo las rutas de callback de la tabla anterior mediante la pasarela Nginx de OneUptime, que asigna `/notification` a la aplicación. Conserve `/api` en la ruta de confirmación mediante teclado. Conserve el método, la ruta, la cadena de consulta, el cuerpo y los encabezados de autenticación (`X-Twilio-Signature`). Mantenga el `Host` público y establezca encabezados de confianza `X-Forwarded-Host` y `X-Forwarded-Proto: https`. No añada redirecciones.

5. Excluya estas rutas del SSO del navegador, CAPTCHA y páginas de inicio de sesión del proxy. Mantenga activa la autenticación de OneUptime. Restrinja el acceso al origen a la pasarela y los clientes internos autorizados; oculte los tokens en los registros.

6. **Establezca la URL canónica de OneUptime**:

   Docker Compose, en `config.env`:

   ```dotenv
   HOST=oneuptime.example.com
   HTTP_PROTOCOL=https
   ```

   Valores de Helm/Portainer:

   ```yaml
   host: oneuptime.example.com
   httpProtocol: https
   ```

   Sustituya el ejemplo por su dominio. Estos ajustes generan URL; no crean DNS, TLS ni reglas de cortafuegos. Aplique la configuración de Compose o la actualización de Helm y espere a que la aplicación se reinicie. OneUptime no ofrece un nombre de host separado para callbacks de Twilio. Si cambia el nombre, actualice también los webhooks de los números Twilio existentes.

Los [ajustes de acceso a redes privadas](/docs/self-hosted/private-network-access) controlan las solicitudes salientes de OneUptime a servicios internos. Activar `ALLOW_PRIVATE_NETWORK_WEBHOOKS` no hace que OneUptime sea accesible para Twilio.

### Acceso saliente y restricciones de IP

Las direcciones de origen de los webhooks habituales de Twilio cambian; no use rangos SIP o multimedia como lista de permitidos. Las ediciones elegibles ofrecen [Static Proxy for Webhooks](https://www.twilio.com/docs/iam/twilio-editions/twilio-static-proxy). Verifique la elegibilidad y los productos compatibles y configure el cortafuegos con los rangos publicados actuales. Siga autenticando los callbacks.

### Pruebas y despliegues sin acceso entrante

Sin acceso entrante, el envío de SMS y la reproducción de voz simple pueden funcionar con HTTPS saliente. Los estados de entrega, la confirmación por teclado y el enrutamiento de llamadas entrantes necesitan callbacks accesibles. Una instalación completamente desconectada no puede usar Twilio.

Para desarrollo, la [guía de pruebas de webhooks de Twilio](https://www.twilio.com/docs/usage/webhooks/webhook-testing) describe un túnel público. Diríjalo a un proxy que solo permita las rutas necesarias, configure el nombre de host resultante como se indica arriba y detenga el túnel después de las pruebas. Un túnel sigue exponiendo acceso entrante.

## 4. Pruebe la entrega y los callbacks por separado

1. Desde fuera de la red corporativa y del VPN, verifique que el nombre de host de callbacks resuelve a la pasarela pública y presenta un certificado TLS válido. Un GET del navegador no prueba estos callbacks POST.
2. Utilice **Enviar SMS de prueba** y **Enviar llamada de prueba** en la configuración de Twilio del proyecto. Confirme la recepción en el teléfono de destino.
3. Configure el contacto verificado del usuario para SMS/llamadas y sus reglas de notificación; después, active una alerta de guardia controlada. Pulse 1 y confirme el reconocimiento en OneUptime. Si usa políticas de llamadas entrantes, llame al número configurado y compruebe el enrutamiento y el registro de llamadas.
4. Compruebe el estado de entrega del SMS en OneUptime y en los registros de mensajes de Twilio. La aceptación de un envío no demuestra su entrega; [Twilio informa de los cambios de estado posteriores mediante callbacks](https://www.twilio.com/docs/messaging/guides/track-outbound-message-status).

Si el envío falla, compruebe las credenciales, funciones del número, restricciones de la cuenta y conectividad saliente. Si el mensaje o la llamada llega pero el estado o reconocimiento no se actualiza, examine la URL del callback y los registros del ingress público. La [guía de Twilio sobre errores de recuperación HTTP](https://www.twilio.com/docs/api/errors/11200) ayuda a diagnosticar callbacks inaccesibles, problemas TLS y errores HTTP. Una llamada de prueba satisfactoria por sí sola no verifica el acceso de los callbacks.
