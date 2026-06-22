# Secretos de monitor

Puedes usar secretos para almacenar información sensible que deseas usar en tus verificaciones de monitoreo. Los secretos están cifrados y almacenados de forma segura.

### Agregar un secreto

Para agregar un secreto, ve al Panel de OneUptime → Configuración del proyecto → Secretos de monitor → Crear secreto de monitor.

![Crear secreto](/docs/static/images/CreateMonitorSecret.png)

Puedes seleccionar qué monitores tienen acceso al secreto. En este caso agregamos el secreto `ApiKey` y seleccionamos los monitores que tendrán acceso a él.

**Ten en cuenta**: Los secretos están cifrados y almacenados de forma segura. Si pierdes el secreto, deberás crear uno nuevo. No puedes ver ni actualizar el secreto después de guardarlo.

### Usar un secreto

Puedes usar secretos en los siguientes tipos de monitoreo:

- API (en encabezados de solicitud, cuerpo de solicitud y URL)
- Sitio web, IP, Puerto, Ping, Certificado SSL (en URL)
- Monitor sintético, Monitor de código personalizado (en el código)
- Monitor SNMP (en la cadena de comunidad, clave de autenticación SNMPv3 y clave de privacidad)

![Usar secreto](/docs/static/images/UsingMonitorSecret.png)

Para usar un secreto, agrega `{{monitorSecrets.SECRET_NAME}}` en el campo donde deseas usar el secreto. Por ejemplo, en este caso agregamos `{{monitorSecrets.ApiKey}}` en el campo de encabezado de solicitud.

Los secretos se inyectan en la sonda antes de que se ejecuten los scripts del monitor Sintético o de Código personalizado, por lo que las referencias como `{{monitorSecrets.ApiKey}}` se resuelven al valor descifrado dentro del script en ejecución.

### Permisos de secretos de monitor

Puedes seleccionar qué monitores tienen acceso al secreto. También puedes actualizar los permisos en cualquier momento. Por lo tanto, si deseas agregar un nuevo monitor para que tenga acceso al secreto, puedes hacerlo actualizando los permisos.
