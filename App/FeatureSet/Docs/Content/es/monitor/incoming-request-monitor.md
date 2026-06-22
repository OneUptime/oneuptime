# Monitor de solicitudes entrantes

El monitoreo de solicitudes entrantes (también conocido como monitoreo de latido) te permite monitorear servicios haciendo que envíen solicitudes HTTP periódicas a OneUptime. En lugar de que OneUptime se conecte a tu servicio, tu servicio hace ping a OneUptime para confirmar que está en ejecución.

## Información general

Los monitores de solicitudes entrantes proporcionan una URL de webhook única que tus servicios llaman de forma programada. Esto te permite:

- Monitorear trabajos cron y tareas programadas
- Verificar que los workers en segundo plano estén en ejecución
- Monitorear servicios detrás de firewalls que no pueden alcanzarse externamente
- Integrarse con herramientas de monitoreo de terceros
- Rastrear señales de latido desde cualquier sistema compatible con HTTP

## Creación de un monitor de solicitudes entrantes

1. Ve a **Monitores** en el panel de OneUptime
2. Haz clic en **Crear monitor**
3. Selecciona **Solicitud entrante** como tipo de monitor
4. Se generará una **Clave secreta** y una URL de latido para este monitor
5. Configura tu servicio para enviar solicitudes a la URL de latido
6. Configura los criterios de monitoreo según sea necesario

## URL de latido

Una vez creado, tu monitor tendrá una URL de latido única en el formato:

```
https://oneuptime.com/heartbeat/YOUR_SECRET_KEY
```

Tu servicio debe enviar solicitudes HTTP **GET** o **POST** a esta URL a intervalos regulares.

### Envío de un latido

#### Usando curl

```bash
# Solicitud GET simple
curl https://oneuptime.com/heartbeat/YOUR_SECRET_KEY

# Solicitud POST con cuerpo personalizado
curl -X POST https://oneuptime.com/heartbeat/YOUR_SECRET_KEY \
  -H "Content-Type: application/json" \
  -d '{"status": "healthy", "version": "1.2.3"}'
```

#### Desde un trabajo cron

```bash
# Agregar al crontab para enviar un latido cada 5 minutos
*/5 * * * * curl -s https://oneuptime.com/heartbeat/YOUR_SECRET_KEY > /dev/null
```

#### Desde el código de la aplicación

```javascript
// Ejemplo en Node.js
const https = require("https");
https.get("https://oneuptime.com/heartbeat/YOUR_SECRET_KEY");
```

```python
# Ejemplo en Python
import requests
requests.get('https://oneuptime.com/heartbeat/YOUR_SECRET_KEY')
```

Reemplaza `https://oneuptime.com` con la URL de tu instancia de OneUptime si es auto-alojada.

## Criterios de monitoreo

Puedes configurar criterios para determinar cuándo tu servicio se considera en línea, degradado o fuera de línea según:

### Tipos de verificación disponibles

| Tipo de verificación                 | Descripción                                                |
| ------------------------------------ | ---------------------------------------------------------- |
| Solicitud entrante                   | Si se recibió un latido dentro de una ventana de tiempo    |
| Cuerpo de la solicitud               | Contenido del cuerpo de la solicitud enviada con el latido |
| Encabezado de la solicitud           | Nombre de un encabezado de solicitud específico            |
| Valor del encabezado de la solicitud | Valor de un encabezado de solicitud específico             |

### Tipos de filtro

Para **Solicitud entrante**:

- **Recibida en minutos**: Se recibió un latido dentro del número de minutos especificado
- **No recibida en minutos**: No se recibió ningún latido dentro del número de minutos especificado

Para **Cuerpo de la solicitud**, **Encabezado de la solicitud** y **Valor del encabezado de la solicitud**:

- **Contiene**: El valor contiene el texto especificado
- **No contiene**: El valor no contiene el texto especificado

### Ejemplos de criterios

#### Marcar como fuera de línea si no hay latido en 10 minutos

- **Verificar en**: Solicitud entrante
- **Tipo de filtro**: No recibida en minutos
- **Valor**: 10

#### Marcar como degradado según el contenido del cuerpo de la solicitud

- **Verificar en**: Cuerpo de la solicitud
- **Tipo de filtro**: Contiene
- **Valor**: `"status": "degraded"`

## Buenas prácticas

1. **Establece la ventana de tiempo apropiada**: Si tu trabajo cron se ejecuta cada 5 minutos, establece el umbral "No recibida en minutos" en 10-15 minutos para permitir retrasos ocasionales
2. **Incluye datos significativos**: Envía información de estado en el cuerpo de la solicitud para poder configurar criterios más detallados
3. **Usa POST para datos enriquecidos**: Usa solicitudes POST con cuerpos JSON cuando necesites enviar información de estado detallada
4. **Monitorea el monitor**: Asegúrate de que el servicio que envía los latidos tenga un manejo de errores adecuado para que las solicitudes de latido fallidas no pasen desapercibidas
