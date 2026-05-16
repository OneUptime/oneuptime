# Monitor de perfiles

El monitoreo de perfiles te permite supervisar los datos de perfilado continuo de tus aplicaciones y activar alertas basadas en recuentos y patrones de perfiles. OneUptime evalúa los datos de perfiles de tus servicios de telemetría en una ventana de tiempo.

## Información general

Los monitores de perfiles cuentan y filtran los datos de perfilado que coinciden con criterios específicos. Esto te permite:

- Monitorear los datos de perfilado continuo de tus aplicaciones
- Filtrar perfiles por tipo (CPU, memoria, goroutines, etc.)
- Rastrear el volumen y los patrones de perfiles
- Alertar sobre anomalías de perfilado
- Filtrar por atributos de perfil personalizados

## Creación de un monitor de perfiles

1. Ve a **Monitores** en el panel de OneUptime
2. Haz clic en **Crear monitor**
3. Selecciona **Perfiles** como tipo de monitor
4. Selecciona los servicios de telemetría a monitorear
5. Configura los filtros de perfiles y los criterios según sea necesario

## Opciones de configuración

### Servicios de telemetría

Selecciona uno o más servicios desde los que monitorear perfiles. Los servicios deben enviar datos de perfilado continuo a OneUptime a través de OpenTelemetry.

### Filtros de perfiles

| Filtro | Descripción | Requerido |
|--------|-------------|----------|
| Tipos de perfil | Filtra por nombres de tipos de perfil (por ejemplo, CPU, memoria, goroutines) | No |
| Atributos | Pares clave-valor para filtrar en atributos de perfil personalizados | No |
| Ventana de tiempo | Hasta qué punto atrás buscar perfiles (en segundos, predeterminado: 60) | No |

## Criterios de monitoreo

### Tipos de verificación disponibles

| Tipo de verificación | Descripción |
|------------|-------------|
| Recuento de perfiles | El número de perfiles que coinciden con tus filtros en la ventana de tiempo |

### Tipos de filtro

- **Mayor que**: El recuento de perfiles supera un umbral
- **Menor que**: El recuento de perfiles está por debajo de un umbral
- **Mayor o igual que**: El recuento de perfiles está en o por encima de un umbral
- **Menor o igual que**: El recuento de perfiles está en o por debajo de un umbral
- **Igual a**: El recuento de perfiles coincide exactamente
- **Diferente de**: El recuento de perfiles no coincide

### Ejemplos de criterios

#### Alertar si no se reciben perfiles en 5 minutos

- **Ventana de tiempo**: 300 segundos
- **Verificar en**: Recuento de perfiles
- **Tipo de filtro**: Igual a
- **Valor**: 0

## Requisitos de configuración

El monitoreo de perfiles requiere que tus aplicaciones envíen datos de perfilado continuo a OneUptime a través de OpenTelemetry. Consulta la documentación de [OpenTelemetry](/docs/telemetry/open-telemetry) para obtener instrucciones de configuración.
