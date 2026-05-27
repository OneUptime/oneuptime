# Preguntas frecuentes y solución de problemas

Preguntas frecuentes y soluciones para las aplicaciones móviles y de escritorio de OneUptime.

## ¿Cómo distribuye OneUptime sus aplicaciones?

- **Móvil (iOS y Android):** OneUptime ofrece una aplicación nativa llamada **OneUptime On-Call**. Está publicada en la [Apple App Store](https://apps.apple.com/us/app/oneuptime-on-call/id6759615391) y en [Google Play](https://play.google.com/store/apps/details?id=com.oneuptime.oncall). También está disponible una [descarga del APK firmado](https://github.com/OneUptime/oneuptime/releases/latest/download/oneuptime-on-call-android-app.apk) para dispositivos Android sin Google Play.
- **Escritorio (Windows, macOS, Linux):** El panel web de OneUptime es una Progressive Web App (PWA). Puede instalarlo como una aplicación de escritorio directamente desde un navegador basado en Chromium o desde Safari — no se requiere cuenta de tienda.

## Preguntas frecuentes sobre la aplicación móvil

### ¿Qué dispositivos son compatibles?

- **iOS:** iPhone o iPad con iOS 15.0 o posterior.
- **Android:** Teléfonos y tabletas con Android 8.0 (Oreo) o posterior.

### ¿La aplicación es gratuita?

Sí. La aplicación OneUptime On-Call es gratuita de instalar. Inicie sesión con su cuenta existente de OneUptime.

### ¿Puedo usar la aplicación con una instancia autoalojada de OneUptime?

Sí. En el primer inicio, la aplicación le pide una **URL del servidor**. Introduzca la URL de su instancia autoalojada (por ejemplo, `https://oneuptime.example.com`). La aplicación valida que el servidor sea accesible antes de permitirle iniciar sesión.

Para las notificaciones push en instancias autoalojadas, siga la guía de [Notificaciones push](/docs/self-hosted/push-notifications).

### ¿Cómo se entregan las actualizaciones?

- **iOS:** A través de la App Store. Habilite las actualizaciones automáticas en **Ajustes → App Store**, o actualice manualmente desde su perfil de la App Store.
- **Android (Google Play):** Las actualizaciones automáticas están habilitadas de forma predeterminada.
- **Android (instalación manual de APK):** Descargue e instale el APK más reciente desde el enlace de GitHub Releases mencionado anteriormente.

### ¿Por qué no recibo notificaciones push?

Las notificaciones push móviles utilizan APNs (iOS) y FCM (Android) mediante Expo Push. Compruebe lo siguiente:

1. Las notificaciones están habilitadas a nivel del sistema operativo para **OneUptime On-Call**.
2. La optimización de batería está deshabilitada y se permite la actividad en segundo plano (Android).
3. Los modos Do Not Disturb o Concentración están desactivados, o la aplicación está en la lista de excepciones.
4. Ha iniciado sesión — el token push solo se registra con el servidor después de iniciar sesión.
5. **Solo autoalojado:** Las notificaciones push están configuradas en su instancia de OneUptime. Consulte la guía de [Notificaciones push](/docs/self-hosted/push-notifications).

### ¿Están seguros los datos en mi teléfono?

- Todo el tráfico de la API utiliza HTTPS.
- Los tokens de acceso y de actualización se almacenan en el almacén de claves seguro del dispositivo (Keychain en iOS, Keystore en Android).
- Puede requerir desbloqueo con Face ID / Touch ID / huella dactilar desde la pantalla de **Configuración** dentro de la aplicación.

### ¿Puedo instalar la aplicación en varios dispositivos?

Sí. Inicie sesión con la misma cuenta de OneUptime en tantos dispositivos como necesite. Cada dispositivo recibe sus propias notificaciones push.

### ¿Cómo desinstalo?

- **iOS:** Mantenga pulsado el icono → **Eliminar app** → **Eliminar app**.
- **Android:** Mantenga pulsado el icono → **Desinstalar**, o **Ajustes → Aplicaciones → OneUptime On-Call → Desinstalar**.

Su cuenta de OneUptime y sus datos se almacenan en el servidor y no se eliminan al desinstalar la aplicación.

## Preguntas frecuentes sobre la aplicación de escritorio (PWA)

### ¿Qué es una Progressive Web App (PWA)?

Una Progressive Web App es una aplicación web que puede instalarse como una aplicación de escritorio nativa. Una vez instalada, se ejecuta en su propia ventana, tiene su propio icono en el lanzador y puede entregar notificaciones de escritorio — sin pasar por Windows Store, Mac App Store ni ningún otro canal de distribución.

### ¿Por qué la aplicación de escritorio utiliza tecnología PWA?

- **Actualizaciones instantáneas** — la aplicación se mantiene sincronizada con su instancia de OneUptime en el momento en que se despliega.
- **No se requiere cuenta de tienda** — instálela directamente desde cualquier navegador moderno.
- **Una sola base de código** — el mismo panel se ejecuta en Windows, macOS y Linux.

### ¿Por qué no aparece el botón "Instalar"?

1. Use un navegador basado en Chromium (Chrome, Edge, Brave, Arc) o Safari (macOS Sonoma o posterior).
2. Confirme que su instancia de OneUptime se sirva a través de HTTPS con un certificado válido.
3. Borre la caché del navegador y recargue.
4. Es posible que la aplicación ya esté instalada — compruebe sus Aplicaciones / Menú Inicio.

### ¿Cómo actualizo la aplicación de escritorio?

La PWA se actualiza automáticamente cada vez que la abre estando en línea. Para forzar una actualización, recargue la ventana con **Ctrl+R** (Windows/Linux) o **Cmd+R** (macOS).

### ¿Cómo desinstalo la PWA de escritorio?

- **Windows:** **Configuración → Aplicaciones → OneUptime → Desinstalar**, o haga clic derecho en la entrada del menú Inicio.
- **macOS:** Arrastre la aplicación desde **Aplicaciones** a la Papelera, o haga clic derecho en el icono del Dock y elija **Eliminar**.
- **Linux:** Use la opción de desinstalación del lanzador de aplicaciones, o elimine el archivo `.desktop` correspondiente.

## Solución de problemas

### Problemas con la aplicación móvil

**La aplicación no inicia sesión / "Error de red":**
- Confirme que la **URL del servidor** sea correcta y accesible desde su teléfono.
- Compruebe que su teléfono esté conectado a Internet.
- Para instancias autoalojadas detrás de una VPN, asegúrese de que la VPN esté activa.

**Notificaciones push retrasadas o ausentes (Android):**
- Deshabilite la optimización de batería: **Ajustes → Aplicaciones → OneUptime On-Call → Batería → Sin restricciones**.
- Deshabilite el Ahorro de datos para la aplicación.
- En dispositivos Samsung, desactive **Mantenimiento del dispositivo → Batería → Límites de uso en segundo plano** para OneUptime On-Call.

**Notificaciones push retrasadas o ausentes (iOS):**
- Evite forzar el cierre de la aplicación — iOS puede pausar la entrega en segundo plano.
- Desactive el Modo de bajo consumo mientras esté de guardia.
- Añada OneUptime On-Call a la lista de permitidos de cualquier modo de Concentración activo.

**Face ID / Touch ID / huella dactilar no funcionan:**
- Asegúrese de tener datos biométricos registrados en la configuración del sistema operativo.
- Vuelva a habilitar el desbloqueo biométrico desde la pantalla **Configuración** dentro de la aplicación OneUptime On-Call.

### Problemas con la aplicación de escritorio (PWA)

**Falta el botón de instalación:**
- Use un navegador compatible (basado en Chromium o Safari en macOS Sonoma o posterior).
- Asegúrese de que la instancia de OneUptime se sirva a través de HTTPS.
- Espere a que la página termine de cargar y, a continuación, compruebe la barra de direcciones en busca del icono de instalación.

**No aparecen las notificaciones de escritorio:**
- Permita las notificaciones cuando el navegador se lo solicite.
- Compruebe la configuración de notificaciones del sistema operativo (Asistente de concentración de Windows, Notificaciones de macOS, demonio de notificaciones de Linux).
- Para instancias autoalojadas, asegúrese de que la configuración de [Notificaciones push](/docs/self-hosted/push-notifications) esté completa.

**La aplicación no muestra los datos más recientes:**
- Actualice con **Ctrl+R** / **Cmd+R**.
- Cierre y vuelva a abrir la ventana.
- Compruebe su conexión de red.

## Soporte

Si aún necesita ayuda:

- Móvil: consulte las guías de instalación para [iOS](./ios-installation.md) o [Android](./android-installation.md).
- Escritorio: consulte las guías de instalación para [Windows](./windows-installation.md), [macOS](./macos-installation.md) o [Linux](./linux-installation.md).
- Abra un issue en el [repositorio de OneUptime en GitHub](https://github.com/OneUptime/oneuptime).
- Contacte con soporte a través de su panel de OneUptime.
