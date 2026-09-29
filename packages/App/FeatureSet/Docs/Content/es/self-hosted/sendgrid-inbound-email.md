# Integración de correo electrónico entrante con SendGrid

El **Monitor de correo electrónico entrante** de OneUptime te permite crear y resolver alertas basadas en correos electrónicos enviados a direcciones de correo únicas específicas del monitor. Esto es útil para integrarse con sistemas heredados, herramientas de alertas o cualquier servicio que pueda enviar correos electrónicos.

Esta guía explica cómo configurar SendGrid Inbound Parse para reenviar los correos entrantes a tu instancia auto-alojada de OneUptime.

## Prerrequisitos

- Una cuenta de SendGrid con acceso a Inbound Parse
- Un dominio que controles con acceso a la configuración DNS
- Un endpoint HTTPS público que reenvíe los webhooks de SendGrid a OneUptime

## Acceso a la red

Inbound Parse requiere que SendGrid inicie una conexión hacia OneUptime. Permitir únicamente acceso saliente a Internet no es suficiente.

| Dirección | Destino | Protocolo / puerto | Finalidad |
| --- | --- | --- | --- |
| SendGrid → OneUptime | `https://your-oneuptime-domain.com/incoming-email/sendgrid/YOUR_SECRET` | HTTPS / TCP 443 | Entregar el correo analizado mediante POST multipart. |
| Servidores de correo remitentes → SendGrid | `mx.sendgrid.net`, mediante el MX público del dominio receptor | SMTP / TCP 25 | Recibir correo en SendGrid; no llega al servidor OneUptime. |
| OneUptime → SendGrid, solo si el envío de correo se configura por separado | `api.sendgrid.com` | HTTPS / TCP 443 | Enviar notificaciones mediante Mail Send API. |

Publica el DNS del hostname del webhook y usa un certificado de confianza pública. Una instalación privada puede exponer solo esta ruta mediante un proxy inverso o gateway público que alcance OneUptime internamente. Conserva la ruta, el secreto, el tipo de contenido y el cuerpo multipart; permite POST sin inicio de sesión interactivo ni desafíos del navegador. OneUptime no necesita escuchar conexiones SMTP entrantes. Consulta la [configuración de SendGrid](https://www.twilio.com/docs/sendgrid/for-developers/parsing-email/setting-up-the-inbound-parse-webhook).

Configura `INBOUND_EMAIL_WEBHOOK_SECRET` con un valor aleatorio seguro y sustituye `YOUR_SECRET` por él. El último segmento es obligatorio. OneUptime lo compara con el secreto configurado; dejar la variable vacía desactiva la comprobación. Mantén privadas la URL completa y las direcciones de los monitores, también en los registros del proxy. OneUptime no valida actualmente las cabeceras firmadas de Inbound Parse ni los tokens OAuth de SendGrid. Si necesitas estos mecanismos, valídalos en un gateway antes de reenviar, siguiendo la [documentación de seguridad de SendGrid](https://www.twilio.com/docs/sendgrid/for-developers/parsing-email/securing-your-parse-webhooks).

SendGrid no proporciona una lista estática fiable de IP de origen de Inbound Parse. Sus IP de envío de correo y las direcciones resueltas para `mx.sendgrid.net` no sirven como lista permitida de webhooks. Sigue sus [indicaciones de firewall](https://support.sendgrid.com/hc/en-us/articles/44375457225371-How-to-Configure-Firewall-Settings-for-SendGrid-Webhook-and-Inbound-Parse-IPs).

Inbound Parse y el envío de correo son independientes. Recibir correo no requiere llamadas a la API de SendGrid. Para enviar notificaciones con SendGrid, permite DNS y HTTPS saliente hacia `api.sendgrid.com`; [Mail Send](https://www.twilio.com/docs/sendgrid/api-reference/mail-send/mail-send) no necesita callbacks entrantes para aceptar el envío. Si utilizas SMTP, permite el servidor y puerto configurados en OneUptime.

Verifica el MX público, envía un correo a un monitor de prueba y confirma la recepción del webhook y la creación o resolución de la alerta. Un POST vacío o una prueba de envío saliente no verifica Inbound Parse.

## Cómo funciona

1. Creas un **Monitor de correo electrónico entrante** en OneUptime
2. OneUptime genera una dirección de correo electrónico única para ese monitor (por ejemplo, `monitor-abc123@inbound.yourdomain.com`)
3. Cuando se envía un correo electrónico a esa dirección, SendGrid lo recibe y lo reenvía a OneUptime a través de webhook
4. OneUptime evalúa el correo electrónico según tus criterios configurados para crear o resolver alertas

## Instrucciones de configuración

### Paso 1: Elige tu dominio de correo electrónico entrante

Necesitarás un subdominio dedicado para recibir correos electrónicos entrantes. Recomendamos usar un subdominio como:

- `inbound.yourdomain.com`
- `email.yourdomain.com`
- `monitor.yourdomain.com`

Este subdominio se usará exclusivamente para los correos electrónicos del monitor de OneUptime.

### Paso 2: Configurar el registro MX de DNS

Agrega un registro MX a tu configuración DNS para enrutar los correos electrónicos de tu subdominio entrante a SendGrid.

| Tipo | Host/Nombre | Prioridad | Valor           |
| ---- | ----------- | --------- | --------------- |
| MX   | inbound     | 10        | mx.sendgrid.net |

**Ejemplo:** Si tu dominio es `example.com` y usas `inbound.example.com`:

```
inbound.example.com.  IN  MX  10  mx.sendgrid.net.
```

**Nota:** Los cambios de DNS pueden tardar hasta 48 horas en propagarse, pero generalmente se completan en unas pocas horas.

### Paso 3: Autenticar el dominio en SendGrid

El dominio receptor debe pertenecer a uno de tus [dominios autenticados en SendGrid](https://www.twilio.com/docs/sendgrid/ui/account-and-settings/inbound-parse):

1. Inicia sesión en tu [panel de SendGrid](https://app.sendgrid.com)
2. Ve a **Configuración** > **Autenticación del remitente**
3. Haz clic en **Autenticar tu dominio**
4. Sigue las instrucciones para agregar los registros DNS requeridos (registros CNAME para DKIM)

### Paso 4: Configurar SendGrid Inbound Parse

1. Inicia sesión en tu [panel de SendGrid](https://app.sendgrid.com)
2. Navega a **Configuración** > **Inbound Parse**
3. Haz clic en **Agregar host y URL**
4. Configura lo siguiente:

| Campo                                            | Valor                                                                   |
| ------------------------------------------------ | ----------------------------------------------------------------------- |
| **Dominio receptor**                             | Tu subdominio entrante (por ejemplo, `inbound.yourdomain.com`)          |
| **URL de destino**                               | `https://your-oneuptime-domain.com/incoming-email/sendgrid/YOUR_SECRET` |
| **Verificar correos entrantes en busca de spam** | Opcional: habilita si lo deseas                                         |
| **Enviar mensaje MIME completo sin procesar**    | Deja sin marcar (no requerido)                                          |
| **POST del mensaje MIME completo sin procesar**  | Deja sin marcar (no requerido)                                          |

5. Haz clic en **Agregar**

### Paso 5: Configurar las variables de entorno de OneUptime

#### Docker Compose

Agrega estas variables de entorno a tu archivo `config.env`:

```bash
# Configuración de correo electrónico entrante
INBOUND_EMAIL_PROVIDER=SendGrid
INBOUND_EMAIL_DOMAIN=inbound.yourdomain.com
INBOUND_EMAIL_WEBHOOK_SECRET=replace-with-a-strong-random-secret
```

#### Kubernetes con Helm

Agrega esto a tu archivo `values.yaml`:

```yaml
inboundEmail:
  provider: "SendGrid"
  domain: "inbound.yourdomain.com"
  webhookSecret: "replace-with-a-strong-random-secret"
```

Usa el mismo secreto en la URL de destino del paso 4 y reinicia OneUptime después de cambiar la configuración.

### Paso 6: Crear un Monitor de correo electrónico entrante

1. Inicia sesión en tu panel de OneUptime
2. Navega a **Monitores** > **Crear monitor**
3. Selecciona **Correo electrónico entrante** como tipo de monitor
4. Configura tu monitor:
   - **Nombre:** Dale un nombre descriptivo a tu monitor
   - **Descripción:** Describe para qué es este monitor
5. Configura los **Criterios de creación de alertas** (cuándo crear una alerta):
   - Ejemplo: El asunto del correo contiene "ALERTA" o "CRÍTICO"
6. Configura los **Criterios de resolución de alertas** (cuándo resolver una alerta):
   - Ejemplo: El asunto del correo contiene "RESUELTO" o "OK"
7. Haz clic en **Crear**

Después de la creación, verás la dirección de correo electrónico única para este monitor (por ejemplo, `monitor-abc123def456@inbound.yourdomain.com`).

### Paso 7: Probar la integración

1. Copia la dirección de correo electrónico del monitor desde el panel de OneUptime
2. Envía un correo electrónico de prueba a esa dirección con un asunto que coincida con tus criterios de alerta
3. Comprueba el panel de OneUptime para verificar:
   - Que el correo electrónico fue recibido (visible en el Resumen del monitor)
   - Que se creó una alerta (si coincidieron los criterios)

## Referencia de variables de entorno

| Variable                       | Descripción                                                                                                                                            | Requerida | Predeterminado |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------ | --------- | -------------- |
| `INBOUND_EMAIL_PROVIDER`       | El proveedor de correo electrónico entrante a usar                                                                                                     | Sí        | -              |
| `INBOUND_EMAIL_DOMAIN`         | El subdominio configurado para correos electrónicos entrantes                                                                                          | Sí        | -              |
| `INBOUND_EMAIL_WEBHOOK_SECRET` | Se compara con el último segmento de `/incoming-email/sendgrid/YOUR_SECRET`. Configúralo para endpoints públicos; un valor vacío desactiva la validación. | Recomendado | - |

## Criterios de correo electrónico admitidos

Al configurar tu Monitor de correo electrónico entrante, puedes crear criterios basados en:

| Campo                       | Descripción                                         | Filtros disponibles                                                                                |
| --------------------------- | --------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| **Asunto del correo**       | La línea de asunto del correo electrónico           | Contiene, No contiene, Igual a, Diferente de, Comienza con, Termina con, Está vacío, No está vacío |
| **Remitente del correo**    | La dirección de correo electrónico del remitente    | Contiene, No contiene, Igual a, Diferente de, Comienza con, Termina con, Está vacío, No está vacío |
| **Cuerpo del correo**       | El cuerpo de texto simple del correo electrónico    | Contiene, No contiene, Igual a, Diferente de, Comienza con, Termina con, Está vacío, No está vacío |
| **Destinatario del correo** | La dirección de correo electrónico del destinatario | Contiene, No contiene, Igual a, Diferente de, Comienza con, Termina con, Está vacío, No está vacío |
| **Correo recibido**         | Tiempo desde que se recibió el último correo        | Recibido en minutos, No recibido en minutos                                                        |

## Casos de uso de ejemplo

### Alertas de sistemas heredados

Muchos sistemas heredados solo pueden enviar alertas por correo electrónico. Crea un Monitor de correo electrónico entrante para:

- Crear alertas de OneUptime cuando el sistema heredado envíe correos `[CRÍTICO]`
- Resolver alertas cuando se reciban correos `[RESUELTO]`

### Integración con servicios de terceros

Intégrate con servicios que envían notificaciones por correo electrónico:

- Herramientas de monitoreo sin integraciones de API
- Notificaciones de proveedores de nube
- Herramientas de análisis de seguridad

### Latido por correo electrónico

Usa criterios de "Correo recibido" para asegurarte de recibir correos periódicos:

- Crea una alerta si no se recibe ningún correo en 60 minutos
- Útil para monitorear trabajos por lotes o tareas programadas que envían correos de finalización

## Solución de problemas

### Correos no recibidos

1. **Comprueba la propagación del DNS:**

   ```bash
   dig MX inbound.yourdomain.com
   ```

   Debería devolver `mx.sendgrid.net`

2. **Verifica la configuración de SendGrid Inbound Parse:**

   - Inicia sesión en el panel de SendGrid
   - Ve a Configuración > Inbound Parse
   - Verifica que tu dominio y la URL del webhook sean correctos

3. **Comprueba los registros de OneUptime:**
   - Busca los webhooks de correo entrante en los registros de la aplicación OneUptime (Telemetry / ProbeIngest).
   - Comprueba si hay mensajes de error

### Webhooks fallando

- La URL HTTPS completa, incluido el secreto, debe ser accesible desde Internet. Sin el último segmento, la URL no coincide con la ruta.
- Permite POST sin redirecciones de inicio de sesión ni desafíos del navegador. Las IP de envío de correo de SendGrid no son una lista de orígenes de webhooks.
- Usa un certificado de confianza pública con su cadena completa. Verifica la entrega como se indica en Acceso a la red.

### El monitor no crea alertas

1. **Verifica la configuración de criterios:**

   - Comprueba que tus criterios de creación de alertas coincidan con el contenido del correo electrónico
   - Prueba con cadenas exactas primero antes de usar la coincidencia de patrones

2. **Comprueba el estado del monitor:**

   - Asegúrate de que el monitor no esté deshabilitado
   - Verifica que el tipo de monitor sea "Correo electrónico entrante"

3. **Revisa el Resumen del monitor:**
   - Comprueba si el correo electrónico fue recibido y procesado
   - Revisa los registros de evaluación para ver los detalles de la coincidencia de criterios

### Registros de entrega del webhook de SendGrid

Para comprobar si SendGrid está enviando webhooks correctamente:

1. Desafortunadamente, SendGrid no proporciona registros detallados para Inbound Parse
2. Comprueba los registros de tu servidor de OneUptime para detectar solicitudes de webhook entrantes
3. Usa una herramienta como [RequestBin](https://requestbin.com) para probar temporalmente la entrega del webhook

## Buenas prácticas de seguridad

1. **Usa HTTPS**: Siempre usa HTTPS para tu punto de conexión de webhook
2. **Secreto del webhook**: Configura `INBOUND_EMAIL_WEBHOOK_SECRET` e inclúyelo en la URL de tu webhook (por ejemplo, `/incoming-email/sendgrid/your-secret`) para una validación adicional
3. **Verificación del dominio**: Verifica tu dominio en SendGrid para una mejor seguridad del correo electrónico
4. **Restringe el acceso**: Solo crea monitores para fuentes de correo electrónico confiables
5. **Monitorea los registros**: Revisa regularmente los registros de correo electrónico entrante para detectar actividad sospechosa

## Proveedores alternativos

OneUptime está diseñado para admitir múltiples proveedores de correo electrónico entrante. Actualmente compatibles:

| Proveedor             | Estado      |
| --------------------- | ----------- |
| SendGrid              | Compatible  |
| Haraka (Auto-alojado) | Planificado |

Si necesitas soporte para un proveedor diferente, contáctanos o envía una solicitud de función.

## Soporte

Si encuentras problemas con la integración de correo electrónico entrante de SendGrid:

1. Consulta la sección de solución de problemas anterior
2. Revisa los registros de OneUptime para ver mensajes de error detallados
3. Contáctanos en [hello@oneuptime.com](mailto:hello@oneuptime.com)

¡Agradecemos los comentarios para mejorar esta integración!
