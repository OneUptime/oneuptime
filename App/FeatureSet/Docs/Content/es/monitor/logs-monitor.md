# Monitor de registros

El monitoreo de registros te permite supervisar los registros de tu aplicación y activar alertas basadas en patrones de registro, recuentos y niveles de gravedad. OneUptime evalúa los registros de tus servicios de telemetría y los verifica según tus criterios configurados.

## Información general

Los monitores de registros buscan y cuentan los registros que coinciden con filtros específicos en una ventana de tiempo. Esto te permite:

- Alertar sobre picos de registros de error
- Monitorear patrones o mensajes de registro específicos
- Rastrear el volumen de registros por nivel de gravedad
- Filtrar registros por servicio, atributos y contenido
- Detectar problemas de la aplicación a partir de patrones de registro

## Creación de un monitor de registros

1. Ve a **Monitores** en el panel de OneUptime
2. Haz clic en **Crear monitor**
3. Selecciona **Registros** como tipo de monitor
4. Selecciona los servicios de telemetría a monitorear
5. Configura los filtros de registros y los criterios según sea necesario

## Opciones de configuración

### Servicios de telemetría

Selecciona uno o más servicios desde los que monitorear registros. Los servicios deben enviar registros a OneUptime a través de OpenTelemetry.

### Filtros de registros

| Filtro              | Descripción                                                              | Requerido |
| ------------------- | ------------------------------------------------------------------------ | --------- |
| Niveles de gravedad | Filtra por gravedad del registro (ERROR, WARN, INFO, DEBUG, etc.)        | No        |
| Cuerpo              | Búsqueda de texto dentro del cuerpo del mensaje de registro              | No        |
| Atributos           | Pares clave-valor para filtrar en atributos de registro personalizados   | No        |
| Ventana de tiempo   | Hasta qué punto atrás buscar registros (en segundos, predeterminado: 60) | No        |

### Niveles de gravedad

Filtra los registros por uno o más niveles de gravedad:

- **FATAL** / **EMERGENCY** / **CRITICAL**
- **ERROR**
- **WARN** / **WARNING**
- **INFO** / **INFORMATIONAL**
- **DEBUG**
- **TRACE**
- **UNSPECIFIED**

## Criterios de monitoreo

### Tipos de verificación disponibles

| Tipo de verificación  | Descripción                                                                  |
| --------------------- | ---------------------------------------------------------------------------- |
| Recuento de registros | El número de registros que coinciden con tus filtros en la ventana de tiempo |

### Tipos de filtro

- **Mayor que**: El recuento de registros supera un umbral
- **Menor que**: El recuento de registros está por debajo de un umbral
- **Mayor o igual que**: El recuento de registros está en o por encima de un umbral
- **Menor o igual que**: El recuento de registros está en o por debajo de un umbral
- **Igual a**: El recuento de registros coincide exactamente
- **Diferente de**: El recuento de registros no coincide

### Ejemplos de criterios

#### Alertar si hay más de 100 registros de error en 60 segundos

- **Niveles de gravedad**: ERROR
- **Ventana de tiempo**: 60 segundos
- **Verificar en**: Recuento de registros
- **Tipo de filtro**: Mayor que
- **Valor**: 100

#### Alertar si aparece algún registro fatal

- **Niveles de gravedad**: FATAL
- **Ventana de tiempo**: 60 segundos
- **Verificar en**: Recuento de registros
- **Tipo de filtro**: Mayor que
- **Valor**: 0

#### Monitorear registros que contienen un mensaje de error específico

- **Cuerpo**: `database connection timeout`
- **Ventana de tiempo**: 300 segundos
- **Verificar en**: Recuento de registros
- **Tipo de filtro**: Mayor que
- **Valor**: 5

## Requisitos de configuración

El monitoreo de registros requiere que tus aplicaciones envíen registros a OneUptime a través de OpenTelemetry. Consulta la documentación de [OpenTelemetry](/docs/telemetry/open-telemetry) para obtener instrucciones de configuración.
