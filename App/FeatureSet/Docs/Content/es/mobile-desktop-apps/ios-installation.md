# Guía de instalación para iOS

Instale la aplicación nativa de iOS **OneUptime On-Call** desde la Apple App Store en su iPhone o iPad.

## Requisitos

- iPhone o iPad con **iOS 15.0 o posterior**
- Una cuenta activa de OneUptime (o la URL de su instancia autoalojada de OneUptime)
- Conexión a Internet para iniciar sesión y recibir notificaciones push

## Instalación desde la App Store

1. **Abra la App Store** en su iPhone o iPad.
2. Toque la pestaña **Buscar** y busque **"OneUptime On-Call"**, o abra este enlace desde su dispositivo:
   [https://apps.apple.com/us/app/oneuptime-on-call/id6759615391](https://apps.apple.com/us/app/oneuptime-on-call/id6759615391)
3. Toque **Obtener** y, a continuación, autentíquese con Face ID, Touch ID o la contraseña de su Apple ID.
4. Una vez instalada, toque **Abrir** o inicie **OneUptime On-Call** desde su pantalla de inicio.

## Primer inicio e inicio de sesión

1. **URL del servidor**
   - Si usa OneUptime Cloud, deje el valor predeterminado `https://oneuptime.com`.
   - Si está autoalojando, introduzca la URL de su instancia de OneUptime (p. ej., `https://oneuptime.example.com`).
   - La aplicación verifica que el servidor sea accesible antes de continuar.
2. **Iniciar sesión**
   - Introduzca el correo electrónico y la contraseña de su cuenta de OneUptime.
   - Opcionalmente, habilite **Face ID** o **Touch ID** para desbloqueos más rápidos en los siguientes inicios.
3. **Permitir notificaciones**
   - Cuando se le solicite, toque **Permitir** para que la aplicación pueda entregar avisos de guardia, alertas de incidentes y confirmaciones.

## Notificaciones push

Las notificaciones push se entregan a través del servicio Apple Push Notification (APNs) mediante Expo Push. Para asegurarse de que los avisos le lleguen de forma fiable:

1. Vaya a **Ajustes → Notificaciones → OneUptime On-Call**.
2. Habilite **Permitir notificaciones**, **Sonidos**, **Globos** y la entrega en **Pantalla bloqueada / Banner / Centro de notificaciones**.
3. Configure **Agrupación de notificaciones** en **Automática**.
4. Si está de guardia, desactive el **Modo de bajo consumo** durante su turno y evite forzar el cierre de la aplicación — iOS puede retrasar la entrega en segundo plano si se fuerza el cierre.
5. Añada **OneUptime On-Call** a cualquier modo de **Concentración** en el que aún desee recibir avisos.

## Actualizaciones

La aplicación se actualiza a través de la App Store:

- Abra la **App Store**, toque su foto de perfil, desplácese hasta **OneUptime On-Call** y toque **Actualizar**.
- O habilite **Ajustes → App Store → Actualizaciones de apps** para instalar las actualizaciones automáticamente.

## Desinstalación

1. **Mantenga pulsado** el icono de **OneUptime On-Call** en su pantalla de inicio.
2. Toque **Eliminar app → Eliminar app**.
3. Confirme tocando **Eliminar**.

Su cuenta de OneUptime y sus turnos de guardia se almacenan en el servidor y no se eliminan al desinstalar la aplicación.

## Solución de problemas

**La App Store indica que la aplicación "No está disponible en su región":**
- La aplicación se publica en la App Store global. Si no aparece en su región, contacte con [soporte](mailto:support@oneuptime.com).

**"Error de red" al iniciar sesión:**
- Verifique que la **URL del servidor** sea correcta y accesible desde su dispositivo.
- Si está en una red corporativa o VPN, asegúrese de que la instancia de OneUptime sea accesible.
- Confirme que el servidor se sirva a través de HTTPS con un certificado válido.

**No se reciben notificaciones push:**
- Abra **Ajustes → Notificaciones → OneUptime On-Call** y confirme que las notificaciones estén permitidas.
- Desactive **No molestar** o añada OneUptime On-Call a la lista de permitidos de su modo de Concentración activo.
- Cierre sesión y vuelva a iniciarla para actualizar el token push registrado con el servidor.
- Usuarios autoalojados: confirme que las notificaciones push estén configuradas en su instancia de OneUptime (consulte la guía de [Notificaciones push](/docs/self-hosted/push-notifications) para instalaciones autoalojadas).

**Face ID / Touch ID no funcionan:**
- Asegúrese de tener datos biométricos registrados en **Ajustes → Face ID y código** o **Ajustes → Touch ID y código**.
- Vuelva a habilitar el desbloqueo biométrico desde la pantalla **Configuración** dentro de la aplicación OneUptime On-Call.

**La aplicación se bloquea al iniciar:**
- Actualice a la última versión desde la App Store.
- Reinicie su dispositivo.
- Si el problema persiste, elimine y reinstale la aplicación, y vuelva a iniciar sesión.

## Soporte

Si aún necesita ayuda, póngase en contacto a través de su panel de OneUptime o abra un issue en nuestro [repositorio de GitHub](https://github.com/OneUptime/oneuptime).
