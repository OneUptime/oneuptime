# Notificaciones push

Las notificaciones push nativas (iOS/Android) están impulsadas por **Expo Push** y **no requieren ninguna configuración del lado del servidor** para instancias auto-alojadas.

## Cómo funciona

La aplicación móvil de OneUptime registra un Token Push de Expo con el backend. Cuando el backend necesita enviar una notificación, hace un POST a la API pública de Expo Push, que enruta el mensaje a Apple APNs o Google FCM en nombre de la aplicación.

Las notificaciones push web continúan usando claves VAPID y el protocolo Web Push.

## Configuración auto-alojada

No se requiere ninguna configuración de notificaciones push. El binario de la aplicación móvil maneja todo el registro de la plataforma automáticamente a través de la infraestructura push de Expo.

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
