# Monitor Ping

El monitoreo Ping te permite supervisar la disponibilidad y la capacidad de respuesta de cualquier host o dirección IP. OneUptime envía periódicamente solicitudes de ping a tu objetivo y verifica si responde correctamente.

## Información general

Los monitores Ping prueban la conectividad de red básica enviando solicitudes de ping ICMP a un host. Esto te permite:

- Monitorear el tiempo de actividad y la disponibilidad del host
- Rastrear la latencia y los tiempos de respuesta de la red
- Detectar problemas de conectividad antes de que afecten a tus servicios
- Verificar que los servidores y los dispositivos de red sean accesibles

## Creación de un monitor Ping

1. Ve a **Monitores** en el panel de OneUptime
2. Haz clic en **Crear monitor**
3. Selecciona **Ping** como tipo de monitor
4. Ingresa el nombre de host o la dirección IP que deseas monitorear
5. Configura los criterios de monitoreo según sea necesario

## Opciones de configuración

### Nombre de host o dirección IP del ping

Ingresa el nombre de host o la dirección IP del objetivo que deseas monitorear (por ejemplo, `example.com` o `192.168.1.1`). Se aceptan tanto nombres de host como direcciones IP.

## Criterios de monitoreo

Puedes configurar criterios para determinar cuándo tu host se considera en línea, degradado o fuera de línea según:

### Tipos de verificación disponibles

| Tipo de verificación                    | Descripción                                                    |
| --------------------------------------- | -------------------------------------------------------------- |
| Está en línea                           | Si el host responde a las solicitudes de ping                  |
| Tiempo de respuesta (en ms)             | Tiempo de ida y vuelta de la solicitud de ping en milisegundos |
| La solicitud superó el tiempo de espera | Si la solicitud de ping superó el tiempo de espera             |

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

#### Marcar como fuera de línea si el host no es accesible

- **Verificar en**: Está en línea
- **Tipo de filtro**: Falso

#### Alertar si el tiempo de respuesta supera los 200ms

- **Verificar en**: Tiempo de respuesta (en ms)
- **Tipo de filtro**: Mayor que
- **Valor**: 200
