# Monitor de dominio

El monitoreo de dominio te permite supervisar el estado de registro y la caducidad de tus nombres de dominio. OneUptime realiza búsquedas WHOIS periódicamente para rastrear el estado de tu dominio y alertarte antes de que caduque.

## Información general

Los monitores de dominio consultan datos WHOIS para tus dominios con el fin de rastrear los detalles de registro. Esto te permite:

- Monitorear las fechas de caducidad del dominio
- Detectar dominios expirados o que están a punto de expirar
- Rastrear la información del registrador de dominio
- Verificar la configuración del servidor de nombres
- Monitorear los códigos de estado del dominio

## Creación de un monitor de dominio

1. Ve a **Monitores** en el panel de OneUptime
2. Haz clic en **Crear monitor**
3. Selecciona **Dominio** como tipo de monitor
4. Ingresa el nombre de dominio que deseas monitorear
5. Configura los criterios de monitoreo según sea necesario

## Opciones de configuración

### Configuración básica

| Campo | Descripción | Requerido |
|-------|-------------|----------|
| Nombre de dominio | El dominio a monitorear (por ejemplo, `example.com`) | Sí |

### Configuración avanzada

| Campo | Descripción | Predeterminado |
|-------|-------------|---------|
| Tiempo de espera (ms) | Tiempo de espera para una respuesta WHOIS | 10000 |
| Reintentos | Número de intentos de reintento en caso de fallo | 3 |

## Criterios de monitoreo

Puedes configurar criterios para determinar cuándo tu dominio se considera en línea, degradado o fuera de línea según:

### Tipos de verificación disponibles

| Tipo de verificación | Descripción |
|------------|-------------|
| El dominio caduca en días | Número de días hasta que caduca el registro del dominio |
| Registrador del dominio | El nombre del registrador del dominio |
| Servidor de nombres del dominio | Nombres de host de servidores de nombres para el dominio |
| Código de estado del dominio | Códigos de estado WHOIS del dominio |
| El dominio está caducado | Si el dominio ha caducado |

### Tipos de filtro

Para **El dominio está caducado**:

- **Verdadero**: El dominio ha caducado
- **Falso**: El dominio no ha caducado

Para **El dominio caduca en días**:

- **Mayor que**, **Menor que**, **Mayor o igual que**, **Menor o igual que**, **Igual a**, **Diferente de**

Para **Registrador del dominio**, **Servidor de nombres del dominio** y **Código de estado del dominio**:

- **Contiene**: El valor contiene el texto especificado
- **No contiene**: El valor no contiene el texto especificado
- **Comienza con**: El valor comienza con el texto especificado
- **Termina con**: El valor termina con el texto especificado
- **Igual a**: El valor coincide exactamente
- **Diferente de**: El valor no coincide

### Ejemplos de criterios

#### Alertar si el dominio caduca en 30 días

- **Verificar en**: El dominio caduca en días
- **Tipo de filtro**: Menor que
- **Valor**: 30

#### Marcar como fuera de línea si el dominio está caducado

- **Verificar en**: El dominio está caducado
- **Tipo de filtro**: Verdadero

#### Verificar que los servidores de nombres sean correctos

- **Verificar en**: Servidor de nombres del dominio
- **Tipo de filtro**: Contiene
- **Valor**: `ns1.example.com`

## Buenas prácticas

1. **Establece alertas tempranas**: Configura alertas de degradación a los 60 días y alertas de fuera de línea a los 14 días antes del vencimiento
2. **Monitorea todos los dominios críticos**: Incluye dominios principales, subdominios registrados por separado y cualquier dominio usado para correo electrónico o APIs
3. **Rastrea cambios de registrador**: Monitorea el campo del registrador para detectar transferencias no autorizadas de dominio
