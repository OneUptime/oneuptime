# SCIM (Sistema de gestión de identidades entre dominios)

OneUptime admite el protocolo SCIM v2.0 para el aprovisionamiento y desaprovisionamiento automatizado de usuarios. SCIM permite que los proveedores de identidad (IdP) como Azure AD, Okta y otros sistemas de identidad empresarial gestionen automáticamente el acceso de los usuarios a los proyectos y páginas de estado de OneUptime.

## Información general

La integración SCIM proporciona los siguientes beneficios:

- **Aprovisionamiento automatizado de usuarios**: Crea automáticamente usuarios en OneUptime cuando se les asigna en tu IdP
- **Desaprovisionamiento automatizado de usuarios**: Elimina automáticamente usuarios de OneUptime cuando se les desasigna en tu IdP
- **Sincronización de atributos de usuario**: Mantiene sincronizada la información del usuario entre tu IdP y OneUptime
- **Gestión centralizada del acceso**: Gestiona el acceso a OneUptime desde tu sistema de gestión de identidades existente

## SCIM para proyectos

El SCIM de proyectos permite que los proveedores de identidad gestionen los miembros del equipo en los proyectos de OneUptime.

### Configuración del SCIM de proyectos

1. **Navegar a la configuración del proyecto**

   - Ve a tu proyecto de OneUptime
   - Navega a **Configuración del proyecto** > **Equipo** > **SCIM**

2. **Configurar los ajustes SCIM**

   - Habilita **Aprovisionamiento automático de usuarios** para agregar automáticamente usuarios cuando se les asigna en tu IdP
   - Habilita **Desaprovisionamiento automático de usuarios** para eliminar automáticamente usuarios cuando se les desasigna en tu IdP
   - Selecciona los **Equipos predeterminados** a los que se agregarán los nuevos usuarios
   - Copia la **URL base de SCIM** y el **Token de portador** para la configuración de tu IdP

3. **Configurar tu proveedor de identidad**
   - Usa la URL base de SCIM: `https://oneuptime.com/scim/v2/{scimId}`
   - Configura la autenticación de token de portador con el token proporcionado
   - Asigna los atributos de usuario (el correo electrónico es obligatorio)

### Puntos de conexión SCIM del proyecto

- **Configuración del proveedor de servicios**: `GET /scim/v2/{scimId}/ServiceProviderConfig`
- **Esquemas**: `GET /scim/v2/{scimId}/Schemas`
- **Tipos de recursos**: `GET /scim/v2/{scimId}/ResourceTypes`
- **Listar usuarios**: `GET /scim/v2/{scimId}/Users`
- **Obtener usuario**: `GET /scim/v2/{scimId}/Users/{userId}`
- **Crear usuario**: `POST /scim/v2/{scimId}/Users`
- **Actualizar usuario**: `PUT /scim/v2/{scimId}/Users/{userId}` o `PATCH /scim/v2/{scimId}/Users/{userId}`
- **Eliminar usuario**: `DELETE /scim/v2/{scimId}/Users/{userId}`
- **Listar grupos**: `GET /scim/v2/{scimId}/Groups`
- **Obtener grupo**: `GET /scim/v2/{scimId}/Groups/{groupId}`
- **Crear grupo**: `POST /scim/v2/{scimId}/Groups`
- **Actualizar grupo**: `PUT /scim/v2/{scimId}/Groups/{groupId}` o `PATCH /scim/v2/{scimId}/Groups/{groupId}`
- **Eliminar grupo**: `DELETE /scim/v2/{scimId}/Groups/{groupId}`

### Ciclo de vida del usuario SCIM del proyecto

1. **Asignación de usuario en el IdP**: Cuando se asigna un usuario a OneUptime en tu IdP
2. **Aprovisionamiento SCIM**: El IdP llama a la API SCIM de OneUptime para crear el usuario
3. **Membresía en el equipo**: El usuario se agrega automáticamente a los equipos predeterminados configurados
4. **Acceso concedido**: El usuario ahora puede acceder al proyecto de OneUptime
5. **Desasignación de usuario**: Cuando se desasigna al usuario en el IdP
6. **Desaprovisionamiento SCIM**: El IdP llama a la API SCIM de OneUptime para eliminar al usuario
7. **Acceso revocado**: El usuario pierde el acceso al proyecto

## SCIM para páginas de estado

El SCIM de páginas de estado permite que los proveedores de identidad gestionen suscriptores de páginas de estado privadas.

### Configuración del SCIM de páginas de estado

1. **Navegar a la configuración de la página de estado**

   - Ve a tu página de estado de OneUptime
   - Navega a **Configuración de página de estado** > **Usuarios privados** > **SCIM**

2. **Configurar los ajustes SCIM**

   - Habilita **Aprovisionamiento automático de usuarios** para agregar suscriptores automáticamente cuando se les asigna en tu IdP
   - Habilita **Desaprovisionamiento automático de usuarios** para eliminar suscriptores automáticamente cuando se les desasigna en tu IdP
   - Copia la **URL base de SCIM** y el **Token de portador** para la configuración de tu IdP

3. **Configurar tu proveedor de identidad**
   - Usa la URL base de SCIM: `https://oneuptime.com/status-page-scim/v2/{scimId}`
   - Configura la autenticación de token de portador con el token proporcionado
   - Asigna los atributos de usuario (el correo electrónico es obligatorio)

### Puntos de conexión SCIM de la página de estado

- **Configuración del proveedor de servicios**: `GET /status-page-scim/v2/{scimId}/ServiceProviderConfig`
- **Esquemas**: `GET /status-page-scim/v2/{scimId}/Schemas`
- **Tipos de recursos**: `GET /status-page-scim/v2/{scimId}/ResourceTypes`
- **Listar usuarios**: `GET /status-page-scim/v2/{scimId}/Users`
- **Obtener usuario**: `GET /status-page-scim/v2/{scimId}/Users/{userId}`
- **Crear usuario**: `POST /status-page-scim/v2/{scimId}/Users`
- **Actualizar usuario**: `PUT /status-page-scim/v2/{scimId}/Users/{userId}` o `PATCH /status-page-scim/v2/{scimId}/Users/{userId}`
- **Eliminar usuario**: `DELETE /status-page-scim/v2/{scimId}/Users/{userId}`

### Ciclo de vida del usuario SCIM de la página de estado

1. **Asignación de usuario en el IdP**: Cuando se asigna un usuario a la página de estado de OneUptime en tu IdP
2. **Aprovisionamiento SCIM**: El IdP llama a la API SCIM de OneUptime para crear el suscriptor
3. **Acceso concedido**: El usuario ahora puede acceder a la página de estado privada
4. **Desasignación de usuario**: Cuando se desasigna al usuario en el IdP
5. **Desaprovisionamiento SCIM**: El IdP llama a la API SCIM de OneUptime para eliminar al suscriptor
6. **Acceso revocado**: El usuario pierde el acceso a la página de estado

## Configuración del proveedor de identidad

### Microsoft Entra ID (anteriormente Azure AD)

Microsoft Entra ID proporciona gestión de identidades empresarial con sólidas capacidades de aprovisionamiento SCIM. Sigue estos pasos detallados para configurar el aprovisionamiento SCIM con OneUptime.

#### Prerrequisitos

- Inquilino de Microsoft Entra ID con licencia Premium P1 o P2 (requerida para el aprovisionamiento automático)
- Cuenta de OneUptime con plan Scale o superior
- Acceso de administrador tanto a Microsoft Entra ID como a OneUptime

#### Paso 1: Obtener la configuración SCIM de OneUptime

1. Inicia sesión en tu panel de OneUptime
2. Navega a **Configuración del proyecto** > **Equipo** > **SCIM**
3. Haz clic en **Crear configuración SCIM**
4. Ingresa un nombre descriptivo (por ejemplo, "Aprovisionamiento de Microsoft Entra ID")
5. Configura las siguientes opciones:
   - **Aprovisionamiento automático de usuarios**: Habilita para crear usuarios automáticamente
   - **Desaprovisionamiento automático de usuarios**: Habilita para eliminar usuarios automáticamente
   - **Equipos predeterminados**: Selecciona los equipos a los que se deben agregar los nuevos usuarios
   - **Habilitar grupos de inserción**: Habilita si deseas gestionar la membresía del equipo a través de grupos de Entra ID
6. Guarda la configuración
7. Copia la **URL base de SCIM** y el **Token de portador** - los necesitarás para Entra ID

#### Paso 2: Crear una aplicación empresarial en Microsoft Entra ID

1. Inicia sesión en el [centro de administración de Microsoft Entra](https://entra.microsoft.com)
2. Navega a **Identidad** > **Aplicaciones** > **Aplicaciones empresariales**
3. Haz clic en **+ Nueva aplicación**
4. Haz clic en **+ Crear tu propia aplicación**
5. Ingresa un nombre (por ejemplo, "OneUptime")
6. Selecciona **Integrar cualquier otra aplicación que no encuentres en la galería (no de galería)**
7. Haz clic en **Crear**

#### Paso 3: Configurar el aprovisionamiento SCIM

1. En tu aplicación empresarial OneUptime, ve a **Aprovisionamiento**
2. Haz clic en **Comenzar**
3. Establece el **Modo de aprovisionamiento** en **Automático**
4. En **Credenciales de administrador**:
   - **URL del inquilino**: Ingresa la URL base de SCIM de OneUptime (por ejemplo, `https://oneuptime.com/api/identity/scim/v2/{your-scim-id}`)
   - **Token secreto**: Ingresa el token de portador de OneUptime
5. Haz clic en **Probar conexión** para verificar la configuración
6. Haz clic en **Guardar**

#### Paso 4: Configurar asignaciones de atributos

1. En la sección de aprovisionamiento, haz clic en **Asignaciones**
2. Haz clic en **Aprovisionar usuarios de Azure Active Directory**
3. Configura las siguientes asignaciones de atributos:

| Atributo de Azure AD                                          | Atributo SCIM de OneUptime     | Requerido   |
| ------------------------------------------------------------- | ------------------------------ | ----------- |
| `userPrincipalName`                                           | `userName`                     | Sí          |
| `mail`                                                        | `emails[type eq "work"].value` | Recomendado |
| `displayName`                                                 | `displayName`                  | Recomendado |
| `givenName`                                                   | `name.givenName`               | Opcional    |
| `surname`                                                     | `name.familyName`              | Opcional    |
| `Switch([IsSoftDeleted], , "False", "True", "True", "False")` | `active`                       | Recomendado |

4. Elimina las asignaciones que no sean necesarias para simplificar el aprovisionamiento
5. Haz clic en **Guardar**

#### Paso 5: Configurar el aprovisionamiento de grupos (opcional)

Si habilitaste **Grupos de inserción** en OneUptime:

1. Vuelve a **Asignaciones**
2. Haz clic en **Aprovisionar grupos de Azure Active Directory**
3. Habilita el aprovisionamiento de grupos estableciendo **Habilitado** en **Sí**
4. Configura las siguientes asignaciones de atributos:

| Atributo de Azure AD | Atributo SCIM de OneUptime |
| -------------------- | -------------------------- |
| `displayName`        | `displayName`              |
| `members`            | `members`                  |

5. Haz clic en **Guardar**

#### Paso 6: Asignar usuarios y grupos

1. En tu aplicación empresarial OneUptime, ve a **Usuarios y grupos**
2. Haz clic en **+ Agregar usuario/grupo**
3. Selecciona los usuarios y/o grupos que deseas aprovisionar en OneUptime
4. Haz clic en **Asignar**

#### Paso 7: Iniciar el aprovisionamiento

1. Ve a **Aprovisionamiento** > **Información general**
2. Haz clic en **Iniciar aprovisionamiento**
3. El ciclo de aprovisionamiento inicial comenzará (esto puede tardar hasta 40 minutos para la primera sincronización)
4. Monitorea los **Registros de aprovisionamiento** para detectar cualquier error

#### Solución de problemas con Microsoft Entra ID

- **Error en la prueba de conexión**: Verifica que la URL base de SCIM incluya el prefijo `/api/identity` y que el token de portador sea correcto
- **Usuarios que no se aprovisionan**: Comprueba que los usuarios estén asignados a la aplicación y que las asignaciones de atributos sean correctas
- **Errores de aprovisionamiento**: Revisa los registros de aprovisionamiento en Entra ID para mensajes de error específicos
- **Retrasos en la sincronización**: El aprovisionamiento inicial puede tardar hasta 40 minutos; las sincronizaciones posteriores ocurren cada 40 minutos

---

### Okta

Okta proporciona una gestión de identidades flexible con excelente soporte SCIM. Sigue estos pasos detallados para configurar el aprovisionamiento SCIM con OneUptime.

#### Prerrequisitos

- Inquilino de Okta con capacidades de aprovisionamiento (función de gestión del ciclo de vida)
- Cuenta de OneUptime con plan Scale o superior
- Acceso de administrador tanto a Okta como a OneUptime

#### Paso 1: Obtener la configuración SCIM de OneUptime

1. Inicia sesión en tu panel de OneUptime
2. Navega a **Configuración del proyecto** > **Equipo** > **SCIM**
3. Haz clic en **Crear configuración SCIM**
4. Ingresa un nombre descriptivo (por ejemplo, "Aprovisionamiento de Okta")
5. Configura las siguientes opciones:
   - **Aprovisionamiento automático de usuarios**: Habilita para crear usuarios automáticamente
   - **Desaprovisionamiento automático de usuarios**: Habilita para eliminar usuarios automáticamente
   - **Equipos predeterminados**: Selecciona los equipos a los que se deben agregar los nuevos usuarios
   - **Habilitar grupos de inserción**: Habilita si deseas gestionar la membresía del equipo a través de grupos de Okta
6. Guarda la configuración
7. Copia la **URL base de SCIM** y el **Token de portador** - los necesitarás para Okta

#### Paso 2: Crear o configurar una aplicación de Okta

**Si tienes una aplicación SSO existente:**

1. Inicia sesión en tu consola de administración de Okta
2. Navega a **Aplicaciones** > **Aplicaciones**
3. Busca y selecciona tu aplicación de OneUptime existente

**Si creas una nueva aplicación:**

1. Inicia sesión en tu consola de administración de Okta
2. Navega a **Aplicaciones** > **Aplicaciones**
3. Haz clic en **Crear integración de aplicación**
4. Selecciona **SAML 2.0** y haz clic en **Siguiente**
5. Ingresa "OneUptime" como nombre de la aplicación
6. Completa la configuración SAML (consulta la documentación de SSO)
7. Haz clic en **Finalizar**

#### Paso 3: Habilitar el aprovisionamiento SCIM

1. En tu aplicación OneUptime, ve a la pestaña **General**
2. En la sección **Configuración de la aplicación**, haz clic en **Editar**
3. En **Aprovisionamiento**, selecciona **SCIM**
4. Haz clic en **Guardar**
5. Aparecerá una nueva pestaña de **Aprovisionamiento**

#### Paso 4: Configurar la conexión SCIM

1. Ve a la pestaña **Aprovisionamiento**
2. Haz clic en **Integración** en la barra lateral izquierda
3. Haz clic en **Configurar integración de API**
4. Marca **Habilitar integración de API**
5. Configura lo siguiente:
   - **URL base del conector SCIM**: Ingresa la URL base de SCIM de OneUptime (por ejemplo, `https://oneuptime.com/api/identity/scim/v2/{your-scim-id}`)
   - **Campo de identificador único para usuarios**: Ingresa `userName`
   - **Acciones de aprovisionamiento compatibles**: Selecciona las acciones que deseas habilitar:
     - Importar nuevos usuarios y actualizaciones de perfil
     - Insertar nuevos usuarios
     - Insertar actualizaciones de perfil
     - Insertar grupos (si usas aprovisionamiento basado en grupos)
   - **Modo de autenticación**: Selecciona **Encabezado HTTP**
   - **Autorización**: Ingresa `Bearer {your-bearer-token}` (reemplaza con el token real)
6. Haz clic en **Probar credenciales de API** para verificar la conexión
7. Haz clic en **Guardar**

#### Paso 5: Configurar el aprovisionamiento para la aplicación

1. En la pestaña **Aprovisionamiento**, haz clic en **A la aplicación** en la barra lateral izquierda
2. Haz clic en **Editar**
3. Habilita las siguientes opciones:
   - **Crear usuarios**: Habilita para aprovisionar nuevos usuarios
   - **Actualizar atributos de usuario**: Habilita para sincronizar cambios de atributos
   - **Desactivar usuarios**: Habilita para desaprovisionar usuarios cuando se desasignan
4. Haz clic en **Guardar**

#### Paso 6: Configurar asignaciones de atributos

1. Desplázate hacia abajo hasta **Asignaciones de atributos**
2. Verifica o configura las siguientes asignaciones:

| Atributo de Okta   | Atributo SCIM de OneUptime      | Dirección               |
| ------------------ | ------------------------------- | ----------------------- |
| `userName`         | `userName`                      | De Okta a la aplicación |
| `user.email`       | `emails[primary eq true].value` | De Okta a la aplicación |
| `user.firstName`   | `name.givenName`                | De Okta a la aplicación |
| `user.lastName`    | `name.familyName`               | De Okta a la aplicación |
| `user.displayName` | `displayName`                   | De Okta a la aplicación |

3. Elimina las asignaciones innecesarias
4. Haz clic en **Guardar** si realizaste cambios

#### Paso 7: Configurar grupos de inserción (opcional)

Si habilitaste **Grupos de inserción** en OneUptime:

1. Ve a la pestaña **Grupos de inserción**
2. Haz clic en **+ Insertar grupos**
3. Selecciona **Buscar grupos por nombre** o **Buscar grupos por regla**
4. Busca y selecciona los grupos que deseas insertar
5. Haz clic en **Guardar**

#### Paso 8: Asignar usuarios

1. Ve a la pestaña **Asignaciones**
2. Haz clic en **Asignar** > **Asignar a personas** o **Asignar a grupos**
3. Selecciona los usuarios o grupos que deseas aprovisionar
4. Haz clic en **Asignar** para cada selección
5. Haz clic en **Listo**

#### Paso 9: Verificar el aprovisionamiento

1. Ve a **Informes** > **Registro del sistema** en la consola de administración de Okta
2. Filtra los eventos relacionados con tu aplicación de OneUptime
3. Verifica que los eventos de aprovisionamiento sean exitosos
4. Comprueba en OneUptime que los usuarios hayan sido creados

#### Solución de problemas con Okta

- **Error en la prueba de credenciales de API**: Verifica que la URL base de SCIM y el token de portador sean correctos
- **Usuarios que no se aprovisionan**: Asegúrate de que los usuarios estén asignados a la aplicación y que el aprovisionamiento esté habilitado
- **Usuarios duplicados**: Asegúrate de que el atributo `userName` sea único y se asigne correctamente al correo electrónico
- **Errores de inserción de grupos**: Verifica que los grupos existan y tengan la membresía correcta
- **Error: 401 No autorizado**: Regenera el token de portador en OneUptime y actualízalo en Okta

---

### Otros proveedores de identidad

La implementación SCIM de OneUptime sigue la especificación SCIM v2.0 y debería funcionar con cualquier proveedor de identidad compatible. Pasos generales de configuración:

1. **URL base de SCIM**: `https://oneuptime.com/api/identity/scim/v2/{scim-id}` (para proyectos) o `https://oneuptime.com/api/identity/status-page-scim/v2/{scim-id}` (para páginas de estado)
2. **Autenticación**: Token de portador HTTP
3. **Atributo de usuario requerido**: `userName` (debe ser una dirección de correo electrónico válida)
4. **Operaciones compatibles**: GET, POST, PUT, PATCH, DELETE para usuarios y grupos

#### Puntos de conexión SCIM compatibles

| Punto de conexión        | Métodos                 | Descripción                                            |
| ------------------------ | ----------------------- | ------------------------------------------------------ |
| `/ServiceProviderConfig` | GET                     | Capacidades del servidor SCIM                          |
| `/Schemas`               | GET                     | Esquemas de recursos disponibles                       |
| `/ResourceTypes`         | GET                     | Tipos de recursos disponibles                          |
| `/Users`                 | GET, POST               | Listar y crear usuarios                                |
| `/Users/{id}`            | GET, PUT, PATCH, DELETE | Gestionar usuarios individuales                        |
| `/Groups`                | GET, POST               | Listar y crear grupos/equipos (solo SCIM de proyectos) |
| `/Groups/{id}`           | GET, PUT, PATCH, DELETE | Gestionar grupos individuales (solo SCIM de proyectos) |

#### Esquema de usuario SCIM

```json
{
  "schemas": ["urn:ietf:params:scim:schemas:core:2.0:User"],
  "userName": "user@example.com",
  "name": {
    "givenName": "John",
    "familyName": "Doe",
    "formatted": "John Doe"
  },
  "displayName": "John Doe",
  "emails": [
    {
      "value": "user@example.com",
      "type": "work",
      "primary": true
    }
  ],
  "active": true
}
```

#### Esquema de grupo SCIM

```json
{
  "schemas": ["urn:ietf:params:scim:schemas:core:2.0:Group"],
  "displayName": "Engineering Team",
  "members": [
    {
      "value": "user-id-here",
      "display": "user@example.com"
    }
  ]
}
```

## Preguntas frecuentes

### ¿Qué sucede cuando se desaprovisiona a un usuario?

Cuando se desaprovisiona a un usuario (ya sea mediante una solicitud DELETE o estableciendo `active: false`), se le elimina de los equipos configurados en los ajustes SCIM. La cuenta de usuario en sí permanece en OneUptime, pero pierde acceso al proyecto.

### ¿Puedo usar SCIM sin SSO?

Sí, SCIM y SSO son características independientes. Puedes usar SCIM para el aprovisionamiento de usuarios mientras permites que los usuarios inicien sesión con sus contraseñas de OneUptime o cualquier otro método de autenticación.

### ¿Cómo gestiono los usuarios que ya existen en OneUptime?

Cuando SCIM intenta crear un usuario que ya existe (coincidiendo por correo electrónico), OneUptime simplemente lo agregará a los equipos predeterminados configurados en lugar de crear un usuario duplicado.

### ¿Cuál es la diferencia entre equipos predeterminados y grupos de inserción?

- **Equipos predeterminados**: Todos los usuarios aprovisionados mediante SCIM se agregan a los mismos equipos predefinidos
- **Grupos de inserción**: La membresía del equipo es gestionada por tu proveedor de identidad, lo que permite que diferentes usuarios estén en diferentes equipos según la membresía en grupos del IdP

### ¿Con qué frecuencia ocurre la sincronización del aprovisionamiento?

Esto depende de tu proveedor de identidad:

- **Microsoft Entra ID**: La sincronización inicial puede tardar hasta 40 minutos; las sincronizaciones posteriores ocurren cada 40 minutos
- **Okta**: Casi en tiempo real para la mayoría de las operaciones, con sincronizaciones completas periódicas
