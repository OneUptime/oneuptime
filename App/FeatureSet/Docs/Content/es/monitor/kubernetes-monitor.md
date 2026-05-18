# Monitor de Kubernetes

La monitorización de Kubernetes le permite supervisar la salud y el rendimiento de sus clústeres de Kubernetes, incluyendo nodos, pods, cargas de trabajo y componentes del plano de control. OneUptime recopila métricas de su clúster y las evalúa según los criterios que configure.

## Visión general

Los monitores de Kubernetes utilizan métricas de su clúster para proporcionar una visibilidad profunda de su infraestructura. Esto le permite:

- Monitorear la salud del clúster, namespace, carga de trabajo, nodo y pod
- Rastrear el uso de CPU, memoria, disco y red entre los recursos
- Detectar caídas de pods, reinicios y fallos de programación
- Monitorear la disponibilidad de réplicas de Deployment
- Alertar sobre problemas del plano de control (etcd, API server, scheduler)
- Rastrear las solicitudes y los límites de recursos

## Crear un monitor de Kubernetes

1. Vaya a **Monitors** en el panel de OneUptime
2. Haga clic en **Create Monitor**
3. Seleccione **Kubernetes** como tipo de monitor
4. Seleccione el clúster y el alcance del recurso a monitorear
5. Configure los filtros de recursos y las consultas de métricas
6. Configure los criterios de monitorización según sea necesario

## Opciones de configuración

### Clúster

Seleccione el clúster de Kubernetes a monitorear. Los clústeres deben estar integrados con OneUptime mediante OpenTelemetry.

### Alcance del recurso

Elija el nivel al que monitorear los recursos:

| Alcance | Descripción |
|-------|-------------|
| Cluster | Monitorear todo el clúster |
| Namespace | Monitorear los recursos dentro de un namespace específico |
| Workload | Monitorear un deployment, statefulset, daemonset, job o cronjob específico |
| Node | Monitorear un nodo de clúster específico |
| Pod | Monitorear un pod específico |

### Filtros de recursos

Acote el alcance con filtros opcionales:

| Filtro | Descripción | Alcances aplicables |
|--------|-------------|-------------------|
| Namespace | Namespace de Kubernetes | Namespace, Workload, Pod |
| Workload Type | deployment, statefulset, daemonset, job, cronjob | Workload |
| Workload Name | Nombre de la carga de trabajo | Workload |
| Node Name | Nombre del nodo | Node |
| Pod Name | Nombre del pod | Pod |

### Consultas de métricas

Configure una o más consultas de métricas a evaluar. Cada consulta especifica:

- **Metric name** — La métrica de Kubernetes a consultar
- **Aggregation** — Cómo agregar los valores de la métrica
- **Filters** — Filtrado adicional basado en atributos

También puede crear **fórmulas** que combinan múltiples consultas de métricas mediante expresiones matemáticas.

### Ventana de tiempo móvil

Seleccione la ventana de tiempo para la evaluación de métricas:

- Past 1 Minute
- Past 5 Minutes
- Past 10 Minutes
- Past 15 Minutes
- Past 30 Minutes
- Past 60 Minutes

## Métricas comunes de Kubernetes

### Métricas de Pod

| Métrica | Descripción |
|--------|-------------|
| Pod CPU Usage | Consumo de CPU por los pods |
| Pod Memory Usage | Consumo de memoria por los pods |
| Pod Filesystem Usage | Uso de disco por los pods |
| Pod Network Receive/Transmit | Tráfico de red |
| Pod Phase | Fase actual del pod (Running, Pending, Failed, etc.) |

### Métricas de nodo

| Métrica | Descripción |
|--------|-------------|
| Node CPU Usage | Utilización de CPU por nodo |
| Node Memory Usage | Utilización de memoria por nodo |
| Node Filesystem Usage | Uso de disco por nodo |
| Node Disk I/O | Operaciones de lectura/escritura |
| Node Ready Condition | Si el nodo está listo |

### Métricas de contenedor

| Métrica | Descripción |
|--------|-------------|
| Container Restarts | Número de reinicios del contenedor |
| Container CPU/Memory Limits | Límites de recursos |
| Container CPU/Memory Requests | Solicitudes de recursos |
| Container Ready Status | Si los contenedores están listos |

### Métricas de carga de trabajo

| Métrica | Descripción |
|--------|-------------|
| Deployment Available/Unavailable Replicas | Recuentos de réplicas |
| DaemonSet Misscheduled Nodes | Problemas de programación |
| StatefulSet Ready Replicas | Recuento de réplicas listas |
| Job Active/Failed/Succeeded Pods | Estado del job |

## Criterios de monitorización

### Tipos de comprobación disponibles

| Tipo de comprobación | Descripción |
|------------|-------------|
| Metric Value | El valor de la consulta de métrica configurada o la fórmula |

### Tipos de agregación

| Agregación | Descripción |
|-------------|-------------|
| Average | Valor promedio en la ventana de tiempo |
| Sum | Suma de todos los valores |
| Maximum Value | Valor más alto en la ventana de tiempo |
| Minimum Value | Valor más bajo en la ventana de tiempo |
| All Values | Todos los valores deben coincidir con los criterios |
| Any Value | Al menos un valor debe coincidir |

### Tipos de filtro

- **Greater Than**, **Less Than**, **Greater Than or Equal To**, **Less Than or Equal To**, **Equal To**, **Not Equal To**

## Plantillas de alerta preconstruidas

OneUptime proporciona plantillas para escenarios comunes de monitorización de Kubernetes:

| Plantilla | Descripción | Umbral |
|----------|-------------|-----------|
| CrashLoopBackOff Detection | Recuento de reinicios del contenedor | > 5 restarts |
| Pod Stuck in Pending | Pods en fase Pending | > 0 pods |
| Node Not Ready | Condición de disponibilidad del nodo | = 0 (not ready) |
| High Node CPU | Utilización de CPU del nodo | > 90% |
| High Node Memory | Utilización de memoria del nodo | > 85% |
| Deployment Replica Mismatch | Réplicas no disponibles | > 0 replicas |
| Job Failures | Pods fallidos en un job | > 0 failures |
| etcd No Leader | Líder del clúster etcd ausente | = 0 (no leader) |
| API Server Throttling | Peticiones de API descartadas | > 0 requests |
| Scheduler Backlog | Pods pendientes en el scheduler | > 0 pods |
| High Node Disk Usage | Uso del sistema de archivos del nodo | > 90% |
| DaemonSet Unavailable | Nodos mal programados | > 0 nodes |

## Requisitos de configuración

Para usar la monitorización de Kubernetes, debe instalar el agente de Kubernetes de OneUptime en su clúster. El agente envía métricas del clúster, eventos, registros de pod y — por defecto — **trazas de aplicación y métricas RED de HTTP capturadas mediante eBPF** a OneUptime sobre OTLP. No se requieren cambios de código ni SDKs por aplicación para ver el tráfico a nivel de servicio.

Consulte la guía [Instalar el agente de Kubernetes](/docs/monitor/kubernetes-agent) — cubre la instalación con Helm de un solo comando, la opción `preset` para elegir la configuración correcta para su clúster (standard, GKE Autopilot, EKS Fargate) y los conmutadores `ebpf.features.*` para las familias de señales individuales (métricas RED de HTTP, gráfico de servicios, flujos de red, estadísticas TCP).
