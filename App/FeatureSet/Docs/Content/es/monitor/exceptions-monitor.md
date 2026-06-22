# Monitor de excepciones

El monitoreo de excepciones te permite supervisar las excepciones y errores de la aplicación, activando alertas cuando los recuentos de excepciones superan tus umbrales configurados. OneUptime evalúa los datos de excepciones de tus servicios de telemetría en una ventana de tiempo.

## Información general

Los monitores de excepciones cuentan y filtran las excepciones que coinciden con criterios específicos. Esto te permite:

- Alertar sobre picos de excepciones en tus aplicaciones
- Monitorear tipos específicos de excepciones
- Buscar excepciones por mensaje de error
- Rastrear por separado las excepciones resueltas y activas
- Detectar problemas de estabilidad de la aplicación a partir de patrones de error

## Creación de un monitor de excepciones

1. Ve a **Monitores** en el panel de OneUptime
2. Haz clic en **Crear monitor**
3. Selecciona **Excepciones** como tipo de monitor
4. Selecciona los servicios de telemetría a monitorear
5. Configura los filtros de excepciones y los criterios según sea necesario

## Opciones de configuración

### Servicios de telemetría

Selecciona uno o más servicios desde los que monitorear excepciones. Los servicios deben enviar datos de excepciones a OneUptime a través de OpenTelemetry.

### Filtros de excepciones

| Filtro             | Descripción                                                                                 | Requerido |
| ------------------ | ------------------------------------------------------------------------------------------- | --------- |
| Tipos de excepción | Filtra por nombres de tipos de excepción (por ejemplo, `NullPointerException`, `TypeError`) | No        |
| Mensaje            | Búsqueda de texto dentro de los mensajes de excepción                                       | No        |
| Incluir resueltas  | Incluye excepciones que han sido marcadas como resueltas (predeterminado: falso)            | No        |
| Incluir archivadas | Incluye excepciones que han sido archivadas (predeterminado: falso)                         | No        |
| Ventana de tiempo  | Hasta qué punto atrás buscar excepciones (en segundos, predeterminado: 60)                  | No        |

## Criterios de monitoreo

### Tipos de verificación disponibles

| Tipo de verificación    | Descripción                                                                    |
| ----------------------- | ------------------------------------------------------------------------------ |
| Recuento de excepciones | El número de excepciones que coinciden con tus filtros en la ventana de tiempo |

### Tipos de filtro

- **Mayor que**: El recuento de excepciones supera un umbral
- **Menor que**: El recuento de excepciones está por debajo de un umbral
- **Mayor o igual que**: El recuento de excepciones está en o por encima de un umbral
- **Menor o igual que**: El recuento de excepciones está en o por debajo de un umbral
- **Igual a**: El recuento de excepciones coincide exactamente
- **Diferente de**: El recuento de excepciones no coincide

### Ejemplos de criterios

#### Alertar si hay más de 10 excepciones en 60 segundos

- **Ventana de tiempo**: 60 segundos
- **Verificar en**: Recuento de excepciones
- **Tipo de filtro**: Mayor que
- **Valor**: 10

#### Alertar sobre cualquier NullPointerException

- **Tipos de excepción**: `NullPointerException`
- **Ventana de tiempo**: 60 segundos
- **Verificar en**: Recuento de excepciones
- **Tipo de filtro**: Mayor que
- **Valor**: 0

#### Monitorear excepciones que contienen un mensaje específico

- **Mensaje**: `out of memory`
- **Ventana de tiempo**: 300 segundos
- **Verificar en**: Recuento de excepciones
- **Tipo de filtro**: Mayor que
- **Valor**: 0

## Requisitos de configuración

El monitoreo de excepciones requiere que tus aplicaciones envíen datos de excepciones a OneUptime a través de OpenTelemetry. Consulta la documentación de [OpenTelemetry](/docs/telemetry/open-telemetry) para instrucciones de configuración.
