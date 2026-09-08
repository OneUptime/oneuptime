# Notificaciones push

Las notificaciones push nativas (iOS/Android) usan **Expo Push**. Las instancias autoalojadas utilizan de forma predeterminada el relay de OneUptime y necesitan acceso de red saliente hacia él.

## Cómo funciona

La aplicación móvil de OneUptime registra un Expo Push Token en el backend. El backend envía notificaciones mediante el relay de OneUptime, o directamente a Expo si se configura `EXPO_ACCESS_TOKEN`. Expo las reenvía a Apple APNs o Google FCM para entregarlas al dispositivo.

Las notificaciones push web continúan usando claves VAPID y el protocolo Web Push.

## Configuración auto-alojada

No necesitas credenciales de Expo en el servidor para la aplicación móvil oficial y el relay predeterminado. Para enviar directamente, configura `EXPO_ACCESS_TOKEN` con credenciales del proyecto Expo de tu aplicación. Web push requiere `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` y `VAPID_SUBJECT`.

## Acceso a la red

| Dirección | Destino | Protocolo / puerto | Cuándo se necesita |
| --- | --- | --- | --- |
| OneUptime → relay predeterminado | `https://oneuptime.com/api/notification/push-relay/send` | HTTPS / TCP 443 | Push móvil sin `EXPO_ACCESS_TOKEN`. |
| OneUptime → Expo | `https://exp.host/--/api/v2/push/send` | HTTPS / TCP 443 | Push móvil directo con `EXPO_ACCESS_TOKEN`. |
| OneUptime → servicio push del navegador | Endpoint HTTPS de la suscripción push | HTTPS / normalmente TCP 443 | Web push. |
| Aplicación móvil o navegador → OneUptime | Tu hostname de OneUptime | HTTPS / TCP 443 | Iniciar sesión, registrar dispositivos y abrir enlaces de notificaciones. |

Si cambias `PUSH_NOTIFICATION_RELAY_URL`, permite su hostname y puerto configurado. Un relay personalizado debe implementar la API de relay de OneUptime. Consulta los valores predeterminados y la selección del modo en la [configuración](https://github.com/OneUptime/oneuptime/blob/master/config.example.env) y el [servicio push de OneUptime](https://github.com/OneUptime/oneuptime/blob/master/Common/Server/Services/PushNotificationService.ts); [Expo](https://docs.expo.dev/push-notifications/sending-notifications/) documenta el endpoint directo.

Para web push, permite los hosts reales de los endpoints de los navegadores utilizados. OneUptime admite `fcm.googleapis.com`, `android.googleapis.com`, `push.services.mozilla.com`, `notify.windows.com` y `push.apple.com`, incluidos sus subdominios, como `updates.push.services.mozilla.com` y `web.push.apple.com`. La [suscripción del navegador](https://developer.mozilla.org/en-US/docs/Web/API/PushSubscription) determina el destino. Permitir solo Expo o el relay no habilita web push.

Permite DNS y TLS saliente desde el proceso OneUptime que envía las notificaciones. Su almacén de confianza debe validar el certificado del destino; los proxies deben dejar pasar las peticiones API sin autenticación interactiva. Los proveedores push no llaman a webhooks de tu servidor. OneUptime puede permanecer privado si los dispositivos lo alcanzan por VPN u otra conexión privada. Sin acceso al relay o los servicios push externos no se entregan notificaciones.

La conectividad del dispositivo es independiente. iOS necesita APNs, normalmente TCP 5223 con TCP 443 como alternativa; consulta los rangos actuales de [Apple](https://support.apple.com/en-us/102266). Android necesita FCM en TCP 5228–5230 y 443; consulta los hosts y reglas actuales de [Google](https://firebase.google.com/docs/cloud-messaging/network-configuration). No abras esos puertos de entrada en OneUptime: el servidor envía push móvil mediante el relay o Expo, no directamente a APNs/FCM.

Comprueba DNS y HTTPS desde el contenedor o pod emisor al destino del modo seleccionado. Envía una prueba desde **User Settings > Notification Methods > Push** y confirma su recepción en un dispositivo registrado. Prueba web push en cada navegador por separado. Revisa los errores del relay, Expo o web-push en los registros de OneUptime; la aceptación por la API no confirma la entrega al dispositivo.

## Solución de problemas

### Las notificaciones push no llegan

- Asegúrate de que la aplicación móvil se haya compilado con EAS Build (Expo Go no admite notificaciones push)
- Verifica que el dispositivo esté registrado en la tabla `UserPush` de tu base de datos
- Comprueba los registros del servidor de OneUptime para detectar errores de la API de Expo Push
- Confirma que el dispositivo tenga una conexión a internet activa y los permisos de notificación habilitados

### Errores "DeviceNotRegistered" en los registros

El token Push de Expo ya no es válido. Esto generalmente significa que la aplicación fue desinstalada o el usuario revocó los permisos de notificación. El token se limpiará automáticamente.

## Soporte

Si encuentras problemas con las notificaciones push, por favor:

1. Consulta la sección de solución de problemas anterior
2. Revisa los registros de OneUptime para ver mensajes de error detallados
3. Contáctanos en [hello@oneuptime.com](mailto:hello@oneuptime.com)
