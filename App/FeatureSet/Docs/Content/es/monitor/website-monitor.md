# Monitor de sitio web

El monitoreo de sitios web te permite supervisar la disponibilidad, el rendimiento y la respuesta de cualquier sitio web o página web. OneUptime envía periódicamente solicitudes HTTP a la URL de tu sitio web y verifica si responde correctamente.

## Información general

Los monitores de sitios web verifican tus páginas web realizando solicitudes HTTP y evaluando las respuestas. Esto te permite:

- Monitorear el tiempo de actividad y la disponibilidad del sitio web
- Rastrear los tiempos de respuesta y el rendimiento
- Verificar los códigos de estado HTTP
- Verificar los encabezados de respuesta
- Detectar el tiempo de inactividad antes de que lo hagan tus usuarios

## Creación de un monitor de sitio web

1. Ve a **Monitores** en el panel de OneUptime
2. Haz clic en **Crear monitor**
3. Selecciona **Sitio web** como tipo de monitor
4. Ingresa la URL del sitio web que deseas monitorear
5. Configura los criterios de monitoreo según sea necesario

## Opciones de configuración

### URL del sitio web

Ingresa la URL completa del sitio web que deseas monitorear, incluyendo el protocolo (por ejemplo, `https://example.com`).

### Marcadores de posición de URL dinámicos

Al monitorear URLs detrás de CDNs o proxies de caché, el monitor puede recibir una respuesta en caché en lugar de alcanzar el servidor de origen. Para invalidar el caché en cada verificación, puedes usar marcadores de posición de URL dinámicos que se reemplazan con un valor único en cada solicitud de monitoreo.

#### Marcadores de posición compatibles

| Marcador de posición | Descripción | Valor de ejemplo |
|-------------|-------------|---------------|
| `{{timestamp}}` | Se reemplaza con la marca de tiempo Unix actual (segundos) | `1719500000` |
| `{{random}}` | Se reemplaza con una cadena única aleatoria | `a3f8b2c1d4e5f6a7b8c9d0e1f2a3b4c5` |

#### Ejemplo

Configura la URL de tu monitor con un marcador de posición:

```
https://example.com/health?cb={{timestamp}}
```

En cada verificación de monitoreo, la URL se convierte en:

```
https://example.com/health?cb=1719500000
https://example.com/health?cb=1719500005
...
```

También puedes usar `{{random}}` para una cadena única en cada solicitud:

```
https://example.com/health?nocache={{random}}
```

### Opciones avanzadas

#### No seguir redirecciones

De forma predeterminada, OneUptime sigue las redirecciones HTTP (301, 302, etc.). Habilita esta opción si deseas monitorear la respuesta de redirección en sí en lugar del destino final.

## Criterios de monitoreo

Puedes configurar criterios para determinar cuándo tu sitio web se considera en línea, degradado o fuera de línea según:

- **Código de estado de respuesta**: Verifica si el código de estado HTTP coincide con los valores esperados (por ejemplo, 200, 301)
- **Tiempo de respuesta**: Monitorea si el tiempo de respuesta supera un umbral
- **Cuerpo de respuesta**: Verifica si el cuerpo de respuesta contiene o coincide con contenido específico
- **Encabezados de respuesta**: Verifica que los encabezados de respuesta específicos estén presentes o coincidan con los valores esperados
