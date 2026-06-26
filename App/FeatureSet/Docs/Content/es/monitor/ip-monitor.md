# Monitor de IP

El monitoreo de IP te permite supervisar la disponibilidad y capacidad de respuesta de cualquier dirección IPv4 o IPv6. OneUptime prueba periódicamente la conectividad con la dirección IP objetivo e informa su estado.

## Información general

Los monitores de IP verifican que una dirección IP específica sea accesible y responda. Esto te permite:

- Monitorear la disponibilidad de direcciones IPv4 e IPv6
- Rastrear los tiempos de respuesta y la latencia
- Detectar problemas de conectividad de red
- Verificar que los puntos de conexión de infraestructura sean accesibles

## Creación de un monitor de IP

1. Ve a **Monitores** en el panel de OneUptime
2. Haz clic en **Crear monitor**
3. Selecciona **IP** como tipo de monitor
4. Ingresa la dirección IP que deseas monitorear
5. Configura los criterios de monitoreo según sea necesario

## Opciones de configuración

### Dirección IP

Ingresa la dirección IPv4 o IPv6 que deseas monitorear (por ejemplo, `192.168.1.1` o `2001:db8::1`). El valor debe ser un formato de dirección IP válido.

## Criterios de monitoreo

Puedes configurar criterios para determinar cuándo tu dirección IP se considera en línea, degradada o fuera de línea según:

### Tipos de verificación disponibles

| Tipo de verificación                    | Descripción                                |
| --------------------------------------- | ------------------------------------------ |
| Está en línea                           | Si la dirección IP es accesible            |
| Tiempo de respuesta (en ms)             | Tiempo de respuesta en milisegundos        |
| La solicitud superó el tiempo de espera | Si la solicitud superó el tiempo de espera |

### Tipos de filtro

Para **Está en línea** y **La solicitud superó el tiempo de espera**:

- **Verdadero**: La condición es verdadera
- **Falso**: La condición es falsa

Para **Tiempo de respuesta**:

- **Mayor que**: El tiempo de respuesta supera un umbral
- **Menor que**: El tiempo de respuesta está por debajo de un umbral
- **Mayor o igual que**: El tiempo de respuesta está en o por encima de un umbral
- **Menor o igual que**: El tiempo de respuesta está en o por debajo de un umbral
- **Igual a**: El tiempo de respuesta coincide exactamente
- **Diferente de**: El tiempo de respuesta no coincide
- **Evaluar en el tiempo**: Evaluar usando agregación (Promedio, Suma, Máximo, Mínimo, Todos los valores, Cualquier valor) sobre una ventana de tiempo

### Ejemplos de criterios

#### Marcar como fuera de línea si la IP no es accesible

- **Verificar en**: Está en línea
- **Tipo de filtro**: Falso

#### Alertar si la latencia supera los 100ms

- **Verificar en**: Tiempo de respuesta (en ms)
- **Tipo de filtro**: Mayor que
- **Valor**: 100
