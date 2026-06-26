# Global SSO (inicio de sesión único en toda la instancia)

Global SSO permite que un **administrador de la instancia** de OneUptime (administrador maestro) configure un único proveedor de identidad SAML 2.0 u OpenID Connect (OIDC) **una sola vez a nivel de instancia** y lo conecte a cualquier proyecto del servidor. Es la contraparte a nivel de instancia del SSO por proyecto: en lugar de que cada propietario de proyecto configure su propio proveedor de identidad, un administrador maestro configura uno que puede dar servicio a toda la instancia.

Global SSO es una funcionalidad de **OneUptime Enterprise Edition** y solo está disponible en instancias que ejecutan la compilación de Enterprise Edition.

## Global SSO frente a Project SSO

|                                | Project SSO                                                         | Global SSO                                                 |
| ------------------------------ | ------------------------------------------------------------------- | ---------------------------------------------------------- |
| Configurado por                | Propietario/administrador del proyecto (Configuración del proyecto) | Administrador maestro de la instancia (Admin Dashboard)    |
| Alcance                        | Un solo proyecto                                                    | Toda la instancia, conectable a cualquier proyecto         |
| Resultado del inicio de sesión | Acceso a ese único proyecto                                         | Acceso a todos los proyectos que el usuario pueda alcanzar |

## Configuración de Global SSO

1. **Abre el Admin Dashboard**

   - Inicia sesión como administrador maestro y abre **Admin** > **Settings** > **Global SSO** (para SAML) o **Global OIDC** (para OpenID Connect).

2. **Crea un proveedor**

   - Haz clic en **Create Global SSO**.
   - Para SAML: ingresa un **Name**, la **Sign On URL** y el **Issuer** de tu proveedor de identidad, y pega el **Public Certificate**. Elige los métodos de **Signature** y **Digest** (deja los valores predeterminados, `RSA-SHA256` / `SHA256`, si no estás seguro).
   - Para OIDC: ingresa la **Discovery URL**, el **Issuer**, el **Client ID**, el **Client Secret**, los **Scopes** (deben incluir `openid`) y los nombres de los claims de **email** / **name**.

3. **Copia las URL de OneUptime en tu proveedor de identidad**

   - Abre el proveedor (haz clic en su fila en la lista) para mostrar la tarjeta **Identity Provider URLs**.
   - Para SAML, copia la **ACS URL (Reply URL)** y el **Issuer (Entity ID)** en tu IdP (Okta, Azure AD, OneLogin, JumpCloud y más).
   - Para OIDC, copia el **Redirect URI** en la lista de redirecciones permitidas de tu IdP.

4. **Prueba el proveedor**
   - Usa el enlace **Test this SSO provider** en la página del proveedor para ejecutar un inicio de sesión de extremo a extremo a través de tu proveedor de identidad. El proveedor debe estar **habilitado** para que el enlace funcione. Habilitar un proveedor global solo agrega una opción de "Sign in with SSO" en la página de inicio de sesión: nunca fuerza el SSO ni bloquea a nadie, por lo que es seguro habilitarlo, probarlo y volver a deshabilitarlo si es necesario.

## Cómo inician sesión los usuarios

El comportamiento de un proveedor global depende de si le adjuntas algún proyecto:

- **Sin proyectos adjuntos (todos por defecto / invitación primero):** Los usuarios pueden iniciar sesión con el proveedor y acceder a **cualquier proyecto del que ya sean miembros**. Los usuarios nuevos **no** se crean automáticamente: primero debe invitarse a un usuario a un proyecto. Usa esta opción para un SSO a nivel de toda la empresa donde las membresías se gestionan en otro lugar.

- **Proyectos adjuntos (aprovisionamiento automático):** Abre el proveedor y usa la tabla **Attached Projects** para adjuntar uno o más proyectos, cada uno con un conjunto de equipos predeterminados. Los usuarios que inician sesión se **aprovisionan automáticamente** en esos proyectos y se agregan a los equipos predeterminados en el primer inicio de sesión. Agrega un proyecto + equipos a la vez para construir la lista; para cambiar un adjunto, elimínalo y vuelve a agregarlo.

Si quieres evitar cualquier creación automática de cuentas incluso cuando hay proyectos adjuntos, habilita **Disable Sign Up with SSO** en el proveedor: los usuarios deberán entonces ser invitados antes de poder iniciar sesión.

## Cómo forzar el SSO

Configurar un proveedor global no obliga a nadie a usarlo; el inicio de sesión con contraseña sigue funcionando. Para exigir el SSO, usa los controles **Require SSO for Login**:

- **Por proyecto:** un proyecto puede exigir SSO y, opcionalmente, exigir un proveedor _específico_ (de proyecto o global).
- **A nivel de instancia:** **Admin** > **Settings** > **Authentication** tiene un interruptor **Require SSO for Login** que fuerza el SSO para todos los usuarios de la instancia. Los administradores maestros permanecen exentos para que no puedan quedar bloqueados.

## Relacionado

- [SSO (Project SSO)](/docs/identity/sso)
- [SCIM](/docs/identity/scim)
