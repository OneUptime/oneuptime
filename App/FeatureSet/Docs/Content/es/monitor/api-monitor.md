# Monitor de API

El monitoreo de API te permite supervisar la disponibilidad, el rendimiento y la corrección de tus APIs HTTP/REST. OneUptime envía periódicamente solicitudes HTTP a tus puntos de conexión de API y evalúa las respuestas según los criterios configurados.

## Información general

Los monitores de API realizan solicitudes HTTP a tus puntos de conexión y verifican las respuestas. Esto te permite:

- Monitorear la disponibilidad y el tiempo de actividad de la API
- Rastrear los tiempos de respuesta y el rendimiento
- Verificar los códigos de estado HTTP y los cuerpos de respuesta
- Validar los encabezados de respuesta
- Probar diferentes métodos HTTP (GET, POST, PUT, DELETE, etc.)
- Enviar encabezados y cuerpos de solicitud personalizados

## Creación de un monitor de API

1. Ve a **Monitores** en el panel de OneUptime
2. Haz clic en **Crear monitor**
3. Selecciona **API** como tipo de monitor
4. Ingresa la URL de la API y configura los ajustes de la solicitud
5. Configura los criterios de monitoreo según sea necesario

## Opciones de configuración

### URL de la API

Ingresa la URL completa del punto de conexión de la API que deseas monitorear (por ejemplo, `https://api.example.com/v1/health`).

### Marcadores de posición de URL dinámicos

Al monitorear APIs detrás de CDNs o proxies de caché, el monitor puede recibir una respuesta en caché en lugar de alcanzar el servidor de origen. Para invalidar el caché en cada verificación, puedes usar marcadores de posición de URL dinámicos que se reemplazan con un valor único en cada solicitud de monitoreo.

#### Marcadores de posición compatibles

| Marcador de posición | Descripción | Valor de ejemplo |
|-------------|-------------|---------------|
| `{{timestamp}}` | Se reemplaza con la marca de tiempo Unix actual (segundos) | `1719500000` |
| `{{random}}` | Se reemplaza con una cadena única aleatoria | `a3f8b2c1d4e5f6a7b8c9d0e1f2a3b4c5` |

#### Ejemplo

Configura la URL de tu monitor con un marcador de posición:

```
https://api.example.com/health?cb={{timestamp}}
```

En cada verificación de monitoreo, la URL se convierte en:

```
https://api.example.com/health?cb=1719500000
https://api.example.com/health?cb=1719500005
...
```

También puedes usar `{{random}}` para una cadena única en cada solicitud:

```
https://api.example.com/health?nocache={{random}}
```

### Tipo de solicitud de API

Selecciona el método HTTP para la solicitud:

- **GET** (predeterminado)
- **POST**
- **PUT**
- **DELETE**
- **PATCH**
- **HEAD**

### Opciones avanzadas

#### Encabezados de solicitud

Agrega encabezados HTTP personalizados a la solicitud. Esto es útil para tokens de autenticación, especificaciones de tipo de contenido y otros encabezados específicos de la API.

Puedes usar [Secretos de monitor](/docs/monitor/monitor-secrets) en los valores de los encabezados para almacenar de forma segura datos sensibles como claves de API.

#### Cuerpo de la solicitud (JSON)

Para solicitudes POST, PUT y PATCH, puedes especificar un cuerpo de solicitud JSON. También puedes usar [Secretos de monitor](/docs/monitor/monitor-secrets) en el cuerpo de la solicitud.

#### No seguir redirecciones

De forma predeterminada, OneUptime sigue las redirecciones HTTP (301, 302, etc.). Habilita esta opción si deseas monitorear la respuesta de redirección en sí en lugar del destino final.

## Criterios de monitoreo

Puedes configurar criterios para determinar cuándo tu API se considera en línea, degradada o fuera de línea según:

- **Código de estado de respuesta**: Verifica si el código de estado HTTP coincide con los valores esperados (por ejemplo, 200, 201)
- **Tiempo de respuesta**: Monitorea si el tiempo de respuesta supera un umbral
- **Cuerpo de respuesta**: Verifica si el cuerpo de respuesta contiene o coincide con contenido específico
- **Encabezados de respuesta**: Verifica que los encabezados de respuesta específicos estén presentes o coincidan con los valores esperados
- **Expresión JavaScript**: Escribe expresiones personalizadas para evaluar la respuesta. Consulta [Expresiones JavaScript](/docs/monitor/javascript-expression) para más detalles.
