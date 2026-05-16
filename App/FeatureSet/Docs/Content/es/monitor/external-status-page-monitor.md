# Monitor de páginas de estado externas

El monitoreo de páginas de estado externas te permite supervisar las páginas de estado de terceros y recibir alertas cuando los servicios de los que dependes sufren interrupciones o rendimiento degradado. OneUptime verifica periódicamente las páginas de estado externas (como AWS, GCP, Azure, GitHub y más) y evalúa su estado.

## Información general

Los monitores de páginas de estado externas verifican el estado de los servicios de los que dependes consultando sus páginas de estado públicas. Esto te permite:

- Monitorear la disponibilidad de servicios de terceros de los que depende tu aplicación
- Recibir alertas cuando los proveedores upstream sufran interrupciones
- Rastrear los estados de los componentes individuales (por ejemplo, "AWS EC2 us-east-1")
- Detectar rendimiento degradado antes de que afecte a tus usuarios
- Correlacionar tus propios incidentes con los problemas de los proveedores upstream

## Proveedores admitidos

OneUptime admite el monitoreo de páginas de estado a través de los siguientes métodos:

| Tipo de proveedor | Descripción |
|---|---|
| **Automático** (predeterminado) | Detecta automáticamente el formato de la página de estado |
| **Atlassian Statuspage** | Páginas de estado basadas en Atlassian Statuspage (API JSON) |
| **RSS** | Páginas de estado que proporcionan un feed RSS |
| **Atom** | Páginas de estado que proporcionan un feed Atom |

### Detección automática

Cuando se establece en **Automático**, OneUptime intentará detectar el formato de la página de estado automáticamente:

1. Primero, prueba la API JSON de Atlassian Statuspage (`/api/v2/status.json` y `/api/v2/components.json`)
2. Si falla, intenta analizar la página como un feed RSS o Atom
3. Como último recurso, realiza una verificación básica de accesibilidad HTTP

## Creación de un monitor de páginas de estado externas

1. Ve a **Monitores** en el panel de OneUptime
2. Haz clic en **Crear monitor**
3. Selecciona **Página de estado externa** como tipo de monitor
4. Ingresa la URL de la página de estado que deseas monitorear
5. Opcionalmente, selecciona un tipo de proveedor específico (o deja como Automático)
6. Opcionalmente, ingresa un nombre de componente para filtrar el monitoreo a un componente específico
7. Configura los criterios de monitoreo según sea necesario

## Opciones de configuración

### URL de la página de estado

Ingresa la URL de la página de estado externa que deseas monitorear. Para sitios basados en Atlassian Statuspage, esto es típicamente la URL raíz (por ejemplo, `https://status.example.com`). Para feeds RSS/Atom, ingresa directamente la URL del feed.

### Tipo de proveedor

Selecciona el tipo de proveedor para la página de estado. Usa **Automático** (predeterminado) para que OneUptime detecte el formato automáticamente, o especifica un tipo de proveedor específico si ya lo conoces.

### Filtro de nombre de componente

Si la página de estado informa sobre múltiples componentes, puedes especificar opcionalmente un nombre de componente para monitorear solo ese componente específico. Por ejemplo, para monitorear solo AWS EC2 en us-east-1, ingresarías `EC2 us-east-1` (el nombre exacto del componente tal como aparece en la página de estado).

Cuando no se especifica ningún nombre de componente, se monitorea el estado general de la página de estado.

### Opciones avanzadas

#### Tiempo de espera

El tiempo máximo (en milisegundos) para esperar una respuesta de la página de estado. El valor predeterminado es 10000ms (10 segundos).

#### Reintentos

El número de veces que se reintenta la solicitud si falla. El valor predeterminado es 3 reintentos.

## Criterios de monitoreo

Puedes configurar criterios para determinar cuándo el servicio externo se considera en línea, degradado o fuera de línea según:

- **Está en línea**: Si la página de estado es accesible y devuelve datos de estado
- **Estado general**: El indicador de estado general de la página de estado (por ejemplo, "operational", "major_outage")
- **Estado del componente**: El estado de un componente específico (cuando se usa el filtro de nombre de componente)
- **Incidentes activos**: El número de incidentes activos actualmente informados en la página de estado
- **Tiempo de respuesta**: Cuánto tiempo tarda en obtenerse los datos de la página de estado

## URLs populares de páginas de estado

Aquí tienes una lista curada de URLs populares de páginas de estado de servicios que puedes monitorear:

| Servicio | URL de la página de estado |
|---|---|
| AWS | `https://health.aws.amazon.com/health/status` |
| Google Cloud Platform | `https://status.cloud.google.com` |
| Microsoft Azure | `https://status.azure.com` |
| GitHub | `https://www.githubstatus.com` |
| Cloudflare | `https://www.cloudflarestatus.com` |
| Datadog | `https://status.datadoghq.com` |
| PagerDuty | `https://status.pagerduty.com` |
| Twilio | `https://status.twilio.com` |
| Stripe | `https://status.stripe.com` |
| Slack | `https://status.slack.com` |
| Atlassian (Jira, Confluence) | `https://status.atlassian.com` |
| Vercel | `https://www.vercel-status.com` |
| Netlify | `https://www.netlifystatus.com` |
| DigitalOcean | `https://status.digitalocean.com` |
| Heroku | `https://status.heroku.com` |
| MongoDB Atlas | `https://status.cloud.mongodb.com` |
| Fastly | `https://status.fastly.com` |
| New Relic | `https://status.newrelic.com` |
| Sentry | `https://status.sentry.io` |
| CircleCI | `https://status.circleci.com` |

> **Nota:** Muchas de estas usan Atlassian Statuspage, por lo que el tipo de proveedor **Automático** las detectará automáticamente.

## Plantillas de incidentes y alertas

Al crear incidentes o alertas desde monitores de páginas de estado externas, puedes usar las siguientes variables de plantilla:

| Variable | Descripción |
|---|---|
| `{{isOnline}}` | Si la página de estado está en línea (verdadero/falso) |
| `{{responseTimeInMs}}` | Tiempo de respuesta en milisegundos |
| `{{failureCause}}` | Razón del fallo, si la hay |
| `{{overallStatus}}` | El valor del indicador de estado general |
| `{{activeIncidentCount}}` | Número de incidentes activos |
| `{{componentStatuses}}` | Arreglo JSON de estados de componentes |

## Buenas prácticas

- **Usa el tipo de proveedor Automático** a menos que conozcas el formato exacto: la detección automática funciona bien para la mayoría de las páginas de estado
- **Monitorea componentes específicos** si solo dependes de ciertos servicios (por ejemplo, una región específica de AWS)
- **Configura la correlación de incidentes**: cuando tus monitores detectan problemas y la página de estado upstream también muestra problemas, ayuda a identificar las causas raíz más rápidamente
- **Combina con otros monitores**: combina los monitores de páginas de estado externas con tus propios monitores de API/sitio web para una visibilidad completa
