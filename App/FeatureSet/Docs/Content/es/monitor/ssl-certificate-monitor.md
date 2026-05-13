# Monitor de certificado SSL

El monitoreo de certificados SSL te permite supervisar la validez y la caducidad de los certificados SSL/TLS en tus sitios web y servicios. OneUptime verifica periódicamente tus certificados y te alerta antes de que caduquen o si se detecta algún problema.

## Información general

Los monitores de certificados SSL se conectan a tus puntos de conexión HTTPS e inspeccionan el certificado SSL/TLS. Esto te permite:

- Monitorear las fechas de caducidad de los certificados
- Detectar certificados caducados o a punto de caducar
- Identificar certificados firmados automáticamente
- Verificar la validez del certificado
- Prevenir interrupciones del servicio causadas por certificados caducados

## Creación de un monitor de certificado SSL

1. Ve a **Monitores** en el panel de OneUptime
2. Haz clic en **Crear monitor**
3. Selecciona **Certificado SSL** como tipo de monitor
4. Ingresa la URL del punto de conexión HTTPS a verificar
5. Configura los criterios de monitoreo según sea necesario

## Opciones de configuración

### URL

Ingresa la URL HTTPS completa del punto de conexión cuyo certificado SSL deseas monitorear (por ejemplo, `https://example.com` o `https://example.com:8443`).

## Criterios de monitoreo

Puedes configurar criterios para determinar cuándo el estado de tu certificado se considera en línea, degradado o fuera de línea según:

### Tipos de verificación disponibles

| Tipo de verificación | Descripción |
|------------|-------------|
| Está en línea | Si el servidor es accesible |
| El certificado es válido | Si el certificado es válido (no caducado, no firmado automáticamente) |
| El certificado está firmado automáticamente | Si el certificado está firmado automáticamente |
| El certificado está caducado | Si el certificado ha caducado |
| El certificado no es válido | Si el certificado no es válido |
| Caduca en horas | Número de horas hasta que caduca el certificado |
| Caduca en días | Número de días hasta que caduca el certificado |
| La solicitud superó el tiempo de espera | Si la conexión superó el tiempo de espera |

### Tipos de filtro

Para **Está en línea**, **El certificado es válido**, **El certificado está firmado automáticamente**, **El certificado está caducado**, **El certificado no es válido** y **La solicitud superó el tiempo de espera**:

- **Verdadero**: La condición es verdadera
- **Falso**: La condición es falsa

Para **Caduca en horas** y **Caduca en días**:

- **Mayor que**: La caducidad está a más del valor especificado
- **Menor que**: La caducidad está a menos del valor especificado
- **Mayor o igual que**: La caducidad está al nivel o por encima del valor especificado
- **Menor o igual que**: La caducidad está al nivel o por debajo del valor especificado
- **Igual a**: La caducidad coincide exactamente
- **Diferente de**: La caducidad no coincide

### Ejemplos de criterios

#### Marcar como degradado si el certificado caduca en 30 días

- **Verificar en**: Caduca en días
- **Tipo de filtro**: Menor que
- **Valor**: 30

#### Marcar como fuera de línea si el certificado está caducado

- **Verificar en**: El certificado está caducado
- **Tipo de filtro**: Verdadero

#### Alertar si el certificado está firmado automáticamente

- **Verificar en**: El certificado está firmado automáticamente
- **Tipo de filtro**: Verdadero

#### Marcar como fuera de línea si el certificado no es válido

- **Verificar en**: El certificado no es válido
- **Tipo de filtro**: Verdadero

## Buenas prácticas

1. **Establece múltiples umbrales**: Usa el estado degradado a los 30 días y fuera de línea a los 7 días antes del vencimiento para darte tiempo suficiente para renovar
2. **Monitorea todos los puntos de conexión**: Si tienes múltiples dominios o subdominios, crea un monitor para cada uno
3. **Incluye puertos no estándar**: No olvides los servicios que ejecutan HTTPS en puertos no estándar
4. **Monitorea después de la renovación**: Después de renovar un certificado, verifica que el monitor confirme que es válido
