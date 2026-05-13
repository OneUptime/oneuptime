# SSO (inicio de sesión único)

OneUptime admite el inicio de sesión único (SSO) basado en SAML 2.0 para la autenticación empresarial. SSO permite que los miembros de tu equipo inicien sesión en OneUptime usando las credenciales de la organización, lo que proporciona una gestión de acceso centralizada y mayor seguridad.

## Información general

La integración SSO proporciona los siguientes beneficios:

- **Autenticación centralizada**: Los usuarios inician sesión con sus credenciales corporativas existentes
- **Mayor seguridad**: Aprovecha la autenticación de múltiples factores y las políticas de seguridad de tu IdP
- **Gestión simplificada de usuarios**: Gestiona el acceso desde tu sistema de gestión de identidades existente
- **Reducción de la fatiga de contraseñas**: Los usuarios no necesitan recordar una contraseña separada de OneUptime

## Configuración de SSO

1. **Navegar a la configuración del proyecto**
   - Ve a tu proyecto de OneUptime
   - Navega a **Configuración del proyecto** > **Autenticación** > **SSO**

2. **Crear la configuración SSO**
   - Haz clic en **Crear SSO**
   - Ingresa un **Nombre** para la configuración SSO (por ejemplo, "Keycloak SAML" o "Okta SAML")
   - Ingresa la **URL de inicio de sesión** de tu proveedor de identidad
   - Ingresa el **Emisor** (ID de entidad) de tu proveedor de identidad
   - Pega el **Certificado público** de tu proveedor de identidad
   - Selecciona el **Algoritmo de firma** (por ejemplo, `RSA-SHA-256`)
   - Selecciona el **Algoritmo de resumen** (por ejemplo, `SHA256`)

3. **Obtener los metadatos SSO de OneUptime**
   - Después de guardar, haz clic en el botón **Ver configuración SSO**
   - Copia el **Identificador (ID de entidad)**: es necesario en la configuración de tu IdP
   - Copia la **URL de respuesta (URL del Servicio de consumidor de aserciones)**: es necesaria en la configuración de tu IdP

## Configuración SAML de Keycloak

Keycloak es una popular solución de código abierto para gestión de identidades y accesos. Sigue estos pasos para configurar Keycloak como proveedor de identidad SAML para OneUptime.

### Prerrequisitos

- Una instancia de Keycloak en ejecución con un dominio configurado
- Acceso de administrador tanto a Keycloak como a OneUptime
- Cuenta de OneUptime con soporte SSO

### Paso 1: Configurar SSO en OneUptime

1. Inicia sesión en tu panel de OneUptime
2. Navega a **Configuración del proyecto** > **Autenticación** > **SSO**
3. Haz clic en **Crear SSO** y completa lo siguiente:
   - **Nombre**: Un nombre descriptivo (por ejemplo, `my-project-oneuptime`)
   - **URL de inicio de sesión**: `https://<your-keycloak-domain>/auth/realms/<your-realm>/protocol/saml`
   - **Emisor**: `https://<your-keycloak-domain>/auth/realms/<your-realm>`
   - **Certificado**: Consulta el [Paso 2](#step-2-get-the-keycloak-certificate) a continuación
   - **Algoritmo de firma**: `RSA-SHA-256`
   - **Algoritmo de resumen**: `SHA256`
4. Guarda la configuración

### Paso 2: Obtener el certificado de Keycloak

1. En Keycloak, navega a la configuración de tu cliente
2. Haz clic en **Exportar** (o ve a la pestaña **Claves** según tu versión de Keycloak)
3. En el archivo JSON exportado, encuentra la clave con `certificate` en el nombre
4. Copia el valor del certificado y pégalo en OneUptime en el siguiente formato:

```
-----BEGIN CERTIFICATE-----
MIICnzCCAYcCBgFyPZ8QFzANBgkqhkiG.......
-----END CERTIFICATE-----
```

### Paso 3: Configurar el cliente de Keycloak

1. En Keycloak, navega a **Clientes** en tu dominio
2. Crea un nuevo cliente o edita uno existente
3. Establece el **Protocolo del cliente** en `saml`
4. Establece el **ID de cliente** en el valor del **Identificador (ID de entidad)** de la **Vista de configuración SSO** de OneUptime
5. Establece las **URIs de redirección válidas** en tu URL de OneUptime
6. Establece la **URL raíz** en la URL base de OneUptime
7. Pega la **URL de respuesta (URL del Servicio de consumidor de aserciones)** de OneUptime en el campo **URL de enlace POST del Servicio de consumidor de aserciones**

### Paso 4: Configurar los ajustes del cliente de Keycloak

1. Deshabilita la **Configuración de claves de firma** (en la pestaña Claves)
2. Establece el **Formato del ID de nombre** en `email`
3. Asegúrate de que la opción **Forzar formato de ID de nombre** esté habilitada para que Keycloak siempre envíe el correo electrónico como ID de nombre

### Paso 5: Verificar la configuración

1. Guarda todos los ajustes tanto en Keycloak como en OneUptime
2. Intenta iniciar sesión en OneUptime usando SSO
3. Deberías ser redirigido a la página de inicio de sesión de Keycloak y de vuelta a OneUptime tras la autenticación exitosa

### Solución de problemas con Keycloak

- **Error de firma al iniciar sesión**: Asegúrate de que el certificado se haya copiado correctamente, incluyendo las líneas `BEGIN CERTIFICATE` y `END CERTIFICATE`
- **Error de ID de nombre**: Verifica que el **Formato del ID de nombre** esté establecido en `email` en Keycloak
- **Bucle de redirección**: Comprueba que las **URI de redirección válidas** y la **URL de enlace POST del Servicio de consumidor de aserciones** estén configuradas correctamente
- **Certificado no encontrado**: Asegúrate de estar exportando desde el cliente correcto en el dominio correcto

---

## Configuración SAML de Microsoft Entra ID (anteriormente Azure AD / Active Directory)

Microsoft Entra ID es el servicio de gestión de identidades y accesos en la nube de Microsoft. Sigue estos pasos para configurar Entra ID como proveedor de identidad SAML para OneUptime.

### Prerrequisitos

- Inquilino de Microsoft Entra ID (cualquier nivel que admita aplicaciones empresariales con SSO SAML)
- Acceso de administrador tanto a Microsoft Entra ID como a OneUptime
- Cuenta de OneUptime con soporte SSO

### Paso 1: Configurar SSO en OneUptime

1. Inicia sesión en tu panel de OneUptime
2. Navega a **Configuración del proyecto** > **Autenticación** > **SSO**
3. Haz clic en **Crear SSO** y completa lo siguiente:
   - **Nombre**: Un nombre descriptivo (por ejemplo, `Azure AD SAML`)
   - **URL de inicio de sesión**: La obtendrás de Entra ID en el [Paso 3](#step-3-copy-entra-id-saml-metadata-to-oneuptime)
   - **Emisor**: Lo obtendrás de Entra ID en el [Paso 3](#step-3-copy-entra-id-saml-metadata-to-oneuptime)
   - **Certificado**: Lo obtendrás de Entra ID en el [Paso 3](#step-3-copy-entra-id-saml-metadata-to-oneuptime)
   - **Algoritmo de firma**: `RSA-SHA-256`
   - **Algoritmo de resumen**: `SHA256`
4. Haz clic en **Ver configuración SSO** y copia el **Identificador (ID de entidad)** y la **URL de respuesta (URL del Servicio de consumidor de aserciones)**: los necesitarás para Entra ID

### Paso 2: Crear una aplicación empresarial en Microsoft Entra ID

1. Inicia sesión en el [centro de administración de Microsoft Entra](https://entra.microsoft.com)
2. Navega a **Identidad** > **Aplicaciones** > **Aplicaciones empresariales**
3. Haz clic en **+ Nueva aplicación**
4. Haz clic en **+ Crear tu propia aplicación**
5. Ingresa un nombre (por ejemplo, "OneUptime")
6. Selecciona **Integrar cualquier otra aplicación que no encuentres en la galería (no de galería)**
7. Haz clic en **Crear**

### Paso 3: Configurar SSO SAML en Entra ID

1. En tu nueva aplicación empresarial, ve a **Inicio de sesión único**
2. Selecciona **SAML** como método de inicio de sesión único
3. En **Configuración básica de SAML**, haz clic en **Editar** y establece:
   - **Identificador (ID de entidad)**: Pega el **Identificador (ID de entidad)** de la **Vista de configuración SSO** de OneUptime
   - **URL de respuesta (URL del Servicio de consumidor de aserciones)**: Pega la **URL de respuesta** de la **Vista de configuración SSO** de OneUptime
4. Haz clic en **Guardar**
5. En la sección **Certificados SAML**:
   - Descarga el **Certificado (Base64)**
   - Abre el archivo de certificado descargado en un editor de texto y copia el contenido
6. En la sección **Configurar OneUptime**, copia:
   - **URL de inicio de sesión**: pégala como la **URL de inicio de sesión** en OneUptime
   - **Identificador de Azure AD**: pégalo como el **Emisor** en OneUptime
7. Vuelve a OneUptime y pega el certificado y las URL, luego guarda

### Paso 4: Configurar atributos de usuario y notificaciones

1. En la página de configuración SAML, haz clic en **Editar** en **Atributos y notificaciones**
2. Asegúrate de que las siguientes notificaciones estén configuradas:

| Nombre de la notificación | Valor |
|-----------|-------|
| `Unique User Identifier (Name ID)` | `user.userprincipalname` o `user.mail` |
| `http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress` | `user.mail` |
| `http://schemas.xmlsoap.org/ws/2005/05/identity/claims/givenname` | `user.givenname` |
| `http://schemas.xmlsoap.org/ws/2005/05/identity/claims/surname` | `user.surname` |

3. Establece el **Formato del identificador de nombre** en `Dirección de correo electrónico`
4. Haz clic en **Guardar**

### Paso 5: Asignar usuarios y grupos

1. En tu aplicación empresarial, ve a **Usuarios y grupos**
2. Haz clic en **+ Agregar usuario/grupo**
3. Selecciona los usuarios y/o grupos a los que deseas conceder acceso SSO
4. Haz clic en **Asignar**

### Paso 6: Verificar la configuración

1. Guarda todos los ajustes tanto en Entra ID como en OneUptime
2. Intenta iniciar sesión en OneUptime usando SSO
3. Deberías ser redirigido a la página de inicio de sesión de Microsoft y de vuelta a OneUptime tras la autenticación exitosa

### Solución de problemas con Microsoft Entra ID

- **Error AADSTS700016**: El Identificador (ID de entidad) en Entra ID no coincide con OneUptime: verifica que ambos valores sean idénticos
- **Error de certificado**: Asegúrate de haber descargado el certificado **Base64** (no el formato raw/binario) e incluido las líneas `BEGIN CERTIFICATE` / `END CERTIFICATE`
- **Usuario no asignado**: Los usuarios deben estar asignados explícitamente a la aplicación empresarial antes de poder iniciar sesión mediante SSO
- **Error de ID de nombre**: Asegúrate de que la notificación del ID de nombre esté establecida en una dirección de correo electrónico que coincida con el correo del usuario en OneUptime

---

## Configuración SAML de Okta

Okta es una plataforma de identidad ampliamente utilizada que proporciona sólidas capacidades de SSO SAML. Sigue estos pasos para configurar Okta como proveedor de identidad SAML para OneUptime.

### Prerrequisitos

- Organización de Okta con acceso de administrador
- Cuenta de OneUptime con soporte SSO

### Paso 1: Configurar SSO en OneUptime

1. Inicia sesión en tu panel de OneUptime
2. Navega a **Configuración del proyecto** > **Autenticación** > **SSO**
3. Haz clic en **Crear SSO** y completa lo siguiente:
   - **Nombre**: Un nombre descriptivo (por ejemplo, `Okta SAML`)
   - **URL de inicio de sesión**: La obtendrás de Okta en el [Paso 3](#step-3-copy-okta-saml-metadata-to-oneuptime)
   - **Emisor**: Lo obtendrás de Okta en el [Paso 3](#step-3-copy-okta-saml-metadata-to-oneuptime)
   - **Certificado**: Lo obtendrás de Okta en el [Paso 3](#step-3-copy-okta-saml-metadata-to-oneuptime)
   - **Algoritmo de firma**: `RSA-SHA-256`
   - **Algoritmo de resumen**: `SHA256`
4. Haz clic en **Ver configuración SSO** y copia el **Identificador (ID de entidad)** y la **URL de respuesta (URL del Servicio de consumidor de aserciones)**: los necesitarás para Okta

### Paso 2: Crear una aplicación SAML en Okta

1. Inicia sesión en tu consola de administración de Okta
2. Navega a **Aplicaciones** > **Aplicaciones**
3. Haz clic en **Crear integración de aplicación**
4. Selecciona **SAML 2.0** y haz clic en **Siguiente**
5. Ingresa "OneUptime" como el **Nombre de la aplicación** y haz clic en **Siguiente**
6. En la sección **Configuración de SAML**, configura:
   - **URL de inicio de sesión único**: Pega la **URL de respuesta (URL del Servicio de consumidor de aserciones)** de la **Vista de configuración SSO** de OneUptime
   - **URI de audiencia (ID de entidad del SP)**: Pega el **Identificador (ID de entidad)** de la **Vista de configuración SSO** de OneUptime
   - **Formato del ID de nombre**: Selecciona `EmailAddress`
   - **Nombre de usuario de la aplicación**: Selecciona `Email`
7. Haz clic en **Siguiente**, luego selecciona **Soy un cliente de Okta que agrega una aplicación interna** y haz clic en **Finalizar**

### Paso 3: Copiar los metadatos SAML de Okta a OneUptime

1. En tu aplicación de Okta, ve a la pestaña **Inicio de sesión**
2. En la sección **Certificados de firma SAML**, encuentra el certificado activo y haz clic en **Acciones** > **Ver metadatos del IdP**
3. Desde los metadatos XML o desde los detalles de la pestaña **Inicio de sesión**:
   - Copia la **URL de inicio de sesión** (también llamada **URL de inicio de sesión único del proveedor de identidad**): pégala como la **URL de inicio de sesión** en OneUptime
   - Copia el **Emisor** (también llamado **Emisor del proveedor de identidad**): pégalo como el **Emisor** en OneUptime
4. Descarga el certificado de firma:
   - En la sección **Certificados de firma SAML**, haz clic en **Acciones** > **Descargar certificado** para el certificado activo
   - Abre el archivo `.cert` descargado en un editor de texto y copia el contenido
   - Pega el certificado en OneUptime (incluyendo las líneas `BEGIN CERTIFICATE` y `END CERTIFICATE`)
5. Guarda la configuración SSO de OneUptime

### Paso 4: Configurar declaraciones de atributos (opcional)

1. En la aplicación de Okta, ve a la pestaña **General**
2. Haz clic en **Editar** en la sección **Configuración de SAML** y haz clic en **Siguiente** para llegar a los ajustes SAML
3. En la sección **Declaraciones de atributos**, agrega:

| Nombre | Valor |
|------|-------|
| `email` | `user.email` |
| `firstName` | `user.firstName` |
| `lastName` | `user.lastName` |

4. Haz clic en **Siguiente** y luego en **Finalizar**

### Paso 5: Asignar usuarios y grupos

1. En tu aplicación de Okta, ve a la pestaña **Asignaciones**
2. Haz clic en **Asignar** > **Asignar a personas** o **Asignar a grupos**
3. Selecciona los usuarios o grupos a los que deseas conceder acceso SSO
4. Haz clic en **Asignar** para cada selección, luego haz clic en **Listo**

### Paso 6: Verificar la configuración

1. Guarda todos los ajustes tanto en Okta como en OneUptime
2. Intenta iniciar sesión en OneUptime usando SSO
3. Deberías ser redirigido a la página de inicio de sesión de Okta y de vuelta a OneUptime tras la autenticación exitosa

### Solución de problemas con Okta

- **Error 404 o URL SSO no válida**: Verifica que la **URL de inicio de sesión único** en Okta coincida exactamente con la **URL de respuesta** de OneUptime
- **Error de audiencia**: Asegúrate de que el **URI de audiencia** en Okta coincida exactamente con el **Identificador (ID de entidad)** de OneUptime
- **Error de certificado**: Asegúrate de haber descargado el certificado para el certificado de firma **activo**, no uno inactivo
- **Usuario no asignado**: Los usuarios deben estar asignados a la aplicación de Okta antes de poder iniciar sesión mediante SSO
- **Error de ID de nombre**: Verifica que el **Formato del ID de nombre** esté establecido en `EmailAddress` y que el **Nombre de usuario de la aplicación** esté establecido en `Email`

---

## Otros proveedores de identidad

La implementación SSO de OneUptime usa el protocolo SAML 2.0 y debería funcionar con cualquier proveedor de identidad compatible. Los pasos generales de configuración son:

1. En OneUptime, crea una configuración SSO y anota el **Identificador (ID de entidad)** y la **URL de respuesta (URL del Servicio de consumidor de aserciones)** del botón **Ver configuración SSO**
2. En tu proveedor de identidad, crea una aplicación SAML usando:
   - **URL del Servicio de consumidor de aserciones / URL de respuesta**: De la configuración SSO de OneUptime
   - **ID de entidad / URI de audiencia**: De la configuración SSO de OneUptime
   - **Formato del ID de nombre**: Dirección de correo electrónico
3. De tu proveedor de identidad, copia lo siguiente en OneUptime:
   - **URL de inicio de sesión** (punto de conexión SSO)
   - **Emisor** (ID de entidad del IdP)
   - **Certificado público** (certificado de firma X.509)
4. Establece el **Algoritmo de firma** en `RSA-SHA-256` y el **Algoritmo de resumen** en `SHA256`

## Notas sobre SSO y roles

OneUptime actualmente no admite la asignación de roles SAML desde tu proveedor de identidad. El control de acceso basado en roles debe configurarse por separado dentro de la **Configuración del proyecto** > **SSO** de OneUptime, donde puedes asignar roles predeterminados para usuarios SSO.
