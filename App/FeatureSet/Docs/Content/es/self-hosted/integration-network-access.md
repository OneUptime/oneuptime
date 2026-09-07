# Acceso a integraciones desde redes privadas

Una instancia autoalojada de OneUptime puede enviar solicitudes a Twilio y Microsoft y, aun así, ser inaccesible desde sus servicios en la nube. La conexión VPN de un empleado no da acceso a la red privada a ninguno de los proveedores. Utilice la [guía de configuración de Twilio](/docs/self-hosted/twilio-integration) y la [guía de configuración de Teams](/docs/self-hosted/microsoft-teams-integration) junto con los siguientes pasos de red.

## ¿En qué dirección se necesita acceso?

| Función | De OneUptime al proveedor | Del proveedor a OneUptime |
| --- | --- | --- |
| Enviar un SMS o reproducir una alerta de voz saliente sencilla | HTTPS | No se necesita para enviar el SMS o reproducir instrucciones de voz incluidas directamente |
| Actualizaciones de entrega de SMS, acciones del teclado de voz, enrutamiento de llamadas entrantes | HTTPS | Callbacks obligatorios; consulte las rutas en la guía de Twilio |
| Notificaciones de Teams | HTTPS a las API de Microsoft | Necesario para la integración completa del bot, incluido el descubrimiento de conversaciones |
| Comandos de Teams, botones de tarjetas, eventos de instalación en chats | HTTPS | `POST /api/microsoft-bot/messages` |

Los [ajustes de acceso a redes privadas](/docs/self-hosted/private-network-access) controlan las solicitudes salientes de OneUptime a servicios internos. Activar `ALLOW_PRIVATE_NETWORK_WEBHOOKS` no hace que OneUptime sea accesible para Twilio o Teams.

## Producción: publique una pasarela hacia el despliegue privado

```text
Twilio / Azure Bot Service
          | HTTPS :443
          v
Pasarela pública (proxy inverso o balanceador de carga)
          | Conexión privada; solo rutas de callback
          v
Ingress privado de OneUptime -> Aplicación OneUptime
```

1. **Elija un nombre de host**, por ejemplo `oneuptime.example.com`. Publique registros DNS públicos que apunten a una pasarela accesible desde Internet. Los proveedores no pueden acceder a direcciones IP privadas ni a nombres DNS exclusivamente internos. Con DNS dividido, los empleados pueden resolver el mismo nombre de host hacia el ingress privado y seguir usando el panel a través de la VPN. El ingress privado también debe ofrecer HTTPS con un certificado válido para ese nombre de host.
2. **Conecte la pasarela a OneUptime.** Sitúela en una DMZ con una ruta al ingress privado, o utilice una pasarela pública conectada mediante su propia VPN de sitio a sitio o enlace privado. Permita el tráfico de la pasarela al ingress en el puerto del servicio de destino. Para Kubernetes/Portainer, un servicio privado `ClusterIP` por sí solo no basta: la pasarela necesita un ingress/controlador u otro destino accesible. Mantenga privadas las bases de datos y los demás servicios internos.
3. **Termine HTTPS en el puerto 443** con un certificado de confianza pública y una cadena intermedia completa. Permita TCP entrante al puerto 443 de la pasarela. Instalar un certificado o cambiar DNS por sí solo no crea la ruta al destino privado.
4. **Reenvíe solo las rutas de callback necesarias** de la tabla de la guía de Twilio y `/api/microsoft-bot/messages` para Teams. Diríjalas a través del ingress de OneUptime, que ya asigna `/notification` a la aplicación. Conserve el método, la ruta original, la cadena de consulta, el cuerpo, `Authorization` y `X-Twilio-Signature`. Conserve el `Host` público y establezca cabeceras de confianza `X-Forwarded-Host` y `X-Forwarded-Proto: https` en la pasarela. No elimine `/api` ni añada redirecciones. Deniegue otras rutas en la pasarela pública; los empleados pueden usar el ingress privado para el panel y los callbacks de inicio de sesión del navegador.
5. **Mantenga intacta la autenticación de callbacks.** Excluya estas rutas del SSO del navegador, CAPTCHA y páginas de inicio de sesión del proxy porque los proveedores no pueden completarlos. OneUptime sigue validando sus tokens de callback, las firmas de Twilio en las rutas de llamadas entrantes y la autenticación de Bot Framework. No elimine esas comprobaciones. Permita el acceso al servidor de origen solo desde su pasarela y clientes internos autorizados, y oculte los tokens de callback en los registros. Twilio describe esta [arquitectura de proxy en DMZ y la seguridad de los webhooks](https://www.twilio.com/docs/usage/webhooks/webhooks-security).
6. **Establezca la URL canónica de OneUptime** antes de configurar cualquiera de las integraciones:

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

   Estos ajustes controlan las URL generadas; no aprovisionan DNS, TLS ni acceso a través del cortafuegos. Aplique la configuración de Compose o la actualización de la versión de Helm y espere a que la aplicación se reinicie. OneUptime no ofrece un nombre de host separado para los callbacks de Twilio. Si cambia el nombre de host, actualice los webhooks existentes de los números de Twilio, el punto de conexión de mensajería de Azure Bot y las URI de redirección del registro de aplicación, y vuelva a descargar y cargar el manifiesto de Teams.

## Acceso saliente y restricciones de IP

Permita la resolución DNS y HTTPS saliente desde la aplicación OneUptime. Twilio recomienda acceso a `*.twilio.com` porque sus direcciones API cambian; consulte las [recomendaciones de Twilio sobre direcciones IP](https://help.twilio.com/articles/115015934048-All-About-Twilio-IP-Addresses). Teams utiliza `graph.microsoft.com`, `login.microsoftonline.com`, puntos de conexión de autenticación y canales de Bot Framework, y la URL del servicio conector de la conversación. Utilice las [recomendaciones de cortafuegos de Microsoft](https://learn.microsoft.com/en-us/azure/bot-service/bot-service-resources-faq-security?view=azure-bot-service-4.0) e inspeccione el tráfico bloqueado durante las pruebas; estos ejemplos no son una lista exhaustiva de dominios.

No utilice los rangos SIP/multimedia de Twilio ni los rangos multimedia de clientes de Teams como listas de permitidos para orígenes de webhooks. Las direcciones ordinarias de los webhooks de Twilio son dinámicas; las ediciones de Twilio elegibles ofrecen [Static Proxy for Webhooks](https://www.twilio.com/docs/iam/twilio-editions/twilio-static-proxy), que requiere una configuración aparte con Twilio. Las recomendaciones de cortafuegos de Microsoft advierten que no se admiten listas fijas de IP entrantes para Bot Framework. Autentique los callbacks en la aplicación en lugar de suponer que una IP de origen fija establece la identidad.

## Pruebas y despliegues sin acceso entrante

Desde una red fuera de su VPN, verifique DNS público y TLS y después compruebe la ruta de Teams:

```bash
curl -sS -i https://oneuptime.example.com/api/microsoft-bot/messages
```

En las versiones actuales de OneUptime, espere `405 Method Not Allowed` con `Allow: POST`. Esto confirma que la solicitud GET llegó a la ruta, no que vaya a funcionar una solicitud POST autenticada del bot. Las versiones anteriores pueden devolver el error JSON 404 de OneUptime; examine el cuerpo de la respuesta y los registros del proxy. Los errores TLS, los tiempos de espera agotados o una página de error HTML del proxy indican problemas de certificado o enrutamiento.

Un GET de navegador no prueba un callback POST de Twilio. Envíe un SMS de prueba real, compruebe su actualización de entrega, responda a una llamada de incidente de prueba y use su acción de teclado; después envíe un mensaje al bot de Teams y pulse un botón de tarjeta. Correlacione los diagnósticos de entrega del proveedor con los registros de la pasarela y la aplicación, ocultando los tokens. Una entrega saliente satisfactoria no demuestra por sí sola que los callbacks funcionen.

Para desarrollo, Twilio documenta las [pruebas mediante un túnel](https://www.twilio.com/docs/usage/webhooks/webhooks-overview) y Microsoft la [depuración local de Teams](https://learn.microsoft.com/en-us/microsoftteams/platform/concepts/build-and-test/debug). Reenvíe un túnel HTTPS público a un proxy que permita únicamente las rutas requeridas, configure el nombre de host resultante como se indica arriba y detenga el túnel después de las pruebas. Un túnel sigue exponiendo un punto de conexión entrante; no convierte un despliegue en uno físicamente aislado de la red.

Si la política prohíbe toda conectividad entrante, el envío de SMS y la reproducción sencilla de voz con instrucciones incluidas pueden seguir funcionando mediante HTTPS saliente, pero no los callbacks de entrega, acciones del teclado, enrutamiento de llamadas entrantes ni la integración completa del bot de Teams. Los puntos de conexión privados de Azure Bot para Direct Line no solucionan la conectividad de Teams: la [guía de aislamiento de red de Microsoft](https://learn.microsoft.com/en-us/azure/bot-service/dl-network-isolation-how-to?view=azure-bot-service-4.0) indica que desactivar el acceso público elimina otros canales, incluido Teams. Un despliegue completamente desconectado no puede utilizar estas integraciones en la nube.
