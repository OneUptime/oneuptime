# Visión general de Crossplane

El proveedor de Crossplane de OneUptime gestiona su proyecto de OneUptime desde Kubernetes. Declare los monitores, las páginas de estado, las políticas de guardia, los equipos, las etiquetas y los demás registros de su proyecto como recursos de Kubernetes, y Crossplane mantiene su proyecto tal como lo describen: crea lo nuevo, cambia lo que usted edita, revierte lo que alguien cambió en otro lugar y elimina lo que usted quita. Argo CD, Flux y cualquier otra herramienta que aplique manifiestos también los aplican. Funciona con OneUptime Cloud y con una instancia de OneUptime autoalojada.

:::cards
- [Cómo funciona el proveedor](#cómo-funciona-el-proveedor): Tipos, espacios de nombres y la clave de API que hay detrás.
- [Instalar el proveedor](#instalar-el-proveedor): El paquete y la versión que elegir.
- [Dar al proveedor su clave de API](#dar-al-proveedor-su-clave-de-api): Un Secret y un ProviderConfig en su espacio de nombres.
- [Crear sus primeros recursos](#crear-sus-primeros-recursos): Un monitor, la etiqueta que lleva y los estados que establece.
:::

## Cómo funciona el proveedor

El proveedor es un paquete de Crossplane. Una vez instalado, añade al grupo de API `crossplane.oneuptime.com` un tipo de recurso por cada tipo de registro de la API de OneUptime: `Monitor`, `StatusPage`, `OnCallPolicy`, `Team`, `Label` y más de 400 tipos más. Cada recurso de estos tipos vive en un espacio de nombres y representa un registro de su proyecto. El proveedor lee y cambia el registro a través de la API REST de OneUptime, con una clave de API de su proyecto, y escribe lo que encuentra en el estado del recurso.

El proveedor se genera a partir del [proveedor de Terraform](/docs/terraform/index), versión tras versión: sus tipos son los recursos del proveedor de Terraform, con los mismos campos y, por debajo, las mismas solicitudes a la API.

## Antes de empezar

- **Crossplane 2.0 o posterior.** Los recursos del proveedor viven en espacios de nombres, que llegaron con Crossplane 2. La propia documentación de Crossplane explica cómo instalarlo en su clúster.
- **Una clave de API de su proyecto.** El [Inicio rápido](/docs/terraform/quick-start#crear-una-clave-de-api-del-proyecto) de Terraform muestra cómo crear una en **Ajustes del proyecto → Avanzado → Claves de API**. La clave decide a qué proyecto pertenecen los recursos y qué puede cambiar en él el proveedor.
- **En OneUptime Cloud, el plan Growth o superior.** Las claves de API de un proyecto solo funcionan con él.

## Instalar el proveedor

Instale el paquete con un `Provider`:

```yaml title="provider.yaml"
apiVersion: pkg.crossplane.io/v1
kind: Provider
metadata:
  name: provider-oneuptime
spec:
  package: ghcr.io/oneuptime/provider-oneuptime:{{CROSSPLANE_PROVIDER_VERSION}}
```

```bash
kubectl apply -f provider.yaml
kubectl get providers.pkg.crossplane.io provider-oneuptime
```

Cuando tanto `INSTALLED` como `HEALTHY` indican `True`, el proveedor está en ejecución. El mismo paquete está en Docker Hub, como `docker.io/oneuptime/provider-oneuptime`.

### Elegir una versión

Las versiones del paquete son las de OneUptime: `{{CROSSPLANE_PROVIDER_VERSION}}` se genera a partir de esa versión de OneUptime, la que sirve esta página. En OneUptime Cloud, use la más reciente. En una instancia de OneUptime autoalojada, use la versión de su instancia, para que el proveedor conozca los campos que conoce la API de su instancia.

### Activar solo los tipos que usa

El chart de Helm de Crossplane activa por defecto todos los tipos de todos los proveedores (su valor `provider.defaultActivations`), lo que en este proveedor supone más de 400 definiciones de recursos personalizados. Para activar solo los tipos que usa, instale Crossplane con `--set provider.defaultActivations={}` e indique los tipos en una política:

```yaml title="activation-policy.yaml"
apiVersion: apiextensions.crossplane.io/v1alpha1
kind: ManagedResourceActivationPolicy
metadata:
  name: oneuptime
spec:
  activate:
    - monitors.crossplane.oneuptime.com
    - monitorstatusdefinitions.crossplane.oneuptime.com
    - labels.crossplane.oneuptime.com
    - statuspages.crossplane.oneuptime.com
```

## Dar al proveedor su clave de API

Ponga la clave en un Secret del espacio de nombres donde vivirán sus recursos, y haga que un `ProviderConfig` de ese espacio de nombres apunte a él. Crear el Secret con `kubectl` mantiene la clave fuera de sus archivos:

```bash
kubectl create namespace team-a
kubectl -n team-a create secret generic oneuptime --from-literal=api-key="<your-api-key>"
```

```yaml title="provider-config.yaml"
apiVersion: crossplane.oneuptime.com/v1beta1
kind: ProviderConfig
metadata:
  name: default
  namespace: team-a
spec:
  credentials:
    secretRef:
      name: oneuptime
      key: api-key
```

Un `ProviderConfig` solo lee los Secrets de su propio espacio de nombres, así que la clave de un espacio de nombres no se puede usar desde otro. Cada recurso indica su `ProviderConfig` en `spec.providerConfigRef`.

### Usar una instancia de OneUptime autoalojada

Indique en el `ProviderConfig` la dirección de su instancia de OneUptime como `url`, sin `/api`:

```yaml title="provider-config.yaml"
apiVersion: crossplane.oneuptime.com/v1beta1
kind: ProviderConfig
metadata:
  name: default
  namespace: team-a
spec:
  url: https://oneuptime.example.com
  credentials:
    secretRef:
      name: oneuptime
      key: api-key
```

### Compartir una clave entre espacios de nombres

Un `ClusterProviderConfig` lee un Secret de cualquier espacio de nombres, y los recursos de todos los espacios de nombres pueden indicarlo. Use uno cuando un solo equipo se encargue de la clave de todo el clúster:

```yaml title="cluster-provider-config.yaml"
apiVersion: crossplane.oneuptime.com/v1beta1
kind: ClusterProviderConfig
metadata:
  name: oneuptime
spec:
  credentials:
    source: Secret
    secretRef:
      namespace: crossplane-system
      name: oneuptime
      key: credentials
```

Un recurso lo indica con `kind: ClusterProviderConfig` en su `providerConfigRef`. El Secret contiene solo la clave, o un JSON que indica también la dirección: `{"api_key": "<your-api-key>", "oneuptime_url": "https://oneuptime.example.com"}`. Una `url` en el `ClusterProviderConfig` tiene prioridad sobre la del JSON. Un `ClusterProviderConfig` también puede leer la clave de una variable de entorno o de un archivo del pod del proveedor, con `source: Environment` o `source: Filesystem`.

## Crear sus primeros recursos

Un monitor de su página de inicio, con una etiqueta, que establece los estados **Sin conexión** y **Operativo** de su proyecto.

:::steps
### Observar los estados que establece

OneUptime creó los estados de su proyecto junto con el proyecto, así que se observan en lugar de crearse: el proveedor los lee por sus ID y nunca los cambia ni los elimina. Con la [CLI de OneUptime](/docs/cli/resource-operations#listar-registros), `oneuptime monitor-status list --fields _id,name` muestra los ID.

```yaml title="statuses.yaml"
apiVersion: crossplane.oneuptime.com/v1alpha1
kind: MonitorStatusDefinition
metadata:
  name: offline
  namespace: team-a
  annotations:
    crossplane.io/external-name: "<the Offline status's ID>"
spec:
  managementPolicies: ["Observe"]
  providerConfigRef:
    kind: ProviderConfig
    name: default
  forProvider: {}
---
apiVersion: crossplane.oneuptime.com/v1alpha1
kind: MonitorStatusDefinition
metadata:
  name: operational
  namespace: team-a
  annotations:
    crossplane.io/external-name: "<the Operational status's ID>"
spec:
  managementPolicies: ["Observe"]
  providerConfigRef:
    kind: ProviderConfig
    name: default
  forProvider: {}
```

### Crear la etiqueta y el monitor

El monitor se refiere a la etiqueta y a los estados por sus nombres de Kubernetes, y el proveedor rellena sus ID:

```yaml title="homepage.yaml"
apiVersion: crossplane.oneuptime.com/v1alpha1
kind: Label
metadata:
  name: production
  namespace: team-a
spec:
  providerConfigRef:
    kind: ProviderConfig
    name: default
  forProvider:
    name: Production
    color: "#16a34a"
---
apiVersion: crossplane.oneuptime.com/v1alpha1
kind: Monitor
metadata:
  name: homepage
  namespace: team-a
spec:
  providerConfigRef:
    kind: ProviderConfig
    name: default
  forProvider:
    name: Homepage
    description: Checks that the homepage responds
    monitorType: Website
    monitoringInterval: "*/5 * * * *"
    labelsRefs:
      - name: production
    monitorSteps:
      - monitorDestination: https://example.com
        monitorDestinationType: URL
        requestType: GET
        criteria:
          - name: Offline
            description: The homepage does not respond
            filterCondition: Any
            changeMonitorStatus: true
            monitorStatusIdRef:
              name: offline
            filters:
              - checkOn: Is Online
                filterType: "False"
          - name: Online
            description: The homepage responds
            filterCondition: All
            changeMonitorStatus: true
            monitorStatusIdRef:
              name: operational
            filters:
              - checkOn: Is Online
                filterType: "True"
```

### Verlos en OneUptime

```bash
kubectl apply -f statuses.yaml -f homepage.yaml
kubectl -n team-a get managed
```

Cuando `SYNCED` y `READY` indican `True`, el registro está en su proyecto. `EXTERNAL-NAME` es su ID en OneUptime.
:::

## Próximos pasos

- [Gestionar recursos](/docs/crossplane/managing-resources) explica los tipos y sus campos, las referencias, cómo importar lo que ya tiene, los Secrets que crea OneUptime y qué revisar cuando un recurso no está listo.
- La [Guía completa de Terraform](/docs/terraform/complete-guide) describe los recursos y sus campos, los mismos que tienen los tipos del proveedor.
