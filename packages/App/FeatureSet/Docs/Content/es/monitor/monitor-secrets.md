# Secretos de monitor

Puedes usar secretos para almacenar información sensible que deseas usar en tus verificaciones de monitoreo. Los secretos están cifrados y almacenados de forma segura.

### Agregar un secreto

Para agregar un secreto, ve al Panel de OneUptime → Monitores → Ajustes → Secretos → Crear secreto de monitor.

![Crear secreto](/docs/static/images/CreateMonitorSecret.png)

Asigne un nombre y un valor al secreto y, después, elija en el paso **Acceso** qué monitores pueden usarlo. En este caso añadimos un secreto `ApiKey`.

**Ten en cuenta**: Los secretos están cifrados y almacenados de forma segura. El valor nunca se vuelve a mostrar después de guardarlo: ni en la tabla, ni en el formulario de edición, ni a través de la API. Si pierdes el valor, tendrás que obtenerlo de su origen y volver a introducirlo. Para rotar un secreto, usa el botón **Actualizar valor del secreto** de su fila; no hace falta eliminarlo y volver a crearlo.

### Elegir qué monitores pueden usar un secreto

Cada secreto tiene una de estas tres opciones de acceso:

- **Todos los monitores**: todos los monitores del proyecto pueden usar el secreto, incluidos los que cree más adelante. Úsela para una credencial que comparten muchos monitores.
- **Monitores específicos**: solo los monitores que elija pueden usar el secreto. Es la opción predeterminada, y los secretos creados antes de que existieran estas opciones funcionan así.
- **Monitores con etiquetas**: los monitores que tienen al menos una de las etiquetas que elija pueden usar el secreto. Añadir una de esas etiquetas a un monitor le da acceso, y quitar la etiqueta le retira el acceso la próxima vez que se ejecute el monitor.

Puede cambiar la opción en cualquier momento con **Editar** en la fila del secreto. Solo se conserva la lista de la opción elegida: cambiar a **Todos los monitores** vacía las listas de monitores y de etiquetas del secreto, y cambiar entre **Monitores específicos** y **Monitores con etiquetas** vacía la lista que deja.

Un secreto nunca está disponible para los monitores de otro proyecto.

Cualquiera que pueda editar un monitor con acceso a un secreto puede enviar ese secreto a cualquier destino al que se conecte el monitor. Con **Todos los monitores**, eso incluye a cualquiera que pueda crear o editar monitores en el proyecto. Con **Monitores con etiquetas**, también incluye a cualquiera que pueda añadir una de esas etiquetas a un monitor.

En la API, la opción de acceso es el campo `monitorAccess`: `All Monitors`, `Specific Monitors` o `Monitors With Labels`. Los campos `monitors` y `labels` contienen las listas. Un secreto creado sin `monitorAccess` recibe `Specific Monitors`.

### Usar un secreto

Puedes usar secretos en los siguientes tipos de monitoreo:

- API (en encabezados de solicitud, cuerpo de solicitud y URL)
- Sitio web, IP, Puerto, Ping, Certificado SSL (en URL)
- Monitor sintético, Monitor de código personalizado (en el código)
- Monitor SNMP (en la cadena de comunidad, clave de autenticación SNMPv3 y clave de privacidad)

![Usar secreto](/docs/static/images/UsingMonitorSecret.png)

Para usar un secreto, agrega `{{monitorSecrets.SECRET_NAME}}` en el campo donde deseas usar el secreto. Por ejemplo, en este caso agregamos `{{monitorSecrets.ApiKey}}` en el campo de encabezado de solicitud.

Los secretos se inyectan en la sonda antes de que se ejecuten los scripts del monitor Sintético o de Código personalizado, por lo que las referencias como `{{monitorSecrets.ApiKey}}` se resuelven al valor descifrado dentro del script en ejecución.

Si un monitor hace referencia a un secreto que no puede usar, la referencia se deja tal cual y no se sustituye por el valor.

Cuando prueba un monitor antes de guardarlo, solo se rellenan los secretos disponibles para **Todos los monitores**, porque un monitor nuevo no está en ninguna lista y aún no tiene etiquetas. Después de guardar el monitor, las pruebas usan todos los secretos a los que tiene acceso.
