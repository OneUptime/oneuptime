# Monitor de correo electrónico entrante

El Monitor de correo electrónico entrante te permite crear y resolver alertas basadas en correos electrónicos enviados a direcciones de correo únicas específicas del monitor. Esto es útil para integrar con sistemas heredados, herramientas de alertas de terceros o cualquier servicio que pueda enviar notificaciones por correo electrónico.

## Cómo funciona

1. Cuando creas un Monitor de correo electrónico entrante, OneUptime genera una dirección de correo electrónico única para ese monitor
2. Cualquier correo electrónico enviado a esa dirección se recibe y evalúa según tus criterios configurados
3. Según los criterios, OneUptime puede crear nuevas alertas o resolver las existentes

Esta es una forma eficaz de integrar sistemas de alertas basados en correo electrónico con el flujo de trabajo de gestión de incidentes de OneUptime.

## Creación de un Monitor de correo electrónico entrante

1. Navega a **Monitores** en tu panel de OneUptime
2. Haz clic en **Crear monitor**
3. Selecciona **Correo electrónico entrante** como tipo de monitor
4. Configura los ajustes del monitor:
   - **Nombre**: Un nombre descriptivo para tu monitor
   - **Descripción**: Para qué es este monitor
5. Configura tus **Criterios de creación de alertas** (condiciones que crean alertas)
6. Configura tus **Criterios de resolución de alertas** (condiciones que resuelven alertas)
7. Haz clic en **Crear**

Después de la creación, verás la dirección de correo electrónico única para este monitor en la página de detalles del monitor.

## Formato de la dirección de correo electrónico

Cada Monitor de correo electrónico entrante obtiene una dirección de correo electrónico única en el formato:

```
monitor-{secret-key}@{inbound-domain}
```

Por ejemplo: `monitor-abc123def456@inbound.yourdomain.com`

Puedes copiar esta dirección desde la página de detalles del monitor y configurar tus sistemas externos para enviar correos electrónicos a ella.

## Campos de criterios disponibles

Puedes crear criterios basados en los siguientes campos de correo electrónico:

| Campo                       | Descripción                                                     |
| --------------------------- | --------------------------------------------------------------- |
| **Asunto del correo**       | La línea de asunto del correo electrónico entrante              |
| **Remitente del correo**    | La dirección de correo electrónico del remitente                |
| **Cuerpo del correo**       | El contenido de texto simple del cuerpo del correo electrónico  |
| **Destinatario del correo** | La dirección de correo electrónico del destinatario             |
| **Correo recibido**         | Criterios basados en el tiempo de cuándo se reciben los correos |

## Tipos de filtro disponibles

### Filtros de cadena (Asunto, Remitente, Cuerpo, Destinatario)

| Filtro            | Descripción                                             | Ejemplo                                        |
| ----------------- | ------------------------------------------------------- | ---------------------------------------------- |
| **Contiene**      | El campo contiene el texto especificado                 | El asunto contiene "CRÍTICO"                   |
| **No contiene**   | El campo no contiene el texto especificado              | El asunto no contiene "PRUEBA"                 |
| **Igual a**       | El campo coincide exactamente con el texto especificado | El remitente es igual a "alertas@servicio.com" |
| **Diferente de**  | El campo no coincide con el texto especificado          | El asunto no es igual a "OK"                   |
| **Comienza con**  | El campo comienza con el texto especificado             | El asunto comienza con "[ALERTA]"              |
| **Termina con**   | El campo termina con el texto especificado              | El asunto termina con "- Producción"           |
| **Está vacío**    | El campo está vacío o en blanco                         | El cuerpo está vacío                           |
| **No está vacío** | El campo tiene contenido                                | El asunto no está vacío                        |

### Filtros basados en el tiempo (Correo recibido)

| Filtro                     | Descripción                              | Ejemplo                          |
| -------------------------- | ---------------------------------------- | -------------------------------- |
| **Recibido en minutos**    | El correo se recibió dentro de X minutos | Correo recibido en 30 minutos    |
| **No recibido en minutos** | Ningún correo recibido en X minutos      | Correo no recibido en 60 minutos |

## Configuraciones de ejemplo

### Ejemplo 1: Crear alerta en correos críticos

**Criterios de creación de alertas:**

- El asunto del correo **Contiene** "CRÍTICO"
- O el asunto del correo **Contiene** "ALERTA"
- O el asunto del correo **Contiene** "ERROR"

**Criterios de resolución de alertas:**

- El asunto del correo **Contiene** "RESUELTO"
- O el asunto del correo **Contiene** "OK"
- O el asunto del correo **Contiene** "RECUPERADO"

### Ejemplo 2: Monitorear un remitente específico

**Criterios de creación de alertas:**

- El remitente del correo **Igual a** "monitoreo@sistema-heredado.com"
- Y el asunto del correo **Contiene** "Fallido"

**Criterios de resolución de alertas:**

- El remitente del correo **Igual a** "monitoreo@sistema-heredado.com"
- Y el asunto del correo **Contiene** "Exitoso"

### Ejemplo 3: Monitor de latido (Sin correo = Alerta)

**Criterios de creación de alertas:**

- Correo recibido **No recibido en minutos** con valor `60`

Esto crea una alerta si no se recibe ningún correo durante 60 minutos, útil para monitorear trabajos programados o procesos por lotes que deben enviar correos de finalización.

**Criterios de resolución de alertas:**

- Correo recibido **Recibido en minutos** con valor `5`

Esto resuelve la alerta cuando se recibe un correo electrónico.

## Casos de uso

### Integración con sistemas heredados

Muchos sistemas más antiguos solo admiten alertas basadas en correo electrónico. Usa el Monitor de correo electrónico entrante para:

- Convertir alertas de correo electrónico en incidentes de OneUptime
- Resolver automáticamente los incidentes cuando lleguen correos de recuperación
- Centralizar las alertas de múltiples sistemas heredados

### Monitoreo de servicios de terceros

Intégrate con servicios que envían notificaciones por correo electrónico:

- Alertas de proveedores de nube (AWS, GCP, Azure)
- Herramientas de análisis de seguridad
- Notificaciones de finalización de copias de seguridad
- Advertencias de caducidad de certificados SSL

### Monitoreo de trabajos programados

Monitorea trabajos por lotes y tareas programadas:

- Crea alertas si no se reciben correos de finalización a tiempo
- Rastrear fallos de trabajos a través de correos de notificación de error
- Monitorear finalizaciones de pipelines de datos

### Agregación de alertas de múltiples proveedores

Consolida alertas de múltiples herramientas de monitoreo:

- Recibe alertas de Nagios, Zabbix u otras herramientas por correo electrónico
- Unifica la gestión de incidentes en OneUptime
- Mantiene una única fuente de verdad para todas las alertas

## Variables de plantilla

Al configurar plantillas de incidentes, puedes usar estas variables de correos electrónicos entrantes:

| Variable              | Descripción                                         |
| --------------------- | --------------------------------------------------- |
| `{{emailSubject}}`    | El asunto del correo electrónico recibido           |
| `{{emailFrom}}`       | La dirección de correo electrónico del remitente    |
| `{{emailTo}}`         | La dirección de correo electrónico del destinatario |
| `{{emailBody}}`       | El cuerpo de texto simple del correo electrónico    |
| `{{emailReceivedAt}}` | Cuándo se recibió el correo electrónico             |

## Vista de resumen del monitor

El resumen del monitor muestra:

- **Último correo recibido el**: Cuándo se recibió el correo electrónico más reciente
- **De**: El remitente del último correo electrónico
- **Asunto**: La línea de asunto del último correo electrónico
- **Encabezados del correo**: Encabezados completos del último correo electrónico (expandible)
- **Cuerpo del correo**: Contenido del último correo electrónico (expandible)

## Configuración auto-alojada

Si estás auto-alojando OneUptime, necesitas configurar un proveedor de correo electrónico entrante. Actualmente compatible:

- **SendGrid Inbound Parse**: Consulta [Integración de correo electrónico entrante con SendGrid](/docs/self-hosted/sendgrid-inbound-email) para obtener instrucciones de configuración

## Aspectos a considerar

- **Seguridad de la dirección de correo**: La dirección de correo del monitor contiene una clave secreta. Trátala como una contraseña y no la compartas públicamente.
- **Tamaño del correo**: Los correos electrónicos muy grandes (con archivos adjuntos grandes) pueden ser truncados o rechazados por el proveedor de correo.
- **Tiempo de procesamiento**: Los correos electrónicos se procesan de forma asíncrona. Puede haber un retraso de unos segundos entre el envío y la creación de alertas.
- **Insensibilidad a mayúsculas/minúsculas**: Todas las comparaciones de cadenas (Contiene, Igual a, etc.) no distinguen entre mayúsculas y minúsculas.
- **Texto simple**: Los criterios del cuerpo del correo usan la versión de texto simple del correo electrónico. El formato HTML se elimina.

## Solución de problemas

### Correos no recibidos

1. Verifica que la dirección de correo sea correcta (comprueba si hay errores tipográficos)
2. Comprueba si el correo está siendo bloqueado por filtros de spam
3. Verifica que tu proveedor de correo entrante esté configurado correctamente
4. Revisa los registros de OneUptime para ver si hay mensajes de error

### Alertas no creadas

1. Verifica que tus criterios coincidan con el contenido del correo
2. Comprueba que el monitor no esté deshabilitado
3. Revisa los registros de evaluación en los detalles del monitor
4. Prueba con coincidencias de cadenas exactas antes de usar la coincidencia de patrones

### Alertas no resueltas

1. Verifica que tus criterios de resolución coincidan con el correo de recuperación
2. Asegúrate de que haya una alerta activa para resolver
3. Comprueba que el correo de resolución se envíe a la misma dirección del monitor
