# Monitor de trazas

El monitoreo de trazas te permite supervisar las trazas distribuidas de tus aplicaciones y activar alertas basadas en patrones de spans, recuentos y estados. OneUptime evalúa los datos de trazas de tus servicios de telemetría en una ventana de tiempo.

## Información general

Los monitores de trazas buscan y cuentan los spans que coinciden con filtros específicos. Esto te permite:

- Alertar sobre picos de spans de error en tus servicios
- Monitorear operaciones y puntos de conexión específicos
- Rastrear el volumen y los patrones de spans
- Filtrar por estado del span, nombre y atributos personalizados
- Detectar problemas de rendimiento y confiabilidad a partir de datos de trazas

## Creación de un monitor de trazas

1. Ve a **Monitores** en el panel de OneUptime
2. Haz clic en **Crear monitor**
3. Selecciona **Trazas** como tipo de monitor
4. Selecciona los servicios de telemetría a monitorear
5. Configura los filtros de spans y los criterios según sea necesario

## Opciones de configuración

### Servicios de telemetría

Selecciona uno o más servicios desde los que monitorear trazas. Los servicios deben enviar trazas a OneUptime a través de OpenTelemetry.

### Filtros de spans

| Filtro            | Descripción                                                                                                | Requerido |
| ----------------- | ---------------------------------------------------------------------------------------------------------- | --------- |
| Estados de span   | Filtra por código de estado del span (OK, ERROR, UNSET)                                                    | No        |
| Nombre del span   | Búsqueda de texto para nombres de span específicos (por ejemplo, nombres de operación o punto de conexión) | No        |
| Atributos         | Pares clave-valor para filtrar en atributos de span personalizados                                         | No        |
| Ventana de tiempo | Hasta qué punto atrás buscar spans (en segundos, predeterminado: 60)                                       | No        |

### Códigos de estado de span

- **OK**: La operación se completó con éxito
- **ERROR**: La operación encontró un error
- **UNSET**: El estado no se estableció explícitamente

## Criterios de monitoreo

### Tipos de verificación disponibles

| Tipo de verificación | Descripción                                                              |
| -------------------- | ------------------------------------------------------------------------ |
| Recuento de spans    | El número de spans que coinciden con tus filtros en la ventana de tiempo |

### Tipos de filtro

- **Mayor que**: El recuento de spans supera un umbral
- **Menor que**: El recuento de spans está por debajo de un umbral
- **Mayor o igual que**: El recuento de spans está en o por encima de un umbral
- **Menor o igual que**: El recuento de spans está en o por debajo de un umbral
- **Igual a**: El recuento de spans coincide exactamente
- **Diferente de**: El recuento de spans no coincide

### Ejemplos de criterios

#### Alertar si hay más de 50 spans de error en 60 segundos

- **Estados de span**: ERROR
- **Ventana de tiempo**: 60 segundos
- **Verificar en**: Recuento de spans
- **Tipo de filtro**: Mayor que
- **Valor**: 50

#### Alertar sobre errores en un punto de conexión específico

- **Nombre del span**: `POST /api/checkout`
- **Estados de span**: ERROR
- **Ventana de tiempo**: 120 segundos
- **Verificar en**: Recuento de spans
- **Tipo de filtro**: Mayor que
- **Valor**: 0

## Requisitos de configuración

El monitoreo de trazas requiere que tus aplicaciones envíen trazas distribuidas a OneUptime a través de OpenTelemetry. Consulta la documentación de [OpenTelemetry](/docs/telemetry/open-telemetry) para obtener instrucciones de configuración.
