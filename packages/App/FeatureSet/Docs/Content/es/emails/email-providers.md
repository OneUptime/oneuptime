# Proveedores de correo electrónico

Envía el correo de OneUptime a través de la API HTTPS de un proveedor de correo electrónico en lugar de un servidor SMTP: Amazon SES, SendGrid, Mailgun, Postmark o Resend. Un proyecto elige uno para una configuración SMTP, y una instalación autoalojada puede enviar todo su propio correo a través de uno. La API se alcanza por HTTPS en el puerto 443, así que el correo sale incluso desde redes que bloquean los puertos SMTP, y la clave de cada proveedor se guarda cifrada.

:::cards
- [Amazon SES](#amazon-ses): Una clave de acceso de IAM, o el propio rol de IAM del servidor, y la región en la que está verificado tu remitente.
- [SendGrid](#sendgrid): Una clave de API con acceso a Mail Send.
- [Mailgun](#mailgun): Una clave de API, el dominio de envío y su región.
- [Postmark](#postmark): El token de API del servidor.
- [Resend](#resend): Una clave de API con acceso de envío.
- [Solución de problemas](#solución-de-problemas): Qué significa el rechazo de cada proveedor.
:::

## Elegir un proveedor

:::tabs
@tab Proyecto
En **Ajustes del proyecto > Notificaciones > Canales de notificación**, abre **Más ajustes** y haz clic en **Crear Configuración SMTP** en la tarjeta **Configuraciones de SMTP personalizado**. En el paso **Proveedor**, introduce un **Nombre** y elige el proveedor. El paso siguiente pide los ajustes de ese proveedor, y el paso **Remitente**, el **Correo del remitente** y el **Nombre de origen**. Una vez guardada la configuración, **Enviar correo de prueba** en su fila comprueba que funciona.
@tab Instancia autoalojada
En el Admin Dashboard, abre **Ajustes** y luego **Notificaciones > Correos**. En la tarjeta **Ajustes del servidor de correo**, haz clic en **Editar servidor** y elige el proveedor como **Tipo de servidor de correo electrónico**. Debajo aparece la tarjeta del proveedor, como **Ajustes de Amazon SES**: haz clic en su botón de edición, como **Editar Amazon SES**, y rellena los ajustes del proveedor y el paso **Remitente**. Mientras le falte algo, la tarjeta dice qué falta, y cada correo se rechaza indicando el ajuste que hay que rellenar.
:::

| Proveedor | Qué pide | Adónde envía OneUptime |
| --- | --- | --- |
| Amazon SES | ID de clave de acceso, Clave de acceso secreta, Región | `https://email.<region>.amazonaws.com` (API v2 de SES) |
| SendGrid | Clave de API | `https://api.sendgrid.com/v3/mail/send` |
| Mailgun | Clave de API, Dominio, Región | `https://api.mailgun.net` o `https://api.eu.mailgun.net` |
| Postmark | Token de API del servidor | `https://api.postmarkapp.com/email` |
| Resend | Clave de API | `https://api.resend.com/emails` |

Cada correo se envía con su parte de texto, y sus imágenes (el logotipo de OneUptime, capturas de pantalla) como adjuntos en línea. Cuando un proveedor limita la velocidad a la que envías, o falla por su parte, OneUptime vuelve a intentarlo tras la espera que pide el proveedor; cualquier otro rechazo se guarda en los registros de notificación, con lo que respondió el proveedor.

## Amazon SES

:::steps
### Verificar el remitente

En la [consola de Amazon SES](https://console.aws.amazon.com/ses/), en la región desde la que vas a enviar, verifica en **Identities** la dirección desde la que envías o su dominio. Mientras tu cuenta esté en el sandbox de SES, verifica también cada destinatario, o solicita acceso de producción.

### Crear una clave de acceso

Crea un usuario de IAM para OneUptime con una política que permita `ses:SendEmail` sobre tu identidad, y luego crea una clave de acceso para él:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": "ses:SendEmail",
      "Resource": "arn:aws:ses:us-east-1:123456789012:identity/example.com"
    }
  ]
}
```

Una instalación autoalojada en AWS puede prescindir de la clave e [iniciar sesión con el rol de IAM del servidor](#iniciar-sesión-con-el-rol-de-iam-del-servidor), con la misma política.

### Rellenar el paso Amazon SES

Introduce el **ID de clave de acceso** y la **Clave de acceso secreta**, y la **Región** en la que está verificada tu identidad, como `us-east-1`.
:::

### Iniciar sesión con el rol de IAM del servidor

Una instalación autoalojada en AWS puede enviar su propio correo como el rol de IAM que AWS da al servidor, sin guardar ninguna clave de acceso en OneUptime: las credenciales que entrega AWS caducan en cuestión de horas, y OneUptime obtiene otras nuevas antes de que caduquen. Esto es solo para el correo propio del servidor. La configuración de Amazon SES de un proyecto siempre inicia sesión con una clave de acceso, porque el rol del servidor es la propia identidad de AWS del servidor, no la de un proyecto.

Da al rol la política de arriba y luego ejecuta OneUptime con ese rol:

:::tabs
@tab Amazon EKS
Con los roles de IAM para cuentas de servicio, crea el rol con una política de confianza para el proveedor OIDC de tu clúster, y haz que el chart de Helm cree una cuenta de servicio con el ARN del rol. Los pods de la app y del worker de OneUptime se ejecutan con ella:

```yaml title="values.yaml"
serviceAccount:
  create: true
  annotations:
    eks.amazonaws.com/role-arn: arn:aws:iam::123456789012:role/oneuptime-ses
```

Con EKS Pod Identity, crea en su lugar una asociación de Pod Identity entre el rol y esa cuenta de servicio, y omite la anotación.
@tab Amazon ECS
Establece el rol como **Task role** de la definición de tarea de OneUptime.
@tab Amazon EC2
Asocia el rol a la instancia como su perfil de instancia. Con OneUptime en Docker en la instancia, sube el límite de saltos de los metadatos de la instancia a 2, para que los contenedores puedan alcanzarlos:

```bash
aws ec2 modify-instance-metadata-options --instance-id <instance-id> --http-put-response-hop-limit 2 --http-endpoint enabled
```
:::

Después, en el Admin Dashboard, haz clic en **Editar Amazon SES**, elige **Rol de IAM de este servidor** como **Tipo de autenticación** e introduce la **Región**. Al guardar, se quita cualquier clave de acceso guardada antes.

OneUptime busca las credenciales del servidor donde las buscan los SDK de AWS, en este orden: `AWS_ACCESS_KEY_ID` y `AWS_SECRET_ACCESS_KEY` en su entorno, un token de identidad web (`AWS_ROLE_ARN` y `AWS_WEB_IDENTITY_TOKEN_FILE`), el endpoint de credenciales de contenedor de Amazon ECS y EKS Pod Identity, y por último el servicio de metadatos de instancia de EC2 (IMDSv2).

## SendGrid

En SendGrid, abre **Settings > API Keys**, crea una clave con acceso a **Mail Send** y verifica la dirección desde la que envías (Single Sender Verification) o su dominio (Domain Authentication). Introduce la clave como **Clave de API** en el paso **SendGrid**.

## Mailgun

En Mailgun, añade y verifica tu dominio de envío, como `mg.example.com`, y luego crea una clave de envío para él, o usa la clave de API de tu cuenta. En el paso **Mailgun**, introduce la **Clave de API** y el **Dominio**, y elige la **Región** en la que se creó el dominio: `EU` para un dominio de la región de la UE de Mailgun, `US` para los demás. El **Correo del remitente** debe ser una dirección de ese dominio. Un dominio sandbox solo envía a sus destinatarios autorizados.

## Postmark

En Postmark, abre el servidor que envía, luego su pestaña **API Tokens**, y copia el token de API del servidor: un token de cuenta no envía. Introdúcelo como **Token de API del servidor** en el paso **Postmark**. El **Correo del remitente** debe ser una firma de remitente confirmada, o una dirección de un dominio verificado. Hasta que Postmark apruebe tu cuenta, solo envía a direcciones de tu propio dominio.

## Resend

En Resend, añade y verifica tu dominio en **Domains**, y luego crea en **API Keys** una clave de API con acceso de envío. Introdúcela como **Clave de API** en el paso **Resend**, con un **Correo del remitente** de tu dominio verificado. El dominio de prueba propio de Resend solo envía a tu propia dirección.

## Solución de problemas

Un correo de prueba que no sale dice por qué. Para cualquier otro correo, abre la pestaña **Correo electrónico** de **Ajustes del proyecto > Notificaciones > Registros de notificación** y selecciona **Ver mensaje de estado** en su fila.

:::details "Amazon SES needs a verified identity in …"
El **Correo del remitente**, o su dominio, no está verificado en la región indicada en la configuración, o la cuenta está en el sandbox de SES y el destinatario no está verificado. Verifícalo en esa región, o solicita acceso de producción.
:::

:::details "Amazon SES does not recognize the access key" o "did not accept the request's signature"
Comprueba el **ID de clave de acceso**, que la clave está activa en IAM y que la **Clave de acceso secreta** es la que se creó con ella. Una firma también se rechaza cuando el reloj del servidor no está en hora.
:::

:::details "The access key may not send with Amazon SES"
La política del usuario de IAM no permite `ses:SendEmail` sobre tu identidad. Añade la política de arriba.
:::

:::details "This server has no AWS credentials"
El servidor inicia sesión con su rol de IAM, pero AWS no le da credenciales. Ejecútalo con el rol, como muestra [Iniciar sesión con el rol de IAM del servidor](#iniciar-sesión-con-el-rol-de-iam-del-servidor), y luego reinicia los pods o tareas de OneUptime: un pod recibe los ajustes de su rol al arrancar. En Docker en Amazon EC2, el mensaje también indica cuándo el límite de saltos de los metadatos de la instancia es demasiado bajo.
:::

:::details "This server's IAM role may not send with Amazon SES" o "did not let this server assume the role"
La política del rol no permite `ses:SendEmail` sobre tu identidad: añade la política de arriba. O bien, en Amazon EKS, la política de confianza del rol no permite `sts:AssumeRoleWithWebIdentity` para el proveedor OIDC de tu clúster y la cuenta de servicio de OneUptime.
:::

:::details "Mailgun has no domain … in its US region"
El dominio no está en la región a la que envía la configuración. Comprueba el **Dominio**, y establece la **Región** en `EU` si el dominio se creó allí.
:::

:::details "is not a confirmed sender signature in Postmark" o "is not a verified domain in Resend"
Confirma el **Correo del remitente** como remitente, o verifica su dominio, en el panel del proveedor.
:::

:::details "did not accept the API key" o "did not accept the server API token"
Comprueba la clave de la configuración: la de SendGrid necesita acceso a Mail Send, la clave de envío de Mailgun solo funciona para su propio dominio, Postmark necesita el token del servidor, y la de Resend necesita acceso de envío.
:::

## Próximos pasos

:::cards
- [SMTP](/docs/emails/smtp): Enviar en su lugar a través de tu propio servidor de correo o de Microsoft 365.
- [Suscriptores y anuncios](/docs/status-pages/subscribers): Enviar el correo a los suscriptores de una página de estado con una configuración SMTP del proyecto.
:::
