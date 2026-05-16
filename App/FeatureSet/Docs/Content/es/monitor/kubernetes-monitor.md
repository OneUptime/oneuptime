# Monitor Kubernetes

El monitoreo Kubernetes te permite supervisar el estado y el rendimiento de tus clústeres Kubernetes, incluyendo nodos, pods, cargas de trabajo y componentes del plano de control. OneUptime recopila métricas de tu clúster y las evalúa según tus criterios configurados.

## Información general

Los monitores Kubernetes usan métricas de tu clúster para proporcionar visibilidad profunda sobre tu infraestructura. Esto te permite:

- Monitorear el estado del clúster, espacio de nombres, carga de trabajo, nodo y pod
- Rastrear el uso de CPU, memoria, disco y red entre los recursos
- Detectar fallos de pods, reinicios y errores de programación
- Monitorear la disponibilidad de réplicas del despliegue
- Alertar sobre problemas del plano de control (etcd, servidor de API, programador)
- Rastrear solicitudes y límites de recursos

## Creación de un monitor Kubernetes

1. Ve a **Monitores** en el panel de OneUptime
2. Haz clic en **Crear monitor**
3. Selecciona **Kubernetes** como tipo de monitor
4. Selecciona el clúster y el alcance de recursos a monitorear
5. Configura los filtros de recursos y las consultas de métricas
6. Configura los criterios de monitoreo según sea necesario

## Opciones de configuración

### Clúster

Selecciona el clúster Kubernetes a monitorear. Los clústeres deben integrarse con OneUptime a través de OpenTelemetry.

### Alcance de recursos

Elige el nivel en el que monitorear los recursos:

| Alcance | Descripción |
|-------|-------------|
| Clúster | Monitorea todo el clúster |
| Espacio de nombres | Monitorea los recursos dentro de un espacio de nombres específico |
| Carga de trabajo | Monitorea un despliegue, statefulset, daemonset, trabajo o cronjob específico |
| Nodo | Monitorea un nodo del clúster específico |
| Pod | Monitorea un pod específico |

### Filtros de recursos

Reduce el alcance con filtros opcionales:

| Filtro | Descripción | Alcances aplicables |
|--------|-------------|-------------------|
| Espacio de nombres | Espacio de nombres de Kubernetes | Espacio de nombres, Carga de trabajo, Pod |
| Tipo de carga de trabajo | deployment, statefulset, daemonset, job, cronjob | Carga de trabajo |
| Nombre de la carga de trabajo | Nombre de la carga de trabajo | Carga de trabajo |
| Nombre del nodo | Nombre del nodo | Nodo |
| Nombre del pod | Nombre del pod | Pod |

### Consultas de métricas

Configura una o más consultas de métricas para evaluar. Cada consulta especifica:

- **Nombre de la métrica**: La métrica de Kubernetes a consultar
- **Agregación**: Cómo agregar los valores de la métrica
- **Filtros**: Filtrado adicional basado en atributos

También puedes crear **fórmulas** que combinen múltiples consultas de métricas usando expresiones matemáticas.

### Ventana de tiempo deslizante

Selecciona la ventana de tiempo para la evaluación de métricas:

- Último 1 minuto
- Últimos 5 minutos
- Últimos 10 minutos
- Últimos 15 minutos
- Últimos 30 minutos
- Últimos 60 minutos

## Métricas comunes de Kubernetes

### Métricas de pod

| Métrica | Descripción |
|--------|-------------|
| Uso de CPU del pod | Consumo de CPU por pods |
| Uso de memoria del pod | Consumo de memoria por pods |
| Uso del sistema de archivos del pod | Uso del disco por pods |
| Recepción/transmisión de red del pod | Tráfico de red |
| Fase del pod | Fase actual del pod (En ejecución, Pendiente, Fallido, etc.) |

### Métricas de nodo

| Métrica | Descripción |
|--------|-------------|
| Uso de CPU del nodo | Utilización de CPU por nodo |
| Uso de memoria del nodo | Utilización de memoria por nodo |
| Uso del sistema de archivos del nodo | Uso del disco por nodo |
| E/S de disco del nodo | Operaciones de lectura/escritura |
| Condición de preparación del nodo | Si el nodo está listo |

### Métricas de contenedor

| Métrica | Descripción |
|--------|-------------|
| Reinicios del contenedor | Número de reinicios del contenedor |
| Límites de CPU/memoria del contenedor | Límites de recursos |
| Solicitudes de CPU/memoria del contenedor | Solicitudes de recursos |
| Estado de preparación del contenedor | Si los contenedores están listos |

### Métricas de carga de trabajo

| Métrica | Descripción |
|--------|-------------|
| Réplicas disponibles/no disponibles del despliegue | Recuentos de réplicas |
| Nodos mal programados del DaemonSet | Problemas de programación |
| Réplicas listas del StatefulSet | Recuento de réplicas listas |
| Pods activos/fallidos/exitosos del trabajo | Estado del trabajo |

## Criterios de monitoreo

### Tipos de verificación disponibles

| Tipo de verificación | Descripción |
|------------|-------------|
| Valor de métrica | El valor de la consulta de métrica o fórmula configurada |

### Tipos de agregación

| Agregación | Descripción |
|-------------|-------------|
| Promedio | Valor promedio durante la ventana de tiempo |
| Suma | Suma de todos los valores |
| Valor máximo | Valor más alto en la ventana de tiempo |
| Valor mínimo | Valor más bajo en la ventana de tiempo |
| Todos los valores | Todos los valores deben coincidir con los criterios |
| Cualquier valor | Al menos un valor debe coincidir |

### Tipos de filtro

- **Mayor que**, **Menor que**, **Mayor o igual que**, **Menor o igual que**, **Igual a**, **Diferente de**

## Plantillas de alerta predefinidas

OneUptime proporciona plantillas para escenarios comunes de monitoreo Kubernetes:

| Plantilla | Descripción | Umbral |
|----------|-------------|-----------|
| Detección de CrashLoopBackOff | Recuento de reinicios del contenedor | > 5 reinicios |
| Pod atascado en Pendiente | Pods en fase Pendiente | > 0 pods |
| Nodo no preparado | Condición de preparación del nodo | = 0 (no preparado) |
| CPU alta del nodo | Utilización de CPU del nodo | > 90% |
| Memoria alta del nodo | Utilización de memoria del nodo | > 85% |
| Desajuste de réplicas del despliegue | Réplicas no disponibles | > 0 réplicas |
| Fallos del trabajo | Pods fallidos en un trabajo | > 0 fallos |
| etcd sin líder | Líder del clúster etcd faltante | = 0 (sin líder) |
| Limitación del servidor de API | Solicitudes de API descartadas | > 0 solicitudes |
| Trabajo pendiente del programador | Pods pendientes en el programador | > 0 pods |
| Uso de disco alto del nodo | Uso del sistema de archivos del nodo | > 90% |
| DaemonSet no disponible | Nodos mal programados | > 0 nodos |

## Requisitos de configuración

Para usar el monitoreo Kubernetes, necesitas instalar el agente Kubernetes de OneUptime en tu clúster. El agente envía métricas del clúster, eventos y registros de pods a OneUptime a través de OTLP.

Consulta la guía [Instalar el Agente Kubernetes](/docs/monitor/kubernetes-agent), que cubre la instalación con un solo comando de Helm y la opción `preset` para elegir la configuración correcta para tu clúster (standard, GKE Autopilot, EKS Fargate).
