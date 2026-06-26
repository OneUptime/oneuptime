# Monitor de servidor / VM

El monitoreo de servidores y VMs te permite supervisar el estado y el rendimiento de tus servidores, máquinas virtuales y otra infraestructura instalando un agente ligero que reporta métricas del sistema a OneUptime.

## Información general

Los monitores de servidor usan un agente de infraestructura instalado en tus servidores para recopilar y reportar métricas del sistema. Esto te permite:

- Monitorear el tiempo de actividad y la disponibilidad del servidor
- Rastrear el uso de CPU, memoria y disco
- Monitorear los procesos en ejecución
- Establecer alertas basadas en umbrales de utilización de recursos
- Detectar problemas de infraestructura antes de que afecten a tus servicios

## Creación de un monitor de servidor

1. Ve a **Monitores** en el panel de OneUptime
2. Haz clic en **Crear monitor**
3. Selecciona **Servidor / VM** como tipo de monitor
4. Se generará una **Clave secreta** para este monitor; la necesitarás para configurar el agente
5. Sigue las instrucciones de instalación para configurar el agente en tu servidor

## Instalación del Agente de infraestructura

El Agente de infraestructura de OneUptime es un demonio ligero basado en Go que recopila métricas del sistema y las envía a OneUptime cada 30 segundos. Compatible con Linux, macOS y Windows.

### Linux / macOS

```bash
# Instalar el agente
curl -sSL https://oneuptime.com/docs/static/scripts/infrastructure-agent/install.sh | sudo bash

# Configurar el agente
sudo oneuptime-infrastructure-agent configure --secret-key=YOUR_SECRET_KEY --oneuptime-url=https://oneuptime.com

# Iniciar el agente
sudo oneuptime-infrastructure-agent start
```

Reemplaza `YOUR_SECRET_KEY` con la clave secreta mostrada en la configuración de tu monitor, y `https://oneuptime.com` con la URL de tu instancia de OneUptime si es auto-alojada.

### Windows

1. Descarga el último agente desde [GitHub Releases](https://github.com/OneUptime/oneuptime/releases/latest)
   - `oneuptime-infrastructure-agent_windows_amd64.zip` para sistemas x64
   - `oneuptime-infrastructure-agent_windows_arm64.zip` para sistemas ARM64
2. Extrae el archivo zip
3. Abre el Símbolo del sistema como administrador y ejecuta:

```bash
# Configurar el agente
oneuptime-infrastructure-agent configure --secret-key=YOUR_SECRET_KEY --oneuptime-url=https://oneuptime.com

# Iniciar el agente
oneuptime-infrastructure-agent start
```

### Soporte para proxy

Si tu servidor se conecta a internet a través de un proxy, puedes configurar el agente para usarlo:

```bash
sudo oneuptime-infrastructure-agent configure --secret-key=YOUR_SECRET_KEY --oneuptime-url=https://oneuptime.com --proxy-url=http://proxy.example.com:8080
```

## Comandos del agente

El agente de infraestructura admite los siguientes comandos:

| Comando     | Descripción                                                                          |
| ----------- | ------------------------------------------------------------------------------------ |
| `configure` | Configurar el agente con tu clave secreta y la URL de OneUptime                      |
| `start`     | Iniciar el servicio del agente                                                       |
| `stop`      | Detener el servicio del agente                                                       |
| `restart`   | Reiniciar el servicio del agente                                                     |
| `status`    | Mostrar el estado actual del servicio                                                |
| `logs`      | Ver los registros del agente (usa `-n` para el recuento de líneas, `-f` para seguir) |
| `uninstall` | Desinstalar el servicio del agente                                                   |

## Métricas recopiladas

El agente recopila las siguientes métricas de tu servidor:

### CPU

- **Porcentaje de uso de CPU**: Utilización general de CPU como porcentaje
- **Núcleos de CPU**: Número de núcleos de CPU

### Memoria

- **Memoria total**: Memoria total disponible
- **Memoria usada**: Memoria actualmente en uso
- **Memoria libre**: Memoria libre disponible
- **Porcentaje de uso de memoria**: Utilización de memoria como porcentaje

### Disco

Para cada disco/volumen montado:

- **Espacio total en disco**: Capacidad total del disco
- **Espacio en disco usado**: Espacio actualmente en uso
- **Espacio libre en disco**: Espacio libre disponible
- **Porcentaje de uso del disco**: Utilización del disco como porcentaje
- **Ruta del disco**: Ruta de montaje del disco

### Procesos

- **Nombre del proceso**: Nombre del proceso en ejecución
- **ID del proceso (PID)**: Identificador del proceso
- **Comando del proceso**: Comando completo usado para iniciar el proceso

## Criterios de monitoreo

Puedes configurar criterios para determinar cuándo tu servidor se considera en línea, degradado o fuera de línea.

### Tipos de verificación disponibles

| Tipo de verificación             | Descripción                                                                    |
| -------------------------------- | ------------------------------------------------------------------------------ |
| Está en línea                    | Si el agente del servidor está reportando (basado en el latido)                |
| Porcentaje de uso de CPU         | Porcentaje de utilización de CPU actual                                        |
| Porcentaje de uso de memoria     | Porcentaje de utilización de memoria actual                                    |
| Porcentaje de uso del disco      | Porcentaje de utilización del disco actual (para una ruta de disco específica) |
| Nombre del proceso del servidor  | Verifica si hay un proceso con un nombre específico en ejecución               |
| Comando del proceso del servidor | Verifica si hay un proceso con un comando específico en ejecución              |
| PID del proceso del servidor     | Verifica si hay un proceso con un PID específico en ejecución                  |

### Tipos de filtro

Para métricas numéricas (CPU, memoria, disco):

- **Mayor que**: El valor supera un umbral
- **Menor que**: El valor está por debajo de un umbral
- **Mayor o igual que**: El valor está en o por encima de un umbral
- **Menor o igual que**: El valor está en o por debajo de un umbral
- **Evaluar en el tiempo**: Evaluar usando agregación (Promedio, Suma, Máximo, Mínimo, Todos los valores, Cualquier valor) sobre una ventana de tiempo

Para verificaciones de procesos:

- **Está ejecutándose**: El proceso está actualmente en ejecución
- **No está ejecutándose**: El proceso no está en ejecución

### Ejemplos de criterios

#### Marcar el servidor como fuera de línea si el agente deja de reportar

- **Verificar en**: Está en línea
- **Tipo de filtro**: Falso

#### Alertar cuando el uso de CPU supera el 90%

- **Verificar en**: Porcentaje de uso de CPU
- **Tipo de filtro**: Mayor que
- **Valor**: 90

#### Alertar cuando el uso del disco supera el 85%

- **Verificar en**: Porcentaje de uso del disco
- **Ruta del disco**: `/`
- **Tipo de filtro**: Mayor que
- **Valor**: 85

#### Alertar cuando el uso de memoria supera el 80%

- **Verificar en**: Porcentaje de uso de memoria
- **Tipo de filtro**: Mayor que
- **Valor**: 80

#### Alertar si un proceso crítico deja de ejecutarse

- **Verificar en**: Nombre del proceso del servidor
- **Tipo de filtro**: No está ejecutándose
- **Valor**: `nginx`

## Solución de problemas

### El agente no reporta

- Verifica que el agente esté en ejecución: `sudo oneuptime-infrastructure-agent status`
- Revisa los registros del agente: `sudo oneuptime-infrastructure-agent logs -n 50`
- Confirma que la clave secreta sea correcta
- Asegúrate de que el servidor pueda alcanzar la URL de tu instancia de OneUptime
- Verifica que las reglas del firewall permitan conexiones HTTPS salientes

### Uso elevado de recursos por el agente

El agente está diseñado para ser ligero. Si notas un uso elevado de recursos:

- Reinicia el agente: `sudo oneuptime-infrastructure-agent restart`
- Revisa los registros del agente para detectar errores

### Problemas de proxy

- Verifica que la URL y el puerto del proxy sean correctos
- Asegúrate de que el proxy permita conexiones a tu instancia de OneUptime
- Vuelve a configurar con: `sudo oneuptime-infrastructure-agent configure --proxy-url=http://proxy:port --secret-key=YOUR_KEY --oneuptime-url=YOUR_URL`

## Buenas prácticas

1. **Establece umbrales significativos**: Configura criterios de degradado y fuera de línea que coincidan con los rangos de operación normal de tu servidor
2. **Monitorea los procesos críticos**: Usa el monitoreo de procesos para asegurarte de que servicios esenciales como servidores web y bases de datos siempre estén en ejecución
3. **Monitorea el uso del disco de forma proactiva**: Los problemas de espacio en disco pueden causar fallos en cascada de la aplicación; establece alertas mucho antes de que los discos se llenen
4. **Usa "Evaluar en el tiempo"**: Para métricas como la CPU que pueden tener picos breves, usa la agregación basada en el tiempo para evitar falsas alertas
5. **Mantén actualizado el agente**: Actualiza periódicamente el agente de infraestructura para obtener las últimas mejoras y correcciones
