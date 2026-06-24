# Monitor de métricas

El monitoreo de métricas te permite supervisar métricas personalizadas de aplicaciones e infraestructura recopiladas a través de OpenTelemetry. OneUptime evalúa los valores de las métricas en una ventana de tiempo y activa alertas según tus criterios configurados.

## Información general

Los monitores de métricas consultan y evalúan métricas numéricas de tus servicios de telemetría. Esto te permite:

- Monitorear métricas personalizadas de la aplicación (tasas de solicitud, profundidades de cola, tasas de error, etc.)
- Rastrear métricas de infraestructura (CPU, memoria, disco, red)
- Crear consultas de métricas complejas con filtros y agregaciones
- Combinar múltiples métricas usando fórmulas matemáticas
- Establecer alertas basadas en umbrales de métricas

## Creación de un monitor de métricas

1. Ve a **Monitores** en el panel de OneUptime
2. Haz clic en **Crear monitor**
3. Selecciona **Métricas** como tipo de monitor
4. Configura las consultas de métricas y las fórmulas opcionales
5. Selecciona la estrategia de agregación
6. Configura los criterios de monitoreo según sea necesario

## Opciones de configuración

### Consultas de métricas

Define una o más consultas de métricas. Cada consulta incluye:

| Campo                | Descripción                                                                                    | Requerido |
| -------------------- | ---------------------------------------------------------------------------------------------- | --------- |
| Nombre de la métrica | El nombre de la métrica a consultar                                                            | Sí        |
| Tipo de agregación   | Cómo agregar los valores de la métrica sin procesar (suma, promedio, mínimo, máximo, recuento) | Sí        |
| Atributos            | Filtros clave-valor para limitar los datos de la métrica                                       | No        |
| Agregar por          | Dimensiones por las que agrupar la métrica                                                     | No        |

Cada consulta recibe un alias (por ejemplo, `a`, `b`, `c`) para usar en fórmulas.

### Fórmulas

Combina múltiples consultas de métricas usando expresiones matemáticas. Por ejemplo:

- `a / b * 100`: Calcular un porcentaje de dos consultas
- `a + b`: Sumar dos métricas
- `a - b`: Diferencia entre métricas

### Ventana de tiempo deslizante

Selecciona la ventana de tiempo para la evaluación de métricas:

- Último 1 minuto
- Últimos 5 minutos
- Últimos 10 minutos
- Últimos 15 minutos
- Últimos 30 minutos
- Últimos 60 minutos

### Estrategia de agregación

Elige cómo agregar los valores de las métricas para la evaluación:

| Estrategia        | Descripción                                         |
| ----------------- | --------------------------------------------------- |
| Promedio          | Valor promedio durante la ventana de tiempo         |
| Suma              | Suma de todos los valores                           |
| Valor máximo      | Valor más alto en la ventana de tiempo              |
| Valor mínimo      | Valor más bajo en la ventana de tiempo              |
| Todos los valores | Todos los valores deben coincidir con los criterios |
| Cualquier valor   | Al menos un valor debe coincidir                    |

## Criterios de monitoreo

### Tipos de verificación disponibles

| Tipo de verificación | Descripción                                                       |
| -------------------- | ----------------------------------------------------------------- |
| Valor de métrica     | El valor agregado de la consulta de métrica o fórmula configurada |

### Tipos de filtro

- **Mayor que**: El valor de la métrica supera un umbral
- **Menor que**: El valor de la métrica está por debajo de un umbral
- **Mayor o igual que**: El valor de la métrica está en o por encima de un umbral
- **Menor o igual que**: El valor de la métrica está en o por debajo de un umbral
- **Igual a**: El valor de la métrica coincide exactamente
- **Diferente de**: El valor de la métrica no coincide

### Ejemplos de criterios

#### Alertar si la tasa de error supera el 5%

- **Consulta a**: `http_requests_total` filtrado por `status=5xx`
- **Consulta b**: `http_requests_total`
- **Fórmula**: `a / b * 100`
- **Verificar en**: Valor de métrica
- **Tipo de filtro**: Mayor que
- **Valor**: 5

#### Alertar si la profundidad de la cola de solicitudes es alta

- **Consulta**: `request_queue_size`, agregación: Valor máximo
- **Verificar en**: Valor de métrica
- **Tipo de filtro**: Mayor que
- **Valor**: 1000

## Requisitos de configuración

El monitoreo de métricas requiere que tus aplicaciones o infraestructura envíen métricas a OneUptime a través de OpenTelemetry. Consulta la documentación de [OpenTelemetry](/docs/telemetry/open-telemetry) para obtener instrucciones de configuración.
