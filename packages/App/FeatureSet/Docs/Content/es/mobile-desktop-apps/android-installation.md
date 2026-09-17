# Guía de instalación para Android

Instale la aplicación nativa de Android **OneUptime On-Call** desde la Google Play Store, o instale el APK directamente en dispositivos sin Google Play.

## Requisitos

- Teléfono o tableta Android con **Android 8.0 (Oreo) o posterior**
- Una cuenta activa de OneUptime (o la URL de su instancia autoalojada de OneUptime)
- Conexión a Internet para iniciar sesión y recibir notificaciones push

## Opción 1: Instalar desde Google Play (recomendado)

1. Abra la **Google Play Store** en su dispositivo.
2. Busque **"OneUptime On-Call"**, o abra este enlace en su dispositivo:
   [https://play.google.com/store/apps/details?id=com.oneuptime.oncall](https://play.google.com/store/apps/details?id=com.oneuptime.oncall)
3. Toque **Instalar**.
4. Una vez instalada, toque **Abrir** o inicie **OneUptime On-Call** desde el cajón de aplicaciones.

## Opción 2: Instalar el APK directamente

Para dispositivos sin Google Play (por ejemplo, GrapheneOS, /e/OS o dispositivos Huawei), instale el APK oficial desde GitHub Releases:

1. En su dispositivo Android, abra este enlace:
   [https://github.com/OneUptime/oneuptime/releases/latest/download/oneuptime-on-call-android-app.apk](https://github.com/OneUptime/oneuptime/releases/latest/download/oneuptime-on-call-android-app.apk)
2. Cuando se le solicite, permita que su navegador instale aplicaciones desconocidas:
   **Ajustes → Aplicaciones → \[Su navegador\] → Instalar aplicaciones desconocidas → Permitir desde esta fuente**.
3. Abra el APK descargado y toque **Instalar**.
4. Inicie **OneUptime On-Call** desde el cajón de aplicaciones.

El APK lo crea y firma OneUptime a partir del mismo código fuente que la versión de Play Store. Las actualizaciones de la aplicación no son automáticas al instalar manualmente — descargue el APK más reciente desde el enlace anterior cuando se publique una nueva versión.

## Primer inicio e inicio de sesión

1. **URL del servidor**
   - Si usa OneUptime Cloud, deje el valor predeterminado `https://oneuptime.com`.
   - Si está autoalojando, introduzca la URL de su instancia de OneUptime (p. ej., `https://oneuptime.example.com`).
   - La aplicación verifica que el servidor sea accesible antes de continuar.
2. **Iniciar sesión**
   - Introduzca el correo electrónico y la contraseña de su cuenta de OneUptime.
   - Opcionalmente, habilite el **desbloqueo biométrico** (huella dactilar) para desbloqueos más rápidos en los siguientes inicios.
3. **Permitir notificaciones**
   - Cuando se le solicite, toque **Permitir** para que la aplicación pueda entregar avisos de guardia, alertas de incidentes y confirmaciones.

## Notificaciones push

Las notificaciones push se entregan a través de Firebase Cloud Messaging (FCM) mediante Expo Push. Para asegurarse de que los avisos le lleguen de forma fiable mientras está de guardia:

1. Abra **Ajustes → Aplicaciones → OneUptime On-Call → Notificaciones** y confirme que todas las categorías estén habilitadas.
2. Abra **Ajustes → Aplicaciones → OneUptime On-Call → Batería** y elija **Sin restricciones** (o desactive la optimización de batería) para que el sistema operativo no retrase las notificaciones push en segundo plano.
3. Permita que la aplicación se ejecute en segundo plano y deshabilite cualquier restricción del "Ahorro de datos" para la misma.
4. Si usa dispositivos Samsung, desactive también **Ajustes → Mantenimiento del dispositivo → Batería → Límites de uso en segundo plano** para OneUptime On-Call.
5. Añada OneUptime On-Call a las listas de excepciones de **Do Not Disturb** (No molestar) para que los avisos sigan sonando durante su turno de guardia.

## Actualizaciones

**Google Play:**

- Las actualizaciones se instalan automáticamente. Para activar una manualmente, abra **Play Store → Perfil → Administrar apps y dispositivo → Actualizaciones disponibles → OneUptime On-Call → Actualizar**.

**Instalación manual del APK:**

- Vuelva a descargar el APK más reciente desde el enlace de GitHub Releases anterior e instálelo sobre la aplicación existente — sus datos, URL del servidor e inicio de sesión se conservan.

## Desinstalación

1. **Mantenga pulsado** el icono de **OneUptime On-Call** y, a continuación, toque **Desinstalar**.
2. O abra **Ajustes → Aplicaciones → OneUptime On-Call → Desinstalar**.
3. Confirme para eliminar la aplicación.

Su cuenta de OneUptime y sus turnos de guardia se almacenan en el servidor y no se eliminan al desinstalar la aplicación.

## Solución de problemas

**"Error de red" al iniciar sesión:**

- Verifique que la **URL del servidor** sea correcta y accesible desde su dispositivo.
- Si está en una red corporativa o VPN, asegúrese de que la instancia de OneUptime sea accesible.
- Confirme que el servidor se sirva a través de HTTPS con un certificado válido.

**No se reciben notificaciones push:**

- Confirme que las notificaciones estén habilitadas en **Ajustes → Aplicaciones → OneUptime On-Call → Notificaciones**.
- Deshabilite la optimización de batería para OneUptime On-Call (consulte Notificaciones push arriba).
- Asegúrese de que Do Not Disturb esté desactivado, o de que OneUptime On-Call esté en la lista de excepciones.
- Cierre sesión y vuelva a iniciarla para actualizar el token push registrado con el servidor.
- Usuarios autoalojados: confirme que las notificaciones push estén configuradas en su instancia de OneUptime (consulte la guía de [Notificaciones push](/docs/self-hosted/push-notifications) para instalaciones autoalojadas).

**El desbloqueo biométrico no funciona:**

- Registre una huella dactilar en **Ajustes → Seguridad → Huella dactilar**.
- Vuelva a habilitar el desbloqueo biométrico desde la pantalla **Configuración** dentro de la aplicación OneUptime On-Call.

**Instalación del APK bloqueada:**

- Debe conceder al navegador permiso para instalar aplicaciones desconocidas (consulte la Opción 2 anterior).
- Algunas operadoras o perfiles de dispositivos empresariales bloquean por completo la instalación manual; en ese caso, utilice la versión de Google Play.

**La aplicación se bloquea al iniciar:**

- Actualice a la última versión desde Google Play o al último APK.
- Reinicie su dispositivo.
- Si el problema persiste, desinstale y reinstale, y vuelva a iniciar sesión.

## Soporte

Si aún necesita ayuda, póngase en contacto a través de su panel de OneUptime o abra un issue en nuestro [repositorio de GitHub](https://github.com/OneUptime/oneuptime).
