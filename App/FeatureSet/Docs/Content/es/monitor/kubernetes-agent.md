# Instalar el Agente Kubernetes

El agente Kubernetes de OneUptime recopila métricas del clúster, eventos y registros de pods desde tu clúster Kubernetes y los envía a OneUptime. Se distribuye como un gráfico Helm.

## Inicio rápido

```bash
helm repo add oneuptime https://helm-chart.oneuptime.com
helm repo update

helm install oneuptime-agent oneuptime/kubernetes-agent \
  --namespace oneuptime-kubernetes-agent \
  --create-namespace \
  --set oneuptime.url=https://oneuptime.com \
  --set oneuptime.apiKey=<YOUR_API_KEY> \
  --set clusterName=<A_UNIQUE_NAME_FOR_THIS_CLUSTER>
```

Tu clúster aparecerá en OneUptime en unos pocos minutos.

## Elige el ajuste predefinido adecuado para tu clúster

Las diferentes distribuciones de Kubernetes tienen diferentes restricciones, principalmente si las cargas de trabajo pueden montar volúmenes `hostPath`. En lugar de obligarte a leer documentación de seguridad, el gráfico expone una única opción de nivel superior: `preset`.

| Ajuste predefinido | Usar para | Recopilación de registros | Notas |
| --- | --- | --- | --- |
| `standard` (predeterminado) | Auto-gestionado, **EKS en EC2**, **GKE Standard**, **AKS**, minikube, kind, k3s | DaemonSet leyendo `/var/log/pods` mediante hostPath | Menor sobrecarga. hostPath está disponible en estas plataformas. |
| `gke-autopilot` | **GKE Autopilot** | Recolector de API Kubernetes (Deployment) | hostPath está bloqueado en Autopilot. Establece un contexto de seguridad reforzado que supera los estándares de seguridad de pods de Autopilot. |
| `eks-fargate` | **EKS Fargate** | Recolector de API Kubernetes (Deployment) | Igual que `gke-autopilot`. Fargate bloquea hostPath y DaemonSets. |

Si no estás seguro, deja `preset` sin configurar: obtendrás los valores predeterminados de `standard`. Si tu clúster rechaza la instalación con un error de política de seguridad de Pod que menciona `hostPath`, cambia a `gke-autopilot` (o `eks-fargate` en EKS Fargate) y vuelve a instalar.

### Ejemplos

**GKE Standard, EKS en EC2, auto-gestionado o AKS:**

```bash
helm install oneuptime-agent oneuptime/kubernetes-agent \
  --namespace oneuptime-kubernetes-agent --create-namespace \
  --set oneuptime.url=https://oneuptime.com \
  --set oneuptime.apiKey=<YOUR_API_KEY> \
  --set clusterName=prod
```

**GKE Autopilot:**

```bash
helm install oneuptime-agent oneuptime/kubernetes-agent \
  --namespace oneuptime-kubernetes-agent --create-namespace \
  --set oneuptime.url=https://oneuptime.com \
  --set oneuptime.apiKey=<YOUR_API_KEY> \
  --set clusterName=prod-gke-autopilot \
  --set preset=gke-autopilot
```

**EKS Fargate:**

```bash
helm install oneuptime-agent oneuptime/kubernetes-agent \
  --namespace oneuptime-kubernetes-agent --create-namespace \
  --set oneuptime.url=https://oneuptime.com \
  --set oneuptime.apiKey=<YOUR_API_KEY> \
  --set clusterName=prod-eks-fargate \
  --set preset=eks-fargate
```

## Cómo difieren los dos modos de recopilación de registros

Internamente, `preset` establece `logs.mode`, y también puedes establecerlo directamente si necesitas anular el valor predeterminado del ajuste predefinido.

### Modo DaemonSet (`logs.mode: daemonset`)

Un DaemonSet ejecuta un pod del Colector OpenTelemetry por nodo. Rastrea los archivos de registro en `/var/log/pods/` mediante un volumen hostPath y los reenvía a través de OTLP.

- **Ventajas**: menor sobrecarga, escala linealmente con los nodos, sin carga en el servidor de la API de Kubernetes, maneja la rotación de registros.
- **Desventajas**: requiere hostPath, requiere la capacidad de programar DaemonSets; ambos no están disponibles en GKE Autopilot y EKS Fargate.

### Modo API (`logs.mode: api`)

Un Deployment de una sola réplica (la imagen `oneuptime/kubernetes-log-tailer`) usa la API de Kubernetes para transmitir los registros de los contenedores, el mismo punto de conexión que usa `kubectl logs -f`. Sin hostPath, sin acceso al host, sin DaemonSet.

- **Ventajas**: funciona en GKE Autopilot, EKS Fargate y cualquier clúster que bloquee hostPath o aplique el estándar de seguridad de pods `restricted`.
- **Desventajas**: cada flujo de contenedor es una conexión de larga duración con `kube-apiserver`. En la práctica, una réplica maneja cómodamente unos pocos miles de contenedores. Para clústeres muy grandes, fragmenta por espacio de nombres usando `logs.api.replicas` más `namespaceFilters.include` en cada réplica.

### ¿Cuál debes usar?

Si hostPath funciona, usa DaemonSet. En cualquier otro lugar, usa el modo API. El ajuste `preset` elige el correcto para ti.

También puedes deshabilitar la recopilación de registros por completo con `--set logs.enabled=false` y enviar los registros de la aplicación a través de los SDK de OpenTelemetry. Consulta los [documentos de OpenTelemetry](/docs/telemetry/open-telemetry).

## Opciones comunes

| Opción | Predeterminado | Descripción |
| --- | --- | --- |
| `preset` | (vacío, tratado como `standard`) | Consulta la tabla anterior. |
| `oneuptime.url` | *(requerido)* | URL de tu instancia de OneUptime. |
| `oneuptime.apiKey` | *(requerido)* | Clave de API del proyecto (Configuración → Claves de API). |
| `clusterName` | *(requerido)* | Nombre único para este clúster. Se aplica como `k8s.cluster.name` en cada registro. |
| `namespaceFilters.include` | `[]` | Si se establece, solo se monitorean estos espacios de nombres. |
| `namespaceFilters.exclude` | `["kube-system"]` | Espacios de nombres a omitir. |
| `logs.enabled` | `true` | Activa o desactiva la recopilación de registros. |
| `logs.mode` | (derivado de `preset`) | `daemonset`, `api` o `disabled`. Anula el ajuste predefinido. |
| `logs.api.replicas` | `1` | Número de réplicas del Deployment del recolector de registros (solo en modo API). |
| `controlPlane.enabled` | `false` | Sondea etcd / api-server / scheduler / controller-manager. Solo clústeres auto-gestionados: las ofertas gestionadas (EKS/GKE/AKS) generalmente no exponen estos puntos de conexión. |

Consulta el [`values.yaml` del gráfico](https://github.com/OneUptime/oneuptime/blob/master/HelmChart/Public/kubernetes-agent/values.yaml) para ver la lista completa.

## Actualización

```bash
helm repo update
helm upgrade oneuptime-agent oneuptime/kubernetes-agent \
  --namespace oneuptime-kubernetes-agent \
  --reuse-values
```

`--reuse-values` mantiene tu configuración existente; pasa cualquier nueva anulación de `--set` encima de ella.

## Desinstalación

```bash
helm uninstall oneuptime-agent --namespace oneuptime-kubernetes-agent
kubectl delete namespace oneuptime-kubernetes-agent
```

## Solución de problemas

### La instalación falla con "hostPath volumes are not allowed"

Tu clúster bloquea hostPath. Cambia a un ajuste predefinido de modo API:

```bash
helm upgrade oneuptime-agent oneuptime/kubernetes-agent \
  --namespace oneuptime-kubernetes-agent \
  --reuse-values \
  --set preset=gke-autopilot   # o eks-fargate
```

### No aparecen registros en OneUptime

Comprueba los pods del agente:

```bash
kubectl get pods -n oneuptime-kubernetes-agent
kubectl logs -n oneuptime-kubernetes-agent -l app.kubernetes.io/part-of=oneuptime --tail=200
```

En modo API, el pod del recolector de registros expone `/healthz` en el puerto 13133; accede mediante `kubectl port-forward` para obtener una instantánea del estado de exportación.

### Mi clúster tiene demasiados pods para una réplica del recolector de registros (solo modo API)

Escala horizontalmente fragmentando los espacios de nombres. Implementa una vez por grupo de espacios de nombres:

```bash
helm install oneuptime-agent-ns-a oneuptime/kubernetes-agent \
  --set preset=gke-autopilot \
  --set namespaceFilters.include={app-a,app-b} \
  ...
```

Alternativamente, aumenta `logs.api.replicas`, pero ten en cuenta que cada réplica procesa todos los espacios de nombres permitidos, por lo que para deduplicación aún necesitas la fragmentación por espacios de nombres.
