# Monitor de puerto

El monitoreo de puertos te permite supervisar la disponibilidad de puertos TCP o UDP específicos en un host. OneUptime intenta periódicamente conectarse al puerto especificado y verifica si está abierto y responde.

## Información general

Los monitores de puertos prueban si un puerto de red específico acepta conexiones. Esto te permite:

- Monitorear la disponibilidad de servicios en puertos específicos
- Rastrear los tiempos de respuesta de los puertos
- Verificar que servicios como bases de datos, servidores de correo y servidores de aplicaciones estén en ejecución
- Detectar interrupciones del servicio antes de que afecten a los usuarios

## Creación de un monitor de puerto

1. Ve a **Monitores** en el panel de OneUptime
2. Haz clic en **Crear monitor**
3. Selecciona **Puerto** como tipo de monitor
4. Ingresa el nombre de host o la dirección IP y el número de puerto
5. Configura los criterios de monitoreo según sea necesario

## Opciones de configuración

### Nombre de host o dirección IP

Ingresa el nombre de host o la dirección IP del host objetivo (por ejemplo, `example.com` o `192.168.1.1`).

### Puerto

Ingresa el número de puerto a monitorear (1–65535). Ejemplos comunes:

| Puerto | Servicio   |
| ------ | ---------- |
| 22     | SSH        |
| 25     | SMTP       |
| 80     | HTTP       |
| 443    | HTTPS      |
| 3306   | MySQL      |
| 5432   | PostgreSQL |
| 6379   | Redis      |
| 27017  | MongoDB    |

## Criterios de monitoreo

Puedes configurar criterios para determinar cuándo tu puerto se considera en línea, degradado o fuera de línea según:

### Tipos de verificación disponibles

| Tipo de verificación                    | Descripción                                          |
| --------------------------------------- | ---------------------------------------------------- |
| Está en línea                           | Si el puerto está abierto y acepta conexiones        |
| Tiempo de respuesta (en ms)             | Tiempo para establecer una conexión en milisegundos  |
| La solicitud superó el tiempo de espera | Si el intento de conexión superó el tiempo de espera |

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

#### Marcar como fuera de línea si el puerto está cerrado

- **Verificar en**: Está en línea
- **Tipo de filtro**: Falso

#### Alertar si el tiempo de conexión supera los 500ms

- **Verificar en**: Tiempo de respuesta (en ms)
- **Tipo de filtro**: Mayor que
- **Valor**: 500

#### Marcar como degradado si la conexión es lenta

- **Verificar en**: Tiempo de respuesta (en ms)
- **Tipo de filtro**: Mayor que
- **Valor**: 200
