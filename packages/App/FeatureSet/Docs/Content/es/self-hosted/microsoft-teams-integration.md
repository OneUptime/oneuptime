# Integración con Microsoft Teams

Para integrar Microsoft Teams con tu instancia auto-alojada de OneUptime, necesitas configurar el registro de aplicaciones de Azure y establecer las variables de entorno requeridas.

## Prerrequisitos

- Cuenta de Azure: puedes crear una en [https://azure.com](https://azure.com)
- Acceso a la configuración de tu servidor de OneUptime

## Acceso de red

OneUptime utiliza un Azure Bot para su integración con Teams. Una URL de Incoming Webhook o Teams Workflow no sustituye al punto de conexión de mensajería de este bot. Microsoft requiere un [punto de conexión HTTPS accesible públicamente para un bot autoalojado](https://learn.microsoft.com/en-us/azure/bot-service/bot-service-resources-faq-security?view=azure-bot-service-4.0). Una dirección IP privada, un nombre DNS interno o la conexión VPN de un empleado no dan a Azure Bot Service acceso a OneUptime.

| Función | De OneUptime al proveedor | Del proveedor a OneUptime |
| --- | --- | --- |
| Notificaciones de Teams | HTTPS a las API de Microsoft | Necesario para la integración completa del bot, incluido el descubrimiento de conversaciones |
| Comandos de Teams, botones de tarjetas, eventos de instalación en chats | HTTPS | `POST /api/microsoft-bot/messages` |

Las redirecciones del registro de aplicación `/api/microsoft-teams/auth` y `/api/microsoft-teams/admin-consent/callback` regresan por el navegador del usuario. Ese navegador debe poder acceder a OneUptime, por ejemplo mediante su red corporativa o VPN. Los mensajes del bot y las acciones de las tarjetas llegan desde los servidores de Microsoft y necesitan su propio ingress accesible. La entrega de alertas salientes por sí sola no verifica la conectividad entrante.

### Producción: publique una pasarela hacia el despliegue privado

1. **Elija un nombre de host**, por ejemplo `oneuptime.example.com`. Publique registros DNS públicos que apunten a una pasarela accesible desde Internet. Los proveedores no pueden acceder a direcciones IP privadas ni a nombres DNS exclusivamente internos. Con DNS dividido, los empleados pueden resolver el mismo nombre de host hacia el ingress privado y seguir usando el panel a través de la VPN. El ingress privado también debe ofrecer HTTPS con un certificado válido para ese nombre de host.

2. **Conecte la pasarela a OneUptime.** Sitúela en una DMZ con una ruta al ingress privado, o utilice una pasarela pública conectada mediante su propia VPN de sitio a sitio o enlace privado. Permita el tráfico de la pasarela al ingress en el puerto del servicio de destino. Para Kubernetes/Portainer, un servicio privado `ClusterIP` por sí solo no basta: la pasarela necesita un ingress/controlador u otro destino accesible. Mantenga privadas las bases de datos y los demás servicios internos.

3. **Termine HTTPS en el puerto 443** con un certificado de confianza pública y una cadena intermedia completa. Permita TCP entrante al puerto 443 de la pasarela. Instalar un certificado o cambiar DNS por sí solo no crea la ruta al destino privado.

4. Publique solo `/api/microsoft-bot/messages` y establezca esta URL HTTPS pública completa como punto de conexión de mensajería de Azure Bot en el paso 4. El adaptador Bot Framework de OneUptime debe recibir y autenticar las solicitudes. Conserve el método, la ruta, la cadena de consulta, el cuerpo y los encabezados de autenticación (`Authorization`). Mantenga el `Host` público y establezca encabezados de confianza `X-Forwarded-Host` y `X-Forwarded-Proto: https`. No añada redirecciones.

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

   Sustituya el ejemplo por su dominio. Estos ajustes generan URL; no crean DNS, TLS ni reglas de cortafuegos. Aplique la configuración de Compose o la actualización de Helm y espere a que la aplicación se reinicie. Si cambia el nombre de host, actualice el punto de conexión de Azure Bot y las URI de redirección del registro de aplicación; vuelva a descargar y cargar el manifiesto de Teams.

Los [ajustes de acceso a redes privadas](/docs/self-hosted/private-network-access) controlan las solicitudes salientes de OneUptime a servicios internos. Activar `ALLOW_PRIVATE_NETWORK_WEBHOOKS` no hace que OneUptime sea accesible para Teams.

### Acceso saliente y restricciones de IP

Permita la resolución DNS y HTTPS (TCP 443) saliente desde la aplicación OneUptime. Teams utiliza `graph.microsoft.com`, `login.microsoftonline.com`, puntos de conexión de autenticación y canales de Bot Framework, y la URL del servicio conector de la conversación. Utilice las [recomendaciones de cortafuegos de Microsoft](https://learn.microsoft.com/en-us/azure/bot-service/bot-service-resources-faq-security?view=azure-bot-service-4.0) e inspeccione el tráfico bloqueado durante las pruebas; estos ejemplos no son una lista exhaustiva de dominios. El conector de respaldo de la nube comercial es `https://smba.trafficmanager.net/teams/`; la URL de servicio de una conversación puede ser diferente.

Microsoft no admite listas fijas de IP entrantes de Bot Framework porque las direcciones cambian. Los rangos multimedia del cliente Teams no son los orígenes de webhooks del bot. Mantenga activa la autenticación de Bot Framework.

### Pruebas y despliegues sin acceso entrante

Desde una red fuera de su VPN, verifique DNS público y TLS y después compruebe la ruta de Teams:

```bash
curl -sS -i https://oneuptime.example.com/api/microsoft-bot/messages
```

En las versiones actuales de OneUptime, espere `405 Method Not Allowed` con `Allow: POST`. Esto confirma que la solicitud GET llegó a la ruta, no que vaya a funcionar una solicitud POST autenticada del bot. Las versiones anteriores pueden devolver el error JSON 404 de OneUptime; examine el cuerpo de la respuesta y los registros del proxy. Los errores TLS, los tiempos de espera agotados o una página de error HTML del proxy indican problemas de certificado o enrutamiento.

Conecte Teams, envíe una notificación de prueba, escriba al bot y pulse un botón de tarjeta. Confirme la acción en OneUptime y compare los diagnósticos de Microsoft con los registros de la pasarela y la aplicación. Una notificación recibida no verifica un POST entrante autenticado.

Para desarrollo, la [guía de pruebas de Teams de Microsoft](https://learn.microsoft.com/en-us/microsoftteams/platform/bots/how-to/authentication/add-authentication#testing-the-bot-locally-in-teams) describe cómo exponer un servicio local con un túnel. Reenvíe al ingress de OneUptime y utilice `/api/microsoft-bot/messages`, sustituyendo la ruta de ejemplo de Microsoft `/api/messages`. Actualice el punto de conexión de Azure Bot cada vez que cambie la URL pública del túnel y use un ingress estable en producción. Configure también el nombre de host correspondiente en OneUptime. Detenga el túnel después de las pruebas; sigue exponiendo acceso entrante.

Si se prohíbe toda conectividad entrante, la integración completa de Teams no funciona: los comandos, las acciones de tarjetas y el descubrimiento de conversaciones la necesitan. Una instalación completamente desconectada no puede usar Teams.

Azure Bot Private Endpoint no sustituye a este ingress de Teams. Las [instrucciones de aislamiento de red de Microsoft](https://learn.microsoft.com/en-us/azure/bot-service/dl-network-isolation-how-to?view=azure-bot-service-4.0) describen el aislamiento de Direct Line e indican que desactivar el acceso a la red pública elimina la configuración de los canales de Teams.

## Instrucciones de configuración

### Paso 1: Crear el registro de aplicaciones de Azure

1. Ve al [Portal de Azure](https://portal.azure.com)
2. Navega a "Registros de aplicaciones" y haz clic en "Nuevo registro"
3. Completa el formulario de registro:
   - **Nombre:** oneuptime
   - **Tipos de cuenta admitidos:** Cuentas en cualquier directorio organizacional (Cualquier inquilino de Microsoft Entra ID: multiinquilino)
   - **URI de redirección:** Web - `https://your-oneuptime-domain.com/api/microsoft-teams/auth`
   - Por favor, también agrega: `https://your-oneuptime-domain.com/api/microsoft-teams/admin-consent/callback`
4. Haz clic en "Registrar"
5. Anota el "ID de aplicación (cliente)": lo necesitarás más adelante

### Paso 2: Configurar los permisos de la aplicación

1. En el registro de tu aplicación, ve a "Permisos de API"
2. Haz clic en "Agregar un permiso" y selecciona "Microsoft Graph"

**Agregar permisos delegados** (cuando actúa en nombre de un usuario con sesión iniciada):

- **User.Read**: Requerido para obtener la información de perfil del usuario autenticado (nombre para mostrar, correo electrónico) durante el flujo OAuth
- **Team.ReadBasic.All**: Requerido para listar los equipos de los que el usuario es miembro al seleccionar qué equipo conectar
- **Channel.ReadBasic.All**: Requerido para leer la información del canal y listar los canales dentro de los equipos para la entrega de notificaciones
- **ChannelMessage.Send**: Requerido para enviar notificaciones de alertas e incidentes a los canales de Teams

**Agregar permisos de aplicación** (cuando actúa como la propia aplicación, sin un usuario con sesión iniciada):

- **Team.ReadBasic.All**: Requerido para listar todos los equipos de la organización después de que se conceda el consentimiento de administrador
- **Channel.ReadBasic.All**: Requerido para verificar la existencia del canal y recuperar los detalles del canal

`ChannelMessage.Send` es únicamente un permiso delegado; no tiene una variante de permiso de aplicación en la [referencia de permisos de Microsoft Graph](https://learn.microsoft.com/en-us/graph/permissions-reference#channelmessagesend). Manténgalo en la lista de permisos delegados anterior.

**Nota:** El framework de Bot maneja la entrega de mensajes usando permisos de Consentimiento específico del recurso (RSC) definidos en el manifiesto de la aplicación de Teams. Estos permisos son:

- **ChannelMessage.Send.Group**: Permite que el bot envíe mensajes a los canales del equipo
- **ChannelMessage.Read.Group**: Permite que el bot lea mensajes del canal para comandos interactivos
- **Channel.Create.Group**: Permite que el bot cree canales cuando sea necesario

3. Haz clic en "Conceder consentimiento de administrador" para tu organización

### Paso 3: Crear el secreto de cliente

1. Ve a "Certificados y secretos" en el registro de tu aplicación
2. Haz clic en "Nuevo secreto de cliente"
3. Agrega una descripción y establece el vencimiento (recomendamos 24 meses)
4. Haz clic en "Agregar" y copia el valor del secreto inmediatamente; no podrás verlo de nuevo

**Importante:** No copies el ID del secreto; necesitas el VALOR del secreto, que es típicamente más largo e incluye más caracteres.

### Paso 4: Crear un servicio de bot

1. En el Portal de Azure, navega a "Azure Bot" y haz clic en "Crear"
2. Completa el formulario de creación del bot:

   - **Nombre del bot:** oneuptime-bot
   - **Suscripción:** Tu suscripción de Azure
   - **Grupo de recursos:** Crea uno nuevo o usa uno existente
   - **Ubicación:** Elige una ubicación cercana a tus usuarios
   - **Nivel de precios:** F0 (Gratis) es suficiente para pruebas
   - Por favor, usa el ID de aplicación (cliente) y el ID de inquilino del registro de aplicación creado anteriormente

3. Haz clic en "Revisar + crear" y luego en "Crear"

4. Una vez implementado, ve a tu recurso de bot y navega a "Configuración"
5. Establece el "Punto de conexión de mensajería" en `https://your-oneuptime-domain.com/api/microsoft-bot/messages`
6. Guarda la configuración

### Paso 5: Agregar el canal de Microsoft Teams al bot

1. En tu recurso de Azure Bot, navega a "Canales"
2. Busca y selecciona "Microsoft Teams" y haz clic en "Abrir" o "Agregar"
3. Revisa la configuración (habilita para Teams, mantén las opciones de mensajería predeterminadas a menos que tengas necesidades específicas)
4. Haz clic en "Guardar" (y "Listo"/"Publicar" si se solicita) para habilitar el canal de Teams

### Paso 6: Configurar las variables de entorno de OneUptime

#### Docker Compose

Si usas Docker Compose, agrega estas variables de entorno a tu configuración:

```bash
MICROSOFT_TEAMS_APP_CLIENT_ID=YOUR_TEAMS_APP_CLIENT_ID
MICROSOFT_TEAMS_APP_CLIENT_SECRET=YOUR_TEAMS_APP_CLIENT_SECRET
MICROSOFT_TEAMS_APP_TENANT_ID=YOUR_MICROSOFT_TENANT_ID
```

#### Kubernetes con Helm

Si usas Kubernetes con Helm, agrega esto a tu archivo `values.yaml`:

```yaml
microsoftTeamsApp:
  clientId: YOUR_TEAMS_APP_CLIENT_ID
  clientSecret: YOUR_TEAMS_APP_CLIENT_SECRET
  tenantId: YOUR_MICROSOFT_TENANT_ID
```

**Importante:** Reinicia tu servidor de OneUptime después de agregar estas variables de entorno para que surtan efecto.

### Paso 7: Cargar el manifiesto de la aplicación de Teams

1. Ve a **Ajustes del proyecto** > **Espacio de trabajo** > **Microsoft Teams**
2. Descarga el manifiesto de la aplicación de Teams desde allí
3. Ve a Microsoft Teams, haz clic en "Aplicaciones" en la barra lateral
4. En la parte inferior, haz clic en "Administrar tus aplicaciones"
5. Haz clic en "Cargar una aplicación personalizada"
6. Selecciona "Cargar para mí o mis equipos"
7. Carga el archivo zip del manifiesto que descargaste anteriormente

## Solución de problemas

Si encuentras problemas:

- Asegúrate de que tu aplicación tenga los permisos correctos concedidos
- Verifica que el URI de redirección coincida exactamente (reemplaza `your-oneuptime-domain.com` con tu dominio real)
- Verifica que tus variables de entorno estén establecidas correctamente
- Asegúrate de que el punto de conexión de mensajería del bot sea accesible desde internet
- Verifica que el bot esté correctamente configurado con el canal de Teams
- Comprueba que el manifiesto de la aplicación de Teams se haya cargado correctamente

## Soporte

Nos gustaría mejorar esta integración, por lo que los comentarios son bienvenidos. Por favor, envíalos a [hello@oneuptime.com](mailto:hello@oneuptime.com).
