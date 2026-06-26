# Integración con Microsoft Teams

Para integrar Microsoft Teams con tu instancia auto-alojada de OneUptime, necesitas configurar el registro de aplicaciones de Azure y establecer las variables de entorno requeridas.

## Prerrequisitos

- Cuenta de Azure: puedes crear una en [https://azure.com](https://azure.com)
- Acceso a la configuración de tu servidor de OneUptime

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
- **ChannelMessage.Send**: Requerido para enviar mensajes a los canales de forma programática

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

1. Ve a **Configuración** del proyecto > **Integraciones** > **Microsoft Teams**
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
